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
import Datastore from 'nedb-promises';
import fs from 'node:fs';
import path from 'node:path';

const IS_TEST_ENV = process.env.NODE_ENV === 'test' || String(process.env.TEST_MODE).toLowerCase() === 'true' || String(process.env.TEST_MODE) === '1';
if (!IS_TEST_ENV) {
  try { fs.mkdirSync(path.resolve('data'), { recursive: true }); } catch {}
}

class AuditLogger {
  constructor() {
    // Persistent append-only audit log (NeDB)
    this.db = Datastore.create({
      filename: 'data/audit-log.db',
      autoload: !IS_TEST_ENV,
      inMemoryOnly: IS_TEST_ENV,
    });
    this.db.ensureIndex({ fieldName: 'entity_type' });
    this.db.ensureIndex({ fieldName: 'entity_id' });
    this.db.ensureIndex({ fieldName: 'user_id' });
    this.db.ensureIndex({ fieldName: 'timestamp' });
    // Auto-compact every 10 minutes
    this.db.persistence.setAutocompactionInterval(600000);
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

      // Persist to NeDB (append-only)
      await this.db.insert(logEntry);

      // Log to console for debugging
      console.log(` AUDIT: ${action} ${entityType} ${entityId} by ${userId || 'system'}`);

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
  async query(filters = {}) {
    const q = {};
    if (filters.entityType) q.entity_type = filters.entityType;
    if (filters.entityId) q.entity_id = filters.entityId;
    if (filters.userId) q.user_id = filters.userId;
    if (filters.action) q.action = filters.action;
    if (filters.fromDate || filters.toDate) {
      q.timestamp = {};
      if (filters.fromDate) q.timestamp.$gte = new Date(filters.fromDate).toISOString();
      if (filters.toDate) q.timestamp.$lte = new Date(filters.toDate).toISOString();
    }

    const offset = filters.offset || 0;
    const limit = filters.limit || 100;

    return this.db.find(q).sort({ timestamp: -1 }).skip(offset).limit(limit);
  }

  /**
   * Get audit trail for a specific entity
   * 
   * @param {string} entityType
   * @param {string} entityId
   * @returns {Array} Chronological log entries for entity
   */
  async getEntityHistory(entityType, entityId) {
    return this.db.find({ entity_type: entityType, entity_id: entityId }).sort({ timestamp: 1 });
  }

  /**
   * Get all actions by a user
   * 
   * @param {string} userId
   * @param {number} limit
   * @returns {Array} User's recent actions
   */
  async getUserActivity(userId, limit = 100) {
    return this.db.find({ user_id: userId }).sort({ timestamp: -1 }).limit(limit);
  }

  /**
   * Get summary statistics
   * 
   * @param {Date} fromDate
   * @param {Date} toDate
   * @returns {Object} Summary stats
   */
  async getSummary(fromDate = null, toDate = null) {
    const q = {};
    if (fromDate || toDate) {
      q.timestamp = {};
      if (fromDate) q.timestamp.$gte = new Date(fromDate).toISOString();
      if (toDate) q.timestamp.$lte = new Date(toDate).toISOString();
    }

    const logs = await this.db.find(q);

    // Calculate stats
    const byEntityType = {};
    const byAction = {};
    const byUser = {};

    logs.forEach(log => {
      byEntityType[log.entity_type] = (byEntityType[log.entity_type] || 0) + 1;
      byAction[log.action] = (byAction[log.action] || 0) + 1;
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
  async export(filters = {}) {
    const logs = await this.query(filters);
    return JSON.stringify(logs, null, 2);
  }

  /**
   * Get total log count
   */
  async getCount() {
    return this.db.count({});
  }

  /**
   * Clear old logs (for testing only)
   * WARNING: Never use in production
   */
  async clearOldLogs(olderThanDays) {
    const cutoffTime = new Date();
    cutoffTime.setDate(cutoffTime.getDate() - olderThanDays);
    const cutoffISO = cutoffTime.toISOString();

    const removed = await this.db.remove({ timestamp: { $lt: cutoffISO } }, { multi: true });

    console.log(`🗑 Cleared ${removed} audit logs older than ${olderThanDays} days`);
    return removed;
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
  router.get('/logs', async (req, res) => {
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

      const logs = await auditLogger.query(filters);

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
  router.get('/entity/:type/:id', async (req, res) => {
    try {
      const { type, id } = req.params;
      const history = await auditLogger.getEntityHistory(type, id);

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
  router.get('/user/:user_id', async (req, res) => {
    try {
      const { user_id } = req.params;
      const limit = parseInt(req.query.limit) || 100;
      const activity = await auditLogger.getUserActivity(user_id, limit);

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
  router.get('/summary', async (req, res) => {
    try {
      const fromDate = req.query.from_date ? new Date(req.query.from_date) : null;
      const toDate = req.query.to_date ? new Date(req.query.to_date) : null;

      const summary = await auditLogger.getSummary(fromDate, toDate);

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
  router.get('/export', async (req, res) => {
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

      const json = await auditLogger.export(filters);

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
