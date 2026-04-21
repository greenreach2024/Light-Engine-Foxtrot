/**
 * Controller Bindings API (Farm Setup Steps 5-6)
 *
 * Maps grow-system template controller slots to physical device IDs.
 * Provides CRUD for bindings + auto-suggest matching from discovered devices.
 *
 * Phase 4 #22
 */

import fs from 'fs';
import path from 'path';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';

const router = Router();
const DATA_DIR = path.join(process.cwd(), 'public', 'data');
const BINDINGS_PATH = path.join(DATA_DIR, 'controller-bindings.json');

function loadBindings() {
  try {
    if (!fs.existsSync(BINDINGS_PATH)) return { bindings: [] };
    return JSON.parse(fs.readFileSync(BINDINGS_PATH, 'utf-8'));
  } catch { return { bindings: [] }; }
}

function saveBindings(data) {
  data.version = data.version || '1.0.0';
  data.$schema = 'controller-bindings-v1';
  fs.writeFileSync(BINDINGS_PATH, JSON.stringify(data, null, 2));
}

// GET /api/controller-bindings -- list all bindings
router.get('/', (req, res) => {
  const data = loadBindings();
  res.json({ ok: true, count: data.bindings.length, bindings: data.bindings });
});

// POST /api/controller-bindings -- create a binding
router.post('/', (req, res) => {
  const { instanceId, controllerId, channel, controlType, subsystem, templateId, roomId, zoneId, deviceName } = req.body;
  if (!controllerId || !controlType) {
    return res.status(400).json({ ok: false, error: 'controllerId and controlType are required' });
  }

  const data = loadBindings();
  const binding = {
    id: uuidv4().slice(0, 8),
    instanceId: instanceId || null,
    controllerId,
    channel: channel || 0,
    controlType,
    subsystem: subsystem || null,
    templateId: templateId || null,
    roomId: roomId || null,
    zoneId: zoneId || null,
    deviceName: deviceName || null,
    assignedAt: new Date().toISOString()
  };

  data.bindings.push(binding);
  saveBindings(data);
  res.json({ ok: true, binding });
});

// DELETE /api/controller-bindings/:id -- remove a binding
router.delete('/:id', (req, res) => {
  const data = loadBindings();
  const idx = data.bindings.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ ok: false, error: 'binding not found' });
  const removed = data.bindings.splice(idx, 1)[0];
  saveBindings(data);
  res.json({ ok: true, removed });
});

// Does a discovered device match a controller class? Shared between the
// persisted-slot path (preferred) and the template-default fallback.
function deviceMatchesControllerClass(device, controllerClass) {
  const deviceType = (device.type || device.deviceType || '').toLowerCase();
  if (controllerClass === 'switchbot_cloud') {
    return device.protocol === 'switchbot'
      || deviceType.includes('woiosensor')
      || deviceType.includes('hub');
  }
  if (controllerClass === 'smart_plug') {
    return deviceType.includes('plug') || deviceType.includes('relay');
  }
  if (controllerClass === '0_10v') {
    return deviceType.includes('dimmer')
      || deviceType.includes('0-10v')
      || deviceType.includes('0_10v');
  }
  return false;
}

