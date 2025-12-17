/**
 * Demo Data Generator for Light Engine
 * Generates realistic farm structures, devices, and inventory for demo mode
 * 
 * Usage:
 *   const generator = new DemoDataGenerator('DEMO-FARM-001');
 *   const farmData = generator.generateFarm();
 */

import crypto from 'crypto';

export class DemoDataGenerator {
  constructor(farmId = 'DEMO-FARM-001', options = {}) {
    this.farmId = farmId;
    this.options = {
      roomCount: options.roomCount || 2,
      zonesPerRoom: options.zonesPerRoom || 4,
      lightsPerZone: options.lightsPerZone || 5,
      sensorsPerZone: options.sensorsPerZone || 3,
      traysPerZone: options.traysPerZone || 25,
      ...options
    };
    
    this.recipes = this._loadRecipes();
    this.deviceVendors = ['HLG', 'Spider Farmer', 'Fluence', 'MARS HYDRO', 'Grow3'];
    this.sensorTypes = ['Temperature', 'Humidity', 'CO2', 'Light', 'VPD'];
  }

  /**
   * Generate complete farm data structure
   */
  generateFarm() {
    const rooms = this._generateRooms();
    const devices = this._generateDevicesFromRooms(rooms);
    const inventory = this._generateInventoryFromRooms(rooms);
    const automationRules = this._generateAutomationRules();

    return {
      farmId: this.farmId,
      name: `Demo Vertical Farm - ${this.farmId}`,
      region: 'Demo Region',
      status: 'online',
      url: `http://demo.lightengine.farm`,
      contact: {
        name: 'Demo Farm Manager',
        email: 'demo@lightengine.farm',
        phone: '+1 (555) DEMO-FARM'
      },
      coordinates: {
        lat: 37.7749,
        lng: -122.4194
      },
      rooms,
      devices,
      inventory,
      automationRules,
      metadata: {
        generatedAt: new Date().toISOString(),
        version: '1.0.0',
        description: 'Demo farm data - resets nightly'
      }
    };
  }

  /**
   * Generate rooms with zones and groups
   */
  _generateRooms() {
    const rooms = [];
    const roomNames = ['Leafy Greens Production', 'Herb Garden', 'Microgreens', 'Flower Production'];
    
    for (let i = 0; i < this.options.roomCount; i++) {
      const roomId = `ROOM-${String.fromCharCode(65 + i)}`;
      const zones = this._generateZones(roomId, this.options.zonesPerRoom);
      
      rooms.push({
        id: roomId,  // Add 'id' for compatibility with frontend
        roomId,
        name: `Room ${String.fromCharCode(65 + i)} - ${roomNames[i] || 'Mixed Crops'}`,
        temperature: this._randomInRange(20, 24, 1),
        humidity: this._randomInRange(60, 70, 0),
        co2: this._randomInRange(800, 1200, 0),
        vpd: this._randomInRange(0.8, 1.2, 2),
        status: 'online',
        zones
      });
    }
    
    return rooms;
  }

  /**
   * Generate zones within a room
   */
  _generateZones(roomId, count) {
    const zones = [];
    const crops = ['Lettuce', 'Basil', 'Arugula', 'Kale', 'Spinach', 'Microgreens', 'Herbs'];
    
    for (let i = 0; i < count; i++) {
      const zoneId = `${roomId}-Z${i + 1}`;
      const crop = crops[i % crops.length];
      const groups = this._generateGroups(zoneId, 5, crop);
      
      zones.push({
        zoneId,
        name: `Zone ${i + 1} - ${crop} Production`,
        crop,
        temperature: this._randomInRange(20, 24, 1),
        humidity: this._randomInRange(60, 70, 0),
        co2: this._randomInRange(800, 1200, 0),
        ppfd: this._randomInRange(400, 600, 0),
        vpd: this._randomInRange(0.8, 1.2, 2),
        status: 'online',
        groups
      });
    }
    
    return zones;
  }

