import EnvStore from './env-store.js';
import RulesStore from './rules-store.js';
import PlugRegistry from './plug-registry.js';
import AutomationLogger from './logger.js';
import PlugManager from './plug-manager.js';
import ControllerOrchestrator from './controller-orchestrator.js';

function ensureArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function evaluateComparison(operator, actual, expected) {
  if (expected === undefined || expected === null) return true;
  switch (operator) {
    case 'gt':
      return actual > expected;
    case 'gte':
      return actual >= expected;
    case 'lt':
      return actual < expected;
    case 'lte':
      return actual <= expected;
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'between':
      return Array.isArray(expected) && expected.length === 2
        ? actual >= expected[0] && actual <= expected[1]
        : true;
    default:
      return true;
  }
}

function evaluateWhenClause(whenClause, env) {
  if (!whenClause) return false;
  return Object.entries(whenClause).every(([key, conditions]) => {
    const reading = env?.sensors?.[key]?.value;
    if (reading === undefined || reading === null) return false;
    if (conditions === null) return true;
    if (typeof conditions !== 'object') {
      return reading === conditions;
    }
    return Object.entries(conditions).every(([operator, expected]) =>
      evaluateComparison(operator, reading, expected)
    );
  });
}

function isFresh(env, freshnessMs) {
  if (!freshnessMs) return true;
  const updatedAt = env?.updatedAt || env?.sensorsUpdatedAt;
  if (!updatedAt) return false;
  const ts = typeof updatedAt === 'number' ? updatedAt : Date.parse(updatedAt);
  if (!ts) return false;
  return Date.now() - ts <= freshnessMs;
}

function normalizeAction(action) {
  if (!action) return null;
  return {
    plugId: action.plugId,
    set: action.set || (action.on ? (action.on ? 'on' : 'off') : undefined),
    on: action.on,
    level: action.level ?? action.pct ?? null
  };
}

export default class PreAutomationEngine {
  constructor(options = {}) {
    const {
      dataDir,
      publicDataDir,
      intervalMs = 15000,
      guardrailDefaults = { freshnessMs: 60000 },
      fanRotation = {}
    } = options;

    this.envStore = options.envStore || new EnvStore({ dataDir });
    this.rulesStore = options.rulesStore || new RulesStore({ dataDir });
    this.registry = options.registry || new PlugRegistry({ dataDir });
    this.logger = options.logger || new AutomationLogger({ dataDir });
    this.plugManager = options.plugManager || new PlugManager({ registry: this.registry, logger: this.logger });

    // VPD automation orchestrator (hardware-driven)
    this.orchestrator = options.orchestrator || new ControllerOrchestrator({
      dataDir,
      publicDataDir,
      logger: this.logger
    });

    this.intervalMs = intervalMs;
    this.guardrailDefaults = guardrailDefaults;
    this.timer = null;
    this.guardState = new Map(); // plugId -> { lastChange, onEvents: [] }
    this.activeRules = new Map(); // scopeId -> { ruleId, executedAt, actions }
    
    // Fan rotation controller (optional)
    this.fanRotation = options.fanRotation || null;
    
    // VPD control state
    this.vpdControlEnabled = options.vpdControlEnabled !== false; // Default to enabled
    this.vpdControlResults = null; // Last VPD control execution results
  }

  getActiveRule(scopeId) {
    return this.activeRules.get(scopeId) || null;
  }

  getActiveRules() {
    return Array.from(this.activeRules.entries()).map(([scopeId, payload]) => ({ scopeId, ...payload }));
  }

