import { query } from '../config/database.js';
import logger from '../utils/logger.js';

export function startHealthCheckService(app) {
  const interval = parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000;
  
  setInterval(async () => {
    try {
      // Check for offline farms (no heartbeat in last 10 minutes)
      const offlineFarms = await query(`
        SELECT farm_id, name, last_heartbeat
        FROM farms
        WHERE status = 'active'
          AND last_heartbeat < NOW() - INTERVAL '10 minutes'
      `);

      if (offlineFarms.rows.length > 0) {
        logger.warn('Offline farms detected', {
          count: offlineFarms.rows.length,
          farms: offlineFarms.rows.map(f => ({
            id: f.farm_id,
            name: f.name,
            lastSeen: f.last_heartbeat
          }))
        });

        // Update health status to offline
        for (const farm of offlineFarms.rows) {
          await query(`
            UPDATE farm_health
            SET overall_status = 'offline'
            WHERE farm_id = $1
          `, [farm.farm_id]);
        }

        // Broadcast to WebSocket clients
        if (app.locals.wss) {
          app.locals.wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send(JSON.stringify({
                type: 'farms_offline',
                farms: offlineFarms.rows,
                timestamp: new Date().toISOString()
              }));
            }
          });
        }
      }

    } catch (error) {
      logger.error('Health check service error', { error: error.message });
    }
  }, interval);

  logger.info('Health check service started', { intervalMs: interval });
}
