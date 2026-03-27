import express from 'express';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from '../config/database.js';
import { ingestPaymentRevenue, ingestRefundReversal } from '../services/revenue-accounting-connector.js';
import { getOrderById, saveOrder, logOrderEvent } from '../services/wholesaleMemoryStore.js';
import { transitionOrderStatus, isValidOrderTransition } from '../services/orderStateMachine.js';
import emailService from '../services/email-service.js';

const router = express.Router();

// ── Webhook Event Deduplication ──────────────────────────────────
let dedupTableReady = false;
async function ensureDedupTable() {
  if (dedupTableReady || !isDatabaseAvailable()) return;
  try {
    await query(`CREATE TABLE IF NOT EXISTS webhook_events_processed (
      event_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      received_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    dedupTableReady = true;
  } catch { /* table may already exist */ dedupTableReady = true; }
}
async function isEventProcessed(eventId, provider) {
  if (!eventId || !isDatabaseAvailable()) return false;
  await ensureDedupTable();
  try {
    const scopedEventId = `${provider}:${eventId}`;
    const inserted = await query(
      'INSERT INTO webhook_events_processed (event_id, provider) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING event_id',
      [scopedEventId, provider]
    );
    return inserted.rows.length === 0;
  } catch { return false; }
}

// ──────────────────────────────────────────────────────────
// Square Webhook Receiver
// ──────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/square
 * Receives Square webhook events and processes payment/refund updates.
 * Must be configured in the Square Developer Dashboard → Webhooks.
 * Env: SQUARE_WEBHOOK_SIGNATURE_KEY
 */
router.post('/square', express.raw({ type: 'application/json' }), async (req, res) => {
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    console.warn('[Webhook:Square] SQUARE_WEBHOOK_SIGNATURE_KEY not set — rejecting');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  // Verify HMAC-SHA256 signature
  const signature = req.headers['x-square-hmacsha256-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
  const notificationUrl = `${process.env.BASE_URL || 'https://greenreachgreens.com'}/api/webhooks/square`;
  const hmac = crypto
    .createHmac('sha256', signatureKey)
    .update(notificationUrl + rawBody)
    .digest('base64');

  if (hmac !== signature) {
    console.warn('[Webhook:Square] Signature mismatch');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // Parse the event
  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = (event.type || '').toLowerCase();
  console.log(`[Webhook:Square] Received: ${eventType} (id: ${event.event_id || 'n/a'})`);

  // Acknowledge immediately — process async
  res.status(200).json({ received: true });

  try {
    if (!isDatabaseAvailable()) return;

    // Dedup: skip if this event was already processed
    if (await isEventProcessed(event.event_id, 'square')) {
      console.log(`[Webhook:Square] Duplicate event ${event.event_id} — skipping`);
      return;
    }

    if (eventType === 'payment.created' || eventType === 'payment.updated') {
      const payment = event.data?.object?.payment;
      if (!payment) return;

      const status = mapSquareStatus(payment.status);
      const amountCents = Number(payment.amount_money?.amount || 0);
      const amount = amountCents / 100;

      // Update payment_records if we have this payment
      await query(
        `UPDATE payment_records SET status = $1, metadata = jsonb_set(COALESCE(metadata, '{}'), '{square_webhook_event}', $2::jsonb), updated_at = NOW()
         WHERE payment_id = $3 OR metadata->>'square_payment_id' = $3`,
        [status, JSON.stringify({ type: eventType, at: new Date().toISOString() }), payment.id]
      );

      // If payment completed, ingest into accounting and advance order state
      if (status === 'completed') {
        const record = await query('SELECT * FROM payment_records WHERE payment_id = $1 OR metadata->>\'square_payment_id\' = $1 LIMIT 1', [payment.id]);
        if (record.rows.length > 0) {
          const r = record.rows[0];
          ingestPaymentRevenue({
            payment_id: r.payment_id, order_id: r.order_id, amount, provider: 'square',
            broker_fee: Number(r.metadata?.broker_fee || 0), tax_amount: Number(r.metadata?.tax_amount || 0),
          }).catch(e => console.error('[Webhook:Square] Revenue ingest err:', e.message));

          const orderId = r.order_id || r.metadata?.masterOrderId;
          if (orderId) {
            try {
              const order = await getOrderById(orderId);
              if (order && order.status !== 'confirmed') {
                const prevStatus = order.status;
                order.status = 'confirmed';
                order.payment = order.payment || {};
                order.payment.status = 'completed';
                order.payment.confirmed_at = new Date().toISOString();
                await saveOrder(order);
                logOrderEvent(orderId, 'payment_confirmed', {
                  previous_status: prevStatus,
                  payment_id: payment.id,
                  amount,
                  provider: 'square'
                });
                const buyerEmail = order.buyer_account?.email;
                if (buyerEmail) {
                  emailService.sendEmail({
                    to: buyerEmail,
                    subject: `GreenReach Order #${String(orderId).substring(0, 8)} - Payment Confirmed`,
                    text: `Your payment of $${amount.toFixed(2)} CAD has been confirmed. Order #${String(orderId).substring(0, 8)} is now being prepared for fulfillment.`,
                    html: `<p>Your payment of <strong>$${amount.toFixed(2)} CAD</strong> has been confirmed.</p><p>Order <strong>#${String(orderId).substring(0, 8)}</strong> is now being prepared for fulfillment.</p>`
                  }).catch(e => console.warn('[Webhook:Square] Buyer notification email err:', e.message));
                }
              }
            } catch (e) {
              console.error('[Webhook:Square] Order status update err:', e.message);
            }
          }
        }
      }
    } else if (eventType === 'refund.created' || eventType === 'refund.updated') {
      const refund = event.data?.object?.refund;
      if (!refund) return;

      const amountCents = Number(refund.amount_money?.amount || 0);
      const amount = amountCents / 100;

      // Update any matching refund record
      if (refund.payment_id) {
        await query(
          `UPDATE payment_records SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{last_refund_webhook}', $1::jsonb), updated_at = NOW()
           WHERE payment_id = $2 OR metadata->>'square_payment_id' = $2`,
          [JSON.stringify({ refund_id: refund.id, amount, status: refund.status, at: new Date().toISOString() }), refund.payment_id]
        );
      }

      // Ingest refund reversal into accounting
      if (refund.status === 'COMPLETED' || refund.status === 'APPROVED') {
        ingestRefundReversal({
          refund_id: refund.id, order_id: refund.order_id || refund.payment_id, amount, provider: 'square',
        }).catch(e => console.error('[Webhook:Square] Refund reversal err:', e.message));

        // Downgrade order status to cancelled if refund is completed
        if (refund.payment_id) {
          try {
            const matchResult = await query(
              `SELECT master_order_id FROM payment_records WHERE payment_id = $1 OR metadata->>'square_payment_id' = $1 LIMIT 1`,
              [refund.payment_id]
            );
            const orderId = matchResult.rows[0]?.master_order_id;
            if (orderId) {
              const order = await getOrderById(orderId);
              if (order && isValidOrderTransition(order.status, 'cancelled')) {
                transitionOrderStatus(order, 'cancelled');
                order.cancelled_at = new Date().toISOString();
                order.cancellation_reason = `Refund completed via webhook (refund_id: ${refund.id})`;
                await saveOrder(order);
                logOrderEvent(orderId, 'order_cancelled_on_refund', {
                  refund_id: refund.id, amount, previous_status: order.status
                });
                console.log(`[Webhook:Square] Order ${orderId} cancelled after refund ${refund.id}`);
              }
            }
          } catch (e) {
            console.error('[Webhook:Square] Order status downgrade on refund err:', e.message);
          }
        }
      }
    }
  } catch (err) {
    console.error('[Webhook:Square] Processing error:', err.message);
  }
});

