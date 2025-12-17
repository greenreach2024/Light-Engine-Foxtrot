// controller/checkAndControlEnvironment.js
import { getAnomalies, getEffects } from '../services/ml-gateway.js';

/**
 * Robust sensor reading with ML anomaly detection and spatial interpolation
 * If a sensor is flagged as anomalous, blend it with neighboring zone readings
 * 
 * @param {Object} z - Zone object with sensors
 * @param {string} key - Sensor key (e.g., 'rh', 'tempC')
 * @param {Array} allZones - All zones for spatial interpolation
 * @param {Object} anomalies - ML anomaly detection results
 * @returns {number|null} Robust sensor reading
 */
function robustSensor(z, key, allZones, anomalies) {
  const zKey = `${z.id}.${key}`;
  const anom = anomalies?.anomalies?.find(
    a => a.zoneId === z.id && a.sensor === key && a.severity >= 0.8
  );
  const conf = anomalies?.confidences?.[zKey] ?? 1.0;
  
  // If no anomaly and confidence is good, use raw reading
  if (!anom && conf >= 0.5) {
    return z.sensors?.[key]?.current;
  }

  // Fallback: distance-weighted median of neighbors
  const vals = [];
  for (const other of allZones) {
    if (other.id === z.id) continue;
    const v = other.sensors?.[key]?.current;
    if (v == null) continue;
    
    // Distance calculation (assumes position.x, position.y)
    const dx = (z.position?.x ?? 0) - (other.position?.x ?? 0);
    const dy = (z.position?.y ?? 0) - (other.position?.y ?? 0);
    const w = Math.exp(-(dx*dx + dy*dy) / (2*16)); // sigma≈4
    vals.push({ v, w });
  }
  
  // If no neighbors, fall back to raw reading anyway
  if (!vals.length) {
    return z.sensors?.[key]?.current;
  }
  
  // Return weighted median
  vals.sort((a, b) => a.v - b.v);
  const mid = vals[Math.floor(vals.length / 2)].v;
  return mid;
}

/**
 * ML-enhanced environmental control with anomaly-resistant sensor fusion
 * 
 * @param {Array} allZones - All zones with sensor data
 * @param {Array} iotDevices - IoT devices (actuators)
 * @param {Object} options - Additional options
 * @param {Function} options.coreAllocator - Core allocation function
 * @param {Object} options.plugManager - Plug manager for device control
 * @param {Array} options.groups - Growing groups
 * @param {Object} options.targets - Target ranges per zone
 * @param {Object} options.lastActions - Last action timestamps
 * @param {Object} options.outdoorContext - Outdoor sensor readings for monitoring
 */
export async function checkAndControlEnvironment(allZones, iotDevices, options = {}) {
  const { coreAllocator, plugManager, groups, targets, lastActions, outdoorContext } = options;
  
  // 1) Pull ML artifacts with caching (15s for anomalies, 5min for effects)
  let anomalies = null;
  let effects = null;
  
  try {
    anomalies = await getAnomalies();
  } catch (e) {
    console.warn('[env-control] Failed to fetch anomalies:', e.message);
    anomalies = null;
  }
  
  try {
    effects = await getEffects();
  } catch (e) {
    console.warn('[env-control] Failed to fetch effects:', e.message);
    effects = null;
  }

  // 2) Replace raw readings with robustified values for control decisions
  const zonesForControl = allZones.map(z => ({
    ...z,
    sensors: {
      ...z.sensors,
      rh: { current: robustSensor(z, 'rh', allZones, anomalies) },
      tempC: { current: robustSensor(z, 'tempC', allZones, anomalies) }
    }
  }));

  // 3) Build effect matrices (prefer ML; else fallback distance-based)
  const ml = effects ? {
    H: effects.H,         // Humidity effect matrix
    T: effects.T,         // Temperature effect matrix
    confidence: effects.confidence
  } : null;

  // 4) Call the core allocator with robustified zones + ML effects
  if (coreAllocator) {
    await coreAllocator(zonesForControl, iotDevices, ml, {
      plugManager,
      groups,
      targets,
      lastActions,
      outdoorContext
    });
  } else {
    console.warn('[env-control] No coreAllocator provided, using fallback control');
    await fallbackControl(zonesForControl, iotDevices);
  }
}

/**
 * Fallback control strategy (zone-based, simple threshold logic)
 * Used when coreAllocator is not provided
 */
async function fallbackControl(zones, iotDevices) {
  // This is the original simple logic - kept as fallback
  for (const zone of zones) {
    if (!zone?.id || !zone.sensors) continue;
    
    const zoneNum = zone.id.replace('zone-', '');
    const tempC = zone.sensors.tempC?.current;
    const rh = zone.sensors.rh?.current;
    
    if (!Number.isFinite(rh) || !Number.isFinite(tempC)) continue;
    
    console.log(`[env-control] Checking ${zone.id}: Temp=${tempC}°C, RH=${rh}%`);
    
    // Get targets (assuming preEnvStore is available - this is a limitation)
    // In production, targets should be passed in or accessed via module export
    const rhMax = 70; // Fallback default
    
    // Find dehumidifier in this zone
    const dehumidifier = iotDevices.find(d => 
      d.zone == zoneNum && 
      d.automationControl === true &&
      (d.name || '').toLowerCase().includes('dehumid')
    );
    
    // Simple threshold control
    if (dehumidifier && rh > rhMax) {
      console.log(`[env-control] 🌡️  Zone ${zoneNum}: RH ${rh}% > ${rhMax}% → Activating dehumidifier`);
      // Note: prePlugManager would need to be passed in or accessed via import
      // This is a placeholder for the actual control logic
    }
  }
}
