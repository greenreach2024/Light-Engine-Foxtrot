#!/usr/bin/env node
/**
 * Query Central's in-memory store for farm data
 * Usage: node scripts/get-farm-data.js FARM-MKLOMAT3-A9D8
 */

import { getInMemoryGroups } from '../routes/sync.js';

const farmId = process.argv[2] || 'FARM-MKLOMAT3-A9D8';

console.log(`\n=== Farm Data for ${farmId} ===\n`);

const groupsStore = getInMemoryGroups();
const groups = groupsStore.get(farmId);

if (groups) {
  console.log(`Found ${groups.length} groups:`);
  console.log(JSON.stringify({ groups }, null, 2));
} else {
  console.log('No groups found in memory for this farm.');
  console.log('\nAll farms in memory:');
  for (const [fId, data] of groupsStore.entries()) {
    console.log(`  - ${fId}: ${data.length} groups`);
  }
}
