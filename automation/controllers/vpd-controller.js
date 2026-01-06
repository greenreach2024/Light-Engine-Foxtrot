/**
 * VPD Compliance Controller
 * 
 * Zone-based VPD control using circulation fans and dehumidifiers.
 * Maintains VPD within growth-stage-specific bands with hysteresis
 * and equipment protection (min on/off times, duty caps).
 * 
 * Control Strategy:
 * - VPD too low (humid/cool): Increase dehu duty, increase mixing fans
 * - VPD too high (dry/hot): Decrease mixing fans, back off dehus
 * - Within band: Decay toward efficient minimums
 */

import { calculatePsychrometrics } from '../psychrometrics.js';

export default class VpdController {
  constructor(options = {}) {
    const {
      hysteresis = 0.05, // kPa - prevent oscillation
      controlIntervalSec = 30, // Control loop interval
      dehuMinOnSec = 180, // 3 min minimum runtime
      dehuMinOffSec = 180, // 3 min minimum off time
      fanMinOnSec = 60, // 1 min minimum runtime
      fanMinOffSec = 60, // 1 min minimum off time
      dehuDutyCap = 0.9, // Max 90% duty cycle
      decayRate = 0.05, // 5% decay toward minimum per cycle
      logger = console
    } = options;
    
    this.hysteresis = hysteresis;
    this.controlIntervalSec = controlIntervalSec;
    this.dehuMinOnSec = dehuMinOnSec;
    this.dehuMinOffSec = dehuMinOffSec;
    this.fanMinOnSec = fanMinOnSec;
    this.fanMinOffSec = fanMinOffSec;
    this.dehuDutyCap = dehuDutyCap;
    this.decayRate = decayRate;
    this.logger = logger;
    
    // Device state tracking
    this.deviceStates = new Map(); // deviceId -> { state, lastChange, onDuration, offDuration, dutyCycle }
    
    // Control state tracking
    this.zoneStates = new Map(); // zoneId -> { lastVpd, lastAction, consecutiveOutOfBand }
  }
  
  /**
   * Execute VPD control for a zone with Max RH override
   * @param {string} zoneId - Zone identifier
   * @param {Object} sensorReading - Current temp/RH reading
   * @param {Object} vpdBand - Target VPD band from recipe
   * @param {number} maxRh - Maximum humidity override from recipe (independent of VPD)
   * @param {Object} devices - Available devices { fans: [], dehumidifiers: [] }
   * @param {Object} deviceStates - Current device states
   * @returns {Object} Control actions to execute
   */
  async control(zoneId, sensorReading, vpdBand, devices, deviceStates, maxRh = null) {
    // Calculate psychrometrics
    const psychro = calculatePsychrometrics(
      sensorReading.tempC,
      sensorReading.rhPct
    );
    
    if (!psychro.valid) {
      return {
        zoneId,
        error: 'Invalid sensor data',
        actions: []
      };
    }
    
    const currentVpd = psychro.vpd;
    const currentRh = sensorReading.rhPct;
    const targetMin = vpdBand.min;
    const targetMax = vpdBand.max;
    const targetVpd = vpdBand.target;
    
    // Get or initialize zone state
    let zoneState = this.zoneStates.get(zoneId);
    if (!zoneState) {
      zoneState = {
        lastVpd: currentVpd,
        lastRh: currentRh,
        lastAction: 'initialize',
        consecutiveOutOfBand: 0,
        consecutiveRhViolations: 0,
        actionTimestamp: Date.now()
      };
      this.zoneStates.set(zoneId, zoneState);
    }
    
    // Check Max RH override FIRST (safety critical)
    // If RH exceeds recipe maximum, prioritize dehumidification over VPD
    let maxRhViolation = false;
    if (maxRh !== null && currentRh > maxRh) {
      maxRhViolation = true;
      zoneState.consecutiveRhViolations++;
      this.logger.warn(`[vpd-controller] Zone ${zoneId} Max RH violation: ${currentRh}% > ${maxRh}%`);
    } else {
      zoneState.consecutiveRhViolations = 0;
    }
    
    // Determine control regime with hysteresis
    let regime;
    let reason;
    
    if (currentVpd < targetMin - this.hysteresis) {
      regime = 'vpd-too-low'; // Too humid/cool
      reason = `VPD ${currentVpd} kPa < target min ${targetMin} kPa (humid)`;
      zoneState.consecutiveOutOfBand++;
    } else if (currentVpd > targetMax + this.hysteresis) {
      regime = 'vpd-too-high'; // Too dry/hot
      reason = `VPD ${currentVpd} kPa > target max ${targetMax} kPa (dry)`;
      zoneState.consecutiveOutOfBand++;
    } else if (currentVpd >= targetMin && currentVpd <= targetMax) {
    // MAX RH OVERRIDE: If humidity ceiling violated, force dehumidification
    if (maxRhViolation) {
      actions.push(...this._forceMaxRhCompliance(zoneId, currentRh, maxRh, devices, deviceStates));
      reason = `Max RH override: ${currentRh}% > ${maxRh}% (VPD ${currentVpd} kPa)`;
      regime = 'max-rh-override';
    } else   regime = 'in-band';
      reason = `VPD ${currentVpd} kPa within band ${targetMin}-${targetMax} kPa`;
      zoneState.consecutiveOutOfBand = 0;
    } else {
      // In hysteresis zone - maintain previous regime
      regime = zoneState.lastAction === 'vpd-too-low' || zoneState.lastAction === 'vpd-too-high'
        ? zoneState.lastAction
        : 'in-band';
      reason = `VPD ${currentVpd} kPa in hysteresis zone - maintaining previous action`;
    }
    Rh = currentRh;
    zoneState.lastAction = regime;
    zoneState.actionTimestamp = Date.now();
    
    return {
      zoneId,
      psychrometrics: psychro,
      vpdBand,
      currentVpd,
      currentRh,
      maxRh,
      maxRhViolation,
      regime,
      reason,
      consecutiveOutOfBand: zoneState.consecutiveOutOfBand,
      consecutiveRhViolations: zoneState.consecutiveRhViolations,
      actions
    };
  }
  
