/**
 * Hardware Capabilities Detection System
 * 
 * Detects what actuators and sensors are available per zone based on:
 * - Device discovery (device-kb.json)
 * - Zone-to-device mappings (zone-device-mappings.json)
 * - Device types and protocols
 * 
 * Enables controllers to gracefully adapt to farm-specific hardware.
 * 
 * Example capabilities:
 * - Zone 1: { fans: true, dehumidifiers: true, ventilation: false, irrigation: true }
 * - Zone 2: { fans: true, dehumidifiers: false, ventilation: false, irrigation: false }
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Device type categorization for automation
 */
const DEVICE_CATEGORIES = {
  FAN: ['fan', 'circulation_fan', 'exhaust_fan', 'intake_fan', 'mixing_fan'],
  DEHUMIDIFIER: ['dehumidifier', 'dehu', 'dehumidification'],
  VENTILATION: ['damper', 'vent', 'ventilation', 'outdoor_air', 'intake', 'exhaust'],
  IRRIGATION: ['irrigation', 'irrigator', 'watering', 'fertigation', 'valve'],
  HVAC: ['ac', 'heater', 'heat_pump', 'mini_split', 'thermostat'],
  LIGHTING: ['light', 'grow_light', 'fixture', 'lamp'],
  SENSOR_INDOOR: ['meter', 'sensor', 'temp_sensor', 'humidity_sensor', 'vpd_sensor'],
  SENSOR_OUTDOOR: ['outdoor_sensor', 'weather_station', 'outdoor_meter']
};

/**
 * Control capabilities that can be enabled/disabled
 */
const CONTROL_CAPABILITIES = {
  VPD_CONTROL: {
    requires: ['SENSOR_INDOOR'],
    recommends: ['FAN', 'DEHUMIDIFIER'],
    description: 'Zone VPD compliance control'
  },
  VENTILATION_CONTROL: {
    requires: ['SENSOR_INDOOR', 'SENSOR_OUTDOOR', 'VENTILATION'],
    recommends: [],
    description: 'Smart outdoor air ventilation'
  },
  MIXING_CONTROL: {
    requires: ['SENSOR_INDOOR', 'FAN'],
    recommends: [],
    description: 'Air mixing and stratification control'
  },
  IRRIGATION_PREEMPTION: {
    requires: ['SENSOR_INDOOR', 'IRRIGATION'],
    recommends: ['FAN', 'DEHUMIDIFIER'],
    description: 'Irrigation-aware humidity pre-emption'
  },
  ENERGY_ORCHESTRATION: {
    requires: ['SENSOR_INDOOR'],
    recommends: ['DEHUMIDIFIER', 'FAN', 'VENTILATION'],
    description: 'Energy-aware device scheduling'
  }
};

export default class HardwareCapabilities {
  constructor(options = {}) {
    const {
      dataDir = path.join(__dirname, '../data'),
      publicDataDir = path.join(__dirname, '../public/data')
    } = options;
    
    this.dataDir = dataDir;
    this.publicDataDir = publicDataDir;
    this.deviceKbPath = path.join(publicDataDir, 'device-kb.json');
    this.zoneMappingsPath = path.join(dataDir, 'zone-device-mappings.json');
    
    this.deviceKb = null; // Discovered devices
    this.zoneMappings = null; // Zone → device assignments
    this.capabilities = new Map(); // zoneId → capabilities object
  }
  
  /**
   * Load device knowledge base and zone mappings
   */
  async load() {
    // Load device-kb (discovered devices)
    try {
      const kbData = await fs.readFile(this.deviceKbPath, 'utf-8');
      this.deviceKb = JSON.parse(kbData);
    } catch (error) {
      console.warn('[hardware-capabilities] Device KB not found, using empty:', error.message);
      this.deviceKb = { devices: [] };
    }
    
    // Load zone-device mappings
    try {
      const mappingsData = await fs.readFile(this.zoneMappingsPath, 'utf-8');
      this.zoneMappings = JSON.parse(mappingsData);
    } catch (error) {
      console.warn('[hardware-capabilities] Zone mappings not found, auto-detecting:', error.message);
      this.zoneMappings = { zones: {} };
      await this._autoDetectMappings();
    }
    
    // Compute capabilities per zone
    await this._computeCapabilities();
  }
  
