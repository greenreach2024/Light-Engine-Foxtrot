/**
 * GreenReach Square Payment Provider Implementation
 * Implements broker fee collection via Square's application fee mechanism
 * 
 * Required Square OAuth scope: PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS
 * Documentation: https://developer.squareup.com/docs/payments-api/take-payments
 */

import { Client as SquareClient, Environment } from 'square';
import crypto from 'crypto';
import { PaymentProvider, PaymentError, PaymentErrorCodes, PaymentProviderFactory } from './base.js';

export class SquarePaymentProvider extends PaymentProvider {
  constructor(config) {
    super({ ...config, providerName: 'square' });
    
    // Validate required config
    if (!config.squareAccessToken) {
      throw new Error('Square access token is required');
    }
    
    // Initialize Square SDK client
    this.client = new SquareClient({
      accessToken: config.squareAccessToken,
      environment: config.environment === 'production' 
        ? Environment.Production 
        : Environment.Sandbox
    });
    
    this.paymentsApi = this.client.paymentsApi;
    this.refundsApi = this.client.refundsApi;
    this.webhookSecret = config.webhookSecret;
    this.brokerMerchantId = config.brokerMerchantId; // GreenReach's Square merchant ID for fee collection
  }

  /**
   * Create a payment with broker fee using Square Payments API
   * Payment goes to farm (MoR), broker fee collected via app_fee_money
   */
  async createPayment(params) {
    const {
      farmSubOrderId,
      farmMerchantId,
      farmLocationId,
      amountMoney,
      brokerFeeMoney,
      idempotencyKey,
      metadata = {}
    } = params;

    // Validate parameters
    if (!farmLocationId) {
      throw new PaymentError('Farm location ID is required', PaymentErrorCodes.INVALID_MERCHANT);
    }
    if (amountMoney.amount <= 0) {
      throw new PaymentError('Payment amount must be greater than zero', PaymentErrorCodes.INVALID_AMOUNT);
    }
    if (brokerFeeMoney.amount > amountMoney.amount) {
      throw new PaymentError('Broker fee cannot exceed payment amount', PaymentErrorCodes.INVALID_AMOUNT);
    }

    try {
      console.log(`[Square] Creating payment for FarmSubOrder ${farmSubOrderId}`);
      console.log(`  Amount: $${amountMoney.amount / 100} ${amountMoney.currency}`);
      console.log(`  Broker Fee: $${brokerFeeMoney.amount / 100} ${brokerFeeMoney.currency}`);
      console.log(`  Location: ${farmLocationId}`);
      console.log(`  Idempotency: ${idempotencyKey}`);

      // Create payment request
      // Note: In production, source_id would come from buyer's payment card token
      // For now, we're setting up the structure for card-not-present payments
      const paymentRequest = {
        sourceId: metadata.sourceId || 'CARD_ON_FILE', // Card token or stored card
        idempotencyKey,
        amountMoney: {
          amount: BigInt(amountMoney.amount),
          currency: amountMoney.currency || 'USD'
        },
        locationId: farmLocationId,
        // Application fee (broker fee) collected by GreenReach
        appFeeMoney: brokerFeeMoney ? {
          amount: BigInt(brokerFeeMoney.amount),
          currency: brokerFeeMoney.currency || 'USD'
        } : undefined,
        // Reference IDs for reconciliation
        referenceId: farmSubOrderId,
        note: `GreenReach Wholesale Order - Sub-order ${farmSubOrderId}`,
        // Additional metadata
        ...(metadata.buyerId && {
          buyerEmailAddress: metadata.buyerEmail,
          customerId: metadata.buyerId
        })
      };

      // Execute payment
      const response = await this.paymentsApi.createPayment(paymentRequest);

      if (response.result && response.result.payment) {
        const payment = response.result.payment;
        
        console.log(`[Square] Payment created successfully: ${payment.id}`);
        console.log(`  Status: ${payment.status}`);
        
        return {
          success: true,
          paymentId: payment.id,
          status: this._mapSquareStatus(payment.status),
          amount: Number(payment.amountMoney.amount),
          brokerFee: payment.applicationDetails?.applicationFeeMoney 
            ? Number(payment.applicationDetails.applicationFeeMoney.amount)
            : 0,
          receiptUrl: payment.receiptUrl,
          providerResponse: payment
        };
      } else {
        throw new PaymentError(
          'Square payment creation failed with no result',
          PaymentErrorCodes.PROVIDER_ERROR,
          response
        );
      }

    } catch (error) {
      console.error('[Square] Payment creation failed:', error);
      
      // Handle Square-specific errors
      if (error.errors && error.errors.length > 0) {
        const squareError = error.errors[0];
        const errorCode = this._mapSquareErrorCode(squareError.code);
        throw new PaymentError(
          squareError.detail || squareError.code,
          errorCode,
          error
        );
      }
      
      throw new PaymentError(
        error.message || 'Unknown payment error',
        PaymentErrorCodes.PROVIDER_ERROR,
        error
      );
    }
  }

