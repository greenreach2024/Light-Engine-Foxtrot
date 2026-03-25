import bcrypt from 'bcryptjs';
import { randomUUID, createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { isDatabaseAvailable, query } from '../config/database.js';

function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

const buyersByEmail = new Map();
const buyersById = new Map();

const ordersById = new Map();
const ordersByBuyerId = new Map();

const paymentsById = new Map();
const refundsById = new Map();

// ── Blacklisted tokens (logout) ──────────────────────────────────────
const tokenBlacklist = new Set();

// ── Login lockout tracking ───────────────────────────────────────────
const loginAttempts = new Map(); // email → { count, lockedUntil }
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 30 * 60 * 1000; // 30 minutes

// ── Order audit trail ────────────────────────────────────────────────
const orderAuditLog = [];

// ── Password-reset tokens ────────────────────────────────────────────
const passwordResetTokens = new Map(); // token → { email, expiresAt }

const ARCHIVE_PATH = process.env.WHOLESALE_ORDER_ARCHIVE_PATH
  ? path.resolve(process.env.WHOLESALE_ORDER_ARCHIVE_PATH)
  : path.resolve(process.cwd(), 'data', 'wholesale-orders-archive.csv');
const ARCHIVE_DAYS = Math.max(1, parseInt(process.env.WHOLESALE_ORDER_ARCHIVE_DAYS || '90', 10));
const ARCHIVE_INTERVAL_MS = Math.max(60_000, parseInt(process.env.WHOLESALE_ORDER_ARCHIVE_INTERVAL_MS || '600000', 10));
let lastArchiveRun = 0;

export async function createBuyer({ businessName, contactName, email, password, buyerType, location }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) throw new Error('Email is required');
  if (buyersByEmail.has(normalizedEmail)) {
    const err = new Error('Email already registered');
    err.code = 'EMAIL_EXISTS';
    throw err;
  }

  const buyerId = `buyer-${randomUUID()}`;
  const passwordHash = await bcrypt.hash(String(password || ''), 10);

  const buyer = {
    id: buyerId,
    businessName: String(businessName || '').trim(),
    contactName: String(contactName || '').trim(),
    email: normalizedEmail,
    buyerType: String(buyerType || '').trim(),
    location: location && typeof location === 'object' ? {
      address1: String(location.address1 || '').trim() || null,
      city: String(location.city || '').trim() || null,
      state: String(location.state || '').trim() || null,
      postalCode: String(location.postalCode || location.zip || '').trim() || null,
      latitude: Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
      longitude: Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null
    } : null,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  buyersByEmail.set(normalizedEmail, buyer);
  buyersById.set(buyerId, buyer);

  await persistBuyer(buyer);

  return sanitizeBuyer(buyer);
}

export async function authenticateBuyer({ email, password }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const buyer = buyersByEmail.get(normalizedEmail);
  if (!buyer) return null;
  const ok = await bcrypt.compare(String(password || ''), buyer.passwordHash);
  if (!ok) return null;
  return sanitizeBuyer(buyer);
}

export function getBuyerById(buyerId) {
  const buyer = buyersById.get(buyerId);
  return buyer ? sanitizeBuyer(buyer) : null;
}

export function sanitizeBuyer(buyer) {
  return {
    id: buyer.id,
    businessName: buyer.businessName,
    contactName: buyer.contactName,
    email: buyer.email,
    buyerType: buyer.buyerType,
    location: buyer.location || null,
    createdAt: buyer.createdAt,
    status: buyer.status || 'active',
    phone: buyer.phone || null
  };
}

// ── Buyer persistence (DB) ───────────────────────────────────────────

async function persistBuyer(buyer) {
  if (!isDatabaseAvailable()) return;
  const now = new Date().toISOString();
  try {
    await query(
      `INSERT INTO wholesale_buyers
        (id, business_name, contact_name, email, buyer_type, location, password_hash, status, phone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE
       SET business_name = EXCLUDED.business_name,
           contact_name = EXCLUDED.contact_name,
           email = EXCLUDED.email,
           buyer_type = EXCLUDED.buyer_type,
           location = EXCLUDED.location,
           password_hash = EXCLUDED.password_hash,
           status = EXCLUDED.status,
           phone = EXCLUDED.phone,
           updated_at = EXCLUDED.updated_at`,
      [buyer.id, buyer.businessName, buyer.contactName, buyer.email,
       buyer.buyerType, JSON.stringify(buyer.location || null), buyer.passwordHash,
       buyer.status || 'active', buyer.phone || null, buyer.createdAt || now, now]
    );
  } catch (err) {
    // Log all persist errors — schema mismatches, type errors, etc.
    console.warn('[BuyerPersist] Error:', err.message);
    throw err;
  }
}

export async function loadBuyersFromDb() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query('SELECT * FROM wholesale_buyers ORDER BY created_at ASC');
    for (const row of result.rows) {
      hydrateRowIntoMaps(row);
    }
    console.log(`[BuyerPersist] Loaded ${result.rows.length} buyers from DB`);
  } catch (err) {
    if (!String(err?.message || '').includes('relation')) {
      console.warn('[BuyerPersist] Load failed:', err.message);
    }
  }
}

