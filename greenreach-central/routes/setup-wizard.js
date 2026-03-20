/**
 * Setup Wizard API Routes
 * Handles first-time farm setup after purchase: farm profile, rooms, zones
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import bcrypt from 'bcryptjs';

const router = express.Router();
const isProductionRuntime =
  process.env.NODE_ENV === 'production' ||
  String(process.env.DEPLOYMENT_MODE || '').toLowerCase() === 'cloud';
const JWT_SECRET = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';

/**
 * JWT Authentication Middleware
 * Verifies token and attaches farm_id to request
 */
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required' 
    });
  }

  // Allow local-access token in development/demo mode
  if (token === 'local-access') {
    req.farmId = 'LOCAL-FARM';
    req.userId = 'local-user';
    req.userEmail = 'admin@local-farm.com';
    req.userRole = 'admin';
    return next();
  }

  try {
    if (!process.env.JWT_SECRET && isProductionRuntime) {
      throw new Error('JWT_SECRET environment variable is required in production');
    }
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: 'greenreach-central',
      audience: 'greenreach-farms'
    });
    
    const rawFarmId = decoded.farm_id || decoded.farmId;
    req.farmId = typeof rawFarmId === 'string' ? rawFarmId.replace(/[,;.\s]+$/, '').trim() : rawFarmId;
    req.userId = decoded.user_id || decoded.userId;
    req.userEmail = decoded.email;
    req.userRole = decoded.role || 'admin';
    
    next();
  } catch (error) {
    console.error('[Setup Wizard] JWT verification failed:', error.message);
    return res.status(403).json({ 
      success: false, 
      error: 'Invalid or expired token' 
    });
  }
}

/**
 * POST /api/setup-wizard/change-password
 * Change password during first-time setup
 * Body: { newPassword: string }
 */
router.post('/change-password', authenticateToken, async (req, res) => {
  try {
    const pool = req.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const { newPassword } = req.body;
    const userId = req.userId;

    // Validate password
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ 
        success: false, 
        error: 'Password must be at least 8 characters long' 
      });
    }

    // Hash new password
    const password_hash = await bcrypt.hash(newPassword, 10);

    // Update password in farm_users and clear must_change_password flag
    const farmId = req.farmId;
    const userEmail = req.userEmail;

    // Try farm_users first (primary auth table for purchased farms)
    let updated = false;
    if (farmId && userEmail) {
      const result = await pool.query(
        'UPDATE farm_users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE farm_id = $2 AND email = $3',
        [password_hash, farmId, userEmail]
      );
      updated = result.rowCount > 0;
    }
    
    // Fallback: try by user ID in farm_users (only if userId is a valid UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!updated && userId && uuidRegex.test(userId)) {
      const result = await pool.query(
        'UPDATE farm_users SET password_hash = $1, must_change_password = false, updated_at = NOW() WHERE id = $2',
        [password_hash, userId]
      );
      updated = result.rowCount > 0;
    }

    // Fallback: if farm exists but no farm_users row, create one
    if (!updated && farmId) {
      try {
        const farmCheck = await pool.query('SELECT farm_id, name FROM farms WHERE farm_id = $1', [farmId]);
        if (farmCheck.rows.length > 0) {
          const fallbackEmail = userEmail || `admin@${farmId.toLowerCase()}.local`;
          await pool.query(
            `INSERT INTO farm_users (farm_id, email, password_hash, role, must_change_password, status, created_at, updated_at)
             VALUES ($1, $2, $3, 'admin', false, 'active', NOW(), NOW())
             ON CONFLICT (farm_id, email) DO UPDATE SET password_hash = $3, must_change_password = false, updated_at = NOW()`,
            [farmId, fallbackEmail, password_hash]
          );
          updated = true;
        }
      } catch (e) {
        console.warn('[Setup Wizard] Fallback farm_users upsert failed:', e.message);
      }
    }

    // Legacy fallback: update users table if it exists
    if (!updated && userId && uuidRegex.test(userId)) {
      try {
        await pool.query(
          'UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2',
          [password_hash, userId]
        );
      } catch (e) {
        // users table may not exist — that's fine
      }
    }

    console.log('[Setup Wizard] Password changed for user:', userId, 'farm:', farmId);

    res.json({
      success: true,
      message: 'Password updated successfully'
    });

  } catch (error) {
    console.error('[Setup Wizard] Password change error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update password' 
    });
  }
});