  async start() {
    if (this.timer) return;
    
    // Initialize VPD orchestrator
    try {
      await this.orchestrator.initialize();
      console.log('[automation] VPD orchestrator initialized');
    } catch (error) {
      console.warn('[automation] VPD orchestrator initialization failed:', error.message);
    }
    
    this.timer = setInterval(() => {
      this.tick().catch((error) => {
        console.warn('[automation] Control loop tick failed:', error.message);
      });
    }, this.intervalMs);
    // Allow tests and short-lived CLI runs to exit even if the interval is active
    try {
      if (this.timer && typeof this.timer.unref === 'function') {
        this.timer.unref();
      }
    } catch {}
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getEnvSnapshot() {
    return this.envStore.getSnapshot();
  }

  ingestSensor(scopeId, sensorType, reading) {
    return this.envStore.updateSensor(scopeId, sensorType, reading);
  }

  setTargets(scopeId, targets) {
    return this.envStore.setTargets(scopeId, targets);
  }

  listRules() {
    return this.rulesStore.list();
  }

  upsertRule(rule) {
    const saved = this.rulesStore.upsert(rule);
    return saved;
  }

  removeRule(ruleId) {
    return this.rulesStore.remove(ruleId);
  }

  setRuleEnabled(ruleId, enabled) {
    return this.rulesStore.setEnabled(ruleId, enabled);
  }

  assignPlug(ruleId, plugId, actionConfig) {
    return this.rulesStore.assignPlug(ruleId, plugId, actionConfig);
  }

  removePlugAssignment(ruleId, plugId) {
    return this.rulesStore.removePlugFromRule(ruleId, plugId);
  }

  listPlugs() {
    return this.plugManager.discoverAll();
  }

  registerPlug(definition) {
    const saved = this.registry.upsert(definition);
    this.plugManager.refreshManualAssignments();
    return saved;
  }

  unregisterPlug(plugId) {
    const removed = this.registry.remove(plugId);
    this.plugManager.refreshManualAssignments();
    return removed;
  }

  async setPlugState(plugId, on) {
    const state = await this.plugManager.setPowerState(plugId, on);
    return state;
  }

  getHistory(limit = 100) {
    return this.logger.getHistory(limit);
  }

  recordGuardEvent(plugId, on) {
    if (!plugId) return;
    const now = Date.now();
    const entry = this.guardState.get(plugId) || { lastChange: 0, onEvents: [] };
    entry.lastChange = now;
    if (on) {
      entry.onEvents.push(now);
      entry.onEvents = entry.onEvents.filter((ts) => now - ts <= 3600000);
    }
    this.guardState.set(plugId, entry);
  }

  guardAllows(action, guardrails = {}) {
    const merged = { ...this.guardrailDefaults, ...guardrails };
    const plugId = action.plugId;
    const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
    const entry = this.guardState.get(plugId) || { lastChange: 0, onEvents: [] };

    if (merged.minHoldSec) {
      const elapsed = (Date.now() - entry.lastChange) / 1000;
      if (elapsed < merged.minHoldSec) {
        return { allowed: false, reason: 'minHoldSec' };
      }
    }

    if (desired && merged.maxOnPerHour) {
      const onEvents = entry.onEvents.filter((ts) => Date.now() - ts <= 3600000);
      if (onEvents.length >= merged.maxOnPerHour) {
        return { allowed: false, reason: 'maxOnPerHour' };
      }
    }

    return { allowed: true };
  }

  async tick() {
    // Run rule-based control (existing logic)
    await this._runRuleBasedControl();
    
    // Run VPD-based control (new hardware-driven automation)
    if (this.vpdControlEnabled) {
      await this._runVpdControl();
    }
  }

  async _runRuleBasedControl() {
    const scopeIds = this.envStore.getScopeIds();
    const rules = this.rulesStore.listEnabled();

    for (const scopeId of scopeIds) {
      const env = this.envStore.getScope(scopeId);
      if (!isFresh(env, this.guardrailDefaults.freshnessMs)) {
        continue;
      }

      const scopeRules = rules.filter((rule) => {
        const ruleScope = rule.scope || {};
        return !ruleScope?.room || ruleScope.room === scopeId || ruleScope.scope === scopeId;
      });

      const matched = scopeRules.find((rule) => evaluateWhenClause(rule.when, env));
      if (!matched) continue;

      const actions = ensureArray(matched.actions).map(normalizeAction).filter(Boolean);
      if (!actions.length) continue;

      const pre = await this.plugManager.snapshot(actions);

      // Filter out actions that are already in desired state (idempotent optimization)
      const neededActions = actions.filter((action) => {
        const plugId = action.plugId;
        const currentState = pre[plugId];
        
        // If we can't determine current state, attempt the action
        if (!currentState || currentState.on === undefined) {
          return true;
        }
        
        // Determine desired state
        const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
        
        // Only include action if state needs to change
        return currentState.on !== desired;
      });

      // Track actions skipped due to already being in desired state
      const alreadyApplied = actions.filter((action) => {
        const plugId = action.plugId;
        const currentState = pre[plugId];
        if (!currentState || currentState.on === undefined) return false;
        const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
        return currentState.on === desired;
      });

      // Log idempotent optimization when it saves work
      if (alreadyApplied.length > 0) {
        console.log(`[automation] Rule "${matched.name}" - ${alreadyApplied.length} action(s) already in desired state, skipping`);
      }

      const guardDecisions = neededActions.map((action) => ({
        action,
        decision: this.guardAllows(action, matched.guardrails)
      }));
      const actionable = guardDecisions.filter((item) => item.decision.allowed).map((item) => item.action);
      const skipped = [
        ...guardDecisions.filter((item) => !item.decision.allowed).map((item) => ({
          ...item.action,
          reason: item.decision.reason
        })),
        ...alreadyApplied.map((action) => ({
          ...action,
          reason: 'already-applied'
        }))
      ];

      const results = await this.plugManager.apply(actionable);
      for (const action of actionable) {
        const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
        this.recordGuardEvent(action.plugId, desired);
        
        // Notify fan rotation controller of demand-based override
        if (this.fanRotation && desired === true) {
          this.fanRotation.setOverride(action.plugId, `${matched.name} (demand-based)`);
        }
      }

      const post = await this.plugManager.snapshot(actions);
      const envAfter = this.envStore.getScope(scopeId);

      const success = results.some((result) => result.success);

      if (success) {
        this.activeRules.set(scopeId, {
          ruleId: matched.id,
          executedAt: Date.now(),
          actions: results
        });
      } else {
        this.activeRules.delete(scopeId);
      }
      
      // Clear overrides for fans that are turned OFF by demand-based rules
      for (const action of actionable) {
        const desired = action.set === 'off' ? false : action.set === 'on' ? true : Boolean(action.on);
        if (this.fanRotation && desired === false) {
          this.fanRotation.clearOverride(action.plugId);
        }
      }

      this.logger.log({
        ts: Date.now(),
        scope: scopeId,
        ruleId: matched.id,
        actions,
        executed: results,
        skipped,
        envBefore: env,
        envAfter,
        pre,
        post
      });
    }
  }

  async _runVpdControl() {
    try {
      // Get environmental snapshot from EnvStore
      const envSnapshot = this.envStore.getSnapshot();
      
      // Get current device states from PlugManager
      const deviceStates = await this._getDeviceStatesForVpd();
      
      // Execute VPD control via orchestrator
      const results = await this.orchestrator.tick(envSnapshot, deviceStates);
      
      // Store results for API access
      this.vpdControlResults = {
        timestamp: Date.now(),
        ...results
      };
      
      // Execute returned actions
      if (results.zones) {
        for (const [zoneId, zoneResult] of Object.entries(results.zones)) {
          if (zoneResult.actions && zoneResult.actions.length > 0) {
            await this._executeVpdActions(zoneId, zoneResult.actions);
          }
          
          // Log warnings
          if (zoneResult.warnings && zoneResult.warnings.length > 0) {
            console.warn(`[automation:vpd] Zone ${zoneId} warnings:`, zoneResult.warnings);
          }
        }
      }
      
      // Log overall warnings and recommendations
      if (results.warnings && results.warnings.length > 0) {
        console.warn('[automation:vpd] System warnings:', results.warnings);
      }
      
    } catch (error) {
      console.error('[automation:vpd] VPD control execution failed:', error);
    }
  }

  async _getDeviceStatesForVpd() {
    // Get all registered plugs/devices
    const plugs = await this.plugManager.discoverAll();
    
    // Map to format expected by orchestrator
    const deviceStates = {};
    for (const plug of plugs) {
      if (plug.id && plug.state !== undefined) {
        deviceStates[plug.id] = {
          on: plug.state === 'on' || plug.state === true,
          level: plug.brightness || plug.level || null,
          available: plug.available !== false
        };
      }
    }
    
    return deviceStates;
  }

  async _executeVpdActions(zoneId, actions) {
    for (const action of actions) {
      try {
        const { deviceId, action: command, level, reason } = action;
        
        // Map VPD action format to PlugManager format
        let desiredState;
        if (command === 'turn-on' || command === 'increase') {
          desiredState = true;
        } else if (command === 'turn-off' || command === 'decrease') {
          desiredState = false;
        } else if (command === 'set-level' && level !== undefined) {
          desiredState = level > 0;
        }
        
        // Apply via PlugManager
        if (desiredState !== undefined) {
          await this.plugManager.setPowerState(deviceId, desiredState);
          
          // Notify fan rotation controller if needed
          if (this.fanRotation && desiredState === true) {
            this.fanRotation.setOverride(deviceId, `VPD Control (${zoneId}): ${reason}`);
          } else if (this.fanRotation && desiredState === false) {
            this.fanRotation.clearOverride(deviceId);
          }
        }
        
        // Set brightness/level if specified
        if (level !== undefined && level !== null && this.plugManager.setLevel) {
          await this.plugManager.setLevel(deviceId, level);
        }
        
        console.log(`[automation:vpd] Zone ${zoneId}: ${command} ${deviceId} - ${reason}`);
        
      } catch (error) {
        console.error(`[automation:vpd] Failed to execute action on ${action.deviceId}:`, error.message);
      }
    }
  }

  // API methods for VPD control
  getVpdControlResults() {
    return this.vpdControlResults;
  }

  setVpdControlEnabled(enabled) {
    this.vpdControlEnabled = enabled;
    return { enabled: this.vpdControlEnabled };
  }

  getOrchestratorStatus() {
    return this.orchestrator.getFarmSummary();
  }

  async assignDeviceToZone(zoneId, deviceId, options = {}) {
    return await this.orchestrator.assignDevice(zoneId, deviceId, options);
  }

  async unassignDeviceFromZone(zoneId, deviceId) {
    return await this.orchestrator.unassignDevice(zoneId, deviceId);
  }
}
