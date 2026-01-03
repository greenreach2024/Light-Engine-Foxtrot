#!/usr/bin/env node
/**
 * Backfill provisioning data for existing farms
 * 
 * This script provisions existing farms that were created before the auto-provisioning feature.
 * It generates:
 * - POS instance IDs (POS-{farm-id}-{random})
 * - Store subdomains (collision-safe slugs from farm names)
 * - Sets central_linked flag to true
 * 
 * Usage:
 *   node scripts/backfill-provisioning.js
 */

import pg from 'pg';
import { provisionFarm } from '../lib/farm-provisioning.js';

const { Client } = pg;

async function backfillProvisioning() {
  console.log('\n=== Farm Provisioning Backfill ===\n');

  // Connect to database
  const client = new Client({
    host: process.env.RDS_HOSTNAME,
    port: process.env.RDS_PORT || 5432,
    database: process.env.RDS_DB_NAME,
    user: process.env.RDS_USERNAME,
    password: process.env.RDS_PASSWORD,
    ssl: process.env.RDS_HOSTNAME ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    // Find farms without provisioning data
    const query = `
      SELECT farm_id, name, plan_type
      FROM farms
      WHERE pos_instance_id IS NULL OR store_subdomain IS NULL
      ORDER BY created_at ASC
    `;

    const result = await client.query(query);
    const farms = result.rows;

    if (farms.length === 0) {
      console.log('\n✓ All farms already provisioned!');
      return;
    }

    console.log(`\nFound ${farms.length} farm(s) needing provisioning:\n`);

    for (const farm of farms) {
      console.log(`Processing: ${farm.farm_id} (${farm.name})`);

      try {
        const provisioningResult = await provisionFarm({
          farmId: farm.farm_id,
          farmName: farm.name,
          planType: farm.plan_type || 'cloud',
          db: client
        });

        console.log(`  ✓ POS Instance: ${provisioningResult.posInstanceId}`);
        console.log(`  ✓ Store Subdomain: ${provisioningResult.storeSubdomain}`);
        console.log(`  ✓ Central Linked: ${provisioningResult.centralLinked}`);

        if (provisioningResult.errors && provisioningResult.errors.length > 0) {
          console.log(`  ⚠ Warnings:`, provisioningResult.errors);
        }

        console.log('');
      } catch (error) {
        console.error(`  ✗ Failed to provision ${farm.farm_id}:`, error.message);
        console.log('');
      }
    }

    // Verify results
    const verifyQuery = `
      SELECT 
        farm_id,
        name,
        pos_instance_id,
        store_subdomain,
        central_linked
      FROM farms
      ORDER BY created_at ASC
    `;

    const verifyResult = await client.query(verifyQuery);
    console.log('\n=== Final Provisioning Status ===\n');

    verifyResult.rows.forEach((farm, index) => {
      console.log(`${index + 1}. ${farm.farm_id} (${farm.name})`);
      console.log(`   POS: ${farm.pos_instance_id || 'NOT SET'}`);
      console.log(`   Store: ${farm.store_subdomain || 'NOT SET'}`);
      console.log(`   Central: ${farm.central_linked ? 'LINKED' : 'NOT LINKED'}`);
      console.log('');
    });

    const provisioned = verifyResult.rows.filter(f => f.pos_instance_id && f.store_subdomain).length;
    const total = verifyResult.rows.length;

    console.log(`✓ Provisioning complete: ${provisioned}/${total} farms provisioned\n`);

  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

// Run backfill
backfillProvisioning()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
