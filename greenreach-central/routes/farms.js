import express from 'express';
import { query } from '../config/database.js';
import { ValidationError, NotFoundError, ConflictError } from '../middleware/errorHandler.js';
import { authMiddleware, requireRole } from '../middleware/auth.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Generate unique farm ID
function generateFarmId() {
  const prefix = process.env.FARM_ID_PREFIX || 'GR';
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${prefix}-${timestamp}${random}`;
}

// Generate registration code
function generateRegistrationCode() {
  const length = parseInt(process.env.REGISTRATION_CODE_LENGTH) || 8;
  return crypto.randomBytes(length).toString('hex').toUpperCase().slice(0, length);
}

// POST /api/farms/register - Register a new farm
router.post('/register', async (req, res, next) => {
  try {
    const {
      name,
      legal_name,
      email,
      phone,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      latitude,
      longitude,
      contact_name,
      tier
    } = req.body;

    // Validate required fields
    if (!name || !email || !phone || !address_line1 || !city || !state || !postal_code) {
      throw new ValidationError('Missing required fields: name, email, phone, address');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }

    // Check if farm with this email already exists
    const existingFarm = await query(
      'SELECT farm_id FROM farms WHERE email = $1',
      [email]
    );
    
    if (existingFarm.rows.length > 0) {
      throw new ConflictError('A farm with this email already exists');
    }

    // Generate farm ID and registration code
    const farmId = generateFarmId();
    const registrationCode = generateRegistrationCode();
    
    // Generate API key and secret
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiSecret = crypto.randomBytes(32).toString('hex');
    const apiSecretHash = await bcrypt.hash(apiSecret, 10);

    // Insert farm record
    const result = await query(`
      INSERT INTO farms (
        farm_id, name, legal_name, email, phone,
        address_line1, address_line2, city, state, postal_code, country,
        latitude, longitude, contact_name,
        registration_code, status, tier,
        api_key, api_secret_hash
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, 'pending', $16,
        $17, $18
      )
      RETURNING farm_id, name, email, registration_code, api_key, status, tier, created_at
    `, [
      farmId, name, legal_name || name, email, phone,
      address_line1, address_line2, city, state, postal_code, country || 'USA',
      latitude, longitude, contact_name,
      registrationCode, tier || 'starter',
      apiKey, apiSecretHash
    ]);

    const farm = result.rows[0];

    logger.info('Farm registered', {
      farmId: farm.farm_id,
      name: farm.name,
      email: farm.email
    });

    // Return farm details including API credentials (ONLY TIME these are returned in plain text)
    res.status(201).json({
      success: true,
      message: 'Farm registered successfully',
      farm: {
        farmId: farm.farm_id,
        name: farm.name,
        email: farm.email,
        registrationCode: farm.registration_code,
        apiKey: farm.api_key,
        apiSecret: apiSecret, // Only returned once!
        status: farm.status,
        tier: farm.tier,
        createdAt: farm.created_at
      },
      notice: 'IMPORTANT: Save your API credentials securely. The API secret will not be shown again.'
    });

  } catch (error) {
    next(error);
  }
});

// POST /api/farms/:id/provision - Provision a farm (activate after edge device setup)
router.post('/:id/provision', async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      registration_code,
      edge_device_id,
      edge_device_type,
      software_version
    } = req.body;

    if (!registration_code || !edge_device_id) {
      throw new ValidationError('Registration code and edge device ID required');
    }

    // Find farm by ID and registration code
    const farmResult = await query(
      'SELECT * FROM farms WHERE farm_id = $1 AND registration_code = $2',
      [id, registration_code]
    );

    if (farmResult.rows.length === 0) {
      throw new NotFoundError('Farm not found or invalid registration code');
    }

    const farm = farmResult.rows[0];

    if (farm.status === 'active') {
      throw new ConflictError('Farm already provisioned');
    }

    // Update farm with edge device info and activate
    const result = await query(`
      UPDATE farms
      SET 
        edge_device_id = $1,
        edge_device_type = $2,
        software_version = $3,
        status = 'active',
        activation_date = NOW(),
        last_heartbeat = NOW()
      WHERE farm_id = $4
      RETURNING farm_id, name, status, activation_date, edge_device_id
    `, [edge_device_id, edge_device_type, software_version, id]);

    const updatedFarm = result.rows[0];

    logger.info('Farm provisioned', {
      farmId: updatedFarm.farm_id,
      edgeDeviceId: updatedFarm.edge_device_id
    });

    res.json({
      success: true,
      message: 'Farm provisioned successfully',
      farm: updatedFarm
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/farms/:id - Get farm details (requires auth)
router.get('/:id', authMiddleware, async (req, res, next) => {
  try {
    const { id } = req.params;

    // Verify user has access to this farm
    if (req.user.farmId !== id && req.user.role !== 'admin') {
      throw new AuthorizationError('Access denied to this farm');
    }

    const result = await query(`
      SELECT 
        farm_id, name, legal_name, email, phone,
        address_line1, address_line2, city, state, postal_code, country,
        latitude, longitude, contact_name,
        status, tier, activation_date,
        edge_device_id, edge_device_type, software_version,
        last_sync, last_heartbeat,
        created_at, updated_at
      FROM farms
      WHERE farm_id = $1
    `, [id]);

    if (result.rows.length === 0) {
      throw new NotFoundError('Farm not found');
    }

    res.json({
      success: true,
      farm: result.rows[0]
    });

  } catch (error) {
    next(error);
  }
});

// GET /api/farms - List all farms (admin only)
router.get('/', authMiddleware, requireRole('admin'), async (req, res, next) => {
  try {
    const { status, tier, limit = 50, offset = 0 } = req.query;

    let queryText = 'SELECT * FROM farms WHERE 1=1';
    const queryParams = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      queryText += ` AND status = $${paramCount}`;
      queryParams.push(status);
    }

    if (tier) {
      paramCount++;
      queryText += ` AND tier = $${paramCount}`;
      queryParams.push(tier);
    }

    queryText += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    queryParams.push(limit, offset);

    const result = await query(queryText, queryParams);

    res.json({
      success: true,
      farms: result.rows,
      count: result.rows.length
    });

  } catch (error) {
    next(error);
  }
});

// POST /api/farms/:id/heartbeat - Update farm heartbeat
router.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Verify API key
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      throw new AuthenticationError('API key required');
    }

    // Update last heartbeat
    const result = await query(`
      UPDATE farms
      SET last_heartbeat = NOW()
      WHERE farm_id = $1 AND api_key = $2
      RETURNING farm_id, last_heartbeat
    `, [id, apiKey]);

    if (result.rows.length === 0) {
      throw new NotFoundError('Farm not found or invalid API key');
    }

    res.json({
      success: true,
      timestamp: result.rows[0].last_heartbeat
    });

  } catch (error) {
    next(error);
  }
});

export default router;
