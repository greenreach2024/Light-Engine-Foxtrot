/**
 * Growth Stage Manager
 * 
 * Manages VPD bands and environmental setpoints per zone based on crop growth stage.
 * Handles stage transitions with gradual ramping to avoid plant stress.
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default class GrowthStageManager {
  constructor(options = {}) {
    const {
      dataDir = path.join(__dirname, '../data'),
      configPath = path.join(__dirname, '../config/growth-stages.json')
    } = options;
    
    this.dataDir = dataDir;
    this.configPath = configPath;
    this.stageConfig = null;
    this.zoneAssignments = new Map(); // zoneId -> { stage, cultivar, startDate, transitionTarget }
    this.assignmentsPath = path.join(dataDir, 'zone-growth-stages.json');
  }
  
  /**
   * Load growth stage configuration
   */
  async load() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf-8');
      this.stageConfig = JSON.parse(configData);
    } catch (error) {
      console.error('[growth-stage-manager] Failed to load config:', error.message);
      this.stageConfig = this._getDefaultConfig();
    }
    
    // Load zone assignments
    try {
      const assignData = await fs.readFile(this.assignmentsPath, 'utf-8');
      const assignments = JSON.parse(assignData);
      this.zoneAssignments = new Map(Object.entries(assignments));
    } catch (error) {
      // File doesn't exist yet or is invalid - start fresh
      this.zoneAssignments = new Map();
    }
  }
  
  /**
   * Get default config if file loading fails
   */
  _getDefaultConfig() {
    return {
      stages: {
        propagation: { vpd: { min: 0.4, max: 0.8, target: 0.6 } },
        vegetative: { vpd: { min: 0.6, max: 1.0, target: 0.8 } },
        finishing: { vpd: { min: 0.8, max: 1.2, target: 1.0 } }
      },
      transitions: { rampDurationHours: 6, stepIntervalMinutes: 30 },
      safeLimits: {
        temperature: { absoluteMin: 14, absoluteMax: 26 },
        humidity: { absoluteMin: 45, absoluteMax: 95 },
        vpd: { absoluteMin: 0.3, absoluteMax: 1.5 }
      }
    };
  }
  
  /**
   * Assign a growth stage to a zone
   * @param {string} zoneId - Zone identifier
   * @param {string} stage - Growth stage (propagation, vegetative, finishing)
   * @param {Object} options - Additional options
   * @param {string} options.cultivar - Cultivar name for adjustments
   * @param {Date|string} options.startDate - When this stage started
   */
  async assignStage(zoneId, stage, options = {}) {
    const { cultivar = null, startDate = new Date() } = options;
    
    if (!this.stageConfig?.stages?.[stage]) {
      throw new Error(`Unknown growth stage: ${stage}`);
    }
    
    const existing = this.zoneAssignments.get(zoneId);
    const assignment = {
      stage,
      cultivar,
      startDate: typeof startDate === 'string' ? startDate : startDate.toISOString(),
      previousStage: existing?.stage || null,
      transitionTarget: null // Set during transition
    };
    
    this.zoneAssignments.set(zoneId, assignment);
    await this._saveAssignments();
    
    return assignment;
  }
  
  /**
   * Initiate a stage transition with gradual ramping
   * @param {string} zoneId - Zone identifier
   * @param {string} targetStage - Target growth stage
   */
  async transitionStage(zoneId, targetStage) {
    const current = this.zoneAssignments.get(zoneId);
    
    if (!current) {
      // No current assignment - just assign directly
      return this.assignStage(zoneId, targetStage);
    }
    
    if (current.stage === targetStage) {
      console.warn(`[growth-stage-manager] Zone ${zoneId} already in ${targetStage}`);
      return current;
    }
    
    // Mark transition in progress
    current.transitionTarget = {
      stage: targetStage,
      startedAt: new Date().toISOString(),
      durationHours: this.stageConfig.transitions?.rampDurationHours || 6
    };
    
    this.zoneAssignments.set(zoneId, current);
    await this._saveAssignments();
    
    return current;
  }
  
  /**
   * Get VPD band for a zone (handles transitions)
   * @param {string} zoneId - Zone identifier
   * @returns {Object} VPD band with min, max, target
   */
  getVpdBand(zoneId) {
    const assignment = this.zoneAssignments.get(zoneId);
    
    if (!assignment) {
      // No assignment - use conservative defaults (vegetative)
      return { min: 0.6, max: 1.0, target: 0.8, unit: 'kPa', stage: 'vegetative (default)' };
    }
    
    const currentStage = this.stageConfig.stages[assignment.stage];
    
    if (!assignment.transitionTarget) {
      // No transition - return current stage VPD
      return {
        ...currentStage.vpd,
        stage: assignment.stage,
        cultivar: assignment.cultivar
      };
    }
    
    // Transition in progress - interpolate between current and target
    const targetStage = this.stageConfig.stages[assignment.transitionTarget.stage];
    const progress = this._getTransitionProgress(assignment.transitionTarget);
    
    return {
      min: this._interpolate(currentStage.vpd.min, targetStage.vpd.min, progress),
      max: this._interpolate(currentStage.vpd.max, targetStage.vpd.max, progress),
      target: this._interpolate(currentStage.vpd.target, targetStage.vpd.target, progress),
      unit: 'kPa',
      stage: `${assignment.stage} → ${assignment.transitionTarget.stage}`,
      transitionProgress: Math.round(progress * 100) + '%',
      cultivar: assignment.cultivar
    };
  }
  
  /**
   * Get temperature setpoints for a zone
   */
  getTemperatureSetpoints(zoneId) {
    const assignment = this.zoneAssignments.get(zoneId);
    
    if (!assignment) {
      return { min: 18, max: 24, target: 21, unit: '°C', stage: 'vegetative (default)' };
    }
    
    const currentStage = this.stageConfig.stages[assignment.stage];
    
    if (!assignment.transitionTarget) {
      return {
        ...currentStage.temperature,
        stage: assignment.stage
      };
    }
    
    const targetStage = this.stageConfig.stages[assignment.transitionTarget.stage];
    const progress = this._getTransitionProgress(assignment.transitionTarget);
    
    return {
      min: this._interpolate(currentStage.temperature.min, targetStage.temperature.min, progress),
      max: this._interpolate(currentStage.temperature.max, targetStage.temperature.max, progress),
      target: this._interpolate(currentStage.temperature.target, targetStage.temperature.target, progress),
      unit: '°C',
      stage: `${assignment.stage} → ${assignment.transitionTarget.stage}`,
      transitionProgress: Math.round(progress * 100) + '%'
    };
  }
  
  /**
   * Get humidity setpoints for a zone
   */
  getHumiditySetpoints(zoneId) {
    const assignment = this.zoneAssignments.get(zoneId);
    
    if (!assignment) {
      return { min: 60, max: 75, target: 68, unit: '%', stage: 'vegetative (default)' };
    }
    
    const currentStage = this.stageConfig.stages[assignment.stage];
    
    if (!assignment.transitionTarget) {
      return {
        ...currentStage.humidity,
        stage: assignment.stage
      };
    }
    
    const targetStage = this.stageConfig.stages[assignment.transitionTarget.stage];
    const progress = this._getTransitionProgress(assignment.transitionTarget);
    
    return {
      min: this._interpolate(currentStage.humidity.min, targetStage.humidity.min, progress),
      max: this._interpolate(currentStage.humidity.max, targetStage.humidity.max, progress),
      target: this._interpolate(currentStage.humidity.target, targetStage.humidity.target, progress),
      unit: '%',
      stage: `${assignment.stage} → ${assignment.transitionTarget.stage}`,
      transitionProgress: Math.round(progress * 100) + '%'
    };
  }
  
  /**
   * Get safe limits (absolute bounds)
   */
  getSafeLimits() {
    return this.stageConfig?.safeLimits || this._getDefaultConfig().safeLimits;
  }
  
  /**
   * Check if zone is within safe limits
   */
  isWithinSafeLimits(zoneId, reading) {
    const limits = this.getSafeLimits();
    const violations = [];
    
    if (reading.tempC != null) {
      if (reading.tempC < limits.temperature.absoluteMin) {
        violations.push(`Temperature ${reading.tempC}°C below minimum ${limits.temperature.absoluteMin}°C`);
      }
      if (reading.tempC > limits.temperature.absoluteMax) {
        violations.push(`Temperature ${reading.tempC}°C above maximum ${limits.temperature.absoluteMax}°C`);
      }
    }
    
    if (reading.rhPct != null) {
      if (reading.rhPct < limits.humidity.absoluteMin) {
        violations.push(`Humidity ${reading.rhPct}% below minimum ${limits.humidity.absoluteMin}%`);
      }
      if (reading.rhPct > limits.humidity.absoluteMax) {
        violations.push(`Humidity ${reading.rhPct}% above maximum ${limits.humidity.absoluteMax}%`);
      }
    }
    
    if (reading.vpd != null) {
      if (reading.vpd < limits.vpd.absoluteMin) {
        violations.push(`VPD ${reading.vpd} kPa below minimum ${limits.vpd.absoluteMin} kPa`);
      }
      if (reading.vpd > limits.vpd.absoluteMax) {
        violations.push(`VPD ${reading.vpd} kPa above maximum ${limits.vpd.absoluteMax} kPa`);
      }
    }
    
    return {
      safe: violations.length === 0,
      violations,
      limits
    };
  }
  
  /**
   * Get all zone assignments
   */
  getZoneAssignments() {
    return Array.from(this.zoneAssignments.entries()).map(([zoneId, assignment]) => ({
      zoneId,
      ...assignment,
      vpdBand: this.getVpdBand(zoneId)
    }));
  }
  
  /**
   * Calculate transition progress (0 to 1)
   */
  _getTransitionProgress(transitionTarget) {
    const startedAt = new Date(transitionTarget.startedAt);
    const durationMs = transitionTarget.durationHours * 60 * 60 * 1000;
    const elapsed = Date.now() - startedAt.getTime();
    const progress = Math.min(1.0, Math.max(0.0, elapsed / durationMs));
    
    // Check if transition complete
    if (progress >= 1.0) {
      // Transition complete - should be finalized by tick loop
      return 1.0;
    }
    
    return progress;
  }
  
  /**
   * Linear interpolation between two values
   */
  _interpolate(start, end, progress) {
    const value = start + (end - start) * progress;
    return Math.round(value * 10) / 10; // Round to 1 decimal
  }
  
  /**
   * Finalize completed transitions (called by automation loop)
   */
  async finalizeTransitions() {
    let changed = false;
    
    for (const [zoneId, assignment] of this.zoneAssignments.entries()) {
      if (!assignment.transitionTarget) continue;
      
      const progress = this._getTransitionProgress(assignment.transitionTarget);
      
      if (progress >= 1.0) {
        // Transition complete
        assignment.stage = assignment.transitionTarget.stage;
        assignment.startDate = new Date().toISOString();
        assignment.previousStage = assignment.stage;
        assignment.transitionTarget = null;
        changed = true;
        
        console.log(`[growth-stage-manager] Zone ${zoneId} transition to ${assignment.stage} complete`);
      }
    }
    
    if (changed) {
      await this._saveAssignments();
    }
  }
  
  /**
   * Save zone assignments to disk
   */
  async _saveAssignments() {
    try {
      const obj = Object.fromEntries(this.zoneAssignments);
      await fs.writeFile(this.assignmentsPath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (error) {
      console.error('[growth-stage-manager] Failed to save assignments:', error.message);
    }
  }
}
