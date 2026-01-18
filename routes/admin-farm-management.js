import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { getJwtSecret } from '../server/utils/secrets-manager.js';
import { initDatabase, query as dbQuery } from '../lib/database.js';

const router = express.Router();

/**
 * Admin authentication middleware
 * Verifies JWT token has admin role
 */
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  console.log('[REQUIRE ADMIN] ===== AUTH CHECK =====');
  console.log('[REQUIRE ADMIN] Has auth header:', !!authHeader);
  console.log('[REQUIRE ADMIN] Auth header preview:', authHeader ? authHeader.substring(0, 20) + '...' : 'none');
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[REQUIRE ADMIN] ❌ Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    console.log('[REQUIRE ADMIN] Token extracted, length:', token.length);
    console.log('[REQUIRE ADMIN] Token preview:', token.substring(0, 50) + '...');
    
    const jwtSecret = await getJwtSecret();
    console.log('[REQUIRE ADMIN] JWT Secret obtained, length:', jwtSecret.length);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('[REQUIRE ADMIN] ✅ Token decoded successfully');
    console.log('[REQUIRE ADMIN] Email:', decoded.email, 'Role:', decoded.role);
    
    if (!['admin', 'super_admin'].includes(decoded.role)) {
      console.warn('[REQUIRE ADMIN] User does not have admin role:', decoded.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.admin = decoded;
    next();
  } catch (error) {
    console.error('[REQUIRE ADMIN ERROR] Token verification failed:', error.message);
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

/**
 * POST /api/admin/auth/login
 * Admin login with email and password
 * Fallback: Hard-coded admin credentials when database is not available
 */
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password, mfa_code } = req.body;
    
    if (!email || !password) {
      console.error('[AUTH LOGIN] ❌ Missing email or password');
      return res.status(400).json({ error: 'Email and password required' });
    }
    
    console.log('[AUTH LOGIN] ===== LOGIN ATTEMPT =====');
    console.log('[AUTH LOGIN] Email:', email);
    console.log('[AUTH LOGIN] Has password:', !!password);
    console.log('[AUTH LOGIN] Password length:', password.length);
    
    // Hard-coded fallback admin credentials (for NeDB/in-memory mode)
    const FALLBACK_ADMIN = {
      email: 'info@greenreachfarms.com',
      password: 'Admin2025!',
      name: 'System Administrator',
      id: 1,
      farm_id: 'greenreach-hq'
    };
    
    // Check fallback credentials first
    console.log('[AUTH LOGIN] Checking fallback credentials...');
    console.log('[AUTH LOGIN] Email match:', email === FALLBACK_ADMIN.email);
    console.log('[AUTH LOGIN] Password match:', password === FALLBACK_ADMIN.password);
    
    if (email === FALLBACK_ADMIN.email && password === FALLBACK_ADMIN.password) {
      console.log('[AUTH LOGIN] ✅ Using fallback admin credentials');
      
      const jwtSecret = await getJwtSecret();
      console.log('[AUTH LOGIN] JWT Secret obtained, length:', jwtSecret.length);
      const token = jwt.sign(
        { 
          admin_id: FALLBACK_ADMIN.id,
          user_id: FALLBACK_ADMIN.id,
          email: FALLBACK_ADMIN.email,
          role: 'admin',
          farm_id: FALLBACK_ADMIN.farm_id
        },
        jwtSecret,
        { expiresIn: '4h' }
      );
      
      console.log('[AUTH LOGIN] ✅ Token generated, length:', token.length);
      console.log('[AUTH LOGIN] Token preview:', token.substring(0, 50) + '...');
      
      return res.json({ 
        success: true, 
        token,
        admin: {
          id: FALLBACK_ADMIN.id,
          email: FALLBACK_ADMIN.email,
          name: FALLBACK_ADMIN.name,
          farm_id: FALLBACK_ADMIN.farm_id
        }
      });
    }
    
    // Try database authentication
    const db = await initDatabase();
    
    // Check if database is actually available (not NeDB mode)
    if (!db || !db.mode || db.mode === 'nedb') {
      console.warn('[AUTH LOGIN] Database not available, only fallback auth supported');
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // For demo: Allow any user with role='admin' to login to GreenReach Central
    const user = await db.get(
      'SELECT * FROM users WHERE email = ? AND role = "admin" LIMIT 1',
      [email]
    );
    
    if (!user) {
      console.warn('[AUTH LOGIN] User not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.warn('[AUTH LOGIN] Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Check if user is disabled
    if (user.status === 'disabled') {
      console.warn('[AUTH LOGIN] Account disabled:', email);
      return res.status(403).json({ error: 'Account disabled' });
    }
    
    console.log('[AUTH LOGIN] Database authentication successful for:', email);
    
    // Generate admin JWT token (4 hour expiry)
    const jwtSecret = await getJwtSecret();
    const token = jwt.sign(
      { 
        admin_id: user.id,
        user_id: user.id,
        email: user.email,
        role: 'admin',
        farm_id: user.farm_id
      },
      jwtSecret,
      { expiresIn: '4h' }
    );
    
    // Update last login
    try {
      await db.run(
        'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id]
      );
    } catch (updateError) {
      console.warn('[AUTH LOGIN] Could not update last_login:', updateError.message);
    }
    
    // Log successful login (if audit table exists)
    try {
      await db.run(
        `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
         VALUES (?, 'LOGIN_SUCCESS', 'admin', ?, ?, ?)`,
        [user.id, user.id, JSON.stringify({ email }), req.ip]
      );
    } catch (auditError) {
      console.warn('[AUTH LOGIN] Audit log not available:', auditError.message);
    }
    
    res.json({ 
      success: true, 
      token,
      admin: {
        id: user.id,
        email: user.email,
        name: user.first_name ? `${user.first_name} ${user.last_name || ''}`.trim() : user.email,
        farm_id: user.farm_id
      }
    });
  } catch (error) {
    console.error('[AUTH LOGIN ERROR]:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

/**
 * GET /api/admin/auth/health
 * Check if JWT secret is accessible
 */
router.get('/auth/health', async (req, res) => {
  try {
    console.log('[AUTH HEALTH] Checking JWT secret availability...');
    const jwtSecret = await getJwtSecret();
    console.log('[AUTH HEALTH] JWT secret obtained, length:', jwtSecret.length);
    console.log('[AUTH HEALTH] JWT secret preview:', jwtSecret.substring(0, 10) + '...');
    
    // Try to sign and verify a test token
    const testPayload = { test: true, timestamp: Date.now() };
    const testToken = jwt.sign(testPayload, jwtSecret, { expiresIn: '1m' });
    const testDecoded = jwt.verify(testToken, jwtSecret);
    
    console.log('[AUTH HEALTH] ✅ JWT signing and verification working');
    res.json({ 
      success: true, 
      message: 'JWT authentication system operational',
      jwtSecretLength: jwtSecret.length,
      testTokenLength: testToken.length,
      testVerified: !!testDecoded
    });
  } catch (error) {
    console.error('[AUTH HEALTH ERROR]:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack 
    });
  }
});

/**
 * GET /api/admin/auth/debug
 * Debug endpoint to check auth status and JWT configuration
 */
router.get('/auth/debug', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const jwtSecret = await getJwtSecret();
    
    const debug = {
      timestamp: new Date().toISOString(),
      hasAuthHeader: !!authHeader,
      authHeaderPreview: authHeader ? authHeader.substring(0, 30) + '...' : null,
      jwtSecretLength: jwtSecret.length,
      jwtSecretPreview: jwtSecret.substring(0, 10) + '...',
      fallbackAdmin: {
        email: 'admin@greenreach.com',
        exists: true
      }
    };
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      debug.tokenLength = token.length;
      debug.tokenPreview = token.substring(0, 50) + '...';
      
      try {
        const decoded = jwt.verify(token, jwtSecret);
        debug.tokenValid = true;
        debug.tokenPayload = decoded;
      } catch (verifyError) {
        debug.tokenValid = false;
        debug.tokenError = verifyError.message;
      }
    }
    
    res.json({ success: true, debug });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

/**
 * GET /api/admin/auth/verify
 * Verify current admin session is valid
 */
router.get('/auth/verify', async (req, res) => {
  const authHeader = req.headers.authorization;
  
  console.log('[AUTH VERIFY] ===== VERIFY REQUEST =====');
  console.log('[AUTH VERIFY] Has auth header:', !!authHeader);
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('[AUTH VERIFY] ❌ Missing or invalid Authorization header');
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    console.log('[AUTH VERIFY] Token extracted, length:', token.length);
    
    const jwtSecret = await getJwtSecret();
    console.log('[AUTH VERIFY] JWT Secret obtained, length:', jwtSecret.length);
    
    const decoded = jwt.verify(token, jwtSecret);
    console.log('[AUTH VERIFY] ✅ Token decoded successfully');
    console.log('[AUTH VERIFY] Email:', decoded.email, 'Role:', decoded.role);
    
    if (decoded.role !== 'admin') {
      console.warn('[AUTH VERIFY] ❌ User does not have admin role:', decoded.role);
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    console.log('[AUTH VERIFY] ✅ Verification successful!');
    res.json({ 
      success: true, 
      admin: {
        id: decoded.admin_id || decoded.user_id,
        email: decoded.email,
        role: decoded.role
      }
    });
  } catch (error) {
    console.error('[AUTH VERIFY ERROR]:', error.message);
    console.error('[AUTH VERIFY ERROR] Stack:', error.stack);
    res.status(401).json({ error: 'Invalid or expired admin token', details: error.message });
  }
});

/**
 * POST /api/admin/auth/logout
 * Logout admin session
 */
router.post('/auth/logout', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Log logout (if audit table exists)
    try {
      await db.run(
        `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
         VALUES (?, 'LOGOUT', 'admin', ?, ?, ?)`,
        [req.admin.admin_id || req.admin.user_id, req.admin.admin_id || req.admin.user_id, JSON.stringify({ email: req.admin.email }), req.ip]
      );
    } catch (auditError) {
      console.warn('Audit log not available:', auditError.message);
    }
    
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

/**
 * GET /api/admin/farms
 * List all registered farms
 */
router.get('/farms', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample farm data');
      
      // Return sample/mock farms for NeDB mode
      const sampleFarms = [
        {
          farm_id: 'greenreach-hq',
          name: 'GreenReach HQ Demo Farm',
          email: 'admin@greenreach.com',
          status: 'active',
          tier: 'enterprise',
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
          user_count: 1
        }
      ];
      
      return res.json({ success: true, farms: sampleFarms, mode: 'demo' });
    }
    
    // PostgreSQL mode: Query actual database
    // First get farms, then count users separately to avoid complex GROUP BY
    const farmsResult = await dbQuery(`
      SELECT 
        farm_id,
        name,
        email,
        status,
        plan_type as tier,
        created_at,
        updated_at as last_login
      FROM farms
      ORDER BY created_at DESC
    `);
    
    // For each farm, count the users
    const farms = farmsResult.rows;
    for (const farm of farms) {
      const countResult = await dbQuery(`
        SELECT COUNT(*) as count FROM users WHERE farm_id = $1
      `, [farm.farm_id]);
      farm.user_count = parseInt(countResult.rows[0].count) || 0;
    }
    
    res.json({ success: true, farms, mode: 'database' });
  } catch (error) {
    console.error('Error listing farms:', error);
    res.status(500).json({ error: 'Failed to list farms', details: error.message });
  }
});

/**
 * GET /api/admin/farms/:farmId
 * Get detailed information about a specific farm
 */
router.get('/farms/:farmId', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample farm detail');
      
      // Return sample farm detail for NeDB mode
      const sampleFarm = {
        farm_id: farmId,
        name: farmId === 'greenreach-hq' ? 'GreenReach HQ Demo Farm' : 'Demo Farm',
        email: 'admin@greenreach.com',
        status: 'active',
        tier: 'enterprise',
        created_at: new Date().toISOString(),
        last_heartbeat: new Date().toISOString(),
        address: '123 Farm Lane',
        city: 'Portland',
        state: 'OR',
        country: 'USA',
        phone: '+1-555-0100',
        total_rooms: 1,
        total_devices: 0,
        user_count: 1
      };
      
      return res.json(sampleFarm);
    }
    
    // PostgreSQL mode: Query actual database
    const result = await dbQuery(`
      SELECT 
        f.farm_id,
        f.name,
        f.email,
        f.phone,
        f.contact_name,
        f.plan_type,
        f.status,
        f.created_at,
        f.updated_at,
        f.api_key,
        f.api_secret,
        f.jwt_secret,
        f.square_payment_id,
        f.square_amount,
        f.timezone,
        f.business_hours,
        f.certifications,
        COUNT(DISTINCT u.user_id) as user_count
      FROM farms f
      LEFT JOIN users u ON f.farm_id = u.farm_id
      WHERE f.farm_id = $1
      GROUP BY f.farm_id, f.name, f.email, f.phone, f.contact_name, f.plan_type, f.status, f.created_at, f.updated_at, f.api_key, f.api_secret, f.jwt_secret, f.square_payment_id, f.square_amount, f.timezone, f.business_hours, f.certifications
    `, [farmId]);
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    const farm = result.rows[0];
    
    // Get detailed metrics for this farm
    try {
      // Count rooms
      const roomsResult = await dbQuery(
        'SELECT COUNT(*) as count FROM rooms WHERE farm_id = $1',
        [farmId]
      );
      farm.room_count = parseInt(roomsResult.rows[0]?.count || 0);
      
      // Count devices  
      const devicesResult = await dbQuery(
        'SELECT COUNT(*) as count FROM devices WHERE farm_id = $1',
        [farmId]
      );
      farm.device_count = parseInt(devicesResult.rows[0]?.count || 0);
      
      // Count zones (if zones table exists)
      try {
        const zonesResult = await dbQuery(
          'SELECT COUNT(*) as count FROM zones WHERE farm_id = $1',
          [farmId]
        );
        farm.zone_count = parseInt(zonesResult.rows[0]?.count || 0);
      } catch (err) {
        farm.zone_count = 0;
      }
      
      // Get inventory trays count
      try {
        const traysResult = await dbQuery(
          'SELECT SUM(qty_available) as count FROM farm_inventory WHERE farm_id = $1',
          [farmId]
        );
        farm.tray_count = parseInt(traysResult.rows[0]?.count || 0);
      } catch (err) {
        farm.tray_count = 0;
      }
      
      // Calculate plant count (estimate: ~40 plants per tray)
      farm.plant_count = farm.tray_count * 40;
      
      // Get active alerts count
      try {
        const alertsResult = await dbQuery(
          'SELECT COUNT(*) as count FROM alerts WHERE farm_id = $1 AND status = $2',
          [farmId, 'active']
        );
        farm.active_alerts = parseInt(alertsResult.rows[0]?.count || 0);
      } catch (err) {
        farm.active_alerts = 0;
      }
      
      // Add metrics object for easy access
      farm.metrics = {
        room_count: farm.room_count,
        zone_count: farm.zone_count,
        device_count: farm.device_count,
        tray_count: farm.tray_count,
        plant_count: farm.plant_count,
        active_alerts: farm.active_alerts,
        user_count: farm.user_count
      };
      
    } catch (metricsError) {
      console.error('Error calculating farm metrics:', metricsError);
      // Continue without metrics
      farm.metrics = {
        room_count: 0,
        zone_count: 0,
        device_count: 0,
        tray_count: 0,
        plant_count: 0,
        active_alerts: 0,
        user_count: farm.user_count || 0
      };
    }
    
    res.json(farm);
  } catch (error) {
    console.error('Error getting farm details:', error);
    res.status(500).json({ error: 'Failed to get farm details', details: error.message });
  }
});

