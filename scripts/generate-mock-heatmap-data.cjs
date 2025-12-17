#!/usr/bin/env node
/**
 * Generate Mock Heat Map Data
 * Creates realistic 24-hour environmental data showing:
 * - Light cycle effects (8hr on, 4hr off)
 * - Mini-split cooling in 2 zones
 * - Circulation fan effects in 2 zones
 * - Temperature and humidity correlation
 */

const fs = require('fs');
const path = require('path');

// Configuration
const DATA_DIR = path.join(__dirname, '../public/data');
const INTERVALS = 288; // 24 hours * 12 (5-minute intervals)

// Light cycle: 8 hours on, 4 hours off (2 cycles per 24 hours)
// Cycle 1: 00:00-04:00 OFF, 04:00-12:00 ON
// Cycle 2: 12:00-16:00 OFF, 16:00-24:00 ON
function isLightsOn(intervalIndex) {
  const hour = (intervalIndex * 5 / 60); // Convert to hours
  // Lights on: 4-12 and 16-24
  return (hour >= 4 && hour < 12) || (hour >= 16 && hour < 24);
}

// Generate temperature pattern
function generateTemperature(intervalIndex, zoneId) {
  const lightsOn = isLightsOn(intervalIndex);
  const hour = (intervalIndex * 5 / 60);
  
  // Base temperatures
  const baseTemp = 70; // Lights off baseline
  const lightHeat = 8; // Heat from lights
  
  // Zone-specific adjustments
  let zoneAdjustment = 0;
  let coolingEffect = 0;
  
  if (zoneId === 'zone-1' || zoneId === 'zone-2') {
    // Zones with mini-splits - better cooling
    coolingEffect = lightsOn ? -4 : 0; // Mini-split reduces light heat by 4°F
  } else {
    // Zones with just fans - moderate cooling
    coolingEffect = lightsOn ? -2 : 0; // Fans reduce light heat by 2°F
  }
  
  // Add some natural variation based on time of day
  const dailyVariation = Math.sin((hour / 24) * Math.PI * 2) * 1.5;
  
  // Gradual ramp up/down (not instant)
  let lightEffect = 0;
  if (lightsOn) {
    const cycleStart = hour >= 16 ? 16 : 4;
    const minutesSinceOn = (hour - cycleStart) * 60;
    // Ramp up over 30 minutes to full heat
    lightEffect = Math.min(1, minutesSinceOn / 30) * lightHeat;
  }
  
  const temp = baseTemp + lightEffect + coolingEffect + dailyVariation + (Math.random() - 0.5) * 0.5;
  return Math.round(temp * 10) / 10; // Round to 1 decimal
}

// Generate humidity pattern
function generateHumidity(intervalIndex, zoneId) {
  const lightsOn = isLightsOn(intervalIndex);
  const hour = (intervalIndex * 5 / 60);
  
  // Base humidity
  const baseRH = 55; // Lights off baseline
  const lightHumidity = 10; // Transpiration increases humidity
  
  // Zone-specific adjustments
  let dehumidifyEffect = 0;
  
  if (zoneId === 'zone-1' || zoneId === 'zone-2') {
    // Mini-splits dehumidify as they cool
    dehumidifyEffect = lightsOn ? -3 : 0;
  } else {
    // Fans don't dehumidify much
    dehumidifyEffect = lightsOn ? -1 : 0;
  }
  
  // Daily variation (higher at night naturally)
  const dailyVariation = Math.cos((hour / 24) * Math.PI * 2) * 3;
  
  // Gradual ramp
  let lightEffect = 0;
  if (lightsOn) {
    const cycleStart = hour >= 16 ? 16 : 4;
    const minutesSinceOn = (hour - cycleStart) * 60;
    lightEffect = Math.min(1, minutesSinceOn / 30) * lightHumidity;
  }
  
  const rh = baseRH + lightEffect + dehumidifyEffect + dailyVariation + (Math.random() - 0.5) * 1;
  return Math.round(Math.max(40, Math.min(70, rh)) * 10) / 10; // Clamp 40-70%
}

// Calculate VPD from temp and RH
function calculateVPD(tempF, rh) {
  const tempC = (tempF - 32) * 5/9;
  const svp = 0.6108 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const vpd = svp * (1 - rh / 100);
  return Math.round(vpd * 100) / 100;
}

// Generate 24-hour history for one zone
function generateZoneHistory(zoneId) {
  const tempHistory = [];
  const rhHistory = [];
  const vpdHistory = [];
  
  for (let i = 0; i < INTERVALS; i++) {
    const temp = generateTemperature(i, zoneId);
    const rh = generateHumidity(i, zoneId);
    const vpd = calculateVPD(temp, rh);
    
    tempHistory.push(temp);
    rhHistory.push(rh);
    vpdHistory.push(vpd);
  }
  
  return {
    current: tempHistory[INTERVALS - 1],
    tempHistory,
    rhHistory,
    vpdHistory
  };
}

