/**
 * Harvest Prediction Service
 * 
 * Predicts harvest dates based on:
 * - Seed date and crop type
 * - Historical harvest data (actual vs planned)
 * - Environmental conditions (temp, humidity, light)
 * - Growth stage progression
 * 
 * Framework Alignment:
 * - Zero-Entry Data: Uses existing harvest log data
 * - Database-Driven: Crop durations from lighting recipes
 * - Simplicity: Single prediction call, no configuration
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crop registry cache for CCA strategy lookup
let _cropRegistryCache = null;
function loadCropRegistry(dataDir) {
  if (_cropRegistryCache) return _cropRegistryCache;
  try {
    const regPath = path.join(dataDir, 'crop-registry.json');
    if (fs.existsSync(regPath)) {
      const data = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
      _cropRegistryCache = data.crops || {};
    } else {
      _cropRegistryCache = {};
    }
  } catch (e) {
    _cropRegistryCache = {};
  }
  return _cropRegistryCache;
}

function lookupCCAStrategy(crop, dataDir) {
  const registry = loadCropRegistry(dataDir);
  const cropLower = crop.toLowerCase();
  for (const [key, entry] of Object.entries(registry)) {
    if (entry.growth?.harvestStrategy === 'cut_and_come_again') {
      if (key.toLowerCase() === cropLower || cropLower.includes(key.toLowerCase()) || key.toLowerCase().includes(cropLower)) {
        return {
          strategy: 'cut_and_come_again',
          maxHarvests: entry.growth.maxHarvests || 4,
          regrowthDays: entry.growth.regrowthDays || 14,
          regrowthYieldFactor: entry.growth.regrowthYieldFactor || 0.85
        };
      }
    }
  }
  return null;
}

// Crop baseline durations (days to harvest) from commercial CEA standards
const CROP_DURATIONS = {
  // Lettuce varieties (25-35 days)
  'Butterhead Lettuce': 32,
  'Buttercrunch Lettuce': 32,
  'Bibb Butterhead': 32,
  'Romaine Lettuce': 35,
  'Red Leaf Lettuce': 30,
  'Oak Leaf Lettuce': 30,
  'Mixed Lettuce': 30,
  
  // Kale varieties (28-40 days)
  'Lacinato Kale': 40,
  'Curly Kale': 38,
  'Dinosaur Kale': 40,
  'Baby Kale': 28,
  'Red Russian Kale': 38,
  
  // Asian Greens (28-30 days)
  'Mei Qing Pak Choi': 30,
  'Tatsoi': 28,
  
  // Specialty Greens (25-35 days)
  'Frisée Endive': 35,
  'Watercress': 25,
  
  // Arugula varieties (21-28 days)
  'Baby Arugula': 21,
  'Cultivated Arugula': 24,
  'Wild Arugula': 28,
  'Wasabi Arugula': 24,
  'Red Arugula': 24,
  
  // Basil varieties (24-26 days)
  'Genovese Basil': 25,
  'Thai Basil': 25,
  'Purple Basil': 25,
  'Lemon Basil': 24,
  'Holy Basil': 26,
  
  // Generic fallbacks
  'Lettuce': 32,
  'Basil': 25,
  'Arugula': 24,
  'Kale': 38
};

export class HarvestPredictor {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.harvestLogPath = path.join(dataDir, 'harvest-log.json');
    this.groupsPath = path.join(dataDir, 'groups.json');
    
    // Cache for historical variance data
    this.cropVarianceCache = null;
    this.cacheTimestamp = null;
    this.cacheTTL = 3600000; // 1 hour
  }

  /**
   * Predict harvest date for a group
   * 
   * @param {string} groupId - Group identifier
   * @param {object} options - Optional environmental modifiers
   * @returns {object} Prediction with date, confidence, factors
   */
  async predict(groupId, options = {}) {
    try {
      // Load group data
      const group = await this.getGroup(groupId);
      if (!group) {
        throw new Error(`Group ${groupId} not found`);
      }

      // Get seed date from anchor
      const seedDate = this.extractSeedDate(group);
      if (!seedDate) {
        throw new Error(`No seed date found for group ${groupId}`);
      }

      // Get crop-specific duration
      const crop = group.crop || 'Unknown';
      const baselineDays = this.getCropDuration(crop);

      // Calculate historical variance for this crop
      const variance = await this.getHistoricalVariance(crop);

      // Environmental modifiers (if provided)
      const envModifier = this.calculateEnvironmentalModifier(options);

      // Calculate adjusted duration
      const adjustedDays = Math.round(baselineDays + variance + envModifier);
      
      // Calculate predicted harvest date
      const predictedDate = new Date(seedDate);
      predictedDate.setDate(predictedDate.getDate() + adjustedDays);

      // Calculate days remaining
      const now = new Date();
      const daysRemaining = Math.ceil((predictedDate - now) / (1000 * 60 * 60 * 24));

      // Calculate confidence based on historical data quality
      const confidence = this.calculateConfidence(crop, variance);

      // Determine factors influencing prediction
      const factors = this.identifyFactors(crop, variance, envModifier);

      // Check for CCA (Cut and Come Again) strategy
      const ccaInfo = lookupCCAStrategy(crop, this.dataDir);
      const harvestCycle = group.planConfig?.harvestCycle || null;

      // Build regrowth harvest dates for CCA crops
      let regrowthHarvests = null;
      if (ccaInfo) {
        const maxH = harvestCycle?.maxHarvests || ccaInfo.maxHarvests;
        const regrowthDays = harvestCycle?.regrowthDays || ccaInfo.regrowthDays;
        const yieldFactor = harvestCycle?.regrowthYieldFactor || ccaInfo.regrowthYieldFactor;
        const currentHarvest = harvestCycle?.currentHarvest || 0;
        regrowthHarvests = [];
        for (let i = 0; i < maxH; i++) {
          const hDate = new Date(predictedDate);
          hDate.setDate(hDate.getDate() + i * regrowthDays);
          regrowthHarvests.push({
            harvestNumber: i + 1,
            date: hDate.toISOString(),
            daysFromSeed: adjustedDays + i * regrowthDays,
            yieldFactor: Math.pow(yieldFactor, i),
            status: i < currentHarvest ? 'completed' : (i === currentHarvest ? 'next' : 'future')
          });
        }
      }

      return {
        groupId,
        crop,
        seedDate: seedDate.toISOString(),
        predictedDate: predictedDate.toISOString(),
        daysRemaining,
        confidence,
        factors,
        baseline: {
          days: baselineDays,
          source: 'crop_database'
        },
        adjustments: {
          historical: variance,
          environmental: envModifier,
          total: variance + envModifier
        },
        // CCA fields
        harvestStrategy: ccaInfo ? ccaInfo.strategy : 'single_harvest',
        regrowthHarvests: regrowthHarvests,
        ccaInfo: ccaInfo ? {
          maxHarvests: ccaInfo.maxHarvests,
          regrowthDays: ccaInfo.regrowthDays,
          regrowthYieldFactor: ccaInfo.regrowthYieldFactor,
          currentHarvest: harvestCycle?.currentHarvest || 0,
          totalProductionDays: adjustedDays + (ccaInfo.maxHarvests - 1) * ccaInfo.regrowthDays
        } : null
      };

    } catch (error) {
      console.error('[HarvestPredictor] Error:', error);
      throw error;
    }
  }

  /**
   * Get group data
   */
  async getGroup(groupId) {
    if (!fs.existsSync(this.groupsPath)) {
      return null;
    }

    const data = JSON.parse(fs.readFileSync(this.groupsPath, 'utf-8'));
    const groups = data.groups || [];
    return groups.find(g => g.id === groupId);
  }

  /**
   * Extract seed date from group anchor configuration
   */
  extractSeedDate(group) {
    if (!group.planConfig || !group.planConfig.anchor) {
      return null;
    }

    const anchor = group.planConfig.anchor;
    
    if (anchor.seedDate) {
      return new Date(anchor.seedDate);
    }

    // Handle different anchor modes
    if (anchor.mode === 'harvestDate' && anchor.harvestDate) {
      // Work backwards from harvest date
      const harvestDate = new Date(anchor.harvestDate);
      const crop = group.crop || 'Unknown';
      const duration = this.getCropDuration(crop);
      const seedDate = new Date(harvestDate);
      seedDate.setDate(seedDate.getDate() - duration);
      return seedDate;
    }

    return null;
  }

  /**
   * Get crop duration from database
   */
  getCropDuration(crop) {
    // Try exact match first
    if (CROP_DURATIONS[crop]) {
      return CROP_DURATIONS[crop];
    }

    // Try partial match (e.g., "Butterhead" matches "Butterhead Lettuce")
    const cropLower = crop.toLowerCase();
    for (const [key, value] of Object.entries(CROP_DURATIONS)) {
      if (key.toLowerCase().includes(cropLower) || cropLower.includes(key.toLowerCase())) {
        return value;
      }
    }

    // Default fallback
    return 30;
  }

  /**
   * Calculate historical variance for crop type
   * Returns average deviation from planned harvest (days)
   */
  async getHistoricalVariance(crop) {
    // Check cache
    if (this.cropVarianceCache && this.cacheTimestamp && 
        (Date.now() - this.cacheTimestamp) < this.cacheTTL) {
      return this.cropVarianceCache[crop] || 0;
    }

    // Rebuild cache
    this.cropVarianceCache = await this.buildVarianceCache();
    this.cacheTimestamp = Date.now();

    return this.cropVarianceCache[crop] || 0;
  }

  /**
   * Build crop variance cache from harvest log
   */
  async buildVarianceCache() {
    const cache = {};

    if (!fs.existsSync(this.harvestLogPath)) {
      return cache;
    }

    const log = JSON.parse(fs.readFileSync(this.harvestLogPath, 'utf-8'));
    const harvests = log.harvests || [];

    // Group by crop
    const byCrop = {};
    harvests.forEach(h => {
      if (!h.crop || h.variance === undefined) return;
      
      if (!byCrop[h.crop]) {
        byCrop[h.crop] = [];
      }
      byCrop[h.crop].push(h.variance);
    });

    // Calculate average variance per crop
    for (const [crop, variances] of Object.entries(byCrop)) {
      if (variances.length > 0) {
        const avg = variances.reduce((sum, v) => sum + v, 0) / variances.length;
        cache[crop] = Math.round(avg * 10) / 10; // Round to 1 decimal
      }
    }

    return cache;
  }

  /**
   * Calculate environmental modifier based on current conditions
   * Positive = longer growth, Negative = faster growth
   */
  calculateEnvironmentalModifier(options) {
    let modifier = 0;

    // Temperature modifier (±2 days per 5°C deviation from optimal)
    if (options.avgTemp !== undefined) {
      const optimalTemp = 22; // °C (optimal for most leafy greens)
      const tempDeviation = options.avgTemp - optimalTemp;
      
      if (tempDeviation < 0) {
        // Colder = slower growth
        modifier += Math.abs(tempDeviation) * 0.4; // 2 days per 5°C
      } else if (tempDeviation > 3) {
        // Too hot = stress, slower growth
        modifier += tempDeviation * 0.3;
      }
    }

    // Light intensity modifier (±1 day per 20% deviation from target)
    if (options.avgPPFD !== undefined && options.targetPPFD !== undefined) {
      const ppfdRatio = options.avgPPFD / options.targetPPFD;
      
      if (ppfdRatio < 0.8) {
        // Low light = slower growth
        modifier += (1 - ppfdRatio) * 2.5; // Up to +2.5 days at 50% light
      }
    }

    return Math.round(modifier * 10) / 10; // Round to 1 decimal
  }

  /**
   * Calculate confidence score (0-1)
   * Based on:
   * - Number of historical samples
   * - Consistency of variance
   * - Environmental data availability
   */
  calculateConfidence(crop, variance) {
    let confidence = 0.7; // Base confidence

    // Check historical data quality
    if (this.cropVarianceCache) {
      const variances = this.getHistoricalVariances(crop);
      const sampleCount = variances.length;

      if (sampleCount >= 10) {
        confidence += 0.2; // High sample size
      } else if (sampleCount >= 5) {
        confidence += 0.1; // Moderate sample size
      }

      // Check consistency (lower std dev = higher confidence)
      if (sampleCount > 1) {
        const stdDev = this.calculateStdDev(variances);
        if (stdDev < 2) {
          confidence += 0.1; // Very consistent
        } else if (stdDev < 4) {
          confidence += 0.05; // Somewhat consistent
        }
      }
    }

    return Math.min(0.99, Math.round(confidence * 100) / 100);
  }

  /**
   * Get all historical variances for a crop
   */
  getHistoricalVariances(crop) {
    if (!fs.existsSync(this.harvestLogPath)) {
      return [];
    }

    const log = JSON.parse(fs.readFileSync(this.harvestLogPath, 'utf-8'));
    const harvests = log.harvests || [];

    return harvests
      .filter(h => h.crop === crop && h.variance !== undefined)
      .map(h => h.variance);
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(values) {
    if (values.length === 0) return 0;
    
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Identify factors influencing prediction
   */
  identifyFactors(crop, variance, envModifier) {
    const factors = [];

    // Baseline factor
    factors.push('crop_type');

    // Historical factor
    if (variance !== 0) {
      const direction = variance > 0 ? 'slower' : 'faster';
      factors.push(`historical_${direction}`);
    }

    // Environmental factor
    if (envModifier > 0) {
      factors.push('environmental_stress');
    } else if (envModifier < 0) {
      factors.push('optimal_conditions');
    }

    return factors;
  }

  /**
   * Batch predict for multiple groups
   */
  async predictMultiple(groupIds, options = {}) {
    const predictions = [];

    for (const groupId of groupIds) {
      try {
        const prediction = await this.predict(groupId, options);
        predictions.push(prediction);
      } catch (error) {
        predictions.push({
          groupId,
          error: error.message
        });
      }
    }

    return predictions;
  }

  /**
   * Get all active groups that need predictions
   */
  async getActiveGroups() {
    if (!fs.existsSync(this.groupsPath)) {
      return [];
    }

    const data = JSON.parse(fs.readFileSync(this.groupsPath, 'utf-8'));
    const groups = data.groups || [];

    // Filter to groups with seed dates and no harvest date yet
    return groups.filter(g => {
      const seedDate = this.extractSeedDate(g);
      return seedDate && !g.harvestedDate;
    });
  }
}

export { lookupCCAStrategy };
export default HarvestPredictor;
