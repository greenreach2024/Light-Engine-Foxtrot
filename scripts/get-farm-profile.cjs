#!/usr/bin/env node
/**
 * Get farm profile data from database
 */

const { Client } = require('pg');

const DB_CONFIG = {
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: 'lightengine',
  password: process.env.DB_PASSWORD || 'LightEngine2024!Secure',
  ssl: {
    rejectUnauthorized: false
  }
};

async function getFarmProfile() {
  const client = new Client(DB_CONFIG);
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    console.log('✓ Connected\n');
    
    // Get farm data
    const farmQuery = `
      SELECT 
        id,
        farm_id,
        name,
        email,
        contact_name,
        registration_code,
        status,
        created_at
      FROM farms 
      WHERE email = 'info@greereachfarms.com' OR name = 'Green' OR farm_id LIKE '%MJUKLMO0%'
      LIMIT 1
    `;
    
    const farmResult = await client.query(farmQuery);
    
    if (farmResult.rows.length === 0) {
      console.log('❌ Farm not found');
      return;
    }
    
    const farm = farmResult.rows[0];
    console.log('📋 Farm Profile:');
    console.log('================');
    console.log(`ID: ${farm.id}`);
    console.log(`Farm ID: ${farm.farm_id}`);
    console.log(`Name: ${farm.name}`);
    console.log(`Email: ${farm.email}`);
    console.log(`Contact: ${farm.contact_name}`);
    console.log(`Registration Code: ${farm.registration_code || 'NULL'}`);
    console.log(`Status: ${farm.status}`);
    console.log(`Created: ${farm.created_at}\n`);
    
    // Check users table for this farm
    const userQuery = `
      SELECT email, role, created_at
      FROM users
      WHERE farm_id = $1
    `;
    
    const userResult = await client.query(userQuery, [farm.farm_id]);
    
    console.log(`👥 Users (${userResult.rows.length}):`);
    userResult.rows.forEach(user => {
      console.log(`  - ${user.email} (${user.role})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
    console.log('\n✓ Disconnected');
  }
}

getFarmProfile();
