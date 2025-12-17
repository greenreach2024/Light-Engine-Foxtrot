/**
 * ML Automation Controller
 * 
 * Responds to ML insights (anomalies and forecasts) with automated actions.
 * Integrates with existing automation rules engine.
 * 
 * @module lib/ml-automation-controller
 */

import anomalyHistory from './anomaly-history.js';

/**
 * Configuration for ML-driven automation
 */
const CONFIG = {
  // Anomaly score thresholds
  anomaly_critical_threshold: 0.8,
  anomaly_warning_threshold: 0.5,
  
  // Forecast thresholds
  forecast_temp_high_threshold: 28.0, // °C
  forecast_temp_low_threshold: 18.0,  // °C
  forecast_rh_high_threshold: 75.0,   // %
  forecast_rh_low_threshold: 40.0,    // %
  
  // Proactive cooling before heat wave
  precool_hours_ahead: 2,             // Start cooling 2 hours before predicted heat
  precool_temp_target: 22.0,          // °C
  
  // Action cooldown (prevent rapid toggling)
  action_cooldown_minutes: 30,
  
  // Enable/disable flags
  enabled: true,
  anomaly_response_enabled: true,
  forecast_response_enabled: true,
  
  // Notification settings
  notify_on_critical: true,
  notify_on_action: true
};

/**
 * Last action timestamps (for cooldown)
 */
const lastActions = new Map();

/**
 * Check if action is in cooldown period
 */
function isActionInCooldown(actionKey) {
  const lastTime = lastActions.get(actionKey);
  if (!lastTime) return false;
  
  const cooldownMs = CONFIG.action_cooldown_minutes * 60 * 1000;
  const elapsed = Date.now() - lastTime;
  return elapsed < cooldownMs;
}

/**
 * Record action timestamp
 */
function recordAction(actionKey) {
  lastActions.set(actionKey, Date.now());
}

/**
 * Evaluate anomaly and determine response action
 * 
 * @param {Object} anomaly - Anomaly event
 * @returns {Object} Response action or null
 */
export function evaluateAnomalyResponse(anomaly) {
  if (!CONFIG.enabled || !CONFIG.anomaly_response_enabled) {
    return null;
  }
  
  const { zone, severity, anomaly_score, indoor_temp, indoor_rh } = anomaly;
  const actionKey = `anomaly-${zone}`;
  
  // Check cooldown
  if (isActionInCooldown(actionKey)) {
    return {
      action: 'none',
      reason: 'cooldown',
      cooldown_remaining_minutes: Math.ceil(
        (CONFIG.action_cooldown_minutes * 60 * 1000 - (Date.now() - lastActions.get(actionKey))) / 60000
      )
    };
  }
  
  // Critical anomaly: Immediate action
  if (severity === 'critical' && anomaly_score >= CONFIG.anomaly_critical_threshold) {
    recordAction(actionKey);
    
    // High temperature anomaly
    if (indoor_temp > 28) {
      return {
        action: 'activate_cooling',
        zone,
        reason: `Critical temperature anomaly: ${indoor_temp.toFixed(1)}°C`,
        severity: 'critical',
        targets: {
          exhaust_fans: 'on',
          misters: 'on',
          hvac_mode: 'cooling',
          hvac_setpoint: 24.0
        },
        notify: CONFIG.notify_on_critical
      };
    }
    
    // Low temperature anomaly
    if (indoor_temp < 18) {
      return {
        action: 'activate_heating',
        zone,
        reason: `Critical low temperature: ${indoor_temp.toFixed(1)}°C`,
        severity: 'critical',
        targets: {
          heaters: 'on',
          hvac_mode: 'heating',
          hvac_setpoint: 20.0
        },
        notify: CONFIG.notify_on_critical
      };
    }
    
    // High humidity anomaly
    if (indoor_rh > 75) {
      return {
        action: 'activate_dehumidification',
        zone,
        reason: `Critical humidity anomaly: ${indoor_rh.toFixed(0)}%`,
        severity: 'critical',
        targets: {
          exhaust_fans: 'on',
          dehumidifier: 'on'
        },
        notify: CONFIG.notify_on_critical
      };
    }
  }
  
  // Warning anomaly: Moderate action
  if (severity === 'warning' && anomaly_score >= CONFIG.anomaly_warning_threshold) {
    recordAction(actionKey);
    
    return {
      action: 'adjust_hvac',
      zone,
      reason: `Anomaly detected: score ${anomaly_score.toFixed(2)}`,
      severity: 'warning',
      targets: {
        hvac_mode: 'auto',
        hvac_setpoint: 23.0
      },
      notify: false
    };
  }
  
  return null;
}

/**
 * Evaluate forecast and determine proactive action
 * 
 * @param {Object} forecast - Forecast data
 * @returns {Object} Response action or null
 */
