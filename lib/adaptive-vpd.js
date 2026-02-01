/**
 * Adaptive VPD Service
 * 
 * AI-powered environmental control that adapts VPD targets based on:
 * - Outdoor weather conditions (heat waves, cold snaps)
 * - Crop growth stage (mature vs seedlings)
 * - Facility capacity (HVAC load)
 * - Energy costs (peak demand hours)
 * 
 * Design Philosophy: Progressive Enhancement
 * - Works with just recipe targets (passthrough)
 * - Enhances with weather data (if available)
 * - Optimizes with facility data (if available)
 * - Logs all decisions with reasoning (visibility)
 * 
 * Integration: Recipe → AI Adapter → VPD Controller → Equipment
 */

export default class AdaptiveVpd {
  constructor(options = {}) {
    const {
      // Weather-based adaptation thresholds
      heatWaveThresholdC = 30,        // Outdoor temp considered heat wave
      coldSnapThresholdC = 5,         // Outdoor temp considered cold snap
      rapidChangeThresholdC = 15,     // Temp change in 24h triggering adaptation
      
      // VPD adaptation limits (prevent excessive relaxation)
      maxRelaxationPct = 0.20,        // Max 20% band relaxation
      minBandWidthKpa = 0.3,          // Min VPD band width (prevent too tight)
      
      // Crop-based adaptation
      matureCropDaysThreshold = 7,    // Days to harvest for "mature" classification
      seedlingDaysThreshold = 14,     // Days since seed for "seedling" classification
      
      // Energy optimization
      peakDemandHours = [14, 15, 16, 17, 18], // Peak energy cost hours
      
      logger = console
    } = options;
    
    this.heatWaveThresholdC = heatWaveThresholdC;
    this.coldSnapThresholdC = coldSnapThresholdC;
    this.rapidChangeThresholdC = rapidChangeThresholdC;
    this.maxRelaxationPct = maxRelaxationPct;
    this.minBandWidthKpa = minBandWidthKpa;
    this.matureCropDaysThreshold = matureCropDaysThreshold;
    this.seedlingDaysThreshold = seedlingDaysThreshold;
    this.peakDemandHours = peakDemandHours;
    this.logger = logger;
    
    // Decision cache (avoid recalculation every control cycle)
    this.decisionCache = new Map(); // cacheKey -> { decision, timestamp }
    this.cacheTtlMs = 5 * 60 * 1000; // 5 minutes
  }
  
  /**
   * Adapt VPD targets based on conditions
   * 
   * @param {Object} params
   * @param {Object} params.recipe - Recipe VPD band { min, max, target }
   * @param {Object} params.outdoor - Outdoor conditions (optional)
   * @param {Object} params.crop - Crop info (optional)
   * @param {Object} params.facility - Facility status (optional)
   * @returns {Object} Adapted VPD band with reasoning
   */
  adapt(params) {
    const { recipe, outdoor, crop, facility } = params;
    
    // Validate recipe band
    if (!recipe || typeof recipe.min !== 'number' || typeof recipe.max !== 'number') {
      return {
        min: recipe?.min ?? 0.8,
        max: recipe?.max ?? 1.2,
        target: recipe?.target ?? 1.0,
        adapted: false,
        reason: 'Invalid recipe band - using defaults',
        confidence: 0.5
      };
    }
    
    // Check cache
    const cacheKey = this._getCacheKey(params);
    const cached = this.decisionCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < this.cacheTtlMs) {
      return cached.decision;
    }
    
    // Start with recipe targets
    let adaptedMin = recipe.min;
    let adaptedMax = recipe.max;
    let adaptedTarget = recipe.target ?? (recipe.min + recipe.max) / 2;
    
    const reasons = [];
    const factors = [];
    let confidence = 1.0;
    let energySavingsPct = 0;
    let cropImpact = 'none';
    
    // Progressive enhancement: Add adaptations if data available
    
    // 1. Weather-based adaptation (highest priority)
    if (outdoor && typeof outdoor.temp === 'number') {
      const weatherAdaptation = this._adaptForWeather(
        { min: adaptedMin, max: adaptedMax, target: adaptedTarget },
        outdoor,
        crop
      );
      
      if (weatherAdaptation.adapted) {
        adaptedMin = weatherAdaptation.min;
        adaptedMax = weatherAdaptation.max;
        adaptedTarget = weatherAdaptation.target;
        reasons.push(weatherAdaptation.reason);
        factors.push('weather');
        energySavingsPct += weatherAdaptation.energySavingsPct || 0;
        cropImpact = weatherAdaptation.cropImpact || cropImpact;
        confidence *= weatherAdaptation.confidence || 0.8;
      }
    }
    
    // 2. Energy-based adaptation (secondary)
    if (facility && typeof facility.energyCost === 'number') {
      const energyAdaptation = this._adaptForEnergy(
        { min: adaptedMin, max: adaptedMax, target: adaptedTarget },
        facility
      );
      
      if (energyAdaptation.adapted) {
        adaptedMin = energyAdaptation.min;
        adaptedMax = energyAdaptation.max;
        adaptedTarget = energyAdaptation.target;
        reasons.push(energyAdaptation.reason);
        factors.push('energy');
        energySavingsPct += energyAdaptation.energySavingsPct || 0;
        confidence *= energyAdaptation.confidence || 0.9;
      }
    }
    
