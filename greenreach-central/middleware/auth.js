import jwt from 'jsonwebtoken';
import { AuthenticationError, AuthorizationError } from './errorHandler.js';
import logger from '../utils/logger.js';

export function authMiddleware(req, res, next) {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AuthenticationError('No token provided');
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Attach user info to request
    req.user = {
      id: decoded.userId,
      email: decoded.email,
      farmId: decoded.farmId,
      role: decoded.role
    };

    logger.debug('User authenticated', {
      userId: req.user.id,
      farmId: req.user.farmId,
      role: req.user.role
    });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AuthenticationError('Invalid token'));
    } else if (error.name === 'TokenExpiredError') {
      next(new AuthenticationError('Token expired'));
    } else {
      next(error);
    }
  }
}

// Middleware to check if user has required role
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError());
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AuthorizationError(`Requires one of: ${allowedRoles.join(', ')}`));
    }

    next();
  };
}

// Middleware to verify API key (for edge devices)
export async function apiKeyAuth(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      throw new AuthenticationError('API key required');
    }

    // Verify API key against database
    // This is a placeholder - implement actual verification
    const farmId = req.headers['x-farm-id'];
    if (!farmId) {
      throw new AuthenticationError('Farm ID required');
    }

    // TODO: Verify API key matches farm_id in database
    // const farm = await Farm.findByApiKey(apiKey);
    // if (!farm || farm.farm_id !== farmId) {
    //   throw new AuthenticationError('Invalid API key');
    // }

    req.farmId = farmId;
    req.authenticated = true;

    next();
  } catch (error) {
    next(error);
  }
}
