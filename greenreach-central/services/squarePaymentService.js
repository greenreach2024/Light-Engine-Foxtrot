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
  const { masterOrderId, farmSubOrders = [], paymentSource = {}, commissionRate = 0.12 } = params || {};

  if (!masterOrderId) {
    return summarizeResults([{ success: false, farmId: null, error: 'master_order_id_required', amountMoney: { amount: 0, currency: 'USD' }, brokerFeeMoney: { amount: 0, currency: 'USD' }, status: 'FAILED' }]);
  }

  if (!Array.isArray(farmSubOrders) || farmSubOrders.length === 0) {
    return summarizeResults([{ success: false, farmId: null, error: 'farm_sub_orders_required', amountMoney: { amount: 0, currency: 'USD' }, brokerFeeMoney: { amount: 0, currency: 'USD' }, status: 'FAILED' }]);
  }

  const sourceId = paymentSource?.source_id || paymentSource?.sourceId || null;
  if (!sourceId || sourceId === 'CARD_ON_FILE') {
    const failedResults = farmSubOrders.map((subOrder) => ({
      farmId: subOrder.farm_id,
      success: false,
      error: 'valid_square_source_id_required',
      amountMoney: { amount: getSubOrderAmountCents(subOrder), currency: 'USD' },
      brokerFeeMoney: { amount: 0, currency: 'USD' },
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
        amountMoney: { amount: amountCents, currency: 'USD' },
        brokerFeeMoney: { amount: 0, currency: 'USD' },
        status: 'FAILED',
      });
      continue;
    }

    if (amountCents <= 0) {
      paymentResults.push({
        farmId,
        success: false,
        error: 'invalid_sub_order_amount',
        amountMoney: { amount: amountCents, currency: 'USD' },
        brokerFeeMoney: { amount: 0, currency: 'USD' },
        status: 'FAILED',
      });
      continue;
    }

    const brokerFeeCents = Math.max(0, Math.round(amountCents * Number(commissionRate || 0)));

    try {
      const provider = PaymentProviderFactory.create('square', {
        squareAccessToken: creds.access_token,
        environment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
        webhookSecret: process.env.SQUARE_WEBHOOK_SECRET || undefined,
        brokerMerchantId: process.env.SQUARE_BROKER_MERCHANT_ID || undefined,
      });

      const providerResponse = await provider.createPayment({
        farmSubOrderId: subOrder.sub_order_id || `${masterOrderId}-${farmId}`,
        farmMerchantId: creds.merchant_id,
        farmLocationId: creds.location_id,
        amountMoney: { amount: amountCents, currency: 'USD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'USD' },
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
        amountMoney: { amount: amountCents, currency: 'USD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'USD' },
        status: providerResponse.status || 'COMPLETED',
        provider: 'square',
      });
    } catch (error) {
      paymentResults.push({
        farmId,
        success: false,
        error: error.message || 'square_payment_failed',
        amountMoney: { amount: amountCents, currency: 'USD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'USD' },
        status: 'FAILED',
      });
    }
  }

  return summarizeResults(paymentResults);
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
  createDemoPaymentRecord
};
