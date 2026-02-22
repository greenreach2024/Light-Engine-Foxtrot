/**
 * Farm Sales Portal - Authentication & Authorization
 * Multi-tenant JWT authentication with farm_id scoping
 * Provides security isolation from farm management systems and GreenReach admin
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// JWT secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '24h'; // Token expires after 24 hours

/**
 * User roles within farm sales system
 */
export const FARM_ROLES = {
  CASHIER: 'cashier',       // POS checkout only
  DELIVERY: 'delivery',     // View/update deliveries only
  MANAGER: 'manager',       // Full farm sales access
  ADMIN: 'admin',           // Full access + settings
  PUBLIC: 'public'          // Consumer storefront (read-only)
};

/**
 * Blocked endpoints - farm sales portal CANNOT access these
 * Security isolation from farm management and GreenReach admin
 */
const BLOCKED_ENDPOINTS = [
  // Farm Management Systems (hardware control)
  '/api/env',
  '/api/devices',
  '/api/lights',
  '/api/groups',
  '/api/automations',
  '/api/bus-mapping',
  '/api/atlas',
  '/api/health/farms',
  
  // GreenReach Admin (multi-farm visibility)
  '/api/wholesale/catalog',      // Can only view own farm inventory
  '/api/wholesale/checkout',     // Buyers only
  '/api/wholesale/webhooks',
  '/api/wholesale/refunds',
  '/api/wholesale/oauth',
  '/api/wholesale/sla',
  '/api/admin'
];

/**
 * Generate JWT token for farm user
 * 
 * @param {Object} payload - User data
 * @param {string} payload.farm_id - Unique farm identifier
 * @param {string} payload.user_id - User identifier
 * @param {string} payload.role - User role (FARM_ROLES)
 * @param {string} payload.name - User display name
 * @param {string} payload.email - User email
 * @returns {string} JWT token
 */
export function generateFarmToken(payload) {
  const { farm_id, user_id, role, name, email } = payload;

  if (!farm_id) {
    throw new Error('farm_id is required');
  }

  if (!Object.values(FARM_ROLES).includes(role)) {
    throw new Error(`Invalid role. Must be one of: ${Object.values(FARM_ROLES).join(', ')}`);
  }

  return jwt.sign(
    {
      farm_id,
      user_id,
      role,
      name,
      email,
      iat: Math.floor(Date.now() / 1000),
      type: 'farm_sales'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify and decode JWT token
 * 
 * @param {string} token - JWT token
 * @returns {Object} Decoded token payload
 * @throws {Error} If token invalid or expired
 */
export function verifyFarmToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    
    // Ensure it's a farm sales token
    if (decoded.type !== 'farm_sales') {
      throw new Error('Invalid token type');
    }

    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired');
    }
    if (error.name === 'JsonWebTokenError') {
      throw new Error('Invalid token');
    }
    throw error;
  }
}

/**
 * Express middleware: Authenticate farm user
 * Extracts and verifies JWT token from Authorization header
 * Attaches farm_id, user_id, and role to req object
 * 
 * Usage:
 *   router.get('/orders', farmAuthMiddleware, (req, res) => {
 *     const farmId = req.farm_id;
 *     // ... query orders for this farm only
 *   });
 */
export function farmAuthMiddleware(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'Authorization header required'
      });
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'Authorization header must be: Bearer <token>'
      });
    }

    const token = parts[1];

    // Verify token
    const decoded = verifyFarmToken(token);

    // Attach to request
    req.farm_id = decoded.farm_id;
    req.user_id = decoded.user_id;
    req.user_role = decoded.role;
    req.user_name = decoded.name;
    req.user_email = decoded.email;

    next();
  } catch (error) {
    return res.status(401).json({
      ok: false,
      error: 'unauthorized',
      message: error.message
    });
  }
}

/**
 * Express middleware: Require specific role
 * Must be used AFTER farmAuthMiddleware
 * 
 * Usage:
 *   router.post('/settings', farmAuthMiddleware, requireRole(['manager', 'admin']), (req, res) => {
 *     // Only managers and admins can access
 *   });
 */