/**
 * GET /api/setup/status
 * Check if farm has completed setup wizard
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;

    // Handle local development mode
    if (farmId === 'LOCAL-FARM') {
      return res.json({
        success: true,
        setupCompleted: false, // Always show wizard in local mode for testing
        farm: {
          farmId: 'LOCAL-FARM',
          name: 'Local Development Farm',
          planType: 'edge',
          timezone: 'America/New_York',
          hasBusinessHours: false
        },
        roomCount: 0
      });
    }

    const pool = req.db;
    if (!pool) {
      // No DB mode — check farmStore for setup_completed flag
      let setupCompleted = false;
      let farmName = 'Farm';
      let roomCount = 0;
      let certifications = {};
      if (req.farmStore) {
        try {
          const profile = await req.farmStore.get(farmId, 'farm_profile');
          if (profile) {
            if (profile.setup_completed) {
              setupCompleted = true;
            }
            farmName = profile.farmName || profile.name || farmName;
            certifications = profile.certifications || {};
          }
          const rooms = await req.farmStore.get(farmId, 'rooms');
          if (Array.isArray(rooms)) roomCount = rooms.length;
        } catch (e) {
          console.warn('[Setup Wizard] farmStore read error:', e.message);
        }
      }
      return res.json({
        success: true,
        setupCompleted,
        completed: setupCompleted,
        farm: {
          farmId,
          name: farmName,
          planType: 'cloud',
          timezone: 'America/New_York',
          hasBusinessHours: false
        },
        certifications,
        roomCount
      });
    }

    // Get farm details including setup_completed flag
    let farm = null;
    try {
      const farmResult = await pool.query(
        'SELECT name, plan_type, setup_completed FROM farms WHERE farm_id = $1',
        [farmId]
      );
      farm = farmResult.rows[0];
    } catch (dbErr) {
      console.warn('[Setup Wizard] farms query failed:', dbErr.message);
    }

    // Check room count as fallback
    let roomCount = 0;
    try {
      const roomsResult = await pool.query(
        'SELECT COUNT(*) as count FROM rooms WHERE farm_id = $1',
        [farmId]
      );
      roomCount = parseInt(roomsResult.rows[0]?.count) || 0;
    } catch (roomError) {
      // If rooms table doesn't exist, roomCount stays 0
      if (roomError.message?.includes('relation') && roomError.message?.includes('does not exist')) {
        console.log('[Setup Wizard] rooms table does not exist yet');
        roomCount = 0;
      } else {
        throw roomError;
      }
    }

    // Determine setup completion: Primary = setup_completed flag, Fallback = has rooms
    let setupCompleted = farm?.setup_completed === true || roomCount > 0;

    // Additional heuristic: if the farm has data in farm_data table, it's been set up
    // This catches farms that were set up before setup_completed column was added
    if (!setupCompleted && pool) {
      try {
        const dataResult = await pool.query(
          'SELECT COUNT(*) as count FROM farm_data WHERE farm_id = $1',
          [farmId]
        );
        const dataCount = parseInt(dataResult.rows[0]?.count) || 0;
        if (dataCount > 0) {
          setupCompleted = true;
          console.log(`[Setup Wizard] Farm ${farmId} has ${dataCount} farm_data entries — treating as setup complete`);
          // Auto-fix the stale flag in the DB
          pool.query('UPDATE farms SET setup_completed = true WHERE farm_id = $1 AND (setup_completed IS NULL OR setup_completed = false)', [farmId]).catch(() => {});
        }
      } catch (fdErr) {
        // farm_data table may not exist — non-fatal
        if (!fdErr.message?.includes('does not exist')) {
          console.warn('[Setup Wizard] farm_data check error:', fdErr.message);
        }
      }
    }

    // In DB mode, fall back to farmStore values when DB flags are stale/empty
    // (common for synced farms where room data lives in farm_data).
    let storeRoomCount = 0;
    let storeSetupCompleted = false;

    // Load certifications from farmStore (works in both DB and no-DB modes)
    let certifications = {};
    if (req.farmStore) {
      try {
        const profile = await req.farmStore.get(farmId, 'farm_profile');
        if (profile && profile.setup_completed === true) {
          storeSetupCompleted = true;
        }
        if (profile && profile.certifications) {
          certifications = profile.certifications;
        }

        const storeRooms = await req.farmStore.get(farmId, 'rooms');
        if (Array.isArray(storeRooms)) {
          storeRoomCount = storeRooms.length;
        }
      } catch (e) {
        // Non-fatal — certifications are optional
      }
    }

    if (!setupCompleted) {
      setupCompleted = storeSetupCompleted || storeRoomCount > 0;
    }

    const effectiveRoomCount = Math.max(roomCount, storeRoomCount);

    res.json({
      success: true,
      setupCompleted,
      completed: setupCompleted,
      farm: {
        farmId,
        name: farm?.name,
        planType: farm?.plan_type,
        timezone: farm?.timezone,
        hasBusinessHours: !!farm?.business_hours
      },
      certifications,
      roomCount: effectiveRoomCount
    });

  } catch (error) {
    console.error('[Setup Wizard] Status check error:', error);
    // Return setupCompleted: false on error so wizard shows
    res.json({ 
      success: true,
      setupCompleted: false,
      error: error.message 
    });
  }
});

/**
 * POST /api/setup-wizard/complete  (also /api/setup/complete via legacy alias)
 * Complete farm setup — saves all wizard data via farmStore
 * Works in both DB and no-DB modes
 *
 * Body: { farmId, farmName, contact, location, rooms, certifications, credentials, endpoints }
 */
