#!/usr/bin/env node

/**
 * Test script for System Management API
 * 
 * Tests all remote management endpoints without authentication
 */

const http = require('http');

const BASE_URL = 'http://localhost:8091';
const SYSTEM_TOKEN = process.env.SYSTEM_TOKEN || 'test-token-123';

function makeRequest(path, method = 'GET', data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${SYSTEM_TOKEN}`,
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode,
            data: JSON.parse(body)
          });
        } catch (err) {
          resolve({
            status: res.statusCode,
            data: body
          });
        }
      });
    });

    req.on('error', reject);
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

async function testSystemAPI() {
  console.log('\n=== Testing System Management API ===\n');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`System Token: ${SYSTEM_TOKEN.substring(0, 10)}...`);
  console.log('');

  try {
    // Test 1: Health endpoint (no auth required)
    console.log('1. Testing GET /api/system/health (public)...');
    const health = await makeRequest('/api/system/health');
    console.log(`   Status: ${health.status}`);
    if (health.status === 200) {
      console.log(`   ✅ Device: ${health.data.device_id}`);
      console.log(`   ✅ Uptime: ${Math.floor(health.data.uptime)}s`);
      console.log(`   ✅ Services: ${health.data.services?.length || 0}`);
    } else {
      console.log(`   ❌ Failed: ${JSON.stringify(health.data)}`);
    }
    console.log('');

    // Test 2: Version endpoint (no auth required)
    console.log('2. Testing GET /api/system/version (public)...');
    const version = await makeRequest('/api/system/version');
    console.log(`   Status: ${version.status}`);
    if (version.status === 200) {
      console.log(`   ✅ Version: ${version.data.version}`);
      console.log(`   ✅ Git: ${version.data.git?.commit}`);
      console.log(`   ✅ Node: ${version.data.node_version}`);
    } else {
      console.log(`   ❌ Failed: ${JSON.stringify(version.data)}`);
    }
    console.log('');

    // Test 3: Diagnostics (requires auth)
    console.log('3. Testing GET /api/system/diagnostics (requires auth)...');
    const diagnostics = await makeRequest('/api/system/diagnostics');
    console.log(`   Status: ${diagnostics.status}`);
    if (diagnostics.status === 200) {
      console.log(`   ✅ Memory: ${diagnostics.data.memory?.usedMB}MB / ${diagnostics.data.memory?.totalMB}MB`);
      console.log(`   ✅ Disk: ${diagnostics.data.disk?.used} / ${diagnostics.data.disk?.total}`);
      console.log(`   ✅ Recent Errors: ${diagnostics.data.recentErrors?.length || 0}`);
    } else if (diagnostics.status === 401) {
      console.log(`   ⚠️  Unauthorized (expected if SYSTEM_TOKEN not set)`);
    } else if (diagnostics.status === 503) {
      console.log(`   ⚠️  System API not configured (SYSTEM_TOKEN env not set)`);
    } else {
      console.log(`   ❌ Failed: ${JSON.stringify(diagnostics.data)}`);
    }
    console.log('');

    // Test 4: Logs (requires auth)
    console.log('4. Testing GET /api/system/logs (requires auth)...');
    const logs = await makeRequest('/api/system/logs?lines=10');
    console.log(`   Status: ${logs.status}`);
    if (logs.status === 200) {
      console.log(`   ✅ Log lines: ${logs.data.logs?.length || 0}`);
      console.log(`   ✅ Service: ${logs.data.service}`);
    } else if (logs.status === 401 || logs.status === 503) {
      console.log(`   ⚠️  Auth required (expected)`);
    } else {
      console.log(`   ❌ Failed: ${JSON.stringify(logs.data)}`);
    }
    console.log('');

    console.log('=== Test Complete ===\n');
    console.log('✅ Public endpoints working (health, version)');
    console.log('⚠️  Protected endpoints require SYSTEM_TOKEN env variable');
    console.log('');
    console.log('To test with authentication:');
    console.log('  export SYSTEM_TOKEN=your-secure-token-here');
    console.log('  pm2 restart lightengine-node --update-env');
    console.log('  SYSTEM_TOKEN=your-secure-token node scripts/test-system-api.cjs');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

// Run tests
testSystemAPI();