  /**
   * Generate light groups within a zone
   */
  _generateGroups(zoneId, count, crop) {
    const groups = [];
    const varieties = {
      'Lettuce': ['Butterhead', 'Romaine', 'Red Leaf', 'Oak Leaf', 'Mixed'],
      'Basil': ['Genovese', 'Thai', 'Purple', 'Lemon', 'Holy'],
      'Arugula': ['Wild', 'Cultivated', 'Baby', 'Red', 'Wasabi'],
      'Kale': ['Lacinato', 'Red Russian', 'Curly', 'Baby', 'Dinosaur'],
      'Spinach': ['Bloomsdale', 'Savoy', 'Flat Leaf', 'Baby', 'Red Stem']
    };
    
    const cropVarieties = varieties[crop] || ['Standard'];
    
    for (let i = 0; i < count; i++) {
      const groupId = `${zoneId}-G${String(i + 1).padStart(2, '0')}`;
      const variety = cropVarieties[i % cropVarieties.length];
      const daysOld = this._randomInRange(5, 30, 0);
      const harvestDays = Math.max(0, 28 - daysOld + this._randomInRange(-3, 3, 0));
      
      groups.push({
        groupId,
        name: `${variety} ${crop} Rack ${i + 1}`,
        crop: `${variety} ${crop}`,
        recipe: this._selectRecipe(crop),
        daysOld,
        harvestIn: harvestDays,
        trays: 8,
        plants: 192,
        health: this._randomChoice(['healthy', 'healthy', 'healthy', 'watch']),
        devices: [
          `${groupId}-LIGHT`,
          `${groupId}-SENSOR`
        ],
        intensity: this._randomInRange(75, 95, 0),
        spectrum: 'CW/WW + 450nm + 660nm'
      });
    }
    
    return groups;
  }

  /**
   * Generate all devices (lights, sensors) from room structure
   */
  _generateDevicesFromRooms(rooms) {
    const devices = {
      lights: [],
      sensors: [],
      hvac: [],
      irrigation: []
    };

    rooms.forEach(room => {
      // Add room-level HVAC
      devices.hvac.push({
        deviceId: `${room.roomId}-HVAC`,
        name: `${room.name} - HVAC Controller`,
        type: 'hvac',
        location: room.roomId,
        vendor: 'TrolMaster',
        model: 'Hydro-X Pro',
        status: 'online',
        lastSeen: new Date().toISOString()
      });

      room.zones.forEach(zone => {
        zone.groups.forEach(group => {
          // Add light for each group
          devices.lights.push({
            deviceId: group.devices[0],
            name: `${group.name} - LED Array`,
            type: 'light',
            location: zone.zoneId,
            vendor: this._randomChoice(this.deviceVendors),
            model: this._generateLightModel(),
            intensity: group.intensity,
            spectrum: group.spectrum,
            ppfd: zone.ppfd,
            status: 'online',
            lastSeen: new Date().toISOString(),
            energyUsage: this._randomInRange(200, 400, 0)
          });

          // Add sensor for each group
          devices.sensors.push({
            deviceId: group.devices[1],
            name: `${group.name} - Environmental Sensor`,
            type: 'sensor',
            location: zone.zoneId,
            vendor: 'SwitchBot',
            model: 'Meter Plus',
            readings: {
              temperature: zone.temperature,
              humidity: zone.humidity,
              co2: zone.co2,
              vpd: zone.vpd
            },
            status: 'online',
            lastSeen: new Date().toISOString()
          });
        });
      });
    });

    return devices;
  }

  /**
   * Generate inventory (trays) from room structure
   */
  _generateInventoryFromRooms(rooms) {
    const inventory = [];
    let trayCounter = 1;

    rooms.forEach(room => {
      room.zones.forEach(zone => {
        zone.groups.forEach(group => {
          for (let i = 0; i < group.trays; i++) {
            const trayId = `TRAY-DEMO-${String(trayCounter).padStart(3, '0')}`;
            const seedDate = this._daysAgo(group.daysOld);
            const harvestDate = this._daysFromNow(group.harvestIn);
            
            inventory.push({
              trayId,
              recipe: group.recipe,
              crop: group.crop,
              plantCount: 24,
              seedDate,
              harvestDate,
              ageDays: group.daysOld,
              status: group.harvestIn < 5 ? 'ready' : 'growing',
              health: group.health,
              location: `${room.roomId}/${zone.zoneId}/${group.groupId}`,
              zone: zone.zoneId,
              room: room.roomId
            });
            
            trayCounter++;
          }
        });
      });
    });

    return inventory;
  }