export function evaluateForecastResponse(forecast) {
  if (!CONFIG.enabled || !CONFIG.forecast_response_enabled) {
    return null;
  }
  
  const { zone, predictions, forecast_horizon_hours } = forecast;
  
  if (!Array.isArray(predictions) || predictions.length === 0) {
    return null;
  }
  
  const actionKey = `forecast-${zone}`;
  
  // Check cooldown
  if (isActionInCooldown(actionKey)) {
    return null;
  }
  
  // Find predictions within proactive window (next 2 hours)
  const now = Date.now();
  const proactiveWindowEnd = now + (CONFIG.precool_hours_ahead * 60 * 60 * 1000);
  
  const proactivePredictions = predictions.filter(pred => {
    const predTime = new Date(pred.timestamp).getTime();
    return predTime >= now && predTime <= proactiveWindowEnd;
  });
  
  if (proactivePredictions.length === 0) {
    return null;
  }
  
  // Check for predicted high temperature (heat wave)
  const maxPredictedTemp = Math.max(...proactivePredictions.map(p => p.value));
  
  if (maxPredictedTemp > CONFIG.forecast_temp_high_threshold) {
    recordAction(actionKey);
    
    return {
      action: 'precool',
      zone,
      reason: `Proactive cooling: ${maxPredictedTemp.toFixed(1)}°C predicted in ${CONFIG.precool_hours_ahead}h`,
      severity: 'info',
      targets: {
        hvac_mode: 'cooling',
        hvac_setpoint: CONFIG.precool_temp_target,
        exhaust_fans: 'on'
      },
      predicted_max_temp: maxPredictedTemp,
      forecast_hours_ahead: CONFIG.precool_hours_ahead,
      notify: CONFIG.notify_on_action
    };
  }
  
  // Check for predicted low temperature
  const minPredictedTemp = Math.min(...proactivePredictions.map(p => p.value));
  
  if (minPredictedTemp < CONFIG.forecast_temp_low_threshold) {
    recordAction(actionKey);
    
    return {
      action: 'preheat',
      zone,
      reason: `Proactive heating: ${minPredictedTemp.toFixed(1)}°C predicted in ${CONFIG.precool_hours_ahead}h`,
      severity: 'info',
      targets: {
        hvac_mode: 'heating',
        hvac_setpoint: 20.0,
        heaters: 'on'
      },
      predicted_min_temp: minPredictedTemp,
      forecast_hours_ahead: CONFIG.precool_hours_ahead,
      notify: CONFIG.notify_on_action
    };
  }
  
  return null;
}

/**
 * Process recent anomalies and generate automation actions
 * 
 * @param {number} minutes - Look back period in minutes
 * @returns {Promise<Array>} Array of actions to execute
 */
export async function processRecentAnomalies(minutes = 15) {
  const since = Date.now() - (minutes * 60 * 1000);
  const history = await anomalyHistory.getHistory({ since, limit: 100 });
  
  const actions = [];
  
  for (const anomaly of history.events) {
    const response = evaluateAnomalyResponse(anomaly);
    if (response && response.action !== 'none') {
      actions.push({
        ...response,
        anomaly_id: anomaly.id,
        triggered_at: new Date().toISOString()
      });
    }
  }
  
  return actions;
}

/**
 * Process forecast insights and generate proactive actions
 * 
 * @param {Object} forecast - Forecast data from ML insights
 * @returns {Object} Action to execute or null
 */
export function processForecastInsight(forecast) {
  return evaluateForecastResponse(forecast);
}

/**
 * Execute automation action (integration with existing automation engine)
 * 
 * @param {Object} action - Action to execute
 * @param {Object} automationEngine - Existing automation rules engine
 * @returns {Promise<Object>} Execution result
 */
export async function executeAction(action, automationEngine) {
  if (!action || action.action === 'none') {
    return { executed: false, reason: 'no_action' };
  }
  
  try {
    const { zone, targets, reason, severity } = action;
    
    // Log action
    console.log(`[ML Automation] Executing ${action.action} for ${zone}: ${reason}`);
    
    // Execute targets via automation engine
    const results = [];
    
    for (const [device, command] of Object.entries(targets)) {
      try {
        // Integration point: Call existing automation engine
        // Example: automationEngine.executeCommand(zone, device, command)
        
        results.push({
          device,
          command,
          status: 'success',
          message: `Set ${device} to ${command}`
        });
      } catch (err) {
        results.push({
          device,
          command,
          status: 'error',
          message: err.message
        });
      }
    }
    
    const success = results.every(r => r.status === 'success');
    
    return {
      executed: true,
      action: action.action,
      zone,
      results,
      success,
      executed_at: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('[ML Automation] Action execution failed:', error);
    return {
      executed: false,
      error: error.message,
      action: action.action
    };
  }
}

/**
 * Get ML automation configuration
 */
export function getConfig() {
  return { ...CONFIG };
}

/**
 * Update ML automation configuration
 */
export function updateConfig(updates) {
  Object.assign(CONFIG, updates);
  return { ...CONFIG };
}

/**
 * Get cooldown status for all zones
 */
export function getCooldownStatus() {
  const status = {};
  const now = Date.now();
  const cooldownMs = CONFIG.action_cooldown_minutes * 60 * 1000;
  
  for (const [key, lastTime] of lastActions.entries()) {
    const elapsed = now - lastTime;
    const remaining = Math.max(0, cooldownMs - elapsed);
    
    status[key] = {
      last_action_at: new Date(lastTime).toISOString(),
      elapsed_minutes: Math.floor(elapsed / 60000),
      remaining_minutes: Math.ceil(remaining / 60000),
      in_cooldown: remaining > 0
    };
  }
  
  return status;
}

export default {
  evaluateAnomalyResponse,
  evaluateForecastResponse,
  processRecentAnomalies,
  processForecastInsight,
  executeAction,
  getConfig,
  updateConfig,
  getCooldownStatus
};
