/**
 * Zone-Aware Environment Recommendation Rollup + Confidence Scoring
 * =================================================================
 *
 * Aggregates group-level context (crops, equipment, grow-system templates)
 * to zone level and produces actionable environment recommendations with
 * confidence metadata.
 *
 * Data sources (all LE-local):
 *   - public/data/env-cache.json      -> live sensor readings per zone
 *   - public/data/target-ranges.json  -> target ranges per zone
 *   - public/data/groups.json         -> groups with room/zone/crop/equipment
 *   - public/data/rooms.json          -> room definitions with zone lists
 *
 * Endpoints:
 *   GET  /api/zone-recommendations            -> all zones
 *   GET  /api/zone-recommendations/:zoneId     -> single zone
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'public', 'data');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJSON(filename, fallback = null) {
  try {
    const filePath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Normalize zone identifiers to a common format for cross-store comparison.
 * env-cache uses "zone-1", groups.json uses "room-3xxjln-zZone 1",
 * target-ranges uses "zone-1".
 */
function normalizeZoneId(rawId) {
  if (!rawId) return '';
  // If already in "zone-N" form, return as-is
  if (/^zone-\d+$/i.test(rawId)) return rawId.toLowerCase();
  // Extract "Zone N" from composite IDs like "room-3xxjln-zZone 1"
  const match = rawId.match(/[zZ]one\s*(\d+)/);
  if (match) return `zone-${match[1]}`;
  // Fallback: lowercase the whole thing
  return rawId.toLowerCase();
}

// ---------------------------------------------------------------------------
// Core recommendation engine
// ---------------------------------------------------------------------------

/**
 * Compute a single zone's recommendation with confidence scoring.
 *
 * @param {string} zoneId        - canonical zone ID (e.g. "zone-1")
 * @param {object} envData       - { temperature, humidity, sensor_count, ... }
 * @param {object} targets       - { temp_min, temp_max, rh_min, rh_max, vpd_min, vpd_max, co2_min, co2_max }
 * @param {Array}  groups        - groups assigned to this zone
 * @param {string} roomId        - room ID
 * @param {string} roomName      - room display name
 * @returns {{ zone, readings, targets, drift, status, groups_summary, recommendations, confidence, conflicts }}
 */