/**
 * Load a single buyer from the DB into the in-memory Maps.
 * Returns the buyer object if found, otherwise null.
 */
export async function hydrateBuyerById(buyerId) {
  if (!isDatabaseAvailable()) return null;
  try {
    const result = await query('SELECT * FROM wholesale_buyers WHERE id = $1 LIMIT 1', [buyerId]);
    if (!result.rows.length) return null;
    return hydrateRowIntoMaps(result.rows[0]);
  } catch {
    return null;
  }
}

/** Internal: convert a DB row into a buyer object and store in both Maps. */
function hydrateRowIntoMaps(row) {
  const buyer = {
    id: row.id,
    businessName: row.business_name,
    contactName: row.contact_name,
    email: row.email,
    buyerType: row.buyer_type,
    location: row.location || null,
    passwordHash: row.password_hash,
    status: row.status || 'active',
    phone: row.phone || null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
  };
  const key = buyer.email.trim().toLowerCase();
  if (!buyersByEmail.has(key)) {
    buyersByEmail.set(key, buyer);
    buyersById.set(buyer.id, buyer);
  }
  return buyer;
}

export async function updateBuyer(buyerId, updates) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;

  // Only allow updating safe fields
  const allowedFields = ['businessName', 'contactName', 'phone', 'buyerType', 'location'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      buyer[field] = updates[field];
    }
  }
  // Email change: re-key the email map
  if (updates.email && updates.email !== buyer.email) {
    const newEmail = String(updates.email).trim().toLowerCase();
    if (buyersByEmail.has(newEmail)) {
      const err = new Error('Email already registered');
      err.code = 'EMAIL_EXISTS';
      throw err;
    }
    buyersByEmail.delete(buyer.email.trim().toLowerCase());
    buyer.email = newEmail;
    buyersByEmail.set(newEmail, buyer);
  }

  await persistBuyer(buyer);
  return sanitizeBuyer(buyer);
}

export async function resetBuyerPassword(email, newPasswordHash) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const buyer = buyersByEmail.get(normalizedEmail);
  if (!buyer) return null;
  buyer.passwordHash = newPasswordHash;
  await persistBuyer(buyer);
  return sanitizeBuyer(buyer);
}

export async function deactivateBuyer(buyerId) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;
  buyer.status = 'deactivated';
  await persistBuyer(buyer);
  return sanitizeBuyer(buyer);
}

export async function reactivateBuyer(buyerId) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;
  buyer.status = 'active';
  await persistBuyer(buyer);
  return sanitizeBuyer(buyer);
}

export function listAllBuyers() {
  return Array.from(buyersById.values()).map(sanitizeBuyer);
}

// ── Token blacklist (logout) ─────────────────────────────────────────

export function blacklistToken(token) {
  tokenBlacklist.add(token);
  // Limit size to avoid memory leak (tokens expire after 7d anyway)
  if (tokenBlacklist.size > 10000) {
    const iter = tokenBlacklist.values();
    tokenBlacklist.delete(iter.next().value);
  }
  // Persist to DB
  if (isDatabaseAvailable()) {
    const hash = hashToken(token);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
    query(
      `INSERT INTO token_blacklist (token_hash, expires_at) VALUES ($1, $2)
       ON CONFLICT (token_hash) DO NOTHING`,
      [hash, expiresAt]
    ).catch(err => console.error('[Blacklist] DB persist error:', err.message));
  }
}

