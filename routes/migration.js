/**
 * Cloud-to-Edge Migration Routes
 * 
 * Provides APIs for migrating from cloud-only deployment to edge deployment
 * with full hardware support while preserving all data.
 */

import express from 'express';
import pg from 'pg';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;
const router = express.Router();

// Database pool
let db;

function initDb(pool) {
  db = pool;
}

/**
 * Export complete farm data from cloud deployment
 * 
 * Exports:
 * - Farm configuration and settings
 * - Users and permissions
 * - Inventory (products, quantities, locations)
 * - Orders (wholesale, retail, CSA)
 * - Automation recipes (if any)
 * - Sensor data (last 90 days)
 * - Analytics and reports
 * - Wholesale buyer/seller relationships
 */
router.post('/export', async (req, res) => {
  try {
    const farmId = req.user.farmId;
    const exportId = crypto.randomBytes(16).toString('hex');
    const exportDate = new Date();

    console.log(`[Migration] Starting export for farm: ${farmId}`);

    // 1. Export farm configuration
    const { rows: [farm] } = await db.query(
      'SELECT * FROM farms WHERE id = $1',
      [farmId]
    );

    if (!farm) {
      return res.status(404).json({ error: 'Farm not found' });
    }

    // 2. Export users
    const { rows: users } = await db.query(
      'SELECT id, username, email, role, created_at FROM users WHERE farm_id = $1',
      [farmId]
    );

    // 3. Export inventory
    const { rows: inventory } = await db.query(
      'SELECT * FROM inventory WHERE farm_id = $1',
      [farmId]
    );

    // 4. Export products
    const { rows: products } = await db.query(
      'SELECT * FROM products WHERE farm_id = $1',
      [farmId]
    );

    // 5. Export orders
    const { rows: orders } = await db.query(
      `SELECT o.*, 
              json_agg(json_build_object(
                'id', oi.id,
                'product_id', oi.product_id,
                'quantity', oi.quantity,
                'price', oi.price
              )) as items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.id
       WHERE o.farm_id = $1
       AND o.created_at > NOW() - INTERVAL '1 year'
       GROUP BY o.id`,
      [farmId]
    );

    // 6. Export wholesale relationships
    const { rows: wholesaleBuyers } = await db.query(
      'SELECT * FROM wholesale_buyers WHERE farm_id = $1',
      [farmId]
    );

    const { rows: wholesaleProducts } = await db.query(
      'SELECT * FROM wholesale_products WHERE farm_id = $1',
      [farmId]
    );

    // 7. Export automation recipes (if applicable)
    const { rows: recipes } = await db.query(
      'SELECT * FROM automation_recipes WHERE farm_id = $1',
      [farmId]
    );

    // 8. Export zones and rooms
    const { rows: zones } = await db.query(
      'SELECT * FROM zones WHERE farm_id = $1',
      [farmId]
    );

    // 9. Export sensor data (last 90 days for size management)
    const { rows: sensorData } = await db.query(
      `SELECT * FROM sensor_readings 
       WHERE farm_id = $1 
       AND timestamp > NOW() - INTERVAL '90 days'
       ORDER BY timestamp DESC`,
      [farmId]
    );

    // 10. Export settings
    const { rows: settings } = await db.query(
      'SELECT * FROM farm_settings WHERE farm_id = $1',
      [farmId]
    );

    // 11. Export certifications
    const { rows: certifications } = await db.query(
      'SELECT * FROM farm_certifications WHERE farm_id = $1',
      [farmId]
    );

    // Build export package
    const exportData = {
      exportId,
      exportDate,
      version: '1.0',
      sourceType: 'cloud',
      farm: {
        ...farm,
        password: undefined // Remove sensitive data
      },
      users: users.map(u => ({
        ...u,
        password: undefined // Users will need to reset passwords
      })),
      inventory,
      products,
      orders,
      wholesale: {
        buyers: wholesaleBuyers,
        products: wholesaleProducts
      },
      automation: {
        recipes,
        zones
      },
      sensorData,
      settings,
      certifications,
      stats: {
        userCount: users.length,
        inventoryCount: inventory.length,
        productCount: products.length,
        orderCount: orders.length,
        sensorDataPoints: sensorData.length
      }
    };

    // Generate checksum for integrity validation
    const checksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(exportData))
      .digest('hex');

    const exportPackage = {
      ...exportData,
      checksum
    };

    // Store export record
    await db.query(
      `INSERT INTO migration_exports 
       (export_id, farm_id, export_date, checksum, status)
       VALUES ($1, $2, $3, $4, 'completed')`,
      [exportId, farmId, exportDate, checksum]
    );

    console.log(`[Migration] Export completed for farm: ${farmId}, export_id: ${exportId}`);

    res.json({
      success: true,
      exportId,
      exportDate,
      checksum,
      stats: exportPackage.stats,
      downloadUrl: `/api/migration/download/${exportId}`,
      data: exportPackage
    });

  } catch (error) {
    console.error('[Migration] Export error:', error);
    res.status(500).json({
      error: 'Export failed',
      message: error.message
    });
  }
});

