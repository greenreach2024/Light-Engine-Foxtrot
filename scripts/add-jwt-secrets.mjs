#!/usr/bin/env node
/**
 * Emergency script: Add jwt_secret to existing farms
 * Run: node scripts/add-jwt-secrets.mjs
 */

import crypto from 'crypto';
import pkg from 'pg';
const { Client } = pkg;

const client = new Client({
  connectionString: process.env.DATABASE_URL || process.env.RDS_URL
});

try {
  await client.connect();
  console.log('✅ Connected to database');
  
  const result = await client.query(
    'UPDATE farms SET jwt_secret = $1 WHERE jwt_secret IS NULL',
    [crypto.randomBytes(32).toString('hex')]
  );
  
  console.log(`✅ Updated ${result.rowCount} farms with jwt_secret`);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
} finally {
  await client.end();
}