/**
 * GET /api/admin/farms/:farmId/rooms
 * Get all rooms for a specific farm with environmental data
 */
router.get('/farms/:farmId/rooms', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Check if database is available
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample rooms');
      return res.json({
        success: true,
        rooms: [
          {
            room_id: 'room-a',
            name: 'Room A',
            farm_id: farmId,
            type: 'grow',
            status: 'active',
            temperature: 72.5,
            humidity: 65,
            co2: 1050,
            vpd: 0.85,
            zone_count: 3,
            device_count: 12
          }
        ]
      });
    }
    
    // Query rooms for this farm
    const result = await dbQuery(`
      SELECT 
        r.id as room_id,
        r.farm_id,
        r.name,
        r.type,
        r.status,
        r.created_at,
        r.updated_at,
        COUNT(DISTINCT z.id) as zone_count,
        COUNT(DISTINCT d.device_id) as device_count
      FROM rooms r
      LEFT JOIN zones z ON r.id = z.room_id
      LEFT JOIN devices d ON r.id = d.room_id
      WHERE r.farm_id = $1
      GROUP BY r.id, r.farm_id, r.name, r.type, r.status, r.created_at, r.updated_at
      ORDER BY r.name ASC
    `, [farmId]);
    
    // Get latest environmental readings for each room (if sensors table exists)
    const rooms = result.rows || [];
    for (const room of rooms) {
      try {
        const envResult = await dbQuery(`
          SELECT 
            AVG(CASE WHEN sensor_type = 'temperature' THEN value END) as temperature,
            AVG(CASE WHEN sensor_type = 'humidity' THEN value END) as humidity,
            AVG(CASE WHEN sensor_type = 'co2' THEN value END) as co2,
            AVG(CASE WHEN sensor_type = 'vpd' THEN value END) as vpd
          FROM sensor_readings
          WHERE room_id = $1
            AND timestamp > NOW() - INTERVAL '5 minutes'
        `, [room.room_id]);
        
        if (envResult.rows && envResult.rows.length > 0) {
          const env = envResult.rows[0];
          room.temperature = env.temperature ? parseFloat(env.temperature).toFixed(1) : null;
          room.humidity = env.humidity ? parseFloat(env.humidity).toFixed(0) : null;
          room.co2 = env.co2 ? parseFloat(env.co2).toFixed(0) : null;
          room.vpd = env.vpd ? parseFloat(env.vpd).toFixed(2) : null;
        }
      } catch (err) {
        // Sensor data not available, continue without it
        room.temperature = null;
        room.humidity = null;
        room.co2 = null;
        room.vpd = null;
      }
      
      // Determine status based on environmental conditions
      if (!room.status || room.status === 'active') {
        room.status = 'optimal';
      }
    }
    
    res.json({ success: true, rooms });
  } catch (error) {
    console.error('Error getting farm rooms:', error);
    res.status(500).json({ error: 'Failed to get farm rooms', details: error.message });
  }
});

