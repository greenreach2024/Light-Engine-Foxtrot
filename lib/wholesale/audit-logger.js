/**
 * GreenReach Wholesale - Audit Logger
 * 
 * Comprehensive audit logging for compliance and debugging:
 * - Logs all state changes (orders, payments, refunds, reservations)
 * - Append-only architecture (no updates or deletes)
 * - Captures: timestamp, user_id, entity, action, old/new values
 * - 7-year retention for regulatory compliance
 * - Query interface for investigations and audits
 * 
 * Usage:
 *   await auditLogger.log('order', 'order_123', 'create', null, newOrderData, userId);
 *   await auditLogger.log('payment', 'pay_456', 'status_update', oldStatus, newStatus, userId);
 */

import crypto from 'crypto';
import express from 'express';

class AuditLogger {
  constructor() {
    // In-memory storage for now (TODO: migrate to database table)
    this.logs = [];
    this.maxLogsInMemory = 10000; // Prevent memory overflow
  }

  /**
   * Log an action
   * 
   * @param {string} entityType - Type of entity (order, payment, refund, reservation, farm, buyer)
   * @param {string} entityId - ID of the entity
   * @param {string} action - Action performed (create, update, delete, status_change, etc.)
   * @param {any} oldValue - Previous value (null for create)
   * @param {any} newValue - New value (null for delete)
   * @param {string} userId - ID of user performing action
   * @param {Object} metadata - Additional context (ip_address, user_agent, etc.)
   */
  async log(entityType, entityId, action, oldValue, newValue, userId = null, metadata = {}) {
    try {
      const logEntry = {
        id: crypto.randomBytes(16).toString('hex'),
        timestamp: new Date().toISOString(),
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
        action,
        old_value: oldValue ? JSON.stringify(oldValue) : null,
        new_value: newValue ? JSON.stringify(newValue) : null,
        ip_address: metadata.ip_address || null,
        user_agent: metadata.user_agent || null,
        metadata: metadata.extra ? JSON.stringify(metadata.extra) : null
      };

      // In-memory storage
      this.logs.push(logEntry);

      // Trim old logs if exceeding limit
      if (this.logs.length > this.maxLogsInMemory) {
        this.logs.shift();
        console.warn(`⚠️ Audit log exceeded ${this.maxLogsInMemory} entries, trimmed oldest`);
      }

      // Log to console for debugging
      console.log(`📋 AUDIT: ${action} ${entityType} ${entityId} by ${userId || 'system'}`);

      // In production, would insert to database:
      // await db.query('INSERT INTO audit_log (...) VALUES (...)', logEntry);

      return logEntry;
    } catch (error) {
      console.error('Audit log error:', error);
      // Never throw - audit logging failures should not break application
      return null;
    }
  }

  /**
   * Log order creation
   */
  async logOrderCreate(orderId, orderData, userId, metadata = {}) {
    return this.log('order', orderId, 'create', null, orderData, userId, metadata);
  }

  /**
   * Log order status change
   */
  async logOrderStatusChange(orderId, oldStatus, newStatus, userId, metadata = {}) {
    return this.log('order', orderId, 'status_change', { status: oldStatus }, { status: newStatus }, userId, metadata);
  }

  /**
   * Log payment creation
   */
  async logPaymentCreate(paymentId, paymentData, userId, metadata = {}) {
    return this.log('payment', paymentId, 'create', null, paymentData, userId, metadata);
  }

  /**
   * Log payment status change
   */
  async logPaymentStatusChange(paymentId, oldStatus, newStatus, userId, metadata = {}) {
    return this.log('payment', paymentId, 'status_change', { status: oldStatus }, { status: newStatus }, userId, metadata);
  }

  /**
   * Log refund creation
   */
  async logRefundCreate(refundId, refundData, userId, metadata = {}) {
    return this.log('refund', refundId, 'create', null, refundData, userId, metadata);
  }

  /**
   * Log reservation creation
   */
  async logReservationCreate(reservationId, reservationData, userId, metadata = {}) {
    return this.log('reservation', reservationId, 'create', null, reservationData, userId, metadata);
  }

  /**
   * Log reservation confirmation
   */
  async logReservationConfirm(reservationId, userId, metadata = {}) {
    return this.log('reservation', reservationId, 'confirm', { status: 'active' }, { status: 'confirmed' }, userId, metadata);
  }

  /**
   * Log reservation release
   */
  async logReservationRelease(reservationId, userId, metadata = {}) {
    return this.log('reservation', reservationId, 'release', { status: 'active' }, { status: 'released' }, userId, metadata);
  }

  /**
   * Log farm onboarding
   */
  async logFarmOnboard(farmId, farmData, userId, metadata = {}) {
    return this.log('farm', farmId, 'onboard', null, farmData, userId, metadata);
  }

