/**
 * Automation Rules Engine for Light Engine Charlie
 * 
 * Handles sensor-triggered automations between SwitchBot sensors, Kasa devices,
 * and IFTTT triggers. Supports complex conditional logic and device orchestration.
 */

class AutomationRulesEngine {
  constructor() {
    this.rules = [];
    this.history = [];
    this.debounceStates = new Map();
    this.scenarioExecutions = new Map();
    this.enabledRules = new Set();
    this.ruleCache = new Map();
    
    // Default rules for common farm scenarios
    this.loadDefaultRules();
  }

  /**
   * Register an automation rule
   * @param {Object} rule - Rule configuration
   * @param {string} rule.id - Unique rule identifier
   * @param {string} rule.name - Human-readable rule name
   * @param {Object} rule.trigger - Trigger conditions
   * @param {Array} rule.actions - Actions to execute
   * @param {Object} rule.conditions - Additional conditions
   * @param {Object} rule.options - Rule options (debounce, schedule, etc.)
   */
  addRule(rule) {
    const normalized = this.normalizeRule(rule);
    const existing = this.rules.findIndex(r => r.id === normalized.id);
    
    if (existing >= 0) {
      this.rules[existing] = normalized;
    } else {
      this.rules.push(normalized);
    }
    
    this.enabledRules.add(normalized.id);
    console.log(`[automation] Registered rule: ${normalized.name} (${normalized.id})`);
  }

