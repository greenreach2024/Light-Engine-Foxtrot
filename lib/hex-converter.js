/**
 * HEX Conversion Utilities for Grow3 Controller
 * Converts plan recipes (CW/WW/BL/RD percentages) to HEX12 format
 * 
 * Format: [CW][WW][BL][RD][00][00] where each channel is 2 hex digits
 * 
 * Grow3 Scale (current):
 *   • Range: 0-64 decimal (0x00-0x40 hex)
 *   • Example: "1D1D1D1D0000" = 45% (0x1D = 29 decimal)
 *   • Formula: round(percent / 100 * 64)
 * 
 * Legacy Scale (deprecated):
 *   • Range: 0-255 decimal (0x00-0xFF hex)
 *   • Example: "737373730000" = 45% (0x73 = 115 decimal)
 *   • Only for historical reference
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Load channel scale configuration
 * Returns maxByte value (0x40 for Grow3, 0xFF for legacy - deprecated)
 */
async function loadChannelScale() {
  try {
    const configPath = path.join(__dirname, '../config/channel-scale.json');
    const data = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(data);
    return config.maxByte || 0x40; // Default to Grow3 0x40 (64 decimal)
  } catch (error) {
    console.warn('[HEX Converter] Failed to load channel-scale.json, using Grow3 default 0x40:', error.message);
    return 0x40; // Grow3 scale: 0-64 decimal
  }
}

/**
 * Convert a single channel percentage to hex
 * @param {number} percent - Value from 0-100
 * @param {number} maxByte - Maximum byte value (0x40 for Grow3, 0xFF legacy deprecated)
 * @returns {string} - 2-character hex string (e.g., "1D" for 45% on Grow3)
 */
function percentToHex(percent, maxByte = 0x40) {
  if (percent === null || percent === undefined || isNaN(percent)) {
    return '00';
  }
  
  // Clamp to 0-100
  const clamped = Math.max(0, Math.min(100, Number(percent)));
  
  // Calculate byte value
  const byteValue = Math.round((clamped / 100) * maxByte);
  
  // Convert to hex and pad
  return byteValue.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Convert recipe object to HEX12 payload
 * @param {Object} recipe - Recipe with cw, ww, bl, rd properties (percentages)
 * @param {number} maxByte - Optional max byte value (auto-loaded if not provided)
 * @returns {Promise<string>} - HEX12 string (e.g., "737373730000")
 */
export async function recipeToHex(recipe, maxByte = null) {
  if (!recipe || typeof recipe !== 'object') {
    throw new Error('Invalid recipe: must be an object');
  }
  
  // Load maxByte if not provided
  if (maxByte === null) {
    maxByte = await loadChannelScale();
  }
  
  let cw, ww, bl, rd;
  
  // Check if recipe has spectral bands (bl, gn, rd) that need to be converted to channels (cw, ww, bl, rd)
  if (recipe.gn !== undefined || recipe.green !== undefined) {
    // Recipe has spectral data - use spectral solver to convert to channel mix
    const { solveSpectrum } = await import('./spectral-solver.js');
    
    const blue = recipe.bl ?? recipe.blue ?? 0;
    const green = recipe.gn ?? recipe.green ?? 0;
    const red = recipe.rd ?? recipe.red ?? 0;
    
    const channelMix = solveSpectrum({ blue, green, red });
    cw = channelMix.cw;
    ww = channelMix.ww;
    bl = channelMix.bl;
    rd = channelMix.rd;
  } else {
    // Recipe already has channel values
    cw = recipe.cw ?? recipe.CW ?? 0;
    ww = recipe.ww ?? recipe.WW ?? 0;
    bl = recipe.bl ?? recipe.BL ?? recipe.blue ?? 0;
    rd = recipe.rd ?? recipe.RD ?? recipe.red ?? 0;
  }
  
  // Convert each channel
  const cwHex = percentToHex(cw, maxByte);
  const wwHex = percentToHex(ww, maxByte);
  const blHex = percentToHex(bl, maxByte);
  const rdHex = percentToHex(rd, maxByte);
  
  // Combine into HEX12 format
  return `${cwHex}${wwHex}${blHex}${rdHex}0000`;
}

/**
 * Calculate Days Post Seed (DPS) from seed date
 * @param {string|Date} seedDate - ISO date string or Date object
 * @param {Date} currentDate - Current date (defaults to now)
 * @returns {number} - Number of days since seed date
 */
export function calculateDPS(seedDate, currentDate = new Date()) {
  if (!seedDate) {
    throw new Error('Seed date is required');
  }
  
  const seed = new Date(seedDate);
  const current = new Date(currentDate);
  
  // Reset time to midnight for accurate day calculation
  seed.setHours(0, 0, 0, 0);
  current.setHours(0, 0, 0, 0);
  
  const diffMs = current - seed;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  return Math.max(0, diffDays); // Never negative
}

/**
 * Get current recipe from plan based on DPS or seed date
 * @param {Object} plan - Plan object with env.days array
 * @param {Object} config - Config with either dps or seedDate
 * @param {Date} currentDate - Current date (defaults to now)
 * @returns {Object|null} - Recipe for current day, or null if not found
 */
export function getCurrentRecipe(plan, config, currentDate = new Date()) {
  // Normalize plan day list from multiple possible schemas
  // Prioritize light.days for lighting schedules
  const days = Array.isArray(plan?.light?.days) ? plan.light.days
    : Array.isArray(plan?.days) ? plan.days
    : Array.isArray(plan?.env?.days) ? plan.env.days
    : null;
  if (!Array.isArray(days) || days.length === 0) {
    throw new Error('Invalid plan: missing days (env.days, light.days, or days)');
  }

  // Normalize anchor config: accept top-level or nested under config.anchor
  const anchor = (config && typeof config === 'object')
    ? (config.anchor && typeof config.anchor === 'object' ? config.anchor : config)
    : {};

  let dayNumber;
  if ((anchor.mode === 'dps' || config.anchorMode === 'dps') && typeof (anchor.dps ?? config.dps) === 'number') {
    // Direct DPS mode
    dayNumber = Number(anchor.dps ?? config.dps);
  } else if (anchor.seedDate || config.seedDate) {
    // Calculate from seed date
    const seed = anchor.seedDate ?? config.seedDate;
    dayNumber = calculateDPS(seed, currentDate);
  } else {
    throw new Error('Config must have either dps or seedDate');
  }

  // Convert to 0-based index; ensure within range (wrap if plan cycles)
  let index = Math.max(0, Math.floor(dayNumber));
  // Many plans consider Day 1 as the first entry; adjust if entries use 'day' or 'd' keys
  // We'll map by finding the last entry whose day (or d) <= current dayNumber+1
  const normalized = days.map(d => ({
    day: Number(d?.day ?? d?.d ?? d?.D ?? 1),
    entry: d
  }))
  .filter(x => Number.isFinite(x.day))
  .sort((a, b) => a.day - b.day);

  const targetDay = (dayNumber + 1); // Day 1 on seed day
  let chosen = null;
  for (const row of normalized) {
    if (row.day <= targetDay) chosen = row.entry; else break;
  }
  if (!chosen) chosen = normalized[0]?.entry;

  // Some schemas store mix under 'mix'
  if (chosen && chosen.mix) {
    return { ...chosen.mix, stage: chosen.stage };
  }
  return chosen || null;
}

/**
 * Parse time string to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format (e.g., "06:00")
 * @returns {number} - Minutes since midnight
 */
export function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return (hours * 60) + (minutes || 0);
}

