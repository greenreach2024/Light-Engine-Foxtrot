/**
 * GreenReach: Square Webhook Handler and Payment Reconciliation
 * Processes Square payment events and maintains payment state machine
 * Implements polling fallback for missed webhook events
 */

import express from 'express';
import { PaymentProviderFactory } from '../../lib/payment-providers/base.js';
import '../../lib/payment-providers/square.js';
import {
  getPaymentRecord,
  savePaymentRecord,
  listPaymentRecords
} from '../../lib/wholesale/payment-store.js';
import orderStoreModule, { updateOrderStatus, listSubOrders } from '../../lib/wholesale/order-store.js';
import notificationService from '../../services/wholesale-notification-service.js';
import { query } from '../../lib/database.js';

const router = express.Router();

// Payment state machine transitions
const VALID_STATE_TRANSITIONS = {
  'created': ['authorized', 'completed', 'failed'],
  'authorized': ['completed', 'failed'],
  'completed': ['refunded', 'partially_refunded', 'disputed'],
  'failed': [],
  'refunded': [],
  'partially_refunded': ['refunded', 'disputed'],
  'disputed': ['completed', 'refunded']
};

function getWebhookEventKey(event, payload) {
  const raw = payload || event.raw || {};
  const explicitEventId = raw.event_id || raw.eventId || raw.id;
  if (explicitEventId) return `square:${explicitEventId}`;

  return [
    event.type || 'unknown',
    event.paymentId || 'no_payment',
    event.status || 'no_status',
    event.amount || 0,
    event.timestamp || 'no_ts'
  ].join(':');
}

/**
 * POST /api/wholesale/webhooks/square
 * Handle Square payment webhooks
 * 
 * Headers:
 * - x-square-signature: HMAC-SHA256 signature for verification
 * 
 * Body: Square webhook event payload
 */
router.post('/square', async (req, res) => {
  try {
    const signature = req.headers['x-square-signature'] || req.headers['x-square-hmacsha256-signature'];
    const webhookSecret = process.env.SQUARE_WEBHOOK_SECRET;

    if (!signature || !webhookSecret) {
      console.error('[Webhook] Missing signature or webhook secret');
      return res.status(401).json({
        ok: false,
        error: 'Missing webhook signature or secret not configured'
      });
    }

    // Verify webhook signature
    const squareProvider = PaymentProviderFactory.create('square', {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT || 'production',
      webhookSecret
    });

    const isValid = squareProvider.verifyWebhook(signature, req.body, webhookSecret);

    if (!isValid) {
      console.error('[Webhook] Invalid webhook signature');
      return res.status(401).json({
        ok: false,
        error: 'Invalid webhook signature'
      });
    }

    // Parse webhook event
    const event = squareProvider.parseWebhookEvent(req.body);

    console.log('[Webhook] Received Square event:', event.type);
    console.log('  Payment ID:', event.paymentId);
    console.log('  Status:', event.status);

    // Process event based on type
    let processResult;
    
    if (event.type.startsWith('payment.')) {
      processResult = await processPaymentEvent(event, req.body);
    } else if (event.type.startsWith('refund.')) {
      processResult = await processRefundEvent(event, req.body);
    } else {
      console.warn('[Webhook] Unhandled event type:', event.type);
      processResult = { ok: true, action: 'ignored', reason: 'Unsupported event type' };
    }

    res.json({
      ok: true,
      event_type: event.type,
      payment_id: event.paymentId,
      processed: processResult
    });

  } catch (error) {
    console.error('[Webhook] Processing failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Webhook processing failed',
      message: error.message
    });
  }
});

/**
 * Look up the wholesale order associated with a Square payment ID.
 * Checks NeDB (LE-created orders) then PostgreSQL (Central-created orders).
 */
async function findOrderByPaymentId(paymentId) {
  if (!paymentId) return null;

  // Search NeDB orders (LE checkout path)
  try {
    const order = await orderStoreModule.ordersDB.findOne({ 'payments.payment_id': paymentId });
    if (order) return order;
  } catch (err) {
    console.warn('[Webhook] NeDB order lookup failed:', err.message);
  }

  // Search PostgreSQL wholesale_orders (Central checkout path)
  try {
    const result = await query(
      `SELECT master_order_id, buyer_id, status, order_data, created_at
       FROM wholesale_orders
       WHERE order_data::text LIKE '%' || $1 || '%'
       LIMIT 1`,
      [paymentId]
    );
    if (result.rows.length > 0) {
      const row = result.rows[0];
      return row.order_data || {
        master_order_id: row.master_order_id,
        buyer_id: row.buyer_id,
        status: row.status,
        created_at: row.created_at
      };
    }
  } catch (err) {
    console.warn('[Webhook] PostgreSQL order lookup failed:', err.message);
  }

  return null;
}

