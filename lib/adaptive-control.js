// lib/adaptive-control.js
/**
 * P2: Adaptive Environmental Control (Tier 1 - Outdoor-Aware Adjustments)
 * 
 * Progressive enhancement architecture that adjusts environmental setpoints based on:
 * - Outdoor weather conditions (Tier 1)
 * - Historical patterns (Tier 2 - future)
 * - ML optimization (Tier 3 - future)
 * 
 * Framework Compliance:
 * - Simplicity Over Features: Tier 1 uses simple rules, no ML
 * - Equipment-Agnostic: Works without knowing HVAC type
 * - Database-Driven: Reads crop requirements from groups.json
 * - Zero Data Format Violations: Only adjusts in-memory targets
 */

export class AdaptiveControl {
  constructor(options = {}) {
    this.tier = options.tier || 1;
    this.historicalData = options.historicalData || [];
    this.weatherAPI = options.weatherAPI || null;
    this.enabled = true;
    
    // Safety margins
    this.maxTempAdjustment = 2.5; // °C
    this.maxRHAdjustment = 10;    // %
    
    console.log(`[Adaptive Control] Initialized: Tier ${this.tier}, Equipment-agnostic mode`);
  }

  /**
   * Adjust zone targets based on outdoor conditions and learned patterns
   * 
   * @param {Object} targets - Current targets {zoneId: {tempC: [min, max], rh: [min, max]}}
   * @param {Object} context - {zones, outdoorContext, groups, timestamp}
   * @returns {Object} Adjusted targets
   */
  adjustTargets(targets, context) {
    if (!this.enabled) {
      return targets;
    }

    const { zones, outdoorContext, groups, timestamp } = context;
    
    // Deep clone to avoid mutating original
    const adjustedTargets = JSON.parse(JSON.stringify(targets));
    
    try {
      // Tier 1: Simple outdoor-aware adjustments
      if (this.tier >= 1) {
        this._tier1OutdoorAware(adjustedTargets, context);
      }
      
      // Tier 2: Historical pattern learning (future)
      if (this.tier >= 2 && this.historicalData.length > 0) {
        this._tier2Historical(adjustedTargets, context);
      }
      
      // Tier 3: ML optimization (future)
      if (this.tier >= 3 && this.mlModel) {
        this._tier3ML(adjustedTargets, context);
      }
      
      return adjustedTargets;
    } catch (error) {
      console.warn('[Adaptive Control] Error adjusting targets:', error.message);
      console.warn('[Adaptive Control] Falling back to original targets');
      return targets; // Fail safe: return original targets
    }
  }

