/**
 * Anomaly Diagnostics Engine
 * 
 * Adds diagnostic reasoning layer on top of IsolationForest anomaly detection.
 * Progressive enhancement: works with minimal data, enhances with available context.
 * 
 * Integration: anomaly-detector.py → this module → Activity Hub alerts
 */

import fs from 'fs';
import path from 'path';

export class AnomalyDiagnostics {
  constructor(dataDir) {
    this.dataDir = dataDir;
  }

  /**
   * Analyze anomaly and provide diagnostic reasoning
   * @param {Object} anomaly - Anomaly from IsolationForest detector
   * @param {Object} context - Additional context (weather, automation logs, etc)
   * @returns {Object} Enhanced anomaly with diagnostic info
   */
  diagnose(anomaly, context = {}) {
    const diagnostic = {
      ...anomaly,
      diagnosis: {
        category: null,
        rootCause: null,
        confidence: 0,
        weatherRelated: false,
        suggestions: [],
        urgency: 'low'
      }
    };

    // Step 1: Check if weather-correlated (not equipment failure)
    if (this._isWeatherCorrelated(anomaly, context.weather)) {
      diagnostic.diagnosis.category = 'weather_correlated';
      diagnostic.diagnosis.weatherRelated = true;
      diagnostic.diagnosis.confidence = 0.85;
      diagnostic.diagnosis.urgency = 'low';
      return this._addWeatherDiagnosis(diagnostic, anomaly, context.weather);
    }

    // Step 2: Check for sensor issues (always detectable)
    const sensorIssue = this._checkSensorIssues(anomaly, context.history);
    if (sensorIssue) {
      diagnostic.diagnosis.category = 'sensor_issue';
      diagnostic.diagnosis.rootCause = sensorIssue.cause;
      diagnostic.diagnosis.confidence = sensorIssue.confidence;
      diagnostic.diagnosis.suggestions = sensorIssue.suggestions;
      diagnostic.diagnosis.urgency = sensorIssue.urgency;
      return diagnostic;
    }

    // Step 3: Check control loop patterns
    const controlIssue = this._checkControlPatterns(anomaly, context.history);
    if (controlIssue) {
      diagnostic.diagnosis.category = 'control_loop';
      diagnostic.diagnosis.rootCause = controlIssue.cause;
      diagnostic.diagnosis.confidence = controlIssue.confidence;
      diagnostic.diagnosis.suggestions = controlIssue.suggestions;
      diagnostic.diagnosis.urgency = controlIssue.urgency;
      return diagnostic;
    }

    // Step 4: Progressive enhancement - check equipment status if available
    if (context.automationLogs) {
      const equipmentIssue = this._checkEquipmentStatus(anomaly, context.automationLogs);
      if (equipmentIssue) {
        diagnostic.diagnosis.category = 'equipment_failure';
        diagnostic.diagnosis.rootCause = equipmentIssue.cause;
        diagnostic.diagnosis.confidence = equipmentIssue.confidence;
        diagnostic.diagnosis.suggestions = equipmentIssue.suggestions;
        diagnostic.diagnosis.urgency = equipmentIssue.urgency;
        return diagnostic;
      }
    }

    // Step 5: General environmental issue
    diagnostic.diagnosis.category = 'environmental';
    diagnostic.diagnosis.rootCause = 'Unusual environmental conditions detected';
    diagnostic.diagnosis.confidence = 0.60;
    diagnostic.diagnosis.suggestions = this._getGeneralSuggestions(anomaly);
    diagnostic.diagnosis.urgency = this._calculateUrgency(anomaly);

    return diagnostic;
  }

  /**
   * Check if anomaly correlates with outdoor weather (not equipment failure)
   */
  _isWeatherCorrelated(anomaly, weather) {
    if (!weather || !anomaly.outdoor_temp) return false;

    const indoorTemp = anomaly.indoor_temp;
    const outdoorTemp = anomaly.outdoor_temp;
    const indoorRh = anomaly.indoor_rh;
    const outdoorRh = anomaly.outdoor_rh;

    // Hot outdoor causing hot indoor (normal strain)
    if (outdoorTemp > 30 && indoorTemp > 25 && (indoorTemp - outdoorTemp) < 10) {
      return true;
    }

    // Cold outdoor causing cold indoor (normal strain)
    if (outdoorTemp < 5 && indoorTemp < 18 && (indoorTemp - outdoorTemp) > -5) {
      return true;
    }

    // High outdoor humidity causing high indoor humidity
    if (outdoorRh > 85 && indoorRh > 70 && Math.abs(indoorRh - outdoorRh) < 20) {
      return true;
    }

    // Rapid outdoor temp change causing indoor lag
    if (weather.tempChange24h && Math.abs(weather.tempChange24h) > 15) {
      return true;
    }

    return false;
  }

