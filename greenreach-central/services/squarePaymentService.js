/**
 * GreenReach Central - Square Payment Service (STUB)
 * 
 * Stub implementation to avoid Square SDK agent compatibility issues.
 * Square payments temporarily disabled.
 */

import crypto from 'crypto';

/**
 * Process Square payments for a wholesale order (STUB)
 * Returns stubbed success responses for demo mode
 */
export async function processSquarePayments(params) {
  const { masterOrderId, farmSubOrders } = params;
  
  console.log('[Square Payment STUB] Processing payment request:', {
    masterOrderId,
    farmCount: farmSubOrders?.length || 0
  });
  
  // Return stub success for demo mode
  const paymentResults = (farmSubOrders || []).map(subOrder => ({
    farmId: subOrder.farm_id,
    success: true,
    paymentId: `stub-payment-${crypto.randomBytes(8).toString('hex')}`,
    amountMoney: { amount: subOrder.total_amount_cents || 0, currency: 'USD' },
    brokerFeeMoney: { amount: 0, currency: 'USD' },
    status: 'COMPLETED'
  }));
  
  return {
    success: true,
    totalPayments: paymentResults.length,
    successfulPayments: paymentResults.length,
    failedPayments: 0,
    totalAmount: paymentResults.reduce((sum, r) => sum + r.amountMoney.amount, 0),
    totalBrokerFee: 0,
    payments: paymentResults
  };
}

/**
 * Create a demo payment record (STUB)
 */
export async function createDemoPaymentRecord(orderId, amount) {
  return {
    payment_id: `stub-${orderId}-${Date.now()}`,
    order_id: orderId,
    amount,
    status: 'completed',
    provider: 'demo',
    created_at: new Date().toISOString()
  };
}

export default {
  processSquarePayments,
  createDemoPaymentRecord
};
