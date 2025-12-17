/**
 * Psychrometric calculations for CEA environmental control
 * 
 * Computes VPD, absolute humidity, dew point, and humidity ratio
 * for indoor zones, outdoor conditions, and adjacent units.
 * 
 * These derived signals enable smart ventilation, condensation prevention,
 * and precise VPD control for optimal crop growth.
 */

/**
 * Calculate saturation vapor pressure (kPa) using Magnus-Tetens approximation
 * @param {number} tempC - Temperature in Celsius
 * @returns {number} Saturation vapor pressure in kPa
 */
export function saturationVaporPressure(tempC) {
  if (!Number.isFinite(tempC)) return null;
  // Magnus-Tetens formula: es = 0.61078 * exp(17.27 * T / (T + 237.3))
  return 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
}

/**
 * Calculate VPD (Vapor Pressure Deficit) in kPa
 * @param {number} tempC - Temperature in Celsius
 * @param {number} rhPct - Relative humidity as percentage (0-100)
 * @returns {number|null} VPD in kPa, or null if inputs invalid
 */
export function calculateVPD(tempC, rhPct) {
  const temperature = Number(tempC);
  const humidity = Number(rhPct);
  
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
  if (humidity <= 0) return saturationVaporPressure(temperature); // Dry air edge case
  if (humidity >= 100) return 0; // Saturated air
  
  const es = saturationVaporPressure(temperature);
  const ea = es * (humidity / 100); // Actual vapor pressure
  const vpd = es - ea;
  
  return Math.round(vpd * 100) / 100; // Round to 2 decimal places
}

/**
 * Calculate dew point temperature (°C) using Magnus-Tetens inversion
 * @param {number} tempC - Temperature in Celsius
 * @param {number} rhPct - Relative humidity as percentage (0-100)
 * @returns {number|null} Dew point in Celsius, or null if inputs invalid
 */
