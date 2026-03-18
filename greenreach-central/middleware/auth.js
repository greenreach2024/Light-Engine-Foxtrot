/**
 * Auth Middleware
 * Extracts farm context from JWT tokens or validated API keys.
 * Supports multi-tenant SaaS: every request is scoped to a farmId.
 *
 * SECURITY: No unauthenticated fallback — all requests must present
 * a valid JWT or a valid API key. In local dev mode (non-production),
 * the FARM_ID env var + x-farm-id header are accepted without a key.
 */

import jwt from 'jsonwebtoken';
import { randomBytes, timingSafeEqual } from 'crypto';
import logger from '../utils/logger.js';
import { isValidFarmApiKey } from '../routes/sync.js';

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

/** Validate an API key using timing-safe comparison */
function isValidApiKey(key) {
  const expected = process.env.GREENREACH_API_KEY;
  if (!expected || !key) return false;
  try {
    const a = Buffer.from(key, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

const isProduction = () =>
  process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud';

/**
 * Basic auth middleware — extracts farmId from JWT token or validated API key.
 *
 * Sets req.user = { farmId, role, email, name, userId, authMethod }
 */
export function authMiddleware(req, res, next) {
  // 1. Try JWT token from Authorization header
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      req.user = {
        farmId: payload.farm_id,
        userId: payload.user_id || 'jwt-user',
        role: payload.role || 'admin',
        email: payload.email,
        name: payload.name,
        authMethod: 'jwt'
      };
      return next();
    } catch (err) {
      // Token invalid/expired — try other methods
      logger.debug('[Auth] JWT validation failed:', err.message);
    }
  }

  // 2. API key auth (edge devices) — key MUST match GREENREACH_API_KEY
  if (req.headers['x-api-key'] && req.headers['x-farm-id']) {
    if (!isValidApiKey(req.headers['x-api-key'])) {
      logger.warn('[Auth] Invalid API key from', req.headers['x-farm-id']);
      return res.status(401).json({ error: 'Invalid API key' });
    }
    req.user = {
      farmId: req.headers['x-farm-id'],
      role: 'admin',
      authMethod: 'api-key'
    };
    return next();
  }

  // 3. Local dev mode only — accept x-farm-id header or FARM_ID env
  if (!isProduction()) {
    const devFarmId = req.headers['x-farm-id'] || process.env.FARM_ID;
    if (devFarmId) {
      req.user = {
        farmId: devFarmId,
        role: 'admin',
        authMethod: 'dev-local'
      };
      return next();
    }
  }

  // No valid credentials — reject
  logger.warn('[Auth] Unauthenticated request to', req.path);
  return res.status(401).json({ error: 'Authentication required' });
}

/**
 * Require authentication
 */
export function requireAuth(req, res, next) {
  if (!req.user || !req.user.farmId) {
    logger.warn('[Auth] Unauthorized access attempt');
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

/**
 * Check farm ownership - ensures user can only access their farm's resources
 */
export async function checkFarmOwnership(req, res, next) {
  const { farmId } = req.user;
  const requestedFarmId = req.body.farmId || req.params.farmId || req.query.farmId;
  
  // If no specific farm requested, use user's farm
  if (!requestedFarmId) {
    req.farmId = farmId;
    return next();
  }
  
  // Verify user has access to requested farm
  if (requestedFarmId !== farmId && req.user.role !== 'superadmin') {
    logger.warn(`[Auth] User ${farmId} attempted to access farm ${requestedFarmId}`);
    return res.status(403).json({ error: 'Access denied to this farm' });
  }
  
  req.farmId = requestedFarmId;
  next();
}

/**
 * Combined auth middleware — accepts EITHER farm JWT/API-key OR admin JWT.
 * Used for routes like /api/accounting and /api/procurement that are accessed
 * by both farm-level clients and the GreenReach Central admin panel.
 *
 * Tries farm auth first (JWT with issuer/audience or API key), then falls back
 * to admin JWT (no issuer/audience constraints). If neither succeeds, returns 401.
 */
export async function authOrAdminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  // 1. Try farm JWT (has issuer/audience)
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.substring(7);
      const payload = jwt.verify(token, JWT_SECRET, {
        issuer: 'greenreach-central',
        audience: 'greenreach-farms'
      });
      req.user = {
        farmId: payload.farm_id,
        userId: payload.user_id || 'jwt-user',
        role: payload.role || 'admin',
        email: payload.email,
        name: payload.name,
        authMethod: 'jwt'
      };
      return next();
    } catch (err) {
      logger.debug('[Auth] Farm JWT validation failed, trying admin JWT:', err.message);
    }

    // 2. Try admin JWT (no issuer/audience constraints)
    try {
      const token = authHeader.substring(7);
      const payload = jwt.verify(token, JWT_SECRET);
      if (payload && (payload.adminId || payload.email)) {
        req.user = {
          farmId: 'ADMIN',
          userId: payload.adminId || payload.email,
          role: payload.role || 'admin',
          email: payload.email,
          name: payload.name,
          authMethod: 'admin-jwt'
        };
        req.admin = {
          id: payload.adminId,
          email: payload.email,
          name: payload.name,
          role: payload.role || 'admin'
        };
        return next();
      }
    } catch (adminErr) {
      logger.debug('[Auth] Admin JWT validation also failed:', adminErr.message);
    }
  }

  // 3. API key auth (edge devices) — try global key first, then per-farm key
  if (req.headers['x-api-key'] && req.headers['x-farm-id']) {
    const apiKey = req.headers['x-api-key'];
    const farmId = req.headers['x-farm-id'];

    if (isValidApiKey(apiKey)) {
      req.user = { farmId, role: 'admin', authMethod: 'api-key' };
      return next();
    }

    // Fallback: per-farm API key (e.g. Light Engine using farm-specific key)
    if (/^[a-f0-9]{64}$/.test(apiKey)) {
      try {
        const validFarmKey = await isValidFarmApiKey(farmId, apiKey);
        if (validFarmKey) {
          req.user = { farmId, role: 'admin', authMethod: 'farm-api-key' };
          return next();
        }
      } catch (err) {
        logger.warn('[Auth] Per-farm API key check failed:', err.message);
      }
    }

    logger.warn('[Auth] Invalid API key from', farmId);
    return res.status(401).json({ error: 'Invalid API key' });
  }

  // 4. Local dev mode only
  if (!isProduction()) {
    const devFarmId = req.headers['x-farm-id'] || process.env.FARM_ID;
    if (devFarmId) {
      req.user = {
        farmId: devFarmId,
        role: 'admin',
        authMethod: 'dev-local'
      };
      return next();
    }
  }

  // No valid credentials
  logger.warn('[Auth] authOrAdmin: no valid credentials for', req.path);
  return res.status(401).json({ error: 'Authentication required' });
}
