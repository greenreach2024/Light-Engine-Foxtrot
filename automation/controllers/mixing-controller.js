/**
 * Mixing Controller
 * 
 * Prevents thermal/humidity stratification through intelligent air circulation.
 * Detects spatial variance and adjusts fan mixing to maintain uniform conditions.
 * 
 * Decision Logic:
 * 1. Calculate spatial variance (temp/RH differences across sensors)
 * 2. Determine if stratification exceeds thresholds
 * 3. Adjust fan speeds to promote mixing
 * 4. Coordinate with VPD control (avoid fighting each other)
 * 
 * Benefits: Uniform growing conditions, prevents microclimates, disease prevention
 */

import { calculateSpatialVariance } from '../psychrometrics.js';

export default class MixingController {
  constructor(options = {}) {
    this.logger = options.logger || console;
    
    // Stratification thresholds
    this.maxTempVariance = options.maxTempVariance || 2.0; // °C difference
    this.maxRhVariance = options.maxRhVariance || 10.0; // % RH difference
    this.maxVpdVariance = options.maxVpdVariance || 0.15; // kPa difference
    
    // Control parameters
    this.minFanSpeed = options.minFanSpeed || 30; // % (minimum for circulation)
    this.maxFanSpeed = options.maxFanSpeed || 100; // % (full mixing power)
    this.baselineSpeed = options.baselineSpeed || 40; // % (normal circulation)
    
    // Equipment protection
    this.minHoldTime = options.minHoldTime || 60; // seconds (1 min min between changes)
    this.rampRate = options.rampRate || 10; // % per control cycle
    
    // State tracking per zone
    this.state = new Map(); // zoneId -> { lastChange, fanSpeed, variance }
  }