export function calculateDewPoint(tempC, rhPct) {
  const temperature = Number(tempC);
  const humidity = Number(rhPct);
  
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) return null;
  if (humidity <= 0 || humidity > 100) return null;
  
  // Calculate actual vapor pressure
  const es = saturationVaporPressure(temperature);
  const ea = es * (humidity / 100);
  
  // Invert Magnus-Tetens: Td = 237.3 * ln(ea/0.61078) / (17.27 - ln(ea/0.61078))
  const lnRatio = Math.log(ea / 0.61078);
  const dewPoint = (237.3 * lnRatio) / (17.27 - lnRatio);
  
  return Math.round(dewPoint * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculate absolute humidity (g H₂O per kg dry air)
 * Also known as humidity ratio or mixing ratio
 * @param {number} tempC - Temperature in Celsius
 * @param {number} rhPct - Relative humidity as percentage (0-100)
 * @param {number} pressureKPa - Atmospheric pressure in kPa (default: 101.325 at sea level)
 * @returns {number|null} Absolute humidity in g/kg, or null if inputs invalid
 */
export function calculateAbsoluteHumidity(tempC, rhPct, pressureKPa = 101.325) {
  const temperature = Number(tempC);
  const humidity = Number(rhPct);
  const pressure = Number(pressureKPa);
  
  if (!Number.isFinite(temperature) || !Number.isFinite(humidity) || !Number.isFinite(pressure)) {
    return null;
  }
  if (humidity <= 0) return 0;
  if (humidity > 100 || pressure <= 0) return null;
  
  // Calculate actual vapor pressure
  const es = saturationVaporPressure(temperature);
  const ea = es * (humidity / 100);
  
  // Humidity ratio: W = 0.622 * (ea / (P - ea))
  // Convert to g/kg by multiplying by 1000
  const humidityRatio = 0.622 * (ea / (pressure - ea)) * 1000;
  
  return Math.round(humidityRatio * 10) / 10; // Round to 1 decimal place
}

/**
 * Calculate psychrometric properties for a given condition
 * @param {number} tempC - Temperature in Celsius
 * @param {number} rhPct - Relative humidity as percentage (0-100)
 * @param {number} pressureKPa - Atmospheric pressure in kPa (default: 101.325)
 * @returns {Object} Psychrometric properties
 */
export function calculatePsychrometrics(tempC, rhPct, pressureKPa = 101.325) {
  const temp = Number(tempC);
  const rh = Number(rhPct);
  
  if (!Number.isFinite(temp) || !Number.isFinite(rh)) {
    return {
      tempC: null,
      rhPct: null,
      vpd: null,
      dewPoint: null,
      absoluteHumidity: null,
      saturationVP: null,
      actualVP: null,
      valid: false
    };
  }
  
  const es = saturationVaporPressure(temp);
  const ea = es * (rh / 100);
  
  return {
    tempC: Math.round(temp * 10) / 10,
    rhPct: Math.round(rh * 10) / 10,
    vpd: calculateVPD(temp, rh),
    dewPoint: calculateDewPoint(temp, rh),
    absoluteHumidity: calculateAbsoluteHumidity(temp, rh, pressureKPa),
    saturationVP: Math.round(es * 1000) / 1000, // kPa
    actualVP: Math.round(ea * 1000) / 1000, // kPa
    valid: true
  };
}

/**
 * Determine if outdoor air is suitable for "free dehumidification"
 * @param {Object} indoor - Indoor psychrometric data
 * @param {Object} outdoor - Outdoor psychrometric data
 * @param {Object} options - Control parameters
 * @param {number} options.absoluteHumidityMargin - Safety margin in g/kg (default: 1.0)
 * @param {number} options.dewPointDelta - Minimum dew point difference in °C (default: 1.5)
 * @returns {Object} Ventilation recommendation
 */
export function evaluateVentilationOpportunity(indoor, outdoor, options = {}) {
  const {
    absoluteHumidityMargin = 1.0,
    dewPointDelta = 1.5
  } = options;
  
  // Validate inputs
  if (!indoor?.valid || !outdoor?.valid) {
    return {
      allow: false,
      reason: 'Invalid sensor data',
      details: {}
    };
  }
  
  const indoorAH = indoor.absoluteHumidity;
  const outdoorAH = outdoor.absoluteHumidity;
  const indoorDP = indoor.dewPoint;
  const outdoorDP = outdoor.dewPoint;
  
  if (indoorAH == null || outdoorAH == null || indoorDP == null || outdoorDP == null) {
    return {
      allow: false,
      reason: 'Incomplete psychrometric data',
      details: {}
    };
  }
  
  // Check absolute humidity: outdoor must be drier by margin
  const ahDiff = indoorAH - outdoorAH;
  const ahCheckPass = ahDiff >= absoluteHumidityMargin;
  
  // Check dew point: outdoor must be lower to avoid condensation
  const dpDiff = indoorDP - outdoorDP;
  const dpCheckPass = dpDiff >= dewPointDelta;
  
  const allow = ahCheckPass && dpCheckPass;
  
  return {
    allow,
    reason: allow 
      ? 'Outdoor air suitable for dehumidification'
      : !ahCheckPass 
        ? 'Outdoor absolute humidity too high'
        : 'Outdoor dew point too high (condensation risk)',
    details: {
      indoorAH,
      outdoorAH,
      ahDiff,
      ahMarginRequired: absoluteHumidityMargin,
      ahCheckPass,
      indoorDP,
      outdoorDP,
      dpDiff,
      dpDeltaRequired: dewPointDelta,
      dpCheckPass,
      energySavings: allow ? 'High - use outdoor air instead of dehumidifier' : null
    }
  };
}

/**
 * Check for condensation risk on leaf surfaces
 * @param {Object} zone - Zone psychrometric data
 * @param {number} leafTempC - Leaf surface temperature (if available, else use air temp)
 * @param {Object} options - Risk thresholds
 * @param {number} options.dewPointMargin - Alert if dew point within this many °C of leaf temp (default: 2.0)
 * @param {number} options.rhThreshold - Alert if RH exceeds this percentage (default: 90)
 * @param {number} options.durationMinutes - Alert if high-risk conditions persist (default: 10)
 * @returns {Object} Condensation risk assessment
 */
export function evaluateCondensationRisk(zone, leafTempC = null, options = {}) {
  const {
    dewPointMargin = 2.0,
    rhThreshold = 90,
    durationMinutes = 10
  } = options;
  
  if (!zone?.valid) {
    return {
      risk: 'unknown',
      reason: 'Invalid sensor data',
      actions: []
    };
  }
  
  // Use leaf temp if available, otherwise assume leaf = air temp
  const leafTemp = leafTempC != null ? Number(leafTempC) : zone.tempC;
  const dewPoint = zone.dewPoint;
  const rh = zone.rhPct;
  
  if (!Number.isFinite(leafTemp) || dewPoint == null || rh == null) {
    return {
      risk: 'unknown',
      reason: 'Incomplete temperature or humidity data',
      actions: []
    };
  }
  
  const dpDiff = leafTemp - dewPoint;
  const dpRisk = dpDiff <= dewPointMargin;
  const rhRisk = rh >= rhThreshold;
  
  let risk = 'low';
  let reason = 'Normal conditions';
  const actions = [];
  
  if (dpRisk && rhRisk) {
    risk = 'high';
    reason = `Dew point within ${dpDiff.toFixed(1)}°C of leaf surface AND RH ${rh.toFixed(1)}% (>=${rhThreshold}%)`;
    actions.push('Force mixing fans immediately');
    actions.push('Increase dehumidifier duty cycle');
    actions.push('Monitor for disease symptoms in next 24-48h');
  } else if (dpRisk) {
    risk = 'medium';
    reason = `Dew point within ${dpDiff.toFixed(1)}°C of leaf surface`;
    actions.push('Increase air mixing to prevent cold spots');
    actions.push('Consider dehumidification if RH rises');
  } else if (rhRisk) {
    risk = 'medium';
    reason = `High RH ${rh.toFixed(1)}% (>=${rhThreshold}%)`;
    actions.push('Activate dehumidifiers if not already running');
    actions.push('Check ventilation opportunities');
  }
  
  return {
    risk,
    reason,
    details: {
      leafTempC: leafTemp,
      dewPointC: dewPoint,
      dewPointDiff: dpDiff,
      rhPct: rh,
      vpdKpa: zone.vpd,
      dewPointMargin,
      rhThreshold
    },
    actions,
    durationThresholdMinutes: durationMinutes
  };
}

/**
 * Calculate spatial variance metrics for mixing control
 * @param {Array<Object>} zonePsychrometrics - Array of zone psychrometric data
 * @returns {Object} Variance metrics
 */
export function calculateSpatialVariance(zonePsychrometrics) {
  if (!Array.isArray(zonePsychrometrics) || zonePsychrometrics.length < 2) {
    return {
      valid: false,
      reason: 'Insufficient zones for variance calculation'
    };
  }
  
  const validZones = zonePsychrometrics.filter(z => z?.valid && z.tempC != null && z.rhPct != null);
  
  if (validZones.length < 2) {
    return {
      valid: false,
      reason: 'Insufficient valid sensor data'
    };
  }
  
  // Calculate mean
  const meanTemp = validZones.reduce((sum, z) => sum + z.tempC, 0) / validZones.length;
  const meanRh = validZones.reduce((sum, z) => sum + z.rhPct, 0) / validZones.length;
  
  // Calculate variance and std deviation
  const tempVariance = validZones.reduce((sum, z) => sum + Math.pow(z.tempC - meanTemp, 2), 0) / validZones.length;
  const rhVariance = validZones.reduce((sum, z) => sum + Math.pow(z.rhPct - meanRh, 2), 0) / validZones.length;
  
  const tempStdDev = Math.sqrt(tempVariance);
  const rhStdDev = Math.sqrt(rhVariance);
  
  // Calculate range
  const tempRange = Math.max(...validZones.map(z => z.tempC)) - Math.min(...validZones.map(z => z.tempC));
  const rhRange = Math.max(...validZones.map(z => z.rhPct)) - Math.min(...validZones.map(z => z.rhPct));
  
  return {
    valid: true,
    zoneCount: validZones.length,
    temperature: {
      mean: Math.round(meanTemp * 10) / 10,
      stdDev: Math.round(tempStdDev * 10) / 10,
      variance: Math.round(tempVariance * 100) / 100,
      range: Math.round(tempRange * 10) / 10,
      min: Math.round(Math.min(...validZones.map(z => z.tempC)) * 10) / 10,
      max: Math.round(Math.max(...validZones.map(z => z.tempC)) * 10) / 10
    },
    humidity: {
      mean: Math.round(meanRh * 10) / 10,
      stdDev: Math.round(rhStdDev * 10) / 10,
      variance: Math.round(rhVariance * 100) / 100,
      range: Math.round(rhRange * 10) / 10,
      min: Math.round(Math.min(...validZones.map(z => z.rhPct)) * 10) / 10,
      max: Math.round(Math.max(...validZones.map(z => z.rhPct)) * 10) / 10
    }
  };
}

/**
 * Estimate latent load (g H₂O/min) from dehumidifier operation
 * @param {number} powerW - Dehumidifier power consumption in Watts
 * @param {number} performanceFactor - Calibrated factor: g H₂O removed per Wh (default: 0.5)
 * @param {number} runtimeMinutes - Runtime duration in minutes
 * @returns {number|null} Estimated moisture removed in grams
 */
export function estimateLatentLoad(powerW, performanceFactor = 0.5, runtimeMinutes = 1) {
  const power = Number(powerW);
  const factor = Number(performanceFactor);
  const runtime = Number(runtimeMinutes);
  
  if (!Number.isFinite(power) || !Number.isFinite(factor) || !Number.isFinite(runtime)) {
    return null;
  }
  
  if (power <= 0 || runtime <= 0) return 0;
  
  // Energy consumed: W * (minutes / 60) = Wh
  const energyWh = power * (runtime / 60);
  
  // Moisture removed: Wh * (g H₂O / Wh)
  const moistureRemoved = energyWh * factor;
  
  return Math.round(moistureRemoved * 10) / 10;
}

export default {
  saturationVaporPressure,
  calculateVPD,
  calculateDewPoint,
  calculateAbsoluteHumidity,
  calculatePsychrometrics,
  evaluateVentilationOpportunity,
  evaluateCondensationRisk,
  calculateSpatialVariance,
  estimateLatentLoad
};
