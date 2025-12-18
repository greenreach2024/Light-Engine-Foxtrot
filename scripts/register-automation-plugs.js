#!/usr/bin/env node

/**
 * Register SwitchBot plugs with the automation system
 * These are the devices used in automation rules
 */

const PLUGS = [
  {
    deviceId: '3C8427B1316E',
    name: 'Grow Room 1, West Fan',
    vendor: 'switchbot',
    model: 'Plug Mini (US)'
  },
  {
    deviceId: '84FCE6F34A66',
    name: 'Grow Room 1, East Fan',
    vendor: 'switchbot',
    model: 'Plug Mini (US)'
  },
  {
    deviceId: '3C8427B1E392',
    name: 'Grow Room 1, Dehumidifier',
    vendor: 'switchbot',
    model: 'Plug Mini (US)'
  },
  {
    deviceId: '7C2C67C5467A',
    name: 'Zone 3 Fan',
    vendor: 'switchbot',
    model: 'Plug Mini (US)'
  },
  {
    deviceId: '84FCE6F5B1B6',
    name: 'Grow Room 3, Dehumidifier',
    vendor: 'switchbot',
    model: 'Plug Mini (US)'
  }
];

async function registerPlugs() {
  console.log('🔌 Registering automation plugs...\n');

  for (const plug of PLUGS) {
    try {
      const response = await fetch('http://localhost:8091/plugs/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plug)
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(` Failed to register ${plug.name}: ${error}`);
        continue;
      }

      const result = await response.json();
      console.log(` Registered: ${plug.name}`);
    } catch (error) {
      console.error(` Error registering ${plug.name}:`, error.message);
    }
  }

  console.log('\n✨ Plug registration complete!');
}

registerPlugs().catch(console.error);
