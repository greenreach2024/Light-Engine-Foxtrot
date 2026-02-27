/**
 * Auth Middleware
 * Extracts farm context from JWT tokens, API keys, or headers.
 * Supports multi-tenant SaaS: every request is scoped to a farmId.
 */

import jwt from 'jsonwebtoken';
import logger from '../utils/logger.js';

function getJwtSecret() {
  if (!process.env.JWT_SECRET && (process.env.NODE_ENV === 'production' || process.env.DEPLOYMENT_MODE === 'cloud')) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  return process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');
}
const JWT_SECRET = getJwtSecret();

/**
 * Basic auth middleware — extracts farmId from JWT token, API key header,
 * or falls back to local farm.
 *
 * Sets req.user = { farmId, role, email, name, userId }
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

  // 2. API key auth (edge devices)
  if (req.headers['x-api-key'] && req.headers['x-farm-id']) {
    req.user = {
      farmId: req.headers['x-farm-id'],
      role: 'admin',
      authMethod: 'api-key'
    };
    return next();
  }

  // 3. Fallback to headers or env (single-farm / local dev mode)
  req.user = {
    farmId: req.headers['x-farm-id'] || process.env.FARM_ID || 'FARM-LOCAL',
    role: 'admin',
    authMethod: 'fallback'
  };
  next();
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
