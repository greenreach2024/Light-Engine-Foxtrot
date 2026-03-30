/**
 * Multi-Tenant Middleware
 * Enforces tenant isolation for cloud-hosted Light Engine instances
 * Each farm gets their own subdomain: farm-name.greenreach.io
 */

import { getDb } from '../db/index.js';

/**
 * Extract tenant ID from subdomain
 * Examples:
 *   butterhead-farm.greenreach.io → butterhead-farm
 *   localhost → 'default' (for development)
 */
export function extractTenantId(req) {
  const host = req.hostname || req.headers.host || '';
  
  // Development mode - use default tenant or from header
  if (host.includes('localhost') || host.includes('127.0.0.1')) {
    return req.headers['x-tenant-id'] || process.env.DEFAULT_TENANT_ID || 'default';
  }
  
  // Extract subdomain from hostname
  // butterhead-farm.greenreach.io → butterhead-farm
  const parts = host.split('.');
  if (parts.length >= 3) {
    return parts[0]; // First part is tenant ID
  }
  
  // Fallback for direct domain access
  return 'default';
}

/**
 * Tenant isolation middleware
 * Attaches tenant context to every request
 */
export function tenantMiddleware(req, res, next) {
  const tenantId = extractTenantId(req);
  
  // Attach tenant to request
  req.tenantId = tenantId;
  req.tenant = {
    id: tenantId,
    subdomain: tenantId
  };
  
  // Log tenant access (optional, can be verbose)
  if (process.env.LOG_TENANT_ACCESS === 'true') {
    console.log(`[Tenant] ${req.method} ${req.path} - Tenant: ${tenantId}`);
  }
  
  next();
}

/**
 * Validate tenant exists
 * Returns 404 if tenant is not registered
 */
export async function validateTenant(req, res, next) {
  const { tenantId } = req;
  
  if (!tenantId || tenantId === 'default') {
    return next(); // Allow default tenant
  }
  
  try {
    const db = getDb();
    
    // Check if tenant exists in database
    const tenant = await db.query(
      'SELECT id, name, active FROM tenants WHERE subdomain = $1',
      [tenantId]
    );
    
    if (!tenant.rows || tenant.rows.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
        message: `Farm '${tenantId}' is not registered. Contact support@greenreach.io`,
        tenantId
      });
    }
    
    const tenantRecord = tenant.rows[0];
    
    // Check if tenant is active
    if (!tenantRecord.active) {
      return res.status(403).json({
        error: 'Tenant suspended',
        message: 'This farm account has been suspended. Contact support@greenreach.io',
        tenantId
      });
    }
    
    // Attach full tenant info
    req.tenant = {
      id: tenantRecord.id,
      subdomain: tenantId,
      name: tenantRecord.name,
      active: tenantRecord.active
    };
    
    next();
  } catch (error) {
    console.error('[Tenant] Validation error:', error);
    res.status(500).json({
      error: 'Tenant validation failed',
      message: error.message
    });
  }
}

/**
 * Scope database query to tenant
 * Automatically adds WHERE tenant_id = $1 to queries
 */
export function scopeQuery(baseQuery, tenantId, params = []) {
  // If query already has WHERE clause
  if (baseQuery.toUpperCase().includes('WHERE')) {
    return {
      query: baseQuery.replace(/WHERE/i, `WHERE tenant_id = $1 AND`),
      params: [tenantId, ...params]
    };
  }
  
  // If query has no WHERE clause, add one
  const insertPoint = baseQuery.toUpperCase().indexOf('ORDER BY');
  if (insertPoint !== -1) {
    const before = baseQuery.substring(0, insertPoint);
    const after = baseQuery.substring(insertPoint);
    return {
      query: `${before} WHERE tenant_id = $1 ${after}`,
      params: [tenantId, ...params]
    };
  }
  
  // No ORDER BY, append WHERE at end
  return {
    query: `${baseQuery} WHERE tenant_id = $1`,
    params: [tenantId, ...params]
  };
}

/**
 * Tenant-scoped database wrapper
 * All queries automatically filtered by tenant
 */
export class TenantDb {
  constructor(tenantId) {
    this.tenantId = tenantId;
    this.db = getDb();
  }
  
  /**
   * Query with automatic tenant scoping
   */
  async query(sql, params = []) {
    // Add tenant_id to params
    const scopedParams = [this.tenantId, ...params];
    
    // Modify query to include tenant filter
    let scopedSql = sql;
    if (!sql.toUpperCase().includes('WHERE')) {
      scopedSql = sql.replace(/FROM\s+(\w+)/i, 'FROM $1 WHERE tenant_id = $1');
    } else {
      scopedSql = sql.replace(/WHERE/i, 'WHERE tenant_id = $1 AND');
    }
    
    return this.db.query(scopedSql, scopedParams);
  }
  
  /**
   * Insert with automatic tenant_id
   */
  async insert(table, data) {
    const columns = [...Object.keys(data), 'tenant_id'];
    const values = [...Object.values(data), this.tenantId];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    
    const sql = `
      INSERT INTO ${table} (${columns.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `;
    
    return this.db.query(sql, values);
  }
  
  /**
   * Update with automatic tenant scoping
   */
  async update(table, data, where, whereParams = []) {
    const updates = Object.keys(data)
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ');
    
    const sql = `
      UPDATE ${table}
      SET ${updates}
      WHERE tenant_id = $1 AND ${where}
      RETURNING *
    `;
    
    return this.db.query(sql, [this.tenantId, ...Object.values(data), ...whereParams]);
  }
  
  /**
   * Delete with automatic tenant scoping
   */
  async delete(table, where, whereParams = []) {
    const sql = `
      DELETE FROM ${table}
      WHERE tenant_id = $1 AND ${where}
      RETURNING *
    `;
    
    return this.db.query(sql, [this.tenantId, ...whereParams]);
  }
}

/**
 * Get tenant-scoped database instance
 */
export function getTenantDb(req) {
  return new TenantDb(req.tenantId);
}

/**
 * S3 prefix for tenant files
 * Ensures files are isolated per tenant
 */
export function getTenantS3Prefix(tenantId) {
  return `tenants/${tenantId}/`;
}

/**
 * Tenant-scoped file upload path
 */
export function getTenantUploadPath(tenantId) {
  return `uploads/${tenantId}/`;
}

export default {
  extractTenantId,
  tenantMiddleware,
  validateTenant,
  scopeQuery,
  TenantDb,
  getTenantDb,
  getTenantS3Prefix,
  getTenantUploadPath
};
