#!/usr/bin/env node
/**
 * Initialize Environmental Data for Big Green Farm
 * Creates initial zone/room structure so sensors can start reporting
 */

const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '../public/data/env.json');

// Initialize with Big Green Farm structure
const initialEnvData = {
  zones: [
    {
      id: "room-knukf2:1",
      name: "Room 1 - Zone 1",
      location: "room-knukf2",
      sensors: {
        tempC: {
          current: null,
          unit: "°C",
          history: [],
          setpoint: { min: 18, max: 24 }
        },
        rh: {
          current: null,
          unit: "%",
          history: [],
          setpoint: { min: 55, max: 75 }
        },
        vpd: {
          current: null,
          unit: "kPa",
          history: [],
          setpoint: { min: 0.8, max: 1.2 }
        }
      },
      meta: {
        farmId: "FARM-MKLOMAT3-A9D8",
        farmName: "Big Green Farm",
        status: "awaiting_data",
        lastSync: new Date().toISOString()
      }
    }
  ],
  rooms: {},
  targets: {},
  control: {},
  demoAuthEnabled: false,
  updatedAt: new Date().toISOString()
};

// Write the file
fs.writeFileSync(envPath, JSON.stringify(initialEnvData, null, 2));
console.log(`✅ Initialized env.json with Big Green Farm structure`);
console.log(`   Zone: room-knukf2:1 (Room 1 - Zone 1)`);
console.log(`   Sensors will now report to this zone`);