// ──────────────────────────────────────────────────────────
// Stripe Webhook Receiver
// ──────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/stripe
 * Receives Stripe webhook events.
 * Must be configured in the Stripe Dashboard → Developers → Webhooks.
 * Env: STRIPE_WEBHOOK_SECRET
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[Webhook:Stripe] STRIPE_WEBHOOK_SECRET not set — rejecting');
    return res.status(503).json({ error: 'Webhook not configured' });
  }

  const sigHeader = req.headers['stripe-signature'];
  if (!sigHeader) {
    return res.status(401).json({ error: 'Missing stripe-signature header' });
  }

  // Verify signature using Stripe's signing scheme (t=...,v1=...)
  const rawBody = typeof req.body === 'string' ? req.body : req.body.toString('utf8');
  if (!verifyStripeSignature(rawBody, sigHeader, webhookSecret)) {
    console.warn('[Webhook:Stripe] Signature verification failed');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventType = event.type || 'unknown';
  console.log(`[Webhook:Stripe] Received: ${eventType} (id: ${event.id || 'n/a'})`);

  // Acknowledge immediately
  res.status(200).json({ received: true });

  try {
    if (!isDatabaseAvailable()) return;

    // Dedup: skip if this event was already processed
    if (await isEventProcessed(event.id, 'stripe')) {
      console.log(`[Webhook:Stripe] Duplicate event ${event.id} — skipping`);
      return;
    }

    const obj = event.data?.object;
    if (!obj) return;

    if (eventType === 'payment_intent.succeeded') {
      const amount = Number(obj.amount || 0) / 100;
      await query(
        `UPDATE payment_records SET status = 'completed', metadata = jsonb_set(COALESCE(metadata, '{}'), '{stripe_webhook_event}', $1::jsonb), updated_at = NOW()
         WHERE payment_id = $2 OR metadata->>'stripe_payment_intent_id' = $2`,
        [JSON.stringify({ type: eventType, at: new Date().toISOString() }), obj.id]
      );

      const record = await query('SELECT * FROM payment_records WHERE payment_id = $1 OR metadata->>\'stripe_payment_intent_id\' = $1 LIMIT 1', [obj.id]);
      if (record.rows.length > 0) {
        const r = record.rows[0];
        ingestPaymentRevenue({
          payment_id: r.payment_id, order_id: r.order_id, amount, provider: 'stripe',
          broker_fee: Number(r.metadata?.broker_fee || 0), tax_amount: Number(r.metadata?.tax_amount || 0),
        }).catch(e => console.error('[Webhook:Stripe] Revenue ingest err:', e.message));
      }
    } else if (eventType === 'payment_intent.payment_failed') {
      await query(
        `UPDATE payment_records SET status = 'failed', metadata = jsonb_set(COALESCE(metadata, '{}'), '{stripe_webhook_event}', $1::jsonb), updated_at = NOW()
         WHERE payment_id = $2 OR metadata->>'stripe_payment_intent_id' = $2`,
        [JSON.stringify({ type: eventType, error: obj.last_payment_error?.message, at: new Date().toISOString() }), obj.id]
      );
    } else if (eventType === 'charge.refunded' || eventType === 'charge.refund.updated') {
      const amount = Number(obj.amount_refunded || obj.amount || 0) / 100;
      const paymentIntentId = obj.payment_intent;

      if (paymentIntentId) {
        await query(
          `UPDATE payment_records SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{last_refund_webhook}', $1::jsonb), updated_at = NOW()
           WHERE payment_id = $2 OR metadata->>'stripe_payment_intent_id' = $2`,
          [JSON.stringify({ amount, status: obj.status, at: new Date().toISOString() }), paymentIntentId]
        );
      }

      if (obj.status === 'succeeded') {
        ingestRefundReversal({
          refund_id: obj.id, order_id: paymentIntentId, amount, provider: 'stripe',
        }).catch(e => console.error('[Webhook:Stripe] Refund reversal err:', e.message));
      }
    }
  } catch (err) {
    console.error('[Webhook:Stripe] Processing error:', err.message);
  }
});

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function mapSquareStatus(squareStatus) {
  const map = { APPROVED: 'authorized', COMPLETED: 'completed', PENDING: 'created', CANCELED: 'failed', FAILED: 'failed' };
  return map[squareStatus] || 'created';
}

/**
 * Verify Stripe webhook signature without the Stripe SDK.
 * Stripe signs: timestamp + '.' + payload → HMAC-SHA256 with webhook secret.
 * The signature header format: t=<ts>,v1=<sig>[,v1=<sig>...]
 */
function verifyStripeSignature(payload, sigHeader, secret) {
  try {
    const elements = sigHeader.split(',').reduce((acc, part) => {
      const [key, val] = part.split('=');
      if (key === 't') acc.timestamp = val;
      if (key === 'v1') acc.signatures.push(val);
      return acc;
    }, { timestamp: null, signatures: [] });

    if (!elements.timestamp || elements.signatures.length === 0) return false;

    // Reject if timestamp is older than 5 minutes (replay protection)
    const age = Math.abs(Date.now() / 1000 - Number(elements.timestamp));
    if (age > 300) return false;

    const signedPayload = `${elements.timestamp}.${payload}`;
    const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    return elements.signatures.some(sig =>
      crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))
    );
  } catch {
    return false;
  }
}

export default router;
