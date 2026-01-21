/**
 * GreenReach Central - Square Payment Service
 * 
 * Handles Square payment processing for wholesale orders with commission splits.
 * Each farm sub-order gets its own Square payment with broker fee.
 */

// CommonJS module - use default import
import squarePkg from 'square';
const { Client: SquareClient, Environment } = squarePkg;
import crypto from 'crypto';
import { getBatchFarmSquareCredentials } from './squareCredentials.js';

const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const BROKER_MERCHANT_ID = process.env.SQUARE_BROKER_MERCHANT_ID;

/**
 * Process Square payments for a wholesale order
 * @param {object} params - Payment parameters
 * @param {string} params.masterOrderId - Master order ID
 * @param {array} params.farmSubOrders - Array of farm sub-orders
 * @param {object} params.paymentSource - Payment source (card token, etc)
 * @param {number} params.commissionRate - Commission rate (e.g., 0.10 for 10%)
 * @returns {Promise<object>} Payment results
 */
export async function processSquarePayments(params) {
  const { masterOrderId, farmSubOrders, paymentSource, commissionRate } = params;
  
  if (!farmSubOrders || farmSubOrders.length === 0) {
    throw new Error('No farm sub-orders to process');
  }
  
  // Get Square credentials for all farms
  const farmIds = farmSubOrders.map(sub => sub.farm_id);
  const credentialsMap = await getBatchFarmSquareCredentials(farmIds);
  
  // Check if all farms have Square connected
  const missingSquare = farmIds.filter(farmId => 
    !credentialsMap.get(farmId)?.success
  );
  
  if (missingSquare.length > 0) {
    throw new Error(`Farms without Square connected: ${missingSquare.join(', ')}`);
  }
  
  // Process payment for each farm sub-order
  const paymentResults = [];
  
  for (const subOrder of farmSubOrders) {
    try {
      const result = await processFarmSubOrderPayment({
        subOrder,
        masterOrderId,
        credentials: credentialsMap.get(subOrder.farm_id).credentials,
        paymentSource,
        commissionRate
      });
      
      paymentResults.push({
        farmId: subOrder.farm_id,
        success: true,
        ...result
      });
      
    } catch (error) {
      console.error(`[Square Payment] Failed for farm ${subOrder.farm_id}:`, error);
      paymentResults.push({
        farmId: subOrder.farm_id,
        success: false,
        error: error.message
      });
    }
  }
  
  // Check if all payments succeeded
  const allSuccess = paymentResults.every(r => r.success);
  const totalAmount = paymentResults
    .filter(r => r.success)
    .reduce((sum, r) => sum + (r.amountMoney?.amount || 0), 0);
  const totalBrokerFee = paymentResults
    .filter(r => r.success)
    .reduce((sum, r) => sum + (r.brokerFeeMoney?.amount || 0), 0);
  
  return {
    success: allSuccess,
    totalPayments: paymentResults.length,
    successfulPayments: paymentResults.filter(r => r.success).length,
    totalAmount,
    totalBrokerFee,
    paymentResults
  };
}

/**
 * Process payment for a single farm sub-order
 * @private
 */
