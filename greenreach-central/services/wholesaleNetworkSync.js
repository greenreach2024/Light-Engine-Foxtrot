/**
 * Wholesale Network Sync Service
 * Periodically refreshes aggregated inventory from all registered farms
 * 
 * Config env vars:
 *   NETWORK_SYNC_INTERVAL_MS  – refresh interval (default 300000 = 5 min)
 */
import { refreshNetworkInventory } from './wholesaleNetworkAggregator.js';
import logger from '../utils/logger.js';

const SYNC_INTERVAL = parseInt(process.env.NETWORK_SYNC_INTERVAL_MS) || 5 * 60 * 1000;
let syncTimer = null;

export function startWholesaleNetworkSync(app) {
  logger.info(`[NetworkSync] Starting wholesale network sync (interval: ${SYNC_INTERVAL / 1000}s)`);

  // Initial refresh after 15 seconds (let farms register first)
  setTimeout(async () => {
    try {
      await refreshNetworkInventory();
    } catch (err) {
      logger.warn('[NetworkSync] Initial refresh failed:', err.message);
    }
  }, 15000);

  // Periodic refresh
  syncTimer = setInterval(async () => {
    try {
      await refreshNetworkInventory();
    } catch (err) {
      logger.warn('[NetworkSync] Periodic refresh failed:', err.message);
    }
  }, SYNC_INTERVAL);

  // Expose stop function for graceful shutdown
  if (app) {
    app.locals.stopWholesaleNetworkSync = () => {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
        logger.info('[NetworkSync] Stopped');
      }
    };
  }

  return Promise.resolve();
}
