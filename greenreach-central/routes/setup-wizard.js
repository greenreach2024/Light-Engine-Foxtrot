/**
 * Setup Wizard API Routes
 * Handles first-time farm setup after purchase: farm profile, rooms, zones
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import bcrypt from 'bcryptjs';

const router = express.Router();

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
    const jwtSecret = process.env.JWT_SECRET || 'greenreach-jwt-secret-2025';
    const decoded = jwt.verify(token, jwtSecret, {
      issuer: 'greenreach-central',
      audience: 'greenreach-farms'
    });
    
    req.farmId = decoded.farm_id || decoded.farmId;
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
    const pool = req.app.locals?.db;
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

    // Update user password and mark email as verified
    await pool.query(
      'UPDATE users SET password_hash = $1, email_verified = true WHERE id = $2',
      [password_hash, userId]
    );

    console.log('[Setup Wizard] Password changed for user:', userId);

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

    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    // Get farm details including setup_completed flag
    const farmResult = await pool.query(
      'SELECT name, plan_type, timezone, business_hours, setup_completed FROM farms WHERE farm_id = $1',
      [farmId]
    );

    const farm = farmResult.rows[0];

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
    const setupCompleted = farm?.setup_completed === true || roomCount > 0;

    res.json({
      success: true,
      setupCompleted,
      farm: {
        farmId,
        name: farm?.name,
        planType: farm?.plan_type,
        timezone: farm?.timezone,
        hasBusinessHours: !!farm?.business_hours
      },
      roomCount
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
 * POST /api/setup-wizard/complete
 * Mark farm setup as completed (bypass wizard)
 * Use this for farms already configured before setup_completed flag existed
 */
router.post('/complete', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const farmId = req.farmId;

    await pool.query(
      'UPDATE farms SET setup_completed = true, setup_completed_at = NOW() WHERE farm_id = $1',
      [farmId]
    );

    console.log(`[Setup Wizard] Marked farm ${farmId} as setup completed`);

    res.json({
      success: true,
      message: 'Farm setup marked as complete'
    });

  } catch (error) {
    console.error('[Setup Wizard] Complete error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark setup as complete' 
    });
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
    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const farmId = req.farmId;
    let { farmName, location, farmSize, timezone, cropTypes, dedicated_crops, business_hours, certifications } = req.body;

    // Validate and sanitize inputs
    if (!timezone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Timezone is required' 
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
    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
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
    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const farmId = req.farmId;

    const result = await pool.query(
      `SELECT room_id, farm_id, name, type, capacity, description, created_at
       FROM rooms
       WHERE farm_id = $1
       ORDER BY created_at ASC`,
      [farmId]
    );

    res.json({
      success: true,
      rooms: result.rows
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
    const pool = req.app.locals?.db;
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

/**
 * POST /api/setup/complete
 * Mark setup wizard as complete
 * This is called after all steps are finished
 */
router.post('/complete', authenticateToken, async (req, res) => {
  try {
    const pool = req.app.locals?.db;
    if (!pool) {
      return res.status(500).json({ 
        success: false, 
        error: 'Database not configured' 
      });
    }

    const farmId = req.farmId;

    // Verify setup is actually complete (has at least one room)
    const roomsResult = await pool.query(
      'SELECT COUNT(*) as count FROM rooms WHERE farm_id = $1',
      [farmId]
    );

    const roomCount = parseInt(roomsResult.rows[0]?.count);

    if (roomCount === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'Cannot complete setup without creating at least one room' 
      });
    }

    // Update farm status (could add a setup_completed flag if needed)
    await pool.query(
      'UPDATE farms SET updated_at = CURRENT_TIMESTAMP WHERE farm_id = $1',
      [farmId]
    );

    console.log('[Setup Wizard] Setup completed for farm:', farmId);

    res.json({
      success: true,
      message: 'Setup wizard completed successfully',
      farmId,
      roomCount
    });

  } catch (error) {
    console.error('[Setup Wizard] Complete setup error:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to complete setup' 
    });
  }
});

export default router;
