/**
 * Controller Orchestrator
 * 
 * Dynamically activates automation controllers based on detected hardware capabilities.
 * Each farm gets a custom control system based on what equipment is actually available.
 * 
 * Philosophy:
 * - No hardcoded assumptions about what devices exist
 * - Controllers gracefully degrade if devices are missing
 * - Informative warnings when capabilities are limited
 * - Recommendations for hardware additions to unlock features
 * 
 * Example:
 * - Farm with only fans → VPD control (mixing only, no dehumidification)
 * - Farm with fans + dehus → Full VPD control
 * - Farm with fans + dehus + outdoor sensors → VPD control + smart ventilation
 */

import VpdController from './controllers/vpd-controller.js';
import VentilationController from './controllers/ventilation-controller.js';
import MixingController from './controllers/mixing-controller.js';
import IrrigationController from './controllers/irrigation-controller.js';
import HardwareCapabilities from './hardware-capabilities.js';
import GrowthStageManager from './growth-stage-manager.js';

export default class ControllerOrchestrator {
  constructor(options = {}) {
    const {
      dataDir,
      publicDataDir,
      logger = console
    } = options;
    
    // Logger compatibility shim (supports console-like or AutomationLogger)
    const baseLogger = logger || console;
    if (typeof baseLogger.info !== 'function') {
      baseLogger.info = (...args) => {
        if (typeof baseLogger.log === 'function') {
          baseLogger.log({ level: 'info', message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') });
        } else {
          console.log(...args);
        }
      };
    }
    if (typeof baseLogger.warn !== 'function') {
      baseLogger.warn = (...args) => {
        if (typeof baseLogger.log === 'function') {
          baseLogger.log({ level: 'warn', message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') });
        } else {
          console.warn(...args);
        }
      };
    }
    if (typeof baseLogger.error !== 'function') {
      baseLogger.error = (...args) => {
        if (typeof baseLogger.log === 'function') {
          baseLogger.log({ level: 'error', message: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ') });
        } else {
          console.error(...args);
        }
      };
    }
    this.logger = baseLogger;
    
    // Core systems
    this.hardwareCaps = new HardwareCapabilities({ dataDir, publicDataDir });
    this.stageManager = new GrowthStageManager({ dataDir });
    
    // Controllers (instantiated only when needed)
    this.vpdController = null;
    this.ventilationController = null;
    this.mixingController = null;
    this.irrigationController = null;
    
    // Control state
    this.activeControllers = new Set();
    this.controlResults = new Map(); // zoneId → latest control results
    this.controlErrors = new Map(); // zoneId → error history
  }
  
  /**
   * Initialize orchestrator and load configurations
   */
  async initialize() {
    this.logger.info('[orchestrator] Initializing controller orchestrator...');
    
    // Load hardware capabilities
    await this.hardwareCaps.load();
    
    // Load growth stage configurations
    await this.stageManager.load();
    
    // Instantiate controllers based on farm-wide capabilities
    await this._instantiateControllers();
    
    // Log farm summary
    const summary = this.hardwareCaps.getFarmSummary();
    this.logger.info('[orchestrator] Farm summary:', {
      zones: summary.totalZones,
      capabilities: summary.capabilities,
      activeControllers: Array.from(this.activeControllers)
    });
    
    if (summary.warnings.length > 0) {
      this.logger.warn('[orchestrator] Hardware warnings:', summary.warnings);
    }
    
    if (summary.recommendations.length > 0) {
      this.logger.info('[orchestrator] Recommendations:', summary.recommendations);
    }
    
    return summary;
  }
  
  /**
   * Instantiate controllers based on farm-wide capabilities
   */
  async _instantiateControllers() {
    const activeCaps = this.hardwareCaps.getActiveCapabilities();
    
    // VPD Controller (if any zone has indoor sensors)
    if (activeCaps.vpdControl.length > 0) {
      this.vpdController = new VpdController({ logger: this.logger });
      this.activeControllers.add('vpd');
      this.logger.info(`[orchestrator] VPD controller enabled for ${activeCaps.vpdControl.length} zones`);
    } else {
      this.logger.warn('[orchestrator] VPD controller disabled - no zones with indoor sensors');
    }
    
    // Ventilation Controller (if any zone has outdoor sensors + ventilation)
    if (activeCaps.ventilationControl.length > 0) {
      this.ventilationController = new VentilationController({ logger: this.logger });
      this.activeControllers.add('ventilation');
      this.logger.info(`[orchestrator] Ventilation controller enabled for ${activeCaps.ventilationControl.length} zones`);
    } else {
      this.logger.info('[orchestrator] Ventilation controller disabled - add outdoor sensors and dampers to enable');
    }
    
    // Mixing Controller (if any zone has fans)
    if (activeCaps.mixingControl.length > 0) {
      this.mixingController = new MixingController({ logger: this.logger });
      this.activeControllers.add('mixing');
      this.logger.info(`[orchestrator] Mixing controller enabled for ${activeCaps.mixingControl.length} zones`);
    } else {
      this.logger.info('[orchestrator] Mixing controller disabled - add circulation fans to enable');
    }
    
    // Irrigation Controller (if any zone has irrigation)
    if (activeCaps.irrigationPreemption.length > 0) {
      this.irrigationController = new IrrigationController({ logger: this.logger });
      this.activeControllers.add('irrigation');
      this.logger.info(`[orchestrator] Irrigation controller enabled for ${activeCaps.irrigationPreemption.length} zones`);
    } else {
      this.logger.info('[orchestrator] Irrigation controller disabled - add irrigation sensors to enable');
    }
  }
  
  /**
   * Execute control loop for all zones
   * @param {Object} envSnapshot - Current environmental snapshot from EnvStore
   * @param {Object} deviceStates - Current device states from PlugManager
   * @returns {Object} Control results per zone
   */
  async tick(envSnapshot, deviceStates) {
    const results = {
      timestamp: new Date().toISOString(),
      zones: {},
      summary: {
        controlledZones: 0,
        skippedZones: 0,
        errors: 0,
        warnings: []
      }
    };
    
    // Execute control for each zone
  const allZones = this.hardwareCaps.getAllZoneCapabilities();
    
    for (const zoneCaps of allZones) {
      const zoneId = zoneCaps.zoneId;
      
      try {
        const zoneResult = await this._controlZone(zoneId, zoneCaps, envSnapshot, deviceStates);
        results.zones[zoneId] = zoneResult;
        
        if (zoneResult.controlled) {
          results.summary.controlledZones++;
        } else {
          results.summary.skippedZones++;
        }
        
        if (zoneResult.warnings?.length > 0) {
          results.summary.warnings.push(...zoneResult.warnings);
        }
        
        // Update control results cache
        this.controlResults.set(zoneId, zoneResult);
        
      } catch (error) {
        this.logger.error(`[orchestrator] Error controlling zone ${zoneId}:`, error);
        results.zones[zoneId] = {
          controlled: false,
          error: error.message,
          timestamp: new Date().toISOString()
        };
        results.summary.errors++;
        
        // Track error history
        if (!this.controlErrors.has(zoneId)) {
          this.controlErrors.set(zoneId, []);
        }
        this.controlErrors.get(zoneId).push({
          timestamp: new Date().toISOString(),
          error: error.message
        });
      }
    }
    
    return results;
  }
  
  /**
   * Execute control for a single zone
   */
  async _controlZone(zoneId, zoneCaps, envSnapshot, deviceStates) {
    // EnvStore snapshot is { scopes, targets, rooms, ... }
    const zoneEnv = envSnapshot?.scopes?.[zoneId];
    
    // Check if we have sensor data
    if (!zoneEnv?.sensors) {
      return {
        controlled: false,
        reason: 'No sensor data available',
        warnings: ['Zone has no recent sensor readings']
      };
    }
    
    const result = {
      controlled: false,
      zoneId,
      timestamp: new Date().toISOString(),
      capabilities: zoneCaps.capabilities,
      controllers: {},
      actions: [],
      warnings: [],
      recommendations: []
    };
    
    // Get current sensor reading
    const sensors = zoneEnv.sensors || {};
    const tempCValue = (sensors.tempC?.value != null) ? sensors.tempC.value : sensors.temp?.value;
    const rhValue = sensors.rh?.value;
    const sensorReading = {
      tempC: tempCValue,
      rhPct: rhValue,
      timestamp: zoneEnv.sensorsUpdatedAt || zoneEnv.updatedAt
    };
    
    if (sensorReading.tempC == null || sensorReading.rhPct == null) {
      result.warnings.push('Incomplete sensor data - missing temperature or humidity');
      return result;
    }
    
    // Execute VPD control if available
    if (zoneCaps.capabilities.vpdControl && this.vpdController) {
      const vpdResult = await this._executeVpdControl(zoneId, zoneCaps, sensorReading, deviceStates);
      result.controllers.vpd = vpdResult;
      result.actions.push(...vpdResult.actions);
      result.controlled = true;
    } else if (!zoneCaps.capabilities.vpdControl) {
      result.warnings.push('VPD control disabled - missing indoor sensors');
    }
    
    // Execute ventilation control if available
    if (zoneCaps.capabilities.ventilationControl && this.ventilationController) {
      const ventResult = await this._executeVentilationControl(zoneId, zoneCaps, sensorReading, envSnapshot, deviceStates);
      result.controllers.ventilation = ventResult;
      result.actions.push(...ventResult.actions);
    }
    
    // Execute mixing control if available
    if (zoneCaps.capabilities.mixingControl && this.mixingController) {
      const mixResult = await this._executeMixingControl(zoneId, zoneCaps, sensorReading, deviceStates);
      result.controllers.mixing = mixResult;
      result.actions.push(...mixResult.actions);
    }
    
    // Execute irrigation pre-emption if available
    if (zoneCaps.capabilities.irrigationPreemption && this.irrigationController) {
      const irrResult = await this._executeIrrigationControl(zoneId, zoneCaps, deviceStates);
      result.controllers.irrigation = irrResult;
      result.actions.push(...irrResult.actions);
    }
    
    // Add zone-specific warnings and recommendations
    result.warnings.push(...zoneCaps.warnings);
    result.recommendations.push(...zoneCaps.recommendations);
    
    return result;
  }
  
  /**
   * Execute VPD control for a zone
   */
  async _executeVpdControl(zoneId, zoneCaps, sensorReading, deviceStates) {
    // Get VPD band from growth stage
    const vpdBand = this.stageManager.getVpdBand(zoneId);
    
    // Get available devices for this zone
    const devices = {
      fans: zoneCaps.devices.fans || [],
      dehumidifiers: zoneCaps.devices.dehumidifiers || []
    };
    
    // Execute VPD control
    const vpdResult = await this.vpdController.control(
      zoneId,
      sensorReading,
      vpdBand,
      devices,
      deviceStates
    );
    
    // Add capability-specific warnings
    if (devices.fans.length === 0 && devices.dehumidifiers.length === 0) {
      vpdResult.warnings = vpdResult.warnings || [];
      vpdResult.warnings.push('VPD control limited - no fans or dehumidifiers available');
      vpdResult.recommendations = vpdResult.recommendations || [];
      vpdResult.recommendations.push('Add fans and/or dehumidifiers to this zone for active VPD control');
    } else if (devices.fans.length === 0) {
      vpdResult.warnings = vpdResult.warnings || [];
      vpdResult.warnings.push('No fans available - VPD control via dehumidification only');
      vpdResult.recommendations = vpdResult.recommendations || [];
      vpdResult.recommendations.push('Add circulation fans to improve air mixing and VPD uniformity');
    } else if (devices.dehumidifiers.length === 0) {
      vpdResult.warnings = vpdResult.warnings || [];
      vpdResult.warnings.push('No dehumidifiers available - VPD control via mixing only (cannot remove moisture)');
      vpdResult.recommendations = vpdResult.recommendations || [];
      vpdResult.recommendations.push('Add dehumidifiers to enable active humidity reduction');
    }
    
    return vpdResult;
  }
  
    /**
     * Execute ventilation control for a zone
     */
    async _executeVentilationControl(zoneId, zoneCaps, sensorReading, envSnapshot, deviceStates) {
      // Derive outdoor sensor reading from EnvStore snapshot when available
      let outdoorReading = null;
      try {
        const scopes = envSnapshot?.scopes || {};
        // Heuristics: prefer a dedicated 'outdoor' scope if present
        const outdoorScope = scopes['outdoor'] || scopes['outdoor_weather'] || scopes['weather'] || null;
        if (outdoorScope?.sensors) {
          const oTemp = outdoorScope.sensors.tempC?.value ?? outdoorScope.sensors.temp?.value;
          const oRh = outdoorScope.sensors.rh?.value;
          if (oTemp != null && oRh != null) {
            outdoorReading = { tempC: oTemp, rhPct: oRh, timestamp: outdoorScope.updatedAt };
          }
        }
        // If zone has mapped outdoor sensors, try a per-zone alias like `${zoneId}-outdoor`
        if (!outdoorReading && zoneCaps?.devices?.sensorsOutdoor?.length) {
          const candidateScopeId = `${zoneId}-outdoor`;
          const zOut = scopes[candidateScopeId];
          if (zOut?.sensors) {
            const oTemp = zOut.sensors.tempC?.value ?? zOut.sensors.temp?.value;
            const oRh = zOut.sensors.rh?.value;
            if (oTemp != null && oRh != null) {
              outdoorReading = { tempC: oTemp, rhPct: oRh, timestamp: zOut.updatedAt };
            }
          }
        }
      } catch (e) {
        this.logger.warn(`[orchestrator] Outdoor reading lookup failed for ${zoneId}:`, e?.message || e);
      }
    
      // Get VPD band from growth stage
  const vpdBand = this.stageManager.getVpdBand(zoneId);
    
      // Get available devices
      const devices = {
        dampers: zoneCaps.devices.ventilation || [],
        fans: zoneCaps.devices.fans || [],
        dehumidifiers: zoneCaps.devices.dehumidifiers || []
      };
    
      // Execute ventilation control
      const ventResult = await this.ventilationController.control(
        zoneId,
        sensorReading,
        outdoorReading,
        vpdBand,
        devices,
        deviceStates
      );
    
      return ventResult;
    }
  
    /**
     * Execute mixing control for a zone
     */
    async _executeMixingControl(zoneId, zoneCaps, sensorReading, deviceStates) {
      // Get all sensor readings for this zone (for variance calculation)
      // For now, use single reading (TODO: collect multiple sensors per zone)
      const sensorReadings = [
        {
          ...sensorReading,
          sensorId: 'primary'
        }
      ];
    
      // Get available devices
      const devices = {
        fans: zoneCaps.devices.fans || []
      };
    
      // Check if VPD control is active
      const vpdControlActive = this.activeControllers.has('vpd') && this.vpdController !== null;
    
      // Execute mixing control
      const mixResult = await this.mixingController.control(
        zoneId,
        sensorReadings,
        devices,
        deviceStates,
        vpdControlActive
      );
    
      return mixResult;
    }
  
    /**
     * Execute irrigation control for a zone
     */
    async _executeIrrigationControl(zoneId, zoneCaps, deviceStates) {
      // Get available devices
      const devices = {
        fans: zoneCaps.devices.fans || [],
        dehumidifiers: zoneCaps.devices.dehumidifiers || []
      };
    
      // Execute irrigation control (no baseline control for now)
      const irrResult = await this.irrigationController.control(
        zoneId,
        devices,
        deviceStates,
        null // baselineControl
      );
    
      return irrResult;
    }
  
  /**
   * Get latest control results for a zone
   */
  getZoneControlResult(zoneId) {
    return this.controlResults.get(zoneId) || null;
  }
  
  /**
   * Get all zone control results
   */
  getAllControlResults() {
    return Array.from(this.controlResults.entries()).map(([zoneId, result]) => ({
      zoneId,
      ...result
    }));
  }
  
  /**
   * Get error history for a zone
   */
  getZoneErrors(zoneId) {
    return this.controlErrors.get(zoneId) || [];
  }
  
  /**
   * Get zone capabilities (passthrough to HardwareCapabilities)
   */
  getZoneCapabilities(zoneId) {
    return this.hardwareCaps.getZoneCapabilities(zoneId);
  }
  
  /**
   * Get all zone capabilities
   */
  getAllZoneCapabilities() {
    return this.hardwareCaps.getAllZoneCapabilities();
  }
  
  /**
   * Assign a device to a zone (passthrough to HardwareCapabilities)
   */
  async assignDevice(zoneId, deviceId, options) {
    const result = await this.hardwareCaps.assignDevice(zoneId, deviceId, options);
    
    // Re-instantiate controllers if capabilities changed
    await this._instantiateControllers();
    
    return result;
  }
  
  /**
   * Unassign a device from a zone (passthrough to HardwareCapabilities)
   */
  async unassignDevice(zoneId, deviceId) {
    const result = await this.hardwareCaps.unassignDevice(zoneId, deviceId);
    
    // Re-instantiate controllers if capabilities changed
    await this._instantiateControllers();
    
    return result;
  }
  
  /**
   * Get farm-wide summary
   */
  getFarmSummary() {
    const hwSummary = this.hardwareCaps.getFarmSummary();
    const controlSummary = {
      activeControllers: Array.from(this.activeControllers),
      totalZones: this.controlResults.size,
      zonesWithErrors: this.controlErrors.size,
      lastTickTimestamp: null
    };
    
    // Find most recent control timestamp
    for (const result of this.controlResults.values()) {
      if (!controlSummary.lastTickTimestamp || result.timestamp > controlSummary.lastTickTimestamp) {
        controlSummary.lastTickTimestamp = result.timestamp;
      }
    }
    
    return {
      hardware: hwSummary,
      control: controlSummary
    };
  }
  
  /**
   * Reload configurations (useful after wizard changes)
   */
  async reload() {
    this.logger.info('[orchestrator] Reloading configurations...');
    await this.hardwareCaps.load();
    await this.stageManager.load();
    await this._instantiateControllers();
    this.logger.info('[orchestrator] Reload complete');
  }
  
  /**
   * Get orchestrator status
   */
  getStatus() {
    return {
      initialized: this.activeControllers.size > 0,
      activeControllers: Array.from(this.activeControllers),
      zones: {
        total: this.hardwareCaps.capabilities.size,
        controlled: this.controlResults.size,
        withErrors: this.controlErrors.size
      },
      controllers: {
        vpd: this.vpdController ? 'active' : 'inactive',
        ventilation: this.ventilationController ? 'active' : 'inactive',
        mixing: this.mixingController ? 'active' : 'inactive',
        irrigation: this.irrigationController ? 'active' : 'inactive'
      }
    };
  }
}
