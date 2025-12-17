/**
 * Demo Mode Middleware for Light Engine
 * Routes requests to demo data when DEMO_MODE is enabled
 * 
 * Usage in server-charlie.js:
 *   import { createDemoModeHandler, isDemoMode, getDemoData } from './server/middleware/demo-mode-handler.js';
 *   
 *   // Initialize
 *   const demoHandler = createDemoModeHandler();
 *   
 *   // Apply to routes
 *   app.get('/api/admin/farms/:farmId', demoHandler, async (req, res) => {
 *     if (req.isDemoRequest) {
 *       return res.json(getDemoData().findFarm(req.params.farmId));
 *     }
 *     // Normal production code...
 *   });
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import DemoDataGenerator from '../../lib/demo-data-generator.js';
import DemoSensorSimulator from '../../lib/demo-sensor-simulator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global demo state
let demoState = null;

/**
 * Initialize demo mode system
 */
export function initializeDemoMode() {
  console.log('[demo-mode-handler] initializeDemoMode() called');
  console.log('[demo-mode-handler] process.env.DEMO_MODE =', process.env.DEMO_MODE);
  
  const DEMO_MODE = process.env.DEMO_MODE === 'true';
  const DEMO_FARM_ID = process.env.DEMO_FARM_ID || 'GR-00001';
  const DEMO_REALTIME = process.env.DEMO_REALTIME === 'true';

  console.log('[demo-mode-handler] DEMO_MODE evaluated to:', DEMO_MODE);

  if (!DEMO_MODE) {
    console.log('📊 Demo mode: DISABLED');
    return null;
  }

  console.log('🎭 DEMO MODE ENABLED');
  console.log(`   Farm ID: ${DEMO_FARM_ID}`);
  console.log(`   Real-time simulation: ${DEMO_REALTIME}`);

  // Load or generate demo data
  const demoDataPath = path.join(__dirname, '../../data/demo/demo-farm-complete.json');
  let farmData;

  try {
    if (fs.existsSync(demoDataPath)) {
      console.log('   Loading demo data from file...');
      farmData = JSON.parse(fs.readFileSync(demoDataPath, 'utf8'));
    } else {
      console.log('   Generating demo data...');
      const generator = new DemoDataGenerator(DEMO_FARM_ID);
      farmData = generator.generateFarm();
      
      // Save for future use
      fs.mkdirSync(path.dirname(demoDataPath), { recursive: true });
      fs.writeFileSync(demoDataPath, JSON.stringify(farmData, null, 2));
    }
  } catch (error) {
    console.error('   ⚠️  Failed to load/generate demo data:', error.message);
    console.log('   Generating fresh demo data...');
    const generator = new DemoDataGenerator(DEMO_FARM_ID);
    farmData = generator.generateFarm();
  }

  // Initialize state
  demoState = {
    enabled: true,
    farmId: DEMO_FARM_ID,
    farmData,
    sensorSimulator: new DemoSensorSimulator(),
    realtime: DEMO_REALTIME,
    startTime: Date.now()
  };

  // Start real-time simulation if enabled
  if (DEMO_REALTIME) {
    startRealtimeSimulation();
  }

  console.log('   ✅ Demo mode initialized');
  console.log(`   - ${farmData.rooms.length} rooms`);
  console.log(`   - ${farmData.devices.lights.length} lights`);
  console.log(`   - ${farmData.devices.sensors.length} sensors`);
  console.log(`   - ${farmData.inventory.length} trays`);

  return demoState;
}

/**
 * Create demo mode middleware
 */
export function createDemoModeHandler() {
  return (req, res, next) => {
    if (!demoState || !demoState.enabled) {
      return next();
    }

    // Check if this request is for the demo farm
    const farmId = req.params.farmId || req.query.farmId || req.body?.farmId;
    
    if (farmId && farmId === demoState.farmId) {
      req.isDemoRequest = true;
      req.demoData = demoState;
    }

    // Also flag requests from demo context
    if (req.headers['x-demo-mode'] === 'true') {
      req.isDemoRequest = true;
      req.demoData = demoState;
    }

    next();
  };
}

/**
 * Check if demo mode is enabled
 */
export function isDemoMode() {
  return demoState && demoState.enabled;
}

/**
 * Get demo data accessor
 */