/**
 * DELETE /api/admin/farms/:email
 * Delete all farms and users for a given email address
 * This is used for cleanup/testing purposes
 */
router.delete('/farms/:email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.params;
    const db = req.app.locals.db;
    
    console.log(`[Admin Delete] Request to delete all farms for email: ${email}`);
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.query) {
      console.log('[Admin Delete] Database not available, cannot delete farms');
      return res.status(503).json({ 
        status: 'error',
        message: 'Farm deletion not available - database not initialized' 
      });
    }
    
    // Start transaction
    await db.query('BEGIN');
    
    try {
      // Find all farms for this email
      const farmsResult = await db.query(`
        SELECT farm_id, name FROM farms WHERE email = $1
      `, [email]);
      
      const farms = farmsResult.rows || [];
      const farmIds = farms.map(f => f.farm_id);
      
      if (farms.length === 0) {
        await db.query('ROLLBACK');
        return res.json({
          status: 'success',
          message: 'No farms found for this email',
          deleted: { farms: 0, users: 0 },
          farmIds: []
        });
      }
      
      console.log(`[Admin Delete] Found ${farms.length} farm(s) to delete:`, farmIds);
      
      // Delete users associated with these farms
      const deleteUsersResult = await db.query(`
        DELETE FROM users WHERE farm_id = ANY($1::text[])
        RETURNING user_id
      `, [farmIds]);
      
      const usersDeleted = deleteUsersResult.rows?.length || 0;
      console.log(`[Admin Delete] Deleted ${usersDeleted} user(s)`);
      
      // Delete farms
      const deleteFarmsResult = await db.query(`
        DELETE FROM farms WHERE email = $1
        RETURNING farm_id
      `, [email]);
      
      const farmsDeleted = deleteFarmsResult.rows?.length || 0;
      console.log(`[Admin Delete] Deleted ${farmsDeleted} farm(s)`);
      
      // Commit transaction
      await db.query('COMMIT');
      
      console.log(`[Admin Delete] ✅ Successfully deleted farms and users for ${email}`);
      
      res.json({
        status: 'success',
        message: `Successfully deleted ${farmsDeleted} farm(s) and ${usersDeleted} user(s)`,
        deleted: {
          farms: farmsDeleted,
          users: usersDeleted
        },
        farmIds: farmIds
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('[Admin Delete] Error deleting farms:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to delete farms',
      details: error.message 
    });
  }
});

