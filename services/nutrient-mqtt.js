// services/nutrient-mqtt.js -- Persistent MQTT subscriber for Atlas nutrient dosing system
// Connects to the Atlas MQTT broker, subscribes to telemetry + dosing event topics,
// stores readings locally (in-memory + file persistence), and exposes data for the
// /data/nutrient-dashboard and /api/nutrients/* endpoints.

import mqtt from 'mqtt';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

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

class NutrientStore extends EventEmitter {
  constructor({ dataDir, fileName = 'nutrient-store.json' } = {}) {
    super();
    this.dataDir = dataDir || path.join(process.cwd(), 'public', 'data', 'automation');
    this.filePath = path.join(this.dataDir, fileName);
    this.state = {
      tanks: {},
      dosingHistory: [],
      calibrations: {},
      alerts: [],
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
    this.state.alerts.push({
      ...alert,
      receivedAt: now
    });
    if (this.state.alerts.length > 50) {
      this.state.alerts = this.state.alerts.slice(-50);
    }
    this.state.updatedAt = now;
    this._schedulePersist();
    this.emit('alert', alert);
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
      stale: tank.updatedAt ? (Date.now() - new Date(tank.updatedAt).getTime()) > STALE_THRESHOLD_MS : true
    };
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

      const allTopics = [...TELEMETRY_TOPICS, ...EVENT_TOPICS];
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
      this.emit('error', err);
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
      subscribedTopics: [...TELEMETRY_TOPICS, ...EVENT_TOPICS]
    };
  }
}

export { NutrientStore, NutrientMqttSubscriber };