    // 3. Facility capacity adaptation (tertiary)
    if (facility && typeof facility.hvacLoad === 'number') {
      const capacityAdaptation = this._adaptForCapacity(
        { min: adaptedMin, max: adaptedMax, target: adaptedTarget },
        facility,
        crop
      );
      
      if (capacityAdaptation.adapted) {
        adaptedMin = capacityAdaptation.min;
        adaptedMax = capacityAdaptation.max;
        adaptedTarget = capacityAdaptation.target;
        reasons.push(capacityAdaptation.reason);
        factors.push('capacity');
        energySavingsPct += capacityAdaptation.energySavingsPct || 0;
        confidence *= capacityAdaptation.confidence || 0.85;
      }
    }
    
    // Ensure band constraints
    const bandwidth = adaptedMax - adaptedMin;
    if (bandwidth < this.minBandWidthKpa) {
      const center = (adaptedMin + adaptedMax) / 2;
      adaptedMin = center - this.minBandWidthKpa / 2;
      adaptedMax = center + this.minBandWidthKpa / 2;
      reasons.push(`Band width enforced minimum ${this.minBandWidthKpa} kPa`);
    }
    
    // Ensure target within band
    adaptedTarget = Math.max(adaptedMin, Math.min(adaptedMax, adaptedTarget));
    
    // Round to 2 decimal places
    adaptedMin = Math.round(adaptedMin * 100) / 100;
    adaptedMax = Math.round(adaptedMax * 100) / 100;
    adaptedTarget = Math.round(adaptedTarget * 100) / 100;
    
    const decision = {
      min: adaptedMin,
      max: adaptedMax,
      target: adaptedTarget,
      adapted: factors.length > 0,
      factors,
      reason: reasons.length > 0 ? reasons.join('; ') : 'No adaptation needed',
      energySavingsPct: Math.round(energySavingsPct),
      cropImpact,
      confidence: Math.round(confidence * 100) / 100,
      original: {
        min: recipe.min,
        max: recipe.max,
        target: recipe.target ?? (recipe.min + recipe.max) / 2
      }
    };
    
    // Cache decision
    this.decisionCache.set(cacheKey, {
      decision,
      timestamp: Date.now()
    });
    