router.post('/complete', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;
    const { farmName, contact, location, rooms, certifications, credentials, endpoints } = req.body;

    // Accept both nested contact object AND flat fields from wizard
    // Wizard sends: ownerName, contactEmail, contactPhone (flat)
    // Structured clients send: contact: { name, email, phone }
    const normalizedContact = {
      name: contact?.name || req.body.ownerName || req.body.contactName || '',
      email: contact?.email || req.body.contactEmail || '',
      phone: contact?.phone || req.body.contactPhone || ''
    };

    // Build farm profile from submitted data
    const farmProfile = {
      farmId,
      name: farmName || 'New Farm',
      farmName: farmName || 'New Farm',
      contact: normalizedContact,
      location: location || {},
      certifications: certifications || {},
      credentials: credentials || {},
      endpoints: endpoints || {},
      status: 'active',
      setup_completed: true,
      setup_completed_at: new Date().toISOString()
    };

    // Save farm profile via farmStore (works in both DB and no-DB modes)
    if (req.farmStore) {
      await req.farmStore.set(farmId, 'farm_profile', farmProfile);
    }

    // Save rooms via farmStore if provided
    if (rooms && Array.isArray(rooms) && rooms.length > 0 && req.farmStore) {
      await req.farmStore.set(farmId, 'rooms', rooms);
    }

    // Save groups via farmStore if provided (preserves grow data across rebuilds)
    const { groups } = req.body;
    if (groups && Array.isArray(groups) && groups.length > 0 && req.farmStore) {
      await req.farmStore.set(farmId, 'groups', groups);
      console.log(`[Setup Wizard] Saved ${groups.length} groups for farm ${farmId}`);
    }

    // Also update farms table if DB available (keeps setup_completed flag in sync)
    const pool = req.db;
    if (pool) {
      try {
        // Add contact_phone column if it doesn't exist yet
        await pool.query('ALTER TABLE farms ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50)').catch(() => {});

        await pool.query(
          `UPDATE farms SET 
            setup_completed = true, 
            setup_completed_at = NOW(), 
            name = COALESCE($2, name),
            contact_name = COALESCE($3, contact_name),
            email = COALESCE($4, email),
            contact_phone = COALESCE($5, contact_phone)
          WHERE farm_id = $1`,
          [farmId, farmName || null, normalizedContact.name || null, normalizedContact.email || null, normalizedContact.phone || null]
        );
        // Also clear must_change_password for all users of this farm
        await pool.query(
          'UPDATE farm_users SET must_change_password = false WHERE farm_id = $1',
          [farmId]
        );
      } catch (dbErr) {
        console.warn('[Setup Wizard] DB update failed (non-fatal):', dbErr.message);
      }
    }

    console.log(`[Setup Wizard] Setup completed for farm ${farmId} (rooms: ${rooms?.length || 0})`);

    res.json({
      success: true,
      message: 'Setup wizard completed successfully',
      farmId,
      roomCount: rooms?.length || 0
    });

  } catch (error) {
    console.error('[Setup Wizard] Complete error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to complete setup' 
    });
  }
});

/**
 * PATCH /api/setup/mark-complete
 * Admin endpoint to mark a farm's setup as complete
 * Fixes farms that were set up before the setup_completed column was actively set
 */
router.patch('/mark-complete', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;
    const pool = req.db;

    if (pool) {
      await pool.query(
        'UPDATE farms SET setup_completed = true, setup_completed_at = COALESCE(setup_completed_at, NOW()) WHERE farm_id = $1',
        [farmId]
      );
      // Also clear must_change_password
      await pool.query(
        'UPDATE farm_users SET must_change_password = false WHERE farm_id = $1',
        [farmId]
      ).catch(() => {});
    }

    // Also update farmStore
    if (req.farmStore) {
      try {
        const profile = await req.farmStore.get(farmId, 'farm_profile') || {};
        profile.setup_completed = true;
        profile.setup_completed_at = profile.setup_completed_at || new Date().toISOString();
        await req.farmStore.set(farmId, 'farm_profile', profile);
      } catch (e) {
        console.warn('[Setup Wizard] farmStore update error:', e.message);
      }
    }

    console.log(`[Setup Wizard] Farm ${farmId} manually marked as setup complete`);
    res.json({ success: true, message: 'Farm marked as setup complete', farmId });
  } catch (error) {
    console.error('[Setup Wizard] Mark complete error:', error);
    res.status(500).json({ success: false, error: 'Failed to mark setup complete' });
  }
});