  /**
   * Add weather-specific diagnosis
   */
  _addWeatherDiagnosis(diagnostic, anomaly, weather) {
    const outdoorTemp = anomaly.outdoor_temp;
    const indoorTemp = anomaly.indoor_temp;
    const outdoorRh = anomaly.outdoor_rh;
    const indoorRh = anomaly.indoor_rh;

    if (outdoorTemp > 30) {
      diagnostic.diagnosis.rootCause = `Heat wave causing indoor temperature rise (${indoorTemp.toFixed(1)}°C)`;
      diagnostic.diagnosis.suggestions = [
        'This is normal during extreme heat',
        'Increase ventilation during cooler evening hours',
        'Consider shade cloth if temperature persists above 28°C',
        'Monitor crop stress indicators'
      ];
    } else if (outdoorTemp < 5) {
      diagnostic.diagnosis.rootCause = `Cold weather causing indoor temperature drop (${indoorTemp.toFixed(1)}°C)`;
      diagnostic.diagnosis.suggestions = [
        'This is normal during cold weather',
        'Check insulation and seal air leaks',
        'Verify heating system is active',
        'Monitor for frost risk if below 10°C'
      ];
    } else if (outdoorRh > 85) {
      diagnostic.diagnosis.rootCause = `High outdoor humidity (${outdoorRh.toFixed(0)}%) affecting indoor levels (${indoorRh.toFixed(0)}%)`;
      diagnostic.diagnosis.suggestions = [
        'This is normal during humid weather',
        'Reduce watering frequency',
        'Increase air circulation',
        'Run dehumidifier if available'
      ];
    } else if (weather.tempChange24h && Math.abs(weather.tempChange24h) > 15) {
      diagnostic.diagnosis.rootCause = `Rapid weather change (${weather.tempChange24h.toFixed(1)}°C in 24h) causing indoor adjustment lag`;
      diagnostic.diagnosis.suggestions = [
        'Indoor temperature adjusting to weather shift',
        'This is temporary (2-4 hours typical)',
        'Monitor trend rather than absolute values',
        'No action needed unless conditions persist >6 hours'
      ];
    }

    return diagnostic;
  }

  /**
   * Check for sensor-related issues (flatline, drift, out of range)
   */
  _checkSensorIssues(anomaly, history) {
    if (!history || history.length < 3) return null;

    const recentReadings = history.slice(-12); // Last hour at 5-min intervals
    const temps = recentReadings.map(r => r.temp).filter(t => t !== null && t !== undefined);
    const rhs = recentReadings.map(r => r.rh).filter(h => h !== null && h !== undefined);

    // Flatline detection (no change >30 min)
    if (temps.length >= 6) {
      const variance = this._calculateVariance(temps);
      if (variance < 0.01) {
        return {
          cause: 'Sensor appears to be flatlined (no readings changing)',
          confidence: 0.90,
          urgency: 'high',
          suggestions: [
            'Check sensor power connection',
            'Verify sensor is not frozen or stuck',
            'Check wireless signal if using WiFi/BLE sensor',
            'Try power cycling the sensor',
            'Replace sensor if issue persists'
          ]
        };
      }
    }

    // Out of range detection
    const temp = anomaly.indoor_temp;
    const rh = anomaly.indoor_rh;

    if (temp < -10 || temp > 50) {
      return {
        cause: `Temperature reading (${temp.toFixed(1)}°C) is outside realistic range`,
        confidence: 0.95,
        urgency: 'high',
        suggestions: [
          'Sensor likely malfunctioning',
          'Check sensor calibration',
          'Verify sensor is not exposed to extreme conditions',
          'Replace sensor'
        ]
      };
    }

    if (rh < 5 || rh > 100) {
      return {
        cause: `Humidity reading (${rh.toFixed(0)}%) is outside valid range`,
        confidence: 0.95,
        urgency: 'high',
        suggestions: [
          'Humidity sensor likely malfunctioning',
          'Check for water damage or contamination',
          'Verify sensor is not blocked',
          'Replace sensor'
        ]
      };
    }

    // Sensor drift detection (compare with other zones if available)
    // This would require multi-zone data - skip for now

    return null;
  }

