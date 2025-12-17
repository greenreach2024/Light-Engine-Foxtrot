/**
 * Spectrum & Environment Math Utilities
 * 
 * Provides spectral power distribution (SPD) calculations, band integration,
 * YPF weighting, and environmental adjustments for Light Engine Charlie.
 * 
 * @module spectrum_env_math
 */

// ============================================================================
// Constants & Wavelength Grid
// ============================================================================

/**
 * Wavelength grid for PAR range (400-750 nm) in 5nm increments
 * Total: 71 points covering photosynthetically active radiation
 */
export const WL = (() => {
  const start = 400;
  const end = 750;
  const step = 5;
  const points = [];
  for (let wl = start; wl <= end; wl += step) {
    points.push(wl);
  }
  return points;
})();

/**
 * PAR spectral bands for horticultural analysis
 * Based on McCree curve and plant photoreceptor sensitivities
 */
export const BANDS = {
  // Photosynthetic bands
  UV_A: { min: 315, max: 400, name: 'UV-A' },          // UV-A (not in PAR but relevant)
  BLUE: { min: 400, max: 500, name: 'Blue' },          // Blue (400-500nm)
  GREEN: { min: 500, max: 600, name: 'Green' },        // Green (500-600nm)
  RED: { min: 600, max: 700, name: 'Red' },            // Red (600-700nm)
  FAR_RED: { min: 700, max: 750, name: 'Far-Red' },    // Far-Red (700-750nm)
  
  // Sub-bands for detailed analysis
  VIOLET: { min: 400, max: 450, name: 'Violet' },      // 400-450nm
  BLUE_CYAN: { min: 450, max: 500, name: 'Cyan' },     // 450-500nm
  GREEN_YELLOW: { min: 500, max: 580, name: 'Yellow-Green' }, // 500-580nm
  ORANGE: { min: 580, max: 620, name: 'Orange' },      // 580-620nm
  DEEP_RED: { min: 620, max: 700, name: 'Deep Red' },  // 620-700nm
  
  // PAR total
  PAR: { min: 400, max: 700, name: 'PAR' }             // Full PAR range
};

// ============================================================================
// Spectral Power Distribution Basis Functions
// ============================================================================

/**
 * Normalized SPD basis functions for 4-channel LED system
 * Each array corresponds to the WL grid (400-750nm in 5nm steps)
 * Values are normalized to peak = 1.0
 */
