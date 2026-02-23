import Datastore from 'nedb-promises';
import crypto from 'crypto';

const STALE_THRESHOLD_MS = Number(process.env.SAFETY_STALE_THRESHOLD_MS || (2 * 60 * 60 * 1000));
const MAX_HISTORY = Number(process.env.SAFETY_STATE_HISTORY_MAX || 50);
const SAFETY_ENABLED = String(process.env.SAFETY_ENVELOPE_ENABLED || 'true').toLowerCase() !== 'false';

const safetyStateDb = Datastore.create({
  filename: './data/safety-envelope-state.db',
  autoload: true,
  timestampData: true
});

const safetyAuditDb = Datastore.create({
  filename: './data/safety-audit-log.db',
  autoload: true,
  timestampData: true
});

let indexesReady = false;

async function ensureIndexes() {
  if (indexesReady) return;
  await safetyStateDb.ensureIndex({ fieldName: 'deviceId', unique: true });
  await safetyAuditDb.ensureIndex({ fieldName: 'auditId', unique: true });
  await safetyAuditDb.ensureIndex({ fieldName: 'timestamp' });
  await safetyAuditDb.ensureIndex({ fieldName: 'deviceId' });
  indexesReady = true;
}

function generateAuditId() {
  return `SAF-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function isTruthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'string') return ['true', '1', 'yes', 'y', 'on'].includes(value.toLowerCase());
  return false;
}

function isActivatingCommand(command = '') {
  const normalized = String(command || '').toLowerCase();
  return ['turnon', 'on', 'start', 'enable', 'inject', 'open'].includes(normalized);
}

function isDeactivatingCommand(command = '') {
  const normalized = String(command || '').toLowerCase();
  return ['turnoff', 'off', 'stop', 'disable', 'close'].includes(normalized);
}

function inferSafetyCategory(device = {}, command = '', args = {}) {
  const explicit = String(device.safetyCategory || '').trim().toLowerCase();
  if (explicit) return explicit;

  const tokens = [
    device.deviceType,
    device.type,
    device.protocol,
    command,
    args?.actuator,
    args?.category,
    args?.mode
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())
    .join(' ');

  if (/sensor|monitor|meter/.test(tokens)) return 'sensor';
  if (/indicator|status|led/.test(tokens)) return 'indicator';
  if (/co2|pump|heater|burner|injector/.test(tokens)) return 'actuator-high';
  return 'actuator-low';
}

function validateConfirmation(confirmation = null, context = {}) {
  if (isTruthy(context.confirmed)) {
    return { ok: true, source: 'flag' };
  }

  if (!confirmation || typeof confirmation !== 'object') {
    return { ok: false, reason: 'Missing confirmation payload' };
  }

  const confirmed = isTruthy(confirmation.confirmed);
  const confirmedBy = String(confirmation.confirmedBy || '').trim();
  const sessionId = String(confirmation.sessionId || context.sessionId || '').trim();
  const confirmedAtMs = Date.parse(confirmation.confirmedAt || '');
  const maxAge = Number(confirmation.maxAge || 30000);

  if (!confirmed) return { ok: false, reason: 'Confirmation flag is false' };
  if (!confirmedBy) return { ok: false, reason: 'confirmedBy is required' };
  if (!sessionId) return { ok: false, reason: 'sessionId is required' };
  if (!Number.isFinite(confirmedAtMs)) return { ok: false, reason: 'confirmedAt is invalid' };
  if ((Date.now() - confirmedAtMs) > maxAge) return { ok: false, reason: 'Confirmation expired' };

  return { ok: true, source: 'signed' };
}

function normalizeStateRecord(existing, deviceId) {
  if (!existing) return null;
  return {
    deviceId,
    currentState: existing.currentState || 'unknown',
    lastCommandAt: existing.lastCommandAt || null,
    lastCommand: existing.lastCommand || null,
    lastOffAt: existing.lastOffAt || null,
    continuousOnSince: existing.continuousOnSince || null,
    cyclesInWindow: Number.isFinite(existing.cyclesInWindow) ? existing.cyclesInWindow : 0,
    windowStart: existing.windowStart || null,
    commandHistory: Array.isArray(existing.commandHistory) ? existing.commandHistory : []
  };
}

function buildValidation({ device, command, state, staleThresholdMs, category, context }) {
  const checks = [];
  const now = Date.now();
  const activating = isActivatingCommand(command);
  const needsHighSafety = category === 'actuator-high' && activating;

  if (!state) {
    if (needsHighSafety) {
      checks.push({ check: 'state:exists', passed: false });
      return {
        allowed: false,
        reason: 'No safety state on record for actuator-high command. Run health check first.',
        remediation: `GET /api/integrations/${device.deviceId}/health-check`,
        checks
      };
    }
    checks.push({ check: 'state:exists', passed: true, degraded: true });
  }

  if (state?.lastCommandAt) {
    const ageMs = now - Date.parse(state.lastCommandAt);
    const stale = !Number.isFinite(ageMs) || ageMs > staleThresholdMs;
    checks.push({
      check: 'state:freshness',
      passed: !stale || !needsHighSafety,
      stale,
      ageMinutes: Number.isFinite(ageMs) ? Math.round(ageMs / 60000) : null,
      thresholdMinutes: Math.round(staleThresholdMs / 60000)
    });

    if (stale && needsHighSafety) {
      return {
        allowed: false,
        reason: `Safety state is stale (${Math.round(ageMs / 60000)} minutes old). Refresh required for actuator-high commands.`,
        remediation: 'Run device health check to refresh state',
        checks
      };
    }
  }

  const requiresConfirmation = category === 'actuator-high' && activating;
  if (requiresConfirmation) {
    const confirmation = validateConfirmation(context.confirmation, context);
    checks.push({
      check: 'confirmation',
      passed: confirmation.ok,
      source: confirmation.source || null,
      reason: confirmation.reason || null
    });

    if (!confirmation.ok) {
      return {
        allowed: false,
        requires_confirmation: true,
        reason: confirmation.reason || 'Human confirmation required for this actuator command',
        checks
      };
    }
  }

  return {
    allowed: true,
    checks,
    reason: null,
    requires_confirmation: false
  };
}

async function updateDeviceState(deviceId, command, previousState) {
  const nowIso = new Date().toISOString();
  const normalized = normalizeStateRecord(previousState, deviceId) || {
    deviceId,
    currentState: 'unknown',
    lastCommandAt: null,
    lastCommand: null,
    lastOffAt: null,
    continuousOnSince: null,
    cyclesInWindow: 0,
    windowStart: nowIso,
    commandHistory: []
  };

  const activating = isActivatingCommand(command);
  const deactivating = isDeactivatingCommand(command);

  const history = [
    { timestamp: nowIso, command: String(command || '') },
    ...(normalized.commandHistory || [])
  ].slice(0, MAX_HISTORY);

  const oneHourAgo = Date.now() - (60 * 60 * 1000);
  const cyclesInWindow = history.filter((entry) => {
    const entryTs = Date.parse(entry.timestamp || '');
    return Number.isFinite(entryTs) && entryTs >= oneHourAgo && isActivatingCommand(entry.command);
  }).length;

  const nextState = {
    deviceId,
    lastCommandAt: nowIso,
    lastCommand: String(command || ''),
    lastOffAt: deactivating ? nowIso : normalized.lastOffAt,
    currentState: activating ? 'on' : deactivating ? 'off' : (normalized.currentState || 'unknown'),
    continuousOnSince: activating
      ? (normalized.currentState === 'on' && normalized.continuousOnSince ? normalized.continuousOnSince : nowIso)
      : deactivating
        ? null
        : normalized.continuousOnSince,
    cyclesInWindow,
    windowStart: new Date(oneHourAgo).toISOString(),
    commandHistory: history
  };

  await safetyStateDb.update({ deviceId }, { $set: nextState }, { upsert: true });
  return nextState;
}

export async function executeSafetyEnvelope({ device, command, args = {}, context = {}, execute }) {
  await ensureIndexes();

  const auditId = generateAuditId();
  const category = inferSafetyCategory(device, command, args);
  const state = normalizeStateRecord(await safetyStateDb.findOne({ deviceId: device.deviceId }), device.deviceId);
  const staleThresholdMs = Number.isFinite(context.staleThresholdMs) ? context.staleThresholdMs : STALE_THRESHOLD_MS;

  const validation = !SAFETY_ENABLED
    ? { allowed: true, checks: [{ check: 'safety:disabled', passed: true }], reason: null }
    : buildValidation({
        device,
        command,
        state,
        staleThresholdMs,
        category,
        context
      });

  const decision = validation.allowed
    ? (validation.requires_confirmation ? 'pending_confirmation' : 'allowed')
    : 'denied';

  await safetyAuditDb.insert({
    auditId,
    timestamp: new Date().toISOString(),
    deviceId: device.deviceId,
    deviceType: device.deviceType || null,
    protocol: device.protocol || null,
    safetyCategory: category,
    command,
    args,
    source: context.source || 'api',
    userId: context.userId || 'system',
    sessionId: context.sessionId || null,
    stateAtEvaluation: state,
    decision,
    reason: validation.reason || null,
    remediation: validation.remediation || null,
    checksEvaluated: validation.checks || []
  });

  if (!validation.allowed) {
    return {
      allowed: false,
      reason: validation.reason,
      remediation: validation.remediation,
      requires_confirmation: Boolean(validation.requires_confirmation),
      auditId
    };
  }

  let result = null;
  let executionError = null;

  try {
    result = await execute();
  } catch (error) {
    executionError = error;
  }

  if (!executionError) {
    await updateDeviceState(device.deviceId, command, state);
  }

  await safetyAuditDb.update(
    { auditId },
    {
      $set: {
        executionResult: executionError
          ? { ok: false, error: executionError.message || String(executionError) }
          : { ok: true },
        executionAt: new Date().toISOString()
      }
    }
  );

  if (executionError) {
    throw executionError;
  }

  return {
    allowed: true,
    executed: true,
    result,
    auditId
  };
}

export async function getSafetyAuditTail(limit = 25) {
  await ensureIndexes();
  const records = await safetyAuditDb.find({}).sort({ timestamp: -1 }).limit(limit);
  return records;
}
