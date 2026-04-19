// services/nutrient-mqtt.js -- Persistent MQTT subscriber for Atlas nutrient dosing system
// Connects to the Atlas MQTT broker, subscribes to telemetry + dosing event topics,
// stores readings locally (in-memory + file persistence), and exposes data for the
// /data/nutrient-dashboard and /api/nutrients/* endpoints.

import mqtt from 'mqtt';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { resolveRuntimeStatePath, scheduleRuntimeJsonMirror } from '../lib/runtime-state.js';

const MAX_HISTORY = 200;
const MAX_DOSING_HISTORY = 100;
const PERSIST_DEBOUNCE_MS = 2000;
const RECONNECT_PERIOD_MS = 5000;
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

// Telemetry topics the Atlas controller publishes sensor data on
const TELEMETRY_TOPICS = [
  'sensors/nutrient/telemetry',
  'sensors/nutrient/status',
  'sensors/nutrient/+/telemetry'
];

// Event topics for dosing actions
const EVENT_TOPICS = [
  'sensors/nutrient/event/dose',
  'sensors/nutrient/event/calibration',
  'sensors/nutrient/event/alert',
  'sensors/nutrient/event/+'
];

// Ack topics — Atlas publishes a command ack after applying setpoints / calibration /
// manual dose commands. The Arduino-flavored firmware uses `sensors/NutrientRoom/ack`
// (see `scripts/mqtt-nutrient-monitor-unified.py`); the generic form mirrors the
// telemetry topic shape. We subscribe to all known variants so whichever firmware
// is on the wire ends up persisting its ack.
const ACK_TOPICS = [
  'sensors/NutrientRoom/ack',
  'sensors/nutrient/ack',
  'sensors/nutrient/+/ack',
  'sensors/nutrient/event/ack'
];

