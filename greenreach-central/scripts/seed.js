import pg from 'pg';
const { Client } = pg;
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

dotenv.config();

async function seedDatabase() {
  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || 'greenreach_central',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    console.log('🌱 Seeding database with test data...');

    // Create test farms
    const farms = [
      {
        farmId: 'GR-17350001001',
        name: 'Green Valley Farm',
        legalName: 'Green Valley Farms LLC',
        email: 'contact@greenvalley.farm',
        phone: '+1-503-555-0100',
        addressLine1: '1234 Farm Road',
        city: 'Portland',
        state: 'OR',
        postalCode: '97201',
        country: 'USA',
        latitude: 45.5231,
        longitude: -122.6765,
        contactName: 'John Farmer',
        tier: 'professional',
        edgeDeviceId: 'rpi5-greenvalley-001',
        edgeDeviceType: 'raspberry-pi-5',
        softwareVersion: '1.0.0'
      },
      {
        farmId: 'GR-17350001002',
        name: 'Urban Greens Co-op',
        legalName: 'Urban Greens Cooperative',
        email: 'hello@urbangreens.coop',
        phone: '+1-206-555-0200',
        addressLine1: '567 City Avenue',
        city: 'Seattle',
        state: 'WA',
        postalCode: '98101',
        country: 'USA',
        latitude: 47.6062,
        longitude: -122.3321,
        contactName: 'Sarah Green',
        tier: 'starter',
        edgeDeviceId: 'rpi5-urbangreens-001',
        edgeDeviceType: 'raspberry-pi-5',
        softwareVersion: '1.0.0'
      },
      {
        farmId: 'GR-17350001003',
        name: 'Pacific Northwest Produce',
        legalName: 'Pacific Northwest Produce Inc.',
        email: 'info@pnwproduce.com',
        phone: '+1-541-555-0300',
        addressLine1: '890 Harvest Lane',
        city: 'Eugene',
        state: 'OR',
        postalCode: '97401',
        country: 'USA',
        latitude: 44.0521,
        longitude: -123.0868,
        contactName: 'Mike Harvest',
        tier: 'enterprise',
        edgeDeviceId: 'rpi5-pnwproduce-001',
        edgeDeviceType: 'raspberry-pi-5',
        softwareVersion: '1.0.0'
      }
    ];

    for (const farm of farms) {
      const registrationCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const apiKey = crypto.randomBytes(32).toString('hex');
      const apiSecret = crypto.randomBytes(32).toString('hex');
      const apiSecretHash = await bcrypt.hash(apiSecret, 10);

      await client.query(`
        INSERT INTO farms (
          farm_id, name, legal_name, email, phone,
          address_line1, city, state, postal_code, country,
          latitude, longitude, contact_name,
          registration_code, status, tier,
          api_key, api_secret_hash,
          edge_device_id, edge_device_type, software_version,
          activation_date, last_heartbeat, last_sync
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'active', $15, $16, $17, $18, $19, $20, NOW(), NOW(), NOW())
        ON CONFLICT (farm_id) DO NOTHING
      `, [
        farm.farmId, farm.name, farm.legalName, farm.email, farm.phone,
        farm.addressLine1, farm.city, farm.state, farm.postalCode, farm.country,
        farm.latitude, farm.longitude, farm.contactName,
        registrationCode, farm.tier,
        apiKey, apiSecretHash,
        farm.edgeDeviceId, farm.edgeDeviceType, farm.softwareVersion
      ]);

      console.log(`✅ Created farm: ${farm.name} (${farm.farmId})`);
      console.log(`   API Key: ${apiKey}`);
      console.log(`   API Secret: ${apiSecret}`);
      console.log('');

      // Create admin user for each farm
      const userEmail = `admin@${farm.email.split('@')[1]}`;
      const password = 'Test123!';
      const passwordHash = await bcrypt.hash(password, 10);

      await client.query(`
        INSERT INTO farm_users (
          farm_id, email, password_hash,
          first_name, last_name, role,
          email_verified
        ) VALUES ($1, $2, $3, $4, $5, 'admin', true)
        ON CONFLICT (email) DO NOTHING
      `, [
        farm.farmId, userEmail, passwordHash,
        'Admin', 'User'
      ]);

      console.log(`✅ Created admin user: ${userEmail} (password: ${password})`);
      console.log('');

      // Create farm config
      await client.query(`
        INSERT INTO farm_config (
          farm_id, total_rooms, total_zones, total_devices, total_trays,
          crop_types, equipment, business_hours, timezone, currency,
          wholesale_enabled, wholesale_minimum_order, delivery_radius,
          sync_enabled, sync_interval_minutes
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        ON CONFLICT (farm_id) DO NOTHING
      `, [
        farm.farmId, 4, 12, 48, 144,
        JSON.stringify(['lettuce', 'herbs', 'microgreens', 'tomatoes']),
        JSON.stringify({
          lights: 48,
          fans: 24,
          sensors: 36,
          dehumidifiers: 4
        }),
        JSON.stringify({
          monday: { open: '08:00', close: '18:00' },
          tuesday: { open: '08:00', close: '18:00' },
          wednesday: { open: '08:00', close: '18:00' },
          thursday: { open: '08:00', close: '18:00' },
          friday: { open: '08:00', close: '18:00' },
          saturday: { open: '09:00', close: '15:00' },
          sunday: { closed: true }
        }),
        'America/Los_Angeles', 'USD',
        true, 100, 50,
        true, 5
      ]);

      // Create sample inventory
      const products = [
        { id: 'prod-lettuce-001', name: 'Butterhead Lettuce', category: 'lettuce', variety: 'Buttercrunch', qty: 50, unit: 'head', wholesale: 2.50, retail: 4.00 },
        { id: 'prod-lettuce-002', name: 'Romaine Lettuce', category: 'lettuce', variety: 'Romaine', qty: 40, unit: 'head', wholesale: 2.75, retail: 4.50 },
        { id: 'prod-herbs-001', name: 'Basil', category: 'herbs', variety: 'Sweet Basil', qty: 30, unit: 'bunch', wholesale: 3.00, retail: 5.00 },
        { id: 'prod-herbs-002', name: 'Cilantro', category: 'herbs', variety: 'Standard', qty: 25, unit: 'bunch', wholesale: 2.50, retail: 4.00 },
        { id: 'prod-micro-001', name: 'Micro Greens Mix', category: 'microgreens', variety: 'Rainbow Mix', qty: 20, unit: 'tray', wholesale: 12.00, retail: 18.00 }
      ];

      for (const product of products) {
        await client.query(`
          INSERT INTO farm_inventory (
            farm_id, product_id, product_name, category, variety,
            quantity_available, quantity_reserved, quantity_unit,
            wholesale_price, retail_price, status, synced_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8, $9, 'available', NOW())
          ON CONFLICT DO NOTHING
        `, [
          farm.farmId, product.id, product.name, product.category, product.variety,
          product.qty, product.unit, product.wholesale, product.retail
        ]);
      }

      console.log(`✅ Created ${products.length} inventory items`);
      console.log('');

      // Create health record
      await client.query(`
        INSERT INTO farm_health (
          farm_id, overall_status,
          cpu_usage, memory_usage, disk_usage,
          active_devices, offline_devices, alert_count,
          avg_temperature, avg_humidity, avg_co2,
          uptime_seconds, last_heartbeat
        ) VALUES ($1, 'healthy', 25.5, 45.2, 30.1, 48, 0, 0, 22.5, 65.0, 800, 86400, NOW())
        ON CONFLICT (farm_id) DO NOTHING
      `, [farm.farmId]);

      console.log(`✅ Created health record`);
      console.log('');
    }

    // Create a sample wholesale order
    const orderId = `ORDER-${Date.now()}`;
    await client.query(`
      INSERT INTO wholesale_orders (
        order_id, customer_name, customer_email, customer_phone,
        delivery_address_line1, delivery_city, delivery_state, delivery_postal_code,
        items, total_amount, tax_amount, delivery_fee,
        status, payment_status,
        assigned_farms, requested_delivery_date
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', 'pending', $13, $14)
    `, [
      orderId,
      'Portland Farmers Market',
      'orders@portlandfarmersmarket.com',
      '+1-503-555-9999',
      '456 Market Street',
      'Portland',
      'OR',
      '97201',
      JSON.stringify([
        { product_id: 'prod-lettuce-001', product_name: 'Butterhead Lettuce', quantity: 100, unit: 'head', price: 2.50 },
        { product_id: 'prod-herbs-001', product_name: 'Basil', quantity: 50, unit: 'bunch', price: 3.00 }
      ]),
      400.00, 40.00, 25.00,
      JSON.stringify(['GR-17350001001', 'GR-17350001002']),
      new Date(Date.now() + 86400000 * 3).toISOString().split('T')[0]
    ]);

    console.log(`✅ Created sample wholesale order: ${orderId}`);
    console.log('');

    console.log('✨ Database seeding completed successfully!');
    console.log('');
    console.log('📝 Test Credentials:');
    console.log('   Admin 1: admin@greenvalley.farm / Test123!');
    console.log('   Admin 2: admin@urbangreens.coop / Test123!');
    console.log('   Admin 3: admin@pnwproduce.com / Test123!');
    console.log('');

  } catch (error) {
    console.error('❌ Seeding failed:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

seedDatabase();
