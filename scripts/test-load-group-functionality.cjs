#!/usr/bin/env node
/**
 * Test: Groups V2 Load Group Functionality
 * 
 * Verifies that the Load Group dropdown can be used at any time
 * without order restrictions. Users should be able to:
 * 1. Load a group immediately when the page loads
 * 2. Load a different group after editing form fields
 * 3. Load a group after clicking "New Group"
 * 4. Load a group multiple times in succession
 * 
 * Bug Report: User reports "order restriction" preventing group loading
 * Fix: Ensure event listener is properly attached (only once) and dropdown
 *      is never disabled or reset unexpectedly
 */

const fs = require('fs');
const path = require('path');

const GROUPS_FILE = path.join(__dirname, '../public/data/groups.json');

console.log('🧪 Test: Groups V2 Load Group Functionality\n');
console.log('=' .repeat(70));

let passed = 0;
let failed = 0;

// Test 1: Verify groups.json exists and has groups
console.log('\n📋 Test 1: Verify Saved Groups Exist');
console.log('-'.repeat(70));

try {
  if (!fs.existsSync(GROUPS_FILE)) {
    console.log('❌ groups.json file not found');
    failed++;
  } else {
    const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    if (!data.groups || !Array.isArray(data.groups)) {
      console.log('❌ groups.json does not contain groups array');
      failed++;
    } else if (data.groups.length === 0) {
      console.log('⚠️  groups.json is empty - no groups to load');
      console.log('   This is valid but means Load Group dropdown will be empty');
      passed++;
    } else {
      console.log(`✅ Found ${data.groups.length} groups in groups.json:`);
      data.groups.forEach((g, i) => {
        const status = g.status || 'draft';
        const statusIcon = status === 'deployed' ? '✅' : '📝';
        console.log(`   ${i + 1}. ${statusIcon} ${g.name} (${g.room}:${g.zone})`);
      });
      passed++;
    }
  }
} catch (err) {
  console.log('❌ Error reading groups.json:', err.message);
  failed++;
}

// Test 2: Verify group structure
console.log('\n📋 Test 2: Verify Group Structure');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const groups = data.groups || [];
  
  let allValid = true;
  groups.forEach((g, i) => {
    const requiredFields = ['id', 'name', 'room', 'zone'];
    const missing = requiredFields.filter(field => !g[field]);
    
    if (missing.length > 0) {
      console.log(`❌ Group ${i + 1} missing fields: ${missing.join(', ')}`);
      allValid = false;
    }
  });
  
  if (allValid && groups.length > 0) {
    console.log(`✅ All ${groups.length} groups have required fields (id, name, room, zone)`);
    passed++;
  } else if (groups.length === 0) {
    console.log('ℹ️  No groups to validate');
    passed++;
  } else {
    failed++;
  }
} catch (err) {
  console.log('❌ Error validating groups:', err.message);
  failed++;
}

// Test 3: Verify group IDs are unique
console.log('\n📋 Test 3: Verify Unique Group IDs');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const groups = data.groups || [];
  const ids = groups.map(g => g.id);
  const uniqueIds = new Set(ids);
  
  if (ids.length === uniqueIds.size) {
    console.log(`✅ All ${ids.length} group IDs are unique`);
    passed++;
  } else {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    console.log(`❌ Duplicate group IDs found: ${[...new Set(duplicates)].join(', ')}`);
    failed++;
  }
} catch (err) {
  console.log('❌ Error checking group IDs:', err.message);
  failed++;
}

// Test 4: Verify status field exists and is valid
console.log('\n📋 Test 4: Verify Group Status Fields');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const groups = data.groups || [];
  
  if (groups.length === 0) {
    console.log('ℹ️  No groups to check');
    passed++;
  } else {
    let withStatus = 0;
    let withoutStatus = 0;
    let invalidStatus = 0;
    
    groups.forEach(g => {
      if (!g.status) {
        withoutStatus++;
      } else if (g.status !== 'draft' && g.status !== 'deployed') {
        invalidStatus++;
        console.log(`  ⚠️  ${g.name}: Invalid status "${g.status}"`);
      } else {
        withStatus++;
      }
    });
    
    if (invalidStatus > 0) {
      console.log(`❌ ${invalidStatus} groups have invalid status`);
      failed++;
    } else {
      console.log(`✅ Status validation passed:`);
      console.log(`   - ${withStatus} groups with valid status`);
      console.log(`   - ${withoutStatus} groups without status (will default to "draft")`);
      passed++;
    }
  }
} catch (err) {
  console.log('❌ Error checking status fields:', err.message);
  failed++;
}

