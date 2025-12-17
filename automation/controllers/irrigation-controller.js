/**
 * Irrigation Controller
 * 
 * Coordinates environmental control with irrigation schedules to prevent disease.
 * Pre-dries rooms before watering and maintains elevated mixing afterward.
 * 
 * Decision Logic:
 * 1. Monitor irrigation schedule
 * 2. Pre-drying (T-20 to T-10 min): Increase dehu + fans
 * 3. During irrigation (T-10 to T+0): Maintain dehu, reduce fans
 * 4. Post-irrigation (T+0 to T+30 min): Elevated mixing, maintain dehu
 * 5. Recovery (T+30 to T+60 min): Gradual return to normal
 * 
 * Disease Prevention: Prevents prolonged leaf wetness that promotes pathogens
 */

export default class IrrigationController {
  constructor(options = {}) {
    this.logger = options.logger || console;
    
    // Timing parameters (minutes before/after irrigation)
    this.preDryStartMin = options.preDryStartMin || 20; // Start pre-drying 20 min before
    this.preDryEndMin = options.preDryEndMin || 10; // End pre-drying 10 min before
    this.postIrrigationMin = options.postIrrigationMin || 30; // Elevated mixing for 30 min
    this.recoveryMin = options.recoveryMin || 60; // Full recovery by 60 min
    
    // Control parameters
    this.preDryFanBoost = options.preDryFanBoost || 20; // % increase
    this.preDryDehuBoost = options.preDryDehuBoost || 30; // % increase
    this.postFanBoost = options.postFanBoost || 30; // % increase
    this.postDehuBoost = options.postDehuBoost || 20; // % increase
    
    // State tracking per zone
    this.state = new Map(); // zoneId -> { phase, startTime, scheduleId }
    this.schedules = new Map(); // zoneId -> { nextIrrigation, duration }
  }

  /**
   * Register irrigation schedule for a zone
   * 
   * @param {string} zoneId - Zone identifier
   * @param {object} schedule - Schedule details { nextIrrigation: timestamp, durationMin: number }
   */
  registerSchedule(zoneId, schedule) {
    this.schedules.set(zoneId, {
      nextIrrigation: schedule.nextIrrigation,
      durationMin: schedule.durationMin || 10
    });
    
    this.logger.log(`[irrigation] Registered schedule for ${zoneId}: next at ${new Date(schedule.nextIrrigation)}`);
  }

  /**
   * Clear irrigation schedule for a zone
   */
  clearSchedule(zoneId) {
    this.schedules.delete(zoneId);
    this.state.delete(zoneId);
  }

  /**
   * Execute irrigation control for a zone
   * 
   * @param {string} zoneId - Zone identifier
   * @param {object} devices - Available devices { fans: [], dehumidifiers: [] }
   * @param {object} deviceStates - Current device states { deviceId: { on, level } }
   * @param {object} baselineControl - Normal VPD control actions (to modify)
   * @returns {object} Control result { actions: [], phase: string, warnings: [] }
   */
  control(zoneId, devices, deviceStates, baselineControl = null) {
    const result = {
      phase: 'normal',
      actions: [],
      warnings: [],
      metrics: {}
    };

    // Check if irrigation scheduled
    const schedule = this.schedules.get(zoneId);
    if (!schedule) {
      result.phase = 'no-schedule';
      return result;
    }

    // Calculate time until/since irrigation
    const now = Date.now();
    const minutesUntil = (schedule.nextIrrigation - now) / (60 * 1000);
    
    result.metrics.minutesUntilIrrigation = minutesUntil;

    // Determine phase
    const phase = this._determinePhase(minutesUntil);
    result.phase = phase.name;
    result.metrics.phaseProgress = phase.progress; // 0-1

    // No pre-emption needed if in normal phase
    if (phase.name === 'normal') {
      return result;
    }

    // Validate devices available
    if (!devices.fans || devices.fans.length === 0) {
      result.warnings.push('No fans available for irrigation pre-emption');
    }

    if (!devices.dehumidifiers || devices.dehumidifiers.length === 0) {
      result.warnings.push('No dehumidifiers available for irrigation pre-emption');
    }

    // Generate phase-specific control actions
    switch (phase.name) {
      case 'pre-dry':
        return this._executePreDry(zoneId, devices, deviceStates, phase, result);
      
      case 'during-irrigation':
        return this._executeDuringIrrigation(zoneId, devices, deviceStates, phase, result);
      
      case 'post-irrigation':
        return this._executePostIrrigation(zoneId, devices, deviceStates, phase, result);
      
      case 'recovery':
        return this._executeRecovery(zoneId, devices, deviceStates, phase, result);
      
      default:
        return result;
    }
  }

