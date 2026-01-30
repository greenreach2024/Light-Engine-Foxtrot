import express from 'express';
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { adminAuthMiddleware } from '../middleware/adminAuth.js';
import adminAuthRoutes from './admin-auth.js';
import adminWholesaleRoutes from './admin-wholesale.js';
import adminRecipesRoutes from './admin-recipes.js';
import { query, isDatabaseAvailable } from '../config/database.js';

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RECIPES_DIR = path.join(__dirname, '../data/recipes-v2');

function normalizeRecipeName(name) {
    return String(name || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getRecipeCategory(name) {
    const lowerName = String(name || '').toLowerCase();
    if (lowerName.includes('basil') || lowerName.includes('cilantro') ||
        lowerName.includes('parsley') || lowerName.includes('thyme') ||
        lowerName.includes('oregano') || lowerName.includes('rosemary') ||
        lowerName.includes('sage') || lowerName.includes('dill') ||
        lowerName.includes('tarragon') || lowerName.includes('marjoram') ||
        lowerName.includes('mint') || lowerName.includes('chervil') ||
        lowerName.includes('lovage') || lowerName.includes('lemon balm')) {
        return 'Herbs';
    }
    if (lowerName.includes('lettuce') || lowerName.includes('arugula') ||
        lowerName.includes('spinach') || lowerName.includes('kale') ||
        lowerName.includes('chard') || lowerName.includes('endive') ||
        lowerName.includes('escarole') || lowerName.includes('frisée') ||
        lowerName.includes('romaine') || lowerName.includes('oakleaf') ||
        lowerName.includes('butterhead') || lowerName.includes('pak choi') ||
        lowerName.includes('mizuna') || lowerName.includes('tatsoi') ||
        lowerName.includes('komatsuna') || lowerName.includes('mustard') ||
        lowerName.includes('watercress') || lowerName.includes('sorrel')) {
        return 'Leafy Greens';
    }
    if (lowerName.includes('tomato') || lowerName.includes('boy') ||
        lowerName.includes('brandywine') || lowerName.includes('celebrity') ||
        lowerName.includes('heatmaster') || lowerName.includes('marzano') ||
        lowerName.includes('gold')) {
        return 'Tomatoes';
    }
    if (lowerName.includes('strawberry') || lowerName.includes('albion') ||
        lowerName.includes('chandler') || lowerName.includes('eversweet') ||
        lowerName.includes('mara') || lowerName.includes('monterey') ||
        lowerName.includes('ozark') || lowerName.includes('seascape') ||
        lowerName.includes('sequoia') || lowerName.includes('tribute') ||
        lowerName.includes('tristar') || lowerName.includes('fort laramie') ||
        lowerName.includes('jewel')) {
        return 'Berries';
    }
    return 'Vegetables';
}

async function parseRecipeCSV(filePath) {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    if (lines.length < 3) {
        throw new Error('Invalid recipe file format');
    }

    const tableName = lines[0].trim();
    const headers = lines[1].split(',').map(h => h.trim());
    const dataLines = lines.slice(2);

    const phases = dataLines.map(line => {
        const values = line.split(',').map(v => v.trim());
        const phase = {};
        headers.forEach((header, index) => {
            const value = values[index];
            if (value && !isNaN(value) && value !== '') {
                phase[header] = parseFloat(value);
            } else {
                phase[header] = value || '';
            }
        });
        return phase;
    });

    return {
        tableName,
        headers,
        phases,
        totalDays: dataLines.length
    };
}

function getAverageTemperature(schedule) {
    if (!Array.isArray(schedule) || schedule.length === 0) return null;
    const temps = schedule
        .map(day => day.temperature || day.tempC || day.afternoon_temp || day['Afternoon Temp (C)'])
        .map(temp => (typeof temp === 'string' ? parseFloat(temp) : temp))
        .filter(t => !Number.isNaN(t) && t > 0);
    if (temps.length === 0) return null;
    const sum = temps.reduce((a, b) => a + b, 0);
    return Math.round((sum / temps.length) * 10) / 10;
}

// Mount authentication routes (no auth required for login)
router.use('/auth', adminAuthRoutes);

// All routes below require admin authentication
router.use(adminAuthMiddleware);

// Mount wholesale admin routes
router.use('/wholesale', adminWholesaleRoutes);

// Mount recipes admin routes
router.use('/recipes', adminRecipesRoutes);

/**
 * DELETE /api/admin/farms/:farmId
 * Delete a farm (requires admin password confirmation)
 */
router.delete('/farms/:farmId', async (req, res) => {
    try {
        const farmId = req.params.farmId;
        const { password } = req.body || {};

        if (!farmId) {
            return res.status(400).json({ status: 'error', message: 'Farm ID is required' });
        }

        if (!password) {
            return res.status(400).json({ status: 'error', message: 'Admin password is required' });
        }

        const dbAvailable = await isDatabaseAvailable();
        if (!dbAvailable) {
            return res.status(503).json({ status: 'error', message: 'Database not available' });
        }

        const adminEmail = req.admin?.email;
        if (!adminEmail) {
            return res.status(401).json({ status: 'error', message: 'Admin session not found' });
        }

        const dbEnabled = String(process.env.DB_ENABLED || 'false').toLowerCase() === 'true';
        if (dbEnabled) {
            const adminResult = await query(
                'SELECT id, password_hash FROM admin_users WHERE email = $1',
                [adminEmail.toLowerCase()]
            );

            if (!adminResult.rows.length) {
                return res.status(401).json({ status: 'error', message: 'Admin account not found' });
            }

            const passwordMatch = await bcrypt.compare(password, adminResult.rows[0].password_hash);
            if (!passwordMatch) {
                return res.status(401).json({ status: 'error', message: 'Invalid admin password' });
            }
        } else {
            const FALLBACK_ADMIN = {
                email: 'info@greenreachfarms.com',
                password: 'Admin2025!'
            };

            if (adminEmail.toLowerCase() !== FALLBACK_ADMIN.email.toLowerCase() || password !== FALLBACK_ADMIN.password) {
                return res.status(401).json({ status: 'error', message: 'Invalid admin password' });
            }
        }

        const farmResult = await query('SELECT farm_id FROM farms WHERE farm_id = $1', [farmId]);
        if (!farmResult.rows.length) {
            return res.status(404).json({ status: 'error', message: 'Farm not found' });
        }

        const deleted = await query('DELETE FROM farms WHERE farm_id = $1 RETURNING farm_id', [farmId]);

        return res.json({
            status: 'success',
            deleted: { farms: deleted.rowCount },
            farmIds: deleted.rows.map(row => row.farm_id)
        });
    } catch (error) {
        console.error('[Admin API] Error deleting farm:', error);
        return res.status(500).json({ status: 'error', message: error.message || 'Failed to delete farm' });
    }
});

/**
 * GET /api/admin/users
 * List admin users (employees)
 */
router.get('/users', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                users: [],
                message: 'Database not available'
            });
        }

        const result = await query(
            `SELECT id, email, name, role, active, last_login, created_at
             FROM admin_users
             ORDER BY created_at DESC`
        );

        const users = result.rows.map(row => {
            const fullName = row.name || '';
            const nameParts = fullName.trim().split(/\s+/).filter(Boolean);
            const firstName = nameParts[0] || '';
            const lastName = nameParts.slice(1).join(' ');

            return {
                user_id: row.id,
                first_name: firstName,
                last_name: lastName,
                email: row.email,
                role: row.role || 'admin',
                status: row.active ? 'active' : 'inactive',
                last_login: row.last_login,
                created_at: row.created_at
            };
        });

        res.json({
            success: true,
            users
        });
    } catch (error) {
        console.error('[Admin API] Error fetching users:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load users',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms
 * Get list of all farms in the network
 */
router.get('/farms', async (req, res) => {
    try {
        const { page = 1, limit = 50, status, region, search } = req.query;
        
        // Query actual farms from database
        let sqlQuery = 'SELECT * FROM farms WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        // Add filters
        if (status) {
            paramCount++;
            sqlQuery += ` AND status = $${paramCount}`;
            params.push(status);
        }
        
        if (search) {
            paramCount++;
            sqlQuery += ` AND (name ILIKE $${paramCount} OR farm_id ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        // Add pagination
        sqlQuery += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit));
        params.push((parseInt(page) - 1) * parseInt(limit));
        
        // Get farms
        const result = await query(sqlQuery, params);
        
        // Get total count
        let countQuery = 'SELECT COUNT(*) FROM farms WHERE 1=1';
        const countParams = [];
        let countParamCount = 0;
        
        if (status) {
            countParamCount++;
            countQuery += ` AND status = $${countParamCount}`;
            countParams.push(status);
        }
        
        if (search) {
            countParamCount++;
            countQuery += ` AND (name ILIKE $${countParamCount} OR farm_id ILIKE $${countParamCount})`;
            countParams.push(`%${search}%`);
        }
        
        const countResult = await query(countQuery, countParams);
        const total = parseInt(countResult.rows[0].count);
        
        // Format farms data
        const farms = result.rows.map(farm => ({
            id: farm.id,
            farmId: farm.farm_id,
            name: farm.name,
            status: farm.status,
            lastUpdate: farm.last_heartbeat,
            metadata: farm.metadata || {},
            createdAt: farm.created_at,
            updatedAt: farm.updated_at
        }));
        
        res.json({
            success: true,
            farms: farms,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                pages: Math.ceil(total / parseInt(limit))
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
 * GET /api/admin/farms/:farmId
 * Get detailed information for a specific farm
 */
router.get('/farms/:farmId', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching farm details for: ${farmId}`);
        
        // Query farm from database by farm_id
        const result = await query(
            'SELECT * FROM farms WHERE farm_id = $1',
            [farmId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found',
                message: `No farm found with ID: ${farmId}`
            });
        }
        
        const farmRow = result.rows[0];

        let roomsData = null;
        let groupsData = null;
        let telemetryData = null;

        if (await isDatabaseAvailable()) {
            const roomsResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'rooms']
            );
            roomsData = roomsResult.rows[0]?.data || null;

            const groupsResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'groups']
            );
            groupsData = groupsResult.rows[0]?.data || null;

            const telemetryResult = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'telemetry']
            );
            telemetryData = telemetryResult.rows[0]?.data || null;
        } else {
            console.warn('[Admin API] Database unavailable for farm detail:', farmId);
        }

        const roomsCount = Array.isArray(roomsData) ? roomsData.length : 0;
        const zonesFromTelemetry = Array.isArray(telemetryData?.zones) ? telemetryData.zones : [];
        const zonesCount = zonesFromTelemetry.length || (Array.isArray(groupsData) ? groupsData.length : 0);
        console.log('[Admin API] Farm data counts:', {
            farmId,
            roomsCount,
            zonesCount,
            telemetryZones: zonesFromTelemetry.length,
            groupsCount: Array.isArray(groupsData) ? groupsData.length : 0
        });

        const envSummary = zonesFromTelemetry.length ? {
            avgTemp: averageNumber(zonesFromTelemetry.map(z => z.sensors?.tempC?.current ?? z.temperature ?? z.tempC ?? null)),
            avgHumidity: averageNumber(zonesFromTelemetry.map(z => z.sensors?.rh?.current ?? z.humidity ?? z.rh ?? null)),
            avgVpd: averageNumber(zonesFromTelemetry.map(z => z.sensors?.vpd?.current ?? z.vpd ?? null))
        } : null;

        // Format farm data - only include fields that exist in DB
        const farm = {
            farmId: farmRow.farm_id,
            name: farmRow.name || 'Unknown Farm',
            status: farmRow.status || 'unknown',
            lastHeartbeat: farmRow.last_heartbeat || null,
            createdAt: farmRow.created_at || null,
            updatedAt: farmRow.updated_at || null,
            rooms: roomsCount,
            zones: zonesCount,
            environmental: {
                zones: zonesFromTelemetry,
                summary: envSummary
            },
            // Include all raw data
            ...farmRow
        };

        res.json({
            success: true,
            farm: farm
        });
    } catch (error) {
        console.error(`[Admin API] Error fetching farm ${req.params.farmId}:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm details',
            message: error.message
        });
    }
});

function averageNumber(values) {
    const filtered = values.filter(v => typeof v === 'number' && Number.isFinite(v));
    if (!filtered.length) return null;
    return filtered.reduce((sum, v) => sum + v, 0) / filtered.length;
}

/**
 * GET /api/admin/farms/:farmId/rooms
 * Return rooms for a farm from synced data
 */
router.get('/farms/:farmId/rooms', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, rooms: [], count: 0, farmId, source: 'memory' });
        }

        const result = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'rooms']
        );
        const rooms = result.rows[0]?.data || [];
        const updatedAt = result.rows[0]?.updated_at || null;

        res.json({
            success: true,
            rooms,
            count: Array.isArray(rooms) ? rooms.length : 0,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm rooms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm rooms', message: error.message });
    }
});

/**
 * GET /api/admin/farms/:farmId/zones
 * Return environmental zones for a farm from telemetry data
 */
router.get('/farms/:farmId/zones', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, zones: [], count: 0, farmId, source: 'memory' });
        }

        const telemetryResult = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'telemetry']
        );
        const telemetry = telemetryResult.rows[0]?.data || {};
        const zones = Array.isArray(telemetry.zones) ? telemetry.zones : [];
        const updatedAt = telemetryResult.rows[0]?.updated_at || null;

        res.json({
            success: true,
            zones,
            count: zones.length,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm zones:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm zones', message: error.message });
    }
});

/**
 * GET /api/admin/farms/:farmId/groups
 * Get groups data for a specific farm
 */
router.get('/farms/:farmId/groups', async (req, res) => {
    try {
        const { farmId } = req.params;
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, groups: [], count: 0, farmId, source: 'memory' });
        }

        const groupsResult = await query(
            `SELECT data, updated_at FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
            [farmId, 'groups']
        );
        const groupsData = groupsResult.rows[0]?.data || [];
        const groups = Array.isArray(groupsData) ? groupsData : [];
        const updatedAt = groupsResult.rows[0]?.updated_at || null;

        res.json({
            success: true,
            groups,
            count: groups.length,
            farmId,
            updatedAt
        });
    } catch (error) {
        console.error('[Admin API] Error fetching farm groups:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch farm groups', message: error.message });
    }
});

