/**
 * Outdoor Sensor Validation Gateway
 * 
 * Validates outdoor sensor data freshness and quality for ML operations.
 * Prevents ML jobs from running with stale or missing outdoor data.
 * 
 * @module lib/outdoor-sensor-validator
 */

/**
 * Maximum age for outdoor sensor data to be considered fresh (30 minutes)
 */
const OUTDOOR_DATA_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * Minimum reasonable outdoor temperature (°C)
 */
const MIN_OUTDOOR_TEMP = -40;

/**
 * Maximum reasonable outdoor temperature (°C)
 */
const MAX_OUTDOOR_TEMP = 60;

/**
 * Minimum reasonable outdoor humidity (%)
 */
const MIN_OUTDOOR_RH = 0;

/**
 * Maximum reasonable outdoor humidity (%)
 */
const MAX_OUTDOOR_RH = 100;

/**
 * Validate outdoor sensor data freshness and quality
 * 
 * @param {Object} sensorData - Latest outdoor sensor reading
 * @param {number} sensorData.temp - Outdoor temperature (°C)
 * @param {number} sensorData.rh - Outdoor relative humidity (%)
 * @param {string} sensorData.timestamp - ISO timestamp of reading
 * @param {string} sensorData.zone - Sensor zone name
 * @returns {Object} Validation result
 */
export function validateOutdoorSensor(sensorData) {
  const result = {
    isValid: true,
    isFresh: true,
    isReasonable: true,
    age_minutes: null,
    errors: [],
    warnings: [],
    metadata: {
      sensor_zone: sensorData?.zone || 'unknown',
      last_reading: sensorData?.timestamp || null,
    }
  };

  // Check if sensor data exists
  if (!sensorData) {
    result.isValid = false;
    result.isFresh = false;
    result.errors.push('No outdoor sensor data available');
    return result;
  }

  // Check timestamp
  if (!sensorData.timestamp) {
    result.isValid = false;
    result.isFresh = false;
    result.errors.push('Outdoor sensor data missing timestamp');
    return result;
  }

  // Calculate age
  const timestamp = new Date(sensorData.timestamp);
  const age = Date.now() - timestamp.getTime();
  result.age_minutes = Math.round(age / 60000);

  // Check freshness
  if (age > OUTDOOR_DATA_MAX_AGE_MS) {
    result.isValid = false;
    result.isFresh = false;
    result.errors.push(
      `Outdoor sensor data is stale (${result.age_minutes} minutes old, max: 30 minutes)`
    );
  }

  // Check temperature
  if (sensorData.temp !== null && sensorData.temp !== undefined) {
    if (sensorData.temp < MIN_OUTDOOR_TEMP || sensorData.temp > MAX_OUTDOOR_TEMP) {
      result.isReasonable = false;
      result.warnings.push(
        `Outdoor temperature ${sensorData.temp}°C is outside reasonable range (${MIN_OUTDOOR_TEMP} to ${MAX_OUTDOOR_TEMP}°C)`
      );
    }
  } else {
    result.isValid = false;
    result.errors.push('Outdoor temperature reading is missing');
  }

  // Check humidity
  if (sensorData.rh !== null && sensorData.rh !== undefined) {
    if (sensorData.rh < MIN_OUTDOOR_RH || sensorData.rh > MAX_OUTDOOR_RH) {
      result.isReasonable = false;
      result.warnings.push(
        `Outdoor humidity ${sensorData.rh}% is outside reasonable range (${MIN_OUTDOOR_RH} to ${MAX_OUTDOOR_RH}%)`
      );
    }
  } else {
    result.isValid = false;
    result.errors.push('Outdoor humidity reading is missing');
  }

  // Final validity check
  if (result.errors.length > 0) {
    result.isValid = false;
  }

  return result;
}

/**
 * Find outdoor sensor from environmental data
 * 
 * @param {Array|Object} envData - Array of environmental sensor readings or env object
 * @returns {Object|null} Latest outdoor sensor reading or null
 */
