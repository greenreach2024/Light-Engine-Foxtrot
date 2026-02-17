import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { isDatabaseAvailable, query } from '../config/database.js';

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

  persistBuyer(buyer).catch(() => {});

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
    // If table doesn't exist yet, silently skip
    if (!String(err?.message || '').includes('relation')) {
      console.warn('[BuyerPersist] Error:', err.message);
    }
  }
}

export async function loadBuyersFromDb() {
  if (!isDatabaseAvailable()) return;
  try {
    const result = await query('SELECT * FROM wholesale_buyers ORDER BY created_at ASC');
    for (const row of result.rows) {
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
    }
    console.log(`[BuyerPersist] Loaded ${result.rows.length} buyers from DB`);
  } catch (err) {
    if (!String(err?.message || '').includes('relation')) {
      console.warn('[BuyerPersist] Load failed:', err.message);
    }
  }
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

  persistBuyer(buyer).catch(() => {});
  return sanitizeBuyer(buyer);
}

export function deactivateBuyer(buyerId) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;
  buyer.status = 'deactivated';
  persistBuyer(buyer).catch(() => {});
  return sanitizeBuyer(buyer);
}

export function reactivateBuyer(buyerId) {
  const buyer = buyersById.get(buyerId);
  if (!buyer) return null;
  buyer.status = 'active';
  persistBuyer(buyer).catch(() => {});
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
}

export function isTokenBlacklisted(token) {
  return tokenBlacklist.has(token);
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

  persistOrder(order).catch(() => {});
  runArchiveIfNeeded().catch(() => {});

  return order;
}

export async function listOrdersForBuyer(buyerId, options = {}) {
  await runArchiveIfNeeded().catch(() => {});
  let dbOrders = [];
  if (isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT order_data FROM wholesale_orders WHERE buyer_id = $1 ORDER BY created_at DESC',
        [buyerId]
      );
      dbOrders = result.rows.map((row) => row.order_data);
    } catch {
      // DB query failed — fall through to memory
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
  await runArchiveIfNeeded().catch(() => {});
  let dbOrders = [];
  if (isDatabaseAvailable()) {
    try {
      const result = await query(
        'SELECT order_data FROM wholesale_orders ORDER BY created_at DESC'
      );
      dbOrders = result.rows.map((row) => row.order_data);
    } catch {
      // DB query failed — fall through to memory
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

  await persistOrder(order).catch(() => {});

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
    broker_fee_amount: totals.broker_fee_total,
    net_to_farms_total: totals.net_to_farms_total,
    split,
    created_at: new Date().toISOString()
  };
  paymentsById.set(paymentId, payment);
  return payment;
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
  return refund;
}

export function listRefundsForOrder(orderId) {
  return Array.from(refundsById.values())
    .filter(r => r.order_id === orderId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// ── Login lockout helpers ────────────────────────────────────────────

export function isAccountLocked(email) {
  const key = String(email || '').trim().toLowerCase();
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (entry.lockedUntil && Date.now() < entry.lockedUntil) return true;
  // Lock expired — reset
  if (entry.lockedUntil && Date.now() >= entry.lockedUntil) {
    loginAttempts.delete(key);
  }
  return false;
}

export function recordLoginAttempt(email, success) {
  const key = String(email || '').trim().toLowerCase();
  if (success) {
    loginAttempts.delete(key);
    return;
  }
  const entry = loginAttempts.get(key) || { count: 0, lockedUntil: null };
  entry.count += 1;
  if (entry.count >= MAX_LOGIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + LOCKOUT_DURATION_MS;
    console.warn(`[Lockout] Account ${key} locked until ${new Date(entry.lockedUntil).toISOString()}`);
  }
  loginAttempts.set(key, entry);
}

export function resetLoginAttempts(email) {
  loginAttempts.delete(String(email || '').trim().toLowerCase());
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
  persistBuyer(buyer).catch(() => {});
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
  return event;
}

export function getOrderAuditLog(orderId) {
  if (orderId) return orderAuditLog.filter(e => e.order_id === orderId);
  return [...orderAuditLog];
}

export async function getOrderById(orderId, options = {}) {
  if (isDatabaseAvailable()) {
    try {
      const result = await query('SELECT order_data FROM wholesale_orders WHERE master_order_id = $1', [orderId]);
      const row = result.rows[0];
      if (row) return row.order_data;
    } catch {
      // DB query failed — fall through to memory
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
  } catch {
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
  } catch {
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
  } catch {
    return null;
  }
}
