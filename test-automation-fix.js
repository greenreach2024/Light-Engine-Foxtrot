#!/usr/bin/env node

/**
 * Test script to verify automation system can control SwitchBot plugs with bare device IDs
 */

import PlugManager from './automation/plug-manager.js';
import PlugRegistry from './automation/plug-registry.js';
import SwitchBotDriver from './automation/drivers/switchbot-driver.js';

const SWITCHBOT_TOKEN = process.env.SWITCHBOT_TOKEN || '';
const SWITCHBOT_SECRET = process.env.SWITCHBOT_SECRET || '';

async function testAutomation() {
  console.log('=== Testing Automation Plug Control ===\n');

  // Initialize components
  const registry = new PlugRegistry({ dataDir: './data/automation' });
  const plugManager = new PlugManager({ registry });

  // Register SwitchBot driver
  const switchbotDriver = new SwitchBotDriver({
    token: SWITCHBOT_TOKEN,
    secret: SWITCHBOT_SECRET
  });
  
  // Check if driver has vendor method
  const vendorName = typeof switchbotDriver.vendor === 'function' 
    ? switchbotDriver.vendor() 
    : 'switchbot';
  
  plugManager.registerDriver(vendorName, switchbotDriver);

  console.log(' Plug manager initialized');
  console.log(' SwitchBot driver registered\n');

  // Test device IDs from automation rules
  const testDevices = [
    '3C8427B1316E', // Fan 1
    '84FCE6F34A66', // Fan 2
    '7C2C67C5467A', // Fan 3
  ];

  console.log('Testing bare device IDs (as used in automation rules):\n');

  for (const deviceId of testDevices) {
    try {
      console.log(`Testing device: ${deviceId}`);
      
      // Test 1: Check if driver can be found
      const driver = plugManager.getDriverForPlug(deviceId);
      if (!driver) {
        console.error(`  ✗ Driver not found for ${deviceId}`);
        continue;
      }
      console.log(`   Driver found: ${driver.vendor()}`);

      // Test 2: Get current state
      try {
        const state = await plugManager.getState(deviceId);
        console.log(`   Current state: ${state.on ? 'ON' : 'OFF'}`);
      } catch (error) {
        console.error(`  ✗ Failed to get state: ${error.message}`);
      }

      console.log('');
    } catch (error) {
      console.error(`  ✗ Error testing ${deviceId}: ${error.message}\n`);
    }
  }

  // Test normalized format too
  console.log('\nTesting normalized device ID format:\n');
  const normalizedId = 'plug:switchbot:3C8427B1316E';
  try {
    const driver = plugManager.getDriverForPlug(normalizedId);
    if (driver) {
      console.log(` Driver found for normalized ID: ${driver.vendor()}`);
      const state = await plugManager.getState(normalizedId);
      console.log(` Current state: ${state.on ? 'ON' : 'OFF'}`);
    } else {
      console.error('✗ Driver not found for normalized ID');
    }
  } catch (error) {
    console.error(`✗ Error: ${error.message}`);
  }

  console.log('\n=== Test Complete ===');
}

testAutomation().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