export const BASIS = {
  /**
   * Cool White (5000-6500K) - Phosphor-converted white LED
   * Broad spectrum with peak in blue region, secondary yellow hump
   */
  cw: [
    0.30, 0.45, 0.65, 0.85, 1.00, 0.95, 0.85, 0.75, 0.68, 0.62,  // 400-445nm (blue peak)
    0.58, 0.55, 0.53, 0.52, 0.51, 0.51, 0.52, 0.54, 0.57, 0.61,  // 450-495nm
    0.65, 0.69, 0.72, 0.74, 0.75, 0.74, 0.72, 0.69, 0.65, 0.60,  // 500-545nm (green)
    0.55, 0.50, 0.45, 0.40, 0.35, 0.31, 0.27, 0.23, 0.20, 0.17,  // 550-595nm
    0.15, 0.13, 0.11, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03,  // 600-645nm
    0.03, 0.02, 0.02, 0.02, 0.01, 0.01, 0.01, 0.01, 0.01, 0.00,  // 650-695nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 700-745nm
    0.00  // 750nm
  ],
  
  /**
   * Warm White (2700-3500K) - Phosphor-converted white LED
   * Broader spectrum with more yellow/red content
   */
  ww: [
    0.25, 0.35, 0.50, 0.70, 0.85, 0.90, 0.88, 0.82, 0.76, 0.70,  // 400-445nm
    0.65, 0.62, 0.60, 0.59, 0.59, 0.60, 0.62, 0.65, 0.69, 0.74,  // 450-495nm
    0.79, 0.84, 0.89, 0.93, 0.96, 0.98, 1.00, 0.99, 0.97, 0.93,  // 500-545nm (yellow peak)
    0.88, 0.82, 0.76, 0.69, 0.62, 0.56, 0.50, 0.44, 0.39, 0.34,  // 550-595nm
    0.30, 0.26, 0.23, 0.20, 0.17, 0.15, 0.13, 0.11, 0.09, 0.08,  // 600-645nm
    0.07, 0.06, 0.05, 0.04, 0.04, 0.03, 0.03, 0.02, 0.02, 0.02,  // 650-695nm
    0.01, 0.01, 0.01, 0.01, 0.01, 0.00, 0.00, 0.00, 0.00, 0.00,  // 700-745nm
    0.00  // 750nm
  ],
  
  /**
   * Blue LED (440-460nm peak) - Monochromatic blue
   * Narrow band centered around 450nm
   */
  bl: [
    0.02, 0.05, 0.12, 0.25, 0.45, 0.70, 0.90, 1.00, 0.95, 0.75,  // 400-445nm (peak at 450nm)
    0.50, 0.30, 0.15, 0.07, 0.03, 0.01, 0.01, 0.00, 0.00, 0.00,  // 450-495nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 500-545nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 550-595nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 600-645nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 650-695nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 700-745nm
    0.00  // 750nm
  ],
  
  /**
   * Red LED (655-665nm peak) - Monochromatic deep red
   * Narrow band centered around 660nm
   */
  rd: [
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 400-445nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 450-495nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 500-545nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 550-595nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 600-645nm
    0.02, 0.08, 0.25, 0.60, 0.90, 1.00, 0.85, 0.50, 0.20, 0.05,  // 650-695nm (peak at 660nm)
    0.01, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 700-745nm
    0.00  // 750nm
  ],
  
  /**
   * Far-Red LED (720-740nm) - Optional channel
   * For R:FR ratio manipulation
   */
  fr: [
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 400-445nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 450-495nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 500-545nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 550-595nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 600-645nm
    0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00, 0.00,  // 650-695nm
    0.05, 0.15, 0.40, 0.70, 0.95, 1.00, 0.90, 0.60, 0.25, 0.08,  // 700-745nm (peak at 730nm)
    0.02  // 750nm
  ]
};

// Validate BASIS arrays match WL length
Object.keys(BASIS).forEach(key => {
  if (BASIS[key].length !== WL.length) {
    console.error(`BASIS.${key} length mismatch: expected ${WL.length}, got ${BASIS[key].length}`);
  }
});

// ============================================================================
// Integration Functions
// ============================================================================

/**
 * Integrate SPD over a wavelength range using trapezoidal rule
 * @param {number[]} spd - Spectral power distribution array
 * @param {number} minWL - Minimum wavelength (nm)
 * @param {number} maxWL - Maximum wavelength (nm)
 * @returns {number} - Integrated value
 */
export function integrate(spd, minWL, maxWL) {
  if (!Array.isArray(spd) || spd.length !== WL.length) {
    throw new Error('SPD array must match wavelength grid length');
  }
  
  let sum = 0;
  const step = WL[1] - WL[0]; // Should be 5nm
  
  for (let i = 0; i < WL.length - 1; i++) {
    const wl = WL[i];
    const nextWl = WL[i + 1];
    
    // Check if this segment overlaps with [minWL, maxWL]
    if (nextWl <= minWL || wl >= maxWL) continue;
    
    // Trapezoidal rule: average of two points * width
    const y1 = spd[i];
    const y2 = spd[i + 1];
    sum += (y1 + y2) * step / 2;
  }
  
  return sum;
}

/**
 * Integrate SPD over a named band
 * @param {number[]} spd - Spectral power distribution array
 * @param {string} bandName - Band name from BANDS (e.g., 'BLUE', 'GREEN', 'RED')
 * @returns {number} - Integrated value
 */