    return decision;
  }
  
  /**
   * Weather-based VPD adaptation
   */
  _adaptForWeather(band, outdoor, crop) {
    const { temp, rh, tempChange24h } = outdoor;
    
    // Heat wave adaptation
    if (temp >= this.heatWaveThresholdC) {
      const severity = temp - this.heatWaveThresholdC; // 0-20°C above threshold
      const relaxationPct = Math.min(0.15, severity / 100); // Max 15% relaxation
      
      // Check crop stage - seedlings need stricter control
      const isSeedling = crop && crop.daysSinceSeed <= this.seedlingDaysThreshold;
      const isMature = crop && crop.daysToHarvest <= this.matureCropDaysThreshold;
      
      if (isSeedling) {
        // Seedlings: minimal relaxation (5%)
        const newMax = band.max * (1 + 0.05);
        return {
          adapted: true,
          min: band.min,
          max: newMax,
          target: (band.min + newMax) / 2,
          reason: `Heat wave (${Math.round(temp)}°C) - minimal relaxation for seedlings`,
          energySavingsPct: 5,
          cropImpact: 'minimal',
          confidence: 0.9
        };
      } else if (isMature) {
        // Mature crops: full relaxation (10-15%)
        const newMax = band.max * (1 + relaxationPct);
        return {
          adapted: true,
          min: band.min,
          max: newMax,
          target: (band.min + newMax) / 2,
          reason: `Heat wave (${Math.round(temp)}°C) - relaxed upper bound for mature crop`,
          energySavingsPct: 15 + Math.round(severity),
          cropImpact: 'minimal (near harvest)',
          confidence: 0.85
        };
      } else {
        // Unknown stage: moderate relaxation (10%)
        const newMax = band.max * 1.10;
        return {
          adapted: true,
          min: band.min,
          max: newMax,
          target: (band.min + newMax) / 2,
          reason: `Heat wave (${Math.round(temp)}°C) - moderate upper bound relaxation`,
          energySavingsPct: 10 + Math.round(severity / 2),
          cropImpact: 'low',
          confidence: 0.75
        };
      }
    }
    
    // Cold snap adaptation
    if (temp <= this.coldSnapThresholdC) {
      const severity = this.coldSnapThresholdC - temp; // 0-10°C below threshold
      const relaxationPct = Math.min(0.10, severity / 50); // Max 10% relaxation
      
      const newMin = band.min * (1 - relaxationPct);
      
      return {
        adapted: true,
        min: newMin,
        max: band.max,
        target: (newMin + band.max) / 2,
        reason: `Cold snap (${Math.round(temp)}°C) - relaxed lower bound to reduce heating`,
        energySavingsPct: 10 + Math.round(severity),
        cropImpact: 'minimal',
        confidence: 0.85
      };
    }
    
    // Rapid temperature change adaptation
    if (tempChange24h && Math.abs(tempChange24h) >= this.rapidChangeThresholdC) {
      const direction = tempChange24h > 0 ? 'warming' : 'cooling';
      const widenPct = 0.08; // 8% wider band
      
      const newMin = band.min * (1 - widenPct / 2);
      const newMax = band.max * (1 + widenPct / 2);
      
      return {
        adapted: true,
        min: newMin,
        max: newMax,
        target: band.target,
        reason: `Rapid ${direction} (${Math.abs(Math.round(tempChange24h))}°C/24h) - widened band for adjustment lag`,
        energySavingsPct: 5,
        cropImpact: 'minimal',
        confidence: 0.80
      };
    }
    
    // High outdoor humidity (correlated with indoor RH challenges)
    if (rh && rh >= 85) {
      // Slightly relax upper VPD bound (harder to dehumidify)
      const newMax = band.max * 1.05;
      
      return {
        adapted: true,
        min: band.min,
        max: newMax,
        target: (band.min + newMax) / 2,
        reason: `High outdoor humidity (${Math.round(rh)}%) - relaxed upper bound`,
        energySavingsPct: 5,
        cropImpact: 'minimal',
        confidence: 0.75
      };
    }
    
    return { adapted: false };
  }
  
  /**
   * Energy-based VPD adaptation
   */
  _adaptForEnergy(band, facility) {
    const { energyCost, hour } = facility;
    
    // Peak demand hour adaptation
    const isPeakHour = this.peakDemandHours.includes(hour ?? new Date().getHours());
    
    if (isPeakHour && energyCost > 0.25) { // High energy cost (>$0.25/kWh)
      // Widen band by 10% during peak demand
      const widenPct = 0.10;
      const newMin = band.min * (1 - widenPct / 2);
      const newMax = band.max * (1 + widenPct / 2);
      
      return {
        adapted: true,
        min: newMin,
        max: newMax,
        target: band.target,
        reason: `Peak demand hour ($${energyCost}/kWh) - widened band to reduce HVAC load`,
        energySavingsPct: 8,
        confidence: 0.90
      };
    }
    
    return { adapted: false };
  }
  
  /**
   * Facility capacity adaptation
   */
  _adaptForCapacity(band, facility, crop) {
    const { hvacLoad } = facility;
    
    // HVAC near capacity (>80%)
    if (hvacLoad >= 0.80) {
      const isMature = crop && crop.daysToHarvest <= this.matureCropDaysThreshold;
      
      if (isMature) {
        // Mature crop: relax upper bound significantly
        const newMax = band.max * 1.12;
        
        return {
          adapted: true,
          min: band.min,
          max: newMax,
          target: (band.min + newMax) / 2,
          reason: `HVAC near capacity (${Math.round(hvacLoad * 100)}%) - relaxed for mature crop`,
          energySavingsPct: 12,
          cropImpact: 'minimal (near harvest)',
          confidence: 0.85
        };
      } else {
        // Unknown stage: moderate relaxation
        const newMax = band.max * 1.06;
        
        return {
          adapted: true,
          min: band.min,
          max: newMax,
          target: (band.min + newMax) / 2,
          reason: `HVAC near capacity (${Math.round(hvacLoad * 100)}%) - moderate relaxation`,
          energySavingsPct: 6,
          cropImpact: 'low',
          confidence: 0.75
        };
      }
    }
    
    return { adapted: false };
  }
  
  /**
   * Generate cache key for decision memoization
   */
  _getCacheKey(params) {
    const { recipe, outdoor, crop, facility } = params;
    
    return JSON.stringify({
      recipe: { min: recipe.min, max: recipe.max, target: recipe.target },
      outdoor: outdoor ? { 
        temp: Math.round(outdoor.temp), 
        rh: Math.round(outdoor.rh ?? 0),
        tempChange: Math.round(outdoor.tempChange24h ?? 0)
      } : null,
      crop: crop ? {
        daysSinceSeed: crop.daysSinceSeed ?? null,
        daysToHarvest: crop.daysToHarvest ?? null
      } : null,
      facility: facility ? {
        hvacLoad: Math.round((facility.hvacLoad ?? 0) * 10) / 10,
        energyCost: Math.round((facility.energyCost ?? 0) * 100) / 100,
        hour: facility.hour ?? new Date().getHours()
      } : null
    });
  }
  
  /**
   * Clear decision cache (useful for testing)
   */
  clearCache() {
    this.decisionCache.clear();
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      size: this.decisionCache.size,
      entries: Array.from(this.decisionCache.entries()).map(([key, value]) => ({
        key,
        age: Date.now() - value.timestamp,
        decision: value.decision
      }))
    };
  }
}
