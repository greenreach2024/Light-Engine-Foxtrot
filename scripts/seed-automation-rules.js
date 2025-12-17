#!/usr/bin/env node
/**
 * Seed automation rules for real farm devices
 * Maps sensors to fans and dehumidifiers based on temperature/humidity
 */

const AUTOMATION_RULES = [
  {
    id: 'grow-room-1-high-temp-fans',
    name: 'Grow Room 1: High Temp → Fans ON',
    scope: { room: 'zone-CE2A8606558E' }, // Grow Room 1, Tw 2 sensor
    enabled: true,
    when: {
      tempC: { gt: 24 } // Turn on fans when temp > 24°C
    },
    actions: [
      { plugId: '3C8427B1316E', set: 'on' }, // West Fan
      { plugId: '84FCE6F34A66', set: 'on' }  // East Fan
    ],
    guardrails: {
      minHoldSec: 120, // Don't toggle more than every 2 minutes
      freshnessMs: 60000 // Only act on fresh data (last minute)
    }
  },
  {
    id: 'grow-room-1-low-temp-fans',
    name: 'Grow Room 1: Normal Temp → Fans OFF',
    scope: { room: 'zone-CE2A8606558E' },
    enabled: true,
    when: {
      tempC: { lte: 22 } // Turn off fans when temp ≤ 22°C
    },
    actions: [
      { plugId: '3C8427B1316E', set: 'off' }, // West Fan
      { plugId: '84FCE6F34A66', set: 'off' }  // East Fan
    ],
    guardrails: {
      minHoldSec: 120,
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-1-high-humidity-dehu',
    name: 'Grow Room 1: High Humidity → Dehumidifier ON',
    scope: { room: 'zone-CE2A8606558E' },
    enabled: true,
    when: {
      rh: { gt: 70 } // Turn on dehumidifier when RH > 70%
    },
    actions: [
      { plugId: '3C8427B1E392', set: 'on' } // Grow Room 1 Dehumidifier
    ],
    guardrails: {
      minHoldSec: 300, // 5 minutes minimum between toggles
      maxOnPerHour: 4, // Max 4 activations per hour
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-1-normal-humidity-dehu',
    name: 'Grow Room 1: Normal Humidity → Dehumidifier OFF',
    scope: { room: 'zone-CE2A8606558E' },
    enabled: true,
    when: {
      rh: { lte: 65 } // Turn off dehumidifier when RH ≤ 65%
    },
    actions: [
      { plugId: '3C8427B1E392', set: 'off' }
    ],
    guardrails: {
      minHoldSec: 300,
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-3-high-temp-fan',
    name: 'Grow Room 3: High Temp → Fan ON',
    scope: { room: 'zone-CE2A84063B59' }, // Grow Room 3, Front Middle Zone
    enabled: true,
    when: {
      tempC: { gt: 24 }
    },
    actions: [
      { plugId: '7C2C67C5467A', set: 'on' } // Zone 3 Fan
    ],
    guardrails: {
      minHoldSec: 120,
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-3-low-temp-fan',
    name: 'Grow Room 3: Normal Temp → Fan OFF',
    scope: { room: 'zone-CE2A84063B59' },
    enabled: true,
    when: {
      tempC: { lte: 22 }
    },
    actions: [
      { plugId: '7C2C67C5467A', set: 'off' }
    ],
    guardrails: {
      minHoldSec: 120,
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-3-high-humidity-dehu',
    name: 'Grow Room 3: High Humidity → Dehumidifier ON',
    scope: { room: 'zone-CE2A84063B59' },
    enabled: true,
    when: {
      rh: { gt: 70 }
    },
    actions: [
      { plugId: '84FCE6F5B1B6', set: 'on' } // Grow Room 3 Dehumidifier
    ],
    guardrails: {
      minHoldSec: 300,
      maxOnPerHour: 4,
      freshnessMs: 60000
    }
  },
  {
    id: 'grow-room-3-normal-humidity-dehu',
    name: 'Grow Room 3: Normal Humidity → Dehumidifier OFF',
    scope: { room: 'zone-CE2A84063B59' },
    enabled: true,
    when: {
      rh: { lte: 65 }
    },
    actions: [
      { plugId: '84FCE6F5B1B6', set: 'off' }
    ],
    guardrails: {
      minHoldSec: 300,
      freshnessMs: 60000
    }
  }
];

async function seedRules() {
  const baseUrl = process.env.BASE_URL || 'http://localhost:8091';
  
  console.log('🌱 Seeding automation rules...\n');
  
  for (const rule of AUTOMATION_RULES) {
    try {
      const response = await fetch(`${baseUrl}/api/automation/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rule)
      });
      
      if (response.ok) {
        console.log(`✅ ${rule.name}`);
      } else {
        const error = await response.text();
        console.log(`❌ ${rule.name}: ${error}`);
      }
    } catch (error) {
      console.log(`❌ ${rule.name}: ${error.message}`);
    }
  }
  
  console.log(`\n✨ Seeded ${AUTOMATION_RULES.length} automation rules`);
}

seedRules().catch(console.error);
