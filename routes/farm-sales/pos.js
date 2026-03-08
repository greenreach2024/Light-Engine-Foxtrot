/**
 * Farm Sales - Point of Sale (POS)
 * Quick checkout terminal for walk-up farm stand sales (MULTI-TENANT)
 */

import express from 'express';
import { farmAuthMiddleware } from '../../lib/farm-auth.js';
import { farmStores } from '../../lib/farm-store.js';
import { shouldRouteToWholesale, routeToWholesale } from '../../lib/wholesale-integration.js';

const router = express.Router();

// Get server port from environment
const SERVER_PORT = process.env.PORT || 8091;
const BASE_URL = `http://localhost:${SERVER_PORT}`;

// Apply authentication to all routes
router.use(farmAuthMiddleware);

// Import order and payment helpers (in real implementation)
// For now, we'll make direct API calls to other endpoints

/**
 * POST /api/farm-sales/pos/checkout
 * Express checkout for POS terminal (combines order + payment)
 * 
 * Body:
 * {
 *   customer?: { name?, email?, phone?, customer_id? }, // Optional for walk-up, customer_id for store credits
 *   items: [{ sku_id, quantity }],
 *   payment: { method: 'cash'|'card'|'credit', card?: { last4, brand } },
 *   use_credits?: boolean, // Apply store credits if available
 *   cashier?: { id, name }
 * }
 */
