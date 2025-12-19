import { query } from '../config/database.js';
import logger from '../utils/logger.js';

export function startSyncMonitor(app) {
  const interval = parseInt(process.env.SYNC_INTERVAL_MS) || 300000; // 5 minutes
  
  setInterval(async () => {
    try {
      // Check for farms that haven't synced recently
      const staleFarms = await query(`
        SELECT farm_id, name, last_sync
        FROM farms
        WHERE status = 'active'
          AND sync_enabled = true
          AND (last_sync IS NULL OR last_sync < NOW() - INTERVAL '15 minutes')
      `);

      if (staleFarms.rows.length > 0) {
        logger.warn('Farms with stale sync detected', {
          count: staleFarms.rows.length,
          farms: staleFarms.rows.map(f => ({
            id: f.farm_id,
            name: f.name,
            lastSync: f.last_sync
          }))
        });

        // Create alerts for stale syncs
        for (const farm of staleFarms.rows) {
          await query(`
            INSERT INTO farm_alerts (
              farm_id, alert_type, severity, title, message,
              source, status
            ) VALUES ($1, 'system', 'warning', 'Sync Delayed', $2, 'sync_monitor', 'active')
            ON CONFLICT DO NOTHING
          `, [
            farm.farm_id,
            `Farm has not synced data in over 15 minutes. Last sync: ${farm.last_sync || 'never'}`
          ]);
        }
      }

    } catch (error) {
      logger.error('Sync monitor service error', { error: error.message });
    }
  }, interval);

  logger.info('Sync monitor service started', { intervalMs: interval });
}