export function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user_role) {
      return res.status(401).json({
        ok: false,
        error: 'unauthorized',
        message: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.user_role)) {
      return res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: `Requires one of these roles: ${allowedRoles.join(', ')}`,
        your_role: req.user_role
      });
    }

    next();
  };
}

/**
 * Express middleware: Block access to farm management endpoints
 * Prevents farm sales portal from accessing hardware controls
 * 
 * Usage: Apply globally before route definitions
 *   app.use(blockFarmManagementEndpoints);
 */
export function blockFarmManagementEndpoints(req, res, next) {
  // Only apply to authenticated farm sales requests
  if (!req.farm_id) {
    return next();
  }

  // Check if requesting blocked endpoint
  const isBlocked = BLOCKED_ENDPOINTS.some(endpoint => 
    req.path.startsWith(endpoint)
  );

  if (isBlocked) {
    console.log(`[security] Blocked farm ${req.farm_id} from accessing ${req.path}`);
    return res.status(403).json({
      ok: false,
      error: 'forbidden',
      message: 'Farm sales portal cannot access farm management systems',
      blocked_endpoint: req.path,
      reason: 'security_isolation'
    });
  }

  next();
}

/**
 * Demo: Generate test tokens for development
 * Creates tokens for multiple farms and roles
 * 
 * @param {Object} [targetFarm] - Optional specific farm to include
 * @param {string} targetFarm.farm_id - Farm ID
 * @param {string} targetFarm.name - Farm name
 * @param {string} targetFarm.slug - Farm slug
 */
export function generateDemoTokens(targetFarm = null) {
  const baseFarms = [
    { farm_id: 'GR-00001', name: 'GreenReach Demo Farm', slug: 'greenreach-demo' },
    { farm_id: 'LOCAL-FARM', name: 'Local Demo Farm', slug: 'local-farm' },
    { farm_id: 'light-engine-demo', name: 'Light Engine Demo', slug: 'light-engine-demo' },
    { farm_id: 'FARM-001', name: 'Sunrise Acres', slug: 'sunrise-acres' },
    { farm_id: 'FARM-002', name: 'Green Valley Farm', slug: 'green-valley' },
    { farm_id: 'FARM-003', name: 'Urban Harvest Co', slug: 'urban-harvest' },
    { farm_id: 'FARM-TEST-WIZARD-001', name: 'Test Wizard Farm', slug: 'test-wizard-farm' }
  ];
  
  // Add target farm if provided and not already in list
  const farms = [...baseFarms];
  if (targetFarm && targetFarm.farm_id && !farms.find(f => f.farm_id === targetFarm.farm_id)) {
    farms.push({
      farm_id: targetFarm.farm_id,
      name: targetFarm.name || targetFarm.farm_id,
      slug: targetFarm.slug || targetFarm.farm_id
    });
    console.log('[generateDemoTokens] Added target farm:', targetFarm.farm_id);
  }

  const tokens = {};

  farms.forEach(farm => {
    tokens[farm.farm_id] = {
      farm_name: farm.name,
      slug: farm.slug,
      cashier: generateFarmToken({
        farm_id: farm.farm_id,
        user_id: `${farm.farm_id}-CASHIER-01`,
        role: FARM_ROLES.CASHIER,
        name: 'Demo Cashier',
        email: `cashier@${farm.slug}.farm`
      }),
      manager: generateFarmToken({
        farm_id: farm.farm_id,
        user_id: `${farm.farm_id}-MANAGER-01`,
        role: FARM_ROLES.MANAGER,
        name: 'Demo Manager',
        email: `manager@${farm.slug}.farm`
      }),
      admin: generateFarmToken({
        farm_id: farm.farm_id,
        user_id: `${farm.farm_id}-ADMIN-01`,
        role: FARM_ROLES.ADMIN,
        name: 'Demo Admin',
        email: `admin@${farm.slug}.farm`
      })
    };
  });

  return tokens;
}

/**
 * Login endpoint handler
 * For demo: accepts email/password and returns token
 * In production: integrate with real auth provider (Auth0, Cognito, etc.)
 * 
 * The database pool is accessed lazily via req.app.locals.db
 * to allow routes to be registered before pool initialization
 */