/**
 * Process payment webhook events
 */
async function processPaymentEvent(event, payload) {
  const { paymentId, status, type } = event;
  const eventKey = getWebhookEventKey(event, payload);

  // Find payment record
  let paymentRecord = await getPaymentRecord(paymentId);

  if (!paymentRecord) {
    console.warn(`[Webhook] Payment record not found for ${paymentId}, creating new record`);
    paymentRecord = {
      id: `PR-${Date.now()}`,
      provider_payment_id: paymentId,
      provider: 'square',
      status: 'created',
      events: [],
      processed_event_keys: [],
      created_at: new Date().toISOString()
    };
    await savePaymentRecord(paymentRecord);
  }

  if ((paymentRecord.processed_event_keys || []).includes(eventKey)) {
    console.log(`[Webhook] Duplicate payment event skipped: ${eventKey}`);
    return {
      ok: true,
      action: 'duplicate_ignored',
      payment_record_id: paymentRecord.id,
      event_key: eventKey
    };
  }

  // Validate state transition
  const currentStatus = paymentRecord.status;
  const validTransitions = VALID_STATE_TRANSITIONS[currentStatus] || [];

  if (!validTransitions.includes(status) && currentStatus !== status) {
    console.warn(`[Webhook] Invalid state transition: ${currentStatus} → ${status}`);
    return {
      ok: false,
      action: 'rejected',
      reason: `Invalid transition from ${currentStatus} to ${status}`
    };
  }

  // Update payment record
  const previousStatus = paymentRecord.status;
  paymentRecord.status = status;
  paymentRecord.updated_at = new Date().toISOString();
  
  // Add event to history
  const nextEvents = paymentRecord.events || [];
  nextEvents.push({
    type,
    status,
    timestamp: event.timestamp,
    raw: event.raw
  });
  paymentRecord.events = nextEvents;

  const processedKeys = paymentRecord.processed_event_keys || [];
  processedKeys.push(eventKey);
  paymentRecord.processed_event_keys = processedKeys;

  await savePaymentRecord(paymentRecord);

  console.log(`[Webhook] Payment ${paymentId}: ${previousStatus} → ${status}`);

  // Handle status-specific actions
  if (status === 'completed' && previousStatus !== 'completed') {
    console.log(`[Webhook] Payment completed: ${paymentId}`);
    try {
      const order = await findOrderByPaymentId(paymentId);
      if (order) {
        const orderId = order.master_order_id;

        // Update NeDB order status
        await updateOrderStatus(orderId, 'completed').catch(err =>
          console.warn(`[Webhook] NeDB order update failed:`, err.message)
        );

        // Update PostgreSQL order status
        await query(
          `UPDATE wholesale_orders SET status = 'completed', updated_at = NOW() WHERE master_order_id = $1`,
          [orderId]
        ).catch(err =>
          console.warn(`[Webhook] PostgreSQL order update failed:`, err.message)
        );

        console.log(`[Webhook] Order ${orderId} marked completed`);

        // Notify buyer of successful payment
        const buyerEmail = order.buyer_account?.email || order.buyer_email || '';
        if (buyerEmail) {
          await notificationService.notifyBuyerOrderPlaced({
            id: orderId,
            buyer_email: buyerEmail,
            buyer_name: order.buyer_account?.contactName || order.buyer_account?.businessName || '',
            total_amount: order.grand_total || order.totals?.total || 0,
            payment_id: paymentId,
            verification_deadline: order.verification_deadline || new Date(Date.now() + 24 * 3600000).toISOString()
          }).catch(err => console.warn(`[Webhook] Buyer notification failed:`, err.message));
        }
      } else {
        console.warn(`[Webhook] No order found for completed payment ${paymentId}`);
      }
    } catch (err) {
      console.error(`[Webhook] Error handling payment.completed:`, err.message);
    }
  } else if (status === 'failed') {
    console.log(`[Webhook] Payment failed: ${paymentId}`);
    try {
      const order = await findOrderByPaymentId(paymentId);
      if (order) {
        const orderId = order.master_order_id;

        // Update NeDB order status
        await updateOrderStatus(orderId, 'payment_failed').catch(err =>
          console.warn(`[Webhook] NeDB order update (failed):`, err.message)
        );

        // Update PostgreSQL order status
        await query(
          `UPDATE wholesale_orders SET status = 'payment_failed', updated_at = NOW() WHERE master_order_id = $1`,
          [orderId]
        ).catch(err =>
          console.warn(`[Webhook] PostgreSQL order update (failed):`, err.message)
        );

        console.log(`[Webhook] Order ${orderId} marked payment_failed`);

        // Notify buyer of payment failure
        const buyerEmail = order.buyer_account?.email || order.buyer_email || '';
        if (buyerEmail) {
          await notificationService.notifyBuyerOrderCancelled({
            id: orderId,
            buyer_email: buyerEmail,
            buyer_name: order.buyer_account?.contactName || order.buyer_account?.businessName || '',
            total_amount: order.grand_total || order.totals?.total || 0
          }, 0).catch(err => console.warn(`[Webhook] Buyer failure notification failed:`, err.message));
        }
      } else {
        console.warn(`[Webhook] No order found for failed payment ${paymentId}`);
      }
    } catch (err) {
      console.error(`[Webhook] Error handling payment.failed:`, err.message);
    }
  }

  return {
    ok: true,
    action: 'updated',
    previous_status: previousStatus,
    new_status: status,
    payment_record_id: paymentRecord.id
  };
}