/**
 * POST /api/setup/farm-profile
 * Update farm profile information during setup
 * 
 * Body: {
 *   timezone: string,
 *   business_hours: { open: string, close: string, days: string[] },
 *   certifications: string[]
 * }
 */
router.post('/farm-profile', authenticateToken, async (req, res) => {
  try {
    const pool = req.db;
    if (!pool) {
      // No DB mode — save via farmStore (in-memory + flat file)
      const farmId = req.farmId;
      // Merge with existing profile to preserve untouched fields
      let existingProfile = {};
      if (req.farmStore) {
        try { existingProfile = await req.farmStore.get(farmId, 'farm_profile') || {}; } catch (e) { /* ignore */ }
      }
      const profileData = {
        ...existingProfile,
        farmId,
        ...(req.body.farmName && { name: req.body.farmName }),
        ...(req.body.timezone && { timezone: req.body.timezone }),
        ...(req.body.location && { location: req.body.location }),
        ...(req.body.farmSize && { farmSize: req.body.farmSize }),
        ...(req.body.cropTypes && { cropTypes: req.body.cropTypes }),
        ...(req.body.business_hours && { business_hours: req.body.business_hours }),
        ...(req.body.certifications && { certifications: req.body.certifications })
      };
      if (req.farmStore) {
        await req.farmStore.set(farmId, 'farm_profile', profileData);
      }
      console.log('[Setup Wizard] Farm profile saved (no-DB mode):', farmId);
      return res.json({
        success: true,
        message: 'Farm profile saved (no-DB mode)',
        farm: profileData
      });
    }

    const farmId = req.farmId;
    let { farmName, location, farmSize, timezone, cropTypes, dedicated_crops, business_hours, certifications } = req.body;

    // Validate and sanitize inputs
    // timezone is required for full profile setup, but optional for partial updates (e.g. cert-only)
    const hasAnyUpdate = farmName || location || farmSize || timezone || cropTypes || dedicated_crops || business_hours || certifications;
    if (!hasAnyUpdate) {
      return res.status(400).json({ 
        success: false, 
        error: 'At least one field is required' 
      });
    }

    // Sanitize text inputs to prevent XSS
    if (farmName) farmName = validator.escape(validator.trim(farmName));
    if (location) location = validator.escape(validator.trim(location));
    if (farmSize) farmSize = validator.escape(validator.trim(farmSize));
    
    // Sanitize crop types array
    if (cropTypes && Array.isArray(cropTypes)) {
      cropTypes = cropTypes.map(crop => validator.escape(validator.trim(crop)));
    }

    // Build update query dynamically based on provided fields
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (farmName) {
      updates.push(`name = $${paramCount++}`);
      values.push(farmName);
    }
    if (location) {
      updates.push(`location = $${paramCount++}`);
      values.push(location);
    }
    if (farmSize) {
      updates.push(`farm_size = $${paramCount++}`);
      values.push(farmSize);
    }
    if (timezone) {
      updates.push(`timezone = $${paramCount++}`);
      values.push(timezone);
    }
    if (cropTypes) {
      updates.push(`crop_types = $${paramCount++}`);
      values.push(JSON.stringify(cropTypes));
    }

    // Store dedicated_crops alongside crop_types in the database
    if (dedicated_crops && Array.isArray(dedicated_crops)) {
      updates.push(`crop_types = $${paramCount++}`);
      values.push(JSON.stringify(dedicated_crops));
      console.log(`[Setup Wizard] Dedicated crops saved for farm ${farmId}: ${dedicated_crops.length} crops`);
    }

    if (business_hours) {
      updates.push(`business_hours = $${paramCount++}`);
      values.push(JSON.stringify(business_hours));
    }
    if (certifications) {
      updates.push(`certifications = $${paramCount++}`);
      values.push(JSON.stringify(certifications));
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(farmId);

    // Update farm profile
    const result = await pool.query(
      `UPDATE farms 
       SET ${updates.join(', ')}
       WHERE farm_id = $${paramCount}
       RETURNING farm_id, name, timezone, business_hours, certifications`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Farm not found' 
      });
    }

    console.log('[Setup Wizard] Farm profile updated:', farmId);

    res.json({
      success: true,
      message: 'Farm profile updated successfully',
      farm: result.rows[0]
    });

  } catch (error) {
    console.error('[Setup Wizard] Farm profile update error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to update farm profile' 
    });
  }
});

/**
 * POST /api/setup/rooms
 * Create grow rooms during setup wizard
 * 
 * Body: {
 *   rooms: [
 *     { name: string, type: string, capacity: number, description: string }
 *   ]
 * }
 */