  /**
   * Determine current phase relative to irrigation
   */
  _determinePhase(minutesUntil) {
    if (minutesUntil > this.preDryStartMin) {
      return { name: 'normal', progress: 0 };
    }

    if (minutesUntil <= this.preDryStartMin && minutesUntil > this.preDryEndMin) {
      const progress = 1 - ((minutesUntil - this.preDryEndMin) / (this.preDryStartMin - this.preDryEndMin));
      return { name: 'pre-dry', progress };
    }

    if (minutesUntil <= this.preDryEndMin && minutesUntil > 0) {
      const progress = 1 - (minutesUntil / this.preDryEndMin);
      return { name: 'during-irrigation', progress };
    }

    const minutesSince = Math.abs(minutesUntil);

    if (minutesSince <= this.postIrrigationMin) {
      const progress = minutesSince / this.postIrrigationMin;
      return { name: 'post-irrigation', progress };
    }

    if (minutesSince <= this.recoveryMin) {
      const progress = (minutesSince - this.postIrrigationMin) / (this.recoveryMin - this.postIrrigationMin);
      return { name: 'recovery', progress };
    }

    return { name: 'normal', progress: 0 };
  }

  /**
   * Pre-dry phase: Increase fans + dehumidifiers to lower RH before watering
   */
  _executePreDry(zoneId, devices, deviceStates, phase, result) {
    const boostFactor = phase.progress; // Gradual ramp 0 → 1

    // Boost fans
    for (const fan of devices.fans || []) {
      const currentSpeed = deviceStates[fan.id]?.level || 50;
      const boost = Math.round(this.preDryFanBoost * boostFactor);
      const targetSpeed = Math.min(100, currentSpeed + boost);

      if (targetSpeed > currentSpeed) {
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: targetSpeed,
          reason: `Pre-dry (T-${Math.round(-phase.progress * 10 + 20)} min) - increase mixing`
        });
      }
    }

    // Boost dehumidifiers
    for (const dehu of devices.dehumidifiers || []) {
      const currentLevel = deviceStates[dehu.id]?.level || 0;
      const boost = Math.round(this.preDryDehuBoost * boostFactor);
      const targetLevel = Math.min(100, currentLevel + boost);

      if (!deviceStates[dehu.id]?.on) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'turn-on',
          level: targetLevel,
          reason: `Pre-dry (T-${Math.round(-phase.progress * 10 + 20)} min) - reduce RH before irrigation`
        });
      } else if (targetLevel > currentLevel) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'set-level',
          level: targetLevel,
          reason: `Pre-dry (T-${Math.round(-phase.progress * 10 + 20)} min) - boost dehumidification`
        });
      }
    }

    this._updateState(zoneId, { phase: 'pre-dry', startTime: Date.now() });
    return result;
  }

  /**
   * During irrigation: Maintain dehu, reduce fans to avoid disrupting watering
   */
  _executeDuringIrrigation(zoneId, devices, deviceStates, phase, result) {
    // Reduce fans to 40% (avoid water spray disruption)
    for (const fan of devices.fans || []) {
      const currentSpeed = deviceStates[fan.id]?.level || 50;
      const targetSpeed = 40;

      if (currentSpeed > targetSpeed) {
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: targetSpeed,
          reason: `During irrigation - reduce mixing to avoid spray disruption`
        });
      }
    }

    // Maintain dehumidifiers (keep removing moisture)
    for (const dehu of devices.dehumidifiers || []) {
      if (!deviceStates[dehu.id]?.on) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'turn-on',
          level: 70,
          reason: `During irrigation - maintain dehumidification`
        });
      }
    }

    this._updateState(zoneId, { phase: 'during-irrigation', startTime: Date.now() });
    return result;
  }

  /**
   * Post-irrigation: Elevated mixing + dehu to dry leaf surfaces quickly
   */
  _executePostIrrigation(zoneId, devices, deviceStates, phase, result) {
    const boostFactor = 1 - (phase.progress * 0.3); // Start high, decay slightly

    // Boost fans significantly
    for (const fan of devices.fans || []) {
      const currentSpeed = deviceStates[fan.id]?.level || 50;
      const boost = Math.round(this.postFanBoost * boostFactor);
      const targetSpeed = Math.min(100, currentSpeed + boost);

      if (targetSpeed > currentSpeed) {
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: targetSpeed,
          reason: `Post-irrigation (T+${Math.round(phase.progress * 30)} min) - dry leaf surfaces`
        });
      }
    }

    // Maintain elevated dehu
    for (const dehu of devices.dehumidifiers || []) {
      const currentLevel = deviceStates[dehu.id]?.level || 0;
      const boost = Math.round(this.postDehuBoost * boostFactor);
      const targetLevel = Math.min(100, currentLevel + boost);

      if (!deviceStates[dehu.id]?.on) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'turn-on',
          level: targetLevel,
          reason: `Post-irrigation (T+${Math.round(phase.progress * 30)} min) - remove excess moisture`
        });
      } else if (targetLevel > currentLevel) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'set-level',
          level: targetLevel,
          reason: `Post-irrigation (T+${Math.round(phase.progress * 30)} min) - boost dehumidification`
        });
      }
    }

    this._updateState(zoneId, { phase: 'post-irrigation', startTime: Date.now() });
    return result;
  }

  /**
   * Recovery: Gradual return to normal VPD control
   */
  _executeRecovery(zoneId, devices, deviceStates, phase, result) {
    const decayFactor = 1 - phase.progress; // 1 → 0 (fade out boost)

    // Gradually reduce fan boost
    for (const fan of devices.fans || []) {
      const currentSpeed = deviceStates[fan.id]?.level || 50;
      const boost = Math.round(this.postFanBoost * 0.5 * decayFactor);
      const targetSpeed = Math.max(50, currentSpeed - boost);

      if (currentSpeed > targetSpeed + 5) {
        result.actions.push({
          deviceId: fan.id,
          action: 'set-level',
          level: targetSpeed,
          reason: `Recovery (T+${Math.round(30 + phase.progress * 30)} min) - return to normal`
        });
      }
    }

    // Gradually reduce dehu boost
    for (const dehu of devices.dehumidifiers || []) {
      const currentLevel = deviceStates[dehu.id]?.level || 0;
      const boost = Math.round(this.postDehuBoost * 0.5 * decayFactor);
      const targetLevel = Math.max(50, currentLevel - boost);

      if (currentLevel > targetLevel + 5) {
        result.actions.push({
          deviceId: dehu.id,
          action: 'set-level',
          level: targetLevel,
          reason: `Recovery (T+${Math.round(30 + phase.progress * 30)} min) - return to normal`
        });
      }
    }

    this._updateState(zoneId, { phase: 'recovery', startTime: Date.now() });
    return result;
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
   * Get all active schedules
   */
  getSchedules() {
    return Array.from(this.schedules.entries()).map(([zoneId, schedule]) => ({
      zoneId,
      ...schedule
    }));
  }

  /**
   * Reset controller state
   */
  reset() {
    this.state.clear();
    this.schedules.clear();
  }
}
