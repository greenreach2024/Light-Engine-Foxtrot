#!/usr/bin/env node

/**
 * Validate All Data Schemas
 * 
 * Validates all data files against their canonical schemas.
 * Run this before commits and deployments.
 * 
 * Usage:
 *   node scripts/validate-all-schemas.js
 *   npm run validate-schemas
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { validateGroups, validateFarm, validateRooms, validateWithErrors } from '../lib/schema-validator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function sanitizeId(value, fallback = 'zone') {
  const raw = String(value || '').trim().toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned || fallback;
}

function normalizeGroupsForValidation(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.groups)) return data;

  const allowedStatuses = new Set(['active', 'planned', 'completed', 'archived', 'deployed', 'growing']);
  const statusMap = {
    draft: 'planned',
    inactive: 'archived',
    complete: 'completed'
  };

  return {
    ...data,
    groups: data.groups.map((group, index) => {
      const crop = String(group?.crop || '').trim() || String(group?.recipe || '').trim() || String(group?.plan || '').trim() || `crop-${index + 1}`;
      const plan = String(group?.plan || '').trim() || String(group?.crop || '').trim() || String(group?.recipe || '').trim() || `plan-${sanitizeId(group?.id || group?.name || index + 1, `group-${index + 1}`)}`;
      const rawStatus = String(group?.status || '').trim().toLowerCase();
      const status = allowedStatuses.has(rawStatus) ? rawStatus : (statusMap[rawStatus] || 'planned');
      const planConfig = (group?.planConfig && typeof group.planConfig === 'object' && !Array.isArray(group.planConfig)) ? group.planConfig : {};

      return {
        ...group,
        crop,
        plan,
        status,
        planConfig
      };
    })
  };
}

function normalizeRoomsForValidation(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.rooms)) return data;

  return {
    ...data,
    rooms: data.rooms.map((room) => {
      if (!Array.isArray(room?.zones)) return room;

      const zones = room.zones.map((zone, index) => {
        if (zone && typeof zone === 'object' && !Array.isArray(zone)) {
          const zoneName = String(zone.name || zone.id || `Zone ${index + 1}`);
          return {
            ...zone,
            id: String(zone.id || sanitizeId(zoneName, `zone-${index + 1}`)),
            name: zoneName
          };
        }

        const zoneName = String(zone || `Zone ${index + 1}`);
        return {
          id: sanitizeId(zoneName, `zone-${index + 1}`),
          name: zoneName
        };
      });

      return {
        ...room,
        zones
      };
    })
  };
}

function normalizeForValidation(data, dataType) {
  if (dataType === 'groups') return normalizeGroupsForValidation(data);
  if (dataType === 'rooms') return normalizeRoomsForValidation(data);
  return data;
}

/**
 * Validate a single file
 */
function validateFile(filePath, validator, dataType) {
  console.log(`\n${colorize('●', 'blue')} Validating ${colorize(filePath, 'bold')}...`);
  
  if (!fs.existsSync(filePath)) {
    console.log(`  ${colorize('⚠', 'yellow')} File not found (skipped)`);
    return { status: 'skipped', file: filePath };
  }
  
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(content);
    const data = normalizeForValidation(parsed, dataType);
    
    const result = validateWithErrors(validator, data, dataType);
    
    if (result.valid) {
      console.log(`  ${colorize('✓', 'green')} Valid ${dataType} format`);
      
      // Check for schema version
      if (!data.schemaVersion) {
        console.log(`  ${colorize('⚠', 'yellow')} Warning: No schemaVersion field`);
      }
      
      return { status: 'valid', file: filePath };
    } else {
      console.log(`  ${colorize('✗', 'red')} Validation failed:`);
      result.errors.forEach(err => {
        console.log(`    ${colorize('→', 'red')} ${err.field}: ${err.message}`);
      });
      return { status: 'invalid', file: filePath, errors: result.errors };
    }
  } catch (err) {
    console.log(`  ${colorize('✗', 'red')} Parse error: ${err.message}`);
    return { status: 'error', file: filePath, error: err.message };
  }
}

/**
 * Main validation routine
 */
function main() {
  console.log(colorize('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(colorize('  Data Format Schema Validation', 'bold'));
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'blue'));
  
  const dataDir = path.join(rootDir, 'public/data');
  
  const files = [
    {
      path: path.join(dataDir, 'groups.json'),
      validator: validateGroups,
      type: 'groups'
    },
    {
      path: path.join(dataDir, 'farm.json'),
      validator: validateFarm,
      type: 'farm'
    },
    {
      path: path.join(dataDir, 'rooms.json'),
      validator: validateRooms,
      type: 'rooms'
    }
  ];
  
  const results = files.map(({ path, validator, type }) => 
    validateFile(path, validator, type)
  );
  
  // Summary
  console.log(colorize('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue'));
  console.log(colorize('  Validation Summary', 'bold'));
  console.log(colorize('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'blue'));
  
  const valid = results.filter(r => r.status === 'valid').length;
  const invalid = results.filter(r => r.status === 'invalid').length;
  const errors = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  
  console.log(`  ${colorize('✓', 'green')} Valid:   ${valid}`);
  console.log(`  ${colorize('✗', 'red')} Invalid: ${invalid}`);
  console.log(`  ${colorize('✗', 'red')} Errors:  ${errors}`);
  console.log(`  ${colorize('⚠', 'yellow')} Skipped: ${skipped}`);
  
  // Exit code
  const exitCode = invalid + errors > 0 ? 1 : 0;
  
  if (exitCode === 0) {
    console.log(colorize('\n✓ All schemas valid!\n', 'green'));
  } else {
    console.log(colorize('\n✗ Schema validation failed\n', 'red'));
    console.log('See DATA_FORMAT_STANDARDS.md for canonical formats');
  }
  
  process.exit(exitCode);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
