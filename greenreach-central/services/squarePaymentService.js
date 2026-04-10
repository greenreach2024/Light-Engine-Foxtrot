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

function makeIdempotencyKey({ masterOrderId, farmId, amountCents, cartFingerprint }) {
  // When a cart fingerprint is available, use it instead of the random order ID.
  // This ensures that retry submissions produce the same idempotency key,
  // so Square rejects duplicate charges even when the order ID differs.
  const stableId = cartFingerprint || masterOrderId;
  const raw = `${stableId}:${farmId}:${amountCents}`;
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
  const { masterOrderId, farmSubOrders = [], paymentSource = {}, commissionRate = 0, cartFingerprint = null } = params || {};

  if (!masterOrderId) {
    return summarizeResults([{ success: false, farmId: null, error: 'master_order_id_required', amountMoney: { amount: 0, currency: 'CAD' }, brokerFeeMoney: { amount: 0, currency: 'CAD' }, status: 'FAILED' }]);
  }

  if (!Array.isArray(farmSubOrders) || farmSubOrders.length === 0) {
    return summarizeResults([{ success: false, farmId: null, error: 'farm_sub_orders_required', amountMoney: { amount: 0, currency: 'CAD' }, brokerFeeMoney: { amount: 0, currency: 'CAD' }, status: 'FAILED' }]);
  }

  const sourceId = paymentSource?.source_id || paymentSource?.sourceId || null;
  const customerId = paymentSource?.customer_id || null;
  if (!sourceId) {
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
        idempotencyKey: makeIdempotencyKey({ masterOrderId, farmId, amountCents, cartFingerprint }),
        metadata: {
          sourceId,
          customerId,
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
      providerPaymentId: paymentId,
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

/**
 * Charge the buyer via GreenReach's own Square account when farms lack Square.
 * GreenReach receives the FULL amount (no app_fee_money split). The broker fee
 * and farm payables are tracked via the accounting ledger only.
 *
 * @param {object} params
 * @param {string} params.masterOrderId - Master order ID
 * @param {Array}  params.farmSubOrders - Array of farm sub-order objects
 * @param {object} params.paymentSource - { source_id, customer_id }
 * @param {number} params.commissionRate - Broker commission rate (e.g. 0.12)
 * @returns {Promise<object>} Same shape as processSquarePayments result
 */
export async function processGreenReachDirectPayment(params) {
  const { masterOrderId, farmSubOrders = [], paymentSource = {}, commissionRate = 0, cartFingerprint = null } = params || {};

  if (!masterOrderId) {
    return summarizeResults([{ success: false, farmId: null, error: 'master_order_id_required', amountMoney: { amount: 0, currency: 'CAD' }, brokerFeeMoney: { amount: 0, currency: 'CAD' }, status: 'FAILED' }]);
  }

  const sourceId = paymentSource?.source_id || paymentSource?.sourceId || null;
  const customerId = paymentSource?.customer_id || null;
  if (!sourceId) {
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

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const squareEnvironment = process.env.SQUARE_ENVIRONMENT;

  if (!accessToken || !locationId || !squareEnvironment) {
    const failedResults = farmSubOrders.map((subOrder) => ({
      farmId: subOrder.farm_id,
      success: false,
      error: 'greenreach_square_credentials_not_configured',
      amountMoney: { amount: getSubOrderAmountCents(subOrder), currency: 'CAD' },
      brokerFeeMoney: { amount: 0, currency: 'CAD' },
      status: 'FAILED',
    }));
    return summarizeResults(failedResults);
  }

  // Aggregate all farm sub-orders into a single charge to GreenReach's Square
  let totalAmountCents = 0;
  let totalBrokerFeeCents = 0;
  for (const subOrder of farmSubOrders) {
    const amountCents = getSubOrderAmountCents(subOrder);
    totalAmountCents += amountCents;
    totalBrokerFeeCents += Math.max(0, Math.round(amountCents * Number(commissionRate || 0)));
  }

  if (totalAmountCents <= 0) {
    return summarizeResults([{
      farmId: 'greenreach-direct',
      success: false,
      error: 'invalid_total_amount',
      amountMoney: { amount: 0, currency: 'CAD' },
      brokerFeeMoney: { amount: 0, currency: 'CAD' },
      status: 'FAILED',
    }]);
  }

  try {
    const provider = PaymentProviderFactory.create('square', {
      squareAccessToken: accessToken,
      environment: squareEnvironment,
    });

    const stableId = cartFingerprint || masterOrderId;
    const idempotencyKey = crypto.createHash('sha256')
      .update(`gr-direct:${stableId}:${totalAmountCents}`)
      .digest('hex')
      .substring(0, 45);

    // Charge the full amount to GreenReach's location (no app_fee_money)
    const providerResponse = await provider.createPayment({
      farmSubOrderId: masterOrderId,
      farmMerchantId: null,
      farmLocationId: locationId,
      amountMoney: { amount: totalAmountCents, currency: 'CAD' },
      brokerFeeMoney: { amount: 0, currency: 'CAD' }, // No split — GreenReach receives the full amount
      idempotencyKey,
      metadata: {
        sourceId,
        customerId,
        buyerEmail: farmSubOrders[0]?.buyer_email,
        buyerId: farmSubOrders[0]?.buyer_id,
      },
    });

    // Return per-farm results so accounting can process each sub-order
    const paymentResults = farmSubOrders.map((subOrder) => {
      const amountCents = getSubOrderAmountCents(subOrder);
      const brokerFeeCents = Math.max(0, Math.round(amountCents * Number(commissionRate || 0)));
      return {
        farmId: subOrder.farm_id,
        success: true,
        paymentId: providerResponse.paymentId,
        amountMoney: { amount: amountCents, currency: 'CAD' },
        brokerFeeMoney: { amount: brokerFeeCents, currency: 'CAD' },
        status: providerResponse.status || 'COMPLETED',
        provider: 'square',
        greenreach_held: true,
      };
    });

    console.log(`[GreenReach Direct] Payment ${providerResponse.paymentId} for order ${masterOrderId}: $${(totalAmountCents / 100).toFixed(2)} CAD`);
    return {
      ...summarizeResults(paymentResults),
      greenreach_held: true,
      greenreach_payment_id: providerResponse.paymentId,
    };

  } catch (error) {
    console.error(`[GreenReach Direct] Payment failed for order ${masterOrderId}:`, error.message);
    const failedResults = farmSubOrders.map((subOrder) => ({
      farmId: subOrder.farm_id,
      success: false,
      error: error.message || 'greenreach_direct_payment_failed',
      amountMoney: { amount: getSubOrderAmountCents(subOrder), currency: 'CAD' },
      brokerFeeMoney: { amount: Math.max(0, Math.round(getSubOrderAmountCents(subOrder) * Number(commissionRate || 0))), currency: 'CAD' },
      status: 'FAILED',
    }));
    return summarizeResults(failedResults);
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

/**
 * Create a Square customer and save a card on file for a wholesale buyer.
 * Uses GreenReach's own Square credentials (not the farm's).
 */
export async function saveCardOnFile({ buyerId, email, displayName, phone, cardNonce }) {
  const squareEnvironment = process.env.SQUARE_ENVIRONMENT;
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!squareEnvironment || !accessToken) {
    return { success: false, error: 'Square credentials not configured for card storage' };
  }

  const provider = PaymentProviderFactory.create('square', {
    squareAccessToken: accessToken,
    environment: squareEnvironment,
  });

  // Create customer if needed
  const custResult = await provider.createCustomer({
    email,
    displayName,
    phone,
    referenceId: buyerId
  });

  // Save card on file
  const cardResult = await provider.createCardOnFile({
    customerId: custResult.customerId,
    sourceId: cardNonce
  });

  return {
    success: true,
    squareCustomerId: custResult.customerId,
    squareCardId: cardResult.cardId,
    brand: cardResult.brand,
    last4: cardResult.last4,
    expMonth: cardResult.expMonth,
    expYear: cardResult.expYear
  };
}

/**
 * Get the saved card details for a buyer
 */
export async function getCardOnFile(squareCustomerId) {
  if (!squareCustomerId) return { success: false, cards: [] };

  const squareEnvironment = process.env.SQUARE_ENVIRONMENT;
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!squareEnvironment || !accessToken) {
    return { success: false, cards: [], error: 'Square credentials not configured' };
  }

  const provider = PaymentProviderFactory.create('square', {
    squareAccessToken: accessToken,
    environment: squareEnvironment,
  });

  return provider.listCards(squareCustomerId);
}

/**
 * Remove a card on file
 */
export async function removeCardOnFile(squareCardId) {
  if (!squareCardId) return { success: false, error: 'No card ID provided' };

  const squareEnvironment = process.env.SQUARE_ENVIRONMENT;
  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  if (!squareEnvironment || !accessToken) {
    return { success: false, error: 'Square credentials not configured' };
  }

  const provider = PaymentProviderFactory.create('square', {
    squareAccessToken: accessToken,
    environment: squareEnvironment,
  });

  return provider.disableCard(squareCardId);
}

export default {
  processSquarePayments,
  refundPayment,
  createDemoPaymentRecord,
  saveCardOnFile,
  getCardOnFile,
  removeCardOnFile
};