// POST /api/controller-bindings/auto-suggest -- match discovered devices to
// reserved controller slots (preferred) or template default slots (fallback).
router.post('/auto-suggest', (req, res) => {
  try {
    const devicesPath = path.join(DATA_DIR, 'iot-devices.json');
    let devices = [];
    try {
      devices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8'));
      if (!Array.isArray(devices)) devices = [];
    } catch { /* no devices */ }

    // grow-systems.json stores templates in a `templates` array; index by id
    // so downstream lookups (templates[sys.templateId]) work.
    const templatesPath = path.join(DATA_DIR, 'grow-systems.json');
    let templates = {};
    try {
      const raw = JSON.parse(fs.readFileSync(templatesPath, 'utf-8'));
      const list = Array.isArray(raw) ? raw : (Array.isArray(raw?.templates) ? raw.templates : []);
      for (const tmpl of list) {
        if (tmpl && tmpl.id) templates[tmpl.id] = tmpl;
      }
    } catch { /* no templates */ }

    const roomsPath = path.join(DATA_DIR, 'rooms.json');
    let rooms = [];
    try {
      rooms = JSON.parse(fs.readFileSync(roomsPath, 'utf-8'));
      if (!Array.isArray(rooms)) rooms = rooms.rooms || [];
    } catch { /* no rooms */ }

    const existing = loadBindings();
    const boundDeviceIds = new Set(existing.bindings.map(b => b.controllerId));
    // Count bindings per room::zone::subsystem. A room can legitimately have
    // two installed systems sharing the same zone+subsystem (e.g. two rack
    // types each needing a pump controller); each slot record consumes one
    // unit of the count, so a Set would under-report demand.
    const boundSlotCounts = new Map();
    for (const b of existing.bindings) {
      if (!b.roomId || !b.subsystem) continue;
      const k = `${b.roomId}::${b.zoneId || ''}::${b.subsystem}`;
      boundSlotCounts.set(k, (boundSlotCounts.get(k) || 0) + 1);
    }

    const available = devices.filter(d => !boundDeviceIds.has(d.deviceId || d.id));

    // Demand = accepted Room Build Plan's reservedControllerSlots when present;
    // otherwise derive from installedSystems + template.defaultControllerClass.
    const suggestions = [];
    const unmet = [];

    for (const room of rooms) {
      const persistedSlots = Array.isArray(room.buildPlan?.reservedControllerSlots)
        ? room.buildPlan.reservedControllerSlots
        : null;

      const slotRecords = persistedSlots
        ? persistedSlots.map(s => ({
            subsystem: s.subsystem,
            controllerClass: s.controllerClass,
            channelsNeeded: s.channels || 1,
            templateId: s.templateId || null,
            zoneId: s.zoneId || null,
            source: 'persisted'
          }))
        : (room.installedSystems || []).flatMap(sys => {
            const tmpl = templates[sys.templateId];
            if (!tmpl?.defaultControllerClass) return [];
            return Object.entries(tmpl.defaultControllerClass).map(([subsystem, ctrl]) => ({
              subsystem,
              controllerClass: ctrl.type,
              channelsNeeded: ctrl[Object.keys(ctrl).find(k => k.startsWith('channels'))] || 1,
              templateId: sys.templateId,
              zoneId: sys.zoneId || null,
              source: 'template'
            }));
          });

      for (const slot of slotRecords) {
        const slotKey = `${room.id}::${slot.zoneId || ''}::${slot.subsystem}`;
        const remaining = boundSlotCounts.get(slotKey) || 0;
        if (remaining > 0) {
          boundSlotCounts.set(slotKey, remaining - 1);
          continue;
        }

        const matches = available.filter(d => deviceMatchesControllerClass(d, slot.controllerClass));

        if (matches.length > 0) {
          suggestions.push({
            roomId: room.id,
            roomName: room.name,
            templateId: slot.templateId,
            zoneId: slot.zoneId,
            subsystem: slot.subsystem,
            controlType: slot.controllerClass,
            channelsNeeded: slot.channelsNeeded,
            source: slot.source,
            candidateDevices: matches.map(d => ({
              deviceId: d.deviceId || d.id,
              name: d.name || d.deviceId,
              type: d.type || d.deviceType,
              zone: d.zone,
              location: d.location
            }))
          });
        } else {
          unmet.push({
            roomId: room.id,
            roomName: room.name,
            templateId: slot.templateId,
            zoneId: slot.zoneId,
            subsystem: slot.subsystem,
            controlType: slot.controllerClass,
            channelsNeeded: slot.channelsNeeded,
            source: slot.source
          });
        }
      }
    }

    // Also suggest unassigned devices that have zone info but no binding
    const unassignedWithZone = available.filter(d => d.zone != null);

    res.json({
      ok: true,
      suggestions,
      unmet,
      unassignedDevices: unassignedWithZone.map(d => ({
        deviceId: d.deviceId || d.id,
        name: d.name,
        type: d.type || d.deviceType,
        zone: d.zone,
        location: d.location,
        protocol: d.protocol
      })),
      totalAvailable: available.length,
      totalBound: existing.bindings.length,
      totalUnmet: unmet.length
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/controller-bindings/accept-suggestion -- one-click accept a suggestion
router.post('/accept-suggestion', (req, res) => {
  const { deviceId, subsystem, controlType, templateId, roomId, zoneId, channel } = req.body;
  if (!deviceId || !controlType) {
    return res.status(400).json({ ok: false, error: 'deviceId and controlType are required' });
  }

  // Load device info for name
  let deviceName = deviceId;
  try {
    const devicesPath = path.join(DATA_DIR, 'iot-devices.json');
    const devices = JSON.parse(fs.readFileSync(devicesPath, 'utf-8'));
    const dev = devices.find(d => (d.deviceId || d.id) === deviceId);
    if (dev) deviceName = dev.name || deviceId;
  } catch { /* ok */ }

  const data = loadBindings();

  // Check not already bound
  if (data.bindings.some(b => b.controllerId === deviceId)) {
    return res.status(409).json({ ok: false, error: 'Device already bound' });
  }

  const binding = {
    id: uuidv4().slice(0, 8),
    instanceId: `${templateId || 'manual'}-${subsystem || 'general'}`,
    controllerId: deviceId,
    channel: channel || 0,
    controlType,
    subsystem: subsystem || null,
    templateId: templateId || null,
    roomId: roomId || null,
    zoneId: zoneId || null,
    deviceName,
    assignedAt: new Date().toISOString()
  };

  data.bindings.push(binding);
  saveBindings(data);
  res.json({ ok: true, binding });
});

export default router;