  /**
   * Generate automation rules
   */
  _generateAutomationRules() {
    return [
      {
        ruleId: 'DEMO-RULE-001',
        name: 'Daytime Lighting Schedule',
        enabled: true,
        trigger: {
          type: 'schedule',
          time: '06:00'
        },
        actions: [
          {
            type: 'light',
            target: 'all',
            intensity: 100
          }
        ]
      },
      {
        ruleId: 'DEMO-RULE-002',
        name: 'Evening Dim',
        enabled: true,
        trigger: {
          type: 'schedule',
          time: '20:00'
        },
        actions: [
          {
            type: 'light',
            target: 'all',
            intensity: 50
          }
        ]
      },
      {
        ruleId: 'DEMO-RULE-003',
        name: 'High Temperature Alert',
        enabled: true,
        trigger: {
          type: 'condition',
          metric: 'temperature',
          operator: '>',
          value: 26
        },
        actions: [
          {
            type: 'alert',
            severity: 'warning',
            message: 'Temperature exceeds threshold'
          }
        ]
      }
    ];
  }

  /**
   * Load recipe data
   */
  _loadRecipes() {
    return [
      { id: 'lettuce-buttercrunch-21d', name: 'Buttercrunch Lettuce (21 day)', crop: 'Lettuce', days: 21 },
      { id: 'basil-genovese-28d', name: 'Genovese Basil (28 day)', crop: 'Basil', days: 28 },
      { id: 'arugula-astro-14d', name: 'Astro Arugula (14 day)', crop: 'Arugula', days: 14 },
      { id: 'kale-red-russian-35d', name: 'Red Russian Kale (35 day)', crop: 'Kale', days: 35 },
      { id: 'spinach-bloomsdale-21d', name: 'Bloomsdale Spinach (21 day)', crop: 'Spinach', days: 21 }
    ];
  }

  /**
   * Select appropriate recipe for crop
   */
  _selectRecipe(crop) {
    const recipe = this.recipes.find(r => r.crop === crop);
    return recipe ? recipe.name : 'Standard Recipe';
  }

  /**
   * Generate realistic light model name
   */
  _generateLightModel() {
    const models = [
      'HLG 650R',
      'Spider Farmer SF-4000',
      'Fluence SPYDR 2p',
      'MARS HYDRO FC-E6500',
      'Grow3 ProMax 720'
    ];
    return this._randomChoice(models);
  }

  /**
   * Utility: Random value in range
   */
  _randomInRange(min, max, decimals = 0) {
    const value = Math.random() * (max - min) + min;
    return decimals > 0 ? parseFloat(value.toFixed(decimals)) : Math.floor(value);
  }

  /**
   * Utility: Random choice from array
   */
  _randomChoice(array) {
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Utility: Date N days ago
   */
  _daysAgo(days) {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Utility: Date N days from now
   */
  _daysFromNow(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  /**
   * Get summary statistics
   */
  getSummary() {
    const farm = this.generateFarm();
    
    return {
      farmId: farm.farmId,
      rooms: farm.rooms.length,
      zones: farm.rooms.reduce((sum, r) => sum + r.zones.length, 0),
      groups: farm.rooms.reduce((sum, r) => 
        sum + r.zones.reduce((zSum, z) => zSum + z.groups.length, 0), 0),
      lights: farm.devices.lights.length,
      sensors: farm.devices.sensors.length,
      trays: farm.inventory.length,
      plants: farm.inventory.reduce((sum, t) => sum + t.plantCount, 0),
      status: 'online'
    };
  }
}

export default DemoDataGenerator;
