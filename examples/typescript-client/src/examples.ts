/**
 * Example usage scenarios demonstrating type-safe API interactions
 */

import { LightEngineClient } from './client';
import type {
  SensorPayload,
  NetworkTestRequest,
  DeviceCommandRequest,
  FailsafePowerRequest,
  AutomationRule,
} from './types';

async function runExamples() {
  // Initialize client
  const client = new LightEngineClient({
    baseUrl: 'http://localhost:8000',
    timeout: 10000,
  });

  console.log('🌱 Light Engine Charlie - Type-Safe API Examples\n');

  try {
    // Example 1: Health Check
    console.log('1️⃣ Health Check');
    const health = await client.health();
    console.log(`   Status: ${health.status}`);
    console.log(`   Version: ${health.version}\n`);

    // Example 2: Ingest Sensor Data (Type-Safe)
    console.log('2️⃣ Ingest Sensor Data (Type-Safe)');
    const sensorData: SensorPayload = {
      scope: 'VegRoom1',
      ts: new Date().toISOString(),
      sensors: {
        temperature: { value: 75.2, unit: 'F' },
        humidity: { value: 60.5, unit: '%' },
        co2: { value: 1200, unit: 'ppm' },
      },
    };
    const ingestResult = await client.ingestSensorData(sensorData);
    console.log(`   Ingested: ${JSON.stringify(ingestResult.message)}\n`);

    // Example 3: Get Latest Readings
    console.log('3️⃣ Get Latest Readings');
    const latest = await client.getLatestReadings('VegRoom1');
    console.log(`   Scope: ${latest.scope}`);
    console.log(`   Sensors: ${Object.keys(latest.sensors).join(', ')}`);
    console.log(`   Observed: ${latest.observedAt}\n`);

    // Example 4: Trigger Device Discovery
    console.log('4️⃣ Trigger Device Discovery');
    const discoveryResult = await client.triggerDiscovery();
    console.log(`   Status: ${discoveryResult.status}`);
    console.log(`   Message: ${discoveryResult.message}\n`);

    // Wait for discovery
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Example 5: Get Discovered Devices (with type safety)
    console.log('5️⃣ Get Discovered Devices');
    const devices = await client.getDiscoveredDevices();
    console.log(`   Found: ${devices.count} devices`);
    devices.devices.forEach((device) => {
      console.log(`   - ${device.name} (${device.protocol})`);
    });
    console.log();

    // Example 6: Network Connectivity Test (Type-Safe Request)
    console.log('6️⃣ Network Connectivity Test');
    const networkTest: NetworkTestRequest = {
      host: 'google.com',
      port: 80,
      protocol: 'http',
    };
    const networkResult = await client.testNetworkConnection(networkTest);
    console.log(`   Host: ${networkResult.host}:${networkResult.port}`);
    console.log(`   Reachable: ${networkResult.reachable ? '✅' : '❌'}`);
    console.log(`   Message: ${networkResult.message}\n`);

    // Example 7: Device Command (Type-Safe)
    console.log('7️⃣ Send Device Command');
    const command: DeviceCommandRequest = {
      device_id: 'fixture_001',
      command: {
        action: 'set_brightness',
        value: 80,
      },
    };
    const commandResult = await client.sendDeviceCommand(command);
    console.log(`   Device: ${commandResult.device_id}`);
    console.log(`   Success: ${commandResult.success ? '✅' : '❌'}`);
    console.log(`   Message: ${commandResult.message}\n`);

    // Example 8: Get Lighting Fixtures
    console.log('8️⃣ Get Lighting Fixtures');
    const fixtures = await client.getLightingFixtures();
    console.log(`   Total: ${fixtures.count} fixtures`);
    fixtures.fixtures.forEach((fixture) => {
      console.log(`   - ${fixture.name} (${fixture.protocol})`);
    });
    console.log();

    // Example 9: Create Automation Rule (Type-Safe)
    console.log('9️⃣ Create Automation Rule');
    const rule: AutomationRule = {
      name: 'High Temperature Alert',
      enabled: true,
      conditions: {
        sensor: 'temperature',
        operator: 'gt',
        value: 85,
        scope: 'VegRoom1',
      },
      actions: {
        notification: {
          type: 'alert',
          message: 'Temperature exceeded 85°F',
        },
        device_command: {
          device_id: 'exhaust_fan_001',
          action: 'turn_on',
        },
      },
      priority: 10,
    };
    const ruleResult = await client.createRule(rule);
    console.log(`   Rule ID: ${ruleResult.rule_id}`);
    console.log(`   Success: ${ruleResult.success ? '✅' : '❌'}\n`);

    // Example 10: List All Rules
    console.log('🔟 List Automation Rules');
    const rules = await client.listRules();
    console.log(`   Total: ${rules.count} rules`);
    rules.rules.forEach((r) => {
      console.log(`   - ${r.name} (${r.enabled ? 'enabled' : 'disabled'})`);
    });
    console.log();

    // Example 11: Emergency Failsafe (Type-Safe)
    console.log('1️⃣1️⃣ Emergency Failsafe Test');
    const failsafe: FailsafePowerRequest = {
      fixtures: ['fixture_001', 'fixture_002'],
      power: 'off',
      brightness: 0,
    };
    const failsafeResult = await client.lightingFailsafe(failsafe);
    console.log(`   Total: ${failsafeResult.total} fixtures`);
    console.log(`   Successful: ${failsafeResult.successful}/${failsafeResult.total}`);
    console.log();

    console.log('✅ All examples completed successfully!');
    console.log('\n📊 Type Safety Benefits:');
    console.log('   - IDE autocomplete for all API methods');
    console.log('   - Compile-time type checking');
    console.log('   - IntelliSense for request/response objects');
    console.log('   - Catch errors before runtime');

  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples();
}

export { runExamples };