export function findOutdoorSensor(envData) {
  // Handle array format (from API zones)
  if (Array.isArray(envData)) {
    if (envData.length === 0) {
      return null;
    }

    // Find sensors with "outdoor" or "outside" in zone name
    const outdoorSensors = envData.filter(reading => {
      const zone = reading.zone?.toLowerCase() || reading.id?.toLowerCase() || '';
      return zone.includes('outdoor') || zone.includes('outside');
    });

    if (outdoorSensors.length === 0) {
      return null;
    }

    // Sort by timestamp (most recent first)
    outdoorSensors.sort((a, b) => {
      const aTime = new Date(a.timestamp || a.updatedAt).getTime();
      const bTime = new Date(b.timestamp || b.updatedAt).getTime();
      return bTime - aTime;
    });

    // Extract sensor data from zone
    const latestZone = outdoorSensors[0];
    
    // Try to extract from sensors object
    if (latestZone.sensors) {
      const tempSensor = latestZone.sensors.temp || latestZone.sensors.temperature;
      const rhSensor = latestZone.sensors.rh || latestZone.sensors.humidity;
      
      return {
        temp: tempSensor?.current !== undefined ? tempSensor.current : null,
        rh: rhSensor?.current !== undefined ? rhSensor.current : null,
        timestamp: tempSensor?.observedAt || latestZone.updatedAt || latestZone.timestamp,
        zone: latestZone.name || latestZone.id || latestZone.zone
      };
    }
    
    // Fallback to direct properties
    return {
      temp: latestZone.temp !== undefined ? latestZone.temp : null,
      rh: latestZone.rh !== undefined ? latestZone.rh : null,
      timestamp: latestZone.timestamp || latestZone.updatedAt,
      zone: latestZone.zone || latestZone.id || latestZone.name
    };
  }
  
  // Handle object format (from env.json)
  if (envData && typeof envData === 'object') {
    const rooms = envData.rooms || {};
    
    // Find outdoor room
    for (const [roomId, roomData] of Object.entries(rooms)) {
      const roomName = roomData.name?.toLowerCase() || roomId.toLowerCase();
      if (roomName.includes('outdoor') || roomName.includes('outside')) {
        return {
          temp: roomData.temp !== undefined ? roomData.temp : null,
          rh: roomData.rh !== undefined ? roomData.rh : null,
          timestamp: roomData.updatedAt || roomData.timestamp || envData.updatedAt,
          zone: roomData.name || roomId
        };
      }
    }
  }

  return null;
}

/**
 * Gate ML operations based on outdoor sensor validity
 * 
 * @param {Object} validationResult - Result from validateOutdoorSensor()
 * @returns {Object} Gate decision with message
 */
export function gateMLOperation(validationResult) {
  if (!validationResult.isValid) {
    return {
      allowed: false,
      reason: 'outdoor_data_invalid',
      message: validationResult.errors.join('; '),
      errors: validationResult.errors
    };
  }

  if (!validationResult.isFresh) {
    return {
      allowed: false,
      reason: 'outdoor_data_stale',
      message: `Outdoor sensor data is too old (${validationResult.age_minutes} minutes)`,
      age_minutes: validationResult.age_minutes
    };
  }

  if (!validationResult.isReasonable) {
    return {
      allowed: true, // Allow but warn
      reason: 'outdoor_data_unreasonable',
      message: 'ML will proceed but outdoor data may be unreliable',
      warnings: validationResult.warnings
    };
  }

  return {
    allowed: true,
    reason: 'outdoor_data_valid',
    message: 'Outdoor sensor data is fresh and valid',
    age_minutes: validationResult.age_minutes
  };
}

/**
 * Get validation summary for API response
 * 
 * @param {Object} validationResult - Result from validateOutdoorSensor()
 * @returns {Object} Summary for API clients
 */
export function getValidationSummary(validationResult) {
  return {
    outdoor_sensor_status: validationResult.isValid ? 'valid' : 'invalid',
    is_fresh: validationResult.isFresh,
    is_reasonable: validationResult.isReasonable,
    age_minutes: validationResult.age_minutes,
    sensor_zone: validationResult.metadata.sensor_zone,
    last_reading: validationResult.metadata.last_reading,
    ml_ready: validationResult.isValid && validationResult.isFresh,
    errors: validationResult.errors,
    warnings: validationResult.warnings
  };
}

export default {
  validateOutdoorSensor,
  findOutdoorSensor,
  gateMLOperation,
  getValidationSummary,
  OUTDOOR_DATA_MAX_AGE_MS
};