export async function isTokenBlacklisted(token) {
  if (tokenBlacklist.has(token)) return true;
  if (!isDatabaseAvailable()) return false;
  try {
    const hash = hashToken(token);
    const result = await query(
      'SELECT 1 FROM token_blacklist WHERE token_hash = $1 AND expires_at > NOW()',
      [hash]
    );
    if (result.rows.length > 0) {
      tokenBlacklist.add(token); // cache for future checks
      return true;
    }
  } catch (err) {
    console.error('[Blacklist] DB check error:', err.message);
  }
  return false;
}

export function createOrder({ buyerId, buyerAccount, poNumber, deliveryDate, deliveryAddress, recurrence, farmSubOrders, totals }) {
  const orderId = `wo-${randomUUID()}`;
  const order = {
    master_order_id: orderId,
    status: 'confirmed',
    created_at: new Date().toISOString(),
    buyer_id: buyerId,
    buyer_account: buyerAccount,
    po_number: poNumber || null,
    delivery_date: deliveryDate,
    delivery_address: deliveryAddress,
    recurrence: recurrence || { cadence: 'one_time' },
    grand_total: totals.grand_total,
    broker_fee_total: totals.broker_fee_total,
    net_to_farms_total: totals.net_to_farms_total,
    farm_sub_orders: farmSubOrders
  };

  ordersById.set(orderId, order);
  if (!ordersByBuyerId.has(buyerId)) ordersByBuyerId.set(buyerId, []);
  ordersByBuyerId.get(buyerId).unshift(order);

  persistOrder(order).catch(err => console.error('[Persist] Order save error:', err.message));
  runArchiveIfNeeded().catch(err => console.error('[Archive] Archive check error:', err.message));

  return order;
}

export async function listOrdersForBuyer(buyerId, options = {}) {
  await runArchiveIfNeeded().catch(err => console.error('[Archive] Archive check error:', err.message));
  let dbOrders = [];
  if (isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT order_data FROM wholesale_orders WHERE buyer_id = $1 ORDER BY created_at DESC',
        [buyerId]
      );
      dbOrders = result.rows.map((row) => row.order_data);
    } catch (err) {
      console.error('[wholesaleStore] DB query error (listOrdersForBuyer):', err.message);
    }
  }
  // Merge DB results with in-memory (covers orders not yet persisted)
  const memOrders = ordersByBuyerId.get(buyerId) || [];
  const merged = mergeOrders(dbOrders, memOrders);
  if (options.includeArchived) {
    const archived = await loadArchivedOrders({ buyerId });
    return mergeOrders(merged, archived);
  }
  return merged;
}

export async function listAllOrders(options = {}) {
  await runArchiveIfNeeded().catch(err => console.error('[Archive] Archive check error:', err.message));
  let dbOrders = [];
  if (isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT order_data FROM wholesale_orders ORDER BY created_at DESC'
      );
      dbOrders = result.rows.map((row) => row.order_data);
    } catch (err) {
      console.error('[wholesaleStore] DB query error (listAllOrders):', err.message);
    }
  }
  const memOrders = Array.from(ordersById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const merged = mergeOrders(dbOrders, memOrders);
  if (options.includeArchived) {
    const archived = await loadArchivedOrders();
    return mergeOrders(merged, archived);
  }
  return merged;
}

export async function updateFarmSubOrder({ orderId, farmId, updates }) {
  const order = ordersById.get(orderId);
  if (!order) return null;

  const subOrder = (order.farm_sub_orders || []).find((sub) => sub.farm_id === farmId);
  if (!subOrder) return null;

  Object.assign(subOrder, updates);
  
  // Update in buyer's list too
  const buyerOrders = ordersByBuyerId.get(order.buyer_id);
  if (buyerOrders) {
    const idx = buyerOrders.findIndex((o) => o.master_order_id === orderId);
    if (idx >= 0) buyerOrders[idx] = order;
  }

  await persistOrder(order).catch(err => console.error('[Persist] Order update error:', err.message));

  return subOrder;
}

export function createPayment({ orderId, provider, split, totals }) {
  const paymentId = `pay-${randomUUID()}`;
  const payment = {
    id: paymentId,
    payment_id: paymentId,
    order_id: orderId,
    provider: provider || 'demo',
    status: 'created',
    amount: totals.grand_total,
    currency: 'CAD',
    broker_fee_amount: totals.broker_fee_total,
    net_to_farms_total: totals.net_to_farms_total,
    split,
    created_at: new Date().toISOString()
  };
  paymentsById.set(paymentId, payment);
  persistPayment(payment).catch(err => console.error('[Persist] Payment save error:', err.message));

  // NOTE: Revenue ingestion is deferred to checkout handler after payment status is finalized.
  // This avoids recording revenue before knowing if payment succeeded.

  return payment;
}