/**
 * GET /api/admin/rooms
 * Aggregate rooms across all farms
 */
router.get('/rooms', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, rooms: [], count: 0, source: 'memory' });
        }

        const result = await query(
            `SELECT farm_id, data, updated_at FROM farm_data WHERE data_type = $1`,
            ['rooms']
        );

        const rooms = result.rows.flatMap(row => {
            const list = Array.isArray(row.data) ? row.data : [];
            return list.map(room => ({ ...room, farmId: row.farm_id, updatedAt: row.updated_at }));
        });

        res.json({ success: true, rooms, count: rooms.length });
    } catch (error) {
        console.error('[Admin API] Error fetching rooms:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch rooms', message: error.message });
    }
});

/**
 * GET /api/admin/zones
 * Aggregate environmental zones across all farms from telemetry
 */
router.get('/zones', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({ success: true, zones: [], count: 0, source: 'memory' });
        }

        const result = await query(
            `SELECT farm_id, data, updated_at FROM farm_data WHERE data_type = $1`,
            ['telemetry']
        );

        const zones = result.rows.flatMap(row => {
            const telemetry = row.data || {};
            const list = Array.isArray(telemetry.zones) ? telemetry.zones : [];
            return list.map(zone => ({ ...zone, farmId: row.farm_id, updatedAt: row.updated_at }));
        });

        res.json({ success: true, zones, count: zones.length });
    } catch (error) {
        console.error('[Admin API] Error fetching zones:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch zones', message: error.message });
    }
});