  /**
   * Check for control loop patterns (oscillation, hunting)
   */
  _checkControlPatterns(anomaly, history) {
    if (!history || history.length < 12) return null;

    const recentReadings = history.slice(-12); // Last hour
    const temps = recentReadings.map(r => r.temp).filter(t => t !== null);

    if (temps.length < 8) return null;

    // Detect oscillation (rapid up/down cycling)
    let oscillations = 0;
    for (let i = 1; i < temps.length - 1; i++) {
      const prev = temps[i - 1];
      const curr = temps[i];
      const next = temps[i + 1];

      // Peak or valley
      if ((curr > prev && curr > next) || (curr < prev && curr < next)) {
        oscillations++;
      }
    }

    // If more than 4 peaks/valleys in 12 readings, it's oscillating
    if (oscillations >= 4) {
      const amplitude = (Math.max(...temps) - Math.min(...temps)) / 2;
      const period = (temps.length / oscillations) * 5; // Period in minutes

      return {
        cause: `Temperature oscillating (±${amplitude.toFixed(1)}°C every ${period.toFixed(0)} min)`,
        confidence: 0.85,
        urgency: 'medium',
        suggestions: [
          'Control system cycling too frequently',
          'Increase temperature deadband/hysteresis',
          'Check if equipment is undersized for space',
          'Verify control sensor placement (avoid direct airflow)',
          'Adjust PID controller gains if using advanced control'
        ]
      };
    }

    return null;
  }

  /**
   * Check equipment status from automation logs (progressive enhancement)
   */
  _checkEquipmentStatus(anomaly, automationLogs) {
    if (!automationLogs || automationLogs.length === 0) return null;

    const recentLogs = automationLogs.slice(-20); // Last 20 automation events
    const temp = anomaly.indoor_temp;
    const rh = anomaly.indoor_rh;

    // Check if cooling was commanded but temp still rising
    const coolingCommands = recentLogs.filter(log => 
      log.action && (log.action.includes('cool') || log.action.includes('fan'))
    );

    if (coolingCommands.length > 0 && temp > 26) {
      const lastCooling = coolingCommands[coolingCommands.length - 1];
      const timeSinceCommand = Date.now() - new Date(lastCooling.timestamp).getTime();
      const minutesSince = timeSinceCommand / 60000;

      if (minutesSince > 15) {
        return {
          cause: `Cooling commanded ${minutesSince.toFixed(0)} min ago but temperature still ${temp.toFixed(1)}°C`,
          confidence: 0.75,
          urgency: 'high',
          suggestions: [
            'Check HVAC system status',
            'Verify compressor is running',
            'Check refrigerant levels',
            'Inspect air filters for blockage',
            'Verify thermostat/relay connections',
            'Call HVAC technician if issue persists'
          ]
        };
      }
    }

    // Check if dehumidifier commanded but RH still high
    const dehumCommands = recentLogs.filter(log => 
      log.action && log.action.includes('dehumid')
    );

    if (dehumCommands.length > 0 && rh > 75) {
      const lastDehum = dehumCommands[dehumCommands.length - 1];
      const timeSinceCommand = Date.now() - new Date(lastDehum.timestamp).getTime();
      const minutesSince = timeSinceCommand / 60000;

      if (minutesSince > 20) {
        return {
          cause: `Dehumidifier commanded ${minutesSince.toFixed(0)} min ago but humidity still ${rh.toFixed(0)}%`,
          confidence: 0.70,
          urgency: 'high',
          suggestions: [
            'Check dehumidifier power and status',
            'Empty water collection bucket/tank',
            'Check drain hose for clogs',
            'Verify dehumidifier is sized correctly for space',
            'Check for water leaks introducing moisture',
            'Consider additional dehumidification capacity'
          ]
        };
      }
    }

    return null;
  }