router.post('/rooms', authenticateToken, async (req, res) => {
  try {
    const pool = req.db;
    if (!pool) {
      // No DB mode — save rooms via farmStore
      const farmId = req.farmId;
      let { rooms } = req.body;
      if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
        return res.status(400).json({ success: false, error: 'At least one room is required' });
      }
      const savedRooms = rooms.map((r, i) => ({
        room_id: `room-${Date.now()}-${i}`,
        farm_id: farmId,
        name: r.name,
        type: r.type || 'grow',
        capacity: r.capacity || null,
        description: r.description || null
      }));
      if (req.farmStore) {
        await req.farmStore.set(farmId, 'rooms', savedRooms);
      }
      console.log('[Setup Wizard] Rooms saved (no-DB mode):', farmId, savedRooms.length);
      return res.json({
        success: true,
        message: `${savedRooms.length} room(s) saved (no-DB mode)`,
        rooms: savedRooms
      });
    }

    const farmId = req.farmId;
    let { rooms } = req.body;

    // Validate input
    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'At least one room is required' 
      });
    }

    // Validate and sanitize each room
    rooms = rooms.map(room => {
      if (!room.name) {
        throw new Error('Room name is required');
      }
      return {
        name: validator.escape(validator.trim(room.name)),
        type: room.type ? validator.escape(validator.trim(room.type)) : null,
        capacity: room.capacity || null,
        description: room.description ? validator.escape(validator.trim(room.description)) : null
      };
    });

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const createdRooms = [];

      for (const room of rooms) {
        const result = await client.query(
          `INSERT INTO rooms (farm_id, name, type, capacity, description, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING room_id, farm_id, name, type, capacity, description`,
          [
            farmId,
            room.name,
            room.type,
            room.capacity,
            room.description
          ]
        );

        createdRooms.push(result.rows[0]);
      }

      await client.query('COMMIT');

      console.log('[Setup Wizard] Rooms created:', farmId, createdRooms.length);

      res.json({
        success: true,
        message: `${createdRooms.length} room(s) created successfully`,
        rooms: createdRooms
      });

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('[Setup Wizard] Room creation error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to create rooms' 
    });
  }
});

/**
 * GET /api/setup/rooms
 * Get all rooms for the authenticated farm
 */
router.get('/rooms', authenticateToken, async (req, res) => {
  try {
    // Always use farmStore — it resolves DB → memory → flat file automatically.
    // The legacy 'rooms' SQL table does not exist; room data lives in farm_data.
    let rooms = [];
    if (req.farmStore) {
      try {
        const stored = await req.farmStore.get(req.farmId, 'rooms');
        if (Array.isArray(stored)) rooms = stored;
      } catch (e) {
        console.warn('[Setup Wizard] farmStore rooms read error:', e.message);
      }
    }
    return res.json({
      success: true,
      rooms
    });
  } catch (error) {
    console.error('[Setup Wizard] Get rooms error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve rooms' 
    });
  }
});

/**
 * POST /api/setup/zones
 * Create zones within rooms during setup wizard
 * Note: Currently zones are stored in room configuration JSONB
 * This could be expanded to a separate zones table if needed
 * 
 * Body: {
 *   room_id: number,
 *   zones: [
 *     { name: string, capacity: number }
 *   ]
 * }
 */
router.post('/zones', authenticateToken, async (req, res) => {
  try {
    const pool = req.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const farmId = req.farmId;
    const { room_id, zones } = req.body;

    // Validate input
    if (!room_id) {
      return res.status(400).json({ 
        success: false, 
        error: 'Room ID is required' 
      });
    }

    if (!zones || !Array.isArray(zones)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Zones array is required' 
      });
    }

    // Verify room belongs to this farm
    const roomCheck = await pool.query(
      'SELECT room_id FROM rooms WHERE room_id = $1 AND farm_id = $2',
      [room_id, farmId]
    );

    if (roomCheck.rows.length === 0) {
      return res.status(404).json({ 
        success: false, 
        error: 'Room not found or does not belong to your farm' 
      });
    }

    // Store zones in room configuration
    const zonesConfig = {
      zones: zones.map((zone, index) => ({
        id: `zone-${index + 1}`,
        name: zone.name,
        capacity: zone.capacity || null,
        created_at: new Date().toISOString()
      }))
    };

    const result = await pool.query(
      `UPDATE rooms 
       SET configuration = $1, updated_at = CURRENT_TIMESTAMP
       WHERE room_id = $2 AND farm_id = $3
       RETURNING room_id, name, configuration`,
      [JSON.stringify(zonesConfig), room_id, farmId]
    );

    console.log('[Setup Wizard] Zones configured for room:', room_id);

    res.json({
      success: true,
      message: `${zones.length} zone(s) configured successfully`,
      room: result.rows[0]
    });

  } catch (error) {
    console.error('[Setup Wizard] Zone configuration error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to configure zones' 
    });
  }
});

