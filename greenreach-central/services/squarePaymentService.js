import crypto from 'crypto';
import { PaymentProviderFactory } from '../lib/payment-providers/base.js';
import '../lib/payment-providers/square.js';
import { getBatchFarmSquareCredentials } from './squareCredentials.js';

function toCents(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric);
}

function getSubOrderAmountCents(subOrder) {
  const explicit = toCents(subOrder?.total_amount_cents);
  if (explicit > 0) return explicit;
  const subtotal = Number(subOrder?.subtotal || 0);
  if (Number.isFinite(subtotal) && subtotal > 0) return Math.round(subtotal * 100);
  return 0;
}

function makeIdempotencyKey({ masterOrderId, farmId, amountCents }) {
  const raw = `${masterOrderId}:${farmId}:${amountCents}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function summarizeResults(paymentResults) {
  const successful = paymentResults.filter((entry) => entry.success);
  const failed = paymentResults.filter((entry) => !entry.success);
  const totalAmount = successful.reduce((sum, entry) => sum + Number(entry.amountMoney?.amount || 0), 0);
  const totalBrokerFee = successful.reduce((sum, entry) => sum + Number(entry.brokerFeeMoney?.amount || 0), 0);

  return {
    success: failed.length === 0 && successful.length > 0,
    totalPayments: paymentResults.length,
    successfulPayments: successful.length,
    failedPayments: failed.length,
    totalAmount,
    totalBrokerFee,
    paymentResults,
    payments: paymentResults,
  };
}

export async function processSquarePayments(params) {
  const { masterOrderId, farmSubOrders = [], paymentSource = {}, commissionRate = 0 } = params || {};

  if (!masterOrderId) {
    return summarizeResults([{ success: false, farmId: null, error: 'master_order_id_required', amountMoney: { amount: 0, currency: 'CAD' }, brokerFeeMoney: { amount: 0, currency: 'CAD' }, status: 'FAILED' }]);
  }

  if (!Array.isArray(farmSubOrders) || farmSubOrders.length === 0) {
    return summarizeResults([{ success: false, farmId: null, error: 'farm_sub_orders_required', amountMoney: { amount: 0, currency: 'CAD' }, brokerFeeMoney: { amount: 0, currency: 'CAD' }, status: 'FAILED' }]);
  }

  const sourceId = paymentSource?.source_id || paymentSource?.sourceId || null;
  if (!sourceId || sourceId === 'CARD_ON_FILE') {
    const failedResults = farmSubOrders.map((subOrder) => ({
      farmId: subOrder.farm_id,
      success: false,
      error: 'valid_square_source_id_required',
      amountMoney: { amount: getSubOrderAmountCents(subOrder), currency: 'CAD' },
      brokerFeeMoney: { amount: 0, currency: 'CAD' },
      status: 'FAILED',
    }));
    return summarizeResults(failedResults);
  }

  const farmIds = farmSubOrders.map((subOrder) => String(subOrder.farm_id));
  const credentials = await getBatchFarmSquareCredentials(farmIds);
  const paymentResults = [];

  for (const subOrder of farmSubOrders) {
    const farmId = String(subOrder.farm_id);
    const creds = credentials.get(farmId);
    const amountCents = getSubOrderAmountCents(subOrder);

    if (!creds?.success || !creds?.access_token || !creds?.location_id) {
      paymentResults.push({
        farmId,
        success: false,
        error: creds?.error || 'square_credentials_unavailable',
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: 0, currency: 'CAD' },
        status: 'FAILED',
      });
      continue;
    }

    if (amountCents <= 0) {
      paymentResults.push({
        farmId,
        success: false,
        error: 'invalid_sub_order_amount',
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: 0, currency: 'CAD' },
        status: 'FAILED',
      });
      continue;
    }

    const brokerFeeCents = Math.max(0, Math.round(amountCents * Number(commissionRate || 0)));

    try {
      const squareEnvironment = process.env.SQUARE_ENVIRONMENT;
      if (!squareEnvironment) {
        throw new Error('SQUARE_ENVIRONMENT is required for Square payment processing');
      }

      const provider = PaymentProviderFactory.create('square', {
        squareAccessToken: creds.access_token,
        environment: squareEnvironment,
        webhookSecret: process.env.SQUARE_WEBHOOK_SECRET || undefined,
        brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID || undefined,
      });

      const providerResponse = await provider.createPayment({
        farmSubOrderId: subOrder.sub_order_id || `${masterOrderId}-${farmId}`,
        farmMerchantId: creds.merchant_id,
        farmLocationId: creds.location_id,
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'CAD' },
        idempotencyKey: makeIdempotencyKey({ masterOrderId, farmId, amountCents }),
        metadata: {
          sourceId,
          buyerEmail: subOrder.buyer_email,
          buyerId: subOrder.buyer_id,
        },
      });

      paymentResults.push({
        farmId,
        success: true,
        paymentId: providerResponse.paymentId,
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'CAD' },
        status: providerResponse.status || 'COMPLETED',
        provider: 'square',
      });
    } catch (error) {
      paymentResults.push({
        farmId,
        success: false,
        error: error.message || 'square_payment_failed',
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'CAD' },
        status: 'FAILED',
      });
    }
  }

  return summarizeResults(paymentResults);
}

/**
 * Refund a previously completed Square payment.
 * @param {object} params
 * @param {string} params.paymentId - Square payment ID to refund
 * @param {string} params.farmId - Farm whose credentials were used for original payment
 * @param {number} params.amountCents - Amount in cents to refund (full or partial)
 * @param {string} params.reason - Refund reason for audit trail
 * @param {string} params.orderId - Associated order ID for idempotency
 * @returns {Promise<{success: boolean, refundId?: string, error?: string}>}
 */
export async function refundPayment({ paymentId, farmId, amountCents, reason, orderId }) {
  if (!paymentId || !farmId || !amountCents || amountCents <= 0) {
    return { success: false, error: 'paymentId, farmId, and positive amountCents are required' };
  }

  try {
    const credentials = await getBatchFarmSquareCredentials([String(farmId)]);
    const creds = credentials.get(String(farmId));
    if (!creds?.success || !creds?.access_token) {
      return { success: false, error: 'square_credentials_unavailable_for_refund' };
    }

    const squareEnvironment = process.env.SQUARE_ENVIRONMENT;
    if (!squareEnvironment) {
      return { success: false, error: 'SQUARE_ENVIRONMENT is required' };
    }

    const provider = PaymentProviderFactory.create('square', {
      squareAccessToken: creds.access_token,
      environment: squareEnvironment,
    });

    const idempotencyKey = crypto.createHash('sha256')
      .update(`refund:${orderId || paymentId}:${farmId}:${amountCents}`)
      .digest('hex');

    const refundResponse = await provider.refundPayment({
      paymentId,
      amountMoney: { amount: amountCents, currency: 'CAD' },
      reason: reason || 'Order cancelled',
      idempotencyKey,
    });

    return {
      success: true,
      refundId: refundResponse.refundId || refundResponse.id,
      status: refundResponse.status || 'PENDING',
    };
  } catch (error) {
    console.error(`[Refund] Failed for payment ${paymentId} farm ${farmId}:`, error.message);
    return { success: false, error: error.message || 'refund_failed' };
  }
}

export async function createDemoPaymentRecord(orderId, amount) {
  return {
    payment_id: `manual-${orderId}-${Date.now()}`,
    order_id: orderId,
    amount,
    status: 'pending_manual',
    provider: 'manual',
    created_at: new Date().toISOString(),
  };
}

export default {
  processSquarePayments,
  refundPayment,
  createDemoPaymentRecord
};