  /**
   * Auto-detect zone mappings based on device names and metadata
   */
  async _autoDetectMappings() {
    const zones = {};
    
    for (const device of this.deviceKb?.devices || []) {
      // Extract zone ID from device name/metadata
      const zoneId = this._extractZoneId(device);
      
      if (!zoneId) continue;
      
      if (!zones[zoneId]) {
        zones[zoneId] = {
          name: zoneId,
          devices: []
        };
      }
      
      zones[zoneId].devices.push({
        deviceId: device.deviceId || device.id,
        name: device.name,
        type: device.type || device.deviceType,
        category: this._categorizeDevice(device),
        shared: false // Default to dedicated
      });
    }
    
    this.zoneMappings = { zones };
    await this._saveMappings();
  }
  
  /**
   * Extract zone ID from device name/metadata
   * Examples: "Grow Room 1, West Fan" → "zone-1"
   *          "Zone 3 Fan" → "zone-3"
   */
  _extractZoneId(device) {
    const name = (device.name || device.deviceName || '').toLowerCase();
    
    // Pattern 1: "Grow Room X"
    const growRoomMatch = name.match(/grow\s*room\s*(\d+)/);
    if (growRoomMatch) return `zone-${growRoomMatch[1]}`;
    
    // Pattern 2: "Zone X"
    const zoneMatch = name.match(/zone\s*(\d+)/);
    if (zoneMatch) return `zone-${zoneMatch[1]}`;
    
    // Pattern 3: "Tower X" or "Tw X"
    const towerMatch = name.match(/(?:tower|tw)\s*(\d+)/);
    if (towerMatch) return `zone-${towerMatch[1]}`;
    
    // Pattern 4: Use zone metadata if present
    if (device.zone) return device.zone;
    if (device.zoneId) return device.zoneId;
    
    return null;
  }
  
  /**
   * Categorize device into automation categories
   */
  _categorizeDevice(device) {
    const type = (device.type || device.deviceType || '').toLowerCase();
    const name = (device.name || device.deviceName || '').toLowerCase();
    const combined = `${type} ${name}`;
    
    for (const [category, keywords] of Object.entries(DEVICE_CATEGORIES)) {
      for (const keyword of keywords) {
        if (combined.includes(keyword)) {
          return category;
        }
      }
    }
    
    return 'UNKNOWN';
  }
  
  /**
   * Compute capabilities per zone
   */
  async _computeCapabilities() {
    this.capabilities.clear();
    
    for (const [zoneId, zoneConfig] of Object.entries(this.zoneMappings?.zones || {})) {
      const zoneCaps = {
        zoneId,
        name: zoneConfig.name || zoneId,
        devices: {
          fans: [],
          dehumidifiers: [],
          ventilation: [],
          irrigation: [],
          hvac: [],
          lighting: [],
          sensorsIndoor: [],
          sensorsOutdoor: []
        },
        capabilities: {
          vpdControl: false,
          ventilationControl: false,
          mixingControl: false,
          irrigationPreemption: false,
          energyOrchestration: false
        },
        warnings: [],
        recommendations: []
      };
      
      // Categorize devices
      for (const deviceMapping of zoneConfig.devices || []) {
        const category = deviceMapping.category || this._categorizeDevice(deviceMapping);
        
        switch (category) {
          case 'FAN':
            zoneCaps.devices.fans.push(deviceMapping);
            break;
          case 'DEHUMIDIFIER':
            zoneCaps.devices.dehumidifiers.push(deviceMapping);
            break;
          case 'VENTILATION':
            zoneCaps.devices.ventilation.push(deviceMapping);
            break;
          case 'IRRIGATION':
            zoneCaps.devices.irrigation.push(deviceMapping);
            break;
          case 'HVAC':
            zoneCaps.devices.hvac.push(deviceMapping);
            break;
          case 'LIGHTING':
            zoneCaps.devices.lighting.push(deviceMapping);
            break;
          case 'SENSOR_INDOOR':
            zoneCaps.devices.sensorsIndoor.push(deviceMapping);
            break;
          case 'SENSOR_OUTDOOR':
            zoneCaps.devices.sensorsOutdoor.push(deviceMapping);
            break;
        }
      }
      
      // Determine which control capabilities are available
      zoneCaps.capabilities = this._evaluateControlCapabilities(zoneCaps.devices);
      
      // Generate warnings and recommendations
      this._generateWarningsAndRecommendations(zoneCaps);
      
      this.capabilities.set(zoneId, zoneCaps);
    }
  }
  
