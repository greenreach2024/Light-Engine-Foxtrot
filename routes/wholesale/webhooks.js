/**
 * GreenReach: Square Webhook Handler and Payment Reconciliation
 * Processes Square payment events and maintains payment state machine
 * Implements polling fallback for missed webhook events
 */

import express from 'express';
import { PaymentProviderFactory } from '../../lib/payment-providers/base.js';
import '../../lib/payment-providers/square.js';

const router = express.Router();

// In-memory payment records (use database in production)
const paymentRecords = new Map();

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
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || 'demo',
      environment: 'sandbox',
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
      processResult = await processPaymentEvent(event);
    } else if (event.type.startsWith('refund.')) {
      processResult = await processRefundEvent(event);
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
 * Process payment webhook events
 */
async function processPaymentEvent(event) {
  const { paymentId, status, type } = event;

  // Find payment record
  let paymentRecord = paymentRecords.get(paymentId);

  if (!paymentRecord) {
    console.warn(`[Webhook] Payment record not found for ${paymentId}, creating new record`);
    paymentRecord = {
      id: `PR-${Date.now()}`,
      provider_payment_id: paymentId,
      provider: 'square',
      status: 'created',
      events: [],
      created_at: new Date().toISOString()
    };
    paymentRecords.set(paymentId, paymentRecord);
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
  paymentRecord.events.push({
    type,
    status,
    timestamp: event.timestamp,
    raw: event.raw
  });

  console.log(`[Webhook] Payment ${paymentId}: ${previousStatus} → ${status}`);

  // Handle status-specific actions
  if (status === 'completed' && previousStatus !== 'completed') {
    console.log(`[Webhook] Payment completed: ${paymentId}`);
    // TODO: Trigger order fulfillment workflow
    // TODO: Update MasterOrder status
    // TODO: Notify buyer of successful payment
  } else if (status === 'failed') {
    console.log(`[Webhook] Payment failed: ${paymentId}`);
    // TODO: Release reservations
    // TODO: Notify buyer of payment failure
    // TODO: Update MasterOrder status to 'payment_failed'
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
async function processRefundEvent(event) {
  const { paymentId, status, type, amount } = event;

  let paymentRecord = paymentRecords.get(paymentId);

  if (!paymentRecord) {
    console.error(`[Webhook] Cannot process refund: Payment record ${paymentId} not found`);
    return {
      ok: false,
      action: 'rejected',
      reason: 'Payment record not found'
    };
  }

  const previousStatus = paymentRecord.status;

  // Update refund status
  if (status === 'completed') {
    // Determine if full or partial refund
    const isPartial = amount && amount < paymentRecord.gross_amount;
    paymentRecord.status = isPartial ? 'partially_refunded' : 'refunded';
  }

  paymentRecord.refund_amount = (paymentRecord.refund_amount || 0) + (amount || 0);
  paymentRecord.updated_at = new Date().toISOString();

  // Add refund event to history
  paymentRecord.events.push({
    type,
    status,
    amount,
    timestamp: event.timestamp,
    raw: event.raw
  });

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
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || 'demo',
      environment: 'sandbox'
    });

    const status = await squareProvider.getPaymentStatus(paymentId);

    // Update local payment record
    let paymentRecord = paymentRecords.get(paymentId);
    if (paymentRecord) {
      if (paymentRecord.status !== status.status) {
        console.log(`[Webhook] Status change detected via polling: ${paymentRecord.status} → ${status.status}`);
        paymentRecord.status = status.status;
        paymentRecord.updated_at = new Date().toISOString();
        paymentRecord.events.push({
          type: 'polling_update',
          status: status.status,
          timestamp: new Date().toISOString(),
          source: 'polling_fallback'
        });
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

    let records = Array.from(paymentRecords.values());

    // Filter by status
    if (status) {
      records = records.filter(r => r.status === status);
    }

    // Filter by date range
    if (from_date) {
      const fromTime = new Date(from_date).getTime();
      records = records.filter(r => new Date(r.created_at).getTime() >= fromTime);
    }

    if (to_date) {
      const toTime = new Date(to_date).getTime();
      records = records.filter(r => new Date(r.created_at).getTime() <= toTime);
    }

    // Sort by created date descending
    records.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

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
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || 'demo',
      environment: 'sandbox'
    });

    const reconciliationResults = [];
    const paymentIdsToReconcile = payment_ids || Array.from(paymentRecords.keys());

    for (const paymentId of paymentIdsToReconcile) {
      try {
        const status = await squareProvider.getPaymentStatus(paymentId);
        
        const paymentRecord = paymentRecords.get(paymentId);
        if (!paymentRecord) continue;

        const statusChanged = paymentRecord.status !== status.status;

        if (statusChanged) {
          console.log(`[Webhook] Reconciliation update: ${paymentId} ${paymentRecord.status} → ${status.status}`);
          paymentRecord.status = status.status;
          paymentRecord.updated_at = new Date().toISOString();
          paymentRecord.events.push({
            type: 'reconciliation_update',
            status: status.status,
            timestamp: new Date().toISOString(),
            source: 'manual_reconciliation'
          });
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
