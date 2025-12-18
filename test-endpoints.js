#!/usr/bin/env node
/**
 * Comprehensive Endpoint Test Suite
 * Tests both Node.js (8091) and Python (8000) backends
 */

import http from 'http';

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, {timeout: 5000}, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          data: data,
          headers: res.headers
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
  });
}

async function testEndpoint(name, url, validator) {
  try {
    const result = await httpGet(url);
    
    if (result.statusCode !== 200) {
      console.log(`   ${name}: HTTP ${result.statusCode}`);
      return false;
    }
    
    if (validator) {
      const isValid = validator(result.data, result);
      if (!isValid) {
        console.log(`   ${name}: Invalid response`);
        return false;
      }
    }
    
    console.log(colorize(`   ${name}`, 'green'));
    return true;
  } catch (error) {
    console.log(colorize(`   ${name}: ${error.message}`, 'red'));
    return false;
  }
}

async function runTests() {
  console.log(colorize('\n========================================', 'cyan'));
  console.log(colorize('  Endpoint Test Suite', 'bright'));
  console.log(colorize('========================================\n', 'cyan'));

  let passed = 0;
  let failed = 0;

  // Python Backend Tests (Port 8000)
  console.log(colorize('Python Backend (port 8000)', 'blue'));
  console.log(colorize('─'.repeat(40), 'blue'));

  const pythonTests = [
    {
      name: 'Health Check',
      url: 'http://localhost:8000/health',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.status === 'ok' && json.version;
      }
    },
    {
      name: 'API Docs',
      url: 'http://localhost:8000/docs',
      validator: () => true // Just check it responds
    },
    {
      name: 'Tray Formats',
      url: 'http://localhost:8000/api/tray-formats',
      validator: (data) => Array.isArray(JSON.parse(data))
    },
    {
      name: 'Recipes',
      url: 'http://localhost:8000/api/recipes',
      validator: (data) => Array.isArray(JSON.parse(data))
    },
    {
      name: 'Billing Plans',
      url: 'http://localhost:8000/api/billing/plans',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.plans && json.status;
      }
    },
    {
      name: 'Devices List',
      url: 'http://localhost:8000/api/devices',
      validator: (data) => Array.isArray(JSON.parse(data))
    },
    {
      name: 'Discover Kasa',
      url: 'http://localhost:8000/api/discover/kasa',
      validator: (data) => {
        const json = JSON.parse(data);
        return Array.isArray(json.devices);
      }
    },
  ];

  for (const test of pythonTests) {
    const result = await testEndpoint(test.name, test.url, test.validator);
    result ? passed++ : failed++;
  }

  console.log('');

  // Node.js Backend Tests (Port 8091)
  console.log(colorize('Node.js Backend (port 8091)', 'blue'));
  console.log(colorize('─'.repeat(40), 'blue'));

  const nodeTests = [
    {
      name: 'Health Check',
      url: 'http://localhost:8091/health',
      validator: () => true
    },
    {
      name: 'Admin Farms List',
      url: 'http://localhost:8091/api/admin/farms',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.farms && Array.isArray(json.farms);
      }
    },
    {
      name: 'Farm Details (GR-00001)',
      url: 'http://localhost:8091/api/admin/farms/GR-00001',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.farmId === 'GR-00001';
      }
    },
    {
      name: 'Environment Data',
      url: 'http://localhost:8091/api/env',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.zones || json.sensors;
      }
    },
    {
      name: 'ML Insights Status',
      url: 'http://localhost:8091/api/ml/insights/status',
      validator: (data) => {
        const json = JSON.parse(data);
        return json.status || json.error;
      }
    },
  ];

  for (const test of nodeTests) {
    const result = await testEndpoint(test.name, test.url, test.validator);
    result ? passed++ : failed++;
  }

  // Summary
  console.log(colorize('\n========================================', 'cyan'));
  console.log(colorize('  Test Results', 'bright'));
  console.log(colorize('========================================', 'cyan'));
  console.log(colorize(`  Passed: ${passed}`, passed > 0 ? 'green' : 'yellow'));
  console.log(colorize(`  Failed: ${failed}`, failed > 0 ? 'red' : 'green'));
  console.log(colorize(`  Total:  ${passed + failed}`, 'bright'));
  console.log(colorize(`  Success Rate: ${Math.round((passed/(passed+failed))*100)}%\n`, passed > failed ? 'green' : 'yellow'));

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error(colorize(`Fatal error: ${error.message}`, 'red'));
  process.exit(1);
});