export function getDemoData() {
  if (!demoState) {
    throw new Error('Demo mode not initialized');
  }

  return {
    // Get complete farm data
    getFarm() {
      return demoState.farmData;
    },

    // Find specific farm by ID
    findFarm(farmId) {
      if (farmId !== demoState.farmId) {
        return null;
      }
      return demoState.farmData;
    },

    // Get farm summary
    getFarmSummary() {
      const farm = demoState.farmData;
      return {
        farmId: farm.farmId,
        name: farm.name,
        status: farm.status,
        region: farm.region,
        rooms: farm.rooms.length,
        zones: farm.rooms.reduce((sum, r) => sum + r.zones.length, 0),
        devices: farm.devices.lights.length + farm.devices.sensors.length,
        trays: farm.inventory.length,
        plants: farm.inventory.reduce((sum, t) => sum + t.plantCount, 0),
        energy: Math.floor(Math.random() * 200) + 150, // Mock energy usage
        alerts: 0,
        lastUpdate: new Date().toISOString()
      };
    },

    // Get room data
    getRoom(roomId) {
      return demoState.farmData.rooms.find(r => r.roomId === roomId);
    },

    // Get zone data
    getZone(zoneId) {
      for (const room of demoState.farmData.rooms) {
        const zone = room.zones.find(z => z.zoneId === zoneId);
        if (zone) return zone;
      }
      return null;
    },

    // Get group data
    getGroup(groupId) {
      for (const room of demoState.farmData.rooms) {
        for (const zone of room.zones) {
          const group = zone.groups.find(g => g.groupId === groupId);
          if (group) return group;
        }
      }
      return null;
    },

    // Get devices
    getDevices(type = null) {
      if (!type) {
        return [
          ...demoState.farmData.devices.lights,
          ...demoState.farmData.devices.sensors,
          ...demoState.farmData.devices.hvac
        ];
      }
      return demoState.farmData.devices[type] || [];
    },

    // Get inventory
    getInventory(filters = {}) {
      let inventory = [...demoState.farmData.inventory];

      if (filters.status) {
        inventory = inventory.filter(t => t.status === filters.status);
      }
      if (filters.room) {
        inventory = inventory.filter(t => t.room === filters.room);
      }
      if (filters.zone) {
        inventory = inventory.filter(t => t.zone === filters.zone);
      }

      return inventory;
    },

    // Get tray by ID
    getTray(trayId) {
      return demoState.farmData.inventory.find(t => t.trayId === trayId);
    },

    // Get sensor readings
    getSensorReadings(zoneId = null) {
      if (zoneId) {
        return demoState.sensorSimulator.generateZoneSummary(zoneId);
      }
      return demoState.sensorSimulator.getAllCurrentReadings();
    },

    // Get sensor history
    getSensorHistory(metric, hours = 24) {
      return demoState.sensorSimulator.generateSensorHistory(metric, hours);
    },

    // Get environmental data (for /env endpoint)
    getEnvironmentalData() {
      const zones = [];
      
      demoState.farmData.rooms.forEach(room => {
        room.zones.forEach(zone => {
          const readings = demoState.sensorSimulator.generateZoneSummary(zone.zoneId);
          zones.push({
            id: zone.zoneId,
            name: zone.name,
            room: room.roomId,
            ...readings
          });
        });
      });

      return { zones };
    },

    // Get harvest forecast
    getHarvestForecast() {
      const inventory = demoState.farmData.inventory;
      const now = new Date();

      const buckets = {
        next7Days: [],
        next14Days: [],
        next30Days: [],
        beyond30Days: []
      };

      inventory.forEach(tray => {
        const harvestDate = new Date(tray.harvestDate);
        const daysUntil = Math.ceil((harvestDate - now) / (1000 * 60 * 60 * 24));

        if (daysUntil <= 7) {
          buckets.next7Days.push(tray);
        } else if (daysUntil <= 14) {
          buckets.next14Days.push(tray);
        } else if (daysUntil <= 30) {
          buckets.next30Days.push(tray);
        } else {
          buckets.beyond30Days.push(tray);
        }
      });

      return {
        next7Days: { count: buckets.next7Days.length, trays: buckets.next7Days },
        next14Days: { count: buckets.next14Days.length, trays: buckets.next14Days },
        next30Days: { count: buckets.next30Days.length, trays: buckets.next30Days },
        beyond30Days: { count: buckets.beyond30Days.length, trays: buckets.beyond30Days }
      };
    },

    // Get automation rules
    getAutomationRules() {
      return demoState.farmData.automationRules || [];
    }
  };
}

/**
 * Start real-time sensor data simulation
 */
function startRealtimeSimulation() {
  const UPDATE_INTERVAL = 60000; // 1 minute

  setInterval(() => {
    // Update sensor readings in farm data
    demoState.farmData.rooms.forEach(room => {
      const roomReadings = demoState.sensorSimulator.getAllCurrentReadings();
      room.temperature = roomReadings.temperature;
      room.humidity = roomReadings.humidity;
      room.co2 = roomReadings.co2;

      room.zones.forEach(zone => {
        const zoneReadings = demoState.sensorSimulator.getAllCurrentReadings();
        zone.temperature = zoneReadings.temperature;
        zone.humidity = zoneReadings.humidity;
        zone.co2 = zoneReadings.co2;
        zone.ppfd = zoneReadings.ppfd;
        zone.vpd = zoneReadings.vpd;
      });
    });

    // Update device statuses
    demoState.farmData.devices.sensors.forEach(sensor => {
      sensor.readings = demoState.sensorSimulator.getAllCurrentReadings();
      sensor.lastSeen = new Date().toISOString();
    });

    demoState.farmData.devices.lights.forEach(light => {
      light.lastSeen = new Date().toISOString();
    });
  }, UPDATE_INTERVAL);

  console.log('   🔄 Real-time simulation started (updates every 60s)');
}

/**
 * Get demo mode status banner HTML
 */
export function getDemoBannerHTML() {
  if (!isDemoMode()) return '';

  const uptime = Math.floor((Date.now() - demoState.startTime) / 1000 / 60); // minutes

  return `
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                padding: 12px 20px; 
                text-align: center; 
                font-weight: 500;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                position: sticky;
                top: 0;
                z-index: 1000;">
      🎭 DEMO MODE ACTIVE - Farm: ${demoState.farmId} | Uptime: ${uptime}m | Data resets nightly
    </div>
  `;
}

export default {
  initializeDemoMode,
  createDemoModeHandler,
  isDemoMode,
  getDemoData,
  getDemoBannerHTML
};
