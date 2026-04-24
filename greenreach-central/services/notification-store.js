/**
 * Notification Store — In-app notification persistence for E.V.I.E.
 * =================================================================
 * Mirrors email notifications as in-app messages so growers always
 * see order updates, alerts, and system messages even when email
 * delivery is unavailable.
 *
 * Storage: PostgreSQL farm_notifications table (auto-created).
 * Consumers: GET /api/assistant/notifications (EVIE frontend polling).
 */

import { query, isDatabaseAvailable } from '../config/database.js';

// ── Category and severity contracts ─────────────────────────────────
// Central enum of supported notification categories. Unknown categories are
// logged and coerced to 'general' to keep per-category routing/unsubscribe
// behaviour well-defined.
export const NOTIFICATION_CATEGORIES = Object.freeze([
  'general',
  'system',
  'admin',
  'sensor_alert',
  'harvest',
  'wholesale_order',
  'wholesale_sample',
  'sample_request',
  'payment',
  'delivery',
  'grant',
  'assistant'
]);

export const NOTIFICATION_SEVERITIES = Object.freeze(['info', 'warning', 'critical']);

function normalizeCategory(raw) {
  const value = (raw == null ? '' : String(raw)).trim().toLowerCase();
  if (!value) return 'general';
  if (NOTIFICATION_CATEGORIES.includes(value)) return value;
  console.warn(`[NotificationStore] Unknown notification category "${raw}" — coercing to "general". Allowed: ${NOTIFICATION_CATEGORIES.join(', ')}`);
  return 'general';
}

function normalizeSeverity(raw) {
  const value = (raw == null ? '' : String(raw)).trim().toLowerCase();
  if (!value) return 'info';
  if (NOTIFICATION_SEVERITIES.includes(value)) return value;
  console.warn(`[NotificationStore] Unknown notification severity "${raw}" — coercing to "info". Allowed: ${NOTIFICATION_SEVERITIES.join(', ')}`);
  return 'info';
}

// ── Schema bootstrap ────────────────────────────────────────────────
let tableReady = false;

async function ensureTable() {
  if (tableReady) return true;
  if (!isDatabaseAvailable()) return false;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS farm_notifications (
        id            SERIAL PRIMARY KEY,
        farm_id       TEXT NOT NULL,
        category      TEXT NOT NULL DEFAULT 'general',
        title         TEXT NOT NULL,
        body          TEXT,
        severity      TEXT NOT NULL DEFAULT 'info',
        source        TEXT,
        read          BOOLEAN NOT NULL DEFAULT FALSE,
        action_url    TEXT,
        action_label  TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await query(`CREATE INDEX IF NOT EXISTS idx_farm_notif_farm ON farm_notifications(farm_id, read, created_at DESC)`);
    // Add action columns if missing (existing deployments)
    await query(`ALTER TABLE farm_notifications ADD COLUMN IF NOT EXISTS action_url TEXT`).catch(() => {});
    await query(`ALTER TABLE farm_notifications ADD COLUMN IF NOT EXISTS action_label TEXT`).catch(() => {});
    tableReady = true;
    return true;
  } catch (err) {
    console.error('[NotificationStore] Table bootstrap failed:', err.message);
    return false;
  }
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Push a notification for a farm.
 * @param {string} farmId
 * @param {{ category?: string, title: string, body?: string, severity?: string, source?: string }} notification
 */
async function pushNotification(farmId, notification) {
  if (!notification || typeof notification !== 'object') {
    console.warn('[NotificationStore] Invalid notification payload — dropped');
    return null;
  }
  if (!notification.title || typeof notification.title !== 'string') {
    console.warn('[NotificationStore] Notification missing required title — dropped');
    return null;
  }
  if (!await ensureTable()) {
    console.warn('[NotificationStore] DB unavailable — notification dropped:', notification.title);
    return null;
  }
  const category = normalizeCategory(notification.category);
  const severity = normalizeSeverity(notification.severity);
  try {
    const result = await query(
      `INSERT INTO farm_notifications (farm_id, category, title, body, severity, source, action_url, action_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, created_at`,
      [
        farmId,
        category,
        notification.title,
        notification.body || null,
        severity,
        notification.source || null,
        notification.action_url || null,
        notification.action_label || null
      ]
    );
    console.log(`[NotificationStore] Pushed notification for farm ${farmId} [${category}/${severity}]: ${notification.title}`);
    return result.rows[0];
  } catch (err) {
    console.error('[NotificationStore] Push failed:', err.message);
    return null;
  }
}

/**
 * Get notifications for a farm (newest first).
 * @param {string} farmId
 * @param {{ unreadOnly?: boolean, limit?: number, offset?: number }} options
 */
async function getNotifications(farmId, options = {}) {
  if (!await ensureTable()) return { notifications: [], unread_count: 0 };
  const { unreadOnly = false, limit = 30, offset = 0 } = options;
  try {
    const conditions = ['farm_id = $1'];
    const params = [farmId];
    let idx = 2;
    if (unreadOnly) {
      conditions.push(`read = FALSE`);
    }
    const where = conditions.join(' AND ');

    const countResult = await query(
      `SELECT COUNT(*) AS cnt FROM farm_notifications WHERE farm_id = $1 AND read = FALSE`,
      [farmId]
    );
    const unreadCount = parseInt(countResult.rows[0]?.cnt || '0', 10);

    const rows = await query(
      `SELECT id, category, title, body, severity, source, read, action_url, action_label, created_at
       FROM farm_notifications
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );

    return { notifications: rows.rows, unread_count: unreadCount };
  } catch (err) {
    console.error('[NotificationStore] Fetch failed:', err.message);
    return { notifications: [], unread_count: 0 };
  }
}

/**
 * Mark a single notification as read.
 */
async function markRead(notificationId, farmId) {
  if (!await ensureTable()) return false;
  try {
    await query(
      `UPDATE farm_notifications SET read = TRUE WHERE id = $1 AND farm_id = $2`,
      [notificationId, farmId]
    );
    return true;
  } catch (err) {
    console.error('[NotificationStore] markRead failed:', err.message);
    return false;
  }
}

/**
 * Mark all notifications as read for a farm.
 */
async function markAllRead(farmId) {
  if (!await ensureTable()) return 0;
  try {
    const result = await query(
      `UPDATE farm_notifications SET read = TRUE WHERE farm_id = $1 AND read = FALSE RETURNING id`,
      [farmId]
    );
    return result.rows.length;
  } catch (err) {
    console.error('[NotificationStore] markAllRead failed:', err.message);
    return 0;
  }
}

/**
 * Get unread count for a farm (lightweight — used in /state polling).
 */
async function getUnreadCount(farmId) {
  if (!await ensureTable()) return 0;
  try {
    const result = await query(
      `SELECT COUNT(*) AS cnt FROM farm_notifications WHERE farm_id = $1 AND read = FALSE`,
      [farmId]
    );
    return parseInt(result.rows[0]?.cnt || '0', 10);
  } catch (err) {
    return 0;
  }
}

export default {
  pushNotification,
  getNotifications,
  markRead,
  markAllRead,
  getUnreadCount
};
