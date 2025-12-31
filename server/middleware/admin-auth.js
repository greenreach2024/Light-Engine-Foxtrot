/**
 * Admin Authentication Middleware
 * Protects admin-only routes with JWT verification
 */

import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || crypto.randomBytes(32).toString('hex');
const JWT_EXPIRY = '12h'; // 12 hour sessions

/**
 * Generate admin JWT token
 */
export function generateAdminToken(admin) {
  return jwt.sign(
    {
      adminId: admin.id,
      email: admin.email,
      role: admin.permissions ? 'super_admin' : 'admin', // Derive from permissions
      name: admin.name
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify admin JWT token
 */
export function verifyAdminToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

/**
 * Hash token for database storage
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Admin authentication middleware
 * Validates JWT and checks session in database
 */
export async function adminAuthMiddleware(req, res, next) {
  try {
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
        message: 'No authorization token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    // Verify JWT
    const decoded = verifyAdminToken(token);
    if (!decoded) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token',
        message: 'Token verification failed'
      });
    }

    // Check if session exists and is valid
    const tokenHash = hashToken(token);
    const sessionQuery = `
      SELECT 
        s.id as session_id,
        s.admin_id,
        s.expires_at,
        u.email,
        u.name,
        u.active
      FROM admin_sessions s
      JOIN admin_users u ON s.admin_id = u.id
      WHERE s.token_hash = $1
    `;

    const { rows } = await req.db.query(sessionQuery, [tokenHash]);
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Invalid session',
        message: 'Session not found'
      });
    }

    const session = rows[0];

    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      return res.status(401).json({
        success: false,
        error: 'Session expired',
        message: 'Your session has expired. Please login again.'
      });
    }

    // Check if account is active
    if (!session.active) {
      return res.status(401).json({
        success: false,
        error: 'Account disabled',
        message: 'Your account has been disabled'
      });
    }

    // Attach admin info to request
    req.admin = {
      id: session.admin_id,
      email: session.email,
      name: session.name,
      role: 'admin', // Can enhance this based on permissions later
      session_id: session.session_id
    };

    next();
  } catch (error) {
    console.error('Admin auth middleware error:', error);
    return res.status(500).json({
      success: false,
      error: 'Authentication error',
      message: 'Internal server error during authentication'
    });
  }
}

/**
 * Role-based authorization middleware
 * Use after adminAuthMiddleware
 */
export function requireAdminRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.admin) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    if (!allowedRoles.includes(req.admin.role)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This action requires one of: ${allowedRoles.join(', ')}`
      });
    }

    next();
  };
}

/**
 * Audit logging middleware for admin actions
 * Use after adminAuthMiddleware
 */
export function auditAdminAction(action, resourceType) {
  return async (req, res, next) => {
    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);

    res.json = async function(data) {
      // Log the admin action
      try {
        const auditQuery = `
          INSERT INTO admin_audit_log (
            admin_user_id,
            action,
            resource_type,
            resource_id,
            details,
            ip_address,
            user_agent,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `;

        const resourceId = req.params.farmId || req.params.email || req.params.id || null;
        const status = res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'error';

        await req.db.query(auditQuery, [
          req.admin?.admin_user_id || null,
          action,
          resourceType,
          resourceId,
          JSON.stringify({
            method: req.method,
            path: req.path,
            query: req.query,
            body: req.body,
            response: data
          }),
          req.ip,
          req.headers['user-agent'],
          status
        ]);
      } catch (error) {
        console.error('Audit logging error:', error);
      }

      // Call original res.json
      return originalJson(data);
    };

    next();
  };
}
