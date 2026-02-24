/**
 * Ventilation Controller
 * 
 * Intelligent outdoor air management for energy-efficient climate control.
 * Uses outdoor conditions to provide "free" cooling/dehumidification when beneficial.
 * 
 * Decision Logic:
 * 1. Check outdoor vs. indoor conditions
 * 2. Evaluate if outdoor air would help reach VPD target
 * 3. Verify no condensation risk
 * 4. Calculate optimal damper position
 * 5. Coordinate with dehumidifiers (reduce if outdoor helps)
 * 
 * Energy Savings: 30-50% reduction in dehumidifier runtime when outdoor conditions favorable
 */

import { evaluateVentilationOpportunity, evaluateCondensationRisk } from '../psychrometrics.js';

export default class VentilationController {
  constructor(options = {}) {
    this.logger = options.logger || console;
    
    // Ventilation thresholds
    this.minOutdoorAdvantage = options.minOutdoorAdvantage || 0.1; // kPa improvement needed
    this.maxCondensationRisk = options.maxCondensationRisk || 0.3; // Max risk score (0-1)
    
    // Control parameters
    this.minDamperPosition = options.minDamperPosition || 10; // % (minimum ventilation)
    this.maxDamperPosition = options.maxDamperPosition || 100; // % (full outdoor air)
    
    // Equipment protection
    this.minHoldTime = options.minHoldTime || 120; // seconds (2 min min between changes)
    this.rampRate = options.rampRate || 5; // % per control cycle
    
    // State tracking per zone
    this.state = new Map(); // zoneId -> { lastChange, damperPosition, reason }
  }

  /**
   * Execute ventilation control for a zone
   * 
   * @param {string} zoneId - Zone identifier
   * @param {object} indoorReading - Indoor sensor reading { tempC, rhPct, vpd }
   * @param {object} outdoorReading - Outdoor weather data { tempC, rhPct }
   * @param {object} vpdBand - Target VPD band { min, max, target }
   * @param {object} devices - Available devices { dampers: [], fans: [], dehumidifiers: [] }
   * @param {object} deviceStates - Current device states { deviceId: { on, level } }
   * @returns {object} Control result { actions: [], regime: string, warnings: [] }
   */
  control(zoneId, indoorReading, outdoorReading, vpdBand, devices, deviceStates) {
    const result = {
      regime: 'unknown',
      actions: [],
      warnings: [],
      metrics: {}
    };

    // Validate inputs
    if (!indoorReading || indoorReading.tempC === undefined || indoorReading.rhPct === undefined) {
      result.warnings.push('Missing or incomplete indoor reading');
      result.regime = 'no-control';
      return result;
    }

    if (!outdoorReading || outdoorReading.tempC === undefined || outdoorReading.rhPct === undefined) {
      result.warnings.push('Missing or incomplete outdoor reading');
      result.regime = 'no-control';
      return result;
    }

    if (!devices.dampers || devices.dampers.length === 0) {
      result.warnings.push('No dampers available for ventilation control');
      result.regime = 'no-control';
      return result;
    }

    if (!vpdBand || vpdBand.target === undefined) {
      result.warnings.push('No VPD target band specified');
      result.regime = 'no-control';
      return result;
    }

    // Evaluate ventilation opportunity
    const opportunity = evaluateVentilationOpportunity(indoorReading, outdoorReading, vpdBand);
    
    result.metrics = {
      indoorVpd: opportunity.currentVpd,
      outdoorVpd: opportunity.outdoorVpd,
      targetVpd: vpdBand.target,
      vpdImprovement: opportunity.vpdImprovement,
      beneficial: opportunity.beneficial
    };

    // Check condensation risk
    const condensationRisk = evaluateCondensationRisk({
      zoneId,
      indoorReading,
      outdoorReading,
      damperPosition: this._getCurrentDamperPosition(zoneId, devices.dampers, deviceStates)
    });

    result.metrics.condensationRisk = condensationRisk.riskScore;

    // Decide regime based on outdoor conditions
    if (!opportunity.beneficial) {
      result.regime = 'outdoor-unfavorable';
      return this._closeVentilation(zoneId, devices, deviceStates, result, 'Outdoor conditions not beneficial');
    }

    if (condensationRisk.riskScore > this.maxCondensationRisk) {
      result.regime = 'condensation-risk';
      return this._closeVentilation(zoneId, devices, deviceStates, result, 
        `Condensation risk too high (${(condensationRisk.riskScore * 100).toFixed(1)}%)`);
    }

    // Outdoor conditions are favorable - calculate optimal damper position
    result.regime = 'ventilation-enabled';
    
    // Calculate target damper position based on VPD improvement potential
    const vpdError = Math.abs(opportunity.currentVpd - vpdBand.target);
    const vpdRange = vpdBand.max - vpdBand.min;
    const targetPosition = this._calculateDamperPosition(opportunity.vpdImprovement, vpdError, vpdRange);

    result.metrics.targetDamperPosition = targetPosition;

    // Check equipment protection (min hold time)
    if (!this._canChange(zoneId)) {
      result.regime = 'ventilation-hold';
      result.warnings.push('Min hold time not elapsed - skipping adjustment');
      return result;
    }

    // Generate damper control actions
    for (const damper of devices.dampers) {
      const currentPosition = deviceStates[damper.id]?.level || 0;
      const newPosition = this._rampToTarget(currentPosition, targetPosition);

      if (Math.abs(newPosition - currentPosition) >= 1) {
        result.actions.push({
          deviceId: damper.id,
          action: 'set-level',
          level: newPosition,
          reason: `Outdoor air beneficial (VPD improvement: ${opportunity.vpdImprovement.toFixed(2)} kPa)`
        });
      }
    }

    // Coordinate with dehumidifiers - reduce duty if outdoor air helping
    if (devices.dehumidifiers && devices.dehumidifiers.length > 0 && targetPosition > 30) {
      const dehuReduction = Math.min(50, targetPosition); // Up to 50% reduction
      
      for (const dehu of devices.dehumidifiers) {
        if (deviceStates[dehu.id]?.on) {
          const currentLevel = deviceStates[dehu.id]?.level || 100;
          const newLevel = Math.max(0, currentLevel - dehuReduction);
          
          if (newLevel < currentLevel) {
            result.actions.push({
              deviceId: dehu.id,
              action: 'set-level',
              level: newLevel,
              reason: `Reduce dehu load (outdoor air assisting, damper at ${targetPosition}%)`
            });
          }
        }
      }
    }

    // Update state
    this._updateState(zoneId, {
      damperPosition: targetPosition,
      regime: result.regime,
      lastChange: Date.now()
    });

    return result;
  }

