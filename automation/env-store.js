import path from 'path';
import { readJsonFileSync, writeJsonFileSync, ensureDirSync } from './utils/file-storage.js';

const DEFAULT_ENV_STATE = {
  scopes: {},
  targets: {},
  rooms: {},
  updatedAt: null
};

const LIVE_SENSOR_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const SENSOR_RETENTION_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_SENSOR_HISTORY = 50;

function nowIso() {
  return new Date().toISOString();
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function toTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const ts = value.getTime();
    return Number.isFinite(ts) ? ts : null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function weightedMedian(samples) {
  if (!Array.isArray(samples) || !samples.length) return null;
  const normalized = samples
    .filter((sample) => isFiniteNumber(sample.value))
    .map((sample) => ({
      value: sample.value,
      weight: isFiniteNumber(sample.weight) && sample.weight > 0 ? sample.weight : 1
    }))
    .sort((a, b) => a.value - b.value);
  if (!normalized.length) return null;
  const totalWeight = normalized.reduce((acc, sample) => acc + sample.weight, 0);
  const halfWeight = totalWeight / 2;
  let running = 0;
  for (const sample of normalized) {
    running += sample.weight;
    if (running >= halfWeight) {
      return sample.value;
    }
  }
  return normalized[normalized.length - 1].value;
}

function aggregateSensorSources(sourceEntries) {
  const entries = Object.values(sourceEntries || {})
    .filter((entry) => entry && isFiniteNumber(entry.value));
  if (!entries.length) {
    return {
      value: null,
      observedAt: null,
      liveSources: 0,
      totalSources: 0,
      fallback: null,
      lastSampleAt: null
    };
  }

  const now = Date.now();
  const withTimestamps = entries.map((entry) => ({
    ...entry,
    observedAtTs: toTimestamp(entry.observedAt) ?? now
  }));

  const live = withTimestamps.filter((entry) => (now - entry.observedAtTs) <= LIVE_SENSOR_MAX_AGE_MS);
  const samples = live.length ? live : withTimestamps;
  const aggregate = weightedMedian(samples);

  const latestSampleTs = samples.reduce((acc, entry) => (entry.observedAtTs > acc ? entry.observedAtTs : acc), 0);
  const observedAt = latestSampleTs ? new Date(latestSampleTs).toISOString() : null;

  return {
    value: aggregate,
    observedAt,
    liveSources: live.length,
    totalSources: withTimestamps.length,
    fallback: live.length ? null : 'stale-sources',
    lastSampleAt: observedAt
  };
}

export default class EnvStore {
  constructor(options = {}) {
    const {
      dataDir = path.resolve('./data/automation'),
      fileName = 'env-state.json'
    } = options;

    this.dataDir = dataDir;
    this.filePath = path.join(this.dataDir, fileName);
    ensureDirSync(this.dataDir);
    this.state = readJsonFileSync(this.filePath, { ...DEFAULT_ENV_STATE });
    if (!this.state.updatedAt) {
      this.state.updatedAt = nowIso();
    }
  }

  getSnapshot() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getScopeIds() {
    return Object.keys(this.state.scopes || {});
  }

  getScope(scopeId) {
    return JSON.parse(JSON.stringify(this.state.scopes?.[scopeId] || {}));
  }

  upsertScope(scopeId, payload = {}) {
    if (!scopeId) return this.getScope(scopeId);
    const existing = this.state.scopes?.[scopeId] || {};
    const next = {
      ...existing,
      ...payload,
      sensors: {
        ...(existing.sensors || {}),
        ...(payload.sensors || {})
      },
      updatedAt: nowIso()
    };
    this.state.scopes = {
      ...(this.state.scopes || {}),
      [scopeId]: next
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return this.getScope(scopeId);
  }

  updateSensor(scopeId, sensorType, reading) {
    if (!scopeId || !sensorType) return;
    const scope = this.state.scopes?.[scopeId] || { sensors: {} };
    const sensors = { ...(scope.sensors || {}) };
    const existingEntry = sensors[sensorType] || {};

    const readingValue = reading?.value ?? (typeof reading === 'number' ? reading : null);
    const unit = reading?.unit || existingEntry.unit || null;
    const observedAt = reading?.observedAt || nowIso();
    const meta = reading?.meta || {};
    const weight = reading?.weight ?? meta?.weight;
    const sensorId = meta?.sensorId
      || meta?.deviceId
      || meta?.id
      || meta?.sourceId
      || meta?.mac
      || meta?.serial
      || null;

    const existingSources = { ...(existingEntry.sources || {}) };
    const nowTs = Date.now();

    if (sensorId) {
      existingSources[sensorId] = {
        value: readingValue,
        weight,
        observedAt,
        meta: { ...meta }
      };
    } else if (readingValue != null) {
      const ephemeralId = `sensor:${sensorType}:${nowTs}`;
      existingSources[ephemeralId] = {
        value: readingValue,
        weight,
        observedAt,
        meta: { ...meta }
      };
    }

    const prunedSources = Object.entries(existingSources).reduce((acc, [key, entry]) => {
      if (!entry || !isFiniteNumber(entry.value)) {
        return acc;
      }
      const ts = toTimestamp(entry.observedAt) ?? nowTs;
      if (ts && nowTs - ts > SENSOR_RETENTION_MS) {
        return acc;
      }
      acc[key] = { ...entry, observedAt: entry.observedAt || new Date(ts).toISOString() };
      return acc;
    }, {});

    const aggregate = aggregateSensorSources(prunedSources);
    const history = Array.isArray(existingEntry.history) ? [...existingEntry.history] : [];
    if (isFiniteNumber(aggregate.value)) {
      history.unshift(aggregate.value);
      if (history.length > MAX_SENSOR_HISTORY) {
        history.length = MAX_SENSOR_HISTORY;
      }
    }

    sensors[sensorType] = {
      value: aggregate.value,
      unit,
      observedAt: aggregate.observedAt || observedAt,
      history,
      sources: prunedSources,
      meta: {
        ...(existingEntry.meta || {}),
        ...meta,
        liveSources: aggregate.liveSources,
        totalSources: aggregate.totalSources,
        fallback: aggregate.fallback,
        lastSampleAt: aggregate.lastSampleAt,
        source: aggregate.liveSources > 0 ? 'weighted-median' : aggregate.value != null ? 'fallback-median' : existingEntry.meta?.source || null
      }
    };

    this.state.scopes = {
      ...(this.state.scopes || {}),
      [scopeId]: {
        ...scope,
        sensors,
        updatedAt: nowIso()
      }
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return this.getScope(scopeId);
  }

  setTargets(scopeId, targets = {}) {
    if (!scopeId) return;
    const existing = this.state.targets?.[scopeId] || {};
    this.state.targets = {
      ...(this.state.targets || {}),
      [scopeId]: {
        ...existing,
        ...targets,
        updatedAt: nowIso()
      }
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return JSON.parse(JSON.stringify(this.state.targets[scopeId]));
  }

  getTargets(scopeId) {
    return JSON.parse(JSON.stringify(this.state.targets?.[scopeId] || {}));
  }

  listRooms() {
    const rooms = this.state.rooms || {};
    return Object.values(rooms).map((room) => JSON.parse(JSON.stringify(room)));
  }

  getRoom(roomId) {
    if (!roomId) return null;
    const room = this.state.rooms?.[roomId];
    return room ? JSON.parse(JSON.stringify(room)) : null;
  }

  upsertRoom(roomId, payload = {}) {
    if (!roomId) return null;
    const existing = this.state.rooms?.[roomId] || {};

    const mergeActuatorList = (next = [], prev = []) => {
      const list = Array.isArray(next) ? next : [];
      const existingList = Array.isArray(prev) ? prev : [];
      const merged = [...existingList, ...list].map((value) => String(value));
      return Array.from(new Set(merged));
    };

    const existingActuators = existing.actuators || {};

    const next = {
      roomId,
      name: payload.name || existing.name || roomId,
      targets: {
        ...(existing.targets || {}),
        ...(payload.targets || {})
      },
      control: {
        enable: existing.control?.enable ?? false,
        mode: existing.control?.mode || 'advisory',
        step: existing.control?.step ?? 0.05,
        dwell: existing.control?.dwell ?? 180,
        ...(payload.control || {})
      },
      sensors: {
        ...(existing.sensors || {}),
        ...(payload.sensors || {})
      },
      actuators: {
        ...existingActuators,
        lights: mergeActuatorList(payload.actuators?.lights, existingActuators?.lights),
        fans: mergeActuatorList(payload.actuators?.fans, existingActuators?.fans),
        dehu: mergeActuatorList(payload.actuators?.dehu, existingActuators?.dehu),
        ...(payload.actuators || {})
      },
      meta: {
        ...(existing.meta || {}),
        ...(payload.meta || {})
      },
      updatedAt: nowIso()
    };

    this.state.rooms = {
      ...(this.state.rooms || {}),
      [roomId]: next
    };
    this.state.updatedAt = nowIso();
    this.persist();
    return JSON.parse(JSON.stringify(next));
  }

  removeRoom(roomId) {
    if (!roomId || !this.state.rooms?.[roomId]) return false;
    const nextRooms = { ...(this.state.rooms || {}) };
    delete nextRooms[roomId];
    this.state.rooms = nextRooms;
    this.state.updatedAt = nowIso();
    this.persist();
    return true;
  }

  persist() {
    writeJsonFileSync(this.filePath, this.state);
  }
}