  /**
   * Execute mixing control for a zone
   * 
   * @param {string} zoneId - Zone identifier
   * @param {array} sensorReadings - Array of sensor readings [{ tempC, rhPct, vpd, sensorId }]
   * @param {object} devices - Available devices { fans: [] }
   * @param {object} deviceStates - Current device states { deviceId: { on, level } }
   * @param {object} vpdControlActive - Whether VPD control is currently active
   * @returns {object} Control result { actions: [], regime: string, warnings: [] }
   */
  control(zoneId, sensorReadings, devices, deviceStates, vpdControlActive = false) {
    const result = {
      regime: 'unknown',
      actions: [],
      warnings: [],
      metrics: {}
    };

    // Validate inputs
    if (!sensorReadings || sensorReadings.length < 2) {
      result.warnings.push('Need at least 2 sensors to detect stratification');
      result.regime = 'insufficient-sensors';
      return result;
    }

    if (!devices.fans || devices.fans.length === 0) {
      result.warnings.push('No fans available for mixing control');
      result.regime = 'no-control';
      return result;
    }

    // Calculate spatial variance
    const variance = calculateSpatialVariance(sensorReadings);
    
    result.metrics = {
      tempVariance: variance.tempVariance,
      rhVariance: variance.rhVariance,
      vpdVariance: variance.vpdVariance,
      sensorCount: sensorReadings.length
    };

    // Determine stratification severity
    const stratified = this._isStratified(variance);
    
    if (!stratified.detected) {
      result.regime = 'uniform-conditions';
      return this._maintainBaseline(zoneId, devices, deviceStates, result);
    }

    // Stratification detected - increase mixing
    result.regime = 'stratification-detected';
    
    // Calculate target fan speed based on stratification severity
    const severity = this._calculateSeverity(variance, stratified);
    const targetSpeed = this._calculateFanSpeed(severity, vpdControlActive);
    
    result.metrics.severity = severity;
    result.metrics.targetFanSpeed = targetSpeed;

    // Check equipment protection (min hold time)
    if (!this._canChange(zoneId)) {
      result.regime = 'mixing-hold';
      result.warnings.push('Min hold time not elapsed - maintaining current mixing');
      return result;
    }

    // Generate fan control actions
    for (const fan of devices.fans) {
      const currentSpeed = deviceStates[fan.id]?.level || this.baselineSpeed;
      const newSpeed = this._rampToTarget(currentSpeed, targetSpeed);

      if (Math.abs(newSpeed - currentSpeed) >= 2) {
        const action = newSpeed > currentSpeed ? 'increase' : 'decrease';
        
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: newSpeed,
          reason: `${stratified.reason} (${severity.toFixed(1)}% severity) - ${action} mixing`
        });
      }
    }

    // Update state
    this._updateState(zoneId, {
      fanSpeed: targetSpeed,
      variance,
      regime: result.regime,
      lastChange: Date.now()
    });

    return result;
  }

  /**
   * Maintain baseline circulation (no stratification)
   */
  _maintainBaseline(zoneId, devices, deviceStates, result) {
    const targetSpeed = this.baselineSpeed;

    for (const fan of devices.fans) {
      const currentSpeed = deviceStates[fan.id]?.level || 0;
      
      if (Math.abs(currentSpeed - targetSpeed) >= 5) {
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: targetSpeed,
          reason: 'Maintain baseline circulation (conditions uniform)'
        });
      }
    }

    this._updateState(zoneId, {
      fanSpeed: targetSpeed,
      regime: result.regime,
      lastChange: Date.now()
    });

    return result;
  }

  /**
   * Check if zone is stratified
   */
  _isStratified(variance) {
    const reasons = [];
    
    if (variance.tempVariance > this.maxTempVariance) {
      reasons.push(`Temp variance ${variance.tempVariance.toFixed(1)}°C (max ${this.maxTempVariance}°C)`);
    }
    
    if (variance.rhVariance > this.maxRhVariance) {
      reasons.push(`RH variance ${variance.rhVariance.toFixed(1)}% (max ${this.maxRhVariance}%)`);
    }
    
    if (variance.vpdVariance > this.maxVpdVariance) {
      reasons.push(`VPD variance ${variance.vpdVariance.toFixed(2)} kPa (max ${this.maxVpdVariance} kPa)`);
    }

    return {
      detected: reasons.length > 0,
      reason: reasons.join(', ') || 'Conditions uniform'
    };
  }

  /**
   * Calculate stratification severity (0-1 scale)
   */
  _calculateSeverity(variance, stratified) {
    if (!stratified.detected) return 0;

    const tempSeverity = Math.min(1.0, variance.tempVariance / (this.maxTempVariance * 2));
    const rhSeverity = Math.min(1.0, variance.rhVariance / (this.maxRhVariance * 2));
    const vpdSeverity = Math.min(1.0, variance.vpdVariance / (this.maxVpdVariance * 2));

    // Take the maximum severity
    return Math.max(tempSeverity, rhSeverity, vpdSeverity);
  }

  /**
   * Calculate target fan speed based on severity
   */
  _calculateFanSpeed(severity, vpdControlActive) {
    // Base calculation: linear scale from baseline to max
    let targetSpeed = this.baselineSpeed + (severity * (this.maxFanSpeed - this.baselineSpeed));

    // If VPD control is active, limit fan speed to avoid interference
    if (vpdControlActive) {
      targetSpeed = Math.min(targetSpeed, this.maxFanSpeed * 0.7); // Cap at 70% to let VPD control dominate
    }

    // Clamp to range
    return Math.max(this.minFanSpeed, Math.min(this.maxFanSpeed, Math.round(targetSpeed)));
  }

  /**
   * Ramp fan speed towards target (avoid abrupt changes)
   */
  _rampToTarget(current, target) {
    const delta = target - current;
    
    if (Math.abs(delta) <= this.rampRate) {
      return target;
    }
    
    return current + Math.sign(delta) * this.rampRate;
  }

  /**
   * Check if enough time has elapsed since last change (equipment protection)
   */
  _canChange(zoneId) {
    const state = this.state.get(zoneId);
    if (!state || !state.lastChange) return true;
    
    const elapsed = (Date.now() - state.lastChange) / 1000; // seconds
    return elapsed >= this.minHoldTime;
  }

  /**
   * Update zone state tracking
   */
  _updateState(zoneId, updates) {
    const current = this.state.get(zoneId) || {};
    this.state.set(zoneId, { ...current, ...updates });
  }

  /**
   * Get current state for a zone
   */
  getState(zoneId) {
    return this.state.get(zoneId) || null;
  }

  /**
   * Reset controller state
   */
  reset() {
    this.state.clear();
  }
}
