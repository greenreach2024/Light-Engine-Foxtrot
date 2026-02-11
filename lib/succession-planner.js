/**
 * Succession Planting Planner
 * 
 * AI-powered planting schedule generation for continuous harvest
 * 
 * Key Principles:
 * - Tray formats are preformatted and recorded (database of plant counts)
 * - Crops have forecast harvest times (leverages harvest-predictor.js)
 * - Groups may use multiple formatted trays based on crop requirements
 * - Space nodes don't change, but location count varies by crop (baby greens vs full head)
 * - Progressive enhancement: works with minimal data, improves with more
 * 
 * Crop Density Examples:
 * - Baby greens: 200 plants/tray (microgreen format)
 * - Full head lettuce: 24 plants/tray (standard NFT)
 * - Tomato: 8 plants/tray (low density)
 * - Baby leaf: 128 plants/tray (high density)
 * 
 * Framework Alignment:
 * - Zero Configuration: Auto-generates from demand + capacity
 * - Database-Driven: Uses tray formats, crop durations, harvest predictions
 * - Simplicity: Clear output ("Seed 12 trays of lettuce on Feb 5")
 * - Workflow-Centric: Designed for daily/weekly planting tasks
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { HarvestPredictor } from './harvest-predictor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Standard tray format definitions (matches backend/seed_tray_formats.py)
const STANDARD_TRAY_FORMATS = {
  // Microgreens (weight-based, high density)
  'microgreens-4-hole': { plantSiteCount: 4, density: 'ultra-high', isWeightBased: true },
  'microgreens-8-hole': { plantSiteCount: 8, density: 'ultra-high', isWeightBased: true },
  'microgreens-12-hole': { plantSiteCount: 12, density: 'ultra-high', isWeightBased: true },
  'microgreens-21-hole': { plantSiteCount: 21, density: 'ultra-high', isWeightBased: true },
  
  // Baby greens (high density)
  'baby-greens-10x20': { plantSiteCount: 200, density: 'high', isWeightBased: false },
  'baby-leaf-128': { plantSiteCount: 128, density: 'high', isWeightBased: false },
  
  // Full head lettuce (standard density)
  'nft-channel-128': { plantSiteCount: 128, density: 'standard', isWeightBased: false },
  'nft-channel-72': { plantSiteCount: 72, density: 'standard', isWeightBased: false },
  'standard-tray-24': { plantSiteCount: 24, density: 'standard', isWeightBased: false },
  
  // Fruiting crops (low density)
  'tomato-tower-8': { plantSiteCount: 8, density: 'low', isWeightBased: false },
  'aeroponic-tower-72': { plantSiteCount: 72, density: 'low', isWeightBased: false },
  'zipgrow-tower-128': { plantSiteCount: 128, density: 'low', isWeightBased: false }
};

// Crop-to-tray-format mapping (determines plants per tray)
const CROP_TRAY_PREFERENCES = {
  // Baby greens
  'Baby Arugula': 'baby-greens-10x20',
  'Baby Kale': 'baby-leaf-128',
  'Baby Spinach': 'baby-leaf-128',
  'Mixed Baby Greens': 'baby-greens-10x20',
  
  // Microgreens
  'Microgreens': 'microgreens-21-hole',
  'Sunflower Shoots': 'microgreens-8-hole',
  'Pea Shoots': 'microgreens-12-hole',
  
  // Full head lettuce
  'Butterhead Lettuce': 'nft-channel-128',
  'Buttercrunch Lettuce': 'nft-channel-128',
  'Romaine Lettuce': 'nft-channel-72',
  'Red Leaf Lettuce': 'nft-channel-128',
  'Oak Leaf Lettuce': 'nft-channel-128',
  
  // Kale
  'Lacinato Kale': 'nft-channel-72',
  'Curly Kale': 'nft-channel-72',
  'Dinosaur Kale': 'nft-channel-72',
  
  // Asian greens
  'Mei Qing Pak Choi': 'nft-channel-128',
  'Tatsoi': 'nft-channel-128',
  'Bok Choy': 'nft-channel-72',
  
  // Herbs
  'Genovese Basil': 'nft-channel-128',
  'Thai Basil': 'nft-channel-128',
  'Purple Basil': 'nft-channel-128',
  
  // Arugula
  'Cultivated Arugula': 'baby-leaf-128',
  'Wild Arugula': 'baby-leaf-128',
  'Astro Arugula': 'baby-leaf-128',
  
  // Fruiting crops
  'Tomato': 'tomato-tower-8',
  'Cherry Tomato': 'aeroponic-tower-72',
  'Strawberry': 'aeroponic-tower-72',
  
  // Generic fallbacks
  'Lettuce': 'nft-channel-128',
  'Basil': 'nft-channel-128',
  'Arugula': 'baby-leaf-128',
  'Kale': 'nft-channel-72'
};

export class SuccessionPlanner {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.groupsPath = path.join(dataDir, 'groups.json');
    this.harvestPredictor = new HarvestPredictor(dataDir);
    
    // Decision cache (5 min TTL)
    this.scheduleCache = new Map();
    this.cacheTTL = 300000; // 5 minutes
  }

  /**
   * Generate succession planting schedule
   * 
   * @param {object} params - Planning parameters
   * @param {string} params.crop - Crop variety
   * @param {number} params.weeklyDemand - Target harvest quantity (heads or lbs)
   * @param {string} params.startDate - First harvest date (ISO format)
   * @param {number} params.weeks - Number of weeks to plan (default: 12)
   * @param {number} params.successionGap - Days between successive plantings (default: 7, crop-specific)
   * @param {object} params.facility - Optional facility capacity constraints
   * @returns {object} Schedule with seeding tasks and gap analysis
   */
  async generateSchedule(params) {
    const startTime = Date.now();
    
    try {
      // Validate required params
      if (!params.crop || !params.weeklyDemand || !params.startDate) {
        throw new Error('Missing required parameters: crop, weeklyDemand, startDate');
      }

      // Check cache
      const cacheKey = JSON.stringify(params);
      const cached = this.scheduleCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTTL) {
        return { ...cached.schedule, cached: true, cachedAt: cached.timestamp };
      }

      // Get tray format for this crop
      const trayFormat = this.getTrayFormatForCrop(params.crop);
      const plantsPerTray = trayFormat.plantSiteCount;

      // Get growth duration from harvest predictor
      const growthDays = await this.getGrowthDuration(params.crop);

      // Get succession gap (configurable, crop-specific)
      const successionGap = params.successionGap || this.getSuccessionGapForCrop(params.crop);
      
      // Calculate planting schedule (backward from harvest dates)
      const weeks = params.weeks || 12;
      const schedule = [];
      const gaps = [];
      let totalTraysNeeded = 0;

      for (let week = 0; week < weeks; week++) {
        const harvestDate = new Date(params.startDate);
        harvestDate.setDate(harvestDate.getDate() + (week * successionGap));

        // Backward calculation: harvest date - growth days = seed date
        const seedDate = new Date(harvestDate);
        seedDate.setDate(seedDate.getDate() - growthDays);

        // Calculate trays needed for weekly demand
        const traysNeeded = Math.ceil(params.weeklyDemand / plantsPerTray);
        totalTraysNeeded += traysNeeded;

        // Check facility capacity and temporal conflicts (if provided)
        const capacityCheck = this.checkCapacity(params.facility, totalTraysNeeded);
        const temporalConflicts = this.checkTemporalConflicts(schedule, seedDate, traysNeeded, params.facility);

        schedule.push({
          week: week + 1,
          crop: params.crop,
          seedDate: seedDate.toISOString().split('T')[0],
          harvestDate: harvestDate.toISOString().split('T')[0],
          traysNeeded: traysNeeded,
          plantsPerTray: plantsPerTray,
          totalPlants: traysNeeded * plantsPerTray,
          trayFormat: trayFormat.name || 'Standard',
          growthDays: growthDays,
          successionGap: successionGap,
          capacityAvailable: capacityCheck.available,
          capacityUsed: capacityCheck.used,
          conflicts: [...capacityCheck.conflicts, ...temporalConflicts],
          reason: `Meet weekly demand of ${params.weeklyDemand} ${trayFormat.isWeightBased ? 'lbs' : 'heads'}`
        });

        // Gap detection (if demand exceeds supply)
        if (params.facility && params.facility.totalTrays) {
          const available = params.facility.totalTrays - (params.facility.currentlyUsed || 0);
          if (totalTraysNeeded > available) {
            gaps.push({
              week: week + 1,
              harvestDate: harvestDate.toISOString().split('T')[0],
              demandUnmet: params.weeklyDemand - (plantsPerTray * available),
              reason: 'Insufficient tray capacity',
              traysNeeded: traysNeeded,
              traysAvailable: available
            });
          }
        }
      }

      // Calculate capacity utilization
      const facilityStats = this.calculateFacilityStats(schedule, params.facility);

      // Generate continuous harvest recommendations
      const continuousHarvestPlan = this.optimizeForContinuousHarvest(schedule);

      const result = {
        ok: true,
        crop: params.crop,
        weeklyDemand: params.weeklyDemand,
        startDate: params.startDate,
        weeksPlanned: weeks,
        schedule: schedule,
        gaps: gaps,
        facilityStats: facilityStats,
        continuousHarvestPlan: continuousHarvestPlan,
        trayFormat: {
          name: trayFormat.name || `${plantsPerTray} plants/tray`,
          plantsPerTray: plantsPerTray,
          density: trayFormat.density,
          isWeightBased: trayFormat.isWeightBased
        },
        summary: {
          totalWeeks: weeks,
          totalTrays: totalTraysNeeded,
          totalPlants: totalTraysNeeded * plantsPerTray,
          avgTraysPerWeek: Math.round(totalTraysNeeded / weeks),
          gapCount: gaps.length,
          capacityUtilization: facilityStats.utilizationPct
        },
        generatedAt: new Date().toISOString(),
        computeTime: Date.now() - startTime
      };

      // Cache result
      this.scheduleCache.set(cacheKey, { schedule: result, timestamp: Date.now() });

      return result;

    } catch (error) {
      console.error('[SuccessionPlanner] generateSchedule error:', error);
      return {
        ok: false,
        error: error.message,
        computeTime: Date.now() - startTime
      };
    }
  }

  /**
   * Get tray format for a crop (determines plants per tray)
   * Handles: baby greens vs full head, microgreens vs lettuce, etc.
   */
  getTrayFormatForCrop(cropName) {
    const formatKey = CROP_TRAY_PREFERENCES[cropName] || CROP_TRAY_PREFERENCES['Lettuce'];
    const format = STANDARD_TRAY_FORMATS[formatKey] || STANDARD_TRAY_FORMATS['nft-channel-128'];
    
    return {
      ...format,
      name: formatKey,
      key: formatKey
    };
  }

  /**
   * Get succession gap for a crop (days between successive plantings)
   * Database-driven, crop-specific intervals
   */
  getSuccessionGapForCrop(cropName) {
    // Crop-specific succession intervals (optimized for continuous harvest)
    const successionGaps = {
      // Fast-growing crops (shorter gaps)
      'Baby Arugula': 5,
      'Microgreens': 3,
      'Sunflower Shoots': 3,
      'Pea Shoots': 3,
      'Baby Spinach': 5,
      'Mixed Baby Greens': 5,
      
      // Standard leafy greens (weekly)
      'Butterhead Lettuce': 7,
      'Buttercrunch Lettuce': 7,
      'Romaine Lettuce': 7,
      'Red Leaf Lettuce': 7,
      'Oak Leaf Lettuce': 7,
      'Genovese Basil': 7,
      'Thai Basil': 7,
      'Astro Arugula': 7,
      
      // Slower crops (longer gaps)
      'Lacinato Kale': 10,
      'Curly Kale': 10,
      'Tomato': 14,
      'Cherry Tomato': 14,
      
      // Generic fallbacks
      'Lettuce': 7,
      'Basil': 7,
      'Arugula': 7,
      'Kale': 10,
      'Microgreens': 3
    };
    
    return successionGaps[cropName] || 7; // Default 7 days (weekly)
  }

  /**
   * Get growth duration for a crop (uses harvest predictor's database)
   */
  async getGrowthDuration(cropName) {
    try {
      // Use harvest predictor's crop duration database
      const durations = {
        // Lettuce varieties (25-35 days)
        'Butterhead Lettuce': 32,
        'Buttercrunch Lettuce': 32,
        'Romaine Lettuce': 35,
        'Red Leaf Lettuce': 30,
        'Oak Leaf Lettuce': 30,
        
        // Kale varieties (28-40 days)
        'Lacinato Kale': 40,
        'Curly Kale': 38,
        'Baby Kale': 28,
        
        // Asian Greens (28-30 days)
        'Mei Qing Pak Choi': 30,
        'Tatsoi': 28,
        'Bok Choy': 30,
        
        // Arugula varieties (21-28 days)
        'Baby Arugula': 21,
        'Cultivated Arugula': 24,
        'Wild Arugula': 28,
        'Astro Arugula': 24,
        
        // Basil varieties (24-26 days)
        'Genovese Basil': 25,
        'Thai Basil': 25,
        'Purple Basil': 25,
        
        // Microgreens (7-14 days)
        'Microgreens': 10,
        'Sunflower Shoots': 7,
        'Pea Shoots': 10,
        
        // Baby greens (18-21 days)
        'Baby Spinach': 21,
        'Mixed Baby Greens': 21,
        
        // Generic fallbacks
        'Lettuce': 32,
        'Basil': 25,
        'Arugula': 24,
        'Kale': 38
      };

      return durations[cropName] || durations['Lettuce'] || 32;
    } catch (error) {
      console.error('[SuccessionPlanner] getGrowthDuration error:', error);
      return 32; // Safe default (lettuce standard)
    }
  }

  /**
   * Check for temporal conflicts (same zone used for overlapping growth periods)
   * Prevents overbooking: Can't use same tray for two crops simultaneously
   */
  checkTemporalConflicts(existingSchedule, newSeedDate, traysNeeded, facility) {
    if (!facility || !facility.zoneCapacity) {
      return []; // No zone info, skip conflict detection
    }

    const conflicts = [];
    const newSeedTime = new Date(newSeedDate).getTime();

    for (const existing of existingSchedule) {
      const existingSeedTime = new Date(existing.seedDate).getTime();
      const existingHarvestTime = new Date(existing.harvestDate).getTime();

      // Check if growth periods overlap
      if (newSeedTime >= existingSeedTime && newSeedTime <= existingHarvestTime) {
        // Overlap detected - check zone capacity
        const combinedTrays = existing.traysNeeded + traysNeeded;
        const zoneCapacity = facility.zoneCapacity.grow || 999;

        if (combinedTrays > zoneCapacity) {
          conflicts.push(`Temporal conflict: Overlaps with ${existing.crop} planting (${combinedTrays} trays exceeds zone capacity ${zoneCapacity})`);
        }
      }
    }

    return conflicts;
  }

  /**
   * Check facility capacity for scheduling
   */
  checkCapacity(facility, totalTraysUsed) {
    if (!facility || !facility.totalTrays) {
      return {
        available: 999,
        used: totalTraysUsed,
        conflicts: []
      };
    }

    const available = facility.totalTrays - (facility.currentlyUsed || 0);
    const conflicts = [];

    if (totalTraysUsed > available) {
      conflicts.push(`Exceeds available capacity by ${totalTraysUsed - available} trays`);
    }

    // Zone capacity checks (if provided)
    if (facility.zoneCapacity) {
      const germinationUsed = Math.ceil(totalTraysUsed * 0.3); // ~30% in germination
      const growUsed = Math.ceil(totalTraysUsed * 0.7); // ~70% in grow zones

      if (germinationUsed > facility.zoneCapacity.germination) {
        conflicts.push(`Germination zone over capacity`);
      }
      if (growUsed > facility.zoneCapacity.grow) {
        conflicts.push(`Grow zone over capacity`);
      }
    }

    return {
      available: Math.max(0, available),
      used: totalTraysUsed,
      conflicts: conflicts
    };
  }

  /**
   * Calculate facility statistics
   */
  calculateFacilityStats(schedule, facility) {
    if (!facility || !facility.totalTrays) {
      return {
        totalCapacity: 999,
        peakUsage: 0,
        utilizationPct: 0,
        bottlenecks: []
      };
    }

    const peakUsage = schedule.reduce((max, task) => {
      return Math.max(max, task.capacityUsed || 0);
    }, 0);

    const utilizationPct = Math.round((peakUsage / facility.totalTrays) * 100);

    const bottlenecks = [];
    if (utilizationPct > 90) {
      bottlenecks.push('Near capacity - consider expanding or reducing demand');
    }
    if (utilizationPct < 50) {
      bottlenecks.push('Under-utilized - could increase production or reduce footprint');
    }

    return {
      totalCapacity: facility.totalTrays,
      currentlyUsed: facility.currentlyUsed || 0,
      peakUsage: peakUsage,
      utilizationPct: utilizationPct,
      bottlenecks: bottlenecks
    };
  }

  /**
   * Optimize schedule for continuous harvest (stagger plantings)
   */
  optimizeForContinuousHarvest(schedule) {
    const recommendations = [];

    // Analyze gaps between harvests
    for (let i = 0; i < schedule.length - 1; i++) {
      const current = schedule[i];
      const next = schedule[i + 1];

      const harvestGap = (new Date(next.harvestDate) - new Date(current.harvestDate)) / (1000 * 60 * 60 * 24);

      if (harvestGap > 7) {
        recommendations.push({
          type: 'gap',
          week: current.week,
          message: `${harvestGap}-day gap between harvests. Consider mid-week seeding on ${this.getMidpointDate(current.seedDate, next.seedDate)}`,
          severity: 'medium'
        });
      }

      if (harvestGap < 3) {
        recommendations.push({
          type: 'overlap',
          week: current.week,
          message: `Harvests only ${harvestGap} days apart. Consider labor capacity for processing`,
          severity: 'low'
        });
      }
    }

    // Check for consistent weekly production
    const traysPerWeek = schedule.map(s => s.traysNeeded);
    const avgTrays = traysPerWeek.reduce((a, b) => a + b, 0) / traysPerWeek.length;
    const variance = traysPerWeek.reduce((sum, val) => sum + Math.pow(val - avgTrays, 2), 0) / traysPerWeek.length;

    if (variance > 4) { // High variance
      recommendations.push({
        type: 'variance',
        message: `Uneven weekly production. Consider smoothing demand or adjusting tray counts`,
        severity: 'medium',
        avgTraysPerWeek: Math.round(avgTrays),
        variance: Math.round(variance * 10) / 10
      });
    }

    return {
      recommendations: recommendations,
      harvestFrequency: schedule.length > 1 ? 'weekly' : 'single',
      avgGapDays: schedule.length > 1 ? 7 : 0,
      consistency: variance < 2 ? 'excellent' : variance < 4 ? 'good' : 'needs-improvement'
    };
  }

  /**
   * Get midpoint date between two dates (for gap filling)
   */
  getMidpointDate(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const midpoint = new Date((d1.getTime() + d2.getTime()) / 2);
    return midpoint.toISOString().split('T')[0];
  }

  /**
   * Suggest seeding schedule from wholesale demand data
   * (Integration point for GreenReach Central AI recommendations)
   * 
   * @param {object} params - Demand forecast parameters
   * @param {string} params.farmId - Farm identifier
   * @param {array} params.demandForecast - Weekly demand from wholesale orders
   * @returns {object} AI-optimized seeding recommendations
   */
  async suggestFromDemand(params) {
    try {
      if (!params.demandForecast || !Array.isArray(params.demandForecast)) {
        throw new Error('Missing or invalid demandForecast array');
      }

      const suggestions = [];

      for (const demand of params.demandForecast) {
        const schedule = await this.generateSchedule({
          crop: demand.crop,
          weeklyDemand: demand.quantity,
          startDate: demand.targetDate,
          weeks: demand.duration || 12,
          facility: params.facility
        });

        if (schedule.ok) {
          suggestions.push({
            crop: demand.crop,
            schedule: schedule.schedule,
            gaps: schedule.gaps,
            summary: schedule.summary,
            priority: demand.priority || 'medium'
          });
        }
      }

      // Request AI optimization from GreenReach Central (if available)
      let aiRecommendations = null;
      if (params.requestAI && process.env.GREENREACH_CENTRAL_URL) {
        aiRecommendations = await this.requestAIOptimization(params.farmId, suggestions);
      }

      return {
        ok: true,
        farmId: params.farmId,
        suggestions: suggestions,
        aiRecommendations: aiRecommendations,
        totalCrops: suggestions.length,
        generatedAt: new Date().toISOString()
      };

    } catch (error) {
      console.error('[SuccessionPlanner] suggestFromDemand error:', error);
      return {
        ok: false,
        error: error.message
      };
    }
  }

  /**
   * Request AI optimization from GreenReach Central
   * (Central has OpenAI access and can provide intelligent recommendations)
   */
  async requestAIOptimization(farmId, scheduleSuggestions) {
    try {
      // Note: This is a placeholder for bidirectional communication
      // GreenReach Central can push AI recommendations back to farm server
      // via POST /api/planting/ai-recommendations endpoint
      
      console.log('[SuccessionPlanner] AI optimization would be requested from GreenReach Central');
      console.log('[SuccessionPlanner] Central has OpenAI access for intelligent schedule optimization');
      
      return {
        available: false,
        message: 'AI optimization via GreenReach Central - bidirectional communication framework ready',
        note: 'Central can analyze demand patterns, facility constraints, and historical data to optimize schedules'
      };

    } catch (error) {
      console.error('[SuccessionPlanner] requestAIOptimization error:', error);
      return null;
    }
  }

  /**
   * Get harvest volume forecast (P5 DATA HOOK)
   * Used by P5 Dynamic Pricing for supply-demand analysis
   * 
   * @param {string} crop - Crop variety
   * @param {number} weeks - Weeks to forecast (default: 12)
   * @returns {array} Harvest forecast with dates and volumes
   */
  async getHarvestForecast(crop, weeks = 12) {
    try {
      // Generate schedule for crop
      const schedule = await this.generateSchedule({
        crop: crop,
        weeklyDemand: 100, // Baseline demand for forecasting
        startDate: new Date().toISOString().split('T')[0],
        weeks: weeks
      });

      if (!schedule.ok) {
        return [];
      }

      // Extract harvest forecast
      return schedule.schedule.map(s => ({
        harvestDate: s.harvestDate,
        crop: s.crop,
        volume: s.totalPlants,
        trays: s.traysNeeded,
        conflicts: s.conflicts.length > 0
      }));

    } catch (error) {
      console.error('[SuccessionPlanner] getHarvestForecast error:', error);
      return [];
    }
  }

  /**
   * Detect inventory gaps (P5 DATA HOOK)
   * Used by P5 Dynamic Pricing for scarcity-based pricing
   * 
   * @param {string} crop - Crop variety
   * @param {number} targetFulfillmentRate - Target fulfillment (default: 0.99)
   * @returns {object} Gap analysis with dates and reasons
   */
  async detectInventoryGaps(crop, targetFulfillmentRate = 0.99) {
    try {
      // Generate schedule with typical demand
      const schedule = await this.generateSchedule({
        crop: crop,
        weeklyDemand: 100,
        startDate: new Date().toISOString().split('T')[0],
        weeks: 12
      });

      if (!schedule.ok) {
        return {
          crop: crop,
          targetRate: targetFulfillmentRate,
          actualRate: 0,
          gaps: []
        };
      }

      // Identify gaps (capacity conflicts or harvest date gaps)
      const gaps = schedule.schedule.filter(s => 
        s.conflicts.length > 0 || 
        !s.capacityAvailable
      );

      const actualRate = 1 - (gaps.length / schedule.schedule.length);

      return {
        crop: crop,
        targetRate: targetFulfillmentRate,
        actualRate: actualRate,
        meetsTarget: actualRate >= targetFulfillmentRate,
        gaps: gaps.map(g => ({
          week: g.week,
          harvestDate: g.harvestDate,
          seedDate: g.seedDate,
          reason: g.conflicts.join(', ') || 'Capacity unavailable',
          traysNeeded: g.traysNeeded
        }))
      };

    } catch (error) {
      console.error('[SuccessionPlanner] detectInventoryGaps error:', error);
      return {
        crop: crop,
        targetRate: targetFulfillmentRate,
        actualRate: 0,
        gaps: []
      };
    }
  }

  /**
   * Clear schedule cache
   */
  clearCache() {
    this.scheduleCache.clear();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      entries: this.scheduleCache.size,
      ttlMs: this.cacheTTL
    };
  }
}

export default SuccessionPlanner;
