/**
 * GreenReach Square Payment Provider Implementation
 * Implements broker fee collection via Square's application fee mechanism
 * 
 * Required Square OAuth scope: PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS
 * Documentation: https://developer.squareup.com/docs/payments-api/take-payments
 *
 * Updated for Square SDK v43 API
 */

import { SquareClient, SquareEnvironment as Environment } from 'square';
import crypto from 'crypto';
import { PaymentProvider, PaymentError, PaymentErrorCodes, PaymentProviderFactory } from './base.js';

export class SquarePaymentProvider extends PaymentProvider {
  constructor(config) {
    super({ ...config, providerName: 'square' });
    
    // Validate required config
    if (!config.squareAccessToken) {
      throw new Error('Square access token is required');
    }
    
    // Initialize Square SDK client (v43: token, not accessToken)
    this.client = new SquareClient({
      token: config.squareAccessToken,
      environment: config.environment === 'production' 
        ? Environment.Production 
        : Environment.Sandbox
    });
    
    // v43: sub-API names drop the "Api" suffix
    this.paymentsApi = this.client.payments;
    this.refundsApi = this.client.refunds;
    this.customersApi = this.client.customers;
    this.cardsApi = this.client.cards;
    this.webhookSecret = config.webhookSecret;
    this.brokerMerchantId = config.brokerMerchantId;
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

      const paymentRequest = {
        sourceId: metadata.sourceId || 'CARD_ON_FILE',
        idempotencyKey,
        amountMoney: {
          amount: BigInt(amountMoney.amount),
          currency: amountMoney.currency || 'USD'
        },
        locationId: farmLocationId,
        appFeeMoney: brokerFeeMoney ? {
          amount: BigInt(brokerFeeMoney.amount),
          currency: brokerFeeMoney.currency || 'USD'
        } : undefined,
        referenceId: farmSubOrderId,
        note: `GreenReach Wholesale Order - Sub-order ${farmSubOrderId}`,
        ...(metadata.customerId && { customerId: metadata.customerId }),
        ...(metadata.buyerEmail && { buyerEmailAddress: metadata.buyerEmail })
      };

      // v43: .create() not .createPayment(), response is flat (no .result wrapper)
      const response = await this.paymentsApi.create(paymentRequest);

      if (response && response.payment) {
        const payment = response.payment;
        
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

      // v43: response is flat (no .result wrapper)
      const response = await this.refundsApi.refundPayment(refundRequest);

      if (response && response.refund) {
        const refund = response.refund;
        
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
      // v43: .get() not .getPayment(), response is flat
      const response = await this.paymentsApi.get({ paymentId: providerPaymentId });
      
      if (response && response.payment) {
        const payment = response.payment;
        
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
   */
  verifyWebhook(signature, payload, webhookSecret) {
    try {
      const webhookKey = webhookSecret || this.webhookSecret;
      if (!webhookKey) {
        throw new Error('Webhook secret not configured');
      }

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
   */
  parseWebhookEvent(webhookPayload) {
    const { type, data } = webhookPayload;
    
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

  supportsBrokerFees() {
    return true;
  }

  getConfigRequirements() {
    return {
      merchantIdField: 'square_merchant_id',
      locationIdField: 'square_location_id',
      authScopes: [
        'PAYMENTS_WRITE',
        'PAYMENTS_WRITE_ADDITIONAL_RECIPIENTS',
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

  /**
   * Create or retrieve a Square customer for a wholesale buyer
   */
  async createCustomer({ email, displayName, phone, referenceId }) {
    try {
      // v43: .create() not .createCustomer(), response is flat
      // Square requires E.164 phone format; skip if not roughly valid
      const digitsOnly = phone ? phone.replace(/[^\d+]/g, '') : '';
      const sanitizedPhone = /^\+?\d{10,15}$/.test(digitsOnly) ? digitsOnly : undefined;
      const response = await this.customersApi.create({
        idempotencyKey: crypto.randomUUID(),
        emailAddress: email,
        givenName: displayName,
        phoneNumber: sanitizedPhone,
        referenceId: referenceId || undefined
      });
      const customer = response.customer;
      return { success: true, customerId: customer.id };
    } catch (error) {
      console.error('[Square] Create customer failed:', error.message);
      throw new PaymentError(error.message || 'Failed to create Square customer', PaymentErrorCodes.PROVIDER_ERROR, error);
    }
  }

  /**
   * Save a card on file for a Square customer
   */
  async createCardOnFile({ customerId, sourceId }) {
    try {
      // v43: .create() not .createCard(), response is flat
      const response = await this.cardsApi.create({
        idempotencyKey: crypto.randomUUID(),
        sourceId,
        card: { customerId }
      });
      const card = response.card;
      return {
        success: true,
        cardId: card.id,
        brand: card.cardBrand,
        last4: card.last4,
        expMonth: Number(card.expMonth),
        expYear: Number(card.expYear)
      };
    } catch (error) {
      console.error('[Square] Create card on file failed:', error.message);
      throw new PaymentError(error.message || 'Failed to save card on file', PaymentErrorCodes.PROVIDER_ERROR, error);
    }
  }

  /**
   * List cards on file for a Square customer
   */
  async listCards(customerId) {
    try {
      // v43: .list({ customerId }) not .listCards(undefined, customerId), response is flat
      const response = await this.cardsApi.list({ customerId });
      const cards = (response.cards || []).map(c => ({
        cardId: c.id,
        brand: c.cardBrand,
        last4: c.last4,
        expMonth: Number(c.expMonth),
        expYear: Number(c.expYear),
        enabled: c.enabled
      }));
      return { success: true, cards };
    } catch (error) {
      console.error('[Square] List cards failed:', error.message);
      return { success: false, cards: [], error: error.message };
    }
  }

  /**
   * Disable (remove) a card on file
   */
  async disableCard(cardId) {
    try {
      // v43: .disable() not .disableCard()
      await this.cardsApi.disable({ cardId });
      return { success: true };
    } catch (error) {
      console.error('[Square] Disable card failed:', error.message);
      throw new PaymentError(error.message || 'Failed to remove card', PaymentErrorCodes.PROVIDER_ERROR, error);
    }
  }
}

// Register Square provider with factory
PaymentProviderFactory.register('square', SquarePaymentProvider);

export default SquarePaymentProvider;