class NutrientStore extends EventEmitter {
  constructor({ dataDir, fileName = 'nutrient-store.json', storageRelativePath } = {}) {
    super();
    this.storageRelativePath = storageRelativePath || `public/data/automation/${fileName}`;
    this.filePath = resolveRuntimeStatePath(this.storageRelativePath);
    this.dataDir = dataDir || path.dirname(this.filePath);
    this.state = {
      tanks: {},
      dosingHistory: [],
      calibrations: {},
      alerts: [],
      // appliedTargets[tankId] tracks the most recent setTargets payload the
      // Atlas controller has acknowledged so the UI can display "Last applied"
      // and the reconcile loop can diff against recipe-resolved targets.
      appliedTargets: {},
      // pendingTargets[tankId] tracks a publish for which we have not yet seen
      // an ack. The server writes to this from publishNutrientCommand before
      // emitting to MQTT; the ack handler promotes it to appliedTargets.
      pendingTargets: {},
      updatedAt: null
    };
    this._persistTimer = null;
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.state = {
            tanks: parsed.tanks || {},
            dosingHistory: Array.isArray(parsed.dosingHistory) ? parsed.dosingHistory.slice(-MAX_DOSING_HISTORY) : [],
            calibrations: parsed.calibrations || {},
            alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
            appliedTargets: parsed.appliedTargets && typeof parsed.appliedTargets === 'object' ? parsed.appliedTargets : {},
            pendingTargets: parsed.pendingTargets && typeof parsed.pendingTargets === 'object' ? parsed.pendingTargets : {},
            updatedAt: parsed.updatedAt || null
          };
        }
      }
    } catch (err) {
      console.warn('[nutrient-store] Failed to load persisted state:', err?.message);
    }
  }

  _schedulePersist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => this._persist(), PERSIST_DEBOUNCE_MS);
    if (typeof this._persistTimer?.unref === 'function') {
      this._persistTimer.unref();
    }
  }

  async _persist() {
    try {
      await fs.promises.mkdir(this.dataDir, { recursive: true });
      const json = JSON.stringify(this.state, null, 2);
      await fs.promises.writeFile(this.filePath, json, 'utf8');
      scheduleRuntimeJsonMirror(this.storageRelativePath, this.state, { delayMs: 0 });
    } catch (err) {
      console.warn('[nutrient-store] Persist failed:', err?.message);
    }
  }

  updateTelemetry(tankId, reading) {
    if (!tankId || !reading || typeof reading !== 'object') return;

    const now = new Date().toISOString();
    if (!this.state.tanks[tankId]) {
      this.state.tanks[tankId] = { sensors: {}, history: [], config: {}, updatedAt: null };
    }

    const tank = this.state.tanks[tankId];

    // Update current sensor values
    if (reading.ph != null) {
      const phVal = Number(reading.ph);
      if (Number.isFinite(phVal)) {
        tank.sensors.ph = {
          value: Math.round(phVal * 100) / 100,
          unit: 'pH',
          observedAt: reading.timestamp || now
        };
      }
    }

    if (reading.ec != null) {
      const ecVal = Number(reading.ec);
      if (Number.isFinite(ecVal)) {
        // Normalize: if > 50, assume microsiemens, convert to mS/cm
        const ecMs = ecVal > 50 ? ecVal / 1000 : ecVal;
        tank.sensors.ec = {
          value: Math.round(ecMs * 1000) / 1000,
          unit: 'mS/cm',
          observedAt: reading.timestamp || now
        };
      }
    }

    if (reading.temperature != null) {
      const tempVal = Number(reading.temperature);
      if (Number.isFinite(tempVal)) {
        tank.sensors.temperature = {
          value: Math.round(tempVal * 10) / 10,
          unit: reading.temperatureUnit || '\u00B0C',
          observedAt: reading.timestamp || now
        };
      }
    }

    // Push to history ring buffer
    const historyEntry = {
      ph: tank.sensors.ph?.value ?? null,
      ec: tank.sensors.ec?.value ?? null,
      temperature: tank.sensors.temperature?.value ?? null,
      observedAt: reading.timestamp || now
    };
    tank.history.push(historyEntry);
    if (tank.history.length > MAX_HISTORY) {
      tank.history = tank.history.slice(-MAX_HISTORY);
    }

    tank.updatedAt = now;
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('telemetry', { tankId, reading: historyEntry });
  }

  recordDosingEvent(event) {
    if (!event || typeof event !== 'object') return;
    const now = new Date().toISOString();
    const entry = {
      timestamp: event.timestamp || now,
      tankId: event.tankId || event.scope || 'unknown',
      pump: event.pump || event.channel || 'unknown',
      durationMs: event.duration_ms || (event.durationSec ? event.durationSec * 1000 : null),
      volumeMl: event.ml || event.volumeMl || null,
      chemical: event.chemical || null,
      trigger: event.trigger || 'auto',
      reason: event.reason || null
    };
    this.state.dosingHistory.push(entry);
    if (this.state.dosingHistory.length > MAX_DOSING_HISTORY) {
      this.state.dosingHistory = this.state.dosingHistory.slice(-MAX_DOSING_HISTORY);
    }
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('dose', entry);
  }

  recordCalibration(type, data) {
    if (!type || !data) return;
    const now = new Date().toISOString();
    if (!this.state.calibrations[type]) {
      this.state.calibrations[type] = [];
    }
    this.state.calibrations[type].push({
      ...data,
      recordedAt: now
    });
    // Keep last 20 calibration records per type
    if (this.state.calibrations[type].length > 20) {
      this.state.calibrations[type] = this.state.calibrations[type].slice(-20);
    }
    this.state.updatedAt = now;
    this._schedulePersist();
  }

  recordAlert(alert) {
    if (!alert) return;
    const now = new Date().toISOString();
    // Spread incoming payload FIRST so the computed defaults below override
    // any null/falsy values on the raw alert (e.g. `"id": null` from JSON) —
    // otherwise `acknowledgeAlert(alertId)` can't find the record.
    this.state.alerts.push({
      ...alert,
      id: alert.id || `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      severity: alert.severity || alert.level || 'warning',
      receivedAt: now,
      acknowledged: alert.acknowledged === true
    });
    if (this.state.alerts.length > 50) {
      this.state.alerts = this.state.alerts.slice(-50);
    }
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('alert', alert);
  }

  /**
   * Record that the server has just published a setTargets command. This is
   * called from publishNutrientCommand (server-foxtrot.js) BEFORE the MQTT
   * publish so the UI can render "Pending ack" even if the ack never arrives.
   */
  recordPendingTargets(tankId, targets, meta = {}) {
    if (!tankId || !targets || typeof targets !== 'object') return;
    const now = new Date().toISOString();
    this.state.pendingTargets[tankId] = {
      targets: JSON.parse(JSON.stringify(targets)),
      requestedAt: now,
      source: meta.source || 'api',
      correlationId: meta.correlationId || null,
      topic: meta.topic || null
    };
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('pending-targets', { tankId, targets });
  }

  /**
   * Record a confirmed/applied setpoint state. This is called either from the
   * ack handler (preferred) or from a fallback timer in the server when no ack
   * topic is configured on the controller. `appliedTargets[tankId]` is the
   * source of truth the reconcile loop diffs against.
   */
  recordAppliedTargets(tankId, targets, meta = {}) {
    if (!tankId || !targets || typeof targets !== 'object') return;
    const now = new Date().toISOString();
    this.state.appliedTargets[tankId] = {
      targets: JSON.parse(JSON.stringify(targets)),
      appliedAt: meta.appliedAt || now,
      source: meta.source || 'ack',
      correlationId: meta.correlationId || null
    };
    // Clear any matching pending entry — the publish has landed.
    delete this.state.pendingTargets[tankId];
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('applied-targets', { tankId, targets });
  }

  /**
   * Receive a raw ack payload from Atlas and, if it describes an applied
   * setTargets, promote pending → applied. Non-setTargets acks (dose, calibration)
   * are recorded in dosingHistory/calibrations by the calling code path.
   */
  recordAck(tankId, ack) {
    if (!ack || typeof ack !== 'object') return;
    const action = String(ack.action || ack.type || '').toLowerCase();
    const explicitTankId = tankId || ack.tank || ack.scope || null;
    const targets = ack.targets || ack.applied || ack.payload || null;
    let resolvedTank = explicitTankId;

    if (!resolvedTank) {
      const pendingEntries = Object.entries(this.state.pendingTargets || {});
      if (pendingEntries.length === 1) {
        resolvedTank = pendingEntries[0][0];
      } else if (targets && pendingEntries.length > 1) {
        const serializedTargets = JSON.stringify(targets);
        const matchingScopes = pendingEntries
          .filter(([, entry]) => JSON.stringify(entry?.targets || null) === serializedTargets)
          .map(([scopeId]) => scopeId);
        if (matchingScopes.length === 1) {
          resolvedTank = matchingScopes[0];
        }
      }
    }

    resolvedTank = resolvedTank || 'unknown';
    if (action === 'settargets' || action === 'set_targets' || action === 'targets') {
      if (targets && typeof targets === 'object') {
        this.recordAppliedTargets(resolvedTank, targets, {
          source: 'ack',
          appliedAt: ack.appliedAt || ack.timestamp
        });
      }
    }
    this.emit('ack', { tankId: resolvedTank, ack });
  }

  getTank(tankId) {
    return this.state.tanks[tankId] || null;
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getScopes() {
    return Object.keys(this.state.tanks);
  }

  getLatest(tankId) {
    const tank = this.state.tanks[tankId];
    if (!tank) return null;
    return {
      scope: tankId,
      sensors: tank.sensors,
      updatedAt: tank.updatedAt,
      stale: tank.updatedAt ? (Date.now() - new Date(tank.updatedAt).getTime()) > STALE_THRESHOLD_MS : true,
      appliedTargets: this.state.appliedTargets[tankId] || null,
      pendingTargets: this.state.pendingTargets[tankId] || null
    };
  }

  getAppliedTargets(tankId) {
    return this.state.appliedTargets[tankId] || null;
  }

  getPendingTargets(tankId) {
    return this.state.pendingTargets[tankId] || null;
  }

  getAlerts({ limit = 50, includeAcknowledged = true } = {}) {
    const list = Array.isArray(this.state.alerts) ? this.state.alerts : [];
    const filtered = includeAcknowledged ? list : list.filter(a => !a.acknowledged);
    return filtered.slice(-limit);
  }

  acknowledgeAlert(alertId) {
    if (!alertId) return false;
    const alert = (this.state.alerts || []).find(a => a.id === alertId);
    if (!alert) return false;
    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    this._schedulePersist();
    return true;
  }

  getHistory(tankId, sensor, limit = 50) {
    const tank = this.state.tanks[tankId];
    if (!tank || !Array.isArray(tank.history)) return [];
    const sliced = tank.history.slice(-limit);
    if (sensor === 'all') return sliced;
    return sliced.map(entry => ({
      value: entry[sensor] ?? null,
      observedAt: entry.observedAt
    })).filter(e => e.value !== null);
  }

  getDosingHistory(limit = 50) {
    return this.state.dosingHistory.slice(-limit);
  }
}

class NutrientMqttSubscriber extends EventEmitter {
  constructor({ brokerUrl, store, scopeId = 'tank-2' } = {}) {
    super();
    this.brokerUrl = brokerUrl;
    this.store = store;
    this.scopeId = scopeId;
    this.client = null;
    this._connected = false;
    this._stopped = false;
    this._reconnectCount = 0;
  }

  start() {
    if (this._stopped) return;
    if (!this.brokerUrl) {
      console.warn('[nutrient-mqtt] No broker URL configured, subscriber disabled');
      return;
    }

    console.log(`[nutrient-mqtt] Connecting to MQTT broker at ${this.brokerUrl}`);

    try {
      this.client = mqtt.connect(this.brokerUrl, {
        reconnectPeriod: RECONNECT_PERIOD_MS,
        connectTimeout: 10000,
        clientId: `greenreach-nutrient-${Date.now()}`,
        clean: true
      });
    } catch (err) {
      console.error('[nutrient-mqtt] Failed to create MQTT client:', err?.message);
      return;
    }

    this.client.on('connect', () => {
      this._connected = true;
      this._reconnectCount = 0;
      console.log('[nutrient-mqtt] Connected to Atlas MQTT broker');

      const allTopics = [...TELEMETRY_TOPICS, ...EVENT_TOPICS, ...ACK_TOPICS];
      this.client.subscribe(allTopics, { qos: 1 }, (err, granted) => {
        if (err) {
          console.error('[nutrient-mqtt] Subscribe failed:', err?.message);
        } else {
          const topics = (granted || []).map(g => g.topic).join(', ');
          console.log(`[nutrient-mqtt] Subscribed to: ${topics || allTopics.join(', ')}`);
        }
      });

      this.emit('connected');
    });

    this.client.on('message', (topic, message) => {
      this._handleMessage(topic, message);
    });

    this.client.on('error', (err) => {
      console.error('[nutrient-mqtt] MQTT error:', err?.message);
      // EventEmitter treats an `error` event with no listeners as fatal. Atlas
      // connectivity is optional during Cloud Run startup, so connection issues
      // must degrade telemetry rather than crash the whole LE revision.
      if (this.listenerCount('error') > 0) {
        this.emit('error', err);
      }
    });

    this.client.on('reconnect', () => {
      this._reconnectCount++;
      if (this._reconnectCount <= 5 || this._reconnectCount % 20 === 0) {
        console.log(`[nutrient-mqtt] Reconnecting (attempt ${this._reconnectCount})...`);
      }
    });

    this.client.on('close', () => {
      this._connected = false;
      this.emit('disconnected');
    });

    this.client.on('offline', () => {
      this._connected = false;
    });
  }

  _handleMessage(topic, rawMessage) {
    let payload;
    try {
      payload = JSON.parse(rawMessage.toString());
    } catch {
      console.warn('[nutrient-mqtt] Non-JSON message on', topic);
      return;
    }

    if (!payload || typeof payload !== 'object') return;

    // Telemetry readings (pH, EC, temperature)
    if (topic.includes('/telemetry') || topic.includes('/status')) {
      const tankId = payload.scope || payload.tank || this.scopeId;
      this.store.updateTelemetry(tankId, {
        ph: payload.ph ?? payload.sensors?.ph?.value ?? payload.sensors?.ph,
        ec: payload.ec ?? payload.sensors?.ec?.value ?? payload.sensors?.ec,
        temperature: payload.temperature ?? payload.temp ?? payload.sensors?.temperature?.value ?? payload.sensors?.temperature,
        temperatureUnit: payload.temperatureUnit || payload.temp_unit,
        timestamp: payload.timestamp || payload.observedAt || new Date().toISOString()
      });
      return;
    }

    // Dosing events
    if (topic.includes('/event/dose')) {
      this.store.recordDosingEvent(payload);
      return;
    }

    // Calibration events
    if (topic.includes('/event/calibration')) {
      const calType = payload.sensor || payload.type || 'unknown';
      this.store.recordCalibration(calType, payload);
      return;
    }

    // Alert events
    if (topic.includes('/event/alert')) {
      this.store.recordAlert(payload);
      return;
    }

    // Ack topics — correlate to a pending setTargets publish or record misc acks.
    if (topic.endsWith('/ack') || topic.includes('/ack')) {
      const tankId = payload.scope || payload.tank || null;
      this.store.recordAck(tankId, payload);
      return;
    }
  }

  stop() {
    this._stopped = true;
    if (this.client) {
      try {
        this.client.end(true);
      } catch {}
      this.client = null;
    }
    this._connected = false;
    console.log('[nutrient-mqtt] Subscriber stopped');
  }

  isConnected() {
    return this._connected;
  }

  getStatus() {
    return {
      connected: this._connected,
      brokerUrl: this.brokerUrl,
      reconnectCount: this._reconnectCount,
      scopeId: this.scopeId,
      subscribedTopics: [...TELEMETRY_TOPICS, ...EVENT_TOPICS, ...ACK_TOPICS]
    };
  }
}

export { NutrientStore, NutrientMqttSubscriber };
