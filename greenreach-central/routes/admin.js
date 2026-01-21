import express from 'express';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import adminAuthRoutes from './admin-auth.js';

const router = express.Router();

// Mount authentication routes (no auth required for login)
router.use('/auth', adminAuthRoutes);

// All routes below require admin authentication
router.use(adminAuthMiddleware);

/**
 * GET /api/admin/farms
 * Get list of all farms in the network
 */
router.get('/farms', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, region, search } = req.query;
        
        // Mock data for now - in production this would query the database
        const mockFarms = [
            {
                id: 1,
                name: 'GreenReach Farms',
                location: { city: 'Brooklyn', state: 'NY', zip: '11201' },
                status: 'active',
                type: 'Vertical Farm',
                capacity: '10,000 heads/week',
                certifications: ['Organic', 'GAP'],
                lastSync: new Date().toISOString(),
                health: 'good'
            }
        ];
        
        res.json({
            success: true,
            farms: mockFarms,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: mockFarms.length,
                pages: 1
            }
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farms:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farms',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/kpis
 * Get platform-wide KPIs
 */
router.get('/kpis', async (req, res) => {
    try {
        res.json({
            success: true,
            kpis: {
                totalFarms: 1,
                activeFarms: 1,
                totalOrders: 0,
                revenue: 0,
                alerts: 0
            }
        });
    } catch (error) {
        console.error('[Admin API] Error fetching KPIs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch KPIs',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/alerts
 * Get platform-wide alerts from all farms
 * 
 * ALERTS vs ANOMALY DETECTION:
 * 
 * ALERTS:
 * - Rule-based thresholds (e.g., temp > 30°C = alert)
 * - Immediate actionable notifications
 * - Triggered by specific conditions being met
 * - Require human acknowledgment and resolution
 * - Examples: Temperature too high, device offline, harvest deadline missed
 * - Sources: Equipment sensors, system monitors, business logic
 * 
 * ANOMALY DETECTION:
 * - ML-based pattern recognition (Isolation Forest algorithm)
 * - Identifies unusual patterns that may not trigger rule-based alerts
 * - Learns from historical data to detect deviations from normal behavior
 * - May or may not require immediate action (investigative)
 * - Examples: Unusual energy consumption pattern, gradual environmental drift
 * - Sources: ML models analyzing 24h+ rolling windows of data
 * 
 * Both systems complement each other:
 * - Alerts catch known problems (reactive)
 * - Anomaly detection catches unknown/emerging problems (proactive)
 */
router.get('/alerts', async (req, res) => {
    try {
        const { severity, status, farm_id, limit = 50 } = req.query;
        
        // Collect alerts from multiple sources
        const alerts = [];
        const now = new Date();
        
        // 1. Farm environmental alerts (temperature, humidity, CO2)
        // TODO: Query actual farm telemetry for threshold violations
        
        // 2. Device health alerts (offline devices, sensor failures)
        // TODO: Query device registry for offline/unhealthy devices
        
        // 3. Business logic alerts (missed deadlines, inventory issues)
        // TODO: Query order fulfillment and harvest schedules
        
        // 4. System alerts (network connectivity, API errors)
        // TODO: Query system health monitoring
        
        // For now, return structure ready for live data
        const mockAlerts = [
            {
                id: 'alert-001',
                timestamp: now.toISOString(),
                farm_id: 'GR-00001',
                farm_name: 'Farm Alpha',
                severity: 'critical',
                type: 'environmental',
                category: 'temperature',
                message: 'Temperature exceeds threshold in Zone 2',
                value: '32.5°C',
                threshold: '30°C',
                status: 'active',
                acknowledged: false,
                acknowledged_by: null,
                acknowledged_at: null,
                resolved: false,
                resolved_at: null,
                source: 'zone-2-temp-sensor',
                context: {
                    room_id: 'room-a',
                    zone_id: 'zone-2',
                    device_id: 'temp-sensor-zone-2'
                }
            },
            {
                id: 'alert-002',
                timestamp: new Date(now.getTime() - 3600000).toISOString(),
                farm_id: 'GR-00001',
                farm_name: 'Farm Alpha',
                severity: 'warning',
                type: 'device',
                category: 'offline',
                message: 'Humidity sensor not responding',
                value: 'offline',
                threshold: 'online',
                status: 'acknowledged',
                acknowledged: true,
                acknowledged_by: 'admin',
                acknowledged_at: new Date(now.getTime() - 1800000).toISOString(),
                resolved: false,
                resolved_at: null,
                source: 'zone-1-humidity-sensor',
                context: {
                    room_id: 'room-a',
                    zone_id: 'zone-1',
                    device_id: 'humidity-sensor-zone-1'
                }
            },
            {
                id: 'alert-003',
                timestamp: new Date(now.getTime() - 7200000).toISOString(),
                farm_id: 'GR-00002',
                farm_name: 'Farm Beta',
                severity: 'warning',
                type: 'business',
                category: 'harvest_deadline',
                message: 'Harvest verification deadline approaching',
                value: '2 hours remaining',
                threshold: '24 hours notice',
                status: 'resolved',
                acknowledged: true,
                acknowledged_by: 'operator',
                acknowledged_at: new Date(now.getTime() - 5400000).toISOString(),
                resolved: true,
                resolved_at: new Date(now.getTime() - 3600000).toISOString(),
                source: 'harvest-scheduler',
                context: {
                    order_id: 'ORD-12345',
                    harvest_date: new Date(now.getTime() + 7200000).toISOString()
                }
            }
        ];
        
        // Filter alerts based on query parameters
        let filteredAlerts = mockAlerts;
        
        if (severity) {
            filteredAlerts = filteredAlerts.filter(a => a.severity === severity);
        }
        
        if (status) {
            filteredAlerts = filteredAlerts.filter(a => a.status === status);
        }
        
        if (farm_id) {
            filteredAlerts = filteredAlerts.filter(a => a.farm_id === farm_id);
        }
        
        // Calculate summary stats
        const summary = {
            total: filteredAlerts.length,
            active: filteredAlerts.filter(a => a.status === 'active').length,
            acknowledged: filteredAlerts.filter(a => a.acknowledged && !a.resolved).length,
            resolved: filteredAlerts.filter(a => a.resolved).length,
            critical: filteredAlerts.filter(a => a.severity === 'critical').length,
            warning: filteredAlerts.filter(a => a.severity === 'warning').length,
            info: filteredAlerts.filter(a => a.severity === 'info').length
        };
        
        res.json({
            success: true,
            alerts: filteredAlerts.slice(0, limit),
            summary,
            timestamp: now.toISOString(),
            demo: true
        });
    } catch (error) {
        console.error('[Admin API] Error fetching alerts:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch alerts',
            message: error.message
        });
    }
});

export default router;