/**
 * Process refund webhook events
 */
async function processRefundEvent(event, payload) {
  const { paymentId, status, type, amount } = event;
  const eventKey = getWebhookEventKey(event, payload);

  let paymentRecord = await getPaymentRecord(paymentId);

  if (!paymentRecord) {
    console.error(`[Webhook] Cannot process refund: Payment record ${paymentId} not found`);
    return {
      ok: false,
      action: 'rejected',
      reason: 'Payment record not found'
    };
  }

  const previousStatus = paymentRecord.status;

  if ((paymentRecord.processed_event_keys || []).includes(eventKey)) {
    console.log(`[Webhook] Duplicate refund event skipped: ${eventKey}`);
    return {
      ok: true,
      action: 'duplicate_ignored',
      previous_status: previousStatus,
      new_status: paymentRecord.status,
      event_key: eventKey
    };
  }

  // Update refund status
  if (status === 'completed') {
    // Determine if full or partial refund
    const isPartial = amount && amount < paymentRecord.gross_amount;
    paymentRecord.status = isPartial ? 'partially_refunded' : 'refunded';
  }

  paymentRecord.refund_amount = (paymentRecord.refund_amount || 0) + (amount || 0);
  paymentRecord.updated_at = new Date().toISOString();

  // Add refund event to history
  const nextEvents = paymentRecord.events || [];
  nextEvents.push({
    type,
    status,
    amount,
    timestamp: event.timestamp,
    raw: event.raw
  });
  paymentRecord.events = nextEvents;

  const processedKeys = paymentRecord.processed_event_keys || [];
  processedKeys.push(eventKey);
  paymentRecord.processed_event_keys = processedKeys;

  await savePaymentRecord(paymentRecord);

  console.log(`[Webhook] Refund processed for ${paymentId}: $${amount / 100} refunded`);
  console.log(`  Payment status: ${previousStatus} → ${paymentRecord.status}`);

  // TODO: Update BrokerFeeRecord settlement_status
  // TODO: Notify farm of refund
  // TODO: Update MasterOrder and FarmSubOrder statuses

  return {
    ok: true,
    action: 'refunded',
    previous_status: previousStatus,
    new_status: paymentRecord.status,
    refund_amount: amount
  };
}

/**
 * GET /api/wholesale/webhooks/payments/:paymentId/status
 * Polling fallback: Get current payment status from Square
 */