// Create mock room map
function createRoomMap() {
  return {
    roomId: "mock-grow-room",
    name: "Mock Grow Room",
    version: 2,
    gridSize: 20,
    cellSize: 40,
    zones: [
      {
        zone: 1,
        name: "Zone 1 (Mini-Split)",
        color: "#3b82f6",
        x1: 1,
        y1: 1,
        x2: 9,
        y2: 6
      },
      {
        zone: 2,
        name: "Zone 2 (Mini-Split)",
        color: "#10b981",
        x1: 11,
        y1: 1,
        x2: 19,
        y2: 6
      },
      {
        zone: 3,
        name: "Zone 3 (Fans)",
        color: "#f59e0b",
        x1: 1,
        y1: 8,
        x2: 9,
        y2: 13
      },
      {
        zone: 4,
        name: "Zone 4 (Fans)",
        color: "#ef4444",
        x1: 11,
        y1: 8,
        x2: 19,
        y2: 13
      }
    ],
    devices: [
      // Zone 1 - Mini-split + Sensor + Lights
      {
        deviceId: "sensor-zone-1",
        x: 5,
        y: 3,
        snapshot: {
          name: "Sensor Zone 1",
          type: "WoIOSensor",
          protocol: "switchbot",
          category: "sensor",
          zone: 1,
          icon: "🌡️"
        }
      },
      {
        deviceId: "minisplit-zone-1",
        x: 2,
        y: 2,
        snapshot: {
          name: "Mini-Split Zone 1",
          type: "HVAC",
          protocol: "switchbot",
          category: "equipment",
          zone: 1,
          icon: "🌀"
        }
      },
      {
        deviceId: "light-line-1-zone-1",
        x: 4,
        y: 4,
        snapshot: {
          name: "Grow Light Line 1",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 1,
          icon: "💡"
        }
      },
      {
        deviceId: "light-line-2-zone-1",
        x: 7,
        y: 4,
        snapshot: {
          name: "Grow Light Line 2",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 1,
          icon: "💡"
        }
      },
      // Zone 2 - Mini-split + Sensor + Lights
      {
        deviceId: "sensor-zone-2",
        x: 15,
        y: 3,
        snapshot: {
          name: "Sensor Zone 2",
          type: "WoIOSensor",
          protocol: "switchbot",
          category: "sensor",
          zone: 2,
          icon: "🌡️"
        }
      },
      {
        deviceId: "minisplit-zone-2",
        x: 12,
        y: 2,
        snapshot: {
          name: "Mini-Split Zone 2",
          type: "HVAC",
          protocol: "switchbot",
          category: "equipment",
          zone: 2,
          icon: "🌀"
        }
      },
      {
        deviceId: "light-line-1-zone-2",
        x: 14,
        y: 4,
        snapshot: {
          name: "Grow Light Line 1",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 2,
          icon: "💡"
        }
      },
      {
        deviceId: "light-line-2-zone-2",
        x: 17,
        y: 4,
        snapshot: {
          name: "Grow Light Line 2",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 2,
          icon: "💡"
        }
      },
      // Zone 3 - Fans + Sensor + Lights
      {
        deviceId: "sensor-zone-3",
        x: 5,
        y: 10,
        snapshot: {
          name: "Sensor Zone 3",
          type: "WoIOSensor",
          protocol: "switchbot",
          category: "sensor",
          zone: 3,
          icon: "🌡️"
        }
      },
      {
        deviceId: "fan-zone-3",
        x: 2,
        y: 9,
        snapshot: {
          name: "Circulation Fan Zone 3",
          type: "plug",
          protocol: "switchbot",
          category: "equipment",
          zone: 3,
          icon: "🔌"
        }
      },
      {
        deviceId: "light-line-1-zone-3",
        x: 4,
        y: 11,
        snapshot: {
          name: "Grow Light Line 1",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 3,
          icon: "💡"
        }
      },
      {
        deviceId: "light-line-2-zone-3",
        x: 7,
        y: 11,
        snapshot: {
          name: "Grow Light Line 2",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 3,
          icon: "💡"
        }
      },
      // Zone 4 - Fans + Sensor + Lights
      {
        deviceId: "sensor-zone-4",
        x: 15,
        y: 10,
        snapshot: {
          name: "Sensor Zone 4",
          type: "WoIOSensor",
          protocol: "switchbot",
          category: "sensor",
          zone: 4,
          icon: "🌡️"
        }
      },
      {
        deviceId: "fan-zone-4",
        x: 12,
        y: 9,
        snapshot: {
          name: "Circulation Fan Zone 4",
          type: "plug",
          protocol: "switchbot",
          category: "equipment",
          zone: 4,
          icon: "🔌"
        }
      },
      {
        deviceId: "light-line-1-zone-4",
        x: 14,
        y: 11,
        snapshot: {
          name: "Grow Light Line 1",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 4,
          icon: "💡"
        }
      },
      {
        deviceId: "light-line-2-zone-4",
        x: 17,
        y: 11,
        snapshot: {
          name: "Grow Light Line 2",
          type: "light",
          protocol: "switchbot",
          category: "light",
          zone: 4,
          icon: "💡"
        }
      }
    ],
    lastUpdated: new Date().toISOString()
  };
}

