#!/usr/bin/env node
/**
 * Test: Static Light Spectrum Persistence
 * 
 * Verify that static lights maintain their factory spectrum regardless
 * of plan changes, while tunable lights adapt to the plan.
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Test: Static Light Spectrum Persistence\n');
console.log('=' .repeat(70));

// Read current groups and lights data
const GROUPS_FILE = path.join(__dirname, '../public/data/groups.json');
const LIGHTS_FILE = path.join(__dirname, '../public/data/lights-catalog.json');

let groupsData, lightsData;

try {
  if (fs.existsSync(GROUPS_FILE)) {
    groupsData = JSON.parse(fs.readFileSync(GROUPS_FILE, 'utf8'));
    console.log(`✅ Loaded ${groupsData.groups?.length || 0} groups`);
  } else {
    console.log('⚠️  No groups.json found');
    groupsData = { groups: [] };
  }
} catch (err) {
  console.error('❌ Failed to load groups:', err.message);
  process.exit(1);
}

try {
  if (fs.existsSync(LIGHTS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(LIGHTS_FILE, 'utf8'));
    // Normalize to array: some catalogs are { lights: [...] } or keyed objects
    if (Array.isArray(raw)) {
      lightsData = raw;
    } else if (Array.isArray(raw.lights)) {
      lightsData = raw.lights;
    } else if (raw && typeof raw === 'object') {
      // If it's an object map, take values
      const vals = Object.values(raw).filter(Boolean);
      lightsData = Array.isArray(vals) ? vals : [];
    } else {
      lightsData = [];
    }
    console.log(`✅ Loaded ${Array.isArray(lightsData) ? lightsData.length : 0} lights from catalog`);
  } else {
    console.log('⚠️  No lights-catalog.json found');
    lightsData = [];
  }
} catch (err) {
  console.error('❌ Failed to load lights catalog:', err.message);
  lightsData = [];
}

console.log('\n📊 Analyzing Light Tunability Markers\n');
console.log('-'.repeat(70));

// Analyze lights in groups
const lightsInGroups = new Set();
groupsData.groups.forEach(group => {
  if (Array.isArray(group.lights)) {
    group.lights.forEach(light => {
      const lightId = typeof light === 'string' ? light : (light.id || light.lightId);
      if (lightId) lightsInGroups.add(lightId);
    });
  }
});

console.log(`Found ${lightsInGroups.size} unique lights assigned to groups`);

// Check each light for tunability markers
const tunabilityReport = [];

lightsInGroups.forEach(lightId => {
  // Find in groups
  let lightObj = null;
  groupsData.groups.forEach(group => {
    if (!Array.isArray(group.lights)) return;
    const found = group.lights.find(l => {
      const id = typeof l === 'string' ? l : (l.id || l.lightId);
      return id === lightId;
    });
    if (found && typeof found === 'object') {
      lightObj = found;
    }
  });

  // Find in catalog
  const catalogEntry = lightsData.find(l => 
    l.id === lightId || 
    l.serial === lightId || 
    l.deviceId === lightId ||
    l.name === lightId
  );

  const report = {
    id: lightId,
    name: lightObj?.name || catalogEntry?.name || lightId,
    groupObj: {
      tunable: lightObj?.tunable,
      dynamicSpectrum: lightObj?.dynamicSpectrum,
      spectrally_tunable: lightObj?.spectrally_tunable,
      spectrum: lightObj?.spectrum,
    },
    catalog: {
      tunable: catalogEntry?.tunable,
      dynamicSpectrum: catalogEntry?.dynamicSpectrum,
      spectrally_tunable: catalogEntry?.spectrally_tunable,
      spectrum: catalogEntry?.spectrum,
    },
  };

  tunabilityReport.push(report);
});

console.log('\nLight Tunability Analysis:');
console.log('='.repeat(70));

tunabilityReport.forEach((report, idx) => {
  console.log(`\n${idx + 1}. ${report.name} (${report.id})`);
  console.log('-'.repeat(70));
  
  // Check group object properties
  console.log('Group Object Properties:');
  console.log(`  tunable: ${report.groupObj.tunable !== undefined ? report.groupObj.tunable : '(not set)'}`);
  console.log(`  dynamicSpectrum: ${report.groupObj.dynamicSpectrum !== undefined ? report.groupObj.dynamicSpectrum : '(not set)'}`);
  console.log(`  spectrally_tunable: ${report.groupObj.spectrally_tunable !== undefined ? report.groupObj.spectrally_tunable : '(not set)'}`);
  console.log(`  spectrum: ${report.groupObj.spectrum ? JSON.stringify(report.groupObj.spectrum) : '(not set)'}`);
  
  // Check catalog properties
  console.log('\nCatalog Properties:');
  console.log(`  tunable: ${report.catalog.tunable !== undefined ? report.catalog.tunable : '(not set)'}`);
  console.log(`  dynamicSpectrum: ${report.catalog.dynamicSpectrum !== undefined ? report.catalog.dynamicSpectrum : '(not set)'}`);
  console.log(`  spectrally_tunable: ${report.catalog.spectrally_tunable !== undefined ? report.catalog.spectrally_tunable : '(not set)'}`);
  console.log(`  spectrum: ${report.catalog.spectrum ? JSON.stringify(report.catalog.spectrum) : '(not set)'}`);
  
  // Determine classification
  const hasExplicitTunable = report.groupObj.tunable !== undefined || report.catalog.tunable !== undefined;
  const hasExplicitDynamic = report.groupObj.dynamicSpectrum !== undefined || report.catalog.dynamicSpectrum !== undefined;
  const hasExplicitSpectrallyTunable = report.groupObj.spectrally_tunable !== undefined || report.catalog.spectrally_tunable !== undefined;
  const hasFactorySpectrum = report.groupObj.spectrum !== undefined || report.catalog.spectrum !== undefined;
  
  const isExplicitlyTunable = report.groupObj.tunable === true || 
                             report.catalog.tunable === true ||
                             report.groupObj.dynamicSpectrum === true ||
                             report.catalog.dynamicSpectrum === true ||
                             report.groupObj.spectrally_tunable === 'Yes' ||
                             report.catalog.spectrally_tunable === 'Yes';
                             
  const isExplicitlyStatic = report.groupObj.tunable === false || 
                             report.catalog.tunable === false ||
                             report.groupObj.dynamicSpectrum === false ||
                             report.catalog.dynamicSpectrum === false ||
                             report.groupObj.spectrally_tunable === 'No' ||
                             report.catalog.spectrally_tunable === 'No';
  
  console.log('\nClassification:');
  if (isExplicitlyTunable) {
    console.log('  ✅ TUNABLE - Will use plan spectrum');
  } else if (isExplicitlyStatic) {
    if (hasFactorySpectrum) {
      console.log('  ✅ STATIC with factory spectrum - Will use fixed factory spectrum');
    } else {
      console.log('  ⚠️  STATIC but NO factory spectrum - Will be SKIPPED');
    }
  } else {
    if (hasFactorySpectrum) {
      console.log('  ⚠️  UNKNOWN tunability but has factory spectrum - Will use factory spectrum');
    } else {
      console.log('  ❌ UNKNOWN tunability and NO factory spectrum - Will use plan spectrum (INCORRECT for static lights!)');
    }
  }
});

// Summary
console.log('\n\n📋 Summary\n');
console.log('='.repeat(70));

const explicitlyTunable = tunabilityReport.filter(r => 
  r.groupObj.tunable === true || r.catalog.tunable === true ||
  r.groupObj.dynamicSpectrum === true || r.catalog.dynamicSpectrum === true ||
  r.groupObj.spectrally_tunable === 'Yes' || r.catalog.spectrally_tunable === 'Yes'
);

const explicitlyStatic = tunabilityReport.filter(r => 
  r.groupObj.tunable === false || r.catalog.tunable === false ||
  r.groupObj.dynamicSpectrum === false || r.catalog.dynamicSpectrum === false ||
  r.groupObj.spectrally_tunable === 'No' || r.catalog.spectrally_tunable === 'No'
);

const unknown = tunabilityReport.filter(r => !explicitlyTunable.includes(r) && !explicitlyStatic.includes(r));

const staticWithSpectrum = explicitlyStatic.filter(r => r.groupObj.spectrum || r.catalog.spectrum);
const staticWithoutSpectrum = explicitlyStatic.filter(r => !r.groupObj.spectrum && !r.catalog.spectrum);
const unknownWithSpectrum = unknown.filter(r => r.groupObj.spectrum || r.catalog.spectrum);
const unknownWithoutSpectrum = unknown.filter(r => !r.groupObj.spectrum && !r.catalog.spectrum);

console.log(`Total lights analyzed: ${tunabilityReport.length}`);
console.log(`\n✅ Explicitly TUNABLE: ${explicitlyTunable.length}`);
console.log(`✅ Explicitly STATIC with factory spectrum: ${staticWithSpectrum.length}`);
console.log(`⚠️  Explicitly STATIC WITHOUT factory spectrum: ${staticWithoutSpectrum.length} (will be skipped)`);
console.log(`⚠️  Unknown tunability with factory spectrum: ${unknownWithSpectrum.length} (OK, will use factory)`);
console.log(`❌ Unknown tunability WITHOUT factory spectrum: ${unknownWithoutSpectrum.length} (PROBLEM: will use plan!)`);

if (unknownWithoutSpectrum.length > 0) {
  console.log('\n⚠️  POTENTIAL ISSUES:');
  console.log('The following lights have no tunability marker and no factory spectrum.');
  console.log('They will incorrectly use the plan spectrum instead of a fixed spectrum:');
  unknownWithoutSpectrum.forEach(r => {
    console.log(`  - ${r.name} (${r.id})`);
  });
  console.log('\n💡 FIX: Add one of these to each light:');
  console.log('  - Set tunable: true (if adjustable spectrum)');
  console.log('  - Set tunable: false + spectrum: {...} (if fixed spectrum)');
  console.log('  - Set dynamicSpectrum: true/false');
  console.log('  - Set spectrally_tunable: "Yes"/"No"');
}

if (staticWithoutSpectrum.length > 0) {
  console.log('\n❌ CRITICAL ISSUES:');
  console.log('The following lights are marked as static but have no factory spectrum.');
  console.log('They will be excluded from group mix calculations:');
  staticWithoutSpectrum.forEach(r => {
    console.log(`  - ${r.name} (${r.id})`);
  });
  console.log('\n💡 FIX: Add factory spectrum data to these lights:');
  console.log('  spectrum: { cw: X, ww: Y, bl: Z, rd: W }');
}

console.log('\n' + '='.repeat(70));
console.log('Test complete.');