function computeZoneRecommendation(zoneId, envData, targets, groups, roomId, roomName) {
  const temp = envData?.temperature ?? null;
  const rh = envData?.humidity ?? null;
  const sensorCount = envData?.sensor_count ?? 0;

  // --- Deviation from targets ---
  const tempMin = targets.temp_min ?? 18;
  const tempMax = targets.temp_max ?? 26;
  const rhMin = targets.rh_min ?? 45;
  const rhMax = targets.rh_max ?? 70;
  const tempMid = (tempMin + tempMax) / 2;
  const rhMid = (rhMin + rhMax) / 2;

  const tempDrift = temp != null ? +(temp - tempMid).toFixed(1) : null;
  const rhDrift = rh != null ? +(rh - rhMid).toFixed(1) : null;
  const tempStatus = temp == null ? 'unknown' : temp < tempMin ? 'low' : temp > tempMax ? 'high' : 'ok';
  const humidityStatus = rh == null ? 'unknown' : rh < rhMin ? 'low' : rh > rhMax ? 'high' : 'ok';

  // --- VPD computation (if we have temp + RH) ---
  let vpd = null;
  let vpdStatus = 'unknown';
  if (temp != null && rh != null) {
    // Tetens formula: SVP = 0.6108 * exp(17.27 * T / (T + 237.3))
    const svp = 0.6108 * Math.exp((17.27 * temp) / (temp + 237.3));
    vpd = +(svp * (1 - rh / 100)).toFixed(2);
    const vpdMin = targets.vpd_min ?? 0.8;
    const vpdMax = targets.vpd_max ?? 1.2;
    vpdStatus = vpd < vpdMin ? 'low' : vpd > vpdMax ? 'high' : 'ok';
  }

  // --- Group context aggregation ---
  const totalGroups = groups.length;
  const croppedGroups = groups.filter(g => g.crop && g.crop !== '');
  const uniqueCrops = [...new Set(croppedGroups.map(g => g.crop))];
  const activeTrayCount = groups.reduce((sum, g) => sum + (g.trays || 0), 0);
  const equipmentTypes = new Set();
  const installedSystems = [];
  for (const g of groups) {
    if (g.lights) {
      for (const l of (Array.isArray(g.lights) ? g.lights : [])) {
        equipmentTypes.add(l.type || l.name || 'light');
      }
    }
    if (g.fans) {
      for (const f of (Array.isArray(g.fans) ? g.fans : [])) {
        equipmentTypes.add(f.type || f.name || 'fan');
      }
    }
    if (g.installedSystems) {
      for (const sys of (Array.isArray(g.installedSystems) ? g.installedSystems : [])) {
        installedSystems.push(sys);
      }
    }
  }

  // --- Conflict detection ---
  // Crops sharing a zone may have conflicting requirements
  // (this is a placeholder for future recipe-based conflict detection)
  const conflicts = [];
  if (uniqueCrops.length > 3) {
    conflicts.push({
      type: 'crop_diversity',
      severity: 'warning',
      message: `${uniqueCrops.length} different crops share this zone. Consider grouping crops with similar environmental needs.`
    });
  }

  // --- Recommendations ---
  const recommendations = [];

  if (tempStatus === 'low') {
    const deficit = +(tempMin - temp).toFixed(1);
    recommendations.push({
      type: 'temperature',
      priority: deficit > 5 ? 'critical' : deficit > 2 ? 'high' : 'medium',
      action: `Increase temperature by ${deficit}C to reach target range ${tempMin}-${tempMax}C`,
      current: temp,
      target: { min: tempMin, max: tempMax },
      deviation: deficit
    });
  } else if (tempStatus === 'high') {
    const excess = +(temp - tempMax).toFixed(1);
    recommendations.push({
      type: 'temperature',
      priority: excess > 5 ? 'critical' : excess > 2 ? 'high' : 'medium',
      action: `Reduce temperature by ${excess}C to reach target range ${tempMin}-${tempMax}C`,
      current: temp,
      target: { min: tempMin, max: tempMax },
      deviation: excess
    });
  }

  if (humidityStatus === 'low') {
    const deficit = +(rhMin - rh).toFixed(1);
    recommendations.push({
      type: 'humidity',
      priority: deficit > 20 ? 'critical' : deficit > 10 ? 'high' : 'medium',
      action: `Raise humidity by ${deficit}% to reach target range ${rhMin}-${rhMax}%`,
      current: rh,
      target: { min: rhMin, max: rhMax },
      deviation: deficit
    });
  } else if (humidityStatus === 'high') {
    const excess = +(rh - rhMax).toFixed(1);
    recommendations.push({
      type: 'humidity',
      priority: excess > 20 ? 'critical' : excess > 10 ? 'high' : 'medium',
      action: `Lower humidity by ${excess}% to reach target range ${rhMin}-${rhMax}%`,
      current: rh,
      target: { min: rhMin, max: rhMax },
      deviation: excess
    });
  }

  if (vpdStatus === 'low') {
    recommendations.push({
      type: 'vpd',
      priority: 'medium',
      action: `VPD is ${vpd} kPa (below ${targets.vpd_min ?? 0.8} kPa). Reduce humidity or raise temperature.`,
      current: vpd,
      target: { min: targets.vpd_min ?? 0.8, max: targets.vpd_max ?? 1.2 }
    });
  } else if (vpdStatus === 'high') {
    recommendations.push({
      type: 'vpd',
      priority: 'medium',
      action: `VPD is ${vpd} kPa (above ${targets.vpd_max ?? 1.2} kPa). Increase humidity or lower temperature.`,
      current: vpd,
      target: { min: targets.vpd_min ?? 0.8, max: targets.vpd_max ?? 1.2 }
    });
  }

  if (sensorCount === 0) {
    recommendations.push({
      type: 'sensor_coverage',
      priority: 'high',
      action: 'No sensors detected in this zone. Install or map SwitchBot sensors for environment monitoring.'
    });
  }

  // --- Confidence scoring ---
  // Confidence = 1.0 minus penalties for missing data
  let confidence = 1.0;
  const gaps = [];

  if (sensorCount === 0) {
    confidence -= 0.40;
    gaps.push('no_sensors');
  } else if (sensorCount < 2) {
    confidence -= 0.10;
    gaps.push('low_sensor_coverage');
  }

  if (temp == null || rh == null) {
    confidence -= 0.25;
    gaps.push('no_readings');
  }

  if (totalGroups === 0) {
    confidence -= 0.10;
    gaps.push('no_groups');
  } else if (croppedGroups.length === 0) {
    confidence -= 0.15;
    gaps.push('no_crops_assigned');
  }

  if (equipmentTypes.size === 0) {
    confidence -= 0.05;
    gaps.push('no_equipment');
  }

  if (targets.temp_min == null && targets.temp_max == null) {
    confidence -= 0.10;
    gaps.push('using_default_targets');
  }

  confidence = Math.max(0, Math.min(1.0, +confidence.toFixed(2)));

  // --- Overall status ---
  const hasCritical = recommendations.some(r => r.priority === 'critical');
  const hasHigh = recommendations.some(r => r.priority === 'high');
  const overallStatus = hasCritical ? 'critical' : hasHigh ? 'attention' : recommendations.length > 0 ? 'advisory' : 'stable';

  return {
    zone_id: zoneId,
    room_id: roomId,
    room_name: roomName,
    overall_status: overallStatus,
    readings: {
      temperature: temp,
      humidity: rh,
      vpd,
      sensor_count: sensorCount
    },
    targets: {
      temp_min: tempMin,
      temp_max: tempMax,
      rh_min: rhMin,
      rh_max: rhMax,
      vpd_min: targets.vpd_min ?? 0.8,
      vpd_max: targets.vpd_max ?? 1.2
    },
    drift: {
      temp_c_from_mid: tempDrift,
      rh_pct_from_mid: rhDrift,
      temp_status: tempStatus,
      humidity_status: humidityStatus,
      vpd_status: vpdStatus
    },
    groups_summary: {
      total_groups: totalGroups,
      cropped_groups: croppedGroups.length,
      unique_crops: uniqueCrops,
      active_trays: activeTrayCount,
      equipment_types: [...equipmentTypes],
      installed_systems: installedSystems.length
    },
    recommendations,
    conflicts,
    confidence: {
      score: confidence,
      gaps,
      level: confidence >= 0.8 ? 'high' : confidence >= 0.5 ? 'medium' : 'low'
    }
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/zone-recommendations
 * Returns recommendations for all zones.
 */
router.get('/', (_req, res) => {
  try {
    const envCache = readJSON('env-cache.json', {});
    const targetRanges = readJSON('target-ranges.json', {});
    const groupsData = readJSON('groups.json', { groups: [] });
    const roomsData = readJSON('rooms.json', { rooms: [] });

    const zt = targetRanges.zones || {};
    const dt = targetRanges.defaults || {};
    const allGroups = groupsData.groups || [];
    const rooms = roomsData.rooms || [];

    // Build zone -> groups map using normalized zone IDs
    const zoneGroupsMap = {};
    for (const g of allGroups) {
      const nzid = normalizeZoneId(g.zoneId || g.zone);
      if (!nzid) continue;
      if (!zoneGroupsMap[nzid]) zoneGroupsMap[nzid] = [];
      zoneGroupsMap[nzid].push(g);
    }

    // Build room ID -> room name map
    const roomNameMap = {};
    for (const r of rooms) {
      roomNameMap[r.id] = r.name || r.id;
    }

    const results = [];

    // Iterate env-cache zones (source of truth for which zones have sensor data)
    for (const [roomId, roomData] of Object.entries(envCache)) {
      if (roomId === 'meta') continue;
      const zoneEntries = roomData?.zones || {};
      const roomName = roomNameMap[roomId] || roomId;

      for (const [zoneId, envData] of Object.entries(zoneEntries)) {
        const nzid = normalizeZoneId(zoneId);
        const targets = zt[zoneId] || zt[nzid] || dt;
        const groups = zoneGroupsMap[nzid] || [];

        results.push(computeZoneRecommendation(nzid, envData, targets, groups, roomId, roomName));
      }
    }

    // Also include zones that have groups but no env data
    for (const [nzid, groups] of Object.entries(zoneGroupsMap)) {
      if (results.some(r => r.zone_id === nzid)) continue;
      const firstGroup = groups[0];
      const roomId = firstGroup?.roomId || '';
      const roomName = roomNameMap[roomId] || firstGroup?.room || roomId;
      const targets = zt[nzid] || dt;
      results.push(computeZoneRecommendation(nzid, null, targets, groups, roomId, roomName));
    }

    // Sort: critical first, then attention, then advisory, then stable
    const statusOrder = { critical: 0, attention: 1, advisory: 2, stable: 3 };
    results.sort((a, b) => (statusOrder[a.overall_status] ?? 9) - (statusOrder[b.overall_status] ?? 9));

    const overallStatus = results.some(r => r.overall_status === 'critical')
      ? 'critical'
      : results.some(r => r.overall_status === 'attention')
        ? 'attention'
        : results.some(r => r.overall_status === 'advisory')
          ? 'advisory'
          : 'stable';

    res.json({
      ok: true,
      overall_status: overallStatus,
      zone_count: results.length,
      updated_at: envCache.meta?.updatedAt || null,
      zones: results
    });
  } catch (err) {
    console.error('[zone-recommendations] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to compute zone recommendations' });
  }
});

/**
 * GET /api/zone-recommendations/:zoneId
 * Returns recommendation for a single zone.
 */
router.get('/:zoneId', (req, res) => {
  try {
    const requestedZone = normalizeZoneId(req.params.zoneId);
    if (!requestedZone) {
      return res.status(400).json({ ok: false, error: 'Invalid zone ID' });
    }

    const envCache = readJSON('env-cache.json', {});
    const targetRanges = readJSON('target-ranges.json', {});
    const groupsData = readJSON('groups.json', { groups: [] });
    const roomsData = readJSON('rooms.json', { rooms: [] });

    const zt = targetRanges.zones || {};
    const dt = targetRanges.defaults || {};
    const allGroups = groupsData.groups || [];
    const rooms = roomsData.rooms || [];

    // Find groups for this zone
    const zoneGroups = allGroups.filter(g => normalizeZoneId(g.zoneId || g.zone) === requestedZone);

    // Build room name map
    const roomNameMap = {};
    for (const r of rooms) {
      roomNameMap[r.id] = r.name || r.id;
    }

    // Find env data for this zone
    let envData = null;
    let roomId = '';
    let roomName = '';
    for (const [rid, roomData] of Object.entries(envCache)) {
      if (rid === 'meta') continue;
      const zoneEntries = roomData?.zones || {};
      for (const [zid, zdata] of Object.entries(zoneEntries)) {
        if (normalizeZoneId(zid) === requestedZone) {
          envData = zdata;
          roomId = rid;
          roomName = roomNameMap[rid] || rid;
          break;
        }
      }
      if (envData) break;
    }

    // Fall back to group data for room info
    if (!roomId && zoneGroups.length > 0) {
      roomId = zoneGroups[0].roomId || '';
      roomName = roomNameMap[roomId] || zoneGroups[0].room || roomId;
    }

    const targets = zt[requestedZone] || zt[req.params.zoneId] || dt;
    const result = computeZoneRecommendation(requestedZone, envData, targets, zoneGroups, roomId, roomName);

    res.json({ ok: true, ...result, updated_at: envCache.meta?.updatedAt || null });
  } catch (err) {
    console.error('[zone-recommendations] Error:', err.message);
    res.status(500).json({ ok: false, error: 'Failed to compute zone recommendation' });
  }
});

export default router;
