/**
 * Audit Logging System
 * 
 * Provides structured logging for security-sensitive events:
 * - Authentication (login, logout, failed attempts)
 * - Authorization (permission changes, role updates)
 * - Data access (sensitive data reads)
 * - Configuration changes
 * 
 * Logs are written to:
 * 1. Console (for CloudWatch Logs in AWS)
 * 2. File system (logs/audit.log)
 * 3. Can be extended to send to external SIEM systems
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const LOGS_DIR = path.join(__dirname, '../../logs');
const AUDIT_LOG_FILE = path.join(LOGS_DIR, 'audit.log');

try {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
} catch (error) {
  console.error('[AuditLog] Failed to create logs directory:', error);
}

/**
 * Event types for audit logging
 */
export const AuditEventType = {
  // Authentication
  LOGIN_SUCCESS: 'auth.login.success',
  LOGIN_FAILURE: 'auth.login.failure',
  LOGOUT: 'auth.logout',
  TOKEN_GENERATED: 'auth.token.generated',
  TOKEN_VALIDATED: 'auth.token.validated',
  TOKEN_EXPIRED: 'auth.token.expired',
  TOKEN_INVALID: 'auth.token.invalid',
  
  // Password management
  PASSWORD_RESET_REQUESTED: 'auth.password.reset_requested',
  PASSWORD_RESET_COMPLETED: 'auth.password.reset_completed',
  PASSWORD_CHANGED: 'auth.password.changed',
  
  // Authorization
  PERMISSION_DENIED: 'authz.permission.denied',
  ROLE_CHANGED: 'authz.role.changed',
  ACCESS_GRANTED: 'authz.access.granted',
  
  // Data access
  SENSITIVE_DATA_READ: 'data.sensitive.read',
  SENSITIVE_DATA_WRITE: 'data.sensitive.write',
  SENSITIVE_DATA_DELETE: 'data.sensitive.delete',
  
  // Configuration
  CONFIG_CHANGED: 'config.changed',
  FEATURE_TOGGLED: 'config.feature.toggled',
};

/**
 * Write audit log entry
 * @param {Object} entry - Audit log entry
 */
function writeAuditLog(entry) {
  const logLine = JSON.stringify(entry) + '\\n';
  
  // Write to console (CloudWatch Logs)
  console.log('[AUDIT]', JSON.stringify(entry));
  
  // Write to file
  try {
    fs.appendFileSync(AUDIT_LOG_FILE, logLine);
  } catch (error) {
    console.error('[AuditLog] Failed to write to file:', error);
  }
}

/**
 * Log an audit event
 * @param {string} eventType - Event type from AuditEventType
 * @param {Object} details - Event-specific details
 * @param {Object} req - Express request object (optional)
 */
export function logAuditEvent(eventType, details = {}, req = null) {
  const entry = {
    timestamp: new Date().toISOString(),
    eventType,
    details,
  };
  
  // Add request context if available
  if (req) {
    entry.context = {
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.get('user-agent'),
      method: req.method,
      path: req.path,
      userId: req.user?.id || req.userId,
      tenantId: req.user?.tenant_id || req.tenantId,
    };
  }
  
  writeAuditLog(entry);
}

/**
 * Audit logging middleware
 * Automatically logs requests to sensitive endpoints
 */
export function auditMiddleware(options = {}) {
  const {
    sensitiveEndpoints = ['/api/auth', '/api/users', '/api/admin'],
    logAllRequests = false,
  } = options;
  
  return (req, res, next) => {
    const isSensitive = sensitiveEndpoints.some(endpoint => 
      req.path.startsWith(endpoint)
    );
    
    if (logAllRequests || isSensitive) {
      logAuditEvent(AuditEventType.ACCESS_GRANTED, {
        endpoint: req.path,
        sensitive: isSensitive,
      }, req);
    }
    
    next();
  };
}

/**
 * Convenience functions for common audit events
 */

export function logLoginSuccess(userId, email, req) {
  logAuditEvent(AuditEventType.LOGIN_SUCCESS, {
    userId,
    email,
  }, req);
}

export function logLoginFailure(email, reason, req) {
  logAuditEvent(AuditEventType.LOGIN_FAILURE, {
    email,
    reason,
  }, req);
}

export function logLogout(userId, email, req) {
  logAuditEvent(AuditEventType.LOGOUT, {
    userId,
    email,
  }, req);
}

export function logTokenGenerated(userId, email, expiresAt, req) {
  logAuditEvent(AuditEventType.TOKEN_GENERATED, {
    userId,
    email,
    expiresAt,
  }, req);
}

export function logPasswordResetRequested(email, req) {
  logAuditEvent(AuditEventType.PASSWORD_RESET_REQUESTED, {
    email,
  }, req);
}

export function logPasswordResetCompleted(userId, email, req) {
  logAuditEvent(AuditEventType.PASSWORD_RESET_COMPLETED, {
    userId,
    email,
  }, req);
}

export function logPasswordChanged(userId, email, req) {
  logAuditEvent(AuditEventType.PASSWORD_CHANGED, {
    userId,
    email,
  }, req);
}

export function logRoleChanged(userId, email, oldRole, newRole, changedBy, req) {
  logAuditEvent(AuditEventType.ROLE_CHANGED, {
    userId,
    email,
    oldRole,
    newRole,
    changedBy,
  }, req);
}

export function logPermissionDenied(resource, action, reason, req) {
  logAuditEvent(AuditEventType.PERMISSION_DENIED, {
    resource,
    action,
    reason,
  }, req);
}

export default {
  AuditEventType,
  logAuditEvent,
  auditMiddleware,
  logLoginSuccess,
  logLoginFailure,
  logLogout,
  logTokenGenerated,
  logPasswordResetRequested,
  logPasswordResetCompleted,
  logPasswordChanged,
  logRoleChanged,
  logPermissionDenied,
};
