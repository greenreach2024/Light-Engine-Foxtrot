/**
 * plan-anchor.js — Shared "assign a crop to a group" helper.
 *
 * Browser: <script src="/js/plan-anchor.js"> → window.planAnchor
 * Node.js: const planAnchor = require('./public/js/plan-anchor.js')
 *
 * Three callers need to stamp the same five scheduling fields on a group when a
 * crop is assigned — the 3D viewer's inline save handler, EVIE's
 * `update_group_crop` tool, and the tray-seed endpoint. Keeping the logic in one
 * place prevents drift (e.g. PR #37's alias + `planIds[]` resolution landing in
 * the viewer but not in EVIE).
 *
 * Contract — a group is considered "scheduled" when these fields are present
 * and consistent:
 *   group.crop                             (canonical display name)
 *   group.recipe                           (same canonical name; lighting recipe key)
 *   group.plan                             (planId)
 *   group.planId                           (planId, duplicated for resolver compat)
 *   group.planConfig.anchor.seedDate       (YYYY-MM-DD, drives computePlanDayNumber)
 *
 * Plus `group.lastModified` (ISO) so SSE / dirty-tracking pick up the change.
 */
(function (exports) {
  'use strict';

  /**
   * Resolve a user-supplied crop name against the crop registry.
   *
   * Registry shape (from `public/data/crop-registry.json`):
   *   { crops: { "Mei Qing Pak Choi": { aliases: ["Bok Choy", ...],
   *                                     planIds: ["crop-pak-choi"], ... } } }
   *
   * Some legacy rows still use the singular `planId` — both are honored.
   *
   * Lookup order:
   *   1. Case-insensitive match against registry keys (canonical names).
   *   2. Alias scan — `entry.aliases[*]` case-insensitive, trimmed.
   *   3. `planIds[0]` if present, else `planId`, else slugified fallback.
   *
   * @param {string} cropName   Raw operator input ("Bok Choy", "bibb", etc.)
   * @param {Object} registry   Parsed crop-registry.json (or `{ crops: {...} }`)
   * @returns {{resolvedName: string, planId: string, matched: boolean}}
   */
  exports.resolveCropRegistryEntry = function (cropName, registry) {
    var raw = String(cropName || '').trim();
    if (!raw) return { resolvedName: '', planId: '', matched: false };

    var crops = null;
    if (registry && typeof registry === 'object') {
      if (registry.crops && typeof registry.crops === 'object') {
        crops = registry.crops;
      } else {
        // Allow callers to pass the `crops` dict directly (matches viewer's
        // `S.cropRegistry` convention where the outer object IS the crops map).
        crops = registry;
      }
    }
    crops = crops || {};

    var keys = Object.keys(crops);
    var lowered = raw.toLowerCase();
    var matchKey = keys.find(function (k) { return String(k).toLowerCase() === lowered; });
    if (!matchKey) {
      matchKey = keys.find(function (k) {
        var e = crops[k];
        if (!e || !Array.isArray(e.aliases)) return false;
        return e.aliases.some(function (a) {
          return String(a || '').toLowerCase().trim() === lowered;
        });
      }) || null;
    }
    var entry = matchKey ? crops[matchKey] : null;
    var resolvedName = matchKey || raw;

    var planId = '';
    if (entry && Array.isArray(entry.planIds) && entry.planIds[0]) {
      planId = entry.planIds[0];
    } else if (entry && typeof entry.planId === 'string' && entry.planId.trim()) {
      planId = entry.planId.trim();
    } else {
      planId = 'crop-' + resolvedName.toLowerCase().replace(/\s+/g, '-');
    }

    return {
      resolvedName: resolvedName,
      planId: planId,
      matched: Boolean(matchKey)
    };
  };

  /**
   * Stamp the five scheduling fields + lastModified on a group. Mutates in place
   * and also returns the group for chaining.
   *
   * Seed-date policy:
   *   - If the group already has `planConfig.anchor.seedDate`, it is preserved
   *     by default — tray-seed writes a real lab-recorded seed date, and later
   *     crop re-assignments (via EVIE or the viewer's save handler) must not
   *     clobber that.
   *   - Callers that genuinely want to overwrite (e.g. "reset seed date to today"
   *     from an admin action) can pass `{ overwriteSeedDate: true }`.
   *   - `seedDate` option can be an explicit 'YYYY-MM-DD' string; otherwise
   *     today (UTC) is used when seedDate is not already set.
   *
   * @param {Object} group        The group object to mutate
   * @param {{resolvedName: string, planId: string}} resolved  From resolveCropRegistryEntry
   * @param {Object} [opts]
   * @param {string} [opts.seedDate]            Explicit YYYY-MM-DD
   * @param {boolean} [opts.overwriteSeedDate]  If true, replace an existing seedDate
   * @returns {Object} the same group (for chaining)
   */
  exports.stampPlanAnchor = function (group, resolved, opts) {
    if (!group || typeof group !== 'object') return group;
    if (!resolved || typeof resolved !== 'object') return group;
    opts = opts || {};

    var resolvedName = resolved.resolvedName || '';
    var planId = resolved.planId || '';
    if (!resolvedName && !planId) return group;

    if (resolvedName) {
      group.crop = resolvedName;
      group.recipe = resolvedName;
    }
    if (planId) {
      group.plan = planId;
      group.planId = planId;
    }

    if (!group.planConfig || typeof group.planConfig !== 'object') group.planConfig = {};
    if (!group.planConfig.anchor || typeof group.planConfig.anchor !== 'object') {
      group.planConfig.anchor = {};
    }

    var hasSeedDate = typeof group.planConfig.anchor.seedDate === 'string'
      && group.planConfig.anchor.seedDate.trim() !== '';
    if (opts.overwriteSeedDate || !hasSeedDate) {
      var desired = typeof opts.seedDate === 'string' && opts.seedDate.trim()
        ? opts.seedDate.trim()
        : new Date().toISOString().slice(0, 10);
      group.planConfig.anchor.seedDate = desired;
    }

    group.lastModified = new Date().toISOString();
    return group;
  };

  /**
   * Convenience: one-shot resolve + stamp. Returns the resolved object so the
   * caller can surface canonical name / planId back to the user in a response.
   *
   * @param {Object} group
   * @param {string} cropName
   * @param {Object} registry
   * @param {Object} [opts]   Same as stampPlanAnchor
   * @returns {{resolvedName: string, planId: string, matched: boolean}}
   */
  exports.assignCropToGroup = function (group, cropName, registry, opts) {
    var resolved = exports.resolveCropRegistryEntry(cropName, registry);
    exports.stampPlanAnchor(group, resolved, opts);
    return resolved;
  };

})(typeof module !== 'undefined' && module.exports
  ? module.exports
  : (this.planAnchor = this.planAnchor || {}));
