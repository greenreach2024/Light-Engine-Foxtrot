/**
 * GreenReach: Refund and Adjustment Workflows
 * Handles full and partial refunds with broker fee reversal
 */

import express from 'express';
import crypto from 'crypto';
import { PaymentProviderFactory } from '../../lib/payment-providers/base.js';
import '../../lib/payment-providers/square.js';
import { getSubOrder, getOrder } from '../../lib/wholesale/order-store.js';

const router = express.Router();

// In-memory stores (use database in production)
const refundRecords = new Map();
const brokerFeeRecords = new Map();

/**
 * POST /api/wholesale/refunds
 * Create a refund for a FarmSubOrder
 * 
 * Request body:
 * {
 *   sub_order_id: string,
 *   refund_type: 'full' | 'partial',
 *   refund_amount: number (required if partial),
 *   reason: string,
 *   broker_fee_policy: 'proportional' | 'full' | 'none' (default: 'proportional')
 * }
 */
router.post('/', async (req, res) => {
  try {
    const {
      sub_order_id,
      refund_type = 'full',
      refund_amount,
      reason = 'Buyer requested refund',
      broker_fee_policy = 'proportional'
    } = req.body;

    if (!sub_order_id) {
      return res.status(400).json({
        ok: false,
        error: 'sub_order_id is required'
      });
    }

    if (refund_type === 'partial' && !refund_amount) {
      return res.status(400).json({
        ok: false,
        error: 'refund_amount is required for partial refunds'
      });
    }

    console.log('[Refunds] Processing refund request');
    console.log(`  Sub-order: ${sub_order_id}`);
    console.log(`  Type: ${refund_type}`);
    console.log(`  Reason: ${reason}`);

    // ── Look up sub-order from persistent store ────────────────────────
    const subOrder = await getSubOrder(sub_order_id);
    if (!subOrder) {
      return res.status(404).json({
        ok: false,
        error: 'Sub-order not found',
        sub_order_id
      });
    }

    // Amounts are stored in dollars; convert to cents for provider calls
    const grossAmountCents = Math.round((subOrder.total || 0) * 100);
    const brokerFeeCents    = Math.round((subOrder.broker_fee_amount || 0) * 100);
    const providerPaymentId = subOrder.payment_id || null;

    // Verify the sub-order is in a refundable state
    const refundableStatuses = ['confirmed', 'verified', 'completed', 'fulfilled', 'delivered'];
    if (!refundableStatuses.includes(subOrder.status)) {
      return res.status(409).json({
        ok: false,
        error: `Cannot refund sub-order in '${subOrder.status}' status`,
        current_status: subOrder.status
      });
    }

    if (grossAmountCents <= 0) {
      return res.status(409).json({
        ok: false,
        error: 'Sub-order has no refundable amount',
        total: subOrder.total
      });
    }

    // ── Calculate refund amounts ──────────────────────────────────────
    let refundAmountCents;
    let brokerFeeRefundCents;

    if (refund_type === 'full') {
      refundAmountCents = grossAmountCents;
      
      // Broker fee refund policy
      if (broker_fee_policy === 'proportional' || broker_fee_policy === 'full') {
        brokerFeeRefundCents = brokerFeeCents;
      } else {
        brokerFeeRefundCents = 0;
      }
    } else {
      // Partial refund
      refundAmountCents = Math.round(refund_amount * 100);
      
      if (refundAmountCents > grossAmountCents) {
        return res.status(400).json({
          ok: false,
          error: 'Refund amount exceeds original payment',
          max_refund: grossAmountCents / 100
        });
      }

      // Calculate proportional broker fee refund
      if (broker_fee_policy === 'proportional') {
        const refundRatio = refundAmountCents / grossAmountCents;
        brokerFeeRefundCents = Math.round(brokerFeeCents * refundRatio);
      } else if (broker_fee_policy === 'full') {
        brokerFeeRefundCents = brokerFeeCents;
      } else {
        brokerFeeRefundCents = 0;
      }
    }

    console.log(`  Refund amount: $${refundAmountCents / 100}`);
    console.log(`  Broker fee refund: $${brokerFeeRefundCents / 100}`);

    // Create payment provider
    const squareProvider = PaymentProviderFactory.create('square', {
      squareAccessToken: process.env.SQUARE_ACCESS_TOKEN || 'demo',
      environment: 'sandbox'
    });

    // Generate idempotency key
    const refundId = `REF-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const idempotencyKey = `${sub_order_id}_${refundId}`;

    // Execute refund via payment provider
    const refundResult = await squareProvider.refundPayment({
      providerPaymentId: providerPaymentId || `no-provider-${sub_order_id}`,
      amountMoney: {
        amount: refundAmountCents,
        currency: 'USD'
      },
      reason,
      idempotencyKey
    });

    if (!refundResult.success) {
      return res.status(500).json({
        ok: false,
        error: 'Refund failed',
        message: refundResult.error || 'Provider refund failed'
      });
    }

    // Create refund record
    const refundRecord = {
      id: refundId,
      sub_order_id,
      master_order_id: subOrder.master_order_id || null,
      farm_id: subOrder.farm_id || null,
      payment_id: providerPaymentId,
      provider_refund_id: refundResult.refundId,
      refund_type,
      refund_amount: refundAmountCents,
      broker_fee_refunded: brokerFeeRefundCents,
      broker_fee_policy,
      reason,
      status: refundResult.status,
      created_at: new Date().toISOString(),
      provider_response: refundResult.providerResponse
    };

    refundRecords.set(refundId, refundRecord);

    // Update broker fee settlement status
    if (brokerFeeRefundCents > 0) {
      const brokerFeeRecord = {
        id: `BF-${refundId}`,
        sub_order_id,
        refund_record_id: refundId,
        fee_amount: brokerFeeCents,
        fee_refunded: brokerFeeRefundCents,
        settlement_status: refund_type === 'full' && broker_fee_policy !== 'none' 
          ? 'reversed' 
          : 'partially_reversed',
        updated_at: new Date().toISOString()
      };

      brokerFeeRecords.set(brokerFeeRecord.id, brokerFeeRecord);
    }

    console.log('[Refunds] Refund completed successfully');
    console.log(`  Refund ID: ${refundId}`);
    console.log(`  Provider Refund ID: ${refundResult.refundId}`);
    console.log(`  Status: ${refundResult.status}`);

    res.json({
      ok: true,
      refund_id: refundId,
      provider_refund_id: refundResult.refundId,
      sub_order_id,
      refund_amount: refundAmountCents / 100,
      broker_fee_refunded: brokerFeeRefundCents / 100,
      status: refundResult.status,
      created_at: refundRecord.created_at
    });

  } catch (error) {
    console.error('[Refunds] Refund processing failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Refund processing failed',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/refunds/:refundId
 * Get refund details
 */
router.get('/:refundId', async (req, res) => {
  try {
    const { refundId } = req.params;

    const refundRecord = refundRecords.get(refundId);

    if (!refundRecord) {
      return res.status(404).json({
        ok: false,
        error: 'Refund not found',
        refund_id: refundId
      });
    }

    res.json({
      ok: true,
      refund: refundRecord
    });

  } catch (error) {
    console.error('[Refunds] Failed to fetch refund:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch refund',
      message: error.message
    });
  }
});

/**
 * GET /api/wholesale/refunds
 * List all refunds with optional filters
 */
router.get('/', async (req, res) => {
  try {
    const { sub_order_id, status, from_date, to_date } = req.query;

    let refunds = Array.from(refundRecords.values());

    // Filter by sub_order_id
    if (sub_order_id) {
      refunds = refunds.filter(r => r.sub_order_id === sub_order_id);
    }

    // Filter by status
    if (status) {
      refunds = refunds.filter(r => r.status === status);
    }

    // Filter by date range
    if (from_date) {
      const fromTime = new Date(from_date).getTime();
      refunds = refunds.filter(r => new Date(r.created_at).getTime() >= fromTime);
    }

    if (to_date) {
      const toTime = new Date(to_date).getTime();
      refunds = refunds.filter(r => new Date(r.created_at).getTime() <= toTime);
    }

    // Sort by created date descending
    refunds.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Summary statistics
    const summary = {
      total_refunds: refunds.length,
      total_refunded: refunds.reduce((sum, r) => sum + r.refund_amount, 0) / 100,
      total_broker_fees_reversed: refunds.reduce((sum, r) => sum + r.broker_fee_refunded, 0) / 100,
      by_status: {}
    };

    for (const refund of refunds) {
      summary.by_status[refund.status] = (summary.by_status[refund.status] || 0) + 1;
    }

    res.json({
      ok: true,
      summary,
      refunds: refunds.map(r => ({
        id: r.id,
        sub_order_id: r.sub_order_id,
        refund_type: r.refund_type,
        refund_amount: r.refund_amount / 100,
        broker_fee_refunded: r.broker_fee_refunded / 100,
        status: r.status,
        reason: r.reason,
        created_at: r.created_at
      }))
    });

  } catch (error) {
    console.error('[Refunds] Failed to list refunds:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to list refunds',
      message: error.message
    });
  }
});

/**
 * POST /api/wholesale/refunds/:refundId/notify-farm
 * Notify farm about refund via Light Engine API
 */
router.post('/:refundId/notify-farm', async (req, res) => {
  try {
    const { refundId } = req.params;

    const refundRecord = refundRecords.get(refundId);

    if (!refundRecord) {
      return res.status(404).json({
        ok: false,
        error: 'Refund not found'
      });
    }

    // TODO: Get farm URL from sub_order_id lookup
    const farmUrl = 'http://light-engine-demo-env.eba-smmuh8fc.us-east-1.elasticbeanstalk.com';

    // Notify farm via webhook
    const notificationPayload = {
      event: 'refund.created',
      refund_id: refundId,
      sub_order_id: refundRecord.sub_order_id,
      refund_amount: refundRecord.refund_amount / 100,
      broker_fee_refunded: refundRecord.broker_fee_refunded / 100,
      reason: refundRecord.reason,
      timestamp: new Date().toISOString()
    };

    console.log('[Refunds] Notifying farm of refund:', refundRecord.sub_order_id);

    try {
      const response = await fetch(`${farmUrl}/api/wholesale/webhooks/refund`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(notificationPayload)
      });

      if (response.ok) {
        console.log('[Refunds] Farm notified successfully');
        res.json({
          ok: true,
          notification_sent: true,
          farm_response_status: response.status
        });
      } else {
        console.warn('[Refunds] Farm notification failed:', response.status);
        res.json({
          ok: false,
          notification_sent: false,
          error: `Farm returned HTTP ${response.status}`
        });
      }

    } catch (error) {
      console.error('[Refunds] Failed to notify farm:', error.message);
      res.status(500).json({
        ok: false,
        notification_sent: false,
        error: error.message
      });
    }

  } catch (error) {
    console.error('[Refunds] Notification failed:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to notify farm',
      message: error.message
    });
  }
});

export default router;