/**
 * Re-persist a payment after its status/provider/details have been mutated.
 */
export function finalizePayment(payment) {
  if (!payment?.payment_id) return;
  paymentsById.set(payment.payment_id, payment);
  persistPayment(payment).catch(err => console.error('[Persist] Payment finalize error:', err.message));
}

async function persistPayment(payment) {
  if (!isDatabaseAvailable()) return;
  try {
    await query(
      `INSERT INTO payment_records
        (payment_id, order_id, amount, currency, provider, status, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (payment_id) DO UPDATE
       SET status = EXCLUDED.status,
           metadata = EXCLUDED.metadata`,
      [payment.payment_id, payment.order_id, payment.amount, payment.currency || 'CAD',
       payment.provider, payment.status,
       JSON.stringify({ split: payment.split, broker_fee_amount: payment.broker_fee_amount, net_to_farms_total: payment.net_to_farms_total }),
       payment.created_at]
    );
  } catch (err) {
    console.error('[Persist] Payment DB error:', err.message);
  }
}

export async function loadPaymentsFromDb() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query('SELECT * FROM payment_records ORDER BY created_at ASC');
    for (const row of result.rows) {
      const payment = {
        id: row.payment_id,
        payment_id: row.payment_id,
        order_id: row.order_id,
        amount: Number(row.amount),
        currency: row.currency || 'CAD',
        provider: row.provider,
        status: row.status,
        broker_fee_amount: row.metadata?.broker_fee_amount || 0,
        net_to_farms_total: row.metadata?.net_to_farms_total || 0,
        split: row.metadata?.split || null,
        farm_id: row.metadata?.farm_id || null,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      };
      if (!paymentsById.has(payment.payment_id)) {
        paymentsById.set(payment.payment_id, payment);
      }
    }
    console.log(`[PaymentPersist] Loaded ${result.rows.length} payments from DB`);
  } catch (err) {
    if (!String(err?.message || '').includes('relation')) {
      console.warn('[PaymentPersist] Load failed:', err.message);
    }
  }
}

export async function loadRefundsFromDb() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query(
      `SELECT * FROM payment_records WHERE provider = 'refund' ORDER BY created_at ASC`
    );
    for (const row of result.rows) {
      const refund = {
        id: row.payment_id,
        order_id: row.order_id,
        amount: Math.abs(Number(row.amount)),
        reason: row.metadata?.reason || '',
        status: row.status || 'processed',
        admin_id: row.metadata?.admin_id || null,
        created_at: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString()
      };
      if (!refundsById.has(refund.id)) {
        refundsById.set(refund.id, refund);
      }
    }
    console.log(`[RefundPersist] Loaded ${result.rows.length} refunds from DB`);
  } catch (err) {
    if (!String(err?.message || '').includes('relation')) {
      console.warn('[RefundPersist] Load failed:', err.message);
    }
  }
}

