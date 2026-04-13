import { query, initDatabase } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function registerFarm() {
  try {
    await initDatabase();
    
    console.log('Registering farm with metadata from farm.json...');
    
    // Load farm.json from edge device
    const farmJsonPath = path.join(__dirname, '..', '..', 'public', 'data', 'farm.json');
    let farmData;
    
    try {
      const farmJsonRaw = await fs.readFile(farmJsonPath, 'utf8');
      farmData = JSON.parse(farmJsonRaw);
      console.log('✓ Loaded farm.json:', farmData.name);
    } catch (error) {
      console.error('❌ Could not load farm.json:', error.message);
      process.exit(1);
    }
    
    // Build metadata object from farm.json (following DATA_FORMAT_STANDARDS.md)
    const metadata = {
      contact: farmData.contact || {},
      location: {
        region: farmData.region,
        city: farmData.location,
        coordinates: farmData.coordinates
      },
      status: farmData.status
    };
    
    console.log('✓ Metadata prepared:', JSON.stringify(metadata, null, 2));
    
    // Generate registration code (unique identifier for farm)
    const registrationCode = `REG-${farmData.farmId.split('-').pop()}-${Date.now().toString(36).toUpperCase()}`;
    
    // Insert/update farm with complete metadata
    const result = await query(`
      INSERT INTO farms (
        farm_id, name, email, api_url, status, metadata, registration_code,
        last_heartbeat, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), NOW())
      ON CONFLICT (farm_id) DO UPDATE 
      SET name = EXCLUDED.name,
          email = EXCLUDED.email,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      RETURNING *
    `, [
      farmData.farmId,
      farmData.name,
      farmData.contact?.email || 'greenreachfarms@gmail.com',
      'http://192.168.2.222:8091',
      'active',
      JSON.stringify(metadata),
      registrationCode
    ]);
    
    console.log('✅ Farm registered successfully:');
    console.log(JSON.stringify(result.rows[0], null, 2));
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
}

registerFarm();