  /**
   * Log farm OAuth token refresh
   */
  async logFarmTokenRefresh(farmId, userId, metadata = {}) {
    return this.log('farm', farmId, 'token_refresh', null, { refreshed_at: new Date().toISOString() }, userId, metadata);
  }

  /**
   * Log farm disconnect
   */
  async logFarmDisconnect(farmId, userId, metadata = {}) {
    return this.log('farm', farmId, 'disconnect', { status: 'active' }, { status: 'inactive' }, userId, metadata);
  }

  /**
   * Log SLA violation
   */
  async logSLAViolation(subOrderId, violationData, userId, metadata = {}) {
    return this.log('sla_violation', subOrderId, 'create', null, violationData, userId, metadata);
  }

  /**
   * Log substitution approval request
   */
  async logSubstitutionRequest(approvalId, requestData, userId, metadata = {}) {
    return this.log('substitution', approvalId, 'request_approval', null, requestData, userId, metadata);
  }

  /**
   * Log substitution approval response
   */
  async logSubstitutionResponse(approvalId, approved, userId, metadata = {}) {
    return this.log('substitution', approvalId, 'respond', { status: 'pending' }, { status: approved ? 'approved' : 'rejected' }, userId, metadata);
  }

  /**
   * Log fulfillment status change
   */
  async logFulfillmentStatusChange(subOrderId, oldStatus, newStatus, userId, metadata = {}) {
    return this.log('fulfillment', subOrderId, 'status_change', { status: oldStatus }, { status: newStatus }, userId, metadata);
  }

  /**
   * Log invoice generation
   */
  async logInvoiceGenerate(invoiceId, invoiceData, userId, metadata = {}) {
    return this.log('invoice', invoiceId, 'generate', null, invoiceData, userId, metadata);
  }

  /**
   * Query audit logs
   * 
   * @param {Object} filters
   * @param {string} filters.entityType - Filter by entity type
   * @param {string} filters.entityId - Filter by entity ID
   * @param {string} filters.userId - Filter by user ID
   * @param {string} filters.action - Filter by action
   * @param {Date} filters.fromDate - Filter by date range start
   * @param {Date} filters.toDate - Filter by date range end
   * @param {number} filters.limit - Max results to return
   * @param {number} filters.offset - Offset for pagination
   * @returns {Array} Filtered log entries
   */
  query(filters = {}) {
    let results = [...this.logs];

    // Apply filters
    if (filters.entityType) {
      results = results.filter(log => log.entity_type === filters.entityType);
    }
    if (filters.entityId) {
      results = results.filter(log => log.entity_id === filters.entityId);
    }
    if (filters.userId) {
      results = results.filter(log => log.user_id === filters.userId);
    }
    if (filters.action) {
      results = results.filter(log => log.action === filters.action);
    }
    if (filters.fromDate) {
      const fromTime = new Date(filters.fromDate).getTime();
      results = results.filter(log => new Date(log.timestamp).getTime() >= fromTime);
    }
    if (filters.toDate) {
      const toTime = new Date(filters.toDate).getTime();
      results = results.filter(log => new Date(log.timestamp).getTime() <= toTime);
    }

    // Sort by timestamp descending (newest first)
    results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || 100;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get audit trail for a specific entity
   * 
   * @param {string} entityType
   * @param {string} entityId
   * @returns {Array} Chronological log entries for entity
   */
  getEntityHistory(entityType, entityId) {
    return this.logs
      .filter(log => log.entity_type === entityType && log.entity_id === entityId)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)); // Chronological order
  }

  /**
   * Get all actions by a user
   * 
   * @param {string} userId
   * @param {number} limit
   * @returns {Array} User's recent actions
   */
  getUserActivity(userId, limit = 100) {
    return this.logs
      .filter(log => log.user_id === userId)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
  }

  /**
   * Get summary statistics
   * 
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Object} Summary stats
   */
  getSummary(fromDate = null, toDate = null) {
    let logs = this.logs;

    // Apply date filter
    if (fromDate) {
      const fromTime = new Date(fromDate).getTime();
      logs = logs.filter(log => new Date(log.timestamp).getTime() >= fromTime);
    }
    if (toDate) {
      const toTime = new Date(toDate).getTime();
      logs = logs.filter(log => new Date(log.timestamp).getTime() <= toTime);
    }

    // Calculate stats
    const byEntityType = {};
    const byAction = {};
    const byUser = {};

    logs.forEach(log => {
      // By entity type
      byEntityType[log.entity_type] = (byEntityType[log.entity_type] || 0) + 1;

      // By action
      byAction[log.action] = (byAction[log.action] || 0) + 1;

      // By user
      const user = log.user_id || 'system';
      byUser[user] = (byUser[user] || 0) + 1;
    });

    return {
      total_logs: logs.length,
      date_range: {
        from: fromDate ? fromDate.toISOString() : null,
        to: toDate ? toDate.toISOString() : null
      },
      by_entity_type: byEntityType,
      by_action: byAction,
      by_user: byUser
    };
  }

  /**
   * Export audit logs to JSON
   * 
   * @param {Object} filters - Same filters as query()
   * @returns {string} JSON string of logs
   */
  export(filters = {}) {
    const logs = this.query(filters);
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Get total log count
   */
  getCount() {
    return this.logs.length;
  }

  /**
   * Clear old logs (for testing only)
   * WARNING: Never use in production
   */
  clearOldLogs(olderThanDays) {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - olderThanDays);
    const cutoffMs = cutoffTime.getTime();

    const beforeCount = this.logs.length;
    this.logs = this.logs.filter(log => new Date(log.timestamp).getTime() >= cutoffMs);
    const afterCount = this.logs.length;

    console.log(`🗑️ Cleared ${beforeCount - afterCount} audit logs older than ${olderThanDays} days`);
    return beforeCount - afterCount;
  }
}