/**
 * Check if schedule is currently active
 * @param {Object} schedule - Schedule object with cycles array
 * @param {Date} currentDate - Current date/time (defaults to now)
 * @returns {boolean} - True if schedule is active
 */
export function isScheduleActive(schedule, currentDate = new Date()) {
  if (!schedule?.cycles || !Array.isArray(schedule.cycles)) {
    return false;
  }
  
  const currentMinutes = currentDate.getHours() * 60 + currentDate.getMinutes();
  
  // Check if current time falls within any cycle
  for (const cycle of schedule.cycles) {
    // Accept both legacy 'on'/'off' and newer 'start'/'off' or 'end'
    const onStr = cycle.start || cycle.on;
    const offStr = cycle.off || cycle.end;
    if (!onStr || !offStr) continue;
    
    const onMinutes = timeToMinutes(onStr);
    const offMinutes = timeToMinutes(offStr);
    
    // Handle cycles that cross midnight
    if (offMinutes < onMinutes) {
      // e.g., on: 22:00, off: 06:00
      if (currentMinutes >= onMinutes || currentMinutes < offMinutes) {
        return true;
      }
    } else {
      // Normal case: e.g., on: 06:00, off: 22:00
      if (currentMinutes >= onMinutes && currentMinutes < offMinutes) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Create a safe default HEX payload (all channels at 45%)
 * @param {number} maxByte - Optional max byte value
 * @returns {Promise<string>} - Safe default HEX12 string
 */
export async function createSafeDefaultHex(maxByte = null) {
  const safeRecipe = { cw: 45, ww: 45, bl: 45, rd: 45 };
  return recipeToHex(safeRecipe, maxByte);
}

export default {
  recipeToHex,
  calculateDPS,
  getCurrentRecipe,
  isScheduleActive,
  timeToMinutes,
  createSafeDefaultHex
};