router.get('/payments/:paymentId/status', async (req, res) => {
  try {
    const { paymentId } = req.params;

    console.log('[Webhook] Polling payment status:', paymentId);

    const squareProvider = PaymentProviderFactory.create('square', {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT || 'production'
    });

    const status = await squareProvider.getPaymentStatus(paymentId);

    // Update local payment record
    let paymentRecord = await getPaymentRecord(paymentId);
    if (paymentRecord) {
      if (paymentRecord.status !== status.status) {
        console.log(`[Webhook] Status change detected via polling: ${paymentRecord.status} → ${status.status}`);
        paymentRecord.status = status.status;
        paymentRecord.updated_at = new Date().toISOString();
        const nextEvents = paymentRecord.events || [];
        nextEvents.push({
          type: 'polling_update',
          status: status.status,
          timestamp: new Date().toISOString(),
          source: 'polling_fallback'
        });
        paymentRecord.events = nextEvents;
        await savePaymentRecord(paymentRecord);
      }
    }

    res.json({
      ok: true,
      payment_id: paymentId,
      status: status.status,
      amount: status.amount,
      broker_fee: status.brokerFee,
      updated_at: status.updatedAt,
      source: 'square_api'
    });

  } catch (error) {
    console.error('[Webhook] Status polling failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to poll payment status',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/webhooks/payments
 * List all payment records (for reconciliation dashboard)
 */
router.get('/payments', async (req, res) => {
  try {
    const { status, from_date, to_date } = req.query;

    const records = await listPaymentRecords({ status, from_date, to_date });

    // Summary statistics
    const summary = {
      total_payments: records.length,
      by_status: {},
      total_amount: 0,
      total_broker_fees: 0
    };

    for (const record of records) {
      summary.by_status[record.status] = (summary.by_status[record.status] || 0) + 1;
      summary.total_amount += record.gross_amount || 0;
      summary.total_broker_fees += record.broker_fee_amount || 0;
    }

    res.json({
      ok: true,
      summary,
      payments: records.map(r => ({
        id: r.id,
        provider_payment_id: r.provider_payment_id,
        status: r.status,
        gross_amount: r.gross_amount,
        broker_fee_amount: r.broker_fee_amount,
        created_at: r.created_at,
        updated_at: r.updated_at,
        event_count: r.events?.length || 0
      }))
    });

  } catch (error) {
    console.error('[Webhook] Failed to list payments:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to list payment records',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/webhooks/reconcile
 * Manual reconciliation: Poll Square for all payment statuses and update records
 */
router.post('/reconcile', async (req, res) => {
  try {
    const { payment_ids } = req.body;

    console.log('[Webhook] Starting manual reconciliation...');

    const squareProvider = PaymentProviderFactory.create('square', {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
      environment: process.env.SQUARE_ENVIRONMENT || 'production'
    });

    const reconciliationResults = [];
    const currentRecords = await listPaymentRecords();
    const paymentIdsToReconcile = payment_ids || currentRecords.map(record => record.provider_payment_id).filter(Boolean);

    for (const paymentId of paymentIdsToReconcile) {
      try {
        const status = await squareProvider.getPaymentStatus(paymentId);
        
        const paymentRecord = await getPaymentRecord(paymentId);
        if (!paymentRecord) continue;

        const statusChanged = paymentRecord.status !== status.status;

        if (statusChanged) {
          console.log(`[Webhook] Reconciliation update: ${paymentId} ${paymentRecord.status} → ${status.status}`);
          paymentRecord.status = status.status;
          paymentRecord.updated_at = new Date().toISOString();
          const nextEvents = paymentRecord.events || [];
          nextEvents.push({
            type: 'reconciliation_update',
            status: status.status,
            timestamp: new Date().toISOString(),
            source: 'manual_reconciliation'
          });
          paymentRecord.events = nextEvents;
          await savePaymentRecord(paymentRecord);
        }

        reconciliationResults.push({
          payment_id: paymentId,
          status_changed: statusChanged,
          current_status: status.status
        });

      } catch (error) {
        console.error(`[Webhook] Reconciliation failed for ${paymentId}:`, error.message);
        reconciliationResults.push({
          payment_id: paymentId,
          error: error.message
        });
      }
    }

    const updatedCount = reconciliationResults.filter(r => r.status_changed).length;
    const errorCount = reconciliationResults.filter(r => r.error).length;

    console.log('[Webhook] Reconciliation complete:');
    console.log(`  Checked: ${reconciliationResults.length}`);
    console.log(`  Updated: ${updatedCount}`);
    console.log(`  Errors: ${errorCount}`);

    res.json({
      ok: true,
      reconciliation_results: reconciliationResults,
      summary: {
        total_checked: reconciliationResults.length,
        status_updated: updatedCount,
        errors: errorCount
      }
    });

  } catch (error) {
    console.error('[Webhook] Reconciliation failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Reconciliation failed',
      message: error.message
    });
  }
});

export default router;