export function createAuthRoutes() {
  const router = express.Router();

  // POST /api/farm-auth/login
  router.post('/login', (req, res) => {
    const { email, password, farm_id } = req.body;

    // Demo: Accept any email/password for testing
    // In production: validate against database
    if (!email || !password) {
      return res.status(400).json({
        ok: false,
        error: 'missing_credentials',
        message: 'Email and password required'
      });
    }

    if (!farm_id) {
      return res.status(400).json({
        ok: false,
        error: 'missing_farm_id',
        message: 'farm_id required'
      });
    }

    // Demo: Determine role from email
    let role = FARM_ROLES.CASHIER;
    if (email.includes('manager')) role = FARM_ROLES.MANAGER;
    if (email.includes('admin')) role = FARM_ROLES.ADMIN;
    if (email.includes('delivery')) role = FARM_ROLES.DELIVERY;

    const token = generateFarmToken({
      farm_id,
      user_id: `USER-${Date.now()}`,
      role,
      name: email.split('@')[0],
      email
    });

    res.json({
      ok: true,
      token,
      expires_in: JWT_EXPIRY,
      user: {
        farm_id,
        role,
        email
      }
    });
  });

  // GET /api/farm-auth/verify
  router.get('/verify', farmAuthMiddleware, (req, res) => {
    res.json({
      ok: true,
      valid: true,
      farm_id: req.farm_id,
      user_id: req.user_id,
      role: req.user_role,
      name: req.user_name,
      email: req.user_email
    });
  });

  // GET /api/farm-auth/demo-tokens (demo mode or development)
  // Allow in demo mode (DEMO_MODE=true) or development
  if (process.env.DEMO_MODE === 'true' || process.env.NODE_ENV !== 'production') {
    router.get('/demo-tokens', async (req, res) => {
      const { farm_id } = req.query;
      let targetFarm = null;
      const dbPool = req.app.locals.db; // Lazy access to database pool
      
      // If a specific farm is requested, validate it exists in database
      if (farm_id && dbPool) {
        try {
          const result = await dbPool.query(
            'SELECT farm_id, name, farm_slug FROM farms WHERE farm_id = $1 OR farm_slug = $1',
            [farm_id]
          );
          if (result.rows && result.rows.length > 0) {
            const farm = result.rows[0];
            targetFarm = { 
              farm_id: farm.farm_id, 
              name: farm.name, 
              slug: farm.farm_slug || farm.farm_id
            };
            console.log('[demo-tokens] Validated farm from database:', targetFarm);
          } else {
            console.log('[demo-tokens] Farm not found in database, will use passthrough:', farm_id);
            // Allow passthrough for farms not in DB (edge servers)
            targetFarm = { farm_id, name: farm_id, slug: farm_id };
          }
        } catch (err) {
          console.warn('[demo-tokens] DB validation failed:', err.message);
          // Fall through - will use base farms only if no targetFarm set
          targetFarm = { farm_id, name: farm_id, slug: farm_id };
        }
      } else if (farm_id) {
        // No dbPool, allow passthrough
        targetFarm = { farm_id, name: farm_id, slug: farm_id };
      }
      
      const tokens = generateDemoTokens(targetFarm);
      res.json({
        ok: true,
        message: 'Demo tokens for testing',
        note: 'Use these tokens in Authorization: Bearer <token> header',
        tokens
      });
    });
  } else {
    // Provide clear error in production
    router.get('/demo-tokens', (req, res) => {
      res.status(403).json({
        ok: false,
        error: 'forbidden',
        message: 'Demo tokens are disabled in production. Set DEMO_MODE=true to enable.',
        hint: 'For production, use POST /api/farm-auth/login with real credentials'
      });
    });
  }

  return router;
}

// Import express for router
import express from 'express';

export default {
  generateFarmToken,
  verifyFarmToken,
  farmAuthMiddleware,
  requireRole,
  blockFarmManagementEndpoints,
  generateDemoTokens,
  createAuthRoutes,
  FARM_ROLES
};
