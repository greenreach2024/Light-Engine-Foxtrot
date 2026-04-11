/**
 * Wholesale Donations — Food Bank Surplus Distribution
 * =====================================================
 * Enables non-profit food security organizations (food banks, shelters,
 * pantries) to receive donated surplus produce through the wholesale portal.
 *
 * Flow:
 *   1. Admin creates a Donation Offer from surplus produce
 *   2. Food bank accounts are notified
 *   3. Food bank claims the offer (partial or full qty)
 *   4. System records a $0 Donation Order with fair-market-value for CRA receipts
 *   5. Farm fulfills via normal fulfillment flow
 *   6. Tax receipt generated for the donating farm
 *
 * Canada-only. Fair market value recorded for CRA charitable donation receipts.
 */

import express from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { isDatabaseAvailable, query } from '../config/database.js';
import {
  getBuyerById,
  hydrateBuyerById,
  listAllBuyers,
  createOrder,
  listOrdersForBuyer,
  logOrderEvent
} from '../services/wholesaleMemoryStore.js';
import emailService from '../services/email-service.js';
import notificationStore from '../services/notification-store.js';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';

const router = express.Router();

// ── Buyer auth (mirrors wholesale.js pattern) ────────────────────────
function getWholesaleJwtSecret() {
  const secret = process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return crypto.randomBytes(32).toString('hex');
  return null;
}

async function requireBuyerAuth(req, res, next) {
  const authHeader = req.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length).trim() : '';
  if (!token) return res.status(401).json({ status: 'error', message: 'Missing bearer token' });

  const secret = getWholesaleJwtSecret();
  if (!secret) return res.status(500).json({ status: 'error', message: 'Auth not configured' });

  try {
    const payload = jwt.verify(token, secret);
    if (!payload?.sub) return res.status(401).json({ status: 'error', message: 'Invalid token' });

    let buyer = getBuyerById(payload.sub);
    if (!buyer) buyer = await hydrateBuyerById(payload.sub);
    if (!buyer) return res.status(401).json({ status: 'error', message: 'Buyer not found' });
    if (buyer.status === 'deactivated') return res.status(403).json({ status: 'error', message: 'Account deactivated' });

    req.buyerId = buyer.id;
    req.buyer = buyer;
    next();
  } catch {
    return res.status(401).json({ status: 'error', message: 'Invalid or expired token' });
  }
}

function requireFoodBankBuyer(req, res, next) {
  if (req.buyer?.buyerType !== 'food_bank') {
    return res.status(403).json({ status: 'error', message: 'Only food bank accounts can access donations' });
  }
  next();
}

// ── DB schema bootstrap ──────────────────────────────────────────────
let donationTablesReady = false;