/**
 * GET /api/admin/farms/:farmId/recipes
 * Get all grow recipes for a specific farm
 */
router.get('/farms/:farmId/recipes', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    // Query all recipes from the recipes table (shared across all farms)
    // Note: recipes are not farm-specific, they are global grow recipes
    const result = await dbQuery(`
      SELECT 
        id as recipe_id,
        name,
        category as crop_type,
        total_days as cycle_duration_days,
        description,
        data->'light_schedule' as light_schedule,
        data as environmental_params,
        data->'harvest_criteria' as harvest_criteria,
        created_at,
        updated_at,
        0 as active_trays
      FROM recipes
      ORDER BY category, name
    `);
    
    res.json({ success: true, recipes: result.rows });
  } catch (error) {
    console.error('Error getting farm recipes:', error);
    // Return empty array instead of 500 error if tables don't exist
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      console.log('[RECIPES] Database tables not yet created, returning empty recipes');
      return res.json({ success: true, recipes: [], message: 'Recipe system not yet configured' });
    }
    res.status(500).json({ error: 'Failed to get recipes', details: error.message });
  }
});

/**
 * POST /api/admin/farms/:farmId/recipes
 * Create a new grow recipe for a farm
 */
router.post('/farms/:farmId/recipes', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { name, crop_type, cycle_duration_days, description, light_schedule, nutrient_schedule, environmental_params, harvest_criteria } = req.body;
    
    if (!name || !crop_type || !cycle_duration_days) {
      return res.status(400).json({ error: 'Missing required fields: name, crop_type, cycle_duration_days' });
    }
    
    const result = await dbQuery(`
      INSERT INTO grow_recipes (farm_id, name, crop_type, cycle_duration_days, description, light_schedule, nutrient_schedule, environmental_params, harvest_criteria, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `, [farmId, name, crop_type, cycle_duration_days, description || null, light_schedule || null, nutrient_schedule || null, environmental_params || null, harvest_criteria || null, req.admin.email]);
    
    res.json({ success: true, recipe: result.rows[0] });
  } catch (error) {
    console.error('Error creating recipe:', error);
    res.status(500).json({ error: 'Failed to create recipe', details: error.message });
  }
});

/**
 * PUT /api/admin/farms/:farmId/recipes/:recipeId
 * Update a grow recipe
 */
router.put('/farms/:farmId/recipes/:recipeId', requireAdmin, async (req, res) => {
  try {
    const { farmId, recipeId } = req.params;
    const { name, crop_type, cycle_duration_days, description, light_schedule, nutrient_schedule, environmental_params, harvest_criteria, active } = req.body;
    
    const result = await dbQuery(`
      UPDATE grow_recipes
      SET name = COALESCE($1, name),
          crop_type = COALESCE($2, crop_type),
          cycle_duration_days = COALESCE($3, cycle_duration_days),
          description = COALESCE($4, description),
          light_schedule = COALESCE($5, light_schedule),
          nutrient_schedule = COALESCE($6, nutrient_schedule),
          environmental_params = COALESCE($7, environmental_params),
          harvest_criteria = COALESCE($8, harvest_criteria),
          active = COALESCE($9, active),
          updated_at = NOW()
      WHERE recipe_id = $10 AND farm_id = $11
      RETURNING *
    `, [name, crop_type, cycle_duration_days, description, light_schedule, nutrient_schedule, environmental_params, harvest_criteria, active, recipeId, farmId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    res.json({ success: true, recipe: result.rows[0] });
  } catch (error) {
    console.error('Error updating recipe:', error);
    res.status(500).json({ error: 'Failed to update recipe', details: error.message });
  }
});

/**
 * DELETE /api/admin/farms/:farmId/recipes/:recipeId
 * Delete (deactivate) a grow recipe
 */
router.delete('/farms/:farmId/recipes/:recipeId', requireAdmin, async (req, res) => {
  try {
    const { farmId, recipeId } = req.params;
    
    // Soft delete by setting active = false
    const result = await dbQuery(`
      UPDATE grow_recipes
      SET active = false, updated_at = NOW()
      WHERE recipe_id = $1 AND farm_id = $2
      RETURNING *
    `, [recipeId, farmId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    res.json({ success: true, message: 'Recipe deactivated' });
  } catch (error) {
    console.error('Error deleting recipe:', error);
    res.status(500).json({ error: 'Failed to delete recipe', details: error.message });
  }
});

/**
 * GET /api/admin/users
 * List all users across all farms
 */
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, returning sample user data');
      
      // Return sample/mock users for NeDB mode
      const sampleUsers = [
        {
          user_id: 1,
          email: 'info@greenreachfarms.com',
          first_name: 'GreenReach',
          last_name: 'Admin',
          role: 'admin',
          status: 'active',
          last_login: new Date().toISOString(),
          created_at: new Date().toISOString(),
          farm_id: 'greenreach-hq',
          farm_name: 'GreenReach Central'
        }
      ];
      
      return res.json({ success: true, users: sampleUsers, mode: 'demo' });
    }
    
    // PostgreSQL mode: Query admin users (GreenReach team)
    const result = await dbQuery(`
      SELECT 
        id as user_id,
        email,
        name,
        permissions,
        active,
        last_login,
        created_at
      FROM admin_users
      ORDER BY created_at DESC
    `);
    
    const users = result.rows.map((row) => {
      const nameParts = String(row.name || '').trim().split(/\s+/).filter(Boolean);
      const first_name = nameParts[0] || '';
      const last_name = nameParts.slice(1).join(' ') || '';
      const status = row.active === false ? 'inactive' : 'active';
      const role = Array.isArray(row.permissions) && row.permissions.includes('delete')
        ? 'admin'
        : 'viewer';
      
      return {
        user_id: row.user_id,
        email: row.email,
        first_name,
        last_name,
        role,
        status,
        last_login: row.last_login,
        created_at: row.created_at,
        farm_id: 'greenreach-central',
        farm_name: 'GreenReach Central'
      };
    });
    
    res.json({ success: true, users, mode: 'database' });
  } catch (error) {
    console.error('Error listing users:', error);
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * POST /api/admin/users
 * Create a new user
 */
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { first_name, last_name, email, role, password, farm_id } = req.body;
    
    // Validate required fields
    if (!first_name || !last_name || !email || !role) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: first_name, last_name, email, role' 
      });
    }
    
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot create users in demo mode');
      return res.status(503).json({ 
        success: false, 
        error: 'User creation not available in demo mode. Please configure database.' 
      });
    }
    
    const normalizedEmail = email.toLowerCase();

    // Check if email already exists
    const existing = await dbQuery('SELECT id FROM admin_users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ 
        success: false, 
        error: 'User with this email already exists' 
      });
    }
    
    // Hash password (required by schema)
    const tempPassword = password || crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const name = `${first_name} ${last_name}`.trim();
    const permissions = role === 'admin'
      ? ['read', 'write', 'delete']
      : ['read'];

    // Insert new admin user
    const created = await dbQuery(
      `INSERT INTO admin_users (email, password_hash, name, permissions, active, mfa_enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, true, false, NOW(), NOW())
       RETURNING id`,
      [normalizedEmail, passwordHash, name, JSON.stringify(permissions)]
    );
    
    res.json({ 
      success: true, 
      user_id: created.rows[0].id,
      message: 'User created successfully',
      temp_password: password ? undefined : tempPassword
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

/**
 * PUT /api/admin/users/:userId
 * Update an existing user
 */
router.put('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { first_name, last_name, email, role, status, password } = req.body;
    
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot update users in demo mode');
      return res.status(503).json({ 
        success: false, 
        error: 'User updates not available in demo mode. Please configure database.' 
      });
    }
    
    // Check if user exists
    const existing = await dbQuery('SELECT id FROM admin_users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramIndex = 1;
    
    if (first_name !== undefined || last_name !== undefined) {
      const name = `${first_name || ''} ${last_name || ''}`.trim();
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex++}`);
      values.push(email.toLowerCase());
    }
    if (role !== undefined) {
      const permissions = role === 'admin'
        ? ['read', 'write', 'delete']
        : ['read'];
      updates.push(`permissions = $${paramIndex++}`);
      values.push(JSON.stringify(permissions));
    }
    if (status !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(status === 'active');
    }
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      updates.push(`password_hash = $${paramIndex++}`);
      values.push(passwordHash);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    
    updates.push('updated_at = NOW()');
    values.push(userId);
    
    await dbQuery(
      `UPDATE admin_users 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}`,
      values
    );
    
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Delete a user
 */
router.delete('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot delete users in demo mode');
      return res.status(503).json({ 
        success: false, 
        error: 'User deletion not available in demo mode. Please configure database.' 
      });
    }
    
    // Check if user exists
    const existing = await dbQuery('SELECT id FROM admin_users WHERE id = $1', [userId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    
    // Soft delete by setting status to inactive
    await dbQuery(
      `UPDATE admin_users 
       SET active = false, updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

/**
 * POST /api/admin/farms/:farmId/reset-credentials
 * Reset farm credentials (password, API keys)
 */
router.post('/farms/:farmId/reset-credentials', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Get farm
    const farm = await db.get('SELECT * FROM farms WHERE farm_id = ?', [farmId]);
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Update admin user password
    await db.run(
      `UPDATE users SET password_hash = ?, must_change_password = 1 
       WHERE farm_id = ? AND role = 'admin' LIMIT 1`,
      [passwordHash, farmId]
    );
    
    // Regenerate API keys
    const newApiKey = 'lef_' + crypto.randomBytes(32).toString('hex');
    await db.run(
      'UPDATE farms SET api_key = ? WHERE farm_id = ?',
      [newApiKey, farmId]
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'RESET_CREDENTIALS', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId }), req.ip]
    );
    
    res.json({ 
      success: true, 
      email: farm.email,
      temp_password: tempPassword,
      message: 'Credentials reset successfully'
    });
  } catch (error) {
    console.error('Error resetting farm credentials:', error);
    res.status(500).json({ error: 'Failed to reset credentials' });
  }
});

