/**
 * Canonical Crop Key Resolver (XC-4)
 *
 * Resolves free-text crop strings (from Activity Hub, scan input, etc.)
 * to the canonical crop key defined in public/data/crop-registry.json.
 *
 * Resolution order:
 *   1. Exact match on canonical key (case-insensitive)
 *   2. Exact match on an alias (case-insensitive)
 *   3. Exact match on a planId
 *   4. null (unknown crop)
 *
 * Usage:
 *   import { resolveCropKey, isKnownCrop, getCropRegistry } from './lib/crop-resolver.js';
 *   const canonical = resolveCropKey('bibb');        // 'Bibb Butterhead'
 *   const canonical2 = resolveCropKey('Bibb Butterhead'); // 'Bibb Butterhead'
 *   const unknown = resolveCropKey('purple banana'); // null
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let registry = null;       // { [canonicalKey]: cropData }
let aliasMap = null;        // Map<lowercase string, canonicalKey>
let planIdMap = null;       // Map<planId, canonicalKey>

function loadRegistry() {
  if (registry) return;
  try {
    const raw = readFileSync(join(__dirname, '..', 'public', 'data', 'crop-registry.json'), 'utf-8');
    const data = JSON.parse(raw);
    const crops = data.crops || data;
    registry = crops;
    aliasMap = new Map();
    planIdMap = new Map();

    for (const [key, entry] of Object.entries(crops)) {
      // Map the canonical key itself (lowercased)
      aliasMap.set(key.toLowerCase(), key);

      // Map all aliases
      if (Array.isArray(entry.aliases)) {
        for (const alias of entry.aliases) {
          aliasMap.set(alias.toLowerCase(), key);
        }
      }

      // Map planIds
      if (Array.isArray(entry.planIds)) {
        for (const pid of entry.planIds) {
          planIdMap.set(pid, key);
        }
      }
    }

    console.log(`[crop-resolver] Loaded ${Object.keys(crops).length} crops, ${aliasMap.size} aliases, ${planIdMap.size} planIds`);
  } catch (err) {
    console.warn('[crop-resolver] Failed to load crop registry:', err.message);
    registry = {};
    aliasMap = new Map();
    planIdMap = new Map();
  }
}

/**
 * Resolve a free-text crop string to its canonical key.
 * @param {string} input - The raw crop string from client (recipe_id, crop name, etc.)
 * @returns {string|null} - The canonical crop key, or null if unrecognized
 */
export function resolveCropKey(input) {
  if (!input || typeof input !== 'string') return null;
  loadRegistry();

  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;

  // 1. Exact match on canonical key or alias
  const fromAlias = aliasMap.get(normalized);
  if (fromAlias) return fromAlias;

  // 2. Match on planId
  const fromPlan = planIdMap.get(input.trim());
  if (fromPlan) return fromPlan;

  return null;
}

/**
 * Check if a crop string resolves to a known crop.
 * @param {string} input
 * @returns {boolean}
 */
export function isKnownCrop(input) {
  return resolveCropKey(input) !== null;
}

/**
 * Get the full crop registry (loaded lazily).
 * @returns {object}
 */
export function getCropRegistry() {
  loadRegistry();
  return registry;
}

/**
 * Force reload the registry from disk (e.g., after registry file update).
 */
export function reloadCropRegistry() {
  registry = null;
  aliasMap = null;
  planIdMap = null;
  loadRegistry();
}
