/**
 * Sync Monitor Service
 *
 * Tracks real-time sync health for Central:
 * - last success/failure timestamps
 * - per-farm sync activity and lag
 * - queue depth (reported/derived)
 * - operation counters and error rate
 */

import logger from '../utils/logger.js';
import { query, isDatabaseAvailable } from '../config/database.js';
import fs from 'node:fs';
import path from 'node:path';
import { readJSON as gcsReadJSON, writeJSON as gcsWriteJSON, USE_GCS } from './gcs-storage.js';

const STALE_AFTER_MS = 15 * 60 * 1000;
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SAMPLE_INTERVAL_MS = 30 * 1000;
const ALERT_TYPES = {
  degraded: 'sync_slo_degraded',
  stale: 'sync_slo_stale'
};
const ALERT_SEVERITY = {
  degraded: 'warning',
  stale: 'critical'
};
const DEGRADED_MIN_OPERATIONS = 3;
const RECENT_ALERT_EVENTS_LIMIT = 50;
const SNAPSHOT_FILE_NAME = 'sync-monitor-snapshot.json';

function isoNow() {
  return new Date().toISOString();
}

function clampNonNegative(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, parsed);
}

export function createSyncMonitor(options = {}) {
  const staleAfterMs = clampNonNegative(options.staleAfterMs) || STALE_AFTER_MS;
  const pruneAfterMs = clampNonNegative(options.pruneAfterMs) || PRUNE_AFTER_MS;
  const sampleIntervalMs = clampNonNegative(options.sampleIntervalMs) || DEFAULT_SAMPLE_INTERVAL_MS;
  const persistenceEnabled = options.persistenceEnabled !== false;
  const snapshotFilePath = options.snapshotFilePath || path.resolve('data', SNAPSHOT_FILE_NAME);

  const state = {
    started_at: isoNow(),
    last_sampled_at: null,
    last_success_at: null,
    last_failure_at: null,
    totals: {
      operations: 0,
      success: 0,
      failure: 0,
      pull_runs: 0,
      pull_failures: 0,
      records_updated: 0,
      errors_reported: 0
    },
    queue_depth: {
      reported_total: 0,
      derived_total: 0,
      max_reported: 0
    },
    operations_by_type: {},
    farms: new Map(),
    farm_status: new Map(),
    farm_db_ids: new Map(),
    alert_events: [],
    alerts: {
      transitions: 0,
      raised: 0,
      resolved: 0,
      last_transition_at: null,
      last_transition: null
    },
    last_persisted_at: null
  };

  let sampler = null;
  let alertTransitionQueue = Promise.resolve();

  function mergeCounterObject(target, source) {
    if (!source || typeof source !== 'object') return target;
    for (const [key, value] of Object.entries(source)) {
      target[key] = clampNonNegative(value);
    }
    return target;
  }

  function hydrateFromSnapshot(snapshotData) {
    if (!snapshotData || typeof snapshotData !== 'object') return false;

    state.started_at = snapshotData.started_at || state.started_at;
    state.last_sampled_at = snapshotData.last_sampled_at || state.last_sampled_at;
    state.last_success_at = snapshotData.last_success_at || snapshotData.health?.last_success_at || state.last_success_at;
    state.last_failure_at = snapshotData.last_failure_at || snapshotData.health?.last_failure_at || state.last_failure_at;

    mergeCounterObject(state.totals, snapshotData.totals);
    mergeCounterObject(state.queue_depth, snapshotData.queue_depth);

    state.operations_by_type = {};
    if (snapshotData.operations_by_type && typeof snapshotData.operations_by_type === 'object') {
      for (const [type, bucket] of Object.entries(snapshotData.operations_by_type)) {
        state.operations_by_type[type] = {
          total: clampNonNegative(bucket?.total),
          success: clampNonNegative(bucket?.success),
          failure: clampNonNegative(bucket?.failure)
        };
      }
    }

    state.farms.clear();
    state.farm_status.clear();
    for (const farm of snapshotData.farms || []) {
      if (!farm || typeof farm !== 'object') continue;
      const farmId = String(farm.farm_id || 'unknown');
      state.farms.set(farmId, {
        farm_id: farmId,
        first_seen_at: farm.first_seen_at || isoNow(),
        last_seen_at: farm.last_seen_at || null,
        last_success_at: farm.last_success_at || null,
        last_failure_at: farm.last_failure_at || null,
        operations: clampNonNegative(farm.operations),
        success: clampNonNegative(farm.success),
        failure: clampNonNegative(farm.failure),
        queue_depth: clampNonNegative(farm.queue_depth),
        lag_ms: farm.lag_ms != null ? clampNonNegative(farm.lag_ms) : null,
        last_operation: farm.last_operation || null,
        last_error: farm.last_error || null
      });
      const status = farm.status || computeFarmStatus(state.farms.get(farmId)).status;
      state.farm_status.set(farmId, status);
    }

    const alerts = snapshotData.alerts || {};
    state.alerts.transitions = clampNonNegative(alerts.transitions);
    state.alerts.raised = clampNonNegative(alerts.raised);
    state.alerts.resolved = clampNonNegative(alerts.resolved);
    state.alerts.last_transition_at = alerts.last_transition_at || null;
    state.alerts.last_transition = alerts.last_transition || null;
    state.alert_events = Array.isArray(alerts.recent)
      ? alerts.recent.slice(-RECENT_ALERT_EVENTS_LIMIT)
      : [];

    state.last_persisted_at = snapshotData.persisted_at || snapshotData.last_persisted_at || null;
    return true;
  }

  function loadSnapshotFromDisk() {
    if (!persistenceEnabled) return;
    // On Cloud Run, load from GCS; locally from disk
    if (USE_GCS) {
      gcsReadJSON('data/sync-monitor-snapshot.json', null).then(parsed => {
        if (parsed && hydrateFromSnapshot(parsed)) {
          logger.info('[SyncMonitor] Restored snapshot from GCS', {
            farms_count: state.farms.size,
            last_success_at: state.last_success_at,
            last_persisted_at: state.last_persisted_at
          });
        }
      }).catch(err => {
        logger.warn('[SyncMonitor] Failed to restore snapshot from GCS', {
          error: String(err?.message || err)
        });
      });
      return;
    }
    try {
      if (!fs.existsSync(snapshotFilePath)) return;
      const raw = fs.readFileSync(snapshotFilePath, 'utf8');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (hydrateFromSnapshot(parsed)) {
        logger.info('[SyncMonitor] Restored snapshot from disk', {
          file: snapshotFilePath,
          farms_count: state.farms.size,
          last_success_at: state.last_success_at,
          last_persisted_at: state.last_persisted_at
        });
      }
    } catch (error) {
      logger.warn('[SyncMonitor] Failed to restore snapshot from disk', {
        file: snapshotFilePath,
        error: String(error?.message || error)
      });
    }
  }

  function persistSnapshot(reason = 'sample') {
    if (!persistenceEnabled) return;
    const payload = snapshot();
    payload.persisted_at = isoNow();
    payload.persist_reason = reason;
    payload.last_success_at = state.last_success_at;
    payload.last_failure_at = state.last_failure_at;

    // Persist to GCS on Cloud Run, filesystem locally
    if (USE_GCS) {
      gcsWriteJSON('data/sync-monitor-snapshot.json', payload).then(() => {
        state.last_persisted_at = payload.persisted_at;
      }).catch(err => {
        logger.warn('[SyncMonitor] Failed to persist snapshot to GCS', {
          reason,
          error: String(err?.message || err)
        });
      });
      return;
    }
    try {
      const dir = path.dirname(snapshotFilePath);
      fs.mkdirSync(dir, { recursive: true });
      const tempPath = `${snapshotFilePath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tempPath, snapshotFilePath);
      state.last_persisted_at = payload.persisted_at;
    } catch (error) {
      logger.warn('[SyncMonitor] Failed to persist snapshot', {
        file: snapshotFilePath,
        reason,
        error: String(error?.message || error)
      });
    }
  }

  function appendAlertEvent(event) {
    state.alert_events.push(event);
    if (state.alert_events.length > RECENT_ALERT_EVENTS_LIMIT) {
      state.alert_events.splice(0, state.alert_events.length - RECENT_ALERT_EVENTS_LIMIT);
    }
  }

  function computeFarmStatus(farm, now = Date.now()) {
    const lastSuccessTs = farm.last_success_at ? new Date(farm.last_success_at).getTime() : null;
    const lagMs = lastSuccessTs ? Math.max(0, now - lastSuccessTs) : null;
    const stale = lagMs != null && lagMs > staleAfterMs;
    const degraded = farm.operations >= DEGRADED_MIN_OPERATIONS && farm.failure > farm.success;

    if (stale) {
      return { status: 'stale', lagMs, stale, degraded };
    }
    if (degraded) {
      return { status: 'degraded', lagMs, stale, degraded };
    }
    return { status: 'healthy', lagMs, stale, degraded };
  }

  async function resolveFarmDbId(farmId) {
    const key = String(farmId || 'unknown');
    if (!key || key === 'unknown') return null;
    if (state.farm_db_ids.has(key)) return state.farm_db_ids.get(key);

    const farmResult = await query('SELECT id FROM farms WHERE farm_id = $1 LIMIT 1', [key]);
    const farmDbId = farmResult.rows[0]?.id || null;
    state.farm_db_ids.set(key, farmDbId);
    return farmDbId;
  }

  async function persistFarmStatusAlert({ farmId, nextStatus, context = {} }) {
    if (!isDatabaseAvailable()) return;
    if (!['degraded', 'stale', 'healthy'].includes(nextStatus)) return;

    try {
      const farmDbId = await resolveFarmDbId(farmId);
      if (!farmDbId) {
        logger.debug('[SyncMonitor] Skipping sync SLO alert persistence: farm not found', { farmId, nextStatus });
        return;
      }

      const activeResult = await query(
        `SELECT id, alert_type
         FROM farm_alerts
         WHERE farm_id = $1
           AND resolved = false
           AND alert_type IN ($2, $3)`,
        [farmDbId, ALERT_TYPES.degraded, ALERT_TYPES.stale]
      );

      const activeByType = new Map(activeResult.rows.map((row) => [row.alert_type, row]));

      if (nextStatus === 'healthy') {
        if (activeResult.rows.length > 0) {
          await query(
            `UPDATE farm_alerts
             SET resolved = true,
                 resolved_at = NOW()
             WHERE farm_id = $1
               AND resolved = false
               AND alert_type IN ($2, $3)`,
            [farmDbId, ALERT_TYPES.degraded, ALERT_TYPES.stale]
          );
        }
        return;
      }

      const targetType = ALERT_TYPES[nextStatus];
      const targetSeverity = ALERT_SEVERITY[nextStatus];

      for (const [alertType, alertRow] of activeByType.entries()) {
        if (alertType !== targetType) {
          await query(
            `UPDATE farm_alerts
             SET resolved = true,
                 resolved_at = NOW()
             WHERE id = $1`,
            [alertRow.id]
          );
        }
      }

      if (activeByType.has(targetType)) return;

      const lagSeconds = context.lagMs != null ? Math.round(context.lagMs / 1000) : null;
      const message = nextStatus === 'stale'
        ? `Sync SLO stale for farm ${farmId}. Last successful sync exceeded ${Math.round(staleAfterMs / 1000)}s threshold (current lag ${lagSeconds ?? 'unknown'}s).`
        : `Sync SLO degraded for farm ${farmId}. Success ${context.success ?? 0}, failure ${context.failure ?? 0} over ${context.operations ?? 0} operations.`;

      await query(
        `INSERT INTO farm_alerts
         (farm_id, alert_type, severity, message, zone_id, device_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [farmDbId, targetType, targetSeverity, message, null, null]
      );
    } catch (error) {
      const message = String(error?.message || error);
      if (message.includes('relation') && message.includes('farm_alerts')) {
        logger.debug('[SyncMonitor] farm_alerts table unavailable, skipping sync SLO alert persistence');
        return;
      }
      logger.warn('[SyncMonitor] Failed to persist sync SLO alert transition', {
        farmId,
        nextStatus,
        error: message
      });
    }
  }

  function enqueueAlertTransition(job) {
    alertTransitionQueue = alertTransitionQueue
      .then(job)
      .catch((error) => {
        logger.warn('[SyncMonitor] Alert transition queue error', { error: String(error?.message || error) });
      });
  }

  function processFarmStatusTransitions() {
    const nowIso = isoNow();
    const now = Date.now();

    for (const farm of state.farms.values()) {
      const transition = computeFarmStatus(farm, now);
      const previousStatus = state.farm_status.get(farm.farm_id) || 'unknown';
      if (previousStatus === transition.status) continue;

      state.farm_status.set(farm.farm_id, transition.status);

      const event = {
        farm_id: farm.farm_id,
        from: previousStatus,
        to: transition.status,
        at: nowIso,
        lag_ms: transition.lagMs,
        success: farm.success,
        failure: farm.failure,
        operations: farm.operations
      };

      state.alerts.transitions += 1;
      state.alerts.last_transition_at = nowIso;
      state.alerts.last_transition = event;

      if ((previousStatus === 'stale' || previousStatus === 'degraded') && transition.status === 'healthy') {
        state.alerts.resolved += 1;
        appendAlertEvent({ ...event, action: 'resolved' });
      } else if (transition.status === 'stale' || transition.status === 'degraded') {
        state.alerts.raised += 1;
        appendAlertEvent({ ...event, action: 'raised' });
      } else {
        appendAlertEvent({ ...event, action: 'transition' });
      }

      logger.info('[SyncMonitor] Farm sync SLO status transition', event);

      enqueueAlertTransition(() => persistFarmStatusAlert({
        farmId: farm.farm_id,
        nextStatus: transition.status,
        context: {
          lagMs: transition.lagMs,
          success: farm.success,
          failure: farm.failure,
          operations: farm.operations
        }
      }));
    }
  }

  function getFarmEntry(farmId) {
    const key = String(farmId || 'unknown');
    if (!state.farms.has(key)) {
      state.farms.set(key, {
        farm_id: key,
        first_seen_at: isoNow(),
        last_seen_at: null,
        last_success_at: null,
        last_failure_at: null,
        operations: 0,
        success: 0,
        failure: 0,
        queue_depth: 0,
        lag_ms: null,
        last_operation: null,
        last_error: null
      });
    }
    return state.farms.get(key);
  }

  function pruneInactiveFarms() {
    const now = Date.now();
    for (const [farmId, farm] of state.farms.entries()) {
      const lastSeen = farm.last_seen_at ? new Date(farm.last_seen_at).getTime() : 0;
      if (!lastSeen || (now - lastSeen) > pruneAfterMs) {
        state.farms.delete(farmId);
      }
    }
  }

  function recomputeDerivedQueueDepth() {
    let total = 0;
    for (const farm of state.farms.values()) {
      total += clampNonNegative(farm.queue_depth);
    }
    state.queue_depth.derived_total = total;
  }

  function sample() {
    state.last_sampled_at = isoNow();
    pruneInactiveFarms();
    recomputeDerivedQueueDepth();
    processFarmStatusTransitions();
    persistSnapshot('sample');
  }

  function incrementTypeCounter(type) {
    const key = String(type || 'unknown');
    const existing = state.operations_by_type[key] || { total: 0, success: 0, failure: 0 };
    existing.total += 1;
    state.operations_by_type[key] = existing;
    return existing;
  }

  function recordOperation({ farmId, type = 'sync', success = true, queueDepth = 0, lagMs = null, error = null, records = 0 } = {}) {
    const nowIso = isoNow();
    const farm = getFarmEntry(farmId);
    const bucket = incrementTypeCounter(type);

    state.totals.operations += 1;
    farm.operations += 1;
    farm.last_seen_at = nowIso;
    farm.last_operation = String(type || 'sync');
    farm.queue_depth = clampNonNegative(queueDepth);

    const computedLag = lagMs != null
      ? clampNonNegative(lagMs)
      : farm.last_success_at
        ? Math.max(0, Date.now() - new Date(farm.last_success_at).getTime())
        : null;
    farm.lag_ms = computedLag;

    if (success) {
      state.totals.success += 1;
      farm.success += 1;
      bucket.success += 1;
      state.last_success_at = nowIso;
      farm.last_success_at = nowIso;
      farm.last_error = null;
      state.totals.records_updated += clampNonNegative(records);
    } else {
      state.totals.failure += 1;
      farm.failure += 1;
      bucket.failure += 1;
      state.last_failure_at = nowIso;
      farm.last_failure_at = nowIso;
      farm.last_error = error ? String(error) : 'sync operation failed';
    }

    const totalQueue = clampNonNegative(queueDepth);
    state.queue_depth.reported_total += totalQueue;
    state.queue_depth.max_reported = Math.max(state.queue_depth.max_reported, totalQueue);

    sample();
  }

  function recordPullRun({ success = true, updated = 0, errors = 0, farmId = null, durationMs = null, error = null } = {}) {
    state.totals.pull_runs += 1;
    state.totals.errors_reported += clampNonNegative(errors);
    if (!success) state.totals.pull_failures += 1;

    recordOperation({
      farmId,
      type: 'pull-farm-data',
      success,
      queueDepth: 0,
      lagMs: durationMs,
      error,
      records: updated
    });
  }

  function getHealth() {
    const now = Date.now();
    const lastSuccessTime = state.last_success_at ? new Date(state.last_success_at).getTime() : null;
    const lagMs = lastSuccessTime ? Math.max(0, now - lastSuccessTime) : null;
    const stale = lagMs != null ? lagMs > staleAfterMs : true;

    let status = 'healthy';
    if (state.totals.failure > state.totals.success) status = 'degraded';
    if (stale) status = 'stale';

    return {
      status,
      stale,
      stale_after_ms: staleAfterMs,
      lag_ms: lagMs,
      lag_seconds: lagMs != null ? Math.round(lagMs / 1000) : null,
      last_success_at: state.last_success_at,
      last_failure_at: state.last_failure_at,
      sample_interval_ms: sampleIntervalMs
    };
  }

  function snapshot() {
    const farms = Array.from(state.farms.values())
      .map((farm) => ({ ...farm }))
      .sort((a, b) => (a.farm_id || '').localeCompare(b.farm_id || ''));

    return {
      started_at: state.started_at,
      last_sampled_at: state.last_sampled_at,
      last_persisted_at: state.last_persisted_at,
      health: getHealth(),
      totals: { ...state.totals },
      alerts: {
        ...state.alerts,
        recent: state.alert_events.map((event) => ({ ...event }))
      },
      queue_depth: { ...state.queue_depth },
      operations_by_type: { ...state.operations_by_type },
      farms_count: farms.length,
      farms
    };
  }

  function start() {
    if (sampler) return sampler;
    loadSnapshotFromDisk();
    sample();
    sampler = setInterval(sample, sampleIntervalMs);
    logger.info('[SyncMonitor] Started', {
      stale_after_ms: staleAfterMs,
      sample_interval_ms: sampleIntervalMs,
      prune_after_ms: pruneAfterMs,
      snapshot_file: snapshotFilePath,
      persistence_enabled: persistenceEnabled
    });
    return sampler;
  }

  function stop() {
    if (!sampler) return;
    clearInterval(sampler);
    sampler = null;
    persistSnapshot('stop');
    logger.info('[SyncMonitor] Stopped');
  }

  return {
    start,
    stop,
    sample,
    snapshot,
    getHealth,
    recordOperation,
    recordPullRun
  };
}

export function startSyncMonitor(app) {
  const monitor = createSyncMonitor();
  monitor.start();

  if (app && app.locals) {
    app.locals.syncMonitor = monitor;
  }

  return monitor;
}