  /**
   * Close ventilation (dampers to minimum position)
   */
  _closeVentilation(zoneId, devices, deviceStates, result, reason) {
    for (const damper of devices.dampers) {
      const currentPosition = deviceStates[damper.id]?.level || 0;
      
      if (currentPosition > this.minDamperPosition) {
        const newPosition = this._rampToTarget(currentPosition, this.minDamperPosition);
        
        result.actions.push({
          deviceId: damper.id,
          action: 'set-level',
          level: newPosition,
          reason
        });
      }
    }

    this._updateState(zoneId, {
      damperPosition: this.minDamperPosition,
      regime: result.regime,
      lastChange: Date.now()
    });

    return result;
  }

  /**
   * Calculate optimal damper position based on outdoor advantage
   */
  _calculateDamperPosition(vpdImprovement, vpdError, vpdRange) {
    // More improvement = higher damper position
    const improvementFactor = Math.min(1.0, vpdImprovement / 0.3); // 0.3 kPa = excellent
    
    // Larger error = more aggressive damper
    const errorFactor = Math.min(1.0, vpdError / vpdRange);
    
    // Combine factors
    const position = (improvementFactor * 0.6 + errorFactor * 0.4) * this.maxDamperPosition;
    
    // Clamp to range
    return Math.max(this.minDamperPosition, Math.min(this.maxDamperPosition, Math.round(position)));
  }

  /**
   * Ramp damper position towards target (avoid abrupt changes)
   */
  _rampToTarget(current, target) {
    const delta = target - current;
    
    if (Math.abs(delta) <= this.rampRate) {
      return target;
    }
    
    return current + Math.sign(delta) * this.rampRate;
  }

  /**
   * Get current damper position for a zone
   */
  _getCurrentDamperPosition(zoneId, dampers, deviceStates) {
    if (!dampers || dampers.length === 0) return 0;
    
    const positions = dampers
      .map(d => deviceStates[d.id]?.level || 0)
      .filter(p => p !== null);
    
    if (positions.length === 0) return 0;
    
    // Average position across all dampers
    return positions.reduce((sum, p) => sum + p, 0) / positions.length;
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