  /**
   * Force dehumidification to bring RH below recipe maximum
   * This overrides VPD targeting to prevent crop damage from excess humidity
   */
  _forceMaxRhCompliance(zoneId, currentRh, maxRh, devices, deviceStates) {
    const actions = [];
    const violation = currentRh - maxRh;
    const urgency = violation > 5 ? 'high' : 'moderate'; // >5% violation is urgent
    
    this.logger.warn(`[vpd-controller] Forcing Max RH compliance for zone ${zoneId}: ${currentRh}% -> ${maxRh}% (${urgency} urgency)`);
    
    // Turn on ALL available dehumidifiers immediately
    for (const dehu of devices.dehumidifiers) {
      const state = this._getDeviceState(dehu.deviceId, deviceStates);
      
      if (state.state === 'off') {
        // Ignore min-off-time for safety-critical Max RH violations
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'turn-on',
          reason: `Max RH override: ${currentRh}% > ${maxRh}%`,
          minOnSec: this.dehuMinOnSec,
          priority: 'high'
        });
      } else {
        // Already on - keep running
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'maintain-on',
          reason: `Max RH override: maintaining dehumidification`,
          priority: 'high'
        });
      }
    }
    
    // Increase air mixing to help distribute drier air
    for (const fan of devices.fans) {
      const state = this._getDeviceState(fan.deviceId, deviceStates);
      
      if (state.state === 'off') {
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'turn-on',
          level: urgency === 'high' ? 80 : 60,
          reason: `Max RH override: increase air mixing`,
          minOnSec: this.fanMinOnSec
        });
      } else if (state.level != null && state.level < 80) {
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'increase-speed',
          level: Math.min(100, state.level + 30),
          reason: `Max RH override: boost mixing for humidity control`
        });
      }
    }
    
    return actions else if (regime === 'in-band') {
      // Decay toward efficient minimums
      actions.push(...this._decayToMinimum(zoneId, devices, deviceStates));
    }
    
    // Update zone state
    zoneState.lastVpd = currentVpd;
    zoneState.lastAction = regime;
    zoneState.actionTimestamp = Date.now();
    
    return {
      zoneId,
      psychrometrics: psychro,
      vpdBand,
      currentVpd,
      regime,
      reason,
      consecutiveOutOfBand: zoneState.consecutiveOutOfBand,
      actions
    };
  }
  
  /**
   * Increase dehumidifier duty cycle
   */
  _increaseDehumidification(zoneId, dehumidifiers, deviceStates) {
    const actions = [];
    
    for (const dehu of dehumidifiers) {
      const state = this._getDeviceState(dehu.deviceId, deviceStates);
      
      // Check min off time
      if (state.state === 'off' && state.offDuration < this.dehuMinOffSec) {
        this.logger.debug(`[vpd-controller] ${dehu.deviceId} in min-off period (${state.offDuration}/${this.dehuMinOffSec}s)`);
        continue;
      }
      
      // Check duty cap
      if (state.dutyCycle >= this.dehuDutyCap) {
        this.logger.warn(`[vpd-controller] ${dehu.deviceId} at duty cap ${this.dehuDutyCap * 100}%`);
        continue;
      }
      
      // Turn on or increase runtime
      if (state.state === 'off') {
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'turn-on',
          reason: 'VPD too low - increase dehumidification',
          minOnSec: this.dehuMinOnSec
        });
      } else {
        // Already on - extend runtime (handled by scheduler)
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'maintain-on',
          reason: 'VPD too low - maintain dehumidification'
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Increase fan mixing
   */
  _increaseMixing(zoneId, fans, deviceStates) {
    const actions = [];
    
    for (const fan of fans) {
      const state = this._getDeviceState(fan.deviceId, deviceStates);
      
      // Check min off time
      if (state.state === 'off' && state.offDuration < this.fanMinOffSec) {
        continue;
      }
      
      // Turn on or increase speed
      if (state.state === 'off') {
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'turn-on',
          level: 50, // Start at moderate speed
          reason: 'VPD too low - increase air mixing',
          minOnSec: this.fanMinOnSec
        });
      } else if (state.level != null && state.level < 100) {
        // Increase speed by 20%
        const newLevel = Math.min(100, state.level + 20);
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'increase-speed',
          level: newLevel,
          reason: 'VPD too low - increase mixing speed'
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Decrease dehumidification
   */
  _decreaseDehumidification(zoneId, dehumidifiers, deviceStates) {
    const actions = [];
    
    for (const dehu of dehumidifiers) {
      const state = this._getDeviceState(dehu.deviceId, deviceStates);
      
      // Check min on time
      if (state.state === 'on' && state.onDuration < this.dehuMinOnSec) {
        this.logger.debug(`[vpd-controller] ${dehu.deviceId} in min-on period (${state.onDuration}/${this.dehuMinOnSec}s)`);
        continue;
      }
      
      // Turn off to reduce drying
      if (state.state === 'on') {
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'turn-off',
          reason: 'VPD too high - reduce dehumidification',
          minOffSec: this.dehuMinOffSec
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Decrease fan mixing
   */
  _decreaseMixing(zoneId, fans, deviceStates) {
    const actions = [];
    
    for (const fan of fans) {
      const state = this._getDeviceState(fan.deviceId, deviceStates);
      
      // Check min on time
      if (state.state === 'on' && state.onDuration < this.fanMinOnSec) {
        continue;
      }
      
      // Reduce speed or turn off
      if (state.level != null && state.level > 30) {
        // Decrease speed by 20%
        const newLevel = Math.max(30, state.level - 20);
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'decrease-speed',
          level: newLevel,
          reason: 'VPD too high - reduce excessive mixing'
        });
      } else if (state.state === 'on') {
        actions.push({
          deviceId: fan.deviceId,
          deviceType: 'fan',
          action: 'turn-off',
          reason: 'VPD too high - stop unnecessary mixing',
          minOffSec: this.fanMinOffSec
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Decay devices toward efficient minimums when in-band
   */
  _decayToMinimum(zoneId, devices, deviceStates) {
    const actions = [];
    
    // Gradually reduce fan speeds
    for (const fan of devices.fans) {
      const state = this._getDeviceState(fan.deviceId, deviceStates);
      
      if (state.state === 'on' && state.level != null && state.level > 30) {
        const newLevel = Math.max(30, Math.round(state.level * (1 - this.decayRate)));
        
        if (newLevel < state.level) {
          actions.push({
            deviceId: fan.deviceId,
            deviceType: 'fan',
            action: 'decay-speed',
            level: newLevel,
            reason: 'VPD in-band - decay toward minimum'
          });
        }
      }
    }
    
    // Allow dehumidifiers to turn off naturally after min-on time
    for (const dehu of devices.dehumidifiers) {
      const state = this._getDeviceState(dehu.deviceId, deviceStates);
      
      if (state.state === 'on' && state.onDuration >= this.dehuMinOnSec) {
        actions.push({
          deviceId: dehu.deviceId,
          deviceType: 'dehumidifier',
          action: 'allow-off',
          reason: 'VPD in-band - allow dehu to cycle off',
          minOffSec: this.dehuMinOffSec
        });
      }
    }
    
    return actions;
  }
  
  /**
   * Get device state with durations
   */
  _getDeviceState(deviceId, deviceStates) {
    const state = deviceStates?.get?.(deviceId) || deviceStates?.[deviceId] || {};
    
    const currentState = state.state || (state.on ? 'on' : 'off');
    const lastChange = state.lastChange || state.lastChangeAt || Date.now();
    const durationSec = (Date.now() - lastChange) / 1000;
    
    return {
      state: currentState,
      level: state.level || state.brightness || null,
      lastChange,
      onDuration: currentState === 'on' ? durationSec : 0,
      offDuration: currentState === 'off' ? durationSec : 0,
      dutyCycle: state.dutyCycle || 0
    };
  }
  
  /**
   * Update device state tracking (call after executing actions)
   */
  updateDeviceState(deviceId, newState) {
    const existing = this.deviceStates.get(deviceId) || {};
    
    const updated = {
      ...existing,
      state: newState.state || newState.on ? 'on' : 'off',
      level: newState.level ?? existing.level,
      lastChange: Date.now(),
      dutyCycle: newState.dutyCycle ?? existing.dutyCycle ?? 0
    };
    
    this.deviceStates.set(deviceId, updated);
    return updated;
  }
  
  /**
   * Get zone control summary
   */
  getZoneStatus(zoneId) {
    return this.zoneStates.get(zoneId) || null;
  }
  
  /**
   * Get all zone statuses
   */
  getAllZoneStatuses() {
    return Array.from(this.zoneStates.entries()).map(([zoneId, state]) => ({
      zoneId,
      ...state
    }));
  }
  
  /**
   * Reset controller state (for testing or reinitialization)
   */
  reset() {
    this.deviceStates.clear();
    this.zoneStates.clear();
    this.logger.info('[vpd-controller] Controller state reset');
  }
}
