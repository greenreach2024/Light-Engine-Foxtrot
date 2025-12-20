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
    const apiSecret = 'demo-secret-placeholder';
    const apiSecretHash = await bcrypt.hash(apiSecret, 10);

    // Insert demo farm
    await query(`
      INSERT INTO farms (
        farm_id, name, legal_name, email, phone,
        address_line1, address_line2, city, state, postal_code, country,
        latitude, longitude, contact_name,
        registration_code, status, tier,
        api_key, api_secret_hash,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19,
        NOW(), NOW()
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
      'USA',
      '34.0522',
      '-118.2437',
      'Demo Administrator',
      'DEMO0001',
      'active',
      'professional',
      apiKey,
      apiSecretHash
    ]);

    logger.info('✓ Demo farm GR-00001 seeded successfully');

    // Seed some demo inventory
    await query(`
      INSERT INTO inventory (
        farm_id, product_id, product_name, category,
        quantity_available, unit, price_per_unit, currency,
        harvest_date, storage_location, notes,
        created_at, updated_at
      ) VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW()),
      ($12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, NOW(), NOW()),
      ($23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, NOW(), NOW())
    `, [
      // Product 1: Butterhead Lettuce
      'GR-00001',
      'PROD-001',
      'Butterhead Lettuce',
      'Leafy Greens',
      250,
      'heads',
      2.50,
      'USD',
      new Date(),
      'Cold Room A',
      'Fresh harvest, ready for wholesale',
      
      // Product 2: Kale
      'GR-00001',
      'PROD-002',
      'Curly Kale',
      'Leafy Greens',
      180,
      'bunches',
      3.00,
      'USD',
      new Date(),
      'Cold Room A',
      'Organic certified',
      
      // Product 3: Basil
      'GR-00001',
      'PROD-003',
      'Sweet Basil',
      'Herbs',
      120,
      'bunches',
      4.50,
      'USD',
      new Date(),
      'Cold Room B',
      'Aromatic and fresh'
    ]);

    logger.info('✓ Demo inventory seeded successfully');

  } catch (error) {
    logger.error('Error seeding demo farm:', error);
    throw error;
  }
}

export { seedDemoFarm };
