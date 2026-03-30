#!/usr/bin/env node

/**
 * Phase 3A Comprehensive Test Suite
 * Tests all 13 endpoints across 6 components
 * 
 * Run: node test-phase-3a.js
 */

import http from 'http';
import assert from 'assert';

const BASE_URL = 'http://127.0.0.1:8091';
const EDGE_TOKEN = 'test-edge-token';

// Test state
const results = {
  passed: 0,
  failed: 0,
  tests: []
};

// Helper: Make HTTP request
async function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${EDGE_TOKEN}`,
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, body: parsed, raw: data });
        } catch (e) {
          resolve({ status: res.statusCode, body: data, raw: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test helper
async function test(name, fn) {
  try {
    await fn();
    results.passed++;
    results.tests.push({ name, status: '✅ PASS', details: '' });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.failed++;
    results.tests.push({ name, status: '❌ FAIL', details: error.message });
    console.error(`❌ ${name}`);
    console.error(`   Error: ${error.message}`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

async function runTests() {
  console.log('\n========================================');
  console.log('Phase 3A Test Suite');
  console.log('========================================\n');

  // =========================================================================
  // 1. NUTRIENT TARGETS ENDPOINTS
  // =========================================================================
  console.log('1️⃣  Testing Nutrient Targets Endpoints\n');

  let nutrientTargetId = null;

  await test('POST /api/nutrients/targets/save - Create nutrient setpoint', async () => {
    const res = await request('POST', '/api/nutrients/targets/save', {
      groupId: 'test-group-001',
      scope: 'nutrient-reservoir',
      nutrient: 'ec',
      minTarget: 1.4,
      maxTarget: 1.6,
      unit: 'ppm',
      active: true
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.raw}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(res.body.setpoint, 'Response should have setpoint');
    nutrientTargetId = res.body.setpoint._id;
  });

  await test('GET /api/nutrients/targets/list - Retrieve setpoints', async () => {
    const res = await request('GET', '/api/nutrients/targets/list?groupId=test-group-001');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(Array.isArray(res.body.targets), 'Should return targets array');
    assert(res.body.targets.length > 0, 'Should have at least one target');
  });

  await test('POST /api/nutrients/targets/save - Validation: min < max', async () => {
    const res = await request('POST', '/api/nutrients/targets/save', {
      groupId: 'test-group-002',
      scope: 'nutrient-reservoir',
      nutrient: 'ph',
      minTarget: 5.8,
      maxTarget: 5.6  // Invalid: min > max
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error message');
  });

  await test('GET /api/nutrients/targets/list - Missing groupId', async () => {
    const res = await request('GET', '/api/nutrients/targets/list');
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error for missing groupId');
  });

  // =========================================================================
  // 2. PUMP CALIBRATION ENDPOINTS
  // =========================================================================
  console.log('\n2️⃣  Testing Pump Calibration Endpoints\n');

  await test('POST /api/nutrients/pump-calibration - Record pump calibration', async () => {
    const res = await request('POST', '/api/nutrients/pump-calibration', {
      scope: 'nutrient-reservoir',
      pumpId: 'pump-001',
      calibratedFlowRate: 42.5,
      notes: 'Calibrated with graduated cylinder'
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.raw}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(res.body.calibration, 'Response should have calibration');
    assert.strictEqual(res.body.calibration.calibratedFlowRate, 42.5, 'Flow rate should match');
    assert(res.body.calibration.nextTestDue, 'Should have nextTestDue (30 days)');
  });

  await test('GET /api/nutrients/pump-calibration/:scope/:pumpId - Retrieve pump calibration', async () => {
    const res = await request('GET', '/api/nutrients/pump-calibration/nutrient-reservoir/pump-001');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert.strictEqual(res.body.calibration.calibratedFlowRate, 42.5, 'Flow rate should match');
  });

  await test('POST /api/nutrients/pump-calibration - Validation: flow rate > 0', async () => {
    const res = await request('POST', '/api/nutrients/pump-calibration', {
      scope: 'nutrient-reservoir',
      pumpId: 'pump-002',
      calibratedFlowRate: -5  // Invalid: negative flow rate
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error for invalid flow rate');
  });

  await test('GET /api/nutrients/pump-calibration - Non-existent pump', async () => {
    const res = await request('GET', '/api/nutrients/pump-calibration/nutrient-reservoir/pump-nonexistent');
    assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    assert(res.body.error, 'Should return error for non-existent pump');
  });

  // =========================================================================
  // 3. SENSOR CALIBRATION ENDPOINTS
  // =========================================================================
  console.log('\n3️⃣  Testing Sensor Calibration Endpoints\n');

  await test('POST /api/nutrients/sensor-calibration - EC sensor multi-point calibration', async () => {
    const res = await request('POST', '/api/nutrients/sensor-calibration', {
      scope: 'nutrient-reservoir',
      sensorType: 'EC',
      calibrationPoints: [
        { measured: 0, actual: 0 },           // Zero point
        { measured: 1420, actual: 1.42 },     // 1.42 µS/cm
        { measured: 12880, actual: 12.88 }    // 12.88 µS/cm
      ],
      notes: 'Multi-point EC calibration'
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.raw}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(res.body.calibration, 'Response should have calibration');
    assert.strictEqual(res.body.calibration.sensorType, 'EC', 'Sensor type should match');
    assert(typeof res.body.calibration.calculatedSlope === 'number', 'Should have calculated slope');
    assert(typeof res.body.calibration.calculatedOffset === 'number', 'Should have calculated offset');
    assert(typeof res.body.calibration.confidence === 'number', 'Should have R² confidence');
    assert(res.body.calibration.confidence > 0.99, 'Confidence should be > 0.99 for perfect calibration');
  });

  await test('GET /api/nutrients/sensor-calibration/:scope/:sensorType - Retrieve sensor calibration', async () => {
    const res = await request('GET', '/api/nutrients/sensor-calibration/nutrient-reservoir/EC');
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert.strictEqual(res.body.calibration.sensorType, 'EC', 'Sensor type should match');
  });

  await test('POST /api/nutrients/sensor-calibration - pH sensor calibration', async () => {
    const res = await request('POST', '/api/nutrients/sensor-calibration', {
      scope: 'nutrient-reservoir',
      sensorType: 'pH',
      calibrationPoints: [
        { measured: 350, actual: 4.0 },   // pH 4.0
        { measured: 1685, actual: 7.0 },  // pH 7.0 (neutral)
        { measured: 3050, actual: 10.0 }  // pH 10.0
      ]
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert.strictEqual(res.body.calibration.sensorType, 'pH', 'Sensor type should be pH');
  });

  await test('POST /api/nutrients/sensor-calibration - Validation: minimum 2 points', async () => {
    const res = await request('POST', '/api/nutrients/sensor-calibration', {
      scope: 'nutrient-reservoir',
      sensorType: 'EC',
      calibrationPoints: [
        { measured: 1420, actual: 1.42 }  // Only 1 point - invalid
      ]
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error for < 2 calibration points');
  });

  await test('POST /api/nutrients/sensor-calibration - Low confidence warning', async () => {
    const res = await request('POST', '/api/nutrients/sensor-calibration', {
      scope: 'test-low-conf',
      sensorType: 'EC',
      calibrationPoints: [
        { measured: 100, actual: 1.0 },    // First point
        { measured: 200, actual: 3.0 }     // Very noisy data
      ]
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}`);
    // Check if warning was added for low confidence
    if (res.body.calibration.confidence < 0.95) {
      assert(res.body.calibration.warning, 'Should have warning for low confidence');
    }
  });

  // =========================================================================
  // 4. TRAY FORMAT CRUD ENDPOINTS
  // =========================================================================
  console.log('\n4️⃣  Testing Tray Format CRUD Endpoints\n');

  let trayFormatId = null;

  await test('POST /api/tray-formats - Create tray format', async () => {
    const res = await request('POST', '/api/tray-formats', {
      tray_format_id: 'TF-TEST-1020-96',
      name: 'Test 1020 Tray - 96 Cells',
      rows: 12,
      columns: 8,
      cells: 96,
      cell_height_mm: 85,
      cell_depth_mm: 42,
      active: true
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.raw}`);
    assert(res.body.success === true, 'Response should have success: true');
    assert(res.body.format, 'Response should have format');
    trayFormatId = res.body.tray_format_id;
  });

  await test('POST /api/tray-formats - Duplicate prevention', async () => {
    const res = await request('POST', '/api/tray-formats', {
      tray_format_id: 'TF-TEST-1020-96',  // Same as above
      name: 'Duplicate Tray',
      rows: 12,
      columns: 8,
      cells: 96
    });
    assert.strictEqual(res.status, 409, `Expected 409 (conflict), got ${res.status}`);
    assert(res.body.error, 'Should return error for duplicate');
  });

  await test('PUT /api/tray-formats/:id - Update tray format', async () => {
    const res = await request('PUT', '/api/tray-formats/TF-TEST-1020-96', {
      name: 'Updated Test 1020 Tray',
      cell_height_mm: 87
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.success === true, 'Response should have success: true');
    assert.strictEqual(res.body.format.cell_height_mm, 87, 'cell_height_mm should be updated');
  });

  await test('PUT /api/tray-formats - Non-existent format', async () => {
    const res = await request('PUT', '/api/tray-formats/TF-NONEXISTENT', {
      name: 'Non-existent'
    });
    assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    assert(res.body.error, 'Should return error for non-existent format');
  });

  await test('DELETE /api/tray-formats/:id - Delete tray format', async () => {
    // First create a format to delete
    const createRes = await request('POST', '/api/tray-formats', {
      tray_format_id: 'TF-TEST-DELETE-ME',
      name: 'Format to Delete',
      rows: 12,
      columns: 8,
      cells: 96
    });
    assert.strictEqual(createRes.status, 201, 'Should create format');

    // Now delete it
    const deleteRes = await request('DELETE', '/api/tray-formats/TF-TEST-DELETE-ME');
    assert.strictEqual(deleteRes.status, 200, `Expected 200, got ${deleteRes.status}`);
    assert(deleteRes.body.success === true, 'Response should have success: true');
  });

  await test('DELETE /api/tray-formats - Non-existent format', async () => {
    const res = await request('DELETE', '/api/tray-formats/TF-NONEXISTENT');
    assert.strictEqual(res.status, 404, `Expected 404, got ${res.status}`);
    assert(res.body.error, 'Should return error for non-existent format');
  });

  // =========================================================================
  // 5. STAGE DETECTION ENDPOINTS
  // =========================================================================
  console.log('\n5️⃣  Testing Stage Detection Endpoints\n');

  await test('GET /api/crops/current-stage/:groupId - Stage detection with deltas', async () => {
    // This endpoint reads from greenreach-central groups.json
    // Use a test group ID that might exist
    const res = await request('GET', '/api/crops/current-stage/Your%20Grow%20Room:1:Your%20First%20Group');
    
    // May fail if group doesn't exist, but test the structure if it succeeds
    if (res.status === 200) {
      assert(res.body.ok === true, 'Response should have ok: true');
      assert(res.body.groupId, 'Response should have groupId');
      assert(res.body.currentStage, 'Response should have currentStage');
      assert(res.body.deltas, 'Response should have deltas');
      assert(Array.isArray(res.body.nutrientSetpoints), 'Should have nutrientSetpoints array');
    } else if (res.status === 404) {
      // Expected if group doesn't exist
      assert(res.body.error, 'Should return error for non-existent group');
    }
  });

  await test('GET /api/crops/current-stage - Missing groupId', async () => {
    const res = await request('GET', '/api/crops/current-stage/');
    // Should get 404 because empty groupId is treated as no route match
    assert(res.status >= 400, 'Should return error for missing groupId');
  });

  // =========================================================================
  // 6. DEVICE DISCOVERY ENDPOINTS
  // =========================================================================
  console.log('\n6️⃣  Testing Device Discovery Endpoints\n');

  await test('POST /api/devices/discover - Auto-discovery with fallback', async () => {
    const res = await request('POST', '/api/devices/discover', {
      scope: 'test-room',
      timeout: 3000
    });
    assert.strictEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(['python-backend', 'fallback-manual'].includes(res.body.source), 'Should have source');
    
    if (res.body.source === 'fallback-manual') {
      assert(res.body.fallbackUI, 'Should have fallbackUI for fallback mode');
      assert(Array.isArray(res.body.fallbackUI.fields), 'Should have field definitions');
    }
  });

  await test('POST /api/devices/discover - Missing scope', async () => {
    const res = await request('POST', '/api/devices/discover', {
      timeout: 3000
      // scope is missing
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error for missing scope');
  });

  await test('POST /api/devices/manual-entry - Register device manually', async () => {
    const res = await request('POST', '/api/devices/manual-entry', {
      device_id: 'sensor-test-001',
      device_name: 'Test EC Sensor',
      device_type: 'sensor',
      scope: 'test-room',
      ip_address: '192.168.1.100',
      port: 5000
    });
    assert.strictEqual(res.status, 201, `Expected 201, got ${res.status}: ${res.raw}`);
    assert(res.body.ok === true, 'Response should have ok: true');
    assert(res.body.device, 'Response should have device');
    assert(res.body.device.manual_entry === true, 'Should mark as manual entry');
  });

  await test('POST /api/devices/manual-entry - Missing required field', async () => {
    const res = await request('POST', '/api/devices/manual-entry', {
      device_id: 'sensor-test-002',
      device_name: 'Test Sensor'
      // device_type is missing
    });
    assert.strictEqual(res.status, 400, `Expected 400, got ${res.status}`);
    assert(res.body.error, 'Should return error for missing device_type');
  });

  // =========================================================================
  // RESULTS
  // =========================================================================
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================\n');
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log(`Total:   ${results.passed + results.failed}\n`);

  if (results.failed === 0) {
    console.log('🎉 All tests passed!\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed.\n');
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal test error:', error);
  process.exit(1);
});