  /**
   * Refund a Square payment (full or partial)
   * Broker fee is refunded proportionally
   */
  async refundPayment(params) {
    const {
      providerPaymentId,
      amountMoney,
      reason,
      idempotencyKey
    } = params;

    try {
      console.log(`[Square] Creating refund for payment ${providerPaymentId}`);
      console.log(`  Refund amount: $${amountMoney.amount / 100} ${amountMoney.currency}`);
      console.log(`  Reason: ${reason}`);

      const refundRequest = {
        idempotencyKey,
        amountMoney: {
          amount: BigInt(amountMoney.amount),
          currency: amountMoney.currency || 'USD'
        },
        paymentId: providerPaymentId,
        reason: reason || 'Wholesale order adjustment'
      };

      const response = await this.refundsApi.refundPayment(refundRequest);

      if (response.result && response.result.refund) {
        const refund = response.result.refund;
        
        // Calculate broker fee refund (proportional)
        const brokerFeeRefunded = refund.applicationFeeMoneyRefunded
          ? Number(refund.applicationFeeMoneyRefunded.amount)
          : 0;

        console.log(`[Square] Refund created successfully: ${refund.id}`);
        console.log(`  Status: ${refund.status}`);
        console.log(`  Broker fee refunded: $${brokerFeeRefunded / 100}`);

        return {
          success: true,
          refundId: refund.id,
          status: this._mapSquareStatus(refund.status),
          amount: Number(refund.amountMoney.amount),
          brokerFeeRefunded,
          providerResponse: refund
        };
      } else {
        throw new PaymentError(
          'Square refund creation failed',
          PaymentErrorCodes.REFUND_FAILED,
          response
        );
      }

    } catch (error) {
      console.error('[Square] Refund failed:', error);
      
      if (error.errors && error.errors.length > 0) {
        const squareError = error.errors[0];
        throw new PaymentError(
          squareError.detail || 'Refund failed',
          PaymentErrorCodes.REFUND_FAILED,
          error
        );
      }
      
      throw new PaymentError(
        error.message || 'Unknown refund error',
        PaymentErrorCodes.REFUND_FAILED,
        error
      );
    }
  }

  /**
   * Get payment status from Square
   * Used for reconciliation and polling fallback
   */
  async getPaymentStatus(providerPaymentId) {
    try {
      const response = await this.paymentsApi.getPayment(providerPaymentId);
      
      if (response.result && response.result.payment) {
        const payment = response.result.payment;
        
        return {
          paymentId: payment.id,
          status: this._mapSquareStatus(payment.status),
          amount: Number(payment.amountMoney.amount),
          brokerFee: payment.applicationDetails?.applicationFeeMoney
            ? Number(payment.applicationDetails.applicationFeeMoney.amount)
            : 0,
          updatedAt: payment.updatedAt,
          providerResponse: payment
        };
      }
      
      throw new PaymentError(
        'Payment not found',
        PaymentErrorCodes.PROVIDER_ERROR,
        response
      );
      
    } catch (error) {
      console.error('[Square] Failed to get payment status:', error);
      throw new PaymentError(
        error.message || 'Failed to retrieve payment status',
        PaymentErrorCodes.PROVIDER_ERROR,
        error
      );
    }
  }

