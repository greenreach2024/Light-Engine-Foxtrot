/**
 * Seed Demo Farm for Development
 * 
 * Creates the GR-00001 demo farm with API credentials that match edge-config.json
 */

import { query } from '../config/database.js';
import bcrypt from 'bcryptjs';
import logger from '../utils/logger.js';

async function seedDemoFarm() {
  try {
    logger.info('Seeding demo farm...');

    // Check if demo farm already exists
    const existing = await query(
      'SELECT farm_id FROM farms WHERE farm_id = $1',
      ['GR-00001']
    );

    if (existing.rows.length > 0) {
      logger.info('Demo farm GR-00001 already exists, skipping seed');
      return;
    }

    // Match the API key from edge-config.json
    const apiKey = 'demo-api-key-12345678901234567890123456789012';
    const registrationCode = 'DEMO0001';

    // Insert demo farm
    await query(`
      INSERT INTO farms (
        farm_id, name, legal_name, email, phone,
        address_line1, address_line2, city, state, postal_code, country,
        latitude, longitude,
        registration_code, status, tier,
        registration_date, activation_date, last_heartbeat
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13,
        $14, $15, $16,
        NOW(), NOW(), NOW()
      )
    `, [
      'GR-00001',
      'Demo Farm - Light Engine Showcase',
      'Demo Farm LLC',
      'demo@lightengine.farm',
      '(555) 123-4567',
      '123 Farm Lane',
      'Building A',
      'Demo City',
      'CA',
      '90210',
      'US',
      '34.0522',
      '-118.2437',
      registrationCode,
      'active',
      'professional'
    ]);

    logger.info('✓ Demo farm GR-00001 seeded successfully');

    // Get the farm's UUID for inventory insertion
    const farmResult = await query(
      'SELECT id FROM farms WHERE farm_id = $1',
      ['GR-00001']
    );
    const farmUuid = farmResult.rows[0].id;

    // Seed some demo inventory
    await query(`
      INSERT INTO farm_inventory (
        farm_id, product_id, product_name, category,
        quantity_available, quantity_unit, wholesale_price, retail_price,
        status, created_at, updated_at
      ) VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW()),
      ($10, $11, $12, $13, $14, $15, $16, $17, $18, NOW(), NOW()),
      ($19, $20, $21, $22, $23, $24, $25, $26, $27, NOW(), NOW())
    `, [
      // Product 1: Butterhead Lettuce
      farmUuid,
      'PROD-001',
      'Butterhead Lettuce',
      'Leafy Greens',
      250,
      'heads',
      2.50,
      3.50,
      'available',
      
      // Product 2: Kale
      farmUuid,
      'PROD-002',
      'Curly Kale',
      'Leafy Greens',
      180,
      'bunches',
      3.00,
      4.50,
      'available',
      
      // Product 3: Basil
      farmUuid,
      'PROD-003',
      'Sweet Basil',
      'Herbs',
      120,
      'bunches',
      4.50,
      6.00,
      'available'
    ]);

    logger.info('✓ Demo inventory seeded successfully');

  } catch (error) {
    logger.error('Error seeding demo farm:', error);
    throw error;
  }
}

export { seedDemoFarm };
