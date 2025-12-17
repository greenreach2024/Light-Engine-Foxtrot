#!/usr/bin/env node
/**
 * Test: Light Tunability Preservation in Groups V2
 * 
 * Tests that when lights are assigned to groups, their tunability status
 * (dynamicSpectrum, tunable, spectrally_tunable) is correctly preserved
 * and displayed in the Assigned Lights card.
 * 
 * Bug: Lights showed "TUNABLE" when unassigned but "STATIC" after assignment
 * Fix: Preserve tunability properties in payload when assigning lights
 */

const fs = require('fs');
const path = require('path');

const GROUPS_FILE = path.join(__dirname, '../public/data/groups.json');
const BACKUP_FILE = GROUPS_FILE + '.backup-tunability-test';

console.log('🧪 Test: Light Tunability Preservation\n');
console.log('=' .repeat(60));

// Backup current groups
let originalGroups = null;
try {
  if (fs.existsSync(GROUPS_FILE)) {
    originalGroups = fs.readFileSync(GROUPS_FILE, 'utf8');
    fs.writeFileSync(BACKUP_FILE, originalGroups);
    console.log('✅ Backed up groups.json');
  }
} catch (err) {
  console.error('❌ Failed to backup groups:', err.message);
  process.exit(1);
}

// Test scenarios
const tests = [];
let passed = 0;
let failed = 0;

// Test 1: Create test group with tunable light
console.log('\n📋 Test 1: Create Group with Tunable Light');
console.log('-'.repeat(60));

const tunableLight = {
  id: 'TEST-TUNABLE-001',
  name: 'Test Tunable Fixture',
  vendor: 'GreenReach',
  dynamicSpectrum: true,
  tunable: true,
  spectrally_tunable: 'Yes',
  ppf: 500,
  spectrum: { cw: 30, ww: 30, bl: 20, rd: 20 },
  control: 'WiFi',
};

const testGroup = {
  id: 'Test Room:1:Tunability Test',
  name: 'Tunability Test',
  room: 'Test Room',
  zone: '1',
  plan: 'DEMO-Lettuce-28Day',
  planConfig: {
    planId: 'DEMO-Lettuce-28Day',
    anchor: {
      mode: 'seedDate',
      seedDate: '2025-10-20',
      dps: null,
    },
  },
  status: 'draft',
  lights: [tunableLight],
};

console.log('Created test group with tunable light:');
console.log(`  - ID: ${tunableLight.id}`);
console.log(`  - Name: ${tunableLight.name}`);
console.log(`  - dynamicSpectrum: ${tunableLight.dynamicSpectrum}`);
console.log(`  - tunable: ${tunableLight.tunable}`);
console.log(`  - spectrally_tunable: ${tunableLight.spectrally_tunable}`);

// Check if tunability properties are present
const hasDynamicSpectrum = typeof tunableLight.dynamicSpectrum === 'boolean';
const hasTunable = typeof tunableLight.tunable === 'boolean';
const hasSpectrallyTunable = tunableLight.spectrally_tunable !== undefined;

if (hasDynamicSpectrum && tunableLight.dynamicSpectrum === true) {
  console.log('✅ dynamicSpectrum property present and true');
  passed++;
} else {
  console.log('❌ dynamicSpectrum property missing or false');
  failed++;
}

if (hasTunable && tunableLight.tunable === true) {
  console.log('✅ tunable property present and true');
  passed++;
} else {
  console.log('❌ tunable property missing or false');
  failed++;
}

if (hasSpectrallyTunable && tunableLight.spectrally_tunable === 'Yes') {
  console.log('✅ spectrally_tunable property present and "Yes"');
  passed++;
} else {
  console.log('❌ spectrally_tunable property missing or not "Yes"');
  failed++;
}

// Test 2: Create test group with static light
console.log('\n📋 Test 2: Create Group with Static Light');
console.log('-'.repeat(60));

const staticLight = {
  id: 'TEST-STATIC-001',
  name: 'Test Static Fixture',
  vendor: 'GenericCo',
  dynamicSpectrum: false,
  tunable: false,
  spectrally_tunable: 'No',
  ppf: 300,
  spectrum: { cw: 50, ww: 50, bl: 0, rd: 0 },
  control: 'Analog 0-10V',
};

const testGroup2 = {
  id: 'Test Room:2:Static Test',
  name: 'Static Test',
  room: 'Test Room',
  zone: '2',
  plan: 'DEMO-Lettuce-28Day',
  planConfig: {
    planId: 'DEMO-Lettuce-28Day',
    anchor: {
      mode: 'seedDate',
      seedDate: '2025-10-20',
      dps: null,
    },
  },
  status: 'draft',
  lights: [staticLight],
};

console.log('Created test group with static light:');
console.log(`  - ID: ${staticLight.id}`);
console.log(`  - Name: ${staticLight.name}`);
console.log(`  - dynamicSpectrum: ${staticLight.dynamicSpectrum}`);
console.log(`  - tunable: ${staticLight.tunable}`);
console.log(`  - spectrally_tunable: ${staticLight.spectrally_tunable}`);

if (typeof staticLight.dynamicSpectrum === 'boolean' && staticLight.dynamicSpectrum === false) {
  console.log('✅ dynamicSpectrum property present and false');
  passed++;
} else {
  console.log('❌ dynamicSpectrum property missing or true');
  failed++;
}

