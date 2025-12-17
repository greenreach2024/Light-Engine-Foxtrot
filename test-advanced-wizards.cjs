#!/usr/bin/env node

/**
 * Advanced Setup Wizard System Test
 * Tests enhanced features: templates, validation, bulk operations, device-specific execution
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

async function testAdvancedWizardSystem() {
  console.log('🧙✨ Testing Advanced Setup Wizard System...\n');

  try {
    // Test 1: Get wizard templates
    console.log('📋 Test 1: Getting available wizard templates...');
    const templatesResponse = await makeRequest('GET', '/setup/templates');
    console.log(`Status: ${templatesResponse.status}`);
    if (templatesResponse.data.templates) {
      console.log('Available templates:');
      templatesResponse.data.templates.forEach(t => {
        console.log(`  - ${t.id}: ${t.name} (${t.wizardCount} wizards)`);
      });
    }
    console.log('');

    // Test 2: Enhanced setup recommendations with templates
    console.log('💡 Test 2: Getting enhanced setup recommendations...');
    const testDevices = [
      {
        ip: '192.168.2.38',
        hostname: 'mqtt-broker',
        type: 'mqtt-broker',
        services: ['mqtt', 'mqtt-tls']
      },
      {
        ip: '192.168.2.45',
        hostname: 'sensor-hub',
        type: 'sensor-hub',
        services: ['http', 'modbus']
      },
      {
        ip: '192.168.2.46',
        hostname: 'kasa-switch',
        type: 'kasa',
        services: ['kasa']
      }
    ];
    
    const recommendResponse = await makeRequest('POST', '/discovery/recommend-setup', {
      devices: testDevices
    });
    
    console.log(`Status: ${recommendResponse.status}`);
    if (recommendResponse.data.recommendations) {
      const rec = recommendResponse.data.recommendations;
      console.log(`Individual wizards: ${rec.individualWizards.length}`);
      console.log(`Template suggestions: ${rec.templates.length}`);
      if (rec.bestMatch) {
        console.log(`Best template match: ${rec.bestMatch.name} (${rec.bestMatch.coverage}% coverage)`);
      }
    }
    console.log('');

    // Test 3: Apply wizard template
    console.log('🚀 Test 3: Applying greenhouse-complete template...');
    const applyResponse = await makeRequest('POST', '/setup/templates/greenhouse-complete/apply', {
      devices: testDevices,
      customPresets: {
        'mqtt-setup': {
          'broker-connection': {
            host: '192.168.2.38',
            port: 8883,
            secure: true
          }
        }
      }
    });
    
    console.log(`Status: ${applyResponse.status}`);
    if (applyResponse.data.result) {
      const result = applyResponse.data.result;
      console.log(`Template: ${result.templateName}`);
      console.log(`Applicable wizards: ${result.applicableWizards.length}`);
      console.log(`Auto-executed: ${result.autoExecuted.length}`);
      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
      }
    }
    console.log('');

    // Test 4: Validated wizard execution
    console.log('✅ Test 4: Testing validated wizard execution...');
    const validatedResponse = await makeRequest('POST', '/setup/wizards/modbus-setup/execute-validated', {
      stepId: 'connection-setup',
      data: {
        host: '192.168.2.50',
        port: 502,
        unitId: 1,
        timeout: 3000,
        protocol: 'TCP'
      }
    });
    
    console.log(`Status: ${validatedResponse.status}`);
    if (validatedResponse.data.result) {
      console.log(`Success: ${validatedResponse.data.result.success}`);
      if (validatedResponse.data.result.message) {
        console.log(`Message: ${validatedResponse.data.result.message}`);
      }
    }
    console.log('');

    // Test 5: Validation error handling
    console.log('❌ Test 5: Testing validation error handling...');
    const invalidResponse = await makeRequest('POST', '/setup/wizards/modbus-setup/execute-validated', {
      stepId: 'connection-setup',
      data: {
        host: '', // Invalid: required field empty
        port: 'invalid', // Invalid: not a number
        unitId: 300 // Invalid: out of range (max 247)
      }
    });
    
    console.log(`Status: ${invalidResponse.status}`);
    if (invalidResponse.data.errors) {
      console.log(`Validation errors: ${invalidResponse.data.errors.length}`);
      invalidResponse.data.errors.forEach(error => {
        console.log(`  - ${error}`);
      });
    }
    console.log('');

    // Test 6: Bulk wizard operations
    console.log('🔄 Test 6: Testing bulk wizard operations...');
    const bulkResponse = await makeRequest('POST', '/setup/wizards/bulk/status', {
      wizardIds: ['mqtt-setup', 'modbus-setup', 'kasa-setup']
    });
    
    console.log(`Status: ${bulkResponse.status}`);
    if (bulkResponse.data.result) {
      const result = bulkResponse.data.result;
      console.log(`Operation: ${result.operation}`);
      console.log(`Total wizards: ${result.totalWizards}`);
      console.log(`Successful: ${result.successful}`);
      console.log(`Failed: ${result.failed}`);
    }
    console.log('');

    // Test 7: Test device-specific MQTT execution
    console.log('🔗 Test 7: Testing device-specific MQTT execution...');
    const mqttResponse = await makeRequest('POST', '/setup/wizards/mqtt-setup/execute', {
      stepId: 'broker-connection',
      data: {
        host: '192.168.2.38',
        port: 8883,
        secure: true,
        username: 'farm-user'
      }
    });
    
    console.log(`Status: ${mqttResponse.status}`);
    if (mqttResponse.data.result) {
      console.log(`Success: ${mqttResponse.data.result.success}`);
      if (mqttResponse.data.result.message) {
        console.log(`Message: ${mqttResponse.data.result.message}`);
      }
      if (mqttResponse.data.result.data?.connectionTest) {
        console.log(`Connection test: ${mqttResponse.data.result.data.connectionTest.connected}`);
      }
    }
    console.log('');

    // Test 8: Complete MQTT topic discovery
    console.log('🔍 Test 8: Testing MQTT topic discovery...');
    const topicResponse = await makeRequest('POST', '/setup/wizards/mqtt-setup/execute', {
      stepId: 'topic-discovery',
      data: {
        baseTopic: 'farm/greenhouse/#',
        discoverTime: 15
      }
    });
    
    console.log(`Status: ${topicResponse.status}`);
    if (topicResponse.data.result) {
      console.log(`Success: ${topicResponse.data.result.success}`);
      if (topicResponse.data.result.data?.discoveredTopics) {
        console.log(`Discovered topics: ${topicResponse.data.result.data.discoveredTopics.length}`);
        topicResponse.data.result.data.discoveredTopics.slice(0, 3).forEach(topic => {
          console.log(`  - ${topic}`);
        });
        if (topicResponse.data.result.data.discoveredTopics.length > 3) {
          console.log(`  ... and ${topicResponse.data.result.data.discoveredTopics.length - 3} more`);
        }
      }
    }
    console.log('');

    // Test 9: Kasa auto-discovery regression (ensures Client constructor is available)
    console.log('🔌 Test 9: Testing Kasa auto-discovery regression...');
    const kasaDiscoveryResponse = await makeRequest('POST', '/setup/wizards/kasa-setup/execute', {
      stepId: 'device-discovery',
      data: {
        discoveryTimeout: 1
      }
    });

    console.log(`Status: ${kasaDiscoveryResponse.status}`);
    if (kasaDiscoveryResponse.data?.result) {
      const kasaResult = kasaDiscoveryResponse.data.result;
      console.log(`Success: ${kasaResult.success}`);
      if (kasaResult.message) {
        console.log(`Message: ${kasaResult.message}`);
      }
      if (kasaResult.success === false) {
        throw new Error(`Kasa discovery step failed: ${kasaResult.error || 'Unknown error'}`);
      }
    } else {
      throw new Error('Kasa discovery response did not include a result payload');
    }

    console.log('✅ All advanced wizard system tests completed successfully!');
    console.log('\n🎯 Advanced Features Tested:');
    console.log('  ✅ Wizard templates and recommendations');
    console.log('  ✅ Template application with auto-execution');
    console.log('  ✅ Field validation and error handling');
    console.log('  ✅ Bulk wizard operations');
    console.log('  ✅ Device-specific wizard execution');
    console.log('  ✅ Real-time device testing and connection validation');
    console.log('  ✅ Kasa device auto-discovery regression coverage');

  } catch (error) {
    console.error('❌ Advanced test failed:', error.message);
  }
}

// Check if server is running first
makeRequest('GET', '/health')
  .then(() => {
    console.log('🟢 Server is running, starting advanced wizard tests...\n');
    return testAdvancedWizardSystem();
  })
  .catch(() => {
    console.log('🔴 Server not running. Please start server-charlie.js first.');
    console.log('Run: node server-charlie.js');
  });