/**
 * GET /api/admin/kpis
 * Get platform-wide KPIs
 */
router.get('/kpis', async (req, res) => {
    try {
        // Query real data from database - handle missing tables gracefully
        let totalFarms = 0, activeFarms = 0, totalOrders = 0, revenue = 0;
        
        try {
            const farmsResult = await query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = $1) as active FROM farms', ['online']);
            totalFarms = parseInt(farmsResult.rows[0].total);
            activeFarms = parseInt(farmsResult.rows[0].active);
        } catch (e) {
            console.warn('[Admin API] Farms table query failed:', e.message);
        }
        
        try {
            const ordersResult = await query('SELECT COUNT(*) as total, COALESCE(SUM((order_data->>\'total\')::numeric), 0) as revenue FROM orders WHERE status != $1', ['cancelled']);
            totalOrders = parseInt(ordersResult.rows[0].total);
            revenue = parseFloat(ordersResult.rows[0].revenue);
        } catch (e) {
            console.warn('[Admin API] Orders table query failed:', e.message);
        }
        
        res.json({
            success: true,
            kpis: {
                totalFarms,
                activeFarms,
                totalOrders,
                revenue,
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
 * GET /api/admin/analytics/aggregate
 * Get aggregated analytics data
 */
router.get('/analytics/aggregate', async (req, res) => {
    try {
        // Query real data from database - handle missing tables gracefully
        let totalFarms = 0, totalRooms = 0, totalZones = 0, totalDevices = 0, totalTrays = 0, totalPlants = 0;
        
        try {
            const farmsResult = await query('SELECT COUNT(*) as total FROM farms');
            totalFarms = parseInt(farmsResult.rows[0].total);
        } catch (e) {
            console.warn('[Admin API] Farms table query failed:', e.message);
        }
        
        // Aggregate from farm_data table
        try {
            const roomsResult = await query("SELECT data FROM farm_data WHERE data_type = 'rooms'");
            roomsResult.rows.forEach(row => {
                if (Array.isArray(row.data)) totalRooms += row.data.length;
            });
        } catch (e) {
            console.warn('[Admin API] Rooms data query failed:', e.message);
        }
        
        try {
            const groupsResult = await query("SELECT data FROM farm_data WHERE data_type = 'groups'");
            const uniqueZones = new Set();
            groupsResult.rows.forEach(row => {
                if (Array.isArray(row.data)) {
                    row.data.forEach(group => {
                        // Count unique zones, not groups
                        if (group.zone) uniqueZones.add(group.zone);

                        const trayCount = Array.isArray(group.trays)
                            ? group.trays.length
                            : (Number.isFinite(group.trays) ? group.trays : 0);
                        totalTrays += trayCount;

                        const plants = Number.isFinite(group.plants)
                            ? group.plants
                            : (trayCount > 0 ? trayCount * 48 : 0);
                        totalPlants += plants;
                    });
                }
            });
            totalZones = uniqueZones.size;
        } catch (e) {
            console.warn('[Admin API] Groups data query failed:', e.message);
        }
        
        // Return top-level fields (UI expects this structure)
        res.json({
            success: true,
            totalFarms,
            totalRooms,
            totalZones,
            totalDevices,
            totalTrays,
            totalPlants,
            mode: 'live'
        });
    } catch (error) {
        console.error('[Admin API] Error fetching analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/farms/sync-all-stats
 * Trigger sync for all farm statistics
 */
router.post('/farms/sync-all-stats', async (req, res) => {
    try {
        console.log('[Admin API] Sync all farm stats requested');
        
        // Get all active farms
        const farmsResult = await query('SELECT farm_id, name FROM farms WHERE status = $1', ['online']);
        const farms = farmsResult.rows;
        
        console.log(`[Admin API] Found ${farms.length} active farms to sync`);
        
        res.json({
            success: true,
            sync: {
                total: farms.length,
                farms: farms.map(f => ({ farm_id: f.farm_id, name: f.name })),
                message: 'Farms are automatically syncing via edge sync service.',
                note: farms.length === 1
                    ? '1 farm was online at the time of query. Edge devices sync rooms, groups, inventory, and telemetry every 30-300 seconds.'
                    : `${farms.length} farms were online at the time of query. Edge devices sync rooms, groups, inventory, and telemetry every 30-300 seconds.`
            }
        });
    } catch (error) {
        console.error('[Admin API] Error syncing farm stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to sync farm stats',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/fleet/monitoring
 * Fleet monitoring summary + deployments table data
 */
router.get('/fleet/monitoring', async (req, res) => {
    try {
        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                summary: {
                    connectedFarms: 0,
                    monthlyRecurringRevenue: 0,
                    totalZones: 0,
                    connectedSensors: 0,
                    fleetHealthScore: 0,
                    activeAlerts: 0
                },
                deployments: []
            });
        }

        const farmsResult = await query(
            `SELECT farm_id, name, status, metadata, settings, last_heartbeat, updated_at
             FROM farms
             ORDER BY created_at DESC`
        );

        const telemetryResult = await query(
            `SELECT farm_id, data, updated_at
             FROM farm_data
             WHERE data_type = $1`,
            ['telemetry']
        );

        const telemetryByFarm = new Map();
        telemetryResult.rows.forEach(row => {
            telemetryByFarm.set(row.farm_id, { data: row.data || {}, updatedAt: row.updated_at });
        });

        const deployments = farmsResult.rows.map(row => {
            const farmId = row.farm_id;
            const telemetry = telemetryByFarm.get(farmId);
            const telemetryData = telemetry?.data || {};
            const zones = Array.isArray(telemetryData.zones) ? telemetryData.zones : [];

            const sensorCounts = zones.reduce((acc, zone) => {
                const sensors = zone?.sensors && typeof zone.sensors === 'object' ? zone.sensors : null;
                if (!sensors) return acc;
                Object.values(sensors).forEach(sensor => {
                    const current = sensor?.current ?? sensor?.value;
                    if (current !== null && current !== undefined) {
                        acc.current += 1;
                    }
                    acc.total += 1;
                });
                return acc;
            }, { current: 0, total: 0 });

            const status = (row.status || 'unknown').toLowerCase();
            const baseHealth = status === 'online' ? 95
                : status === 'warning' ? 80
                : status === 'critical' ? 50
                : status === 'offline' ? 40
                : 60;

            const lastSeen = telemetry?.updatedAt || row.last_heartbeat || row.updated_at || null;
            const lastSeenAgeMs = lastSeen ? Date.now() - new Date(lastSeen).getTime() : null;
            const healthScore = Number.isFinite(lastSeenAgeMs) && lastSeenAgeMs > 24 * 60 * 60 * 1000
                ? Math.max(10, baseHealth - 20)
                : baseHealth;

            const telemetryBytes = telemetryData ? Buffer.byteLength(JSON.stringify(telemetryData)) : 0;
            const dataStorageMB = telemetryBytes ? Math.round((telemetryBytes / (1024 * 1024)) * 10) / 10 : 0;

            const plan = row.settings?.plan || row.settings?.tier || row.metadata?.plan || 'Starter';

            return {
                farmId,
                farmName: row.name || farmId,
                plan,
                status: status.toUpperCase(),
                sensors: {
                    current: sensorCounts.current,
                    total: sensorCounts.total,
                    limit: Number.isFinite(row.settings?.sensorLimit) ? row.settings.sensorLimit : null
                },
                apiCalls30d: null,
                dataStorageMB,
                healthScore,
                lastSeen
            };
        });

        const connectedFarms = farmsResult.rows.filter(row => (row.status || '').toLowerCase() === 'online').length;
        const totalZones = telemetryResult.rows.reduce((acc, row) => {
            const zones = Array.isArray(row.data?.zones) ? row.data.zones.length : 0;
            return acc + zones;
        }, 0);
        const connectedSensors = deployments.reduce((acc, d) => acc + (d.sensors?.current || 0), 0);
        const fleetHealthScore = deployments.length
            ? Math.round(deployments.reduce((acc, d) => acc + (Number.isFinite(d.healthScore) ? d.healthScore : 0), 0) / deployments.length)
            : 0;

        res.json({
            success: true,
            summary: {
                connectedFarms,
                monthlyRecurringRevenue: 0,
                totalZones,
                connectedSensors,
                fleetHealthScore,
                activeAlerts: 0
            },
            deployments
        });
    } catch (error) {
        console.error('[Admin API] Error fetching fleet monitoring:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to load fleet monitoring',
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
        const now = new Date();

        if (!(await isDatabaseAvailable())) {
            return res.json({
                success: true,
                alerts: [],
                summary: {
                    total: 0,
                    active: 0,
                    acknowledged: 0,
                    resolved: 0,
                    critical: 0,
                    warning: 0,
                    info: 0
                },
                timestamp: now.toISOString()
            });
        }

        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (severity) {
            conditions.push(`fa.severity = $${paramIndex}`);
            params.push(severity);
            paramIndex++;
        }

        if (farm_id) {
            conditions.push(`f.farm_id = $${paramIndex}`);
            params.push(farm_id);
            paramIndex++;
        }

        if (status) {
            if (status === 'active') {
                conditions.push('fa.resolved = false AND fa.acknowledged = false');
            } else if (status === 'acknowledged') {
                conditions.push('fa.acknowledged = true AND fa.resolved = false');
            } else if (status === 'resolved') {
                conditions.push('fa.resolved = true');
            }
        }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const summaryResult = await query(
            `SELECT
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE fa.resolved = false AND fa.acknowledged = false) as active,
                COUNT(*) FILTER (WHERE fa.acknowledged = true AND fa.resolved = false) as acknowledged,
                COUNT(*) FILTER (WHERE fa.resolved = true) as resolved,
                COUNT(*) FILTER (WHERE fa.severity = 'critical') as critical,
                COUNT(*) FILTER (WHERE fa.severity = 'warning') as warning,
                COUNT(*) FILTER (WHERE fa.severity = 'info') as info
             FROM farm_alerts fa
             JOIN farms f ON f.id = fa.farm_id
             ${whereClause}`,
            params
        );

        const summaryRow = summaryResult.rows[0] || {};
        const summary = {
            total: parseInt(summaryRow.total || 0),
            active: parseInt(summaryRow.active || 0),
            acknowledged: parseInt(summaryRow.acknowledged || 0),
            resolved: parseInt(summaryRow.resolved || 0),
            critical: parseInt(summaryRow.critical || 0),
            warning: parseInt(summaryRow.warning || 0),
            info: parseInt(summaryRow.info || 0)
        };

        const alertsResult = await query(
            `SELECT
                fa.id,
                fa.alert_type,
                fa.severity,
                fa.message,
                fa.zone_id,
                fa.device_id,
                fa.acknowledged,
                fa.acknowledged_by,
                fa.acknowledged_at,
                fa.resolved,
                fa.resolved_at,
                fa.created_at,
                f.farm_id,
                f.name as farm_name
             FROM farm_alerts fa
             JOIN farms f ON f.id = fa.farm_id
             ${whereClause}
             ORDER BY fa.created_at DESC
             LIMIT $${params.length + 1}`,
            [...params, parseInt(limit)]
        );

        const alerts = alertsResult.rows.map(row => {
            const statusValue = row.resolved
                ? 'resolved'
                : row.acknowledged
                ? 'acknowledged'
                : 'active';

            return {
                id: row.id,
                timestamp: row.created_at,
                farm_id: row.farm_id,
                farm_name: row.farm_name,
                severity: row.severity,
                type: row.alert_type,
                category: row.alert_type,
                message: row.message,
                status: statusValue,
                acknowledged: row.acknowledged,
                acknowledged_by: row.acknowledged_by,
                acknowledged_at: row.acknowledged_at,
                resolved: row.resolved,
                resolved_at: row.resolved_at,
                context: row.zone_id || row.device_id ? {
                    zone_id: row.zone_id,
                    device_id: row.device_id
                } : null
            };
        });

        res.json({
            success: true,
            alerts,
            summary,
            timestamp: now.toISOString()
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

/**
 * GET /api/admin/farms/:farmId/config
 * Get farm configuration settings
 */
router.get('/farms/:farmId/config', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching config for farm: ${farmId}`);
        
        // Query farm configuration
        const farmResult = await query(
            'SELECT farm_id, name, email, api_url, metadata, settings, created_at, updated_at FROM farms WHERE farm_id = $1',
            [farmId]
        );
        
        if (farmResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        const farm = farmResult.rows[0];
        
        // Get API keys count (don't expose actual keys)
        let apiKeyCount = 0;
        try {
            const keysResult = await query(
                'SELECT COUNT(*) as count FROM farm_api_keys WHERE farm_id = $1 AND active = true',
                [farmId]
            );
            apiKeyCount = parseInt(keysResult.rows[0]?.count || 0);
        } catch (e) {
            console.warn('[Admin API] farm_api_keys table not available');
        }
        
        // Get device registration count
        let deviceCount = 0;
        try {
            const devicesResult = await query(
                'SELECT COUNT(*) as count FROM devices WHERE farm_id = $1',
                [farmId]
            );
            deviceCount = parseInt(devicesResult.rows[0]?.count || 0);
        } catch (e) {
            console.warn('[Admin API] devices table not available');
        }
        
        const config = {
            farmId: farm.farm_id,
            farmName: farm.name,
            contactEmail: farm.email,
            apiUrl: farm.api_url || null,
            network: {
                localIP: farm.metadata?.network?.local_ip || null,
                publicIP: farm.metadata?.network?.public_ip || null,
                hostname: farm.metadata?.network?.hostname || null
            },
            apiKeys: {
                count: apiKeyCount,
                hasActive: apiKeyCount > 0
            },
            devices: {
                count: deviceCount,
                types: farm.metadata?.devices?.types || []
            },
            integrations: {
                square: farm.settings?.square?.connected || false,
                wholesale: farm.settings?.wholesale?.enabled || false,
                notifications: farm.settings?.notifications || {}
            },
            notifications: {
                email: farm.settings?.notifications?.email || true,
                sms: farm.settings?.notifications?.sms || false,
                slack: farm.settings?.notifications?.slack || false,
                alerts: {
                    system: farm.settings?.notifications?.alerts?.system || true,
                    environmental: farm.settings?.notifications?.alerts?.environmental || true,
                    inventory: farm.settings?.notifications?.alerts?.inventory || false
                }
            },
            settings: farm.settings || {},
            metadata: farm.metadata || {},
            createdAt: farm.created_at,
            updatedAt: farm.updated_at
        };
        
        res.json({
            success: true,
            config
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching farm config:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm configuration',
            message: error.message
        });
    }
});

/**
 * PATCH /api/admin/farms/:farmId/config
 * Update farm configuration settings
 */
router.patch('/farms/:farmId/config', async (req, res) => {
    try {
        const { farmId } = req.params;
        const { apiUrl, notifications, settings } = req.body;
        
        console.log(`[Admin API] Updating config for farm: ${farmId}`);
        
        // Build update query dynamically
        const updates = [];
        const params = [farmId];
        let paramCount = 1;
        
        if (apiUrl !== undefined) {
            paramCount++;
            updates.push(`api_url = $${paramCount}`);
            params.push(apiUrl);
        }
        
        if (notifications) {
            // Merge with existing settings
            const farmResult = await query('SELECT settings FROM farms WHERE farm_id = $1', [farmId]);
            const currentSettings = farmResult.rows[0]?.settings || {};
            currentSettings.notifications = { ...currentSettings.notifications, ...notifications };
            
            paramCount++;
            updates.push(`settings = $${paramCount}`);
            params.push(JSON.stringify(currentSettings));
        } else if (settings) {
            paramCount++;
            updates.push(`settings = $${paramCount}`);
            params.push(JSON.stringify(settings));
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No valid updates provided'
            });
        }
        
        // Add updated_at
        paramCount++;
        updates.push(`updated_at = $${paramCount}`);
        params.push(new Date().toISOString());
        
        const updateQuery = `UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $1 RETURNING *`;
        const result = await query(updateQuery, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Farm not found'
            });
        }
        
        res.json({
            success: true,
            message: 'Farm configuration updated successfully',
            farm: result.rows[0]
        });
        
    } catch (error) {
        console.error(`[Admin API] Error updating farm config:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to update farm configuration',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/logs
 * Get system logs for a specific farm
 */
router.get('/farms/:farmId/logs', async (req, res) => {
    try {
        const { farmId } = req.params;
        const { type, limit = 100, offset = 0 } = req.query;
        
        console.log(`[Admin API] Fetching logs for farm: ${farmId}`);
        
        const logs = [];
        
        // Try to get audit logs from admin_audit_log table
        try {
            let auditQuery = `
                SELECT 
                    id,
                    admin_id,
                    action,
                    resource_type,
                    resource_id,
                    metadata,
                    ip_address,
                    created_at
                FROM admin_audit_log
                WHERE resource_id = $1 OR metadata::text LIKE $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
            `;
            
            const auditResult = await query(auditQuery, [
                farmId,
                `%${farmId}%`,
                parseInt(limit),
                parseInt(offset)
            ]);
            
            logs.push(...auditResult.rows.map(row => ({
                id: row.id,
                type: 'user_activity',
                level: 'info',
                action: row.action,
                message: `${row.action} on ${row.resource_type || 'farm'}`,
                resourceType: row.resource_type,
                resourceId: row.resource_id,
                userId: row.admin_id,
                ipAddress: row.ip_address,
                metadata: row.metadata,
                timestamp: row.created_at
            })));
        } catch (e) {
            console.warn('[Admin API] admin_audit_log table not available:', e.message);
        }
        
        // Try to get device connection logs
        try {
            const deviceQuery = `
                SELECT 
                    'device_connection' as type,
                    'info' as level,
                    device_id,
                    'Device heartbeat' as action,
                    last_seen,
                    metadata
                FROM devices
                WHERE farm_id = $1
                ORDER BY last_seen DESC
                LIMIT 20
            `;
            
            const deviceResult = await query(deviceQuery, [farmId]);
            
            logs.push(...deviceResult.rows.map(row => ({
                type: 'device_connection',
                level: 'info',
                action: 'heartbeat',
                message: `Device ${row.device_id} check-in`,
                deviceId: row.device_id,
                metadata: row.metadata,
                timestamp: row.last_seen
            })));
        } catch (e) {
            console.warn('[Admin API] devices table query failed:', e.message);
        }
        
        // Try to get farm heartbeat logs
        try {
            const heartbeatQuery = `
                SELECT 
                    'api_call' as type,
                    'info' as level,
                    'heartbeat' as action,
                    last_heartbeat,
                    metadata
                FROM farms
                WHERE farm_id = $1
            `;
            
            const hbResult = await query(heartbeatQuery, [farmId]);
            
            if (hbResult.rows.length > 0) {
                const row = hbResult.rows[0];
                logs.push({
                    type: 'api_call',
                    level: 'info',
                    action: 'farm_heartbeat',
                    message: 'Farm heartbeat received',
                    metadata: row.metadata,
                    timestamp: row.last_heartbeat
                });
            }
        } catch (e) {
            console.warn('[Admin API] heartbeat query failed:', e.message);
        }
        
        // Add mock system events if no real logs available
        if (logs.length === 0) {
            const now = new Date();
            logs.push(
                {
                    id: 1,
                    type: 'system_event',
                    level: 'info',
                    action: 'system_start',
                    message: 'Farm system initialized',
                    timestamp: new Date(now - 3600000).toISOString()
                },
                {
                    id: 2,
                    type: 'api_call',
                    level: 'info',
                    action: 'api_request',
                    message: 'GET /api/admin/farms/' + farmId,
                    timestamp: new Date(now - 1800000).toISOString()
                },
                {
                    id: 3,
                    type: 'warning',
                    level: 'warning',
                    action: 'high_temperature',
                    message: 'Temperature threshold exceeded in Room 1',
                    timestamp: new Date(now - 900000).toISOString()
                },
                {
                    id: 4,
                    type: 'device_connection',
                    level: 'info',
                    action: 'device_online',
                    message: 'Light controller LT-001 connected',
                    timestamp: new Date(now - 600000).toISOString()
                },
                {
                    id: 5,
                    type: 'user_activity',
                    level: 'info',
                    action: 'settings_updated',
                    message: 'Farm configuration updated',
                    timestamp: new Date(now - 300000).toISOString()
                }
            );
        }
        
        // Sort by timestamp desc
        logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Filter by type if specified
        const filteredLogs = type ? logs.filter(log => log.type === type) : logs;
        
        res.json({
            success: true,
            logs: filteredLogs.slice(0, parseInt(limit)),
            total: filteredLogs.length,
            hasMore: filteredLogs.length > parseInt(limit)
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching logs:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm logs',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/devices
 * Get devices registered to a specific farm
 */
router.get('/farms/:farmId/devices', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching devices for farm: ${farmId}`);
        
        // Try to get devices from farm_data sync table
        let devices = [];
        try {
            const result = await query(
                `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = $2`,
                [farmId, 'devices']
            );
            
            if (result.rows.length > 0) {
                devices = result.rows[0].data || [];
            }
        } catch (e) {
            console.warn('[Admin API] farm_data table not available:', e.message);
        }
        
        // If no synced devices, return empty array
        res.json({
            success: true,
            devices: devices,
            count: devices.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching devices:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm devices',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/inventory
 * Get inventory for a specific farm
 */
router.get('/farms/:farmId/inventory', async (req, res) => {
    try {
        const { farmId } = req.params;
        console.log(`[Admin API] Fetching inventory for farm: ${farmId}`);
        
        // Try to get inventory from farm_inventory table
        let inventory = [];
        try {
            const result = await query(
                `SELECT * FROM farm_inventory WHERE farm_id = $1 ORDER BY last_updated DESC`,
                [farmId]
            );
            
            inventory = result.rows.map(row => ({
                productId: row.product_id,
                productName: row.product_name,
                sku: row.sku,
                quantity: row.quantity,
                unit: row.unit,
                price: row.price,
                availableForWholesale: row.available_for_wholesale,
                lastUpdated: row.last_updated
            }));
        } catch (e) {
            console.warn('[Admin API] farm_inventory table not available:', e.message);
        }
        
        res.json({
            success: true,
            inventory: inventory,
            count: inventory.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching inventory:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm inventory',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/farms/:farmId/recipes
 * Get active recipes for a specific farm (from synced group data)
 */
router.get('/farms/:farmId/recipes', async (req, res) => {
    try {
        const { farmId } = req.params;
        const db = req.app.locals.db;
        
        if (!db) {
            return res.json({
                success: true,
                recipes: [],
                count: 0,
                farmId: farmId,
                message: 'Database not available'
            });
        }
        
        // Get groups from farm_data (synced from edge device)
        const result = await db.query(
            `SELECT data FROM farm_data WHERE farm_id = $1 AND data_type = 'groups'`,
            [farmId]
        );
        
        let activeRecipes = [];
        
        if (result.rows.length > 0) {
            let groups = result.rows[0].data;
            if (typeof groups === 'string') {
                try {
                    groups = JSON.parse(groups);
                } catch (parseError) {
                    console.warn('[Admin API] Failed to parse groups JSON:', parseError.message);
                    groups = [];
                }
            }
            if (!Array.isArray(groups)) {
                groups = [];
            }
            
            // Extract active recipes from groups
            // Each group has an active recipe assigned
            const recipeMap = new Map();
            const recipeNameToGroups = new Map();

            groups.forEach(group => {
                const recipeName = group.active_recipe || group.recipe_name || group.recipeName || group.recipe || group.crop;
                if (!recipeName) return;

                const key = recipeName.trim();
                if (!recipeMap.has(key)) {
                    recipeMap.set(key, {
                        name: recipeName,
                        id: recipeName.toLowerCase().replace(/\s+/g, '-'),
                        groups: 0,
                        trays: 0,
                        category: group.crop_type || getRecipeCategory(recipeName)
                    });
                    recipeNameToGroups.set(key, []);
                }

                const recipe = recipeMap.get(key);
                recipe.groups++;
                recipe.trays += Array.isArray(group.trays) ? group.trays.length : (group.trays || 0);
                recipeNameToGroups.get(key).push(group);
            });

            const recipeFiles = await fs.readdir(RECIPES_DIR).catch(() => []);
            const recipeFileMap = new Map();
            recipeFiles.filter(f => f.endsWith('.csv')).forEach(file => {
                const name = file.replace(/-Table 1\.csv$/, '').replace(/\.csv$/, '');
                recipeFileMap.set(normalizeRecipeName(name), file);
            });

            const today = new Date();
            activeRecipes = await Promise.all(Array.from(recipeMap.values()).map(async recipe => {
                const normalized = normalizeRecipeName(recipe.name);
                const file = recipeFileMap.get(normalized);
                let schedule = [];
                let totalDays = null;
                let avgTemp = null;

                if (file) {
                    try {
                        const parsed = await parseRecipeCSV(path.join(RECIPES_DIR, file));
                        schedule = parsed.phases || [];
                        totalDays = parsed.totalDays || schedule.length || null;
                        avgTemp = getAverageTemperature(schedule);
                    } catch (err) {
                        console.warn(`[Admin API] Failed to parse recipe file ${file}:`, err.message);
                    }
                }

                const groupsForRecipe = recipeNameToGroups.get(recipe.name) || [];
                const seedDates = groupsForRecipe
                    .map(group => group.planConfig?.anchor?.seedDate || group.planSeedDate || group.seedDate)
                    .filter(Boolean)
                    .map(dateStr => new Date(dateStr))
                    .filter(dateObj => !Number.isNaN(dateObj.getTime()));

                let seedDateMin = null;
                let seedDateMax = null;
                let currentDayMin = null;
                let currentDayMax = null;
                let daysRemainingMin = null;
                let daysRemainingMax = null;

                if (seedDates.length > 0) {
                    seedDates.sort((a, b) => a - b);
                    seedDateMin = seedDates[0];
                    seedDateMax = seedDates[seedDates.length - 1];

                    const daysSinceSeed = seedDates.map(d => Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24))));
                    currentDayMin = Math.min(...daysSinceSeed) + 1;
                    currentDayMax = Math.max(...daysSinceSeed) + 1;

                    if (totalDays != null) {
                        const daysRemaining = daysSinceSeed.map(days => Math.max(0, totalDays - (days + 1)));
                        daysRemainingMin = Math.min(...daysRemaining);
                        daysRemainingMax = Math.max(...daysRemaining);
                    }
                }

                return {
                    recipe_id: recipe.id,
                    id: recipe.id,
                    name: recipe.name,
                    category: recipe.category,
                    total_days: totalDays,
                    schedule_length: schedule.length,
                    avg_temp_c: avgTemp,
                    groups_running: recipe.groups,
                    trays_running: recipe.trays,
                    seed_date_min: seedDateMin ? seedDateMin.toISOString().split('T')[0] : null,
                    seed_date_max: seedDateMax ? seedDateMax.toISOString().split('T')[0] : null,
                    current_day_min: currentDayMin,
                    current_day_max: currentDayMax,
                    days_remaining_min: daysRemainingMin,
                    days_remaining_max: daysRemainingMax,
                    description: `Growing recipe for ${recipe.name}`,
                    data: { schedule }
                };
            }));
        }

        if (activeRecipes.length === 0) {
            try {
                const syncResponse = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/sync/${farmId}/groups`);
                if (syncResponse.ok) {
                    const syncData = await syncResponse.json();
                    const groups = Array.isArray(syncData.groups) ? syncData.groups : [];
                    if (groups.length > 0) {
                        const recipeMap = new Map();
                        const recipeNameToGroups = new Map();

                        groups.forEach(group => {
                            const recipeName = group.active_recipe || group.recipe_name || group.recipeName || group.recipe || group.crop;
                            if (!recipeName) return;
                            const key = recipeName.trim();
                            if (!recipeMap.has(key)) {
                                recipeMap.set(key, {
                                    name: recipeName,
                                    id: recipeName.toLowerCase().replace(/\s+/g, '-'),
                                    groups: 0,
                                    trays: 0,
                                    category: group.crop_type || getRecipeCategory(recipeName)
                                });
                                recipeNameToGroups.set(key, []);
                            }
                            const recipe = recipeMap.get(key);
                            recipe.groups++;
                            recipe.trays += Array.isArray(group.trays) ? group.trays.length : (group.trays || 0);
                            recipeNameToGroups.get(key).push(group);
                        });

                        const recipeFiles = await fs.readdir(RECIPES_DIR).catch(() => []);
                        const recipeFileMap = new Map();
                        recipeFiles.filter(f => f.endsWith('.csv')).forEach(file => {
                            const name = file.replace(/-Table 1\.csv$/, '').replace(/\.csv$/, '');
                            recipeFileMap.set(normalizeRecipeName(name), file);
                        });

                        const today = new Date();
                        activeRecipes = await Promise.all(Array.from(recipeMap.values()).map(async recipe => {
                            const normalized = normalizeRecipeName(recipe.name);
                            const file = recipeFileMap.get(normalized);
                            let schedule = [];
                            let totalDays = null;
                            let avgTemp = null;

                            if (file) {
                                try {
                                    const parsed = await parseRecipeCSV(path.join(RECIPES_DIR, file));
                                    schedule = parsed.phases || [];
                                    totalDays = parsed.totalDays || schedule.length || null;
                                    avgTemp = getAverageTemperature(schedule);
                                } catch (err) {
                                    console.warn(`[Admin API] Failed to parse recipe file ${file}:`, err.message);
                                }
                            }

                            const groupsForRecipe = recipeNameToGroups.get(recipe.name) || [];
                            const seedDates = groupsForRecipe
                                .map(group => group.planConfig?.anchor?.seedDate || group.planSeedDate || group.seedDate)
                                .filter(Boolean)
                                .map(dateStr => new Date(dateStr))
                                .filter(dateObj => !Number.isNaN(dateObj.getTime()));

                            let seedDateMin = null;
                            let seedDateMax = null;
                            let currentDayMin = null;
                            let currentDayMax = null;
                            let daysRemainingMin = null;
                            let daysRemainingMax = null;

                            if (seedDates.length > 0) {
                                seedDates.sort((a, b) => a - b);
                                seedDateMin = seedDates[0];
                                seedDateMax = seedDates[seedDates.length - 1];

                                const daysSinceSeed = seedDates.map(d => Math.max(0, Math.floor((today - d) / (1000 * 60 * 60 * 24))));
                                currentDayMin = Math.min(...daysSinceSeed) + 1;
                                currentDayMax = Math.max(...daysSinceSeed) + 1;

                                if (totalDays != null) {
                                    const daysRemaining = daysSinceSeed.map(days => Math.max(0, totalDays - (days + 1)));
                                    daysRemainingMin = Math.min(...daysRemaining);
                                    daysRemainingMax = Math.max(...daysRemaining);
                                }
                            }

                            return {
                                recipe_id: recipe.id,
                                id: recipe.id,
                                name: recipe.name,
                                category: recipe.category,
                                total_days: totalDays,
                                schedule_length: schedule.length,
                                avg_temp_c: avgTemp,
                                groups_running: recipe.groups,
                                trays_running: recipe.trays,
                                seed_date_min: seedDateMin ? seedDateMin.toISOString().split('T')[0] : null,
                                seed_date_max: seedDateMax ? seedDateMax.toISOString().split('T')[0] : null,
                                current_day_min: currentDayMin,
                                current_day_max: currentDayMax,
                                days_remaining_min: daysRemainingMin,
                                days_remaining_max: daysRemainingMax,
                                description: `Growing recipe for ${recipe.name}`,
                                data: { schedule }
                            };
                        }));
                    }
                }
            } catch (error) {
                console.warn('[Admin API] Fallback sync groups failed:', error.message);
            }
        }
        
        res.json({
            success: true,
            recipes: activeRecipes,
            count: activeRecipes.length,
            farmId: farmId
        });
        
    } catch (error) {
        console.error(`[Admin API] Error fetching farm recipes:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch farm recipes',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/energy/dashboard
 * Get energy usage dashboard data
 */
router.get('/energy/dashboard', async (req, res) => {
    try {
        console.log('[Admin API] Fetching energy dashboard data');
        
        // Return mock data structure for now
        // TODO: Implement real energy monitoring when available
        const now = new Date();
        const mockData = {
            summary: {
                totalConsumption: 1250.5, // kWh
                cost: 187.58, // USD
                peakDemand: 45.2, // kW
                avgDemand: 28.3, // kW
                period: '30 days'
            },
            byFarm: [
                {
                    farmId: 'GR-00001',
                    farmName: 'Farm Alpha',
                    consumption: 850.3,
                    cost: 127.54,
                    percentOfTotal: 68
                },
                {
                    farmId: 'GR-00002',
                    farmName: 'Farm Beta',
                    consumption: 400.2,
                    cost: 60.04,
                    percentOfTotal: 32
                }
            ],
            hourly: Array.from({ length: 24 }, (_, i) => ({
                hour: i,
                consumption: 25 + Math.random() * 20,
                timestamp: new Date(now.getTime() - (24 - i) * 3600000).toISOString()
            })),
            alerts: []
        };
        
        res.json({
            success: true,
            data: mockData,
            timestamp: now.toISOString(),
            demo: true
        });
        
    } catch (error) {
        console.error('[Admin API] Error fetching energy dashboard:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch energy dashboard',
            message: error.message
        });
    }
});

export default router;