  /**
   * Tier 1: Outdoor-aware adjustments using simple rules
   * 
   * Rules (refined per Review Agent):
   * 1. Extreme heat: Allow +2°C when outdoor >32°C (with crop max limit)
   * 2. Extreme cold: Allow -1°C when outdoor <5°C (with crop min limit)
   * 3. Time-of-use: Allow +1°C during peak hours 2-6pm
   * 4. Safety: Never exceed crop absolute min/max
   * 
   * @private
   */
  _tier1OutdoorAware(targets, context) {
    const { outdoorContext, groups } = context;
    const outdoorTemp = outdoorContext?.temp;
    const outdoorRH = outdoorContext?.rh;
    const hour = new Date().getHours();
    
    if (!outdoorTemp) {
      console.log('[Adaptive Control] No outdoor temp available, skipping outdoor-aware adjustments');
      return;
    }

    for (const zoneId in targets) {
      // Find group for this zone to get crop requirements
      const group = groups?.find(g => {
        // Match by zone ID or location field
        return g.location === zoneId || g.room === zoneId || g.zone === zoneId;
      });
      
      // Get crop temperature requirements (with sensible defaults)
      const cropTempMin = group?.environmentalNeeds?.tempMin 
        || group?.environmentalNeeds?.temperature?.min 
        || 15; // Default minimum for leafy greens
      const cropTempMax = group?.environmentalNeeds?.tempMax 
        || group?.environmentalNeeds?.temperature?.max 
        || 28; // Default maximum for leafy greens
      const cropRHMax = group?.environmentalNeeds?.rhMax 
        || group?.environmentalNeeds?.humidity?.max 
        || 75; // Safety limit to prevent mold

      const originalTempMax = targets[zoneId].tempC[1];
      const originalTempMin = targets[zoneId].tempC[0];
      let adjustmentReason = [];

      // Rule 1: Extreme heat relaxation
      // Allow higher indoor temp when outdoor is extreme (HVAC capacity limited)
      if (outdoorTemp > 32) {
        const heatAdjustment = Math.min(2.0, this.maxTempAdjustment);
        const newMax = Math.min(
          originalTempMax + heatAdjustment,
          cropTempMax + 1 // Never exceed crop max + 1°C safety margin
        );
        
        if (newMax > originalTempMax) {
          targets[zoneId].tempC[1] = newMax;
          adjustmentReason.push(`extreme heat (outdoor ${outdoorTemp}°C): +${(newMax - originalTempMax).toFixed(1)}°C`);
        }
      }
      
      // Rule 2: Extreme cold relaxation
      // Allow lower indoor temp when outdoor is cold (heating expensive)
      if (outdoorTemp < 5) {
        const coldAdjustment = Math.min(1.0, this.maxTempAdjustment);
        const newMin = Math.max(
          originalTempMin - coldAdjustment,
          cropTempMin // Never go below crop absolute minimum
        );
        
        if (newMin < originalTempMin) {
          targets[zoneId].tempC[0] = newMin;
          adjustmentReason.push(`extreme cold (outdoor ${outdoorTemp}°C): ${(newMin - originalTempMin).toFixed(1)}°C`);
        }
      }
      
      // Rule 3: Time-of-use energy optimization
      // Relax temp during peak energy hours (2-6pm) to save costs
      if (hour >= 14 && hour < 18) {
        const touAdjustment = 1.0;
        const newMax = Math.min(
          originalTempMax + touAdjustment,
          cropTempMax + 1
        );
        
        // Only apply if not already adjusted by heat rule
        if (newMax > targets[zoneId].tempC[1]) {
          targets[zoneId].tempC[1] = newMax;
          adjustmentReason.push(`peak hours (${hour}:00): +${touAdjustment}°C`);
        } else if (adjustmentReason.length === 0) {
          // Already adjusted by heat rule, just note TOU
          adjustmentReason.push(`peak hours (${hour}:00): already relaxed`);
        }
      }

      // Log adjustments for monitoring and energy analysis
      if (adjustmentReason.length > 0) {
        console.log(`[Adaptive Control] ${zoneId}: ${adjustmentReason.join(', ')} | Target: ${targets[zoneId].tempC[0]}-${targets[zoneId].tempC[1]}°C`);
      }
      
      // Safety validation: Ensure we never exceeded crop limits
      if (targets[zoneId].tempC[1] > cropTempMax + 1.5) {
        console.warn(`[Adaptive Control] Safety override: ${zoneId} temp max ${targets[zoneId].tempC[1]}°C exceeds crop limit ${cropTempMax}°C`);
        targets[zoneId].tempC[1] = cropTempMax + 1;
      }
      if (targets[zoneId].tempC[0] < cropTempMin - 0.5) {
        console.warn(`[Adaptive Control] Safety override: ${zoneId} temp min ${targets[zoneId].tempC[0]}°C below crop limit ${cropTempMin}°C`);
        targets[zoneId].tempC[0] = cropTempMin;
      }
    }
  }

  /**
   * Tier 2: Historical pattern learning (future implementation)
   * 
   * Will use simple regression on:
   * - Historical HVAC efficiency by outdoor temp
   * - Time-of-day patterns
   * - Seasonal adjustments
   * 
   * @private
   */
  _tier2Historical(targets, context) {
    // Placeholder for Tier 2 implementation
    // This will be implemented after Tier 1 is validated with real data
    console.log('[Adaptive Control] Tier 2 historical learning not yet implemented');
  }

  /**
   * Tier 3: ML optimization (future implementation)
   * 
   * Will use neural network for:
   * - Multi-objective optimization (energy + crop health + cost)
   * - Complex pattern recognition
   * - Predictive control
   * 
   * @private
   */
  _tier3ML(targets, context) {
    // Placeholder for Tier 3 implementation
    // This will be implemented after Tier 2 is validated
    console.log('[Adaptive Control] Tier 3 ML optimization not yet implemented');
  }

  /**
   * Enable or disable adaptive control
   * 
   * @param {boolean} enabled - True to enable, false to disable
   */
  setEnabled(enabled) {
    this.enabled = enabled;
    console.log(`[Adaptive Control] ${enabled ? 'Enabled' : 'Disabled'}`);
  }

  /**
   * Get current configuration
   * 
   * @returns {Object} Current config
   */
  getConfig() {
    return {
      tier: this.tier,
      enabled: this.enabled,
      maxTempAdjustment: this.maxTempAdjustment,
      maxRHAdjustment: this.maxRHAdjustment,
      historicalDataPoints: this.historicalData.length
    };
  }
}

export default AdaptiveControl;