/**
 * POST /api/admin/users/:userId/reset-password
 * Reset user password
 */
router.post('/users/:userId/reset-password', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = await initDatabase();
    
    // Get user
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Update password
    await db.run(
      'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
      [passwordHash, userId]
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'RESET_PASSWORD', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, email: user.email }), req.ip]
    );
    
    res.json({ 
      success: true, 
      temp_password: tempPassword,
      message: 'Password reset successfully'
    });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * POST /api/admin/farms/lookup-by-email
 * Look up farm by email address (for password recovery/resend credentials)
 */
router.post('/farms/lookup-by-email', requireAdmin, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const db = await initDatabase();
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available for email lookup');
      return res.status(503).json({ 
        error: 'Database not available',
        message: 'PostgreSQL database required for this operation'
      });
    }
    
    // Look up user by email
    const userResult = await db.query(
      `SELECT u.*, f.name as farm_name, f.farm_id, f.api_key, f.status as farm_status
       FROM users u
       JOIN farms f ON u.farm_id = f.farm_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    
    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Not found',
        message: 'No account found with this email address'
      });
    }
    
    const user = userResult.rows[0];
    
    res.json({
      success: true,
      found: true,
      farm_id: user.farm_id,
      farm_name: user.farm_name,
      farm_status: user.farm_status,
      user_name: user.name,
      user_role: user.role,
      user_status: user.is_active ? 'active' : 'inactive',
      created_at: user.created_at
    });
    
  } catch (error) {
    console.error('Error looking up farm by email:', error);
    res.status(500).json({ error: 'Failed to look up farm' });
  }
});

/**
 * PATCH /api/admin/farms/:farmId/status
 * Toggle farm status (active/suspended)
 */
router.patch('/farms/:farmId/status', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const { status } = req.body;
    const db = await initDatabase();
    
    if (!['active', 'suspended', 'pending', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await db.run('UPDATE farms SET status = ? WHERE farm_id = ?', [status, farmId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_STATUS', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId, new_status: status }), req.ip]
    );
    
    res.json({ success: true, message: 'Farm status updated' });
  } catch (error) {
    console.error('Error updating farm status:', error);
    res.status(500).json({ error: 'Failed to update farm status' });
  }
});

/**
 * PATCH /api/admin/users/:userId/status
 * Toggle user status (active/disabled)
 */
router.patch('/users/:userId/status', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { status } = req.body;
    const db = await initDatabase();
    
    if (!['active', 'disabled'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await db.run('UPDATE users SET status = ? WHERE id = ?', [status, userId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_STATUS', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, new_status: status }), req.ip]
    );
    
    res.json({ success: true, message: 'User status updated' });
  } catch (error) {
    console.error('Error updating user status:', error);
    res.status(500).json({ error: 'Failed to update user status' });
  }
});

/**
 * PATCH /api/admin/users/:userId/role
 * Change user role
 */
router.patch('/users/:userId/role', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { role } = req.body;
    const db = await initDatabase();
    
    const validRoles = ['admin', 'manager', 'user', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    await db.run('UPDATE users SET role = ? WHERE id = ?', [role, userId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_ROLE', 'user', ?, ?, ?)`,
      [req.admin.admin_id, userId, JSON.stringify({ user_id: userId, new_role: role }), req.ip]
    );
    
    res.json({ success: true, message: 'User role updated' });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

/**
 * POST /api/admin/impersonate/:farmId
 * Generate impersonation token for support
 */
