/**
 * Device-to-Group Auto-Assignment Suggester — AI Vision Phase 2, T19
 *
 * Analyzes discovered devices and suggests group assignments based on:
 *   1. Controller topology (GROW3 device-to-zone mappings)
 *   2. Room/zone name affinity (device name patterns)
 *   3. Protocol matching (device protocol vs group light protocols)
 *   4. Network proximity (IP subnet matching)
 *
 * Rule 8.1 compliance: suggestions only — never auto-writes to groups.json.
 * Grower must approve each assignment via the approve endpoint.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PENDING_FILE = path.join(__dirname, '..', 'public', 'data', 'pending-assignments.json');
const GROUPS_FILE = path.join(__dirname, '..', 'public', 'data', 'groups.json');
const CONFIDENCE_THRESHOLD = 0.3;

/**
 * Load current groups from groups.json
 */
function loadGroups() {
  try {
    const raw = fs.readFileSync(GROUPS_FILE, 'utf8');
    const data = JSON.parse(raw);
    // groups.json can be an array or { groups: [...] }
    return Array.isArray(data) ? data : (data.groups || []);
  } catch {
    return [];
  }
}

/**
 * Load pending assignments from disk
 */
function loadPending() {
  try {
    const raw = fs.readFileSync(PENDING_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { suggestions: [], updatedAt: null };
  }
}

/**
 * Save pending assignments to disk
 */
function savePending(data) {
  data.updatedAt = new Date().toISOString();
  fs.writeFileSync(PENDING_FILE, JSON.stringify(data, null, 2));
}

/**
 * Extract known device IPs from groups
 */
function getKnownDeviceIPs(groups) {
  const ips = new Set();
  for (const g of groups) {
    const devices = g.lights || g.members || g.devices || [];
    for (const d of devices) {
      if (d.ip) ips.add(d.ip);
      if (d.host) ips.add(d.host);
    }
    if (g.controller?.ip) ips.add(g.controller.ip);
    if (g.iotDevice?.ip) ips.add(g.iotDevice.ip);
  }
  return ips;
}

/**
 * Get the subnet prefix (first 3 octets) from an IP
 */
function getSubnet(ip) {
  if (!ip) return '';
  const parts = ip.split('.');
  return parts.length >= 3 ? parts.slice(0, 3).join('.') : '';
}

/**
 * Compute a match score between a discovered device and a group
 * Returns { score: 0-1, reasons: string[] }
 */
function computeMatchScore(device, group) {
  let score = 0;
  const reasons = [];

  // 1. Controller topology: same controller IP
  if (group.controller?.ip && device.ip) {
    const groupSubnet = getSubnet(group.controller.ip);
    const deviceSubnet = getSubnet(device.ip);
    if (groupSubnet && groupSubnet === deviceSubnet) {
      score += 0.25;
      reasons.push('Same subnet as group controller');
    }
  }

  // 2. Room/zone name affinity
  const deviceName = (device.info?.name || device.alias || '').toLowerCase();
  const groupRoom = (group.room || '').toLowerCase();
  const groupZone = (group.zone || '').toLowerCase();
  const groupName = (group.name || '').toLowerCase();

  if (deviceName) {
    if (groupRoom && deviceName.includes(groupRoom)) {
      score += 0.3;
      reasons.push(`Device name matches room "${group.room}"`);
    }
    if (groupZone && deviceName.includes(groupZone)) {
      score += 0.25;
      reasons.push(`Device name matches zone "${group.zone}"`);
    }
    if (groupName && deviceName.includes(groupName)) {
      score += 0.2;
      reasons.push(`Device name matches group "${group.name}"`);
    }
  }

  // 3. Protocol matching
  const groupLights = group.lights || [];
  const groupProtocols = groupLights.map(l => (l.control || l.protocol || '').toLowerCase());
  const deviceProtocol = (device.protocol || '').toLowerCase();

  if (deviceProtocol && groupProtocols.length > 0) {
    // Protocol name normalization
    const protoMap = { 'grow3': 'grow3', '0-10v': 'analog', 'dmx': 'dmx', 'dmx512': 'dmx', 'http': 'http' };
    const normDevice = protoMap[deviceProtocol] || deviceProtocol;
    const normGroup = groupProtocols.map(p => protoMap[p] || p);
    if (normGroup.includes(normDevice)) {
      score += 0.15;
      reasons.push(`Protocol "${deviceProtocol}" matches group lights`);
    }
  }

  // 4. Network proximity — same /24 subnet as any existing group device
  const existingDevices = groupLights.filter(d => d.ip || d.host);
  for (const ed of existingDevices) {
    const edSubnet = getSubnet(ed.ip || ed.host);
    const devSubnet = getSubnet(device.ip);
    if (edSubnet && devSubnet && edSubnet === devSubnet) {
      score += 0.10;
      reasons.push('Same subnet as existing group devices');
      break;
    }
  }

  // 5. Empty group bonus — groups with no lights are high-priority targets
  if (groupLights.length === 0 && group.active !== false) {
    score += 0.05;
    reasons.push('Group has no lights assigned');
  }

  return { score: Math.min(score, 1.0), reasons };
}

/**
 * Generate assignment suggestions for discovered devices
 * @param {Array} discoveredDevices — from DeviceDiscovery.discoverDevices().devices
 * @returns {{ suggestions: Array, summary: Object }}
 */
export function suggestAssignments(discoveredDevices) {
  const groups = loadGroups();
  const knownIPs = getKnownDeviceIPs(groups);

  // Filter to only new (unassigned) devices
  const newDevices = discoveredDevices.filter(d =>
    d.ip && !knownIPs.has(d.ip) && d.type === 'light_controller'
  );

  const suggestions = [];

  for (const device of newDevices) {
    // Score against all active groups
    const matches = groups
      .filter(g => g.active !== false)
      .map(g => {
        const { score, reasons } = computeMatchScore(device, g);
        return { groupId: g.id, groupName: g.name || g.id, score, reasons };
      })
      .filter(m => m.score >= CONFIDENCE_THRESHOLD)
      .sort((a, b) => b.score - a.score);

    const bestMatch = matches[0] || null;

    suggestions.push({
      deviceId: device.ip, // IP as device identifier for non-Kasa devices
      device: {
        ip: device.ip,
        protocol: device.protocol,
        manufacturer: device.manufacturer,
        model: device.info?.model || 'Unknown',
        name: device.info?.name || device.alias || `Device at ${device.ip}`,
        confidence: device.confidence,
        channels: device.info?.channels
      },
      suggestedGroupId: bestMatch?.groupId || null,
      suggestedGroupName: bestMatch?.groupName || null,
      matchConfidence: bestMatch?.score || 0,
      reason: bestMatch?.reasons?.join('; ') || 'No matching group found',
      alternativeGroups: matches.slice(1, 4).map(m => ({
        id: m.groupId,
        name: m.groupName,
        confidence: m.score,
        reason: m.reasons.join('; ')
      })),
      status: 'pending',
      discoveredAt: new Date().toISOString()
    });
  }

  const result = {
    suggestions,
    summary: {
      totalDiscovered: discoveredDevices.length,
      newDevices: newDevices.length,
      suggestionsGenerated: suggestions.filter(s => s.suggestedGroupId).length,
      unmatched: suggestions.filter(s => !s.suggestedGroupId).length
    }
  };

  // Persist pending suggestions
  savePending(result);

  return result;
}

/**
 * Get current pending assignment suggestions
 */
export function getPendingAssignments() {
  return loadPending();
}

/**
 * Approve one or more assignment suggestions.
 * Writes the device into the group's lights/members/devices arrays in groups.json.
 * @param {Array<{ deviceId: string, groupId: string }>} assignments
 * @returns {{ approved: number, errors: string[] }}
 */
export function approveAssignments(assignments) {
  const pending = loadPending();
  const groups = loadGroups();
  let approved = 0;
  const errors = [];
  const decisions = [];

  for (const { deviceId, groupId } of assignments) {
    // Find the pending suggestion
    const suggestion = pending.suggestions.find(s => s.deviceId === deviceId && s.status === 'pending');
    if (!suggestion) {
      errors.push(`No pending suggestion for device ${deviceId}`);
      continue;
    }

    // Find the target group
    const group = groups.find(g => g.id === groupId);
    if (!group) {
      errors.push(`Group ${groupId} not found`);
      continue;
    }

    // Add device to group's lights array
    if (!group.lights) group.lights = [];
    const newLight = {
      id: `auto-${suggestion.device.protocol}-${suggestion.device.ip.replace(/\./g, '-')}`,
      name: suggestion.device.name,
      vendor: suggestion.device.manufacturer,
      ip: suggestion.device.ip,
      protocol: suggestion.device.protocol,
      model: suggestion.device.model,
      channels: suggestion.device.channels,
      autoAssigned: true,
      assignedAt: new Date().toISOString()
    };
    group.lights.push(newLight);

    // Keep members/devices in sync
    if (!group.members) group.members = [];
    group.members.push({ id: newLight.id });
    if (!group.devices) group.devices = [];
    group.devices.push(newLight);
    group.deviceCount = group.lights.length;

    suggestion.status = 'accepted';
    approved++;

    decisions.push({
      deviceId,
      groupId,
      decision: 'accepted',
      confidence: suggestion.matchConfidence,
      timestamp: new Date().toISOString()
    });
  }

  // Save updated groups
  if (approved > 0) {
    try {
      // Read raw to preserve structure
      const raw = fs.readFileSync(GROUPS_FILE, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        fs.writeFileSync(GROUPS_FILE, JSON.stringify(groups, null, 2));
      } else {
        data.groups = groups;
        fs.writeFileSync(GROUPS_FILE, JSON.stringify(data, null, 2));
      }
    } catch (err) {
      errors.push(`Failed to write groups.json: ${err.message}`);
    }
  }

  // Update pending file
  savePending(pending);

  // Log decisions for future ML training (Rule 8.1 training signal)
  logDecisions(decisions);

  return { approved, errors };
}

/**
 * Dismiss one or more assignment suggestions.
 * @param {Array<{ deviceId: string, reason?: string }>} dismissals
 * @returns {{ dismissed: number }}
 */
export function dismissAssignments(dismissals) {
  const pending = loadPending();
  let dismissed = 0;
  const decisions = [];

  for (const { deviceId, reason } of dismissals) {
    const suggestion = pending.suggestions.find(s => s.deviceId === deviceId && s.status === 'pending');
    if (suggestion) {
      suggestion.status = 'dismissed';
      suggestion.dismissReason = reason || 'Grower dismissed';
      dismissed++;
      decisions.push({
        deviceId,
        suggestedGroupId: suggestion.suggestedGroupId,
        decision: 'dismissed',
        reason: reason || 'Grower dismissed',
        confidence: suggestion.matchConfidence,
        timestamp: new Date().toISOString()
      });
    }
  }

  savePending(pending);
  logDecisions(decisions);

  return { dismissed };
}

/**
 * Log assignment decisions for future ML training (Rule 8.1 training signal)
 */
function logDecisions(decisions) {
  if (decisions.length === 0) return;
  const logFile = path.join(__dirname, '..', 'public', 'data', 'assignment-decisions.json');
  try {
    let existing = [];
    try {
      existing = JSON.parse(fs.readFileSync(logFile, 'utf8'));
    } catch { /* first time */ }
    existing.push(...decisions);
    // Keep last 500 decisions
    if (existing.length > 500) existing = existing.slice(-500);
    fs.writeFileSync(logFile, JSON.stringify(existing, null, 2));
  } catch (err) {
    console.error('[DeviceGroupSuggester] Failed to log decisions:', err.message);
  }
}
