/**
 * Rate Limiting Middleware
 * 
 * Implements rate limiting to prevent API abuse and DDoS attacks.
 * Uses in-memory store for single-server deployments.
 * For distributed systems, use Redis store (rate-limit-redis).
 */

const rateLimits = new Map(); // key -> { count, resetAt }

/**
 * Create a rate limiter middleware
 * @param {Object} options - Rate limiter configuration
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.max - Maximum number of requests per window
 * @param {string} options.message - Error message for rate limited requests
 * @param {Function} options.keyGenerator - Function to generate rate limit key from request
 * @returns {Function} Express middleware
 */
export function createRateLimiter(options = {}) {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes default
    max = 100, // 100 requests per window default
    message = 'Too many requests, please try again later.',
    keyGenerator = (req) => req.ip || req.connection.remoteAddress || 'unknown',
    skip = (req) => false, // Skip rate limiting for certain requests
  } = options;

  return (req, res, next) => {
    // Check if rate limiting should be skipped
    if (skip(req)) {
      return next();
    }

    const key = keyGenerator(req);
    const now = Date.now();
    
    // Get or initialize rate limit data for this key
    let limit = rateLimits.get(key);
    
    // Reset if window has expired
    if (!limit || now > limit.resetAt) {
      limit = {
        count: 0,
        resetAt: now + windowMs,
      };
      rateLimits.set(key, limit);
    }
    
    // Increment request count
    limit.count++;
    
    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - limit.count));
    res.setHeader('X-RateLimit-Reset', new Date(limit.resetAt).toISOString());
    
    // Check if rate limit exceeded
    if (limit.count > max) {
      res.setHeader('Retry-After', Math.ceil((limit.resetAt - now) / 1000));
      return res.status(429).json({
        error: 'Too Many Requests',
        message,
        retryAfter: Math.ceil((limit.resetAt - now) / 1000),
      });
    }
    
    next();
  };
}

/**
 * Cleanup expired rate limit entries periodically
 */
export function startRateLimitCleanup(intervalMs = 60000) {
  setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, limit] of rateLimits.entries()) {
      if (now > limit.resetAt) {
        rateLimits.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      console.log(`[RateLimit] Cleaned ${cleaned} expired entries`);
    }
  }, intervalMs);
}

/**
 * Predefined rate limiters for common use cases
 */

// Strict rate limiter for authentication endpoints
export const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.',
});

// Standard rate limiter for API endpoints
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // 500 requests per 15 minutes
  message: 'Too many requests, please try again later.',
});

// Relaxed rate limiter for read-only endpoints
export const readRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 minutes
  message: 'Too many requests, please try again later.',
});

// Strict rate limiter for write operations
export const writeRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 write requests per 15 minutes
  message: 'Too many write requests, please try again later.',
});

// Start cleanup process
startRateLimitCleanup();

export default {
  createRateLimiter,
  authRateLimiter,
  apiRateLimiter,
  readRateLimiter,
  writeRateLimiter,
  startRateLimitCleanup,
};
