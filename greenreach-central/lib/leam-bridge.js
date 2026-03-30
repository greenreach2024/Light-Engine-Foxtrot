/**
 * LEAM Bridge — GreenReach Central
 * ==================================
 * Manages WebSocket connections from LEAM companion agents.
 * Provides a command relay so EVIE tools can dispatch commands
 * to the operator's local machine and receive results.
 *
 * Architecture:
 *   EVIE tool -> leamBridge.sendCommand(farmId, cmd, params)
 *                -> WebSocket -> LEAM on operator's Mac
 *                -> local BLE/WiFi/system scan
 *                -> WebSocket response -> resolve Promise -> EVIE gets results
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

// Active LEAM connections keyed by farmId
const leamClients = new Map(); // farmId -> { ws, capabilities, system, version, lastHeartbeat }

// Pending command responses keyed by request ID
const pendingCommands = new Map(); // id -> { resolve, reject, timer, command, farmId }

const COMMAND_TIMEOUT_MS = 35000; // 35s max per command (BLE scans can take 30s)

/**
 * Register a WebSocket connection as a LEAM client.
 * Called from server.js when a WS message with type='leam_register' arrives.
 */
function registerClient(ws, farmId, registration) {
  const existing = leamClients.get(farmId);
  if (existing && existing.ws !== ws) {
    logger.info(`[LEAM Bridge] Replacing existing LEAM connection for farm ${farmId}`);
  }

  leamClients.set(farmId, {
    ws,
    capabilities: registration.capabilities || [],
    system: registration.system || {},
    version: registration.version || 'unknown',
    lastHeartbeat: Date.now(),
    connectedAt: new Date().toISOString()
  });

  logger.info(`[LEAM Bridge] LEAM client registered for farm ${farmId} (v${registration.version || '?'}, ` +
    `${registration.capabilities?.length || 0} commands, ` +
    `host: ${registration.system?.hostname || 'unknown'})`);

  // Acknowledge registration
  ws.send(JSON.stringify({
    type: 'leam_registered',
    farmId,
    timestamp: new Date().toISOString()
  }));
}

/**
 * Update heartbeat timestamp for a LEAM client.
 */
function handleHeartbeat(farmId) {
  const client = leamClients.get(farmId);
  if (client) {
    client.lastHeartbeat = Date.now();
  }
}

/**
 * Handle a command response from LEAM.
 */
function handleResponse(response) {
  const pending = pendingCommands.get(response.id);
  if (!pending) {
    logger.warn(`[LEAM Bridge] Received response for unknown command ID: ${response.id}`);
    return;
  }

  clearTimeout(pending.timer);
  pendingCommands.delete(response.id);

  if (response.ok) {
    pending.resolve(response);
  } else {
    pending.resolve(response); // Still resolve — let the caller inspect ok=false
  }
}

/**
 * Handle LEAM client disconnect.
 */
function handleDisconnect(farmId, ws) {
  const client = leamClients.get(farmId);
  if (client && client.ws === ws) {
    leamClients.delete(farmId);
    logger.info(`[LEAM Bridge] LEAM client disconnected for farm ${farmId}`);

    // Reject any pending commands for this farm
    for (const [id, pending] of pendingCommands) {
      if (pending.farmId === farmId) {
        clearTimeout(pending.timer);
        pending.resolve({ ok: false, error: 'LEAM client disconnected', command: pending.command });
        pendingCommands.delete(id);
      }
    }
  }
}

/**
 * Send a command to a farm's LEAM client and wait for the response.
 * @param {string} farmId - Target farm ID
 * @param {string} command - LEAM command name (e.g. 'ble_scan', 'scan_all')
 * @param {object} params - Command parameters
 * @returns {Promise<object>} Command result
 */
function sendCommand(farmId, command, params = {}) {
  return new Promise((resolve) => {
    const client = leamClients.get(farmId);
    if (!client) {
      return resolve({
        ok: false,
        error: 'LEAM companion is not connected. Attempting to initialize LEAM automatically.',
        leam_required: true
      });
    }

    if (client.ws.readyState !== 1 /* OPEN */) {
      leamClients.delete(farmId);
      return resolve({
        ok: false,
        error: 'LEAM companion connection went stale. Reconnecting automatically.',
        leam_required: true
      });
    }

    const id = crypto.randomUUID();

    const timer = setTimeout(() => {
      pendingCommands.delete(id);
      resolve({
        ok: false,
        error: `LEAM command '${command}' timed out after ${COMMAND_TIMEOUT_MS / 1000}s`,
        command
      });
    }, COMMAND_TIMEOUT_MS);

    pendingCommands.set(id, { resolve, timer, command, farmId });

    client.ws.send(JSON.stringify({
      type: 'leam_command',
      id,
      command,
      params,
      timestamp: new Date().toISOString()
    }));
  });
}

/**
 * Check if a LEAM client is connected for a given farm.
 */
function isConnected(farmId) {
  const client = leamClients.get(farmId);
  if (!client) return false;
  if (client.ws.readyState !== 1) {
    leamClients.delete(farmId);
    return false;
  }
  // Consider stale if no heartbeat in 90s
  if (Date.now() - client.lastHeartbeat > 90000) {
    logger.warn(`[LEAM Bridge] LEAM client for ${farmId} appears stale (no heartbeat in 90s)`);
    return false;
  }
  return true;
}

/**
 * Get LEAM client status for a farm.
 */
function getClientStatus(farmId) {
  const client = leamClients.get(farmId);
  if (!client) return { connected: false };
  return {
    connected: client.ws.readyState === 1,
    version: client.version,
    capabilities: client.capabilities,
    system: client.system,
    lastHeartbeat: new Date(client.lastHeartbeat).toISOString(),
    connectedAt: client.connectedAt,
    heartbeatAgeMs: Date.now() - client.lastHeartbeat
  };
}

/**
 * Get all connected LEAM clients (admin view).
 */
function getAllClients() {
  const result = {};
  for (const [farmId, client] of leamClients) {
    result[farmId] = {
      version: client.version,
      system: client.system?.hostname || 'unknown',
      capabilities: client.capabilities?.length || 0,
      lastHeartbeat: new Date(client.lastHeartbeat).toISOString(),
      connectedAt: client.connectedAt
    };
  }
  return result;
}

/**
 * Process an incoming WebSocket message that may be LEAM-related.
 * Returns true if the message was handled as a LEAM message.
 */
function processMessage(ws, farmId, data) {
  switch (data.type) {
    case 'leam_register':
      registerClient(ws, farmId, data);
      return true;

    case 'leam_heartbeat':
      handleHeartbeat(farmId);
      return true;

    case 'leam_response':
      handleResponse(data);
      return true;

    default:
      return false; // Not a LEAM message
  }
}

export default {
  registerClient,
  handleHeartbeat,
  handleResponse,
  handleDisconnect,
  sendCommand,
  isConnected,
  getClientStatus,
  getAllClients,
  processMessage
};