async function ensureDonationTables() {
  if (donationTablesReady) return true;
  if (!isDatabaseAvailable()) return false;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS donation_offers (
        id              TEXT PRIMARY KEY,
        farm_id         TEXT NOT NULL,
        created_by      TEXT NOT NULL DEFAULT 'admin',
        status          TEXT NOT NULL DEFAULT 'available',
        reason          TEXT NOT NULL DEFAULT 'surplus',
        pickup_window   TEXT,
        notes           TEXT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMPTZ,
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS donation_offer_items (
        id              SERIAL PRIMARY KEY,
        offer_id        TEXT NOT NULL REFERENCES donation_offers(id) ON DELETE CASCADE,
        product_name    TEXT NOT NULL,
        sku             TEXT,
        category        TEXT,
        quantity         NUMERIC NOT NULL,
        unit            TEXT NOT NULL DEFAULT 'lbs',
        retail_price    NUMERIC NOT NULL DEFAULT 0,
        fair_market_value NUMERIC NOT NULL DEFAULT 0
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS donation_claims (
        id              TEXT PRIMARY KEY,
        offer_id        TEXT NOT NULL REFERENCES donation_offers(id),
        buyer_id        TEXT NOT NULL,
        order_id        TEXT,
        status          TEXT NOT NULL DEFAULT 'claimed',
        claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        fulfilled_at    TIMESTAMPTZ,
        notes           TEXT
      )
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS donation_claim_items (
        id              SERIAL PRIMARY KEY,
        claim_id        TEXT NOT NULL REFERENCES donation_claims(id) ON DELETE CASCADE,
        product_name    TEXT NOT NULL,
        sku             TEXT,
        quantity         NUMERIC NOT NULL,
        unit            TEXT NOT NULL DEFAULT 'lbs',
        fair_market_value NUMERIC NOT NULL DEFAULT 0
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_donation_offers_status ON donation_offers(status, expires_at)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_donation_claims_buyer ON donation_claims(buyer_id, status)`);
    await query(`CREATE INDEX IF NOT EXISTS idx_donation_claims_offer ON donation_claims(offer_id)`);
    donationTablesReady = true;
    console.log('[Donations] Tables ready');
    return true;
  } catch (err) {
    console.error('[Donations] Table bootstrap failed:', err.message);
    return false;
  }
}

// ── ADMIN: Create a donation offer ───────────────────────────────────
// Called from admin UI or via FAYE when surplus is detected.
// Auth: admin auth middleware is applied at mount point in server.js

router.post('/offers', adminAuthMiddleware, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { farm_id, items, pickup_window, notes, reason, expires_at } = req.body;

  if (!farm_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'farm_id and items[] are required' });
  }

  const offerId = `DON-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const offerReason = ['surplus', 'planned', 'seasonal', 'end_of_day'].includes(reason) ? reason : 'surplus';

  try {
    await query(
      `INSERT INTO donation_offers (id, farm_id, created_by, status, reason, pickup_window, notes, expires_at)
       VALUES ($1, $2, $3, 'available', $4, $5, $6, $7)`,
      [offerId, farm_id, req.adminUser?.email || 'admin', offerReason,
       pickup_window || null, notes || null, expires_at || null]
    );

    let totalFmv = 0;
    for (const item of items) {
      const fmv = Number(item.fair_market_value || 0) || (Number(item.retail_price || 0) * Number(item.quantity || 0));
      totalFmv += fmv;
      await query(
        `INSERT INTO donation_offer_items (offer_id, product_name, sku, category, quantity, unit, retail_price, fair_market_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [offerId, item.product_name, item.sku || null, item.category || null,
         Number(item.quantity || 0), item.unit || 'lbs',
         Number(item.retail_price || 0), fmv]
      );
    }

    // Notify all active food_bank buyers
    await notifyFoodBanks(offerId, farm_id, items, totalFmv);

    console.log(`[Donations] Offer ${offerId} created: ${items.length} items, FMV $${totalFmv.toFixed(2)}`);
    res.json({ status: 'ok', data: { offer_id: offerId, items_count: items.length, total_fmv: totalFmv } });
  } catch (err) {
    console.error('[Donations] Create offer error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to create donation offer' });
  }
});

// ── ADMIN: List all donation offers ──────────────────────────────────

router.get('/offers', adminAuthMiddleware, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { status, farm_id, limit = 50, offset = 0 } = req.query;

  try {
    let sql = `SELECT o.*, COALESCE(json_agg(
                 json_build_object('product_name', i.product_name, 'sku', i.sku, 'category', i.category,
                   'quantity', i.quantity, 'unit', i.unit, 'retail_price', i.retail_price,
                   'fair_market_value', i.fair_market_value)
               ) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
               FROM donation_offers o
               LEFT JOIN donation_offer_items i ON i.offer_id = o.id`;
    const params = [];
    const conditions = [];
    let idx = 1;

    if (status) { conditions.push(`o.status = $${idx++}`); params.push(status); }
    if (farm_id) { conditions.push(`o.farm_id = $${idx++}`); params.push(farm_id); }

    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    sql += ` GROUP BY o.id ORDER BY o.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(Number(limit), Number(offset));

    const result = await query(sql, params);

    // Attach claim summary per offer
    for (const offer of result.rows) {
      const claims = await query(
        `SELECT c.id, c.buyer_id, c.status, c.claimed_at,
                COALESCE(json_agg(json_build_object('product_name', ci.product_name, 'quantity', ci.quantity, 'unit', ci.unit)) FILTER (WHERE ci.id IS NOT NULL), '[]') AS claimed_items
         FROM donation_claims c
         LEFT JOIN donation_claim_items ci ON ci.claim_id = c.id
         WHERE c.offer_id = $1
         GROUP BY c.id ORDER BY c.claimed_at DESC`,
        [offer.id]
      );
      offer.claims = claims.rows;
    }

    res.json({ status: 'ok', data: { offers: result.rows, total: result.rows.length } });
  } catch (err) {
    console.error('[Donations] List offers error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to list offers' });
  }
});

// ── ADMIN: Cancel / expire a donation offer ──────────────────────────

router.patch('/offers/:offerId/status', adminAuthMiddleware, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { offerId } = req.params;
  const { status: newStatus } = req.body;

  if (!['cancelled', 'expired', 'available'].includes(newStatus)) {
    return res.status(400).json({ status: 'error', message: 'Invalid status. Use: cancelled, expired, available' });
  }

  try {
    const result = await query(
      `UPDATE donation_offers SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [newStatus, offerId]
    );
    if (!result.rows.length) return res.status(404).json({ status: 'error', message: 'Offer not found' });
    res.json({ status: 'ok', data: result.rows[0] });
  } catch (err) {
    console.error('[Donations] Update offer status error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to update offer' });
  }
});

// ── BUYER: List available donation offers (food_bank only) ───────────

router.get('/available', requireBuyerAuth, requireFoodBankBuyer, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  try {
    // Show available offers that haven't expired
    const result = await query(`
      SELECT o.*, COALESCE(json_agg(
        json_build_object('product_name', i.product_name, 'sku', i.sku, 'category', i.category,
          'quantity', i.quantity, 'unit', i.unit, 'fair_market_value', i.fair_market_value)
      ) FILTER (WHERE i.id IS NOT NULL), '[]') AS items
      FROM donation_offers o
      LEFT JOIN donation_offer_items i ON i.offer_id = o.id
      WHERE o.status = 'available'
        AND (o.expires_at IS NULL OR o.expires_at > NOW())
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 50
    `);

    // Subtract already-claimed quantities
    for (const offer of result.rows) {
      const claimed = await query(
        `SELECT ci.product_name, SUM(ci.quantity) as claimed_qty
         FROM donation_claims c
         JOIN donation_claim_items ci ON ci.claim_id = c.id
         WHERE c.offer_id = $1 AND c.status != 'cancelled'
         GROUP BY ci.product_name`,
        [offer.id]
      );
      const claimedMap = {};
      for (const row of claimed.rows) claimedMap[row.product_name] = Number(row.claimed_qty);

      offer.items = (offer.items || []).map(item => ({
        ...item,
        claimed_qty: claimedMap[item.product_name] || 0,
        remaining_qty: Math.max(0, Number(item.quantity) - (claimedMap[item.product_name] || 0))
      }));

      offer.fully_claimed = offer.items.every(item => item.remaining_qty <= 0);
    }

    // Filter out fully claimed offers
    const available = result.rows.filter(o => !o.fully_claimed);
    res.json({ status: 'ok', data: { offers: available } });
  } catch (err) {
    console.error('[Donations] List available error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to load available donations' });
  }
});

// ── BUYER: Claim a donation offer (food_bank only) ───────────────────

router.post('/claim', requireBuyerAuth, requireFoodBankBuyer, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { offer_id, items, notes } = req.body;
  if (!offer_id || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ status: 'error', message: 'offer_id and items[] are required' });
  }

  try {
    // Verify offer exists and is available
    const offerResult = await query('SELECT * FROM donation_offers WHERE id = $1', [offer_id]);
    if (!offerResult.rows.length) return res.status(404).json({ status: 'error', message: 'Offer not found' });
    const offer = offerResult.rows[0];
    if (offer.status !== 'available') return res.status(400).json({ status: 'error', message: 'Offer is no longer available' });
    if (offer.expires_at && new Date(offer.expires_at) < new Date()) {
      return res.status(400).json({ status: 'error', message: 'Offer has expired' });
    }

    // Get offer items for validation
    const offerItems = await query('SELECT * FROM donation_offer_items WHERE offer_id = $1', [offer_id]);
    const offerItemMap = {};
    for (const oi of offerItems.rows) offerItemMap[oi.product_name] = oi;

    // Check already-claimed quantities
    const alreadyClaimed = await query(
      `SELECT ci.product_name, SUM(ci.quantity) as claimed_qty
       FROM donation_claims c
       JOIN donation_claim_items ci ON ci.claim_id = c.id
       WHERE c.offer_id = $1 AND c.status != 'cancelled'
       GROUP BY ci.product_name`,
      [offer_id]
    );
    const claimedMap = {};
    for (const row of alreadyClaimed.rows) claimedMap[row.product_name] = Number(row.claimed_qty);

    // Validate claim quantities
    let totalClaimFmv = 0;
    const validatedItems = [];
    for (const claimItem of items) {
      const offerItem = offerItemMap[claimItem.product_name];
      if (!offerItem) {
        return res.status(400).json({ status: 'error', message: `Product "${claimItem.product_name}" not in this offer` });
      }
      const available = Number(offerItem.quantity) - (claimedMap[claimItem.product_name] || 0);
      const requested = Number(claimItem.quantity || 0);
      if (requested <= 0) continue;
      if (requested > available) {
        return res.status(400).json({ status: 'error', message: `Only ${available} ${offerItem.unit} of "${claimItem.product_name}" remaining` });
      }
      const unitFmv = Number(offerItem.fair_market_value) / Number(offerItem.quantity);
      const itemFmv = unitFmv * requested;
      totalClaimFmv += itemFmv;
      validatedItems.push({
        product_name: claimItem.product_name,
        sku: offerItem.sku,
        quantity: requested,
        unit: offerItem.unit,
        fair_market_value: Math.round(itemFmv * 100) / 100
      });
    }

    if (validatedItems.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No valid items to claim' });
    }

    // Create the claim
    const claimId = `DC-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    await query(
      `INSERT INTO donation_claims (id, offer_id, buyer_id, status, notes) VALUES ($1, $2, $3, 'claimed', $4)`,
      [claimId, offer_id, req.buyerId, notes || null]
    );

    for (const item of validatedItems) {
      await query(
        `INSERT INTO donation_claim_items (claim_id, product_name, sku, quantity, unit, fair_market_value)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [claimId, item.product_name, item.sku, item.quantity, item.unit, item.fair_market_value]
      );
    }

    // Create a $0 donation order in the wholesale order system
    const donationOrderId = `DO-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    const farmSubOrders = [{
      farm_id: offer.farm_id,
      items: validatedItems.map(item => ({
        product_name: item.product_name,
        sku: item.sku || null,
        quantity: item.quantity,
        unit: item.unit,
        price_per_unit: 0,
        subtotal: 0,
        fair_market_value: item.fair_market_value
      })),
      subtotal: 0,
      broker_fee: 0,
      tax: 0,
      total_amount_cents: 0,
      status: 'confirmed',
      order_type: 'donation',
      donation_claim_id: claimId,
      donation_offer_id: offer_id
    }];

    const buyer = req.buyer;
    const donationOrder = createOrder({
      buyerId: req.buyerId,
      buyerAccount: { businessName: buyer.businessName, email: buyer.email },
      deliveryDate: null,
      deliveryAddress: buyer.location || null,
      farmSubOrders,
      totals: {
        grand_total: 0,
        broker_fee_total: 0,
        net_to_farms_total: 0
      },
      orderId: donationOrderId
    });

    // Tag the order as a donation
    donationOrder.order_type = 'donation';
    donationOrder.donation_metadata = {
      offer_id: offer_id,
      claim_id: claimId,
      estimated_fair_market_value: Math.round(totalClaimFmv * 100) / 100,
      reason: offer.reason,
      donor_farm_id: offer.farm_id,
      recipient_org: buyer.businessName,
      receipt_generated: false
    };

    // Persist donation order to DB
    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO wholesale_orders (order_id, buyer_id, order_data, created_at)
           VALUES ($1, $2, $3::jsonb, NOW())
           ON CONFLICT (order_id) DO UPDATE SET order_data = EXCLUDED.order_data`,
          [donationOrderId, req.buyerId, JSON.stringify(donationOrder)]
        );
      } catch (dbErr) {
        console.warn('[Donations] Order DB persist warning:', dbErr.message);
      }
    }

    // Update claim with order reference
    await query('UPDATE donation_claims SET order_id = $1 WHERE id = $2', [donationOrderId, claimId]);

    // Log audit event
    logOrderEvent(donationOrderId, 'donation_claimed', {
      buyer_id: req.buyerId,
      claim_id: claimId,
      offer_id: offer_id,
      fmv: totalClaimFmv
    });

    // Check if offer is now fully claimed
    const remainingCheck = await query(
      `SELECT oi.product_name, oi.quantity as offered,
              COALESCE((SELECT SUM(ci.quantity) FROM donation_claims c
                        JOIN donation_claim_items ci ON ci.claim_id = c.id
                        WHERE c.offer_id = $1 AND c.status != 'cancelled'
                        AND ci.product_name = oi.product_name), 0) as claimed
       FROM donation_offer_items oi WHERE oi.offer_id = $1`,
      [offer_id]
    );
    const fullyClaimed = remainingCheck.rows.every(r => Number(r.claimed) >= Number(r.offered));
    if (fullyClaimed) {
      await query(`UPDATE donation_offers SET status = 'fully_claimed', updated_at = NOW() WHERE id = $1`, [offer_id]);
    }

    // Notify admin of claim
    try {
      const adminEmail = process.env.ADMIN_EMAIL || process.env.ADMIN_ALERT_EMAIL;
      if (adminEmail) {
        const itemSummary = validatedItems.map(i => `${i.quantity} ${i.unit} ${i.product_name}`).join(', ');
        await emailService.sendEmail({
          to: adminEmail,
          subject: `Donation Claimed: ${buyer.businessName}`,
          text: `${buyer.businessName} claimed donation offer ${offer_id}.\n\nItems: ${itemSummary}\nFair Market Value: $${totalClaimFmv.toFixed(2)}\nOrder: ${donationOrderId}`,
          html: `<p><strong>${buyer.businessName}</strong> claimed donation offer <code>${offer_id}</code>.</p>
                 <p>Items: ${itemSummary}</p>
                 <p>Fair Market Value: $${totalClaimFmv.toFixed(2)}</p>
                 <p>Donation Order: <code>${donationOrderId}</code></p>`
        });
      }
    } catch (emailErr) {
      console.warn('[Donations] Admin notification email failed:', emailErr.message);
    }

    console.log(`[Donations] Claim ${claimId} created by ${buyer.businessName} for offer ${offer_id}, FMV $${totalClaimFmv.toFixed(2)}`);
    res.json({
      status: 'ok',
      data: {
        claim_id: claimId,
        order_id: donationOrderId,
        items: validatedItems,
        total_fair_market_value: Math.round(totalClaimFmv * 100) / 100
      }
    });
  } catch (err) {
    console.error('[Donations] Claim error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to process donation claim' });
  }
});

// ── BUYER: My claimed donations (food_bank only) ────────────────────

router.get('/my-claims', requireBuyerAuth, requireFoodBankBuyer, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  try {
    const result = await query(`
      SELECT c.*, o.farm_id, o.reason as offer_reason,
             COALESCE(json_agg(
               json_build_object('product_name', ci.product_name, 'quantity', ci.quantity,
                 'unit', ci.unit, 'fair_market_value', ci.fair_market_value)
             ) FILTER (WHERE ci.id IS NOT NULL), '[]') AS items
      FROM donation_claims c
      JOIN donation_offers o ON o.id = c.offer_id
      LEFT JOIN donation_claim_items ci ON ci.claim_id = c.id
      WHERE c.buyer_id = $1
      GROUP BY c.id, o.farm_id, o.reason
      ORDER BY c.claimed_at DESC
      LIMIT 100
    `, [req.buyerId]);

    res.json({ status: 'ok', data: { claims: result.rows } });
  } catch (err) {
    console.error('[Donations] My claims error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to load claims' });
  }
});

// ── BUYER: Cancel a claim (before fulfillment) ──────────────────────

router.post('/claims/:claimId/cancel', requireBuyerAuth, requireFoodBankBuyer, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { claimId } = req.params;

  try {
    const result = await query(
      `UPDATE donation_claims SET status = 'cancelled'
       WHERE id = $1 AND buyer_id = $2 AND status = 'claimed'
       RETURNING *`,
      [claimId, req.buyerId]
    );

    if (!result.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Claim not found or already processed' });
    }

    // Re-open the parent offer if it was fully claimed
    const claim = result.rows[0];
    await query(
      `UPDATE donation_offers SET status = 'available', updated_at = NOW()
       WHERE id = $1 AND status = 'fully_claimed'`,
      [claim.offer_id]
    );

    res.json({ status: 'ok', data: { claim_id: claimId, status: 'cancelled' } });
  } catch (err) {
    console.error('[Donations] Cancel claim error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to cancel claim' });
  }
});

// ── ADMIN: Donation reporting / summary ──────────────────────────────

router.get('/summary', adminAuthMiddleware, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { start_date, end_date, farm_id } = req.query;

  try {
    const conditions = [];
    const params = [];
    let idx = 1;

    if (start_date) { conditions.push(`c.claimed_at >= $${idx++}`); params.push(start_date); }
    if (end_date) { conditions.push(`c.claimed_at <= $${idx++}`); params.push(end_date); }
    if (farm_id) { conditions.push(`o.farm_id = $${idx++}`); params.push(farm_id); }
    conditions.push(`c.status != 'cancelled'`);

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await query(`
      SELECT
        COUNT(DISTINCT c.id) as total_claims,
        COUNT(DISTINCT c.offer_id) as total_offers_claimed,
        COUNT(DISTINCT c.buyer_id) as unique_recipients,
        COALESCE(SUM(ci.quantity), 0) as total_quantity,
        COALESCE(SUM(ci.fair_market_value), 0) as total_fair_market_value
      FROM donation_claims c
      JOIN donation_offers o ON o.id = c.offer_id
      LEFT JOIN donation_claim_items ci ON ci.claim_id = c.id
      ${where}
    `, params);

    // Per-product breakdown
    const products = await query(`
      SELECT ci.product_name, ci.unit,
             SUM(ci.quantity) as total_qty,
             SUM(ci.fair_market_value) as total_fmv,
             COUNT(DISTINCT c.buyer_id) as recipient_count
      FROM donation_claims c
      JOIN donation_offers o ON o.id = c.offer_id
      LEFT JOIN donation_claim_items ci ON ci.claim_id = c.id
      ${where}
      GROUP BY ci.product_name, ci.unit
      ORDER BY total_qty DESC
    `, params);

    // Per-recipient breakdown
    const recipients = await query(`
      SELECT c.buyer_id,
             SUM(ci.quantity) as total_qty,
             SUM(ci.fair_market_value) as total_fmv,
             COUNT(DISTINCT c.id) as claim_count
      FROM donation_claims c
      JOIN donation_offers o ON o.id = c.offer_id
      LEFT JOIN donation_claim_items ci ON ci.claim_id = c.id
      ${where}
      GROUP BY c.buyer_id
      ORDER BY total_fmv DESC
    `, params);

    // Enrich recipient names
    for (const r of recipients.rows) {
      const buyer = getBuyerById(r.buyer_id) || await hydrateBuyerById(r.buyer_id);
      r.business_name = buyer?.businessName || r.buyer_id;
    }

    const summary = result.rows[0] || {};
    res.json({
      status: 'ok',
      data: {
        total_claims: Number(summary.total_claims || 0),
        total_offers_claimed: Number(summary.total_offers_claimed || 0),
        unique_recipients: Number(summary.unique_recipients || 0),
        total_quantity_donated: Number(summary.total_quantity || 0),
        total_fair_market_value: Number(summary.total_fair_market_value || 0),
        by_product: products.rows,
        by_recipient: recipients.rows
      }
    });
  } catch (err) {
    console.error('[Donations] Summary error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to generate summary' });
  }
});

// ── ADMIN: Generate CRA tax receipt data ─────────────────────────────

router.get('/receipt/:claimId', adminAuthMiddleware, async (req, res) => {
  if (!await ensureDonationTables()) {
    return res.status(503).json({ status: 'error', message: 'Database unavailable' });
  }

  const { claimId } = req.params;

  try {
    const claimResult = await query(`
      SELECT c.*, o.farm_id, o.reason, o.created_at as offer_date
      FROM donation_claims c
      JOIN donation_offers o ON o.id = c.offer_id
      WHERE c.id = $1
    `, [claimId]);

    if (!claimResult.rows.length) {
      return res.status(404).json({ status: 'error', message: 'Claim not found' });
    }

    const claim = claimResult.rows[0];
    const items = await query(
      'SELECT * FROM donation_claim_items WHERE claim_id = $1',
      [claimId]
    );

    const buyer = getBuyerById(claim.buyer_id) || await hydrateBuyerById(claim.buyer_id);
    const totalFmv = items.rows.reduce((sum, i) => sum + Number(i.fair_market_value), 0);

    const receipt = {
      receipt_number: `GR-DON-${claimId}`,
      date_of_donation: claim.claimed_at,
      donor: {
        name: 'GreenReach Greens',
        address: 'Ottawa, ON, Canada',
        business_number: process.env.CRA_BUSINESS_NUMBER || '(Business Number on file)',
        farm_id: claim.farm_id
      },
      recipient_organization: {
        name: buyer?.businessName || 'Unknown',
        contact: buyer?.contactName || '',
        address: buyer?.location ? `${buyer.location.address1 || ''}, ${buyer.location.city || ''}, ${buyer.location.state || ''} ${buyer.location.postalCode || ''}`.trim() : '',
        charity_registration: '(To be provided by recipient)'
      },
      items: items.rows.map(i => ({
        description: i.product_name,
        quantity: Number(i.quantity),
        unit: i.unit,
        fair_market_value: Number(i.fair_market_value)
      })),
      total_fair_market_value: Math.round(totalFmv * 100) / 100,
      currency: 'CAD',
      reason: claim.reason || 'surplus',
      valuation_method: 'Retail price at time of donation (farm gate value)',
      notes: 'Fair market value determined based on current wholesale catalog retail pricing. Produce donated as surplus from local farm production through GreenReach distribution network.'
    };

    res.json({ status: 'ok', data: { receipt } });
  } catch (err) {
    console.error('[Donations] Receipt error:', err.message);
    res.status(500).json({ status: 'error', message: 'Failed to generate receipt' });
  }
});

// ── Notification helper ──────────────────────────────────────────────

async function notifyFoodBanks(offerId, farmId, items, totalFmv) {
  try {
    const allBuyers = listAllBuyers();
    const foodBanks = allBuyers.filter(b => b.buyerType === 'food_bank' && b.status === 'active');

    if (foodBanks.length === 0) {
      console.log('[Donations] No active food bank accounts to notify');
      return;
    }

    const itemSummary = items.map(i => `${i.quantity} ${i.unit || 'lbs'} ${i.product_name}`).join(', ');
    const subject = 'New Surplus Produce Available for Donation';
    const textBody = `Fresh surplus produce is available through GreenReach.\n\nItems: ${itemSummary}\nEstimated Value: $${totalFmv.toFixed(2)} CAD\n\nLog in to the wholesale portal to claim this donation:\nhttps://greenreachgreens.com/GR-wholesale.html\n\nThis offer is available on a first-come basis.`;
    const htmlBody = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px;">
        <h2 style="color: #2d5016;">Surplus Produce Available</h2>
        <p>Fresh surplus produce is available for donation through GreenReach.</p>
        <div style="background: #f0f7e6; padding: 1rem; border-radius: 8px; margin: 1rem 0;">
          <p style="margin: 0 0 0.5rem 0;"><strong>Available Items:</strong></p>
          <ul style="margin: 0; padding-left: 1.5rem;">
            ${items.map(i => `<li>${i.quantity} ${i.unit || 'lbs'} ${i.product_name}</li>`).join('')}
          </ul>
          <p style="margin: 0.5rem 0 0 0;"><strong>Estimated Fair Market Value:</strong> $${totalFmv.toFixed(2)} CAD</p>
        </div>
        <p><a href="https://greenreachgreens.com/GR-wholesale.html" style="display: inline-block; background: #2d5016; color: #fff; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none;">Claim This Donation</a></p>
        <p style="color: #666; font-size: 0.85rem;">This offer is available on a first-come basis. Log in with your food bank account to claim.</p>
      </div>`;

    for (const bank of foodBanks) {
      try {
        await emailService.sendEmail({
          to: bank.email,
          subject,
          text: textBody,
          html: htmlBody
        });
      } catch (emailErr) {
        console.warn(`[Donations] Failed to notify ${bank.email}:`, emailErr.message);
      }
    }

    // Also push in-app notification for admin
    await notificationStore.pushNotification('GR-ADMIN', {
      category: 'donation',
      title: 'Donation Offer Created',
      body: `${items.length} items offered (FMV $${totalFmv.toFixed(2)}). ${foodBanks.length} food bank(s) notified.`,
      severity: 'info',
      source: 'donation-service'
    });

    console.log(`[Donations] Notified ${foodBanks.length} food bank(s) about offer ${offerId}`);
  } catch (err) {
    console.error('[Donations] Notification error:', err.message);
  }
}

// ── Surplus-to-donation helper (called from admin or scheduled) ──────

export async function createDonationFromSurplus(surplusPredictions, farmId, adminEmail) {
  if (!await ensureDonationTables()) return null;
  if (!Array.isArray(surplusPredictions) || surplusPredictions.length === 0) return null;

  const eligibleItems = surplusPredictions
    .filter(p => p.surplus_kg > 0.5 && p.surplus_ratio > 0.2)
    .map(p => ({
      product_name: p.crop,
      category: 'produce',
      quantity: Math.round(p.surplus_kg * 2.205), // kg to lbs
      unit: 'lbs',
      retail_price: p.retail_price || 0,
      fair_market_value: (p.retail_price || 0) * Math.round(p.surplus_kg * 2.205)
    }));

  if (eligibleItems.length === 0) return null;

  const offerId = `DON-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  let totalFmv = 0;

  try {
    await query(
      `INSERT INTO donation_offers (id, farm_id, created_by, status, reason, notes, expires_at)
       VALUES ($1, $2, $3, 'available', 'surplus', 'Auto-generated from surplus prediction', NOW() + INTERVAL '7 days')`,
      [offerId, farmId || 'GR-00001', adminEmail || 'system']
    );

    for (const item of eligibleItems) {
      totalFmv += item.fair_market_value;
      await query(
        `INSERT INTO donation_offer_items (offer_id, product_name, category, quantity, unit, retail_price, fair_market_value)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [offerId, item.product_name, item.category, item.quantity, item.unit, item.retail_price, item.fair_market_value]
      );
    }

    await notifyFoodBanks(offerId, farmId, eligibleItems, totalFmv);
    console.log(`[Donations] Auto-created offer ${offerId} from surplus: ${eligibleItems.length} items, FMV $${totalFmv.toFixed(2)}`);
    return { offer_id: offerId, items_count: eligibleItems.length, total_fmv: totalFmv };
  } catch (err) {
    console.error('[Donations] Auto-create from surplus error:', err.message);
    return null;
  }
}

export default router;
