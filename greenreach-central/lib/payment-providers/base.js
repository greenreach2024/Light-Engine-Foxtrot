/**
 * GreenReach Payment Provider Abstraction
 * Base class for payment provider implementations (Square, Stripe, etc.)
 * 
 * Design principle: Farms are Merchant of Record (MoR) for their FarmSubOrders
 * GreenReach collects broker fee via provider-supported application/platform fee mechanisms
 */

/**
 * Abstract base class for payment providers
 * All payment providers must implement these methods
 */
export class PaymentProvider {
  constructor(config) {
    if (new.target === PaymentProvider) {
      throw new Error('PaymentProvider is abstract and cannot be instantiated directly');
    }
    this.config = config;
    this.providerName = config.providerName || 'unknown';
  }

  /**
   * Create a payment for a FarmSubOrder
   * Payment goes to farm (MoR), broker fee collected via platform fee
   * 
   * @param {Object} params Payment parameters
   * @param {string} params.farmSubOrderId Unique sub-order identifier
   * @param {string} params.farmMerchantId Provider-specific merchant ID (e.g., Square merchant_id)
   * @param {string} params.farmLocationId Provider-specific location ID (e.g., Square location_id)
   * @param {Object} params.amountMoney Payment amount: {amount: cents, currency: 'USD'}
   * @param {Object} params.brokerFeeMoney Broker fee: {amount: cents, currency: 'USD'}
   * @param {string} params.idempotencyKey Deterministic key: masterOrderId + farmSubOrderId + attemptNumber
   * @param {Object} params.metadata Additional metadata (buyer_id, buyer_name, etc.)
   * @returns {Promise<Object>} Payment result: {success, paymentId, status, providerResponse}
   */
  async createPayment(params) {
    throw new Error('createPayment must be implemented by subclass');
  }

  /**
   * Refund a payment (full or partial)
   * Broker fee is refunded proportionally by default
   * 
   * @param {Object} params Refund parameters
   * @param {string} params.providerPaymentId Original payment ID from provider
   * @param {Object} params.amountMoney Refund amount: {amount: cents, currency: 'USD'}
   * @param {string} params.reason Refund reason for audit trail
   * @param {string} params.idempotencyKey Unique refund idempotency key
   * @returns {Promise<Object>} Refund result: {success, refundId, status, brokerFeeRefunded, providerResponse}
   */
  async refundPayment(params) {
    throw new Error('refundPayment must be implemented by subclass');
  }

  /**
   * Get current payment status from provider
   * Used for reconciliation and polling fallback
   * 
   * @param {string} providerPaymentId Payment ID from provider
   * @returns {Promise<Object>} Status: {paymentId, status, amount, brokerFee, updatedAt, providerResponse}
   */
  async getPaymentStatus(providerPaymentId) {
    throw new Error('getPaymentStatus must be implemented by subclass');
  }

  /**
   * Verify webhook signature from provider
   * Prevents webhook spoofing attacks
   * 
   * @param {string} signature Signature header from webhook request
   * @param {string|Object} payload Raw webhook payload (string or parsed JSON)
   * @param {string} webhookSecret Provider webhook secret key
   * @returns {boolean} True if signature is valid
   */
  verifyWebhook(signature, payload, webhookSecret) {
    throw new Error('verifyWebhook must be implemented by subclass');
  }

  /**
   * Parse webhook event from provider
   * Normalizes provider-specific webhook format to standard event structure
   * 
   * @param {Object} webhookPayload Raw webhook payload from provider
   * @returns {Object} Normalized event: {type, paymentId, status, amount, timestamp, raw}
   */
  parseWebhookEvent(webhookPayload) {
    throw new Error('parseWebhookEvent must be implemented by subclass');
  }

  /**
   * Check if provider supports broker/platform fees
   * @returns {boolean} True if broker fees are supported
   */
  supportsBrokerFees() {
    throw new Error('supportsBrokerFees must be implemented by subclass');
  }

  /**
   * Get provider-specific configuration requirements
   * Used for farm onboarding validation
   * 
   * @returns {Object} Required fields: {merchantIdField, locationIdField, authScopes, webhookEvents}
   */
  getConfigRequirements() {
    throw new Error('getConfigRequirements must be implemented by subclass');
  }
}

/**
 * Payment provider factory
 * Returns appropriate provider instance based on type
 */
export class PaymentProviderFactory {
  static providers = new Map();

  /**
   * Register a payment provider implementation
   * @param {string} providerType Provider type ('square', 'stripe', etc.)
   * @param {Class} ProviderClass Provider implementation class
   */
  static register(providerType, ProviderClass) {
    PaymentProviderFactory.providers.set(providerType, ProviderClass);
  }

  /**
   * Create provider instance
   * @param {string} providerType Provider type
   * @param {Object} config Provider-specific configuration
   * @returns {PaymentProvider} Provider instance
   */
  static create(providerType, config) {
    const ProviderClass = PaymentProviderFactory.providers.get(providerType);
    if (!ProviderClass) {
      throw new Error(`Payment provider '${providerType}' not registered. Available: ${[...PaymentProviderFactory.providers.keys()].join(', ')}`);
    }
    return new ProviderClass(config);
  }

  /**
   * Get list of registered providers
   * @returns {string[]} Array of provider types
   */
  static getAvailableProviders() {
    return [...PaymentProviderFactory.providers.keys()];
  }
}

/**
 * Standard error types for payment operations
 */
export class PaymentError extends Error {
  constructor(message, code, providerError = null) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.providerError = providerError;
  }
}

export const PaymentErrorCodes = {
  INVALID_AMOUNT: 'INVALID_AMOUNT',
  INVALID_MERCHANT: 'INVALID_MERCHANT',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
  PAYMENT_DECLINED: 'PAYMENT_DECLINED',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  REFUND_FAILED: 'REFUND_FAILED',
  WEBHOOK_VERIFICATION_FAILED: 'WEBHOOK_VERIFICATION_FAILED'
};