  /**
   * Verify Square webhook signature
   * Prevents webhook spoofing
   */
  verifyWebhook(signature, payload, webhookSecret) {
    try {
      const webhookKey = webhookSecret || this.webhookSecret;
      if (!webhookKey) {
        throw new Error('Webhook secret not configured');
      }

      // Square uses HMAC-SHA256 for webhook signatures
      const payloadString = typeof payload === 'string' 
        ? payload 
        : JSON.stringify(payload);
      
      const hmac = crypto
        .createHmac('sha256', webhookKey)
        .update(payloadString)
        .digest('base64');

      return hmac === signature;
      
    } catch (error) {
      console.error('[Square] Webhook verification failed:', error);
      return false;
    }
  }

  /**
   * Parse Square webhook event
   * Normalizes to standard event structure
   */
  parseWebhookEvent(webhookPayload) {
    const { type, data } = webhookPayload;
    
    // Square webhook event types
    // payment.created, payment.updated, refund.created, refund.updated
    const eventType = type?.toLowerCase() || 'unknown';
    
    let paymentId = null;
    let status = null;
    let amount = null;
    
    if (data?.object?.payment) {
      const payment = data.object.payment;
      paymentId = payment.id;
      status = this._mapSquareStatus(payment.status);
      amount = Number(payment.amountMoney?.amount || 0);
    } else if (data?.object?.refund) {
      const refund = data.object.refund;
      paymentId = refund.paymentId;
      status = this._mapSquareStatus(refund.status);
      amount = Number(refund.amountMoney?.amount || 0);
    }

    return {
      type: eventType,
      paymentId,
      status,
      amount,
      timestamp: data?.object?.payment?.createdAt || data?.object?.refund?.createdAt || new Date().toISOString(),
      raw: webhookPayload
    };
  }

  /**
   * Check if Square supports broker/platform fees
   */
  supportsBrokerFees() {
    return true; // Square supports app_fee_money for platform fees
  }

  /**
   * Get Square configuration requirements
   */
  getConfigRequirements() {
    return {
      merchantIdField: 'square_merchant_id',
      locationIdField: 'square_location_id',
      authScopes: [
        'PAYMENTS_WRITE',
        'PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS', // Required for app_fee_money
        'MERCHANT_PROFILE_READ'
      ],
      webhookEvents: [
        'payment.created',
        'payment.updated',
        'refund.created',
        'refund.updated'
      ]
    };
  }

  /**
   * Map Square payment status to standard status
   */
  _mapSquareStatus(squareStatus) {
    const statusMap = {
      'APPROVED': 'authorized',
      'COMPLETED': 'completed',
      'PENDING': 'created',
      'CANCELED': 'failed',
      'FAILED': 'failed'
    };
    return statusMap[squareStatus] || 'created';
  }

  /**
   * Map Square error codes to standard error codes
   */
  _mapSquareErrorCode(squareErrorCode) {
    const errorMap = {
      'CARD_DECLINED': PaymentErrorCodes.PAYMENT_DECLINED,
      'INSUFFICIENT_FUNDS': PaymentErrorCodes.INSUFFICIENT_FUNDS,
      'INVALID_CARD': PaymentErrorCodes.PAYMENT_DECLINED,
      'CVV_FAILURE': PaymentErrorCodes.PAYMENT_DECLINED,
      'ADDRESS_VERIFICATION_FAILURE': PaymentErrorCodes.PAYMENT_DECLINED,
      'INVALID_LOCATION': PaymentErrorCodes.INVALID_MERCHANT,
      'IDEMPOTENCY_KEY_REUSED': PaymentErrorCodes.IDEMPOTENCY_CONFLICT
    };
    return errorMap[squareErrorCode] || PaymentErrorCodes.PROVIDER_ERROR;
  }
}

// Register Square provider with factory
PaymentProviderFactory.register('square', SquarePaymentProvider);

export default SquarePaymentProvider;