  /**
   * Evaluate which control capabilities are available based on devices
   */
  _evaluateControlCapabilities(devices) {
    const caps = {};
    
    for (const [capName, capDef] of Object.entries(CONTROL_CAPABILITIES)) {
      const hasRequired = capDef.requires.every(req => {
        const categoryKey = req.toLowerCase().replace(/_/g, '');
        return devices[categoryKey]?.length > 0;
      });
      
      const hasRecommended = capDef.recommends.every(rec => {
        const categoryKey = rec.toLowerCase().replace(/_/g, '');
        return devices[categoryKey]?.length > 0;
      });
      
      // Convert to camelCase key
      const capKey = capName.toLowerCase().replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      caps[capKey] = hasRequired;
      
      // Add metadata
      caps[`${capKey}Recommended`] = hasRecommended;
    }
    
    return caps;
  }
  
  /**
   * Generate warnings and recommendations for missing capabilities
   */
  _generateWarningsAndRecommendations(zoneCaps) {
    const { devices, capabilities } = zoneCaps;
    
    // VPD control warnings
    if (capabilities.vpdControl) {
      if (devices.fans.length === 0 && devices.dehumidifiers.length === 0) {
        zoneCaps.warnings.push(
          'VPD control enabled but no fans or dehumidifiers available - control will be limited'
        );
        zoneCaps.recommendations.push(
          'Add circulation fans and/or dehumidifiers for effective VPD control'
        );
      } else if (devices.fans.length === 0) {
        zoneCaps.recommendations.push(
          'Add circulation fans to improve VPD control (air mixing eliminates microclimates)'
        );
      } else if (devices.dehumidifiers.length === 0) {
        zoneCaps.recommendations.push(
          'Add dehumidifiers for latent heat removal (fans alone cannot reduce humidity)'
        );
      }
    }
    
    // Ventilation control warnings
    if (devices.sensorsIndoor.length > 0 && devices.sensorsOutdoor.length === 0) {
      zoneCaps.recommendations.push(
        'Configure outdoor weather source to enable smart ventilation (free dehumidification when outdoor air is dry)'
      );
    }
    
    if (devices.sensorsOutdoor.length > 0 && devices.ventilation.length === 0) {
      zoneCaps.warnings.push(
        'Outdoor weather data available but no ventilation actuators - cannot utilize outdoor air'
      );
      zoneCaps.recommendations.push(
        'Add dampers or ventilation fans to enable free cooling/dehumidification'
      );
    }
    
    // Sensor warnings
    if (devices.sensorsIndoor.length === 0) {
      zoneCaps.warnings.push(
        'No indoor sensors detected - automation cannot control without environmental feedback'
      );
    }
    
    // HVAC notice
    if (devices.hvac.length > 0) {
      zoneCaps.warnings.push(
        'HVAC devices detected but not under automation control (setpoints assumed fixed)'
      );
    }
  }
  
  /**
   * Get capabilities for a specific zone
   */
  getZoneCapabilities(zoneId) {
    return this.capabilities.get(zoneId) || this._getDefaultCapabilities(zoneId);
  }
  
  /**
   * Get default capabilities (all disabled) for unknown zones
   */
  _getDefaultCapabilities(zoneId) {
    return {
      zoneId,
      name: zoneId,
      devices: {
        fans: [],
        dehumidifiers: [],
        ventilation: [],
        irrigation: [],
        hvac: [],
        lighting: [],
        sensorsIndoor: [],
        sensorsOutdoor: []
      },
      capabilities: {
        vpdControl: false,
        ventilationControl: false,
        mixingControl: false,
        irrigationPreemption: false,
        energyOrchestration: false
      },
      warnings: ['Zone not configured - no devices mapped'],
      recommendations: ['Use zone mapping wizard to assign devices to this zone']
    };
  }
  
  /**
   * Get all zones with their capabilities
   */
  getAllZoneCapabilities() {
    return Array.from(this.capabilities.values());
  }
  