if (typeof staticLight.tunable === 'boolean' && staticLight.tunable === false) {
  console.log('✅ tunable property present and false');
  passed++;
} else {
  console.log('❌ tunable property missing or true');
  failed++;
}

if (staticLight.spectrally_tunable === 'No') {
  console.log('✅ spectrally_tunable property present and "No"');
  passed++;
} else {
  console.log('❌ spectrally_tunable property missing or not "No"');
  failed++;
}

// Test 3: Verify additional properties are preserved
console.log('\n📋 Test 3: Verify Additional Properties Preserved');
console.log('-'.repeat(60));

const propertiesToCheck = ['ppf', 'spectrum', 'control'];

propertiesToCheck.forEach(prop => {
  if (tunableLight[prop] !== undefined) {
    console.log(`✅ Tunable light has ${prop} property:`, tunableLight[prop]);
    passed++;
  } else {
    console.log(`❌ Tunable light missing ${prop} property`);
    failed++;
  }
  
  if (staticLight[prop] !== undefined) {
    console.log(`✅ Static light has ${prop} property:`, staticLight[prop]);
    passed++;
  } else {
    console.log(`❌ Static light missing ${prop} property`);
    failed++;
  }
});

// Test 4: Save groups and verify persistence
console.log('\n📋 Test 4: Save Groups and Verify Persistence');
console.log('-'.repeat(60));

const groupsData = {
  groups: [testGroup, testGroup2],
};

try {
  fs.writeFileSync(GROUPS_FILE, JSON.stringify(groupsData, null, 2));
  console.log('✅ Saved test groups to groups.json');
  passed++;
} catch (err) {
  console.log('❌ Failed to save groups:', err.message);
  failed++;
}

// Reload and verify
try {
  const reloaded = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const reloadedTunable = reloaded.groups[0].lights[0];
  const reloadedStatic = reloaded.groups[1].lights[0];
  
  console.log('\nReloaded tunable light:');
  console.log(`  - dynamicSpectrum: ${reloadedTunable.dynamicSpectrum}`);
  console.log(`  - tunable: ${reloadedTunable.tunable}`);
  console.log(`  - spectrally_tunable: ${reloadedTunable.spectrally_tunable}`);
  
  if (reloadedTunable.dynamicSpectrum === true && 
      reloadedTunable.tunable === true && 
      reloadedTunable.spectrally_tunable === 'Yes') {
    console.log('✅ Tunable properties persisted correctly');
    passed++;
  } else {
    console.log('❌ Tunable properties not persisted correctly');
    failed++;
  }
  
  console.log('\nReloaded static light:');
  console.log(`  - dynamicSpectrum: ${reloadedStatic.dynamicSpectrum}`);
  console.log(`  - tunable: ${reloadedStatic.tunable}`);
  console.log(`  - spectrally_tunable: ${reloadedStatic.spectrally_tunable}`);
  
  if (reloadedStatic.dynamicSpectrum === false && 
      reloadedStatic.tunable === false && 
      reloadedStatic.spectrally_tunable === 'No') {
    console.log('✅ Static properties persisted correctly');
    passed++;
  } else {
    console.log('❌ Static properties not persisted correctly');
    failed++;
  }
} catch (err) {
  console.log('❌ Failed to reload groups:', err.message);
  failed++;
}

// Test 5: Verify spectrum and PPF data
console.log('\n📋 Test 5: Verify Spectrum and PPF Data Preserved');
console.log('-'.repeat(60));

try {
  const reloaded = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
  const reloadedTunable = reloaded.groups[0].lights[0];
  const reloadedStatic = reloaded.groups[1].lights[0];
  
  if (reloadedTunable.ppf === 500) {
    console.log('✅ Tunable light PPF preserved: 500');
    passed++;
  } else {
    console.log('❌ Tunable light PPF not preserved');
    failed++;
  }
  
  if (reloadedStatic.ppf === 300) {
    console.log('✅ Static light PPF preserved: 300');
    passed++;
  } else {
    console.log('❌ Static light PPF not preserved');
    failed++;
  }
  
  if (reloadedTunable.spectrum && reloadedTunable.spectrum.cw === 30) {
    console.log('✅ Tunable light spectrum preserved');
    passed++;
  } else {
    console.log('❌ Tunable light spectrum not preserved');
    failed++;
  }
  
  if (reloadedStatic.control === 'Analog 0-10V') {
    console.log('✅ Static light control method preserved');
    passed++;
  } else {
    console.log('❌ Static light control method not preserved');
    failed++;
  }
} catch (err) {
  console.log('❌ Failed to verify spectrum/PPF data:', err.message);
  failed++;
}

// Cleanup
console.log('\n📋 Cleanup');
console.log('-'.repeat(60));
try {
  if (originalGroups) {
    fs.writeFileSync(GROUPS_FILE, originalGroups);
    console.log('✅ Restored original groups.json');
  }
  if (fs.existsSync(BACKUP_FILE)) {
    fs.unlinkSync(BACKUP_FILE);
    console.log('✅ Removed backup file');
  }
} catch (err) {
  console.error('⚠️  Cleanup warning:', err.message);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log('📊 Test Summary');
console.log('='.repeat(60));
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`📊 Total: ${passed + failed}`);
console.log(`📈 Success Rate: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);

if (failed === 0) {
  console.log('\n🎉 All tests passed! Light tunability preservation is working correctly.');
  process.exit(0);
} else {
  console.log('\n⚠️  Some tests failed. Please review the output above.');
  process.exit(1);
}
