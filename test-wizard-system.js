#!/usr/bin/env node

/**
 * Test Script for Setup Wizard System
 * Tests the wizard endpoints and functionality
 */

const http = require('http');

const BASE_URL = 'http://127.0.0.1:8091';

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: 8091,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
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

async function testWizardSystem() {
  console.log('🧙 Testing Setup Wizard System...\n');

  try {
    // Test 1: Get all available wizards
    console.log('📋 Test 1: Getting all available wizards...');
    const wizardsResponse = await makeRequest('GET', '/setup/wizards');
    console.log(`Status: ${wizardsResponse.status}`);
    console.log('Available wizards:');
    if (wizardsResponse.data.wizards) {
      wizardsResponse.data.wizards.forEach(w => {
        console.log(`  - ${w.id}: ${w.name} (${w.stepCount} steps)`);
      });
    }
    console.log('');

    // Test 2: Get specific wizard definition
    console.log('🎯 Test 2: Getting MQTT wizard definition...');
    const mqttWizardResponse = await makeRequest('GET', '/setup/wizards/mqtt-setup');
    console.log(`Status: ${mqttWizardResponse.status}`);
    if (mqttWizardResponse.data.wizard) {
      const wizard = mqttWizardResponse.data.wizard;
      console.log(`Wizard: ${wizard.name}`);
      console.log(`Description: ${wizard.description}`);
      console.log(`Steps: ${wizard.steps.length}`);
      wizard.steps.forEach((step, i) => {
        console.log(`  ${i+1}. ${step.name}: ${step.description}`);
      });
    }
    console.log('');

    // Test 3: Execute first wizard step
    console.log('⚡ Test 3: Executing first step of MQTT wizard...');
    const stepData = {
      host: '192.168.2.38',
      port: 8883,
      secure: true,
      username: 'testuser',
      password: 'testpass'
    };
    const executeResponse = await makeRequest('POST', '/setup/wizards/mqtt-setup/execute', {
      stepId: 'broker-connection',
      data: stepData
    });
    console.log(`Status: ${executeResponse.status}`);
    if (executeResponse.data.result) {
      console.log(`Success: ${executeResponse.data.result.success}`);
      console.log(`Next step: ${executeResponse.data.result.nextStep}`);
    }
    console.log('');

    // Test 4: Check wizard status
    console.log('📊 Test 4: Checking wizard execution status...');
    const statusResponse = await makeRequest('GET', '/setup/wizards/mqtt-setup/status');
    console.log(`Status: ${statusResponse.status}`);
    if (statusResponse.data.status) {
      const status = statusResponse.data.status;
      console.log(`Progress: ${status.progress}% (${status.currentStep}/${status.totalSteps})`);
      console.log(`Completed: ${status.completed}`);
      console.log(`Started: ${status.startedAt}`);
    }
    console.log('');

    // Test 5: Test wizard suggestions for discovered devices
    console.log('💡 Test 5: Testing wizard suggestions...');
    const testDevices = [
      {
        ip: '192.168.2.38',
        hostname: 'mqtt-broker',
        type: 'mqtt-tls',
        services: ['mqtt', 'mqtt-tls']
      },
      {
        ip: '192.168.2.80',
        hostname: 'controller',
        type: 'http',
        services: ['http', 'https']
      }
    ];
    
    const suggestResponse = await makeRequest('POST', '/discovery/suggest-wizards', {
      devices: testDevices
    });
    console.log(`Status: ${suggestResponse.status}`);
    if (suggestResponse.data.suggestions) {
      console.log('Wizard suggestions:');
      suggestResponse.data.suggestions.forEach(suggestion => {
        console.log(`  Device: ${suggestion.device.ip} (${suggestion.device.type})`);
        suggestion.recommendedWizards.forEach(wizard => {
          console.log(`    → ${wizard.name} (confidence: ${wizard.confidence}%)`);
        });
      });
    }
    console.log('');

    console.log('✅ All wizard system tests completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Check if server is running first
makeRequest('GET', '/health')
  .then(() => {
    console.log('🟢 Server is running, starting wizard tests...\n');
    return testWizardSystem();
  })
  .catch(() => {
    console.log('🔴 Server not running. Please start server-charlie.js first.');
    console.log('Run: node server-charlie.js');
  });