async function processFarmSubOrderPayment(params) {
  const { subOrder, masterOrderId, credentials, paymentSource, commissionRate } = params;
  
  // Initialize Square client with farm's access token
  const client = new SquareClient({
    accessToken: credentials.access_token,
    environment: SQUARE_ENVIRONMENT === 'production' 
      ? Environment.Production 
      : Environment.Sandbox
  });
  
  const paymentsApi = client.paymentsApi;
  
  // Calculate amounts in cents
  const grossAmount = Math.round(subOrder.total * 100); // Convert to cents
  const brokerFeeAmount = Math.round(grossAmount * commissionRate);
  
  // Generate idempotency key
  const idempotencyKey = `${masterOrderId}_${subOrder.farm_id}_${Date.now()}`;
  
  // Prepare payment request
  const paymentRequest = {
    sourceId: paymentSource.source_id || 'CARD_ON_FILE',
    idempotencyKey,
    amountMoney: {
      amount: BigInt(grossAmount),
      currency: 'USD'
    },
    locationId: credentials.location_id,
    // Application fee (broker fee) collected by GreenReach
    appFeeMoney: BROKER_MERCHANT_ID ? {
      amount: BigInt(brokerFeeAmount),
      currency: 'USD'
    } : undefined,
    referenceId: `${masterOrderId}_${subOrder.farm_id}`,
    note: `GreenReach Wholesale Order ${masterOrderId} - Farm ${subOrder.farm_id}`,
    // Buyer information
    buyerEmailAddress: subOrder.buyer_email,
    // Additional metadata
    note: `GreenReach Wholesale - Order ${masterOrderId} - ${subOrder.items.length} items`
  };
  
  console.log(`[Square Payment] Processing for farm ${subOrder.farm_id}:`);
  console.log(`  Amount: $${(grossAmount / 100).toFixed(2)}`);
  console.log(`  Broker Fee: $${(brokerFeeAmount / 100).toFixed(2)}`);
  console.log(`  Location: ${credentials.location_id}`);
  console.log(`  Idempotency: ${idempotencyKey}`);
  
  // Execute payment
  const response = await paymentsApi.createPayment(paymentRequest);
  
  if (response.result && response.result.payment) {
    const payment = response.result.payment;
    
    console.log(`[Square Payment] Success for farm ${subOrder.farm_id}: ${payment.id}`);
    console.log(`  Status: ${payment.status}`);
    
    return {
      paymentId: payment.id,
      status: mapSquareStatus(payment.status),
      amountMoney: {
        amount: Number(payment.amountMoney.amount),
        currency: payment.amountMoney.currency
      },
      brokerFeeMoney: payment.applicationDetails?.applicationFeeMoney 
        ? {
            amount: Number(payment.applicationDetails.applicationFeeMoney.amount),
            currency: payment.applicationDetails.applicationFeeMoney.currency
          }
        : { amount: brokerFeeAmount, currency: 'USD' },
      receiptUrl: payment.receiptUrl,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt
    };
  } else {
    throw new Error('Square payment creation failed with no result');
  }
}

/**
 * Map Square payment status to standard status
 * @private
 */
function mapSquareStatus(squareStatus) {
  const statusMap = {
    'APPROVED': 'authorized',
    'COMPLETED': 'completed',
    'PENDING': 'pending',
    'CANCELED': 'failed',
    'FAILED': 'failed'
  };
  return statusMap[squareStatus] || 'pending';
}

/**
 * Create demo payment record (for testing without real Square calls)
 * @param {object} params - Payment parameters
 */
export function createDemoPaymentRecord(params) {
  const { masterOrderId, farmSubOrders, commissionRate } = params;
  
  const paymentResults = farmSubOrders.map(subOrder => {
    const grossAmount = Math.round(subOrder.total * 100);
    const brokerFeeAmount = Math.round(grossAmount * commissionRate);
    
    return {
      farmId: subOrder.farm_id,
      success: true,
      paymentId: `demo_${masterOrderId}_${subOrder.farm_id}`,
      status: 'completed',
      amountMoney: { amount: grossAmount, currency: 'USD' },
      brokerFeeMoney: { amount: brokerFeeAmount, currency: 'USD' },
      receiptUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  });
  
  const totalAmount = paymentResults.reduce((sum, r) => sum + r.amountMoney.amount, 0);
  const totalBrokerFee = paymentResults.reduce((sum, r) => sum + r.brokerFeeMoney.amount, 0);
  
  return {
    success: true,
    totalPayments: paymentResults.length,
    successfulPayments: paymentResults.length,
    totalAmount,
    totalBrokerFee,
    paymentResults
  };
}