/**
 * Download export package
 */
router.get('/download/:exportId', async (req, res) => {
  try {
    const { exportId } = req.params;
    const farmId = req.user.farmId;

    // Verify export exists and belongs to user's farm
    const { rows: [exportRecord] } = await db.query(
      'SELECT * FROM migration_exports WHERE export_id = $1 AND farm_id = $2',
      [exportId, farmId]
    );

    if (!exportRecord) {
      return res.status(404).json({ error: 'Export not found' });
    }

    // Re-generate export data (or retrieve from storage if cached)
    // For now, we'll regenerate - in production, consider caching large exports
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="light-engine-export-${exportId}.json"`);
    
    // In production, stream from S3 or file storage
    res.json({ message: 'Use POST /api/migration/export to get data' });

  } catch (error) {
    console.error('[Migration] Download error:', error);
    res.status(500).json({ error: 'Download failed' });
  }
});

/**
 * Import data into edge deployment
 * 
 * Validates and imports previously exported data from cloud deployment.
 * Performs integrity checks and creates rollback point.
 */
router.post('/import', async (req, res) => {
  const client = await db.connect();
  
  try {
    const importData = req.body;
    const { exportId, checksum, version, sourceType } = importData;

    console.log(`[Migration] Starting import from export: ${exportId}`);

    // 1. Validate export package
    if (!exportId || !checksum) {
      return res.status(400).json({ error: 'Invalid export package' });
    }

    // Verify checksum
    const calculatedChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        ...importData,
        checksum: undefined
      }))
      .digest('hex');

    if (calculatedChecksum !== checksum) {
      console.error('[Migration] Checksum mismatch!');
      return res.status(400).json({
        error: 'Data integrity check failed',
        message: 'Export package may be corrupted'
      });
    }

    // 2. Check compatibility
    if (version !== '1.0') {
      return res.status(400).json({
        error: 'Incompatible export version',
        message: `Expected version 1.0, got ${version}`
      });
    }

    if (sourceType !== 'cloud') {
      return res.status(400).json({
        error: 'Invalid source type',
        message: 'Only cloud-to-edge migration is supported'
      });
    }

    // 3. Create backup/rollback point
    const rollbackId = crypto.randomBytes(16).toString('hex');
    await client.query('BEGIN');

    console.log(`[Migration] Creating rollback point: ${rollbackId}`);

    // Backup current database state
    await client.query(
      `CREATE TABLE IF NOT EXISTS migration_rollback (
        rollback_id VARCHAR(255) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT NOW(),
        table_name VARCHAR(255),
        backup_data JSONB
      )`
    );

    // Backup existing data
    const tablesToBackup = ['farms', 'users', 'inventory', 'products', 'orders', 'wholesale_buyers'];
    
    for (const table of tablesToBackup) {
      const { rows } = await client.query(`SELECT * FROM ${table}`);
      await client.query(
        `INSERT INTO migration_rollback (rollback_id, table_name, backup_data)
         VALUES ($1, $2, $3)`,
        [rollbackId, table, JSON.stringify(rows)]
      );
    }

    // 4. Import farm data
    const { farm } = importData;
    
    // Check if farm already exists
    const { rows: existingFarms } = await client.query('SELECT id FROM farms LIMIT 1');
    
    if (existingFarms.length > 0) {
      // Update existing farm
      await client.query(
        `UPDATE farms SET 
         name = $1,
         location = $2,
         timezone = $3,
         updated_at = NOW()
         WHERE id = $4`,
        [farm.name, farm.location, farm.timezone, existingFarms[0].id]
      );
    } else {
      // Insert new farm
      await client.query(
        `INSERT INTO farms (id, name, location, timezone, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [farm.id, farm.name, farm.location, farm.timezone, farm.created_at]
      );
    }

    const farmId = existingFarms.length > 0 ? existingFarms[0].id : farm.id;

    // 5. Import users
    for (const user of importData.users) {
      await client.query(
        `INSERT INTO users (id, farm_id, username, email, role, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           username = EXCLUDED.username,
           email = EXCLUDED.email,
           role = EXCLUDED.role`,
        [user.id, farmId, user.username, user.email, user.role, user.created_at]
      );
    }

    // 6. Import products
    for (const product of importData.products) {
      await client.query(
        `INSERT INTO products (id, farm_id, name, variety, category, unit, price, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           variety = EXCLUDED.variety,
           price = EXCLUDED.price`,
        [product.id, farmId, product.name, product.variety, product.category, 
         product.unit, product.price, product.created_at]
      );
    }

    // 7. Import inventory
    for (const item of importData.inventory) {
      await client.query(
        `INSERT INTO inventory (id, farm_id, product_id, quantity, location, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           quantity = EXCLUDED.quantity,
           location = EXCLUDED.location,
           updated_at = EXCLUDED.updated_at`,
        [item.id, farmId, item.product_id, item.quantity, item.location, item.updated_at]
      );
    }

    // 8. Import orders
    for (const order of importData.orders) {
      await client.query(
        `INSERT INTO orders (id, farm_id, customer_name, customer_email, total, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           status = EXCLUDED.status`,
        [order.id, farmId, order.customer_name, order.customer_email, 
         order.total, order.status, order.created_at]
      );

      // Import order items
      if (order.items) {
        for (const item of order.items) {
          await client.query(
            `INSERT INTO order_items (id, order_id, product_id, quantity, price)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO NOTHING`,
            [item.id, order.id, item.product_id, item.quantity, item.price]
          );
        }
      }
    }

    // 9. Import wholesale data
    if (importData.wholesale) {
      for (const buyer of importData.wholesale.buyers) {
        await client.query(
          `INSERT INTO wholesale_buyers (id, farm_id, business_name, email, phone, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             business_name = EXCLUDED.business_name,
             email = EXCLUDED.email`,
          [buyer.id, farmId, buyer.business_name, buyer.email, buyer.phone, buyer.created_at]
        );
      }

      for (const product of importData.wholesale.products) {
        await client.query(
          `INSERT INTO wholesale_products (id, farm_id, product_id, price, min_order, available)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             price = EXCLUDED.price,
             min_order = EXCLUDED.min_order`,
          [product.id, farmId, product.product_id, product.price, 
           product.min_order, product.available]
        );
      }
    }

    // 10. Import automation recipes
    if (importData.automation) {
      for (const recipe of importData.automation.recipes) {
        await client.query(
          `INSERT INTO automation_recipes (id, farm_id, name, config, enabled, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             config = EXCLUDED.config,
             enabled = EXCLUDED.enabled`,
          [recipe.id, farmId, recipe.name, recipe.config, recipe.enabled, recipe.created_at]
        );
      }

      for (const zone of importData.automation.zones) {
        await client.query(
          `INSERT INTO zones (id, farm_id, name, config, created_at)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             config = EXCLUDED.config`,
          [zone.id, farmId, zone.name, zone.config, zone.created_at]
        );
      }
    }

    // 11. Import settings
    for (const setting of importData.settings) {
      await client.query(
        `INSERT INTO farm_settings (farm_id, key, value)
         VALUES ($1, $2, $3)
         ON CONFLICT (farm_id, key) DO UPDATE SET
           value = EXCLUDED.value`,
        [farmId, setting.key, setting.value]
      );
    }

    // 12. Create migration record
    await client.query(
      `CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        export_id VARCHAR(255),
        rollback_id VARCHAR(255),
        farm_id INTEGER,
        imported_at TIMESTAMP DEFAULT NOW(),
        status VARCHAR(50)
      )`
    );

    await client.query(
      `INSERT INTO migrations (export_id, rollback_id, farm_id, status)
       VALUES ($1, $2, $3, 'completed')`,
      [exportId, rollbackId, farmId]
    );

    await client.query('COMMIT');

    console.log(`[Migration] Import completed successfully. Rollback ID: ${rollbackId}`);

    res.json({
      success: true,
      message: 'Migration completed successfully',
      rollbackId,
      stats: {
        usersImported: importData.users.length,
        productsImported: importData.products.length,
        inventoryImported: importData.inventory.length,
        ordersImported: importData.orders.length
      }
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] Import error:', error);
    
    res.status(500).json({
      error: 'Import failed',
      message: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * Rollback migration
 * 
 * Restores database to pre-migration state using rollback point
 */
router.post('/rollback/:rollbackId', async (req, res) => {
  const client = await db.connect();
  
  try {
    const { rollbackId } = req.params;

    console.log(`[Migration] Starting rollback: ${rollbackId}`);

    await client.query('BEGIN');

    // Get rollback data
    const { rows: rollbackData } = await client.query(
      'SELECT * FROM migration_rollback WHERE rollback_id = $1',
      [rollbackId]
    );

    if (rollbackData.length === 0) {
      return res.status(404).json({
        error: 'Rollback point not found',
        message: 'Cannot rollback - backup data not found'
      });
    }

    // Restore each table
    for (const backup of rollbackData) {
      const { table_name, backup_data } = backup;
      const data = JSON.parse(backup_data);

      // Clear current data
      await client.query(`DELETE FROM ${table_name}`);

      // Restore backup data
      if (data.length > 0) {
        const columns = Object.keys(data[0]);
        
        for (const row of data) {
          const values = columns.map(col => row[col]);
          const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
          
          await client.query(
            `INSERT INTO ${table_name} (${columns.join(', ')})
             VALUES (${placeholders})`,
            values
          );
        }
      }
    }

    // Mark rollback as completed
    await client.query(
      `UPDATE migrations SET status = 'rolled_back' 
       WHERE rollback_id = $1`,
      [rollbackId]
    );

    await client.query('COMMIT');

    console.log(`[Migration] Rollback completed: ${rollbackId}`);

    res.json({
      success: true,
      message: 'Rollback completed successfully',
      rollbackId
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[Migration] Rollback error:', error);
    
    res.status(500).json({
      error: 'Rollback failed',
      message: error.message
    });
  } finally {
    client.release();
  }
});

/**
 * Get migration status
 */
router.get('/status', async (req, res) => {
  try {
    const { rows: migrations } = await db.query(
      `SELECT * FROM migrations 
       ORDER BY imported_at DESC 
       LIMIT 10`
    );

    const { rows: exports } = await db.query(
      `SELECT export_id, farm_id, export_date, status
       FROM migration_exports
       ORDER BY export_date DESC
       LIMIT 10`
    );

    res.json({
      migrations,
      exports,
      hasRollbackPoints: migrations.some(m => m.status === 'completed')
    });

  } catch (error) {
    console.error('[Migration] Status error:', error);
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * Validate export data before import
 */
router.post('/validate', async (req, res) => {
  try {
    const importData = req.body;
    const errors = [];
    const warnings = [];

    // Check required fields
    if (!importData.exportId) errors.push('Missing exportId');
    if (!importData.checksum) errors.push('Missing checksum');
    if (!importData.version) errors.push('Missing version');
    if (!importData.farm) errors.push('Missing farm data');

    // Validate checksum
    const calculatedChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify({
        ...importData,
        checksum: undefined
      }))
      .digest('hex');

    if (calculatedChecksum !== importData.checksum) {
      errors.push('Checksum mismatch - data may be corrupted');
    }

    // Check version compatibility
    if (importData.version !== '1.0') {
      errors.push(`Incompatible version: ${importData.version}`);
    }

    // Validate data structures
    if (importData.users && !Array.isArray(importData.users)) {
      errors.push('Invalid users data structure');
    }

    if (importData.inventory && !Array.isArray(importData.inventory)) {
      errors.push('Invalid inventory data structure');
    }

    // Check for large sensor data
    if (importData.sensorData && importData.sensorData.length > 100000) {
      warnings.push(`Large sensor dataset: ${importData.sensorData.length} records. Import may take several minutes.`);
    }

    // Estimate storage requirements
    const estimatedSize = JSON.stringify(importData).length / 1024 / 1024; // MB
    if (estimatedSize > 100) {
      warnings.push(`Large import size: ${estimatedSize.toFixed(2)} MB`);
    }

    res.json({
      valid: errors.length === 0,
      errors,
      warnings,
      stats: importData.stats,
      estimatedSize: `${estimatedSize.toFixed(2)} MB`
    });

  } catch (error) {
    console.error('[Migration] Validation error:', error);
    res.status(500).json({
      valid: false,
      errors: ['Validation failed: ' + error.message]
    });
  }
});

export { router, initDb };