export function listPayments() {
  return Array.from(paymentsById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function listRefunds() {
  return Array.from(refundsById.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function listPaymentsForBuyer(buyerId) {
  return Array.from(paymentsById.values())
    .filter(p => {
      // Match via order's buyer_id
      const order = ordersById.get(p.order_id);
      return order && order.buyer_id === buyerId;
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function createRefund({ orderId, amount, reason, adminId }) {
  const refundId = `ref-${randomUUID()}`;
  const refund = {
    id: refundId,
    order_id: orderId,
    amount: Number(amount || 0),
    reason: reason || '',
    status: 'processed',
    admin_id: adminId || null,
    created_at: new Date().toISOString()
  };
  refundsById.set(refundId, refund);
  persistRefund(refund).catch(err => console.error('[Persist] Refund save error:', err.message));
  return refund;
}

async function persistRefund(refund) {
  if (!isDatabaseAvailable()) return;
  try {
    await query(
      `INSERT INTO payment_records
        (payment_id, order_id, amount, currency, provider, status, metadata, created_at)
       VALUES ($1, $2, $3, 'CAD', 'refund', $4, $5::jsonb, $6)
       ON CONFLICT (payment_id) DO UPDATE
       SET status = EXCLUDED.status`,
      [refund.id, refund.order_id, -Math.abs(refund.amount), refund.status,
       JSON.stringify({ reason: refund.reason, admin_id: refund.admin_id, type: 'refund' }),
       refund.created_at]
    );
  } catch (err) {
    console.error('[Persist] Refund DB error:', err.message);
  }
}

export function listRefundsForOrder(orderId) {
  return Array.from(refundsById.values())
    .filter(r => r.order_id === orderId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ── Login lockout helpers ────────────────────────────────────────────

export async function isAccountLocked(email) {
  const key = String(email || '').trim().toLowerCase();
  const entry = loginAttempts.get(key);
  if (entry) {
    if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
    if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
      loginAttempts.delete(key);
    }
  }
  // Fall back to DB if no in-memory entry
  if (!entry && isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT attempt_count, locked_until FROM login_lockouts WHERE email = $1',
        [key]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        if (row.locked_until && new Date(row.locked_until) > new Date()) {
          loginAttempts.set(key, { count: row.attempt_count, lockedUntil: new Date(row.locked_until).getTime() });
          return true;
        }
        // Lock expired — clean up
        if (row.locked_until && new Date(row.locked_until) <= new Date()) {
          query('DELETE FROM login_lockouts WHERE email = $1', [key]).catch(() => {});
        }
      }
    } catch (err) {
      console.error('[Lockout] DB check error:', err.message);
    }
  }
  return false;
}

export function recordLoginAttempt(email, success) {
  const key = String(email || '').trim().toLowerCase();
  if (success) {
    loginAttempts.delete(key);
    if (isDatabaseAvailable()) {
      query('DELETE FROM login_lockouts WHERE email = $1', [key])
        .catch(err => console.error('[Lockout] DB clear error:', err.message));
    }
    return;
  }
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`[Lockout] Account ${key} locked until ${new Date(entry.lockedUntil).toISOString()}`);
  }
  loginAttempts.set(key, entry);
  // Persist to DB
  if (isDatabaseAvailable()) {
    query(
      `INSERT INTO login_lockouts (email, attempt_count, locked_until, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (email) DO UPDATE
       SET attempt_count = $2, locked_until = $3, updated_at = NOW()`,
      [key, entry.count, entry.lockedUntil ? new Date(entry.lockedUntil) : null]
    ).catch(err => console.error('[Lockout] DB persist error:', err.message));
  }
}

export function resetLoginAttempts(email) {
  const key = String(email || '').trim().toLowerCase();
  loginAttempts.delete(key);
  if (isDatabaseAvailable()) {
    query('DELETE FROM login_lockouts WHERE email = $1', [key])
      .catch(err => console.error('[Lockout] DB reset error:', err.message));
  }
}

// ── Buyer helpers ────────────────────────────────────────────────────

export function getBuyerByEmail(email) {
  const key = String(email || '').trim().toLowerCase();
  const buyer = buyersByEmail.get(key);
  return buyer || null;
}

export async function updateBuyerPassword(buyerId, newPassword) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;
  buyer.passwordHash = await bcrypt.hash(String(newPassword || ''), 10);
  await persistBuyer(buyer);
  return sanitizeBuyer(buyer);
}

// ── Password-reset token helpers ─────────────────────────────────────

export function createPasswordResetToken(email) {
  const key = String(email || '').trim().toLowerCase();
  const token = randomUUID();
  const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour
  passwordResetTokens.set(token, { email: key, expiresAt });
  return token;
}

export function validatePasswordResetToken(token) {
  const entry = passwordResetTokens.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    passwordResetTokens.delete(token);
    return null;
  }
  return entry.email;
}

export function consumePasswordResetToken(token) {
  const email = validatePasswordResetToken(token);
  if (email) passwordResetTokens.delete(token);
  return email;
}

// ── Order audit trail ────────────────────────────────────────────────

export function logOrderEvent(orderId, action, details = {}) {
  const event = {
    order_id: orderId,
    action,
    details,
    timestamp: new Date().toISOString()
  };
  orderAuditLog.push(event);
  // Keep last 10 000 events in memory
  if (orderAuditLog.length > 10000) orderAuditLog.splice(0, orderAuditLog.length - 10000);
  console.log(`[Audit] ${orderId} → ${action}`, JSON.stringify(details));

  // Persist to audit_log DB table (fire-and-forget with error logging)
  persistAuditEntry(event).catch(err => console.error('[Persist] Audit log error:', err.message));

  return event;
}

async function persistAuditEntry(event) {
  if (!isDatabaseAvailable()) return;
  await query(
    `INSERT INTO audit_log (event_type, entity_type, entity_id, actor, details, created_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [event.action, 'order', event.order_id, event.details?.actor || null,
     JSON.stringify(event.details), event.timestamp]
  );
}

export async function getOrderAuditLog(orderId) {
  // Try DB first for complete history
  if (isDatabaseAvailable()) {
    try {
      const params = orderId ? [orderId] : [];
      const where = orderId ? 'WHERE entity_id = $1' : '';
      const result = await query(
        `SELECT event_type, entity_type, entity_id, actor, details, created_at FROM audit_log ${where} ORDER BY created_at DESC LIMIT 1000`,
        params
      );
      if (result.rows.length > 0) {
        return result.rows.map(row => ({
          order_id: row.entity_id,
          action: row.event_type,
          details: row.details || {},
          timestamp: new Date(row.created_at).toISOString()
        }));
      }
    } catch (err) {
      console.error('[Audit] DB query error:', err.message);
    }
  }
  // Fallback to in-memory
  if (orderId) return orderAuditLog.filter(e => e.order_id === orderId);
  return [...orderAuditLog];
}

export async function getOrderById(orderId, options = {}) {
  if (isDatabaseAvailable()) {
    try {
      const result = await query('SELECT order_data FROM wholesale_orders WHERE master_order_id = $1', [orderId]);
      const row = result.rows[0];
      if (row) return row.order_data;
    } catch (err) {
      console.error('[wholesaleStore] DB query error (getOrderById):', err.message);
    }
  }
  // Always check in-memory as fallback
  const order = ordersById.get(orderId) || null;
  if (order) return order;
  if (options.includeArchived) {
    const archived = await loadArchivedOrders({ orderId });
    return archived[0] || null;
  }
  return null;
}

export async function saveOrder(order) {
  await persistOrder(order);
  return order;
}

async function persistOrder(order) {
  if (!isDatabaseAvailable()) return;
  const now = new Date().toISOString();
  const createdAt = order.created_at || now;
  const buyerEmail = order.buyer_account?.email || null;
  await query(
    `INSERT INTO wholesale_orders
      (master_order_id, buyer_id, buyer_email, status, order_data, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     ON CONFLICT (master_order_id) DO UPDATE
     SET buyer_id = EXCLUDED.buyer_id,
         buyer_email = EXCLUDED.buyer_email,
         status = EXCLUDED.status,
         order_data = EXCLUDED.order_data,
         updated_at = EXCLUDED.updated_at`,
    [order.master_order_id, order.buyer_id, buyerEmail, order.status, JSON.stringify(order), createdAt, now]
  );
}

async function runArchiveIfNeeded() {
  if (!isDatabaseAvailable()) return;
  const now = Date.now();
  if (now - lastArchiveRun < ARCHIVE_INTERVAL_MS) return;
  lastArchiveRun = now;
  await archiveOldOrders();
}

async function archiveOldOrders() {
  const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const result = await query(
    'SELECT master_order_id, buyer_id, buyer_email, status, created_at, updated_at, order_data FROM wholesale_orders WHERE created_at < $1 ORDER BY created_at ASC',
    [cutoff]
  );
  if (!result.rows.length) return;
  await appendArchiveRows(result.rows);
  const ids = result.rows.map((row) => row.master_order_id);
  await query('DELETE FROM wholesale_orders WHERE master_order_id = ANY($1)', [ids]);
}

function mergeOrders(primary, secondary) {
  const seen = new Set(primary.map((o) => o.master_order_id));
  const merged = [...primary];
  for (const order of secondary) {
    if (!seen.has(order.master_order_id)) merged.push(order);
  }
  return merged.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function appendArchiveRows(rows) {
  await fs.mkdir(path.dirname(ARCHIVE_PATH), { recursive: true });
  let hasFile = true;
  try {
    await fs.access(ARCHIVE_PATH);
  } catch (_) {
    hasFile = false;
  }

  const header = 'master_order_id,buyer_id,buyer_email,status,created_at,updated_at,order_json\n';
  const lines = rows.map((row) => {
    const orderJson = JSON.stringify(row.order_data || {});
    return [
      row.master_order_id,
      row.buyer_id,
      row.buyer_email || '',
      row.status || '',
      new Date(row.created_at).toISOString(),
      new Date(row.updated_at).toISOString(),
      orderJson
    ].map(csvEscape).join(',');
  }).join('\n') + '\n';

  if (!hasFile) {
    await fs.writeFile(ARCHIVE_PATH, header + lines, 'utf8');
    return;
  }
  await fs.appendFile(ARCHIVE_PATH, lines, 'utf8');
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (str.includes('"') || str.includes(',') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function loadArchivedOrders(filters = {}) {
  let content = '';
  try {
    content = await fs.readFile(ARCHIVE_PATH, 'utf8');
  } catch (_) {
    return [];
  }

  const lines = content.split(/\r?\n/).filter(Boolean);
  if (lines.length <= 1) return [];
  const rows = lines.slice(1).map(parseCsvLine).filter(Boolean);

  let orders = rows.map((row) => {
    const orderJson = row[6] ? safeJsonParse(row[6]) : null;
    return orderJson || null;
  }).filter(Boolean);

  if (filters.orderId) {
    orders = orders.filter((o) => o.master_order_id === filters.orderId);
  }
  if (filters.buyerId) {
    orders = orders.filter((o) => o.buyer_id === filters.buyerId);
  }
  return orders;
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === ',') {
      values.push(current);
      current = '';
    } else if (char === '"') {
      inQuotes = true;
    } else {
      current += char;
    }
  }
  values.push(current);
  return values.length >= 7 ? values : null;
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

/**
 * Phase 2 Task 2.8: Analyze wholesale demand patterns by crop.
 * Returns a map of crop name → { network_total_qty, network_order_count, network_trend }
 * Compares last 30 days to prior 30 days for trend computation.
 * Used by AI pusher to populate demand_signals in network intelligence.
 */
export async function analyzeDemandPatterns() {
  const allOrders = await listAllOrders();
  const now = new Date();
  const cutoff60 = new Date(now); cutoff60.setDate(cutoff60.getDate() - 60);
  const cutoff30 = new Date(now); cutoff30.setDate(cutoff30.getDate() - 30);

  const completedStatuses = new Set(['completed', 'picked_up', 'payment_captured', 'confirmed', 'delivered']);
  const recent = allOrders.filter(o => {
    const s = (o.status || '').toLowerCase();
    const d = new Date(o.created_at || o.order_date || 0);
    return completedStatuses.has(s) && d >= cutoff60;
  });

  const demand = {};

  const processItem = (item, orderDate) => {
    const name = (item.product_name || item.crop_name || item.name || '').toLowerCase().trim();
    if (!name) return;
    if (!demand[name]) demand[name] = { network_total_qty: 0, network_order_count: 0, recent30: 0, prior30: 0, network_trend: 'stable' };
    const qty = item.quantity || item.qty || 1;
    demand[name].network_total_qty += qty;
    demand[name].network_order_count += 1;
    if (orderDate >= cutoff30) {
      demand[name].recent30 += qty;
    } else {
      demand[name].prior30 += qty;
    }
  };

  for (const order of recent) {
    const orderDate = new Date(order.created_at || order.order_date || 0);
    for (const item of order.items || []) {
      processItem(item, orderDate);
    }
    if (order.sub_orders || order.farm_sub_orders) {
      for (const sub of (order.sub_orders || order.farm_sub_orders || [])) {
        for (const item of sub.items || []) {
          processItem(item, orderDate);
        }
      }
    }
  }

  // Compute trend from 30-day comparison
  for (const [, data] of Object.entries(demand)) {
    if (data.prior30 === 0 && data.recent30 > 0) data.network_trend = 'increasing';
    else if (data.prior30 > 0 && data.recent30 === 0) data.network_trend = 'decreasing';
    else if (data.prior30 > 0) {
      const ratio = data.recent30 / data.prior30;
      if (ratio >= 1.25) data.network_trend = 'increasing';
      else if (ratio <= 0.75) data.network_trend = 'decreasing';
      else data.network_trend = 'stable';
    }
    // Clean up internal fields
    delete data.recent30;
    delete data.prior30;
  }

  return demand;
}
