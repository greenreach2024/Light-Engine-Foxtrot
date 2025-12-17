/**
 * Demo Sensor Simulator for Light Engine
 * Generates realistic time-series sensor data with daily patterns and noise
 * 
 * Usage:
 *   const simulator = new DemoSensorSimulator();
 *   const data = simulator.generateSensorHistory('temperature', 24);
 */

export class DemoSensorSimulator {
  constructor(options = {}) {
    this.options = {
      // Baseline values (typical indoor farm conditions)
      temperature: { base: 22, amplitude: 2, noise: 0.5 },
      humidity: { base: 65, amplitude: 5, noise: 2 },
      co2: { base: 1000, amplitude: 200, noise: 50 },
      ppfd: { base: 500, amplitude: 100, noise: 20 },
      vpd: { base: 1.0, amplitude: 0.2, noise: 0.05 },
      ...options
    };
  }

  /**
   * Generate sensor history for specified hours
   * @param {string} metric - Metric name (temperature, humidity, co2, ppfd, vpd)
   * @param {number} hours - Number of hours to generate (default: 24)
   * @param {number} intervalMinutes - Data point interval (default: 5 minutes)
   * @returns {Array} Array of {timestamp, value} objects
   */
  generateSensorHistory(metric, hours = 24, intervalMinutes = 5) {
    const config = this.options[metric];
    if (!config) {
      throw new Error(`Unknown metric: ${metric}`);
    }

    const dataPoints = [];
    const pointsCount = (hours * 60) / intervalMinutes;
    const now = Date.now();

    for (let i = 0; i < pointsCount; i++) {
      const timestamp = now - (pointsCount - i) * intervalMinutes * 60 * 1000;
      const hourOfDay = new Date(timestamp).getHours() + (new Date(timestamp).getMinutes() / 60);
      
      // Calculate value with daily pattern
      const value = this._calculateValue(metric, hourOfDay, config);
      
      dataPoints.push({
        timestamp: new Date(timestamp).toISOString(),
        value: parseFloat(value.toFixed(2))
      });
    }

    return dataPoints;
  }

  /**
   * Generate current sensor reading
   * @param {string} metric - Metric name
   * @returns {number} Current value
   */
  getCurrentReading(metric) {
    const config = this.options[metric];
    if (!config) {
      throw new Error(`Unknown metric: ${metric}`);
    }

    const now = new Date();
    const hourOfDay = now.getHours() + (now.getMinutes() / 60);
    return parseFloat(this._calculateValue(metric, hourOfDay, config).toFixed(2));
  }

  /**
   * Generate readings for all metrics
   * @returns {Object} Current readings for all sensors
   */
  getAllCurrentReadings() {
    return {
      temperature: this.getCurrentReading('temperature'),
      humidity: this.getCurrentReading('humidity'),
      co2: this.getCurrentReading('co2'),
      ppfd: this.getCurrentReading('ppfd'),
      vpd: this.getCurrentReading('vpd'),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Generate multi-metric history
   * @param {Array} metrics - Array of metric names
   * @param {number} hours - Number of hours
   * @returns {Object} Object with metric names as keys
   */
  generateMultiMetricHistory(metrics, hours = 24) {
    const result = {};
    
    metrics.forEach(metric => {
      result[metric] = this.generateSensorHistory(metric, hours);
    });

    return result;
  }

  /**
   * Calculate sensor value with daily pattern
   * @private
   */
  _calculateValue(metric, hourOfDay, config) {
    const { base, amplitude, noise } = config;
    
    // Different patterns for different metrics
    let pattern = 0;
    
    switch (metric) {
      case 'temperature':
        // Temperature rises during day (lights on), falls at night
        pattern = Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI) * amplitude;
        break;
        
      case 'humidity':
        // Humidity inversely related to temperature
        pattern = -Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI) * amplitude;
        break;
        
      case 'co2':
        // CO2 drops during day (plant uptake), rises at night
        pattern = -Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI) * amplitude;
        break;
        
      case 'ppfd':
        // Light intensity follows photoperiod (6am-10pm typical)
        if (hourOfDay >= 6 && hourOfDay < 22) {
          // On period with slight variation
          pattern = amplitude * 0.9 + (Math.random() - 0.5) * amplitude * 0.2;
        } else {
          // Off period
          pattern = -base; // Return to near-zero
        }
        break;
        
      case 'vpd':
        // VPD varies with temperature and humidity
        pattern = Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI) * amplitude;
        break;
        
      default:
        pattern = 0;
    }

    // Add random noise
    const randomNoise = (Math.random() - 0.5) * 2 * noise;
    
    // Calculate final value
    let value = base + pattern + randomNoise;
    
    // Ensure value stays within realistic bounds
    value = this._clampValue(metric, value);
    
    return value;
  }

  /**
   * Clamp values to realistic ranges
   * @private
   */
  _clampValue(metric, value) {
    const ranges = {
      temperature: { min: 18, max: 28 },
      humidity: { min: 40, max: 80 },
      co2: { min: 400, max: 1500 },
      ppfd: { min: 0, max: 800 },
      vpd: { min: 0.4, max: 1.6 }
    };

    const range = ranges[metric];
    if (!range) return value;

    return Math.max(range.min, Math.min(range.max, value));
  }

  /**
   * Generate anomaly event (for testing)
   * @param {string} metric - Metric name
   * @param {string} type - Anomaly type ('spike', 'drop', 'drift')
   * @returns {Object} Anomaly event data
   */
  generateAnomaly(metric, type = 'spike') {
    const config = this.options[metric];
    const normalValue = this.getCurrentReading(metric);
    let anomalyValue;

    switch (type) {
      case 'spike':
        anomalyValue = normalValue + config.amplitude * 3;
        break;
      case 'drop':
        anomalyValue = normalValue - config.amplitude * 3;
        break;
      case 'drift':
        anomalyValue = normalValue + config.amplitude * 1.5;
        break;
      default:
        anomalyValue = normalValue;
    }

    return {
      metric,
      type,
      timestamp: new Date().toISOString(),
      normalValue,
      anomalyValue: parseFloat(anomalyValue.toFixed(2)),
      severity: Math.abs(anomalyValue - normalValue) > config.amplitude * 2 ? 'critical' : 'warning'
    };
  }

  /**
   * Generate environmental data summary for a zone
   * @param {string} zoneId - Zone identifier
   * @returns {Object} Zone environmental summary
   */
  generateZoneSummary(zoneId) {
    const readings = this.getAllCurrentReadings();
    
    return {
      zoneId,
      ...readings,
      status: 'normal',
      alerts: []
    };
  }

  /**
   * Generate sparkline data (simplified for charts)
   * @param {string} metric - Metric name
   * @param {number} points - Number of data points (default: 24)
   * @returns {Array} Array of numeric values
   */
  generateSparkline(metric, points = 24) {
    const history = this.generateSensorHistory(metric, points, 60);
    return history.map(point => point.value);
  }
}

export default DemoSensorSimulator;
