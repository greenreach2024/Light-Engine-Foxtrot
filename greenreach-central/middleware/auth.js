/**
 * Auth Middleware
 */

import logger from '../utils/logger.js';

/**
 * Basic auth middleware (passthrough for now, ready for JWT/session)
 */
export function authMiddleware(req, res, next) {
  // TODO: Implement JWT/session validation
  // For now, extract farmId from headers or default to local farm
  req.user = {
    farmId: req.headers['x-farm-id'] || process.env.FARM_ID || 'FARM-LOCAL',
    role: 'admin' // TODO: Extract from token
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