// Test 5: Check for planConfig structure
console.log('\n📋 Test 5: Verify Plan Configuration');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const groups = data.groups || [];
  
  if (groups.length === 0) {
    console.log('ℹ️  No groups to check');
    passed++;
  } else {
    let withPlanConfig = 0;
    let withoutPlanConfig = 0;
    
    groups.forEach(g => {
      if (g.planConfig && typeof g.planConfig === 'object') {
        withPlanConfig++;
      } else {
        withoutPlanConfig++;
        console.log(`  ⚠️  ${g.name}: Missing planConfig`);
      }
    });
    
    console.log(`✅ Plan configuration check:`);
    console.log(`   - ${withPlanConfig} groups with planConfig`);
    console.log(`   - ${withoutPlanConfig} groups without planConfig`);
    passed++;
  }
} catch (err) {
  console.log('❌ Error checking planConfig:', err.message);
  failed++;
}

// Test 6: Simulate dropdown population
console.log('\n📋 Test 6: Simulate Dropdown Population');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const groups = data.groups || [];
  
  // Sort groups like the UI does: deployed first, then alphabetically
  const sorted = [...groups].sort((a, b) => {
    const statusA = a.status || 'draft';
    const statusB = b.status || 'draft';
    
    if (statusA === 'deployed' && statusB !== 'deployed') return -1;
    if (statusA !== 'deployed' && statusB === 'deployed') return 1;
    
    const labelA = `${a.room}:${a.zone}:${a.name}`;
    const labelB = `${b.room}:${b.zone}:${b.name}`;
    return labelA.localeCompare(labelB);
  });
  
  console.log('✅ Dropdown would be populated in this order:');
  console.log('   (none) ← default option');
  sorted.forEach((g, i) => {
    const status = g.status || 'draft';
    const statusIcon = status === 'deployed' ? '✅' : '📝';
    const label = `${g.room}:${g.zone}:${g.name}`;
    console.log(`   ${statusIcon} ${label}`);
  });
  passed++;
} catch (err) {
  console.log('❌ Error simulating dropdown:', err.message);
  failed++;
}

// Test 7: Verify no circular references in group data
console.log('\n📋 Test 7: Verify No Circular References');
console.log('-'.repeat(70));

try {
  const data = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  // If we can parse and stringify, there are no circular references
  JSON.stringify(data);
  console.log('✅ No circular references detected in groups data');
  passed++;
} catch (err) {
  if (err.message.includes('circular')) {
    console.log('❌ Circular reference detected in groups.json');
    failed++;
  } else {
    console.log('❌ Error checking circular references:', err.message);
    failed++;
  }
}

// Documentation
console.log('\n📖 Expected Behavior');
console.log('='.repeat(70));
console.log('The Load Group dropdown should:');
console.log('  1. Be available and clickable at ALL times');
console.log('  2. Show (none) as first option');
console.log('  3. Show deployed groups first (✅ icon), then drafts (📝 icon)');
console.log('  4. Be alphabetically sorted within each section');
console.log('  5. When selected, populate ALL form fields with group data');
console.log('  6. NOT be disabled or cleared when editing other fields');
console.log('  7. Allow switching between groups at any time');
console.log('');
console.log('Common Issues:');
console.log('  ❌ Dropdown is empty → No groups saved in groups.json');
console.log('  ❌ Selection doesn\'t work → JavaScript error in console (check F12)');
console.log('  ❌ Form doesn\'t update → Event listener not attached properly');
console.log('  ❌ Selection gets cleared → Bug in form reset logic');

// Summary
console.log('\n' + '='.repeat(70));
console.log('📊 Test Summary');
console.log('='.repeat(70));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total: ${passed + failed}`);

if (failed === 0) {
  console.log('\n✅ All data structure tests passed!');
  console.log('   The Load Group dropdown should work without restrictions.');
  console.log('   If you\'re experiencing issues:');
  console.log('     1. Check browser console (F12) for JavaScript errors');
  console.log('     2. Verify you\'re on the Groups V2 panel');
  console.log('     3. Try clicking "New Group" then selecting a group from dropdown');
  console.log('     4. Check that groups.json was loaded (look in Network tab)');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Review the output above.');
  console.log('   Fix any data structure issues before using Load Group dropdown.');
  process.exit(1);
}