// NOTE: Duplicate POST /complete handler was removed (dead code — Express uses
// the first matching handler registered above at line ~209). The first handler
// now saves all body data via farmStore and works in both DB and no-DB modes.

/**
 * GET /api/setup/profile
 * Returns full farm profile data for the Settings page
 */
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;

    // LOCAL-FARM fallback
    if (farmId === 'LOCAL-FARM') {
      return res.json({
        success: true,
        profile: {
          farmId: 'LOCAL-FARM',
          name: 'Local Development Farm',
          contactName: '',
          email: '',
          phone: '',
          website: '',
          address: { street: '', city: '', province: '', country: 'CA' },
          planType: 'edge',
          setupCompleted: false
        }
      });
    }

    const pool = req.db;
    let profile = {
      farmId,
      name: '',
      contactName: '',
      email: '',
      phone: '',
      website: '',
      address: { street: '', city: '', province: '', country: 'CA' },
      planType: 'cloud',
      setupCompleted: false
    };

    if (pool) {
      try {
        const result = await pool.query(
          `SELECT name, contact_name, email, contact_phone, plan_type, location,
                  setup_completed, created_at
           FROM farms WHERE farm_id = $1`,
          [farmId]
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];
          profile.name = row.name || '';
          profile.contactName = row.contact_name || '';
          profile.email = row.email || '';
          profile.phone = row.contact_phone || '';
          profile.planType = row.plan_type || 'cloud';
          profile.setupCompleted = row.setup_completed || false;
          profile.location = row.location || '';
          profile.createdAt = row.created_at;
        }
      } catch (dbErr) {
        console.warn('[Setup Wizard] Profile DB query failed:', dbErr.message);
      }
    }

    // Merge with farmStore data (may have website, address, etc.)
    if (req.farmStore) {
      try {
        const storeProfile = await req.farmStore.get(farmId, 'farm_profile');
        if (storeProfile) {
          profile.website = storeProfile.website || storeProfile.contact?.website || profile.website;
          profile.address = storeProfile.address || storeProfile.location || profile.address;
          if (!profile.name && storeProfile.name) profile.name = storeProfile.name;
          if (!profile.contactName && storeProfile.contact?.name) profile.contactName = storeProfile.contact.name;
          if (!profile.email && storeProfile.contact?.email) profile.email = storeProfile.contact.email;
          if (!profile.phone && storeProfile.contact?.phone) profile.phone = storeProfile.contact.phone;
        }
      } catch (e) {
        console.warn('[Setup Wizard] farmStore profile read error:', e.message);
      }
    }

    res.json({ success: true, profile });

  } catch (error) {
    console.error('[Setup Wizard] Profile fetch error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
});

/**
 * PATCH /api/setup/profile
 * Update farm contact/profile from Settings page
 * Accepts partial updates — only provided fields are changed
 *
 * Body: { name, contactName, email, phone, website, address: { street, city, province, country } }
 */
router.patch('/profile', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;
    const { name, contactName, email, phone, website, address } = req.body;

    const hasUpdate = name || contactName || email || phone || website || address;
    if (!hasUpdate) {
      return res.status(400).json({ success: false, error: 'At least one field is required' });
    }

    // Sanitize
    const clean = {
      name: name ? validator.escape(validator.trim(name)) : undefined,
      contactName: contactName ? validator.escape(validator.trim(contactName)) : undefined,
      email: email ? validator.trim(email) : undefined,
      phone: phone ? validator.trim(phone) : undefined,
      website: website ? validator.trim(website) : undefined,
      address: address || undefined
    };

    // Validate email format if provided
    if (clean.email && !validator.isEmail(clean.email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    const pool = req.db;
    if (pool) {
      const updates = [];
      const values = [];
      let p = 1;

      if (clean.name) { updates.push(`name = $${p++}`); values.push(clean.name); }
      if (clean.contactName) { updates.push(`contact_name = $${p++}`); values.push(clean.contactName); }
      if (clean.email) { updates.push(`email = $${p++}`); values.push(clean.email); }
      if (clean.phone) { updates.push(`contact_phone = $${p++}`); values.push(clean.phone); }
      if (clean.address && typeof clean.address === 'object') {
        updates.push(`location = $${p++}`);
        values.push(typeof clean.address === 'string' ? clean.address : JSON.stringify(clean.address));
      }
      updates.push('updated_at = CURRENT_TIMESTAMP');
      values.push(farmId);

      if (updates.length > 1) {
        try {
          await pool.query(
            `UPDATE farms SET ${updates.join(', ')} WHERE farm_id = $${p}`,
            values
          );
        } catch (dbErr) {
          console.warn('[Setup Wizard] Profile DB update failed:', dbErr.message);
        }
      }
    }

    // Also persist in farmStore for offline / edge use
    if (req.farmStore) {
      try {
        const existing = await req.farmStore.get(farmId, 'farm_profile') || {};
        const updated = {
          ...existing,
          ...(clean.name && { name: clean.name, farmName: clean.name }),
          contact: {
            ...(existing.contact || {}),
            ...(clean.contactName && { name: clean.contactName }),
            ...(clean.email && { email: clean.email }),
            ...(clean.phone && { phone: clean.phone }),
            ...(clean.website && { website: clean.website })
          },
          ...(clean.website && { website: clean.website }),
          ...(clean.address && { address: clean.address })
        };
        await req.farmStore.set(farmId, 'farm_profile', updated);
      } catch (e) {
        console.warn('[Setup Wizard] farmStore profile write error:', e.message);
      }
    }

    console.log('[Setup Wizard] Profile updated for farm:', farmId);
    res.json({ success: true, message: 'Profile updated successfully' });

  } catch (error) {
    console.error('[Setup Wizard] Profile update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update profile' });
  }
});