router.post('/checkout', async (req, res) => {
  try {
    const { customer, items, payment, delivery, pricing, use_credits, cashier } = req.body;
    const farmId = req.farm_id;
    const authToken = req.headers.authorization; // Pass through to internal calls

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required',
        message: 'At least one item required for checkout'
      });
    }

    // Validate payment method
    if (!payment?.method || !['cash', 'card', 'credit'].includes(payment.method)) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_payment_method',
        message: 'Payment method must be "cash", "card", or "credit" (store credits)'
      });
    }

    const timestamp = new Date().toISOString();

    // Step 1: Fetch inventory details for items (farm-scoped)
    const inventory = await fetchInventory(authToken);
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = inventory.find(p => p.sku_id === item.sku_id);
      
      if (!product) {
        return res.status(400).json({
          ok: false,
          error: 'product_not_found',
          sku_id: item.sku_id
        });
      }

      if (product.available < item.quantity) {
        return res.status(400).json({
          ok: false,
          error: 'insufficient_inventory',
          sku_id: item.sku_id,
          requested: item.quantity,
          available: product.available
        });
      }

      const lineTotal = item.quantity * product.retail_price;
      subtotal += lineTotal;

      orderItems.push({
        sku_id: product.sku_id,
        name: product.name,
        category: product.category,
        quantity: item.quantity,
        unit: product.unit,
        unit_price: product.retail_price,
        line_total: lineTotal
      });
    }

    // Calculate totals
    const tax = subtotal * 0.08; // 8% sales tax
    const isDeliveryOrder = String(delivery?.option || delivery?.method || '').toLowerCase() === 'delivery';
    const deliveryFee = isDeliveryOrder
      ? Math.max(0, Number(pricing?.delivery_fee ?? delivery?.delivery_fee ?? 0) || 0)
      : 0;
    const tipAmount = Math.max(0, Number(pricing?.tip ?? pricing?.tip_amount ?? delivery?.tip_amount ?? 0) || 0);
    let total = subtotal + tax + deliveryFee + tipAmount;

    // Step 1.5: Apply store credits if requested and customer_id provided
    let creditsApplied = 0;
    let remainingBalance = 0;
    let creditTransaction = null;

    if (use_credits && customer?.customer_id && payment.method !== 'credit') {
      // Fetch customer credit balance
      const customerResponse = await fetch(`${BASE_URL}/api/farm-sales/customers/${customer.customer_id}`, {
        headers: { 'Authorization': authToken }
      });

      if (customerResponse.ok) {
        const customerData = await customerResponse.json();
        const availableCredits = customerData.customer?.credit_balance || 0;

        if (availableCredits > 0) {
          // Apply credits up to the order total
          creditsApplied = Math.min(availableCredits, total);
          total = total - creditsApplied;
        }
      }
    }

    // If payment method is 'credit' (full store credit payment)
    if (payment.method === 'credit') {
      if (!customer?.customer_id) {
        return res.status(400).json({
          ok: false,
          error: 'customer_id_required',
          message: 'customer_id required for store credit payments'
        });
      }

      // Check customer has sufficient credits
      const customerResponse = await fetch(`${BASE_URL}/api/farm-sales/customers/${customer.customer_id}`, {
        headers: { 'Authorization': authToken }
      });

      if (!customerResponse.ok) {
        return res.status(400).json({
          ok: false,
          error: 'customer_not_found'
        });
      }

      const customerData = await customerResponse.json();
      const availableCredits = customerData.customer?.credit_balance || 0;

      if (availableCredits < total) {
        return res.status(400).json({
          ok: false,
          error: 'insufficient_credits',
          required: total,
          available: availableCredits
        });
      }

      creditsApplied = total;
      total = 0; // Fully paid with credits
    }

    // Step 2: Create order through orders endpoint (farm-scoped)
    const orderResponse = await fetch(`${BASE_URL}/api/farm-sales/orders`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': authToken // Pass farm auth token
      },
      body: JSON.stringify({
        channel: isDeliveryOrder ? 'delivery' : 'pos',
        customer: customer || { name: 'Walk-up Customer' },
        items: orderItems,
        payment: {
          method: payment.method === 'credit' ? 'credit' : payment.method,
          amount: subtotal + tax + deliveryFee + tipAmount, // Original total before credits
          credits_applied: creditsApplied
        },
        delivery: isDeliveryOrder ? {
          method: 'delivery',
          address: delivery?.address || null,
          delivery_date: delivery?.date || null,
          time_slot: delivery?.time_slot || null,
          zone: delivery?.zone || null,
          delivery_fee: deliveryFee,
          tip_amount: tipAmount,
          notes: delivery?.notes || null
        } : {
          method: 'pickup'
        },
        pricing: {
          delivery_fee: deliveryFee,
          tip: tipAmount
        },
        notes: cashier ? `POS checkout by ${cashier.name}` : 'POS checkout'
      })
    });

    const orderData = await orderResponse.json();
    if (!orderData.ok) {
      throw new Error(`Order creation failed: ${orderData.error}`);
    }

    const order = orderData.order;

    // Step 2.5: Deduct store credits if any were applied
    if (creditsApplied > 0 && customer?.customer_id) {
      const useCreditsResponse = await fetch(
        `${BASE_URL}/api/farm-sales/customers/${customer.customer_id}/use-credits`,
        {
          method: 'POST',
          headers: { 
            'Content-Type': 'application/json',
            'Authorization': authToken
          },
          body: JSON.stringify({
            amount: creditsApplied,
            order_id: order.order_id,
            notes: `Applied to POS order ${order.order_id}`
          })
        }
      );

      if (useCreditsResponse.ok) {
        const creditData = await useCreditsResponse.json();
        creditTransaction = creditData.transaction;
        remainingBalance = creditData.new_balance;
      }
    }

    // Step 3: Process remaining payment through payments endpoint (if any amount due)
    let paymentData = null;
    if (total > 0) {
      const paymentResponse = await fetch(`${BASE_URL}/api/farm-sales/payments`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': authToken // Pass farm auth token
        },
        body: JSON.stringify({
          order_id: order.order_id,
          method: payment.method,
          amount: total,
          card: payment.card,
          reference: `POS checkout ${order.order_id}`
        })
      });

      paymentData = await paymentResponse.json();
      if (!paymentData.ok) {
        throw new Error(`Payment processing failed: ${paymentData.error}`);
      }
    }

    // Step 4: Confirm inventory reservation
    await fetch(`${BASE_URL}/api/farm-sales/inventory/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.order_id,
        items: items.map(item => ({
          sku_id: item.sku_id,
          quantity: item.quantity
        }))
      })
    });

    // Step 5: Mark order status based on channel
    if (!isDeliveryOrder) {
      await fetch(`${BASE_URL}/api/farm-sales/orders/${order.order_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({
          status: 'fulfilled',
          fulfillment: {
            status: 'completed',
            picked_at: timestamp,
            packed_at: timestamp,
            ready_at: timestamp,
            completed_at: timestamp
          },
          payment: {
            status: 'completed',
            completed_at: timestamp,
            reference: paymentData?.payment?.payment_id || 'CREDIT-PAYMENT',
            credits_applied: creditsApplied
          }
        })
      });
    } else {
      await fetch(`${BASE_URL}/api/farm-sales/orders/${order.order_id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({
          status: 'confirmed',
          fulfillment: {
            status: 'pending',
            picked_at: null,
            packed_at: null,
            ready_at: null,
            completed_at: null
          },
          payment: {
            status: 'completed',
            completed_at: timestamp,
            reference: paymentData?.payment?.payment_id || 'CREDIT-PAYMENT',
            credits_applied: creditsApplied
          }
        })
      });
    }

    // Step 6: Generate receipt
    const receipt = {
      receipt_id: `RCP-${order.order_id.split('-')[1]}`,
      order_id: order.order_id,
      payment_id: paymentData?.payment?.payment_id || null,
      timestamp,
      cashier: cashier?.name || 'POS Terminal',
      customer: customer || { name: 'Walk-up Customer' },
      items: orderItems,
      subtotal,
      tax,
      delivery_fee: deliveryFee,
      tip_amount: tipAmount,
      credits_applied: creditsApplied,
      total: subtotal + tax + deliveryFee + tipAmount,
      amount_due: total,
      payment_method: payment.method,
      card_last4: payment.card?.last4,
      customer_credit_balance: remainingBalance > 0 ? remainingBalance : null,
      change_due: payment.method === 'cash' && payment.tendered ? 
        (payment.tendered - total).toFixed(2) : null
    };

    res.status(201).json({
      ok: true,
      status: 'completed',
      order_id: order.order_id,
      payment_id: paymentData?.payment?.payment_id,
      receipt,
      credits: creditsApplied > 0 ? {
        applied: creditsApplied,
        remaining_balance: remainingBalance,
        transaction_id: creditTransaction?.transaction_id
      } : null,
      message: 'Transaction completed successfully'
    });

  } catch (error) {
    console.error('[farm-sales] POS checkout failed:', error);
    res.status(500).json({
      ok: false,
      error: 'checkout_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/pos/b2b-checkout
 * B2B wholesale checkout with automatic routing
 * Routes large orders to GreenReach marketplace if farm inventory insufficient
 * 
 * Body:
 * {
 *   buyer: { name, email, phone, company, address, zip },
 *   items: [{ sku_id, quantity, unit }],
 *   delivery: { date, method: 'pickup'|'delivery', address? },
 *   payment_source?: { source_id, type: 'card' }, // Optional, returns preview if omitted
 *   notes?: string
 * }
 */
router.post('/b2b-checkout', async (req, res) => {
  try {
    const { buyer, items, delivery, payment_source, notes } = req.body;
    const farmId = req.farm_id;
    const authToken = req.headers.authorization;

    console.log('[farm-sales] B2B checkout initiated');
    console.log(`  Buyer: ${buyer?.company || buyer?.name}`);
    console.log(`  Items: ${items?.length}`);

    // Validate buyer
    if (!buyer || !buyer.email) {
      return res.status(400).json({
        ok: false,
        error: 'buyer_required',
        message: 'Buyer information with email required for B2B orders'
      });
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'items_required',
        message: 'At least one item required for B2B order'
      });
    }

    // Validate delivery
    if (!delivery || !delivery.date) {
      return res.status(400).json({
        ok: false,
        error: 'delivery_required',
        message: 'Delivery date required for B2B orders'
      });
    }

    // Step 1: Fetch farm inventory
    const inventory = await fetchInventory(authToken);

    // Step 2: Check if order should be routed to wholesale
    const routingCheck = shouldRouteToWholesale(items, inventory);

    console.log(`[farm-sales] Inventory check: ${routingCheck.canFulfillLocally ? 'LOCAL' : 'WHOLESALE ROUTING'}`);

    if (routingCheck.insufficientItems.length > 0) {
      console.log('[farm-sales] Insufficient items for local fulfillment:');
      routingCheck.insufficientItems.forEach(item => {
        console.log(`  - ${item.sku_id}: need ${item.requested}, have ${item.available}`);
      });
    }

    // Step 3a: Route to wholesale if needed
    if (routingCheck.shouldRoute) {
      console.log('[farm-sales] Routing to GreenReach wholesale marketplace...');

      const wholesaleResult = await routeToWholesale({
        buyer_id: buyer.email,
        customer: buyer,
        items,
        delivery,
        payment_source,
        notes
      }, farmId, authToken);

      if (!wholesaleResult.ok) {
        return res.status(wholesaleResult.status || 409).json({
          ok: false,
          channel: 'b2b_wholesale',
          routed: true,
          error: wholesaleResult.error,
          message: wholesaleResult.message,
          routing_check: routingCheck,
          wholesale_response: wholesaleResult
        });
      }

      // Create local tracking record for wholesale order
      const trackingOrderResponse = await fetch(`${BASE_URL}/api/farm-sales/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({
          channel: 'b2b',
          customer: buyer,
          items: items.map(item => ({
            sku_id: item.sku_id,
            quantity: item.quantity,
            unit: item.unit || 'unit',
            name: item.name || item.sku_id
          })),
          delivery,
          payment: {
            method: 'wholesale_marketplace',
            status: wholesaleResult.status === 'confirmed' ? 'completed' : 'pending',
            amount: wholesaleResult.totals?.total || 0
          },
          notes: `Routed to wholesale marketplace - Master Order: ${wholesaleResult.master_order_id}`,
          wholesale_order_id: wholesaleResult.master_order_id, // Store for sub-order tracking
          routed_to_wholesale: true
        })
      });

      const trackingData = await trackingOrderResponse.json();
      if (trackingData.ok) {
        console.log(`[farm-sales] Created tracking order: ${trackingData.order.order_id}`);
      }

      // Wholesale order successful
      return res.status(201).json({
        ok: true,
        channel: 'b2b_wholesale',
        routed: true,
        status: wholesaleResult.status,
        local_order_id: trackingData.ok ? trackingData.order.order_id : null,
        master_order_id: wholesaleResult.master_order_id,
        sub_orders: wholesaleResult.sub_orders,
        totals: wholesaleResult.totals,
        receipt_url: wholesaleResult.receipt_url,
        sub_orders_url: trackingData.ok ? `/api/farm-sales/orders/${trackingData.order.order_id}/sub-orders` : null,
        message: payment_source 
          ? 'B2B order routed to wholesale marketplace and confirmed'
          : 'B2B order preview - provide payment_source to complete',
        routing_reason: 'Insufficient farm inventory - fulfilled via marketplace',
        insufficient_items: routingCheck.insufficientItems
      });
    }

    // Step 3b: Fulfill locally if inventory sufficient
    console.log('[farm-sales] Fulfilling B2B order locally...');

    // Calculate pricing from inventory
    const orderItems = [];
    let subtotal = 0;

    for (const item of items) {
      const product = inventory.find(p => p.sku_id === item.sku_id);

      if (!product) {
        return res.status(400).json({
          ok: false,
          error: 'product_not_found',
          sku_id: item.sku_id
        });
      }

      // Use wholesale price (70% of retail) for B2B orders
      const wholesalePrice = product.wholesale_price || (product.retail_price * 0.70);
      const lineTotal = item.quantity * wholesalePrice;
      subtotal += lineTotal;

      orderItems.push({
        sku_id: product.sku_id,
        name: product.name,
        category: product.category,
        quantity: item.quantity,
        unit: product.unit,
        unit_price: wholesalePrice,
        line_total: lineTotal
      });
    }

    // B2B orders may have different tax treatment
    const tax = subtotal * 0.08; // 8% sales tax (adjust for B2B tax rules)
    const total = subtotal + tax;

    // Step 4: Create order through orders endpoint
    const orderResponse = await fetch(`${BASE_URL}/api/farm-sales/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authToken
      },
      body: JSON.stringify({
        channel: 'b2b',
        customer: {
          name: buyer.company || buyer.name,
          email: buyer.email,
          phone: buyer.phone,
          company: buyer.company,
          address: buyer.address,
          zip: buyer.zip
        },
        items: orderItems,
        delivery: {
          date: delivery.date,
          method: delivery.method,
          address: delivery.address,
          notes: delivery.notes
        },
        payment: {
          method: payment_source?.type || 'invoice',
          amount: total,
          status: payment_source ? 'pending' : 'invoice_required'
        },
        notes: notes || 'B2B wholesale order'
      })
    });

    const orderData = await orderResponse.json();
    if (!orderData.ok) {
      throw new Error(`Order creation failed: ${orderData.error}`);
    }

    const order = orderData.order;

    // Step 5: Process payment if payment source provided
    let paymentData = null;
    if (payment_source) {
      const paymentResponse = await fetch(`${BASE_URL}/api/farm-sales/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authToken
        },
        body: JSON.stringify({
          order_id: order.order_id,
          method: payment_source.type,
          amount: total,
          source_id: payment_source.source_id,
          reference: `B2B order ${order.order_id}`
        })
      });

      paymentData = await paymentResponse.json();
      if (!paymentData.ok) {
        throw new Error(`Payment processing failed: ${paymentData.error}`);
      }
    }

    // Step 6: Return receipt
    const receipt = {
      order_id: order.order_id,
      payment_id: paymentData?.payment.payment_id,
      channel: 'b2b',
      buyer: buyer,
      items: orderItems,
      subtotal,
      tax,
      total,
      delivery,
      payment_status: payment_source ? 'completed' : 'invoice_required',
      fulfillment_method: 'local',
      message: payment_source 
        ? 'B2B order confirmed - invoice will be sent' 
        : 'B2B order received - invoice will be sent for payment'
    };

    res.status(201).json({
      ok: true,
      channel: 'b2b',
      routed: false,
      status: 'confirmed',
      order_id: order.order_id,
      payment_id: paymentData?.payment.payment_id,
      receipt,
      message: 'B2B order fulfilled locally'
    });

  } catch (error) {
    console.error('[farm-sales] B2B checkout failed:', error);
    res.status(500).json({
      ok: false,
      error: 'b2b_checkout_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/pos/cash
 * Process cash payment (with change calculation)
 * 
 * Body:
 * {
 *   total: number,
 *   tendered: number
 * }
 */
router.post('/cash', (req, res) => {
  try {
    const { total, tendered } = req.body;

    if (typeof total !== 'number' || typeof tendered !== 'number') {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amounts',
        message: 'Total and tendered must be numbers'
      });
    }

    if (tendered < total) {
      return res.status(400).json({
        ok: false,
        error: 'insufficient_payment',
        message: 'Tendered amount less than total',
        total,
        tendered,
        shortage: (total - tendered).toFixed(2)
      });
    }

    const change = tendered - total;
    const breakdown = calculateChangeBreakdown(change);

    res.json({
      ok: true,
      total: total.toFixed(2),
      tendered: tendered.toFixed(2),
      change: change.toFixed(2),
      breakdown
    });

  } catch (error) {
    console.error('[farm-sales] Cash payment failed:', error);
    res.status(500).json({
      ok: false,
      error: 'cash_payment_failed',
      message: error.message
    });
  }
});

/**
 * POST /api/farm-sales/pos/card
 * Process card payment (Square integration placeholder)
 * 
 * Body:
 * {
 *   amount: number,
 *   card_nonce?: string, // From Square SDK
 *   device_id?: string   // Square Reader device ID
 * }
 */
router.post('/card', async (req, res) => {
  try {
    const { amount, card_nonce, device_id } = req.body;

    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({
        ok: false,
        error: 'invalid_amount',
        message: 'Amount must be a positive number'
      });
    }

    // TODO: Integrate with Square Payment API
    // For now, simulate card processing
    const timestamp = new Date().toISOString();
    const authCode = `AUTH${Date.now().toString().slice(-8)}`;
    const transactionId = `sq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Simulate 2-second processing delay
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Simulate 95% success rate
    const success = Math.random() > 0.05;

    if (!success) {
      return res.status(400).json({
        ok: false,
        error: 'card_declined',
        message: 'Card declined by processor',
        code: 'CARD_DECLINED'
      });
    }

    res.json({
      ok: true,
      status: 'approved',
      transaction_id: transactionId,
      auth_code: authCode,
      amount: amount.toFixed(2),
      card: {
        last4: '4242', // Simulated
        brand: 'Visa',  // Simulated
        entry_method: device_id ? 'swiped' : 'keyed'
      },
      processed_at: timestamp
    });

  } catch (error) {
    console.error('[farm-sales] Card payment failed:', error);
    res.status(500).json({
      ok: false,
      error: 'card_payment_failed',
      message: error.message
    });
  }
});

/**
 * GET /api/farm-sales/pos/session/summary
 * Get current POS session summary (cashier shift)
 * 
 * Query params:
 * - cashier_id: Filter by cashier
 * - date: YYYY-MM-DD (defaults to today)
 */
router.get('/session/summary', async (req, res) => {
  try {
    const { cashier_id, date } = req.query;    const farmId = req.farm_id;    const authToken = req.headers.authorization;    const targetDate = date || new Date().toISOString().split('T')[0];

    // Fetch today's orders from POS channel (farm-scoped)
    const ordersResponse = await fetch(
      `${BASE_URL}/api/farm-sales/orders?channel=pos&date_from=${targetDate}&date_to=${targetDate}`,
      { headers: { 'Authorization': authToken } }
    );
    const ordersData = await ordersResponse.json();

    if (!ordersData.ok) {
      throw new Error('Failed to fetch orders');
    }

    let orders = ordersData.orders;

    // Filter by cashier if specified
    if (cashier_id) {
      orders = orders.filter(o => o.notes?.includes(cashier_id));
    }

    // Calculate session totals
    const summary = {
      session_date: targetDate,
      cashier_id,
      total_transactions: orders.length,
      total_items_sold: orders.reduce((sum, o) => 
        sum + o.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
      ),
      gross_sales: orders.reduce((sum, o) => sum + (o.pricing?.subtotal || 0), 0),
      tax_collected: orders.reduce((sum, o) => sum + (o.pricing?.tax || 0), 0),
      total_revenue: orders.reduce((sum, o) => sum + (o.pricing?.total || 0), 0),
      by_payment_method: {},
      by_category: {}
    };

    // Break down by payment method
    orders.forEach(order => {
      const method = order.payment?.method || 'unknown';
      if (!summary.by_payment_method[method]) {
        summary.by_payment_method[method] = {
          count: 0,
          amount: 0
        };
      }
      summary.by_payment_method[method].count++;
      summary.by_payment_method[method].amount += order.pricing?.total || 0;

      // Break down by category
      order.items?.forEach(item => {
        const category = item.category || 'unknown';
        if (!summary.by_category[category]) {
          summary.by_category[category] = {
            quantity: 0,
            revenue: 0
          };
        }
        summary.by_category[category].quantity += item.quantity;
        summary.by_category[category].revenue += item.line_total || 0;
      });
    });

    res.json({
      ok: true,
      summary,
      orders: orders.map(o => ({
        order_id: o.order_id,
        timestamp: o.timestamps.created_at,
        total: o.pricing?.total,
        payment_method: o.payment?.method,
        items_count: o.items?.length || 0
      }))
    });

  } catch (error) {
    console.error('[farm-sales] Session summary failed:', error);
    res.status(500).json({
      ok: false,
      error: 'session_summary_failed',
      message: error.message
    });
  }
});

/**
 * Helper: Fetch current inventory (farm-scoped)
 */
async function fetchInventory(authToken) {
  const response = await fetch(`${BASE_URL}/api/farm-sales/inventory?available_only=true`, {
    headers: { 'Authorization': authToken }
  });
  const data = await response.json();
  return data.inventory || [];
}

/**
 * Helper: Calculate change breakdown in bills/coins
 */
function calculateChangeBreakdown(change) {
  if (change === 0) return [];

  const denominations = [
    { name: '$20', value: 20 },
    { name: '$10', value: 10 },
    { name: '$5', value: 5 },
    { name: '$1', value: 1 },
    { name: '$0.25', value: 0.25 },
    { name: '$0.10', value: 0.10 },
    { name: '$0.05', value: 0.05 },
    { name: '$0.01', value: 0.01 }
  ];

  const breakdown = [];
  let remaining = Math.round(change * 100) / 100;

  for (const denom of denominations) {
    const count = Math.floor(remaining / denom.value);
    if (count > 0) {
      breakdown.push({
        denomination: denom.name,
        count
      });
      remaining = Math.round((remaining - (count * denom.value)) * 100) / 100;
    }
  }

  return breakdown;
}

export default router;
