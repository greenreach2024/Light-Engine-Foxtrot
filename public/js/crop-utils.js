/**
 * crop-utils.js — Shared crop utility for Light Engine
 * 
 * Browser: <script src="/js/crop-utils.js"> → window.cropUtils
 * Node.js: const cropUtils = require('./public/js/crop-utils.js')
 * 
 * Registry-aware with plan-ID parse fallback.
 * Phase 2a of crop data unification (2026-02-17).
 */
(function (exports) {
  'use strict';

  /** @type {Object|null} Loaded crop registry data */
  let _registry = null;

  /** @type {Object} Pre-built lookup caches (populated on setRegistry) */
  let _planIdCache = {};   // planId → canonical name
  let _aliasCache = {};    // normalized alias → canonical name

  /**
   * Load a crop registry object (from /api/crops or require('crop-registry.json'))
   * @param {Object} data - Parsed crop-registry.json content
   */
  exports.setRegistry = function (data) {
    _registry = data;
    _planIdCache = {};
    _aliasCache = {};

    if (!data || !data.crops) return;

    // Build lookup caches
    for (const [name, crop] of Object.entries(data.crops)) {
      // Plan ID → name
      if (Array.isArray(crop.planIds)) {
        for (const pid of crop.planIds) {
          _planIdCache[pid] = name;
        }
      }
      // Aliases → name (normalized lowercase)
      if (Array.isArray(crop.aliases)) {
        for (const alias of crop.aliases) {
          _aliasCache[alias.toLowerCase().trim()] = name;
        }
      }
      // Canonical name itself as alias
      _aliasCache[name.toLowerCase().trim()] = name;
    }
  };

  /**
   * Get the raw registry data
   * @returns {Object|null}
   */
  exports.getRegistry = function () {
    return _registry;
  };

  /**
   * Convert a plan ID (e.g. "crop-bibb-butterhead") to a human-readable crop name.
   * Uses registry lookup first, falls back to title-case parsing.
   * 
   * Replaces: extractCropDisplayName(), planIdToCropName(), extractCropNameFromPlanId()
   * 
   * @param {string} planId - Plan or planId string
   * @returns {string} Human-readable crop name, or 'Unknown' if null/empty
   */
  exports.planIdToCropName = function (planId) {
    if (!planId || typeof planId !== 'string') return 'Unknown';

    // Registry lookup (fast O(1) cache hit)
    if (_planIdCache[planId]) {
      return _planIdCache[planId];
    }

    // Fallback: parse plan ID → title case
    // Handles any crop-* pattern not yet in registry
    return planId
      .replace(/^crop-/, '')
      .split('-')
      .map(function (w) { return w ? w.charAt(0).toUpperCase() + w.slice(1) : w; })
      .join(' ')
      .trim() || 'Unknown';
  };

  /**
   * Normalize any crop name/alias to the canonical registry name.
   * Returns input unchanged if no registry match found.
   * 
   * @param {string} input - Crop name, alias, or plan ID
   * @returns {string} Canonical crop name
   */
  exports.normalizeCropName = function (input) {
    if (!input || typeof input !== 'string') return 'Unknown';

    // Try plan ID lookup first
    if (input.startsWith('crop-')) {
      return exports.planIdToCropName(input);
    }

    // Try alias cache (exact normalized match)
    var normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    if (_aliasCache[normalized]) {
      return _aliasCache[normalized];
    }

    // Try partial alias match (any alias token is a substring)
    for (var alias in _aliasCache) {
      if (normalized.includes(alias) || alias.includes(normalized)) {
        return _aliasCache[alias];
      }
    }

    return input; // Return original if no match
  };

  /**
   * Get days to harvest for a crop name.
   * @param {string} cropName - Canonical or alias crop name
   * @returns {number} Days to harvest, or 35 default
   */
  exports.getCropGrowDays = function (cropName) {
    if (!_registry || !_registry.crops) return 35;
    var canonical = exports.normalizeCropName(cropName);
    var entry = _registry.crops[canonical];
    return (entry && entry.growth && entry.growth.daysToHarvest) || 35;
  };

  /**
   * Get pricing data for a crop name.
   * @param {string} cropName - Canonical or alias crop name
   * @returns {Object|null} { retailPerOz, wholesaleDiscounts } or null
   */
  exports.getCropPricing = function (cropName) {
    if (!_registry || !_registry.crops) return null;
    var canonical = exports.normalizeCropName(cropName);
    var entry = _registry.crops[canonical];
    return (entry && entry.pricing) || null;
  };

  /**
   * Get growth parameters for a crop name.
   * @param {string} cropName - Canonical or alias crop name
   * @returns {Object|null} { daysToHarvest, retailPricePerLb, yieldFactor } or null
   */
  exports.getCropGrowth = function (cropName) {
    if (!_registry || !_registry.crops) return null;
    var canonical = exports.normalizeCropName(cropName);
    var entry = _registry.crops[canonical];
    return (entry && entry.growth) || null;
  };

  /**
   * Get the market data resolution key for a crop.
   * Used to look up the crop in marketDataSources.
   * @param {string} cropName - Canonical or alias crop name
   * @returns {string|null} The marketDataSources key, or null
   */
  exports.getMarketResolveKey = function (cropName) {
    if (!_registry || !_registry.crops) return null;
    var canonical = exports.normalizeCropName(cropName);
    var entry = _registry.crops[canonical];
    return (entry && entry.market && entry.market.resolveAs) || null;
  };

  /**
   * Get all active crops from the registry.
   * @returns {Array<{name: string, crop: Object}>} Array of active crop entries
   */
  exports.getActiveCrops = function () {
    if (!_registry || !_registry.crops) return [];
    var result = [];
    for (var name in _registry.crops) {
      if (_registry.crops[name].active) {
        result.push({ name: name, crop: _registry.crops[name] });
      }
    }
    return result;
  };

  /**
   * Get all crops from the registry.
   * @param {Object} [opts] - Options
   * @param {boolean} [opts.activeOnly] - Only return active crops
   * @param {string} [opts.category] - Filter by category
   * @returns {Array<{name: string, crop: Object}>}
   */
  exports.getAllCrops = function (opts) {
    if (!_registry || !_registry.crops) return [];
    opts = opts || {};
    var result = [];
    for (var name in _registry.crops) {
      var crop = _registry.crops[name];
      if (opts.activeOnly && !crop.active) continue;
      if (opts.category && crop.category !== opts.category) continue;
      result.push({ name: name, crop: crop });
    }
    return result;
  };

})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (this.cropUtils = this.cropUtils || {}));
