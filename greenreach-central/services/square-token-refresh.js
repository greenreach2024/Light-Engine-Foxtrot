/**
 * Square Token Auto-Refresh Scheduler
 * Periodically checks all farms Square OAuth tokens and refreshes those expiring soon.
 * Runs on Central server boot.
 */
import logger from '../utils/logger.js';

const SQUARE_APP_ID = process.env.SQUARE_APP_ID || process.env.SQUARE_APPLICATION_ID || null;
const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET || process.env.SQUARE_APPLICATION_SECRET || null;
const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
const SQUARE_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

// Refresh tokens expiring within 7 days
const REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
// Check every 12 hours
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

async function refreshSquareToken(farmId, record) {
  try {
    const response = await fetch(`${SQUARE_BASE}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        grant_type: 'refresh_token',
        refresh_token: record.refresh_token,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) {
      logger.warn(`[SquareRefresh] Failed to refresh token for farm ${farmId}: ${data?.message || response.status}`);
      return false;
    }

    // Persist updated tokens via farmStore
    const { farmStore } = await import('../lib/farm-data-store.js');
    const updated = {
      ...record,
      access_token: data.access_token,
      refresh_token: data.refresh_token || record.refresh_token,
      expires_at: data.expires_at || record.expires_at,
      updated_at: new Date().toISOString(),
    };
    await farmStore.set(farmId, 'square_oauth', updated);
    logger.info(`[SquareRefresh] Successfully refreshed token for farm ${farmId}`);
    return true;
  } catch (err) {
    logger.error(`[SquareRefresh] Error refreshing farm ${farmId}:`, err.message);
    return false;
  }
}

async function checkAndRefreshAll() {
  if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
    return;
  }

  try {
    // Query farm_data table directly for all square_oauth entries
    const { query } = await import('../config/database.js');
    const result = await query(
      `SELECT farm_id, data FROM farm_data WHERE data_type = 'square_oauth' AND data IS NOT NULL`
    ).catch(() => ({ rows: [] }));

    if (!result.rows || result.rows.length === 0) return;

    const now = Date.now();
    let refreshed = 0;
    let skipped = 0;

    for (const row of result.rows) {
      try {
        const record = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
        if (!record?.refresh_token) continue;

        const expiresAt = record.expires_at ? new Date(record.expires_at).getTime() : 0;
        const timeUntilExpiry = expiresAt - now;

        if (expiresAt === 0 || timeUntilExpiry < REFRESH_THRESHOLD_MS) {
          const success = await refreshSquareToken(row.farm_id, record);
          if (success) refreshed++;
        } else {
          skipped++;
        }
      } catch (err) {
        logger.warn(`[SquareRefresh] Error checking farm ${row.farm_id}:`, err.message);
      }
    }

    if (refreshed > 0 || result.rows.length > 0) {
      logger.info(`[SquareRefresh] Check complete: ${refreshed} refreshed, ${skipped} still valid, ${result.rows.length} total`);
    }
  } catch (err) {
    logger.error('[SquareRefresh] Scheduler error:', err.message);
  }
}

let intervalHandle = null;

export function startSquareTokenRefreshScheduler() {
  if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
    logger.info('[SquareRefresh] Square not configured -- scheduler disabled');
    return;
  }

  logger.info('[SquareRefresh] Starting token auto-refresh scheduler (every 12h)');

  // Initial check after 60 seconds (let boot settle)
  setTimeout(() => {
    checkAndRefreshAll().catch(err => logger.error('[SquareRefresh] Initial check error:', err.message));
  }, 60_000);

  // Then every 12 hours
  intervalHandle = setInterval(() => {
    checkAndRefreshAll().catch(err => logger.error('[SquareRefresh] Periodic check error:', err.message));
  }, CHECK_INTERVAL_MS);

  intervalHandle.unref();
}

export function stopSquareTokenRefreshScheduler() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}