router.post('/impersonate/:farmId', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const db = await initDatabase();
    
    // Get farm
    const farm = await db.get('SELECT * FROM farms WHERE farm_id = ?', [farmId]);
    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }
    
    // Get farm admin user
    const adminUser = await db.get(
      'SELECT * FROM users WHERE farm_id = ? AND role = "admin" LIMIT 1',
      [farmId]
    );
    
    if (!adminUser) {
      return res.status(404).json({ error: 'Farm admin user not found' });
    }
    
    // Generate impersonation token (1 hour expiry)
    const token = jwt.sign(
      { 
        user_id: adminUser.id,
        farm_id: farmId,
        email: adminUser.email,
        role: 'admin',
        impersonated_by: req.admin.admin_id,
        impersonation: true
      },
      getJwtSecret(),
      { expiresIn: '1h' }
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'IMPERSONATE', 'farm', ?, ?, ?)`,
      [req.admin.admin_id, farmId, JSON.stringify({ farm_id: farmId, target_user: adminUser.email }), req.ip]
    );
    
    res.json({ 
      success: true, 
      token,
      expires_in: '1h',
      message: 'Impersonation token generated'
    });
  } catch (error) {
    console.error('Error generating impersonation token:', error);
    res.status(500).json({ error: 'Failed to generate impersonation token' });
  }
});

/**
 * Get farm inventory/trays
 * GET /api/admin/farms/:farmId/inventory
 */
router.get('/farms/:farmId/inventory', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const trays = await dbQuery(`
      SELECT 
        gt.tray_id,
        gt.tray_code,
        gt.location,
        gt.plant_count,
        gt.seed_date,
        gt.expected_harvest_date,
        gt.age_days,
        gt.status,
        gt.notes,
        gr.name as recipe_name,
        gr.crop_type,
        gr.cycle_duration_days,
        CASE 
          WHEN gt.expected_harvest_date IS NOT NULL THEN 
            EXTRACT(DAY FROM (gt.expected_harvest_date - CURRENT_DATE))
          ELSE NULL 
        END as days_to_harvest
      FROM grow_trays gt
      LEFT JOIN grow_recipes gr ON gt.recipe_id = gr.recipe_id
      WHERE gt.farm_id = $1
      ORDER BY gt.status ASC, gt.expected_harvest_date ASC
    `, [farmId]);
    
    res.json({ success: true, trays });
  } catch (error) {
    console.error('Error fetching farm inventory:', error);
    // Return empty array instead of 500 error if tables don't exist
    if (error.message?.includes('relation') && error.message?.includes('does not exist')) {
      console.log('[INVENTORY] Database tables not yet created, returning empty inventory');
      return res.json({ success: true, trays: [], message: 'Inventory system not yet configured' });
    }
    res.status(500).json({ error: 'Failed to fetch inventory', details: error.message });
  }
});

/**
 * Get farm devices
 * GET /api/admin/farms/:farmId/devices
 */
router.get('/farms/:farmId/devices', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    
    const devices = await dbQuery(`
      SELECT 
        device_id,
        device_code,
        device_name,
        device_type,
        vendor,
        model,
        firmware_version,
        location,
        status,
        last_seen,
        created_at
      FROM devices
      WHERE farm_id = $1
      ORDER BY device_type ASC, device_code ASC
    `, [farmId]);
    
    res.json({ success: true, devices });
  } catch (error) {
    console.error('Error fetching farm devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

/**
 * Get farm analytics/metrics
 * GET /api/admin/analytics/farms/:farmId/metrics?days=30
 */
router.get('/analytics/farms/:farmId/metrics', requireAdmin, async (req, res) => {
  try {
    const { farmId } = req.params;
    const days = Math.min(parseInt(req.query.days) || 30, 365); // Max 365 days
    
    const result = await dbQuery(`
      SELECT 
        metric_id,
        farm_id,
        date,
        production_kg,
        revenue,
        costs,
        efficiency_score,
        trays_seeded,
        trays_harvested,
        orders_fulfilled,
        notes,
        created_at,
        updated_at
      FROM farm_daily_metrics
      WHERE farm_id = $1 AND date >= CURRENT_DATE - $2::integer * INTERVAL '1 day'
      ORDER BY date DESC
    `, [farmId, days]);
    
    const metrics = result.rows || [];
    
    // Calculate summary stats
    const summary = {
      totalProduction: 0,
      totalRevenue: 0,
      totalCosts: 0,
      avgEfficiency: 0,
      totalOrders: 0,
      daysReported: metrics.length
    };
    
    metrics.forEach(m => {
      summary.totalProduction += parseFloat(m.production_kg) || 0;
      summary.totalRevenue += parseFloat(m.revenue) || 0;
      summary.totalCosts += parseFloat(m.costs) || 0;
      summary.avgEfficiency += parseFloat(m.efficiency_score) || 0;
      summary.totalOrders += m.orders_fulfilled || 0;
    });
    
    if (metrics.length > 0) {
      summary.avgEfficiency = summary.avgEfficiency / metrics.length;
      summary.netProfit = summary.totalRevenue - summary.totalCosts;
    }
    
    res.json({ success: true, metrics, summary });
  } catch (error) {
    console.error('Error fetching farm metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * Get buyer analytics/insights
 * GET /api/admin/analytics/buyers/:buyerId/insights?days=90
 */
router.get('/analytics/buyers/:buyerId/insights', requireAdmin, async (req, res) => {
  try {
    const { buyerId } = req.params;
    const days = Math.min(parseInt(req.query.days) || 90, 365); // Max 365 days
    
    const result = await dbQuery(`
      SELECT 
        summary_id,
        buyer_id,
        date,
        order_count,
        total_spent,
        avg_order_value,
        items_purchased,
        created_at,
        updated_at
      FROM buyer_order_summary
      WHERE buyer_id = $1 AND date >= CURRENT_DATE - $2::integer * INTERVAL '1 day'
      ORDER BY date DESC
    `, [buyerId, days]);
    
    const insights = result.rows || [];
    
    // Calculate summary stats
    const summary = {
      totalOrders: 0,
      totalSpent: 0,
      avgOrderValue: 0,
      totalItems: 0,
      daysActive: insights.length
    };
    
    insights.forEach(i => {
      summary.totalOrders += i.order_count || 0;
      summary.totalSpent += parseFloat(i.total_spent) || 0;
      summary.totalItems += i.items_purchased || 0;
    });
    
    if (summary.totalOrders > 0) {
      summary.avgOrderValue = summary.totalSpent / summary.totalOrders;
    }
    
    res.json({ success: true, insights, summary });
  } catch (error) {
    console.error('Error fetching buyer insights:', error);
    res.status(500).json({ error: 'Failed to fetch buyer insights' });
  }
});

/**
 * GET /api/admin/wholesale/orders
 * List all wholesale orders (admin view)
 */
router.get('/wholesale/orders', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    if (!db) {
      return res.status(500).json({ 
        status: 'error', 
        error: 'Database connection error' 
      });
    }

    // Check if master_orders table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'master_orders'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      return res.json({
        status: 'ok',
        orders: [],
        count: 0,
        message: 'Wholesale orders table not yet created'
      });
    }

    // Query all orders with farm sub-orders (PostgreSQL syntax)
    const result = await db.query(`
      SELECT 
        o.*,
        COALESCE(
          json_agg(
            json_build_object(
              'id', so.id,
              'farm_id', so.farm_id,
              'status', so.status,
              'line_items', so.line_items,
              'subtotal', so.subtotal,
              'broker_fee_amount', so.broker_fee_amount,
              'tax_amount', so.tax_amount,
              'total', so.total
            )
          ) FILTER (WHERE so.id IS NOT NULL), '[]'
        ) as sub_orders
      FROM master_orders o
      LEFT JOIN farm_sub_orders so ON o.id = so.master_order_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
      LIMIT 100
    `);

    const orders = result.rows;

    res.json({
      status: 'ok',
      orders: orders,
      count: orders.length
    });

  } catch (error) {
    console.error('[Admin Wholesale Orders] List error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Failed to fetch orders',
      details: error.message
    });
  }
});

/**
 * POST /api/admin/run-migration/wholesale-password-reset
 * One-time endpoint to run password reset migration
 */
router.post('/run-migration/wholesale-password-reset', requireAdmin, async (req, res) => {
  try {
    const db = req.app.locals.db;
    
    if (!db) {
      return res.status(500).json({ 
        status: 'error', 
        error: 'Database connection error' 
      });
    }

    console.log('[Admin Migration] Running wholesale password reset migration...');

    // Add password reset columns
    await db.query(`
      ALTER TABLE wholesale_buyers 
        ADD COLUMN IF NOT EXISTS password_reset_token TEXT,
        ADD COLUMN IF NOT EXISTS password_reset_expires TIMESTAMP;
    `);

    // Create index
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_reset_token 
        ON wholesale_buyers(password_reset_token) 
        WHERE password_reset_token IS NOT NULL;
    `);

    console.log('[Admin Migration] ✅ Migration completed successfully');

    res.json({
      status: 'ok',
      message: 'Wholesale password reset migration completed successfully'
    });

  } catch (error) {
    console.error('[Admin Migration] Error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Migration failed',
      details: error.message
    });
  }
});