export function integrateBand(spd, bandName) {
  const band = BANDS[bandName];
  if (!band) {
    throw new Error(`Unknown band: ${bandName}`);
  }
  return integrate(spd, band.min, band.max);
}

// ============================================================================
// Spectral Mixing
// ============================================================================

/**
 * Mix multiple SPD basis functions with given weights
 * @param {Object} mix - Channel mix object {cw: %, ww: %, bl: %, rd: %, fr: %}
 * @returns {number[]} - Composite SPD array
 */
export function mixSPD(mix) {
  const result = new Array(WL.length).fill(0);
  
  // Normalize weights to 0-1 range
  const channels = ['cw', 'ww', 'bl', 'rd', 'fr'];
  channels.forEach(ch => {
    const weight = (mix[ch] || 0) / 100; // Convert percent to fraction
    if (weight <= 0 || !BASIS[ch]) return;
    
    for (let i = 0; i < WL.length; i++) {
      result[i] += BASIS[ch][i] * weight;
    }
  });
  
  return result;
}

/**
 * Calculate band percentages from an SPD
 * @param {number[]} spd - Spectral power distribution
 * @param {string[]} bands - Array of band names to calculate (default: BLUE, GREEN, RED, FAR_RED)
 * @returns {Object} - Band percentages {BLUE: %, GREEN: %, RED: %, FAR_RED: %}
 */
export function calculateBandPercentages(spd, bands = ['BLUE', 'GREEN', 'RED', 'FAR_RED']) {
  const integrals = {};
  let total = 0;
  
  bands.forEach(band => {
    const value = integrateBand(spd, band);
    integrals[band] = value;
    total += value;
  });
  
  const percentages = {};
  if (total > 0) {
    bands.forEach(band => {
      percentages[band] = (integrals[band] / total) * 100;
    });
  } else {
    bands.forEach(band => {
      percentages[band] = 0;
    });
  }
  
  return percentages;
}

// ============================================================================
// Green Split Function (SPD-Weighted)
// ============================================================================

/**
 * Split green percentage into CW and WW using SPD-weighted method
 * 
 * This calculates how much green (500-600nm) each white channel produces,
 * then distributes the requested green percentage proportionally.
 * 
 * @param {number} greenPercent - Desired green percentage (0-100)
 * @returns {Object} - {cw: number, ww: number} channel increments
 */
export function splitGreenIntoWhites(greenPercent) {
  if (greenPercent === null || greenPercent === undefined || greenPercent <= 0) {
    return { cw: 0, ww: 0 };
  }
  
  // Integrate CW and WW SPDs over green band (500-600nm)
  const cwGreen = integrate(BASIS.cw, 500, 600);
  const wwGreen = integrate(BASIS.ww, 500, 600);
  
  const totalGreen = cwGreen + wwGreen;
  
  if (totalGreen <= 0) {
    // Fallback to 50/50 if SPD data unavailable
    return { cw: greenPercent / 2, ww: greenPercent / 2 };
  }
  
  // Weight by actual green production capability
  const cwRatio = cwGreen / totalGreen;
  const wwRatio = wwGreen / totalGreen;
  
  return {
    cw: greenPercent * cwRatio,
    ww: greenPercent * wwRatio
  };
}

// ============================================================================
// YPF (Yield Photon Flux) Weighting
// ============================================================================

/**
 * McCree Relative Quantum Efficiency curve (simplified)
 * Approximation of plant photosynthetic response by wavelength
 * Peak normalized to 1.0 at ~610nm
 */