  /**
   * Check if a specific control capability is available for a zone
   */
  hasCapability(zoneId, capabilityName) {
    const zoneCaps = this.getZoneCapabilities(zoneId);
    return zoneCaps.capabilities[capabilityName] === true;
  }
  
  /**
   * Get devices of a specific type for a zone
   */
  getZoneDevices(zoneId, deviceType) {
    const zoneCaps = this.getZoneCapabilities(zoneId);
    return zoneCaps.devices[deviceType] || [];
  }
  
  /**
   * Get all active control capabilities across all zones
   */
  getActiveCapabilities() {
    const active = {
      vpdControl: [],
      ventilationControl: [],
      mixingControl: [],
      irrigationPreemption: [],
      energyOrchestration: []
    };
    
    for (const zoneCaps of this.capabilities.values()) {
      for (const [capName, enabled] of Object.entries(zoneCaps.capabilities)) {
        if (enabled && active[capName]) {
          active[capName].push(zoneCaps.zoneId);
        }
      }
    }
    
    return active;
  }
  
  /**
   * Assign a device to a zone
   */
  async assignDevice(zoneId, deviceId, options = {}) {
    const { type, category, shared = false } = options;
    
    if (!this.zoneMappings.zones[zoneId]) {
      this.zoneMappings.zones[zoneId] = {
        name: zoneId,
        devices: []
      };
    }
    
    // Find device in KB
    const device = this.deviceKb?.devices?.find(d => 
      d.deviceId === deviceId || d.id === deviceId
    );
    
    if (!device) {
      throw new Error(`Device ${deviceId} not found in device knowledge base`);
    }
    
    this.zoneMappings.zones[zoneId].devices.push({
      deviceId,
      name: device.name || device.deviceName,
      type: type || device.type || device.deviceType,
      category: category || this._categorizeDevice(device),
      shared
    });
    
    await this._saveMappings();
    await this._computeCapabilities();
    
    return this.getZoneCapabilities(zoneId);
  }
  
  /**
   * Unassign a device from a zone
   */
  async unassignDevice(zoneId, deviceId) {
    if (!this.zoneMappings.zones[zoneId]) {
      throw new Error(`Zone ${zoneId} not found`);
    }
    
    const zone = this.zoneMappings.zones[zoneId];
    zone.devices = zone.devices.filter(d => d.deviceId !== deviceId);
    
    await this._saveMappings();
    await this._computeCapabilities();
    
    return this.getZoneCapabilities(zoneId);
  }
  
  /**
   * Save zone mappings to disk
   */
  async _saveMappings() {
    try {
      await fs.writeFile(
        this.zoneMappingsPath,
        JSON.stringify(this.zoneMappings, null, 2),
        'utf-8'
      );
    } catch (error) {
      console.error('[hardware-capabilities] Failed to save mappings:', error.message);
    }
  }
  
  /**
   * Get farm-wide capability summary
   */
  getFarmSummary() {
    const summary = {
      totalZones: this.capabilities.size,
      capabilities: {
        vpdControl: 0,
        ventilationControl: 0,
        mixingControl: 0,
        irrigationPreemption: 0,
        energyOrchestration: 0
      },
      devices: {
        fans: 0,
        dehumidifiers: 0,
        ventilation: 0,
        irrigation: 0,
        sensorsIndoor: 0,
        sensorsOutdoor: 0
      },
      warnings: [],
      recommendations: []
    };
    
    for (const zoneCaps of this.capabilities.values()) {
      // Count enabled capabilities
      for (const [capName, enabled] of Object.entries(zoneCaps.capabilities)) {
        if (enabled && typeof summary.capabilities[capName] === 'number') {
          summary.capabilities[capName]++;
        }
      }
      
      // Count devices
      for (const [deviceType, devices] of Object.entries(zoneCaps.devices)) {
        if (typeof summary.devices[deviceType] === 'number') {
          summary.devices[deviceType] += devices.length;
        }
      }
      
      // Collect unique warnings/recommendations
      for (const warning of zoneCaps.warnings) {
        if (!summary.warnings.includes(warning)) {
          summary.warnings.push(warning);
        }
      }
      for (const rec of zoneCaps.recommendations) {
        if (!summary.recommendations.includes(rec)) {
          summary.recommendations.push(rec);
        }
      }
    }
    
    return summary;
  }
}