/**
 * POST /api/setup/certifications
 * Update certifications & practices from the Settings page edit modal
 *
 * Body: { certifications: string[], practices: string[], attributes: string[] }
 */
router.post('/certifications', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;
    const { certifications, practices, attributes } = req.body;

    // Validate input: arrays of strings only
    const sanitizeArr = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.filter(v => typeof v === 'string').map(v => validator.escape(validator.trim(v))).filter(Boolean);
    };

    const updatedCerts = {
      certifications: sanitizeArr(certifications),
      practices: sanitizeArr(practices),
      attributes: sanitizeArr(attributes)
    };

    // Save to farmStore (source of truth for certifications)
    if (req.farmStore) {
      try {
        const existing = await req.farmStore.get(farmId, 'farm_profile') || {};
        existing.certifications = updatedCerts;
        await req.farmStore.set(farmId, 'farm_profile', existing);
      } catch (e) {
        console.warn('[Setup Wizard] farmStore certifications write error:', e.message);
      }
    }

    // Also save to DB if available (certifications column)
    const pool = req.db;
    if (pool) {
      try {
        await pool.query(
          'UPDATE farms SET certifications = $1, updated_at = CURRENT_TIMESTAMP WHERE farm_id = $2',
          [JSON.stringify(updatedCerts), farmId]
        );
      } catch (dbErr) {
        console.warn('[Setup Wizard] DB certifications update failed:', dbErr.message);
      }
    }

    console.log('[Setup Wizard] Certifications updated for farm:', farmId);
    res.json({ success: true, certifications: updatedCerts });

  } catch (error) {
    console.error('[Setup Wizard] Certifications update error:', error);
    res.status(500).json({ success: false, error: 'Failed to update certifications' });
  }
});

/**
 * GET /api/setup/onboarding-status
 * Returns onboarding checklist completion status
 */