  /**
   * Get general troubleshooting suggestions
   */
  _getGeneralSuggestions(anomaly) {
    const suggestions = [];
    const temp = anomaly.indoor_temp;
    const rh = anomaly.indoor_rh;

    if (temp > 26) {
      suggestions.push('Check ventilation and air circulation');
      suggestions.push('Verify cooling system is operational');
      suggestions.push('Inspect for heat sources (lights, equipment)');
      suggestions.push('Consider increasing air exchange rate');
    } else if (temp < 18) {
      suggestions.push('Check heating system status');
      suggestions.push('Inspect for cold drafts or air leaks');
      suggestions.push('Verify insulation is adequate');
      suggestions.push('Check if heating capacity is sufficient');
    }

    if (rh > 75) {
      suggestions.push('Increase air circulation');
      suggestions.push('Reduce watering frequency if possible');
      suggestions.push('Check for water leaks or standing water');
      suggestions.push('Verify dehumidification system if available');
    } else if (rh < 40) {
      suggestions.push('Increase watering or misting');
      suggestions.push('Check for excessive ventilation');
      suggestions.push('Consider humidification if crops require it');
    }

    if (suggestions.length === 0) {
      suggestions.push('Monitor conditions for trends');
      suggestions.push('Document any recent changes to equipment or settings');
      suggestions.push('Compare with historical data for this time period');
    }

    return suggestions;
  }

  /**
   * Calculate urgency level
   */
  _calculateUrgency(anomaly) {
    const temp = anomaly.indoor_temp;
    const rh = anomaly.indoor_rh;
    const severity = anomaly.severity;

    // Critical conditions
    if (temp > 32 || temp < 10) return 'critical';
    if (rh > 90 || rh < 20) return 'critical';
    if (severity === 'critical') return 'critical';

    // High urgency
    if (temp > 28 || temp < 15) return 'high';
    if (rh > 80 || rh < 30) return 'high';
    if (severity === 'warning') return 'high';

    // Medium urgency
    if (temp > 26 || temp < 18) return 'medium';
    if (rh > 75 || rh < 40) return 'medium';

    return 'low';
  }

  /**
   * Calculate variance for flatline detection
   */
  _calculateVariance(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return variance;
  }

  /**
   * Batch diagnose multiple anomalies
   */
  diagnoseMultiple(anomalies, context = {}) {
    return anomalies.map(anomaly => this.diagnose(anomaly, context));
  }

  /**
   * Get diagnostic summary for UI display
   */
  getSummary(diagnostics) {
    const bySeverity = {
      critical: diagnostics.filter(d => d.diagnosis.urgency === 'critical'),
      high: diagnostics.filter(d => d.diagnosis.urgency === 'high'),
      medium: diagnostics.filter(d => d.diagnosis.urgency === 'medium'),
      low: diagnostics.filter(d => d.diagnosis.urgency === 'low')
    };

    const byCategory = {
      weather_correlated: diagnostics.filter(d => d.diagnosis.category === 'weather_correlated'),
      sensor_issue: diagnostics.filter(d => d.diagnosis.category === 'sensor_issue'),
      equipment_failure: diagnostics.filter(d => d.diagnosis.category === 'equipment_failure'),
      control_loop: diagnostics.filter(d => d.diagnosis.category === 'control_loop'),
      environmental: diagnostics.filter(d => d.diagnosis.category === 'environmental')
    };

    return {
      total: diagnostics.length,
      bySeverity,
      byCategory,
      needsAttention: bySeverity.critical.length + bySeverity.high.length,
      weatherRelated: byCategory.weather_correlated.length,
      message: this._getSummaryMessage(bySeverity, byCategory)
    };
  }

  /**
   * Generate human-readable summary message
   */
  _getSummaryMessage(bySeverity, byCategory) {
    const critical = bySeverity.critical.length;
    const high = bySeverity.high.length;
    const weather = byCategory.weather_correlated.length;

    if (critical > 0) {
      return `URGENT: ${critical} critical issue${critical > 1 ? 's' : ''} requiring immediate attention`;
    }

    if (high > 0) {
      const weatherNote = weather > 0 ? ` (${weather} weather-related)` : '';
      return `${high} issue${high > 1 ? 's' : ''} need${high === 1 ? 's' : ''} attention${weatherNote}`;
    }

    if (weather > 0) {
      return `${weather} weather-related condition${weather > 1 ? 's' : ''} detected (normal)`;
    }

    return 'All conditions within normal ranges';
  }
}

export default AnomalyDiagnostics;
