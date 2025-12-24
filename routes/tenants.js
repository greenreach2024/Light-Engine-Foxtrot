/**
 * Tenant Management Routes
 * Admin endpoints for managing multi-tenant cloud instance
 */

import express from 'express';
import { getDb } from '../db/index.js';
import crypto from 'crypto';

const router = express.Router();

/**
 * POST /api/tenants/register
 * Register a new farm tenant (admin only)
 */
router.post('/register', async (req, res) => {
  try {
    const { farmName, contactEmail, tier, subdomain } = req.body;
    
    if (!farmName || !contactEmail || !subdomain) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['farmName', 'contactEmail', 'subdomain']
      });
    }
    
    // Validate subdomain format
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    if (!subdomainRegex.test(subdomain)) {
      return res.status(400).json({
        error: 'Invalid subdomain',
        message: 'Subdomain must be lowercase, alphanumeric, and may contain hyphens'
      });
    }
    
    const db = getDb();
    
    // Check if subdomain is already taken
    const existing = await db.query(
      'SELECT id FROM tenants WHERE subdomain = $1',
      [subdomain]
    );
    
    if (existing.rows && existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Subdomain already taken',
        subdomain
      });
    }
    
    // Create tenant
    const result = await db.query(
      `INSERT INTO tenants (subdomain, name, contact_email, tier, active)
       VALUES ($1, $2, $3, $4, TRUE)
       RETURNING *`,
      [subdomain, farmName, contactEmail, tier || 'inventory-only']
    );
    
    const tenant = result.rows[0];
    
    // Generate activation code
    const activationCode = `GR-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    
    console.log(`[Tenants] Registered new tenant: ${subdomain}`);
    console.log(`  Name: ${farmName}`);
    console.log(`  Tier: ${tier || 'inventory-only'}`);
    console.log(`  Activation Code: ${activationCode}`);
    
    res.json({
      ok: true,
      message: 'Tenant registered successfully',
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        name: tenant.name,
        tier: tenant.tier,
        url: `https://${subdomain}.greenreach.io`,
        activationCode
      }
    });
    
  } catch (error) {
    console.error('[Tenants] Registration error:', error);
    res.status(500).json({
      error: 'Failed to register tenant',
      message: error.message
    });
  }
});

/**
 * GET /api/tenants
 * List all tenants (admin only)
 */
router.get('/', async (req, res) => {
  try {
    const { active, tier, search } = req.query;
    const db = getDb();
    
    let query = 'SELECT * FROM tenants WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (active !== undefined) {
      query += ` AND active = $${paramIndex}`;
      params.push(active === 'true');
      paramIndex++;
    }
    
    if (tier) {
      query += ` AND tier = $${paramIndex}`;
      params.push(tier);
      paramIndex++;
    }
    
    if (search) {
      query += ` AND (name ILIKE $${paramIndex} OR subdomain ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await db.query(query, params);
    
    res.json({
      ok: true,
      count: result.rows.length,
      tenants: result.rows.map(t => ({
        id: t.id,
        subdomain: t.subdomain,
        name: t.name,
        contactEmail: t.contact_email,
        tier: t.tier,
        active: t.active,
        url: `https://${t.subdomain}.greenreach.io`,
        createdAt: t.created_at
      }))
    });
    
  } catch (error) {
    console.error('[Tenants] List error:', error);
    res.status(500).json({
      error: 'Failed to list tenants',
      message: error.message
    });
  }
});

/**
 * GET /api/tenants/:subdomain
 * Get tenant details
 */
router.get('/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    const db = getDb();
    
    const result = await db.query(
      'SELECT * FROM tenants WHERE subdomain = $1',
      [subdomain]
    );
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
        subdomain
      });
    }
    
    const tenant = result.rows[0];
    
    res.json({
      ok: true,
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        name: tenant.name,
        contactEmail: tenant.contact_email,
        tier: tenant.tier,
        active: tenant.active,
        url: `https://${tenant.subdomain}.greenreach.io`,
        createdAt: tenant.created_at,
        updatedAt: tenant.updated_at
      }
    });
    
  } catch (error) {
    console.error('[Tenants] Get error:', error);
    res.status(500).json({
      error: 'Failed to get tenant',
      message: error.message
    });
  }
});

/**
 * PATCH /api/tenants/:subdomain
 * Update tenant (admin only)
 */
router.patch('/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    const { name, contactEmail, tier, active } = req.body;
    const db = getDb();
    
    // Build dynamic update query
    const updates = [];
    const params = [subdomain];
    let paramIndex = 2;
    
    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      params.push(name);
      paramIndex++;
    }
    
    if (contactEmail !== undefined) {
      updates.push(`contact_email = $${paramIndex}`);
      params.push(contactEmail);
      paramIndex++;
    }
    
    if (tier !== undefined) {
      updates.push(`tier = $${paramIndex}`);
      params.push(tier);
      paramIndex++;
    }
    
    if (active !== undefined) {
      updates.push(`active = $${paramIndex}`);
      params.push(active);
      paramIndex++;
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No updates provided'
      });
    }
    
    const query = `
      UPDATE tenants
      SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
      WHERE subdomain = $1
      RETURNING *
    `;
    
    const result = await db.query(query, params);
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
        subdomain
      });
    }
    
    const tenant = result.rows[0];
    
    console.log(`[Tenants] Updated tenant: ${subdomain}`);
    
    res.json({
      ok: true,
      message: 'Tenant updated successfully',
      tenant: {
        id: tenant.id,
        subdomain: tenant.subdomain,
        name: tenant.name,
        contactEmail: tenant.contact_email,
        tier: tenant.tier,
        active: tenant.active,
        updatedAt: tenant.updated_at
      }
    });
    
  } catch (error) {
    console.error('[Tenants] Update error:', error);
    res.status(500).json({
      error: 'Failed to update tenant',
      message: error.message
    });
  }
});

/**
 * DELETE /api/tenants/:subdomain
 * Delete tenant and all data (admin only, dangerous!)
 */
router.delete('/:subdomain', async (req, res) => {
  try {
    const { subdomain } = req.params;
    const { confirm } = req.body;
    
    if (confirm !== subdomain) {
      return res.status(400).json({
        error: 'Confirmation required',
        message: 'Must provide "confirm": "<subdomain>" in request body'
      });
    }
    
    const db = getDb();
    
    // Delete tenant (CASCADE will delete all related data)
    const result = await db.query(
      'DELETE FROM tenants WHERE subdomain = $1 RETURNING *',
      [subdomain]
    );
    
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'Tenant not found',
        subdomain
      });
    }
    
    console.log(`[Tenants] DELETED tenant: ${subdomain}`);
    console.log(`[Tenants] ⚠️  All data for this tenant has been permanently deleted`);
    
    res.json({
      ok: true,
      message: 'Tenant and all data deleted permanently',
      subdomain
    });
    
  } catch (error) {
    console.error('[Tenants] Delete error:', error);
    res.status(500).json({
      error: 'Failed to delete tenant',
      message: error.message
    });
  }
});

export default router;