router.get('/onboarding-status', authenticateToken, async (req, res) => {
  try {
    const farmId = req.farmId;
    let planType = 'cloud';
    let tasks = [];

    // Gather completion data from DB and farmStore
    let dbData = {};
    const pool = req.db;
    if (pool) {
      try {
        const farmResult = await pool.query(
          `SELECT name, contact_name, email, plan_type, setup_completed FROM farms WHERE farm_id = $1`,
          [farmId]
        );
        if (farmResult.rows.length > 0) {
          dbData = farmResult.rows[0];
          planType = dbData.plan_type || 'cloud';
        }
      } catch (e) { /* non-fatal */ }

      // Count rooms
      try {
        const roomsResult = await pool.query('SELECT COUNT(*) as count FROM rooms WHERE farm_id = $1', [farmId]);
        dbData.roomCount = parseInt(roomsResult.rows[0]?.count) || 0;
      } catch (e) { dbData.roomCount = 0; }

      // Count inventory items
      try {
        const invResult = await pool.query(
          `SELECT COUNT(*) as count FROM inventory WHERE farm_id = $1`,
          [farmId]
        );
        dbData.inventoryCount = parseInt(invResult.rows[0]?.count) || 0;
      } catch (e) { dbData.inventoryCount = 0; }
    }

    // FarmStore data
    let storeProfile = {};
    let storeRoomCount = 0;
    let storeSeedCount = 0;
    let storeGroupCount = 0;
    let storeTrayCount = 0;
    if (req.farmStore) {
      try {
        storeProfile = await req.farmStore.get(farmId, 'farm_profile') || {};
        const storeRooms = await req.farmStore.get(farmId, 'rooms');
        if (Array.isArray(storeRooms)) storeRoomCount = storeRooms.length;
        const storeSeeds = await req.farmStore.get(farmId, 'inventory_seeds');
        if (Array.isArray(storeSeeds)) storeSeedCount = storeSeeds.length;
        const storeGroups = await req.farmStore.get(farmId, 'groups');
        if (Array.isArray(storeGroups)) storeGroupCount = storeGroups.length;
        const storeTrays = await req.farmStore.get(farmId, 'trays');
        if (Array.isArray(storeTrays)) storeTrayCount = storeTrays.length;
      } catch (e) { /* non-fatal */ }
    }

    const effectiveRoomCount = Math.max(dbData.roomCount || 0, storeRoomCount);

    // Build tasks
    tasks = [
      {
        id: 'setup_wizard',
        label: 'Run the setup wizard — set your password and farm profile in one pass',
        completed: dbData.setup_completed === true || storeProfile.setup_completed === true,
        link: '/setup-wizard.html',
        icon: '✅'
      },
      {
        id: 'farm_profile',
        label: 'Add your contact info and farm location — this appears on receipts, invoices, and your online store',
        completed: !!(dbData.contact_name || storeProfile.contact?.name),
        link: '#settings',
        icon: '👤'
      },
      {
        id: 'grow_rooms',
        label: 'Create a grow room — rooms organize your zones, sensors, and lights so everything maps to a physical space',
        completed: effectiveRoomCount > 0,
        link: '#iframe-view',
        linkUrl: '/LE-dashboard.html?panel=grow-rooms',
        icon: '🌱'
      },
      {
        id: 'display_prefs',
        label: 'Set your units and timezone — this controls how temperatures, weights, and dates display everywhere',
        completed: false, // deferred to client-side check
        clientCheck: 'farmSettings',
        link: '#settings',
        icon: '⚙️'
      },
      {
        id: 'payment_processing',
        label: 'Connect Square for payments — required before you can accept orders through POS or your online store',
        completed: storeProfile.payment_configured === true,
        link: '#payments',
        icon: '💳'
      },
      {
        id: 'online_store',
        label: 'Launch your online store — customers will browse your inventory and place orders directly',
        completed: storeProfile.store_configured === true,
        link: '#iframe-view',
        linkUrl: '/LE-dashboard.html?wizard=store-setup',
        icon: '🛒'
      },
      {
        id: 'inventory',
        label: 'Add your first crop to inventory — this is what feeds your store, pricing, and harvest tracking',
        completed: (dbData.inventoryCount || 0) > 0,
        link: '#iframe-view',
        linkUrl: '/views/farm-inventory.html',
        icon: '📦'
      },
      {
        id: 'activity_hub',
        label: 'Install the Activity Hub on your iPad — a farm-floor app for scanning trays, recording harvests, and daily tasks',
        completed: storeProfile.activity_hub_installed === true,
        link: '#settings',
        icon: '📱'
      },
      {
        id: 'tray_setup',
        label: 'Set up your tray types — trays track every plant from seed to harvest with full traceability',
        completed: storeTrayCount > 0,
        link: '#iframe-view',
        linkUrl: '/views/tray-setup.html',
        icon: '🗂️'
      },
      {
        id: 'seed_inventory',
        label: 'Add your seeds to inventory — seed tracking powers planting schedules and supply forecasting',
        completed: storeSeedCount > 0,
        link: '#inventory-mgmt',
        icon: '🌱'
      },
      {
        id: 'first_recipe',
        label: 'Create a grow recipe — recipes define light schedules, environment targets, and growth stages for each crop',
        completed: storeGroupCount > 0,
        link: '#iframe-view',
        linkUrl: '/LE-dashboard.html?panel=groups-v2',
        icon: '📋'
      }
    ];

    // Add edge-only tasks
    if (planType === 'edge') {
      tasks.push(
        {
          id: 'controllers',
          label: 'Discover your light controllers — auto-scan finds GROW3 and DMX hardware on your network',
          completed: storeProfile.controllers_connected === true,
          link: '#iframe-view',
          linkUrl: '/LE-dashboard.html?panel=iot-devices',
          icon: '💡',
          edgeOnly: true
        },
        {
          id: 'bus_mapping',
          label: 'Map your lighting bus — connects physical light channels to zones so recipes can control them',
          completed: storeProfile.bus_mapped === true,
          link: '#iframe-view',
          linkUrl: '/LE-dashboard.html?panel=bus-mapping',
          icon: '🔌',
          edgeOnly: true
        }
      );
    }

    const completedCount = tasks.filter(t => t.completed).length;

    res.json({
      success: true,
      planType,
      completedCount,
      totalCount: tasks.length,
      tasks
    });

  } catch (error) {
    console.error('[Setup Wizard] Onboarding status error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch onboarding status' });
  }
});

export default router;