/**
 * POST /api/admin/farms/reset-user-password
 * Reset password for an LE user (for support purposes)
 */
router.post('/farms/reset-user-password', requireAdmin, async (req, res) => {
  try {
    const { farmId, email } = req.body;
    
    if (!farmId || !email) {
      return res.status(400).json({ 
        status: 'error',
        message: 'Farm ID and email are required' 
      });
    }

    const db = await initDatabase();
    
    if (!db || !db.pool) {
      return res.status(503).json({ 
        status: 'error',
        message: 'Database not available'
      });
    }

    // Find user
    const userResult = await db.query(
      `SELECT user_id, email, name, farm_id 
       FROM users 
       WHERE farm_id = $1 AND LOWER(email) = LOWER($2)`,
      [farmId, email]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        status: 'error',
        message: 'User not found with this farm ID and email' 
      });
    }

    const user = userResult.rows[0];

    // Generate temporary password
    const tempPassword = crypto.randomBytes(8).toString('base64url');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Update password
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE user_id = $2',
      [passwordHash, user.user_id]
    );

    console.log(`[Admin] Password reset for user ${email} in farm ${farmId}`);

    res.json({ 
      status: 'success',
      message: 'Password reset successfully',
      tempPassword: tempPassword,
      farmId: farmId,
      email: user.email
    });

  } catch (error) {
    console.error('[Admin] Reset user password error:', error);
    res.status(500).json({ 
      status: 'error',
      message: 'Failed to reset password',
      error: error.message
    });
  }
});

// ============================================================================
// RECIPE MANAGEMENT ROUTES
// ============================================================================

/**
 * GET /api/admin/recipes
 * List all recipes with filtering and pagination
 */
router.get('/recipes', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    const { category, search, page = 1, limit = 50 } = req.query;
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot list recipes');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }
    
    // PostgreSQL mode: Query actual database
    const offset = (parseInt(page) - 1) * parseInt(limit);
    let whereClause = [];
    let params = [];
    let paramIndex = 1;
    
    if (category) {
      whereClause.push(`category = $${paramIndex++}`);
      params.push(category);
    }
    
    if (search) {
      whereClause.push(`name ILIKE $${paramIndex++}`);
      params.push(`%${search}%`);
    }
    
    const whereSQL = whereClause.length > 0 ? 'WHERE ' + whereClause.join(' AND ') : '';
    
    // Get total count
    const countResult = await dbQuery(
      `SELECT COUNT(*) as total FROM recipes ${whereSQL}`,
      params
    );
    const total = parseInt(countResult.rows[0].total);
    
    // Get recipes
    params.push(parseInt(limit), offset);
    const result = await dbQuery(
      `SELECT id, name, category, description, total_days, data,
              jsonb_array_length(data->'schedule') as schedule_length,
              created_at, updated_at
       FROM recipes
       ${whereSQL}
       ORDER BY category, name
       LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
      params
    );
    
    res.json({
      ok: true,
      recipes: result.rows,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error listing recipes:', error);
    res.status(500).json({ error: 'Failed to list recipes', details: error.message });
  }
});

/**
 * GET /api/admin/recipes/:id
 * Get full recipe details including schedule data
 */
router.get('/recipes/:id', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    const { id } = req.params;
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot fetch recipe');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }
    
    // PostgreSQL mode: Query actual database
    const result = await dbQuery(
      'SELECT * FROM recipes WHERE id = $1',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    res.json({
      ok: true,
      recipe: result.rows[0],
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error fetching recipe:', error);
    res.status(500).json({ error: 'Failed to fetch recipe', details: error.message });
  }
});

/**
 * POST /api/admin/recipes
 * Create new recipe
 */
router.post('/recipes', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    const { name, category, description, total_days, data } = req.body;
    
    // Validate required fields
    if (!name || !category || !data) {
      return res.status(400).json({ error: 'Missing required fields: name, category, data' });
    }
    
    // Validate data structure
    if (!data.schedule || !Array.isArray(data.schedule)) {
      return res.status(400).json({ error: 'Invalid data format: schedule array required' });
    }
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot create recipe');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }
    
    // PostgreSQL mode: Insert into database
    const result = await dbQuery(
      `INSERT INTO recipes (name, category, description, total_days, data)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, category, description, total_days, JSON.stringify(data)]
    );
    
    console.log(`[ADMIN RECIPES] Created recipe: ${name} (ID: ${result.rows[0].id})`);
    
    res.status(201).json({
      ok: true,
      message: 'Recipe created successfully',
      recipe: result.rows[0],
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error creating recipe:', error);
    if (error.code === '23505') { // unique_violation
      return res.status(409).json({ error: 'Recipe with this name already exists' });
    }
    res.status(500).json({ error: 'Failed to create recipe', details: error.message });
  }
});

/**
 * PUT /api/admin/recipes/:id
 * Update existing recipe
 */
