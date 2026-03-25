/**
 * GreenReach: Wholesale Checkout Orchestration
 * Coordinates reservations, payments, and order creation across multiple farms
 */

import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { allocateOrder, validateCart } from '../../lib/wholesale/order-allocator.js';
import { createReservations, releaseReservations, confirmReservations } from '../../lib/wholesale/reservation-manager.js';
import { PaymentProviderFactory } from '../../lib/payment-providers/base.js';
import '../../lib/payment-providers/square.js'; // Ensure Square provider is registered
import '../../lib/payment-providers/stripe.js'; // Ensure Stripe provider is registered
import jwt from 'jsonwebtoken';
import auditLogger from '../../lib/wholesale/audit-logger.js';
import orderStore from '../../lib/wholesale/order-store.js';
import { query } from '../../lib/database.js';
import { getBuyerDiscount } from '../../lib/wholesale/buyer-discount-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

function shouldReadFromDb() {
  const raw = String(process.env.WHOLESALE_READ_FROM_DB || '').trim().toLowerCase();
  if (!raw) return true;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function getBuyerIdFromRequest(req) {
  const directBuyerId = req.buyer?.id || req.wholesaleBuyer?.id || req.body?.buyer_id || null;
  if (directBuyerId) return String(directBuyerId);

  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return null;

  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret';
  if (!secret) return null;

  try {
    const payload = jwt.verify(token, secret);
    const buyerId = payload?.buyerId || payload?.sub || null;
    return buyerId ? String(buyerId) : null;
  } catch {
    return null;
  }
}

/**
 * Get Foxtrot API base URL with production fail-fast pattern
 * Production must have FOXTROT_API_URL env var set to HTTPS endpoint (e.g., CloudFront)
 * Development defaults to localhost:8091
 */
function getFoxtrotApiUrl() {
  const configured = process.env.FOXTROT_API_URL;
  if (!configured && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('FOXTROT_API_URL environment variable is required in production');
  }
  return configured || 'http://127.0.0.1:8091';
}

/**
 * Load tax configuration from farm.json
 * Returns { rate: number, label: string, business_number: string }
 */
function loadFarmTaxConfig() {
  try {
    const farmJsonPath = path.resolve(__dirname, '../../public/data/farm.json');
    if (fs.existsSync(farmJsonPath)) {
      const farmData = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
      if (farmData.tax && typeof farmData.tax.rate === 'number') {
        return farmData.tax;
      }
    }
  } catch (err) {
    console.error('[Checkout] Failed to load farm tax config:', err.message);
  }
  return { rate: 0, label: 'TAX', business_number: '' };
}

// In-memory fallback for same-process reads; persisted store is source of truth
const orders = new Map();

/**
 * POST /api/wholesale/checkout/preview
 * Preview order allocation without creating reservations
 * 
 * Request body:
 * {
 *   cart: {
 *     items: [{sku_id, qty}],
 *     delivery: {address, delivery_date, zip}
 *   },
 *   allocation_strategy: 'closest' | 'cheapest' | 'earliest'
 * }
 */
router.post('/preview', async (req, res) => {
  try {
    const { cart, allocation_strategy = 'closest' } = req.body;

    // Validate cart
    const validation = validateCart(cart);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid cart',
        validation_errors: validation.errors
      });
    }

    // Fetch current catalog from Foxtrot edge server
    const foxtrotApi = getFoxtrotApiUrl();
    const catalogUrl = `${foxtrotApi}/api/wholesale/catalog`;
    const catalogResponse = await fetch(catalogUrl);
    
    if (!catalogResponse.ok) {
      throw new Error('Failed to fetch catalog');
    }
    
    const catalog = await catalogResponse.json();

    // Allocate order
    const taxConfig = loadFarmTaxConfig();
    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    // Resolve buyer discount from purchase history (optional auth on preview)
    const previewBuyerId = getBuyerIdFromRequest(req);
    const buyerDiscount = previewBuyerId ? await getBuyerDiscount(previewBuyerId) : { rate: 0, tier: 'tier-1', trailing_spend: 0 };

    const allocation = await allocateOrder(cart, catalog, {
      allocation_strategy,
      broker_fee_percent: commissionRate * 100,
      tax_rate: taxConfig.rate,
      tax_label: taxConfig.label,
      buyer_discount_rate: buyerDiscount.rate
    });

    res.json({
      ok: allocation.ok,
      preview: allocation,
      buyer_discount: buyerDiscount,
      next_steps: allocation.ok 
        ? 'Proceed to payment by calling POST /api/wholesale/checkout/execute'
        : 'Review unallocated items and adjust cart'
    });

  } catch (error) {
    console.error('[Checkout] Preview failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to preview checkout',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/checkout/execute
 * Execute full checkout: allocate, reserve, create payments
 * 
 * Request body:
 * {
 *   cart: {items, delivery},
 *   buyer_id: string,
 *   payment_source: {source_id: string, type: 'card'},
 *   allocation_strategy: string
 * }
 */
router.post('/execute', async (req, res) => {
  const checkoutStartTime = Date.now();
  let masterOrderId = null;
  let reservations = [];

  try {
    const {
      cart,
      buyer_id,
      payment_source,
      allocation_strategy = 'closest'
    } = req.body;

    const resolvedBuyerId = getBuyerIdFromRequest(req);
    if (!resolvedBuyerId) {
      return res.status(401).json({
        ok: false,
        error: 'Buyer authentication required',
        message: 'Provide bearer token or buyer_id'
      });
    }

    console.log('[Checkout] Starting checkout execution');
    console.log(`  Buyer: ${resolvedBuyerId}`);
    console.log(`  Cart items: ${cart.items.length}`);

    // Validate cart
    const validation = validateCart(cart);
    if (!validation.valid) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid cart',
        validation_errors: validation.errors
      });
    }

    // Validate payment source
    if (!payment_source || !payment_source.source_id) {
      return res.status(400).json({
        ok: false,
        error: 'Payment source is required'
      });
    }

    // Generate master order ID
    masterOrderId = `MO-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    // Step 1: Fetch catalog
    console.log('[Checkout] Step 1: Fetching catalog...');
    const foxtrotApi = getFoxtrotApiUrl();
    const catalogUrl = `${foxtrotApi}/api/wholesale/catalog`;
    const catalogResponse = await fetch(catalogUrl);
    
    if (!catalogResponse.ok) {
      throw new Error('Failed to fetch catalog');
    }
    
    const catalog = await catalogResponse.json();

    // Step 2: Allocate order
    console.log('[Checkout] Step 2: Allocating order...');
    const taxConfig = loadFarmTaxConfig();
    const commissionRate = Number(process.env.WHOLESALE_COMMISSION_RATE || 0.12);

    // Compute buyer volume discount from purchase history
    const buyerDiscount = await getBuyerDiscount(resolvedBuyerId);
    console.log(`[Checkout] Buyer discount: ${(buyerDiscount.rate * 100).toFixed(1)}% (tier: ${buyerDiscount.tier}, 30-day spend: $${buyerDiscount.trailing_spend.toFixed(2)})`);

    const allocation = await allocateOrder(cart, catalog, {
      allocation_strategy,
      broker_fee_percent: commissionRate * 100,
      tax_rate: taxConfig.rate,
      tax_label: taxConfig.label,
      buyer_discount_rate: buyerDiscount.rate
    });

    if (!allocation.ok) {
      return res.status(409).json({
        ok: false,
        error: 'Order allocation failed',
        unallocated_items: allocation.unallocated_items,
        allocation
      });
    }

    // Step 3: Create reservations
    console.log('[Checkout] Step 3: Creating inventory reservations...');
    const reservationResult = await createReservations(
      allocation.sub_orders,
      masterOrderId,
      { ttl_minutes: 15 }
    );

    if (!reservationResult.ok) {
      return res.status(409).json({
        ok: false,
        error: 'Failed to reserve inventory',
        failed_reservations: reservationResult.failed_reservations,
        message: 'Some items could not be reserved. Inventory may have changed.'
      });
    }

    reservations = reservationResult.reservations;

    // Step 4: Execute payments per farm
    console.log('[Checkout] Step 4: Processing payments...');
    const paymentResults = [];
    let paymentAttempt = 0;

    for (const subOrder of allocation.sub_orders) {
      paymentAttempt++;
      
      try {
        // Generate sub-order ID
        const subOrderId = `SO-${masterOrderId}-${subOrder.farm_id}`;
        
        // Generate idempotency key
        const idempotencyKey = `${masterOrderId}_${subOrderId}_${paymentAttempt}`;

        // TODO: Get farm's payment provider credentials from database
        // Determine payment provider from farm config or request
        const farmPaymentProvider = req.body.payment_provider || subOrder.payment_provider || 'square';
        
        let providerConfig;
        if (farmPaymentProvider === 'stripe') {
          if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY environment variable is required for Stripe payments');
          }
          providerConfig = {
            stripeSecretKey: process.env.STRIPE_SECRET_KEY,
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            connectedAccountId: subOrder.stripe_account_id || null
          };
        } else {
          if (!process.env.SQUARE_ACCESS_TOKEN) {
            throw new Error('SQUARE_ACCESS_TOKEN environment variable is required for Square payments');
          }
          providerConfig = {
            squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
            environment: process.env.SQUARE_ENVIRONMENT || 'production',
            brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID || null
          };
        }

        // Create payment provider
        const paymentProvider = PaymentProviderFactory.create(farmPaymentProvider, providerConfig);

        // Execute payment
        const paymentResult = await paymentProvider.createPayment({
          farmSubOrderId: subOrderId,
          farmMerchantId: subOrder.farm_id,
          farmLocationId: subOrder.location_id || process.env.SQUARE_LOCATION_ID,
          amountMoney: {
            amount: Math.round(subOrder.total * 100), // Convert to cents
            currency: process.env.PAYMENT_CURRENCY || 'CAD'
          },
          brokerFeeMoney: {
            amount: Math.round(subOrder.broker_fee_amount * 100),
            currency: process.env.PAYMENT_CURRENCY || 'CAD'
          },
          idempotencyKey,
          metadata: {
            sourceId: payment_source.source_id,
            buyerId: resolvedBuyerId,
            masterOrderId,
            subOrderId
          }
        });

        if (!paymentResult.success) {
          throw new Error(`Payment failed: ${paymentResult.status}`);
        }

        paymentResults.push({
          sub_order_id: subOrderId,
          farm_id: subOrder.farm_id,
          farm_name: subOrder.farm_name,
          payment_id: paymentResult.paymentId,
          status: paymentResult.status,
          amount: subOrder.total,
          broker_fee: subOrder.broker_fee_amount,
          success: true
        });

        console.log(`  Payment successful: ${subOrderId} - $${subOrder.total}`);

        // Persist to payment_records table for reporting/exports
        try {
          await query(
            `INSERT INTO payment_records (payment_id, order_id, amount, currency, provider, status, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (payment_id) DO NOTHING`,
            [
              paymentResult.paymentId,
              subOrderId,
              subOrder.total,
              process.env.PAYMENT_CURRENCY || 'CAD',
              farmPaymentProvider,
              paymentResult.status || 'completed',
              JSON.stringify({ masterOrderId, buyerId: resolvedBuyerId, farmId: subOrder.farm_id, brokerFee: subOrder.broker_fee_amount })
            ]
          );
        } catch (dbErr) {
          console.warn('[Checkout] payment_records INSERT deferred:', dbErr.message);
        }

      } catch (paymentError) {
        console.error(`  Payment failed for ${subOrder.farm_name}:`, paymentError.message);

        // Payment failure - rollback all payments and release reservations
        console.error('[Checkout] Payment failure detected, initiating rollback...');

        // Release all reservations
        await releaseReservations(reservations);

        // Refund already-succeeded payments for other farms
        for (const successfulPayment of paymentResults.filter(p => p.success)) {
          try {
            const refundProviderConfig = (req.body.payment_provider === 'stripe')
              ? { stripeSecretKey: process.env.STRIPE_SECRET_KEY }
              : { squareAccessToken: process.env.SQUARE_ACCESS_TOKEN, environment: process.env.SQUARE_ENVIRONMENT || 'production' };
            const refundProvider = PaymentProviderFactory.create(
              req.body.payment_provider || 'square', refundProviderConfig
            );
            await refundProvider.refundPayment({
              paymentId: successfulPayment.payment_id,
              amountMoney: { amount: Math.round(successfulPayment.amount * 100), currency: process.env.PAYMENT_CURRENCY || 'CAD' },
              reason: 'Rollback: multi-farm checkout partial failure'
            });
            console.log(`  Refunded payment ${successfulPayment.payment_id} for ${successfulPayment.farm_name}`);
          } catch (refundErr) {
            console.error(`  CRITICAL: Failed to refund ${successfulPayment.payment_id}:`, refundErr.message);
          }
        }

        return res.status(402).json({
          ok: false,
          error: 'Payment failed',
          message: paymentError.message,
          failed_farm: subOrder.farm_name,
          successful_payments: paymentResults.filter(p => p.success).length,
          rollback_initiated: true
        });
      }
    }

    // Step 5: Confirm all reservations (payments succeeded)
    console.log('[Checkout] Step 5: Confirming inventory reservations...');
    for (const subOrder of allocation.sub_orders) {
      const subOrderId = `SO-${masterOrderId}-${subOrder.farm_id}`;
      const subOrderReservations = reservations.filter(r => r.farm_id === subOrder.farm_id);
      
      await confirmReservations(subOrderReservations, subOrderId);
    }

    // Step 6: Create order record
    const masterOrder = {
      id: masterOrderId,
      buyer_id: resolvedBuyerId,
      status: 'confirmed',
      created_at: new Date().toISOString(),
      cart,
      allocation,
      payments: paymentResults,
      reservations: reservations.map(r => r.reservation_id),
      totals: allocation.master_order,
      processing_time_ms: Date.now() - checkoutStartTime
    };

    orders.set(masterOrderId, masterOrder);
    await orderStore.saveOrder(masterOrder);
    for (const subOrder of allocation.sub_orders) {
      const subOrderId = `SO-${masterOrderId}-${subOrder.farm_id}`;
      await orderStore.saveSubOrder({
        sub_order_id: subOrderId,
        master_order_id: masterOrderId,
        farm_id: subOrder.farm_id,
        farm_name: subOrder.farm_name,
        status: 'pending_verification',
        line_items: subOrder.line_items,
        subtotal: subOrder.subtotal,
        broker_fee_amount: subOrder.broker_fee_amount,
        tax_amount: subOrder.tax_amount || 0,
        total: subOrder.total,
        verification_deadline: new Date(Date.now() + 24 * 3600000).toISOString(),
        payment_id: paymentResults.find(p => p.farm_id === subOrder.farm_id)?.payment_id
      });
    }

    console.log('[Checkout] Checkout complete!');
    console.log(`  Master Order: ${masterOrderId}`);
    console.log(`  Total: $${allocation.master_order.total}`);
    console.log(`  Processing time: ${masterOrder.processing_time_ms}ms`);

    res.json({
      ok: true,
      master_order_id: masterOrderId,
      status: 'confirmed',
      totals: allocation.master_order,
      sub_orders: allocation.sub_orders.map((sub, idx) => ({
        sub_order_id: `SO-${masterOrderId}-${sub.farm_id}`,
        farm_name: sub.farm_name,
        line_items: sub.line_items.length,
        total: sub.total,
        payment_id: paymentResults[idx]?.payment_id
      })),
      processing_time_ms: masterOrder.processing_time_ms,
      receipt_url: `/api/wholesale/orders/${masterOrderId}`
    });

  } catch (error) {
    console.error('[Checkout] Checkout execution failed:', error);

    // Cleanup: release any reservations
    if (reservations.length > 0) {
      console.log('[Checkout] Releasing reservations due to error...');
      await releaseReservations(reservations);
    }

    res.status(500).json({
      ok: false,
      error: 'Checkout execution failed',
      message: error.message,
      master_order_id: masterOrderId
    });
  }
});

/**
 * GET /api/wholesale/orders/:orderId
 * Get order details and receipt
 */
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params;
    const readFromDb = shouldReadFromDb();
    let order = null;

    if (readFromDb) {
      order = await orderStore.getOrder(orderId);
      if (!order) order = orders.get(orderId);
    } else {
      order = orders.get(orderId);
      if (!order) order = await orderStore.getOrder(orderId);
    }

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'Order not found',
        order_id: orderId
      });
    }

    res.json({
      ok: true,
      order,
      read_source: readFromDb ? 'db_primary' : 'map_primary'
    });

  } catch (error) {
    console.error('[Checkout] Failed to fetch order:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch order',
      message: error.message
    });
  }
});

export default router;
