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
import auditLogger from '../../lib/wholesale/audit-logger.js';
import orderStore from '../../lib/wholesale/order-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

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

// In-memory order storage (use database in production)
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
    const allocation = await allocateOrder(cart, catalog, {
      allocation_strategy,
      broker_fee_percent: 10.0,
      tax_rate: taxConfig.rate,
      tax_label: taxConfig.label
    });

    res.json({
      ok: allocation.ok,
      preview: allocation,
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

    console.log('[Checkout] Starting checkout execution');
    console.log(`  Buyer: ${buyer_id}`);
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
    const allocation = await allocateOrder(cart, catalog, {
      allocation_strategy,
      broker_fee_percent: 10.0,
      tax_rate: taxConfig.rate,
      tax_label: taxConfig.label
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
          providerConfig = {
            stripeSecretKey: process.env.STRIPE_SECRET_KEY || 'demo-stripe-key',
            webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
            connectedAccountId: subOrder.stripe_account_id || null
          };
        } else {
          providerConfig = {
            squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || 'demo-token',
            environment: 'sandbox',
            brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID || 'greenreach-merchant-id'
          };
        }

        // Create payment provider
        const paymentProvider = PaymentProviderFactory.create(farmPaymentProvider, providerConfig);

        // Execute payment
        const paymentResult = await paymentProvider.createPayment({
          farmSubOrderId: subOrderId,
          farmMerchantId: subOrder.farm_id, // TODO: Use actual Square merchant ID
          farmLocationId: 'demo-location-id', // TODO: Get from farm record
          amountMoney: {
            amount: Math.round(subOrder.total * 100), // Convert to cents
            currency: 'USD'
          },
          brokerFeeMoney: {
            amount: Math.round(subOrder.broker_fee_amount * 100),
            currency: 'USD'
          },
          idempotencyKey,
          metadata: {
            sourceId: payment_source.source_id,
            buyerId: buyer_id,
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

      } catch (paymentError) {
        console.error(`  Payment failed for ${subOrder.farm_name}:`, paymentError.message);

        // Payment failure - rollback all payments and release reservations
        console.error('[Checkout] Payment failure detected, initiating rollback...');

        // Release all reservations
        await releaseReservations(reservations);

        // TODO: Refund successful payments

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
      buyer_id,
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

    const order = orders.get(orderId);

    if (!order) {
      return res.status(404).json({
        ok: false,
        error: 'Order not found',
        order_id: orderId
      });
    }

    res.json({
      ok: true,
      order
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