router.put('/recipes/:id', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    const { id } = req.params;
    const { name, category, description, total_days, data } = req.body;
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot update recipe');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }
    
    // PostgreSQL mode: Update database
    // Check if recipe exists
    const existing = await dbQuery('SELECT id FROM recipes WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    // Build update query dynamically based on provided fields
    const updates = [];
    const params = [];
    let paramIndex = 1;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      params.push(name);
    }
    if (category !== undefined) {
      updates.push(`category = $${paramIndex++}`);
      params.push(category);
    }
    if (description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      params.push(description);
    }
    if (total_days !== undefined) {
      updates.push(`total_days = $${paramIndex++}`);
      params.push(total_days);
    }
    if (data !== undefined) {
      if (!data.schedule || !Array.isArray(data.schedule)) {
        return res.status(400).json({ error: 'Invalid data format: schedule array required' });
      }
      updates.push(`data = $${paramIndex++}`);
      params.push(JSON.stringify(data));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    updates.push(`updated_at = NOW()`);
    params.push(id);
    
    const result = await dbQuery(
      `UPDATE recipes 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      params
    );
    
    console.log(`[ADMIN RECIPES] Updated recipe ID ${id}: ${result.rows[0].name}`);
    
    res.json({
      ok: true,
      message: 'Recipe updated successfully',
      recipe: result.rows[0],
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error updating recipe:', error);
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Recipe name already exists' });
    }
    res.status(500).json({ error: 'Failed to update recipe', details: error.message });
  }
});

/**
 * DELETE /api/admin/recipes/:id
 * Delete recipe
 */
router.delete('/recipes/:id', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();
    const { id } = req.params;
    
    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot delete recipe');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }
    
    // PostgreSQL mode: Delete from database
    const result = await dbQuery(
      'DELETE FROM recipes WHERE id = $1 RETURNING name',
      [id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Recipe not found' });
    }
    
    console.log(`[ADMIN RECIPES] Deleted recipe ID ${id}: ${result.rows[0].name}`);
    
    res.json({
      ok: true,
      message: 'Recipe deleted successfully',
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error deleting recipe:', error);
    res.status(500).json({ error: 'Failed to delete recipe', details: error.message });
  }
});

/**
 * GET /api/admin/recipes/categories/list
 * Get list of unique recipe categories
 */
router.get('/recipes/categories/list', requireAdmin, async (req, res) => {
  try {
    const db = await initDatabase();

    // Check if database is available (PostgreSQL mode)
    if (!db || !db.pool || db.mode === 'nedb') {
      console.log('[Admin] Database not available, cannot list recipe categories');
      return res.status(503).json({
        error: 'Database not available',
        message: 'Recipes require PostgreSQL. Set DB_ENABLED=true and configure DB_HOST/DB_NAME/DB_USER/DB_PASSWORD in the environment.',
        mode: 'database_unavailable'
      });
    }

    const result = await dbQuery(
      `SELECT DISTINCT category, COUNT(*) as count
       FROM recipes
       GROUP BY category
       ORDER BY category`
    );
    
    res.json({
      ok: true,
      categories: result.rows,
      mode: 'database'
    });
  } catch (error) {
    console.error('[ADMIN RECIPES] Error listing categories:', error);
    res.status(500).json({ error: 'Failed to list categories', details: error.message });
  }
});

/**
 * POST /api/admin/users
 * Create a new GreenReach employee user
 */
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, first_name, last_name, role, password } = req.body;
    
    // Validate required fields
    if (!email || !first_name || !last_name || !role) {
      return res.status(400).json({ error: 'Missing required fields: email, first_name, last_name, role' });
    }
    
    // Validate role
    const validRoles = ['admin', 'operations', 'support', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be: admin, operations, support, or viewer' });
    }
    
    const db = await initDatabase();
    
    // Check if database is available
    if (!db || !db.pool || db.mode === 'nedb') {
      return res.status(503).json({ 
        error: 'Database not available. User management requires PostgreSQL database.',
        mode: 'demo'
      });
    }
    
    // Check if email already exists
    const existingUser = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existingUser) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    
    // Generate password hash
    const tempPassword = password || crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    
    // Insert user
    const result = await db.run(
      `INSERT INTO users (email, first_name, last_name, role, password_hash, status, farm_id, created_at)
       VALUES (?, ?, ?, ?, ?, 'active', 'greenreach-hq', datetime('now'))`,
      [email, first_name, last_name, role, passwordHash]
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'CREATE_USER', 'user', ?, ?, ?)`,
      [req.admin.admin_id || req.admin.email, result.lastID, JSON.stringify({ email, role }), req.ip]
    );
    
    res.json({ 
      success: true, 
      message: 'User created successfully',
      user: {
        user_id: result.lastID,
        email,
        first_name,
        last_name,
        role,
        status: 'active',
        temporary_password: !password ? tempPassword : undefined
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

/**
 * PUT /api/admin/users/:userId
 * Update user details
 */
router.put('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, first_name, last_name, role } = req.body;
    const db = await initDatabase();
    
    if (!db || !db.pool || db.mode === 'nedb') {
      return res.status(503).json({ error: 'Database not available', mode: 'demo' });
    }
    
    // Validate role if provided
    if (role) {
      const validRoles = ['admin', 'operations', 'support', 'viewer'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
    }
    
    // Check if user exists
    const existingUser = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Build update query dynamically
    const updates = [];
    const params = [];
    
    if (email) {
      // Check email uniqueness
      const emailCheck = await db.get('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (emailCheck) {
        return res.status(409).json({ error: 'Email already in use' });
      }
      updates.push('email = ?');
      params.push(email);
    }
    if (first_name) {
      updates.push('first_name = ?');
      params.push(first_name);
    }
    if (last_name) {
      updates.push('last_name = ?');
      params.push(last_name);
    }
    if (role) {
      updates.push('role = ?');
      params.push(role);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    params.push(userId);
    
    await db.run(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'UPDATE_USER', 'user', ?, ?, ?)`,
      [req.admin.admin_id || req.admin.email, userId, JSON.stringify({ userId, updates: { email, first_name, last_name, role } }), req.ip]
    );
    
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

/**
 * DELETE /api/admin/users/:userId
 * Delete a user (soft delete - set status to deleted)
 */
router.delete('/users/:userId', requireAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = await initDatabase();
    
    if (!db || !db.pool || db.mode === 'nedb') {
      return res.status(503).json({ error: 'Database not available', mode: 'demo' });
    }
    
    // Check if user exists
    const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Prevent deleting yourself
    if (user.email === req.admin.email) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }
    
    // Soft delete: set status to 'deleted'
    await db.run('UPDATE users SET status = ?, deleted_at = datetime(\'now\') WHERE id = ?', ['deleted', userId]);
    
    // Log action
    await db.run(
      `INSERT INTO admin_audit_log (admin_id, action, resource_type, resource_id, metadata, ip_address)
       VALUES (?, 'DELETE_USER', 'user', ?, ?, ?)`,
      [req.admin.admin_id || req.admin.email, userId, JSON.stringify({ userId, email: user.email }), req.ip]
    );
    
    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

export default router;