  /**
   * Remove a rule by ID
   */
  removeRule(ruleId) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
    this.enabledRules.delete(ruleId);
    this.debounceStates.delete(ruleId);
    this.scenarioExecutions.delete(ruleId);
    console.log(`[automation] Removed rule: ${ruleId}`);
  }

  /**
   * Enable/disable a rule
   */
  setRuleEnabled(ruleId, enabled) {
    if (enabled) {
      this.enabledRules.add(ruleId);
    } else {
      this.enabledRules.delete(ruleId);
    }
  }

  /**
   * Process incoming sensor data and check for rule matches
   * @param {Object} sensorData - Sensor reading
   * @param {string} sensorData.source - Data source (switchbot, ifttt, etc.)
   * @param {string} sensorData.deviceId - Device identifier
   * @param {string} sensorData.type - Sensor type (temperature, humidity, etc.)
   * @param {number} sensorData.value - Sensor value
   * @param {Object} sensorData.metadata - Additional metadata
   */
  async processSensorData(sensorData) {
    const timestamp = Date.now();
    
    // Update sensor state cache
    this.updateSensorCache(sensorData);
    
    // Find matching rules
    const matchingRules = this.rules.filter(rule => {
      if (!this.enabledRules.has(rule.id)) return false;
      return this.evaluateTrigger(rule.trigger, sensorData);
    });

    // Execute matched rules
    for (const rule of matchingRules) {
      try {
        await this.executeRule(rule, sensorData, timestamp);
      } catch (error) {
        console.error(`[automation] Rule execution failed for ${rule.id}:`, error);
        this.logRuleExecution(rule.id, 'error', { error: error.message }, timestamp);
      }
    }
  }

  /**
   * Process IFTTT trigger and execute automations
   * @param {string} triggerEvent - IFTTT trigger event name
   * @param {Object} payload - IFTTT payload data
   */
  async processIFTTTTrigger(triggerEvent, payload) {
    const sensorData = this.normalizeIFTTTData(triggerEvent, payload);
    if (sensorData) {
      await this.processSensorData(sensorData);
    }
  }

  /**
   * Normalize IFTTT webhook data to sensor format
   */
  normalizeIFTTTData(triggerEvent, payload) {
    // Map common IFTTT service patterns to sensor data
    const mappings = {
      'weather_temp_change': { type: 'temperature', source: 'ifttt-weather' },
      'weather_humidity_change': { type: 'humidity', source: 'ifttt-weather' },
      'sensor_reading': { type: payload.sensor_type, source: 'ifttt-sensor' },
      'schedule_trigger': { type: 'schedule', source: 'ifttt-schedule' },
      'motion_detected': { type: 'motion', source: 'ifttt-security' },
      'light_level_change': { type: 'light', source: 'ifttt-ambient' }
    };

    const mapping = mappings[triggerEvent];
    if (!mapping) return null;

    return {
      source: mapping.source,
      deviceId: payload.device_id || `ifttt-${triggerEvent}`,
      type: mapping.type,
      value: parseFloat(payload.value1 || payload.value || payload.reading || 0),
      metadata: {
        iftttEvent: triggerEvent,
        originalPayload: payload,
        timestamp: new Date().toISOString()
      }
    };
  }

  /**
   * Execute a rule with debouncing and condition checking
   */
  async executeRule(rule, sensorData, timestamp) {
    // Check debounce
    if (this.isDebounced(rule, timestamp)) {
      console.log(`[automation] Rule ${rule.id} debounced, skipping`);
      return;
    }

    // Evaluate additional conditions
    if (!this.evaluateConditions(rule.conditions, sensorData)) {
      console.log(`[automation] Rule ${rule.id} conditions not met, skipping`);
      return;
    }

    // Check schedule constraints
    if (!this.isScheduleActive(rule.schedule)) {
      console.log(`[automation] Rule ${rule.id} outside active schedule, skipping`);
      return;
    }

    console.log(`[automation] Executing rule: ${rule.name} (${rule.id})`);
    
    // Set debounce state
    this.setDebounceState(rule, timestamp);

    // Execute actions
    const results = [];
    for (const action of rule.actions) {
      try {
        const result = await this.executeAction(action, sensorData);
        results.push({ action: action.type, result, success: true });
      } catch (error) {
        console.error(`[automation] Action failed:`, error);
        results.push({ action: action.type, error: error.message, success: false });
      }
    }

    // Log execution
    this.logRuleExecution(rule.id, 'executed', {
      trigger: sensorData,
      results,
      timestamp: new Date(timestamp).toISOString()
    }, timestamp);
  }

  /**
   * Execute a specific action
   */
  async executeAction(action, triggerData) {
    switch (action.type) {
      case 'kasa_control':
        return await this.executeKasaAction(action, triggerData);
      
      case 'switchbot_control':
        return await this.executeSwitchBotAction(action, triggerData);
      
      case 'ifttt_trigger':
        return await this.executeIFTTTAction(action, triggerData);
      
      case 'notification':
        return await this.executeNotificationAction(action, triggerData);
      
      case 'scenario':
        return await this.executeScenarioAction(action, triggerData);
      
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Execute Kasa device control action
   */
  async executeKasaAction(action, triggerData) {
    const { deviceId, command, parameters } = action;
    const url = `http://127.0.0.1:${process.env.PORT || 8091}/api/kasa/devices/${deviceId}/control`;
    
    const payload = {
      action: command,
      ...parameters
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Kasa control failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Execute SwitchBot device control action
   */
  async executeSwitchBotAction(action, triggerData) {
    const { deviceId, command, parameter } = action;
    const url = `http://127.0.0.1:${process.env.PORT || 8091}/api/switchbot/devices/${deviceId}/commands`;
    
    const payload = {
      command,
      parameter: parameter || 'default'
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`SwitchBot control failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Execute IFTTT trigger action
   */
  async executeIFTTTAction(action, triggerData) {
    const { event, data } = action;
    const url = `http://127.0.0.1:${process.env.PORT || 8091}/integrations/ifttt/trigger/${event}`;
    
    const payload = {
      value1: data.value1 || triggerData.value,
      value2: data.value2 || triggerData.deviceId,
      value3: data.value3 || triggerData.type,
      ...data
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`IFTTT trigger failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  /**
   * Execute notification action
   */
  async executeNotificationAction(action, triggerData) {
    // For now, log to console. Could extend to email, SMS, push notifications
    const message = this.interpolateMessage(action.message, triggerData);
    console.log(`[automation-notification] ${action.title}: ${message}`);
    
    // If IFTTT notification event is configured, trigger it
    if (action.iftttEvent) {
      return await this.executeIFTTTAction({
        event: action.iftttEvent,
        data: { value1: action.title, value2: message, value3: triggerData.deviceId }
      }, triggerData);
    }

    return { sent: true, message };
  }

  /**
   * Execute scenario action (multiple coordinated actions)
   */
  async executeScenarioAction(action, triggerData) {
    const { scenarioId, parameters } = action;
    const scenario = this.getScenario(scenarioId);
    
    if (!scenario) {
      throw new Error(`Scenario not found: ${scenarioId}`);
    }

    const results = [];
    for (const step of scenario.steps) {
      const stepAction = { ...step, ...parameters };
      try {
        const result = await this.executeAction(stepAction, triggerData);
        results.push({ step: step.name || step.type, result, success: true });
        
        // Add delay between steps if specified
        if (step.delay) {
          await new Promise(resolve => setTimeout(resolve, step.delay));
        }
      } catch (error) {
        console.error(`[automation] Scenario step failed:`, error);
        results.push({ step: step.name || step.type, error: error.message, success: false });
        
        // Stop scenario on critical errors
        if (step.critical) break;
      }
    }

    return { scenario: scenarioId, steps: results };
  }

  /**
   * Evaluate trigger conditions against sensor data
   */
  evaluateTrigger(trigger, sensorData) {
    // Source matching
    if (trigger.source && trigger.source !== sensorData.source) return false;
    
    // Device matching
    if (trigger.deviceId && trigger.deviceId !== sensorData.deviceId) return false;
    
    // Sensor type matching
    if (trigger.type && trigger.type !== sensorData.type) return false;
    
    // Value conditions
    if (trigger.value) {
      const { operator, threshold, range } = trigger.value;
      const value = sensorData.value;
      
      switch (operator) {
        case 'gt': return value > threshold;
        case 'gte': return value >= threshold;
        case 'lt': return value < threshold;
        case 'lte': return value <= threshold;
        case 'eq': return value === threshold;
        case 'neq': return value !== threshold;
        case 'between': return value >= range.min && value <= range.max;
        case 'outside': return value < range.min || value > range.max;
        default: return true;
      }
    }
    
    return true;
  }

  /**
   * Evaluate additional rule conditions
   */
  evaluateConditions(conditions, sensorData) {
    if (!conditions) return true;
    
    // Time-based conditions
    if (conditions.timeRange) {
      const now = new Date();
      const hour = now.getHours();
      const { start, end } = conditions.timeRange;
      
      if (start <= end) {
        if (hour < start || hour >= end) return false;
      } else {
        // Overnight range (e.g., 22:00 to 06:00)
        if (hour < start && hour >= end) return false;
      }
    }
    
    // Multi-sensor conditions
    if (conditions.sensorCombination) {
      // This would require checking multiple sensor states
      // Implementation depends on specific requirements
    }
    
    return true;
  }

  /**
   * Load default automation rules for common farm scenarios
   */
  loadDefaultRules() {
    // High temperature -> Turn on exhaust fans
    this.addRule({
      id: 'high-temp-exhaust',
      name: 'High Temperature → Exhaust Fans',
      trigger: {
        type: 'temperature',
        value: { operator: 'gt', threshold: 28 }
      },
      actions: [
        {
          type: 'kasa_control',
          deviceId: 'exhaust-fan-kasa',
          command: 'turnOn'
        },
        {
          type: 'ifttt_trigger',
          event: 'farm_alert_high_temp',
          data: { value1: 'High temperature detected' }
        }
      ],
      options: { debounceMs: 300000 } // 5 minute debounce
    });

    // Low humidity -> Turn on misters
    this.addRule({
      id: 'low-humidity-misters',
      name: 'Low Humidity → Activate Misters',
      trigger: {
        type: 'humidity',
        value: { operator: 'lt', threshold: 60 }
      },
      actions: [
        {
          type: 'switchbot_control',
          deviceId: 'mister-switchbot',
          command: 'turnOn'
        }
      ],
      conditions: {
        timeRange: { start: 6, end: 20 } // Only during daylight hours
      },
      options: { debounceMs: 600000 } // 10 minute debounce
    });

    // Motion detected -> Security lighting
    this.addRule({
      id: 'motion-security-lights',
      name: 'Motion Detection → Security Lights',
      trigger: {
        type: 'motion',
        value: { operator: 'eq', threshold: 1 }
      },
      actions: [
        {
          type: 'scenario',
          scenarioId: 'security-lighting',
          parameters: { duration: 600000 } // 10 minutes
        }
      ],
      conditions: {
        timeRange: { start: 20, end: 6 } // Nighttime only
      },
      options: { debounceMs: 30000 } // 30 second debounce
    });

    console.log(`[automation] Loaded ${this.rules.length} default automation rules`);
  }

  /**
   * Helper methods for rule management
   */
  normalizeRule(rule) {
    return {
      id: rule.id,
      name: rule.name || rule.id,
      trigger: rule.trigger || {},
      actions: Array.isArray(rule.actions) ? rule.actions : [],
      conditions: rule.conditions || {},
      schedule: rule.schedule,
      options: rule.options || {},
      createdAt: new Date().toISOString(),
      ...rule
    };
  }

  isDebounced(rule, timestamp) {
    const debounceMs = rule.options?.debounceMs || 30000; // Default 30s
    const lastExecution = this.debounceStates.get(rule.id);
    return lastExecution && (timestamp - lastExecution) < debounceMs;
  }

  setDebounceState(rule, timestamp) {
    this.debounceStates.set(rule.id, timestamp);
  }

  isScheduleActive(schedule) {
    if (!schedule) return true;
    
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0 = Sunday
    
    if (schedule.hours) {
      const { start, end } = schedule.hours;
      if (start <= end) {
        if (hour < start || hour >= end) return false;
      } else {
        if (hour < start && hour >= end) return false;
      }
    }
    
    if (schedule.days && !schedule.days.includes(day)) {
      return false;
    }
    
    return true;
  }

  updateSensorCache(sensorData) {
    const key = `${sensorData.source}-${sensorData.deviceId}-${sensorData.type}`;
    this.ruleCache.set(key, {
      ...sensorData,
      timestamp: Date.now()
    });
  }

  logRuleExecution(ruleId, status, data, timestamp) {
    this.history.push({
      ruleId,
      status,
      data,
      timestamp
    });
    
    // Keep only last 1000 executions
    if (this.history.length > 1000) {
      this.history = this.history.slice(-1000);
    }
  }

  interpolateMessage(template, data) {
    return template
      .replace(/\{value\}/g, data.value)
      .replace(/\{deviceId\}/g, data.deviceId)
      .replace(/\{type\}/g, data.type)
      .replace(/\{source\}/g, data.source);
  }

  getScenario(scenarioId) {
    const scenarios = {
      'security-lighting': {
        steps: [
          { type: 'kasa_control', deviceId: 'security-light-1', command: 'turnOn' },
          { type: 'kasa_control', deviceId: 'security-light-2', command: 'turnOn' },
          { type: 'ifttt_trigger', event: 'security_motion_alert', data: { value1: 'Motion detected' } }
        ]
      }
    };
    
    return scenarios[scenarioId];
  }

  // Public API methods
  getRules() {
    return this.rules.map(rule => ({
      ...rule,
      enabled: this.enabledRules.has(rule.id),
      lastExecution: this.debounceStates.get(rule.id)
    }));
  }

  getHistory(limit = 100) {
    return this.history.slice(-limit);
  }

  getSensorCache() {
    const cache = {};
    for (const [key, value] of this.ruleCache.entries()) {
      cache[key] = value;
    }
    return cache;
  }
}

export default AutomationRulesEngine;