// Create environmental data
function createEnvData() {
  const zone1 = generateZoneHistory('zone-1');
  const zone2 = generateZoneHistory('zone-2');
  const zone3 = generateZoneHistory('zone-3');
  const zone4 = generateZoneHistory('zone-4');
  
  return {
    zones: [
      {
        id: "zone-1",
        name: "Zone 1 (Mini-Split)",
        location: "zone-1",
        sensors: {
          tempC: {
            current: zone1.current,
            setpoint: { min: 68, max: 75 },
            history: zone1.tempHistory
          },
          rh: {
            current: zone1.rhHistory[INTERVALS - 1],
            setpoint: { min: 50, max: 60 },
            history: zone1.rhHistory
          },
          vpd: {
            current: zone1.vpdHistory[INTERVALS - 1],
            setpoint: { min: 0.8, max: 1.2 },
            history: zone1.vpdHistory
          }
        }
      },
      {
        id: "zone-2",
        name: "Zone 2 (Mini-Split)",
        location: "zone-2",
        sensors: {
          tempC: {
            current: zone2.current,
            setpoint: { min: 68, max: 75 },
            history: zone2.tempHistory
          },
          rh: {
            current: zone2.rhHistory[INTERVALS - 1],
            setpoint: { min: 50, max: 60 },
            history: zone2.rhHistory
          },
          vpd: {
            current: zone2.vpdHistory[INTERVALS - 1],
            setpoint: { min: 0.8, max: 1.2 },
            history: zone2.vpdHistory
          }
        }
      },
      {
        id: "zone-3",
        name: "Zone 3 (Fans)",
        location: "zone-3",
        sensors: {
          tempC: {
            current: zone3.current,
            setpoint: { min: 68, max: 75 },
            history: zone3.tempHistory
          },
          rh: {
            current: zone3.rhHistory[INTERVALS - 1],
            setpoint: { min: 50, max: 60 },
            history: zone3.rhHistory
          },
          vpd: {
            current: zone3.vpdHistory[INTERVALS - 1],
            setpoint: { min: 0.8, max: 1.2 },
            history: zone3.vpdHistory
          }
        }
      },
      {
        id: "zone-4",
        name: "Zone 4 (Fans)",
        location: "zone-4",
        sensors: {
          tempC: {
            current: zone4.current,
            setpoint: { min: 68, max: 75 },
            history: zone4.tempHistory
          },
          rh: {
            current: zone4.rhHistory[INTERVALS - 1],
            setpoint: { min: 50, max: 60 },
            history: zone4.rhHistory
          },
          vpd: {
            current: zone4.vpdHistory[INTERVALS - 1],
            setpoint: { min: 0.8, max: 1.2 },
            history: zone4.vpdHistory
          }
        }
      }
    ],
    lastUpdated: new Date().toISOString()
  };
}

// Main execution
console.log('🌡️  Generating mock heat map data...\n');

// Create room map
const roomMap = createRoomMap();
const roomMapPath = path.join(DATA_DIR, 'room-map.json');
fs.writeFileSync(roomMapPath, JSON.stringify(roomMap, null, 2));
console.log('✅ Created room-map.json');
console.log(`   - 4 zones (2 with mini-splits, 2 with fans)`);
console.log(`   - 4 sensors (1 per zone)`);
console.log(`   - 8 grow lights (2 lines per zone)`);
console.log(`   - 2 mini-splits + 2 fans\n`);

// Create environmental data
const envData = createEnvData();
const envDataPath = path.join(DATA_DIR, 'env.json');
fs.writeFileSync(envDataPath, JSON.stringify(envData, null, 2));
console.log('✅ Created env.json');
console.log(`   - 288 data points per metric (24 hours @ 5min intervals)`);
console.log(`   - Light cycle: 8hr on, 4hr off (repeating)`);
console.log(`   - Temperature range: 68-78°F`);
console.log(`   - Humidity range: 52-65%`);
console.log(`   - VPD range: 0.75-1.35 kPa\n`);

// Summary
console.log('📊 Pattern Summary:');
console.log('   Lights OFF: Temp ~70°F, RH ~55%');
console.log('   Lights ON:  Temp rises to ~78°F, RH ~65%');
console.log('   Mini-Splits: Cool to ~72°F (Zones 1 & 2)');
console.log('   Fans:       Cool to ~74°F (Zones 3 & 4)');
console.log('\n🚀 Ready for heat map visualization!');
console.log('   Open: http://localhost:8091/views/room-heatmap.html\n');