const YPF_WEIGHTS = (() => {
  const weights = new Array(WL.length).fill(0);
  
  for (let i = 0; i < WL.length; i++) {
    const wl = WL[i];
    
    if (wl < 400 || wl > 700) {
      weights[i] = 0; // Outside PAR range
    } else if (wl <= 550) {
      // Blue-green region: rising from 400-550nm
      weights[i] = 0.2 + 0.6 * ((wl - 400) / 150);
    } else if (wl <= 610) {
      // Green-orange region: peak around 610nm
      weights[i] = 0.8 + 0.2 * (1 - Math.abs(wl - 610) / 60);
    } else {
      // Red region: declining from 610-700nm
      weights[i] = 1.0 - 0.15 * ((wl - 610) / 90);
    }
    
    // Clamp to [0, 1]
    weights[i] = Math.max(0, Math.min(1, weights[i]));
  }
  
  return weights;
})();

/**
 * Calculate YPF-weighted integral (photosynthetically effective photons)
 * @param {number[]} spd - Spectral power distribution
 * @returns {number} - YPF-weighted integral
 */
export function calculateYPF(spd) {
  const weighted = spd.map((val, i) => val * YPF_WEIGHTS[i]);
  return integrate(weighted, 400, 700);
}

// ============================================================================
// Environmental Adjustments
// ============================================================================

/**
 * Calculate VPD (Vapor Pressure Deficit) in kPa
 * @param {number} tempC - Temperature in Celsius
 * @param {number} rhPercent - Relative humidity percentage (0-100)
 * @returns {number} - VPD in kPa
 */
export function calculateVPD(tempC, rhPercent) {
  // Saturated vapor pressure (Tetens equation)
  const svp = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  
  // Actual vapor pressure
  const avp = svp * (rhPercent / 100);
  
  // VPD = SVP - AVP
  return Math.max(0, svp - avp);
}

/**
 * Calculate VPD-driven blue adjustment
 * High VPD → increase blue to close stomata
 * Low VPD → decrease blue to open stomata
 * 
 * @param {number} vpd - VPD in kPa
 * @param {number} targetVPD - Target VPD in kPa (default 1.0)
 * @param {number} maxAdjust - Maximum adjustment percentage (default ±20)
 * @returns {number} - Blue adjustment percentage (-20 to +20)
 */
export function calculateBlueAdjustment(vpd, targetVPD = 1.0, maxAdjust = 20) {
  if (vpd === null || vpd === undefined || !isFinite(vpd)) {
    return 0;
  }
  
  // Delta from target
  const delta = vpd - targetVPD;
  
  // Scale linearly: ±1 kPa → ±maxAdjust%
  const adjust = delta * maxAdjust;
  
  // Clamp to [-maxAdjust, +maxAdjust]
  return Math.max(-maxAdjust, Math.min(maxAdjust, adjust));
}

/**
 * Calculate canopy temperature-driven PPFD adjustment
 * Hot canopy → reduce PPFD to prevent stress
 * Cool canopy → increase PPFD for growth
 * 
 * @param {number} canopyTempC - Canopy temperature in Celsius
 * @param {number} targetTempC - Target temperature in Celsius (default 24)
 * @param {number} maxAdjust - Maximum adjustment percentage (default ±30)
 * @returns {number} - PPFD adjustment percentage (-30 to +30)
 */
export function calculatePPFDAdjustment(canopyTempC, targetTempC = 24, maxAdjust = 30) {
  if (canopyTempC === null || canopyTempC === undefined || !isFinite(canopyTempC)) {
    return 0;
  }
  
  // Delta from target
  const delta = canopyTempC - targetTempC;
  
  // Inverse relationship: hot → reduce, cool → increase
  // Scale: ±3°C → ∓maxAdjust%
  const adjust = -delta * (maxAdjust / 3);
  
  // Clamp to [-maxAdjust, +maxAdjust]
  return Math.max(-maxAdjust, Math.min(maxAdjust, adjust));
}

// ============================================================================
// Exports Summary
// ============================================================================

export default {
  WL,
  BANDS,
  BASIS,
  integrate,
  integrateBand,
  mixSPD,
  calculateBandPercentages,
  splitGreenIntoWhites,
  calculateYPF,
  calculateVPD,
  calculateBlueAdjustment,
  calculatePPFDAdjustment
};
