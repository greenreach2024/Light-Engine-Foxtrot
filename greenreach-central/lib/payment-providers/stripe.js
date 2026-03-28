/**
 * GreenReach Stripe Payment Provider Implementation
 * Implements broker fee collection via Stripe Connect application fees
 * 
 * Stripe Connect model: Farm is the connected account (MoR),
 * GreenReach collects broker fee via application_fee_amount on PaymentIntents
 * 
 * Documentation: https://docs.stripe.com/connect/charges
 */

import Stripe from 'stripe';
import crypto from 'crypto';
import { PaymentProvider, PaymentError, PaymentErrorCodes, PaymentProviderFactory } from './base.js';

export class StripePaymentProvider extends PaymentProvider {
  constructor(config) {
    super({ ...config, providerName: 'stripe' });

    // Validate required config
    if (!config.stripeSecretKey) {
      throw new Error('Stripe secret key is required');
    }

    // Initialize Stripe SDK
    this.stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: '2024-12-18.acacia'
    });

    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    this.connectedAccountId = config.connectedAccountId; // Farm's Stripe Connect account ID
  }

  /**
   * Create a payment with broker fee using Stripe PaymentIntents API
   * Payment goes to farm (connected account), application_fee collected by GreenReach
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
    if (amountMoney.amount <= 0) {
      throw new PaymentError('Payment amount must be greater than zero', PaymentErrorCodes.INVALID_AMOUNT);
    }
    if (brokerFeeMoney && brokerFeeMoney.amount > amountMoney.amount) {
      throw new PaymentError('Broker fee cannot exceed payment amount', PaymentErrorCodes.INVALID_AMOUNT);
    }

    try {
      console.log(`[Stripe] Creating payment for FarmSubOrder ${farmSubOrderId}`);
      console.log(`  Amount: $${amountMoney.amount / 100} ${amountMoney.currency}`);
      console.log(`  Broker Fee: $${(brokerFeeMoney?.amount || 0) / 100} ${amountMoney.currency}`);
      console.log(`  Idempotency: ${idempotencyKey}`);

      // Build PaymentIntent parameters
      const intentParams = {
        amount: amountMoney.amount, // Stripe uses integer cents natively
        currency: (amountMoney.currency || 'CAD').toLowerCase(),
        metadata: {
          farm_sub_order_id: farmSubOrderId,
          farm_id: farmMerchantId,
          master_order_id: metadata.masterOrderId || '',
          buyer_id: metadata.buyerId || '',
          platform: 'greenreach'
        },
        description: `GreenReach Wholesale Order - Sub-order ${farmSubOrderId}`
      };

      // If a payment method source is provided (card token, payment method ID)
      if (metadata.sourceId && metadata.sourceId !== 'CARD_ON_FILE') {
        intentParams.payment_method = metadata.sourceId;
        intentParams.confirm = true;
        intentParams.automatic_payment_methods = { enabled: true, allow_redirects: 'never' };
      } else {
        // Create intent for later confirmation (frontend collects card)
        intentParams.automatic_payment_methods = { enabled: true };
      }

      // Stripe Connect: direct charge on connected account with application fee
      const connectedAccount = this.connectedAccountId || metadata.connectedAccountId;
      if (connectedAccount) {
        intentParams.on_behalf_of = connectedAccount;
        intentParams.transfer_data = { destination: connectedAccount };
        if (brokerFeeMoney && brokerFeeMoney.amount > 0) {
          intentParams.application_fee_amount = brokerFeeMoney.amount;
        }
      } else if (brokerFeeMoney && brokerFeeMoney.amount > 0) {
        // No connected account — store broker fee in metadata for manual reconciliation
        intentParams.metadata.broker_fee_cents = String(brokerFeeMoney.amount);
      }

      // Add buyer email if available
      if (metadata.buyerEmail) {
        intentParams.receipt_email = metadata.buyerEmail;
      }

      // Create PaymentIntent
      const paymentIntent = await this.stripe.paymentIntents.create(
        intentParams,
        { idempotencyKey }
      );

      console.log(`[Stripe] PaymentIntent created: ${paymentIntent.id}`);
      console.log(`  Status: ${paymentIntent.status}`);

      return {
        success: true,
        paymentId: paymentIntent.id,
        status: this._mapStripeStatus(paymentIntent.status),
        amount: paymentIntent.amount,
        brokerFee: paymentIntent.application_fee_amount || 0,
        clientSecret: paymentIntent.client_secret, // For frontend confirmation
        receiptUrl: paymentIntent.charges?.data?.[0]?.receipt_url || null,
        providerResponse: paymentIntent
      };

    } catch (error) {
      console.error('[Stripe] Payment creation failed:', error);

      if (error.type === 'StripeCardError') {
        throw new PaymentError(
          error.message,
          this._mapStripeErrorCode(error.code),
          error
        );
      }
      if (error.type === 'StripeIdempotencyError') {
        throw new PaymentError(
          error.message,
          PaymentErrorCodes.IDEMPOTENCY_CONFLICT,
          error
        );
      }
      if (error instanceof PaymentError) throw error;

      throw new PaymentError(
        error.message || 'Unknown payment error',
        PaymentErrorCodes.PROVIDER_ERROR,
        error
      );
    }
  }

  /**
   * Refund a Stripe payment (full or partial)
   * Application fee is refunded proportionally by default
   */
  async refundPayment(params) {
    const {
      providerPaymentId,
      amountMoney,
      reason,
      idempotencyKey
    } = params;

    try {
      console.log(`[Stripe] Creating refund for payment ${providerPaymentId}`);
      console.log(`  Refund amount: $${amountMoney.amount / 100} ${amountMoney.currency}`);
      console.log(`  Reason: ${reason}`);

      const refundParams = {
        payment_intent: providerPaymentId,
        amount: amountMoney.amount,
        reason: this._mapRefundReason(reason),
        metadata: {
          reason_detail: reason || 'Wholesale order adjustment',
          platform: 'greenreach'
        },
        // Refund application fee proportionally
        refund_application_fee: true
      };

      const refund = await this.stripe.refunds.create(
        refundParams,
        { idempotencyKey }
      );

      console.log(`[Stripe] Refund created: ${refund.id}`);
      console.log(`  Status: ${refund.status}`);

      return {
        success: true,
        refundId: refund.id,
        status: this._mapStripeRefundStatus(refund.status),
        amount: refund.amount,
        brokerFeeRefunded: 0, // Stripe handles proportional refund internally
        providerResponse: refund
      };

    } catch (error) {
      console.error('[Stripe] Refund failed:', error);
      throw new PaymentError(
        error.message || 'Refund failed',
        PaymentErrorCodes.REFUND_FAILED,
        error
      );
    }
  }

  /**
   * Get payment status from Stripe
   */
  async getPaymentStatus(providerPaymentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.retrieve(providerPaymentId);

      return {
        paymentId: paymentIntent.id,
        status: this._mapStripeStatus(paymentIntent.status),
        amount: paymentIntent.amount,
        brokerFee: paymentIntent.application_fee_amount || 0,
        updatedAt: new Date(paymentIntent.created * 1000).toISOString(),
        providerResponse: paymentIntent
      };

    } catch (error) {
      console.error('[Stripe] Failed to get payment status:', error);
      throw new PaymentError(
        error.message || 'Failed to retrieve payment status',
        PaymentErrorCodes.PROVIDER_ERROR,
        error
      );
    }
  }

  /**
   * Verify Stripe webhook signature
   * Uses Stripe's built-in signature verification
   */
  verifyWebhook(signature, payload, webhookSecret) {
    try {
      const secret = webhookSecret || this.webhookSecret;
      if (!secret) {
        throw new Error('Webhook secret not configured');
      }

      // Stripe requires the raw body string
      const payloadString = typeof payload === 'string'
        ? payload
        : JSON.stringify(payload);

      // Use Stripe SDK's built-in verification
      this.stripe.webhooks.constructEvent(payloadString, signature, secret);
      return true;

    } catch (error) {
      console.error('[Stripe] Webhook verification failed:', error.message);
      return false;
    }
  }

  /**
   * Parse Stripe webhook event
   * Normalizes to standard event structure
   */
  parseWebhookEvent(webhookPayload) {
    const eventType = webhookPayload.type || 'unknown';
    const data = webhookPayload.data?.object || {};

    let paymentId = null;
    let status = null;
    let amount = null;

    if (eventType.startsWith('payment_intent.')) {
      paymentId = data.id;
      status = this._mapStripeStatus(data.status);
      amount = data.amount || 0;
    } else if (eventType.startsWith('charge.refund')) {
      paymentId = data.payment_intent;
      status = this._mapStripeRefundStatus(data.status);
      amount = data.amount || 0;
    } else if (eventType.startsWith('charge.')) {
      paymentId = data.payment_intent;
      status = data.status === 'succeeded' ? 'completed' : 'created';
      amount = data.amount || 0;
    }

    return {
      type: eventType,
      paymentId,
      status,
      amount,
      timestamp: data.created
        ? new Date(data.created * 1000).toISOString()
        : new Date().toISOString(),
      raw: webhookPayload
    };
  }

  /**
   * Check if Stripe supports broker/platform fees
   */
  supportsBrokerFees() {
    return true; // Stripe Connect supports application_fee_amount
  }

  /**
   * Get Stripe configuration requirements
   */
  getConfigRequirements() {
    return {
      merchantIdField: 'stripe_account_id',
      locationIdField: null, // Stripe doesn't require locations
      authScopes: [
        'read_write' // Stripe Connect standard scope
      ],
      webhookEvents: [
        'payment_intent.succeeded',
        'payment_intent.payment_failed',
        'charge.refunded',
        'charge.refund.updated',
        'account.updated' // For Connect account status changes
      ]
    };
  }

  // --- Private helpers ---

  /**
   * Map Stripe PaymentIntent status to standard status
   */
  _mapStripeStatus(stripeStatus) {
    const statusMap = {
      'requires_payment_method': 'created',
      'requires_confirmation': 'created',
      'requires_action': 'created',
      'processing': 'authorized',
      'requires_capture': 'authorized',
      'canceled': 'failed',
      'succeeded': 'completed'
    };
    return statusMap[stripeStatus] || 'created';
  }

  /**
   * Map Stripe refund status to standard status
   */
  _mapStripeRefundStatus(stripeRefundStatus) {
    const statusMap = {
      'succeeded': 'completed',
      'pending': 'authorized',
      'failed': 'failed',
      'canceled': 'failed',
      'requires_action': 'created'
    };
    return statusMap[stripeRefundStatus] || 'created';
  }

  /**
   * Map Stripe error codes to standard error codes
   */
  _mapStripeErrorCode(stripeErrorCode) {
    const errorMap = {
      'card_declined': PaymentErrorCodes.PAYMENT_DECLINED,
      'insufficient_funds': PaymentErrorCodes.INSUFFICIENT_FUNDS,
      'invalid_cvc': PaymentErrorCodes.PAYMENT_DECLINED,
      'incorrect_cvc': PaymentErrorCodes.PAYMENT_DECLINED,
      'expired_card': PaymentErrorCodes.PAYMENT_DECLINED,
      'incorrect_number': PaymentErrorCodes.PAYMENT_DECLINED,
      'invalid_number': PaymentErrorCodes.PAYMENT_DECLINED,
      'processing_error': PaymentErrorCodes.PROVIDER_ERROR,
      'rate_limit': PaymentErrorCodes.NETWORK_ERROR
    };
    return errorMap[stripeErrorCode] || PaymentErrorCodes.PROVIDER_ERROR;
  }

  /**
   * Map reason text to Stripe refund reason enum
   */
  _mapRefundReason(reason) {
    if (!reason) return 'requested_by_customer';
    const lower = reason.toLowerCase();
    if (lower.includes('duplicate')) return 'duplicate';
    if (lower.includes('fraud')) return 'fraudulent';
    return 'requested_by_customer';
  }
}

// Register Stripe provider with factory
PaymentProviderFactory.register('stripe', StripePaymentProvider);

export default StripePaymentProvider;
