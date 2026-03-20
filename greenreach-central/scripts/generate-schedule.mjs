#!/usr/bin/env node
/**
 * Generate optimized crop schedule starting April 1, 2026.
 * 
 * Strategy: Succession planting across 78 groups in Zone 1
 * - Stagger seed dates weekly for continuous harvest flow
 * - Balance allocation: Arugula (fast turn) gets more groups for weekly supply
 * - Lettuce varieties get balanced allocation
 * 
 * Output: planting-schedule.json for review + direct DB insert
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

// Read groups
const groups = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'groups.json'), 'utf8')).groups || [];
const zone1Groups = groups.filter(g => g.zone === 'Zone 1');
console.log(`Zone 1 groups: ${zone1Groups.length}`);

// Crop definitions
const crops = [
  { name: 'Astro Arugula',        planId: 'crop-astro-arugula',        growDays: 21, allocation: 0.30 },
  { name: 'Buttercrunch Lettuce',  planId: 'crop-buttercrunch-lettuce', growDays: 32, allocation: 0.25 },
  { name: 'Bibb Butterhead',      planId: 'crop-bibb-butterhead',      growDays: 32, allocation: 0.25 },
  { name: 'Salad Bowl Oakleaf',   planId: 'crop-salad-bowl-oakleaf',   growDays: 30, allocation: 0.20 }
];

const START_DATE = '2026-04-01';
const STAGGER_DAYS = 7; // stagger weekly for succession planting
const FARM_ID = 'demo-farm';

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Allocate groups to crops
const schedule = [];
let groupIdx = 0;

for (const crop of crops) {
  const numGroups = Math.round(zone1Groups.length * crop.allocation);
  const numWaves = Math.ceil(numGroups / Math.ceil(numGroups / 3)); // ~3 groups per wave
  const groupsPerWave = Math.ceil(numGroups / numWaves);
  
  let waveNum = 0;
  let assigned = 0;
  
  while (assigned < numGroups && groupIdx < zone1Groups.length) {
    const seedDate = addDays(START_DATE, waveNum * STAGGER_DAYS);
    const harvestDate = addDays(seedDate, crop.growDays);
    const waveGroupCount = Math.min(groupsPerWave, numGroups - assigned);
    
    for (let i = 0; i < waveGroupCount && groupIdx < zone1Groups.length; i++) {
      const group = zone1Groups[groupIdx++];
      schedule.push({
        farm_id: FARM_ID,
        group_id: group.id,
        zone: group.zone,
        group_name: group.name,
        crop_id: crop.planId,
        crop_name: crop.name,
        seed_date: seedDate,
        harvest_date: harvestDate,
        grow_days: crop.growDays,
        wave: waveNum + 1,
        status: 'active'
      });
      assigned++;
    }
    waveNum++;
  }
}

// Summary
const summary = {};
for (const entry of schedule) {
  if (!summary[entry.crop_name]) summary[entry.crop_name] = { count: 0, waves: new Set(), firstSeed: entry.seed_date, lastHarvest: entry.harvest_date };
  summary[entry.crop_name].count++;
  summary[entry.crop_name].waves.add(entry.wave);
  if (entry.harvest_date > summary[entry.crop_name].lastHarvest) summary[entry.crop_name].lastHarvest = entry.harvest_date;
}

console.log('\n=== Optimized Crop Schedule ===');
console.log(`Start: ${START_DATE}`);
console.log(`Groups assigned: ${schedule.length} / ${zone1Groups.length}`);
console.log('');
for (const [crop, s] of Object.entries(summary)) {
  console.log(`${crop}: ${s.count} groups, ${s.waves.size} waves, seeds ${s.firstSeed} → last harvest ${s.lastHarvest}`);
}

// Write schedule for review
const outputPath = path.join(DATA_DIR, 'planting-schedule.json');
const output = {
  metadata: {
    generated: new Date().toISOString(),
    startDate: START_DATE,
    strategy: 'succession-weekly-stagger',
    totalGroups: schedule.length,
    farmId: FARM_ID,
    crops: Object.entries(summary).map(([name, s]) => ({
      crop: name, groups: s.count, waves: s.waves.size, firstSeed: s.firstSeed, lastHarvest: s.lastHarvest
    }))
  },
  assignments: schedule
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
console.log(`\nSchedule written to: ${outputPath}`);

// Generate SQL for DB insertion
const sqlLines = schedule.map(s =>
  `('${s.farm_id}', '${s.group_id.replace(/'/g, "''")}', '${s.crop_id}', '${s.crop_name}', '${s.seed_date}', '${s.harvest_date}', 'active', NOW())`
);

const sql = `-- Optimized Crop Schedule: April 1, 2026
-- Generated: ${new Date().toISOString()}
-- Strategy: Succession planting with weekly stagger across ${schedule.length} groups
DELETE FROM planting_assignments WHERE farm_id = '${FARM_ID}';
INSERT INTO planting_assignments (farm_id, group_id, crop_id, crop_name, seed_date, harvest_date, status, updated_at)
VALUES
${sqlLines.join(',\n')};
`;

const sqlPath = path.join(__dirname, 'load-schedule.sql');
fs.writeFileSync(sqlPath, sql);
console.log(`SQL written to: ${sqlPath}`);
console.log('\nTo load: run the SQL against your database, or use the assistant to call create_planting_plan.');