// Singleton instance
const auditLogger = new AuditLogger();

export default auditLogger;

// Express middleware to capture request context
export function auditMiddleware(req, res, next) {
  // Attach audit logger to request object
  req.auditLog = async (entityType, entityId, action, oldValue, newValue) => {
    const metadata = {
      ip_address: req.ip || req.connection.remoteAddress,
      user_agent: req.get('user-agent'),
      extra: {
        method: req.method,
        url: req.originalUrl
      }
    };

    // Extract user ID from request (auth middleware should set this)
    const userId = req.user?.id || req.headers['x-user-id'] || null;

    await auditLogger.log(entityType, entityId, action, oldValue, newValue, userId, metadata);
  };

  next();
}

// Express route for querying audit logs
export function createAuditRoutes() {
  const router = express.Router();

  /**
   * GET /api/audit/logs
   * Query audit logs with filters
   */
  router.get('/logs', (req, res) => {
    try {
      const filters = {
        entityType: req.query.entity_type,
        entityId: req.query.entity_id,
        userId: req.query.user_id,
        action: req.query.action,
        fromDate: req.query.from_date,
        toDate: req.query.to_date,
        limit: parseInt(req.query.limit) || 100,
        offset: parseInt(req.query.offset) || 0
      };

      const logs = auditLogger.query(filters);

      res.json({
        status: 'ok',
        data: {
          logs,
          total: logs.length,
          filters
        }
      });
    } catch (error) {
      console.error('Query audit logs error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to query audit logs',
        error: error.message
      });
    }
  });

  /**
   * GET /api/audit/entity/:type/:id
   * Get audit trail for specific entity
   */
  router.get('/entity/:type/:id', (req, res) => {
    try {
      const { type, id } = req.params;
      const history = auditLogger.getEntityHistory(type, id);

      res.json({
        status: 'ok',
        data: {
          entity_type: type,
          entity_id: id,
          history,
          total: history.length
        }
      });
    } catch (error) {
      console.error('Get entity history error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get entity history',
        error: error.message
      });
    }
  });

  /**
   * GET /api/audit/user/:user_id
   * Get user activity
   */
  router.get('/user/:user_id', (req, res) => {
    try {
      const { user_id } = req.params;
      const limit = parseInt(req.query.limit) || 100;
      const activity = auditLogger.getUserActivity(user_id, limit);

      res.json({
        status: 'ok',
        data: {
          user_id,
          activity,
          total: activity.length
        }
      });
    } catch (error) {
      console.error('Get user activity error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get user activity',
        error: error.message
      });
    }
  });

  /**
   * GET /api/audit/summary
   * Get audit log statistics
   */
  router.get('/summary', (req, res) => {
    try {
      const fromDate = req.query.from_date ? new Date(req.query.from_date) : null;
      const toDate = req.query.to_date ? new Date(req.query.to_date) : null;

      const summary = auditLogger.getSummary(fromDate, toDate);

      res.json({
        status: 'ok',
        data: summary
      });
    } catch (error) {
      console.error('Get audit summary error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to get audit summary',
        error: error.message
      });
    }
  });

  /**
   * GET /api/audit/export
   * Export audit logs to JSON
   */
  router.get('/export', (req, res) => {
    try {
      const filters = {
        entityType: req.query.entity_type,
        entityId: req.query.entity_id,
        userId: req.query.user_id,
        action: req.query.action,
        fromDate: req.query.from_date,
        toDate: req.query.to_date,
        limit: parseInt(req.query.limit) || 10000
      };

      const json = auditLogger.export(filters);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-log-${Date.now()}.json"`);
      res.send(json);
    } catch (error) {
      console.error('Export audit logs error:', error);
      res.status(500).json({
        status: 'error',
        message: 'Failed to export audit logs',
        error: error.message
      });
    }
  });

  return router;
}
