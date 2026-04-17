/**
 * Recipe-Based Environmental Target Calculator
 * 
 * Calculates weighted environmental targets (VPD, Temperature, Max RH) from grow recipes
 * based on tray placement, recipe schedule, and current day in grow cycle.
 * 
 * Features:
 * - Zone-focused targeting (multiple trays in same zone averaged)
 * - Room-level fallback (when no zone-specific data)
 * - Daily updates as recipes progress through grow cycles
 * - Weighted averages based on plant count per tray
 * - Supports both PostgreSQL (production) and SQLite (edge devices)
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs/promises';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default class RecipeEnvironmentalTargets {
  constructor(options = {}) {
    const {
      dbQuery = null, // Database query function
      dataDir = path.join(__dirname, '../data'),
      logger = console
    } = options;
    
    this.dbQuery = dbQuery;
    this.dataDir = dataDir;
    this.logger = logger;
    
    // Cache for recipe data (refreshed daily)
    this.recipeCache = new Map(); // recipe_id -> recipe data
    this.lastCacheRefresh = null;
    this.cacheRefreshIntervalMs = 24 * 60 * 60 * 1000; // 24 hours
    
    // Cache for tray locations (refreshed hourly)
    this.trayLocationCache = new Map(); // zone_id -> [trays]
    this.lastLocationRefresh = null;
    this.locationRefreshIntervalMs = 60 * 60 * 1000; // 1 hour
  }
  
  /**
   * Get environmental targets for a zone based on active trays and their recipes
   * @param {string} zoneId - Zone identifier
   * @param {string} roomId - Room identifier (for room-level fallback)
   * @returns {Promise<Object>} Environmental targets { vpd, temp, maxRh }
   */
  async getZoneTargets(zoneId, roomId = null) {
    try {
      // Refresh caches if needed
      await this._refreshCachesIfNeeded();
      
      // Get active trays in this zone
      const trays = await this._getActiveTraysInZone(zoneId);
      
      if (!trays || trays.length === 0) {
        // No active trays - check room-level
        if (roomId) {
          return await this._getRoomTargets(roomId);
        }
        
        // Return conservative defaults
        return this._getDefaultTargets('no-trays');
      }
      
      // Calculate weighted targets from tray recipes
      const targets = await this._calculateWeightedTargets(trays, 'zone', zoneId);
      
      return targets;
      
    } catch (error) {
      this.logger.error(`[recipe-targets] Error calculating zone targets for ${zoneId}:`, error.message);
      return this._getDefaultTargets('error');
    }
  }
  
  /**
   * Get environmental targets for a room (all zones aggregated)
   * @param {string} roomId - Room identifier
   * @returns {Promise<Object>} Environmental targets
   */
  async _getRoomTargets(roomId) {
    try {
      await this._refreshCachesIfNeeded();
      
      const trays = await this._getActiveTraysInRoom(roomId);
      
      if (!trays || trays.length === 0) {
        return this._getDefaultTargets('no-trays-room');
      }
      
      const targets = await this._calculateWeightedTargets(trays, 'room', roomId);
      
      return targets;
      
    } catch (error) {
      this.logger.error(`[recipe-targets] Error calculating room targets for ${roomId}:`, error.message);
      return this._getDefaultTargets('error');
    }
  }
  
  /**
   * Calculate weighted environmental targets from multiple trays
   * @param {Array} trays - Array of tray objects with recipe and day info
   * @param {string} level - 'zone' or 'room'
   * @param {string} levelId - Zone or room ID
   * @returns {Promise<Object>} Weighted targets
   */
  async _calculateWeightedTargets(trays, level, levelId) {
    let totalWeight = 0;
    let maxRhValues = [];
    const contributors = []; // Per-tray breakdown for telemetry

    // Default comfort bands (half-widths) per dimension
    const VPD_HALF_BAND = 0.15;  // kPa
    const TEMP_HALF_BAND = 1.5;  // C

    for (const tray of trays) {
      const recipe = await this._getRecipeData(tray.recipe_id);

      if (!recipe || !recipe.data || !recipe.data.schedule) {
        this.logger.warn(`[recipe-targets] Recipe ${tray.recipe_id} not found or invalid`);
        continue;
      }

      const currentDay = this._calculateCurrentDay(tray.seed_date);
      const scheduleDay = this._findScheduleDay(recipe.data.schedule, currentDay);

      if (!scheduleDay) {
        this.logger.warn(`[recipe-targets] No schedule found for day ${currentDay} in recipe ${recipe.name}`);
        continue;
      }

      const weight = tray.planted_site_count || 1;
      const vpdTarget = parseFloat(scheduleDay.vpd_target) || null;
      const tempTarget = parseFloat(scheduleDay.temp_target) || null;
      const maxRh = parseFloat(scheduleDay.max_humidity) || null;

      if (vpdTarget !== null) {
        contributors.push({
          tray_id: tray.tray_id,
          tray_run_id: tray.tray_run_id,
          recipe_id: tray.recipe_id,
          day: currentDay,
          weight,
          vpd: { target: vpdTarget, min: vpdTarget - VPD_HALF_BAND, max: vpdTarget + VPD_HALF_BAND },
          temp: tempTarget !== null ? { target: tempTarget, min: tempTarget - TEMP_HALF_BAND, max: tempTarget + TEMP_HALF_BAND } : null,
          maxRh
        });
        totalWeight += weight;
      }

      if (maxRh !== null) {
        maxRhValues.push(maxRh);
      }

      this.logger.debug(`[recipe-targets] Tray ${tray.tray_id}: Day ${currentDay}, VPD ${vpdTarget}, Temp ${tempTarget}, MaxRH ${maxRh}, Weight ${weight}`);
    }

    if (totalWeight === 0 || contributors.length === 0) {
      this.logger.warn(`[recipe-targets] No valid recipes found for ${level} ${levelId}`);
      return this._getDefaultTargets('no-valid-recipes');
    }

    // ── Range intersection algorithm ────────────────────────────────────
    // Intersect comfort bands across all trays. If the intersection is
    // non-empty, pick the weighted centroid clamped inside.  If empty,
    // mark infeasible and protect the most-sensitive crop (smallest band).

    const vpdIntersectMin = Math.max(...contributors.map(c => c.vpd.min));
    const vpdIntersectMax = Math.min(...contributors.map(c => c.vpd.max));

    const tempContributors = contributors.filter(c => c.temp !== null);
    const tempIntersectMin = tempContributors.length > 0
      ? Math.max(...tempContributors.map(c => c.temp.min)) : null;
    const tempIntersectMax = tempContributors.length > 0
      ? Math.min(...tempContributors.map(c => c.temp.max)) : null;

    // Weighted centroid (used only within feasible intersection)
    const weightedVpdCentroid = contributors.reduce((s, c) => s + c.vpd.target * c.weight, 0) / totalWeight;
    const weightedTempCentroid = tempContributors.length > 0
      ? tempContributors.reduce((s, c) => s + c.temp.target * c.weight, 0)
        / tempContributors.reduce((s, c) => s + c.weight, 0)
      : null;

    // VPD resolution
    let vpdState, vpdTarget, vpdBandMin, vpdBandMax;
    if (vpdIntersectMin <= vpdIntersectMax) {
      // Feasible: clamp centroid inside intersection
      vpdState = 'feasible';
      vpdTarget = Math.max(vpdIntersectMin, Math.min(vpdIntersectMax, weightedVpdCentroid));
      vpdBandMin = vpdIntersectMin;
      vpdBandMax = vpdIntersectMax;
    } else {
      // Infeasible: protect the most-sensitive crop (smallest band width)
      vpdState = 'infeasible';
      const sensitive = contributors.reduce((best, c) => {
        const width = c.vpd.max - c.vpd.min;
        return (!best || width < best.width) ? { ...c, width } : best;
      }, null);
      vpdTarget = sensitive.vpd.target;
      vpdBandMin = sensitive.vpd.min;
      vpdBandMax = sensitive.vpd.max;
      this.logger.warn(`[recipe-targets] VPD INFEASIBLE for ${level} ${levelId}: no common band across ${contributors.length} crops. Protecting ${sensitive.recipe_id}.`);
    }

    // Temperature resolution
    let tempState = 'feasible', tempTarget2, tempBandMin, tempBandMax;
    if (tempIntersectMin !== null && tempIntersectMax !== null) {
      if (tempIntersectMin <= tempIntersectMax) {
        tempState = 'feasible';
        tempTarget2 = Math.max(tempIntersectMin, Math.min(tempIntersectMax, weightedTempCentroid));
        tempBandMin = tempIntersectMin;
        tempBandMax = tempIntersectMax;
      } else {
        tempState = 'infeasible';
        const sensitive = tempContributors.reduce((best, c) => {
          const width = c.temp.max - c.temp.min;
          return (!best || width < best.width) ? { ...c, width } : best;
        }, null);
        tempTarget2 = sensitive.temp.target;
        tempBandMin = sensitive.temp.min;
        tempBandMax = sensitive.temp.max;
        this.logger.warn(`[recipe-targets] TEMP INFEASIBLE for ${level} ${levelId}: no common band across ${tempContributors.length} crops. Protecting ${sensitive.recipe_id}.`);
      }
    } else {
      // No temp data at all -- use default
      tempTarget2 = 21;
      tempBandMin = 19;
      tempBandMax = 23;
    }

    // Max RH: minimum (most restrictive) -- unchanged, already correct
    const maxRhOverride = maxRhValues.length > 0 ? Math.min(...maxRhValues) : null;

    const vpdBand = { min: vpdBandMin, max: vpdBandMax, target: vpdTarget, unit: 'kPa' };
    const tempBand = { min: tempBandMin, max: tempBandMax, target: tempTarget2, unit: 'C' };

    return {
      vpd: vpdBand,
      temperature: tempBand,
      maxRh: maxRhOverride,
      compromise_state: (vpdState === 'feasible' && tempState === 'feasible') ? 'feasible' : 'infeasible',
      vpd_state: vpdState,
      temp_state: tempState,
      contributors: contributors.map(c => ({
        tray_id: c.tray_id,
        tray_run_id: c.tray_run_id,
        recipe_id: c.recipe_id,
        day: c.day,
        vpd_target: c.vpd.target,
        temp_target: c.temp?.target ?? null,
        delta_vpd: Math.abs(c.vpd.target - vpdTarget),
        delta_temp: c.temp ? Math.abs(c.temp.target - tempTarget2) : null
      })),
      level,
      levelId,
      trayCount: trays.length,
      totalPlants: totalWeight,
      calculatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Get recipe data from cache or database
   * @param {string} recipeId - Recipe ID (either numeric ID or recipe name)
   * @returns {Promise<Object>} Recipe object
   */
  async _getRecipeData(recipeId) {
    // Check cache
    if (this.recipeCache.has(recipeId)) {
      return this.recipeCache.get(recipeId);
    }
    
    // Query database
    if (!this.dbQuery) {
      throw new Error('Database query function not provided');
    }
    
    try {
      // Try as integer ID first, then as name
      let result;
      if (!isNaN(recipeId)) {
        result = await this.dbQuery('SELECT * FROM recipes WHERE id = $1', [recipeId]);
      } else {
        result = await this.dbQuery('SELECT * FROM recipes WHERE name = $1', [recipeId]);
      }
      
      if (!result || result.length === 0) {
        return null;
      }
      
      const recipe = result[0];
      this.recipeCache.set(recipeId, recipe);
      return recipe;
      
    } catch (error) {
      this.logger.error(`[recipe-targets] Error fetching recipe ${recipeId}:`, error.message);
      return null;
    }
  }
  
  /**
   * Get active trays in a zone with their locations and recipes
   * @param {string} zoneId - Zone identifier
   * @returns {Promise<Array>} Array of tray objects
   */
  async _getActiveTraysInZone(zoneId) {
    if (!this.dbQuery) {
      throw new Error('Database query function not provided');
    }
    
    try {
      // Query trays with active runs in this zone
      const query = `
        SELECT 
          tr.tray_run_id,
          tr.tray_id,
          tr.recipe_id,
          tr.seed_date,
          tr.planted_site_count,
          tr.status,
          tp.location_id,
          l.zone_id,
          l.room_id
        FROM tray_runs tr
        JOIN tray_placements tp ON tr.tray_run_id = tp.tray_run_id
        JOIN locations l ON tp.location_id = l.location_id
        WHERE l.zone_id = $1 
          AND tr.status IN ('SEEDED', 'GROWING', 'active')
          AND tp.removed_at IS NULL
        ORDER BY tr.seed_date DESC
      `;
      
      const result = await this.dbQuery(query, [zoneId]);
      return result || [];
      
    } catch (error) {
      this.logger.error(`[recipe-targets] Error fetching trays for zone ${zoneId}:`, error.message);
      return [];
    }
  }
  
  /**
   * Get active trays in a room (all zones)
   * @param {string} roomId - Room identifier
   * @returns {Promise<Array>} Array of tray objects
   */
  async _getActiveTraysInRoom(roomId) {
    if (!this.dbQuery) {
      throw new Error('Database query function not provided');
    }
    
    try {
      const query = `
        SELECT 
          tr.tray_run_id,
          tr.tray_id,
          tr.recipe_id,
          tr.seed_date,
          tr.planted_site_count,
          tr.status,
          tp.location_id,
          l.zone_id,
          l.room_id
        FROM tray_runs tr
        JOIN tray_placements tp ON tr.tray_run_id = tp.tray_run_id
        JOIN locations l ON tp.location_id = l.location_id
        WHERE l.room_id = $1 
          AND tr.status IN ('SEEDED', 'GROWING', 'active')
          AND tp.removed_at IS NULL
        ORDER BY tr.seed_date DESC
      `;
      
      const result = await this.dbQuery(query, [roomId]);
      return result || [];
      
    } catch (error) {
      this.logger.error(`[recipe-targets] Error fetching trays for room ${roomId}:`, error.message);
      return [];
    }
  }
  
  /**
   * Calculate current day in grow cycle from seed date
   * @param {Date|string} seedDate - Seed date
   * @returns {number} Current day (1-indexed)
   */
  _calculateCurrentDay(seedDate) {
    const seed = new Date(seedDate);
    const now = new Date();
    const diffMs = now - seed;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays + 1); // 1-indexed, minimum day 1
  }
  
  /**
   * Find the closest schedule day in recipe for given current day
   * @param {Array} schedule - Recipe schedule array
   * @param {number} currentDay - Current day in cycle
   * @returns {Object} Schedule day object
   */
  _findScheduleDay(schedule, currentDay) {
    if (!schedule || schedule.length === 0) {
      return null;
    }
    
    // Find exact match or closest lower day
    let closestDay = null;
    let closestDiff = Infinity;
    
    for (const schedDay of schedule) {
      const day = parseFloat(schedDay.day);
      const diff = currentDay - day;
      
      // Exact match
      if (diff === 0) {
        return schedDay;
      }
      
      // Closest lower day (within current cycle)
      if (diff > 0 && diff < closestDiff) {
        closestDay = schedDay;
        closestDiff = diff;
      }
    }
    
    // If no lower day found, use first day
    if (!closestDay && schedule.length > 0) {
      closestDay = schedule[0];
    }
    
    return closestDay;
  }
  
  /**
   * Get default environmental targets when no recipe data available
   * @param {string} reason - Reason for defaults
   * @returns {Object} Default targets
   */
  _getDefaultTargets(reason) {
    this.logger.info(`[recipe-targets] Using default targets (${reason})`);
    
    return {
      vpd: {
        min: 0.6,
        max: 1.0,
        target: 0.8,
        unit: 'kPa'
      },
      temperature: {
        min: 19,
        max: 23,
        target: 21,
        unit: '°C'
      },
      maxRh: 75, // Conservative default
      level: 'default',
      reason,
      calculatedAt: new Date().toISOString()
    };
  }
  
  /**
   * Refresh caches if needed based on intervals
   */
  async _refreshCachesIfNeeded() {
    const now = Date.now();
    
    // Refresh recipe cache daily
    if (!this.lastCacheRefresh || now - this.lastCacheRefresh > this.cacheRefreshIntervalMs) {
      this.recipeCache.clear();
      this.lastCacheRefresh = now;
      this.logger.info('[recipe-targets] Recipe cache refreshed');
    }
    
    // Refresh location cache hourly
    if (!this.lastLocationRefresh || now - this.lastLocationRefresh > this.locationRefreshIntervalMs) {
      this.trayLocationCache.clear();
      this.lastLocationRefresh = now;
      this.logger.info('[recipe-targets] Location cache refreshed');
    }
  }
  
  /**
   * Force refresh all caches (for testing or manual trigger)
   */
  async forceRefresh() {
    this.recipeCache.clear();
    this.trayLocationCache.clear();
    this.lastCacheRefresh = null;
    this.lastLocationRefresh = null;
    this.logger.info('[recipe-targets] All caches forcefully refreshed');
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats() {
    return {
      recipes: this.recipeCache.size,
      locations: this.trayLocationCache.size,
      lastRecipeRefresh: this.lastCacheRefresh ? new Date(this.lastCacheRefresh).toISOString() : null,
      lastLocationRefresh: this.lastLocationRefresh ? new Date(this.lastLocationRefresh).toISOString() : null
    };
  }
}
