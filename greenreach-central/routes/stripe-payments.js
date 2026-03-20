/**
 * Stripe Payment Routes
 * Wires the Stripe payment provider into Express routes.
 * Requires STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET env vars.
 */

import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();

let _stripe = null;

// Use dynamic import so module loads even without stripe package
async function ensureStripe() {
  if (_stripe) return _stripe;
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) return null;
  try {
    const { default: Stripe } = await import('stripe');
    _stripe = new Stripe(secret, { apiVersion: '2024-12-18.acacia' });
    console.log('[Stripe] SDK initialized');
    return _stripe;
  } catch (err) {
    console.warn('[Stripe] SDK not available:', err.message);
    return null;
  }
}

/**
 * GET /api/stripe/status
 * Check whether Stripe is configured and reachable
 */
router.get('/status', async (_req, res) => {
  const stripe = await ensureStripe();
  const configured = !!stripe;
  let account = null;

  if (stripe) {
    try {
      const acct = await stripe.accounts.retrieve();
      account = { id: acct.id, country: acct.country, default_currency: acct.default_currency };
    } catch (err) {
      account = { error: err.message };
    }
  }

  res.json({
    ok: true,
    stripe_configured: configured,
    has_secret_key: !!process.env.STRIPE_SECRET_KEY,
    has_webhook_secret: !!process.env.STRIPE_WEBHOOK_SECRET,
    account,
  });
});

/**
 * POST /api/stripe/create-payment-intent
 * Create a Stripe PaymentIntent (farm checkout or wholesale)
 */
router.post('/create-payment-intent', async (req, res) => {
  try {
    const stripe = await ensureStripe();
    if (!stripe) {
      return res.status(503).json({ ok: false, error: 'Stripe not configured' });
    }

    const { amount_cents, currency, description, metadata, connected_account_id, application_fee_cents } = req.body || {};

    if (!amount_cents || amount_cents <= 0) {
      return res.status(400).json({ ok: false, error: 'amount_cents must be a positive integer' });
    }

    const intentParams = {
      amount: Math.round(Number(amount_cents)),
      currency: (currency || 'cad').toLowerCase(),
      description: description || 'GreenReach Payment',
      metadata: metadata || {},
      automatic_payment_methods: { enabled: true },
    };

    if (connected_account_id) {
      intentParams.transfer_data = { destination: connected_account_id };
      if (application_fee_cents && application_fee_cents > 0) {
        intentParams.application_fee_amount = Math.round(Number(application_fee_cents));
      }
    }

    const intent = await stripe.paymentIntents.create(intentParams);

    // Persist to payment_records
    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO payment_records (payment_id, order_id, amount, currency, provider, status, metadata, created_at)
           VALUES ($1, $2, $3, $4, 'stripe', $5, $6, NOW())
           ON CONFLICT (payment_id) DO NOTHING`,
          [intent.id, metadata?.order_id || intent.id, (amount_cents / 100).toFixed(2),
           (currency || 'CAD').toUpperCase(), intent.status,
           JSON.stringify({ stripe_client_secret: intent.client_secret, connected_account_id })]
        );
      } catch (dbErr) {
        console.warn('[Stripe] payment_records insert:', dbErr.message);
      }
    }

    return res.json({
      ok: true,
      client_secret: intent.client_secret,
      payment_intent_id: intent.id,
      status: intent.status,
    });
  } catch (err) {
    console.error('[Stripe] create-payment-intent error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to create payment intent' });
  }
});

/**
 * POST /api/stripe/refund
 * Issue a Stripe refund
 */
router.post('/refund', async (req, res) => {
  try {
    const stripe = await ensureStripe();
    if (!stripe) {
      return res.status(503).json({ ok: false, error: 'Stripe not configured' });
    }

    const { payment_intent_id, amount_cents, reason } = req.body || {};
    if (!payment_intent_id) {
      return res.status(400).json({ ok: false, error: 'payment_intent_id required' });
    }

    const refundParams = { payment_intent: payment_intent_id };
    if (amount_cents && amount_cents > 0) {
      refundParams.amount = Math.round(Number(amount_cents));
    }
    if (reason) {
      refundParams.reason = reason === 'duplicate' || reason === 'fraudulent' ? reason : 'requested_by_customer';
    }

    const refund = await stripe.refunds.create(refundParams);

    return res.json({
      ok: true,
      refund_id: refund.id,
      status: refund.status,
      amount: refund.amount,
    });
  } catch (err) {
    console.error('[Stripe] refund error:', err.message);
    res.status(500).json({ ok: false, error: 'Refund failed' });
  }
});

/**
 * GET /api/stripe/payment/:paymentIntentId
 * Retrieve payment status from Stripe
 */
router.get('/payment/:paymentIntentId', async (req, res) => {
  try {
    const stripe = await ensureStripe();
    if (!stripe) {
      return res.status(503).json({ ok: false, error: 'Stripe not configured' });
    }

    const intent = await stripe.paymentIntents.retrieve(req.params.paymentIntentId);

    return res.json({
      ok: true,
      payment_intent_id: intent.id,
      status: intent.status,
      amount: intent.amount,
      currency: intent.currency,
    });
  } catch (err) {
    console.error('[Stripe] retrieve error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to retrieve payment' });
  }
});

export default router;
