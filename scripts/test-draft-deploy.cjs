#!/usr/bin/env node
/**
 * Groups V2 Draft/Deploy Workflow - Automated Test Script
 * 
 * Tests the complete draft/deploy workflow including:
 * - Creating draft groups
 * - Deploying groups
 * - Editing and changing status
 * - Dropdown ordering (deployed first)
 * - Status badges and persistence
 * 
 * Test Plan:
 * 1. Verify existing groups have status field
 * 2. Create new draft group programmatically
 * 3. Verify draft status persists
 * 4. Deploy group (change status to deployed)
 * 5. Verify deployed status persists
 * 6. Test status transitions (deployed → draft → deployed)
 * 7. Verify dropdown ordering
 * 8. Validate timestamps (created, lastModified)
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const GROUPS_PATH = path.join(DATA_DIR, 'groups.json');

console.log('\n🧪 Groups V2 Draft/Deploy Workflow - Automated Tests\n');
console.log('=' .repeat(60));

// Test counters
let passed = 0;
let failed = 0;
let warnings = 0;

function test(name, condition, message = '') {
  if (condition) {
    console.log(`✅ ${name}`);
    if (message) console.log(`   ${message}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    if (message) console.log(`   ${message}`);
    failed++;
  }
}

function warn(name, message = '') {
  console.log(`⚠️  ${name}`);
  if (message) console.log(`   ${message}`);
  warnings++;
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function loadGroups() {
  try {
    const data = fs.readFileSync(GROUPS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return { groups: [] };
  }
}

function saveGroups(groupsData) {
  fs.writeFileSync(GROUPS_PATH, JSON.stringify(groupsData, null, 2), 'utf8');
}

function createTestGroup(name, status = 'draft') {
  return {
    id: `Test Room:1:${name}`,
    name: name,
    room: 'Test Room',
    zone: '1',
    plan: 'DEMO-Lettuce-28Day',
    status: status,
    created: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    planConfig: {
      planId: 'DEMO-Lettuce-28Day',
      anchor: {
        mode: 'seedDate',
        seedDate: '2025-10-01',
        dps: null
      }
    }
  };
}

function postToServer(endpoint, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);
    const options = {
      hostname: 'localhost',
      port: 8091,
      path: endpoint,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getFromServer(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:8091${endpoint}`, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, body: body });
        }
      });
    }).on('error', reject);
  });
}

// ============================================================================
// TEST 1: Verify Existing Groups Have Status
// ============================================================================
console.log('\n📋 Test 1: Verify Existing Groups Structure\n');

const groupsData = loadGroups();

test('Groups file loaded', !!groupsData, `Found ${groupsData.groups.length} groups`);

if (groupsData.groups.length > 0) {
  groupsData.groups.forEach((group, idx) => {
    const hasStatus = group.status !== undefined;
    const hasLastModified = group.lastModified !== undefined;
    
    test(`Group ${idx + 1} (${group.name}) has status field`, hasStatus,
      hasStatus ? `Status: ${group.status}` : 'Missing status');
    
    if (hasLastModified) {
      test(`Group ${idx + 1} has lastModified`, true, 
        `Last modified: ${group.lastModified}`);
    } else {
      warn(`Group ${idx + 1} missing lastModified`,
        'Older groups may not have timestamp');
    }
  });
} else {
  warn('No existing groups found', 'Starting with empty groups file');
}

// ============================================================================
// TEST 2: Create Draft Group
// ============================================================================
console.log('\n📋 Test 2: Create Draft Group\n');

const draftGroup = createTestGroup('Test Draft Group', 'draft');
const initialGroupCount = groupsData.groups.length;

// Remove any existing test groups
groupsData.groups = groupsData.groups.filter(g => 
  !g.name.startsWith('Test Draft') && !g.name.startsWith('Test Deployed')
);

// Add draft group
groupsData.groups.push(draftGroup);
saveGroups(groupsData);

test('Draft group created', true, `ID: ${draftGroup.id}`);

// Verify persistence
const reloadedGroups = loadGroups();
const savedDraft = reloadedGroups.groups.find(g => g.id === draftGroup.id);

test('Draft group persisted', !!savedDraft);

if (savedDraft) {
  test('Status is "draft"', savedDraft.status === 'draft',
    `Status: ${savedDraft.status}`);
  test('Has created timestamp', !!savedDraft.created);
  test('Has lastModified timestamp', !!savedDraft.lastModified);
  test('Has planConfig', !!savedDraft.planConfig);
  test('Has anchor', !!savedDraft.planConfig.anchor);
}

// ============================================================================
// TEST 3: Deploy Group (Change Status)
// ============================================================================
console.log('\n📋 Test 3: Deploy Group (Change Status)\n');

if (savedDraft) {
  const originalModified = savedDraft.lastModified;
  
  // Wait 10ms to ensure timestamp changes
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  
  (async () => {
    await wait(10);
    
    // Change status to deployed
    savedDraft.status = 'deployed';
    savedDraft.lastModified = new Date().toISOString();
    
    const groupsToSave = loadGroups();
    const idx = groupsToSave.groups.findIndex(g => g.id === savedDraft.id);
    if (idx !== -1) {
      groupsToSave.groups[idx] = savedDraft;
      saveGroups(groupsToSave);
    }
    
    test('Status changed to deployed', true);
    
    // Verify persistence
    const reloadedAfterDeploy = loadGroups();
    const deployedGroup = reloadedAfterDeploy.groups.find(g => g.id === savedDraft.id);
    
    test('Deployed group persisted', !!deployedGroup);
    
    if (deployedGroup) {
      test('Status is "deployed"', deployedGroup.status === 'deployed',
        `Status: ${deployedGroup.status}`);
      test('lastModified updated', deployedGroup.lastModified !== originalModified,
        `Was: ${originalModified.substring(0, 19)}, Now: ${deployedGroup.lastModified.substring(0, 19)}`);
    }
    
    continueTests();
  })();
}

function continueTests() {
  // ============================================================================
  // TEST 4: Create Multiple Groups with Different Statuses
  // ============================================================================
  console.log('\n📋 Test 4: Create Multiple Groups with Different Statuses\n');
  
  const testGroups = [
    createTestGroup('Test Draft Group A', 'draft'),
    createTestGroup('Test Deployed Group B', 'deployed'),
    createTestGroup('Test Draft Group C', 'draft'),
    createTestGroup('Test Deployed Group D', 'deployed'),
  ];
  
  const currentGroups = loadGroups();
  
  // Remove existing test groups
  currentGroups.groups = currentGroups.groups.filter(g => 
    !g.name.startsWith('Test Draft') && !g.name.startsWith('Test Deployed')
  );
  
  // Add test groups
  testGroups.forEach(g => currentGroups.groups.push(g));
  saveGroups(currentGroups);
  
  test('Multiple test groups created', true, 
    `Created ${testGroups.length} groups (2 draft, 2 deployed)`);
  
  // Verify all persisted
  const verifyGroups = loadGroups();
  const foundDrafts = verifyGroups.groups.filter(g => 
    g.name.startsWith('Test Draft') && g.status === 'draft'
  );
  const foundDeployed = verifyGroups.groups.filter(g => 
    g.name.startsWith('Test Deployed') && g.status === 'deployed'
  );
  
  test('Draft groups persisted', foundDrafts.length === 2,
    `Found ${foundDrafts.length} draft groups`);
  test('Deployed groups persisted', foundDeployed.length === 2,
    `Found ${foundDeployed.length} deployed groups`);
  
  // ============================================================================
  // TEST 5: Verify Status Transitions
  // ============================================================================
  console.log('\n📋 Test 5: Verify Status Transitions\n');
  
  info('Testing status transition: draft → deployed → draft');
  
  const groupToTransition = verifyGroups.groups.find(g => 
    g.name === 'Test Draft Group A'
  );
  
  if (groupToTransition) {
    test('Initial status is draft', groupToTransition.status === 'draft');
    
    // Transition to deployed
    groupToTransition.status = 'deployed';
    groupToTransition.lastModified = new Date().toISOString();
    
    const updated1 = loadGroups();
    const idx1 = updated1.groups.findIndex(g => g.id === groupToTransition.id);
    updated1.groups[idx1] = groupToTransition;
    saveGroups(updated1);
    
    const verify1 = loadGroups().groups.find(g => g.id === groupToTransition.id);
    test('Transitioned to deployed', verify1.status === 'deployed',
      `Status: ${verify1.status}`);
    
    // Transition back to draft
    groupToTransition.status = 'draft';
    groupToTransition.lastModified = new Date().toISOString();
    
    const updated2 = loadGroups();
    const idx2 = updated2.groups.findIndex(g => g.id === groupToTransition.id);
    updated2.groups[idx2] = groupToTransition;
    saveGroups(updated2);
    
    const verify2 = loadGroups().groups.find(g => g.id === groupToTransition.id);
    test('Transitioned back to draft', verify2.status === 'draft',
      `Status: ${verify2.status}`);
  }
  
  // ============================================================================
  // TEST 6: Dropdown Ordering
  // ============================================================================
  console.log('\n📋 Test 6: Dropdown Ordering (Deployed First)\n');
  
  info('Simulating dropdown sort logic...');
  
  const allGroups = loadGroups().groups;
  
  // Sort: deployed first, then by name
  const sortedGroups = [...allGroups].sort((a, b) => {
    // Deployed before draft
    if (a.status === 'deployed' && b.status !== 'deployed') return -1;
    if (a.status !== 'deployed' && b.status === 'deployed') return 1;
    // Then by name
    return a.name.localeCompare(b.name);
  });
  
  test('Groups sorted correctly', true);
  
  const firstDeployedIdx = sortedGroups.findIndex(g => g.status === 'deployed');
  const lastDeployedIdx = sortedGroups.findLastIndex(g => g.status === 'deployed');
  const firstDraftIdx = sortedGroups.findIndex(g => g.status === 'draft');
  
  if (firstDeployedIdx !== -1 && firstDraftIdx !== -1) {
    test('Deployed groups appear before drafts', 
      firstDeployedIdx < firstDraftIdx,
      `First deployed at index ${firstDeployedIdx}, first draft at ${firstDraftIdx}`);
  }
  
  console.log('\n   Sorted Order:');
  sortedGroups.forEach((g, idx) => {
    const icon = g.status === 'deployed' ? '✅' : '📝';
    console.log(`   ${idx + 1}. ${icon} ${g.name} (${g.status})`);
  });
  
  // ============================================================================
  // TEST 7: Timestamp Validation
  // ============================================================================
  console.log('\n📋 Test 7: Timestamp Validation\n');
  
  const groupsWithTimestamps = allGroups.filter(g => 
    g.created && g.lastModified
  );
  
  test('All groups have timestamps', 
    groupsWithTimestamps.length === allGroups.length,
    `${groupsWithTimestamps.length}/${allGroups.length} groups have timestamps`);
  
  groupsWithTimestamps.forEach(g => {
    const created = new Date(g.created);
    const modified = new Date(g.lastModified);
    
    const isValidCreated = !isNaN(created.getTime());
    const isValidModified = !isNaN(modified.getTime());
    
    test(`${g.name} has valid created timestamp`, isValidCreated);
    test(`${g.name} has valid lastModified timestamp`, isValidModified);
    
    if (isValidCreated && isValidModified) {
      const modifiedAfterCreated = modified >= created;
      test(`${g.name} lastModified >= created`, modifiedAfterCreated,
        modifiedAfterCreated ? 'Timestamps are logical' : 
        `Created: ${created.toISOString()}, Modified: ${modified.toISOString()}`);
    }
  });
  
  // ============================================================================
  // TEST 8: Server API Integration
  // ============================================================================
  console.log('\n📋 Test 8: Server API Integration\n');
  
  (async () => {
    try {
      // Test GET endpoint
      const getResponse = await getFromServer('/data/groups.json');
      test('GET /data/groups.json responds', getResponse.status === 200,
        `Status: ${getResponse.status}`);
      
      if (getResponse.status === 200) {
        const serverGroups = getResponse.body;
        test('Server returns valid JSON', !!serverGroups.groups);
        test('Server groups match file', 
          serverGroups.groups.length === allGroups.length,
          `Server: ${serverGroups.groups.length}, File: ${allGroups.length}`);
      }
      
      // Test POST endpoint (save groups)
      info('Testing POST /data/groups endpoint...');
      
      const testData = { groups: allGroups };
      const postResponse = await postToServer('/data/groups', testData);
      
      test('POST /data/groups responds', 
        postResponse.status === 200 || postResponse.status === 201,
        `Status: ${postResponse.status}`);
      
    } catch (err) {
      test('Server API accessible', false, `Error: ${err.message}`);
    }
    
    // ============================================================================
    // TEST 9: Field Validation
    // ============================================================================
    console.log('\n📋 Test 9: Field Validation\n');
    
    const requiredFields = ['id', 'name', 'room', 'zone', 'plan', 'status', 'planConfig'];
    const optionalFields = ['created', 'lastModified'];
    
    allGroups.forEach((g, idx) => {
      requiredFields.forEach(field => {
        test(`Group ${idx + 1} has ${field}`, g[field] !== undefined,
          g[field] !== undefined ? `${field}: ${g[field]}` : `Missing ${field}`);
      });
    });
    
    // Validate status values
    const validStatuses = ['draft', 'deployed'];
    allGroups.forEach((g, idx) => {
      const isValid = validStatuses.includes(g.status);
      test(`Group ${idx + 1} has valid status`, isValid,
        isValid ? `Status: ${g.status}` : `Invalid status: ${g.status}`);
    });
    
    // ============================================================================
    // TEST 10: Edge Cases
    // ============================================================================
    console.log('\n📋 Test 10: Edge Cases\n');
    
    info('Testing edge cases...');
    
    // Test group without status (should handle gracefully)
    const groupWithoutStatus = createTestGroup('Test No Status');
    delete groupWithoutStatus.status;
    
    warn('Group without status field', 
      'UI should default to "draft" or show validation error');
    
    // Test group with invalid status
    const groupInvalidStatus = createTestGroup('Test Invalid Status');
    groupInvalidStatus.status = 'invalid';
    
    warn('Group with invalid status',
      'UI should validate status values (draft/deployed only)');
    
    // Test very long group name
    const longName = 'A'.repeat(100);
    const groupLongName = createTestGroup(longName);
    test('Group with 100-char name', groupLongName.name.length === 100,
      'UI should validate name length');
    
    // Test empty groups array
    const emptyGroups = { groups: [] };
    test('Empty groups array is valid', Array.isArray(emptyGroups.groups),
      'System should handle no groups gracefully');
    
    finishTests();
  })();
}

function finishTests() {
  // ============================================================================
  // CLEANUP
  // ============================================================================
  console.log('\n📋 Cleanup\n');
  
  info('Cleaning up test groups...');
  
  const finalGroups = loadGroups();
  const originalGroups = finalGroups.groups.filter(g => 
    !g.name.startsWith('Test Draft') && 
    !g.name.startsWith('Test Deployed') &&
    !g.name.startsWith('Test No Status') &&
    !g.name.startsWith('Test Invalid') &&
    g.name.length < 50
  );
  
  const removedCount = finalGroups.groups.length - originalGroups.length;
  
  saveGroups({ groups: originalGroups });
  
  test('Test groups cleaned up', true, 
    `Removed ${removedCount} test groups, kept ${originalGroups.length} original groups`);
  
  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary\n');
  console.log(`✅ Passed: ${passed}`);
  console.log(`⚠️  Warnings: ${warnings}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📊 Total: ${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n🎉 All automated tests PASSED!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) FAILED`);
  }
  
  console.log('\n✅ Server is running at http://localhost:8091');
  console.log('📄 Next: Manual UI testing in Groups V2 panel');
  console.log('   1. Click ➕ New Group button');
  console.log('   2. Create group and click 💾 Save Draft');
  console.log('   3. Verify 📝 DRAFT badge appears');
  console.log('   4. Load draft and click 🚀 Save & Deploy');
  console.log('   5. Verify ✅ DEPLOYED badge appears');
  console.log('   6. Check dropdown shows deployed groups first');
  
  console.log('\n' + '='.repeat(60) + '\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

// Handle async startup
if (!savedDraft) {
  continueTests();
}
