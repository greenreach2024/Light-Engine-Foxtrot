/**
 * Webhook Signature Verification Middleware
 * 
 * Validates webhook requests using HMAC-SHA256 signatures to prevent
 * unauthorized/spoofed webhook events from external sources.
 * 
 * Expects webhook requests to include:
 * - X-Webhook-Signature: HMAC-SHA256 hex digest of signed payload
 * - X-Timestamp: ISO 8601 timestamp of signature creation
 * - Request body: JSON payload to verify
 * 
 * Production: Fails if WEBHOOK_SECRET not configured or signature invalid
 * Development: Skips verification if WEBHOOK_SECRET not set
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

/**
 * Format webhook signature message: timestamp.body
 * Must match client-side signing format exactly
 */
function formatWebhookMessage(timestamp, body) {
  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  return `${timestamp}.${bodyStr}`;
}

/**
 * Verify webhook request signature
 * Returns true if signature valid or verification skipped (dev mode)
 */
export function verifyWebhookSignature(req, res, next) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-timestamp'];
  const webhookSecret = process.env.WEBHOOK_SECRET;
  
  // Production: must have both signature and secret
  if (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud') {
    if (!webhookSecret) {
      logger.error('[Webhook] WEBHOOK_SECRET not configured in production');
      return res.status(503).json({
        success: false,
        error: 'Webhook verification unavailable'
      });
    }
    
    if (!signature || !timestamp) {
      logger.warn('[Webhook] Missing signature or timestamp headers');
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }
  } else {
    // Development: skip if no secret configured
    if (!webhookSecret) {
      logger.info('[Webhook] Skipping signature verification (dev mode, no WEBHOOK_SECRET)');
      return next();
    }
    
    // Development: warn if missing headers
    if (!signature || !timestamp) {
      logger.warn('[Webhook] Missing signature or timestamp (dev mode)');
      return next(); // Allow in dev
    }
  }
  
  // Validate timestamp is recent (prevent replay attacks)
  try {
    const signedAt = new Date(timestamp);
    const now = new Date();
    const ageSeconds = (now.getTime() - signedAt.getTime()) / 1000;
    const maxAgeSeconds = 5 * 60; // 5 minute tolerance
    
    if (ageSeconds < 0) {
      logger.warn('[Webhook] Signature timestamp is in the future');
      return res.status(401).json({
        success: false,
        error: 'Invalid signature timestamp'
      });
    }
    
    if (ageSeconds > maxAgeSeconds) {
      logger.warn(`[Webhook] Signature too old: ${ageSeconds}s > ${maxAgeSeconds}s`);
      return res.status(401).json({
        success: false,
        error: 'Webhook signature expired'
      });
    }
  } catch (err) {
    logger.warn('[Webhook] Invalid timestamp format:', timestamp, err.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid timestamp'
    });
  }
  
  // Compute expected signature
  try {
    const bodyStr = typeof req.body === 'string' 
      ? req.body 
      : JSON.stringify(req.body);
    
    const message = formatWebhookMessage(timestamp, bodyStr);
    const computed = crypto
      .createHmac('sha256', webhookSecret)
      .update(message)
      .digest('hex');
    
    // Use constant-time comparison to prevent timing attacks
    const signatureBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');
    
    if (!crypto.timingSafeEqual(signatureBuffer, computedBuffer)) {
      logger.warn('[Webhook] Signature mismatch (possible spoofed request)');
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }
    
    // Signature valid - attach verification info to request for audit logging
    req.webhook = {
      verified: true,
      timestamp: new Date(timestamp),
      ageSeconds: (new Date().getTime() - new Date(timestamp).getTime()) / 1000
    };
    
    logger.info(`[Webhook] Signature verified (age: ${req.webhook.ageSeconds}s)`);
    next();
    
  } catch (error) {
    logger.error('[Webhook] Signature verification failed:', error.message);
    
    if (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud') {
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    } else {
      // Allow in dev if verification fails unexpectedly
      logger.warn('[Webhook] Allowing request despite verification error (dev mode)');
      next();
    }
  }
}

/**
 * Create a webhook signature for testing or client-side signing
 * Useful for tests and webhook client libraries
 */
export function createWebhookSignature(payload, webhookSecret, timestamp = null) {
  const ts = timestamp || new Date().toISOString();
  const bodyStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const message = formatWebhookMessage(ts, bodyStr);
  
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(message)
    .digest('hex');
  
  return {
    signature,
    timestamp: ts,
    headers: {
      'X-Webhook-Signature': signature,
      'X-Timestamp': ts
    }
  };
}

/**
 * Async version of verifyWebhookSignature for use in route handlers
 */
export async function validateWebhookRequest(req, webhookSecret) {
  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-timestamp'];
  
  if (!signature || !timestamp) {
    return {
      valid: false,
      error: 'Missing signature or timestamp headers'
    };
  }
  
  try {
    // Validate timestamp
    const signedAt = new Date(timestamp);
    const now = new Date();
    const ageSeconds = (now.getTime() - signedAt.getTime()) / 1000;
    
    if (ageSeconds < 0 || ageSeconds > 5 * 60) {
      return {
        valid: false,
        error: 'Signature timestamp invalid or expired'
      };
    }
    
    // Compute and verify signature
    const bodyStr = typeof req.body === 'string' 
      ? req.body 
      : JSON.stringify(req.body);
    
    const message = formatWebhookMessage(timestamp, bodyStr);
    const computed = crypto
      .createHmac('sha256', webhookSecret)
      .update(message)
      .digest('hex');
    
    const signatureBuffer = Buffer.from(signature, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');
    
    if (!crypto.timingSafeEqual(signatureBuffer, computedBuffer)) {
      return {
        valid: false,
        error: 'Signature mismatch'
      };
    }
    
    return {
      valid: true,
      timestamp: signedAt,
      ageSeconds
    };
    
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}

export default {
  verifyWebhookSignature,
  createWebhookSignature,
  validateWebhookRequest
};
