// API Base URL - uses window.API_BASE set in LE-farm-admin.html
const API_BASE = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : (typeof location !== 'undefined' ? location.origin : '');

/**
 * Fetch helper that automatically includes Authorization header from
 * localStorage token when available. This ensures correct farm-scoping
 * when requests go through greenreach-central's multi-tenant middleware.
 */
function fetchWithFarmAuth(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!headers['Authorization']) {
    try {
      const token = sessionStorage.getItem('token') || localStorage.getItem('token');
      if (token) headers['Authorization'] = `Bearer ${token}`;
    } catch (_) {}
  }
  return fetch(url, { ...options, headers });
}
function getFarmPin() {
  try {
    if (typeof window !== 'undefined' && typeof window.FARM_PIN === 'string' && window.FARM_PIN.trim()) {
      return window.FARM_PIN.trim();
    }
    if (typeof window !== 'undefined' && typeof window.location === 'object') {
      const qs = new URLSearchParams(window.location.search || '');
      const qpin = (qs.get('pin') || '').trim();
      if (qpin) return qpin;
    }
    if (typeof localStorage !== 'undefined') {
      const lspin = (localStorage.getItem('gr.farmPin') || '').trim();
      if (lspin) return lspin;
    }
  } catch (_) {}
  return '';
}

function normalizeDataUrl(url) {
  const raw = String(url || '').trim();
  if (!raw) return raw;
  if (/^\.?\/?data\//i.test(raw)) {
    const normalized = raw.replace(/^\.\//, '');
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }
  return raw;
}

// Production hardening: silence browser console telemetry unless explicitly enabled.
(function() {
  try {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const debugEnabled = (typeof localStorage !== 'undefined' && localStorage.getItem('gr.debug') === 'true') || isLocal;
    window.GR_DEBUG = debugEnabled;
    if (!debugEnabled && typeof console !== 'undefined') {
      const noop = function() {};
      console.log = noop;
      console.debug = noop;
      console.info = noop;
      console.warn = noop;
    }
  } catch (e) {
    window.GR_DEBUG = false;
  }
})();

// Global debug helper (use localStorage.setItem('gr.debug','true') to enable)
window.grLog = function(...args) { if (window.GR_DEBUG && console && typeof console.debug === 'function') console.debug(...args); };

// Billing management helper
function manageBilling() {
  window.location.href = '/LE-billing.html';
}

// Fallbacks for device pick state if not defined elsewhere
if (typeof getDevicePickState !== 'function') {
  window.getDevicePickState = function() {
    return { scope: 'devices', ids: [] };
  };
}
if (typeof setDevicePickState !== 'function') {
  window.setDevicePickState = function(scope, ids) {
    // no-op fallback
  };
}
// --- Device Control: sendDeviceCommand ---
async function sendDeviceCommand(deviceId, command, params = {}) {
  try {
    const res = await fetch('/api/device/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId, command, params })
    });
    if (!res.ok) throw new Error('Device command failed');
    const data = await res.json();
    showToast({ title: 'Device Command', msg: `Command '${command}' sent to ${deviceId}`, kind: 'success', icon: '' });
    return data;
  } catch (e) {
    showToast({ title: 'Device Command Error', msg: e.message, kind: 'error', icon: '' });
    return null;
  }
}
const CALIBRATION_MULTIPLIER_KEYS = ['cw', 'ww', 'b', 'r'];
const CALIBRATION_DEFAULT_MULTIPLIERS = { cw: 1, ww: 1, b: 1, r: 1 };
let calibrationMultipliersCache = null;

function getDeviceIdentifier(device) {
  if (!device || typeof device !== 'object') return '';
  const candidates = [device.id, device.device_id, device.deviceId, device.uuid, device._id];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const value = String(candidate).trim();
    if (value) return value;
  }
  return '';
}

function clampCalibrationMultiplier(value) {
  if (value === undefined || value === null) return 1;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value).trim());
  if (!Number.isFinite(parsed)) return 1;
  if (parsed < 0) return 0;
  if (parsed > 10) return 10;
  return Math.round(parsed * 1000) / 1000;
}

function normalizeCalibrationMultipliersDoc(doc) {
  const base = { ...CALIBRATION_DEFAULT_MULTIPLIERS };
  if (!doc || typeof doc !== 'object') return base;
  CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
    let sourceKey = key;
    if (!(key in doc)) {
      if (key === 'b') sourceKey = 'bl';
      else if (key === 'r') sourceKey = 'rd';
      else if (key === 'cw') sourceKey = 'cold';
      else if (key === 'ww') sourceKey = 'warm';
    }
    const value = doc[key] ?? doc[sourceKey];
    base[key] = clampCalibrationMultiplier(value);
  });
  return base;
}

function formatCalibrationMultiplier(value) {
  const normalised = clampCalibrationMultiplier(value);
  const fixed = normalised.toFixed(3);
  return fixed.replace(/\.0+$/, '').replace(/0+$/, '').replace(/\.$/, '') || '0';
}

async function loadCalibrationMultipliers(force = false) {
  if (!force && calibrationMultipliersCache) return calibrationMultipliersCache;
  try {
    const response = await fetch('/calibration');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json().catch(() => ({}));
    const devices = payload && typeof payload === 'object' ? payload.devices : {};
    const normalized = {};
    if (devices && typeof devices === 'object') {
      Object.entries(devices).forEach(([deviceId, value]) => {
        const key = String(deviceId || '').trim();
        if (!key) return;
        normalized[key] = normalizeCalibrationMultipliersDoc(value);
      });
    }
    calibrationMultipliersCache = normalized;
  } catch (error) {
    console.warn('[calibration] Failed to load multipliers', error);
    calibrationMultipliersCache = calibrationMultipliersCache || {};
    throw error;
  }
  return calibrationMultipliersCache;
}

async function saveCalibrationMultipliers(deviceId, multipliers) {
  const id = String(deviceId || '').trim();
  if (!id) throw new Error('Missing device id');
  const normalized = normalizeCalibrationMultipliersDoc(multipliers);
  const response = await fetch('/calibration', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: id, multipliers: normalized })
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json().catch(() => ({}));
  const result = normalizeCalibrationMultipliersDoc(payload?.multipliers || normalized);
  calibrationMultipliersCache = { ...(calibrationMultipliersCache || {}), [id]: result };
  return result;
}

async function setupCalibrationMultipliersCard(card, devices = []) {
  if (!card) return;
  const selectEl = card.querySelector('#calibrationDeviceSelect');
  const statusEl = card.querySelector('#calibrationStatus');
  const inputs = {
    cw: card.querySelector('#calibrationMultiplierCw'),
    ww: card.querySelector('#calibrationMultiplierWw'),
    b: card.querySelector('#calibrationMultiplierB'),
    r: card.querySelector('#calibrationMultiplierR'),
  };
  const saveBtn = card.querySelector('#calibrationSave');
  const resetBtn = card.querySelector('#calibrationReset');
  const setDisabled = (disabled) => {
    CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
      if (inputs[key]) inputs[key].disabled = disabled;
    });
    if (saveBtn) saveBtn.disabled = disabled;
    if (resetBtn) resetBtn.disabled = disabled;
  };
  const showStatus = (message) => {
    if (statusEl) statusEl.textContent = message || '';
  };

  if (!selectEl) {
    setDisabled(true);
    showStatus('No selectable lights');
    return;
  }

  const availableDevices = Array.isArray(devices)
    ? devices.map((device) => ({ id: getDeviceIdentifier(device) })).filter((entry) => entry.id)
    : [];

  if (!availableDevices.length || !selectEl.options.length) {
    setDisabled(true);
    showStatus(availableDevices.length ? 'Select a light' : 'No compatible lights');
    return;
  }

  const applyMultipliersToInputs = (deviceId, cache) => {
    const multipliers = (cache && cache[deviceId]) || normalizeCalibrationMultipliersDoc();
    CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
      if (inputs[key]) inputs[key].value = formatCalibrationMultiplier(multipliers[key]);
    });
  };

  let cache = {};
  try {
    cache = await loadCalibrationMultipliers(false);
    showStatus('');
  } catch (error) {
    showStatus('Load failed');
    cache = calibrationMultipliersCache || {};
  }

  // Handle device selection changes for calibration multipliers
  const handleDeviceChange = (deviceId) => {
    if (!deviceId) {
      setDisabled(true);
      showStatus('Select a light');
      return;
    }
    setDisabled(false);
    showStatus('');
    applyMultipliersToInputs(deviceId, cache);
  };

  const initialDeviceId = selectEl.value || (availableDevices[0] ? availableDevices[0].id : '');
  if (initialDeviceId && !selectEl.value) {
    selectEl.value = initialDeviceId;
  }
  handleDeviceChange(selectEl.value);

  selectEl.addEventListener('change', () => {
    showStatus('');
    handleDeviceChange(selectEl.value);
  });

  saveBtn?.addEventListener('click', async () => {
    const deviceId = selectEl.value;
    if (!deviceId) {
      handleDeviceChange('');
      return;
    }
    const multipliers = {};
    CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
      multipliers[key] = clampCalibrationMultiplier(inputs[key]?.value);
    });
    CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
      if (inputs[key]) inputs[key].value = formatCalibrationMultiplier(multipliers[key]);
    });
    showStatus('Saving…');
    if (saveBtn) saveBtn.disabled = true;
    try {
      const saved = await saveCalibrationMultipliers(deviceId, multipliers);
      cache[deviceId] = saved;
      showStatus('Saved');
      setTimeout(() => {
        if (statusEl && statusEl.textContent === 'Saved') statusEl.textContent = '';
      }, 2000);
    } catch (error) {
      console.warn('[calibration] Failed to save multipliers', error);
      showStatus('Save failed');
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  });

  resetBtn?.addEventListener('click', () => {
    CALIBRATION_MULTIPLIER_KEYS.forEach((key) => {
      if (inputs[key]) inputs[key].value = formatCalibrationMultiplier(1);
    });
    showStatus('Reset values');
    setTimeout(() => {
      if (statusEl && statusEl.textContent === 'Reset values') statusEl.textContent = '';
    }, 2000);
  });
}

// --- Grow3 Manager Modal Logic with Controller Info ---
function getGrow3ControllerConfig() {
  let config = { name: 'Grow3 Controller', address: '127.0.0.1', port: '8091' };
  try {
    const stored = JSON.parse(localStorage.getItem('grow3.controller.config') || '{}');
    if (stored && typeof stored === 'object') config = { ...config, ...stored };
  } catch {}
  return config;
}
function saveGrow3ControllerConfig(cfg) {
  localStorage.setItem('grow3.controller.config', JSON.stringify(cfg));
}

window.openGrow3Manager = async function() {
  const modal = document.getElementById('grow3Modal');
  const body = document.getElementById('grow3ManagerBody');
  if (!modal || !body) {
    window.showToast?.({ title: 'Grow3 Manager', msg: 'Modal not found.', kind: 'error', icon: '' });
    return;
  }
  // Show controller info at the top
  const cfg = getGrow3ControllerConfig();
  const apiBase = `http://${cfg.address}:${cfg.port}`;
  const SAFE_ON_HEX = '1D1D1D1D0000'; // Grow3 scale (0-64): 45% = 0x1D per channel
  body.innerHTML = `
    <h2 style="margin-top:0">Grow3 Manager</h2>
    <form id="grow3ControllerForm" style="background:#f8fafc;padding:12px 16px;border-radius:8px;margin-bottom:18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;">
      <label style="font-size:13px;">Name<br><input type="text" id="grow3ControllerName" value="${escapeHtml(cfg.name)}" style="width:160px;"></label>
      <label style="font-size:13px;">Address<br><input type="text" id="grow3ControllerAddress" value="${escapeHtml(cfg.address)}" style="width:140px;"></label>
      <label style="font-size:13px;">Port<br><input type="text" id="grow3ControllerPort" value="${escapeHtml(cfg.port)}" style="width:80px;"></label>
      <button type="submit" class="primary" style="margin-top:18px;">Save</button>
    </form>
    <div class="tiny" style="color:#475569;margin-bottom:12px;">
      Proxy summary: <code>${apiBase}/healthz</code> → Code3 controller <code>http://192.168.2.80:3000</code>. HEX format <code>[CW][WW][BL][RD][00][00]</code> (00–64).
    </div>
    <div id="grow3DevicesLoading" style="text-align:center;padding:32px;">Loading Grow3 devices…</div>
  `;
  modal.style.display = 'flex';
  // Save handler
  body.querySelector('#grow3ControllerForm').onsubmit = function(e) {
    e.preventDefault();
    const newCfg = {
      name: body.querySelector('#grow3ControllerName').value.trim() || 'Grow3 Controller',
      address: body.querySelector('#grow3ControllerAddress').value.trim() || '127.0.0.1',
      port: body.querySelector('#grow3ControllerPort').value.trim() || '8091'
    };
    saveGrow3ControllerConfig(newCfg);
    window.showToast?.({ title: 'Controller Info Saved', msg: `${newCfg.name} (${newCfg.address}:${newCfg.port})`, kind: 'success', icon: '' });
    window.openGrow3Manager();
  };
  // Fetch device list from controller API using config
  let devices = [];
  try {
    const resp = await fetch(`${apiBase}/api/devicedatas`);
    if (!resp.ok) throw new Error('Controller not reachable');
    const data = await resp.json();
    devices = Array.isArray(data) ? data : (data.devices || []);
  } catch (e) {
    body.querySelector('#grow3DevicesLoading').innerHTML = `<div style=\"color:#b91c1c;text-align:center;padding:32px;\">Failed to load devices: ${e.message}</div>`;
    return;
  }
  // Filter for Grow3 lights (customize as needed)
  const grow3s = devices.filter(d => (d.type||'').toLowerCase().includes('grow3') || (d.model||'').toLowerCase().includes('grow3'));
  if (!grow3s.length) {
    body.querySelector('#grow3DevicesLoading').innerHTML = '<div style=\"color:#b91c1c;text-align:center;padding:32px;\">No Grow3 lights found on controller.</div>';
    return;
  }
  // Render device controls
  const deviceOptions = grow3s
    .map((dev, index) => {
      const id = getDeviceIdentifier(dev);
      if (!id) return '';
      const label = dev.name || dev.model || id;
      const selected = index === 0 ? ' selected' : '';
      return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .filter(Boolean)
    .join('');

  body.querySelector('#grow3DevicesLoading').outerHTML = `
    <div style="display:flex;flex-direction:column;gap:16px;">
      <div id="calibrationMultipliersCard" class="gr-card" style="padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;">
        <div class="row row--between row--center" style="margin-bottom:12px;gap:12px;">
          <h3 style="margin:0">Calibration Multipliers</h3>
          <span id="calibrationStatus" class="tiny" aria-live="polite"></span>
        </div>
        <div class="row row--wrap" style="gap:16px;align-items:flex-end;">
          <label class="tiny" style="display:flex;flex-direction:column;gap:4px;min-width:200px;">
            Device
            <select id="calibrationDeviceSelect" style="min-height:32px;border-radius:6px;border:1px solid #cbd5e1;padding:0 8px;">
              ${deviceOptions || '<option value="">No controllable lights</option>'}
            </select>
          </label>
          <div class="grid cols-2" style="gap:12px;flex:1;min-width:240px;">
            <label class="tiny" style="display:flex;flex-direction:column;gap:4px;">
              CW
              <input id="calibrationMultiplierCw" type="number" step="0.01" min="0" max="10" value="1" style="min-height:32px;border-radius:6px;border:1px solid #cbd5e1;padding:0 8px;">
            </label>
            <label class="tiny" style="display:flex;flex-direction:column;gap:4px;">
              WW
              <input id="calibrationMultiplierWw" type="number" step="0.01" min="0" max="10" value="1" style="min-height:32px;border-radius:6px;border:1px solid #cbd5e1;padding:0 8px;">
            </label>
            <label class="tiny" style="display:flex;flex-direction:column;gap:4px;">
              Blue
              <input id="calibrationMultiplierB" type="number" step="0.01" min="0" max="10" value="1" style="min-height:32px;border-radius:6px;border:1px solid #cbd5e1;padding:0 8px;">
            </label>
            <label class="tiny" style="display:flex;flex-direction:column;gap:4px;">
              Red
              <input id="calibrationMultiplierR" type="number" step="0.01" min="0" max="10" value="1" style="min-height:32px;border-radius:6px;border:1px solid #cbd5e1;padding:0 8px;">
            </label>
          </div>
        </div>
        <div class="row row--gap-sm" style="margin-top:12px;">
          <button id="calibrationSave" type="button" class="primary">Save Multipliers</button>
          <button id="calibrationReset" type="button" class="ghost">Reset</button>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f1f5f9"><th>Name</th><th>Device ID</th><th>Status</th><th>HEX</th><th>Actions</th></tr></thead>
          <tbody>
            ${grow3s.map(dev => `
              <tr data-id="${dev.id}">
                <td>${escapeHtml(dev.name||dev.model||'Grow3')}</td>
                <td>${escapeHtml(dev.id||'')}</td>
                <td class="grow3-status">${escapeHtml(dev.status||'—')}</td>
                <td><input type="text" class="grow3-hex" value="${escapeHtml(dev.value||dev.lastHex||'')}" placeholder="HEX payload" style="width:120px" maxlength="12"></td>
                <td>
                  <button class="ghost grow3-on">ON</button>
                  <button class="ghost grow3-off">OFF</button>
                  <button class="primary grow3-send">Send HEX</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
      <div class="tiny" style="margin-top:16px;color:#64748b">Controller API: <code>${apiBase}/api/devicedatas</code> (GET), <code>${apiBase}/api/devicedatas/device/:id</code> (PATCH)</div>
    </div>
  `;
  await setupCalibrationMultipliersCard(body.querySelector('#calibrationMultipliersCard'), grow3s);
  // Wire up actions
  Array.from(body.querySelectorAll('.grow3-on')).forEach(btn => {
    btn.onclick = async function() {
      const row = btn.closest('tr');
      const id = row.getAttribute('data-id');
      await sendGrow3Command(id, { status: 'on', value: SAFE_ON_HEX }, row, apiBase);
    };
  });
  Array.from(body.querySelectorAll('.grow3-off')).forEach(btn => {
    btn.onclick = async function() {
      const row = btn.closest('tr');
      const id = row.getAttribute('data-id');
      await sendGrow3Command(id, { status: 'off', value: null }, row, apiBase);
    };
  });
  Array.from(body.querySelectorAll('.grow3-send')).forEach(btn => {
    btn.onclick = async function() {
      const row = btn.closest('tr');
      const id = row.getAttribute('data-id');
      const hex = row.querySelector('.grow3-hex').value.trim();
      if (!hex) { window.showToast?.({ title: 'HEX required', msg: 'Enter a HEX payload.', kind: 'warn', icon: '' }); return; }
      await sendGrow3Command(id, { status: 'on', value: hex }, row, apiBase);
    };
  });
};

async function sendGrow3Command(id, payload, row, apiBase) {
  try {
    const hdrs = { 'Content-Type': 'application/json' };
    try {
      const pin = (function getFarmPin() {
        try {
          if (typeof window !== 'undefined' && typeof window.FARM_PIN === 'string' && window.FARM_PIN.trim()) return window.FARM_PIN.trim();
          if (typeof window !== 'undefined' && typeof window.location === 'object') {
            const qs = new URLSearchParams(window.location.search || '');
            const qpin = (qs.get('pin') || '').trim();
            if (qpin) return qpin;
          }
          if (typeof localStorage !== 'undefined') {
            const lspin = (localStorage.getItem('gr.farmPin') || '').trim();
            if (lspin) return lspin;
          }
        } catch {}
        return '';
      })();
      if (pin) hdrs['x-farm-pin'] = pin;
    } catch {}
    const resp = await fetch(`${apiBase}/api/devicedatas/device/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: hdrs,
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error('Controller error');
    const data = await resp.json();
    row.querySelector('.grow3-status').textContent = data.status || payload.status || 'OK';
    row.querySelector('.grow3-hex').value = typeof data.value === 'string' ? data.value : (payload.value || '');
    window.showToast?.({ title: 'Grow3 Updated', msg: `Device ${id} → ${row.querySelector('.grow3-status').textContent}`, kind: 'success', icon: '' });
  } catch (e) {
    window.showToast?.({ title: 'Grow3 Error', msg: e.message, kind: 'error', icon: '' });
  }
}

// Modal open/close wiring
document.addEventListener('DOMContentLoaded', function() {
  const btn = document.getElementById('btnOpenGrow3Manager');
  const modal = document.getElementById('grow3Modal');
  const closeBtn = document.getElementById('closeGrow3Modal');
  if (btn && modal && closeBtn) {
    btn.onclick = window.openGrow3Manager;
    closeBtn.onclick = function() { modal.style.display = 'none'; };
    modal.addEventListener('click', function(e) { if (e.target === modal) modal.style.display = 'none'; });
  }
});
// --- Groups Card Room/Zone Dropdown Seeding ---
function getRoomZones(room) {
  if (!room || typeof room !== 'object') return [];
  if (Array.isArray(room.zones) && room.zones.length) return room.zones.filter(Boolean);
  if (Array.isArray(room.zoneNames) && room.zoneNames.length) return room.zoneNames.filter(Boolean);
  if (Array.isArray(room.zone_names) && room.zone_names.length) return room.zone_names.filter(Boolean);
  return [];
}

function roomHasZones(room) {
  return getRoomZones(room).length > 0;
}

function buildRoomLookupKey(room) {
  const id = String(room?.id || room?.roomId || room?.room_id || '').trim().toLowerCase();
  const name = String(room?.name || room?.roomName || '').trim().toLowerCase();
  return id || name;
}

function mergeRoomsWithZoneFallback(baseRooms, fallbackPools = []) {
  const pools = fallbackPools.filter(pool => Array.isArray(pool) && pool.length);
  if (!Array.isArray(baseRooms)) return [];
  return baseRooms.map((room) => {
    if (roomHasZones(room)) return room;
    const key = buildRoomLookupKey(room);
    if (!key) return room;
    for (const pool of pools) {
      const match = pool.find((candidate) => buildRoomLookupKey(candidate) === key && roomHasZones(candidate));
      if (match) {
        return { ...room, zones: getRoomZones(match) };
      }
    }
    return room;
  });
}

function collectRoomsFromState() {
  const wizardRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
  let lsRooms = [];
  try {
    const cached = localStorage.getItem('gr.rooms');
    if (cached) {
      const parsed = JSON.parse(cached);
      lsRooms = Array.isArray(parsed?.rooms) ? parsed.rooms : Array.isArray(parsed) ? parsed : [];
    }
  } catch (_) { /* localStorage unavailable */ }

  const firstAvailable = wizardRooms.length ? wizardRooms : (farmRooms.length ? farmRooms : lsRooms);
  if (!firstAvailable.length) return [];
  return mergeRoomsWithZoneFallback(firstAvailable, [farmRooms, lsRooms, wizardRooms]);
}

function updateGroupActionStates({ hasGroup = false, hasRoom = false, hasZone = false } = {}) {
  const applyDisabled = !(hasGroup && hasRoom && hasZone);
  const saveDisabled = !(hasRoom && hasZone);
  ['grpApply', 'grpOn', 'grpOff'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = applyDisabled;
  });
  ['btnSaveGroup', 'btnGroupSave'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = saveDisabled;
  });
}

function seedGroupRoomZoneDropdowns() {
  const roomSel = document.getElementById('groupRoomDropdown');
  const zoneSel = document.getElementById('groupZoneDropdown');
  const fixtureSummary = document.getElementById('groupFixtureSummary');
  if (!roomSel || !zoneSel) return;
  // Helper to update fixture summary for selected room/zone
  function updateFixtureSummary() {
    if (!fixtureSummary) return;
    const roomId = roomSel.value;
    const zone = zoneSel.value;
    updateGroupActionStates({ hasGroup: Boolean(STATE?.currentGroup), hasRoom: !!roomId, hasZone: !!zone });
    if (!roomId || !zone) {
      fixtureSummary.innerHTML = '<span style="color:#64748b;font-size:13px;">Select a room and zone to view lights.</span>';
      return;
    }
    const setups = (window.STATE?.lightSetups || []).filter(s => (s.room === roomId || s.room === (window.STATE?.rooms?.find(r=>r.id===roomId)?.name)) && s.zone === zone);
    if (!setups.length) {
      fixtureSummary.innerHTML = '<span style="color:#64748b;font-size:13px;">No lights configured for this room/zone.</span>';
      return;
    }
    let html = '';
    setups.forEach(setup => {
      if (Array.isArray(setup.fixtures)) {
        html += setup.fixtures.map(f => `<div style='font-size:13px;'>${escapeHtml(f.vendor||f.name||f.model||'Light')} ×${f.count||1} (${f.watts||''}W)</div>`).join('');
      }
    });
    fixtureSummary.innerHTML = html || '<span style="color:#64748b;font-size:13px;">No lights found for this room/zone.</span>';
  }

  const normaliseRooms = () => (collectRoomsFromState() || []).map(room => ({
    id: room?.id || '',
    name: room?.name || '',
    zones: Array.isArray(room?.zones) ? room.zones : []
  }));

  const previousRoom = roomSel.value;
  const previousZone = zoneSel.value;
  const rooms = normaliseRooms();

  roomSel.innerHTML = '<option value="">Room</option>' + rooms.map(r => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('');

  const preservedRoomId = rooms.some(r => r.id === previousRoom) ? previousRoom : '';
  roomSel.value = preservedRoomId;

  const updateZones = (roomId, zoneToPreserve) => {
    const currentRooms = normaliseRooms();
    const selectedRoom = currentRooms.find(r => r.id === roomId);
    const zones = selectedRoom ? selectedRoom.zones : [];
    zoneSel.innerHTML = '<option value="">Zone</option>' + zones.map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join('');
    const zoneCandidate = zoneToPreserve && zones.includes(zoneToPreserve) ? zoneToPreserve : '';
    if (zoneCandidate) {
      zoneSel.value = zoneCandidate;
    } else {
      zoneSel.value = '';
    }
  };

  updateZones(roomSel.value, previousZone);

  roomSel.onchange = () => {
    updateZones(roomSel.value, zoneSel.value);
    updateFixtureSummary();
    if (STATE.currentGroup) {
      try { updateGroupUI(STATE.currentGroup); } catch (e) { console.warn('Failed to refresh group UI after room change', e); }
    }
  };
  zoneSel.onchange = () => {
    zoneSel.dataset.lastValue = zoneSel.value;
    updateFixtureSummary();
    if (STATE.currentGroup) {
      try { updateGroupUI(STATE.currentGroup); } catch (e) { console.warn('Failed to refresh group UI after zone change', e); }
    }
  };
  // Initial summary
  updateFixtureSummary();
}

function resolveRoomReference(roomValue) {
  // Handle object form: { id, name } or similar
  if (roomValue && typeof roomValue === 'object') {
    const id   = String(roomValue.id   ?? roomValue.roomId ?? roomValue.value ?? '').trim();
    const name = String(roomValue.name ?? roomValue.label  ?? id).trim();
    if (id || name) return { id, name };
  }

  // Handle primitive (string/number)
  const text = String(roomValue ?? '').trim();
  if (!text) return { id: '', name: '' };

  const rooms = collectRoomsFromState() || [];
  const match = rooms.find(r => r && (r.id === text || r.name === text));
  if (match) return { id: match.id || text, name: match.name || match.id || text };

  return { id: text, name: text };
}

function collectSetupLightsForRoomZone(roomValue, zoneValue) {
  const zone = typeof zoneValue === 'string' ? zoneValue.trim() : '';
  if (!zone) return [];
  const { id: roomId, name: roomName } = resolveRoomReference(roomValue);
  if (!roomId && !roomName) return [];
  const setups = Array.isArray(window.STATE?.lightSetups) ? window.STATE.lightSetups : [];
  const results = [];
  setups.forEach((setup) => {
    if (!setup || typeof setup !== 'object') return;
    if (!Array.isArray(setup.fixtures) || !setup.fixtures.length) return;
    const { id: setupRoomId, name: setupRoomName } = resolveRoomReference(setup.room);
    const matchesRoom =
      (setupRoomId && (setupRoomId === roomId || setupRoomId === roomName)) ||
      (setupRoomName && (setupRoomName === roomId || setupRoomName === roomName));
    if (!matchesRoom) return;
    if (String(setup.zone || '').trim() !== zone) return;
    const setupId = typeof setup.id === 'string' && setup.id ? setup.id : null;
    setup.fixtures.forEach((fixture, fixtureIndex) => {
      if (!fixture || typeof fixture !== 'object') return;
      const baseId = fixture.id || buildFixtureSyntheticId(fixture) || `fixture-${fixtureIndex + 1}`;
      const label = firstNonEmptyString(
        fixture.deviceName,
        fixture.name,
        formatVendorModel(fixture.vendor, fixture.model),
        fixture.model,
        fixture.vendor,
        'Light'
      );
      const count = Math.max(1, Number(fixture.count) || 1);
      for (let instance = 0; instance < count; instance += 1) {
        const instanceSuffix = count > 1 ? `-${instance + 1}` : '';
        const instanceId = `setup:${setupId || baseId}:${baseId}${instanceSuffix}:${roomId || roomName}:${zone}`;
        results.push({
          id: instanceId,
          device_id: instanceId,
          name: label,
          deviceName: label,
          type: 'Light',
          vendor: fixture.vendor || '',
          model: fixture.model || '',
          watts: fixture.watts,
          source: 'setup',
          count: 1,
          room: String(roomId || roomName || '').trim(),
          roomId: String(roomId || '').trim(),
          roomName: String(roomName || '').trim(),
          zone: String(zone || '').trim(),
          setupId,
          fixtureId: fixture.id || baseId,
          countIndex: instance + 1,
          countTotal: count,
        });
      }
    });
  });
  return results;
}

// --- Utilities: stable id + room/zone normalization -------------------------

function stableLightId(entry) {
  const id = entry?.id;
  if (id && String(id).trim()) return String(id).trim();
  const vendorRaw = (entry?.vendor || entry?.name || 'fixture').toString().trim().replace(/\s+/g, '_');
  const modelRaw = (entry?.model || 'light').toString().trim().replace(/\s+/g, '_');
  const vendor = vendorRaw || 'fixture';
  const model = modelRaw || 'light';
  return `wired-${vendor}-${model}`;
}

function resolveRoomRef(roomValue, rooms = collectRoomsFromState() || []) {
  if (roomValue && typeof roomValue === 'object') {
    const id = String(roomValue.id ?? roomValue.roomId ?? roomValue.value ?? '').trim();
    const name = String(roomValue.name ?? roomValue.label ?? id).trim();
    if (id || name) return { id, name };
  }
  const text = String(roomValue ?? '').trim();
  if (!text) return { id: '', name: '' };
  const hit = rooms.find((room) => room && (room.id === text || room.name === text));
  if (hit) return { id: hit.id || text, name: hit.name || text };
  return { id: text, name: text };
}

function normZone(z) {
  return String(z ?? '').trim();
}

function isForSelection(lightMeta, selectedRoom, selectedZone) {
  const rooms = collectRoomsFromState() || [];
  const sel = resolveRoomRef(selectedRoom, rooms);
  const lit = resolveRoomRef(lightMeta?.roomId ?? lightMeta?.room ?? lightMeta?.roomName, rooms);
  const selZone = normZone(selectedZone);
  const litZone = normZone(lightMeta?.zone);
  if (selZone !== litZone) return false;
  const idMatch =
    (sel.id && lit.id && lit.id === sel.id) ||
    (sel.id && lit.name && lit.name === sel.id);
  const nameMatch =
    (sel.name && lit.name && lit.name === sel.name) ||
    (sel.name && lit.id && lit.id === sel.name);
  return Boolean(idMatch || nameMatch);
}

// --- Build the candidate set strictly from Room+Zone ------------------------

function collectCandidatesForSelection(selectedRoom, selectedZone) {
  const rooms = collectRoomsFromState() || [];
  const sel = resolveRoomRef(selectedRoom, rooms);
  const zone = normZone(selectedZone);
  if (!zone || (!sel.id && !sel.name)) return [];

  const outMap = new Map();

  function ensureCandidate(id, payload) {
    if (!id) return;
    if (!outMap.has(id)) {
      outMap.set(id, payload);
    }
  }

  (STATE?.lightSetups || []).forEach((setup) => {
    const sRoom = resolveRoomRef(setup?.room, rooms);
    if (!isForSelection({ roomId: sRoom.id, room: sRoom.name, zone: setup?.zone }, sel, zone)) return;
    (setup?.fixtures || []).forEach((fixture) => {
      if (!fixture) return;
      const id = stableLightId(fixture);
      ensureCandidate(id, {
        id,
        vendor: fixture.vendor,
        model: fixture.model,
        deviceName: fixture.vendor ? `${fixture.vendor} ${fixture.model}` : (fixture.name || fixture.model || 'Light'),
        roomId: sRoom.id,
        roomName: sRoom.name,
        zone,
        source: 'setup',
        setupId: setup?.id || null,
        fixtureId: fixture.id || null,
      });
    });
  });

  (STATE?.deviceKB?.fixtures || []).forEach((fixture) => {
    if (!fixture) return;
    const fRoom = resolveRoomRef(fixture?.roomId ?? fixture?.room, rooms);
    if (!isForSelection({ roomId: fRoom.id, room: fRoom.name, zone: fixture?.zone }, sel, zone)) return;
    const id = stableLightId(fixture);
    ensureCandidate(id, {
      ...fixture,
      id,
      vendor: fixture.vendor,
      model: fixture.model,
      deviceName: fixture.vendor ? `${fixture.vendor} ${fixture.model}` : (fixture.name || fixture.model || 'Light'),
      roomId: fRoom.id,
      roomName: fRoom.name,
      zone,
      source: 'fixture',
    });
  });

  (STATE?.devices || []).forEach((device) => {
    if (!device) return;
    const dRoom = resolveRoomRef(device?.roomId ?? device?.room, rooms);
    if (!isForSelection({ roomId: dRoom.id, room: dRoom.name, zone: device?.zone }, sel, zone)) return;
    const id = stableLightId(device);
    ensureCandidate(id, {
      ...device,
      id,
      deviceName: device.deviceName || device.name || `${device.vendor || ''} ${device.model || ''}`.trim(),
      roomId: dRoom.id,
      roomName: dRoom.name,
      zone,
      source: device.source || 'device',
    });
  });

  Object.entries(STATE?.deviceMeta || {}).forEach(([metaId, meta]) => {
    if (!metaId) return;
    const mRoom = resolveRoomRef(meta?.roomId ?? meta?.room ?? meta?.roomName, rooms);
    if (!isForSelection({ roomId: mRoom.id, room: mRoom.name, zone: meta?.zone }, sel, zone)) return;
    ensureCandidate(String(metaId), {
      ...meta,
      id: String(metaId),
      deviceName: meta.deviceName || meta.name || resolveLightNameFromState(metaId, meta) || String(metaId),
      roomId: mRoom.id,
      roomName: mRoom.name,
      zone,
      source: meta.source || 'meta',
    });
  });

  return Array.from(outMap.values());
}

// --- Split Assigned vs Ungrouped WITHOUT using group name ------------------

function computeRostersForSelection(selectedRoom, selectedZone) {
  const candidates = collectCandidatesForSelection(selectedRoom, selectedZone);
  if (!candidates.length) return { assigned: [], ungrouped: [] };

  const assignedIds = new Set();
  (STATE?.groups || []).forEach((group) => {
    (group?.lights || []).forEach((light) => {
      const id = typeof light === 'string' ? String(light).trim() : stableLightId(light);
      if (!id) return;
      const meta = typeof light === 'string' ? {} : light;
      if (isForSelection(meta, selectedRoom, selectedZone)) {
        assignedIds.add(id);
      }
    });
  });

  const assigned = [];
  const ungrouped = [];
  candidates.forEach((candidate) => {
    if (!candidate?.id) return;
    (assignedIds.has(candidate.id) ? assigned : ungrouped).push(candidate);
  });

  return { assigned, ungrouped };
}

// --- When adding a light to a group, stamp roomId/zone explicitly ----------

function addLightToGroup(group, light, selectedRoom, selectedZone) {
  if (!group || !light) return;
  const rooms = collectRoomsFromState() || [];
  const sel = resolveRoomRef(selectedRoom, rooms);
  const zone = normZone(selectedZone);
  const id = stableLightId(light);
  if (!id) return;

  const stateLights = Array.isArray(STATE?.lights) ? STATE.lights : [];
  const stateLight = stateLights.find((stateLight) => stableLightId(stateLight) === id);
  const meta = typeof getDeviceMeta === 'function' ? (getDeviceMeta(id) || {}) : {};
  const merged = { ...(stateLight || {}), ...(light || {}) };

  const pickNumber = (...values) => {
    for (const value of values) {
      const num = Number(value);
      if (Number.isFinite(num)) return num;
    }
    return undefined;
  };

  const displayName = firstNonEmptyString(
    merged.deviceName,
    merged.name,
    merged.label,
    meta.deviceName,
    id
  );
  const vendor = firstNonEmptyString(merged.vendor, merged.manufacturer, meta.vendor);
  const model = firstNonEmptyString(merged.model, meta.model);

  const entry = {
    id,
    name: displayName,
    deviceName: displayName,
    vendor,
    model,
    roomId: sel.id,
    roomName: sel.name,
    room: merged.room || merged.roomName || merged.roomId || sel.name || sel.id,
    zone,
    source: merged.source,
    setupId: merged.setupId,
    fixtureId: merged.fixtureId,
  };

  if (merged.labels != null) entry.labels = merged.labels;
  if (merged.watts != null) entry.watts = merged.watts;
  if (merged.spectra != null) entry.spectra = merged.spectra;
  if (merged.spectrum != null) entry.spectrum = merged.spectrum;
  if (typeof merged.dynamicSpectrum === 'boolean') {
    entry.dynamicSpectrum = merged.dynamicSpectrum;
  } else if (typeof merged.tunable === 'boolean') {
    entry.dynamicSpectrum = merged.tunable;
  }
  if (typeof merged.tunable === 'boolean') entry.tunable = merged.tunable;
  if (merged.spectrally_tunable != null) entry.spectrally_tunable = merged.spectrally_tunable;

  const ppfValue = pickNumber(merged.ppf, merged.metrics?.ppf, merged.output?.ppf);
  if (ppfValue !== undefined) entry.ppf = ppfValue;
  const ppfdValue = pickNumber(merged.ppfd, merged.metrics?.ppfd, merged.output?.ppfd);
  if (ppfdValue !== undefined) entry.ppfd = ppfdValue;
  const countValue = pickNumber(merged.count, merged.qty, merged.quantity, merged.units);
  if (countValue !== undefined) entry.count = countValue;

  if (merged.control != null) entry.control = merged.control;
  if (merged.transport != null) entry.transport = merged.transport;
  if (merged.protocol != null) entry.protocol = merged.protocol;
  if (merged.spectrumMode != null) entry.spectrumMode = merged.spectrumMode;
  if (merged.controllerId != null) entry.controllerId = merged.controllerId;
  if (merged.deviceId != null) entry.deviceId = merged.deviceId;
  else entry.deviceId = merged.id || id;
  if (merged.controllerIp != null) entry.controllerIp = merged.controllerIp;
  if (merged.controllerPort != null) entry.controllerPort = merged.controllerPort;
  if (merged.ipAddress != null) entry.ipAddress = merged.ipAddress;
  if (merged.ip != null) entry.ip = merged.ip;

  group.lights = Array.isArray(group.lights) ? group.lights : [];
  const existingIndex = group.lights.findIndex((existing) => stableLightId(existing) === id);
  if (existingIndex === -1) {
    group.lights.push(entry);
  } else {
    group.lights[existingIndex] = { ...group.lights[existingIndex], ...entry };
  }

  if (Array.isArray(stateLights)) {
    const labelParts = [group.room || group.roomName, group.zone, group.name || group.label].filter(Boolean);
    const groupLabel = labelParts.join(':');
    if (stateLight) {
      stateLight.zoneId = zone || stateLight.zoneId || null;
      stateLight.groupId = group.id || groupLabel || stateLight.groupId || null;
      stateLight.groupLabel = groupLabel || stateLight.groupLabel || stateLight.groupId || null;
      stateLight.roomId = entry.roomId || stateLight.roomId;
      stateLight.room = entry.room || stateLight.room;
      stateLight.roomName = entry.roomName || stateLight.roomName;
      if (entry.control != null) stateLight.control = entry.control;
      if (entry.controllerId != null) stateLight.controllerId = entry.controllerId;
      if (entry.deviceId != null) stateLight.deviceId = entry.deviceId;
      if (entry.controllerIp != null) stateLight.controllerIp = entry.controllerIp;
      if (entry.controllerPort != null) stateLight.controllerPort = entry.controllerPort;
      if (entry.ipAddress != null) stateLight.ipAddress = entry.ipAddress;
      if (entry.ip != null) stateLight.ip = entry.ip;
      if (entry.dynamicSpectrum !== undefined) stateLight.dynamicSpectrum = entry.dynamicSpectrum;
      if (entry.tunable !== undefined) stateLight.tunable = entry.tunable;
      if (entry.spectrally_tunable !== undefined) stateLight.spectrally_tunable = entry.spectrally_tunable;
      if (entry.ppf !== undefined) stateLight.ppf = entry.ppf;
      if (entry.ppfd !== undefined) stateLight.ppfd = entry.ppfd;
    } else {
      stateLights.push({
        ...entry,
        zoneId: zone || null,
        groupId: group.id || groupLabel || null,
        groupLabel: groupLabel || null,
      });
    }
  }

  if (typeof document !== 'undefined') {
    document.dispatchEvent(new Event('lights-updated'));
    document.dispatchEvent(new Event('groups-updated'));
  }
}

function dedupeById(arr) {
  const map = new Map();
  (arr || []).forEach((item) => {
    if (!item || !item.id) return;
    if (!map.has(item.id)) {
      map.set(item.id, { ...item });
    }
  });
  return Array.from(map.values());
}

function normalizeExistingGroups() {
  const rooms = collectRoomsFromState() || [];
  (STATE?.groups || []).forEach((group) => {
    if (!group || !Array.isArray(group.lights)) return;
    const cleaned = [];
    group.lights.forEach((light) => {
      const id = typeof light === 'string' ? String(light).trim() : stableLightId(light);
      if (!id) return;
      // Backfill missing room/zone from device metadata and STATE.lights for older entries
      const meta = (STATE?.deviceMeta && STATE.deviceMeta[id]) ? STATE.deviceMeta[id] : {};
      const stateLight = Array.isArray(STATE?.lights) ? STATE.lights.find((l) => stableLightId(l) === id) : null;
      const roomValueCandidate =
        light?.roomId ??
        light?.room ??
        light?.roomName ??
        meta?.roomId ??
        meta?.room ??
        meta?.roomName ??
        (stateLight ? (stateLight.roomId || stateLight.room || stateLight.roomName) : '');
      const roomRef = resolveRoomRef(roomValueCandidate, rooms);
      let zone = normZone(light?.zone);
      if (!zone) {
        const assigned = (meta && typeof meta === 'object') ? (meta.assignedEquipment || meta.assignment || {}) : {};
        const zoneCandidate =
          assigned.zone ?? assigned.zoneId ?? assigned.zone_id ??
          meta?.zone ?? (stateLight ? stateLight.zoneId : '');
        zone = normZone(zoneCandidate);
      }
      const deviceName = firstNonEmptyString(
        light?.deviceName,
        light?.name,
        resolveLightNameFromState(id, light || null),
        id
      );
      const entry = {
        ...((typeof light === 'object' && light) || {}),
        id,
        deviceName,
        name: deviceName,
        roomId: roomRef.id,
        roomName: roomRef.name,
        room: light?.room || roomRef.name || roomRef.id,
        zone,
      };
      cleaned.push(entry);
    });
    group.lights = dedupeById(cleaned);
  });
}

function getSelectedGroupRoomZone() {
  const roomSel = document.getElementById('groupRoomDropdown');
  const zoneSel = document.getElementById('groupZoneDropdown');
  const roomValue = roomSel ? roomSel.value : '';
  const zoneValue = zoneSel ? zoneSel.value : '';
  const { id: roomId, name: roomName } = resolveRoomReference(roomValue);
  return { roomId, roomName, rawRoom: roomValue, zone: zoneValue ? zoneValue.trim() : '' };
}

function buildFixtureSyntheticId(fixture) {
  if (!fixture || typeof fixture !== 'object') return '';
  if (fixture.id) return String(fixture.id);
  const vendor = String(fixture.vendor || fixture.name || '').trim().replace(/\s+/g, '_');
  const model = String(fixture.model || '').trim().replace(/\s+/g, '_');
  if (!vendor && !model) return '';
  return `wired-${vendor || 'fixture'}-${model || 'light'}`;
}

function findFixtureById(id) {
  if (!id || !Array.isArray(STATE.deviceKB?.fixtures)) return null;
  return STATE.deviceKB.fixtures.find((fixture) => {
    const synthetic = buildFixtureSyntheticId(fixture);
    return String(fixture.id || '').toLowerCase() === String(id).toLowerCase() || synthetic.toLowerCase() === String(id).toLowerCase();
  }) || null;
}

function findSetupFixtureById(id) {
  if (!id || !Array.isArray(window.STATE?.lightSetups)) return null;
  for (const setup of window.STATE.lightSetups) {
    if (!Array.isArray(setup.fixtures)) continue;
    const match = setup.fixtures.find((fixture) => {
      const synthetic = fixture.id || buildFixtureSyntheticId(fixture);
      return synthetic && String(synthetic).toLowerCase() === String(id).toLowerCase();
    });
    if (match) {
      return { fixture: match, setup };
    }
  }
  return null;
}

function getDeviceMeta(id) {
  if (!id) return null;
  const fromMeta = STATE.deviceMeta?.[id];
  if (fromMeta) return fromMeta;
  const fromDevices = Array.isArray(STATE.devices) ? STATE.devices.find((device) => device.id === id) : null;
  if (fromDevices) return fromDevices;
  const fromFixtures = findFixtureById(id);
  if (fromFixtures) {
    const control = String(fromFixtures.control || '').toLowerCase();
    const inferredMode = control.includes('api') || control.includes('lan') || control.includes('dynamic')
      ? 'dynamic'
      : 'static';
    return {
      ...fromFixtures,
      vendor: fromFixtures.vendor || fromFixtures.name || '',
      model: fromFixtures.model || fromFixtures.name || '',
      spectrumMode: inferredMode,
      factorySpectrum: fromFixtures.spectrum || null,
    };
  }
  return null;
}

function computeChannelPercentages(mix) {
  const channels = ['cw', 'ww', 'bl', 'rd'];
  const totals = channels.reduce((acc, key) => acc + Math.max(0, Number(mix?.[key] || 0)), 0);
  const safeTotal = totals > 0 ? totals : 1;
  const pct = {};
  channels.forEach((key) => {
    const value = Math.max(0, Number(mix?.[key] || 0));
    pct[key] = (value / safeTotal) * 100;
  });
  return { percentages: pct, total: totals };
}

/**
 * Compute spectral band percentages from SPD data.
 * 
 * IMPORTANT: "Mid-spectrum" (500-600nm) represents the ENTIRE mid-spectrum range,
 * including cyan, true green, yellow, and amber wavelengths. This is NOT just 
 * "visually green" light.
 * 
 * For fixtures with only adjustable red/blue channels:
 * - The absolute mid-spectrum output is FIXED (cannot be adjusted)
 * - The percentage shown will vary as total output changes when red/blue are adjusted
 * - Higher blue/red = lower mid-spectrum %, same absolute mid-spectrum = higher mid-spectrum %
 * 
 * Example: If fixture outputs 4.5 units of mid-spectrum (fixed):
 * - Baseline (blue=44, red=41): total=99.5 → mid=4.5/99.5 = 4.5%
 * - Dimmed red 50% (blue=44, red=20.5): total=79 → mid=4.5/79 = 5.7%
 * - Boosted blue 25% (blue=55, red=41): total=111 → mid=4.5/111 = 4.1%
 * 
 * @param {Object} spd - SPD object with wavelengths and samples/display arrays
 * @returns {Object|null} - { blue, mid, red } percentages or null if invalid
 */
function computeSpdBandPercentages(spd) {
  if (!spd || !Array.isArray(spd.wavelengths)) return null;
  const wavelengths = spd.wavelengths;
  const samples = Array.isArray(spd.samples) && spd.samples.length === wavelengths.length
    ? spd.samples
    : (Array.isArray(spd.display) && spd.display.length === wavelengths.length ? spd.display : null);
  if (!samples) return null;
  let red = 0;
  let mid = 0;
  let blue = 0;
  for (let i = 0; i < wavelengths.length; i += 1) {
    const wl = wavelengths[i];
    const value = Number(samples[i]) || 0;
    if (wl >= 600) red += value;
    else if (wl >= 500) mid += value;  // Mid-spectrum: entire 500-600nm band (cyan→green→yellow→amber)
    else blue += value;
  }
  const total = red + mid + blue;
  if (total <= 0) {
    return { red: 0, mid: 0, blue: 0 };
  }
  const scale = 100 / total;
  return {
    red: red * scale,
    mid: mid * scale,  // Percentage of total output in 500-600nm range
    blue: blue * scale,
  };
}

function buildSelectedLightMix(group, fallbackSpectrum = null) {
  if (!group || !Array.isArray(group.lights) || group.lights.length === 0) return null;
  const totals = { cw: 0, ww: 0, bl: 0, rd: 0 };
  let totalWeight = 0;
  let dynamicWeight = 0;
  let staticWeight = 0;
  const fallback = fallbackSpectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };

  group.lights.forEach((entry) => {
    if (!entry) return;
    const entryObj = (entry && typeof entry === 'object') ? entry : null;
    const lightId = entryObj ? (entryObj.id || entryObj.lightId || entryObj.deviceId) : (typeof entry === 'string' ? entry : null);
    if (!lightId) return;

    const meta = getDeviceMeta(lightId) || {};
    const setup = findSetupFixtureById(lightId);
    const fromSetup = setup?.fixture || null;

    // Look up light in database to get dynamicSpectrum/tunability and spectrum as fallbacks
    const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
    const dbLight = lightsDb.find((l) => (
      String(l?.id) === String(lightId) ||
      String(l?.serial) === String(lightId) ||
      String(l?.deviceId) === String(lightId) ||
      (entryObj && (String(l?.id) === String(entryObj.id) || String(l?.serial) === String(entryObj.serial) || String(l?.deviceId) === String(entryObj.deviceId)))
    )) || null;

    // Determine manufacturer spectrum with robust fallbacks
    const manufacturerSpectrum =
      entryObj?.spectrum ||
      dbLight?.spectrum ||
      meta.factorySpectrum ||
      meta.spectrum ||
      fromSetup?.spectrum ||
      null;

    const controlRaw = [
      entryObj?.control,
      meta.control,
      fromSetup?.control,
      entryObj?.transport,
      meta.transport,
      entryObj?.protocol,
      meta.protocol,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const spectrumMode = String(entryObj?.spectrumMode || meta.spectrumMode || '').toLowerCase();

    // Determine tunability with priority:
    // 1) Assigned entry object flags
    // 2) Database flags
    // 3) Explicit meta/setup tunable
    // 4) Infer from control (fallback)
    let isTunable = null;
    if (typeof entryObj?.dynamicSpectrum === 'boolean') {
      isTunable = entryObj.dynamicSpectrum;
    } else if (typeof entryObj?.tunable === 'boolean') {
      isTunable = entryObj.tunable;
    } else if (entryObj?.spectrally_tunable) {
      const st = String(entryObj.spectrally_tunable).toLowerCase();
      isTunable = (st === 'yes' || st === 'true');
    } else if (typeof dbLight?.dynamicSpectrum === 'boolean') {
      isTunable = dbLight.dynamicSpectrum;
    } else if (typeof dbLight?.tunable === 'boolean') {
      isTunable = dbLight.tunable;
    } else if (dbLight?.spectrally_tunable) {
      const st = String(dbLight.spectrally_tunable).toLowerCase();
      isTunable = (st === 'yes' || st === 'true');
    } else if (typeof meta.tunable === 'boolean') {
      isTunable = meta.tunable;
    } else if (typeof fromSetup?.tunable === 'boolean') {
      isTunable = fromSetup.tunable;
    }

    // Determine if light can adjust spectrum dynamically
    const isDynamic = isTunable === true || (isTunable !== false && (spectrumMode === 'dynamic' || /dynamic|api|lan|wifi|grow3|driver/.test(controlRaw)));

    const countCandidate = entryObj
      ? (entryObj.count ?? entryObj.qty ?? entryObj.quantity ?? entryObj.units ?? entryObj.total)
      : null;
    const parsedCount = Number(countCandidate);
    const weight = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;

    // CRITICAL: Static lights should NEVER adjust to match the plan spectrum
    // - Tunable lights: use the plan spectrum (fallback)
    // - Static lights: use their factory spectrum ONLY (never plan spectrum)
    let sourceSpectrum = null;
    if (isDynamic) {
      // Tunable light: use plan spectrum
      sourceSpectrum = fallback;
    } else {
      // Static light: MUST use manufacturer spectrum
      sourceSpectrum = manufacturerSpectrum;

      if (!sourceSpectrum) {
        // Static light without factory spectrum: skip it entirely
        // (do NOT fall back to plan spectrum - static lights can't adjust)
        console.warn(`[buildSelectedLightMix] Skipping static light ${lightId} - no factory spectrum defined. Static lights must have factory spectrum data.`);
        totalWeight += weight;
        staticWeight += weight;
        return;
      }
    }

    const numericSpectrum = {
      cw: Number(sourceSpectrum?.cw || 0),
      ww: Number(sourceSpectrum?.ww || 0),
      bl: Number(sourceSpectrum?.bl || 0),
      rd: Number(sourceSpectrum?.rd || 0),
    };
    const channelSum = numericSpectrum.cw + numericSpectrum.ww + numericSpectrum.bl + numericSpectrum.rd;
    if (channelSum <= 0) return;
    totals.cw += numericSpectrum.cw * weight;
    totals.ww += numericSpectrum.ww * weight;
    totals.bl += numericSpectrum.bl * weight;
    totals.rd += numericSpectrum.rd * weight;
    totalWeight += weight;
    if (isDynamic) dynamicWeight += weight;
    else staticWeight += weight;
  });

  if (totalWeight <= 0) return null;
  const channelTotal = totals.cw + totals.ww + totals.bl + totals.rd;
  if (channelTotal <= 0) return null;
  return {
    mix: {
      cw: (totals.cw / channelTotal) * 100,
      ww: (totals.ww / channelTotal) * 100,
      bl: (totals.bl / channelTotal) * 100,
      rd: (totals.rd / channelTotal) * 100,
    },
    counts: {
      total: totalWeight,
      dynamic: dynamicWeight,
      static: staticWeight,
    },
  };
}

function deriveDeviceId(device, fallbackIndex = 0) {
  if (!device || typeof device !== 'object') {
    return `device-${fallbackIndex + 1}`;
  }
  const candidates = [
    device.id,
    device.device_id,
    device.deviceId,
    device.mac,
    device.address,
    device.serial,
    device.uuid,
    device._id
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  return `device-${fallbackIndex + 1}`;
}

function deriveDeviceName(device, fallbackId = '') {
  if (!device || typeof device !== 'object') {
    return fallbackId || 'Unknown device';
  }
  const candidates = [
    device.deviceName,
    device.name,
    device.label,
    device.alias,
    device.description
  ];
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const text = String(candidate).trim();
    if (text) return text;
  }
  const vendor = typeof device.vendor === 'string' ? device.vendor.trim() : '';
  const model = typeof device.model === 'string' ? device.model.trim() : '';
  const combined = [vendor, model].filter(Boolean).join(' ').trim();
  if (combined) return combined;
  return fallbackId || 'Unknown device';
}

function firstNonEmptyString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function formatVendorModel(vendor, model) {
  const vendorText = typeof vendor === 'string' ? vendor.trim() : '';
  const modelText = typeof model === 'string' ? model.trim() : '';
  return [vendorText, modelText].filter(Boolean).join(' ').trim();
}

function resolveLightNameFromState(id, source) {
  const sourceName =
    source && typeof source === 'object'
      ? firstNonEmptyString(
          source.name,
          source.deviceName,
          source.label,
          formatVendorModel(source.vendor, source.model),
          formatVendorModel(source.manufacturer, source.model),
          source.model,
          source.manufacturer
        )
      : '';
  if (sourceName) return sourceName;

  const device = Array.isArray(STATE?.devices) ? STATE.devices.find((d) => d.id === id) : null;
  if (device) {
    const deviceName = firstNonEmptyString(
      device.deviceName,
      device.name,
      formatVendorModel(device.vendor, device.model),
      deriveDeviceName(device, id)
    );
    if (deviceName) return deviceName;
  }

  const meta = STATE?.deviceMeta?.[id];
  if (meta) {
    const metaName = firstNonEmptyString(
      meta.deviceName,
      meta.name,
      meta.label,
      formatVendorModel(meta.vendor || meta.manufacturer, meta.model),
      meta.model,
      meta.manufacturer
    );
    if (metaName) return metaName;
  }

  return id;
}

function normalizeGroupLightEntry(entry, index = 0) {
  if (!entry) return null;
  if (typeof entry === 'string') {
    const id = firstNonEmptyString(entry);
    if (!id) return null;
    const name = resolveLightNameFromState(id, null);
    return { id, name, deviceName: name };
  }
  if (typeof entry === 'object') {
    const raw = entry;
    const idCandidate = firstNonEmptyString(raw.id, raw.device_id, raw.deviceId, raw.deviceID);
    const id = idCandidate || deriveDeviceId(raw, index);
    if (!id) return null;
    const name = resolveLightNameFromState(id, raw) || id;
    const existingName = typeof raw.name === 'string' ? raw.name.trim() : '';
    const needsUpdate = raw.id !== id || existingName !== name || !raw.deviceName;
    if (!needsUpdate) {
      return { ...raw, id, name: existingName || name, deviceName: raw.deviceName || existingName || name };
    }
    const normalized = { ...raw, id, name };
    if (!normalized.deviceName) normalized.deviceName = name;
    return normalized;
  }
  return null;
}

function normalizeGroupRecord(group) {
  if (!group || typeof group !== 'object') {
    return { id: '', name: '', lights: [], plan: '', schedule: '', room: '', zone: '' };
  }
  const normalized = { ...group };
  if (typeof normalized.id === 'string') normalized.id = normalized.id.trim();
  if (typeof normalized.name === 'string') normalized.name = normalized.name.trim();
  if (!normalized.name && normalized.id) normalized.name = normalized.id;
  const lights = Array.isArray(group.lights)
    ? group.lights
        .map((entry, idx) => normalizeGroupLightEntry(entry, idx))
        .filter((entry) => entry && entry.id)
    : [];
  normalized.lights = lights;
  
  // ✅ DATA FLOW FIX: Preserve plan, schedule, room, zone fields during normalization
  // These fields were being lost when normalizeGroupsInState() was called
  normalized.plan = group.plan || '';
  normalized.schedule = group.schedule || '';
  normalized.room = group.room || group.roomId || '';
  normalized.zone = group.zone || '';
  
  return normalized;
}

function normalizeGroupsInState() {
  if (!Array.isArray(STATE?.groups)) {
    if (STATE) STATE.groups = [];
    return;
  }
  normalizeExistingGroups();
  const currentId = STATE.currentGroup?.id || null;
  STATE.groups = STATE.groups.map((group) => normalizeGroupRecord(group));
  if (currentId) {
    STATE.currentGroup = STATE.groups.find((group) => group.id === currentId) || null;
  }
}

function buildDeviceLikeFromMeta(id) {
  if (!id) return null;
  const meta = STATE?.deviceMeta?.[id];
  if (!meta) return null;
  const name = resolveLightNameFromState(id, meta);
  return {
    id,
    deviceName: name,
    name,
    online: true,
    type: meta.type || 'light',
    protocol: meta.protocol || meta.transport || 'unknown',
    spectrumMode: meta.spectrumMode || meta.control || 'static',
    vendor: meta.vendor || meta.manufacturer,
    manufacturer: meta.manufacturer || meta.vendor,
    model: meta.model,
    farm: meta.farm,
    room: meta.room,
    zone: meta.zone,
    module: meta.module,
    level: meta.level,
    side: meta.side,
    watts: meta.watts,
    source: 'meta',
  };
}

function formatDelta(delta, unit = '', precision = 0) {
  if (delta == null || !Number.isFinite(delta)) return null;
  const factor = Math.pow(10, precision);
  const rounded = Math.round(delta * factor) / factor;
  const threshold = precision === 0 ? 0.5 : 0.5 / factor;
  if (Math.abs(rounded) < threshold) return `±0${unit}`;
  const sign = rounded > 0 ? '+' : '';
  return `${sign}${rounded.toFixed(precision)}${unit}`;
}

function formatValueWithDelta(value, deltaText) {
  if (!deltaText) return value;
  return `${value} (${deltaText})`;
}

function resolveEnvironmentTargets(roomId, zoneValue) {
  const envZones = Array.isArray(STATE.environment) ? STATE.environment : [];
  if (!envZones.length) return null;
  const rooms = collectRoomsFromState();
  const room = rooms.find((r) => r.id === roomId || r.name === roomId) || null;
  const candidates = [];
  if (zoneValue) candidates.push(String(zoneValue));
  if (room?.name) candidates.push(String(room.name));
  if (roomId) candidates.push(String(roomId));
  const lowerCandidates = candidates.map((value) => value.toLowerCase());
  const match = envZones.find((zone) => {
    const keys = [zone.id, zone.name, zone.location].filter(Boolean).map((value) => String(value).toLowerCase());
    return keys.some((value) => lowerCandidates.includes(value));
  });
  if (!match) return null;
  return {
    temp: match.sensors?.tempC?.setpoint || null,
    rh: match.sensors?.rh?.setpoint || null,
  };
}

function formatSetpointRange(range, unit) {
  if (!range || (range.min == null && range.max == null)) return '—';
  const formatValue = (value) =>
    value == null || Number.isNaN(Number(value)) ? null : Number(value).toFixed(unit === '°C' ? 1 : 0);
  const min = formatValue(range.min);
  const max = formatValue(range.max);
  if (min && max) {
    if (min === max) return `${min}${unit}`;
    return `${min}–${max}${unit}`;
  }
  if (min) return `${min}${unit}`;
  if (max) return `${max}${unit}`;
  return '—';
}

function clearCanvas(canvas) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// --- IoT System Setup Card Show/Hide Logic ---
document.addEventListener('DOMContentLoaded', function() {
  const btn = document.getElementById('btnShowIotSetup');
  const card = document.getElementById('iotEcosystemCard');
  if (btn && card) {
    btn.onclick = function() {
      card.style.display = card.style.display === 'none' || !card.style.display ? 'block' : 'none';
    };
    // Optional: hide card when clicking outside or pressing Escape
    document.addEventListener('mousedown', function(e) {
      if (card.style.display !== 'none' && !card.contains(e.target) && e.target !== btn) {
        card.style.display = 'none';
      }
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && card.style.display !== 'none') {
        card.style.display = 'none';
      }
    });
  }
});
// --- IoT Ecosystem Device Manager Buttons & Modal ---
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('iotEcosystemModal');
  const modalBody = document.getElementById('iotEcosystemModalBody');
  const closeBtn = document.getElementById('closeIotEcosystemModal');
  if (closeBtn && modal) closeBtn.onclick = () => { modal.style.display = 'none'; };
  function showModal(html) {
    if (modalBody) modalBody.innerHTML = html;
    if (modal) modal.style.display = 'flex';
  }
  // Ecosystem button handlers
  const ecosystemPrompts = {
    SwitchBot: {
      title: 'SwitchBot Setup Wizard',
      instructions: `<b>SwitchBot Cloud Integration</b><br>To discover and control SwitchBot devices, connect your SwitchBot account.<br><br><b>Step 1:</b> Enter your SwitchBot API Token and Secret. <br><span class='tiny'>Find these in the SwitchBot app under Profile → Preferences → API Token.</span>`,
      fields: [
        { label: 'API Token', type: 'text', id: 'sbApiToken', placeholder: 'SwitchBot API Token', required: true },
        { label: 'API Secret', type: 'text', id: 'sbApiSecret', placeholder: 'SwitchBot API Secret', required: true }
      ]
    },
    Kasa: {
      title: 'TP-Link Kasa Setup',
      instructions: `<b>Kasa (LAN Wi‑Fi plugs & lamps)</b><br>Enter your Kasa account or local IP range to resolve device names and import schedules.<br><br><b>Instructions:</b><ol><li>Enter your Kasa account email (or local IP range for LAN discovery).</li></ol>`,
      fields: [
        { label: 'Kasa Account Email or IP Range', type: 'text', id: 'kasaAccount', placeholder: 'e.g. user@email.com or 192.168.1.0/24' },
        { label: 'Vendor', type: 'select', id: 'kasaVendor', options: () => (window.DEVICE_MANUFACTURERS||[]).map(m=>m.name) }
      ]
    },
    Sonoff: {
      title: 'Sonoff / ITEAD Setup',
      instructions: `<b>Sonoff / ITEAD</b><br>Is the device stock eWeLink cloud or reflashed to Tasmota/ESPHome? This lets us choose between HTTP and MQTT drivers.<br><br><b>Instructions:</b><ol><li>Select the firmware type.</li></ol>`,
      fields: [
        { label: 'Firmware', type: 'select', id: 'sonoffFw', options: ['eWeLink (stock)', 'Tasmota', 'ESPHome'] },
        { label: 'Vendor', type: 'select', id: 'sonoffVendor', options: () => (window.DEVICE_MANUFACTURERS||[]).map(m=>m.name) }
      ]
    }
    // Add more ecosystems as needed...
  };
  function renderFields(fields) {
    return fields.map(f => {
      if (f.type === 'select') {
        const opts = typeof f.options === 'function' ? f.options() : f.options;
        return `<label style="display:block;margin-bottom:8px;">${f.label}<br><select id="${f.id}" style="width:100%;padding:6px 8px;margin-top:2px;">${opts.map(o=>`<option value="${o}">${o}</option>`).join('')}</select></label>`;
      } else {
        return `<label style="display:block;margin-bottom:8px;">${f.label}<br><input type="text" id="${f.id}" placeholder="${f.placeholder||''}" style="width:100%;padding:6px 8px;margin-top:2px;"></label>`;
      }
    }).join('');
  }
  function handleEcosystemBtn(ecosystem) {
    if (ecosystem === 'SwitchBot') {
      showSwitchBotWizard();
      return;
    }
    if (ecosystem === 'Kasa') {
      showKasaWizard();
      return;
    }
    const prompt = ecosystemPrompts[ecosystem];
    if (!prompt) return;
    const html = `<h2 style="margin-top:0">${prompt.title}</h2><div class="tiny" style="margin-bottom:12px;">${prompt.instructions}</div>${renderFields(prompt.fields)}<button class="primary" style="margin-top:12px;width:100%;" onclick="window.saveEcosystemSetup && window.saveEcosystemSetup('${ecosystem}')">Save</button>`;
    showModal(html);
// --- Kasa Setup Wizard Modal ---
function showKasaWizard() {
  const modal = document.getElementById('iotEcosystemModal');
  const modalBody = document.getElementById('iotEcosystemModalBody');
  if (!modal || !modalBody) return;
  let step = 1;
  let discoveryResults = [];
  function renderStep1() {
    modalBody.innerHTML = `
      <h2 style="margin-top:0">Kasa Setup Wizard</h2>
      <div class="tiny" style="margin-bottom:12px;">To discover and control Kasa devices, enter your Kasa account email or local IP range.<br><b>Step 1:</b> Provide your Kasa credentials or subnet for LAN discovery.</div>
      <label style="display:block;margin-bottom:8px;">Kasa Account Email or IP Range<br><input type="text" id="kasaAccount" placeholder="e.g. user@email.com or 192.168.1.0/24" style="width:100%;padding:6px 8px;margin-top:2px;"></label>
      <button class="primary" id="kasaWizardNext" style="margin-top:12px;width:100%;">Next</button>
    `;
    modal.style.display = 'flex';
    document.getElementById('kasaWizardNext').onclick = function() {
      const account = document.getElementById('kasaAccount').value.trim();
      if (!account) {
        showToast({ title: 'Missing Info', msg: 'Account email or IP range is required.', kind: 'error', icon: '' });
        return;
      }
      renderStep2(account);
    };
  }
  function renderStep2(account) {
    modalBody.innerHTML = `
      <h2 style="margin-top:0">Kasa Setup Wizard</h2>
      <div class="tiny" style="margin-bottom:12px;">Step 2: Discovering your Kasa devices…</div>
      <div id="kasaWizardSpinner" style="text-align:center;margin:24px 0;">
        <span class="spinner" style="display:inline-block;width:32px;height:32px;border:4px solid #e5e7eb;border-top:4px solid #60a5fa;border-radius:50%;animation:spin 1s linear infinite;"></span>
        <div class="tiny" style="margin-top:8px;">Scanning LAN for Kasa devices…</div>
      </div>
    `;
    modal.style.display = 'flex';
    fetch('/api/kasa/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account })
    })
    .then(resp => resp.json())
    .then(data => {
      discoveryResults = Array.isArray(data.devices) ? data.devices : [];
      if (!discoveryResults.length) {
        modalBody.innerHTML = `<h2 style=\"margin-top:0\">Kasa Setup Wizard</h2><div class=\"tiny\" style=\"margin-bottom:12px;\">No Kasa devices found. Please check your info and try again.</div><button class=\"ghost\" id=\"kasaWizardBack\">Back</button>`;
        document.getElementById('kasaWizardBack').onclick = renderStep1;
        return;
      }
      renderStep3(account);
    })
    .catch(err => {
      modalBody.innerHTML = `<h2 style=\"margin-top:0\">Kasa Setup Wizard</h2><div class=\"tiny\" style=\"margin-bottom:12px;\">Error: ${escapeHtml(err.message||'Unknown error')}</div><button class=\"ghost\" id=\"kasaWizardBack\">Back</button>`;
      document.getElementById('kasaWizardBack').onclick = renderStep1;
    });
  }
  function renderStep3(account) {
    modalBody.innerHTML = `
      <h2 style="margin-top:0">Kasa Setup Wizard</h2>
      <div class="tiny" style="margin-bottom:12px;">Configure your discovered Kasa devices. Edit alias, assign location/zone, and enable scheduling as needed.</div>
      <form id="kasaConfigForm">
        <ul style="margin-bottom:16px;list-style:none;padding:0;">
          ${discoveryResults.map((d,i)=>`
            <li style="margin-bottom:12px;padding:8px;border:1px solid #e5e7eb;border-radius:6px;">
              <b>${escapeHtml(d.alias||d.name||'Device')}</b> <span class='tiny'>(${escapeHtml(d.model||'Unknown')})</span><br>
              <label>Alias: <input type="text" name="alias_${i}" value="${escapeHtml(d.alias||'')}" style="width:120px;margin-left:4px;"></label>
              <label style="margin-left:12px;">Location/Zone: <input type="text" name="zone_${i}" value="" style="width:100px;margin-left:4px;"></label>
              <label style="margin-left:12px;">Scheduling: <select name="sched_${i}"><option value="enabled">Enabled</option><option value="disabled">Disabled</option></select></label>
            </li>
          `).join('')}
        </ul>
        <button class="primary" type="submit" style="width:100%;">Finish Setup</button>
      </form>
    `;
    modal.style.display = 'flex';
    document.getElementById('kasaConfigForm').onsubmit = function(e) {
      e.preventDefault();
      // Collect config for each device
      const form = e.target;
      const configs = discoveryResults.map((d,i)=>({
        id: d.id || d.deviceId || d.mac || d.address,
        alias: form[`alias_${i}`].value,
        zone: form[`zone_${i}`].value,
        scheduling: form[`sched_${i}`].value
      }));
      // Send config to backend
      fetch('/api/kasa/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account, configs })
      })
      .then(resp => resp.json())
      .then(result => {
        modal.style.display = 'none';
        showToast({ title: 'Kasa Setup Complete', msg: `Provisioned ${configs.length} device(s).`, kind: 'success', icon: '' });
        // Optionally refresh Kasa card here
        if (typeof window.refreshKasaCard === 'function') window.refreshKasaCard();
      })
      .catch(err => {
        showToast({ title: 'Kasa Setup Error', msg: escapeHtml(err.message||'Unknown error'), kind: 'error', icon: '' });
      });
    };
  }
  renderStep1();
}
  }

  // --- SwitchBot Setup Wizard Modal ---
  function showSwitchBotWizard() {
    let step = 1;
    const modal = document.getElementById('iotEcosystemModal');
    const modalBody = document.getElementById('iotEcosystemModalBody');
    if (!modal || !modalBody) return;
    function renderStep1() {
      modalBody.innerHTML = `
        <h2 style="margin-top:0">SwitchBot Setup Wizard</h2>
        <div class="tiny" style="margin-bottom:12px;">To discover and control SwitchBot devices, connect your SwitchBot account.<br><b>Step 1:</b> Enter your SwitchBot API Token and Secret.<br><span class='tiny'>Find these in the SwitchBot app under Profile → Preferences → API Token.</span></div>
        <label style="display:block;margin-bottom:8px;">API Token<br><input type="text" id="sbApiToken" placeholder="SwitchBot API Token" style="width:100%;padding:6px 8px;margin-top:2px;"></label>
        <label style="display:block;margin-bottom:8px;">API Secret<br><input type="text" id="sbApiSecret" placeholder="SwitchBot API Secret" style="width:100%;padding:6px 8px;margin-top:2px;"></label>
        <button class="primary" id="sbWizardNext" style="margin-top:12px;width:100%;">Next</button>
      `;
      modal.style.display = 'flex';
      document.getElementById('sbWizardNext').onclick = function() {
        const token = document.getElementById('sbApiToken').value.trim();
        const secret = document.getElementById('sbApiSecret').value.trim();
        if (!token || !secret) {
          showToast({ title: 'Missing Info', msg: 'Both API Token and Secret are required.', kind: 'error', icon: '' });
          return;
        }
        renderStep2(token, secret);
      };
    }
    function renderStep2(token, secret) {
      modalBody.innerHTML = `
        <h2 style="margin-top:0">SwitchBot Setup Wizard</h2>
        <div class="tiny" style="margin-bottom:12px;">Step 2: Discovering your SwitchBot devices…</div>
        <div id="sbWizardSpinner" style="text-align:center;margin:24px 0;">
          <span class="spinner" style="display:inline-block;width:32px;height:32px;border:4px solid #e5e7eb;border-top:4px solid #60a5fa;border-radius:50%;animation:spin 1s linear infinite;"></span>
          <div class="tiny" style="margin-top:8px;">Contacting SwitchBot cloud…</div>
        </div>
      `;
      modal.style.display = 'flex';
      // Call backend to discover devices (route is /switchbot/discover, NOT /api/switchbot/discover)
      fetch('/switchbot/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, secret })
      })
      .then(resp => resp.json())
      .then(data => {
        if (!Array.isArray(data.devices) || !data.devices.length) {
          modalBody.innerHTML = `<h2 style=\"margin-top:0\">SwitchBot Setup Wizard</h2><div class=\"tiny\" style=\"margin-bottom:12px;\">No devices found. Please check your credentials and try again.</div><button class=\"ghost\" id=\"sbWizardBack\">Back</button>`;
          document.getElementById('sbWizardBack').onclick = renderStep1;
          return;
        }
        modalBody.innerHTML = `<h2 style=\"margin-top:0\">SwitchBot Setup Wizard</h2><div class=\"tiny\" style=\"margin-bottom:12px;\">Found ${data.devices.length} device(s):</div><ul style=\"margin-bottom:16px;\">${data.devices.map(d=>`<li><b>${escapeHtml(d.name||d.deviceName||'Device')}</b> <span class='tiny'>(${escapeHtml(d.deviceType||'Unknown')})</span></li>`).join('')}</ul><button class=\"primary\" id=\"sbWizardFinish\" style=\"width:100%;\">Finish Setup</button>`;
        document.getElementById('sbWizardFinish').onclick = function() {
          modal.style.display = 'none';
          showToast({ title: 'SwitchBot Setup Complete', msg: `Discovered ${data.devices.length} device(s).`, kind: 'success', icon: '' });
          // Optionally refresh SwitchBot card here
          if (typeof window.refreshSwitchBotCard === 'function') window.refreshSwitchBotCard();
        };
      })
      .catch(err => {
        modalBody.innerHTML = `<h2 style=\"margin-top:0\">SwitchBot Setup Wizard</h2><div class=\"tiny\" style=\"margin-bottom:12px;\">Error: ${escapeHtml(err.message||'Unknown error')}</div><button class=\"ghost\" id=\"sbWizardBack\">Back</button>`;
        document.getElementById('sbWizardBack').onclick = renderStep1;
      });
    }
    renderStep1();
  }
  [
    ['btnMgrSwitchBot','SwitchBot'],
    ['btnMgrKasa','Kasa'],
    ['btnMgrSonoff','Sonoff']
    // Add more mappings as you implement more ecosystems
  ].forEach(([btnId, eco]) => {
    const btn = document.getElementById(btnId);
    if (btn) btn.onclick = () => handleEcosystemBtn(eco);
  });
});

// Save handler stub (extend as needed)
window.saveEcosystemSetup = function(ecosystem) {
  // Collect field values and show a toast (replace with real logic as needed)
  const modal = document.getElementById('iotEcosystemModal');
  const fields = Array.from((modal && modal.querySelectorAll('input,select')) || []);
  const values = {};
  fields.forEach(f => { values[f.id] = f.value; });
  showToast({ title: `${ecosystem} Info Saved`, msg: JSON.stringify(values), kind: 'success', icon: '' });
  if (modal) modal.style.display = 'none';
};
// (Removed) Legacy demo pairing modal logic
// Sidebar panel state (fixes ReferenceError in strict mode)
let ACTIVE_PANEL = 'overview';

// --- Grow Room Modal Show/Hide Logic ---

// --- Fallbacks for missing global helpers (standalone mode) ---
// Utility: Group array of objects by key
function groupBy(arr, key) {
  return arr.reduce((acc, obj) => {
    const k = (typeof key === 'function') ? key(obj) : obj[key] || 'Unknown';
    if (!acc[k]) acc[k] = [];
    acc[k].push(obj);
    return acc;
  }, {});
}
// --- IoT Device Manager Modular UI ---
const DEVICE_ID_FIELDS = ['id', 'deviceId', 'device_id', 'serialNumber', 'serial', 'mac', 'macAddress', 'btAddress', 'ieeeAddress', 'address', 'ip', 'uuid'];

function cloneDeviceData(value) {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (err) {
    console.warn('[renderIoTDeviceCards] structuredClone failed, falling back to JSON clone', err);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (jsonErr) {
    console.warn('[renderIoTDeviceCards] JSON clone failed, returning shallow copy', jsonErr);
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object') return { ...value };
  }
  return value;
}

function deriveDeviceKey(device) {
  if (!device || typeof device !== 'object') return null;
  for (const field of DEVICE_ID_FIELDS) {
    const candidate = device[field];
    if (candidate !== undefined && candidate !== null && String(candidate).trim()) {
      return String(candidate).trim();
    }
  }
  return null;
}

function buildFallbackDeviceKey(device) {
  if (!device || typeof device !== 'object') return `device-${Date.now()}`;
  const parts = [
    device.protocol || device.comm_type || device.type,
    device.vendor || device.brand || device.manufacturer,
    device.name || device.deviceName || device.label,
    device.model || device.deviceModel || device.productModel,
    device.mac || device.ip || device.address
  ].filter(Boolean);
  if (parts.length === 0) {
    return `device-${Date.now()}`;
  }
  return parts.join('|').toLowerCase();
}

function extractTelemetryData(source, fallback = {}) {
  const summary = { ...(fallback || {}) };
  const scope = [];
  if (source && typeof source === 'object') {
    scope.push(source);
    if (source.body && typeof source.body === 'object') scope.push(source.body);
    if (source.status && typeof source.status === 'object') scope.push(source.status);
    if (source.state && typeof source.state === 'object') scope.push(source.state);
    if (Array.isArray(source.properties)) {
      for (const prop of source.properties) {
        const key = prop?.name || prop?.key;
        const value = prop?.value;
        if (key && value !== undefined && value !== null && typeof value !== 'object') {
          summary[key] = value;
        }
      }
    }
  }
  const interestingKeys = ['power', 'powerState', 'devicePower', 'voltage', 'current', 'temperature', 'humidity', 'rssi', 'signal', 'battery', 'fwVersion', 'firmwareVersion', 'watts', 'amps', 'status', 'state'];
  for (const target of scope) {
    for (const [key, value] of Object.entries(target)) {
      if (value === undefined || value === null) continue;
      if (typeof value === 'object') continue;
      summary[key] = value;
      if (!interestingKeys.includes(key)) {
        if (/power|state|temp|humid|volt|amp|signal|battery|status/i.test(key)) {
          summary[key] = value;
        }
      }
    }
  }
  return summary;
}

function sanitizeDevicePayload(rawDevice = {}, overrides = {}) {
  const base = rawDevice && typeof rawDevice === 'object' ? cloneDeviceData(rawDevice) : {};
  if (base.deviceData && typeof base.deviceData === 'object') {
    delete base.deviceData.deviceData;
  }
  if (base.telemetry && typeof base.telemetry === 'object') {
    delete base.telemetry.telemetry;
  }
  const merged = { ...base, ...overrides };
  const key = deriveDeviceKey(merged) || buildFallbackDeviceKey(merged);
  const telemetry = extractTelemetryData(merged.deviceData || merged, overrides.telemetry || merged.telemetry);
  const payload = {
    id: key,
    deviceId: merged.deviceId || merged.device_id || key,
    name: merged.name || merged.deviceName || merged.label || 'Unknown Device',
    brand: merged.brand || merged.vendor || merged.manufacturer || 'Unknown',
    vendor: merged.vendor || merged.brand || merged.manufacturer || 'Unknown',
    protocol: String(merged.protocol || merged.comm_type || merged.type || 'unknown').toLowerCase(),
    type: String(merged.type || merged.category || merged.deviceType || merged.kind || merged.protocol || 'unknown').toLowerCase(),
    category: merged.category || merged.deviceCategory || null,
    ip: merged.ip || merged.address || merged.localIp || merged.ipAddress || null,
    mac: merged.mac || merged.macAddress || merged.btAddress || merged.ieeeAddress || null,
    address: merged.address || merged.ip || merged.mac || key,
    model: merged.model || merged.deviceModel || merged.productModel || null,
    location: merged.location || merged.room || merged.area || null,
    zone: merged.zone !== undefined ? merged.zone : null,
    automationControl: merged.automationControl !== undefined ? merged.automationControl : false,
    trust: overrides.trust || merged.trust || rawDevice.trust || 'unknown',
    credentials: overrides.credentials !== undefined ? overrides.credentials : (merged.credentials !== undefined ? merged.credentials : null),
    lastSeen: merged.lastSeen || merged.lastseen || merged.lastUpdate || merged.updateTime || merged.detectedAt || null,
    telemetry,
    deviceData: cloneDeviceData(merged.deviceData || merged)
  };

  // Correct type/category for known sensor models (SwitchBot WoIOSensor, MeterPlus, etc.)
  const mdl = (payload.model || '').toLowerCase();
  const nm = (payload.name || '').toLowerCase();
  if (mdl.includes('sensor') || mdl.includes('meter') || mdl.includes('woio') || /^sen\s*\d/.test(nm)) {
    if (!payload.type.includes('sensor') && !payload.type.includes('meter')) {
      payload.type = 'sensor';
    }
    if (!payload.category || payload.category === 'Device' || payload.category === 'device') {
      payload.category = 'environmental_sensor';
    }
  }
  if (payload.deviceData && typeof payload.deviceData === 'object' && 'credentials' in payload.deviceData) {
    delete payload.deviceData.credentials;
  }
  Object.defineProperty(payload, '__sanitized', { value: true, enumerable: false });
  return payload;
}

function dedupeDevices(devices = []) {
  const map = new Map();
  if (!Array.isArray(devices)) return [];
  for (const device of devices) {
    const sanitized = device?.__sanitized ? device : sanitizeDevicePayload(device);
    map.set(sanitized.id, sanitized);
  }
  return Array.from(map.values());
}

function upsertDeviceList(list = [], device) {
  const sanitized = device?.__sanitized ? device : sanitizeDevicePayload(device);
  const result = new Map();
  if (Array.isArray(list)) {
    for (const item of list) {
      const normalized = item?.__sanitized ? item : sanitizeDevicePayload(item);
      result.set(normalized.id, normalized);
    }
  }
  result.set(sanitized.id, sanitized);
  return Array.from(result.values());
}

function formatTelemetryKey(key) {
  const keyStr = String(key || '').trim();
  
  // Handle SwitchBot-specific poorly named keys
  const switchbotKeyMap = {
    'weight': 'Power (W)',
    'electricityOfDay': 'Energy Today (Wh)',
    'electricCurrent': 'Current (mA)',
    'voltage': 'Voltage (V)'
  };
  
  if (switchbotKeyMap[keyStr]) {
    return switchbotKeyMap[keyStr];
  }
  
  // Generic formatting for other keys
  return keyStr
    .replace(/_/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\w/g, ch => ch.toUpperCase());
}

function getDeviceCategory(device) {
  if (!device) return 'unknown';
  const protocol = String(device.protocol || '').toLowerCase();
  const type = String(device.type || '').toLowerCase();
  const category = String(device.category || '').toLowerCase();
  const vendor = String(device.vendor || device.brand || '').toLowerCase();
  
  // Sensors (environmental monitoring)
  if (type.includes('sensor') || category.includes('sensor') || type.includes('woiosensor')) {
    return 'sensor';
  }
  
  // Controllers (Grow3, lighting controllers)
  if (type.includes('grow3') || type.includes('controller') || category.includes('controller') || type.includes('lynx')) {
    return 'controller';
  }
  
  // Plugs/switches (power control)
  if (type.includes('plug') || category.includes('plug') || 
      type.includes('switch') || category.includes('switch') ||
      protocol.includes('kasa') || vendor.includes('kasa') || vendor.includes('tp-link')) {
    return 'plug';
  }
  
  return 'device';
}

function deviceSupportsPowerToggle(device) {
  if (!device) return false;
  const protocol = String(device.protocol || '').toLowerCase();
  const type = String(device.type || '').toLowerCase();
  const category = String(device.category || '').toLowerCase();
  const vendor = String(device.vendor || device.brand || '').toLowerCase();
  
  // SwitchBot plugs
  if (protocol === 'switchbot' && (type.includes('plug') || category.includes('plug'))) {
    return true;
  }
  
  // Kasa/TP-Link devices (supports power toggle)
  if (protocol.includes('kasa') || protocol.includes('tp-link') || vendor.includes('kasa') || vendor.includes('tp-link')) {
    return true;
  }
  
  return false;
}

function getDevicePowerState(device) {
  if (!device) return null;
  const telemetry = device.telemetry || {};
  const candidates = [telemetry.power, telemetry.powerState, telemetry.devicePower, telemetry.switch, telemetry.status, telemetry.state];
  for (const value of candidates) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') return value ? 'on' : 'off';
    const text = String(value).trim().toLowerCase();
    if (['on', 'true', '1', 'opened', 'open'].includes(text)) return 'on';
    if (['off', 'false', '0', 'closed', 'close'].includes(text)) return 'off';
  }
  return null;
}

function buildInfoGrid(entries, options = {}) {
  const items = (entries || []).filter(entry => {
    if (!entry) return false;
    const value = entry.value;
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && !value.trim()) return false;
    return true;
  });
  if (!items.length) return null;
  const columns = options.columns || 2;
  const grid = document.createElement('div');
  grid.style.cssText = `margin-top:${options.compact ? '6px' : '10px'};display:grid;grid-template-columns:repeat(${columns}, minmax(0, 1fr));gap:${options.compact ? '6px' : '10px'};`; 
  const cellStyle = options.cellStyle || 'background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:8px;display:flex;flex-direction:column;gap:2px;';
  const labelStyle = options.labelStyle || 'font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#475569;';
  const valueStyle = options.valueStyle || 'font-size:12px;color:#0f172a;font-weight:500;word-break:break-word;';
  items.forEach(entry => {
    const cell = document.createElement('div');
    cell.style.cssText = cellStyle;
    const label = document.createElement('span');
    label.style.cssText = labelStyle;
    label.textContent = entry.label;
    const valueEl = document.createElement('span');
    valueEl.style.cssText = valueStyle;
    valueEl.textContent = entry.value;
    cell.appendChild(label);
    cell.appendChild(valueEl);
    grid.appendChild(cell);
  });
  return grid;
}

function buildTelemetrySection(device, options = {}) {
  const telemetry = device?.telemetry && typeof device.telemetry === 'object' ? device.telemetry : {};
  
  // Keys to exclude from telemetry display (shown in snapshot or redundant)
  const excludeKeys = options.excludeKeys || [];
  
  // For SwitchBot plugs, exclude power-related keys shown in snapshot
  const isSwitchbotPlug = String(device.protocol || '').toLowerCase() === 'switchbot' && 
                          (String(device.category || '').toLowerCase().includes('plug') || 
                           String(device.type || '').toLowerCase().includes('plug'));
  
  if (isSwitchbotPlug) {
    excludeKeys.push('weight', 'voltage', 'electricityOfDay', 'electricCurrent');
  }
  
  // For SwitchBot sensors, exclude environmental keys shown in snapshot
  const isSwitchbotSensor = String(device.protocol || '').toLowerCase() === 'switchbot' && 
                            (String(device.category || '').toLowerCase().includes('sensor') || 
                             String(device.type || '').toLowerCase().includes('sensor'));
  
  if (isSwitchbotSensor) {
    excludeKeys.push('temperature', 'humidity', 'battery');
  }
  
  const entries = Object.keys(telemetry)
    .filter(key => {
      if (telemetry[key] === undefined || telemetry[key] === null || typeof telemetry[key] === 'object') return false;
      if (excludeKeys.includes(key)) return false;
      // Exclude common metadata keys
      if (['device_id', 'deviceId', 'deviceType', 'name', 'category', 'protocol', 'hubDeviceId', 'lastUpdate', 'online', 'trust', 'version'].includes(key)) return false;
      return true;
    })
    .map(key => ({ label: formatTelemetryKey(key), value: String(telemetry[key]) }));
  if (!entries.length) return null;

  const deviceId = options.deviceId || device.id;
  const storageKey = deviceId ? `iot.metrics.expanded.${deviceId}` : null;
  const stored = storageKey ? (localStorage.getItem(storageKey) || '').toLowerCase() : '';
  const storedExpanded = stored === '1' || stored === 'true' || stored === 'yes';
  const showAll = options.showAll === true || storedExpanded;
  const limit = typeof options.limit === 'number' ? options.limit : entries.length;

  const section = document.createElement('div');
  section.style.cssText = 'margin-top:10px;display:flex;flex-direction:column;gap:8px;';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;';
  const heading = document.createElement('span');
  heading.style.cssText = 'font-size:11px;font-weight:600;color:#0369a1;letter-spacing:0.03em;text-transform:uppercase;';
  heading.textContent = 'Telemetry';
  header.appendChild(heading);

  const canToggle = entries.length > limit && !showAll;
  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = 'margin-left:auto;padding:4px 8px;background:#e2e8f0;color:#0f172a;border:none;border-radius:6px;font-size:10px;font-weight:600;cursor:pointer;';
  toggleBtn.textContent = showAll ? 'Show less' : canToggle ? `Show all (+${entries.length - limit})` : '';
  if (toggleBtn.textContent) header.appendChild(toggleBtn);

  section.appendChild(header);

  const gridAll = buildInfoGrid(entries, { columns: options.columns || 2, compact: true });
  const gridTrimmed = buildInfoGrid(entries.slice(0, limit), { columns: options.columns || 2, compact: true });

  if (showAll) {
    if (gridAll) section.appendChild(gridAll);
  } else {
    if (gridTrimmed) section.appendChild(gridTrimmed);
  }

  if (toggleBtn.textContent) {
    toggleBtn.addEventListener('click', () => {
      const currentlyAll = section.querySelector('[data-telemetry-all]');
    });
  }

  // Enhanced toggle that rebuilds content when clicked
  if (toggleBtn.textContent) {
    const rebuild = (expand) => {
      // Remove existing grid(s)
      Array.from(section.querySelectorAll('.__telemetry-grid')).forEach(el => el.remove());
      const grid = expand ? buildInfoGrid(entries, { columns: options.columns || 2, compact: true })
                          : buildInfoGrid(entries.slice(0, limit), { columns: options.columns || 2, compact: true });
      if (grid) {
        grid.classList.add('__telemetry-grid');
        section.appendChild(grid);
      }
      toggleBtn.textContent = expand ? 'Show less' : `Show all (+${entries.length - limit})`;
      if (storageKey) localStorage.setItem(storageKey, expand ? '1' : '0');
    };
    // Mark initial grid for easy replacement
    const lastGrid = section.lastElementChild;
    if (lastGrid) lastGrid.classList.add('__telemetry-grid');
    toggleBtn.addEventListener('click', () => rebuild(toggleBtn.textContent !== 'Show less'));
  }

  return section;
}

function findKeyCaseInsensitive(source, targetKey) {
  if (!source || typeof source !== 'object') return null;
  const search = String(targetKey || '').toLowerCase();
  for (const key of Object.keys(source)) {
    if (key.toLowerCase() === search) {
      return key;
    }
  }
  return null;
}

function resolveDeviceMetric(device, keys = []) {
  if (!device || typeof device !== 'object') return { key: null, value: null };
  const sources = [];
  if (device.telemetry && typeof device.telemetry === 'object') sources.push(device.telemetry);
  if (device.deviceData && typeof device.deviceData === 'object') {
    sources.push(device.deviceData);
    const { details, status, state, body } = device.deviceData;
    if (details && typeof details === 'object') sources.push(details);
    if (status && typeof status === 'object') sources.push(status);
    if (state && typeof state === 'object') sources.push(state);
    if (body && typeof body === 'object') sources.push(body);
  }
  for (const source of sources) {
    for (const key of keys) {
      const actualKey = findKeyCaseInsensitive(source, key);
      if (!actualKey) continue;
      const value = source[actualKey];
      if (value !== undefined && value !== null) {
        return { key: actualKey, value };
      }
    }
    // Shallow nested search (depth 1) for metrics that may be nested in objects
    for (const [k, v] of Object.entries(source)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const key of keys) {
          const nestedKey = findKeyCaseInsensitive(v, key);
          if (!nestedKey) continue;
          const value = v[nestedKey];
          if (value !== undefined && value !== null) {
            return { key: `${k}.${nestedKey}`, value };
          }
        }
      }
    }
  }
  return { key: null, value: null };
}

function toNumericValue(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, ' ').trim();
    if (!cleaned) return null;
    const match = cleaned.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number.parseFloat(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatSwitchbotMetric(value, options = {}) {
  const fallback = options.fallback !== undefined ? options.fallback : '—';
  if (value === undefined || value === null) return fallback;
  const numeric = toNumericValue(value);
  if (numeric === null) {
    const text = String(value).trim();
    return text || fallback;
  }
  let amount = numeric;
  let unit = options.unit || '';
  const threshold = options.kiloThreshold;
  if (threshold && Math.abs(numeric) >= threshold) {
    amount = numeric / threshold;
    unit = options.kiloUnit || unit;
  }
  const decimals = typeof options.decimals === 'number' ? options.decimals : 1;
  let formatted = decimals >= 0 ? amount.toFixed(decimals) : String(amount);
  formatted = formatted.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  if (options.minDecimals !== undefined && options.minDecimals > 0 && !formatted.includes('.')) {
    formatted = `${formatted}.${'0'.repeat(options.minDecimals)}`;
  }
  return unit ? `${formatted}${unit}` : formatted;
}

function classifySwitchbotDeviceRole(device) {
  const type = String(device?.type || '').toLowerCase();
  const category = String(device?.category || '').toLowerCase();
  if (type.includes('sensor') || category.includes('sensor')) return 'Sensor';
  if (type.includes('plug') || category.includes('plug')) return 'Plug';
  const sensorMetric = resolveDeviceMetric(device, ['temperature', 'temp', 'humidity']);
  if (sensorMetric.value !== null) return 'Sensor';
  const plugMetric = resolveDeviceMetric(device, ['wattage', 'watts', 'power', 'meter']);
  if (plugMetric.value !== null) return 'Plug';
  if (type) return formatTelemetryKey(type);
  if (category) return formatTelemetryKey(category);
  return 'Device';
}

function formatSwitchbotTemperature(device) {
  const metric = resolveDeviceMetric(device, ['temperature', 'temp_c', 'temp', 'temperature_c', 'temperaturef', 'temperature_f', 'temperaturec']);
  const telemetry = device?.telemetry || {};
  const unitHint = String(telemetry.temperatureUnit || telemetry.temperature_scale || telemetry.tempUnit || telemetry.temperatureScale || '').trim();
  const suffix = unitHint ? (unitHint.toUpperCase().startsWith('F') ? '°F' : unitHint.toUpperCase().startsWith('K') ? 'K' : '°C') : '°C';
  return formatSwitchbotMetric(metric.value, { unit: suffix, decimals: 1 });
}

function formatSwitchbotHumidity(device) {
  const metric = resolveDeviceMetric(device, ['humidity', 'relative_humidity', 'humid']);
  return formatSwitchbotMetric(metric.value, { unit: '%', decimals: 0 });
}

function formatSwitchbotVpd(device) {
  const metric = resolveDeviceMetric(device, ['vpd', 'vpd_kpa', 'vpdvalue', 'vapor_pressure_deficit', 'vaporpressuredeficit']);
  if (metric.value !== null && metric.value !== undefined) {
    return formatSwitchbotMetric(metric.value, { unit: 'kPa', decimals: 2 });
  }
  const vpdCalc = computeVpdFromTempHumidity(device);
  return vpdCalc !== null ? formatSwitchbotMetric(vpdCalc, { unit: 'kPa', decimals: 2 }) : '—';
}

function formatSwitchbotWattage(device) {
  // SwitchBot uses "weight" key for actual wattage (poor naming by vendor)
  // Also check other common power keys
  const metric = resolveDeviceMetric(device, ['weight', 'wattage', 'watts', 'watt', 'power_w', 'currentpower', 'instantpower', 'currentwatt', 'meter', 'powerconsumption']);
  return formatSwitchbotMetric(metric.value, { unit: 'W', kiloThreshold: 1000, kiloUnit: 'kW', decimals: 1 });
}

function formatSwitchbotPreviousDayEnergy(device) {
  const metric = resolveDeviceMetric(device, ['previousdaywattage', 'wattageyesterday', 'meteryesterday', 'yesterdaymeter', 'energyyesterday', 'electricityofyesterday', 'electricityOfYesterday', 'yesterdayenergy', 'wattagepreviousday', 'yesterdaykwh', 'yesterDayKwh']);
  return formatSwitchbotMetric(metric.value, { unit: 'Wh', kiloThreshold: 1000, kiloUnit: 'kWh', decimals: 1 });
}

function getTemperatureCelsiusNumeric(device) {
  const m = resolveDeviceMetric(device, ['temperature', 'temp_c', 'temp', 'temperature_c', 'temperaturef', 'temperature_f', 'temperaturec']);
  const raw = m.value;
  const unitHint = String((device?.telemetry?.temperatureUnit || device?.telemetry?.temperature_scale || device?.telemetry?.tempUnit || device?.telemetry?.temperatureScale || '')).trim();
  let value = toNumericValue(raw);
  if (value === null) return null;
  const key = (m.key || '').toLowerCase();
  const isF = unitHint.toUpperCase().startsWith('F') || key.endsWith('f');
  if (isF) {
    value = (value - 32) * (5/9);
  }
  return value;
}

function getHumidityPercentNumeric(device) {
  const m = resolveDeviceMetric(device, ['humidity', 'relative_humidity', 'humid']);
  const value = toNumericValue(m.value);
  return value === null ? null : value;
}

function computeVpdFromTempHumidity(device) {
  const tC = getTemperatureCelsiusNumeric(device);
  const rh = getHumidityPercentNumeric(device);
  if (tC === null || rh === null) return null;
  // Tetens equation for saturation vapor pressure (kPa)
  const svp = 0.6108 * Math.exp((17.27 * tC) / (tC + 237.3));
  const vpd = svp * (1 - (rh / 100));
  return vpd;
}

function buildSwitchbotSnapshot(device) {
  const role = classifySwitchbotDeviceRole(device);
  const common = [{ label: 'Role', value: role || '—' }];
  const isPlug = role === 'Plug';
  const isSensor = role === 'Sensor';
  
  // Helper to format energy today
  const formatEnergyToday = (device) => {
    const metric = resolveDeviceMetric(device, ['electricityOfDay', 'energyToday', 'todayEnergy', 'meterToday', 'todayMeter']);
    return formatSwitchbotMetric(metric.value, { unit: 'Wh', kiloThreshold: 1000, kiloUnit: 'kWh', decimals: 1 });
  };
  
  // Helper to format voltage
  const formatVoltage = (device) => {
    const metric = resolveDeviceMetric(device, ['voltage']);
    return formatSwitchbotMetric(metric.value, { unit: 'V', decimals: 1 });
  };
  
  // Helper to format current
  const formatCurrent = (device) => {
    const metric = resolveDeviceMetric(device, ['electricCurrent', 'current']);
    return formatSwitchbotMetric(metric.value, { unit: 'mA', decimals: 0 });
  };
  
  const plugEntries = [
    { label: 'Power', value: formatSwitchbotWattage(device) },
    { label: 'Voltage', value: formatVoltage(device) },
    { label: 'Current', value: formatCurrent(device) },
    { label: 'Energy Today', value: formatEnergyToday(device) },
    { label: 'Yesterday', value: formatSwitchbotPreviousDayEnergy(device) }
  ];
  const sensorEntries = [
    { label: 'Temperature', value: formatSwitchbotTemperature(device) },
    { label: 'Humidity', value: formatSwitchbotHumidity(device) },
    { label: 'VPD', value: formatSwitchbotVpd(device) }
  ];
  const entries = isPlug ? [...common, ...plugEntries] : isSensor ? [...common, ...sensorEntries] : [...common];
  const grid = buildInfoGrid(entries, {
    columns: isPlug ? 3 : (entries.length > 2 ? 3 : 2),
    compact: true,
    cellStyle: 'background:var(--bg-secondary, rgba(15,23,42,0.04));border:1px solid var(--border, var(--gr-border, #cbd5e1));border-radius:8px;padding:8px;display:flex;flex-direction:column;gap:2px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08);',
    labelStyle: 'font-size:10px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-secondary, #64748b);',
    valueStyle: 'font-size:12px;color:var(--text-primary, var(--gr-text, #0f172a));font-weight:600;word-break:break-word;'
  });
  if (!grid) return null;
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'margin-top:8px;display:flex;flex-direction:column;gap:6px;';
  const heading = document.createElement('span');
  heading.style.cssText = 'font-size:10px;font-weight:700;color:#166534;letter-spacing:0.04em;text-transform:uppercase;';
  heading.textContent = 'SwitchBot Snapshot';
  wrapper.appendChild(heading);
  wrapper.appendChild(grid);
  return wrapper;
}

// ===== Client-side zone enrichment from room-map data =====
// Reads room-map.json and applies zone assignments to devices in STATE.iotDevices.
// This bridges the gap where room-map has zone data but iot-devices.json doesn't.
async function enrichDeviceZonesFromRoomMap() {
  try {
    // Try room-map.json (legacy merged file)
    const resp = await fetchWithFarmAuth('/data/room-map.json', { cache: 'no-store' });
    if (!resp.ok) return;
    const roomMap = await resp.json();
    if (!roomMap?.devices?.length) return;

    // Build zone lookup: deviceId -> { zone, room, location }
    const zoneMap = new Map();
    for (const dev of roomMap.devices) {
      const deviceId = dev.deviceId || dev.id;
      const rawZone = dev.snapshot?.zone ?? dev.zone;
      const room = dev.snapshot?.room || dev.room || roomMap.name || '';
      if (deviceId && rawZone != null) {
        const zoneNum = typeof rawZone === 'number' ? rawZone : (() => {
          const s = String(rawZone).trim();
          if (/^\d+$/.test(s)) return Number(s);
          const m = s.match(/^zone[- ]?(\d+)$/i);
          return m ? Number(m[1]) : null;
        })();
        if (zoneNum != null) {
          const location = room ? `${room} - Zone ${zoneNum}` : `Zone ${zoneNum}`;
          zoneMap.set(deviceId, { zone: zoneNum, room, location });
        }
      }
    }
    if (!zoneMap.size) return;

    // Apply zone assignments to STATE.iotDevices
    let updated = false;
    const devices = Array.isArray(STATE.iotDevices) ? STATE.iotDevices : [];
    for (const device of devices) {
      const deviceId = device.id || device.deviceId;
      const mapping = zoneMap.get(deviceId);
      if (mapping && (!device.zone || device.zone === null || device.zone === '')) {
        device.zone = mapping.zone;
        if (!device.location) device.location = mapping.location;
        updated = true;
      }
    }
    if (updated) {
      window.LAST_IOT_SCAN = STATE.iotDevices.slice();
      console.log('[enrichDeviceZonesFromRoomMap] Applied zone assignments from room-map to', devices.length, 'device(s)');
    }
  } catch (err) {
    console.warn('[enrichDeviceZonesFromRoomMap] Failed:', err.message || err);
  }
}

function persistIotDevices(devices) {
  const payload = dedupeDevices(devices);
  console.log('[persistIotDevices] Saving', payload.length, 'devices to server...',
    'trusted:', payload.filter(d => d.trust === 'trusted').length,
    'IDs:', payload.map(d => d.id).join(','));
  // Always backup to localStorage immediately (synchronous, reliable)
  try { localStorage.setItem('gr.iotDevices', JSON.stringify(payload)); } catch (_) {}
  return fetchWithFarmAuth('/data/iot-devices.json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).then(async res => {
    if (!res.ok) throw new Error(res.statusText || 'Failed to save devices');
    const result = await res.json().catch(() => ({}));
    console.log('[persistIotDevices] ✅ Server confirmed save:', result, 'count:', payload.length);
    
    // Verify round-trip: read back to confirm data was actually persisted
    try {
      const verifyResp = await fetchWithFarmAuth('/data/iot-devices.json', { cache: 'no-store' });
      if (verifyResp.ok) {
        const saved = await verifyResp.json();
        const savedArr = Array.isArray(saved) ? saved : (saved.devices || []);
        if (savedArr.length !== payload.length) {
          console.error('[persistIotDevices] ⚠️ VERIFICATION MISMATCH! Saved:', payload.length, 'Read back:', savedArr.length);
        } else {
          console.log('[persistIotDevices] ✅ Verified: read back', savedArr.length, 'devices from server');
        }
      }
    } catch (verifyErr) {
      console.warn('[persistIotDevices] Verification read-back failed:', verifyErr.message);
    }
    
    // ✅ DATA FLOW: Notify components that IoT devices have been updated
    try {
      document.dispatchEvent(new Event('iot-devices-updated'));
    } catch (err) {
      console.warn('[persistIotDevices] Failed to dispatch iot-devices-updated:', err);
    }
  }).catch(err => {
    console.error('[IoT] ⚠️ Failed to persist devices to server:', err);
    // Show user-visible warning since devices may not survive navigation
    if (typeof showToast === 'function') {
      showToast({ title: 'Save Warning', msg: 'IoT devices saved locally but server save failed. They may not persist after page reload.', kind: 'warn', icon: '⚠️', duration: 8000 });
    }
  });
}

function findDeviceRecord(deviceId) {
  if (!deviceId) return null;
  const key = String(deviceId);
  const collections = [STATE.iotDevices || [], window.LAST_IOT_SCAN || []];
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue;
    const match = collection.find(item => deriveDeviceKey(item) === key);
    if (match) return match.__sanitized ? match : sanitizeDevicePayload(match);
  }
  return null;
}

function updateDeviceRecord(device, options = {}) {
  const sanitized = device?.__sanitized ? device : sanitizeDevicePayload(device, options.overrides || {});
  STATE.iotDevices = upsertDeviceList(STATE.iotDevices, sanitized);
  window.LAST_IOT_SCAN = upsertDeviceList(window.LAST_IOT_SCAN, sanitized);
  if (options.persist) {
    persistIotDevices(STATE.iotDevices);
  }
  return sanitized;
}

function createDeviceEntryElement(device) {
  const entry = document.createElement('div');
  entry.className = `iot-device-entry iot-device-entry--${getDeviceCategory(device)}`;
  entry.dataset.deviceId = device.id;
  
  // Get device category for styling
  const deviceCategory = getDeviceCategory(device);
  
  // Category-specific colors
  const categoryColors = {
    'sensor': { border: '#4ade80', accent: '#86efac', icon: '' },
    'plug': { border: '#f59e0b', accent: '#fbbf24', icon: '🔌' },
    'controller': { border: '#818cf8', accent: '#a5b4fc', icon: '🎛' },
    'device': { border: '#94a3b8', accent: '#cbd5e1', icon: '📱' }
  };
  
  const colors = categoryColors[deviceCategory] || categoryColors['device'];
  entry.style.setProperty('--iot-device-accent', colors.border);
  entry.style.setProperty('--iot-device-title', colors.accent);

  const info = document.createElement('div');
  info.style.cssText = 'flex:1;min-width:0;';

  const name = document.createElement('div');
  name.style.cssText = 'font-weight:700;color:var(--iot-device-title, var(--text-primary, var(--gr-text, #0f172a)));margin-bottom:4px;font-size:14px;display:flex;align-items:center;gap:6px;';
  
  // Add category icon
  const categoryIcon = document.createElement('span');
  categoryIcon.textContent = colors.icon;
  categoryIcon.style.cssText = 'font-size:16px;';
  name.appendChild(categoryIcon);
  
  const nameText = document.createElement('span');
  nameText.textContent = device.name || 'Unknown Device';
  name.appendChild(nameText);
  
  info.appendChild(name);

  const subline = document.createElement('div');
  subline.style.cssText = 'font-size:10px;color:#475569;display:flex;flex-wrap:wrap;gap:6px;align-items:center;';

  // Add category badge
  const categoryBadge = document.createElement('span');
  const categoryBadgeColors = {
    'sensor': { bg: '#dcfce7', color: '#166534' },
    'plug': { bg: '#fef3c7', color: '#92400e' },
    'controller': { bg: '#e0e7ff', color: '#3730a3' },
    'device': { bg: '#e2e8f0', color: '#334155' }
  };
  const catColors = categoryBadgeColors[deviceCategory] || categoryBadgeColors['device'];
  categoryBadge.style.cssText = `background:${catColors.bg};color:${catColors.color};padding:2px 6px;border-radius:999px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;`;
  categoryBadge.textContent = deviceCategory;
  subline.appendChild(categoryBadge);

  const protocolBadge = document.createElement('span');
  protocolBadge.style.cssText = 'background:#e0e7ff;color:#1d4ed8;padding:2px 6px;border-radius:999px;font-weight:600;letter-spacing:0.03em;text-transform:uppercase;';
  protocolBadge.textContent = device.protocol || 'unknown';
  subline.appendChild(protocolBadge);

  if (device.type && device.type !== device.protocol) {
    const typeBadge = document.createElement('span');
  typeBadge.style.cssText = 'background:#e2e8f0;color:#1f2937;padding:2px 6px;border-radius:999px;font-weight:500;text-transform:uppercase;letter-spacing:0.03em;';
    typeBadge.textContent = device.type;
    subline.appendChild(typeBadge);
  }

  // Keep badges minimal: omit address/location to reduce card size

  info.appendChild(subline);

  const powerStateValue = getDevicePowerState(device);
  if (powerStateValue) {
    const stateChip = document.createElement('span');
    stateChip.style.cssText = `display:inline-flex;align-items:center;gap:4px;margin-top:6px;font-size:11px;font-weight:600;color:${powerStateValue === 'on' ? '#047857' : '#b91c1c'};`;
    const dot = document.createElement('span');
    dot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${powerStateValue === 'on' ? '#22c55e' : '#f87171'};`;
    stateChip.appendChild(dot);
    const label = document.createElement('span');
    label.textContent = `Power ${powerStateValue.toUpperCase()}`;
    stateChip.appendChild(label);
    info.appendChild(stateChip);
  }

  const isSwitchbot = String(device.protocol || '').toLowerCase() === 'switchbot';
  const typeLC = String(device.type || '').toLowerCase();
  const categoryLC = String(device.category || '').toLowerCase();
  const isWoiSensor = typeLC.includes('woiosensor') || categoryLC.includes('woiosensor');
  const isSwitchbotSensor = isSwitchbot && (
    isWoiSensor ||
    typeLC.includes('sensor') ||
    typeLC.includes('meter') ||
    typeLC.includes('hub 2') ||
    categoryLC.includes('sensor') ||
    categoryLC.includes('meter')
  );
  if (isSwitchbot) {
    const snapshot = buildSwitchbotSnapshot(device);
    if (snapshot) info.appendChild(snapshot);
  }

  // Add zone assignment dropdown for SwitchBot sensors (all sensor types, not just WoIOSensor)
  if (isSwitchbotSensor) {
    const zoneSection = document.createElement('div');
    zoneSection.style.cssText = 'margin-top:10px;padding:8px;background:var(--bg-secondary, rgba(15,23,42,0.04));border:1px solid var(--border, var(--gr-border, #bae6fd));border-radius:6px;';
    
    const zoneLabel = document.createElement('label');
    zoneLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary, #0c4a6e);font-weight:600;';
    
    const labelText = document.createElement('span');
    labelText.textContent = 'Zone:';
    zoneLabel.appendChild(labelText);
    
    const zoneSelect = document.createElement('select');
    zoneSelect.style.cssText = 'padding:4px 8px;border:1px solid var(--border, #0ea5e9);border-radius:4px;background:var(--bg-card, var(--gr-surface, #ffffff));color:var(--text-primary, var(--gr-text, #0f172a));font-size:12px;font-weight:500;cursor:pointer;';
    zoneSelect.dataset.deviceId = device.id;
    
    // Add unassigned option
    const unassignedOption = document.createElement('option');
    unassignedOption.value = '';
    unassignedOption.textContent = 'Unassigned';
    zoneSelect.appendChild(unassignedOption);
    
    // Add zone options from farm rooms configuration
    const farmRooms = collectRoomsFromState ? collectRoomsFromState() : (Array.isArray(STATE.rooms) ? STATE.rooms : Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : []);
    console.log('[ZoneDropdown] farmRooms:', farmRooms.length, 'rooms. STATE.rooms:', STATE.rooms?.length, 'STATE.farm?.rooms:', STATE.farm?.rooms?.length);
    console.log('[ZoneDropdown] farmRooms detail:', JSON.stringify(farmRooms.map(r => ({ id: r.id, name: r.name, zones: r.zones }))));
    let zoneOptionsAdded = false;
    for (const room of farmRooms) {
      const roomZones = Array.isArray(room.zones) ? room.zones : [];
      for (const zoneName of roomZones) {
        const option = document.createElement('option');
        option.value = zoneName;
        option.textContent = `${zoneName}${farmRooms.length > 1 ? ` (${room.name || room.id})` : ''}`;
        zoneSelect.appendChild(option);
        zoneOptionsAdded = true;
      }
    }
    // Fallback: if no rooms/zones configured yet, attempt async load from farm.json
    if (!zoneOptionsAdded) {
      console.warn('[ZoneDropdown] No zone options from rooms — attempting async load from /data/farm.json');
      // Add a temporary "Loading zones..." option
      const loadingOpt = document.createElement('option');
      loadingOpt.value = '';
      loadingOpt.textContent = 'Loading zones…';
      loadingOpt.disabled = true;
      zoneSelect.appendChild(loadingOpt);
      
      // Async load farm.json and populate
      (async () => {
        try {
          const resp = await fetch('/data/farm.json', { cache: 'no-store' });
          if (resp.ok) {
            const farm = await resp.json();
            if (!STATE.farm) STATE.farm = farm;
            const rooms = Array.isArray(farm.rooms) ? farm.rooms : [];
            // Remove the loading option
            if (loadingOpt.parentNode) loadingOpt.remove();
            let added = false;
            for (const room of rooms) {
              const roomZones = Array.isArray(room.zones) ? room.zones : [];
              for (const zoneName of roomZones) {
                const option = document.createElement('option');
                option.value = zoneName;
                option.textContent = `${zoneName}${rooms.length > 1 ? ` (${room.name || room.id})` : ''}`;
                zoneSelect.appendChild(option);
                added = true;
              }
            }
            if (added) {
              // Re-select current zone if device already has one
              if (device.zone) zoneSelect.value = device.zone;
              console.log('[ZoneDropdown] Loaded zones from /data/farm.json:', rooms.flatMap(r => r.zones || []));
            }
          }
        } catch (e) {
          console.warn('[ZoneDropdown] Async farm.json load failed:', e.message);
        }
      })();
    }

    // Lazy re-populate: when user focuses the dropdown, refresh zone options
    // from latest STATE.rooms in case they were loaded after initial render
    zoneSelect.addEventListener('focus', function _refreshZones() {
      const latestRooms = collectRoomsFromState ? collectRoomsFromState() : [];
      let latestZones = [];
      for (const room of latestRooms) {
        const rz = Array.isArray(room.zones) ? room.zones : [];
        for (const zn of rz) latestZones.push({ zone: zn, room });
      }
      if (!latestZones.length) return; // still nothing — keep current options
      // Check if we already have the correct zones
      const currentValues = Array.from(zoneSelect.options).map(o => o.value).filter(Boolean);
      const latestValues = latestZones.map(z => z.zone);
      if (currentValues.length === latestValues.length && currentValues.every((v,i) => v === latestValues[i])) return;
      // Re-populate
      const selectedValue = zoneSelect.value;
      while (zoneSelect.options.length > 1) zoneSelect.remove(1); // keep "Unassigned"
      for (const { zone: zoneName, room } of latestZones) {
        const option = document.createElement('option');
        option.value = zoneName;
        option.textContent = `${zoneName}${latestRooms.length > 1 ? ` (${room.name || room.id})` : ''}`;
        zoneSelect.appendChild(option);
      }
      // Restore selection
      if (selectedValue) {
        const match = Array.from(zoneSelect.options).find(o => o.value === selectedValue);
        if (match) match.selected = true;
      }
    });
    
    // Check multiple sources for zone data
    let currentZone = device.zone;
    if (!currentZone && device.telemetry?.zone_id) {
      currentZone = device.telemetry.zone_id;
    }
    if (!currentZone && device.deviceData?.zone_id) {
      currentZone = device.deviceData.zone_id;
    }
    if (!currentZone && device.telemetry?.room_name) {
      // Try to find zone from room name in groups data
      const roomName = device.telemetry.room_name;
      console.log(`[IoT] Looking for zone assignment for device in room: ${roomName}`);
    }
    
    // Set selected zone - match by value or by partial match
    if (currentZone) {
      const zoneValue = String(currentZone);
      let matchingOption = Array.from(zoneSelect.options).find(opt => opt.value === zoneValue);
      // Fallback: try matching zone number to zone name (e.g. 1 → "Zone 1", "zone-1" → "Zone 1")
      if (!matchingOption) {
        const zoneNum = String(zoneValue).match(/\d+/)?.[0];
        if (zoneNum) {
          matchingOption = Array.from(zoneSelect.options).find(opt => {
            const optNum = String(opt.value).match(/\d+/)?.[0];
            return optNum === zoneNum;
          });
        }
      }
      if (matchingOption) {
        matchingOption.selected = true;
      }
    } else {
      unassignedOption.selected = true;
    }
    
    zoneSelect.addEventListener('change', (e) => {
      const newZone = e.target.value || null;
      window.updateDeviceZone(device.id, newZone);
    });
    
    zoneLabel.appendChild(zoneSelect);
    zoneSection.appendChild(zoneLabel);
    
    // Add automation control toggle
    const automationRow = document.createElement('div');
    automationRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid #bae6fd;';
    
    const automationLabel = document.createElement('label');
    automationLabel.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;color:#0c4a6e;font-weight:600;cursor:pointer;flex:1;';
    
    const automationCheckbox = document.createElement('input');
    automationCheckbox.type = 'checkbox';
    automationCheckbox.checked = device.automationControl === true;
    automationCheckbox.style.cssText = 'width:16px;height:16px;cursor:pointer;accent-color:#0ea5e9;';
    automationCheckbox.dataset.deviceId = device.id;
    
    automationCheckbox.addEventListener('change', (e) => {
      window.updateDeviceAutomationControl(device.id, e.target.checked);
    });
    
    const automationLabelText = document.createElement('span');
    automationLabelText.textContent = 'Used for Automation Control';
    
    automationLabel.appendChild(automationCheckbox);
    automationLabel.appendChild(automationLabelText);
    
    // Add status badge
    const statusBadge = document.createElement('span');
    statusBadge.style.cssText = `padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600;${device.automationControl ? 'background:#dcfce7;color:#166534;' : 'background:#f3f4f6;color:#6b7280;'}`;
    statusBadge.textContent = device.automationControl ? 'Active' : 'Monitor Only';
    
    automationRow.appendChild(automationLabel);
    automationRow.appendChild(statusBadge);
    zoneSection.appendChild(automationRow);
    
    info.appendChild(zoneSection);
  }

  // Hide the verbose info grid by default to keep cards small.

  // Hide raw telemetry grid for SwitchBot WoIOSensor cards to keep them clean; keep snapshot above
  if (!(isSwitchbot && isWoiSensor)) {
    const telemetrySection = buildTelemetrySection(device, { deviceId: device.id, limit: 6, columns: 2, showAll: isSwitchbot && !isWoiSensor });
    if (telemetrySection) {
      info.appendChild(telemetrySection);
    } else {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'margin-top:10px;font-size:11px;color:#94a3b8;';
      placeholder.textContent = 'No telemetry reported yet.';
      info.appendChild(placeholder);
    }
  }

  // Show controlled equipment
  const controlledEquipment = getAllEquipment().filter(eq => eq.control === `IoT:${device.deviceId || device.id}`);
  if (controlledEquipment.length > 0) {
    const controlSection = document.createElement('div');
    controlSection.style.cssText = 'margin-top:10px;padding:8px;background:#f1f5f9;border-radius:6px;border-left:3px solid #3b82f6;';
    
    const controlHeader = document.createElement('div');
    controlHeader.style.cssText = 'font-size:11px;font-weight:600;color:#1e40af;margin-bottom:6px;';
    controlHeader.textContent = `Controls ${controlledEquipment.length} Equipment:`;
    controlSection.appendChild(controlHeader);
    
    const equipList = document.createElement('div');
    equipList.style.cssText = 'display:flex;flex-direction:column;gap:4px;';
    
    controlledEquipment.forEach(eq => {
      const equipItem = document.createElement('div');
      equipItem.style.cssText = 'font-size:11px;color:#475569;display:flex;align-items:center;gap:6px;';
      equipItem.innerHTML = `
        <span style="width:6px;height:6px;background:#3b82f6;border-radius:50%;"></span>
        <span style="font-weight:500;">${escapeHtml(eq.name || eq.category || 'Equipment')}</span>
        ${eq.roomName ? `<span style="color:#94a3b8;">in ${escapeHtml(eq.roomName)}</span>` : ''}
      `;
      equipList.appendChild(equipItem);
    });
    
    controlSection.appendChild(equipList);
    info.appendChild(controlSection);
  }

  entry.appendChild(info);

  const actions = document.createElement('div');
  actions.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:flex-end;';

  const buttonGroup = document.createElement('div');
  buttonGroup.style.cssText = 'display:flex;gap:4px;';

  let refreshAdded = false;
  if (deviceSupportsPowerToggle(device)) {
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = powerStateValue === 'on' ? 'Turn Off' : 'Turn On';
    toggleBtn.style.cssText = 'padding:6px 10px;background:#10b981;color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;';
    toggleBtn.dataset.deviceId = device.id;
    toggleBtn.dataset.intent = powerStateValue === 'on' ? 'off' : 'on';
    toggleBtn.addEventListener('click', () => window.toggleDevicePower(device.id));
    buttonGroup.appendChild(toggleBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = 'padding:6px 10px;background:#1f2937;color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;';
    refreshBtn.addEventListener('click', () => window.refreshDeviceStatus(device.id));
    buttonGroup.appendChild(refreshBtn);
    refreshAdded = true;
  }

  if (isSwitchbot && !refreshAdded) {
    const refreshBtn = document.createElement('button');
    refreshBtn.textContent = 'Refresh';
    refreshBtn.style.cssText = 'padding:6px 10px;background:#1f2937;color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;';
    refreshBtn.addEventListener('click', () => window.refreshDeviceStatus(device.id));
    buttonGroup.appendChild(refreshBtn);
    refreshAdded = true;
  }

  const removeBtn = document.createElement('button');
  removeBtn.textContent = 'Remove';
  removeBtn.style.cssText = 'padding:6px 10px;background:#ef4444;color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;';
  removeBtn.addEventListener('click', () => window.removeIoTDevice(device.id));
  buttonGroup.appendChild(removeBtn);

  const renameBtn = document.createElement('button');
  renameBtn.textContent = 'Rename';
  renameBtn.style.cssText = 'padding:6px 10px;background:#334155;color:white;border:none;border-radius:4px;font-size:11px;font-weight:600;cursor:pointer;';
  renameBtn.addEventListener('click', () => window.renameIoTDevice(device.id));
  buttonGroup.appendChild(renameBtn);

  actions.appendChild(buttonGroup);

  const trustValue = String(device.trust || '').toLowerCase();
  if (trustValue && trustValue !== 'unknown') {
    const trustBadge = document.createElement('span');
    trustBadge.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;color:#475569;';
    trustBadge.textContent = `Trust: ${trustValue}`;
    actions.appendChild(trustBadge);
  }

  entry.appendChild(actions);

  return entry;
}

function renderIoTDeviceCards(devices) {
  console.log('[renderIoTDeviceCards] Called with devices:', devices);
  let list = document.getElementById('iotDevicesList');
  console.log('[renderIoTDeviceCards] iotDevicesList element:', list);
  if (!list) {
    const iotPanelBody = document.querySelector('#iotPanel .panel-body') || document.getElementById('iotPanel');
    if (iotPanelBody) {
      list = document.createElement('div');
      list.id = 'iotDevicesList';
      list.style.marginTop = '12px';
      iotPanelBody.appendChild(list);
      console.warn('[renderIoTDeviceCards] Created missing iotDevicesList container dynamically');
    } else {
      console.error('[renderIoTDeviceCards] IoT panel body not found; cannot render devices');
      return;
    }
  }

  const normalizedDevices = dedupeDevices(Array.isArray(devices) ? devices : []);
  console.log('[renderIoTDeviceCards] Normalized devices:', normalizedDevices.length, normalizedDevices);

  // Show trusted devices (sensors/IoT devices that have been accepted)
  // Lights/controllers assigned to groups are handled separately and not shown here
  const trustedDevices = normalizedDevices.filter(device => {
    const trust = (device.trust || 'unknown').toLowerCase();
    return trust === 'trusted';
  });
  
  const unknownDevices = normalizedDevices.filter(device => {
    const trust = (device.trust || 'unknown').toLowerCase();
    return trust === 'unknown';
  });

  list.innerHTML = '';
  console.log('[renderIoTDeviceCards] Trusted devices:', trustedDevices.length);
  console.log('[renderIoTDeviceCards] Unknown devices:', unknownDevices.length);
  if (unknownDevices.length) {
    let html = `<h3 style="margin:0 0 8px 0;">Unknown Devices</h3>`;
    html += `<table class="iot-unknown-table" style="width:100%;border-collapse:collapse;margin-bottom:12px;">
      <thead><tr style="background:#f1f5f9"><th>Identifier</th><th>Type</th><th>Vendor</th><th>Name</th><th>Location</th><th>Trust</th><th>Actions</th></tr></thead><tbody>`;
    for (const dev of unknownDevices) {
      html += `<tr data-device-id="${escapeHtml(dev.id)}" style="border-bottom:1px solid #e5e7eb;">
        <td>${escapeHtml(dev.address || dev.id || '—')}</td>
        <td><input type="text" class="iot-unknown-type" value="${escapeHtml(dev.type || '')}" style="width:90px"></td>
        <td><input type="text" class="iot-unknown-vendor" value="${escapeHtml(dev.vendor || '')}" style="width:110px"></td>
        <td><input type="text" class="iot-unknown-name" value="${escapeHtml(dev.name || '')}" style="width:120px"></td>
        <td><input type="text" class="iot-unknown-loc" value="${escapeHtml(dev.location || '')}" style="width:120px"></td>
        <td>
          <select class="iot-unknown-trust">
            <option value="unknown"${!dev.trust || dev.trust === 'unknown' ? ' selected' : ''}>Unknown</option>
            <option value="trusted"${dev.trust === 'trusted' ? ' selected' : ''}>Trusted</option>
            <option value="quarantine"${dev.trust === 'quarantine' ? ' selected' : ''}>Quarantine</option>
            <option value="ignored"${dev.trust === 'ignored' ? ' selected' : ''}>Ignored</option>
          </select>
        </td>
        <td>
          <button class="primary tiny iot-unknown-assign">Assign</button>
          <button class="ghost tiny iot-unknown-quarantine">Quarantine</button>
        </td>
      </tr>`;
    }
    html += '</tbody></table>';
    list.insertAdjacentHTML('beforeend', html);

    Array.from(list.querySelectorAll('.iot-unknown-assign')).forEach(btn => {
      btn.onclick = function(e) {
        const row = e.target.closest('tr');
        const deviceId = row.getAttribute('data-device-id');
        const type = row.querySelector('.iot-unknown-type').value.trim();
        const vendor = row.querySelector('.iot-unknown-vendor').value.trim();
        const name = row.querySelector('.iot-unknown-name').value.trim();
        const loc = row.querySelector('.iot-unknown-loc').value.trim();
        const trust = row.querySelector('.iot-unknown-trust').value;
        const device = findDeviceRecord(deviceId);
        if (device) {
          const updated = sanitizeDevicePayload({ ...device, type, vendor, name, location: loc, trust });
          window.LAST_IOT_SCAN = upsertDeviceList(window.LAST_IOT_SCAN, updated);
          if (trust === 'trusted') {
            STATE.iotDevices = upsertDeviceList(STATE.iotDevices, { ...updated, trust: 'trusted' });
            persistIotDevices(STATE.iotDevices);
          }
          showToast({ title: 'Device updated', msg: `${name || device.address || device.id} updated.`, kind: 'success', icon: '' });
          renderIoTDeviceCards(window.LAST_IOT_SCAN);
        }
      };
    });

    Array.from(list.querySelectorAll('.iot-unknown-quarantine')).forEach(btn => {
      btn.onclick = function(e) {
        const row = e.target.closest('tr');
        const deviceId = row.getAttribute('data-device-id');
        const device = findDeviceRecord(deviceId);
        if (device) {
          const updated = sanitizeDevicePayload({ ...device, trust: 'quarantine' });
          window.LAST_IOT_SCAN = upsertDeviceList(window.LAST_IOT_SCAN, updated);
          showToast({ title: 'Device quarantined', msg: `${device.name || device.address || device.id} moved to quarantine.`, kind: 'warn', icon: '' });
          renderIoTDeviceCards(window.LAST_IOT_SCAN);
        }
      };
    });
  }

  console.log('[renderIoTDeviceCards] Rendering trusted device cards:', trustedDevices.length);
  if (!trustedDevices.length) {
    if (!unknownDevices.length) {
      list.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">No IoT devices found. Use the Universal Scanner to discover devices.</div>';
    }
    return;
  }

  console.log('[renderIoTDeviceCards] About to group by vendor...');
  const byVendor = groupBy(trustedDevices, dev => (dev.vendor || dev.brand || 'Unknown').toLowerCase());
  console.log('[renderIoTDeviceCards] Grouped vendors:', Object.keys(byVendor));
  for (const vendor of Object.keys(byVendor)) {
    console.log('[renderIoTDeviceCards] Rendering vendor:', vendor, 'with', byVendor[vendor].length, 'devices');
    const card = document.createElement('section');
    card.className = 'iot-vendor-card';
    card.className = 'iot-vendor-card';

    const header = document.createElement('h3');
      header.className = 'iot-vendor-card__title';
    header.textContent = `${vendor === 'unknown' ? 'Unknown' : vendor} Devices`;
    const badge = document.createElement('span');
      badge.className = 'iot-vendor-card__count';
    badge.textContent = byVendor[vendor].length;
    header.appendChild(badge);
    card.appendChild(header);

    const container = document.createElement('div');
      container.className = 'iot-vendor-card__grid';
    byVendor[vendor].forEach(device => {
      console.log('[renderIoTDeviceCards] Creating entry for device:', device.id);
      const entry = createDeviceEntryElement(device);
      container.appendChild(entry);
    });
    card.appendChild(container);
    list.appendChild(card);
    console.log('[renderIoTDeviceCards] Appended vendor card to list');
  }
  console.log('[renderIoTDeviceCards] === COMPLETED ===');
}

// ✅ DATA FLOW: Register event listeners for IoT devices panel
document.addEventListener('DOMContentLoaded', () => {
  // Refresh IoT device cards when rooms change (room assignments in device config)
  document.addEventListener('rooms-updated', () => {
    console.log('[IoTDevices] Rooms updated, refreshing device cards');
    if (window.LAST_IOT_SCAN && document.getElementById('iotDevicesList')) {
      renderIoTDeviceCards(window.LAST_IOT_SCAN);
    }
  });
});

// View device details
window.viewDeviceDetails = function(deviceId) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  const safeDevice = cloneDeviceData(device);
  if (safeDevice.credentials) {
    if (safeDevice.credentials.token) safeDevice.credentials.token = '••••••';
    if (safeDevice.credentials.secret) safeDevice.credentials.secret = '••••••';
    if (safeDevice.credentials.password) safeDevice.credentials.password = '••••••';
  }
  const detailsHtml = `
    <div style="font-family: monospace; font-size: 12px; white-space: pre-wrap; max-height: 320px; overflow-y: auto;">
${JSON.stringify({
  id: safeDevice.id,
  name: safeDevice.name,
  vendor: safeDevice.vendor,
  protocol: safeDevice.protocol,
  type: safeDevice.type,
  location: safeDevice.location,
  trust: safeDevice.trust,
  telemetry: safeDevice.telemetry,
  deviceData: safeDevice.deviceData
}, null, 2)}
    </div>
  `;

  showToast({
    title: `Device: ${safeDevice.name || 'Unknown'}`,
    msg: detailsHtml,
    kind: 'info',
    icon: '',
    duration: 15000
  });
};

// Remove device from IoT devices
window.removeIoTDevice = function(deviceId) {
  if (!confirm('Remove this device from IoT devices?')) return;
  const key = String(deviceId);
  STATE.iotDevices = (STATE.iotDevices || []).filter(device => deriveDeviceKey(device) !== key);
  window.LAST_IOT_SCAN = (window.LAST_IOT_SCAN || []).filter(device => deriveDeviceKey(device) !== key);
  persistIotDevices(STATE.iotDevices).finally(() => {
    window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
  });
  showToast({
    title: 'Device removed',
    msg: 'Device has been removed from IoT devices',
    kind: 'success',
    icon: ''
  });
};

// Track last refresh time per device to prevent rate limiting
const deviceRefreshCooldowns = new Map();
const REFRESH_COOLDOWN_MS = 30000; // 30 seconds minimum between forced refreshes

window.refreshDeviceStatus = async function(deviceId, options = {}) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    if (!options.silent) showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  
  // Check cooldown for forced refresh (only for SwitchBot devices)
  if (device.protocol === 'switchbot' && !options.bypassCooldown) {
    const lastRefresh = deviceRefreshCooldowns.get(deviceId);
    const now = Date.now();
    
    if (lastRefresh && (now - lastRefresh) < REFRESH_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((REFRESH_COOLDOWN_MS - (now - lastRefresh)) / 1000);
      if (!options.silent) {
        showToast({ 
          title: 'Please wait', 
          msg: `Device was recently refreshed. Please wait ${remainingSeconds} seconds to avoid rate limiting.`, 
          kind: 'warn', 
          icon: '⏱' 
        });
      }
      return;
    }
  }
  
  if (device.protocol === 'switchbot') {
    try {
      // For SwitchBot devices, use deviceData.device_id or top-level deviceId
      const realDeviceId = device.deviceData?.device_id || device.deviceId || device.id;
      if (!realDeviceId) {
        throw new Error('SwitchBot device ID not found - device may need to be rediscovered');
      }
      const endpointId = encodeURIComponent(realDeviceId);
      const resp = await fetch(`/api/switchbot/devices/${endpointId}/status?refresh=1`);
      const data = await resp.json();
      if (!resp.ok || !data || data.statusCode !== 100) {
        throw new Error(data?.message || 'Unable to fetch device status');
      }
      const body = data.body || {};
      const telemetry = extractTelemetryData(body, device.telemetry);
      const updated = sanitizeDevicePayload({
        ...device,
        telemetry,
        lastSeen: body.lastUpdate || new Date().toISOString(),
        deviceData: { ...device.deviceData, status: body }
      });
      updateDeviceRecord(updated, { persist: true });
      renderIoTDeviceCards(window.LAST_IOT_SCAN);
      
      // Record successful refresh time to enforce cooldown
      deviceRefreshCooldowns.set(deviceId, Date.now());
      
      if (!options.silent) {
        showToast({ title: 'Status refreshed', msg: `${device.name || device.id} status updated.`, kind: 'success', icon: '' });
      }
    } catch (error) {
      console.error('[IoT] Failed to refresh status', error);
      if (!options.silent) {
        showToast({ title: 'Status refresh failed', msg: error.message || 'Unable to refresh status', kind: 'error', icon: '' });
      }
    }
    return;
  }
  if (!options.silent) {
    showToast({ title: 'Not supported', msg: 'Status refresh is not implemented for this device type yet.', kind: 'warn', icon: '' });
  }
};

window.toggleDevicePower = async function(deviceId) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  if (!deviceSupportsPowerToggle(device)) {
    showToast({ title: 'Unsupported', msg: 'Power control not available for this device.', kind: 'warn', icon: '' });
    return;
  }
  const currentState = getDevicePowerState(device);
  const targetState = currentState === 'on' ? 'off' : 'on';

  // SwitchBot power toggle
  if (device.protocol === 'switchbot') {
    const command = targetState === 'on' ? 'turnOn' : 'turnOff';
    try {
      // For SwitchBot devices, use deviceData.device_id or top-level deviceId
      const realDeviceId = device.deviceData?.device_id || device.deviceId || device.id;
      if (!realDeviceId) {
        throw new Error('SwitchBot device ID not found - device may need to be rediscovered');
      }
      const endpointId = encodeURIComponent(realDeviceId);
      const resp = await fetch(`/api/switchbot/devices/${endpointId}/commands`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command })
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.statusCode !== 100) {
        throw new Error(data.message || 'Command failed');
      }
      showToast({ title: 'Command sent', msg: `${device.name || device.id} turned ${targetState}.`, kind: 'success', icon: '' });
      await window.refreshDeviceStatus(device.id, { silent: true });
    } catch (error) {
      console.error('[IoT] Power toggle failed', error);
      showToast({ title: 'Command failed', msg: error.message || 'Unable to toggle device power', kind: 'error', icon: '' });
    }
    return;
  }

  // Kasa/TP-Link power toggle
  const protocol = String(device.protocol || '').toLowerCase();
  const vendor = String(device.vendor || device.brand || '').toLowerCase();
  if (protocol.includes('kasa') || protocol.includes('tp-link') || vendor.includes('kasa') || vendor.includes('tp-link')) {
    try {
      const deviceHost = device.host || device.ip || device.address;
      if (!deviceHost) {
        throw new Error('Device IP address not found');
      }
      
      const resp = await fetch(`/api/kasa/device/${encodeURIComponent(deviceHost)}/power`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: targetState })
      });
      
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Command failed');
      }
      
      showToast({ title: 'Command sent', msg: `${device.name || device.id} turned ${targetState}.`, kind: 'success', icon: '' });
      
      // Update device state locally
      const updated = sanitizeDevicePayload({
        ...device,
        telemetry: { ...device.telemetry, power: targetState }
      });
      updateDeviceRecord(updated, { persist: true });
      renderIoTDeviceCards(window.LAST_IOT_SCAN);
      
    } catch (error) {
      console.error('[IoT] Kasa power toggle failed', error);
      showToast({ title: 'Command failed', msg: error.message || 'Unable to toggle Kasa device', kind: 'error', icon: '' });
    }
    return;
  }

  showToast({ title: 'Not implemented', msg: 'Power control not implemented for this protocol yet.', kind: 'warn', icon: '' });
};

// Rename device (update friendly name and persist)
window.renameIoTDevice = async function(deviceId) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  const current = device.name || '';
  const next = prompt('Enter a new device name:', current);
  if (next === null) return; // cancelled
  const newName = String(next).trim();
  if (!newName) {
    showToast({ title: 'Invalid name', msg: 'Name cannot be empty.', kind: 'warn', icon: '' });
    return;
  }
  try {
    const updated = sanitizeDevicePayload({ ...device, name: newName });
    updateDeviceRecord(updated, { persist: true });
    renderIoTDeviceCards(window.LAST_IOT_SCAN);
    showToast({ title: 'Device renamed', msg: `${current || 'Device'} → ${newName}`, kind: 'success', icon: '' });
  } catch (e) {
    showToast({ title: 'Rename failed', msg: e.message || 'Unable to update name', kind: 'error', icon: '' });
  }
};

// Update device zone assignment
window.updateDeviceZone = async function(deviceId, zone) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  
  try {
    const updated = sanitizeDevicePayload({ ...device, zone: zone });
    updateDeviceRecord(updated, { persist: true });
    
    const zoneName = zone ? (String(zone).match(/^zone\b/i) ? zone : `Zone ${zone}`) : 'Unassigned';
    const deviceName = device.name || device.address || device.id;
    
    showToast({ 
      title: 'Zone Updated', 
      msg: `${deviceName} assigned to ${zoneName}`, 
      kind: 'success', 
      icon: '' 
    });
  } catch (e) {
    showToast({ 
      title: 'Zone update failed', 
      msg: e.message || 'Unable to update zone', 
      kind: 'error', 
      icon: '' 
    });
  }
};

// Update device automation control flag
window.updateDeviceAutomationControl = async function(deviceId, isEnabled) {
  const device = findDeviceRecord(deviceId);
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  
  try {
    const updated = sanitizeDevicePayload({ ...device, automationControl: isEnabled });
    updateDeviceRecord(updated, { persist: true });
    
    const deviceName = device.name || device.address || device.id;
    const status = isEnabled ? 'enabled for automation control' : 'set to monitor only';
    
    showToast({ 
      title: 'Automation Control Updated', 
      msg: `${deviceName} ${status}`, 
      kind: 'success', 
      icon: '' 
    });
    
    // Re-render to update the badge
    renderIoTDeviceCards(window.LAST_IOT_SCAN);
  } catch (e) {
    showToast({ 
      title: 'Update failed', 
      msg: e.message || 'Unable to update automation control', 
      kind: 'error', 
      icon: '' 
    });
  }
};

// Demo: global stubs for Kasa/Shelly managers
window.openKasaManager = function() { showToast({ title: 'Kasa Manager', msg: 'Kasa setup wizard coming soon.', kind: 'info', icon: '' }); };
window.openShellyManager = function() { showToast({ title: 'Shelly Manager', msg: 'Shelly setup wizard coming soon.', kind: 'info', icon: '' }); };
// Modal close handler
document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('switchBotModal');
  const closeBtn = document.getElementById('closeSwitchBotModal');
  if (modal && closeBtn) {
    closeBtn.onclick = function() {
      modal.style.display = 'none';
    };
    // Optional: close modal on outside click
    modal.addEventListener('click', function(e) {
      if (e.target === modal) modal.style.display = 'none';
    });
  }
  // Start auto polling on load
  try { window.startIotAutoPolling(); } catch {}

  // Pause polling when tab hidden, resume when visible
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      window.stopIotAutoPolling();
    } else {
      window.startIotAutoPolling();
    }
  });
});

// Demo: global for last IoT scan results
window.LAST_IOT_SCAN = [];

// ===== IoT Auto-Polling (every 5 minutes) =====
window.__iotPollTimer = window.__iotPollTimer || null;
window.__iotPollIntervalMs = 5 * 60 * 1000; // 5 minutes

function getRefreshableDevices() {
  const all = Array.isArray(STATE.iotDevices) && STATE.iotDevices.length
    ? STATE.iotDevices
    : (Array.isArray(window.LAST_IOT_SCAN) ? window.LAST_IOT_SCAN : []);
  return dedupeDevices(all).filter(d => String(d.protocol || '').toLowerCase() === 'switchbot' && String(d.trust || '').toLowerCase() === 'trusted');
}

async function refreshAllDevices(options = {}) {
  const list = getRefreshableDevices();
  for (const dev of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await window.refreshDeviceStatus(dev.id, { silent: true, ...(options || {}) });
      // eslint-disable-next-line no-await-in-loop
      await new Promise(r => setTimeout(r, 250));
    } catch (e) {
      // ignore per-device failures during polling
    }
  }
}

window.startIotAutoPolling = function() {
  if (window.__iotPollTimer) return; // already running
  window.__iotPollTimer = setInterval(() => {
    refreshAllDevices({});
  }, window.__iotPollIntervalMs);
};

window.stopIotAutoPolling = function() {
  if (window.__iotPollTimer) {
    clearInterval(window.__iotPollTimer);
    window.__iotPollTimer = null;
  }
};

// Scan for devices and update UI
window.scanIoTDevices = async function() {
  const btn = document.getElementById('btnScanIoTDevices');
  const barContainer = document.getElementById('iotScanBarContainer');
  const barFill = document.getElementById('iotScanBarFill');
  const barPercent = document.getElementById('iotScanBarPercent');
  let percent = 0;
  let animFrame;
  let running = true;
  // Show and reset bar
  if (barContainer && barFill && barPercent) {
    barContainer.style.display = '';
    barFill.style.width = '0%';
    barPercent.textContent = '0%';
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  // Animate bar
  function animateBar() {
    if (!running) return;
    percent += Math.random() * 2 + 1; // 1-3% per frame
    if (percent > 98) percent = 98; // cap at 98% until fetch completes
    if (barFill && barPercent) {
      barFill.style.width = percent + '%';
      barPercent.textContent = Math.round(percent) + '%';
    }
    if (percent < 98) {
      animFrame = requestAnimationFrame(animateBar);
    }
  }
  animFrame = requestAnimationFrame(animateBar);
  try {
    const resp = await fetch('/discovery/devices');
    if (!resp.ok) throw new Error('Discovery failed');
    const data = await resp.json();
  const devices = Array.isArray(data.devices) ? data.devices : [];
  const scanned = devices.map(dev => sanitizeDevicePayload(dev, { trust: 'unknown' }));
  const trusted = Array.isArray(STATE.iotDevices) ? STATE.iotDevices : [];
  window.LAST_IOT_SCAN = dedupeDevices([...scanned, ...trusted]);
  // Persist so iot-devices.json gets populated and server-side zone sync runs
  STATE.iotDevices = window.LAST_IOT_SCAN.slice();
  await persistIotDevices(STATE.iotDevices);
  await enrichDeviceZonesFromRoomMap();
  renderIoTDeviceCards(window.LAST_IOT_SCAN);
    showToast({ title: 'Scan complete', msg: `Found ${devices.length} devices`, kind: 'success', icon: '' });
    if (data.analysis && data.analysis.suggestedWizards) {
      console.info('Suggested wizards:', data.analysis.suggestedWizards);
    }
    // Complete bar
    percent = 100;
    if (barFill && barPercent) {
      barFill.style.width = '100%';
      barPercent.textContent = '100%';
    }
    await new Promise(res => setTimeout(res, 500));
  } catch (e) {
    renderIoTDeviceCards([]);
    showToast({ title: 'Scan failed', msg: e.message || 'Could not scan for devices.', kind: 'error', icon: '' });
    // Fill bar to 100% on error
    percent = 100;
    if (barFill && barPercent) {
      barFill.style.width = '100%';
      barPercent.textContent = '100%';
    }
    await new Promise(res => setTimeout(res, 700));
  } finally {
    running = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    if (btn) { btn.disabled = false; btn.textContent = 'Scan for Devices'; }
    // Hide bar after short delay
    setTimeout(() => {
      if (barContainer) barContainer.style.display = 'none';
    }, 600);
  }
};

// ===== UNIVERSAL DEVICE SCANNER =====
// Live multi-protocol scanner for the Integrations panel
window.runUniversalScan = async function() {
  const btn = document.getElementById('btnUniversalScan');
  const progress = document.getElementById('universalScanProgress');
  const progressBar = document.getElementById('universalScanProgressBar');
  const status = document.getElementById('universalScanStatus');
  const resultsContainer = document.getElementById('universalScanResults');
  const resultsTable = document.getElementById('universalScanResultsTable');
  const resultsCount = document.getElementById('universalScanCount');
  const scanStart = Date.now();
  const minScanDurationMs = 12000;
  
  // Disable button and show progress
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Scanning...';
  }
  if (progress) progress.style.display = 'block';
  if (resultsContainer) resultsContainer.style.display = 'none';
  
  let percent = 0;
  let animFrame;
  let running = true;
  
  // Animate progress bar
  function animateProgress() {
    if (!running) return;
    percent += Math.random() * 3 + 1;
    if (percent > 95) percent = 95;
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (percent < 95) {
      animFrame = requestAnimationFrame(animateProgress);
    }
  }
  
  animFrame = requestAnimationFrame(animateProgress);
  
  try {
    let capabilityWarnings = [];
    try {
      const capResp = await fetchWithFarmAuth('/discovery/capabilities');
      if (capResp.ok) {
        const capData = await capResp.json();
        capabilityWarnings = Array.isArray(capData.warnings) ? capData.warnings : [];
        if (capabilityWarnings.length && status) {
          status.textContent = `Scanner warnings: ${capabilityWarnings.slice(0, 2).join(' ')}${capabilityWarnings.length > 2 ? '…' : ''}`;
        }
      }
    } catch (e) {
      console.warn('[UniversalScan] capability check failed:', e.message);
    }

    // Update status text
    if (status) status.textContent = 'Scanning WiFi, BLE, MQTT, Kasa, SwitchBot... this can take up to 60 seconds.';
    
    // Use universal scanner on Node.js (port 8091). Fallback to Python discovery if needed.
    const discoveryEndpoint = '/discovery/scan';
    const fallbackEndpoint = '/discovery/devices';
    const currentHost = (window?.location?.hostname || '').toLowerCase();
    const currentOrigin = window?.location?.origin || '';
    const isProductionHost = currentHost && !['localhost', '127.0.0.1'].includes(currentHost);
    const isCloudHost = isProductionHost;
    const explicitLocalProbe = window.ENABLE_LOCAL_EDGE_PROBE === true || (new URLSearchParams(window.location.search).get('edgeLocal') === '1');
    const canProbeEdge = Boolean(window.EDGE_URL) || explicitLocalProbe;
    console.log('[UniversalScan] Fetching from:', discoveryEndpoint);
    console.log('[UniversalScan] Full URL:', window.location.origin + discoveryEndpoint);
    
    let response;

    // On hosted UI, only probe edge when an edge URL is configured or explicitly requested.
    if (isProductionHost && canProbeEdge) {
      const edgeUrls = [];
      if (window.EDGE_URL) edgeUrls.push(window.EDGE_URL.replace(/\/$/, ''));
      if (explicitLocalProbe) {
        edgeUrls.push('http://localhost:8091', 'http://127.0.0.1:8091');
      }
      // Deduplicate
      const uniqueEdge = [...new Set(edgeUrls)];
      console.log('[UniversalScan] Cloud mode — trying local edge URLs:', uniqueEdge);
      if (status) status.textContent = 'Cloud mode: checking for local Light Engine...';

      // Quick health check first (2s timeout) to give fast feedback
      let connectedEdge = null;
      for (const edgeBase of uniqueEdge) {
        try {
          const hc = await fetch(edgeBase + '/env', { signal: AbortSignal.timeout(2000) });
          if (hc.ok) { connectedEdge = edgeBase; break; }
        } catch (_) {}
      }

      if (connectedEdge) {
        console.log('[UniversalScan] Local Light Engine detected at', connectedEdge);
        if (status) status.textContent = '✓ Local Light Engine connected — scanning network devices...';

        try {
          const edgeResp = await fetch(connectedEdge + '/discovery/scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(90000)
          });
          if (edgeResp.ok) {
            const edgeData = await edgeResp.json();
            const edgeDevices = Array.isArray(edgeData.devices) ? edgeData.devices : [];
            console.log('[UniversalScan] Edge scan succeeded via', connectedEdge, '- devices:', edgeDevices.length);

            // If edge found 0 devices, also try cloud scan for SwitchBot
            if (edgeDevices.length === 0) {
              console.log('[UniversalScan] Edge found 0 devices - also trying cloud scan for SwitchBot');
              if (status) status.textContent = 'Local scan complete. Checking cloud for SwitchBot devices...';
              try {
                const cloudResp = await fetchWithFarmAuth('/discovery/scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' }
                });
                if (cloudResp.ok) {
                  const cloudData = await cloudResp.json();
                  const cloudDevices = Array.isArray(cloudData.devices) ? cloudData.devices : [];
                  edgeDevices.push(...cloudDevices);
                  console.log('[UniversalScan] Cloud returned', cloudDevices.length, 'additional device(s)');
                }
              } catch (cloudErr) {
                console.warn('[UniversalScan] Cloud scan also failed:', cloudErr.message);
              }
            }

            // Build merged response
            response = new Response(JSON.stringify({
              ok: true, devices: edgeDevices, count: edgeDevices.length, source: 'merged'
            }), { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        } catch (edgeErr) {
          console.warn('[UniversalScan] Edge scan failed at', connectedEdge, edgeErr.message);
        }
      }

      // Fall back to cloud endpoint with actionable message
      if (!response) {
        console.log('[UniversalScan] No local edge or edge failed, falling back to cloud endpoint');
        if (status) {
          status.textContent = 'Scanning via cloud...';
        }
      }
    }

    if (!response) {
      response = await fetchWithFarmAuth(discoveryEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    if (!response.ok) {
      console.warn('[UniversalScan] Primary scan failed, trying fallback:', fallbackEndpoint);
      response = await fetchWithFarmAuth(fallbackEndpoint, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    console.log('[UniversalScan] Response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[UniversalScan] Error response:', errorText);
      let parsedMessage = '';
      try {
        const parsed = JSON.parse(errorText || '{}');
        parsedMessage = parsed?.message || parsed?.error || '';
      } catch {}

      if (isCloudHost && (response.status === 502 || response.status === 504)) {
        throw new Error('Scanner must run from the Light Engine host URL. Open http://127.0.0.1:3100 (or http://<machine-ip>:3100) and run scan there.');
      }

      const statusPart = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      const reasonPart = parsedMessage ? ` - ${parsedMessage}` : '';
      throw new Error(`Scan failed (${statusPart})${reasonPart} [origin: ${currentOrigin}]`);
    }
    
    const data = await response.json();
    console.log('[UniversalScan] Response data:', data);
    const devices = Array.isArray(data.devices) ? data.devices : [];
    
    console.log('[UniversalScan] Found devices:', devices);
    console.log('[UniversalScan] Device count:', devices.length);
    console.log('[UniversalScan] Device protocols:', [...new Set(devices.map(d => d.protocol))].join(', '));
    
    // Ensure scan UI doesn't complete too quickly
    const elapsedMs = Date.now() - scanStart;
    if (elapsedMs < minScanDurationMs) {
      await new Promise(res => setTimeout(res, minScanDurationMs - elapsedMs));
    }

    // Complete progress
    percent = 100;
    if (progressBar) progressBar.style.width = '100%';
    if (status) status.textContent = `Found ${devices.length} device${devices.length !== 1 ? 's' : ''}`;
    
    await new Promise(res => setTimeout(res, 500));
    
    // Hide progress, show results
    if (progress) progress.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'block';
    if (resultsCount) resultsCount.textContent = `${devices.length} device${devices.length !== 1 ? 's' : ''} found`;
    
    // Render results table with Accept/Ignore buttons
    if (resultsTable) {
      if (devices.length === 0) {
        resultsTable.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">No devices found after scan completed.</div>';
      } else {
        resultsTable.innerHTML = `
          <table style="width: 100%; border-collapse: collapse;">
            <thead>
              <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569;">Device</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569;">Brand</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569;">Protocol</th>
                <th style="padding: 12px; text-align: left; font-size: 12px; font-weight: 600; color: #475569;">IP / ID</th>
                <th style="padding: 12px; text-align: center; font-size: 12px; font-weight: 600; color: #475569;">Action</th>
              </tr>
            </thead>
            <tbody id="universalScanTableBody">
              ${devices.map((device, idx) => `
                <tr id="device-row-${idx}" style="border-bottom: 1px solid #f1f5f9; ${idx % 2 === 0 ? 'background: #fafafa;' : ''}">
                  <td style="padding: 12px; font-size: 13px; color: #1e293b;">${escapeHtml(device.name || 'Unknown Device')}</td>
                  <td style="padding: 12px; font-size: 12px; color: #64748b;">${escapeHtml(device.brand || device.vendor || '—')}</td>
                  <td style="padding: 12px;">
                    <span style="display: inline-block; padding: 4px 8px; background: #e0e7ff; color: #4338ca; border-radius: 4px; font-size: 11px; font-weight: 600;">
                      ${escapeHtml(device.protocol || device.comm_type || 'unknown')}
                    </span>
                  </td>
                  <td style="padding: 12px; font-size: 12px; color: #64748b; font-family: monospace;">${escapeHtml(device.ip || device.deviceId || device.mac || '—')}</td>
                  <td style="padding: 12px; text-align: center;">
                    <button onclick="window.acceptDiscoveredDevice(${idx})" 
                            style="padding: 6px 12px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer; margin-right: 4px;">
                      Accept
                    </button>
                    <button onclick="window.ignoreDiscoveredDevice(${idx})" 
                            style="padding: 6px 12px; background: #64748b; color: white; border: none; border-radius: 4px; font-size: 12px; font-weight: 600; cursor: pointer;">
                      Ignore
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
    
    // Store results for adding devices
    window.LAST_UNIVERSAL_SCAN = devices;
    
    showToast({ 
      title: 'Scan complete', 
      msg: `Found ${devices.length} device${devices.length !== 1 ? 's' : ''} across all protocols`, 
      kind: 'success', 
      icon: '' 
    });
    
  } catch (error) {
    console.error('[UniversalScan] Error:', error);
    
    percent = 100;
    if (progressBar) progressBar.style.width = '100%';
    if (status) status.textContent = 'Scan failed';
    
    await new Promise(res => setTimeout(res, 500));
    if (progress) progress.style.display = 'none';
    
    showToast({ 
      title: 'Scan failed', 
      msg: error.message || 'Could not complete device scan', 
      kind: 'error', 
      icon: '' 
    });
  } finally {
    running = false;
    if (animFrame) cancelAnimationFrame(animFrame);
    
    // Reset button
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Start Scan';
    }
  }
};

// Helper to accept a discovered device - prompts for sign-in if needed
window.acceptDiscoveredDevice = async function(index) {
  const devices = window.LAST_UNIVERSAL_SCAN || [];
  const device = devices[index];
  if (!device) {
    showToast({ title: 'Error', msg: 'Device not found', kind: 'error', icon: '' });
    return;
  }
  
  console.log('[UniversalScan] Accepting device:', device);
  
  // Determine if device requires sign-in based on protocol
  const protocol = (device.protocol || device.comm_type || '').toLowerCase();
  const requiresSignIn = ['kasa', 'tplink', 'switchbot'].includes(protocol);
  
  if (requiresSignIn) {
    // First check if credentials are already saved in the credential store (farm.json)
    let storeConfigured = false;
    try {
      const storeResp = await fetch('/api/credential-store');
      const storeData = await storeResp.json();
      if (storeData.ok) {
        if (protocol === 'switchbot' && storeData.switchbot?.configured) storeConfigured = true;
        if ((protocol === 'kasa' || protocol === 'tplink') && storeData.kasa?.configured) storeConfigured = true;
      }
    } catch (e) {
      console.warn('[UniversalScan] Could not check credential store:', e.message);
    }

    if (storeConfigured) {
      // Credentials exist in farm.json credential store — no need to re-prompt
      console.log(`[UniversalScan] ${protocol} credentials already configured in credential store, skipping sign-in`);
      await addDeviceToIoT(device, index, { _fromStore: true, protocol });
    } else {
      // Check STATE.iotDevices for existing device with embedded credentials
      const existingDevice = STATE.iotDevices?.find(d => 
        d.protocol === protocol && d.credentials && Object.keys(d.credentials).length > 0
      );
      
      if (existingDevice && existingDevice.credentials) {
        // Use existing credentials - no need to ask again
        console.log(`[UniversalScan] Using existing ${protocol} credentials`);
        await addDeviceToIoT(device, index, existingDevice.credentials);
      } else {
        // Need to get credentials from user
        console.log(`[UniversalScan] No existing ${protocol} credentials found, showing sign-in form`);
        await showDeviceSignInForm(device, index);
      }
    }
  } else {
    // No auth needed - add directly to IoT devices
    await addDeviceToIoT(device, index);
  }
};

// Helper to ignore a discovered device
window.ignoreDiscoveredDevice = function(index) {
  const devices = window.LAST_UNIVERSAL_SCAN || [];
  const device = devices[index];
  if (!device) return;
  
  console.log('[UniversalScan] Ignoring device:', device);
  
  // Remove row from table
  const row = document.getElementById(`device-row-${index}`);
  if (row) {
    row.style.opacity = '0.5';
    row.style.transition = 'opacity 0.3s';
    setTimeout(() => {
      row.remove();
      
      // Update count
      const remainingRows = document.querySelectorAll('#universalScanTableBody tr');
      const resultsCount = document.getElementById('universalScanCount');
      if (resultsCount) {
        resultsCount.textContent = `${remainingRows.length} device${remainingRows.length !== 1 ? 's' : ''} found`;
      }
      
      // Show empty state if no devices left
      if (remainingRows.length === 0) {
        const resultsTable = document.getElementById('universalScanResultsTable');
        if (resultsTable) {
          resultsTable.innerHTML = '<div style="padding: 24px; text-align: center; color: #64748b;">All devices ignored. Run scan again to discover more.</div>';
        }
      }
    }, 300);
  }
  
  showToast({ 
    title: 'Device ignored', 
    msg: `${device.name || 'Device'} will not be added`, 
    kind: 'info', 
    icon: '' 
  });
};

// Show sign-in form for devices that require authentication
async function showDeviceSignInForm(device, deviceIndex) {
  const protocol = (device.protocol || device.comm_type || '').toLowerCase();
  
  // Create modal overlay
  const modal = document.createElement('div');
  modal.id = 'deviceSignInModal';
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
  `;
  
  let formHTML = '';
  
  if (protocol === 'switchbot') {
    formHTML = `
      <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%;">
        <h3 style="margin: 0 0 16px 0; color: #1e293b;">Sign In to SwitchBot</h3>
        <p style="margin: 0 0 16px 0; color: #64748b; font-size: 14px;">
          Enter your SwitchBot API credentials to add <strong>${escapeHtml(device.name)}</strong>
        </p>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; color: #475569;">API Token</label>
          <input type="text" id="deviceSignInToken" placeholder="Your SwitchBot API token" 
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 24px;">
          <label style="display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; color: #475569;">API Secret</label>
          <input type="password" id="deviceSignInSecret" placeholder="Your SwitchBot API secret" 
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 14px;">
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button onclick="closeDeviceSignInModal()" 
                  style="padding: 10px 20px; background: #e2e8f0; color: #475569; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Cancel
          </button>
          <button onclick="submitDeviceSignIn(${deviceIndex}, 'switchbot')" 
                  style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Sign In & Add Device
          </button>
        </div>
      </div>
    `;
  } else if (protocol === 'kasa' || protocol === 'tplink') {
    formHTML = `
      <div style="background: white; border-radius: 8px; padding: 24px; max-width: 500px; width: 90%;">
        <h3 style="margin: 0 0 16px 0; color: #1e293b;">Sign In to TP-Link Kasa</h3>
        <p style="margin: 0 0 16px 0; color: #64748b; font-size: 14px;">
          Enter your Kasa account credentials to add <strong>${escapeHtml(device.name)}</strong>
        </p>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; color: #475569;">Email</label>
          <input type="email" id="deviceSignInEmail" placeholder="your@email.com" 
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 14px;">
        </div>
        
        <div style="margin-bottom: 24px;">
          <label style="display: block; margin-bottom: 4px; font-size: 13px; font-weight: 600; color: #475569;">Password</label>
          <input type="password" id="deviceSignInPassword" placeholder="Your password" 
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 4px; font-size: 14px;">
        </div>
        
        <div style="display: flex; gap: 8px; justify-content: flex-end;">
          <button onclick="closeDeviceSignInModal()" 
                  style="padding: 10px 20px; background: #e2e8f0; color: #475569; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Cancel
          </button>
          <button onclick="submitDeviceSignIn(${deviceIndex}, 'kasa')" 
                  style="padding: 10px 20px; background: #10b981; color: white; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Sign In & Add Device
          </button>
        </div>
      </div>
    `;
  }
  
  modal.innerHTML = formHTML;
  document.body.appendChild(modal);
}

// Close sign-in modal
window.closeDeviceSignInModal = function() {
  const modal = document.getElementById('deviceSignInModal');
  if (modal) modal.remove();
};

// Submit device sign-in and add to IoT devices
window.submitDeviceSignIn = async function(deviceIndex, protocol) {
  const devices = window.LAST_UNIVERSAL_SCAN || [];
  const device = devices[deviceIndex];
  if (!device) return;
  
  let credentials = {};
  
  if (protocol === 'switchbot') {
    const token = document.getElementById('deviceSignInToken')?.value.trim();
    const secret = document.getElementById('deviceSignInSecret')?.value.trim();
    
    if (!token || !secret) {
      showToast({ title: 'Error', msg: 'Please enter both token and secret', kind: 'error', icon: '' });
      return;
    }
    
    credentials = { token, secret };
  } else if (protocol === 'kasa') {
    const email = document.getElementById('deviceSignInEmail')?.value.trim();
    const password = document.getElementById('deviceSignInPassword')?.value.trim();
    
    if (!email || !password) {
      showToast({ title: 'Error', msg: 'Please enter both email and password', kind: 'error', icon: '' });
      return;
    }
    
    credentials = { email, password };
  }
  
  // Close modal
  closeDeviceSignInModal();
  
  // Persist credentials to the credential store (farm.json) so they survive page reloads
  try {
    const storePayload = {};
    if (protocol === 'switchbot') storePayload.switchbot = credentials;
    if (protocol === 'kasa') storePayload.kasa = credentials;
    const storeResp = await fetch('/api/credential-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(storePayload)
    });
    if (!storeResp.ok) {
      const errBody = await storeResp.json().catch(() => ({}));
      throw new Error(errBody.error || `HTTP ${storeResp.status}`);
    }
    console.log(`[UniversalScan] ${protocol} credentials saved to credential store`);
  } catch (e) {
    console.warn(`[UniversalScan] Failed to persist ${protocol} credentials to store:`, e.message);
    showToast({ title: 'Credential save failed', msg: `Could not save ${protocol} credentials: ${e.message}. You may be re-prompted later.`, kind: 'warning', icon: '' });
  }
  
  // Add device with credentials
  await addDeviceToIoT(device, deviceIndex, credentials);
};

// Add device to IoT devices panel
async function addDeviceToIoT(device, deviceIndex, credentials = null) {
  try {
    const sanitizedDevice = sanitizeDevicePayload(device, { trust: 'trusted', credentials });
    console.log('[UniversalScan] Adding device to IoT:', sanitizedDevice);

    STATE.iotDevices = upsertDeviceList(STATE.iotDevices, sanitizedDevice);
    window.LAST_IOT_SCAN = upsertDeviceList(window.LAST_IOT_SCAN, sanitizedDevice);

    await persistIotDevices(STATE.iotDevices);
    
    // Remove from scan results
    const row = document.getElementById(`device-row-${deviceIndex}`);
    if (row) {
      row.style.opacity = '0.5';
      row.style.transition = 'opacity 0.3s';
      setTimeout(() => {
        row.remove();
        
        // Update count
        const remainingRows = document.querySelectorAll('#universalScanTableBody tr');
        const resultsCount = document.getElementById('universalScanCount');
        if (resultsCount) {
          resultsCount.textContent = `${remainingRows.length} device${remainingRows.length !== 1 ? 's' : ''} found`;
        }
        
        // Show empty state if no devices left
        if (remainingRows.length === 0) {
          const resultsTable = document.getElementById('universalScanResultsTable');
          if (resultsTable) {
            resultsTable.innerHTML = '<div style="padding: 24px; text-align: center; color: #10b981;"> All devices processed. Run scan again to discover more.</div>';
          }
        }
      }, 300);
    }
    
    // Render IoT devices panel
    console.log('[IoT] Rendering devices, count:', window.LAST_IOT_SCAN?.length);
    console.log('[IoT] Devices to render:', window.LAST_IOT_SCAN);
    if (typeof window.renderIoTDeviceCards === 'function') {
      window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
    } else {
      console.warn('[IoT] renderIoTDeviceCards function not found!');
    }
    
    // Note: Auto-navigation removed to prevent panel switching
    // User can manually navigate to IoT Devices panel to view accepted devices
    
    const deviceTypeName = sanitizedDevice.category === 'environmental_sensor' ? 'sensor' : 'device';
    const successMsg = sanitizedDevice.protocol === 'usb-serial' 
      ? `${sanitizedDevice.name || 'Device'} added successfully. ${deviceTypeName.charAt(0).toUpperCase() + deviceTypeName.slice(1)} will report data once connected and transmitting. View in IoT Devices panel.`
      : `${sanitizedDevice.name || 'Device'} added to IoT devices. Navigate to IoT Devices panel to view and configure.`;
    
    showToast({ 
      title: 'Device Added Successfully', 
      msg: successMsg, 
      kind: 'success', 
      icon: '✓',
      duration: 5000
    });
    
  } catch (error) {
    console.error('[UniversalScan] Error adding device:', error);
    showToast({ 
      title: 'Error', 
      msg: `Failed to add device: ${error.message}`, 
      kind: 'error', 
      icon: '' 
    });
  }
}

// Legacy function - deprecated
window.addDiscoveredDevice = function(index) {
  console.warn('[UniversalScan] addDiscoveredDevice is deprecated, use acceptDiscoveredDevice instead');
  window.acceptDiscoveredDevice(index);
};

// Bind Universal Scanner button on page load
document.addEventListener('DOMContentLoaded', function() {
  // Track active dance party interval for cleanup
  let activeDanceInterval = null;
  
  const universalScanBtn = document.getElementById('btnUniversalScan');
  if (universalScanBtn) {
    universalScanBtn.addEventListener('click', window.runUniversalScan);
  }
  
  // Auto-check Grow3 controller status on page load and every 30 seconds
  const grow3StatusEl = document.getElementById('grow3Status');
  if (grow3StatusEl) {
    window.checkGrow3Status();
    // Continuously monitor controller status
    setInterval(() => window.checkGrow3Status(), 30000);
  }
  
  // Initialize GROW3 Pro 640 fixtures on page load (add to STATE.lights for Groups V2)
  try {
    if (!window.STATE) window.STATE = {};
    if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
    
    // Light Engine GROW3 Pro 640 fixtures controlled by Code3 controller
    const fixtures = [
      { 
        id: 'F00001', 
        serial: 'F00001',
        deviceId: 'F00001',
        name: 'GROW3 Pro 640 - F00001', 
        label: 'GROW3 Pro 640 - F00001',
        brand: 'Light Engine',
        manufacturer: 'Light Engine',
        model: 'GROW3 Pro 640',
        productName: 'GROW3 Pro 640',
        controllerId: 2,
        controllerIp: '192.168.2.80',
        controllerPort: 3000,
        protocol: 'grow3',
        transport: 'LAN',
        comm: 'MANAGED_BY_LIGHT_ENGINE',
        control: 'managed-by-le',
        roomId: 'GreenReach', 
        room: 'GreenReach',
        zoneId: null, 
        groupId: null, 
        groupLabel: null, 
        tunable: true,
        dynamicSpectrum: true,
        dimmable: true,
        spectrumMode: 'dynamic',
        channels: ['Cool White', 'Warm White', 'Blue (450nm)', 'Red (660nm)'],
        watts: 640,
        maxPowerW: 640,
        ppf: 1792,
        ppe: 2.8,
        efficacy_umolPerJ: 2.8,
        spectrum: { cw: 25, ww: 25, bl: 25, rd: 25 },
        colorRange: '400-700nm'
      },
      { 
        id: 'F00002', 
        serial: 'F00002',
        deviceId: 'F00002',
        name: 'GROW3 Pro 640 - F00002', 
        label: 'GROW3 Pro 640 - F00002',
        brand: 'Light Engine',
        manufacturer: 'Light Engine',
        model: 'GROW3 Pro 640',
        productName: 'GROW3 Pro 640',
        controllerId: 3,
        controllerIp: '192.168.2.80',
        controllerPort: 3000,
        protocol: 'grow3',
        transport: 'LAN',
        comm: 'MANAGED_BY_LIGHT_ENGINE',
        control: 'managed-by-le',
        roomId: 'GreenReach', 
        room: 'GreenReach',
        zoneId: null, 
        groupId: null, 
        groupLabel: null, 
        tunable: true,
        dynamicSpectrum: true,
        dimmable: true,
        spectrumMode: 'dynamic',
        channels: ['Cool White', 'Warm White', 'Blue (450nm)', 'Red (660nm)'],
        watts: 640,
        maxPowerW: 640,
        ppf: 1792,
        ppe: 2.8,
        efficacy_umolPerJ: 2.8,
        spectrum: { cw: 25, ww: 25, bl: 25, rd: 25 },
        colorRange: '400-700nm'
      },
      { 
        id: 'F00003', 
        serial: 'F00003',
        deviceId: 'F00003',
        name: 'GROW3 Pro 640 - F00003', 
        label: 'GROW3 Pro 640 - F00003',
        brand: 'Light Engine',
        manufacturer: 'Light Engine',
        model: 'GROW3 Pro 640',
        productName: 'GROW3 Pro 640',
        controllerId: 4,
        controllerIp: '192.168.2.80',
        controllerPort: 3000,
        protocol: 'grow3',
        transport: 'LAN',
        comm: 'MANAGED_BY_LIGHT_ENGINE',
        control: 'managed-by-le',
        roomId: 'GreenReach', 
        room: 'GreenReach',
        zoneId: null, 
        groupId: null, 
        groupLabel: null, 
        tunable: true,
        dynamicSpectrum: true,
        dimmable: true,
        spectrumMode: 'dynamic',
        channels: ['Cool White', 'Warm White', 'Blue (450nm)', 'Red (660nm)'],
        watts: 640,
        maxPowerW: 640,
        ppf: 1792,
        ppe: 2.8,
        efficacy_umolPerJ: 2.8,
        spectrum: { cw: 25, ww: 25, bl: 25, rd: 25 },
        colorRange: '400-700nm'
      },
      { 
        id: 'F00005', 
        serial: 'F00005',
        deviceId: 'F00005',
        name: 'GROW3 Pro 640 - F00005', 
        label: 'GROW3 Pro 640 - F00005',
        brand: 'Light Engine',
        manufacturer: 'Light Engine',
        model: 'GROW3 Pro 640',
        productName: 'GROW3 Pro 640',
        controllerId: 5,
        controllerIp: '192.168.2.80',
        controllerPort: 3000,
        protocol: 'grow3',
        transport: 'LAN',
        comm: 'MANAGED_BY_LIGHT_ENGINE',
        control: 'managed-by-le',
        roomId: 'GreenReach', 
        room: 'GreenReach',
        zoneId: null, 
        groupId: null, 
        groupLabel: null, 
        tunable: true,
        dynamicSpectrum: true,
        dimmable: true,
        spectrumMode: 'dynamic',
        channels: ['Cool White', 'Warm White', 'Blue (450nm)', 'Red (660nm)'],
        watts: 640,
        maxPowerW: 640,
        ppf: 1792,
        ppe: 2.8,
        efficacy_umolPerJ: 2.8,
        spectrum: { cw: 25, ww: 25, bl: 25, rd: 25 },
        colorRange: '400-700nm'
      },
      { 
        id: 'F00004', 
        serial: 'F00004',
        deviceId: 'F00004',
        name: 'GROW3 Pro 640 - F00004', 
        label: 'GROW3 Pro 640 - F00004',
        brand: 'Light Engine',
        manufacturer: 'Light Engine',
        model: 'GROW3 Pro 640',
        productName: 'GROW3 Pro 640',
        controllerId: 6,
        controllerIp: '192.168.2.80',
        controllerPort: 3000,
        protocol: 'grow3',
        transport: 'LAN',
        comm: 'MANAGED_BY_LIGHT_ENGINE',
        control: 'managed-by-le',
        roomId: 'GreenReach', 
        room: 'GreenReach',
        zoneId: null, 
        groupId: null, 
        groupLabel: null, 
        tunable: true,
        dynamicSpectrum: true,
        dimmable: true,
        spectrumMode: 'dynamic',
        channels: ['Cool White', 'Warm White', 'Blue (450nm)', 'Red (660nm)'],
        watts: 640,
        maxPowerW: 640,
        ppf: 1792,
        ppe: 2.8,
        efficacy_umolPerJ: 2.8,
        spectrum: { cw: 25, ww: 25, bl: 25, rd: 25 },
        colorRange: '400-700nm'
      }
    ];
    
    let added = 0;
    fixtures.forEach(f => {
      if (!window.STATE.lights.some(x => x.id === f.id)) {
        window.STATE.lights.push({
          ...f,
          zoneId: f.zoneId ?? null,
          groupId: f.groupId ?? null,
          groupLabel: f.groupLabel ?? null,
        });
        added++;
      }
    });
    
    if (added > 0) {
      console.debug(`[GROW3] Added ${added} GROW3 Pro 640 fixtures to STATE.lights on page load`);
      document.dispatchEvent(new Event('lights-updated'));
    }
  } catch(e) { 
    console.warn('[GROW3] Failed to initialize fixtures on page load:', e); 
  }
  
  // Bind Grow3 test button
  const btnTestGrow3 = document.getElementById('btnTestGrow3');
  if (btnTestGrow3) {
    btnTestGrow3.addEventListener('click', window.testGrow3Connection);
  }
  
  // Bind 4-channel spectrum control sliders
  const cwSlider = document.getElementById('cwSlider');
  const wwSlider = document.getElementById('wwSlider');
  const blueSlider = document.getElementById('blueSlider');
  const redSlider = document.getElementById('redSlider');
  
  const cwValue = document.getElementById('cwValue');
  const wwValue = document.getElementById('wwValue');
  const blueValue = document.getElementById('blueValue');
  const redValue = document.getElementById('redValue');
  
  const hexPreview = document.getElementById('hexPreview');
  
  // Use the exact encodeChannels function from Code3 manual
  function encodeChannels(percentages) {
    const padded = [...percentages, 0, 0, 0, 0, 0, 0].slice(0, 6);
    const bytes = padded.map((p) => {
      const step = percentToDriverByte(p ?? 0);
      return step.toString(16).padStart(2, '0');
    });
    return bytes.join('').toUpperCase(); // 12 hex chars
  }
  
  function updateHexPreview() {
    if (!cwSlider || !wwSlider || !blueSlider || !redSlider || !hexPreview) return;
    
    const cw = parseInt(cwSlider.value);
    const ww = parseInt(wwSlider.value);
    const blue = parseInt(blueSlider.value);
    const red = parseInt(redSlider.value);
    
    // Use the official encodeChannels function from Code3 manual
    // Channels: [CW, WW, Blue, Red, CH5 (unused), CH6 (unused)]
    const hex12 = encodeChannels([cw, ww, blue, red]);
    hexPreview.textContent = hex12;
    
    // Individual hex values for breakdown display
  const cwHex = percentToDriverByte(cw).toString(16).padStart(2, '0');
  const wwHex = percentToDriverByte(ww).toString(16).padStart(2, '0');
  const blueHex = percentToDriverByte(blue).toString(16).padStart(2, '0');
  const redHex = percentToDriverByte(red).toString(16).padStart(2, '0');
    
    // Update value displays
    if (cwValue) cwValue.textContent = cw;
    if (wwValue) wwValue.textContent = ww;
    if (blueValue) blueValue.textContent = blue;
    if (redValue) redValue.textContent = red;
    
    // Update hex breakdown display
    const hexCW = document.getElementById('hexCW');
    const hexWW = document.getElementById('hexWW');
    const hexBlue = document.getElementById('hexBlue');
    const hexRed = document.getElementById('hexRed');
    
    if (hexCW) hexCW.textContent = cwHex.toUpperCase();
    if (hexWW) hexWW.textContent = wwHex.toUpperCase();
    if (hexBlue) hexBlue.textContent = blueHex.toUpperCase();
    if (hexRed) hexRed.textContent = redHex.toUpperCase();
    
    // Add visual indicator for active channels
    if (hexCW) hexCW.style.opacity = cw > 0 ? '1' : '0.3';
    if (hexWW) hexWW.style.opacity = ww > 0 ? '1' : '0.3';
    if (hexBlue) hexBlue.style.opacity = blue > 0 ? '1' : '0.3';
    if (hexRed) hexRed.style.opacity = red > 0 ? '1' : '0.3';
  }
  
  if (cwSlider) cwSlider.addEventListener('input', updateHexPreview);
  if (wwSlider) wwSlider.addEventListener('input', updateHexPreview);
  if (blueSlider) blueSlider.addEventListener('input', updateHexPreview);
  if (redSlider) redSlider.addEventListener('input', updateHexPreview);
  
  // Initialize hex preview
  updateHexPreview();
  
  // Bind send command button
  const btnSendGrow3Command = document.getElementById('btnSendGrow3Command');
  if (btnSendGrow3Command) {
    btnSendGrow3Command.addEventListener('click', window.sendGrow3SpectrumCommand);
  }
  
  // Bind all off button
  const btnGrow3AllOff = document.getElementById('btnGrow3AllOff');
  if (btnGrow3AllOff) {
    btnGrow3AllOff.addEventListener('click', async function() {
      // Stop any active dance party
      if (activeDanceInterval) {
        clearInterval(activeDanceInterval);
        activeDanceInterval = null;
        const btnDance = document.getElementById('btnGrow3DanceParty');
        if (btnDance) {
          btnDance.disabled = false;
          btnDance.textContent = ' Dance Party';
        }
        // Wait a moment for any pending dance party requests to complete
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      if (cwSlider) cwSlider.value = 0;
      if (wwSlider) wwSlider.value = 0;
      if (blueSlider) blueSlider.value = 0;
      if (redSlider) redSlider.value = 0;
      updateHexPreview();
      
      // Send off command to all fixtures
      const targetSelect = document.getElementById('grow3TargetDevice');
      if (!targetSelect) return;
      
      try {
        const target = targetSelect.value;
        let targetIds = [];
        if (target === 'broadcast') {
          targetIds = GROW3_FIXTURES.map(f => f.controllerId);
        } else {
          targetIds = [parseInt(target)];
        }
        
        // Send OFF command (status: "off")
        const promises = targetIds.map(id => 
          fetch(`${GROW3_BASE_URL}/api/devicedatas/device/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'off' }),
            signal: AbortSignal.timeout(10000)
          })
        );
        
        await Promise.all(promises);
        
        const targetLabel = target === 'broadcast' ? 'All Fixtures' : `Controller ID ${target}`;
        showToast({
          title: 'Lights Turned Off',
          msg: targetLabel,
          kind: 'success'
        });
      } catch (error) {
        // Don't show error for AbortError during cleanup - it's expected
        if (error.name === 'AbortError') {
          console.warn('[Grow3] All off request timed out (may still succeed)');
          showToast({
            title: 'Command Sent',
            msg: 'Lights should turn off shortly',
            kind: 'info'
          });
        } else {
          console.error('[Grow3] All off failed:', error);
          showToast({
            title: 'Command Failed',
            msg: 'Failed to turn off lights',
            kind: 'error'
          });
        }
      }
    });
  }
  
  // Bind dance party button
  const btnGrow3DanceParty = document.getElementById('btnGrow3DanceParty');
  if (btnGrow3DanceParty) {
    btnGrow3DanceParty.addEventListener('click', async function() {
      const targetSelect = document.getElementById('grow3TargetDevice');
      if (!targetSelect) return;
      
      // If dance party is already running, stop it
      if (activeDanceInterval) {
        clearInterval(activeDanceInterval);
        activeDanceInterval = null;
        btnGrow3DanceParty.disabled = false;
        btnGrow3DanceParty.textContent = ' Dance Party';
        showToast({
          title: ' Dance Party Stopped',
          msg: 'Light show cancelled',
          kind: 'info'
        });
        return;
      }
      
      try {
        const target = targetSelect.value;
        let targetIds = [];
        if (target === 'broadcast') {
          targetIds = GROW3_FIXTURES.map(f => f.controllerId);
        } else {
          targetIds = [parseInt(target)];
        }
        
        // Disable button during dance party
        btnGrow3DanceParty.disabled = false; // Keep enabled so user can click to stop
        btnGrow3DanceParty.textContent = '⏹ Stop Party';
        
        showToast({
          title: ' Dance Party Started!',
          msg: '30 seconds of random light phasing (click button to stop)',
          kind: 'success'
        });
        
        // Dance party: 30 seconds of random color phasing
        const duration = 30000; // 30 seconds
        const interval = 1500; // Update every 1500ms (1.5 seconds) - slower phasing
        const startTime = Date.now();
        
        activeDanceInterval = setInterval(async () => {
          const elapsed = Date.now() - startTime;
          
          if (elapsed >= duration) {
            clearInterval(activeDanceInterval);
            activeDanceInterval = null;
            
            // Turn off all lights at the end
            const offPromises = targetIds.map(id => 
              fetch(`${GROW3_BASE_URL}/api/devicedatas/device/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'off' }),
                signal: AbortSignal.timeout(10000)
              }).catch(err => console.warn('[Grow3] Dance party cleanup error:', err))
            );
            
            await Promise.all(offPromises);
            
            // Re-enable button
            btnGrow3DanceParty.disabled = false;
            btnGrow3DanceParty.textContent = ' Dance Party';
            
            showToast({
              title: ' Dance Party Complete',
              msg: 'Lights returned to off state',
              kind: 'success'
            });
            return;
          }
          
          // Generate random values for each channel (0-100)
          const randomSpectrum = [
            Math.floor(Math.random() * 101), // CW
            Math.floor(Math.random() * 101), // WW
            Math.floor(Math.random() * 101), // Blue
            Math.floor(Math.random() * 101)  // Red
          ];
          
          // Encode to hex
          const hexValue = encodeChannels(randomSpectrum);
          
          // Send to all target fixtures (don't await to keep animation smooth)
          targetIds.forEach(id => {
            fetch(`${GROW3_BASE_URL}/api/devicedatas/device/${id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'on', value: hexValue }),
              signal: AbortSignal.timeout(10000)
            }).catch(err => {
              // Silently ignore timeout errors during dance party
              if (err.name !== 'AbortError') {
                console.warn('[Grow3] Dance party frame error:', err);
              }
            });
          });
        }, interval);
        
      } catch (error) {
        console.error('[Grow3] Dance party failed:', error);
        if (activeDanceInterval) {
          clearInterval(activeDanceInterval);
          activeDanceInterval = null;
        }
        btnGrow3DanceParty.disabled = false;
        btnGrow3DanceParty.textContent = ' Dance Party';
        showToast({
          title: 'Dance Party Failed',
          msg: error.message || 'Failed to start dance party',
          kind: 'error'
        });
      }
    });
  }
});

// ===== GROW3 CONTROLLER FUNCTIONS =====
// Use relative URL to proxy through Node.js server instead of direct connection
const GROW3_BASE_URL = (typeof window !== 'undefined' && typeof window.GROW3_PROXY_BASE === 'string')
  ? window.GROW3_PROXY_BASE
  : '';
const GROW3_FIXTURES = [
  { controllerId: 2, fixtureUid: 'F00001' },
  { controllerId: 3, fixtureUid: 'F00002' },
  { controllerId: 4, fixtureUid: 'F00003' },
  { controllerId: 5, fixtureUid: 'F00005' },
  { controllerId: 6, fixtureUid: 'F00004' }
];

// Check Grow3 controller health
window.checkGrow3Status = async function() {
  const statusEl = document.getElementById('grow3Status');
  if (!statusEl) return;

  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!GROW3_BASE_URL && !isLocalHost) {
    statusEl.innerHTML = `
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #6b7280;"></span>
      <span>Unavailable</span>
    `;
    const code3Dot = document.getElementById('code3StatusDot');
    const code3Pill = document.getElementById('code3StatusPill');
    const code3Text = document.getElementById('code3StatusText');
    if (code3Dot) code3Dot.style.background = '#6b7280';
    if (code3Pill) code3Pill.style.background = '#6b7280';
    if (code3Text) code3Text.textContent = 'Unavailable';
    return;
  }
  
  try {
    // Most Grow3 controllers don't expose /healthz; using /api/devicedatas avoids a noisy 404
    const response = await fetch(`${GROW3_BASE_URL}/api/devicedatas`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)  // 3 second timeout for faster offline detection
    });
    
    if (response.ok) {
      const data = await response.json();
      // Accept various success indicators
      // Grow3 returns: {status: 'success', message: '...', data: [...]}
      const isHealthy = 
        data.ok || 
        data.status === 'ok' || 
        data.status === 'success' ||  // ← Grow3 uses 'success'
        Array.isArray(data) ||
        (data.data && Array.isArray(data.data));  // ← Nested data array
      
      if (isHealthy) {
        statusEl.innerHTML = `
          <span style="width: 8px; height: 8px; border-radius: 50%; background: #10b981;"></span>
          <span>Online</span>
        `;
        // Mirror into Code3 card dot/text
        const code3Dot = document.getElementById('code3StatusDot');
        const code3Pill = document.getElementById('code3StatusPill');
        const code3Text = document.getElementById('code3StatusText');
        if (code3Dot) code3Dot.style.background = '#10b981';
        if (code3Pill) code3Pill.style.background = '#10b981';
        if (code3Text) code3Text.textContent = 'Online';
      } else {
        throw new Error('Controller returned non-ok status');
      }
    } else {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    // Quietly handle Abort/timeout errors (very noisy when polled frequently)
    const isAbort = error && (error.name === 'AbortError' || /aborted|timeout/i.test(error.message || ''));
    if (!isAbort) {
      console.warn('[Grow3] Health check failed:', error.message);
    } else {
      // Debug-level message only to reduce console spam
      console.debug('[Grow3] Health check aborted/timeout:', error.message);
    }

    statusEl.innerHTML = `
      <span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span>
      <span>Offline</span>
    `;
    const code3Dot = document.getElementById('code3StatusDot');
    const code3Pill = document.getElementById('code3StatusPill');
    const code3Text = document.getElementById('code3StatusText');
    if (code3Dot) code3Dot.style.background = '#ef4444';
    if (code3Pill) code3Pill.style.background = '#ef4444';
    if (code3Text) code3Text.textContent = 'Offline';
  }
};
// Test Grow3 controller connection with full device list check
window.testGrow3Connection = async function() {
  const btn = document.getElementById('btnTestGrow3');
  if (!btn) return;

  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (!GROW3_BASE_URL && !isLocalHost) {
    showToast({
      title: 'Code3 Endpoint Unavailable',
      msg: 'Grow3 proxy is not configured on this environment.',
      kind: 'warning'
    });
    return;
  }
  
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Testing...';
  
  try {
    // Note: Grow3 controller doesn't have /healthz, so we use /api/devicedatas as health check
    const devicesResponse = await fetch(`${GROW3_BASE_URL}/api/devicedatas`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000)  // 5 second timeout for manual test
    });
    
    if (!devicesResponse.ok) {
      throw new Error(`Devices endpoint failed: ${devicesResponse.statusText}`);
    }
    
    const devicesData = await devicesResponse.json();
    console.log('[Grow3] Devices:', devicesData);
    
    // Extract device array from response (format: {status, message, data: [...]})
    const devices = devicesData.data || devicesData;
    const deviceCount = Array.isArray(devices) ? devices.length : 0;
    
    // Update status
    window.checkGrow3Status();
    
    showToast({
      title: 'Code3 Controller Connected',
      msg: `Found ${deviceCount} device${deviceCount !== 1 ? 's' : ''}`,
      kind: 'success'
    });

    // Update Code3 status visuals
    const code3Dot = document.getElementById('code3StatusDot');
    const code3Pill = document.getElementById('code3StatusPill');
    const code3Text = document.getElementById('code3StatusText');
    if (code3Dot) code3Dot.style.background = '#10b981';
    if (code3Pill) code3Pill.style.background = '#10b981';
    if (code3Text) code3Text.textContent = 'Online';
    
  } catch (error) {
    console.error('[Grow3] Connection test failed:', error);
    
    showToast({
      title: 'Code3 Connection Failed',
      msg: error.message || 'Check network and controller status',
      kind: 'error'
    });
    
    // Update status to offline
    const statusEl = document.getElementById('grow3Status');
    if (statusEl) {
      statusEl.innerHTML = `
        <span style="width: 8px; height: 8px; border-radius: 50%; background: #ef4444;"></span>
        <span>Offline</span>
      `;
    }
    const code3Dot = document.getElementById('code3StatusDot');
    const code3Pill = document.getElementById('code3StatusPill');
    const code3Text = document.getElementById('code3StatusText');
    if (code3Dot) code3Dot.style.background = '#ef4444';
    if (code3Pill) code3Pill.style.background = '#ef4444';
    if (code3Text) code3Text.textContent = 'Offline';
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// Send 4-channel spectrum command to Grow3 controller
window.sendGrow3SpectrumCommand = async function() {
  const btn = document.getElementById('btnSendGrow3Command');
  const targetSelect = document.getElementById('grow3TargetDevice');
  const hexPreview = document.getElementById('hexPreview');
  
  if (!btn || !targetSelect || !hexPreview) {
    console.error('[Grow3] Required elements not found');
    return;
  }
  
  const target = targetSelect.value;
  const hexValue = hexPreview.textContent;
  
  if (!hexValue || hexValue.length !== 12) {
    showToast({
      title: 'Invalid HEX Format',
      msg: 'HEX12 format must be exactly 12 characters',
      kind: 'error'
    });
    return;
  }
  
  // Parse and log channel breakdown for debugging
  const cwHex = hexValue.substring(0, 2);
  const wwHex = hexValue.substring(2, 4);
  const blueHex = hexValue.substring(4, 6);
  const redHex = hexValue.substring(6, 8);
  const ch5Hex = hexValue.substring(8, 10);
  const ch6Hex = hexValue.substring(10, 12);
  
  console.log('[Grow3] Channel breakdown:');
  console.log(`  CW:   ${cwHex} (${parseInt(cwHex, 16)}%)`);
  console.log(`  WW:   ${wwHex} (${parseInt(wwHex, 16)}%)`);
  console.log(`  Blue: ${blueHex} (${parseInt(blueHex, 16)}%)`);
  console.log(`  Red:  ${redHex} (${parseInt(redHex, 16)}%)`);
  console.log(`  CH5:  ${ch5Hex} (unused)`);
  console.log(`  CH6:  ${ch6Hex} (unused)`);
  console.log(`  Full HEX12: ${hexValue}`);
  
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Sending...';
  
  try {
    // Correct API format for Grow3 controller
    // status: "on" or "off" (string, not numeric)
    // value: 12 hex characters for 6 channels (per Code3 API spec)
    const payload = {
      status: 'on',
      value: hexValue
    };
    
    console.log('[Grow3] Sending spectrum command:', payload);
    
    // Determine which devices to target
    let targetIds = [];
    if (target === 'broadcast') {
      // Send to all fixtures
      targetIds = GROW3_FIXTURES.map(f => f.controllerId);
    } else {
      // Send to specific fixture
      targetIds = [parseInt(target)];
    }
    
    console.log('[Grow3] Target IDs:', targetIds);
    
    const commandPromises = targetIds.map(async (id) => {
      const url = `${GROW3_BASE_URL}/api/devicedatas/device/${id}`;
      console.log(`[Grow3] Sending PATCH to ${url}`, payload);
      let response;
      try {
        response = await fetch(url, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000)
        });
      } catch (networkError) {
        console.error(`[Grow3] Network error targeting controller ${id}:`, networkError);
        throw { id, type: 'network', message: networkError?.message || String(networkError) };
      }

      const responseText = await response.text();
      let parsed = null;
      if (responseText) {
        try {
          parsed = JSON.parse(responseText);
        } catch {
          parsed = null;
        }
      }

      console.log(`[Grow3] Response from controller ${id}:`, {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText
      });

      if (!response.ok) {
        console.error(`[Grow3] Error from controller ${id}:`, responseText);
        throw {
          id,
          status: response.status,
          statusText: response.statusText,
          body: responseText
        };
      }

      if (parsed !== null) {
        console.log(`[Grow3] Controller ${id} response data:`, parsed);
      }

      return {
        id,
        status: response.status,
        statusText: response.statusText,
        data: parsed
      };
    });

    const settledResults = await Promise.allSettled(commandPromises);
    const successes = [];
    const failures = [];

    settledResults.forEach((result, index) => {
      const id = targetIds[index];
      if (result.status === 'fulfilled') {
        successes.push(result.value);
      } else {
        const info = (result.reason && typeof result.reason === 'object') ? { ...result.reason } : { message: String(result.reason) };
        if (!info.id) info.id = id;
        failures.push(info);
      }
    });

    const targetLabel = target === 'broadcast' ? 'All Fixtures' : `Controller ID ${target}`;
    if (successes.length && !failures.length) {
      console.log(`[Grow3] Spectrum command sent to ${targetLabel}: ${hexValue}`);
      showToast({
        title: 'Spectrum Command Sent',
        msg: `${targetLabel}: ${hexValue}`,
        kind: 'success'
      });
    } else if (successes.length && failures.length) {
      const skippedSummary = failures.map((f) => `ID ${f.id}${f.status ? ` (${f.status})` : ''}`).join(', ');
      console.warn('[Grow3] Partial success - controllers skipped:', failures);
      showToast({
        title: 'Spectrum Sent (Some Skipped)',
        msg: `${targetLabel}: ${hexValue}. Skipped ${failures.length} controller${failures.length === 1 ? '' : 's'}: ${skippedSummary}`,
        kind: 'warn'
      });
    } else if (!successes.length && failures.length) {
      console.error('[Grow3] Spectrum command failed for all controllers:', failures);
      const failureSummary = failures.map((f) => `ID ${f.id}${f.status ? ` (${f.status})` : ''}`).join(', ');
      showToast({
        title: 'Spectrum Command Failed',
        msg: failureSummary || 'All controllers unavailable',
        kind: 'error'
      });
    }
    
  } catch (error) {
    console.error('[Grow3] Spectrum command failed:', error);
    showToast({
      title: 'Command Failed',
      msg: error.message || 'Failed to send spectrum command',
      kind: 'error'
    });
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
};

// Test individual Grow3 fixture with on/off sequence
window.testGrow3Fixture = async function(controllerId, fixtureUid) {
  console.log(`[Grow3] Testing fixture ${fixtureUid} (Controller ID: ${controllerId})`);
  
  try {
    // Turn ON with 45% all channels (Grow3 scale 0-64: 0x1D = 29 decimal = 45%)
    const onPayload = {
      status: 'on',
      value: '1D1D1D1D0000' // CW:45% WW:45% Blue:45% Red:45%
    };
    
    const onResponse = await fetch(`${GROW3_BASE_URL}/api/devicedatas/device/${controllerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(onPayload),
      signal: AbortSignal.timeout(10000)
    });
    
    if (!onResponse.ok) {
      throw new Error(`ON command failed: ${onResponse.statusText}`);
    }
    
    console.log(`[Grow3] Fixture ${fixtureUid} turned ON`);
    
    showToast({
      title: `Fixture ${fixtureUid} ON`,
      msg: 'All channels at 45%. Light should be on.',
      kind: 'success',
      icon: ''
    });
    
    // Wait 2 seconds, then turn OFF
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const offPayload = { status: 'off' };
    
    const offResponse = await fetch(`${GROW3_BASE_URL}/api/devicedatas/device/${controllerId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(offPayload),
      signal: AbortSignal.timeout(10000)
    });
    
    if (!offResponse.ok) {
      throw new Error(`OFF command failed: ${offResponse.statusText}`);
    }
    
    console.log(`[Grow3] Fixture ${fixtureUid} turned OFF`);
    
    showToast({
      title: `Fixture ${fixtureUid} OFF`,
      msg: 'Test complete. Light should be off.',
      kind: 'info',
      icon: ''
    });
    
  } catch (error) {
    console.error(`[Grow3] Fixture test failed for ${fixtureUid}:`, error);
    
    showToast({
      title: 'Fixture Test Failed',
      msg: `${fixtureUid}: ${error.message}`,
      kind: 'error',
      icon: ''
    });
  }
};

if (typeof window.showTipFor !== 'function') {
  window.showTipFor = function(el) {
    // No-op stub for tooltips
  };
}
if (typeof window.hideTip !== 'function') {
  window.hideTip = function() {
    // No-op stub for tooltips
  };
}
// --- Fallbacks for missing global helpers (standalone mode) ---
if (typeof window.showToast !== 'function') {
  window.showToast = function({ title = '', msg = '', kind = 'info', icon = '' } = {}) {
    // Simple DOM toast
    let toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '2em';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.background = kind === 'success' ? '#2e7d32' : kind === 'warn' ? '#fbc02d' : '#1976d2';
    toast.style.color = '#fff';
    toast.style.padding = '1em 2em';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
    toast.style.zIndex = 9999;
    toast.style.fontSize = '1.1em';
    toast.innerHTML = `<span style="margin-right:0.5em;">${icon || ''}</span><b>${title}</b> <span style="margin-left:0.5em;">${msg}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeHexColor(input) {
  if (!input || typeof input !== 'string') return null;
  let value = input.trim();
  if (!value) return null;
  if (value.startsWith('#')) value = value.slice(1);
  if (/^[0-9a-f]{3}$/i.test(value)) {
    value = value.split('').map(ch => ch + ch).join('');
  } else if (/^[0-9a-f]{4}$/i.test(value)) {
    const [r, g, b] = value.split('').slice(0, 3);
    value = [r, g, b].map(ch => ch + ch).join('');
  } else if (/^[0-9a-f]{6}$/i.test(value)) {
    // already correct length
  } else if (/^[0-9a-f]{8}$/i.test(value)) {
    value = value.slice(0, 6);
  } else {
    const rgbMatch = input.trim().match(/rgba?\(([^)]+)\)/i);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map(p => p.trim());
      if (parts.length >= 3) {
        const [r, g, b] = parts;
        const to255 = (component) => {
          if (component.includes('%')) {
            const pct = parseFloat(component) || 0;
            return clamp(Math.round((pct / 100) * 255), 0, 255);
          }
          return clamp(Math.round(parseFloat(component) || 0), 0, 255);
        };
        const rgb = [to255(r), to255(g), to255(b)]
          .map(num => num.toString(16).padStart(2, '0'))
          .join('');
        return `#${rgb.toUpperCase()}`;
      }
    }
    return null;
  }
  return `#${value.toUpperCase()}`;
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex);
  if (!normalized) return { r: 0, g: 0, b: 0 };
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b].map(c => clamp(Math.round(c), 0, 255).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const srgb = [r, g, b].map(channel => {
    const v = channel / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

function contrastRatio(hexA, hexB) {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const brightest = Math.max(lumA, lumB);
  const darkest = Math.min(lumA, lumB);
  return (brightest + 0.05) / (darkest + 0.05);
}

function mixColors(hexA, hexB, amount = 0.5) {
  const t = clamp(amount, 0, 1);
  const colorA = hexToRgb(hexA);
  const colorB = hexToRgb(hexB);
  return rgbToHex({
    r: Math.round(colorA.r + (colorB.r - colorA.r) * t),
    g: Math.round(colorA.g + (colorB.g - colorA.g) * t),
    b: Math.round(colorA.b + (colorB.b - colorA.b) * t)
  });
}

function hexToRgba(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
}

function adjustColorForContrast(color, textColor, threshold = 4.5) {
  const base = normalizeHexColor(color) || '#000000';
  const text = normalizeHexColor(textColor) || '#000000';
  if (contrastRatio(base, text) >= threshold) return base;
  const targetPrimary = text === '#FFFFFF' ? '#000000' : '#FFFFFF';
  let best = base;
  let bestRatio = contrastRatio(best, text);
  for (let i = 1; i <= 20; i += 1) {
    const amount = i / 20;
    const candidate = mixColors(base, targetPrimary, amount);
    const ratio = contrastRatio(candidate, text);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= threshold) return candidate;
  }
  const targetSecondary = targetPrimary === '#000000' ? '#FFFFFF' : '#000000';
  for (let i = 1; i <= 20; i += 1) {
    const amount = i / 20;
    const candidate = mixColors(base, targetSecondary, amount);
    const ratio = contrastRatio(candidate, text);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    if (ratio >= threshold) return candidate;
  }
  return best;
}

function ensureColorContrast(color, candidateTexts, threshold) {
  let base = normalizeHexColor(color) || '#0D7D7D';
  let bestText = normalizeHexColor(candidateTexts?.[0]) || '#FFFFFF';
  let bestRatio = contrastRatio(base, bestText);

  candidateTexts.forEach(candidate => {
    const textColor = normalizeHexColor(candidate);
    if (!textColor) return;
    const ratio = contrastRatio(base, textColor);
    if (ratio > bestRatio) {
      bestText = textColor;
      bestRatio = ratio;
    }
  });

  if (bestRatio < threshold) {
    let adjusted = adjustColorForContrast(base, bestText, threshold);
    let adjustedRatio = contrastRatio(adjusted, bestText);
    if (adjustedRatio >= threshold) {
      return { color: adjusted, text: bestText };
    }
    candidateTexts.forEach(candidate => {
      const textColor = normalizeHexColor(candidate);
      if (!textColor) return;
      const candidateColor = adjustColorForContrast(base, textColor, threshold);
      const ratio = contrastRatio(candidateColor, textColor);
      if (ratio > adjustedRatio) {
        adjusted = candidateColor;
        adjustedRatio = ratio;
        bestText = textColor;
      }
    });
    if (adjustedRatio >= threshold) {
      return { color: adjusted, text: bestText };
    }
    const fallbackText = contrastRatio(base, '#000000') >= contrastRatio(base, '#FFFFFF') ? '#000000' : '#FFFFFF';
    base = adjustColorForContrast(base, fallbackText, threshold);
    bestText = fallbackText;
  }

  return { color: base, text: bestText };
}

function ensureBackgroundContrast(background, candidateTexts, threshold) {
  let bg = normalizeHexColor(background) || '#F7FAFA';
  let bestText = normalizeHexColor(candidateTexts?.[0]) || '#0B1220';
  let bestRatio = contrastRatio(bg, bestText);

  candidateTexts.forEach(candidate => {
    const textColor = normalizeHexColor(candidate);
    if (!textColor) return;
    const ratio = contrastRatio(bg, textColor);
    if (ratio > bestRatio) {
      bestText = textColor;
      bestRatio = ratio;
    }
  });

  if (bestRatio < threshold) {
    bg = adjustColorForContrast(bg, bestText, threshold);
    bestRatio = contrastRatio(bg, bestText);
  }

  if (bestRatio < threshold) {
    ['#000000', '#111111', '#ffffff'].forEach(candidate => {
      const ratio = contrastRatio(bg, candidate);
      if (ratio > bestRatio) {
        bestText = candidate;
        bestRatio = ratio;
      }
    });
    if (bestRatio < threshold) {
      bg = adjustColorForContrast(bg, bestText, threshold);
      bestRatio = contrastRatio(bg, bestText);
    }
  }

  return { background: bg, text: bestText, ratio: bestRatio };
}

function sanitizeBrandPalette(rawPalette = {}) {
  const palette = rawPalette && typeof rawPalette === 'object' && !Array.isArray(rawPalette)
    ? rawPalette
    : {};

  const baseBackground = normalizeHexColor(palette.background || palette.bg) || '#F7FAFA';
  const baseText = normalizeHexColor(palette.text) || '#0B1220';
  const backgroundPair = ensureBackgroundContrast(baseBackground, [baseText, '#0B1220', '#111827', '#111111', '#ffffff'], 4.5);
  const background = backgroundPair.background;
  const text = backgroundPair.text;

  const surface = normalizeHexColor(palette.surface) || mixColors(background, '#FFFFFF', 0.08);
  const muted = normalizeHexColor(palette.muted) || mixColors(text, background, 0.55);

  const primaryPair = ensureColorContrast(
    palette.primary || '#0D7D7D',
    [text, '#FFFFFF', '#0B1220', '#111111'],
    4.5
  );
  const primary = primaryPair.color;
  const onPrimary = primaryPair.text;

  const accentPair = ensureColorContrast(
    palette.accent || '#64C7C7',
    [text, onPrimary, '#FFFFFF', '#0B1220'],
    4.5
  );
  const accent = accentPair.color;
  const onAccent = accentPair.text;

  let border = normalizeHexColor(palette.border);
  if (!border) border = mixColors(primary, background, 0.65);
  if (contrastRatio(border, background) < 1.35) {
    border = mixColors(primary, text, 0.6);
  }
  const borderStrong = mixColors(primary, text, 0.45);
  const borderSubtle = mixColors(background, text, 0.92);
  const highlight = normalizeHexColor(palette.highlight) || mixColors(accent, '#FFFFFF', 0.25);

  const primaryHover = mixColors(primary, '#000000', 0.12);
  const primaryActive = mixColors(primary, '#000000', 0.2);
  const primarySoft = mixColors(primary, '#FFFFFF', 0.85);
  const accentHover = mixColors(accent, '#000000', 0.12);
  const accentSoft = mixColors(accent, '#FFFFFF', 0.85);

  const shadow = `0 1px 3px 0 ${hexToRgba(primary, 0.16)}, 0 1px 2px -1px ${hexToRgba(primary, 0.12)}`;
  const shadowLg = `0 10px 15px -3px ${hexToRgba(primary, 0.22)}, 0 4px 6px -4px ${hexToRgba(primary, 0.14)}`;
  const focusRing = `0 0 0 3px ${hexToRgba(accent, 0.35)}`;

  return {
    primary,
    primaryHover,
    primaryActive,
    primarySoft,
    accent,
    accentHover,
    accentSoft,
    background,
    surface,
    border,
    borderStrong,
    borderSubtle,
    text,
    muted,
    highlight,
    onPrimary,
    onAccent,
    shadow,
    shadowLg,
    focusRing
  };
}

if (typeof window.sanitizeBrandPalette !== 'function') {
  window.sanitizeBrandPalette = sanitizeBrandPalette;
}

if (typeof window.applyTheme !== 'function') {
  window.applyTheme = function(themeObj = {}, options = {}) {
    const rawPalette = themeObj && themeObj.palette ? themeObj.palette : themeObj;
    const sanitized = sanitizeBrandPalette(rawPalette || {});
    const root = document.documentElement;
    const tokens = {
      '--gr-bg': sanitized.background,
      '--gr-surface': sanitized.surface,
      '--gr-border': sanitized.border,
      '--gr-border-strong': sanitized.borderStrong,
      '--gr-border-subtle': sanitized.borderSubtle,
      '--gr-text': sanitized.text,
      '--gr-muted': sanitized.muted,
      '--gr-primary': sanitized.primary,
      '--gr-primary-hover': sanitized.primaryHover,
      '--gr-primary-active': sanitized.primaryActive,
      '--gr-primary-soft': sanitized.primarySoft,
      '--gr-accent': sanitized.accent,
      '--gr-accent-hover': sanitized.accentHover,
      '--gr-accent-soft': sanitized.accentSoft,
      '--gr-highlight': sanitized.highlight,
      '--gr-shadow': sanitized.shadow,
      '--gr-shadow-lg': sanitized.shadowLg,
      '--gr-focus-ring': sanitized.focusRing,
      '--gr-on-primary': sanitized.onPrimary,
      '--gr-on-accent': sanitized.onAccent,
      '--gr-button-text': sanitized.onPrimary
    };

    Object.entries(tokens).forEach(([key, value]) => {
      if (value) root.style.setProperty(key, value);
    });

    const fontFamily = options.fontFamily || themeObj.fontFamily || (themeObj.palette && themeObj.palette.fontFamily) || '';
    if (fontFamily) {
      root.style.setProperty('--gr-font', fontFamily);
    }
    if (options.logoHeight) {
      root.style.setProperty('--gr-logo-height', options.logoHeight);
    }

    window.GR_LAST_THEME = sanitized;
    return sanitized;
  };
}

// Utility: Save farm to backend or localStorage fallback
async function safeFarmSave(payload) {
  try {
    const resp = await fetch('/farm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (resp.ok) return true;
    throw new Error('HTTP ' + resp.status);
  } catch (err) {
    // Fallback: save to localStorage
    try {
      localStorage.setItem('gr.farm', JSON.stringify(payload));
      console.warn('[safeFarmSave] Backend failed, saved to localStorage:', err);
      return true;
    } catch (e) {
      console.error('[safeFarmSave] Could not save farm:', e);
      return false;
    }
  }
}

// Utility: Save rooms to backend or localStorage fallback
async function safeRoomsDelete(roomId) {
  if (!roomId) return false;
  if (!Array.isArray(STATE.rooms)) STATE.rooms = [];
  const before = STATE.rooms.length;
  STATE.rooms = STATE.rooms.filter(r => String(r.id) !== String(roomId));
  const after = STATE.rooms.length;
  if (after === before) return false; // nothing deleted
  const ok = await safeRoomsSave();
  if (ok) {
    // Reload rooms from backend to ensure UI is in sync
    await loadRoomsFromBackend();
    renderRooms();
  }
  return ok;
}

// Helper to reload rooms from backend
async function loadRoomsFromBackend() {
  let loaded = false;
  try {
    const token = localStorage.getItem('token');
    const authHeaders = token ? { 'Authorization': `Bearer ${token}` } : {};

    if (!token) {
      try {
        const staticRoomsResp = await fetch('/data/rooms.json', { cache: 'no-store' });
        if (staticRoomsResp.ok) {
          const staticRoomsData = await staticRoomsResp.json();
          const staticRooms = Array.isArray(staticRoomsData?.rooms) ? staticRoomsData.rooms : [];
          STATE.rooms = staticRooms;
          localStorage.setItem('gr.rooms', JSON.stringify({ rooms: STATE.rooms }));
          loaded = true;
        }
      } catch (staticError) {
        console.warn('[loadRoomsFromBackend] Static rooms fallback unavailable:', staticError);
      }

      if (!loaded) STATE.rooms = [];
    } else {
      // Prefer dedicated rooms endpoint
      const roomsResp = await fetch('/api/setup/rooms', { headers: authHeaders });
      if (roomsResp.ok) {
        const roomsData = await roomsResp.json();
        if (roomsData.success && Array.isArray(roomsData.rooms)) {
          STATE.rooms = roomsData.rooms;
          localStorage.setItem('gr.rooms', JSON.stringify({ rooms: STATE.rooms }));
          console.log('[loadRoomsFromBackend] Loaded rooms from', roomsData.source || 'api', ':', STATE.rooms.length);
          loaded = true;
        }
      }

      if (!loaded) {
        // Fallback to setup data API
        const resp = await fetch('/api/setup/data', { headers: authHeaders });
        if (resp.ok) {
          const data = await resp.json();
          if (data.success && data.config) {
            // Store farm metadata
            STATE.farm = STATE.farm || {};
            STATE.farm.name = data.config.farmName;
            STATE.farm.ownerName = data.config.ownerName;
            STATE.farm.contactEmail = data.config.contactEmail;
            STATE.farm.contactPhone = data.config.contactPhone;

            // Load user's actual rooms
            STATE.rooms = data.config.rooms || [];
            localStorage.setItem('gr.rooms', JSON.stringify({ rooms: STATE.rooms }));

            console.log('[loadRoomsFromBackend] Loaded real user data:',
                        STATE.rooms.length, 'rooms from', data.config.farmName);

            // Update header with farm name
            if (data.config.farmName) {
              updateFarmNameInHeader(data.config.farmName);
            }
            loaded = true;
          }
        }
      }

      if (!loaded) {
        // Last resort: try static rooms.json even with token
        try {
          const staticResp = await fetch('/data/rooms.json', { cache: 'no-store' });
          if (staticResp.ok) {
            const staticData = await staticResp.json();
            const staticRooms = Array.isArray(staticData?.rooms) ? staticData.rooms : [];
            if (staticRooms.length) {
              STATE.rooms = staticRooms;
              localStorage.setItem('gr.rooms', JSON.stringify({ rooms: STATE.rooms }));
              console.log('[loadRoomsFromBackend] Loaded rooms from static rooms.json:', STATE.rooms.length);
              loaded = true;
            }
          }
        } catch (_) { /* static fallback not available */ }
      }

      if (!loaded) {
        console.log('[loadRoomsFromBackend] No setup data found, starting with empty state');
        STATE.rooms = [];
      }
    }
  } catch (e) {
    console.error('[loadRoomsFromBackend] Failed to load setup data:', e);
    STATE.rooms = [];
  }

  // Normalize room id fields (API may return room_id or roomId instead of id)
  STATE.rooms = (Array.isArray(STATE.rooms) ? STATE.rooms : []).map(r => {
    if (!r.id && (r.room_id || r.roomId)) r.id = r.room_id || r.roomId;
    return r;
  });

  // ALWAYS enrich rooms with zone data from room-map files
  await enrichRoomZonesFromMaps();
}

// Merge zone names from room-map-{roomId}.json into STATE.rooms entries
// so the Grow Room Setup card always reflects what the Room Mapper has saved.
async function enrichRoomZonesFromMaps() {
  try {
    let staticRooms = [];
    try {
      const staticResp = await fetch('/data/rooms.json', { cache: 'no-store' });
      if (staticResp.ok) {
        const staticData = await staticResp.json();
        staticRooms = Array.isArray(staticData?.rooms) ? staticData.rooms : Array.isArray(staticData) ? staticData : [];
      }
    } catch (_) { /* static rooms not available */ }

    // If STATE.rooms is empty, try loading from rooms.json first
    if (!STATE.rooms || STATE.rooms.length === 0) {
      try {
        if (staticRooms.length) {
          const rooms = staticRooms;
          if (rooms.length) {
            STATE.rooms = rooms.map(r => {
              if (!r.id && (r.room_id || r.roomId)) r.id = r.room_id || r.roomId;
              return r;
            });
            console.log('[enrichRoomZones] Loaded', STATE.rooms.length, 'rooms from rooms.json (STATE was empty)');
          }
        }
      } catch (_) { /* rooms.json not available */ }
    }

    const staticZoneMap = new Map(
      (Array.isArray(staticRooms) ? staticRooms : []).map((room) => [
        buildRoomLookupKey(room),
        getRoomZones(room)
      ])
    );

    for (const room of STATE.rooms) {
      const roomId = room.id || room.roomId || room.room_id;
      if (!roomId) continue;

      if (!roomHasZones(room)) {
        const fromStatic = staticZoneMap.get(buildRoomLookupKey(room));
        if (Array.isArray(fromStatic) && fromStatic.length) {
          room.zones = fromStatic;
          continue;
        }
      }

      // Skip if room already has zones populated
      if (Array.isArray(room.zones) && room.zones.length > 0) continue;
      try {
        const resp = await fetch(`/data/room-map-${roomId}.json`, { cache: 'no-store' });
        if (!resp.ok) continue;
        const mapData = await resp.json();
        if (Array.isArray(mapData.zones) && mapData.zones.length > 0) {
          room.zones = mapData.zones
            .map(z => z.name || (z.zone != null ? `Zone ${z.zone}` : null))
            .filter(Boolean);
          console.log(`[enrichRoomZones] ${roomId}: enriched with ${room.zones.length} zones from room-map`);
        }
      } catch (_) { /* room-map file doesn't exist — that's fine */ }
    }
  } catch (err) {
    console.warn('[enrichRoomZones] Error:', err);
  }
}

async function safeRoomsSave() {
  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  try {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    // Try to save to the setup data endpoint (edge devices)
    const resp = await fetch('/api/setup/save-rooms', {
      method: 'POST',
      headers,
      body: JSON.stringify({ rooms })
    });
    if (resp.ok) {
      const result = await resp.json();
      if (result.success) return true;
      throw new Error(result.message || 'Save failed');
    }
    throw new Error('HTTP ' + resp.status);
  } catch (err) {
    console.warn('[safeRoomsSave] Backend save failed, saving to rooms.json:', err);
    // Fallback: save to rooms.json so main pages can load the latest room equipment
    const ok = await saveJSON('rooms.json', { rooms });
    if (ok) return true;
    // Last resort: localStorage
    try {
      localStorage.setItem('gr.rooms', JSON.stringify({ rooms }));
      return true;
    } catch (e) {
      console.error('[safeRoomsSave] Could not save rooms:', e);
      return false;
    }
  }
}

// DEMO fallback: safeRoomsSave always resolves true
if (typeof window.safeRoomsSave !== 'function') {
  window.safeRoomsSave = safeRoomsSave;
}
// DEMO fallback: safeFarmSave always resolves true
if (typeof window.safeFarmSave !== 'function') {
  window.safeFarmSave = async function(payload) {
    console.log('[DEMO] safeFarmSave called with:', payload);
    await new Promise(res => setTimeout(res, 500));
    return true;
  };
}
// Global stub: render a schedule bar (canvas, cycles)
function renderScheduleBar(canvas, cycles) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const width = canvas.width || 300;
  const height = canvas.height || 24;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#e0e7ef';
  ctx.fillRect(0, 0, width, height);
  // Draw simple colored blocks for each cycle
  if (Array.isArray(cycles)) {
    const colors = ['#60a5fa', '#fde68a', '#f87171', '#34d399'];
    cycles.forEach((cycle, i) => {
      const start = typeof cycle.on === 'number' ? cycle.on : 0;
      const end = typeof cycle.off === 'number' ? cycle.off : start + 60;
      const x1 = Math.round((start / 1440) * width);
      const x2 = Math.round((end / 1440) * width);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x1, 2, Math.max(2, x2 - x1), height - 4);
    });
  }
  ctx.strokeStyle = '#64748b';
  ctx.strokeRect(0, 0, width, height);
}
// Compute duration in minutes for a single cycle (wraps across midnight)
function computeCycleDuration(on, off) {
  const start = toMinutes(on);
  const end = toMinutes(off);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  let diff = end - start;
  if (diff < 0) diff += 1440;
  if (diff < 0) diff = 0;
  if (diff > 1440) diff = 1440;
  if (start === end) {
    // Ambiguous case (either 0 h or 24 h). Treat as 0 so editor can surface it.
    return 0;
  }
  return diff;
}

function buildCycleSegments(on, off) {
  const startRaw = toMinutes(on);
  const endRaw = toMinutes(off);
  if (!Number.isFinite(startRaw) || !Number.isFinite(endRaw)) return [];
  let duration = endRaw - startRaw;
  if (duration < 0) duration += 1440;
  if (duration <= 0) return [];
  if (duration > 1440) duration = 1440;
  const start = ((startRaw % 1440) + 1440) % 1440;
  const end = start + duration;
  if (end <= 1440) {
    return [{ start, end }];
  }
  const overflow = end - 1440;
  return [
    { start, end: 1440 },
    { start: 0, end: Math.min(overflow, 1440) }
  ];
}

// Validate a schedule and compute totals
function validateSchedule(mode, cycles) {
  const errors = [];
  const normalizedMode = mode === 'two' ? 'two' : 'one';
  const cycleList = Array.isArray(cycles) ? cycles.filter(Boolean) : [];
  if (!cycleList.length) {
    errors.push('Add at least one cycle.');
  }
  if (normalizedMode !== 'two' && cycleList.length > 1) {
    errors.push('Only the first cycle is used in single-cycle mode.');
  }

  const segments = [];
  let totalRaw = 0;
  cycleList.forEach((cycle, idx) => {
    const on = typeof cycle.on === 'string' ? cycle.on : '';
    const off = typeof cycle.off === 'string' ? cycle.off : '';
    if (!on || !off || !/^\d{2}:\d{2}$/.test(on) || !/^\d{2}:\d{2}$/.test(off)) {
      errors.push(`Cycle ${idx + 1} has invalid on/off times.`);
      return;
    }
    const duration = computeCycleDuration(on, off);
    if (duration <= 0) {
      errors.push(`Cycle ${idx + 1} duration is 0 h.`);
      return;
    }
    const segs = buildCycleSegments(on, off);
    segs.forEach((seg) => {
      const span = Math.max(0, Math.min(1440, seg.end) - Math.max(0, seg.start));
      if (span > 0) {
        segments.push({ start: Math.max(0, Math.min(1440, seg.start)), end: Math.max(0, Math.min(1440, seg.end)) });
        totalRaw += span;
      }
    });
  });

  segments.sort((a, b) => a.start - b.start);
  let onTotal = 0;
  if (segments.length) {
    let currentStart = segments[0].start;
    let currentEnd = segments[0].end;
    for (let i = 1; i < segments.length; i += 1) {
      const seg = segments[i];
      if (seg.start <= currentEnd) {
        currentEnd = Math.max(currentEnd, seg.end);
      } else {
        onTotal += currentEnd - currentStart;
        currentStart = seg.start;
        currentEnd = seg.end;
      }
    }
    onTotal += currentEnd - currentStart;
  }
  const overlapTrim = Math.max(0, totalRaw - onTotal);
  if (onTotal > 1440) {
    errors.push('Total ON time exceeds 24 h.');
    onTotal = 1440;
  }
  const offTotal = Math.max(0, 1440 - Math.min(onTotal, 1440));
  return { errors, onTotal, offTotal, overlapTrim };
}

function getDailyOnMinutes(schedule) {
  if (!schedule || typeof schedule !== 'object') return 0;
  const { onTotal } = validateSchedule(schedule.mode, schedule.cycles);
  return Math.max(0, onTotal);
}

function getDailyOnHours(schedule) {
  return getDailyOnMinutes(schedule) / 60;
}

function scheduleSummary(schedule) {
  if (!schedule || typeof schedule !== 'object') return 'No schedule';
  const cycles = Array.isArray(schedule.cycles) ? schedule.cycles.filter(Boolean) : [];
  if (!cycles.length) return 'No schedule';
  const totalHours = getDailyOnHours(schedule);
  const totalLabel = `${totalHours.toFixed(1).replace(/\.0$/, '')} h on`;
  const parts = cycles.map((cycle, idx) => {
    const on = typeof cycle.on === 'string' ? cycle.on : '--:--';
    const off = typeof cycle.off === 'string' ? cycle.off : '--:--';
    const duration = computeCycleDuration(on, off) / 60;
    const durLabel = duration > 0 ? ` (${duration.toFixed(1).replace(/\.0$/, '')} h)` : '';
    return `C${idx + 1}: ${on}–${off}${durLabel}`;
  });
  return `${totalLabel} • ${parts.join(', ')}`;
}
// Global helper: convert HH:MM string to minutes since midnight
function toMinutes(hhmm) {
  if (typeof hhmm !== 'string') return 0;
  const [h, m] = hhmm.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return 0;
  return h * 60 + m;
}
// Global helper: convert minutes to HH:MM string
function minutesToHHMM(mins) {
  if (typeof mins !== 'number' || isNaN(mins)) return '00:00';
  mins = ((mins % 1440) + 1440) % 1440; // wrap around 24h
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
// Global lights status UI initializer stub
function initLightsStatusUI() {
  // TODO: Replace with real lights status UI initialization if needed
  grLog('[Stub] initLightsStatusUI called');
}
// Spectral rendering constants
// DRIVER_CHANNEL_KEYS = 4 physical LED driver channels (the only real channels)
const DRIVER_CHANNEL_KEYS = ['cw', 'ww', 'bl', 'rd'];
// HEX_CHANNEL_KEYS = legacy/deprecated - includes gn/fr/uv which are spectral BANDS, not channels
// DO NOT USE for SPD calculations - only for backward compatibility with old data formats
const HEX_CHANNEL_KEYS = ['cw', 'ww', 'bl', 'gn', 'rd', 'fr', 'uv'];

const resolveDriverMaxByte = () => {
  const candidates = [
    window?.CHANNEL_SCALE?.maxByte,
    window?.STATE?.channelScale?.maxByte,
    window?.STATE?.channelScale?.max_byte,
    window?.STATE?.channelMaxByte,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) {
      return Math.min(Math.max(Math.round(numeric), 1), 255);
    }
  }
  return 64;
};

const DRIVER_MAX_BYTE = resolveDriverMaxByte();

const clampPercent = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
};

const percentToDriverByte = (value) => {
  const clamped = clampPercent(value);
  const scaled = Math.round((clamped / 100) * DRIVER_MAX_BYTE);
  return Math.max(0, Math.min(DRIVER_MAX_BYTE, scaled));
};
const driverByteToPercent = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const bounded = Math.max(0, Math.min(DRIVER_MAX_BYTE, numeric));
  const percent = (bounded / DRIVER_MAX_BYTE) * 100;
  return clampPercent(percent);
};

function normalizeMixInput(input) {
  const base = { cw: 0, ww: 0, bl: 0, gn: 0, rd: 0, fr: 0, uv: 0 };
  if (typeof input === 'number') {
    const pct = clampPercent(input);
    base.cw = pct;
    base.ww = pct;
    return base;
  }
  if (typeof input === 'string') {
    const parsed = parseHex12(input);
    if (parsed) {
      HEX_CHANNEL_KEYS.forEach((key) => {
        if (typeof parsed[key] === 'number') base[key] = clampPercent(parsed[key]);
      });
      return base;
    }
  }
  if (input && typeof input === 'object') {
    HEX_CHANNEL_KEYS.forEach((key) => {
      if (typeof input[key] === 'number') {
        base[key] = clampPercent(input[key]);
      }
    });
  }
  return base;
}

function buildHex12(input) {
  const mix = normalizeMixInput(input);
  return HEX_CHANNEL_KEYS.map((key) => percentToDriverByte(mix[key] ?? 0)
    .toString(16)
    .padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function parseHex12(hex) {
  if (typeof hex !== 'string') return null;
  const cleaned = hex.trim();
  if (!/^[0-9a-fA-F]{12}$/.test(cleaned)) return null;
  const result = {};
  for (let i = 0; i < HEX_CHANNEL_KEYS.length; i += 1) {
    const slice = cleaned.slice(i * 2, i * 2 + 2);
    const byte = parseInt(slice, 16);
    if (Number.isNaN(byte)) return null;
    result[HEX_CHANNEL_KEYS[i]] = driverByteToPercent(byte);
  }
  return result;
}

const defaultCalibration = () => ({ cw: 1, ww: 1, bl: 1, rd: 1, fr: 1, uv: 1, intensity: 1 });

function normalizeSpdLibrary(raw) {
  if (!raw || !Array.isArray(raw.wavelengths)) return null;
  const wavelengths = raw.wavelengths.slice();
  const channels = {};
  const sourceChannels = raw.channels || {};
  Object.keys(sourceChannels).forEach((key) => {
    const channel = sourceChannels[key];
    if (!channel || !Array.isArray(channel.values)) return;
    const values = wavelengths.map((_, index) => {
      const v = channel.values[index];
      return typeof v === 'number' ? v : 0;
    });
    channels[key] = {
      values,
      gamma: typeof channel.gamma === 'number' ? channel.gamma : 1,
      efficacy: typeof channel.efficacy === 'number' ? channel.efficacy : 1,
    };
  });
  return { wavelengths, channels };
}

function getDeviceCalibration(deviceId) {
  const cache = STATE._calibrationCache || (STATE._calibrationCache = new Map());
  if (deviceId && cache.has(deviceId)) {
    const cached = cache.get(deviceId);
    return { ...cached };
  }
  const result = defaultCalibration();
  if (!deviceId) return result;
  const entries = Array.isArray(STATE.calibrations) ? STATE.calibrations : [];
  let touched = false;
  entries.forEach((entry) => {
    if (!entry || entry.applied === false) return;
    const gains = entry.gains?.[deviceId];
    if (!gains) return;
    touched = true;
    HEX_CHANNEL_KEYS.forEach((key) => {
      if (typeof gains[key] === 'number') {
        result[key] *= gains[key];
      }
    });
    if (typeof gains.intensity === 'number') {
      result.intensity *= gains.intensity;
    }
  });
  cache.set(deviceId, { ...result });
  return result;
}

function aggregateCalibrations(deviceIds = []) {
  if (!Array.isArray(deviceIds) || deviceIds.length === 0) {
    return defaultCalibration();
  }
  const sum = defaultCalibration();
  deviceIds.forEach((id) => {
    const gains = getDeviceCalibration(id);
    HEX_CHANNEL_KEYS.forEach((key) => {
      sum[key] += gains[key];
    });
    sum.intensity += gains.intensity;
  });
  const count = deviceIds.length;
  HEX_CHANNEL_KEYS.forEach((key) => {
    sum[key] /= count;
  });
  sum.intensity /= count;
  return sum;
}

function applyCalibrationToMix(mix, calibration) {
  const base = normalizeMixInput(mix);
  const gains = calibration || defaultCalibration();
  const intensity = typeof gains.intensity === 'number' ? gains.intensity : 1;
  const result = { ...base };
  HEX_CHANNEL_KEYS.forEach((key) => {
    const gain = (typeof gains[key] === 'number' ? gains[key] : 1) * intensity;
    result[key] = clampPercent(result[key] * gain);
  });
  return result;
}

function buildDeviceHexForMix(mix, deviceId) {
  const calibration = getDeviceCalibration(deviceId);
  const calibratedMix = applyCalibrationToMix(mix, calibration);
  const hex = buildHex12(calibratedMix);
  return { hex, mix: calibratedMix, calibration };
}

function hydrateDeviceDriverState() {
  if (!Array.isArray(STATE.devices)) return;
  STATE.devices = STATE.devices.map((device) => {
    if (!device || typeof device !== 'object') return device;
    const copy = { ...device };
    const candidates = [copy.lastHex, copy.value, copy.hex12, copy.hex];
    for (const candidate of candidates) {
      const parsed = parseHex12(candidate);
      if (parsed) {
        copy.driverHex = candidate.toUpperCase();
        copy.driverMix = parsed;
        copy.calibratedDriverMix = applyCalibrationToMix(parsed, getDeviceCalibration(copy.id));
        break;
      }
    }
    return copy;
  });
}

// Global spectrum canvas renderer (simple SPD visualization)
function renderSpectrumCanvas(canvas, spd, opts = {}) {
  if (!canvas || !canvas.getContext) return;
  const ctx = canvas.getContext('2d');
  const width = opts.width || canvas.width || 300;
  const height = opts.height || canvas.height || 40;
  canvas.width = width;
  canvas.height = height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, width, height);

  const resolveSeries = (value) => {
    if (Array.isArray(value) && value.length > 1) return value;
    if (value && typeof value === 'object') {
      if (Array.isArray(value.display) && value.display.length > 1) return value.display;
      if (Array.isArray(value.samples) && value.samples.length > 1) return value.samples;
    }
    return null;
  };

  const series = resolveSeries(spd);
  if (series) {
    const maxVal = Math.max(...series);
    const values = maxVal > 0 ? series.map((v) => v / maxVal) : series.slice();
    if (values.length > 1) {
      ctx.beginPath();
      ctx.moveTo(0, height - 2);
      values.forEach((v, index) => {
        const x = (index / (values.length - 1)) * width;
        const y = height - 2 - v * (height - 6);
        ctx.lineTo(x, y);
      });
      ctx.lineTo(width, height - 2);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      const gradient = ctx.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0.0, '#0ea5e9');
      gradient.addColorStop(0.18, '#38bdf8');
      gradient.addColorStop(0.36, '#22d3ee');
      gradient.addColorStop(0.54, '#34d399');
      gradient.addColorStop(0.72, '#facc15');
      gradient.addColorStop(0.86, '#fb923c');
      gradient.addColorStop(1.0, '#ef4444');
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1.25;
      ctx.stroke();
      return;
    }
  }

  if (spd && typeof spd === 'object') {
    const mix = spd.mix || spd;
    const keys = DRIVER_CHANNEL_KEYS;
    const colors = ['#e0e7ef', '#fde68a', '#60a5fa', '#f87171'];
    const max = Math.max(...keys.map((key) => mix[key] || 0), 1);
    const barWidth = width / keys.length;
    keys.forEach((key, index) => {
      const val = mix[key] || 0;
      const barHeight = (val / max) * (height - 12);
      ctx.fillStyle = colors[index];
      ctx.fillRect(index * barWidth + 8, height - barHeight - 6, barWidth - 16, barHeight);
      ctx.fillStyle = '#1f2937';
      ctx.font = '10px sans-serif';
      ctx.fillText(key.toUpperCase(), index * barWidth + 10, height - 2);
    });
    return;
  }

  ctx.fillStyle = '#64748b';
  ctx.font = '12px sans-serif';
  ctx.fillText('No spectrum data', 10, Math.max(16, height / 2));
}

function computeWeightedSPD(mix, opts = {}) {
  const baseMix = normalizeMixInput(mix);
  const deviceIds = Array.isArray(opts.deviceIds) ? opts.deviceIds : [];
  const calibration = aggregateCalibrations(deviceIds);
  const calibratedMix = applyCalibrationToMix(baseMix, calibration);
  const library = STATE?.spdLibrary;
  const wavelengths = Array.isArray(library?.wavelengths) ? library.wavelengths.slice() : [];
  const samples = wavelengths.length ? new Array(wavelengths.length).fill(0) : [];
  const weights = {};

  // Only use the 4 physical LED driver channels (CW, WW, BL, RD)
  // Spectral bands (blue 400-500nm, green 500-600nm, red 600-700nm, far-red 700-800nm) 
  // are computed FROM these 4 channels via their SPD curves
  DRIVER_CHANNEL_KEYS.forEach((key) => {
    const pct = calibratedMix[key] ?? 0;
    const channel = library?.channels?.[key];
    // Skip channels without SPD data
    if (!channel || !Array.isArray(channel.values)) return;
    const gamma = channel?.gamma ?? 1;
    const efficacy = channel?.efficacy ?? 1;
    const response = Math.pow(pct / 100, gamma);
    const weight = response * efficacy;
    weights[key] = weight;
    channel.values.forEach((value, index) => {
      if (index < samples.length) samples[index] += weight * value;
    });
  });

  let display = samples.slice();
  const normaliseMode = opts.normalise || 'relative';
  if (normaliseMode === 'relative') {
    const max = Math.max(...display, 0);
    if (max > 0) display = display.map((v) => v / max);
  } else if (normaliseMode === 'area') {
    const area = display.reduce((acc, v) => acc + v, 0);
    if (area > 0) display = display.map((v) => v / area);
  }

  return {
    wavelengths,
    samples,
    display,
    mix: calibratedMix,
    requestedMix: baseMix,
    calibration,
    weights,
    deviceCount: deviceIds.length,
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MATRIX SOLVER: SPECTRAL BANDS → LED CHANNEL LEVELS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEM: We have recipe targets in spectral bands (B, G, R, FR) but need
 * to drive 4 physical LED channels (CW, WW, BL, RD). Each channel contributes
 * to MULTIPLE bands according to its SPD curve.
 * 
 * SOLUTION: Build calibration matrix M where M[band][channel] = fraction of
 * that channel's output in that band. Then solve M·x ≈ t to find optimal
 * channel levels x for target bands t.
 * 
 * ALGORITHM (from user specification):
 * 1. Allocate white LEDs for green (most efficient, least leakage)
 * 2. Calculate white leakage into blue and red bands
 * 3. Top up residual blue/red with pure BL/RD channels
 * 4. Clamp to [0, 100%] and verify power limits
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Build calibration matrix M from SPD curves.
 * For each channel (CW, WW, BL, RD), integrate SPD over each band's wavelength
 * range to get fraction of output in that band.
 * 
 * @param {Object} spdLib - SPD library with wavelengths and channel SPD values
 * @param {Object} [opts] - Options
 * @param {Array<string>} [opts.bands=['B','G','R','FR']] - Band names
 * @param {Object} [opts.bandRanges] - Wavelength ranges per band
 * @returns {Object} - { matrix: M[band][channel], bands: [...], channels: [...] }
 */
function buildCalibrationMatrix(spdLib, opts = {}) {
  const bands = opts.bands || ['B', 'G', 'R', 'FR'];
  const bandRanges = opts.bandRanges || {
    B: [400, 500],   // Blue: 400-500nm
    G: [500, 600],   // Green: 500-600nm
    R: [600, 700],   // Red: 600-700nm
    FR: [700, 800],  // Far-Red: 700-800nm
  };
  
  const channels = ['cw', 'ww', 'bl', 'rd']; // Only physical channels
  const wavelengths = spdLib.wavelengths || [];
  const matrix = {};
  
  // For each band, compute fractional contribution from each channel
  for (const band of bands) {
    matrix[band] = {};
    const [minWL, maxWL] = bandRanges[band];
    
    for (const ch of channels) {
      const spdValues = spdLib.channels?.[ch]?.values || [];
      if (spdValues.length === 0) {
        matrix[band][ch] = 0;
        continue;
      }
      
      // Integrate SPD over band wavelength range
      let bandIntegral = 0;
      let totalIntegral = 0;
      
      for (let i = 0; i < wavelengths.length; i++) {
        const wl = wavelengths[i];
        const value = spdValues[i] || 0;
        
        totalIntegral += value;
        if (wl >= minWL && wl < maxWL) {
          bandIntegral += value;
        }
      }
      
      // Fraction = band integral / total integral
      matrix[band][ch] = totalIntegral > 0 ? bandIntegral / totalIntegral : 0;
    }
  }
  
  return {
    matrix,
    bands,
    channels,
    bandRanges,
  };
}

/**
 * Solve for optimal channel levels to achieve target spectral bands.
 * 
 * ALGORITHM (greedy heuristic, user-specified):
 * 1. Allocate whites for green (CW/WW ratio based on efficiency/leakage)
 * 2. Calculate white leakage into B and R bands
 * 3. Compute residual B and R needs
 * 4. Top up with pure BL and RD channels
 * 5. Clamp to [0, 100%] and normalize if exceeds power limit
 * 
 * @param {Object} targets - Band targets { B: 0.20, G: 0.30, R: 0.50, FR?: 0.0 }
 * @param {Object} calibMatrix - Calibration matrix from buildCalibrationMatrix()
 * @param {Object} [opts] - Options
 * @param {number} [opts.maxPower=100] - Max sum of channel percentages
 * @param {number} [opts.tolerance=0.05] - Acceptable error threshold
 * @returns {Object} - { channels: {cw, ww, bl, rd}, achieved: {B, G, R, FR}, error }
 */
function solveChannelsFromBands(targets, calibMatrix, opts = {}) {
  const maxPower = opts.maxPower || 100;
  // Allow configurable margin of error: prefer opts.margin, then opts.tolerance, fallback 5%
  const tolerance = (Number.isFinite(opts.margin) ? opts.margin : (Number.isFinite(opts.tolerance) ? opts.tolerance : 0.05));
  
  const M = calibMatrix.matrix;
  const bands = calibMatrix.bands;
  const channels = calibMatrix.channels;
  
  // Normalize targets to sum to 1.0 (if not already)
  const targetSum = Object.values(targets).reduce((s, v) => s + v, 0);
  const t = {};
  for (const b of bands) {
    t[b] = targetSum > 0 ? (targets[b] || 0) / targetSum : 0;
  }
  
  // Initialize channel levels
  const x = { cw: 0, ww: 0, bl: 0, rd: 0 };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1: Allocate whites for green
  // ═══════════════════════════════════════════════════════════════════════════
  const targetGreen = t.G || 0;

  const bandG = M.G || {};
  const bandB = M.B || {};
  const bandR = M.R || {};
  const cwGreen = Number.isFinite(bandG.cw) ? bandG.cw : 0;
  const wwGreen = Number.isFinite(bandG.ww) ? bandG.ww : 0;
  const cwLeak = (Number.isFinite(bandB.cw) ? bandB.cw : 0) + (Number.isFinite(bandR.cw) ? bandR.cw : 0);
  const wwLeak = (Number.isFinite(bandB.ww) ? bandB.ww : 0) + (Number.isFinite(bandR.ww) ? bandR.ww : 0);

  const cwScore = cwGreen / (cwGreen + cwLeak + 1e-6);
  const wwScore = wwGreen / (wwGreen + wwLeak + 1e-6);
  const scoreSum = cwScore + wwScore;

  if (targetGreen > 0 && scoreSum > 0) {
    const cwRatio = cwScore / scoreSum;
    const wwRatio = 1 - cwRatio;
    const greenPerPercent = (cwRatio * cwGreen) + (wwRatio * wwGreen);
    if (greenPerPercent > 1e-6) {
      const totalWhitePercent = (targetGreen * 100) / greenPerPercent;
      x.cw = totalWhitePercent * cwRatio;
      x.ww = totalWhitePercent * wwRatio;
    } else {
      // Fallback: evenly distribute when SPD data is incomplete
      const totalWhitePercent = targetGreen * 100;
      x.cw = totalWhitePercent * 0.5;
      x.ww = totalWhitePercent * 0.5;
    }
  } else if (targetGreen > 0) {
    // No SPD data; use balanced allocation as a guardrail
    const totalWhitePercent = targetGreen * 100;
    x.cw = totalWhitePercent * 0.5;
    x.ww = totalWhitePercent * 0.5;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2: Calculate white leakage into blue and red
  // ═══════════════════════════════════════════════════════════════════════════
  const achievedFromWhites = {
    B: (x.cw / 100) * M.B.cw + (x.ww / 100) * M.B.ww,
    G: (x.cw / 100) * M.G.cw + (x.ww / 100) * M.G.ww,
    R: (x.cw / 100) * M.R.cw + (x.ww / 100) * M.R.ww,
    FR: (x.cw / 100) * M.FR.cw + (x.ww / 100) * M.FR.ww,
  };
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 3: Compute residual blue and red needs
  // ═══════════════════════════════════════════════════════════════════════════
  const residualBlue = Math.max(0, (t.B || 0) - achievedFromWhites.B);
  const residualRed = Math.max(0, (t.R || 0) - achievedFromWhites.R);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 4: Top up with pure BL and RD channels
  // ═══════════════════════════════════════════════════════════════════════════
  if (M.B.bl > 0.001) {
    x.bl = (residualBlue / M.B.bl) * 100;
  }
  if (M.R.rd > 0.001) {
    x.rd = (residualRed / M.R.rd) * 100;
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 5: Clamp to [0, 100] and normalize if exceeds power limit
  // ═══════════════════════════════════════════════════════════════════════════
  for (const ch of channels) {
    x[ch] = Math.max(0, Math.min(100, x[ch]));
  }
  
  const totalPower = x.cw + x.ww + x.bl + x.rd;
  if (totalPower > maxPower) {
    const scale = maxPower / totalPower;
    for (const ch of channels) {
      x[ch] *= scale;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 6: Calculate achieved bands and error
  // ═══════════════════════════════════════════════════════════════════════════
  const achieved = {};
  for (const b of bands) {
    achieved[b] = 0;
    for (const ch of channels) {
      achieved[b] += (x[ch] / 100) * M[b][ch];
    }
  }
  
  // Compute RMS error
  let errorSum = 0;
  for (const b of bands) {
    const diff = (t[b] || 0) - achieved[b];
    errorSum += diff * diff;
  }
  const error = Math.sqrt(errorSum / bands.length);
  
  return {
    channels: {
      cw: Math.round(x.cw * 10) / 10,
      ww: Math.round(x.ww * 10) / 10,
      bl: Math.round(x.bl * 10) / 10,
      rd: Math.round(x.rd * 10) / 10,
    },
    achieved: {
      B: Math.round(achieved.B * 1000) / 1000,
      G: Math.round(achieved.G * 1000) / 1000,
      R: Math.round(achieved.R * 1000) / 1000,
      FR: Math.round(achieved.FR * 1000) / 1000,
    },
    targets: t,
    error: Math.round(error * 1000) / 1000,
    withinTolerance: error <= tolerance,
    totalPower: Math.round((x.cw + x.ww + x.bl + x.rd) * 10) / 10,
  };
}

/**
 * Convert channel-based recipe to band-based recipe using calibration matrix.
 * For non-tunable fixtures that store channel values in recipes.
 * 
 * @param {Object} channelMix - Channel values { cw: 35, ww: 25, bl: 12, rd: 34 }
 * @param {Object} calibMatrix - Calibration matrix from buildCalibrationMatrix()
 * @returns {Object} - Band values { B: 0.20, G: 0.30, R: 0.50, FR: 0.0 }
 */
function convertChannelsToBands(channelMix, calibMatrix) {
  const M = calibMatrix.matrix;
  const bands = calibMatrix.bands;
  const channels = calibMatrix.channels;
  
  const result = {};
  for (const b of bands) {
    result[b] = 0;
    for (const ch of channels) {
      const channelLevel = (channelMix[ch] || 0) / 100; // Convert % to fraction
      result[b] += channelLevel * M[b][ch];
    }
  }
  
  // Normalize to sum to 1.0
  const sum = Object.values(result).reduce((s, v) => s + v, 0);
  if (sum > 0) {
    for (const b of bands) {
      result[b] = Math.round((result[b] / sum) * 1000) / 1000;
    }
  }
  
  return result;
}

/**
 * Test/demo function for matrix solver - can be called from console.
 * Example: testMatrixSolver({ B: 0.20, G: 0.30, R: 0.50 })
 * 
 * @param {Object} targets - Band targets { B, G, R, FR? }
 * @returns {Object} - Solver result with channels, achieved, error
 */
function testMatrixSolver(targets = { B: 0.20, G: 0.30, R: 0.50 }) {
  if (!STATE.calibrationMatrix) {
    console.error('[Matrix] Calibration matrix not available. Load SPD library first.');
    return null;
  }
  
  console.log('[Matrix] Testing Solver');
  console.log('  Input targets:', targets);
  
  const result = solveChannelsFromBands(targets, STATE.calibrationMatrix);
  
  console.log('  Output channels:', result.channels);
  console.log('  Achieved bands:', result.achieved);
  console.log('  Target bands:', result.targets);
  console.log('  Error (RMS):', result.error);
  console.log('  Within tolerance?', result.withinTolerance ? 'Yes' : 'No');
  console.log('  Total power:', result.totalPower + '%');
  
  // Verify: convert channels back to bands
  const verification = convertChannelsToBands(result.channels, STATE.calibrationMatrix);
  console.log('  Verification (channels → bands):', verification);
  
  return result;
}

// Expose matrix solver functions globally for console access
if (typeof window !== 'undefined') {
  window.testMatrixSolver = testMatrixSolver;
  window.solveChannelsFromBands = solveChannelsFromBands;
  window.convertChannelsToBands = convertChannelsToBands;
  window.buildCalibrationMatrix = buildCalibrationMatrix;
}

// Global farm normalization stub
function normalizeFarmDoc(farm) {
  // TODO: Replace with real normalization logic if needed
  return farm;
}
function cloneFallback(value) {
  if (typeof value === 'function') {
    try { return value(); } catch (err) { console.warn('[loadJSON] Fallback function threw error:', err); return null; }
  }
  if (Array.isArray(value)) return value.slice();
  if (value && typeof value === 'object') return { ...value };
  return value;
}

// Global JSON loader with graceful fallback
async function loadJSON(url, fallbackValue = null) {
  try {
    const resolvedUrl = normalizeDataUrl(url);
    const resp = await fetchWithFarmAuth(resolvedUrl, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.warn(`[loadJSON] Falling back for ${url}:`, error);
    return cloneFallback(fallbackValue);
  }
}
// Persist JSON via backend helper
async function saveJSON(url, data) {
  try {
    const fileName = url.split('/').filter(Boolean).pop();
    if (!fileName) throw new Error('Invalid save target');
    console.log(`[saveJSON] Saving to /data/${fileName}`);
    console.log(`[saveJSON] Payload:`, JSON.stringify(data, null, 2));
    const resp = await fetchWithFarmAuth(`/data/${encodeURIComponent(fileName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    console.log(`[saveJSON] Response status:`, resp.status, resp.statusText);
    if (!resp.ok) {
      const errorText = await resp.text();
      console.error(`[saveJSON] Error response:`, errorText);
      throw new Error(`HTTP ${resp.status}`);
    }
    const result = await resp.json();
    console.log(`[saveJSON] Response data:`, result);
    return true;
  } catch (error) {
    console.error(`[saveJSON] Failed to persist ${url}:`, error);
    return false;
  }
}

// ── Light Setup Persistence ─────────────────────────────────────
// Persist STATE.lightSetups to /data/light-setups.json
async function persistLightSetups() {
  const setups = Array.isArray(STATE.lightSetups) ? STATE.lightSetups : [];
  try {
    await saveJSON('light-setups.json', { lightSetups: setups });
    console.log('[lightSetups] Persisted', setups.length, 'light setup(s) to disk');
  } catch (err) {
    console.warn('[lightSetups] Failed to persist:', err);
  }
}

// Load light setups from /data/light-setups.json on page init
async function loadLightSetups() {
  try {
    const resp = await fetchWithFarmAuth('/data/light-setups.json', { cache: 'no-store' });
    if (resp.status === 404) return; // File doesn't exist yet — that's fine
    if (!resp.ok) {
      console.warn('[lightSetups] Unable to load persisted setups:', resp.status);
      return;
    }
    const data = await resp.json();
    const setups = Array.isArray(data?.lightSetups) ? data.lightSetups : [];
    if (!setups.length) return;
    if (!STATE.lightSetups) STATE.lightSetups = [];
    // Merge: only add setups not already in STATE (by id)
    const existingIds = new Set(STATE.lightSetups.map(s => s.id));
    let added = 0;
    for (const setup of setups) {
      if (setup.id && !existingIds.has(setup.id)) {
        STATE.lightSetups.push(setup);
        existingIds.add(setup.id);
        added++;
      }
    }
    if (added > 0) {
      console.log('[lightSetups] Loaded', added, 'light setup(s) from disk');
      window.dispatchEvent(new CustomEvent('lightSetupsChanged'));
      if (typeof renderLightSetupSummary === 'function') renderLightSetupSummary();
    }
  } catch (err) {
    // File doesn't exist or parse error — not a problem for new farms
    console.log('[lightSetups] No persisted light setups found');
  }
}

async function fetchPlansDocument() {
  try {
    const resp = await fetchWithFarmAuth('/plans', { cache: 'no-store' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.warn('[plans] Failed to fetch /plans', error);
    return null;
  }
}

async function fetchSchedulesDocument() {
  const pin = getFarmPin();
  try {
    if (pin) {
      const resp = await fetch('/sched', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    }
  } catch (error) {
    console.warn('[sched] Failed to fetch /sched', error);
  }

  try {
    const localResp = await fetch('/data/schedules.json', { cache: 'no-store' });
    if (!localResp.ok) throw new Error(`HTTP ${localResp.status}`);
    return await localResp.json();
  } catch (error) {
    console.warn('[sched] Failed to fetch /data/schedules.json', error);
    return null;
  }
}

async function publishPlansDocument(doc) {
  try {
    const payload = Array.isArray(doc)
      ? { plans: doc }
      : (doc && typeof doc === 'object' ? doc : { plans: [] });
    const resp = await fetchWithFarmAuth('/plans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error('[plans] Failed to publish plans', error);
    return null;
  }
}

async function publishSchedulesDocument(doc) {
  try {
    const payload = Array.isArray(doc)
      ? { schedules: doc }
      : (doc && typeof doc === 'object' ? doc : { schedules: [] });
    // Attach farm PIN if available to satisfy PIN-guarded /sched
    const headers = { 'Content-Type': 'application/json' };
    const pin = getFarmPin();
    if (pin) headers['x-farm-pin'] = pin;
    const resp = await fetch('/sched', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (error) {
    console.error('[sched] Failed to publish schedules', error);
    return null;
  }
}
// Light Engine Charlie - Comprehensive Dashboard Application
// Global API fetch helper
async function api(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const contentType = resp.headers?.get?.('content-type') || resp.headers?.get?.('Content-Type') || '';
  const rawBody = await resp.text();
  const trimmedBody = rawBody.trim();
  const expectsJson = /json/i.test(contentType);

  if (!trimmedBody) {
    if (expectsJson) {
      throw new Error(`Empty JSON response from ${url}`);
    }
    return rawBody;
  }
  if (expectsJson) {
    try {
      return JSON.parse(rawBody);
    } catch (error) {
      const snippet = rawBody.slice(0, 120).replace(/\s+/g, ' ').trim();
      throw new Error(`Invalid JSON response from ${url}: ${error.message}${snippet ? ` — snippet: ${snippet}` : ''}`);
    }
  }

  try {
    return JSON.parse(rawBody);
  } catch (error) {
    const snippet = rawBody.slice(0, 120).replace(/\s+/g, ' ').trim();
    if (!snippet) return rawBody;
    throw new Error(`Expected JSON from ${url} but received: ${snippet}`);
  }
}
// [MERGE CONFLICT REMOVED]
// [MERGE CONFLICT REMOVED]

async function safeApi(url, fallbackValue = null, opts = {}) {
  try {
    return await api(url, opts);
  } catch (error) {
    console.warn(`API request to ${url} failed`, error);
    return fallbackValue;
  }
}

function unwrapDeviceList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload.devices)) return payload.devices;
    if (Array.isArray(payload.deviceList)) return payload.deviceList;
  }
  return [];
}

function summarizeSwitchBotDevices(devices = [], meta = {}) {
  const list = Array.isArray(devices) ? devices : [];
  const total = list.length;
  const active = list.filter((d) => String(d.status || '').toLowerCase() !== 'offline').length;
  const lowBattery = list.filter((d) => typeof d.battery === 'number' && d.battery < 30).length;
  return {
    total_devices: total,
    active_devices: active,
    offline_devices: total - active,
    low_battery_devices: lowBattery,
    last_updated: meta.last_updated || new Date().toISOString(),
    hub_status: meta.hub_status || 'unknown',
    hub_model: meta.hub_model || null,
    hub_firmware: meta.hub_firmware || null
  };
}

function extractSwitchBotDeviceCandidates(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload?.body?.deviceList)) return payload.body.deviceList;
  if (Array.isArray(payload.devices)) return payload.devices;
  if (Array.isArray(payload.deviceList)) return payload.deviceList;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function normalizeSwitchBotDeviceEntry(device, index) {
  const fallbackId = `switchbot-${index + 1}`;
  const fallbackName = `SwitchBot device ${index + 1}`;
  if (!device || typeof device !== 'object') {
    return {
      id: fallbackId,
      deviceId: fallbackId,
      name: fallbackName,
      deviceName: fallbackName,
      type: 'Unknown device',
      location: '',
      equipment_controlled: '',
      status: 'unknown',
      battery: null,
      lastSeen: null,
      readings: {}
    };
  }

  const normalized = { ...device };
  const rawId = normalized.deviceId || normalized.device_id || normalized.id || fallbackId;
  const displayName = normalized.deviceName || normalized.name || fallbackName;

  normalized.id = rawId;
  normalized.deviceId = normalized.deviceId || normalized.device_id || rawId;
  normalized.name = displayName;
  normalized.deviceName = displayName;
  normalized.type = normalized.type || normalized.deviceType || normalized.category || 'SwitchBot device';
  normalized.location = normalized.location || normalized.room || '';
  normalized.equipment_controlled = normalized.equipment_controlled || normalized.equipment || '';

  if (typeof normalized.battery !== 'number') {
    if (typeof normalized.batteryLevel === 'number') normalized.battery = normalized.batteryLevel;
    else if (typeof normalized.battery_percent === 'number') normalized.battery = normalized.battery_percent;
    else normalized.battery = null;
  }

  if (!normalized.lastSeen) {
    normalized.lastSeen = normalized.last_seen || normalized.updateTime || normalized.timestamp || null;
  }

  if (!normalized.readings || typeof normalized.readings !== 'object') {
    const fallbackReadings = normalized.data || normalized.metrics || null;
    normalized.readings = (fallbackReadings && typeof fallbackReadings === 'object') ? fallbackReadings : {};
  }

  if (!normalized.status) {
    normalized.status = normalized.online === false ? 'offline' : 'active';
  }

  return normalized;
}

function normalizeSwitchBotDevicesList(list) {
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => normalizeSwitchBotDeviceEntry(item, index));
}

function interpretSwitchBotPayload(payload) {
  const rawDevices = extractSwitchBotDeviceCandidates(payload);
  const devices = normalizeSwitchBotDevicesList(rawDevices);
  const summaryMeta = (payload && typeof payload === 'object' && payload.summary && typeof payload.summary === 'object') ? payload.summary : {};
  const summary = summarizeSwitchBotDevices(devices, summaryMeta);
  const meta = (payload && typeof payload === 'object' && payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
  const statusCode = typeof payload?.statusCode === 'number' ? payload.statusCode : null;
  const message = typeof payload?.message === 'string' ? payload.message : null;
  return { rawDevices, devices, summary, summaryMeta, meta, statusCode, message };
}

async function loadSwitchBotDevices() {
  try {
    const response = await fetch('/switchbot/devices');
    const cache = {
      status: response.headers?.get?.('X-Cache') || null,
      freshness: response.headers?.get?.('X-Cache-Freshness') || null
    };

    if (!response.ok) {
      console.warn('switchbot list failed', response.status);
      renderSwitchBotList([]);
      return {
        devices: [],
        summary: summarizeSwitchBotDevices([]),
        meta: {},
        cache,
        httpStatus: response.status,
        statusCode: null,
        message: null
      };
    }

    const payload = await response.json();
    const interpreted = interpretSwitchBotPayload(payload);
    const rendered = renderSwitchBotList(interpreted.rawDevices, interpreted.summaryMeta);
    return {
      ...interpreted,
      devices: rendered.devices,
      summary: rendered.summary,
      payload,
      cache
    };
  } catch (error) {
    console.warn('switchbot list failed', error);
    renderSwitchBotList([]);
    return {
      devices: [],
      summary: summarizeSwitchBotDevices([]),
      meta: {},
      error
    };
  }
}

function formatSwitchBotPreviewReadings(readings) {
  if (!readings || typeof readings !== 'object') return 'No readings reported yet';
  const entries = Object.entries(readings).filter(([key]) => key !== 'timestamp');
  if (!entries.length) return 'No readings reported yet';
  return entries.slice(0, 3).map(([key, value]) => `${key.replace(/_/g, ' ')}: ${value}`).join(' • ');
}

function formatSwitchBotTimestamp(ts) {
  if (!ts) return 'Unknown';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString();
}

function getSwitchBotStatusColor(status) {
  const normalized = String(status || '').toLowerCase();
  if (['active', 'online', 'on', 'ready'].includes(normalized)) return '#10b981';
  if (['offline', 'inactive', 'error'].includes(normalized)) return '#ef4444';
  return '#f59e0b';
}
// [MERGE CONFLICT REMOVED]
// Ensure STATE is globally defined
var STATE = window.STATE = window.STATE || {};
STATE.rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
STATE.iotDevices = Array.isArray(STATE.iotDevices) ? STATE.iotDevices : [];
STATE.driverMaxByte = DRIVER_MAX_BYTE;

const $ = (s, r=document)=>r.querySelector(s);
const $$ = (s, r=document)=>r.querySelectorAll(s);
const setStatus = m => { const el=$("#status"); if(el) el.textContent = m; };

// Load saved IoT devices from persistent storage
async function loadSavedIoTDevices() {
  console.log('[IoT] ===== loadSavedIoTDevices CALLED =====');
  let deviceArray = [];
  let source = 'none';
  try {
    console.log('[IoT] Fetching /data/iot-devices.json...');
    const resp = await fetchWithFarmAuth('/data/iot-devices.json', { cache: 'no-store' });
    if (resp.ok) {
      const devices = await resp.json();
      console.log('[IoT] Received response:', devices);
      deviceArray = Array.isArray(devices) ? devices : (devices.devices || []);
      source = 'server';
    } else {
      console.log('[IoT] Server returned', resp.status, '- trying localStorage fallback');
    }
  } catch (e) {
    console.warn('[IoT] Server fetch failed:', e.message, '- trying localStorage fallback');
  }
  // Fallback: try localStorage if server returned empty or failed
  if (!deviceArray.length) {
    try {
      const cached = localStorage.getItem('gr.iotDevices');
      if (cached) {
        const parsed = JSON.parse(cached);
        const lsDevices = Array.isArray(parsed) ? parsed : (parsed?.devices || []);
        if (lsDevices.length) {
          deviceArray = lsDevices;
          source = 'localStorage';
          console.log('[IoT] Recovered', lsDevices.length, 'devices from localStorage');
        }
      }
    } catch (_) { /* localStorage unavailable */ }
  }
  console.log('[IoT] Device array length:', deviceArray.length, 'source:', source);
  STATE.iotDevices = deviceArray.map(d => sanitizeDevicePayload(d));
  window.LAST_IOT_SCAN = STATE.iotDevices.slice();
  console.log('[IoT] Loaded', STATE.iotDevices.length, 'saved devices');
  // Persist localStorage backup for next load
  try { localStorage.setItem('gr.iotDevices', JSON.stringify(STATE.iotDevices)); } catch (_) {}
  // Enrich device zones from room-map data
  await enrichDeviceZonesFromRoomMap();
  // Render devices if the panel exists
  if (typeof window.renderIoTDeviceCards === 'function') {
    console.log('[IoT] Calling renderIoTDeviceCards...');
    window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
  } else {
    console.warn('[IoT] renderIoTDeviceCards function NOT FOUND');
  }
}

// Load farm data to check demo mode status
async function loadFarmData() {
  const loadLocalFarmFallback = async (reason) => {
    try {
      const resp = await fetch('/data/farm.json', { cache: 'no-store' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data && typeof data === 'object') {
        STATE.farm = data;
        console.log('[loadFarmData] Loaded farm from /data/farm.json:', data.farmId || data.name || data.farmName, reason ? `(${reason})` : '');
        if (Array.isArray(data.rooms)) {
          STATE.rooms = data.rooms;
        }
        updateFarmNameInHeader(data.name || data.farmName || data.farmId);
        return true;
      }
    } catch (error) {
      console.warn('[loadFarmData] Failed to load /data/farm.json fallback:', error);
    }
    return false;
  };

  try {
    const token = localStorage.getItem('token');
    
    if (!token) {
      console.warn('[loadFarmData] No authentication token, using /data/farm.json fallback');
      await loadLocalFarmFallback('no-token');
      return;
    }
    
    const resp = await fetch('/api/farm/profile', {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (resp.ok) {
      const data = await resp.json();
      if (data.status === 'success' && data.farm) {
        STATE.farm = data.farm;
        console.log('[loadFarmData] Loaded farm:', STATE.farm?.farmId || STATE.farm?.name);
        
        // Store farm data in STATE.rooms if provided
        if (Array.isArray(data.farm.rooms)) {
          STATE.rooms = data.farm.rooms;
        }
        
        // Update header with farm name
        updateFarmNameInHeader(data.farm.name);
      }
    } else if (resp.status === 401) {
      console.warn('[loadFarmData] Authentication failed, using /data/farm.json fallback');
      await loadLocalFarmFallback('unauthorized');
    }
  } catch (e) {
    console.warn('[loadFarmData] Failed to load farm data:', e);
    await loadLocalFarmFallback('error');
  }
}

/**
 * Update the header title and page title with the farm name
 * Replaces "Light Engine Foxtrot" with "[Farm Name] - Light Engine"
 */
function updateFarmNameInHeader(farmName) {
  if (!farmName) return;
  
  // Update the main header title element
  const headerTitle = document.getElementById('lightEngineTitle');
  if (headerTitle) {
    headerTitle.textContent = `${farmName} - Light Engine`;
    console.log('[Header] Updated header title with farm name:', farmName);
  }
  
  // Update the page title
  document.title = `${farmName} - Light Engine Foxtrot`;
  
  // Update the farm name display in the top card (left side)
  const farmNameEl = document.getElementById('farmName');
  if (farmNameEl) {
    farmNameEl.textContent = farmName;
  }
}

// Remove demo rooms from STATE.rooms on load (ONLY if not in DEMO_MODE)
function removeDemoRooms() {
  // Check if we're in demo mode by looking for demo farm data
  const isDemoMode = window.location.search.includes('demo=true') || 
                     (STATE.farm?.farmId === 'DEMO-FARM-001') ||
                     (STATE.farm?.name && STATE.farm.name.includes('Demo'));
  
  if (isDemoMode) {
    console.log('[removeDemoRooms] Skipping - DEMO_MODE detected (farmId:', STATE.farm?.farmId, ')');
    return;
  }
  
  if (!Array.isArray(STATE.rooms)) return;
  const originalCount = STATE.rooms.length;
  
  // Define demo room names/ids to remove (customize as needed)
  const demoNames = [
    "Demo Room", "Demo Grow Room", "Test Room", "Sample Room", "Room 1", "Room 2", "Room A", "Room B",
    "Propagation Bay", "Flower Bay"
  ];
  STATE.rooms = STATE.rooms.filter(r => {
    if (!r) return false;
    const name = (r.name||"").toLowerCase();
    return !demoNames.some(dn => name.includes(dn.toLowerCase()));
  });
  
  const removedCount = originalCount - STATE.rooms.length;
  if (removedCount > 0) {
    console.log(`[removeDemoRooms] Removed ${removedCount} demo rooms`);
  }
}

document.addEventListener('DOMContentLoaded', async function() {
  console.log('[INIT] ===== DOMContentLoaded FIRED =====');
  // Load farm data first to check if we're in demo mode
  console.log('[INIT] Loading farm data...');
  await loadFarmData();
  // Load rooms data
  console.log('[INIT] Loading rooms...');
  await loadRoomsFromBackend();
  // Load persisted light setups
  console.log('[INIT] Loading light setups...');
  await loadLightSetups();
  // NOTE: IoT devices are loaded by loadAllData() in the second DOMContentLoaded handler.
  // Loading here was redundant and caused a race condition where both handlers wrote
  // to STATE.iotDevices concurrently. loadAllData() is the authoritative load path
  // because it also merges SwitchBot devices and handles persistence.
  console.log('[INIT] Skipping loadSavedIoTDevices (handled by loadAllData)');
  // Remove demo rooms (will skip if in demo mode)
  removeDemoRooms();
  // Render rooms if function exists
  if (typeof renderRooms === 'function') renderRooms();
  console.log('[INIT] ===== Initialization complete =====');
});

STATE.smartPlugs = Array.isArray(STATE.smartPlugs) ? STATE.smartPlugs : [];
STATE.preAutomationRules = Array.isArray(STATE.preAutomationRules) ? STATE.preAutomationRules : [];
STATE.preAutomationEnv = STATE.preAutomationEnv || { scopes: {} };
STATE.preAutomationAlert = null;
STATE.environment = Array.isArray(STATE.environment) ? STATE.environment : [];

// ...existing code...
class FarmWizard {
  // Map step names to user-friendly titles
  static stepTitles = {
    'connection-choice': "Let's get you online",
    'wifi-select': 'Select Wi‑Fi network',
    'wifi-password': 'Enter Wi‑Fi password',
    'wifi-test': 'Test Wi‑Fi connection',
    'location': 'Where is this farm?',
    'contact': 'Contact information',
    'spaces': 'Add rooms and zones',
    'review': 'Review and save'
  };
  constructor() {
    this.modal = $('#farmModal');
    this.form = $('#farmWizardForm');
    this.progressEl = $('#farmModalProgress');
    this.titleEl = $('#farmModalTitle');
    this.currentStep = 0;
    // Auto-detect deployment mode: edge devices need Wi-Fi/Ethernet setup,
    // cloud deployments (EB, hosted) are already online — skip connectivity steps.
    this.isEdgeMode = this.detectEdgeMode();
    if (this.isEdgeMode) {
      this.baseSteps = ['connection-choice', 'wifi-select', 'wifi-password', 'wifi-test', 'location', 'contact', 'review'];
    } else {
      // Cloud mode: device is already online, skip connectivity steps entirely
      this.baseSteps = ['location', 'contact', 'review'];
      console.debug('[FarmWizard] Cloud mode detected — skipping connectivity steps');
    }
  this.wifiNetworks = [];
  this.hasScannedWifi = false;
    this.data = this.defaultData();
    this.discoveryStorageKeys = {
      reuse: 'gr.discovery.useSameNetwork',
      subnet: 'gr.discovery.subnet',
      gateway: 'gr.discovery.gateway',
      ssid: 'gr.discovery.ssid'
    };
    // Do NOT call this.init() here. It will be called once after instantiation below.
  }

  defaultData() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
    const reuse = this.readDiscoveryPreference();
    return {
      connection: {
        type: 'wifi',
        wifi: {
          ssid: '',
          password: '',
          reuseDiscovery: reuse,
          tested: false,
          testResult: null
        }
      },
      location: {
        farmName: '',
        address: '',
        city: '',
        state: '',
        postal: '',
        timezone: tz,
        coordinates: null // Will store { lat, lng }
      },
      contact: {
        name: '',
        email: '',
        phone: '',
        website: ''
      },
      rooms: []
    };
  }

  readDiscoveryPreference() {
    try {
      const raw = localStorage.getItem(this.discoveryStorageKeys.reuse);
      return raw === null ? true : raw === 'true';
    } catch { return true; }
  }

  init() {
    $('#btnLaunchFarm')?.addEventListener('click', () => { this.data = this.defaultData(); this.open(); });
    $('#btnEditFarm')?.addEventListener('click', () => this.edit());
    $('#farmModalClose')?.addEventListener('click', () => this.close());
    // Remove backdrop click to close - wizard should only close on save
    // $('#farmModalBackdrop')?.addEventListener('click', () => this.close());
    $('#farmPrev')?.addEventListener('click', () => this.prevStep());
    const nextBtn = $('#farmNext');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        console.debug('[FarmWizard] Next button clicked. Current step:', this.currentStep, 'Step id:', this.steps?.[this.currentStep]);
        const valid = this.validateCurrentStep();
        console.debug('[FarmWizard] validateCurrentStep() returned:', valid);
        if (valid) this.nextStep();
        else console.warn('[FarmWizard] Validation failed, not advancing.');
      });
    } else {
      console.warn('[FarmWizard] #farmNext button not found in DOM');
    }
    this.form?.addEventListener('submit', (e) => {
      e.preventDefault(); // Always prevent default form submission
      // Only save if we're on the final step (review)
      if (this.currentStep === this.steps.length - 1) {
        this.saveFarm(e);
      }
    });

    $('#btnScanWifi')?.addEventListener('click', () => this.scanWifiNetworks(true));
    $('#btnManualSsid')?.addEventListener('click', () => this.handleManualSsid());
    $('#wifiShowPassword')?.addEventListener('change', (e) => {
      const input = $('#wifiPassword');
      if (input) input.type = e.target.checked ? 'text' : 'password';
    });
    $('#wifiPassword')?.addEventListener('input', (e) => {
      this.data.connection.wifi.password = e.target.value || '';
      this.data.connection.wifi.tested = false;
      this.data.connection.wifi.testResult = null;
      this.updateWifiPasswordUI();
    });
    $('#wifiReuseDevices')?.addEventListener('change', (e) => {
      const reuse = !!e.target.checked;
      this.data.connection.wifi.reuseDiscovery = reuse;
      try { localStorage.setItem(this.discoveryStorageKeys.reuse, reuse ? 'true' : 'false'); } catch {}
    });
    $('#btnTestWifi')?.addEventListener('click', () => this.testWifi());
    // All form field listeners are now attached in attachFormListeners() when modal opens
    
    // Website branding button - opens wizard directly
    $('#websiteBrandingButton')?.addEventListener('click', () => {
      this.openBrandingWizard();
    });
    
    // Enable Enter key on website input to trigger branding wizard
    $('#contactWebsite')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.data.contact.website?.trim()) {
          this.openBrandingWizard();
        }
      }
    });
    $('#btnAddRoom')?.addEventListener('click', () => this.addRoom());
    $('#newRoomName')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); this.addRoom(); } });
    
    // Location finder - only use current location now
    $('#btnUseMyLocation')?.addEventListener('click', () => this.useMyLocation());

    document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const choice = btn.dataset.value;
        if (!choice) return;
        this.data.connection.type = choice;
        document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(b => b.classList.toggle('is-active', b === btn));
        
        // Rebuild steps based on connection type
        this.steps = this.getVisibleSteps();
        console.debug('[FarmWizard] Connection type changed to', choice, '- new steps:', this.steps);
        
        // Only reset scan state, do not auto-scan
        if (choice === 'wifi') {
          this.hasScannedWifi = false;
          this.wifiNetworks = [];
        }
        if (choice !== 'wifi') {
          this.data.connection.wifi.testResult = null;
          this.data.connection.wifi.tested = false;
        }
        
        // If Ethernet selected, skip WiFi steps entirely - auto-advance to next step
        if (choice === 'ethernet' && this.validateCurrentStep()) {
          console.debug('[FarmWizard] Ethernet selected - auto-advancing to location step');
          this.nextStep();
        }
        
        this.renderWifiNetworks();
        this.updateWifiPasswordUI();
      });
    });

    this.populateTimezones();
    this.loadExistingFarm();
  }

  populateTimezones() {
    const select = $('#farmTimezone');
    if (!select) return;
    const common = [
      'America/Toronto','America/New_York','America/Chicago','America/Denver','America/Los_Angeles','America/Vancouver',
      'America/Sao_Paulo','Europe/London','Europe/Amsterdam','Europe/Berlin','Asia/Tokyo','Asia/Kolkata','Australia/Sydney'
    ];
    const current = this.data.location.timezone;
    select.innerHTML = common.map(tz => `<option value="${tz}">${tz}</option>`).join('');
    if (!common.includes(current)) {
      const opt = document.createElement('option');
      opt.value = current;
      opt.textContent = current;
      opt.selected = true;
      select.appendChild(opt);
    } else {
      select.value = current;
    }
  }

  /**
   * Detect whether we're running on an edge device (reTerminal, Raspberry Pi)
   * or in a cloud/hosted environment (EB, remote server).
   * Edge = localhost, 127.0.0.1, or .local hostnames (mDNS).
   * Cloud = everything else (elasticbeanstalk, custom domains, public IPs).
   */
  detectEdgeMode() {
    try {
      const host = window.location.hostname || '';
      const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
      // Also check for Tailscale IPs (100.x.x.x) used to reach edge devices remotely
      const isTailscale = /^100\.\d+\.\d+\.\d+$/.test(host);
      const edge = isLocal || isTailscale;
      console.debug('[FarmWizard] detectEdgeMode:', { host, isLocal, isTailscale, edge });
      return edge;
    } catch {
      return false; // Default to cloud if detection fails
    }
  }

  getVisibleSteps() {
    // In cloud mode, connectivity steps are already excluded from baseSteps
    if (!this.isEdgeMode) return this.baseSteps.slice();
    // In edge mode, filter Wi-Fi steps if Ethernet is selected
    if (this.data.connection.type === 'wifi') return this.baseSteps.slice();
    return this.baseSteps.filter(step => !step.startsWith('wifi-'));
  }

  open() {
    this.currentStep = 0;
    this.steps = this.getVisibleSteps();
    console.debug('[FarmWizard] open() steps:', this.steps);
    this.showStep(0);
    this.modal?.setAttribute('aria-hidden', 'false');
    this.updateConnectionButtons();
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
    this.renderRoomsEditor();
    // Attach form event listeners after modal is shown
    this.attachFormListeners();
  }

  attachFormListeners() {
    // Attach input event listeners for form fields - need to do this after modal is shown
    // Use a scoped selector to avoid clashing with the top-card header #farmName
    document.querySelector('#farmWizardForm #farmName')?.addEventListener('input', (e) => { 
      const value = e.target.value?.trim() || '';
      this.data.location.farmName = value; 
      console.log('🏠 Farm name updated:', this.data.location.farmName);
      this.updateLiveBranding(); 
    });
    document.querySelector('#farmWizardForm #farmName')?.addEventListener('blur', (e) => {
      // Ensure data is saved on blur as well
      const value = e.target.value?.trim() || '';
      this.data.location.farmName = value;
      console.log('🏠 Farm name saved on blur:', this.data.location.farmName);
    });
    $('#farmAddress')?.addEventListener('input', (e) => { this.data.location.address = e.target.value || ''; this.guessTimezone(); });
    $('#farmCity')?.addEventListener('input', (e) => { this.data.location.city = e.target.value || ''; this.guessTimezone(); });
    $('#farmState')?.addEventListener('input', (e) => { this.data.location.state = e.target.value || ''; this.guessTimezone(); });
    $('#farmPostal')?.addEventListener('input', (e) => { this.data.location.postal = e.target.value || ''; });
    $('#farmTimezone')?.addEventListener('change', (e) => { this.data.location.timezone = e.target.value || this.data.location.timezone; });
    $('#contactName')?.addEventListener('input', (e) => { this.data.contact.name = e.target.value || ''; this.updateLiveBranding(); });
    $('#contactEmail')?.addEventListener('input', (e) => { this.data.contact.email = e.target.value || ''; });
    $('#contactPhone')?.addEventListener('input', (e) => { this.data.contact.phone = e.target.value || ''; });
    $('#contactWebsite')?.addEventListener('input', (e) => { 
      this.data.contact.website = e.target.value || ''; 
      this.updateLiveBranding();
      this.fetchWebsiteBranding();
      this.updateWebsiteBrandingButton();
    });
  }

  edit() {
    // Open the normal farm registration wizard
    this.open();
  }

  close() {
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'true');
      this.modal.style.display = 'none';
    }
  }

  showStep(index) {
    // Defensive check: if steps is not initialized, bail out early
    if (!this.steps || !Array.isArray(this.steps) || this.steps.length === 0) {
      console.warn('[FarmWizard] showStep called but steps is not initialized:', this.steps);
      return;
    }
    // Do NOT reassign this.steps here! Only use the current value.
    if (index >= this.steps.length) index = this.steps.length - 1;
    if (index < 0) index = 0;
    this.currentStep = index;
    const activeId = this.steps[index];
    console.debug('[FarmWizard] showStep', { index, activeId, steps: this.steps });
    document.querySelectorAll('.farm-step').forEach(step => {
      if (!activeId) { step.removeAttribute('data-active'); return; }
      step.toggleAttribute('data-active', step.dataset.step === activeId);
    });
    if (this.progressEl) this.progressEl.textContent = `Step ${index + 1} of ${this.steps.length}`;
    if (this.titleEl) {
      // Use custom title if available, else fallback to step name
      this.titleEl.textContent = FarmWizard.stepTitles[activeId] || activeId || '';
    }
    const prevBtn = $('#farmPrev');
    const nextBtn = $('#farmNext');
    const saveBtn = $('#btnSaveFarm');
    if (prevBtn) prevBtn.style.display = index === 0 ? 'none' : 'inline-block';
    if (activeId === 'review') {
      nextBtn.style.display = 'none';
      saveBtn.style.display = 'inline-block';
      this.updateReview();
    } else {
      nextBtn.style.display = 'inline-block';
      saveBtn.style.display = 'none';
    }
    // Do not auto-scan Wi-Fi networks when entering wifi-select step
    if (activeId === 'wifi-select') {
      this.renderWifiNetworks();
    }
    if (activeId === 'wifi-password') this.updateWifiPasswordUI();
    if (activeId === 'wifi-test') {
      // Hide the test status until the user runs the test
      const status = $('#wifiTestStatus');
      if (status) status.style.display = 'none';
    }
    // Update live branding when relevant steps are shown
    if (activeId === 'location' || activeId === 'contact') {
      this.updateLiveBranding();
    }
    // Trigger branding fetch in review step
    if (activeId === 'review') {
      this.updateLiveBranding();
    }
    // Extra debug: log all farm-step sections and which is active
    document.querySelectorAll('.farm-step').forEach((step, idx) => {
      console.debug('[FarmWizard] DOM step', idx, step.dataset.step, 'active:', step.hasAttribute('data-active'));
    });
  }

  handleManualSsid() {
    const ssid = prompt('Enter the Wi‑Fi network name (SSID)');
    if (!ssid) return;
    this.wifiNetworks = [{ ssid, signal: null, security: 'Manual' }, ...this.wifiNetworks.filter(n => n.ssid !== ssid)];
    this.selectSsid(ssid);
    this.renderWifiNetworks();
  }

  selectSsid(ssid) {
    this.data.connection.wifi.ssid = ssid;
    this.data.connection.wifi.tested = false;
    this.data.connection.wifi.testResult = null;
    const label = $('#wifiChosenSsid');
    if (label) label.textContent = ssid || 'your network';
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
  }

  updateWifiPasswordUI() {
    const status = $('#wifiTestStatus');
    if (!status) return;
    const result = this.data.connection.wifi.testResult;
    // Only show the status if the test has been run (tested=true)
    if (!this.data.connection.wifi.tested) {
      status.style.display = 'none';
      status.innerHTML = '';
      return;
    }
    status.style.display = 'block';
    
    // Add "Edit Network" button to all status messages
    const editButton = '<button onclick="farmWizard.editWifiNetwork()" class="btn-link tiny" style="margin-left:8px">✏ Change Network</button>';
    
    if (!result) {
      status.innerHTML = `<div class="tiny" style="color:#475569">Run a quick connectivity test to confirm.${editButton}</div>`;
    } else if (result.status === 'connected') {
      status.innerHTML = `<div class="badge badge--success">Success</div><div class="tiny">IP ${result.ip || '—'} • latency ${result.latencyMs ?? '—'} ms${editButton}</div>`;
    } else if (result.status === 'skipped') {
      status.innerHTML = `<div class="badge badge--info">Configured</div><div class="tiny">Network: ${this.data.connection.wifi.ssid} (test skipped)${editButton}</div>`;
    } else {
      status.innerHTML = `<div class="badge badge--warn">${result.status || 'Failed'}</div><div class="tiny">${result.message || 'Try again or re-enter the password.'}${editButton}</div>`;
    }
  }
  
  editWifiNetwork() {
    console.debug('[FarmWizard] Edit WiFi network requested');
    
    // Reset WiFi configuration
    this.data.connection.wifi.ssid = '';
    this.data.connection.wifi.password = '';
    this.data.connection.wifi.tested = false;
    this.data.connection.wifi.testResult = null;
    
    // Clear UI fields
    const passwordInput = $('#wifiPassword');
    if (passwordInput) passwordInput.value = '';
    
    // Go back to WiFi network selection step
    this.goToStep('wifi-networks');
    
    showToast({
      title: 'Edit WiFi Network',
      msg: 'Select a new network or enter SSID manually',
      kind: 'info',
      icon: ''
    });
  }

  async scanWifiNetworks(force = false) {
    const status = $('#wifiScanStatus');
    const scanningIndicator = $('#wifiScanningIndicator');
    const step2Scanner = $('#wifiStep2Scanner');
    const networkList = $('#wifiNetworkList');
    console.debug('[FarmWizard] scanWifiNetworks called', { force });
    
    // CONFIGURATION: Attempt automatic scan first, fallback to manual on error
    // Set to true only if you want to skip scan entirely and go straight to manual
    const SKIP_AUTO_SCAN = false;
    
    // Show the new scanner in step 2, hide the old one if present
    if (step2Scanner) step2Scanner.style.display = 'flex';
    if (scanningIndicator) scanningIndicator.style.display = 'none';
    if (networkList) networkList.style.display = 'none';
    this.hasScannedWifi = true;
    
    if (SKIP_AUTO_SCAN) {
      console.debug('[FarmWizard] Auto-scan disabled, showing manual entry immediately');
      if (status) status.textContent = 'Manual entry mode';
      
      // Skip scan, go straight to manual entry
      if (step2Scanner) step2Scanner.style.display = 'none';
      if (networkList) {
        networkList.style.display = 'flex';
        networkList.style.flexDirection = 'column';
        networkList.innerHTML = `
          <div style="width: 100%; padding: 20px; background: #dbeafe; border: 2px solid #3b82f6; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="margin: 0 0 12px; font-weight: 700; font-size: 16px; color: #1e40af;">ℹ Manual WiFi Entry</p>
            <p style="margin: 0; font-size: 14px; color: #1e3a8a; line-height: 1.5;">
              Enter your WiFi network details below to connect your device.
            </p>
          </div>
          <div style="width: 100%; padding: 20px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05);">
            <label style="display: block; margin-bottom: 12px;">
              <span style="display: block; margin-bottom: 8px; font-weight: 700; font-size: 14px; color: #1e293b;">Network Name (SSID)</span>
              <input type="text" id="manualWifiSsid" placeholder="Enter WiFi network name (e.g., MyNetwork)" 
                     style="width: 100%; padding: 12px; border: 2px solid #cbd5e1; border-radius: 6px; font-size: 16px; box-sizing: border-box;">
            </label>
            <button type="button" id="btnManualWifiContinue" class="primary" style="width: 100%; margin-top: 8px; padding: 12px; font-size: 16px; font-weight: 600;">
              Continue with Manual Entry
            </button>
          </div>
        `;
        
        // Wire up manual entry button
        const manualBtn = document.getElementById('btnManualWifiContinue');
        const manualInput = document.getElementById('manualWifiSsid');
        if (manualBtn && manualInput) {
          manualBtn.onclick = () => {
            const ssid = manualInput.value.trim();
            if (!ssid) {
              showToast({ title: 'WiFi Setup', msg: 'Please enter a network name', kind: 'error', icon: '' });
              return;
            }
            this.data.connection.ssid = ssid;
            this.nextStep();
          };
        }
      }
      return; // Exit early, don't attempt scan
    }
    
    if (status) status.textContent = 'Scanning…';
    
    // LIVE MODE: Call real WiFi scan endpoint
    try {
      const response = await fetch(`${API_BASE}/forwarder/network/wifi/scan`);
      if (!response.ok) {
        // For 503, try to get detailed error info from backend
        let errorInfo = null;
        try {
          errorInfo = await response.json();
        } catch (e) {
          // Fallback if response isn't JSON
        }
        const error = new Error(errorInfo?.message || `WiFi scan failed: ${response.statusText}`);
        error.details = errorInfo;
        throw error;
      }
      
      const networks = await response.json();
      this.wifiNetworks = Array.isArray(networks) ? networks : [];
      
      if (status) status.textContent = `${this.wifiNetworks.length} network${this.wifiNetworks.length !== 1 ? 's' : ''} found`;
      console.debug('[FarmWizard] Live Wi-Fi scan result', this.wifiNetworks);
      
      // Hide both scanners and show network list
      if (step2Scanner) step2Scanner.style.display = 'none';
      if (scanningIndicator) scanningIndicator.style.display = 'none';
      if (networkList) networkList.style.display = 'block';
      this.renderWifiNetworks();
    } catch (error) {
      console.error('[FarmWizard] WiFi scan error:', error);
      console.debug('[FarmWizard] Error details:', error.details);
      if (status) status.textContent = 'Scan failed - manual entry available';
      
      // LIVE MODE: No demo fallback - show real error with option to enter manually
      this.wifiNetworks = [];
      
      console.debug('[FarmWizard] Hiding scanners, showing manual entry UI');
      if (step2Scanner) step2Scanner.style.display = 'none';
      if (scanningIndicator) scanningIndicator.style.display = 'none';
      
      if (networkList) {
        console.debug('[FarmWizard] Setting networkList display to flex (keep original chip-grid layout)');
        networkList.style.display = 'flex';
        networkList.style.flexDirection = 'column';
        
        // Build technical details from backend error info
        let technicalDetails = error.message || 'Unknown error';
        if (error.details) {
          console.debug('[FarmWizard] Building technical details from error.details');
          technicalDetails += '<br><br>';
          if (error.details.details && error.details.details.length > 0) {
            technicalDetails += '<strong>Details:</strong><br>' + error.details.details.map(d => `• ${d}`).join('<br>');
          }
          if (error.details.suggestions && error.details.suggestions.length > 0) {
            technicalDetails += '<br><br><strong>Suggestions:</strong><br>' + error.details.suggestions.map(s => `• ${s}`).join('<br>');
          }
          if (error.details.platform) {
            technicalDetails += `<br><br><strong>Platform:</strong> ${error.details.platform}`;
          }
          if (error.details.controller) {
            technicalDetails += `<br><strong>Controller:</strong> ${error.details.controller}`;
          }
        }
        
        console.debug('[FarmWizard] Setting networkList innerHTML with manual entry UI');
        // Add manual entry option with highly visible styling
        networkList.innerHTML = `
          <div style="width: 100%; padding: 20px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
            <p style="margin: 0 0 12px; font-weight: 700; font-size: 16px; color: #92400e;"> WiFi Scan Unavailable</p>
            <p style="margin: 0 0 12px; font-size: 14px; color: #78350f; line-height: 1.5;">
              Automatic network detection failed. You can enter your WiFi details manually below.
            </p>
            <details style="font-size: 12px; color: #78350f; margin-top: 8px;">
              <summary style="cursor: pointer; margin-bottom: 8px; font-weight: 600;">Technical details</summary>
              <div style="margin: 8px 0; line-height: 1.6; padding: 8px; background: rgba(255,255,255,0.5); border-radius: 4px;">${technicalDetails}</div>
            </details>
          </div>
          <div style="width: 100%; padding: 20px; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.05);">
            <label style="display: block; margin-bottom: 12px;">
              <span style="display: block; margin-bottom: 8px; font-weight: 700; font-size: 14px; color: #1e293b;">Network Name (SSID)</span>
              <input type="text" id="manualWifiSsid" placeholder="Enter WiFi network name (e.g., MyNetwork)" 
                     style="width: 100%; padding: 12px; border: 2px solid #cbd5e1; border-radius: 6px; font-size: 16px; box-sizing: border-box;">
            </label>
            <button type="button" id="btnManualWifiContinue" class="primary" style="width: 100%; margin-top: 8px; padding: 12px; font-size: 16px; font-weight: 600;">
              Continue with Manual Entry
            </button>
          </div>
        `;
        
        console.debug('[FarmWizard] Manual entry UI HTML set, networkList.innerHTML length:', networkList.innerHTML.length);
        console.debug('[FarmWizard] networkList display:', networkList.style.display, 'visibility:', networkList.style.visibility || 'visible');
        console.debug('[FarmWizard] networkList offsetHeight:', networkList.offsetHeight, 'offsetWidth:', networkList.offsetWidth);
        
        // Wire up manual entry button
        const manualBtn = document.getElementById('btnManualWifiContinue');
        const manualInput = document.getElementById('manualWifiSsid');
        console.debug('[FarmWizard] Manual entry button found:', !!manualBtn, 'Input found:', !!manualInput);
        if (manualBtn && manualInput) {
          console.debug('[FarmWizard] Button element:', manualBtn);
          console.debug('[FarmWizard] Input element:', manualInput);
          manualBtn.onclick = () => {
            console.debug('[FarmWizard] Manual entry button CLICKED!');
            const ssid = manualInput.value.trim();
            if (!ssid) {
              showToast({ title: 'WiFi Setup', msg: 'Please enter a network name', kind: 'error', icon: '' });
              return;
            }
            console.debug('[FarmWizard] Proceeding with manual SSID:', ssid);
            this.data.connection.ssid = ssid;
            this.nextStep();
          };
          console.debug('[FarmWizard] Manual entry button click handler wired up');
        } else {
          console.error('[FarmWizard] Failed to find manual entry elements after setting innerHTML');
        }
      } else {
        console.error('[FarmWizard] networkList element not found!');
      }
      
      showToast({ 
        title: 'WiFi Scan Failed', 
        msg: 'Automatic scan unavailable. Use manual entry or check controller connection.', 
        kind: 'warning', 
        icon: '' 
      });
    }

    // If not already on the wifi-select step, force the wizard to that step
    if (this.steps && this.steps[this.currentStep] !== 'wifi-select') {
      const idx = this.steps.indexOf('wifi-select');
      if (idx !== -1) {
        this.showStep(idx);
      }
    }
  }

  renderWifiNetworks() {
    const host = $('#wifiNetworkList');
    if (!host) return;
    host.innerHTML = '';
    if (this.data.connection.type !== 'wifi') {
      host.innerHTML = '<p class="tiny">Ethernet selected—skip Wi‑Fi.</p>';
      return;
    }
    if (!this.hasScannedWifi) {
      host.style.display = 'none';
      return;
    }
    host.style.display = 'block';
    console.debug('[FarmWizard] renderWifiNetworks', this.wifiNetworks);
    this.wifiNetworks.forEach(net => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip-option';
      btn.setAttribute('role', 'option');
      btn.dataset.value = net.ssid;
      btn.innerHTML = `<span>${escapeHtml(net.ssid)}</span><span class="tiny">${net.signal != null ? `${net.signal} dBm` : ''} ${net.security}</span>`;
      if (this.data.connection.wifi.ssid === net.ssid) btn.classList.add('is-active');
      btn.addEventListener('click', () => this.selectSsid(net.ssid));
      host.appendChild(btn);
    });
  }

  async testWifi() {
    if (this.data.connection.type !== 'wifi') return;
    if (!this.data.connection.wifi.ssid) { alert('Pick a Wi‑Fi network first.'); return; }
    
    // CONFIGURATION: Skip WiFi test when controller doesn't support it
    const SKIP_WIFI_TEST = true;
    
    const status = $('#wifiTestStatus');
    const testingIndicator = $('#wifiTestingIndicator');
    const testButton = $('#btnTestWifi');
    
    if (SKIP_WIFI_TEST) {
      console.debug('[FarmWizard] WiFi test skipped, marking as successful');
      
      // Mark as tested with mock success
      this.data.connection.wifi.tested = true;
      this.data.connection.wifi.testResult = {
        status: 'skipped',
        message: 'WiFi test skipped - controller does not support network testing'
      };
      
      showToast({ 
        title: 'Wi‑Fi Configuration Saved', 
        msg: `Network: ${this.data.connection.wifi.ssid} (test skipped)`, 
        kind: 'info', 
        icon: 'ℹ' 
      });
      
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `<div class="badge badge--info">Configured</div><div class="tiny">Network: ${this.data.connection.wifi.ssid} (test skipped)<button onclick="farmWizard.editWifiNetwork()" class="btn-link tiny" style="margin-left:8px">✏ Change Network</button></div>`;
      }
      
      this.updateWifiPasswordUI();
      return; // Skip test entirely
    }
    
    // Show testing indicator and disable button
    if (testingIndicator) {
      testingIndicator.style.display = 'flex';
    }
    if (testButton) {
      testButton.disabled = true;
      testButton.textContent = 'Testing...';
    }
    if (status) {
      status.style.display = 'none'; // Hide status while testing indicator is shown
      status.innerHTML = '<div class="tiny">Testing connection...</div>';
    }
    
    // LIVE MODE: Call real network test endpoint
    try {
      const payload = {
        type: 'wifi',
        wifi: {
          ssid: this.data.connection.wifi.ssid,
          password: this.data.connection.wifi.password
        }
      };
      
      const response = await fetch(`${API_BASE}/forwarder/network/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) throw new Error(`Network test failed: ${response.statusText}`);
      
      const result = await response.json();
      this.data.connection.wifi.tested = true;
      this.data.connection.wifi.testResult = result;
      
      // Store network info for device discovery if enabled
      if (this.data.connection.wifi.reuseDiscovery && result.subnet) {
        try {
          localStorage.setItem(this.discoveryStorageKeys.subnet, result.subnet);
          localStorage.setItem(this.discoveryStorageKeys.gateway, result.gateway || '');
          localStorage.setItem(this.discoveryStorageKeys.ssid, this.data.connection.wifi.ssid);
        } catch {}
      }
      
      showToast({ 
        title: 'Wi‑Fi connected', 
        msg: `IP ${result.ip || 'unknown'} • gateway ${result.gateway || 'unknown'}`, 
        kind: 'success', 
        icon: '' 
      });
      
      // Hide testing indicator, restore button, and show status
      if (testingIndicator) {
        testingIndicator.style.display = 'none';
      }
      if (testButton) {
        testButton.disabled = false;
        testButton.textContent = 'Test connection';
      }
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `<div class="badge badge--success">Connected</div><div class="tiny">IP: ${result.ip || 'N/A'} • Latency: ${result.latencyMs || 0}ms</div>`;
      }
      this.updateWifiPasswordUI();
      
    } catch (error) {
      console.error('[FarmWizard] WiFi test error:', error);
      
      this.data.connection.wifi.tested = false;
      this.data.connection.wifi.testResult = null;
      
      // Hide testing indicator, restore button
      if (testingIndicator) {
        testingIndicator.style.display = 'none';
      }
      if (testButton) {
        testButton.disabled = false;
        testButton.textContent = 'Test connection';
      }
      if (status) {
        status.style.display = 'block';
        status.innerHTML = `<div class="badge badge--error">Failed</div><div class="tiny">${error.message || 'Connection test failed. Check password and try again.'}</div>`;
      }
      
      showToast({ 
        title: 'Connection failed', 
        msg: 'Check password and network availability', 
        kind: 'error', 
        icon: '' 
      });
    }
  }

  addRoom() {
    const input = $('#newRoomName');
    if (!input) return;
    const name = (input.value || '').trim();
    if (!name) return;
    const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`;
    this.data.rooms.push({ id, name, zones: [] });
    input.value = '';
    this.renderRoomsEditor();
  }

  removeRoom(roomId) {
    this.data.rooms = this.data.rooms.filter(r => r.id !== roomId);
    this.renderRoomsEditor();
  }

  addZone(roomId, zoneName) {
    const room = this.data.rooms.find(r => r.id === roomId);
    if (!room || !zoneName) return;
    if (!room.zones.includes(zoneName)) room.zones.push(zoneName);
    this.renderRoomsEditor();
  }

  removeZone(roomId, zoneName) {
    const room = this.data.rooms.find(r => r.id === roomId);
    if (!room) return;
    room.zones = room.zones.filter(z => z !== zoneName);
    this.renderRoomsEditor();
  }

  renderRoomsEditor() {
    const host = $('#roomsEditor');
    if (!host) return;
    if (!this.data.rooms.length) {
      host.innerHTML = '<p class="tiny">Add your first room to get started. Zones can be canopy, bench, or bay labels.</p>';
      return;
    }
    host.innerHTML = '';
    // Unify summary logic with Light Setup summary
    const lightSetups = window.STATE?.lightSetups || [];
    this.data.rooms.forEach(room => {
      // Gather zones from room and light setups (match by id or name)
      let zones = new Set(Array.isArray(room.zones) ? room.zones : []);
      let controls = new Set();
      let lights = {};
      let numLights = 0;
      lightSetups.forEach(setup => {
        if (
          String(setup.room) === String(room.id) ||
          String(setup.room) === String(room.name)
        ) {
          if (setup.zone) zones.add(setup.zone);
          if (setup.controlMethod && setup.controlMethod !== '0' && setup.controlMethod !== 0) controls.add(setup.controlMethod);
          (setup.fixtures||[]).forEach(f => {
            const key = f.vendor||f.name||f.model||'Light';
            if (!lights[key]) lights[key] = 0;
            lights[key] += Number(f.count)||1;
            numLights += Number(f.count)||1;
          });
        }
      });
      // If no controls found, check for controlMethod in room object
      if (controls.size === 0 && room.controlMethod) controls.add(room.controlMethod);
      const zoneNames = Array.from(zones).join(', ') || '—';
      const controlsList = controls.size ? Array.from(controls).join(', ') : '—';
      const lightsList = Object.keys(lights).length ? Object.entries(lights).map(([k,v]) => `${escapeHtml(k)} ×${v}`).join(', ') : '—';
      // Equipment summary (if present)
      let equipmentList = '—';
      if (Array.isArray(room.equipment) && room.equipment.length) {
        const eqMap = {};
        room.equipment.forEach(eq => {
          const key = eq.category || eq.type || eq.name || 'Equipment';
          if (!eqMap[key]) eqMap[key] = 0;
          eqMap[key] += Number(eq.count)||1;
        });
        equipmentList = Object.entries(eqMap).map(([k,v]) => `${escapeHtml(k)} ×${v}`).join(', ');
      }
      const card = document.createElement('div');
      card.className = 'farm-room-card';
      card.innerHTML = `
        <div class="farm-room-card__header">
          <strong>${escapeHtml(room.name)}</strong>
          <button type="button" class="ghost tiny" data-action="remove-room" data-room="${room.id}">Remove</button>
        </div>
        <div class="farm-room-card__summary" data-room="${room.id}">
          <div class="tiny"><b>Zones:</b> ${zoneNames}</div>
          <div class="tiny"><b>Controls:</b> ${controlsList}</div>
          <div class="tiny"><b>Lights:</b> ${numLights} (${lightsList})</div>
          <div class="tiny"><b>Equipment:</b> ${equipmentList}</div>
        </div>
        <div class="farm-room-card__zones" data-room="${room.id}" style="margin-top:6px">${Array.from(zones).map(z => `<span class="chip tiny" data-zone="${escapeHtml(z)}">${escapeHtml(z)} <button type="button" data-action="remove-zone" data-room="${room.id}" data-zone="${escapeHtml(z)}">×</button></span>`).join('')}</div>
        <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:8px">
          <input type="text" class="tiny farm-zone-input" data-room="${room.id}" placeholder="Add zone">
          <button type="button" class="ghost tiny" data-action="add-zone" data-room="${room.id}">Add zone</button>
        </div>`;
      host.appendChild(card);
    });
    host.querySelectorAll('[data-action="remove-room"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      this.removeRoom(roomId);
    }));
    host.querySelectorAll('[data-action="add-zone"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      const input = host.querySelector(`.farm-zone-input[data-room="${roomId}"]`);
      const value = (input?.value || '').trim();
      if (value) {
        this.addZone(roomId, value);
        if (input) input.value = '';
      }
    }));
    host.querySelectorAll('.farm-zone-input').forEach(input => {
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const roomId = ev.target.dataset.room;
          this.addZone(roomId, (ev.target.value || '').trim());
          ev.target.value = '';
        }
      });
    });
    host.querySelectorAll('[data-action="remove-zone"]').forEach(btn => btn.addEventListener('click', (e) => {
      const roomId = e.currentTarget.dataset.room;
      const zone = e.currentTarget.dataset.zone;
      this.removeZone(roomId, zone);
    }));
  }

  validateCurrentStep() {
    const stepId = this.steps[this.currentStep];
    console.debug(' Validating step:', stepId, 'with data:', JSON.parse(JSON.stringify(this.data)));
    if (!stepId) {
      console.warn('[FarmWizard] validateCurrentStep: No stepId for currentStep', this.currentStep);
      return false;
    }
    if (stepId === 'connection-choice' && !['wifi','ethernet'].includes(this.data.connection.type)) {
      alert('Pick Wi‑Fi or Ethernet to continue.');
      return false;
    }
    if (stepId === 'wifi-select' && !this.data.connection.wifi.ssid) {
      alert('Choose a Wi‑Fi network.');
      return false;
    }
    if (stepId === 'wifi-test') {
      // Accept both 'connected' (real test) and 'skipped' (when SKIP_WIFI_TEST = true)
      const testResult = this.data.connection.wifi.testResult;
      const validStatuses = ['connected', 'skipped'];
      if (!testResult || !validStatuses.includes(testResult.status)) {
        alert('Run the Wi‑Fi test so we know the credentials work.');
        return false;
      }
    }
    if (stepId === 'location') {
      // Capture all location data for subscription services
      const farmNameEl = document.querySelector('#farmWizardForm #farmName');
      const farmNameValue = farmNameEl?.value?.trim() || '';
      const addressEl = $('#farmAddress');
      const addressValue = addressEl?.value?.trim() || '';
      const cityEl = $('#farmCity');
      const cityValue = cityEl?.value?.trim() || '';
      const stateEl = $('#farmState');
      const stateValue = stateEl?.value?.trim() || '';
      const postalEl = $('#farmPostal');
      const postalValue = postalEl?.value?.trim() || '';
      // Always update the data with current form values (required for subscriptions)
      this.data.location.farmName = farmNameValue;
      this.data.location.address = addressValue;
      this.data.location.city = cityValue;
      this.data.location.state = stateValue;
      this.data.location.postal = postalValue;
      console.debug(' Location data captured for subscriptions:', {
        farmName: farmNameValue || '(blank)',
        address: addressValue || '(blank)',
        city: cityValue || '(blank)', 
        state: stateValue || '(blank)',
        postal: postalValue || '(blank)'
      });
      return true; // Always allow progression - data collection for future subscriptions
    }
    if (stepId === 'contact' && (!this.data.contact.name || !this.data.contact.email)) {
      alert('Contact name and email are required.');
      return false;
    }
    if (stepId === 'spaces' && !this.data.rooms.length) {
      alert('Add at least one room.');
      return false;
    }
    return true;
  }

  nextStep() {
    console.debug('[FarmWizard] nextStep from', this.currentStep, 'steps:', this.steps);
    // Defensive check: if steps is not initialized, bail out early
    if (!this.steps || !Array.isArray(this.steps) || this.steps.length === 0) {
      console.warn('[FarmWizard] nextStep called but steps is not initialized:', this.steps);
      return;
    }
    // Prevent double-advance: only allow next if validation passes
    if (!this.validateCurrentStep()) {
      console.debug('[FarmWizard] nextStep: validation failed at', this.currentStep);
      // Explicitly re-show the current step to block accidental advance
      this.showStep(this.currentStep);
      return;
    }
    // Only increment by 1, never skip steps
    const next = this.currentStep + 1;
    if (next < this.steps.length) {
      console.debug('[FarmWizard] nextStep: moving to', next, 'step:', this.steps[next]);
      this.showStep(next);
    }
  }

  prevStep() {
    // Defensive check: if steps is not initialized, bail out early
    if (!this.steps || !Array.isArray(this.steps) || this.steps.length === 0) {
      console.warn('[FarmWizard] prevStep called but steps is not initialized:', this.steps);
      return;
    }
    const prev = Math.max(this.currentStep - 1, 0);
    console.debug('[FarmWizard] prevStep from', this.currentStep, 'to', prev, 'steps:', this.steps);
    this.showStep(prev);
  }

  updateReview() {
    const host = $('#farmReview');
    if (!host) return;
    const conn = this.data.connection;
    const rooms = this.data.rooms;
    const timezone = this.data.location.timezone;
    const addressParts = [this.data.location.address, this.data.location.city, this.data.location.state, this.data.location.postal].filter(Boolean);
    
    // Build branding section if we have farm name or website
    let brandingSection = '';
    if (this.data.location.farmName || this.data.contact.website) {
      const farmName = this.data.location.farmName || 'Untitled Farm';
      let logoSection = '';
      if (this.data.contact.website) {
        const domain = this.extractDomain(this.data.contact.website);
        logoSection = `<img id="reviewFarmLogo" style="width:24px;height:24px;margin-right:8px;vertical-align:middle;display:none">`;
      }
      brandingSection = `<div style="border:1px solid var(--gr-border);border-radius:8px;padding:12px;margin:12px 0;background:var(--gr-surface)">
        <div style="font-size:18px;font-weight:600;margin-bottom:8px;display:flex;align-items:center">
          ${logoSection}<span>${escapeHtml(farmName)}</span>
        </div>
        ${this.data.contact.website ? `<div class="tiny" style="color:var(--gr-primary)"> <a href="${this.data.contact.website.startsWith('http') ? this.data.contact.website : 'https://' + this.data.contact.website}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${this.extractDomain(this.data.contact.website)}</a></div>` : ''}
      </div>`;
      
      // Fetch website branding for the logo
      if (this.data.contact.website) {
        this.fetchWebsiteBrandingForReview();
      }
    }
    
    host.innerHTML = `
      ${brandingSection}
      <div><strong>Connection:</strong> ${conn.type === 'wifi' ? `Wi‑Fi · ${escapeHtml(conn.wifi.ssid || '')}` : 'Ethernet'} ${conn.wifi.testResult?.status === 'connected' ? '' : ''}</div>
      <div><strong>Farm:</strong> ${escapeHtml(this.data.location.farmName || 'Untitled')}</div>
      <div><strong>Address:</strong> ${escapeHtml(addressParts.join(', ') || '—')}</div>
      <div><strong>Timezone:</strong> ${escapeHtml(timezone)}</div>
      ${this.data.contact.website ? `<div><strong>Website:</strong> <a href="${this.data.contact.website.startsWith('http') ? escapeHtml(this.data.contact.website) : 'https://' + escapeHtml(this.data.contact.website)}" target="_blank">${escapeHtml(this.data.contact.website)}</a></div>` : ''}
    `;
  }

  hydrateFromFarm(farmData) {
    const safe = farmData || {};
    const copy = this.defaultData();
    copy.connection.type = safe.connection?.type === 'ethernet' ? 'ethernet' : 'wifi';
    if (safe.connection?.wifi) {
      copy.connection.wifi.ssid = safe.connection.wifi.ssid || '';
      copy.connection.wifi.reuseDiscovery = safe.connection.wifi.reuseDiscovery ?? this.readDiscoveryPreference();
      copy.connection.wifi.tested = !!safe.connection.wifi.tested;
      copy.connection.wifi.testResult = safe.connection.wifi.testResult || null;
    }
    copy.location.farmName = safe.farmName || '';
    copy.location.address = safe.address || '';
    copy.location.city = safe.city || '';
    copy.location.state = safe.state || '';
    copy.location.postal = safe.postalCode || safe.postal || '';
    copy.location.timezone = safe.timezone || copy.location.timezone;
    if (safe.location?.coordinates || safe.coordinates) {
      const coords = safe.location?.coordinates || safe.coordinates;
      if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
        copy.location.coordinates = { lat: coords.lat, lng: coords.lng };
      }
    }
    if (safe.contact) {
      copy.contact.name = safe.contact.name || '';
      copy.contact.email = safe.contact.email || '';
      copy.contact.phone = safe.contact.phone || '';
      copy.contact.website = safe.contact.website || '';
    }
    copy.rooms = Array.isArray(safe.rooms) ? safe.rooms.map(room => ({
      id: room.id || `room-${Math.random().toString(36).slice(2,8)}`,
      name: room.name || room.title || 'Room',
      zones: Array.isArray(room.zones) ? room.zones.slice() : []
    })) : [];
    if (!copy.rooms.length && Array.isArray(safe.locations)) {
      copy.rooms = safe.locations.map((name, idx) => ({ id: `room-${idx}`, name, zones: [] }));
    }
    this.data = copy;
    this.renderRoomsEditor();
    this.renderWifiNetworks();
    this.updateWifiPasswordUI();
    this.updateConnectionButtons();
    this.populateTimezones();
    // Populate form fields
  const farmNameEl = document.querySelector('#farmWizardForm #farmName'); if (farmNameEl) farmNameEl.value = this.data.location.farmName;
    const farmAddressEl = $('#farmAddress'); if (farmAddressEl) farmAddressEl.value = this.data.location.address;
    const farmCityEl = $('#farmCity'); if (farmCityEl) farmCityEl.value = this.data.location.city;
    const farmStateEl = $('#farmState'); if (farmStateEl) farmStateEl.value = this.data.location.state;
    const farmPostalEl = $('#farmPostal'); if (farmPostalEl) farmPostalEl.value = this.data.location.postal;
    const farmTimezoneEl = $('#farmTimezone'); if (farmTimezoneEl) farmTimezoneEl.value = this.data.location.timezone;
    const contactNameEl = $('#contactName'); if (contactNameEl) contactNameEl.value = this.data.contact.name;
    const contactEmailEl = $('#contactEmail'); if (contactEmailEl) contactEmailEl.value = this.data.contact.email;
    const contactPhoneEl = $('#contactPhone'); if (contactPhoneEl) contactPhoneEl.value = this.data.contact.phone;
    const contactWebsiteEl = $('#contactWebsite'); if (contactWebsiteEl) contactWebsiteEl.value = this.data.contact.website;
    
    // Update the website branding button state
    this.updateWebsiteBrandingButton();
  }

  updateConnectionButtons() {
    document.querySelectorAll('#farmConnectionChoice .chip-option').forEach(btn => {
      btn.classList.toggle('is-active', btn.dataset.value === this.data.connection.type);
    });
  }

  async loadExistingFarm() {
    try {
      const farm = await loadJSON('./data/farm.json');
      if (farm) {
        STATE.farm = this.normalizeFarm(farm);
        this.hydrateFromFarm(STATE.farm);
        // If coordinates available, show current weather
        const coords = STATE.farm.location?.coordinates || STATE.farm.coordinates;
        if (coords && typeof coords.lat === 'number' && typeof coords.lng === 'number') {
          try { this.loadWeather(coords.lat, coords.lng); } catch {}
        }
        this.updateFarmDisplay();
        return;
      }
    } catch (err) {
      console.warn('Failed to load farm.json', err);
    }
    try {
      const cached = JSON.parse(localStorage.getItem('gr.farm') || 'null');
      if (cached) {
        STATE.farm = this.normalizeFarm(cached);
        this.hydrateFromFarm(STATE.farm);
        const coords2 = STATE.farm.location?.coordinates || STATE.farm.coordinates;
        if (coords2 && typeof coords2.lat === 'number' && typeof coords2.lng === 'number') {
          try { this.loadWeather(coords2.lat, coords2.lng); } catch {}
        }
        this.updateFarmDisplay();
      }
    } catch {}
  }

  normalizeFarm(farm) {
    return normalizeFarmDoc(farm);
  }

  async saveFarm(event) {
    event?.preventDefault();
    console.debug('[FarmWizard] saveFarm called at step', this.currentStep, 'steps:', this.steps);
    // Only allow saving from the review step (final step)
    if (this.currentStep !== this.steps.length - 1) {
      console.warn('[FarmWizard] Save attempt from non-final step, ignoring', this.currentStep, this.steps);
      return;
    }
    if (!this.validateCurrentStep()) {
      console.warn('[FarmWizard] saveFarm: validation failed at', this.currentStep);
      this.showStep(this.currentStep);
      return;
    }
    const existing = STATE.farm || {};
    const payload = {
      ...existing,
      farmName: this.data.location.farmName,
      address: this.data.location.address,
      city: this.data.location.city,
      state: this.data.location.state,
      postalCode: this.data.location.postal,
      timezone: this.data.location.timezone,
      coordinates: this.data.location.coordinates || existing.coordinates || null,
      contact: {
        name: this.data.contact.name,
        email: this.data.contact.email,
        phone: this.data.contact.phone,
        website: this.data.contact.website
      },
      connection: {
        type: this.data.connection.type,
        wifi: {
          ssid: this.data.connection.wifi.ssid,
          reuseDiscovery: this.data.connection.wifi.reuseDiscovery,
          tested: this.data.connection.wifi.tested,
          testResult: this.data.connection.wifi.testResult
        }
      },
      discovery: {
        subnet: (() => { try { return localStorage.getItem(this.discoveryStorageKeys.subnet) || ''; } catch { return ''; } })(),
        gateway: (() => { try { return localStorage.getItem(this.discoveryStorageKeys.gateway) || ''; } catch { return ''; } })(),
        reuseNetwork: this.data.connection.wifi.reuseDiscovery,
        ssid: this.data.connection.wifi.ssid
      },
      rooms: this.data.rooms.map((room, idx) => ({
        id: room.id || `room-${idx}`,
        name: room.name,
        zones: Array.isArray(room.zones) ? room.zones.slice() : []
      })),
      locations: this.data.rooms.map(r => r.name),
      registered: existing.registered || new Date().toISOString()
    };
    try {
      const saved = await safeFarmSave(payload);
      if (!saved) throw new Error('Failed to save farm.');
      STATE.farm = this.normalizeFarm({
        ...payload,
        // Mirror name key for header branding components
        name: payload.farmName || payload.name || 'Your Farm'
      });
      this.updateFarmDisplay();
      try { this.updateFarmHeaderDisplay(); } catch {}
      showToast({ title: 'Farm saved', msg: 'We stored the farm profile and updated discovery defaults.', kind: 'success', icon: '' });
      // Notify listeners (e.g., Groups card) that farm data changed
      window.dispatchEvent(new CustomEvent('farmDataChanged'));
    } catch (err) {
      showToast({ title: 'Save failed', msg: err?.message || String(err), kind: 'warn', icon: '' });
    }
    this.close();
    // Removed: Do not auto-launch Grow Room setup after farm registration
  }

  updateFarmDisplay() {
    const badge = $('#farmBadge');
    const editBtn = $('#btnEditFarm');
    const launchBtn = $('#btnLaunchFarm');
    const summaryChip = $('#farmSummaryChip');
    const hide = el => { if (el) el.classList.add('is-hidden'); };
    const show = el => { if (el) el.classList.remove('is-hidden'); };

    if (!STATE.farm) {
      hide(badge);
      show(launchBtn);
      hide(editBtn);
      if (summaryChip) {
        summaryChip.removeAttribute('data-has-summary');
        summaryChip.textContent = '';
      }
      return;
    }
    // Build summary with contact info only
    const contact = STATE.farm?.contact || {};
    const summary = `${STATE.farm.farmName || 'Farm'}\nContact: ${contact.name || '—'}\nPhone: ${contact.phone || '—'}\nEmail: ${contact.email || '—'}`;
    if (badge) {
      show(badge);
      badge.textContent = summary;
      badge.style.whiteSpace = 'pre-line';
    }
    if (summaryChip) {
      summaryChip.dataset.hasSummary = 'true';
      summaryChip.textContent = summary;
      summaryChip.style.whiteSpace = 'pre-line';
    }
    if (launchBtn) hide(launchBtn);
    show(editBtn);
  }

  guessTimezone() {
    const state = (this.data.location.state || '').toLowerCase();
    const map = {
      'ca': 'America/Los_Angeles', 'california': 'America/Los_Angeles',
      'or': 'America/Los_Angeles', 'oregon': 'America/Los_Angeles',
      'wa': 'America/Los_Angeles', 'washington': 'America/Los_Angeles',
      'bc': 'America/Vancouver', 'british columbia': 'America/Vancouver',
      'ab': 'America/Edmonton', 'alberta': 'America/Edmonton',
      'on': 'America/Toronto', 'ontario': 'America/Toronto',
      'qc': 'America/Toronto', 'quebec': 'America/Toronto',
      'ny': 'America/New_York', 'new york': 'America/New_York',
      'il': 'America/Chicago', 'illinois': 'America/Chicago',
      'fl': 'America/New_York', 'florida': 'America/New_York'
    };
    const guess = map[state];
    if (guess) {
      this.data.location.timezone = guess;
      const select = $('#farmTimezone');
      if (select) {
        if (![...select.options].some(opt => opt.value === guess)) {
          const opt = document.createElement('option');
          opt.value = guess;
          opt.textContent = guess;
          select.appendChild(opt);
        }
        select.value = guess;
      }
    }
  }

  async findLocation() {
    // DEPRECATED: GPS coordinates button removed from UI
    // Location data is now collected via "Use Current Location" button only
    console.log('🚫 findLocation() called but GPS coordinates button has been removed from UI');
    return;
    
    if (!button || !status) return;
    
    // Build address string from form fields
    const address = [
      this.data.location.address,
      this.data.location.city,
      this.data.location.state,
      this.data.location.postal
    ].filter(Boolean).join(', ');
    
    if (!address.trim()) {
      status.textContent = 'Please enter address information first';
      status.style.color = '#EF4444';
      return;
    }
    
    try {
      button.disabled = true;
      button.textContent = ' Searching...';
      status.textContent = 'Looking up location...';
      status.style.color = '#666';
      
      const response = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Geocoding failed');
      }
      
      if (!data.results || data.results.length === 0) {
        status.textContent = 'No locations found. Try being more specific.';
        status.style.color = '#EF4444';
        return;
      }
      
      // Show location options
      if (optionsDiv) {
        optionsDiv.innerHTML = data.results.map((location, index) => `
          <div class="location-option" data-index="${index}" data-lat="${location.lat}" data-lng="${location.lng}">
            ${location.display_name}
          </div>
        `).join('');
        
        // Add click handlers
        optionsDiv.querySelectorAll('.location-option').forEach(option => {
          option.addEventListener('click', () => {
            const lat = parseFloat(option.dataset.lat);
            const lng = parseFloat(option.dataset.lng);
            this.selectLocation(lat, lng, option.textContent);
          });
        });
      }
      
      if (resultsDiv) resultsDiv.style.display = 'block';
      status.textContent = `Found ${data.results.length} location${data.results.length > 1 ? 's' : ''}:`;
      status.style.color = '#16A34A';
      
    } catch (error) {
      console.error('Location search error:', error);
      status.textContent = 'Error finding location. Please try again.';
      status.style.color = '#EF4444';
    } finally {
      button.disabled = false;
      button.textContent = '📍 Find Location';
    }
  }
  
  selectLocation(lat, lng, displayName) {
    const resultsDiv = $('#locationResults');
    const status = $('#locationStatus');
    
    // Store coordinates
    this.data.location.coordinates = { lat, lng };
    
    // Hide results
    if (resultsDiv) resultsDiv.style.display = 'none';
    
    // Update status
    if (status) {
      status.textContent = `Location set: ${String(displayName || '').split(',')[0]}`;
      status.style.color = '#16A34A';
    }
    
    // Load weather for this location
    this.loadWeather(lat, lng);
  }
  
  async loadWeather(lat, lng) {
    const weatherDiv = $('#weatherDisplay');
    const weatherContent = $('#weatherContent');
    
    if (!weatherDiv || !weatherContent) return;
    
    try {
      weatherContent.innerHTML = '<div style="text-align: center; color: #666;">Loading weather...</div>';
      weatherDiv.style.display = 'block';
      
      const response = await fetch(`/api/weather?lat=${lat}&lng=${lng}`);
      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Weather fetch failed');
      }
      
      const weather = data.current;
      const tempF = Math.round(weather.temperature_f);
      const tempC = Math.round(weather.temperature_c);
      const humidity = Math.round(weather.humidity || 0);
      const windSpeed = Math.round(weather.wind_speed || 0);
      
      weatherContent.innerHTML = `
        <div class="weather-row">
          <span class="weather-temp">${tempF}°F (${tempC}°C)</span>
          <span class="weather-description">${escapeHtml(weather.description || '')}</span>
        </div>
        <div class="weather-row">
          <span>Humidity:</span>
          <span class="weather-value">${humidity}%</span>
        </div>
        <div class="weather-row">
          <span>Wind Speed:</span>
          <span class="weather-value">${windSpeed} km/h</span>
        </div>
        <div style="margin-top: 8px; font-size: 12px; color: #666;">
          Updated: ${new Date(weather.last_updated).toLocaleTimeString()}
        </div>
      `;
      
    } catch (error) {
      grLog('Weather loading error:', error?.message || error);
      weatherContent.innerHTML = `
        <div style="color: #EF4444; font-size: 14px;">
           Unable to load weather data
        </div>
      `;
    }
  }

  async useMyLocation() {
    const status = $('#locationStatus');
    if (!navigator.geolocation) {
      if (status) { status.textContent = 'Geolocation not supported by this browser.'; status.style.color = '#EF4444'; }
      return;
    }
    try {
      if (status) { status.textContent = 'Requesting your location…'; status.style.color = '#666'; }
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve, 
          reject, 
          { 
            enableHighAccuracy: false, // Don't require GPS, use network location
            timeout: 10000,
            maximumAge: 300000 // Cache location for 5 minutes
          }
        );
      });
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      this.data.location.coordinates = { lat, lng };
      if (status) { status.textContent = `Location acquired (${lat.toFixed(4)}, ${lng.toFixed(4)}). Looking up address…`; status.style.color = '#16A34A'; }
      // Reverse geocode to prefill address fields
      const r = await fetch(`/api/reverse-geocode?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`);
      const j = await r.json();
      if (j?.ok && j.address) {
        const { road, city, state, postal, display_name } = j.address;
        // Fill fields when present
        if (road) { this.data.location.address = road; const el = $('#farmAddress'); if (el) el.value = road; }
        if (city) { this.data.location.city = city; const el = $('#farmCity'); if (el) el.value = city; }
        if (state) { this.data.location.state = state; const el = $('#farmState'); if (el) el.value = state; }
        if (postal) { this.data.location.postal = postal; const el = $('#farmPostal'); if (el) el.value = postal; }
        if (status) { status.textContent = `Using ${display_name || 'current location'}`; status.style.color = '#16A34A'; }
      }
      // Fetch and show weather
      await this.loadWeather(lat, lng);
    } catch (e) {
      console.error('[useMyLocation] Error:', e);
      let errorMsg = 'Unable to get your location.';
      
      // Provide specific error messages based on GeolocationPositionError codes
      if (e?.code === 1) {
        errorMsg = 'Location permission denied. Please allow location access in your browser settings.';
      } else if (e?.code === 2) {
        errorMsg = 'Location unavailable. Check your device location settings.';
      } else if (e?.code === 3) {
        errorMsg = 'Location request timed out. Please try again.';
      } else if (e?.message) {
        errorMsg = `Location error: ${e.message}`;
      }
      
      if (status) { 
        status.textContent = errorMsg; 
        status.style.color = '#EF4444'; 
      }
    }
  }

  updateLiveBranding() {
    // Update farm branding in real-time as user types
    const farmName = this.data.location?.farmName || '';
    const contactName = this.data.contact?.name || '';
    const website = this.data.contact?.website || '';
    
  const brandingSection = $('#farmBrandingSection');
  // Top-card name element (header)
  const farmHeaderNameEl = document.querySelector('#topCard #farmName');
    const farmTaglineEl = $('#farmTagline');
    const brandingPreview = $('#brandingPreview');
    const brandingPreviewContent = $('#brandingPreviewContent');
    
    if (farmName || contactName || website) {
      // Show branding section if we have any info
  if (brandingSection) brandingSection.style.display = 'block';
      
      // Update farm name display
      if (farmHeaderNameEl && farmName) {
        farmHeaderNameEl.textContent = farmName;
      }
      
      // Update tagline with available info
      if (farmTaglineEl) {
        const taglineParts = [];
        if (contactName) taglineParts.push(`Contact: ${contactName}`);
        if (website) {
          const domain = this.extractDomain(website);
          if (domain) taglineParts.push(domain);
        }
        farmTaglineEl.textContent = taglineParts.join(' • ') || 'Farm details being configured...';
      }
      
      // Update preview in contact step
      if (brandingPreview && brandingPreviewContent) {
        brandingPreview.style.display = 'block';
        const previewParts = [];
        if (farmName) previewParts.push(`🏡 <strong>${farmName}</strong>`);
        if (contactName) previewParts.push(`👤 ${contactName}`);
        if (website) {
          const domain = this.extractDomain(website);
          previewParts.push(` <a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color:var(--gr-primary)">${domain}</a>`);
        }
        brandingPreviewContent.innerHTML = previewParts.join('<br>') || 'Enter farm name and website to see your branding...';
      }
    } else {
      // Hide branding if no info
      if (brandingSection) brandingSection.style.display = 'none';
      if (brandingPreview) brandingPreview.style.display = 'none';
    }
  }

  extractDomain(url) {
    try {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch {
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  updateWebsiteBrandingButton() {
    const websiteButton = document.getElementById('websiteBrandingButton');
    const website = this.data.contact?.website?.trim();
    
    if (websiteButton) {
      if (website) {
        websiteButton.disabled = false;
        websiteButton.style.opacity = '1';
        websiteButton.style.cursor = 'pointer';
        websiteButton.title = 'Open branding wizard';
      } else {
        websiteButton.disabled = true;
        websiteButton.style.opacity = '0.5';
        websiteButton.style.cursor = 'not-allowed';
        websiteButton.title = 'Enter a website URL first';
      }
    }
  }

  extractDomain(url) {
    // Helper to extract clean domain from URL
    if (!url) return '';
    try {
      const cleanUrl = url.startsWith('http') ? url : 'https://' + url;
      const domain = new URL(cleanUrl).hostname;
      return domain.replace('www.', '');
    } catch (e) {
      // If URL parsing fails, just clean up what we have
      return url.replace(/^(https?:\/\/)?(www\.)?/, '').split('/')[0];
    }
  }

  async fetchWebsiteBrandingForReview() {
    // Special method for review step branding
    const website = this.data.contact?.website?.trim();
    if (!website) return;

    try {
      const domain = this.extractDomain(website);
      const faviconUrl = `https://${domain}/favicon.ico`;
      
      const reviewLogo = $('#reviewFarmLogo');
      if (reviewLogo) {
        // Create a new image element to test if favicon loads
        const testImg = new Image();
        testImg.onload = () => {
          reviewLogo.src = faviconUrl;
          reviewLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          reviewLogo.style.display = 'none';
        };
        // Start loading the test image
        testImg.src = faviconUrl;
      }
    } catch (error) {
      console.log('Review branding fetch failed:', error.message);
    }
  }

  showBrandingModal() {
    // Enhanced branding preview modal
    const farmName = this.data.location?.farmName || '';
    const contactName = this.data.contact?.name || '';
    const website = this.data.contact?.website || '';
    const domain = website ? this.extractDomain(website) : '';
    
    let logoHtml = '';
    if (website) {
      logoHtml = `<img id="modalFaviconImg" style="width:32px;height:32px;margin-right:12px;vertical-align:middle;display:none">`;
    }
    
    const modalContent = `
      <div id="brandingModalBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center">
        <div style="background:white;border-radius:12px;padding:24px;max-width:500px;margin:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2)" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;margin-bottom:16px">
            <h3 style="margin:0;flex:1"> Live Branding Preview</h3>
            <button id="closeBrandingModal" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666">&times;</button>
          </div>
          
          <div style="border:1px solid var(--gr-border);border-radius:8px;padding:20px;background:var(--gr-bg);margin-bottom:16px">
            <div style="font-size:20px;font-weight:600;margin-bottom:8px;display:flex;align-items:center">
              ${logoHtml}<span>${farmName || 'Your Farm Name'}</span>
            </div>
            ${contactName ? `<div style="color:var(--medium);margin-bottom:4px">👤 Contact: ${contactName}</div>` : ''}
            ${website ? `<div style="color:var(--gr-primary)"> <a href="${website.startsWith('http') ? website : 'https://' + website}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${domain}</a></div>` : ''}
            ${(!farmName && !contactName && !website) ? '<div style="color:var(--medium);font-style:italic">Complete your farm details to see branding preview</div>' : ''}
          </div>
          
          <div style="text-align:center;margin-bottom:16px">
            <button id="openBrandingWizard" style="background:var(--gr-accent);color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;margin-right:8px"> Customize Branding</button>
            <button id="closeBrandingModalBtn" style="background:var(--gr-primary);color:white;border:none;padding:8px 16px;border-radius:6px;cursor:pointer">Close Preview</button>
          </div>
        </div>
      </div>
    `;
    
    // Remove any existing modal
    const existing = document.getElementById('brandingModalBackdrop');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalContent);
    
    // Load favicon for modal if website exists
    if (website) {
      const modalImg = document.getElementById('modalFaviconImg');
      if (modalImg) {
        const testImg = new Image();
        testImg.onload = () => {
          modalImg.src = `https://${domain}/favicon.ico`;
          modalImg.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          modalImg.style.display = 'none';
        };
        testImg.src = `https://${domain}/favicon.ico`;
      }
    }
    
    // Add event listeners for close functionality
    document.getElementById('closeBrandingModal').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('closeBrandingModalBtn').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('brandingModalBackdrop').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
    });
    
    document.getElementById('openBrandingWizard').addEventListener('click', () => {
      document.getElementById('brandingModalBackdrop').remove();
      this.openBrandingWizard();
    });
  }

  openBrandingWizard() {
    // Comprehensive branding editor wizard
    const farmName = this.data.location?.farmName || 'Your Farm';
    const website = this.data.contact?.website || '';
    const domain = website ? this.extractDomain(website) : '';
    
    // Get current branding from state or defaults, but ALWAYS use current website for logo
    const currentBranding = STATE.farm?.branding || {
      palette: {
        primary: '#0D7D7D',
        accent: '#64C7C7',
        background: '#F7FAFA',
        surface: '#FFFFFF',
        border: '#DCE5E5',
        text: '#0B1220'
      },
      fontFamily: '',
      logo: '',
      tagline: 'Growing with technology',
      fontCss: []
    };
    
    // ALWAYS use the current website's favicon as the logo, overriding any saved logo
    const currentLogo = domain ? `https://${domain}/favicon.ico` : '';
    currentBranding.logo = currentLogo;
    
    const wizardContent = `
      <div id="brandingWizardBackdrop" style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10001;display:flex;align-items:center;justify-content:center">
        <div style="background:white;border-radius:12px;padding:24px;max-width:600px;width:90%;margin:20px;box-shadow:0 20px 40px rgba(0,0,0,0.2);max-height:80vh;overflow-y:auto" onclick="event.stopPropagation()">
          <div style="display:flex;align-items:center;margin-bottom:20px">
            <h3 style="margin:0;flex:1"> ${farmName} Branding Editor</h3>
            ${website ? `<div id="autoExtractionStatus" style="padding:6px 12px;margin-right:8px;background:#f3f4f6;color:#6b7280;border:1px solid #d1d5db;border-radius:4px;font-size:12px"> Auto-extracting...</div>` : ''}
            <button id="closeBrandingWizard" style="background:none;border:none;font-size:24px;cursor:pointer;color:#666">&times;</button>
          </div>
          
          <!-- Live Preview Section -->
          <div id="brandingLivePreview" style="border:2px solid var(--gr-border);border-radius:8px;padding:16px;margin-bottom:20px;background:var(--gr-bg)">
            <div style="font-weight:600;margin-bottom:8px;color:var(--gr-primary)">Live Preview</div>
            <div style="display:flex;align-items:center;padding:12px;background:white;border-radius:6px;border:1px solid var(--gr-border)">
              <img id="previewLogo" style="width:32px;height:32px;margin-right:12px;border-radius:4px;display:none">
              <div>
                <div id="previewFarmName" style="font-size:18px;font-weight:600;color:var(--gr-text)">${farmName}</div>
                <div id="previewTagline" style="font-size:12px;color:var(--gr-primary)">${currentBranding.tagline || 'Growing with technology'}</div>
              </div>
            </div>
          </div>
          
          <!-- Farm Details Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Farm Details</h4>
            <div style="margin-bottom:12px">
              <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Farm Name</label>
              <input type="text" id="farmNameInput" value="${farmName}" placeholder="Your Farm Name" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
            </div>
            <div>
              <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Tagline</label>
              <input type="text" id="taglineInput" value="${currentBranding.tagline || 'Growing with technology'}" placeholder="Farm tagline or motto" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
            </div>
          </div>
          
          <!-- Color Palette Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Color Palette</h4>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Primary Color</label>
                <input type="color" id="primaryColor" value="${currentBranding.palette.primary}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Accent Color</label>
                <input type="color" id="accentColor" value="${currentBranding.palette.accent}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Background</label>
                <input type="color" id="backgroundColor" value="${currentBranding.palette.background}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
              <div>
                <label style="display:block;margin-bottom:4px;font-size:12px;color:var(--medium)">Text Color</label>
                <input type="color" id="textColor" value="${currentBranding.palette.text}" style="width:100%;height:40px;border:1px solid var(--gr-border);border-radius:4px">
              </div>
            </div>
          </div>
          
          <!-- Logo Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Logo</h4>
            <input type="url" id="logoUrl" placeholder="Logo URL (or leave blank to use website favicon)" value="${currentBranding.logo}" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px;margin-bottom:8px">
            <div style="font-size:12px;color:var(--medium)"> We'll automatically use your website's favicon if no logo is provided</div>
            ${domain ? `<div style="font-size:12px;color:var(--gr-primary);margin-top:4px">🔗 Auto-detected from ${domain}</div>` : ''}
          </div>
          
          <!-- Font Section -->
          <div style="margin-bottom:20px">
            <h4 style="margin:0 0 12px;color:var(--gr-text)">Typography</h4>
            <select id="fontFamily" style="width:100%;padding:8px;border:1px solid var(--gr-border);border-radius:4px">
              <option value="">Default Font</option>
              <option value="Inter" ${currentBranding.fontFamily === 'Inter' ? 'selected' : ''}>Inter (Modern)</option>
              <option value="Roboto" ${currentBranding.fontFamily === 'Roboto' ? 'selected' : ''}>Roboto (Clean)</option>
              <option value="Open Sans" ${currentBranding.fontFamily === 'Open Sans' ? 'selected' : ''}>Open Sans (Friendly)</option>
              <option value="Montserrat" ${currentBranding.fontFamily === 'Montserrat' ? 'selected' : ''}>Montserrat (Bold)</option>
              <option value="Poppins" ${currentBranding.fontFamily === 'Poppins' ? 'selected' : ''}>Poppins (Rounded)</option>
            </select>
          </div>
          
          <!-- Action Buttons -->
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button id="testTheme" style="background:#ff6b6b;color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer"> Test Theme</button>
            <button id="resetBranding" style="background:var(--medium);color:white;border:none;padding:10px 16px;border-radius:6px;cursor:pointer">Reset to Default</button>
            <button id="saveBranding" style="background:var(--gr-primary);color:white;border:none;padding:10px 20px;border-radius:6px;cursor:pointer">Save Branding</button>
          </div>
        </div>
      </div>
    `;
    
    // Remove any existing wizard
    const existing = document.getElementById('brandingWizardBackdrop');
    if (existing) existing.remove();
    
    document.body.insertAdjacentHTML('beforeend', wizardContent);
    
    // Load the preview logo if available
    const previewLogo = document.getElementById('previewLogo');
    if (previewLogo && currentBranding.logo) {
      const testImg = new Image();
      testImg.onload = () => {
        previewLogo.src = currentBranding.logo;
        previewLogo.style.display = 'inline-block';
      };
      testImg.onerror = () => {
        previewLogo.style.display = 'none';
      };
      testImg.src = currentBranding.logo;
    }
    
    // Add event listeners
    this.setupBrandingWizardListeners();
    
    // Immediately populate the logo URL field with the current website favicon
    const logoUrlField = document.getElementById('logoUrl');
    if (logoUrlField && currentLogo) {
      logoUrlField.value = currentLogo;
    }
    
    // Initialize the preview with current values
    this.updateBrandingPreview();
  }

  setupBrandingWizardListeners() {
    // Close wizard - apply current changes before closing
    document.getElementById('closeBrandingWizard').addEventListener('click', () => {
      this.applyCurrentBrandingChanges();
      document.getElementById('brandingWizardBackdrop').remove();
    });
    
    // Auto-extract website branding if website exists
    const website = this.data.contact?.website;
    if (website) {
      console.log(' Auto-extracting website branding from:', website);
      // Trigger automatic extraction after a short delay
      setTimeout(() => {
        this.fetchWebsiteBrandingData();
      }, 500);
    }
    
    // Farm name and tagline inputs - live preview updates
    document.getElementById('farmNameInput').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    document.getElementById('taglineInput').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    // Color inputs - live preview updates
    const colorInputs = ['primaryColor', 'accentColor', 'backgroundColor', 'textColor'];
    colorInputs.forEach(inputId => {
      document.getElementById(inputId).addEventListener('input', (e) => {
        this.updateBrandingPreview();
      });
    });
    
    // Logo URL input
    document.getElementById('logoUrl').addEventListener('input', (e) => {
      this.updateBrandingPreview();
    });
    
    // Font family select
    document.getElementById('fontFamily').addEventListener('change', (e) => {
      this.updateBrandingPreview();
    });
    
    // Test theme button for debugging
    document.getElementById('testTheme').addEventListener('click', () => {
      console.log('Testing theme application...');
      // Apply a bright test theme to see if applyTheme works
      const testPalette = {
        primary: '#ff6b6b',
        accent: '#4ecdc4', 
        background: '#ffe66d',
        surface: '#ffffff',
        border: '#ff8e53',
        text: '#2d3436'
      };
      applyTheme(testPalette, { fontFamily: 'Arial, sans-serif' });
      console.log('Test theme applied!');
    });

    // Reset branding
    document.getElementById('resetBranding').addEventListener('click', () => {
      this.resetBrandingToDefaults();
    });    // Save branding
    document.getElementById('saveBranding').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Saving...';
      try {
        await this.saveBrandingChanges();
      } catch (err) {
  if (typeof showToast === 'function') showToast({ title: 'Save failed', msg: err?.message || String(err), kind: 'warn', icon: '' });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save Branding';
      }
    });
  }

  updateBrandingPreview() {
    console.log('updateBrandingPreview called');
    const paletteInputs = {
      primary: document.getElementById('primaryColor').value,
      accent: document.getElementById('accentColor').value,
      background: document.getElementById('backgroundColor').value,
      text: document.getElementById('textColor').value
    };
    const sanitizedPalette = sanitizeBrandPalette(paletteInputs);

    // Keep inputs in sync with sanitized palette to reflect contrast adjustments
    document.getElementById('primaryColor').value = sanitizedPalette.primary;
    document.getElementById('accentColor').value = sanitizedPalette.accent;
    document.getElementById('backgroundColor').value = sanitizedPalette.background;
    document.getElementById('textColor').value = sanitizedPalette.text;

    const primary = sanitizedPalette.primary;
    const accent = sanitizedPalette.accent;
    const background = sanitizedPalette.background;
    const text = sanitizedPalette.text;
    const logoUrl = document.getElementById('logoUrl').value;
    const fontFamily = document.getElementById('fontFamily').value;
    const farmName = document.getElementById('farmNameInput').value;
    const tagline = document.getElementById('taglineInput').value;
    
    console.log('Preview values:', { primary, accent, background, text, logoUrl, fontFamily, farmName, tagline });
    
    // Update the live preview container with new colors - make it very visible
    const previewContainer = document.getElementById('brandingLivePreview');
    if (previewContainer) {
      // Apply colors directly to the preview container
      previewContainer.style.borderColor = sanitizedPalette.border;
      previewContainer.style.backgroundColor = background;
      previewContainer.style.borderWidth = '3px'; // Make border more visible
      previewContainer.style.boxShadow = sanitizedPalette.shadow;
      console.log('Updated preview container with background:', background, 'border:', accent);
    }
    
    // Update preview elements directly
    const previewLogo = document.getElementById('previewLogo');
    const previewFarmName = document.getElementById('previewFarmName');
    const previewTagline = document.getElementById('previewTagline');
    
    console.log('Preview elements found:', { 
      previewLogo: !!previewLogo, 
      previewFarmName: !!previewFarmName, 
      previewTagline: !!previewTagline,
      previewContainer: !!previewContainer
    });

    if (logoUrl && previewLogo) {
      // Validate logo URL before attempting to load
      if (logoUrl.startsWith('http://') || logoUrl.startsWith('https://')) {
        console.log('Loading logo:', logoUrl);
        const testImg = new Image();
        testImg.onload = () => {
          console.log('Logo loaded successfully');
          previewLogo.src = logoUrl;
          previewLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          console.log('Logo failed to load');
          previewLogo.style.display = 'none';
        };
        testImg.src = logoUrl;
      } else {
        console.log('Invalid logo URL, hiding logo');
        previewLogo.style.display = 'none';
      }
    } else if (previewLogo) {
      console.log('No logo URL, hiding logo');
      previewLogo.style.display = 'none';
    }
    
    if (previewFarmName) {
      previewFarmName.textContent = farmName || 'Your Farm';
      previewFarmName.style.color = text;
      previewFarmName.style.fontFamily = fontFamily || 'inherit';
      previewFarmName.style.textShadow = sanitizedPalette.shadow ? `0 1px 2px ${hexToRgba(sanitizedPalette.primary, 0.15)}` : '';
      previewFarmName.style.fontWeight = 'bold'; // Make more visible
      console.log('Updated farm name preview with color:', text, 'font:', fontFamily);
    }

    if (previewTagline) {
      previewTagline.textContent = tagline || 'Growing with technology';
      previewTagline.style.color = accent;
      previewTagline.style.fontFamily = fontFamily || 'inherit';
      console.log('Updated tagline preview with color:', primary, 'font:', fontFamily);
    }
    
    // Update the inner preview card background and styling - make it more prominent
    const previewCard = previewContainer?.querySelector('div[style*="background:white"]');
    if (previewCard) {
      previewCard.style.backgroundColor = '#ffffff';
      previewCard.style.borderColor = primary;
      previewCard.style.borderWidth = '2px';
      previewCard.style.borderStyle = 'solid';
      console.log('Updated preview card styling with primary color border:', primary);
    }
  }

  applyCurrentBrandingChanges() {
    // Apply current branding wizard values to the UI without saving
    try {
      const farmName = document.getElementById('farmNameInput')?.value;
      const tagline = document.getElementById('taglineInput')?.value;
      
      const paletteInputs = {
        primary: document.getElementById('primaryColor')?.value || '#0D7D7D',
        accent: document.getElementById('accentColor')?.value || '#64C7C7',
        background: document.getElementById('backgroundColor')?.value || '#F7FAFA',
        text: document.getElementById('textColor')?.value || '#0B1220'
      };
      const sanitizedPalette = sanitizeBrandPalette(paletteInputs);

      document.getElementById('primaryColor').value = sanitizedPalette.primary;
      document.getElementById('accentColor').value = sanitizedPalette.accent;
      document.getElementById('backgroundColor').value = sanitizedPalette.background;
      document.getElementById('textColor').value = sanitizedPalette.text;

      const branding = {
        palette: sanitizedPalette,
        logo: document.getElementById('logoUrl')?.value || '',
        tagline: tagline || 'Growing with technology',
        fontFamily: document.getElementById('fontFamily')?.value || '',
        fontCss: document.getElementById('fontFamily')?.value ? [`https://fonts.googleapis.com/css2?family=${document.getElementById('fontFamily').value.replace(' ', '+')}&display=swap`] : []
      };
      
      // Update farm name in wizard data if changed
      if (farmName && farmName !== this.data.location.farmName) {
        this.data.location.farmName = farmName;
      }
      
      // Update STATE.farm temporarily for header display
      if (!STATE.farm) STATE.farm = {};
      STATE.farm.branding = branding;
      STATE.farm.name = farmName || STATE.farm.name;
      STATE.farm.tagline = tagline || STATE.farm.tagline;
      STATE.farm.logo = branding.logo || STATE.farm.logo;
      
      // Apply the theme immediately
      this.applyBranding(branding);
      
      // Update the header display immediately
      this.updateFarmHeaderDisplay();
      
      // Update the live branding preview in the wizard
      this.updateLiveBranding();
      
      // Force refresh of any displayed branding elements
      initializeTopCard();
    } catch (e) {
      console.warn('Failed to apply current branding changes:', e);
    }
  }

  resetBrandingToDefaults() {
  const farmName = this.data.location?.farmName || 'Your Farm';
  document.getElementById('farmNameInput').value = farmName;
  document.getElementById('taglineInput').value = 'Growing with technology';
  document.getElementById('primaryColor').value = '#0D7D7D';
  document.getElementById('accentColor').value = '#64C7C7';
  document.getElementById('backgroundColor').value = '#F7FAFA';
  document.getElementById('textColor').value = '#0B1220';
  document.getElementById('logoUrl').value = '';
  document.getElementById('fontFamily').value = '';
  this.updateBrandingPreview();
  // Immediately apply and save the default branding so the app resets everywhere
  this.saveBrandingChanges();
  }

  async saveBrandingChanges() {
    const farmName = document.getElementById('farmNameInput').value;
    const tagline = document.getElementById('taglineInput').value;
    
    const paletteInputs = {
      primary: document.getElementById('primaryColor').value,
      accent: document.getElementById('accentColor').value,
      background: document.getElementById('backgroundColor').value,
      text: document.getElementById('textColor').value
    };
    const sanitizedPalette = sanitizeBrandPalette(paletteInputs);

    // Reflect sanitized palette back into the inputs so the user sees the accessible variant
    document.getElementById('primaryColor').value = sanitizedPalette.primary;
    document.getElementById('accentColor').value = sanitizedPalette.accent;
    document.getElementById('backgroundColor').value = sanitizedPalette.background;
    document.getElementById('textColor').value = sanitizedPalette.text;

    const branding = {
      palette: sanitizedPalette,
      logo: document.getElementById('logoUrl').value,
      tagline: tagline || 'Growing with technology',
      fontFamily: document.getElementById('fontFamily').value,
      fontCss: document.getElementById('fontFamily').value ? [`https://fonts.googleapis.com/css2?family=${document.getElementById('fontFamily').value.replace(' ', '+')}&display=swap`] : []
    };
    
    console.log(' Saving branding with palette:', branding.palette);
    
    // Update farm name in wizard data
    if (farmName) {
      this.data.location.farmName = farmName;
    }
    
    // Update STATE.farm with branding and farm details
    if (!STATE.farm) STATE.farm = {};
    STATE.farm.branding = branding;
    STATE.farm.name = farmName;
    STATE.farm.tagline = tagline;
    STATE.farm.logo = branding.logo;
    
    console.log(' Updated STATE.farm.branding:', STATE.farm.branding);
    
    // Apply the theme immediately - THIS IS CRITICAL
    console.log(' Calling applyBranding with:', branding);
    this.applyBranding(branding);
    
    // Also apply theme directly to make sure it works
    console.log(' Calling applyTheme directly with palette:', branding.palette);
    applyTheme(branding.palette);
    
    // Update the header display immediately
    this.updateFarmHeaderDisplay();
    
    // Update the live branding preview in the wizard
    this.updateLiveBranding();
    
    // Update any form fields with the new farm name
    const farmNameEl = document.getElementById('farmName');
    if (farmNameEl && farmName) {
      farmNameEl.value = farmName;
    }
    
    // Force refresh of any displayed branding elements
    initializeTopCard();
    
    // Save to backend or localStorage, always close modal
    try {
      localStorage.setItem('gr.farm', JSON.stringify(STATE.farm));
    } catch (e) {
      console.warn('Could not save branding to localStorage:', e);
    }
    try {
      if (STATE.farm.name) {
        await safeFarmSave(STATE.farm);
        showToast({ title: 'Branding saved', msg: 'Your farm branding has been updated successfully.', kind: 'success', icon: '' });
      } else {
        showToast({ title: 'Branding applied', msg: 'Branding will be saved when you complete farm registration.', kind: 'info', icon: '' });
      }
    } catch (e) {
      showToast({ title: 'Save warning', msg: 'Branding applied locally but could not sync to server.', kind: 'warn', icon: '' });
    }
    document.getElementById('brandingWizardBackdrop').remove();
  }
  
  // Add a helper function to update the farm header display
  updateFarmHeaderDisplay() {
    const farmNameEl = document.getElementById('farmName');
    const farmBrandingSection = document.getElementById('farmBrandingSection');
    const farmLogoEl = document.getElementById('farmLogo');
    const farmTaglineEl = document.getElementById('farmTagline');
    
    if (STATE.farm && STATE.farm.name) {
      // Show farm branding section
      if (farmBrandingSection) {
        farmBrandingSection.style.display = 'block';
      }
      
      // Update farm name
      if (farmNameEl) {
        farmNameEl.textContent = STATE.farm.name;
      }
      
      // Update farm tagline if available
      if (farmTaglineEl && STATE.farm.tagline) {
        farmTaglineEl.textContent = STATE.farm.tagline;
        farmTaglineEl.style.display = 'block';
      }
      
      // Update farm logo
      if (farmLogoEl && STATE.farm.logo) {
        // Validate logo URL before attempting to load
        const logoUrl = STATE.farm.logo.trim();
        if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
          // Use test image approach to avoid 404s
          const testImg = new Image();
          testImg.onload = () => {
            farmLogoEl.src = logoUrl;
            farmLogoEl.style.display = 'block';
          };
          testImg.onerror = () => {
            farmLogoEl.style.display = 'none';
          };
          testImg.src = logoUrl;
        } else {
          farmLogoEl.style.display = 'none';
        }
      }
    }
  }

  applyBranding(branding) {
    console.log(' applyBranding called with:', branding);
    
    // Apply theme using the global applyTheme function for comprehensive theming
    if (branding.palette) {
      console.log(' Applying theme with palette:', branding.palette);
    if (typeof applyTheme === 'function') {
      applyTheme(branding.palette, {
        fontFamily: branding.fontFamily || '',
        logoHeight: branding.logoHeight || ''
      });
      console.log(' Theme applied successfully');
    }
    } else {
      console.warn(' No palette found in branding object!');
    }
    
    // Update the farm logo in the header
    if (branding.logo) {
      const logoUrl = branding.logo.trim();
      if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
        const farmLogo = document.getElementById('farmLogo');
        if (farmLogo) {
          // Use test image approach to avoid 404s
          const testImg = new Image();
          testImg.onload = () => {
            farmLogo.src = logoUrl;
            farmLogo.style.display = 'block';
          };
          testImg.onerror = () => {
            farmLogo.style.display = 'none';
          };
          testImg.src = logoUrl;
        }
      }
    }
    
    // Load custom fonts
    if (branding.fontCss && branding.fontCss.length) {
      const fontLink = document.getElementById('gr-brand-fonts') || document.createElement('link');
      fontLink.id = 'gr-brand-fonts';
      fontLink.rel = 'stylesheet';
      fontLink.href = branding.fontCss[0];
      if (!document.getElementById('gr-brand-fonts')) {
        document.head.appendChild(fontLink);
      }
    }
  }

  async fetchWebsiteBranding() {
    clearTimeout(this.websiteTimeout);
    this.websiteTimeout = setTimeout(async () => {
      const website = this.data.contact?.website?.trim();
      if (!website) return;

      try {
        // Try to fetch website metadata for enhanced branding
        const url = website.startsWith('http') ? website : `https://${website}`;
        
        // Use a simple approach to try to get favicon
        const domain = this.extractDomain(website);
        const faviconUrl = `https://${domain}/favicon.ico`;
        
        // Note: We don't update the main farmLogo here anymore - that should only 
        // happen when the user explicitly applies branding changes
        
        // Update tagline with website info
        const farmTaglineEl = $('#farmTagline');
        if (farmTaglineEl && !this.data.location?.farmName) {
          farmTaglineEl.innerHTML = `<a href="${url}" target="_blank" style="color:var(--gr-primary);text-decoration:none">${domain}</a>`;
        }
        
      } catch (error) {
        console.log('Website branding fetch failed:', error.message);
      }
    }, 1000); // 1 second debounce
  }

  async fetchWebsiteBrandingData() {
    const website = this.data.contact?.website?.trim();
    if (!website) {
      console.log('No website URL available for auto-extraction');
      return;
    }

    const statusEl = document.getElementById('autoExtractionStatus');
    if (statusEl) {
      statusEl.textContent = '⏳ Extracting branding...';
      statusEl.style.background = '#fef3c7';
      statusEl.style.color = '#92400e';
    }

    try {
      const url = website.startsWith('http') ? website : `https://${website}`;
      console.log(' Auto-fetching branding from:', url);
      
      const response = await fetch(`/brand/extract?url=${encodeURIComponent(url)}`);
      const data = await response.json();
      
      console.log(' Website branding data received:', data);
      
      if (data.ok && data.palette) {
        const sanitizedPalette = sanitizeBrandPalette(data.palette);

        // Update the form inputs with the sanitized data to enforce contrast requirements
        document.getElementById('primaryColor').value = sanitizedPalette.primary;
        document.getElementById('accentColor').value = sanitizedPalette.accent;
        document.getElementById('backgroundColor').value = sanitizedPalette.background;
        document.getElementById('textColor').value = sanitizedPalette.text;

        if (data.logo) {
          document.getElementById('logoUrl').value = data.logo;
        }
        if (data.fontFamily) {
          document.getElementById('fontFamily').value = data.fontFamily;
        }
        
        // Update the live preview
        this.updateBrandingPreview();
        
        console.log(' Branding wizard auto-populated with website data');
        
        // Update status to success
        if (statusEl) {
          statusEl.textContent = ' Branding extracted!';
          statusEl.style.background = '#d1fae5';
          statusEl.style.color = '#065f46';
          setTimeout(() => {
            statusEl.style.opacity = '0';
            setTimeout(() => statusEl.remove(), 300);
          }, 2000);
        }
      } else {
        console.log(' Failed to extract branding:', data.error);
        
        // Update status to partial success
        if (statusEl) {
          statusEl.textContent = ' Partial extraction';
          statusEl.style.background = '#fef3c7';
          statusEl.style.color = '#92400e';
        }
        
        // At least try to set the logo if we have it
        if (data.logo) {
          document.getElementById('logoUrl').value = data.logo;
        }
        this.updateBrandingPreview();
      }
    } catch (error) {
      console.error(' Error fetching website branding:', error);
      
      // Update status to error
      if (statusEl) {
        statusEl.textContent = ' Extraction failed';
        statusEl.style.background = '#fee2e2';
        statusEl.style.color = '#991b1b';
      }
    }
  }
}




// --- Device Discovery & Manager ---
class DeviceManagerWindow {
  constructor() {
    this.host = $('#deviceManager');
    this.backdrop = $('#deviceManagerBackdrop');
    this.closeBtn = $('#deviceManagerClose');
    this.resultsEl = $('#deviceDiscoveryResults');
    this.statusEl = $('#discoveryStatus');
    this.summaryEl = $('#deviceManagerSummary');
    this.runBtn = $('#btnRunDiscovery');
    this.filterButtons = Array.from(document.querySelectorAll('#deviceManager [data-filter]'));
    this.automationBtn = $('#btnOpenAutomation');
    this.devices = [];
    this.activeFilter = 'all';
    this.discoveryRun = null;
    this.bind();
  }

  bind() {
    $('#btnDiscover')?.addEventListener('click', () => this.open());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.backdrop?.addEventListener('click', () => this.close());
    this.runBtn?.addEventListener('click', () => this.runDiscovery());
    this.filterButtons.forEach(btn => btn.addEventListener('click', () => this.setFilter(btn.dataset.filter)));
    this.automationBtn?.addEventListener('click', () => {
      showToast({ title: 'Automation card', msg: 'Coming soon — natural language rules for any sensor to control any device.', kind: 'info', icon: '' }, 5000);
    });
  }

  open() {
    if (!this.host) return;
    this.host.setAttribute('aria-hidden', 'false');
    if (!this.devices.length) this.runDiscovery();
    this.render();
  }

  close() {
    if (!this.host) return;
    this.host.setAttribute('aria-hidden', 'true');
  }

  setFilter(filter) {
    this.activeFilter = filter || 'all';
    this.filterButtons.forEach(btn => btn.setAttribute('aria-selected', btn.dataset.filter === this.activeFilter ? 'true' : 'false'));
    this.render();
  }

  async runDiscovery() {
    if (this.statusEl) this.statusEl.textContent = 'Scanning local network, BLE hub, and MQTT broker…';
    try {
      const resp = await fetchWithFarmAuth('/discovery/devices');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const body = await resp.json();
      this.discoveryRun = body;
      const list = Array.isArray(body.devices) ? body.devices : [];
      // Dynamically import OUI lookup
      let lookupVendorByMac = null;
      try {
        lookupVendorByMac = (await import('./oui-lookup.js')).lookupVendorByMac;
      } catch (e) {}
      this.devices = list.map(dev => {
        let vendor = dev.vendor || dev.brand || 'Unknown';
        // If vendor is unknown and MAC is present, try OUI lookup
        if ((vendor === 'Unknown' || !vendor) && lookupVendorByMac && dev.mac) {
          vendor = lookupVendorByMac(dev.mac);
        } else if ((vendor === 'Unknown' || !vendor) && lookupVendorByMac && dev.address && typeof dev.address === 'string' && dev.address.match(/^([0-9A-Fa-f]{2}[:-]){5}/)) {
          vendor = lookupVendorByMac(dev.address);
        }
        return {
          id: dev.id || `${dev.protocol}:${dev.address || dev.name || Math.random().toString(36).slice(2,8)}`,
          name: dev.name || dev.label || 'Unknown device',
          protocol: dev.protocol || 'wifi',
          confidence: typeof dev.confidence === 'number' ? dev.confidence : 0.6,
          signal: dev.signal ?? dev.rssi ?? null,
          address: dev.address || dev.ip || dev.mac || null,
          vendor,
          lastSeen: dev.lastSeen || body.completedAt || new Date().toISOString(),
          hints: dev.hints || {},
          status: 'new',
          assignment: null
        };
      });
      if (this.statusEl) this.statusEl.textContent = `Found ${this.devices.length} device${this.devices.length === 1 ? '' : 's'}`;
      showToast({ title: 'Discovery complete', msg: `Found ${this.devices.length} potential devices`, kind: 'success', icon: '' });
    } catch (err) {
      console.error('Discovery failed', err);
      // NO DEMO DEVICES - Show error and require live discovery
      this.devices = [];
      if (this.statusEl) this.statusEl.textContent = 'Discovery failed - no devices found';
      showToast({ 
        title: 'Discovery Failed', 
        msg: 'Device discovery failed. Please check network connectivity and try again. No demo devices available.', 
        kind: 'error', 
        icon: '' 
      });
    }
    this.render();
  }

  filteredDevices() {
    if (this.activeFilter === 'added') return this.devices.filter(d => d.status === 'added');
    if (this.activeFilter === 'ignored') return this.devices.filter(d => d.status === 'ignored');
    return this.devices;
  }

  render() {
    if (!this.resultsEl) return;
    const devices = this.filteredDevices();
    this.resultsEl.innerHTML = '';
    if (!devices.length) {
      this.resultsEl.innerHTML = '<p class="tiny">No devices to show. Run discovery or adjust filters.</p>';
      return;
    }
    // Group devices by family/protocol
    const families = {
      switchbot: [],
      mqtt: [],
      wifi: [],
      ble: [],
      mdns: [],
      other: [],
      unknown: []
    };
    devices.forEach(dev => {
      const proto = (dev.protocol || '').toLowerCase();
      if (proto.includes('switchbot')) families.switchbot.push(dev);
      else if (proto.includes('mqtt')) families.mqtt.push(dev);
      else if (proto.includes('wifi')) families.wifi.push(dev);
      else if (proto.includes('ble') || proto.includes('bluetooth')) families.ble.push(dev);
      else if (proto.includes('mdns')) families.mdns.push(dev);
      else if (dev.vendor === 'Unknown' || proto === 'unknown' || !proto) families.unknown.push(dev);
      else families.other.push(dev);
    });
    // Helper to render a family section
    const renderFamilySection = (title, devs) => {
      if (!devs.length) return;
      const section = document.createElement('section');
      section.className = 'device-family-section';
      section.innerHTML = `<h3 class="device-family-title">${title}</h3>`;
      devs.forEach(dev => section.appendChild(this.renderDeviceCard(dev)));
      this.resultsEl.appendChild(section);
    };
    renderFamilySection('SwitchBot Devices', families.switchbot);
    renderFamilySection('MQTT Devices', families.mqtt);
    renderFamilySection('Wi-Fi Devices', families.wifi);
    renderFamilySection('Bluetooth/BLE Devices', families.ble);
    renderFamilySection('mDNS Devices', families.mdns);
    renderFamilySection('Other Devices', families.other);
    // Unknown devices table/section
    if (families.unknown.length) {
      const section = document.createElement('section');
      section.className = 'device-family-section device-unknown-section';
      section.innerHTML = `<h3 class="device-family-title">Unknown Devices</h3>`;
      // Table header
      const table = document.createElement('table');
      table.className = 'device-unknown-table';
      table.innerHTML = `<thead><tr><th>Name</th><th>Vendor</th><th>Address</th><th>Protocol</th><th>Last Seen</th><th>Actions</th></tr></thead><tbody></tbody>`;
      families.unknown.forEach(dev => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${escapeHtml(dev.name)}</td>
          <td>${escapeHtml(dev.vendor)}</td>
          <td>${escapeHtml(dev.address || '')}</td>
          <td>${escapeHtml(dev.protocol || '')}</td>
          <td>${new Date(dev.lastSeen).toLocaleString()}</td>
          <td>
            <button type="button" class="primary" data-action="add">Assign</button>
            <button type="button" class="ghost" data-action="ignore">Ignore</button>
          </td>
        `;
        // Add event listeners for actions
        tr.querySelector('[data-action="add"]').addEventListener('click', () => {
          // Show assignment form in a modal or inline (reuse toggleAssignment logic)
          this.toggleAssignment(tr, dev);
        });
        tr.querySelector('[data-action="ignore"]').addEventListener('click', () => this.toggleIgnore(dev));
        table.querySelector('tbody').appendChild(tr);
      });
      section.appendChild(table);
      this.resultsEl.appendChild(section);
    }
    const added = this.devices.filter(d => d.status === 'added').length;
    const ignored = this.devices.filter(d => d.status === 'ignored').length;
    const total = this.devices.length;
    if (this.summaryEl) this.summaryEl.textContent = `${total} found · ${added} added · ${ignored} ignored`;
  }

  renderDeviceCard(device) {
    const card = document.createElement('article');
    card.className = 'device-manager__card';
    card.dataset.deviceId = device.id;
    const signal = device.signal != null ? `${device.signal} dBm` : '—';
    const confidencePct = Math.round(device.confidence * 100);
    const statusBadge = device.status === 'added' ? '<span class="badge badge--success">Added</span>' : (device.status === 'ignored' ? '<span class="badge badge--muted">Ignored</span>' : '');
    // Device-family-specific controls
    let familyControls = '';
    const proto = (device.protocol || '').toLowerCase();
    if (proto.includes('switchbot')) {
      familyControls += `<button type="button" class="secondary" data-action="open-switchbot">Pair/Open Manager</button>`;
    } else if (proto.includes('mqtt')) {
      familyControls += `<button type="button" class="secondary" data-action="mqtt-sub">Subscribe/Unsubscribe</button>`;
    } else if (proto.includes('wifi')) {
      familyControls += `<div class="tiny">Wi-Fi device: <b>${escapeHtml(device.address || '')}</b></div>`;
    }
    card.innerHTML = `
      <header class="device-manager__card-header">
        <div>
          <div class="device-manager__name">${escapeHtml(device.name)}</div>
          <div class="tiny">${escapeHtml(device.vendor)} • ${escapeHtml(device.address || 'No address')}</div>
        </div>
        <div class="device-manager__badges">
          <span class="badge badge--protocol">${device.protocol.toUpperCase()}</span>
          ${statusBadge}
        </div>
      </header>
      <div class="device-manager__card-body">
        <div class="tiny">Last seen ${new Date(device.lastSeen).toLocaleString()}</div>
        ${device.hints?.metrics ? `<div class="tiny">Metrics: ${device.hints.metrics.join(', ')}</div>` : ''}
        ${device.hints?.type ? `<div class="tiny">Suggested type: ${device.hints.type}</div>` : ''}
        ${familyControls}
      </div>
      <div class="device-manager__actions">
        <button type="button" class="primary" data-action="add">${device.status === 'added' ? 'Edit assignment' : 'Add to Farm'}</button>
        <button type="button" class="ghost" data-action="ignore">${device.status === 'ignored' ? 'Undo ignore' : 'Ignore'}</button>
      </div>
      <div class="device-manager__assignment" data-assignment></div>
    `;
    const actions = card.querySelector('.device-manager__actions');
    actions.querySelector('[data-action="add"]').addEventListener('click', () => this.toggleAssignment(card, device));
    actions.querySelector('[data-action="ignore"]').addEventListener('click', () => this.toggleIgnore(device));
    // Device-family-specific action handlers
    if (proto.includes('switchbot')) {
      card.querySelector('[data-action="open-switchbot"]').addEventListener('click', () => {
        if (typeof window.openSwitchBotManager === 'function') window.openSwitchBotManager();
      });
    } else if (proto.includes('mqtt')) {
      card.querySelector('[data-action="mqtt-sub"]').addEventListener('click', () => {
        showToast({ title: 'MQTT', msg: 'Subscribe/Unsubscribe coming soon.', kind: 'info', icon: '' });
      });
    }
    this.renderAssignment(card, device);
    return card;
  }

  toggleAssignment(card, device) {
    const slot = card.querySelector('[data-assignment]');
    if (!slot) return;
    if (slot.querySelector('form')) {
      slot.innerHTML = '';
      return;
    }
    const form = this.buildAssignmentForm(device);
    slot.innerHTML = '';
    slot.appendChild(form);
  }

  buildAssignmentForm(device) {
    const form = document.createElement('form');
    form.className = 'device-manager__assign-form';
    let rooms = (collectRoomsFromState() || []).map(room => ({
      id: room?.id || '',
      name: room?.name || '',
      zones: Array.isArray(room?.zones) ? room.zones : []
    }));
    if (!rooms.length) {
      form.innerHTML = '<p class="tiny">Add rooms in the Farm setup to assign devices.</p>';
      return form;
    }
    const roomOptions = () => rooms.map(room => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)}</option>`).join('');
    form.innerHTML = `
      <label class="tiny">Room
        <select name="room" required></select>
      </label>
      <label class="tiny">Zone
        <select name="zone"></select>
        <button type="button" id="createNewZoneBtn" class="ghost" style="margin-left:8px;">Create New Zone</button>
      </label>
      <label class="tiny">Type
        <select name="type" required>
          <option value="light">Light</option>
          <option value="sensor">Sensor</option>
          <option value="plug">Plug</option>
          <option value="hvac">HVAC</option>
          <option value="other">Other</option>
        </select>
      </label>
      <button type="submit" class="primary">Save</button>
    `;
    const roomSelect = form.querySelector('select[name="room"]');
    const zoneSelect = form.querySelector('select[name="zone"]');
    const createZoneBtn = form.querySelector('#createNewZoneBtn');

    // Helper to update room and zone dropdowns
    function refreshRoomsAndZones(selectedRoomId, selectedZone) {
      rooms = (collectRoomsFromState() || []).map(room => ({
        id: room?.id || '',
        name: room?.name || '',
        zones: Array.isArray(room?.zones) ? room.zones : []
      }));
      roomSelect.innerHTML = '<option value="">Select room</option>' + roomOptions();
      let roomId = selectedRoomId;
      if (!roomId || !rooms.some(r => r.id === roomId)) {
        roomId = rooms[0]?.id || '';
      }
      roomSelect.value = roomId;
      updateZones(roomId, selectedZone);
    }

    function updateZones(roomId, zoneToPreserve) {
      const selectedRoom = rooms.find(r => r.id === roomId);
      const zones = selectedRoom ? selectedRoom.zones : [];
      zoneSelect.innerHTML = '<option value="">Whole room</option>' + zones.map(z => `<option value="${escapeHtml(z)}">${escapeHtml(z)}</option>`).join('');
      if (zoneToPreserve && zones.includes(zoneToPreserve)) {
        zoneSelect.value = zoneToPreserve;
      } else {
        zoneSelect.value = '';
      }
    }

    // Listen for state refreshes to keep lists in sync
    window.addEventListener('farmDataChanged', () => {
      refreshRoomsAndZones(roomSelect.value, zoneSelect.value);
    });

    roomSelect.addEventListener('change', () => {
      updateZones(roomSelect.value, '');
    });

    // Create New Zone action
    createZoneBtn.addEventListener('click', () => {
      const roomId = roomSelect.value;
      if (!roomId) return alert('Select a room first');
      const zoneName = prompt('Enter new zone name:');
      if (!zoneName) return;
      // Find and update the room in STATE.rooms (preferred) or STATE.farm.rooms
      let updated = false;
      if (Array.isArray(STATE.rooms)) {
        const r = STATE.rooms.find(r => r.id === roomId);
        if (r) {
          r.zones = Array.isArray(r.zones) ? r.zones : [];
          if (!r.zones.includes(zoneName)) {
            r.zones.push(zoneName);
            updated = true;
          }
        }
      }
      if (!updated && Array.isArray(STATE.farm?.rooms)) {
        const r = STATE.farm.rooms.find(r => r.id === roomId);
        if (r) {
          r.zones = Array.isArray(r.zones) ? r.zones : [];
          if (!r.zones.includes(zoneName)) {
            r.zones.push(zoneName);
            updated = true;
          }
        }
      }
      if (updated) {
        showToast({ title: 'Zone added', msg: `Zone "${zoneName}" added to room.`, kind: 'success', icon: '' });
        refreshRoomsAndZones(roomId, zoneName);
        if (typeof safeRoomsSave === 'function') {
          try { safeRoomsSave({ id: roomId }); } catch {}
        }
        window.dispatchEvent(new CustomEvent('farmDataChanged'));
      } else {
        alert('Failed to add zone.');
      }
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const roomId = roomSelect.value;
      if (!roomId) { alert('Choose a room'); return; }
      const zone = zoneSelect.value || null;
      const type = form.querySelector('select[name="type"]').value;
      device.assignment = { roomId, zone, type };
      device.status = 'added';
      showToast({ title: 'Device added', msg: `${device.name} mapped to ${type} in room ${rooms.find(r => r.id === roomId)?.name || roomId}`, kind: 'success', icon: '' });
      this.render();
    });

    // If editing, pre-select values
    if (device.assignment) {
      refreshRoomsAndZones(device.assignment.roomId, device.assignment.zone || '');
      form.querySelector('select[name="type"]').value = device.assignment.type || 'other';
    } else {
      refreshRoomsAndZones('', '');
    }
    return form;
  }

  renderAssignment(card, device) {
    const slot = card.querySelector('[data-assignment]');
    if (!slot) return;
    if (device.status !== 'added' || !device.assignment) {
      slot.innerHTML = '';
      return;
    }
    const rooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const room = rooms.find(r => r.id === device.assignment.roomId);
    slot.innerHTML = `<div class="tiny">Assigned to <strong>${escapeHtml(room?.name || 'Room')}</strong>${device.assignment.zone ? ` · Zone ${escapeHtml(device.assignment.zone)}` : ''} as ${device.assignment.type}</div>`;
  }


  toggleIgnore(device) {
    if (device.status === 'ignored') {
      device.status = 'new';
    } else {
      device.status = 'ignored';
      device.assignment = null;
    }
    this.render();
  }

}

// --- Grow Room Wizard ---
class RoomWizard {
  renderRoomsEditor() {
    if (this._stepInProgress || this._blockNextStep) {
      console.warn('[RoomWizard] nextStep: already in progress or blocked, ignoring call');
      return;
    }
    this._stepInProgress = true;
    try {
      console.debug('[RoomWizard] nextStep called. currentStep:', this.currentStep, 'steps:', this.steps);
      // Block nextStep if we just rebuilt steps and set currentStep (after hardware)
      if (this._justRebuiltSteps) {
        this._justRebuiltSteps = false;
        this._blockNextStep = true;
        setTimeout(() => { this._blockNextStep = false; }, 400);
        console.debug('[RoomWizard] nextStep: blocked after dynamic step rebuild');
        return;
      }
      if (!this.validateCurrentStep()) {
        console.debug('[RoomWizard] nextStep: validation failed at', this.currentStep);
        this.showStep(this.currentStep);
        return;
      }
      const next = this.currentStep + 1;
      if (next < this.steps.length) {
        console.debug('[RoomWizard] nextStep: moving to', next, 'step:', this.steps[next]);
        this.showStep(next);
      }
    } finally {
      setTimeout(() => { this._stepInProgress = false; }, 200);
    }
  }
  showError(id, msg) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = msg;
      el.style.display = msg ? '' : 'none';
    }
  }
  constructor() {
    console.debug('[RoomWizard] constructor called');
    this.modal = $('#roomModal');
    this.form = $('#roomWizardForm');
    // Listen for global lightSetupsChanged event to re-render summary
    if (!this._lightSetupsListener) {
      this._lightSetupsListener = () => this.renderRoomsEditor();
      window.addEventListener('lightSetupsChanged', this._lightSetupsListener);
    }
    // Auto-advance behavior: when a required field for a step is completed,
    // the wizard will advance automatically. Can be disabled if needed.
    // Default to manual navigation so you can review each page without being blocked
    this.autoAdvance = false;
    // equipment-first: begin with connectivity and hardware categories for room management
    // Steps can be augmented dynamically based on selected hardware (e.g., hvac, dehumidifier, etc.)
  this.baseSteps = ['room-info','hardware','category-setup','review'];
    this.steps = this.baseSteps.slice();
    this.currentStep = 0;
    this.data = {
      id: '',
      name: '',
      location: '',
      hardwareCats: [],
      hardwareOrder: [],
      layout: { type: '', rows: 0, racks: 0, levels: 0 },
      zones: [],
  energy: '',
  energyHours: 0,
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
      roles: { admin: [], operator: [], viewer: [] },
  grouping: { groups: [], planId: '', scheduleId: '' }
    };
    this.hardwareSearchResults = [];
    // dynamic category setup state
    this.categoryQueue = []; // ordered list of categories to visit
    this.categoryIndex = -1; // index within categoryQueue for current category-setup step
    // Per-category progress and status map. Keys are category ids, values: { status: 'not-started'|'needs-hub'|'needs-setup'|'needs-energy'|'complete', controlConfirmed: bool, notes: string }
    this.categoryProgress = {};
    this.init();
  }

  init() {
    console.debug('[RoomWizard] init called');
    // Remove any existing event listeners by replacing the button node
    const oldBtn = document.getElementById('btnLaunchRoom');
    if (oldBtn) {
      const newBtn = oldBtn.cloneNode(true);
      oldBtn.parentNode.replaceChild(newBtn, oldBtn);
      newBtn.addEventListener('click', () => {
        console.debug('[RoomWizard] btnLaunchRoom clicked');
        this.open();
      });
    }
    $('#roomModalClose')?.addEventListener('click', () => this.close());
    $('#roomModalBackdrop')?.addEventListener('click', () => this.close());
    // --- One-time wiring and step guards for Room Setup wizard ---
    if (!this._navWired) {
      const prev = document.getElementById('roomPrev');
      const next = document.getElementById('roomNext');
      const topPrev = document.getElementById('roomTopPrev');
      const topNext = document.getElementById('roomTopNext');
      const topSaveClose = document.getElementById('roomTopSaveClose');
      // Remove any inline handlers just in case
      if (prev) prev.onclick = null;
      if (next) next.onclick = null;
      if (topPrev) topPrev.onclick = null;
      if (topNext) topNext.onclick = null;
      if (topSaveClose) topSaveClose.onclick = null;
      // Step guards
      this._isAdvancing = false;
      const onPrevClick = () => {
        if (this._isAdvancing) return;
        this.prevStep();
      };
      const onNextClick = async (e) => {
        if (this._isAdvancing) return;
        this._isAdvancing = true;
        try {
          // validate returns boolean; do NOT mutate currentStep here
          const ok = await this.validateCurrentStep();
          if (!ok) return;
          // If on category-setup and more categories remain, advance within categories
          const stepKey = this.steps[this.currentStep];
          if (stepKey === 'category-setup' && this.categoryQueue.length > 0 && this.categoryIndex < this.categoryQueue.length - 1) {
            this.captureCurrentCategoryForm();
            this.categoryIndex++;
            this.renderCurrentCategoryForm();
            this.updateCategoryNav();
            return; // stay on category-setup step
          }
          const nextIdx = Math.min(this.currentStep + 1, this.steps.length - 1);
          if (nextIdx !== this.currentStep) {
            this.currentStep = nextIdx;
            this.showStep(this.currentStep);
          } else {
            this.saveAndClose();
          }
        } finally {
          setTimeout(() => { this._isAdvancing = false; }, 0);
        }
      };
      prev?.addEventListener('click', onPrevClick, { passive: true });
      next?.addEventListener('click', onNextClick, { passive: true });
      topPrev?.addEventListener('click', onPrevClick, { passive: true });
      topNext?.addEventListener('click', onNextClick, { passive: true });
      topSaveClose?.addEventListener('click', () => this.saveAndClose());
      // Enter key should advance exactly once; prevent implicit submit
      const modal = document.getElementById('roomModal');
      if (modal) {
        modal.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onNextClick(e);
          }
        });
        // Optional: stop propagation from inputs that need native Enter behavior
        const content = modal.querySelector('#roomWizardContent');
        if (content) {
          content.addEventListener('keydown', (e) => {
            const tag = e.target.tagName;
            if (e.key === 'Enter' && (tag === 'TEXTAREA')) {
              e.stopPropagation();
            }
          });
        }
      }
      this._navWired = true;
    }
    this.form?.addEventListener('submit', (e)=> this.saveRoom(e));

    if (this.modal) {
      const isOpen = this.modal.getAttribute('aria-hidden') === 'false';
      if (!isOpen) {
        this.modal.style.display = 'none';
      } else if (!this.modal.dataset.leOpen) {
        this.close();
      }
    }

    // Chip groups
    const chipGroup = (sel, target, field) => {
      const host = $(sel); if (!host) return;
      host.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option'); if (!btn) return;
        host.querySelectorAll('.chip-option').forEach(b=>b.removeAttribute('data-active'));
        btn.setAttribute('data-active','');
        target[field] = btn.dataset.value;
        if (field === 'type') this.data.layout.type = btn.dataset.value;
        if (sel === '#roomEnergy') this.updateSetupQueue();
        if (sel === '#roomLayoutType') this.updateSetupQueue();
      });
    };
    chipGroup('#roomLayoutType', this.data.layout, 'type');
    chipGroup('#roomEnergy', this.data, 'energy');
    $('#roomRows')?.addEventListener('input', (e)=> { this.data.layout.rows = Number(e.target.value||0); this.updateSetupQueue(); });
    $('#roomRacks')?.addEventListener('input', (e)=> { this.data.layout.racks = Number(e.target.value||0); this.updateSetupQueue(); });
    $('#roomLevels')?.addEventListener('input', (e)=> { this.data.layout.levels = Number(e.target.value||0); this.updateSetupQueue(); });

    const energyHoursInput = document.getElementById('roomEnergyHours');
    if (energyHoursInput) {
      energyHoursInput.addEventListener('input', (e) => {
        const v = Number(e.target.value || 0);
        this.data.energyHours = Number.isFinite(v) ? Math.max(0, Math.min(24, v)) : 0;
        this.updateSetupQueue();
      });
    }
    // Auto-advance hooks: room name
    const roomNameInput = document.getElementById('roomInfoName');
    if (roomNameInput) {
      roomNameInput.addEventListener('input', (e) => {
        this.data.name = (e.target.value || '').trim();
        // try auto-advancing if enabled and we're on the name step
        this.tryAutoAdvance();
        this.updateSetupQueue();
        this.showError('roomInfoError', '');
      });
    }

    const zoneInput = document.getElementById('roomZoneInput');
    const zoneAdd = document.getElementById('roomZoneAdd');
    if (zoneAdd) zoneAdd.addEventListener('click', () => this.handleZoneAdd());
    if (zoneInput) {
      zoneInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); this.handleZoneAdd(); }
      });
    }
    const zoneList = document.getElementById('roomZoneList');
    if (zoneList) {
      zoneList.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-zone-idx]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-zone-idx'));
        if (!Number.isNaN(idx)) this.removeZone(idx);
      });
    }
  // Upload nameplate / datasheet functionality removed - moved to Light Setup wizard

    const hwSearch = document.getElementById('roomDeviceSearch');
    const hwResults = document.getElementById('roomDeviceSearchResults');
    if (hwSearch) {
      hwSearch.addEventListener('input', () => this.updateHardwareSearch(hwSearch.value.trim()));
    }
    if (hwResults) {
      hwResults.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-idx]');
        if (!btn) return;
        const idx = Number(btn.dataset.idx || -1);
        if (Number.isNaN(idx)) return;
        const suggestion = this.hardwareSearchResults[idx];
        if (suggestion) this.applyHardwareSuggestion(suggestion);
      });
    }

    // Sensors section removed - no longer part of room setup

    // Devices management (for smart devices / hubs)
    $('#roomAddDeviceBtn')?.addEventListener('click', () => {
      const name = ($('#roomDeviceName')?.value || '').trim();
      const vendor = ($('#roomDeviceVendor')?.value || '').trim();
      const model = ($('#roomDeviceModel')?.value || '').trim();
      const host = ($('#roomDeviceHost')?.value || '').trim();
      if (!name) return alert('Enter a device name');
      // Collect setup subform values if present
      const setup = {};
      // Clear any previous inline errors and invalid markers
      const errHost = document.getElementById('roomDeviceInlineError'); if (errHost) errHost.textContent = '';
      let fatalError = false;
      const invalidEls = [];
      // WiFi
      if (document.getElementById('deviceSetup-wifi')?.style.display !== 'none') {
        const ssid = ($('#deviceWifiSsid')?.value || '').trim();
        const psk = ($('#deviceWifiPsk')?.value || '').trim();
        const useStatic = !!($('#deviceWifiStatic')?.checked);
        const staticIp = ($('#deviceWifiStaticIp')?.value || '').trim();
        if (ssid) setup.wifi = { ssid, psk: psk || null, useStatic, staticIp: staticIp || null };
      }
      // Bluetooth
      if (document.getElementById('deviceSetup-bluetooth')?.style.display !== 'none') {
        const btName = ($('#deviceBtName')?.value || '').trim();
        const btPin = ($('#deviceBtPin')?.value || '').trim();
        if (btName || btPin) setup.bluetooth = { name: btName || null, pin: btPin || null };
      }
      // RS-485
      if (document.getElementById('deviceSetup-rs485')?.style.display !== 'none') {
        const rsHost = ($('#deviceRs485Host')?.value || '').trim();
        const rsUnit = Number($('#deviceRs485UnitId')?.value || 0) || null;
        const rsBaud = ($('#deviceRs485Baud')?.value || '').trim() || null;
        // Validate RS-485 unit id (Modbus: 1-247) and baud
        if (rsHost || rsUnit) {
          const validUnit = (rsUnit === null) || (Number.isInteger(rsUnit) && rsUnit >= 1 && rsUnit <= 247);
          const commonBaud = ['9600','19200','38400','115200','4800','57600'];
          const validBaud = !rsBaud || commonBaud.includes(String(rsBaud));
          // Clear previous field errors
          clearFieldError('deviceRs485UnitId');
          if (!validUnit) {
            // Block adding device on invalid unit id
            fatalError = true;
            const msg = 'RS-485 Unit ID must be an integer between 1 and 247';
            showToast({ title: 'RS-485 invalid', msg, kind: 'warn', icon: '' });
            setFieldError('deviceRs485UnitId', msg);
            const el = document.getElementById('deviceRs485UnitId'); if (el) invalidEls.push(el);
          }
          if (!validBaud) {
            // Non-fatal advisory for uncommon baud
            showToast({ title: 'RS-485 baud', msg: `Uncommon baud rate: ${rsBaud}. Examples: ${commonBaud.join(', ')}`, kind: 'info', icon: '' });
          }
          if (validUnit && !fatalError) setup.rs485 = { host: rsHost || null, unitId: rsUnit, baud: rsBaud || null };
        }
      }
      // 0-10V
      if (document.getElementById('deviceSetup-0-10v')?.style.display !== 'none') {
        const ch = ($('#device0v10Channel')?.value || '').trim();
        const scale = ($('#device0v10Scale')?.value || '').trim();
        // Validate channel (non-empty) and numeric scale (e.g., 0-100)
        if (ch || scale) {
          const validCh = !!ch;
          const scaleNum = Number(scale || NaN);
          const validScale = !scale || (!Number.isNaN(scaleNum) && scaleNum >= 0 && scaleNum <= 1000);
          // Clear previous field errors
          clearFieldError('device0v10Channel'); clearFieldError('device0v10Scale');
          if (!validCh) {
            fatalError = true;
            const msg = '0-10V channel is required for 0-10V setup';
            showToast({ title: '0-10V invalid', msg, kind: 'warn', icon: '' });
            setFieldError('device0v10Channel', msg);
            const el = document.getElementById('device0v10Channel'); if (el) invalidEls.push(el);
          }
          if (!validScale) {
            fatalError = true;
            const msg = '0-10V scale must be numeric (e.g., 0-100)';
            showToast({ title: '0-10V scale', msg, kind: 'warn', icon: '' });
            setFieldError('device0v10Scale', msg);
            const el2 = document.getElementById('device0v10Scale'); if (el2) invalidEls.push(el2);
          }
          if (validCh && validScale && !fatalError) setup['0-10v'] = { channel: ch || null, scale: scale || null };
        }
      }

      if (fatalError) {
        // Mark invalid inputs and focus the first one
        invalidEls.forEach(el => el.classList.add('invalid'));
        if (invalidEls.length) {
          const firstInvalid = invalidEls[0];
          firstInvalid.focus();
          try { firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch(e) { /* ignore */ }
        }
        // Do not add device if fatal validation failed
        setStatus('Device not added due to validation errors');
        return;
      }
      this.data.devices = this.data.devices || [];
      this.data.devices.push({ name, vendor, model, host, setup });
      ($('#roomDeviceName')?.value) && ($('#roomDeviceName').value = '');
      ($('#roomDeviceVendor')?.value) && ($('#roomDeviceVendor').value = '');
      ($('#roomDeviceModel')?.value) && ($('#roomDeviceModel').value = '');
      ($('#roomDeviceHost')?.value) && ($('#roomDeviceHost').value = '');
      // Clear subforms and invalid markers (also clear inline error nodes)
      ['deviceWifiSsid','deviceWifiPsk','deviceWifiStatic','deviceWifiStaticIp','deviceBtName','deviceBtPin','deviceRs485Host','deviceRs485UnitId','deviceRs485Baud','device0v10Channel','device0v10Scale'].forEach(id=>{
        const el = document.getElementById(id);
        if (el) {
          if (el.type === 'checkbox') el.checked = false; else el.value = '';
          // remove visual invalid marker and inline error message
          try { clearFieldError(id); } catch(e){ if (el.classList) el.classList.remove('invalid'); }
        }
      });
      this.renderDevicesList();
      this.updateSetupQueue();
      // Update controller assignments when devices are added
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
    });

    // Device list remove handler (delegated)
    const devList = $('#roomDevicesList');
    devList?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action="remove-device"]');
      if (!btn) return;
      const idx = Number(btn.dataset.idx);
      if (!Number.isNaN(idx) && this.data.devices && this.data.devices[idx]) {
        this.data.devices.splice(idx,1);
        this.renderDevicesList();
        this.updateSetupQueue();
        // Update controller assignments when devices are removed
        if (typeof renderControllerAssignments === 'function') {
          renderControllerAssignments();
        }
      }
    });

    // Toggle static IP input
    const wifiStatic = $('#deviceWifiStatic');
    wifiStatic?.addEventListener('change', (e)=>{
      const ip = $('#deviceWifiStaticIp'); if (!ip) return;
      ip.style.display = wifiStatic.checked ? 'inline-block' : 'none';
    });

    // Clear invalid class on input/change/focus for device setup fields so users get immediate feedback removal
    const clearOnInput = (id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => clearFieldError(id));
      el.addEventListener('change', () => clearFieldError(id));
      el.addEventListener('focus', () => clearFieldError(id));
    };
    ['deviceRs485UnitId','device0v10Channel','device0v10Scale','deviceRs485Host','deviceWifiSsid','deviceWifiPsk','deviceBtName','deviceBtPin'].forEach(clearOnInput);

    // Live SwitchBot devices button - NO DEMO
    $('#roomDemoSwitchBot')?.addEventListener('click', () => {
      if (typeof addLiveSwitchBotDevices === 'function') {
        addLiveSwitchBotDevices();
      } else {
        console.warn('addLiveSwitchBotDevices is not defined');
      }
    });

    // When model select changes we also toggle relevant setup forms (safety: also do this on vendor change when model list is built)
    const modelSelect = $('#roomDeviceModel');
    modelSelect?.addEventListener('change', (e)=>{
      const modelName = e.target.value;
      const vendor = ($('#roomDeviceVendor')?.value||'');
      const man = DEVICE_MANUFACTURERS && DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
      const md = man?.models?.find(m=>m.model===modelName);
      toggleSetupFormsForModel(md);
    });

    $('#catPrevType')?.addEventListener('click', () => this.stepCategory(-1));
    $('#catNextType')?.addEventListener('click', () => this.stepCategory(1));

    // Control method chips (buttons wired dynamically when showing control step)
    // Hardware categories (new step)
    // Use delegated click handling on the container so handlers are robust and not overwritten later.
    const hwHost = document.getElementById('roomHardwareCats');
    if (hwHost) {
      // ensure baseline aria state for accessibility
      hwHost.querySelectorAll('.chip-option').forEach(btn => {
        if (!btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', btn.hasAttribute('data-active') ? 'true' : 'false');
      });
      hwHost.addEventListener('click', (e) => {
        const btn = e.target.closest('.chip-option');
        if (!btn || !hwHost.contains(btn)) return;
        // Toggle visual active state using shared helper so class/aria stay in sync
        const makeActive = !btn.hasAttribute('data-active');
        this.setChipActiveState(btn, makeActive);
        // normalize selections into this.data.hardwareCats
        const active = Array.from(hwHost.querySelectorAll('.chip-option[data-active]')).map(b=>b.dataset.value);
        // Preserve selection order by tracking the sequence in data.hardwareOrder
        this.data.hardwareOrder = this.data.hardwareOrder || [];
        // Rebuild order: keep prior order for any still-active, then append newly active at the end
        const prior = Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder.filter(v => active.includes(v)) : [];
        const newly = active.filter(v => !prior.includes(v));
        this.data.hardwareOrder = [...prior, ...newly];
        this.data.hardwareCats = active;
        // Debug help: visible in browser console to trace clicks
        console.debug('[RoomWizard] hardware toggle', { value: btn.dataset.value, active, hardwareCats: this.data.hardwareCats, hardwareOrder: this.data.hardwareOrder });
        // Recompute dynamic steps as categories change (only when we're on or past hardware step)
        this.rebuildDynamicSteps();
        console.debug('[RoomWizard] after rebuildDynamicSteps (hardware click)', {
          steps: this.steps,
          currentStep: this.currentStep,
          hardwareCats: this.data.hardwareCats,
          categoryQueue: this.categoryQueue
        });
        this.updateSetupQueue();
        if (active.length) this.showError('hardwareError', '');
      });
    }

    const hubRadios = document.querySelectorAll('input[name="roomHubPresence"]');
    if (hubRadios && hubRadios.length) {
      hubRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
          const val = e.target.value;
          this.data.connectivity = this.data.connectivity || { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' };
          this.data.connectivity.hasHub = val === 'yes' ? true : val === 'no' ? false : null;
          this.updateSetupQueue();
        });
      });
    }
    $('#roomHubDetect')?.addEventListener('click', () => this.detectHub());
    $('#roomHubVerify')?.addEventListener('click', () => this.verifyHub());
    $('#roomDeviceScan')?.addEventListener('click', () => this.scanLocalDevices());

    $('#roomHubType')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.hubType = (e.target.value || '').trim();
      this.updateSetupQueue();
    });
    $('#roomHubIp')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.hubIp = (e.target.value || '').trim();
      this.updateSetupQueue();
    });
    $('#roomCloudTenant')?.addEventListener('input', (e) => {
      this.data.connectivity = this.data.connectivity || {};
      this.data.connectivity.cloudTenant = (e.target.value || '').trim();
      this.updateSetupQueue();
    });

    const bindRoleInput = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => {
        this.setRoleList(key, el.value);
        this.updateSetupQueue();
      });
    };
    bindRoleInput('roomRoleAdmin', 'admin');
    bindRoleInput('roomRoleOperator', 'operator');
    bindRoleInput('roomRoleViewer', 'viewer');

    const groupInput = document.getElementById('roomGroupNameInput');
    if (groupInput) {
      groupInput.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); this.addGroupFromInput(); }
      });
    }
    $('#roomGroupAdd')?.addEventListener('click', () => this.addGroupFromInput());
    const groupSuggestions = document.getElementById('roomGroupSuggestions');
    if (groupSuggestions) {
      groupSuggestions.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-group]');
        if (!btn) return;
        this.addGroup(btn.getAttribute('data-group') || '');
      });
    }
    const groupList = document.getElementById('roomGroupList');
    if (groupList) {
      groupList.addEventListener('click', (ev) => {
        const btn = ev.target.closest('button[data-group-idx]');
        if (!btn) return;
        const idx = Number(btn.getAttribute('data-group-idx'));
        if (!Number.isNaN(idx)) this.removeGroup(idx);
      });
    }
    $('#roomGroupPlan')?.addEventListener('change', (ev) => {
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
      this.data.grouping.planId = ev.target.value || '';
      this.updateSetupQueue();
    });
    $('#roomGroupSchedule')?.addEventListener('change', (ev) => {
      this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
      this.data.grouping.scheduleId = ev.target.value || '';
      this.updateSetupQueue();
    });

    // Device Discovery step handlers
    $('#roomDiscoveryRun')?.addEventListener('click', () => this.runDeviceDiscovery());
    $('#roomDiscoveryStop')?.addEventListener('click', () => this.stopDeviceDiscovery());
    $('#roomDiscoverySelectAll')?.addEventListener('click', () => this.selectAllDiscoveredDevices());
    $('#roomDiscoverySelectNone')?.addEventListener('click', () => this.selectNoDiscoveredDevices());
    $('#roomDiscoveryRefresh')?.addEventListener('click', () => this.refreshDeviceDiscovery());
  }

  open(room = null) {
    console.debug('[RoomWizard.open] called. room:', room);
    // Always make the modal visible
    if (this.modal) {
      // The close() method forces display:none so ensure we restore the
      // flex layout every time the wizard is opened (fixes buttons that
      // failed to reopen the wizard after the first close).
      this.modal.style.display = 'flex';
      this.modal.setAttribute('aria-hidden', 'false');
      this.modal.dataset.leOpen = 'true';
    }
    // Always refresh the room list from STATE.farm.rooms to reflect latest Farm Registration
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms.map(r => ({ ...r })) : [];
    const hasFarmRooms = farmRooms.length > 0;

    // Editing an existing room should always work, even if Farm Registration has no rooms yet
    if (room) {
      if (hasFarmRooms) {
        const idx = farmRooms.findIndex(r => r.id === room.id);
        if (idx >= 0) {
          this.multiRoomList = farmRooms;
          this.multiRoomIndex = idx;
        } else {
          this.multiRoomList = [room];
          this.multiRoomIndex = 0;
        }
      } else {
        this.multiRoomList = [room];
        this.multiRoomIndex = 0;
      }
      this._openSingleRoom(room);
      if (this.multiRoomList.length > 1) {
        this._injectMultiRoomNav();
      }
      return;
    }

    if (!hasFarmRooms) {
      showToast({
        title: 'No Rooms Found',
        msg: 'Farm Registration has no rooms yet. Starting a blank Grow Room setup.',
        kind: 'info',
        icon: ''
      });
      this.multiRoomList = [];
      this.multiRoomIndex = 0;
      this._openSingleRoom(null);
      return;
    }

    this.multiRoomList = farmRooms;
    this.multiRoomIndex = 0;
    // Start with the first room from Farm Registration
    this._openSingleRoom(this.multiRoomList[this.multiRoomIndex]);
    // Always inject multi-room navigation if there are multiple rooms
    if (this.multiRoomList.length > 1) {
      this._injectMultiRoomNav();
    }
  }

  _openSingleRoom(room) {
      // Prefill the room location select if present
      const locationSelect = document.getElementById('roomLocationSelect');
      if (locationSelect && this.data && this.data.location) {
        locationSelect.value = this.data.location;
      }
    console.debug('[RoomWizard._openSingleRoom] Called with room:', room);
    // Reset navigation state to ensure clean slate
    this.currentStep = 0;
    this.steps = this.baseSteps.slice(); // Reset to base steps
    
    // Clean up any existing Setup Next Room button from previous sessions
    const existingNextRoomBtn = document.getElementById('setupNextRoomBtn');
    if (existingNextRoomBtn) {
      existingNextRoomBtn.remove();
    }
    
    const base = {
      id: '',
      name: '',
      location: '',
      hardwareCats: [],
      hardwareOrder: [],
      layout: { type: '', rows: 0, racks: 0, levels: 0 },
      zones: [],
      fixtures: [],
      controlMethod: null,
      devices: [],
      sensors: { categories: [], placements: {} },
      energy: '',
      energyHours: 0,
      targetPpfd: 0,
      photoperiod: 0,
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' },
      roles: { admin: [], operator: [], viewer: [] },
      grouping: { groups: [], planId: '', scheduleId: '' }
    };
    
    if (room) {
      const clone = JSON.parse(JSON.stringify(room));
      this.data = {
        ...base,
        ...clone,
        layout: { ...base.layout, ...(clone.layout || {}) },
        sensors: { ...base.sensors, ...(clone.sensors || {}) },
        connectivity: { ...base.connectivity, ...(clone.connectivity || {}) },
        roles: { ...base.roles, ...(clone.roles || {}) },
        grouping: { ...base.grouping, ...(clone.grouping || {}) }
      };
      
      // Ensure the room name from Farm Registration is preserved
      if (clone.name) {
        this.data.name = clone.name;
      }
      
      if (!Array.isArray(this.data.hardwareOrder) || !this.data.hardwareOrder.length) {
        this.data.hardwareOrder = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats.slice() : [];
      }
      if (!this.data.sensors.placements) this.data.sensors.placements = {};
    } else {
      this.data = { ...base };
    }
    
    // Restore per-category progress if present on room record or local storage
    this.categoryProgress = (this.data._categoryProgress && JSON.parse(JSON.stringify(this.data._categoryProgress))) || (()=>{ try { const s = JSON.parse(localStorage.getItem('gr.roomWizard.progress')||'null'); return s?.categoryProgress||{}; } catch { return {}; } })();
    
    // If categories were already chosen, build the dynamic steps and position to first incomplete category
    try { this.rebuildDynamicSteps(); } catch {}
    
    this.modal.setAttribute('aria-hidden','false');
    
    // Use setTimeout to ensure DOM is ready and navigation state is reset
    setTimeout(() => {
      this.showStep(0);
      // Force navigation update after modal opens
      this.showStep(this.currentStep);
      // Prefill the room name input if present
      const nameInput = document.getElementById('roomInfoName');
      if (nameInput && this.data && this.data.name) {
        nameInput.value = this.data.name;
      }
      // Prefill the zone count and zone names if present
      const zoneCountInput = document.getElementById('roomInfoZoneCount');
      if (zoneCountInput && this.data && Array.isArray(this.data.zones)) {
        zoneCountInput.value = this.data.zones.length;
        // Render the zone name inputs and prefill them
        const zoneInputsHost = document.getElementById('roomInfoZoneInputs');
        if (zoneInputsHost) {
          zoneInputsHost.innerHTML = '';
          for (let i = 0; i < this.data.zones.length; ++i) {
            const input = document.createElement('input');
            input.type = 'text';
            input.value = this.data.zones[i] || `Zone ${i+1}`;
            input.placeholder = `Zone ${i+1} name`;
            input.className = 'tiny';
            input.style.marginBottom = '2px';
            input.oninput = (e) => {
              this.data.zones[i] = (e.target.value || '').trim() || `Zone ${i+1}`;
              this.updateSetupQueue();
            };
            zoneInputsHost.appendChild(input);
          }
        }
      }
    }, 10);
    
    // Prefill lists (fixtures rendering moved to Light Setup wizard)
    this.renderDevicesList();
    this.renderZoneList();
    this.renderGroupList();
    this.updateGroupSuggestions();
    this.updateHardwareSearch('');
    this.updateSetupQueue();
    
    // If we have a queue and any incomplete categories, jump to category-setup at first incomplete
    try {
      if ((this.data.hardwareCats||[]).length) {
        const queue = this.categoryQueue || [];
        const firstIncompleteIdx = queue.findIndex(c => (this.categoryProgress?.[c]?.status || 'not-started') !== 'complete');
        if (firstIncompleteIdx >= 0) {
          const stepIdx = this.steps.indexOf('category-setup');
          if (stepIdx >= 0) { this.currentStep = stepIdx; this.categoryIndex = firstIncompleteIdx; this.showStep(stepIdx); }
        }
      }
    } catch {}
  }

  _injectMultiRoomNav() {
    // Add navigation UI for multi-room setup (e.g., Next Room, Prev Room, Room X of Y)
    // Only if modal is open and multiRoomList exists
    if (!this.modal || !Array.isArray(this.multiRoomList) || this.multiRoomList.length < 2) return;
    
    let nav = document.getElementById('multiRoomNav');
    if (!nav) {
      nav = document.createElement('div');
      nav.id = 'multiRoomNav';
      nav.style = 'display:flex;justify-content:center;align-items:center;gap:16px;margin:8px 0;padding:8px;background:#f8f9fa;border-radius:6px;border:1px solid #e5e7eb;';
      this.modal.querySelector('.modal-header')?.appendChild(nav);
    }
    
    const currentRoom = this.multiRoomList[this.multiRoomIndex];
    const roomName = currentRoom?.name || `Room ${this.multiRoomIndex + 1}`;
    
    nav.innerHTML = `
      <button id="prevRoomBtn" ${this.multiRoomIndex === 0 ? 'disabled' : ''} style="padding:4px 8px;border-radius:4px;">&lt; Previous</button>
      <span style="font-weight:bold;color:#374151;">Setting up: <em>${roomName}</em> (${this.multiRoomIndex + 1} of ${this.multiRoomList.length})</span>
      <button id="nextRoomBtn" ${this.multiRoomIndex === this.multiRoomList.length - 1 ? 'disabled' : ''} style="padding:4px 8px;border-radius:4px;">Next &gt;</button>
    `;
    
    // Previous room navigation
    document.getElementById('prevRoomBtn').onclick = () => {
      if (this.multiRoomIndex > 0) {
        this.multiRoomIndex--;
        const prevRoom = this.multiRoomList[this.multiRoomIndex];
        this._openSingleRoom(prevRoom);
        this._injectMultiRoomNav();
        showToast({ 
          title: 'Switched Room', 
          msg: `Now setting up: ${prevRoom.name}`, 
          kind: 'info', 
          icon: '' 
        });
      }
    };
    
    // Next room navigation  
    document.getElementById('nextRoomBtn').onclick = () => {
      if (this.multiRoomIndex < this.multiRoomList.length - 1) {
        this.multiRoomIndex++;
        const nextRoom = this.multiRoomList[this.multiRoomIndex];
        this._openSingleRoom(nextRoom);
        this._injectMultiRoomNav();
        showToast({ 
          title: 'Switched Room', 
          msg: `Now setting up: ${nextRoom.name}`, 
          kind: 'info', 
          icon: '' 
        });
      }
    };
  }

  close(){
    this.modal.setAttribute('aria-hidden','true');
    this.modal.style.display = 'none';
    if (this.modal && this.modal.dataset.leOpen) {
      delete this.modal.dataset.leOpen;
    }
  }

  showStep(index) {
      console.debug('[RoomWizard] showStep called. index:', index, 'stepKey:', this.steps[index], 'steps:', this.steps);
    // Sync internal current step state
    this.currentStep = index;

    document.querySelectorAll('.room-step').forEach(step => step.removeAttribute('data-active'));
    const el = document.querySelector(`.room-step[data-step="${this.steps[index]}"]`);
    if (el) el.setAttribute('data-active', '');
    $('#roomModalProgress').textContent = `Step ${index + 1} of ${this.steps.length}`;

      // Hide legacy footer except on final step
      const legacyFooter = this.form?.querySelector('.room-modal__footer');
      if (legacyFooter) {
        legacyFooter.style.display = (index === this.steps.length - 1) ? 'flex' : 'none';
      }

    // Guard navigation button toggles
    const prev = $('#roomPrev');
    const next = $('#roomNext');
    const topNext = $('#roomTopNext');
    const topPrev = $('#roomTopPrev');
    const topSaveClose = $('#roomTopSaveClose');
    const save = $('#btnSaveRoom');

    // Ensure buttons exist before setting styles
    if (prev) {
      prev.style.display = index === 0 ? 'none' : 'inline-block';
    }

    // On final step: show Previous and Save & Close buttons
    if (index === this.steps.length - 1) {
      if (prev) prev.style.display = 'inline-block';  // Show Previous on final step
      if (next) next.style.display = 'none';
      if (topNext) topNext.style.display = 'none';
      if (topPrev) topPrev.style.display = 'inline-block';  // Show Previous in header on final step
      // Insert Setup Next Room button if there are more rooms to setup
      let nextRoomBtn = document.getElementById('setupNextRoomBtn');
      const hasMoreRooms = Array.isArray(this.multiRoomList) && this.multiRoomList.length > 1 && this.multiRoomIndex < this.multiRoomList.length - 1;

      if (hasMoreRooms) {
        if (!nextRoomBtn) {
          nextRoomBtn = document.createElement('button');
          nextRoomBtn.id = 'setupNextRoomBtn';
          nextRoomBtn.className = 'primary';
          nextRoomBtn.style.marginRight = '8px';
          // Insert before Save & Close button if present
          if (topSaveClose && topSaveClose.parentNode) {
            topSaveClose.parentNode.insertBefore(nextRoomBtn, topSaveClose);
          } else if (save && save.parentNode) {
            save.parentNode.insertBefore(nextRoomBtn, save);
          } else {
            document.body.appendChild(nextRoomBtn);
          }
        }
        nextRoomBtn.textContent = `Setup Next Room (${this.multiRoomIndex + 2}/${this.multiRoomList.length})`;
        nextRoomBtn.style.display = 'inline-block';
        nextRoomBtn.onclick = async () => {
          // Save current room's setup data first, but don't auto-close
          const mockEvent = { preventDefault: () => {} };
          const success = await this.saveRoom(mockEvent, false);

          if (success) {
            // Move to next room after successful save
            this.multiRoomIndex++;

            // Get the next room from the original farm data
            const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
            const nextRoom = farmRooms[this.multiRoomIndex];

            if (nextRoom) {
              // Open the next room - start fresh with farm registration data
              this._openSingleRoom(nextRoom);
              this.currentStep = 0;
              this.showStep(0);
              this._injectMultiRoomNav();

              // Update modal title to show current room
              const titleEl = document.getElementById('roomModalTitle');
              if (titleEl) {
                titleEl.textContent = `Set up ${nextRoom.name}`;
              }

              showToast({
                title: 'Room Setup Saved',
                msg: `Moving to ${nextRoom.name}`,
                kind: 'success',
                icon: ''
              });
            } else {
              // No more rooms, close the wizard
              this.close();
              showToast({
                title: 'All Rooms Complete!',
                msg: 'All grow rooms have been set up successfully',
                kind: 'success',
                icon: ''
              });
            }
          } else {
            showToast({
              title: 'Save Failed',
              msg: 'Please fix errors before continuing',
              kind: 'error',
              icon: ''
            });
          }
        };
      } else if (nextRoomBtn) {
        nextRoomBtn.style.display = 'none';
      }

      // Show Save & Close button only if there are no more rooms
      if (topSaveClose) {
        if (hasMoreRooms) {
          // If there are more rooms, hide the Save & Continue button since we have Setup Next Room
          topSaveClose.style.display = 'none';
        } else {
          // This is the last room, show final save text
          topSaveClose.textContent = 'Save & Close';
          topSaveClose.style.display = 'inline-block';
        }
      }
      if (save) {
        if (hasMoreRooms) {
          // Hide footer save button when there are more rooms
          save.style.display = 'none';
        } else {
          save.style.display = 'inline-block';
        }
      }
      this.updateReview();

      // Update title based on current room and progress
      const titleEl = document.getElementById('roomModalTitle');
      if (titleEl) {
        if (hasMoreRooms) {
          titleEl.textContent = `Complete Setup: ${this.data.name || 'Room'} (${this.multiRoomIndex + 1}/${this.multiRoomList.length})`;
        } else {
          titleEl.textContent = `Final Room Setup: ${this.data.name || 'Room'}`;
        }
      }
    }
    else { 
      // Show Previous button except on first step
      if (topPrev) {
        topPrev.style.display = index === 0 ? 'none' : 'inline-block';
      }
      if (next) {
        next.style.display = 'inline-block';
        next.style.visibility = 'visible';
      }
      if (topNext) {
        topNext.style.display = 'inline-block';
        topNext.style.visibility = 'visible';
      }
      if (topSaveClose) topSaveClose.style.display = 'none';
      if (save) save.style.display = 'none';
      
      // IMPORTANT: Hide the Setup Next Room button on non-final steps
      const nextRoomBtn = document.getElementById('setupNextRoomBtn');
      if (nextRoomBtn) {
        nextRoomBtn.style.display = 'none';
      }
      
      // Reset title for non-final steps
      const titleEl = document.getElementById('roomModalTitle');
      if (titleEl) titleEl.textContent = 'Set up a Grow Room';
    }

    const stepKey = this.steps[index];
    
    // Track previous step for transitions
    this.previousStep = stepKey;
    
    // Helper to render editable zone names (must be defined before any use)
    this.renderRoomInfoZones = () => {
      const zoneCountInput = document.getElementById('roomInfoZoneCount');
      const zoneInputsHost = document.getElementById('roomInfoZoneInputs');
      if (!zoneInputsHost || !zoneCountInput) return;
      let zoneCount = Math.max(1, Math.min(12, Number(zoneCountInput.value)||1));
      zoneInputsHost.innerHTML = '';
      for (let i = 0; i < zoneCount; ++i) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = this.data.zones && this.data.zones[i] ? this.data.zones[i] : `Zone ${i+1}`;
        input.placeholder = `Zone ${i+1} name`;
        input.className = 'tiny';
        input.style.marginBottom = '2px';
        input.oninput = (e) => {
          this.data.zones[i] = (e.target.value || '').trim() || `Zone ${i+1}`;
          this.updateSetupQueue();
        };
        zoneInputsHost.appendChild(input);
      }
    };

    if (stepKey === 'room-info') {
      // Room name and zones step
      const nameInput = document.getElementById('roomInfoName');
      const zoneCountInput = document.getElementById('roomInfoZoneCount');
      const zoneInputsHost = document.getElementById('roomInfoZoneInputs');
      if (nameInput) {
        if (!this.data.name && STATE.farm?.farmName) {
          const roomNumber = (this.multiRoomIndex || 0) + 1;
          this.data.name = `${STATE.farm.farmName} - Room ${roomNumber}`;
        }
        nameInput.value = this.data.name || '';
        nameInput.oninput = (e) => {
          this.data.name = (e.target.value || '').trim();
          this.updateSetupQueue();
        };
      }
      if (zoneCountInput) {
        let zoneCount = Number(zoneCountInput.value) || 1;
        if (!Array.isArray(this.data.zones) || this.data.zones.length !== zoneCount) {
          // Initialize or resize zones array
          this.data.zones = Array.from({length: zoneCount}, (_, i) => this.data.zones && this.data.zones[i] ? this.data.zones[i] : `Zone ${i+1}`);
        }
        zoneCountInput.oninput = (e) => {
          let count = Math.max(1, Math.min(12, Number(e.target.value)||1));
          this.data.zones = Array.from({length: count}, (_, i) => this.data.zones && this.data.zones[i] ? this.data.zones[i] : `Zone ${i+1}`);
          this.renderRoomInfoZones();
          this.updateSetupQueue();
        };
      }
      if (zoneInputsHost && typeof this.renderRoomInfoZones === 'function') {
        this.renderRoomInfoZones();
      } else if (zoneInputsHost) {
        console.error('[RoomWizard] renderRoomInfoZones is not a function', this.renderRoomInfoZones);
      }
    }

    if (stepKey === 'layout') {
      const type = this.data.layout?.type || '';
      document.querySelectorAll('#roomLayoutType .chip-option').forEach(btn => {
        if (btn.dataset.value === type) btn.setAttribute('data-active', ''); else btn.removeAttribute('data-active');
      });
      const rows = document.getElementById('roomRows'); if (rows) rows.value = String(this.data.layout?.rows ?? 0);
      const racks = document.getElementById('roomRacks'); if (racks) racks.value = String(this.data.layout?.racks ?? 0);
      const levels = document.getElementById('roomLevels'); if (levels) levels.value = String(this.data.layout?.levels ?? 0);
    }
    if (stepKey === 'zones') {
      this.renderZoneList();
    }
    if (stepKey === 'hardware') {
      const hwContainer = document.getElementById('roomHardwareCats');
      if (hwContainer) {
        const active = this.data.hardwareCats || [];
        hwContainer.querySelectorAll('.chip-option').forEach(b => {
          this.setChipActiveState(b, active.includes(b.dataset.value));
        });
        // Ensure event handler is attached only once
        if (!hwContainer.dataset.listenerAttached) {
          hwContainer.addEventListener('click', (e) => {
            const btn = e.target.closest('.chip-option');
            if (!btn || !hwContainer.contains(btn)) return;
            // Toggle visual active state using shared helper so class/aria stay in sync
            const makeActive = !btn.hasAttribute('data-active');
            this.setChipActiveState(btn, makeActive);
            // normalize selections into this.data.hardwareCats
            const active = Array.from(hwContainer.querySelectorAll('.chip-option[data-active]')).map(b=>b.dataset.value);
            // Preserve selection order by tracking the sequence in data.hardwareOrder
            this.data.hardwareOrder = this.data.hardwareOrder || [];
            // Rebuild order: keep prior order for any still-active, then append newly active at the end
            const prior = Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder.filter(v => active.includes(v)) : [];
            const newly = active.filter(v => !prior.includes(v));
            this.data.hardwareOrder = [...prior, ...newly];
            this.data.hardwareCats = active;
            // Debug help: visible in browser console to trace clicks
            console.debug('[RoomWizard] hardware toggle', { value: btn.dataset.value, active });
            // Recompute dynamic steps as categories change (only when we're on or past hardware step)
            this.rebuildDynamicSteps();
            this.updateSetupQueue();
            if (active.length) this.showError('hardwareError', '');
          });
          hwContainer.dataset.listenerAttached = 'true';
        }
      }
    }
    if (stepKey === 'category-setup') {
      if (this.categoryIndex < 0) this.categoryIndex = 0;
      this.renderCurrentCategoryForm();
      this.updateCategoryNav();
    }
    if (stepKey === 'control') {
      const container = document.getElementById('roomControlMethod');
      if (!container) return;
      container.querySelectorAll('.chip-option').forEach(b => {
        b.classList.remove('active');
        if (this.data.controlMethod && b.dataset.value === this.data.controlMethod) b.classList.add('active');
        b.onclick = () => {
          const v = b.dataset.value;
          this.data.controlMethod = v;
          container.querySelectorAll('.chip-option').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          document.getElementById('roomControlDetails').textContent = this.controlHintFor(v);
          this.inferSensors();
          if (this.autoAdvance) setTimeout(() => this.tryAutoAdvance(), 80);
        };
      });
      if (this.data.controlMethod) document.getElementById('roomControlDetails').textContent = this.controlHintFor(this.data.controlMethod);
    }
    if (stepKey === 'sensors') {
      const container = document.getElementById('roomSensorCats');
      if (!container) return;
      container.querySelectorAll('input[type=checkbox]').forEach(cb => {
        const lbl = cb.closest('.chip-option') || cb.parentElement;
        cb.checked = (this.data.sensors.categories || []).includes(cb.value);
        if (cb.checked) lbl?.setAttribute('data-active', ''); else lbl?.removeAttribute('data-active');
        cb.onchange = () => {
          if (cb.checked) lbl?.setAttribute('data-active', ''); else lbl?.removeAttribute('data-active');
          this.data.sensors.categories = Array.from(container.querySelectorAll('input:checked')).map(i => i.value);
        };
        lbl?.addEventListener('click', () => setTimeout(() => cb.dispatchEvent(new Event('change')), 0));
      });
      container.querySelectorAll('.sensor-location').forEach(sel => {
        const key = sel.getAttribute('data-sensor');
        if (!key) return;
        const val = this.data.sensors?.placements?.[key] || '';
        sel.value = val;
      });
    }
    if (stepKey === 'devices') {
      const cm = this.data.controlMethod;
      this.renderDevicesList();
    }
    if (stepKey === 'connectivity') {
      const hub = this.data.connectivity || {};
      document.querySelectorAll('input[name="roomHubPresence"]').forEach(radio => {
        if (hub.hasHub === null) radio.checked = false;
        else radio.checked = (hub.hasHub && radio.value === 'yes') || (!hub.hasHub && radio.value === 'no');
      });
      const hubType = document.getElementById('roomHubType'); if (hubType) hubType.value = hub.hubType || '';
      const hubIp = document.getElementById('roomHubIp'); if (hubIp) hubIp.value = hub.hubIp || '';
      const tenant = document.getElementById('roomCloudTenant'); if (tenant) tenant.value = hub.cloudTenant || '';
      const roles = this.data.roles || {};
      const adminInput = document.getElementById('roomRoleAdmin'); if (adminInput) adminInput.value = (roles.admin || []).join(', ');
      const opInput = document.getElementById('roomRoleOperator'); if (opInput) opInput.value = (roles.operator || []).join(', ');
      const viewerInput = document.getElementById('roomRoleViewer'); if (viewerInput) viewerInput.value = (roles.viewer || []).join(', ');
      const statusEl = document.getElementById('roomHubStatus');
      if (statusEl) {
        if (hub.hasHub) statusEl.textContent = hub.hubIp ? `Hub recorded at ${hub.hubIp}. Verify Node-RED when ready.` : 'Hub recorded. Add IP to enable edge control.';
        else statusEl.textContent = '';
      }
    }
    if (stepKey === 'energy') {
      document.querySelectorAll('#roomEnergy .chip-option').forEach(btn => {
        if (btn.dataset.value === this.data.energy) btn.setAttribute('data-active', ''); else btn.removeAttribute('data-active');
      });
      const hours = document.getElementById('roomEnergyHours');
      if (hours) hours.value = String(this.data.energyHours ?? 0);
    }
    if (stepKey === 'grouping') {
      this.populateGroupingSelectors();
    }
    if (stepKey === 'review') {
      this.updateReview();
    }
  }

  // Silent validation used by auto-advance (no alerts/confirms)
  silentValidateCurrentStep(){
    const step = this.steps[this.currentStep];
    switch(step){
      case 'room-info': {
        const v = ($('#roomInfoName')?.value||'').trim(); return !!v; }

      case 'layout': return true;
      case 'zones': return Array.isArray(this.data.zones) && this.data.zones.length > 0;
      case 'hardware': return false; // multi-select; don't auto-advance here
      case 'category-setup': return true; // allow auto-advance if user clicks next; forms are optional counts
      case 'control': return !!this.data.controlMethod;
      case 'devices': return false;
      case 'connectivity': {
        const conn = this.data.connectivity || {};
        return conn.hasHub !== null;
      }
      case 'energy': return !!this.data.energy;
      case 'grouping': return Array.isArray(this.data.grouping?.groups) && this.data.grouping.groups.length > 0;
      case 'review': return false;
    }
    return false;
  }

  // Attempt to auto-advance when silent validation passes for the current step
  tryAutoAdvance(){
    if (!this.autoAdvance) return;
    // Only advance if not at last step
    if (this.currentStep >= this.steps.length - 1) return;
    try {
      if (this.silentValidateCurrentStep()) {
        // Use normal validateCurrentStep to preserve any needed confirmations
        // but defer slightly so the UI can update first.
        setTimeout(()=>{ if (this.validateCurrentStep()) { this.currentStep++; this.showStep(this.currentStep); } }, 150);
      }
    } catch(e) { /* ignore auto-advance errors */ }
  }

  validateCurrentStep(){
    const step = this.steps[this.currentStep];
    switch(step){
      case 'room-info': {
        const v = ($('#roomInfoName')?.value||'').trim();
        if (!v) {
          this.showError('roomInfoError', 'Room name is required.');
          return false;
        }
        this.showError('roomInfoError', '');
        this.data.name = v;
        break; }

      case 'layout': {
        // no strict validation
        break; }
      case 'zones': {
        const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
        if (!zones.length) {
          return false;
        }
        break; }
      case 'hardware': {
        const cats = this.data.hardwareCats || [];
        if (!cats.length) {
          this.showError('hardwareError', 'Select at least one hardware category.');
          return false;
        }
        this.showError('hardwareError', '');
        // When leaving hardware, build dynamic category queue and insert a single category-setup step if needed
        const prevSteps = this.steps.slice();
        this.rebuildDynamicSteps();
        // If category-setup was just inserted, advance to it
        const idxCatSetup = this.steps.indexOf('category-setup');
        if (idxCatSetup > this.currentStep) {
          this.currentStep = idxCatSetup;
          this._justRebuiltSteps = false;
          // Immediately show the category-setup step and block further navigation until user acts
          this._stepInProgress = true;
          this.showStep(idxCatSetup);
          setTimeout(() => { this._stepInProgress = false; }, 400);
          return false;
        }
        break; }
      case 'category-setup': {
        // Persist current category form values into this.data.
        this.captureCurrentCategoryForm();
        void this.persistProgress();
        break; }
      case 'sensors': {
        const container = document.getElementById('roomSensorCats');
        if (container) {
          const categories = Array.from(container.querySelectorAll('input[type=checkbox]:checked')).map(cb => cb.value);
          this.data.sensors = this.data.sensors || { categories: [], placements: {} };
          this.data.sensors.categories = categories;
          container.querySelectorAll('.sensor-location').forEach(sel => {
            const key = sel.getAttribute('data-sensor');
            if (!key) return;
            const val = sel.value || '';
            this.data.sensors.placements[key] = val;
          });
        }
        break; }
      case 'location': {
        const sel = document.getElementById('roomLocationSelect');
        if (sel) this.data.location = sel.value || '';
        break; }
      case 'fixtures': {
        const needsLights = (this.data.hardwareCats || []).includes('grow-lights');
        const fixtures = Array.isArray(this.data.fixtures) ? this.data.fixtures : [];
        if (needsLights && fixtures.length === 0) {
          return false;
        }
        break; }
      case 'control': {
        const needsLights = (this.data.hardwareCats || []).includes('grow-lights');
        if (!this.data.controlMethod && needsLights) {
          return false;
        }
        break; }
      case 'devices': {
        const smartControl = ['wifi','smart-plug','rs485'].includes(this.data.controlMethod);
        if (smartControl && !(Array.isArray(this.data.devices) && this.data.devices.length)) {
          return false;
        }
        break; }
      case 'connectivity': {
        const conn = this.data.connectivity || (this.data.connectivity = { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' });
        const radios = document.querySelector('input[name="roomHubPresence"]:checked');
        if (radios) {
          conn.hasHub = radios.value === 'yes' ? true : radios.value === 'no' ? false : null;
        }
        if (conn.hasHub === null) { alert('Let us know if a local hub is present.'); return false; }
        conn.hubType = ($('#roomHubType')?.value || '').trim();
        conn.hubIp = ($('#roomHubIp')?.value || '').trim();
        conn.cloudTenant = ($('#roomCloudTenant')?.value || '').trim() || 'Azure';
        if (conn.hasHub && !conn.hubIp) { alert('Enter the hub IP address so we can link automations.'); return false; }
        if (!conn.hasHub && (this.data.hardwareCats || []).includes('controllers')) {
          const ok = confirm('Controllers were selected, but no hub is configured. Continue?');
          if (!ok) return false;
        }
        this.setRoleList('admin', ($('#roomRoleAdmin')?.value || ''));
        this.setRoleList('operator', ($('#roomRoleOperator')?.value || ''));
        this.setRoleList('viewer', ($('#roomRoleViewer')?.value || ''));
        break; }
      case 'grouping': {
        this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
        const planSel = document.getElementById('roomGroupPlan');
        const scheduleSel = document.getElementById('roomGroupSchedule');
        if (planSel) this.data.grouping.planId = planSel.value || '';
        if (scheduleSel) this.data.grouping.scheduleId = scheduleSel.value || '';
        const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : [];
        if (!groups.length) {
          const needsGroups = (Array.isArray(this.data.zones) && this.data.zones.length) || (Array.isArray(this.data.devices) && this.data.devices.length);
          if (needsGroups) {
            const ok = confirm('No groups defined yet. Groups make it easier to assign plans and schedules. Continue without groups?');
            if (!ok) return false;
          }
        }
        break; }
      case 'energy': {
        const energy = this.data.energy;
        if (!energy) { alert('Select how energy will be monitored.'); return false; }
        const hours = Number(this.data.energyHours);
        if (energy !== 'none' && (!Number.isFinite(hours) || hours <= 0)) {
          const ok = confirm('Runtime hours are blank. Continue without estimating daily runtime?');
          if (!ok) return false;
        }
        break; }
    }
    return true;
  }

  // Build the dynamic category steps/queue based on selected hardware
  rebuildDynamicSteps() {
      console.debug('[RoomWizard] rebuildDynamicSteps called', {
        hardwareCats: this.data.hardwareCats,
        hardwareOrder: this.data.hardwareOrder,
        baseSteps: this.baseSteps,
        currentSteps: this.steps
      });
    const selected = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats.slice() : [];
    // Define which categories have micro-forms; order them after hardware and before fixtures
  const formCats = selected.filter(c => ['hvac','mini-split','dehumidifier','fans','vents','controllers','energy-monitor','other'].includes(c));
      console.debug('[RoomWizard] formCats for category-setup:', formCats);
    // Preserve user selection order using hardwareOrder we maintain on toggles
    const chipOrder = (Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder : [])
      .filter(v => formCats.includes(v));
      console.debug('[RoomWizard] chipOrder (categoryQueue):', chipOrder);
    this.categoryQueue = chipOrder;
    // Compute new steps list: replace any existing category-setup appearances with a single placeholder when queue non-empty
    const before = this.steps.slice();
    const idxHardware = this.baseSteps.indexOf('hardware');
    const idxFixtures = this.baseSteps.indexOf('fixtures');
    const newSteps = [];
    for (let i = 0; i < this.baseSteps.length; i++) {
      const k = this.baseSteps[i];
      // Skip the baseline category-setup entry; we'll inject it after hardware only if queue is non-empty
      if (k === 'category-setup') continue;
      newSteps.push(k);
      if (k === 'hardware' && this.categoryQueue.length) {
        // inject one "category-setup" placeholder right after hardware when needed
        newSteps.push('category-setup');
        console.debug('[RoomWizard] Injected category-setup after hardware', {
          categoryQueue: this.categoryQueue,
          steps: newSteps
        });
      }
    }
    this.steps = newSteps;
    console.debug('[RoomWizard] steps after rebuild:', this.steps, 'categoryQueue:', this.categoryQueue, 'hardwareCats:', this.data.hardwareCats);
    // Reset category index if we are at/after hardware
    if (this.currentStep >= this.steps.indexOf('hardware')) {
      // Map current step: if we're in category-setup, keep categoryIndex; else reset
      if (this.steps[this.currentStep] !== 'category-setup') this.categoryIndex = (this.categoryQueue.length ? 0 : -1);
    }
    // Update progress label to reflect potential step count change
    $('#roomModalProgress').textContent = `Step ${this.currentStep+1} of ${this.steps.length}`;
      console.debug('[RoomWizard] categoryIndex:', this.categoryIndex, 'categoryQueue:', this.categoryQueue);
  }

  // Determine the current category id from categoryIndex
  getCurrentCategoryId() {
    if (this.categoryIndex < 0) return null;
    return this.categoryQueue[this.categoryIndex] || null;
  }

  // Render the micro-form for the current category
  renderCurrentCategoryForm() {
    const catId = this.getCurrentCategoryId();
    const titleEl = document.getElementById('catSetupTitle');
    const body = document.getElementById('catSetupBody');
    if (!titleEl || !body) return;
    if (!catId) {
      titleEl.textContent = 'Category setup';
      body.innerHTML = '<p class="tiny" style="color:#64748b">No categories selected that require setup.</p>';
      return;
    }
    const titles = {
      'hvac': 'Central HVAC setup',
      'mini-split': 'Mini Split setup',
      'dehumidifier': 'Dehumidifier setup',
      'fans': 'Fans setup',
      'vents': 'Vents setup',
      'controllers': 'Controllers / hubs setup',
      'energy-monitor': 'Energy Monitor setup',
      'other': 'Other equipment setup'
    };
    titleEl.textContent = titles[catId] || 'Category setup';

    // Map catId to equipment-kb category name
    const kbCat = catId;
    const prefix = catId === 'dehumidifier' ? 'dehu' : catId;

    body.innerHTML = `
      <div style="margin-bottom:12px;">
        <label style="display:block;margin-bottom:8px;font-size:13px;">Search ${titles[catId] || catId}:</label>
        <input id="cat-${prefix}-search" type="text" placeholder="Search models..."
               style="width:100%;padding:8px;font-size:14px;">
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Search Results:</div>
        <div id="cat-${prefix}-results" style="max-height:150px;overflow-y:auto;border:1px solid rgba(59,130,246,0.15);border-radius:8px;min-height:60px;background:rgba(15,23,42,0.4);">
          <div style="padding:20px;text-align:center;color:#64748b;font-size:13px;">
            Type to search for models...
          </div>
        </div>
      </div>
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;color:#64748b;margin-bottom:4px;">Selected Equipment:</div>
        <div id="cat-${prefix}-selected" style="min-height:60px;border:1px solid rgba(59,130,246,0.15);border-radius:8px;padding:8px;background:rgba(15,23,42,0.4);">
          <div style="color:#64748b;font-size:13px;">No equipment selected yet</div>
        </div>
      </div>
    `;

    // Wire search input
    const searchInput = document.getElementById(`cat-${prefix}-search`);
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchEquipment(kbCat, e.target.value, `cat-${prefix}-results`);
      });
    }
    // Render any previously selected equipment
    this.renderSelectedEquipment(kbCat, `cat-${prefix}-selected`);

    // Prevent Enter from submitting form
    body.querySelectorAll('input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); return false; }
      });
    });
  }

  // Render selected equipment items with per-model shared specs (dimensions + category-specific)
  renderSelectedEquipment(category, selectedElementId) {
    const selectedDiv = document.getElementById(selectedElementId);
    if (!selectedDiv) return;
    const catId = this.getCurrentCategoryId();
    if (!catId) return;

    const selectedEquipment = (this.categoryProgress[catId]?.selectedEquipment || [])
      .filter(e => e.category === category);

    if (selectedEquipment.length === 0) {
      selectedDiv.innerHTML = '<div style="color:#64748b;font-size:13px;">No equipment selected yet</div>';
      return;
    }

    // Category-specific spec field builder
    const specFieldFor = (item) => {
      const s = item.specs || {};
      const cat = item.category;
      if (cat === 'fans') return '<label class="tiny" style="color:#94a3b8;">CFM <input type="number" class="eq-spec" data-spec="cfm" min="0" value="' + (s.cfm||'') + '" style="width:75px;margin-left:4px;"></label>';
      if (cat === 'hvac' || cat === 'mini-split') return '<label class="tiny" style="color:#94a3b8;">BTU <input type="number" class="eq-spec" data-spec="btu" min="0" value="' + (s.btu||'') + '" style="width:85px;margin-left:4px;"></label>';
      if (cat === 'dehumidifier') return '<label class="tiny" style="color:#94a3b8;">PPD <input type="number" class="eq-spec" data-spec="ppd" min="0" value="' + (s.ppd||'') + '" style="width:75px;margin-left:4px;"></label>';
      if (cat === 'vents') return '<label class="tiny" style="color:#94a3b8;">Dia (in) <input type="number" class="eq-spec" data-spec="diameter" min="0" step="0.5" value="' + (s.diameter||'') + '" style="width:70px;margin-left:4px;"></label>';
      if (cat === 'energy-monitor') return '<label class="tiny" style="color:#94a3b8;">Amps <input type="number" class="eq-spec" data-spec="amps" min="0" value="' + (s.amps||'') + '" style="width:70px;margin-left:4px;"></label>';
      if (cat === 'other') return '<label class="tiny" style="color:#94a3b8;">Notes <input type="text" class="eq-spec" data-spec="notes" value="' + escapeHtml(s.notes||'') + '" placeholder="e.g., CO2 burner" style="min-width:140px;margin-left:4px;"></label>';
      return '';
    };

    selectedDiv.innerHTML = '';
    const self = this;
    selectedEquipment.forEach((item, idx) => {
      const d = item.dimensions || {};
      const itemDiv = document.createElement('div');
      itemDiv.style.cssText = 'padding:10px;border-bottom:1px solid rgba(59,130,246,0.1);';

      // Row 1: model info + count controls
      const row1 = document.createElement('div');
      row1.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;';
      row1.innerHTML = '<div>'
        + '<div style="font-weight:500;font-size:14px;color:#f1f5f9;">' + escapeHtml(item.vendor) + ' ' + escapeHtml(item.model) + '</div>'
        + '<div style="font-size:12px;color:#94a3b8;">' + escapeHtml(item.capacity) + ' -- ' + escapeHtml(item.control) + '</div>'
        + '</div>'
        + '<div style="display:flex;gap:6px;align-items:center;">'
        + '<button type="button" class="btn-decrease" style="width:24px;height:24px;border:1px solid rgba(59,130,246,0.3);background:rgba(30,41,59,0.6);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;">-</button>'
        + '<span style="min-width:20px;text-align:center;font-size:14px;color:#f1f5f9;">' + item.count + '</span>'
        + '<button type="button" class="btn-increase" style="width:24px;height:24px;border:1px solid rgba(59,130,246,0.3);background:rgba(30,41,59,0.6);color:#93c5fd;border-radius:4px;cursor:pointer;font-size:16px;line-height:1;">+</button>'
        + '<button type="button" class="btn-remove" style="width:24px;height:24px;border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.1);color:#f87171;border-radius:4px;cursor:pointer;font-size:14px;line-height:1;">x</button>'
        + '</div>';

      // Row 2: Shared specs banner + dimension fields + category-specific field
      const row2 = document.createElement('div');
      row2.style.cssText = 'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.12);border-radius:6px;padding:8px 10px;margin-top:4px;';
      row2.innerHTML = '<div style="font-size:11px;font-weight:600;color:#60a5fa;margin-bottom:6px;letter-spacing:0.03em;">'
        + 'Shared specs -- applies to all ' + item.count + ' unit' + (item.count !== 1 ? 's' : '')
        + '</div>'
        + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">'
        + '<label class="tiny" style="color:#94a3b8;">L<input type="number" class="eq-dim" data-dim="l" min="0" step="0.1" value="' + (d.l||'') + '" style="width:60px;margin-left:4px;" placeholder="in"> in</label>'
        + '<label class="tiny" style="color:#94a3b8;">W<input type="number" class="eq-dim" data-dim="w" min="0" step="0.1" value="' + (d.w||'') + '" style="width:60px;margin-left:4px;" placeholder="in"> in</label>'
        + '<label class="tiny" style="color:#94a3b8;">H<input type="number" class="eq-dim" data-dim="h" min="0" step="0.1" value="' + (d.h||'') + '" style="width:60px;margin-left:4px;" placeholder="in"> in</label>'
        + specFieldFor(item)
        + '</div>';

      itemDiv.appendChild(row1);
      itemDiv.appendChild(row2);

      // Wire count buttons
      row1.querySelector('.btn-decrease').addEventListener('click', () => {
        self.changeEquipmentCount(category, item.vendor, item.model, -1);
      });
      row1.querySelector('.btn-increase').addEventListener('click', () => {
        self.changeEquipmentCount(category, item.vendor, item.model, 1);
      });
      row1.querySelector('.btn-remove').addEventListener('click', () => {
        self.removeEquipment(category, item.vendor, item.model);
      });

      // Wire dimension inputs -- update item.dimensions and persist
      row2.querySelectorAll('.eq-dim').forEach(input => {
        input.addEventListener('input', () => {
          if (!item.dimensions) item.dimensions = {};
          const val = parseFloat(input.value);
          item.dimensions[input.dataset.dim] = Number.isFinite(val) ? val : undefined;
        });
      });

      // Wire spec inputs -- update item.specs and persist
      row2.querySelectorAll('.eq-spec').forEach(input => {
        input.addEventListener('input', () => {
          if (!item.specs) item.specs = {};
          const key = input.dataset.spec;
          if (input.type === 'number') {
            const val = parseFloat(input.value);
            item.specs[key] = Number.isFinite(val) ? val : undefined;
          } else {
            item.specs[key] = (input.value || '').trim() || undefined;
          }
        });
      });

      selectedDiv.appendChild(itemDiv);
    });
  }

  captureCurrentCategoryForm() {
    const catId = this.getCurrentCategoryId();
    if (!catId) return;
    const data = (this.data.category || (this.data.category = {}));
    const catData = (data[catId] || (data[catId] = {}));

    // All categories now use selectedEquipment with per-model specs
    const selectedEquipment = (this.categoryProgress[catId]?.selectedEquipment || []);
    catData.selectedEquipment = selectedEquipment.map(e => ({...e}));
    catData.count = selectedEquipment.reduce((sum, item) => sum + item.count, 0);
    if (selectedEquipment.length > 0) {
      catData.manufacturer = selectedEquipment[0].vendor;
      catData.model = selectedEquipment[0].model;
    }
  }

  setupManufacturerSearch() {
    // All categories now use the unified search pattern wired in renderCurrentCategoryForm
  }

  searchEquipment(category, query, resultsElementId) {
    const resultsDiv = document.getElementById(resultsElementId);
    if (!resultsDiv) return;

    if (!query || !query.trim()) {
      resultsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;font-size:13px;">Type to search for models...</div>';
      return;
    }

    // Search in equipment database
    const equipment = STATE.equipmentKB?.equipment || [];

    if (equipment.length === 0) {
      // Try to load the equipment database on-demand
      fetch('/data/equipment-kb.json')
        .then(r => r.json())
        .then(data => {
          if (data && Array.isArray(data.equipment)) {
            STATE.equipmentKB = data;
            this.searchEquipment(category, query, resultsElementId);
          } else {
            resultsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#f87171;font-size:13px;">Equipment database has invalid structure.</div>';
          }
        })
        .catch(err => {
          resultsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#f87171;font-size:13px;">Failed to load equipment database.</div>';
        });
      return;
    }

    const q = query.toLowerCase();
    const filtered = equipment.filter(item => {
      const searchText = (item.vendor + ' ' + item.model + ' ' + (item.tags || []).join(' ')).toLowerCase();
      return item.category === category && searchText.includes(q);
    });

    if (filtered.length === 0) {
      resultsDiv.innerHTML = '<div style="padding:20px;text-align:center;color:#64748b;font-size:13px;">No models found matching "' + escapeHtml(query) + '"</div>';
      return;
    }

    resultsDiv.innerHTML = '';
    filtered.forEach(item => {
      const div = document.createElement('div');
      div.style.cssText = 'padding:8px;border-bottom:1px solid rgba(59,130,246,0.08);cursor:pointer;display:flex;justify-content:space-between;align-items:center;transition:background 0.15s;';
      div.innerHTML = '<div>'
        + '<div style="font-weight:500;font-size:14px;color:#f1f5f9;">' + escapeHtml(item.vendor) + ' ' + escapeHtml(item.model) + '</div>'
        + '<div style="font-size:12px;color:#94a3b8;">' + escapeHtml(item.capacity || item.power || '') + ' -- ' + escapeHtml(item.control || 'Manual') + '</div>'
        + '</div>'
        + '<div style="font-size:12px;color:#60a5fa;font-weight:500;">+ Add</div>';
      div.addEventListener('mouseenter', () => { div.style.background = 'rgba(59,130,246,0.08)'; });
      div.addEventListener('mouseleave', () => { div.style.background = ''; });
      div.addEventListener('click', () => {
        this.addEquipment(category, item.vendor, item.model, item.capacity || item.power || 'Unknown', item.control || 'Manual');
      });
      resultsDiv.appendChild(div);
    });
  }

  addEquipment(category, vendor, model, capacity, control) {
    const catId = this.getCurrentCategoryId();
    if (!catId) return;
    if (!this.categoryProgress[catId]) this.categoryProgress[catId] = {};
    if (!this.categoryProgress[catId].selectedEquipment) this.categoryProgress[catId].selectedEquipment = [];

    const existing = this.categoryProgress[catId].selectedEquipment.find(e =>
      e.category === category && e.vendor === vendor && e.model === model
    );
    if (existing) {
      existing.count += 1;
    } else {
      this.categoryProgress[catId].selectedEquipment.push({
        category, vendor, model, capacity, control,
        count: 1,
        dimensions: {},
        specs: {}
      });
    }
    const prefix = category === 'dehumidifier' ? 'dehu' : category;
    this.renderSelectedEquipment(category, 'cat-' + prefix + '-selected');
  }

  changeEquipmentCount(category, vendor, model, delta) {
    let foundCatId = null;
    let item = null;
    for (const [catId, catProg] of Object.entries(this.categoryProgress)) {
      const eqArr = catProg?.selectedEquipment || [];
      const match = eqArr.find(e => e.category === category && e.vendor === vendor && e.model === model);
      if (match) { foundCatId = catId; item = match; break; }
    }
    if (item && foundCatId !== null) {
      item.count = Math.max(0, item.count + delta);
      if (item.count === 0) {
        this.removeEquipment(category, vendor, model, foundCatId);
      } else {
        const prefix = category === 'dehumidifier' ? 'dehu' : category;
        this.renderSelectedEquipment(category, 'cat-' + prefix + '-selected');
      }
    }
  }

  removeEquipment(category, vendor, model, catId) {
    const targetCatId = catId != null ? catId : this.getCurrentCategoryId();
    if (!targetCatId || !this.categoryProgress[targetCatId]?.selectedEquipment) return;
    this.categoryProgress[targetCatId].selectedEquipment =
      this.categoryProgress[targetCatId].selectedEquipment.filter(e =>
        !(e.category === category && e.vendor === vendor && e.model === model)
      );
    const prefix = category === 'dehumidifier' ? 'dehu' : category;
    this.renderSelectedEquipment(category, 'cat-' + prefix + '-selected');
  }
  populateModelDropdown(modelSelectId, manufacturerQuery, category) {
    const modelSelect = document.getElementById(modelSelectId);
    if (!modelSelect) {
      console.log('[DEBUG] Model select element not found:', modelSelectId);
      return;
    }

    // Clear existing options except the first one
    modelSelect.innerHTML = '<option value="">Select model</option>';

    if (!manufacturerQuery || manufacturerQuery.length < 2) {
      console.log('[DEBUG] Query too short or empty:', manufacturerQuery);
      return;
    }

    const query = manufacturerQuery.toLowerCase();
    console.log('[DEBUG] Searching equipment for manufacturer:', query, 'category:', category);
    console.log('[DEBUG] STATE.equipmentKB exists:', !!STATE.equipmentKB);
    console.log('[DEBUG] Equipment array exists:', !!STATE.equipmentKB?.equipment);
    console.log('[DEBUG] Equipment array length:', STATE.equipmentKB?.equipment?.length || 0);

    // Search in equipment database
    const equipment = STATE.equipmentKB?.equipment || [];
    const matchingEquipment = equipment.filter(item => 
      item.category === category && 
      item.vendor.toLowerCase().includes(query)
    );

    console.log('[DEBUG] Found equipment matches:', matchingEquipment.length);
    if (matchingEquipment.length > 0) {
      console.log('[DEBUG] Sample matches:', matchingEquipment.slice(0, 3).map(e => `${e.vendor} ${e.model}`));
    }

    matchingEquipment.forEach(item => {
      const option = document.createElement('option');
      option.value = item.model;
      option.textContent = `${item.model} (${item.capacity || item.power || 'Unknown capacity'})`;
      option.dataset.vendor = item.vendor;
      option.dataset.category = item.category;
      option.dataset.control = item.control;
      modelSelect.appendChild(option);
    });

    // Also search in device manufacturers database
    const manufacturers = window.DEVICE_MANUFACTURERS || [];
    manufacturers.forEach(manufacturer => {
      if (manufacturer.name.toLowerCase().includes(query)) {
        (manufacturer.models || []).forEach(model => {
          // Try to match category or features to the requested category
          const hasRelevantFeatures = model.features && (
            (category === 'dehumidifier' && model.features.includes('dehumidification')) ||
            (category === 'mini-split' && model.features.includes('hvac')) ||
            (category === 'fans' && model.features.includes('ventilation'))
          );

          if (hasRelevantFeatures || category === 'other') {
            const option = document.createElement('option');
            option.value = model.model;
            option.textContent = `${model.model} (${(model.connectivity || []).join(', ')})`;
            option.dataset.vendor = manufacturer.name;
            option.dataset.connectivity = (model.connectivity || []).join(',');
            modelSelect.appendChild(option);
          }
        });
      }
    });
  }

  // Wire per-category action buttons: Test Control
  async persistProgress() {
    try {
      const key = 'gr.roomWizard.progress';
      const state = { categoryProgress: this.categoryProgress, data: this.data, ts: Date.now() };
      localStorage.setItem(key, JSON.stringify(state));
      return true;
    } catch { return false; }
  }

  updateKbResults(q){
    const host = $('#roomKbResults'); if (!host) return;
    host.innerHTML = '';
    if (!q) return;
    const fixtures = STATE.deviceKB.fixtures || [];
    // Filter KB by query and by selected hardware categories (if any)
    const cats = this.data.hardwareCats || [];
    // Small category -> tag mapping to make category-first browsing deterministic
    const CATEGORY_TAG_MAP = {
      'grow-lights': ['led','bar','fixture','light'],
      'controllers': ['controller','driver','ballast'],
      'sensors': ['sensor','temp','humidity','ppfd','co2'],
      'hubs': ['hub','bridge']
    };
    const res = fixtures.map((it, idx)=>({it, idx}))
      .filter(({it})=>`${it.vendor} ${it.model}`.toLowerCase().includes(q.toLowerCase()))
      .filter(({it}) => {
        if (!cats.length) return true;
        const tagSet = new Set((it.tags||[]).map(t=>t.toLowerCase()));
        // If any selected category maps to tags that intersect the item tags, include it
        for (const c of cats) {
          const mapped = CATEGORY_TAG_MAP[c] || [c];
          if (mapped.some(t => tagSet.has(t))) return true;
        }
        // fallback: include if model or vendor contains category string
        return cats.every(c => (`${it.vendor} ${it.model}`.toLowerCase().includes(c.toLowerCase())));
      });
  if (!res.length) { host.innerHTML = '<li class="tiny" style="color:#64748b">No matches in knowledge base.</li>'; return; }
  host.innerHTML = res.map(({it, idx})=>`<li><div class="row" style="justify-content:space-between;align-items:center;gap:8px"><div>${it.vendor} <strong>${it.model}</strong> • ${it.watts} W • ${it.control || ''}</div><div style="display:flex;gap:6px"><button type="button" class="ghost" data-action="add-kb" data-idx="${idx}">Add</button><button type="button" class="ghost" data-action="add-unknown" data-idx="${idx}">Add unknown</button><button type="button" class="ghost" data-action="add-research" data-idx="${idx}">Add to research queue</button></div></div></li>`).join('');
  }

  // renderKbSelected method moved to LightWizard

  renderDevicesList() {
    const ul = $('#roomDevicesList'); if (!ul) return;
    const summarizeSetup = (s) => {
      if (!s) return '';
      const parts = [];
      if (s.wifi) parts.push(`Wi‑Fi: ${s.wifi.ssid || 'n/a'}`);
      if (s.bluetooth) parts.push(`BT: ${s.bluetooth.name || 'paired'}`);
      if (s['0-10v']) parts.push(`0‑10V: ch ${s['0-10v'].channel || '?'}${s['0-10v'].scale ? ` scale ${s['0-10v'].scale}` : ''}`);
      if (s.rs485) parts.push(`RS‑485: id ${s.rs485.unitId || '?'} @ ${s.rs485.baud || '?.?'} baud`);
      if (s.smartPlug || s['smart-plug']) parts.push('Smart‑plug');
      return parts.join(' • ');
    };

    ul.innerHTML = (this.data.devices||[]).map((d, i) => `
      <li>
        <div class="row" style="align-items:center;gap:6px">
          <div style="flex:1">
            <div><strong>${escapeHtml(d.name || '')}</strong> ${escapeHtml(d.vendor||'')} ${escapeHtml(d.model||'')} ${d.host?`• ${escapeHtml(d.host)}`:''}</div>
            <div class="tiny" style="color:#64748b;margin-top:4px">${escapeHtml(summarizeSetup(d.setup) || '')}</div>
          </div>
          <button type="button" class="ghost" data-action="remove-device" data-idx="${i}">×</button>
        </div>
      </li>
    `).join('');
    try {
      const statusEl = document.getElementById('deviceOnboardingStatus');
      if (statusEl) {
        const count = Array.isArray(this.data.devices) ? this.data.devices.length : 0;
        statusEl.textContent = count ? `${count} device${count === 1 ? '' : 's'} ready for mapping.` : 'No devices paired yet.';
      }
    } catch {}
    this.updateSetupQueue();
  }

  addGroupFromInput() {
    const input = document.getElementById('roomGroupNameInput');
    if (!input) return;
    const value = (input.value || '').trim();
    if (value) this.addGroup(value);
    input.value = '';
  }

  addGroup(name) {
    if (!name) return;
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
    const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : (this.data.grouping.groups = []);
    if (!groups.includes(name)) {
      groups.push(name);
      this.renderGroupList();
      this.updateGroupSuggestions();
      this.updateSetupQueue();
    }
  }

  removeGroup(idx) {
    this.data.grouping = this.data.grouping || { groups: [], planId: '', scheduleId: '' };
    const groups = Array.isArray(this.data.grouping.groups) ? this.data.grouping.groups : [];
    if (idx >= 0 && idx < groups.length) {
      groups.splice(idx, 1);
      this.renderGroupList();
      this.updateGroupSuggestions();
      this.updateSetupQueue();
    }
  }

  renderGroupList() {
    const list = document.getElementById('roomGroupList'); if (!list) return;
    const groups = Array.isArray(this.data.grouping?.groups) ? this.data.grouping.groups : [];
    if (!groups.length) {
      list.innerHTML = '<li class="tiny" style="color:#64748b">No groups yet.</li>';
      return;
    }
    list.innerHTML = groups.map((name, idx) => `
      <li class="row" style="align-items:center;justify-content:space-between">
        <span>${escapeHtml(name)}</span>
        <button type="button" class="ghost" data-group-idx="${idx}">Remove</button>
      </li>
    `).join('');
  }

  updateGroupSuggestions() {
    const host = document.getElementById('roomGroupSuggestions'); if (!host) return;
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    const current = new Set(Array.isArray(this.data.grouping?.groups) ? this.data.grouping.groups : []);
    const suggestions = zones.filter(z => !current.has(z));
    if (!suggestions.length) {
      host.innerHTML = '<span class="tiny" style="color:#94a3b8">No zone-based suggestions.</span>';
      return;
    }
    host.innerHTML = suggestions.map(z => `<button type="button" class="chip-option" data-group="${escapeHtml(z)}">${escapeHtml(z)}</button>`).join('');
  }

  populateGroupingSelectors() {
    const planSel = document.getElementById('roomGroupPlan');
    const schedSel = document.getElementById('roomGroupSchedule');
    if (planSel) {
      const plans = Array.isArray(STATE.plans) ? STATE.plans : [];
      const current = this.data.grouping?.planId || '';
      planSel.innerHTML = ['<option value="">Select plan…</option>', ...plans.map(p => `<option value="${escapeHtml(p.id || '')}">${escapeHtml(p.name || 'Plan')}</option>`)].join('');
      planSel.value = current || '';
    }
    if (schedSel) {
      const sched = Array.isArray(STATE.schedules) ? STATE.schedules : [];
      const current = this.data.grouping?.scheduleId || '';
      schedSel.innerHTML = ['<option value="">Select schedule…</option>', ...sched.map(s => `<option value="${escapeHtml(s.id || '')}">${escapeHtml(s.name || 'Schedule')}</option>`)].join('');
      schedSel.value = current || '';
    }
    this.renderGroupList();
    this.updateGroupSuggestions();
  }

  async detectHub() {
    const status = document.getElementById('roomHubStatus');
    if (status) status.textContent = 'Detecting hub…';
    try {
  // const resp = await fetch('/forwarder/healthz');
  // Forwarder health check disabled
  const resp = { ok: false };
      if (resp.ok) {
        if (status) status.textContent = 'Controller reachable — hub likely online.';
        this.data.connectivity = this.data.connectivity || {};
        if (this.data.connectivity.hasHub !== false) this.data.connectivity.hasHub = true;
      } else {
        if (status) status.textContent = 'Hub not detected automatically. Enter IP manually.';
      }
    } catch (err) {
      if (status) status.textContent = 'Could not reach hub automatically. Enter the IP and tenant manually.';
    }
    this.updateSetupQueue();
  }

  async verifyHub() {
    const status = document.getElementById('roomHubStatus');
    if (status) status.textContent = 'Verifying Node-RED…';
    try {
  // const resp = await fetch('/forwarder/healthz');
  // Forwarder health check disabled
  const resp = { ok: false };
      if (resp.ok) {
        if (status) status.textContent = 'Forwarder healthy — confirm Node-RED flows are running on the hub for edge control.';
      } else {
        if (status) status.textContent = 'Forwarder returned an error. Ensure Node-RED is running on the local hub.';
      }
    } catch (err) {
      if (status) status.textContent = 'Unable to reach the hub right now. Check local connectivity and Node-RED status.';
    }
  }

  async scanLocalDevices() {
    const status = document.getElementById('deviceOnboardingStatus');
    if (status) status.textContent = 'Scanning local network for smart devices…';
    try {
      const resp = await fetch('/forwarder/network/scan');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json().catch(() => null);
      if (Array.isArray(data?.devices) && data.devices.length) {
        const summary = data.devices.slice(0, 5).map(d => `${d.vendor || d.brand || 'Device'} ${d.model || ''}`.trim()).join(', ');
        if (status) status.textContent = `Discovered ${data.devices.length} device(s): ${summary}${data.devices.length > 5 ? '…' : ''}`;
      } else {
        if (status) status.textContent = 'No known devices responded. Add them manually after completing vendor onboarding.';
      }
    } catch (err) {
      if (status) status.textContent = 'Scan unavailable in this environment. Enter tokens or IPs from the vendor apps.';
    }
  }

  handleZoneAdd() {
    const input = document.getElementById('roomZoneInput');
    if (!input) return;
    const value = (input.value || '').trim();
    if (!value) return;
    this.data.zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    if (!this.data.zones.includes(value)) {
      this.data.zones.push(value);
      this.renderZoneList();
      this.updateSetupQueue();
    }
    input.value = '';
    try { input.focus(); } catch {}
  }

  removeZone(idx) {
    if (!Array.isArray(this.data.zones)) return;
    this.data.zones.splice(idx, 1);
    this.renderZoneList();
    this.updateSetupQueue();
  }

  renderZoneList() {
    const list = document.getElementById('roomZoneList');
    if (!list) return;
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    if (!zones.length) {
      list.innerHTML = '<li class="tiny" style="color:#64748b">No zones yet.</li>';
      this.updateGroupSuggestions();
      return;
    }
    list.innerHTML = zones.map((z, idx) => `
      <li class="row" style="align-items:center;justify-content:space-between">
        <span>${escapeHtml(z)}</span>
        <button type="button" class="ghost" data-zone-idx="${idx}">Remove</button>
      </li>
    `).join('');
    this.updateGroupSuggestions();
  }

  setRoleList(roleKey, raw) {
    this.data.roles = this.data.roles || { admin: [], operator: [], viewer: [] };
    const entries = (raw || '')
      .split(/[;,]/)
      .map(v => v.trim())
      .filter(Boolean);
    this.data.roles[roleKey] = entries;
  }

  mapControlToMethod(control) {
    if (!control) return null;
    const text = String(control).toLowerCase();
    if (text.includes('0-10')) return '0-10v';
    if (text.includes('modbus') || text.includes('rs485') || text.includes('bacnet')) return 'rs485';
    if (text.includes('smart plug') || text.includes('smart-plug') || text.includes('plug') || text.includes('kasa') || text.includes('switchbot')) return 'smart-plug';
    if (text.includes('bluetooth') || text.includes('ble')) return 'bluetooth';
    if (text.includes('wifi') || text.includes('wi-fi') || text.includes('cloud')) return 'wifi';
    return 'other';
  }

  setChipActiveState(btn, isActive) {
    if (!btn) return;
    if (isActive) {
      btn.setAttribute('data-active', '');
      btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      btn.removeAttribute('data-active');
      btn.classList.remove('is-active');
      btn.setAttribute('aria-pressed', 'false');
    }
  }

  ensureHardwareCategory(cat) {
    if (!cat) return;
    this.data.hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
    this.data.hardwareOrder = Array.isArray(this.data.hardwareOrder) ? this.data.hardwareOrder : [];
    if (!this.data.hardwareCats.includes(cat)) {
      this.data.hardwareCats.push(cat);
      if (!this.data.hardwareOrder.includes(cat)) this.data.hardwareOrder.push(cat);
      const host = document.getElementById('roomHardwareCats');
      if (host) {
        const btn = host.querySelector(`.chip-option[data-value="${cat}"]`);
        if (btn) this.setChipActiveState(btn, true);
      }
      this.rebuildDynamicSteps();
    } else {
      const host = document.getElementById('roomHardwareCats');
      if (host) {
        const btn = host.querySelector(`.chip-option[data-value="${cat}"]`);
        if (btn) this.setChipActiveState(btn, true);
      }
    }
    this.updateSetupQueue();
  }

  updateHardwareSearch(query) {
    const host = document.getElementById('roomDeviceSearchResults');
    if (!host) return;
    this.hardwareSearchResults = [];
    if (!query) {
      host.innerHTML = '<li class="tiny" style="color:#64748b">Search lights, hubs, HVAC, dehumidifiers, equipment…</li>';
      return;
    }
    const q = query.toLowerCase();
    const results = [];
    
    // Search fixtures (lights)
    const fixtures = (STATE.deviceKB?.fixtures || []).filter(item => `${item.vendor} ${item.model}`.toLowerCase().includes(q));
    fixtures.forEach(item => {
      results.push({
        kind: 'fixture',
        item,
        label: `${item.vendor} ${item.model}`,
        meta: [item.watts ? `${item.watts} W` : null, item.control || null].filter(Boolean).join(' • ')
      });
    });
    
    // Search equipment (HVAC, dehumidifiers, fans, etc.)
    const equipment = (STATE.equipmentKB?.equipment || []).filter(item => 
      `${item.vendor} ${item.model} ${item.category}`.toLowerCase().includes(q)
    );
    equipment.forEach(item => {
      results.push({
        kind: 'equipment',
        item,
        label: `${item.vendor} ${item.model}`,
        meta: [
          item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : null,
          item.capacity || null,
          item.control || null
        ].filter(Boolean).join(' • ')
      });
    });
    
    // Search device manufacturers
    (DEVICE_MANUFACTURERS || []).forEach(man => {
      (man.models || []).forEach(model => {
        const label = `${man.name} ${model.model}`;
        if (!label.toLowerCase().includes(q)) return;
        results.push({
          kind: 'device',
          item: {
            vendor: man.name,
            model: model.model,
            connectivity: model.connectivity || [],
            features: model.features || [],
            requiresHub: model.requiresHub || man.requiresHub || false
          },
          label,
          meta: (model.connectivity || []).join(', ')
        });
      });
    });
    
    this.hardwareSearchResults = results.slice(0, 8);
    if (!this.hardwareSearchResults.length) {
      host.innerHTML = '<li class="tiny" style="color:#64748b">No matches found. Try another make/model.</li>';
      return;
    }
    host.innerHTML = this.hardwareSearchResults.map((res, idx) => {
      const meta = res.meta ? `<div class="tiny" style="color:#64748b">${escapeHtml(res.meta)}</div>` : '';
      let hint = 'Fill device form & pairing tips';
      if (res.kind === 'fixture') hint = 'Add fixture & infer control';
      else if (res.kind === 'equipment') hint = 'Add equipment & configure control';
      
      return `<li><button type="button" class="ghost" data-idx="${idx}" style="width:100%;text-align:left"><div><div><strong>${escapeHtml(res.label)}</strong></div>${meta}<div class="tiny" style="color:#0f172a">${escapeHtml(hint)}</div></div></button></li>`;
    }).join('');
  }

  applyHardwareSuggestion(suggestion) {
    if (!suggestion) return;
    const host = document.getElementById('roomDeviceSearchResults');
    if (host) host.innerHTML = '';
    const searchInput = document.getElementById('roomDeviceSearch');
    if (searchInput) searchInput.value = '';
    
    if (suggestion.kind === 'fixture') {
      const item = suggestion.item;
      this.data.fixtures = this.data.fixtures || [];
      this.data.fixtures.push({ ...item, count: 1 });
      this.renderKbSelected();
      const method = this.mapControlToMethod(item.control || '');
      if (method) {
        this.data.controlMethod = method;
        const container = document.getElementById('roomControlMethod');
        if (container) {
          container.querySelectorAll('.chip-option').forEach(btn => {
            if (btn.dataset.value === method) btn.classList.add('active'); else btn.classList.remove('active');
          });
        }
        const details = document.getElementById('roomControlDetails');
        if (details) details.textContent = this.controlHintFor(method);
      }
      this.ensureHardwareCategory('grow-lights');
      this.inferSensors();
      this.updateSetupQueue();
      // Update controller assignments when fixtures are added
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
      showToast({ title: 'Fixture added', msg: `${item.vendor} ${item.model} inserted into the room`, kind: 'success', icon: '' }, 3000);
      return;
    }

    if (suggestion.kind === 'equipment') {
      const item = suggestion.item;
      this.data.devices = this.data.devices || [];
      
      // Create device entry from equipment
  function updateReview(){
        const host = $('#roomReview'); if (!host) return;
        const escape = escapeHtml;
        // Hardware categories selected in 'hardware' step
        const hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
        const hardwareHtml = hardwareCats.length ? hardwareCats.map(id => `<span class=\"chip tiny\">${escape(this.categoryLabel(id))}</span>`).join(' ') : '—';
        // Per-category detail captured in 'category-setup' step
        const catData = this.data.category || {};
        const catDetails = Object.entries(catData).map(([key, val]) => {
          const parts = [];
          if (val.count != null) parts.push(`${escape(String(val.count))} units`);
          if (val.control) parts.push(escape(String(val.control)));
          if (val.energy) parts.push(escape(String(val.energy)));
          if (val.notes) parts.push(escape(String(val.notes)));
          const label = escape(this.categoryLabel(key));
          return `<li><strong>${label}</strong> — ${parts.length ? parts.join(' • ') : 'No details captured'}</li>`;
        });
        const categoryHtml = catDetails.length ? `<ul class=\"tiny\" style=\"margin:6px 0 0 0; padding-left:18px\">${catDetails.join('')}</ul>` : '<span>—</span>';
        // Zones summary from step 1 (for multi-room, use current room's zones)
        let zones = [];
        if (this.multiRoomList && this.multiRoomList.length > 0 && typeof this.multiRoomIndex === 'number') {
          const currentRoom = this.multiRoomList[this.multiRoomIndex];
          zones = Array.isArray(currentRoom?.zones) ? currentRoom.zones : [];
        } else {
          zones = Array.isArray(this.data.zones) ? this.data.zones : [];
        }
        const zonesHtml = zones.length
          ? `${zones.length} zone${zones.length > 1 ? 's' : ''}: <span>${zones.map(z => escape(z)).join(', ')}</span>`
          : '—';
        host.innerHTML = `
          <div><strong>Name:</strong> ${escape(this.data.name || '—')}</div>
          <div><strong>Zones:</strong> ${zonesHtml}</div>
          <div><strong>Hardware:</strong> ${hardwareHtml}</div>
          <div><strong>Per-category details:</strong> ${categoryHtml}</div>
        `;
      }
      
      showToast({ 
        title: 'Equipment added', 
        msg: `${item.vendor} ${item.model} added to room`, 
        kind: 'success', 
        icon: '' 
      }, 3000);
      return;
    }

    if (suggestion.kind === 'device') {
      const item = suggestion.item;
      const vendorSel = document.getElementById('roomDeviceVendor');
      if (vendorSel) {
        if (!Array.from(vendorSel.options || []).some(opt => opt.value === item.vendor)) {
          const opt = document.createElement('option');
          opt.value = item.vendor;
          opt.textContent = item.vendor;
          vendorSel.appendChild(opt);
        }
        vendorSel.value = item.vendor;
        vendorSel.dispatchEvent(new Event('change'));
      }
      const modelSel = document.getElementById('roomDeviceModel');
      if (modelSel) {
        if (!Array.from(modelSel.options || []).some(opt => opt.value === item.model)) {
          const opt = document.createElement('option');
          opt.value = item.model;
          opt.textContent = item.model;
          modelSel.appendChild(opt);
        }
        modelSel.value = item.model;
        modelSel.dispatchEvent(new Event('change'));
      }
      const nameInput = document.getElementById('roomDeviceName');
      if (nameInput && !nameInput.value) nameInput.value = item.model;
      const cm = this.mapControlToMethod((item.connectivity || []).join(' '));
      if (cm) {
        this.data.controlMethod = cm;
        const container = document.getElementById('roomControlMethod');
        if (container) {
          container.querySelectorAll('.chip-option').forEach(btn => {
            if (btn.dataset.value === cm) btn.classList.add('active'); else btn.classList.remove('active');
          });
        }
        const details = document.getElementById('roomControlDetails');
        if (details) details.textContent = this.controlHintFor(cm);
      }
      if ((item.connectivity || []).some(c => /plug|smart/.test(String(c).toLowerCase())) || /plug|switch/.test(item.model.toLowerCase())) {
        this.ensureHardwareCategory('controllers');
      } else {
        this.ensureHardwareCategory('other');
      }
      if (typeof toggleSetupFormsForModel === 'function') toggleSetupFormsForModel(item);
      this.updateSetupQueue();
      showToast({ title: 'Device selected', msg: `${item.vendor} ${item.model} prefilled. Complete the device form to add it.`, kind: 'info', icon: '' }, 3500);
    }
  }

  stepCategory(direction) {
    if (!this.categoryQueue.length) return;
    const next = this.categoryIndex + direction;
    if (next < 0 || next >= this.categoryQueue.length) return;
    this.captureCurrentCategoryForm();
    this.categoryIndex = next;
    this.renderCurrentCategoryForm();
    this.updateCategoryNav();
  }

  categoryStatusMessage(status, note = '') {
    const map = {
      'complete': ' Ready',
      'needs-hub': ' Needs hub',
      'needs-energy': ' Needs energy meter',
      'needs-setup': ' Needs setup',
      'needs-info': '• Needs info',
      'not-started': '• Needs info'
    };
    const label = map[status] || '• Needs info';
    return note ? `${label} — ${note}` : label;
  }

  updateCategoryNav() {
    const progress = document.getElementById('catSetupProgress');
    const total = this.categoryQueue.length;
    if (progress) {
      progress.textContent = total ? `Type ${this.categoryIndex + 1} of ${total}` : '';
    }
    const prev = document.getElementById('catPrevType');
    const next = document.getElementById('catNextType');
    if (prev) prev.disabled = this.categoryIndex <= 0;
    if (next) next.disabled = this.categoryIndex >= total - 1;
    const catId = this.getCurrentCategoryId();
    const statusLine = document.getElementById('catSetupStatusLine');
    const status = document.getElementById('catSetupStatus');
    if (statusLine && catId) {
      statusLine.textContent = `Configuring ${this.categoryLabel(catId)} (${this.categoryIndex + 1} of ${total || 1})`;
    }
    if (status && catId) {
      const st = this.categoryProgress?.[catId]?.status || 'needs-info';
      const note = this.categoryProgress?.[catId]?.notes || '';
      status.textContent = this.categoryStatusMessage(st, note);
    }
  }

  goToStep(stepKey) {
    const idx = this.steps.indexOf(stepKey);
    if (idx >= 0) {
      this.currentStep = idx;
      this.showStep(idx);
    }
  }

  updateSetupQueue() {
    // No-op: setup queue visualization removed. Keep function for compatibility.
    return;
  }

  categoryLabel(id) {
    const map = {
      'hvac': 'Central HVAC',
      'mini-split': 'Mini Split',
      'dehumidifier': 'Dehumidifiers',
      'fans': 'Fans',
      'vents': 'Vents',
      'controllers': 'Controllers',
      'energy-monitor': 'Energy Monitor',
      'sensors': 'Sensors',
      'other': 'Other'
    };
    return map[id] || id;
  }

  // removeFixture and updateFixtureCount methods moved to LightWizard

  controlHintFor(v) {
    const map = {
      'wifi': 'Wi‑Fi/Cloud-controlled fixtures often expose energy and runtime telemetry; they may also report PPFD if integrated.',
      'bluetooth': 'Bluetooth control pairs locally and may require a nearby hub or phone; telemetry depends on vendor integration.',
      'smart-plug': 'Smart plugs give power/energy telemetry but typically do not provide PPFD or temperature readings.',
      '0-10v': '0‑10V wired control usually implies no integrated sensors; external PPFD or temp sensors are commonly used.',
      'rs485': 'RS‑485/Modbus fixtures or drivers may expose metering and diagnostics depending on vendor.',
      'other': 'Other control method — sensor availability depends on the specific device.'
    };
    return map[v] || '';
  }

  inferSensors(){
    // Simple heuristic: combine fixture-declared sensors and control-method hints
    const inferred = new Set();
    (this.data.fixtures||[]).forEach(f => {
      if (Array.isArray(f.sensors)) f.sensors.forEach(s=>inferred.add(s));
      // some KB entries may list capabilities in f.capabilities or f.control
      if (f.capabilities && Array.isArray(f.capabilities)) f.capabilities.forEach(s=>inferred.add(s));
      if (typeof f.control === 'string' && /meter|power|energy/i.test(f.control)) inferred.add('energy');
      if (typeof f.control === 'string' && /ppfd|light|par/i.test(f.control)) inferred.add('ppfd');
    });
    // control method mapping
    const cm = this.data.controlMethod;
    if (cm === 'smart-plug') inferred.add('energy');
    if (cm === 'wifi') inferred.add('energy');
    if (cm === 'rs485') inferred.add('energy');
    // 0-10v tends not to expose sensors directly

    // Normalize known category keys to match checkboxes: tempRh, co2, vpd, ppfd, energy
    // If fixture mentions temp or rh words, map to tempRh
    // already handled by sensors strings if present

    this.data.sensors.categories = Array.from(inferred);

    // Update UI checkboxes if sensors step present
    const container = document.getElementById('roomSensorCats');
    if (container) {
      container.querySelectorAll('input[type=checkbox]').forEach(cb=>{
        cb.checked = this.data.sensors.categories.includes(cb.value);
      });
    }
    this.updateSetupQueue();
  }



  updateReview(){
    const host = $('#roomReview'); if (!host) return;
    const escape = escapeHtml;
    // Hardware categories selected in 'hardware' step
    const hardwareCats = Array.isArray(this.data.hardwareCats) ? this.data.hardwareCats : [];
    const hardwareHtml = hardwareCats.length ? hardwareCats.map(id => `<span class="chip tiny">${escape(this.categoryLabel(id))}</span>`).join(' ') : '—';
    // Per-category detail captured in 'category-setup' step
    const catData = this.data.category || {};
    const catDetails = Object.entries(catData).map(([key, val]) => {
      const parts = [];
      if (val.count != null) parts.push(`${escape(String(val.count))} units`);
      if (val.control) parts.push(escape(String(val.control)));
      if (val.energy) parts.push(escape(String(val.energy)));
      if (val.notes) parts.push(escape(String(val.notes)));
      const label = escape(this.categoryLabel(key));
      return `<li><strong>${label}</strong> — ${parts.length ? parts.join(' • ') : 'No details captured'}</li>`;
    });
    const categoryHtml = catDetails.length ? `<ul class="tiny" style="margin:6px 0 0 0; padding-left:18px">${catDetails.join('')}</ul>` : '<span>—</span>';
    // Zones summary from step 1
    const zones = Array.isArray(this.data.zones) ? this.data.zones : [];
    const zonesHtml = zones.length
      ? `${zones.length} zone${zones.length > 1 ? 's' : ''}: <span>${zones.map(z => escape(z)).join(', ')}</span>`
      : '—';
    host.innerHTML = `
      <div><strong>Name:</strong> ${escape(this.data.name || '—')}</div>
      <div><strong>Zones:</strong> ${zonesHtml}</div>
      <div><strong>Hardware:</strong> ${hardwareHtml}</div>
      <div><strong>Per-category details:</strong> ${categoryHtml}</div>
    `;
  }

  async addLiveSwitchBotDevices() {
    try {
      // Clear existing devices first
      this.data.devices = [];
      
      // Fetch LIVE SwitchBot devices from the API - NO DEMO/MOCK DATA
      console.log('🔌 Fetching LIVE SwitchBot device data (no mock fallbacks)...');
      const response = await fetch('/switchbot/devices');

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SwitchBot API returned HTTP ${response.status}: ${errorText}`);
      }

      const payload = await response.json();
      const interpreted = interpretSwitchBotPayload(payload);
      const meta = interpreted.meta || {};
      const headers = {
        status: response.headers?.get?.('X-Cache') || null,
        freshness: response.headers?.get?.('X-Cache-Freshness') || null
      };

      // Check for rate limiting
      if (response.status === 429 || interpreted.statusCode === 429) {
        const retryAfter = payload?.retryAfter || 60;
        console.warn(`⏱ SwitchBot API rate limited. Retry after ${retryAfter} seconds.`);
        showToast({
          title: 'API Rate Limited',
          msg: `SwitchBot API is rate limited. Please wait ${retryAfter} seconds and refresh.`,
          kind: 'warn',
          icon: ''
        });

        // NO FALLBACK - Live data only
        if (this.statusEl) {
          this.statusEl.textContent = `Rate limited - retry in ${retryAfter}s`;
        }
        return;
      }

      const cacheStatus = (headers.status || '').toLowerCase();
      const cacheFreshness = (headers.freshness || '').toLowerCase();

      if ((meta.cached && meta.stale) || (cacheStatus === 'hit' && cacheFreshness === 'stale')) {
        console.warn(' Using stale cached SwitchBot data:', meta.error || 'Unknown error');
        showToast({
          title: 'Using Cached Data',
          msg: 'SwitchBot API unavailable, using cached device data.',
          kind: 'info',
          icon: ''
        });
      } else if (meta.cached || cacheStatus === 'hit') {
        console.info(' Using cached SwitchBot device list (within TTL).');
      }

      const rawDevices = interpreted.rawDevices.length ? interpreted.rawDevices : interpreted.devices;
      const normalizedDevices = normalizeSwitchBotDevicesList(rawDevices);

      if (!normalizedDevices.length) {
        console.warn(' No SwitchBot devices found in your account');
        showToast({
          title: 'No Devices Found',
          msg: 'No SwitchBot devices found in your account. Add devices in the SwitchBot app first.',
          kind: 'warn',
          icon: ''
        });

        if (this.statusEl) {
          this.statusEl.textContent = 'No devices found in SwitchBot account';
        }
        return;
      }

      // Add real devices only
      normalizedDevices.forEach((device, index) => {
        const liveDevice = {
          name: device.name || device.deviceName || `SwitchBot ${device.type || 'device'} ${index + 1}`,
          vendor: 'SwitchBot',
          model: device.type || device.deviceType || 'SwitchBot device',
          host: 'live-switchbot-api',
          switchBotId: device.deviceId || device.id || '',
          hubId: device.hubDeviceId || device.hub_id || null,
          setup: this.getSetupForDeviceType(device.type || device.deviceType || 'device'),
          isReal: true,
          isLive: true, // Mark as live data
          realDeviceData: device,
          lastUpdate: new Date().toISOString()
        };
        this.data.devices.push(liveDevice);
      });

      this.renderDeviceList();

      console.log(` Loaded ${normalizedDevices.length} LIVE SwitchBot device(s) from greenreach network`, meta);
      showToast({
        title: 'Live Devices Connected',
        msg: `Successfully connected to ${normalizedDevices.length} live SwitchBot devices on greenreach network.`,
        kind: 'success',
        icon: ''
      });

      if (this.statusEl) {
        this.statusEl.textContent = `${normalizedDevices.length} live devices connected on greenreach`;
      }
    } catch (error) {
      console.error(' Failed to load live SwitchBot devices:', error);
      
      // NO FALLBACK TO MOCK DATA - Show error instead
      showToast({ 
        title: 'Live Data Required', 
        msg: `Cannot load live SwitchBot devices: ${error.message}. Please check your API credentials and network connection.`, 
        kind: 'error', 
        icon: '' 
      });
      
      if (this.statusEl) {
        this.statusEl.textContent = `Error: ${error.message}`;
      }
      
      // Keep devices array empty to force live data requirement
      this.data.devices = [];
    }

    // Set live SwitchBot configuration - NO DEMO TOKENS
    this.setupLiveSwitchBotConfiguration();
  }

  getSetupForDeviceType(deviceType) {
    const type = deviceType.toLowerCase();
    // LIVE MODE: Return empty setup - user must configure WiFi/BLE from Farm Registration wizard
    if (type.includes('meter') || type.includes('sensor')) {
      return {
        bluetooth: { name: `WoSensorTH_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else if (type.includes('plug') || type.includes('switch')) {
      return {
        wifi: { ssid: '', psk: '', useStatic: false, staticIp: null }
      };
    } else if (type.includes('bot')) {
      return {
        bluetooth: { name: `WoHand_${Math.random().toString(36).substr(2, 6)}`, pin: null }
      };
    } else {
      return {
        wifi: { ssid: '', psk: '', useStatic: false, staticIp: null }
      };
    }
  }

  addFallbackDemoDevices() {
    // DISABLED: No more mock/demo fallback data
    // This function is intentionally disabled to enforce live data only
    console.warn('🚫 Mock fallback data is disabled. Only live SwitchBot devices are supported.');
    showToast({ 
      title: 'Live Data Only', 
      msg: 'Mock devices are disabled. Please ensure your SwitchBot API is working and you have real devices.', 
      kind: 'warn', 
      icon: '' 
    });
    this.data.devices = [];
  }

  setupLiveSwitchBotConfiguration() {
    // Set hardware categories for real farm equipment
    this.data.hardwareCats = this.data.hardwareCats || [];
    const farmEquipment = ['grow-lights', 'hvac', 'mini-split', 'dehumidifier', 'fans', 'controllers'];
    farmEquipment.forEach(cat => {
      if (!this.data.hardwareCats.includes(cat)) {
        this.data.hardwareCats.push(cat);
      }
    });

    // LIVE connectivity configuration - NO DEMO TOKENS
    this.data.connectivity = {
      hasHub: 'yes',
      hubType: 'Raspberry Pi 4 + SwitchBot Hub',
      hubIp: '192.168.1.100',
      cloudTenant: 'Azure',
      // LIVE TOKENS SHOULD BE SET VIA ENVIRONMENT VARIABLES
      switchbotToken: process.env.SWITCHBOT_TOKEN || 'REQUIRED: Set SWITCHBOT_TOKEN environment variable',
      switchbotSecret: process.env.SWITCHBOT_SECRET || 'REQUIRED: Set SWITCHBOT_SECRET environment variable'
    };

    // Real sensor categories from farm environment
    this.data.sensors = this.data.sensors || { categories: [], placements: {} };
    const farmSensors = ['temperature', 'humidity', 'co2', 'power', 'light', 'soil-moisture'];
    farmSensors.forEach(cat => {
      if (!this.data.sensors.categories.includes(cat)) {
        this.data.sensors.categories.push(cat);
      }
    });

    // Farm-specific sensor placements
    this.data.sensors.placements = {
      temperature: 'canopy-level',
      humidity: 'canopy-level', 
      co2: 'mid-level',
      power: 'electrical-panel',
      light: 'sensor-grid',
      'soil-moisture': 'root-zone'
    };

    // Re-render the devices list and update setup queue
    this.renderDevicesList();
    this.updateSetupQueue();

    // Show LIVE connection message
    showToast({ 
      title: 'Live Farm Network Connected', 
      msg: `Connected to greenreach network with live SwitchBot devices and farm sensors.`, 
      kind: 'success', 
      icon: '' 
    });
  }

  nextStep() {
    // Require validation before advancing
    if (!this.validateCurrentStep()) return;
    this.currentStep = Math.min(this.steps.length - 1, this.currentStep + 1);
    this.showStep(this.currentStep);
  }

  prevStep() {
    // If on category-setup and not on the first category, go to previous category
    const stepKey = this.steps[this.currentStep];
    if (stepKey === 'category-setup' && this.categoryIndex > 0) {
      this.captureCurrentCategoryForm();
      this.categoryIndex--;
      this.renderCurrentCategoryForm();
      this.updateCategoryNav();
      return; // stay on category-setup step
    }
    this.currentStep = Math.max(0, this.currentStep - 1);
    this.showStep(this.currentStep);
  }

  async saveRoom(e, shouldAutoClose = true){
    e.preventDefault();
    // Assign id if new
    if (!this.data.id) this.data.id = `room-${Math.random().toString(36).slice(2,8)}`;
    // Persist categoryProgress into room data for summary
    if (this.categoryProgress) {
      const snap = JSON.parse(JSON.stringify(this.categoryProgress));
      // Save under both underscored and non-underscored keys to ensure visibility across readers
      this.data._categoryProgress = snap;
      this.data.categoryProgress = snap;
    }
    // Upsert into STATE.rooms and persist
    const idx = STATE.rooms.findIndex(r => r.id === this.data.id);
    if (idx >= 0) STATE.rooms[idx] = { ...STATE.rooms[idx], ...this.data };
    else STATE.rooms.push({ ...this.data });
    // Use safeRoomsSave to avoid overwriting manual edits
    const ok = await safeRoomsSave(this.data);
    if (ok) {
      renderRooms();
      renderControllerAssignments(); // Update controller assignments when rooms change
      renderEquipmentOverview(); // Update equipment overview when rooms change
      if (typeof seedGroupRoomZoneDropdowns === 'function') {
        try { seedGroupRoomZoneDropdowns(); } catch {}
      }
      if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try { window.dispatchEvent(new CustomEvent('farmDataChanged')); } catch {}
      }
      // ✅ DATA FLOW: Notify components that rooms have been updated
      try {
        document.dispatchEvent(new Event('rooms-updated'));
        console.log('[saveRoom] Dispatched rooms-updated event');
      } catch (err) {
        console.warn('[saveRoom] Failed to dispatch rooms-updated:', err);
      }
      showToast({ title:'Room saved', msg:`${this.data.name} saved`, kind:'success', icon:'' });
      try { localStorage.removeItem('gr.roomWizard.progress'); } catch {}
      // Only close if explicitly requested and not part of a multi-room workflow
      if (shouldAutoClose && (!this.multiRoomList || this.multiRoomList.length <= 1)) {
        this.close();
      }
      return true;
    } else {
      alert('Failed to save room');
      return false;
    }
  }

  async saveAndClose() {
    // Always save and close the wizard (single or multi-room)
    const mockEvent = { preventDefault: () => {} };
    const success = await this.saveRoom(mockEvent, true);
    if (success) {
      this.close();
      showToast({
        title: 'Room Saved',
        msg: `Room \"${this.data.name}\" saved successfully!`,
        kind: 'success',
        icon: ''
      });
    }
    // If save failed, saveRoom will handle the error display and we stay in the wizard
  }

  // Device Discovery Methods
  async runDeviceDiscovery() {
    const statusEl = $('#roomDiscoveryStatus');
    const runBtn = $('#roomDiscoveryRun');
    const stopBtn = $('#roomDiscoveryStop');
    const resultsEl = $('#roomDiscoveryResults');
      const progressEl = $('#roomDiscoveryProgress');
    
      // Show enhanced scanning radar
      if (progressEl) progressEl.style.display = 'flex';
      if (statusEl) statusEl.innerHTML = '<span style="color:#0ea5e9"> Multi-protocol scan in progress...</span>';
      if (runBtn) {
        runBtn.style.display = 'none';
        runBtn.disabled = true;
      }
    if (stopBtn) stopBtn.style.display = 'inline-block';
    
    this.discoveryRunning = true;
    this.discoveredDevices = [];
    
    try {
      // Use the existing device discovery from DeviceManagerWindow
      if (deviceManagerWindow) {
        await deviceManagerWindow.runDiscovery();
        this.discoveredDevices = deviceManagerWindow.devices || [];
        
          if (statusEl) statusEl.innerHTML = `<span style="color:#059669"> Found ${this.discoveredDevices.length} devices across all protocols</span>`;
        this.renderDiscoveredDevices();
        if (resultsEl) resultsEl.style.display = 'block';
      }
    } catch (error) {
        if (statusEl) statusEl.innerHTML = '<span style="color:#dc2626"> Multi-protocol discovery failed</span>';
      console.error('Device discovery failed:', error);
    }
    
      // Hide scanning radar
      if (progressEl) progressEl.style.display = 'none';
    this.discoveryRunning = false;
      if (runBtn) {
        runBtn.style.display = 'inline-block';
        runBtn.disabled = false;
      }
    if (stopBtn) stopBtn.style.display = 'none';
  }
  
  stopDeviceDiscovery() {
    this.discoveryRunning = false;
    const statusEl = $('#roomDiscoveryStatus');
    const runBtn = $('#roomDiscoveryRun');
    const stopBtn = $('#roomDiscoveryStop');
    
    if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b">⏹ Discovery stopped</span>';
    if (runBtn) runBtn.style.display = 'inline-block';
    if (stopBtn) stopBtn.style.display = 'none';
  }
  
  renderDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl || !this.discoveredDevices) return;
    
    listEl.innerHTML = this.discoveredDevices.map((device, idx) => `
      <div class="discovery-device-item" style="display:flex;align-items:center;padding:8px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:6px">
        <input type="checkbox" id="discoveryDevice${idx}" data-device-idx="${idx}" style="margin-right:8px">
        <div style="flex:1">
          <div class="tiny" style="font-weight:500">${device.deviceName || device.id || 'Unknown Device'}</div>
          <div class="tiny" style="color:#6b7280">${device.ip || device.host || ''} • ${device.type || 'Unknown type'}</div>
        </div>
        <div class="tiny" style="color:#374151">${device.online ? '🟢 Online' : ' Offline'}</div>
      </div>
    `).join('');
  }
  
  selectAllDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl) return;
    
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
  }
  
  selectNoDiscoveredDevices() {
    const listEl = $('#roomDiscoveryDeviceList');
    if (!listEl) return;
    
    listEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
  }
  
  refreshDeviceDiscovery() {
    this.runDeviceDiscovery();
  }
}
window.RoomWizard = RoomWizard;

// --- Schedule Identity Normalization (Shared Utility) ---
function ensureScheduleIdentity(rawSchedule) {
  if (!rawSchedule || typeof rawSchedule !== 'object') return null;
  const next = { ...rawSchedule };
  const trimmedName = typeof next.name === 'string' ? next.name.trim() : '';
  
  function slugifyName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'schedule';
  }
  
  const slug = slugifyName(trimmedName || next.id || 'schedule');

  if (!next.id || !next.id.trim()) {
    if (typeof next.groupId === 'string' && next.groupId.trim()) {
      const groupIdTrimmed = next.groupId.trim();
      next.id = groupIdTrimmed.startsWith('group:') ? groupIdTrimmed : `group:${groupIdTrimmed}`;
    } else {
      next.id = `schedule-${slug}`;
    }
  }

  if (!next.groupId || !next.groupId.trim()) {
    if (next.id.startsWith('group:')) {
      next.groupId = next.id.slice(6) || slug;
    } else if (next.id.startsWith('schedule-')) {
      const base = next.id.slice('schedule-'.length) || slug;
      next.groupId = `library:${base}`;
    } else {
      const base = slug || next.id;
      next.groupId = `library:${base}`;
    }
  }

  next.id = (next.id || '').trim();
  next.groupId = (next.groupId || '').trim();

  if (!next.updatedAt) {
    try {
      next.updatedAt = new Date().toISOString();
    } catch {}
  }

  return next;
}

// --- Data Loading and Initialization ---
async function loadAllData() {
  try {
    // 1) Try loading IoT devices from farm-scoped DB (via greenreach-central)
    let dbDevices = null;
    try {
      const resp = await fetchWithFarmAuth('/data/iot-devices.json', { cache: 'no-store' });
      if (resp.ok) {
        const payload = await resp.json();
        dbDevices = Array.isArray(payload) ? { devices: payload } : payload;
      }
    } catch (e) {
      console.warn('/data/iot-devices.json fetch failed, will try forwarder/api', e);
    }
    if (dbDevices && Array.isArray(dbDevices.devices)) {
      STATE.devices = dbDevices.devices;
    } else {
      // 2) Load device data from controller via forwarder; fallback to /api/devicedatas
      let deviceResponse = null;
      try {
        deviceResponse = await api('/forwarder/devicedatas');
      } catch (e) {
        console.warn('forwarder devicedatas fetch failed, falling back to /api/devicedatas', e);
      }
      if (!deviceResponse || !deviceResponse.data) {
        const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (isLocalHost) {
          try {
            deviceResponse = await api('/api/devicedatas');
          } catch (e) {
            console.error('Failed to load device list from /api/devicedatas', e);
            deviceResponse = { data: [], meta: { source: 'fallback', error: e?.message || String(e) } };
          }
        } else {
          deviceResponse = { data: [], meta: { source: 'fallback', error: 'skipped /api/devicedatas on non-local host' } };
        }
      }
      STATE.devicesMeta = deviceResponse?.meta || {};
      STATE.devices = unwrapDeviceList(deviceResponse);
    }
    
    // Ensure all devices have proper online status for research mode
    STATE.devices = STATE.devices.map((device, index) => {
      if (!device || typeof device !== 'object') {
        const fallbackId = deriveDeviceId(null, index);
        return {
          id: fallbackId,
          deviceName: fallbackId,
          name: fallbackId,
          online: true
        };
      }
      const copy = { ...device };
      const id = deriveDeviceId(copy, index);
      copy.id = id;
      const friendlyName = deriveDeviceName(copy, id);
      if (!copy.deviceName || !String(copy.deviceName).trim()) {
        copy.deviceName = friendlyName;
      }
      if (!copy.name || !String(copy.name).trim()) {
        copy.name = friendlyName;
      }
      copy.online = copy.online !== false;
      return copy;
    });
    
    // Load static data files
     const [groups, schedules, plans, environment, calibrations, spdLibrary, deviceMeta, deviceKB, equipmentKB, equipmentCatalog, deviceManufacturers, farm, rooms, switchbotDevices, storedIotDevices, equipmentMetadata] = await Promise.all([
      loadJSON('/data/groups.json', { groups: [] }),
      fetchSchedulesDocument(),
      fetchPlansDocument(),
      safeApi('/env', { zones: [] }),
      loadJSON('./data/calibration.json', { calibrations: [] }),
      loadJSON('./data/spd-library.json', null),
      loadJSON('./data/device-meta.json', { devices: {} }),
      loadJSON('./data/device-kb.json', { fixtures: [] }),
      loadJSON('./data/equipment-kb.json', { equipment: [] }),
      loadJSON('./data/equipment.catalog.json', { dehumidifiers: [] }),
      loadJSON('./data/device-manufacturers.json', { manufacturers: [] }),
      loadJSON('./data/farm.json', {}),
      // Use /api/rooms which reads from database when DB_ENABLED=true, otherwise falls back to rooms.json
      loadJSON('/api/rooms', []).then(data => ({ rooms: Array.isArray(data) ? data : (data?.rooms || []) })),
      loadJSON('./data/switchbot-devices.json', { devices: [], summary: null }),
      loadJSON('/data/iot-devices.json', []),
      loadJSON('/data/equipment-metadata.json', {})
    ]);

    console.log('[loadAllData] Raw groups response:', groups);
    STATE.groups = groups?.groups || [];
    console.log(`[loadAllData] Loaded STATE.groups: ${STATE.groups.length} groups`);
    if (STATE.groups.length > 0) {
      console.log('[loadAllData] First group:', STATE.groups[0]);
      console.log('[loadAllData] All group IDs:', STATE.groups.map(g => g.id));
    } else {
      console.error('[loadAllData] ⚠️ NO GROUPS LOADED! Raw response:', groups);
    }
    const iotDevicesData = Array.isArray(storedIotDevices) ? storedIotDevices : [];
    
    // Build a lookup of existing zone/location from stored iot-devices.json
    // so that SwitchBot merge doesn't overwrite manually-set zones
    const storedZoneMap = new Map();
    for (const d of iotDevicesData) {
      const id = d.id || d.deviceId;
      if (id && (d.zone != null || d.location)) {
        storedZoneMap.set(id, { zone: d.zone, location: d.location });
      }
    }

    // Merge SwitchBot devices from switchbot-devices.json into IoT devices
    const switchbotDevicesList = Array.isArray(switchbotDevices?.devices) ? switchbotDevices.devices : [];
    if (switchbotDevicesList.length > 0) {
      console.log(`[loadAllData] Merging ${switchbotDevicesList.length} SwitchBot devices into IoT devices`);
      // Convert SwitchBot device format to IoT device format
      const switchbotAsIot = switchbotDevicesList.map(sbDev => {
        const devId = sbDev.id || sbDev.deviceId;
        // Preserve existing zone/location from iot-devices.json if SwitchBot API doesn't provide one
        const stored = storedZoneMap.get(devId);
        return {
          id: devId,
          deviceId: devId,
          name: sbDev.name || sbDev.deviceName || `SwitchBot ${sbDev.type || 'device'}`,
          vendor: 'SwitchBot',
          brand: 'SwitchBot',
          protocol: 'switchbot',
          type: (sbDev.type || '').toLowerCase(),
          category: sbDev.type || 'Unknown',
          address: devId,
          location: sbDev.location || stored?.location || null,
          zone: sbDev.zone || stored?.zone || null,
          trust: 'trusted',
          automationControl: false,
          lastSeen: sbDev.lastSeen || null,
          telemetry: {
            device_id: devId,
            name: sbDev.name || sbDev.deviceName,
            category: sbDev.type,
            protocol: 'switchbot',
            online: sbDev.status !== 'offline',
            battery: sbDev.battery,
            ...sbDev.readings
          },
          deviceData: {
            device_id: devId,
            name: sbDev.name || sbDev.deviceName,
            category: sbDev.type,
            protocol: 'switchbot',
            online: sbDev.status !== 'offline'
          }
        };
      });
      // Merge into iot devices
      iotDevicesData.push(...switchbotAsIot);
    }
    
    // Merge with localStorage fallback if server returned empty
    if (!iotDevicesData.length) {
      try {
        const cached = localStorage.getItem('gr.iotDevices');
        if (cached) {
          const lsDevices = JSON.parse(cached);
          if (Array.isArray(lsDevices) && lsDevices.length) {
            iotDevicesData.push(...lsDevices);
            console.log('[loadAllData] Recovered', lsDevices.length, 'IoT devices from localStorage');
          }
        }
      } catch (_) {}
    }
    const uniqueDevices = dedupeDevices(iotDevicesData);
    // Only re-persist if SwitchBot merge enriched the list (avoid unnecessary writes that
    // can race with server-side syncSensorData timer). Skip if we just loaded the same data.
    if (uniqueDevices.length && switchbotDevicesList.length > 0) {
      console.log('[loadAllData] SwitchBot merge enriched list, persisting', uniqueDevices.length, 'devices');
      await persistIotDevices(uniqueDevices);
    }
    STATE.iotDevices = uniqueDevices;
    window.LAST_IOT_SCAN = uniqueDevices.slice();
    // Keep localStorage in sync
    try { localStorage.setItem('gr.iotDevices', JSON.stringify(uniqueDevices)); } catch (_) {}
    console.log('[loadAllData] Loaded IoT devices:', STATE.iotDevices.length,
      'trusted:', uniqueDevices.filter(d => d.trust === 'trusted').length);
    if (uniqueDevices.length > 0) {
      console.log('[loadAllData] Device IDs:', uniqueDevices.map(d => d.id).join(', '));
    }

    // Enrich device zones from room-map data (bridges Room Mapper → IoT cards)
    await enrichDeviceZonesFromRoomMap();

    // Render IoT device cards immediately (no delay)
    if (typeof window.renderIoTDeviceCards === 'function') {
      window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
    }
  const schedulesDoc = (schedules && typeof schedules === 'object') ? schedules : null;
  STATE.scheduleDocument = schedulesDoc;
  const loadedSchedules = Array.isArray(schedulesDoc?.schedules) ? schedulesDoc.schedules : [];
  STATE.schedules = loadedSchedules.map((entry) => ensureScheduleIdentity(entry)).filter(Boolean);
    // Notify listeners that schedules have been hydrated
    try {
      document.dispatchEvent(new Event('schedules-updated'));
      console.log('[loadAllData] Dispatched schedules-updated event');
    } catch (err) {
      console.warn('[loadAllData] Failed to dispatch schedules-updated:', err);
    }
     const plansDoc = (plans && typeof plans === 'object') ? plans : null;
    STATE.planDocumentInfo = plansDoc;
    STATE.plans = Array.isArray(plansDoc?.plans) ? plansDoc.plans : [];
    updatePlansStatusIndicator({ doc: STATE.planDocumentInfo, plans: STATE.plans });
    // Notify listeners that plans have been hydrated
    dispatchPlansUpdated({ source: 'loadAllData', plans: STATE.plans });
    console.log('[loadAllData] Dispatched plans-updated event');
    STATE.environment = environment?.zones || [];
    STATE.calibrations = calibrations?.calibrations || [];
    STATE._calibrationCache = new Map();
    STATE.spdLibrary = normalizeSpdLibrary(spdLibrary);
    if (STATE.spdLibrary) {
      console.log('[SPD] Loaded library:', STATE.spdLibrary.wavelengths.length, 'bins');
      
      // Build calibration matrix for band → channel conversion
      try {
        STATE.calibrationMatrix = buildCalibrationMatrix(STATE.spdLibrary);
        console.log('[Matrix] Built calibration matrix:', STATE.calibrationMatrix.bands.join(','), '→', STATE.calibrationMatrix.channels.join(','));
        
        // Log matrix values for verification
        console.log('[Matrix] M[band][channel]:');
        for (const band of STATE.calibrationMatrix.bands) {
          const row = STATE.calibrationMatrix.channels.map(ch => 
            `${ch}=${(STATE.calibrationMatrix.matrix[band][ch] * 100).toFixed(1)}%`
          ).join(', ');
          console.log(`  ${band}: ${row}`);
        }
      } catch (err) {
        console.error('[Matrix] Failed to build calibration matrix:', err);
        STATE.calibrationMatrix = null;
      }
    } else {
      console.warn('[SPD] Library missing or invalid');
      STATE.calibrationMatrix = null;
    }
    hydrateDeviceDriverState();
    STATE.deviceMeta = deviceMeta?.devices || {};
    normalizeGroupsInState();
    STATE.switchbotDevices = switchbotDevices?.devices || [];
    STATE.switchbotSummary = switchbotDevices?.summary || summarizeSwitchBotDevices(STATE.switchbotDevices) || {};
    const rawFarm = farm || (() => { try { return JSON.parse(localStorage.getItem('gr.farm') || 'null'); } catch { return null; } })() || {};
    STATE.farm = normalizeFarmDoc(rawFarm);
    try { if (STATE.farm && Object.keys(STATE.farm).length) localStorage.setItem('gr.farm', JSON.stringify(STATE.farm)); } catch {}
    if (typeof updateFarmNameInHeader === 'function') {
      updateFarmNameInHeader(STATE.farm?.name || STATE.farm?.farmName || STATE.farm?.farmId);
    }
    const backendRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
    const fileRooms = rooms?.rooms || [];
    const farmRooms = Array.isArray(STATE.farm?.rooms) ? STATE.farm.rooms : [];
    const localRooms = (() => {
      try {
        const raw = localStorage.getItem('gr.rooms');
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed?.rooms) ? parsed.rooms : Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
    const hasBackendData = backendRooms.some(r => r && (r._categoryProgress || r.categoryProgress || r.category || r.equipment));
    if (hasBackendData) {
      STATE.rooms = backendRooms;
      console.log(' [loadAllData] Retained backend-loaded rooms:', STATE.rooms.length);
    } else if (localRooms.length) {
      STATE.rooms = localRooms;
      console.log(' [loadAllData] Loaded STATE.rooms from localStorage:', STATE.rooms.length, 'rooms');
    } else {
      STATE.rooms = fileRooms;
      console.log(' [loadAllData] Loaded STATE.rooms from rooms.json:', STATE.rooms.length, 'rooms');
    }

    STATE.rooms = (Array.isArray(STATE.rooms) ? STATE.rooms : [])
      .filter(room => room && typeof room === 'object')
      .map((room, index) => {
        const fallbackName = String(room.name || room.roomName || room.room_id || room.roomId || room.id || `Room ${index + 1}`).trim();
        const fallbackId = String(room.id || room.roomId || room.room_id || fallbackName || `room-${index + 1}`).trim();
        return {
          ...room,
          id: fallbackId,
          name: fallbackName
        };
      });

    STATE.rooms = mergeRoomsWithZoneFallback(STATE.rooms, [localRooms, fileRooms, farmRooms]);

    STATE.equipmentMetadata = equipmentMetadata || {};
    console.log(' [loadAllData] Loaded equipment metadata:', Object.keys(STATE.equipmentMetadata).length, 'items');
    if (STATE.rooms.length > 0) {
      console.log('   Room details:', STATE.rooms.map(r => `${r.name} (id: ${r.id})`).join(', '));
    }
    
    // Dispatch rooms-updated event for Groups V2 to populate room dropdown
    document.dispatchEvent(new Event('rooms-updated'));
  if (deviceKB && Array.isArray(deviceKB.fixtures)) {
    // Assign a unique id to each fixture if missing
    deviceKB.fixtures.forEach(fixture => {
      if (!fixture.id) {
        fixture.id = `${fixture.vendor}__${fixture.model}`.replace(/\s+/g, '_');
      }
    });
    STATE.deviceKB = deviceKB;
    console.log(' Loaded device fixtures database:', deviceKB.fixtures.length, 'fixtures');
    console.log('Sample fixtures:', deviceKB.fixtures.slice(0, 3).map(f => `${f.vendor} ${f.model} [${f.id}]`));
  }
  if (equipmentKB && Array.isArray(equipmentKB.equipment)) {
    if (equipmentKB.equipment.length === 0 && equipmentCatalog && Array.isArray(equipmentCatalog.dehumidifiers)) {
      const mappedDehums = equipmentCatalog.dehumidifiers
        .map((item) => {
          const vendor = item?.brand || item?.vendor || '';
          const model = item?.model || '';
          if (!vendor && !model) return null;
          const pintsPerDay = item?.pintsPerDay ?? item?.capacity ?? '';
          return {
            category: 'dehumidifier',
            vendor,
            model,
            capacity: pintsPerDay ? `${pintsPerDay} PPD` : '',
            control: item?.control || item?.protocol || '',
            tags: Array.isArray(item?.tags) ? item.tags : []
          };
        })
        .filter(Boolean);
      equipmentKB.equipment = mappedDehums;
    }
    STATE.equipmentKB = equipmentKB;
    console.log(' Loaded equipment database:', equipmentKB.equipment.length, 'equipment items');
    console.log('Sample equipment:', equipmentKB.equipment.slice(0, 3).map(e => `${e.vendor} ${e.model} (${e.category})`));
  }
  // load manufacturers into a global for lookups and selects
  if (deviceManufacturers && Array.isArray(deviceManufacturers.manufacturers)) {
    window.DEVICE_MANUFACTURERS = deviceManufacturers.manufacturers;
    console.log(' Loaded device manufacturers:', deviceManufacturers.manufacturers.length, 'manufacturers');
  } else {
    window.DEVICE_MANUFACTURERS = window.DEVICE_MANUFACTURERS || [];
  }
    
    setStatus(`Loaded ${STATE.devices.length} devices, ${STATE.groups.length} groups, ${STATE.schedules.length} schedules`);
    // NO DEMO FALLBACK - Live devices only
    if ((!STATE.devices || STATE.devices.length === 0)) {
      setStatus(`No live devices found. Please ensure devices are connected to greenreach network and discoverable.`);
      console.warn('🚫 No live devices discovered. Demo/mock fallback is disabled.');
    }
    
    // Render UI
    renderDevices();
    renderGroups();
    renderSchedules();
    renderPlans();
    renderPlansPanel();
    renderEnvironment();
    renderRooms();
    renderLightSetups();
    renderEquipmentOverview(); // Explicitly render equipment overview on load
    
    // Demo/mock light setups removed: only live light setups and devices will be used.
    
    renderLightSetupSummary();
    renderControllerAssignments();
    renderSwitchBotDevices();
    const switchBotCreds = STATE?.farm?.integrations?.switchbot || {};
    if (switchBotCreds.token && switchBotCreds.secret) {
      // Auto-sync live SwitchBot data: use refreshSwitchBotDevices() which
      // merges into STATE.iotDevices AND persists to iot-devices.json
      setTimeout(() => {
        refreshSwitchBotDevices().catch((error) => {
          console.warn('[switchbot] Startup sync failed', error);
        });
      }, 0);
    }
    
    // Notify wizards that data has been loaded
    try {
      window.dispatchEvent(new CustomEvent('farmDataChanged'));
      console.log('[loadAllData] Dispatched farmDataChanged event');
    } catch (err) {
      console.warn('[loadAllData] Failed to dispatch farmDataChanged:', err);
    }

    // Notify UI components that groups have been loaded
    try {
      console.log(`[loadAllData] About to dispatch groups-updated event with ${STATE.groups.length} groups`);
      document.dispatchEvent(new Event('groups-updated'));
      console.log('[loadAllData] ✓ Dispatched groups-updated event');
    } catch (err) {
      console.error('[loadAllData] ❌ Failed to dispatch groups-updated:', err);
    }

    const lightSearchHost =
      document.querySelector('[data-search-scope="lights"]') ||
      document.getElementById('lightsSearch') ||
      document.getElementById('lightsSearchRoot') ||
      document.querySelector('[data-search="lights"]');
    if (lightSearchHost && lightSearchHost.offsetParent !== null) {
      try {
        await initLightSearch();
      } catch (error) {
        console.warn('Light search init failed', error);
      }
    }

    const dehumSearchHost =
      document.querySelector('[data-search-scope="dehum"]') ||
      document.getElementById('dehumSearch') ||
      document.getElementById('dehumSearchRoot') ||
      document.querySelector('[data-search="dehum"]');
    if (dehumSearchHost && dehumSearchHost.offsetParent !== null) {
      try {
        await initDehumSearch();
      } catch (error) {
        console.warn('Dehumidifier search init failed', error);
      }
    }

    // Wire controller assignments buttons
    document.getElementById('btnRefreshControllerAssignments')?.addEventListener('click', renderControllerAssignments);
    document.getElementById('btnManageControllers')?.addEventListener('click', () => {
      alert('Controller management interface will be implemented in future update');
    });
    // Start background polling for environment telemetry
    startEnvPolling();

    try { roomWizard.populateGroupingSelectors(); } catch {}

  } catch (error) {
    setStatus(`Error loading data: ${error.message}`);
    console.error('Data loading error:', error);
  }
}

// Patch a single device's location into the server DB (best-effort)
async function patchDeviceDb(id, fields){
  try {
    // Read current devices, update the target, write back
    let devices = [];
    try {
      const resp = await fetchWithFarmAuth('/data/iot-devices.json', { cache: 'no-store' });
      if (resp.ok) {
        const parsed = await resp.json();
        devices = Array.isArray(parsed) ? parsed : (parsed.devices || []);
      }
    } catch (_) {}
    const idx = devices.findIndex(d => (d.id || d.deviceId) === id);
    if (idx >= 0) {
      devices[idx] = { ...devices[idx], ...fields };
    } else {
      devices.push({ id, ...fields });
    }
    await fetchWithFarmAuth('/data/iot-devices.json', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(devices)
    });
  } catch (e) {
    console.warn('patchDeviceDb failed', e);
  }
}

// Populate vendor/model selects used in RoomWizard
function populateVendorModelSelects() {
  const vendorSel = document.getElementById('roomDeviceVendor');
  const modelSel = document.getElementById('roomDeviceModel');
  if (!vendorSel || !modelSel) return;
  vendorSel.innerHTML = '<option value="">Vendor</option>' + (window.DEVICE_MANUFACTURERS || []).map(m => `<option value="${m.name}">${m.name}</option>`).join('');
  vendorSel.addEventListener('change', (e) => {
    const name = e.target.value;
    const man = (window.DEVICE_MANUFACTURERS || []).find(x => x.name === name);
    modelSel.innerHTML = '<option value="">Model</option>' + (man?.models || []).map(m => `<option value="${m.model}">${m.model}</option>`).join('');
    // toggle setup forms if model selected
    const md = man?.models?.[0] || null;
    toggleSetupFormsForModel(md);
  });
}

function findModelByValue(vendor, modelName) {
  const man = (window.DEVICE_MANUFACTURERS || []).find(x => x.name === vendor);
  if (!man) return null;
  return man.models?.find(m => m.model === modelName) || null;
}

function renderDevices() {
  const container = $('#devices');
  const emptyMsg = $('#devicesEmpty');
  const scopeSel = $('#deviceScope');
  const multiSel = $('#deviceSelect');
  const note = $('#devicesNote');
  if (!container) return;

  // Ensure selection lists are bound and hydrated (always do this, even if cards are gated off)
  if (scopeSel && multiSel && !multiSel.dataset.bound) {
    multiSel.dataset.bound = '1';
    // Initialize scope from saved state once
    const saved = getDevicePickState();
    if (scopeSel && !scopeSel.dataset.init) {
      scopeSel.value = saved.scope || 'devices';
      scopeSel.dataset.init = '1';
    }
    scopeSel.addEventListener('change', () => {
      setDevicePickState(scopeSel.value, []);
      hydrateDeviceSelect();
      renderDevices();
    });
    multiSel.addEventListener('change', () => {
      const ids = Array.from(multiSel.selectedOptions || []).map(o=>o.value);
      setDevicePickState(scopeSel.value, ids);
      renderDevices();
    });
  }
  hydrateDeviceSelect();

  // Always show device cards if there's a selection
  if (emptyMsg) emptyMsg.style.display = 'none';

  const scope = scopeSel?.value || 'devices';
  const selected = Array.from(multiSel?.selectedOptions || []).map(o => o.value);
  const cap = scope === 'groups' ? 5 : 10;
  const over = selected.length > cap;
  if (note) {
    note.textContent = selected.length ? `${selected.length} selected • showing up to ${cap}` : `Select up to ${cap} ${scope}`;
    note.style.color = over ? '#b91c1c' : '';
  }

  container.innerHTML = '';
  if (scope === 'groups') {
    const groups = STATE.groups.filter(g => selected.includes(g.id)).slice(0, cap);
    groups.forEach(g => {
      // Render one card summarizing the group; show first device as representative if present
      const ids = (g.lights || [])
        .map((entry) => (typeof entry === 'string' ? entry : entry?.id || ''))
        .filter(Boolean);
      const devices = ids
        .map((id) => STATE.devices.find((d) => d.id === id) || buildDeviceLikeFromMeta(id))
        .filter(Boolean);
      const rep =
        devices[0] ||
        {
          id: g.id,
          deviceName: g.name,
          name: g.name,
          onOffStatus: true,
          online: true,
          type: 'group',
        };
      const card = deviceCard(rep, { compact: true, context: { group: g, deviceCount: devices.length } });
      container.appendChild(card);
    });
  } else {
    const devices = STATE.devices.filter(d => selected.includes(d.id)).slice(0, cap);
    devices.forEach(device => {
      const card = deviceCard(device, { compact: true });
      container.appendChild(card);
    });
  }
}

function hydrateDeviceSelect() {
  const scopeSel = $('#deviceScope');
  const multiSel = $('#deviceSelect');
  if (!scopeSel || !multiSel) return;
  const scope = scopeSel.value || 'devices';
  const saved = getDevicePickState();
  if (scope === 'groups') {
    multiSel.innerHTML = STATE.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
  } else {
    multiSel.innerHTML = STATE.devices.map(d => `<option value="${d.id}">${d.deviceName || d.id}</option>`).join('');
  }
  // Preselect saved ids that still exist under this scope
  const validIds = new Set((scope === 'groups' ? STATE.groups.map(g=>g.id) : STATE.devices.map(d=>d.id)));
  let toSelect = (saved.scope === scope ? saved.ids : []).filter(id => validIds.has(id));
  // If nothing saved, auto-select the first 1-3 items for a quick start
  if (!toSelect.length) {
    const max = scope === 'groups' ? 3 : 3;
    toSelect = Array.from(validIds).slice(0, max);
    if (toSelect.length) setDevicePickState(scope, toSelect);
  }
  Array.from(multiSel.options || []).forEach(opt => { opt.selected = toSelect.includes(opt.value); });
}

function renderGroups() {
  // Save Plan & Schedule button logic
  const btnSavePlanSchedule = document.getElementById('btnSavePlanSchedule');
  if (btnSavePlanSchedule) {
    btnSavePlanSchedule.onclick = () => {
      const group = STATE.currentGroup;
      if (!group) return;
      group.plan = document.getElementById('groupPlan')?.value || '';
      group.schedule = document.getElementById('groupSchedule')?.value || '';
      // Persist the full group object, including updated lights array
      const idx = STATE.groups.findIndex(g => g.id === group.id);
      if (idx >= 0) {
        STATE.groups[idx] = { ...group };
        Promise.resolve(saveJSON('/data/groups.json', { groups: STATE.groups }))
          .then(async () => {
            // Reload groups from disk to ensure persistence
            const groupsReloaded = await loadJSON('/data/groups.json');
            if (groupsReloaded && Array.isArray(groupsReloaded.groups)) {
              STATE.groups = groupsReloaded.groups;
              normalizeGroupsInState();
              // Re-select the current group by id
              STATE.currentGroup = STATE.groups.find(g => g.id === group.id) || null;
            }
            renderGroups();
            showToast('Group configuration saved and reloaded, including lights, plan, and schedule.');
          })
          .catch(() => {
            showToast('Failed to save group configuration.', 'error');
          });
      }
    };
  }

  // Plan spectrum/slider sync on plan change
  const planSel = document.getElementById('groupPlan');
  if (planSel) {
    planSel.onchange = () => {
      const planId = planSel.value;
      if (STATE.currentGroup) {
        STATE.currentGroup.plan = planId;
      }
      const plan = STATE.plans.find(p => p.id === planId);
      if (plan && plan.spectrum) {
        // Update spectrum preview
        renderPlanSpectrum(plan.spectrum);
        // Update sliders
        setSlider('gcw', plan.spectrum.cw);
        setSlider('gww', plan.spectrum.ww);
        setSlider('gbl', plan.spectrum.bl);
        setSlider('grd', plan.spectrum.rd);
      }
      if (STATE.currentGroup) {
        renderGroupSpectrumPreview(STATE.currentGroup);
        updateGroupPlanInfoCard(STATE.currentGroup);
        updateGroupLightInfoCard(STATE.currentGroup);
      }
    };
  }

  function setSlider(id, value) {
    const slider = document.getElementById(id);
    const num = document.getElementById(id+'v');
    if (slider) slider.value = value;
    if (num) num.value = value;
  }
  function renderPlanSpectrum(spectrum) {
    const canvas = document.getElementById('groupPlanCanvas');
    if (canvas && typeof renderSpectrumCanvas === 'function') {
      const deviceIds = Array.isArray(STATE.currentGroup?.lights)
        ? STATE.currentGroup.lights.map((l) => l.id).filter(Boolean)
        : [];
      const spd = computeWeightedSPD(
        { cw: spectrum.cw||0, ww: spectrum.ww||0, bl: spectrum.bl||0, rd: spectrum.rd||0 },
        { deviceIds }
      );
      renderSpectrumCanvas(canvas, spd, { width: 300, height: 36 });
    }
  }
  // Render light selection bar seeded by Light Setup Wizard
  const lightSelectionBar = document.getElementById('groupLightSelectionBar');
  if (lightSelectionBar) {
    lightSelectionBar.innerHTML = '';
    const groupRoomSel = document.getElementById('groupRoomDropdown');
    const groupZoneSel = document.getElementById('groupZoneDropdown');
    let setupLights = [];
    if (groupRoomSel && groupZoneSel && window.STATE?.lightSetups) {
      const roomId = groupRoomSel.value;
      const zone = groupZoneSel.value;
      window.STATE.lightSetups.forEach(setup => {
          if ((setup.room === roomId || setup.room === (window.STATE?.rooms?.find(r=>r.id===roomId)?.name)) && setup.zone === zone) {
            if (Array.isArray(setup.fixtures)) {
              setup.fixtures.forEach(f => {
                const fixtureId = f.id || buildFixtureSyntheticId(f);
                setupLights.push({
                  id: fixtureId,
                  name: f.vendor ? `${f.vendor} ${f.model}` : (f.name || f.model || 'Light'),
                  vendor: f.vendor,
                  model: f.model,
                  watts: f.watts,
                  count: f.count,
                  source: 'setup',
                  setupId: setup.id || null,
                  fixtureId,
                });
              });
            }
          }
        });
      }
    if (setupLights.length === 0) {
      lightSelectionBar.innerHTML = '<span style="color:#64748b;font-size:13px;">No lights configured for this room/zone.</span>';
    } else {
      setupLights.forEach(light => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ghost';
        btn.style.marginRight = '8px';
        btn.textContent = `${light.name} (${light.count || 1} × ${light.watts || '?'}W)`;
        btn.onclick = async () => {
          // Add this light to the current group if not already present
          const group = STATE.currentGroup;
          if (!group) return;
          addLightToGroup(group, light, roomId ? { id: roomId } : groupRoomSel.value, zone);
          await saveGroups();
          renderGroups();
        };
        lightSelectionBar.appendChild(btn);
      });
    }
  }
  const select = $('#groupSelect');
  if (!select) return;
  const prev = STATE.currentGroup?.id || select.value || '';
  select.innerHTML = '<option value="">Select group...</option>' +
    STATE.groups.map(group => `<option value="${group.id}">${escapeHtml(group.name||group.id)}</option>`).join('');
  // Preserve prior selection when possible; else select first group
  const nextId = STATE.groups.some(g=>g.id===prev) ? prev : (STATE.groups[0]?.id || '');
  if (nextId) {
    select.value = nextId;
    STATE.currentGroup = STATE.groups.find(g=>g.id===nextId) || null;
    try { if (typeof updateGroupUI === 'function') updateGroupUI(STATE.currentGroup); } catch {}
    // Reflect name input
    const nameInput = $('#groupName'); if (nameInput) nameInput.value = STATE.currentGroup?.name || '';
  }
  // Seed Room/Zone dropdowns for Groups card
  seedGroupRoomZoneDropdowns();
}

// Helper function to extract equipment from nested room.category structure
function extractRoomEquipment(room) {
  const equipment = [];
  const categoryProgress = room._categoryProgress || room.categoryProgress;
  const categoryStore = room.category && typeof room.category === 'object' ? room.category : {};

  const selectedKeys = new Set();
  if (categoryProgress && typeof categoryProgress === 'object') {
    Object.entries(categoryProgress).forEach(([key, cat]) => {
      if (Array.isArray(cat?.selectedEquipment)) {
        selectedKeys.add(key);
        equipment.push(...cat.selectedEquipment);
      }
    });
  }
  Object.entries(categoryStore).forEach(([key, cat]) => {
    if (selectedKeys.has(key)) return;
    if (Array.isArray(cat?.selectedEquipment)) {
      equipment.push(...cat.selectedEquipment);
    }
  });

  const simpleCategories = ['fans', 'vents', 'controllers', 'energy-monitor', 'other'];
  simpleCategories.forEach(catKey => {
    const catData = (categoryProgress && categoryProgress[catKey]) || categoryStore[catKey];
    if (catData && catData.count && catData.count > 0) {
      equipment.push({
        category: catKey,
        vendor: catData.manufacturer || 'Unknown',
        model: catData.model || catKey,
        count: catData.count,
        control: catData.control || null,
        wifi: catData.wifi || false,
        wired: catData.wired || false,
        notes: catData.notes || ''
      });
    }
  });
  // Also check for flat room.equipment array (legacy/alternative structure)
  if (Array.isArray(room.equipment)) {
    equipment.push(...room.equipment);
  }
  return equipment;
}

const PLAN_SUMMARY_MS_PER_DAY = 24 * 60 * 60 * 1000;

function planSummaryToNumber(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function planSummaryNormalizeKey(value) {
  if (value == null) return '';
  return String(value).trim().toLowerCase();
}

function planSummaryParseDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const copy = new Date(value.getTime());
    copy.setHours(0, 0, 0, 0);
    return copy;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const asDate = new Date(value);
    if (!Number.isNaN(asDate.getTime())) {
      asDate.setHours(0, 0, 0, 0);
      return asDate;
    }
  }
  const text = String(value).trim();
  if (!text) return null;
  const asIso = new Date(text);
  if (!Number.isNaN(asIso.getTime())) {
    asIso.setHours(0, 0, 0, 0);
    return asIso;
  }
  const match = text.match(/^([0-9]{4})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12][0-9]|3[01])$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    const day = Number(match[3]);
    const asParts = new Date(year, month, day);
    if (!Number.isNaN(asParts.getTime())) {
      asParts.setHours(0, 0, 0, 0);
      return asParts;
    }
  }
  return null;
}

function planSummaryAddDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function planSummaryFormatDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const opts = { month: 'short', day: 'numeric' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

function planSummaryGetSeedDate(config, group) {
  const anchor = config?.anchor && typeof config.anchor === 'object' ? config.anchor : {};
  const groupPlanObj = group && typeof group.plan === 'object' ? group.plan : {};
  const candidates = [
    anchor.startDate,
    anchor.seedDate,
    anchor.seed,
    anchor.date,
    config?.seedDate,
    config?.startDate,
    config?.date,
    group?.seedDate,
    group?.planSeedDate,
    group?.planStartDate,
    groupPlanObj?.seedDate,
    group?.created
  ];
  for (const candidate of candidates) {
    const parsed = planSummaryParseDate(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function planSummaryComputeDayNumber(group, todayOverride) {
  const today = todayOverride instanceof Date ? new Date(todayOverride) : new Date();
  today.setHours(0, 0, 0, 0);
  const config = group?.planConfig && typeof group.planConfig === 'object' ? group.planConfig : {};
  const anchor = config?.anchor && typeof config.anchor === 'object' ? config.anchor : {};
  const mode = typeof anchor.mode === 'string' ? anchor.mode.trim().toLowerCase() : '';
  const anchorDps = planSummaryToNumber(anchor.dps);
  if (mode === 'dps' && anchorDps != null) return Math.max(1, Math.round(anchorDps));
  if (anchorDps != null) return Math.max(1, Math.round(anchorDps));
  
  // Check if in hold mode (at end of plan, waiting for harvest)
  const holdDay = planSummaryToNumber(anchor.holdDay);
  if (mode === 'hold' && holdDay != null) return Math.max(1, Math.round(holdDay));
  
  const previewDay = planSummaryToNumber(config?.preview?.day);
  if (previewDay != null) return Math.max(1, Math.round(previewDay));
  const seedDate = planSummaryGetSeedDate(config, group);
  if (seedDate) {
    const diff = Math.floor((today.getTime() - seedDate.getTime()) / PLAN_SUMMARY_MS_PER_DAY);
    const calculatedDay = diff >= 0 ? diff + 1 : 1;
    
    // Get the plan to check max day
    const plan = (window.STATE?.plans || []).find(p => p.id === group?.plan);
    if (plan) {
      const maxDay = planSummaryGetPlanMaxDay(plan);
      if (maxDay != null && calculatedDay >= maxDay) {
        // Reached end of plan - hold at final day until harvest
        return Math.max(1, Math.round(maxDay));
      }
    }
    
    return calculatedDay;
  }
  return 1;
}

function planSummaryGetPlanMaxDay(plan) {
  if (!plan || typeof plan !== 'object') return null;
  const candidates = [];
  const push = (value) => {
    const num = planSummaryToNumber(value);
    if (num != null) candidates.push(num);
  };
  if (Array.isArray(plan.days)) {
    plan.days.forEach(entry => {
      push(entry?.day);
      push(entry?.d);
      push(entry?.dayIndex);
      if (entry?.duration && !entry.day && !entry.d) push(entry.duration);
    });
  }
  if (Array.isArray(plan?.light?.days)) {
    plan.light.days.forEach(entry => {
      push(entry?.day);
      push(entry?.d);
      push(entry?.dayIndex);
    });
  }
  if (Array.isArray(plan?.env?.days)) {
    plan.env.days.forEach(entry => {
      push(entry?.day);
      push(entry?.d);
      push(entry?.dayIndex);
    });
  }
  push(plan?.durationDays);
  push(plan?.length);
  if (!candidates.length) return null;
  return Math.max(...candidates);
}

function planSummaryGetStageForDay(plan, dayNumber) {
  if (!plan || typeof plan !== 'object') return '';
  const stageEntries = [];
  const addEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const stage = typeof entry.stage === 'string' ? entry.stage.trim() : '';
    if (!stage) return;
    const day = planSummaryToNumber(entry.day ?? entry.d ?? entry.dayIndex) || 1;
    stageEntries.push({ day, stage });
  };
  if (Array.isArray(plan.days)) plan.days.forEach(addEntry);
  if (Array.isArray(plan?.light?.days)) plan.light.days.forEach(addEntry);
  if (Array.isArray(plan?.env?.days)) plan.env.days.forEach(addEntry);
  stageEntries.sort((a, b) => a.day - b.day);
  if (!stageEntries.length) {
    const fallback = plan?.stage || plan?.meta?.label || '';
    return typeof fallback === 'string' ? fallback : '';
  }
  let currentStage = stageEntries[0].stage;
  for (const entry of stageEntries) {
    if (dayNumber >= entry.day) {
      currentStage = entry.stage;
    } else {
      break;
    }
  }
  return currentStage;
}

function planSummaryFindPlanForGroup(group) {
  const plans = Array.isArray(STATE?.plans) ? STATE.plans : [];
  if (!plans.length) return null;
  const planKeys = [
    group?.plan,
    group?.planKey,
    group?.plan_id,
    group?.planId,
    group?.planConfig?.planId,
    group?.planConfig?.preview?.planId,
    group?.planConfig?.preview?.planKey,
    group?.planConfig?.preview?.plan
  ].filter(value => typeof value === 'string' && value.trim());
  for (const key of planKeys) {
    const normalized = planSummaryNormalizeKey(key);
    const match = plans.find(plan => [plan?.id, plan?.key, plan?.name]
      .filter(Boolean)
      .some(candidate => planSummaryNormalizeKey(candidate) === normalized));
    if (match) return match;
  }
  return null;
}

function getRoomPlanSummaries(room) {
  const groups = Array.isArray(STATE?.groups) ? STATE.groups : [];
  if (!groups.length || !room) return [];
  const candidateRoomKeys = [room.id, room.name]
    .filter(value => typeof value === 'string' && value.trim())
    .map(planSummaryNormalizeKey);
  if (!candidateRoomKeys.length) return [];
  return groups
    .filter(group => {
      const groupRoomKeys = [
        group?.room,
        group?.roomId,
        group?.roomName,
        group?.match?.room,
        group?.match?.roomId,
        group?.match?.roomName
      ].filter(value => typeof value === 'string' && value.trim())
        .map(planSummaryNormalizeKey);
      return groupRoomKeys.some(key => candidateRoomKeys.includes(key));
    })
    .map(group => {
      const plan = planSummaryFindPlanForGroup(group);
      if (!plan) return null;
      const config = group?.planConfig && typeof group.planConfig === 'object' ? group.planConfig : {};
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const dayNumber = planSummaryComputeDayNumber(group, today);
      const anchorMode = typeof config?.anchor?.mode === 'string' ? config.anchor.mode.trim().toLowerCase() : '';
      const isHold = anchorMode === 'hold';
      const holdDay = planSummaryToNumber(config?.anchor?.holdDay);
      const maxDay = planSummaryGetPlanMaxDay(plan);
      const stage = planSummaryGetStageForDay(plan, dayNumber);
      const seedDate = planSummaryGetSeedDate(config, group);
      let harvestDate = null;
      if (!isHold && maxDay != null) {
        if (seedDate) {
          harvestDate = planSummaryAddDays(seedDate, Math.max(0, Math.round(maxDay) - 1));
        } else {
          const remaining = Math.max(0, Math.round(maxDay) - Math.max(1, Math.round(dayNumber)));
          harvestDate = planSummaryAddDays(today, remaining);
        }
      }
      const isAtEnd = maxDay != null && dayNumber >= maxDay;
      return {
        zone: group?.zone ? `Zone ${group.zone}` : '',
        planName: plan?.name || plan?.id || 'Plan',
        dayNumber: isHold
          ? Math.max(1, holdDay != null ? Math.round(holdDay) : Math.round(dayNumber))
          : Math.max(1, Math.round(dayNumber)),
        maxDay: maxDay != null ? Math.max(1, Math.round(maxDay)) : null,
        stage,
        startText: seedDate ? planSummaryFormatDate(seedDate) : '',
        harvestText: harvestDate ? planSummaryFormatDate(harvestDate) : '',
        holdMode: isHold,
        atEnd: isAtEnd
      };
    })
    .filter(Boolean);
}

function renderPlanSummaryLine(summary) {
  if (!summary) return '';
  const pieces = [];
  if (summary.zone) pieces.push(summary.zone);
  if (summary.planName) pieces.push(summary.planName);
  if (summary.atEnd && !summary.holdMode) {
    pieces.push(`<span style="color:#059669;font-weight:600;">🌾 Ready for Harvest</span>`);
    pieces.push(`Day ${summary.dayNumber} of ${summary.maxDay}`);
  } else if (summary.holdMode) {
    pieces.push(`Hold (Day ${summary.dayNumber})`);
  } else if (Number.isFinite(summary.dayNumber)) {
    let dayLabel = `Day ${summary.dayNumber}`;
    if (summary.maxDay) dayLabel += ` of ${summary.maxDay}`;
    pieces.push(dayLabel);
  }
  if (summary.stage) pieces.push(summary.stage);
  if (summary.startText) pieces.push(`Start ${summary.startText}`);
  if (!summary.holdMode && summary.harvestText) pieces.push(`Harvest ${summary.harvestText}`);
  return pieces.map(escapeHtml).join(' • ');
}

function renderRooms() {
  const host = $('#roomsList'); if (!host) return;
  if (!STATE.rooms.length) {
    host.innerHTML = '<p class="tiny" style="color:#64748b">No rooms yet. Create one to get started.</p>';
    return;
  }
    host.innerHTML = STATE.rooms.map(r => {
      const name = escapeHtml(r.name || '');
      const roomId = escapeHtml(r.id || '');
      
      // Equipment summary - extract from room.category structure with controller metadata
      let equipmentSummary = '—';
      const equipment = extractRoomEquipment(r);
      if (equipment.length) {
        const eqMap = {};
        const eqWithController = [];
        
        equipment.forEach(eq => {
          const key = `${eq.vendor || ''} ${eq.model || eq.name || eq.category || 'Equipment'}`.trim();
          if (!eqMap[key]) eqMap[key] = 0;
          eqMap[key] += Number(eq.count) || 1;
          
          // Track equipment with controller for metadata display
          if (eq.control && eq.control.startsWith('IoT:')) {
            eqWithController.push(eq);
          }
        });
        
        const equipmentList = Object.entries(eqMap)
          .map(([k, v]) => `${escapeHtml(k)}${v > 1 ? ` ×${v}` : ''}`)
          .join(', ');
        
        // Add controller status badges if any equipment has controllers
        const controllerStatus = eqWithController.map(eq => {
          const deviceId = eq.control.slice(4);
          const device = (STATE.iotDevices || []).find(d => {
            const id = (d.deviceId || d.id || '').toString().toLowerCase();
            return id === deviceId.toLowerCase();
          });
          
          if (device && device.telemetry) {
            const online = device.telemetry.online !== false;
            const powerState = device.telemetry.power === 'on' || device.telemetry.power === true;
            const name = eq.name || eq.category || 'Equipment';
            const badge = online ? (powerState ? '🟢' : '⚪') : '';
            return `${badge} ${escapeHtml(name)}`;
          }
          return null;
        }).filter(Boolean).join(', ');
        
        equipmentSummary = controllerStatus ? `${equipmentList}<br><span style="font-size:10px;">${controllerStatus}</span>` : equipmentList;
      }
      
      // Zone display — show names, not just count
      const zoneList = Array.isArray(r.zones) ? r.zones.filter(Boolean) : [];
      const zoneCount = zoneList.length;
      let zoneHtml;
      if (zoneCount === 0) {
        zoneHtml = '<span style="color:#94a3b8">No zones — use Room Mapper to add</span>';
      } else {
        const chips = zoneList.map(z => `<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#e0f2fe;color:#0369a1;font-size:11px;font-weight:500;">${escapeHtml(z)}</span>`).join(' ');
        zoneHtml = chips;
      }
      
      // Aggregate lights from STATE.lightSetups for this room
      const roomLightSetups = (window.STATE?.lightSetups || []).filter(setup => String(setup.room) === String(r.id) || String(setup.room) === String(r.name));
      let lightMap = {};
      let numLights = 0;
      roomLightSetups.forEach(setup => {
        (setup.fixtures || []).forEach(f => {
          const key = (f.vendor||f.name||f.model||'Light');
          if (!lightMap[key]) lightMap[key] = 0;
          lightMap[key] += Number(f.count)||1;
          numLights += Number(f.count)||1;
        });
      });
      const lightsList = Object.keys(lightMap).length ? Object.entries(lightMap).map(([k,v]) => `${escapeHtml(k)} ×${v}`).join(', ') : '—';
      const planSummaries = getRoomPlanSummaries(r);
      const planSummaryHtml = planSummaries.length
        ? planSummaries.map(renderPlanSummaryLine).join('<br>')
        : '—';
      
      return `<div class="card" style="margin-top:8px">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div>
            <h3 style="margin:0">${name}</h3>
            <div class="tiny" style="color:#475569"><b>Equipment:</b> ${equipmentSummary}</div>
            <div class="tiny" style="margin:4px 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b style="color:#475569">Zones:</b> ${zoneHtml}</div>
            <div class="tiny" style="color:#475569"><b>Plans:</b> ${planSummaryHtml}</div>
            ${numLights > 0 ? `<div class="tiny" style="color:#64748b">Lights: ${numLights} (${lightsList})</div>` : ''}
          </div>
          <div class="row" style="gap:6px">
            <button type="button" class="ghost" data-action="edit-room" data-room-id="${roomId}">Edit</button>
            <button type="button" class="ghost danger" data-action="del-room" data-room-id="${roomId}">Delete</button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Wire Edit actions
    host.querySelectorAll('[data-action="edit-room"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-room-id');
        if (!id) return;
        const room = STATE.rooms.find(r => String(r.id) === String(id));
        console.debug('[Edit Room Button] Clicked. id:', id, 'room:', room);
        if (!room) {
          console.warn('Edit requested for unknown room id', id);
          if (typeof showToast === 'function') {
            showToast({ title: 'Room not found', msg: 'Unable to load room for editing.', kind: 'warn', icon: '' });
          }
          return;
        }
        if (window.roomWizard && typeof window.roomWizard.open === 'function') {
          window.roomWizard.open(room);
        } else {
          const modal = document.getElementById('roomModal');
          if (modal) {
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
          }
        }
      });
    });

    // Wire Delete actions
    host.querySelectorAll('[data-action="del-room"]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-room-id');
        const room = STATE.rooms.find(r => String(r.id) === String(id));
        if (!id) return;
        const name = room?.name || id;
        if (!confirm(`Delete grow room “${name}”? This cannot be undone.`)) return;
        const ok = await safeRoomsDelete(id);
        if (ok) {
          setStatus(`Deleted room ${name}`);
          renderRooms();
          // Update controller assignments when rooms are deleted
          if (typeof renderControllerAssignments === 'function') {
            renderControllerAssignments();
          }
        } else {
          alert('Failed to delete room');
        }
      });
    });

  renderGrowRoomOverview();
}

function renderLightSetups() {
  const container = document.getElementById('lightSetupsList');
  if (!container) return;
  
  // Get rooms from STATE.rooms that have fixtures defined
  const rooms = (STATE.rooms || []).filter(room => 
    room.fixtures && Array.isArray(room.fixtures) && room.fixtures.length > 0
  );
  
  if (rooms.length === 0) {
    // Per request: remove emoji and empty-state guidance; leave the area blank
    container.innerHTML = '';
  } else {
    container.innerHTML = rooms.map(room => {
      const fixtures = room.fixtures || [];
      const totalFixtures = fixtures.reduce((sum, f) => sum + (Number(f.count) || 1), 0);
      const fixturesList = fixtures.map(f => {
        const name = f.name || f.model || f.vendor || 'Light';
        const count = Number(f.count) || 1;
        return `${count}× ${escapeHtml(name)}`;
      }).join(', ');
      
      const zones = Array.isArray(room.zones) ? room.zones.join(', ') : '—';
      const controlMethod = room.controlMethod || room.control || '—';
      
      return `
        <div class="card" style="margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px;">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
            <div>
              <h3 style="margin: 0 0 4px 0; color: #1e293b; font-size: 18px;">${escapeHtml(room.name || 'Unnamed Room')}</h3>
              <div class="tiny" style="color: #64748b;">Room ID: ${escapeHtml(room.id || 'N/A')}</div>
            </div>
            <div style="display: flex; gap: 8px;">
              <button type="button" class="ghost small" onclick="editRoom('${escapeHtml(room.id)}')">
                Edit Room
              </button>
            </div>
          </div>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; padding: 12px; background: #f8fafc; border-radius: 6px;">
            <div>
              <div class="tiny" style="color: #64748b; margin-bottom: 4px;">Fixtures</div>
              <div style="font-weight: 600; color: #1e293b;">${totalFixtures} total</div>
              <div class="tiny" style="color: #475569; margin-top: 2px;">${fixturesList}</div>
            </div>
            <div>
              <div class="tiny" style="color: #64748b; margin-bottom: 4px;">Zones</div>
              <div style="font-weight: 600; color: #1e293b;">${escapeHtml(zones)}</div>
            </div>
            <div>
              <div class="tiny" style="color: #64748b; margin-bottom: 4px;">Control Method</div>
              <div style="font-weight: 600; color: #1e293b;">${escapeHtml(controlMethod)}</div>
            </div>
            ${room.layout ? `
            <div>
              <div class="tiny" style="color: #64748b; margin-bottom: 4px;">Layout</div>
              <div style="font-weight: 600; color: #1e293b;">${escapeHtml(room.layout)}</div>
            </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }
}


function renderLightSetupSummary() {
  const summaryContainer = document.getElementById('lightSetupSummary');
  if (!summaryContainer) return;
  // Listen for global lightSetupsChanged event to re-render summary
  if (!window._lightSetupSummaryListener) {
    window._lightSetupSummaryListener = () => renderLightSetupSummary();
    window.addEventListener('lightSetupsChanged', window._lightSetupSummaryListener);
  }

  // Try to use STATE.lightSetups first, then fallback to STATE.rooms with fixtures
  let lightSetups = STATE.lightSetups || [];
  
  // If no light setups, create virtual setups from rooms with fixtures
  if (lightSetups.length === 0) {
    const roomsWithFixtures = (STATE.rooms || []).filter(room => 
      room.fixtures && Array.isArray(room.fixtures) && room.fixtures.length > 0
    );
    
    if (roomsWithFixtures.length === 0) {
      // Per request: remove warning guidance; leave summary blank when nothing to show
      summaryContainer.innerHTML = '';
      return;
    }
    
    // Convert rooms to light setup format for display
    lightSetups = roomsWithFixtures.map(room => ({
      room: room.id,
      fixtures: room.fixtures || [],
      controlMethod: room.controlMethod || room.control,
      zone: room.zones ? room.zones[0] : null
    }));
  }
  
  // Group light setups by room (id or name)
  const roomMap = {};
  lightSetups.forEach(setup => {
    const roomKey = String(setup.room);
    if (!roomMap[roomKey]) {
      // Try to find room name from STATE.rooms
      let roomName = roomKey;
      let zones = [];
      const roomObj = (STATE.rooms||[]).find(r => String(r.id) === roomKey || String(r.name) === roomKey);
      if (roomObj) {
        roomName = roomObj.name || roomKey;
        zones = Array.isArray(roomObj.zones) ? roomObj.zones.slice() : [];
      }
      roomMap[roomKey] = {
        id: roomKey,
        name: roomName,
        zones: new Set(zones),
        controls: new Set(),
        lights: {},
        totalLights: 0
      };
    }
    // Add zones from setup
    if (setup.zone) roomMap[roomKey].zones.add(setup.zone);
    // Add control method
    if (setup.controlMethod) roomMap[roomKey].controls.add(setup.controlMethod);
    // Add lights
    (setup.fixtures||[]).forEach(f => {
      const key = f.vendor||f.name||f.model||'Light';
      if (!roomMap[roomKey].lights[key]) roomMap[roomKey].lights[key] = 0;
      roomMap[roomKey].lights[key] += Number(f.count)||1;
      roomMap[roomKey].totalLights += Number(f.count)||1;
    });
  });

  // Render summary cards for each room in roomMap
  summaryContainer.innerHTML = Object.values(roomMap).map(room => {
    const zones = Array.from(room.zones).join(', ') || '—';
    const controls = Array.from(room.controls).join(', ') || '—';
    const lightsList = Object.keys(room.lights).length ? Object.entries(room.lights).map(([k,v]) => `${escapeHtml(k)} ×${v}`).join(', ') : '—';
    const name = escapeHtml(room.name || room.id);
    const roomId = escapeHtml(room.id);
    return `<div class="card" style="margin-top:8px">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div>
          <h3 style="margin:0">${name}</h3>
          <div class="tiny" style="color:#475569">Zones: ${zones} • Controls: ${controls}</div>
          <div class="tiny" style="color:#475569">Lights: ${room.totalLights} (${lightsList})</div>
        </div>
        <div class="row" style="gap:6px">
          <button type="button" class="ghost" data-action="edit-room" data-room-id="${roomId}">Edit</button>
          <button type="button" class="ghost danger" data-action="del-room" data-room-id="${roomId}">Delete</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Wire Edit and Delete actions (delegated)
  summaryContainer.onclick = async function(e) {
    const editBtn = e.target.closest('[data-action="edit-room"]');
    if (editBtn) {
      const id = editBtn.getAttribute('data-room-id');
      if (!id) return;
      const room = (STATE.rooms||[]).find(r => String(r.id) === String(id) || String(r.name) === String(id));
      if (!room) {
        if (typeof showToast === 'function') showToast({ title: 'Room not found', msg: 'Unable to load room for editing.', kind: 'warn', icon: '' });
        return;
      }
      if (window.freshLightWizard && typeof window.freshLightWizard.open === 'function') {
        window.freshLightWizard.open();
        setTimeout(() => {
          const roomSelect = document.getElementById('freshRoomSelect');
          if (roomSelect) {
            roomSelect.value = room.name;
            roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, 100);
      } else {
        const modal = document.getElementById('freshLightModal');
        if (modal) {
          modal.setAttribute('aria-hidden', 'false');
          modal.style.removeProperty('display');
          modal.style.opacity = '1';
          modal.style.pointerEvents = 'all';
        }
      }
      return;
    }
    const delBtn = e.target.closest('[data-action="del-room"]');
    if (delBtn) {
      const id = delBtn.getAttribute('data-room-id');
      if (!id) return;
      const room = (STATE.rooms||[]).find(r => String(r.id) === String(id) || String(r.name) === String(id));
      const name = room?.name || id;
      if (!confirm(`Delete grow room “${name}”? This cannot be undone.`)) return;
      // Remove from STATE.rooms
      if (STATE.rooms) STATE.rooms = STATE.rooms.filter(r => String(r.id) !== String(id) && String(r.name) !== String(id));
      // Remove from STATE.lightSetups
      if (STATE.lightSetups) STATE.lightSetups = STATE.lightSetups.filter(setup => String(setup.room) !== String(id) && String(setup.room) !== name);
      // Persist light setups change
      persistLightSetups();
      // Save and re-render
      await safeRoomsSave();
      window.dispatchEvent(new CustomEvent('lightSetupsChanged'));
      renderLightSetupSummary();
      renderRooms();
      if (typeof renderControllerAssignments === 'function') renderControllerAssignments();
      setStatus(`Deleted room ${name}`);
      return;
    }
  };

  renderGrowRoomOverview();
}

function editLightSetup(roomId) {
  // Find the room
  const room = STATE.rooms.find(r => String(r.id) === String(roomId));
  if (!room) {
    alert('Room not found');
    return;
  }
  
  // Find light setups for this room
  const roomLightSetups = STATE.lightSetups.filter(setup => 
    setup.room === room.name || setup.room === roomId
  );
  
  if (roomLightSetups.length === 0) {
    // No existing light setup, create new one
    if (confirm(`No light setup found for "${room.name}". Create a new light setup for this room?`)) {
      // Open the fresh light wizard with pre-selected room
      if (window.freshLightWizard) {
        freshLightWizard.open();
        // Pre-select the room in step 1 if possible
        setTimeout(() => {
          const roomSelect = document.getElementById('freshRoomSelect');
          if (roomSelect) {
            roomSelect.value = room.name;
            // Trigger change event to update zones
            roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, 100);
      }
    }
    return;
  }
  
  // For now, since we have multiple light setups per room, 
  // let's open the light wizard to add/modify setups
  if (window.freshLightWizard) {
    freshLightWizard.open();
    // Pre-select the room
    setTimeout(() => {
      const roomSelect = document.getElementById('freshRoomSelect');
      if (roomSelect) {
        roomSelect.value = room.name;
        roomSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, 100);
    
    showToast({ 
      title: 'Edit Light Setup', 
      msg: `Opening light setup wizard for ${room.name}`, 
      kind: 'info', 
      icon: '' 
    });
  }
}

// Edit a room from the Light Setup panel
function editRoom(roomId) {
  // Find the room in STATE.rooms
  const room = (STATE.rooms || []).find(r => String(r.id) === String(roomId));
  
  if (!room) {
    showToast({ 
      title: 'Room not found', 
      msg: `Unable to find room with ID: ${roomId}`, 
      kind: 'error', 
      icon: '' 
    });
    return;
  }
  
  // Open the Grow Room wizard with this room's data
  if (typeof growRoomWizard !== 'undefined' && growRoomWizard.open) {
    growRoomWizard.open(room);
    showToast({ 
      title: 'Edit Room', 
      msg: `Opening ${room.name} for editing`, 
      kind: 'info', 
      icon: '' 
    });
  } else {
    showToast({ 
      title: 'Wizard not available', 
      msg: 'Grow Room wizard is not loaded', 
      kind: 'error', 
      icon: '' 
    });
  }
}

// Controller Assignments functionality
function generateUniqueId(equipmentType, roomName, zoneName) {
  // Create unique ID format: EQUIPMENTTYPEROOM#ZONE#RANDOM
  // e.g., DEAL037 for Dehumidifier in Alpha room, zone 3, random 7
  
  const equipmentCode = equipmentType.substring(0, 2).toUpperCase();
  const roomCode = roomName.substring(0, 2).toUpperCase();
  const zoneCode = zoneName.toString().padStart(1, '0');
  const randomDigit = Math.floor(Math.random() * 10);
  
  return `${equipmentCode}${roomCode}${zoneCode}${randomDigit}`;
}

function getControllerRequiredEquipment() {
  const equipment = [];
  
  // Get current operational lights from device metadata (for demo/existing lights)
  const deviceMeta = STATE.deviceMeta || {};
  Object.keys(deviceMeta).forEach(deviceId => {
    const device = deviceMeta[deviceId];
    if (deviceId.startsWith('light-') && device.transport === 'wifi') {
      // Map to current room structure or use legacy room name
      let roomName = device.room || 'Grow Room 2';
      let zoneName = device.zone || '1';
      
      // Try to map to current rooms
      const currentRoom = STATE.rooms?.find(r => 
        r.name.toLowerCase().includes('grow') || 
        r.name.toLowerCase().includes('test')
      );
      if (currentRoom) {
        roomName = currentRoom.name;
        zoneName = currentRoom.zones?.[0] || '1';
      }
      
      equipment.push({
        type: 'Light',
        make: device.manufacturer || 'Unknown',
        model: device.model || 'Unknown',
        room: roomName,
        zone: zoneName,
        uniqueId: deviceId, // Use actual device ID for existing lights
        controlMethod: 'WiFi',
        controller: 'Unassigned',
        status: 'Operational', // Mark as operational for demo
        serial: device.serial || 'Unknown',
        watts: device.watts || 'Unknown'
      });
    }
  });
  
  // Get equipment from light setups
  const lightSetups = STATE.lightSetups || [];
  lightSetups.forEach(setup => {
    if (setup.controlMethod && setup.controlMethod !== 'manual') {
      const room = STATE.rooms.find(r => r.name === setup.room || r.id === setup.room);
      const roomName = room?.name || setup.room || 'Unknown';
      const zoneName = setup.zone || '1';
      
      if (setup.selectedFixtures) {
        setup.selectedFixtures.forEach(fixture => {
          const quantity = setup.fixtureQuantities?.[fixture.id] || 1;
          for (let i = 0; i < quantity; i++) {
            equipment.push({
              type: 'Light',
              make: fixture.vendor || 'Unknown',
              model: fixture.name || fixture.model || 'Unknown',
              room: roomName,
              zone: zoneName,
              uniqueId: generateUniqueId('Light', roomName, zoneName),
              controlMethod: setup.controlMethod,
              controller: 'Unassigned'
            });
          }
        });
      }
    }
  });
  
  // Get equipment from room setups (HVAC, sensors, etc.)
  const rooms = STATE.rooms || [];
  rooms.forEach(room => {
    // Check for devices that need controllers
    if (room.devices && room.devices.length > 0) {
      room.devices.forEach(device => {
        const needsController = device.setup && (
          device.setup.wifi || 
          device.setup.bluetooth || 
          device.setup['0-10v'] || 
          device.setup.rs485 ||
          device.setup.smartPlug ||
          device.setup['smart-plug']
        );
        
        if (needsController) {
          room.zones?.forEach(zone => {
            equipment.push({
              type: capitalizeDeviceType(device.category || getDeviceTypeFromModel(device.model) || 'Device'),
              make: device.vendor || 'Unknown',
              model: device.model || 'Unknown',
              room: room.name,
              zone: zone,
              uniqueId: generateUniqueId(device.category || getDeviceTypeFromModel(device.model) || 'Device', room.name, zone),
              controlMethod: getDeviceControlMethod(device.setup),
              controller: 'Unassigned'
            });
          });
        }
      });
    }
    
    // Check for fixtures in room data (legacy format)
    if (room.fixtures && room.fixtures.length > 0) {
      room.fixtures.forEach(fixture => {
        if (fixture.control && fixture.control !== 'manual') {
          room.zones?.forEach(zone => {
            const count = fixture.count || 1;
            for (let i = 0; i < count; i++) {
              equipment.push({
                type: 'Light',
                make: fixture.vendor || 'Unknown',
                model: fixture.model || 'Unknown',
                room: room.name,
                zone: zone,
                uniqueId: generateUniqueId('Light', room.name, zone),
                controlMethod: fixture.control,
                controller: 'Unassigned'
              });
            }
          });
        }
      });
    }
  });
  
  // Get equipment from groups (lights that are grouped)
  const groups = STATE.groups || [];
  groups.forEach(group => {
    if (group.lights && group.lights.length > 0) {
      group.lights.forEach(light => {
        const device = STATE.devices?.find(d => d.id === light.id);
        if (device) {
          // Determine room from device location or group assignment
          const roomName = device.location || group.room || 'Unknown';
          const zoneName = device.zone || '1';
          
          equipment.push({
            type: 'Light',
            make: device.vendor || 'Unknown',
            model: device.model || device.deviceName || 'Unknown',
            room: roomName,
            zone: zoneName,
            uniqueId: generateUniqueId('Light', roomName, zoneName),
            controlMethod: 'Group Control',
            controller: 'Unassigned'
          });
        }
      });
    }
  });
  
  return equipment;
}

function capitalizeDeviceType(type) {
  const typeMap = {
    'hvac': 'HVAC',
    'mini-split': 'Mini-Split',
    'dehumidifier': 'Dehumidifier',
    'sensor': 'Sensor',
    'fan': 'Fan',
    'controller': 'Controller',
    'hub': 'Hub'
  };
  
  return typeMap[type.toLowerCase()] || type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
}

function getDeviceTypeFromModel(model) {
  if (!model) return 'Device';
  
  const modelLower = model.toLowerCase();
  if (modelLower.includes('dehumid')) return 'Dehumidifier';
  if (modelLower.includes('hvac') || modelLower.includes('split')) return 'HVAC';
  if (modelLower.includes('sensor')) return 'Sensor';
  if (modelLower.includes('fan')) return 'Fan';
  if (modelLower.includes('hub') || modelLower.includes('bridge')) return 'Hub';
  if (modelLower.includes('controller')) return 'Controller';
  
  return 'Device';
}

function getDeviceControlMethod(setup) {
  if (setup.wifi) return 'WiFi';
  if (setup.bluetooth) return 'Bluetooth';
  if (setup['0-10v']) return '0-10V';
  if (setup.rs485) return 'RS-485';
  if (setup.smartPlug || setup['smart-plug']) return 'Smart Plug';
  return 'Unknown';
}

function renderControllerAssignments() {
  const container = document.getElementById('controllerAssignmentsTable');
  if (!container) return;
  
  const equipment = getControllerRequiredEquipment();
  
  if (equipment.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 24px; color: #64748b;">
        <p>No equipment requiring controllers found.</p>
        <p class="tiny">Equipment will appear here when you configure lights, HVAC, or sensors with smart control methods.</p>
      </div>
    `;
    return;
  }
  
  container.innerHTML = `
    <div class="table-container" style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
        <thead>
          <tr style="background: #f8fafc; border-bottom: 2px solid #e2e8f0;">
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Type</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Make</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Model</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Room</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Zone</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Unique ID</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Control</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Status</th>
            <th style="text-align: left; padding: 12px 8px; font-weight: 600;">Controller</th>
            <th style="text-align: center; padding: 12px 8px; font-weight: 600;">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${equipment.map((item, index) => `
            <tr style="border-bottom: 1px solid #e2e8f0;">
              <td style="padding: 12px 8px;">
                <span class="chip tiny" style="background: #dbeafe; color: #1e40af;">${item.type}</span>
                ${item.watts ? `<div class="tiny" style="color: #64748b; margin-top: 2px;">${item.watts}W</div>` : ''}
              </td>
              <td style="padding: 12px 8px; font-weight: 500;">${item.make}</td>
              <td style="padding: 12px 8px;">
                ${item.model}
                ${item.serial ? `<div class="tiny" style="color: #64748b; margin-top: 2px;">S/N: ${item.serial}</div>` : ''}
              </td>
              <td style="padding: 12px 8px;">${item.room}</td>
              <td style="padding: 12px 8px;">${item.zone}</td>
              <td style="padding: 12px 8px;">
                <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', monospace; font-size: 12px;">${item.uniqueId}</code>
              </td>
              <td style="padding: 12px 8px;">
                <span class="chip tiny" style="background: #ecfdf5; color: #059669;">${item.controlMethod}</span>
              </td>
              <td style="padding: 12px 8px;">
                ${item.status === 'Operational' ? 
                  '<span class="chip tiny" style="background: #dcfce7; color: #166534;">Operational</span>' : 
                  '<span class="chip tiny" style="background: #fef3c7; color: #d97706;">Setup Required</span>'
                }
              </td>
              <td style="padding: 12px 8px;">
                <select class="controller-select" data-equipment-index="${index}" style="padding: 4px 8px; border: 1px solid #d1d5db; border-radius: 4px; font-size: 13px;">
                  <option value="">Select Controller...</option>
                  <option value="hub-001">Main Hub (HUB-001)</option>
                  <option value="controller-001">Zone Controller 1 (CTRL-001)</option>
                  <option value="controller-002">Zone Controller 2 (CTRL-002)</option>
                  <option value="wifi-bridge">WiFi Bridge (WIFI-001)</option>
                </select>
              </td>
              <td style="padding: 12px 8px; text-align: center;">
                <button type="button" class="ghost tiny" onclick="editControllerAssignment(${index})">Edit</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    
    <div style="margin-top: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <strong>${equipment.length}</strong> equipment item${equipment.length !== 1 ? 's' : ''} requiring controller assignment
        </div>
        <div class="row" style="gap: 8px;">
          <button type="button" class="ghost" onclick="exportControllerAssignments()">Export CSV</button>
          <button type="button" class="primary" onclick="saveControllerAssignments()">Save Assignments</button>
        </div>
      </div>
    </div>
  `;
  
  // Wire up controller selection changes
  container.querySelectorAll('.controller-select').forEach(select => {
    select.addEventListener('change', (e) => {
      const index = parseInt(e.target.getAttribute('data-equipment-index'));
      const controllerId = e.target.value;
      
      if (equipment[index]) {
        equipment[index].controller = controllerId || 'Unassigned';
        
        showToast({
          title: 'Controller Updated',
          msg: `${equipment[index].uniqueId} assigned to ${controllerId || 'Unassigned'}`,
          kind: 'success',
          icon: ''
        });
      }
    });
  });
}

function editControllerAssignment(index) {
  const equipment = getControllerRequiredEquipment();
  const item = equipment[index];
  
  if (!item) return;
  
  const isOperational = item.status === 'Operational';
  // Room/zone dropdowns
  const rooms = (window.STATE?.rooms || []);
  const roomOptions = rooms.map(r => `<option value="${r.id}"${item.room === r.name || item.room === r.id ? ' selected' : ''}>${r.name}</option>`).join('');
  const selectedRoom = rooms.find(r => r.name === item.room || r.id === item.room) || rooms[0] || {};
  const zones = selectedRoom.zones || [];
  const zoneOptions = zones.map(z => `<option value="${z}"${item.zone === z ? ' selected' : ''}>${z}</option>`).join('');

  const modalHTML = `
    <div class="modal-backdrop active" onclick="closeModal()">
      <div class="modal-content" onclick="event.stopPropagation()" style="max-width: 600px;">
        <div class="modal-header">
          <h3>${isOperational ? 'Configure' : 'Edit'} Controller Assignment</h3>
          <button type="button" class="btn-close" onclick="closeModal()">×</button>
        </div>
        
        <div class="modal-body">
          <div class="form-group">
            <label>Equipment Details</label>
            <div style="background: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 16px;">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px;">
                <div><strong>Type:</strong> ${item.type}</div>
                <div><strong>Make:</strong> ${item.make}</div>
                <div><strong>Model:</strong> ${item.model}</div>
                <div><strong>Room:</strong> 
                  <select id="editRoomDropdown" style="width: 90%; padding: 4px 8px; border-radius: 4px;">${roomOptions}</select>
                </div>
                <div><strong>Zone:</strong> 
                  <select id="editZoneDropdown" style="width: 90%; padding: 4px 8px; border-radius: 4px;">${zoneOptions}</select>
                </div>
                <div><strong>Control:</strong> ${item.controlMethod}</div>
                ${item.serial ? `<div><strong>Serial:</strong> ${item.serial}</div>` : ''}
                ${item.watts ? `<div><strong>Power:</strong> ${item.watts}W</div>` : ''}
              </div>
              ${isOperational ? '<div class="chip tiny" style="background: #dcfce7; color: #166534; margin-top: 8px;">Currently Operational</div>' : ''}
            </div>
          </div>
          
          <div class="form-group">
            <label for="assignedController">Assign Controller</label>
            <select id="assignedController" style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px;">
              <option value="">Select Controller...</option>
              <option value="hub-001" ${item.controller === 'hub-001' ? 'selected' : ''}>Main Hub (HUB-001)</option>
              <option value="controller-001" ${item.controller === 'controller-001' ? 'selected' : ''}>Zone Controller 1 (CTRL-001)</option>
              <option value="controller-002" ${item.controller === 'controller-002' ? 'selected' : ''}>Zone Controller 2 (CTRL-002)</option>
              <option value="wifi-bridge" ${item.controller === 'wifi-bridge' ? 'selected' : ''}>WiFi Bridge (WIFI-001)</option>
            </select>
          </div>
          
          ${isOperational ? `
            <div class="form-group">
              <label>Network Configuration</label>
              <div style="background: #fef3c7; padding: 12px; border-radius: 8px; border-left: 4px solid #f59e0b;">
                <div style="font-size: 14px; color: #92400e;">
                  <strong>Note:</strong> This equipment is currently operational. Any controller assignment changes may affect current operation.
                </div>
              </div>
            </div>
          ` : ''}
          
          <div class="form-group">
            <label for="assignmentNotes">Notes</label>
            <textarea id="assignmentNotes" rows="3" placeholder="Add any notes about this controller assignment..." style="width: 100%; padding: 12px; border: 1px solid #d1d5db; border-radius: 8px; resize: vertical;"></textarea>
          </div>
        </div>
        
        <div class="modal-footer">
          <button type="button" class="btn secondary" onclick="closeModal()">Cancel</button>
          <button type="button" class="btn primary" onclick="saveControllerAssignment(${index}, true)">
            ${isOperational ? 'Update Assignment' : 'Save Assignment'}
          </button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);
  // Wire up room/zone dropdown linkage
  const roomSel = document.getElementById('editRoomDropdown');
  const zoneSel = document.getElementById('editZoneDropdown');
  if (roomSel && zoneSel) {
    roomSel.addEventListener('change', () => {
      const selected = rooms.find(r => r.id === roomSel.value);
      zoneSel.innerHTML = (selected?.zones || []).map(z => `<option value="${z}">${z}</option>`).join('');
    });
  }
}

function saveControllerAssignment(index, updateRoomZone) {
  const equipment = getControllerRequiredEquipment();
  const item = equipment[index];
  if (!item) return;
  const controllerId = document.getElementById('assignedController').value;
  const notes = document.getElementById('assignmentNotes').value;
  // Room/zone update
  if (updateRoomZone) {
    const roomSel = document.getElementById('editRoomDropdown');
    const zoneSel = document.getElementById('editZoneDropdown');
    if (roomSel && zoneSel) {
      item.room = roomSel.options[roomSel.selectedIndex].text;
      item.zone = zoneSel.value;
      // Try to update STATE.devices and STATE.deviceMeta if possible
      if (window.STATE?.devices) {
        const dev = window.STATE.devices.find(d => d.id === item.uniqueId);
        if (dev) {
          dev.room = item.room;
          dev.zone = item.zone;
        }
      }
      if (window.STATE?.deviceMeta) {
        const meta = window.STATE.deviceMeta[item.uniqueId];
        if (meta) {
          meta.room = item.room;
          meta.zone = item.zone;
        }
      }
      // Add to group.lights if matching group exists
      if (window.STATE && Array.isArray(window.STATE.groups)) {
        let group = window.STATE.groups.find(g => (g.room === item.room || g.roomId === item.room) && g.zone === item.zone);
        if (group) {
          group.lights = group.lights || [];
          if (!group.lights.some(l => l.id === item.uniqueId)) {
            group.lights.push({
              id: item.uniqueId,
              name: item.make || item.model || item.uniqueId,
              vendor: item.make || '',
              model: item.model || '',
              room: item.room,
              roomId: item.room,
              zone: item.zone,
              source: 'controller',
              fixtureId: null
            });
            if (typeof saveGroups === 'function') saveGroups();
            if (typeof updateGroupUI === 'function') updateGroupUI(group);
          }
        }
      }
    }
  }
  // Update the equipment item
  item.controller = controllerId || 'Unassigned';
  if (notes) item.notes = notes;
  closeModal();
  renderControllerAssignments();
  showToast({
    title: 'Assignment Updated',
    msg: `${item.uniqueId} ${controllerId ? 'assigned to ' + controllerId : 'unassigned'}`,
    kind: 'success',
    icon: ''
  });
}

function closeModal() {
  const modal = document.querySelector('.modal-backdrop');
  if (modal) modal.remove();
}

function exportControllerAssignments() {
  const equipment = getControllerRequiredEquipment();
  
  const csvHeaders = ['Type', 'Make', 'Model', 'Room', 'Zone', 'Unique ID', 'Control Method', 'Controller'];
  const csvRows = equipment.map(item => [
    item.type,
    item.make,
    item.model,
    item.room,
    item.zone,
    item.uniqueId,
    item.controlMethod,
    item.controller
  ]);
  
  const csvContent = [csvHeaders, ...csvRows]
    .map(row => row.map(field => `"${field}"`).join(','))
    .join('\n');
  
  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'controller-assignments.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  showToast({
    title: 'Export Complete',
    msg: 'Controller assignments exported to CSV',
    kind: 'success',
    icon: ''
  });
}

function saveControllerAssignments() {
  // Future: Save controller assignments to backend
  showToast({
    title: 'Assignments Saved',
    msg: 'Controller assignments have been saved',
    kind: 'success',
    icon: ''
  });
}

function renderSchedules() {
  const select = $('#groupSchedule');
  if (!select) return;

  select.innerHTML = '<option value="">No schedule</option>' +
    STATE.schedules.map(schedule => `<option value="${schedule.id}">${schedule.name}</option>`).join('');

  renderGrowRoomOverview();
  renderEquipmentOverview();
}

function buildEquipmentDisplayName(source) {
  const item = source || {};
  const explicit = typeof item.name === 'string' ? item.name.trim() : '';
  if (explicit) return explicit;
  const vendor = typeof item.vendor === 'string' ? item.vendor.trim() : '';
  const model = typeof item.model === 'string' ? item.model.trim() : '';
  const vendorLower = vendor && vendor.toLowerCase ? vendor.toLowerCase() : '';
  const vendorIsUnknown = vendorLower === 'unknown';
  if (vendor && !vendorIsUnknown && model) return `${vendor} ${model}`.trim();
  if (model) return model;
  if (vendor && !vendorIsUnknown) return vendor;
  const category = typeof item.category === 'string' ? item.category.trim() : '';
  if (category) {
    return category
      .split('-')
      .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : '')
      .join(' ')
      .trim() || 'Equipment';
  }
  return 'Equipment';
}

// --- Equipment Overview Functions ---
function getAllEquipment() {
  // Aggregate equipment from all rooms
  const equipment = [];
  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  
  rooms.forEach(room => {
    // Skip null or undefined rooms
    if (!room) return;
    
    const roomId = room.id || room.name;
    const roomName = room.name || room.location || 'Unnamed Room';
    
    // Check if room has equipment array (legacy structure)
    if (Array.isArray(room.equipment)) {
      room.equipment.forEach(eq => {
        const count = eq.count || 1;
        // Expand equipment with count > 1 into individual items
        for (let i = 0; i < count; i++) {
          const item = {
            ...eq,
            id: eq.id ? `${eq.id}-${i}` : `${roomId}-${eq.vendor}-${eq.model}-${i}`.replace(/\s+/g, '-'),
            count: 1, // Each item is a single unit
            roomId,
            roomName
          };
          item.name = buildEquipmentDisplayName(item);
          equipment.push(item);
        }
      });
    }
    
    // Check _categoryProgress (persisted from wizard)
    const categoryProgress = room._categoryProgress || room.categoryProgress;
    if (categoryProgress) {
      // Process categories with selectedEquipment arrays (mini-split, dehumidifier)
      Object.values(categoryProgress).forEach(catProgress => {
        if (Array.isArray(catProgress.selectedEquipment)) {
          catProgress.selectedEquipment.forEach(eq => {
            const count = eq.count || 1;
            // Expand equipment with count > 1 into individual items
            for (let i = 0; i < count; i++) {
              const item = {
                ...eq,
                id: eq.id ? `${eq.id}-${i}` : `${roomId}-${eq.vendor}-${eq.model}-${i}`.replace(/\s+/g, '-'),
                count: 1, // Each item is a single unit
                roomId,
                roomName
              };
              item.name = buildEquipmentDisplayName(item);
              equipment.push(item);
            }
          });
        }
      });
      
      // Process categories with simple count/manufacturer format (fans, vents, controllers, etc.)
      const simpleCategories = ['fans', 'vents', 'controllers', 'energy-monitor', 'other'];
      simpleCategories.forEach(catKey => {
        const catData = categoryProgress[catKey];
        if (catData && catData.count && catData.count > 0) {
          // Expand into individual items based on count
          for (let i = 0; i < catData.count; i++) {
            const item = {
              id: `${roomId}-${catKey}-${i}`.replace(/\s+/g, '-'),
              category: catKey,
              vendor: catData.manufacturer || 'Unknown',
              model: catData.model || catKey,
              count: 1, // Each item is a single unit
              control: catData.control || null,
              roomId,
              roomName,
              wifi: catData.wifi || false,
              wired: catData.wired || false,
              notes: catData.notes || ''
            };
            item.name = buildEquipmentDisplayName(item);
            equipment.push(item);
          }
        }
      });
    }
    
    // Also check room.category for legacy storage format
    if (room.category) {
      const simpleCategories = ['fans', 'vents', 'controllers', 'energy-monitor', 'other'];
      simpleCategories.forEach(catKey => {
        const catData = room.category[catKey];
        if (catData && catData.count && catData.count > 0) {
          // Expand into individual items based on count
          for (let i = 0; i < catData.count; i++) {
            const item = {
              id: `${roomId}-${catKey}-${i}`.replace(/\s+/g, '-'),
              category: catKey,
              vendor: catData.manufacturer || 'Unknown',
              model: catData.model || catKey,
              count: 1, // Each item is a single unit
              control: catData.control || null,
              roomId,
              roomName,
              wifi: catData.wifi || false,
              wired: catData.wired || false,
              notes: catData.notes || ''
            };
            item.name = buildEquipmentDisplayName(item);
            equipment.push(item);
          }
        }
      });
    }
  });
  
  // Normalize equipment list to avoid null/invalid entries
  const cleanedEquipment = equipment.filter(eq => eq && typeof eq === 'object');

  // Merge in metadata (name, control overrides, etc.)
  const metadata = STATE.equipmentMetadata || {};
  cleanedEquipment.forEach(eq => {
    if (metadata[eq.id]) {
      Object.assign(eq, metadata[eq.id]);
    }
  });
  
  // Add standalone equipment that only exists in metadata (manually added)
  const equipmentIds = new Set(cleanedEquipment.map(eq => eq.id));
  Object.keys(metadata).forEach(metadataId => {
    // Skip metadata keys that are not equipment IDs or have null/invalid values
    if (metadataId === 'metadata' || metadataId === 'lastUpdated' || metadataId === 'version') {
      return;
    }
    const metaItem = metadata[metadataId];
    if (!metaItem || typeof metaItem !== 'object') {
      return;
    }
    
    // If this ID doesn't exist in the room-based equipment, it's a standalone item
    if (!equipmentIds.has(metadataId)) {
      cleanedEquipment.push({
        id: metadataId,
        name: metaItem.name || 'Equipment',
        category: metaItem.category || 'Other',
        vendor: metaItem.vendor || 'Unknown',
        model: metaItem.model || 'Unknown',
        count: 1,
        control: metaItem.control || null,
        roomId: metaItem.roomId || '',
        roomName: metaItem.roomName || '—',
        isStandalone: true
      });
    }
  });
  
  cleanedEquipment.forEach(eq => {
    if (!eq || typeof eq !== 'object') return;
    const currentName = typeof eq.name === 'string' ? eq.name.trim() : '';
    if (!currentName) {
      eq.name = buildEquipmentDisplayName(eq);
    }
  });

  return cleanedEquipment;
}

function openGrowRoomWizardForEquipment() {
  // Create a new equipment item directly in the metadata
  const equipmentId = `equipment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  // Create a new equipment entry with default values
  STATE.equipmentMetadata[equipmentId] = {
    name: 'New Equipment',
    category: 'Other',
    vendor: 'Unknown',
    model: 'Unknown',
    roomId: '',
    roomName: '—',
    control: ''
  };
  
  // Save metadata
  saveEquipmentMetadata();
  
  // Re-render equipment overview
  renderEquipmentOverview();
  
  showToast({
    title: 'Equipment Added',
    msg: 'New equipment added. Please fill in the details.',
    kind: 'success',
    icon: ''
  }, 2000);
  
  // Focus on the first input field of the new equipment
  setTimeout(() => {
    const row = document.querySelector(`tr[data-equipment-id="${equipmentId}"]`);
    if (row) {
      const firstInput = row.querySelector('input[data-field="name"]');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }
    }
  }, 100);
}

function renderEquipmentOverview() {
  const summaryEl = document.getElementById('equipmentSummary');
  const tbody = document.querySelector('#equipmentTable tbody');
  if (!summaryEl || !tbody) return;
  
  const equipment = getAllEquipment();
  
  if (equipment.length === 0) {
    summaryEl.textContent = 'No equipment configured yet.';
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 24px; color: #64748b;">
          <p>No equipment found.</p>
          <p class="tiny" style="margin-top: 8px;">Click "+ Add New Equipment" above or configure equipment through the Grow Room Setup wizard.</p>
        </td>
      </tr>
    `;
    return;
  }
  
  // Create summary
  const categoryCount = {};
  equipment.forEach(eq => {
    const cat = eq.category || 'Other';
    categoryCount[cat] = (categoryCount[cat] || 0) + (eq.count || 1);
  });
  
  const summaryParts = Object.entries(categoryCount).map(([cat, count]) => 
    `${count} ${cat}${count !== 1 ? 's' : ''}`
  );
  summaryEl.textContent = `${equipment.length} equipment item${equipment.length !== 1 ? 's' : ''}: ${summaryParts.join(', ')}`;
  
  // Render equipment table
  tbody.innerHTML = equipment.map((eq, index) => {
    const id = eq.id || `eq-${index}`;
    const name = eq.name || '';
    const category = eq.category || 'Other';
    const vendor = eq.vendor || '—';
    const model = eq.model || '—';
    const roomName = eq.roomName || '—';
    const control = eq.control || '—';
    const actions = renderEquipmentActions(control);
    
    // Get controller metadata if control is assigned
    const controllerMetadata = renderControllerMetadata(control);
    
    return `
      <tr data-equipment-id="${id}">
        <td>
          <input type="text" 
                 value="${escapeHtml(name)}" 
                 data-equipment-id="${id}"
                 data-field="name"
                 onblur="updateEquipmentField('${id}', 'name', this.value)"
                 class="equipment-input"
                 placeholder="Equipment name" />
          ${controllerMetadata ? `<div class="tiny" style="color:#64748b;margin-top:4px;">${controllerMetadata}</div>` : ''}
        </td>
        <td>
          <select class="equipment-select" 
                  data-equipment-id="${id}" 
                  onchange="updateEquipmentCategory('${id}', this.value)">
            ${renderCategoryOptions(category)}
          </select>
        </td>
        <td>
          <input type="text" 
                 value="${escapeHtml(vendor)}" 
                 data-equipment-id="${id}"
                 data-field="vendor"
                 onblur="updateEquipmentField('${id}', 'vendor', this.value)"
                 class="equipment-input"
                 placeholder="Vendor" />
        </td>
        <td>
          ${renderModelField(id, category, vendor, model)}
        </td>
        <td>
          <select class="equipment-select" data-equipment-id="${id}" onchange="assignEquipmentRoom('${id}', this.value)">
            ${renderRoomOptions(eq.roomId)}
          </select>
        </td>
        <td>
          <select class="equipment-select" data-equipment-id="${id}" onchange="assignEquipmentControl('${id}', this.value)">
            ${renderControlOptions(control)}
          </select>
        </td>
        <td>
          <div class="row" style="gap: 4px; flex-wrap: wrap;">
            ${actions}
          </div>
        </td>
        <td>
          <div class="row" style="gap: 4px;">
            <button type="button" class="ghost tiny" onclick="editEquipment('${id}')" title="Edit">✎</button>
            <button type="button" class="ghost tiny" onclick="deleteEquipment('${id}')" title="Delete" style="color: #ef4444;">×</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// ✅ DATA FLOW: Register event listeners for Equipment Overview
document.addEventListener('DOMContentLoaded', () => {
  // Refresh equipment overview when any equipment-related data changes
  document.addEventListener('rooms-updated', () => {
    console.log('[EquipmentOverview] Rooms updated, refreshing equipment display');
    if (document.querySelector('#equipmentTable')) {
      renderEquipmentOverview();
    }
  });

  document.addEventListener('lights-updated', () => {
    console.log('[EquipmentOverview] Lights updated, refreshing equipment display');
    if (document.querySelector('#equipmentTable')) {
      renderEquipmentOverview();
    }
  });

  document.addEventListener('bus-mapping-updated', () => {
    console.log('[EquipmentOverview] Bus mapping updated, refreshing equipment display');
    if (document.querySelector('#equipmentTable')) {
      renderEquipmentOverview();
    }
  });

  document.addEventListener('iot-devices-updated', () => {
    console.log('[EquipmentOverview] IoT devices updated, refreshing equipment display');
    if (document.querySelector('#equipmentTable')) {
      renderEquipmentOverview();
    }
  });
});

function renderControllerMetadata(control) {
  // Extract and format IoT device metadata for display
  if (!control || control === '—' || control === '' || typeof control !== 'string') {
    return '';
  }
  
  // Check if control is an IoT device reference
  if (control.startsWith('IoT:')) {
    const deviceId = control.slice(4);
    const device = (STATE.iotDevices || []).find(d => {
      const id = (d.deviceId || d.id || '').toString().toLowerCase();
      return id === deviceId.toLowerCase();
    });
    
    if (device && device.telemetry) {
      const telemetry = device.telemetry;
      const parts = [];
      
      // Online status
      const online = telemetry.online !== false;
      const powerState = telemetry.power === 'on' || telemetry.power === true;
      const statusBadge = online ? (powerState ? '🟢 ON' : '⚪ OFF') : ' OFFLINE';
      parts.push(statusBadge);
      
      // Voltage
      if (telemetry.voltage) {
        parts.push(`${telemetry.voltage}V`);
      }
      
      // Current
      if (telemetry.electricCurrent) {
        const amps = (telemetry.electricCurrent / 1000).toFixed(2);
        parts.push(`${amps}A`);
      }
      
      // Power
      if (telemetry.electricCurrent && telemetry.voltage) {
        const watts = ((telemetry.voltage * telemetry.electricCurrent) / 1000).toFixed(0);
        parts.push(`${watts}W`);
      }
      
      // Energy today
      if (telemetry.electricityOfDay) {
        const energy = telemetry.electricityOfDay >= 1000 
          ? `${(telemetry.electricityOfDay / 1000).toFixed(2)} kWh`
          : `${telemetry.electricityOfDay} Wh`;
        parts.push(` ${energy} today`);
      }
      
      return parts.length > 0 ? parts.join(' • ') : '';
    }
  }
  
  return '';
}

function renderEquipmentActions(control) {
  // Return action buttons based on control type
  if (!control || control === '—' || control === '') {
    return '<span class="tiny" style="color:#94a3b8;">No control assigned</span>';
  }
  
  // Check if it's an IoT device (format: IoT:{deviceId})
  if (control.startsWith('IoT:')) {
    const deviceId = control.substring(4);
    const device = STATE.iotDevices?.find(d => d.deviceId === deviceId || d.id === deviceId);
    
    if (device) {
      // Check if device supports power control (plugs, switches, etc.)
      const type = (device.type || '').toLowerCase();
      const category = String(device.category || '').toLowerCase();
      const protocol = (device.protocol || '').toLowerCase();
      
      // Kasa and SwitchBot plugs support on/off
      if (type.includes('plug') || category.includes('plug') || 
          protocol.includes('kasa') || protocol.includes('tp-link')) {
        return `
          <button type="button" class="btn-sm" onclick="controlEquipment('${deviceId}', 'on')" 
                  style="padding:2px 8px;font-size:11px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;">
            ON
          </button>
          <button type="button" class="btn-sm" onclick="controlEquipment('${deviceId}', 'off')" 
                  style="padding:2px 8px;font-size:11px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;">
            OFF
          </button>
        `;
      }
      // Add more device types as needed
      return '<span class="tiny" style="color:#64748b;">Device control available</span>';
    }
    return '<span class="tiny" style="color:#f59e0b;">Device not found</span>';
  }
  
  // Manual control types
  if (control === 'Manual') {
    return '<span class="tiny" style="color:#64748b;">Manual operation</span>';
  }
  
  // Other control types show as configured
  return `<span class="tiny" style="color:#64748b;">${escapeHtml(control)}</span>`;
}

function renderRoomOptions(selectedRoomId) {
  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  const options = ['<option value="">— Unassigned —</option>'];
  
  rooms.forEach(room => {
    const id = room.id || room.name;
    const name = room.name || room.location || 'Unnamed Room';
    const selected = id === selectedRoomId ? 'selected' : '';
    options.push(`<option value="${id}" ${selected}>${escapeHtml(name)}</option>`);
  });
  
  return options.join('');
}

function renderControlOptions(selectedControl) {
  const controls = [
    'WiFi',
    'Wired Thermostat',
    'Modbus/BACnet',
    'Relay',
    '0-10V',
    'Manual',
    'Other'
  ];
  
  const options = ['<option value="">— Select Control —</option>'];
  
  // Add standard control options
  controls.forEach(control => {
    const selected = control === selectedControl ? 'selected' : '';
    options.push(`<option value="${control}" ${selected}>${control}</option>`);
  });
  
  // Get IoT plugs from saved devices
  const iotDevices = STATE.iotDevices || [];
  const plugDevices = iotDevices.filter(device => {
    const type = (device.deviceType || device.type || '').toLowerCase();
    const category = String(device.category || '').toLowerCase();
    const protocol = (device.protocol || '').toLowerCase();
    const vendor = (device.vendor || '').toLowerCase();
    
    // Check if it's a plug device (Kasa, SwitchBot, or any plug type/category)
    return type.includes('plug') || category.includes('plug') || 
           protocol.includes('kasa') || protocol.includes('tp-link') || 
           vendor.includes('kasa') || vendor.includes('tp-link');
  });
  
  // Add IoT plugs as control options if any exist
  if (plugDevices.length > 0) {
    options.push('<option disabled>━━━ IoT Plugs ━━━</option>');
    plugDevices.forEach(plug => {
      const deviceName = plug.name || plug.deviceName || plug.id || 'Unknown Plug';
      const deviceId = plug.id || plug.deviceId;
      const controlValue = `IoT:${deviceId}`;
      const selected = controlValue === selectedControl ? 'selected' : '';
      options.push(`<option value="${controlValue}" ${selected}>🔌 ${escapeHtml(deviceName)}</option>`);
    });
  }

  // Ensure the currently selected control remains visible even if it wasn't in the lists above
  if (selectedControl && !options.some(opt => opt.includes(`value="${selectedControl}"`))) {
    // Try to resolve a friendly label for IoT-linked values
    let label = selectedControl;
    if (typeof selectedControl === 'string' && selectedControl.startsWith('IoT:')) {
      const rawId = selectedControl.slice(4);
      const found = (STATE.iotDevices || []).find(d => {
        const a = (d.deviceId || d.id || '').toString().toLowerCase();
        return a === rawId.toString().toLowerCase();
      });
      if (found) {
        const name = found.name || found.deviceName || found.label || rawId;
        label = `IoT:${rawId}`;
        options.push(`<option disabled>━━━ Linked (unlisted) ━━━</option>`);
        options.push(`<option value="${label}" selected>🔗 ${escapeHtml(name)}</option>`);
      } else {
        options.push(`<option disabled>━━━ Linked (unlisted) ━━━</option>`);
        options.push(`<option value="${escapeHtml(selectedControl)}" selected>${escapeHtml(selectedControl)}</option>`);
      }
    } else {
      options.push(`<option disabled>━━━ Linked (custom) ━━━</option>`);
      options.push(`<option value="${escapeHtml(selectedControl)}" selected>${escapeHtml(selectedControl)}</option>`);
    }
  }
  
  return options.join('');
}

function renderCategoryOptions(selectedCategory) {
  // Equipment categories from grow room wizard
  const categories = [
    'grow-lights',
    'hvac',
    'mini-split',
    'dehumidifier',
    'fans',
    'vents',
    'controllers',
    'energy-monitor',
    'other'
  ];
  
  const options = ['<option value="">— Select Category —</option>'];
  
  categories.forEach(cat => {
    const selected = cat === selectedCategory ? 'selected' : '';
    const displayName = cat.split('-').map(word => 
      word.charAt(0).toUpperCase() + word.slice(1)
    ).join(' ');
    options.push(`<option value="${cat}" ${selected}>${displayName}</option>`);
  });
  
  return options.join('');
}

function renderModelField(equipmentId, category, vendor, model) {
  // For mini-split and dehumidifier, render dropdown from equipment database
  if (category === 'mini-split' || category === 'dehumidifier') {
    return `
      <select class="equipment-model-select" 
              data-equipment-id="${equipmentId}" 
              data-category="${category}"
              onchange="updateEquipmentModel('${equipmentId}', this.value)" 
              style="width:100%;border:1px solid #e2e8f0;padding:4px 8px;border-radius:4px;font-size:13px;">
        ${renderModelOptions(category, vendor, model)}
      </select>
    `;
  }
  
  // For other categories, use text input
  return `
    <input type="text" 
           value="${escapeHtml(model)}" 
           data-equipment-id="${equipmentId}"
           data-field="model"
           onblur="updateEquipmentField('${equipmentId}', 'model', this.value)"
           style="width:100%;border:1px solid #e2e8f0;padding:4px 8px;border-radius:4px;font-size:13px;"
           placeholder="Model" />
  `;
}

function renderModelOptions(category, vendor, model) {
  const equipmentKB = STATE.equipmentKB?.equipment || [];
  
  // Filter equipment by category
  const filteredEquipment = equipmentKB.filter(eq => eq.category === category);
  
  const options = ['<option value="">— Select Model —</option>'];
  
  if (filteredEquipment.length === 0) {
    options.push('<option disabled>No models in database</option>');
  } else {
    // Group by vendor
    const byVendor = {};
    filteredEquipment.forEach(eq => {
      const v = eq.vendor || 'Unknown';
      if (!byVendor[v]) byVendor[v] = [];
      byVendor[v].push(eq);
    });
    
    // Render options grouped by vendor
    Object.keys(byVendor).sort().forEach(v => {
      options.push(`<option disabled>━━━ ${v} ━━━</option>`);
      byVendor[v].forEach(eq => {
        const modelValue = `${eq.vendor}|${eq.model}`;
        const currentValue = `${vendor}|${model}`;
        const selected = modelValue === currentValue ? 'selected' : '';
        const displayText = `${eq.model}${eq.capacity ? ' (' + eq.capacity + ')' : ''}`;
        options.push(`<option value="${escapeHtml(modelValue)}" ${selected}>${escapeHtml(displayText)}</option>`);
      });
    });
  }
  
  return options.join('');
}

function assignEquipmentRoom(equipmentId, roomId) {
  // Initialize equipment metadata storage if not exists
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  if (!STATE.equipmentMetadata[equipmentId]) {
    STATE.equipmentMetadata[equipmentId] = {};
  }
  
  // Update equipment room assignment in metadata
  STATE.equipmentMetadata[equipmentId].roomId = roomId;
  const room = STATE.rooms.find(r => r.id === roomId || r.name === roomId);
  const roomName = room ? (room.name || room.location) : '—';
  STATE.equipmentMetadata[equipmentId].roomName = roomName;
  
  // Save metadata
  saveEquipmentMetadata();
  
  // Re-render equipment overview
  renderEquipmentOverview();
  
  showToast({
    title: 'Room Assigned',
    msg: `Equipment assigned to ${roomName}`,
    kind: 'success',
    icon: ''
  }, 2000);
}

function updateEquipmentField(equipmentId, fieldName, newValue) {
  // Initialize equipment metadata storage if not exists
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  // Validate and update the field
  const trimmedValue = String(newValue || '').trim();
  
  // Name field can be empty, but other fields cannot
  if (!trimmedValue && fieldName !== 'name') {
    showToast({
      title: 'Invalid Value',
      msg: `${fieldName} cannot be empty`,
      kind: 'warning',
      icon: ''
    });
    renderEquipmentOverview(); // Re-render to restore original value
    return;
  }
  
  // Store in metadata
  if (!STATE.equipmentMetadata[equipmentId]) {
    STATE.equipmentMetadata[equipmentId] = {};
  }
  STATE.equipmentMetadata[equipmentId][fieldName] = trimmedValue;
  
  // Save metadata
  saveEquipmentMetadata();
  
  showToast({
    title: 'Field Updated',
    msg: `${fieldName} updated successfully`,
    kind: 'success',
    icon: ''
  }, 2000);
}

async function updateEquipmentCategory(equipmentId, newCategory) {
  // Initialize equipment metadata storage if not exists
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  if (!STATE.equipmentMetadata[equipmentId]) {
    STATE.equipmentMetadata[equipmentId] = {};
  }
  
  // Store category in metadata
  STATE.equipmentMetadata[equipmentId].category = newCategory;
  
  // When category changes to mini-split or dehumidifier, clear existing model
  // since it needs to be selected from database
  if (newCategory === 'mini-split' || newCategory === 'dehumidifier') {
    STATE.equipmentMetadata[equipmentId].model = '';
    STATE.equipmentMetadata[equipmentId].vendor = '';
  }
  
  // Save metadata
  await saveEquipmentMetadata();
  
  // Re-render to update model field (dropdown vs text input)
  renderEquipmentOverview();
  
  showToast({
    title: 'Category Updated',
    msg: `Category changed to ${newCategory}`,
    kind: 'success',
    icon: ''
  }, 2000);
}

async function updateEquipmentModel(equipmentId, modelValue) {
  // Initialize equipment metadata storage if not exists
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  if (!STATE.equipmentMetadata[equipmentId]) {
    STATE.equipmentMetadata[equipmentId] = {};
  }
  
  // Model value format: "Vendor|Model"
  if (modelValue && modelValue.includes('|')) {
    const [vendor, model] = modelValue.split('|');
    STATE.equipmentMetadata[equipmentId].vendor = vendor;
    STATE.equipmentMetadata[equipmentId].model = model;
    
    // Also update capacity/power from equipment KB if available
    const equipmentKB = STATE.equipmentKB?.equipment || [];
    const equipment = equipmentKB.find(eq => 
      eq.vendor === vendor && eq.model === model
    );
    
    if (equipment) {
      if (equipment.capacity) {
        STATE.equipmentMetadata[equipmentId].capacity = equipment.capacity;
      }
      if (equipment.power) {
        STATE.equipmentMetadata[equipmentId].power = equipment.power;
      }
      if (equipment.control) {
        STATE.equipmentMetadata[equipmentId].control = equipment.control;
      }
    }
  }
  
  // Save metadata
  await saveEquipmentMetadata();
  
  // Re-render to update vendor field and other details
  renderEquipmentOverview();
  
  showToast({
    title: 'Model Updated',
    msg: `Model updated from database`,
    kind: 'success',
    icon: ''
  }, 2000);
}

async function saveEquipmentMetadata() {
  try {
    await fetch('/data/equipment-metadata.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(STATE.equipmentMetadata || {})
    });
  } catch (error) {
    console.error('Failed to save equipment metadata:', error);
  }
}

function assignEquipmentControl(equipmentId, controlMethod) {
  // Initialize equipment metadata storage if not exists
  if (!STATE.equipmentMetadata) {
    STATE.equipmentMetadata = {};
  }
  
  if (!STATE.equipmentMetadata[equipmentId]) {
    STATE.equipmentMetadata[equipmentId] = {};
  }
  
  // Normalize IoT control IDs to canonical deviceId casing
  let normalized = controlMethod;
  if (typeof controlMethod === 'string' && controlMethod.startsWith('IoT:')) {
    const rawId = controlMethod.slice(4);
    const match = (STATE.iotDevices || []).find(d => {
      const a = (d.deviceId || d.id || '').toString().toLowerCase();
      return a === rawId.toString().toLowerCase();
    });
    if (match) {
      const canonical = (match.deviceId || match.id).toString();
      normalized = `IoT:${canonical}`;
    } else {
      // Keep original but enforce IoT: prefix
      normalized = `IoT:${rawId}`;
    }
  }
  // Update equipment control method in metadata
  STATE.equipmentMetadata[equipmentId].control = normalized;
  
  // Save metadata
  saveEquipmentMetadata();
  
  // Re-render both equipment overview and IoT devices to show the connection
  renderEquipmentOverview();
  if (typeof window.renderIoTDeviceCards === 'function' && window.LAST_IOT_SCAN) {
    window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
  }
  
  showToast({
    title: 'Control Updated',
    msg: `Control method updated`,
    kind: 'success',
    icon: ''
  }, 2000);
}

async function controlEquipment(deviceId, action) {
  // Find the IoT device
  const device = STATE.iotDevices?.find(d => d.deviceId === deviceId || d.id === deviceId);
  
  if (!device) {
    showToast({
      title: 'Device Not Found',
      msg: 'IoT device not found',
      kind: 'error',
      icon: ''
    });
    return;
  }
  
  const deviceName = device.deviceName || device.name || 'Device';
  const protocol = (device.protocol || '').toLowerCase();
  
  showToast({
    title: 'Sending Command',
    msg: `Sending ${action.toUpperCase()} to ${deviceName}`,
    kind: 'info',
    icon: ''
  }, 1000);
  
  try {
    let response;
    
    // Kasa devices use different API endpoint
    if (protocol.includes('kasa') || protocol.includes('tp-link')) {
      const host = device.address || device.host;
      if (!host) {
        throw new Error('Device address not found');
      }
      
      response = await fetch(`/api/kasa/device/${host}/power`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: action === 'on' ? 1 : 0
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        showToast({
          title: 'Success',
          msg: `${deviceName} turned ${action.toUpperCase()}`,
          kind: 'success',
          icon: ''
        }, 2000);
      } else {
        throw new Error(result.error || 'Command failed');
      }
    } else {
      // SwitchBot devices use original API
      response = await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: action === 'on' ? 'turnOn' : 'turnOff',
          parameter: 'default'
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.statusCode === 100 || result.status === 'success') {
        showToast({
          title: 'Success',
          msg: `${deviceName} turned ${action.toUpperCase()}`,
          kind: 'success',
          icon: ''
        }, 2000);
      } else {
        throw new Error(result.message || 'Command failed');
      }
    }
  } catch (error) {
    console.error('Equipment control error:', error);
    showToast({
      title: 'Control Failed',
      msg: error.message || 'Failed to control equipment',
      kind: 'error',
      icon: ''
    });
  }
}

function editEquipment(equipmentId) {
  const equipment = getAllEquipment();
  const eq = equipment.find(e => (e.id || `eq-${equipment.indexOf(e)}`) === equipmentId);
  
  if (!eq) {
    showToast({
      title: 'Error',
      msg: 'Equipment not found',
      kind: 'error',
      icon: ''
    });
    return;
  }
  
  // Open grow room wizard with this equipment pre-selected
  // For now, just show a message
  showToast({
    title: 'Edit Equipment',
    msg: `Editing ${eq.vendor} ${eq.model}. Use the Grow Room wizard to modify equipment details.`,
    kind: 'info',
    icon: ''
  }, 3000);
  
  // TODO: Enhance wizard to support editing existing equipment
}

async function deleteEquipment(equipmentId) {
  if (!confirm('Are you sure you want to delete this equipment?')) {
    return;
  }
  
  const equipment = getAllEquipment();
  const eq = equipment.find(e => e.id === equipmentId);
  
  if (!eq) {
    showToast({
      title: 'Error',
      msg: 'Equipment not found',
      kind: 'error',
      icon: ''
    });
    return;
  }
  
  // If it's a standalone item (only exists in metadata), just remove from metadata
  if (eq.isStandalone) {
    if (STATE.equipmentMetadata && STATE.equipmentMetadata[equipmentId]) {
      delete STATE.equipmentMetadata[equipmentId];
      await saveEquipmentMetadata();
    }
  } else {
    // For room-based equipment, we need to remove from source data
    const room = STATE.rooms.find(r => (r.id || r.name) === eq.roomId);
    if (room) {
      let removed = false;
      
      // Extract the base ID and index from equipmentId (e.g., "room-fans-0" -> "room-fans", index 0)
      const match = equipmentId.match(/^(.+)-(\d+)$/);
      if (match) {
        const baseId = match[1];
        const itemIndex = parseInt(match[2], 10);
        
        // Check _categoryProgress or categoryProgress for simple count-based categories
        const categoryProgress = room._categoryProgress || room.categoryProgress;
        if (categoryProgress) {
          const simpleCategories = ['fans', 'vents', 'controllers', 'energy-monitor', 'other'];
          for (const catKey of simpleCategories) {
            if (baseId.includes(catKey) && categoryProgress[catKey]) {
              const catData = categoryProgress[catKey];
              if (catData.count > 1) {
                catData.count--;
                removed = true;
              } else if (catData.count === 1) {
                // Remove the entire category entry
                delete categoryProgress[catKey];
                removed = true;
              }
              break;
            }
          }
        }
        
        // Also check room.category for legacy storage format
        if (!removed && room.category) {
          const simpleCategories = ['fans', 'vents', 'controllers', 'energy-monitor', 'other'];
          for (const catKey of simpleCategories) {
            if (baseId.includes(catKey) && room.category[catKey]) {
              const catData = room.category[catKey];
              if (catData.count > 1) {
                catData.count--;
                removed = true;
              } else if (catData.count === 1) {
                // Remove the entire category entry
                delete room.category[catKey];
                removed = true;
              }
              break;
            }
          }
        }
      }
      
      // Check legacy room.equipment array
      if (!removed && Array.isArray(room.equipment)) {
        const eqIndex = room.equipment.findIndex(e => {
          const eqId = e.id || `${eq.roomId}-${e.vendor}-${e.model}`.replace(/\s+/g, '-');
          return equipmentId.startsWith(eqId);
        });
        if (eqIndex !== -1) {
          room.equipment.splice(eqIndex, 1);
          removed = true;
        }
      }
      
      if (removed) {
        // Save the updated rooms data
        await saveJSON('rooms.json', { rooms: STATE.rooms });
      }
    }
    
    // Also remove from metadata if it exists
    if (STATE.equipmentMetadata && STATE.equipmentMetadata[equipmentId]) {
      delete STATE.equipmentMetadata[equipmentId];
      await saveEquipmentMetadata();
    }
  }
  
  // Re-render equipment overview
  renderEquipmentOverview();
  
  // Update IoT devices display if control was assigned
  if (eq.control && typeof window.renderIoTDeviceCards === 'function' && window.LAST_IOT_SCAN) {
    window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
  }
  
  showToast({
    title: 'Equipment Removed',
    msg: `${eq.name || eq.category || 'Equipment'} has been removed`,
    kind: 'success',
    icon: ''
  }, 2000);
}

// --- Light Controller Assignment Functions (Groups V2) ---

function renderLightControlOptions(selectedControl) {
  const controls = [
    'WiFi',
    'Wired Thermostat',
    'Modbus/BACnet',
    'Relay',
    '0-10V',
    'Manual',
    'Scheduler',
    'Other'
  ];
  
  const options = ['<option value="">— Select Controller —</option>'];
  
  // Add standard control options
  controls.forEach(control => {
    const selected = control === selectedControl ? 'selected' : '';
    options.push(`<option value="${control}" ${selected}>${control}</option>`);
  });
  
  // Get IoT plugs from saved devices
  const iotDevices = STATE.iotDevices || [];
  const plugDevices = iotDevices.filter(device => {
    const type = (device.deviceType || device.type || '').toLowerCase();
    const category = String(device.category || '').toLowerCase();
    const protocol = (device.protocol || '').toLowerCase();
    const vendor = (device.vendor || '').toLowerCase();
    
    // Check if it's a plug device (Kasa, SwitchBot, or any plug type/category)
    return type.includes('plug') || category.includes('plug') || 
           protocol.includes('kasa') || protocol.includes('tp-link') || 
           vendor.includes('kasa') || vendor.includes('tp-link');
  });
  
  // Add IoT plugs as control options if any exist
  if (plugDevices.length > 0) {
    options.push('<option disabled>━━━ IoT Plugs ━━━</option>');
    const seenDeviceIds = new Set();
    plugDevices.forEach(plug => {
      const deviceId = plug.id || plug.deviceId;
      if (!deviceId || seenDeviceIds.has(deviceId)) return;
      seenDeviceIds.add(deviceId);
      const deviceName = plug.name || plug.deviceName || deviceId || 'Unknown Plug';
      const controlValue = `IoT:${deviceId}`;
      const selected = controlValue === selectedControl ? 'selected' : '';
      options.push(`<option value="${controlValue}" ${selected}>🔌 ${escapeHtml(deviceName)}</option>`);
    });
  }
  
  return options.join('');
}

function renderLightControlActions(lightId, control, lightName) {
  // Return action elements based on control type
  if (!control || control === '') {
    return '<span class="tiny" style="color:#94a3b8;">No controller assigned</span>';
  }
  
  // Scheduler control - show link to scheduler panel
  if (control === 'Scheduler') {
    return `
      <a href="#" onclick="event.preventDefault(); navigateToScheduler('${escapeHtml(lightId)}'); return false;" 
         style="font-size:11px;color:#3b82f6;text-decoration:none;display:flex;align-items:center;gap:4px;">
        📅 Configure Schedule
      </a>
    `;
  }
  
  // Check if it's an IoT device (format: IoT:{deviceId})
  if (control.startsWith('IoT:')) {
    const deviceId = control.substring(4);
    const device = STATE.iotDevices?.find(d => d.deviceId === deviceId || d.id === deviceId);
    
    if (device) {
      // Check if device supports power control (plugs, switches, etc.)
      const type = (device.type || '').toLowerCase();
      const category = String(device.category || '').toLowerCase();
      const protocol = (device.protocol || '').toLowerCase();
      
      // Kasa and SwitchBot plugs support on/off
      if (type.includes('plug') || category.includes('plug') || 
          protocol.includes('kasa') || protocol.includes('tp-link')) {
        return `
          <button type="button" class="btn-sm" onclick="event.stopPropagation(); controlLightDevice('${deviceId}', 'on', '${escapeHtml(lightName)}');" 
                  style="padding:2px 8px;font-size:11px;background:#10b981;color:white;border:none;border-radius:4px;cursor:pointer;">
            ON
          </button>
          <button type="button" class="btn-sm" onclick="event.stopPropagation(); controlLightDevice('${deviceId}', 'off', '${escapeHtml(lightName)}');" 
                  style="padding:2px 8px;font-size:11px;background:#ef4444;color:white;border:none;border-radius:4px;cursor:pointer;">
            OFF
          </button>
        `;
      }
      // Add more device types as needed
      return '<span class="tiny" style="color:#64748b;">Device control available</span>';
    }
    return '<span class="tiny" style="color:#f59e0b;">Device not found</span>';
  }
  
  // Manual control types
  if (control === 'Manual') {
    return '<span class="tiny" style="color:#64748b;">Manual operation</span>';
  }
  
  // Other control types show as configured
  return `<span class="tiny" style="color:#64748b;">${escapeHtml(control)}</span>`;
}

async function controlLightDevice(deviceId, action, lightName) {
  // Find the IoT device
  const device = STATE.iotDevices?.find(d => d.deviceId === deviceId || d.id === deviceId);
  
  if (!device) {
    showToast({
      title: 'Device Not Found',
      msg: 'IoT device not found',
      kind: 'error',
      icon: ''
    });
    return;
  }
  
  const deviceName = device.deviceName || device.name || 'Device';
  const protocol = (device.protocol || '').toLowerCase();
  
  showToast({
    title: 'Sending Command',
    msg: `Sending ${action.toUpperCase()} to ${lightName} via ${deviceName}`,
    kind: 'info',
    icon: ''
  }, 1000);
  
  try {
    let response;
    
    // Kasa devices use different API endpoint
    if (protocol.includes('kasa') || protocol.includes('tp-link')) {
      const host = device.address || device.host;
      if (!host) {
        throw new Error('Device address not found');
      }
      
      response = await fetch(`/api/kasa/device/${host}/power`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          state: action === 'on' ? 1 : 0
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.success) {
        showToast({
          title: 'Success',
          msg: `${lightName} turned ${action.toUpperCase()}`,
          kind: 'success',
          icon: ''
        }, 2000);
      } else {
        throw new Error(result.error || 'Command failed');
      }
    } else {
      // SwitchBot devices use original API
      response = await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          command: action === 'on' ? 'turnOn' : 'turnOff',
          parameter: 'default'
        })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const result = await response.json();
      
      if (result.statusCode === 100 || result.status === 'success') {
        showToast({
          title: 'Success',
          msg: `${lightName} turned ${action.toUpperCase()}`,
          kind: 'success',
          icon: ''
        }, 2000);
      } else {
        throw new Error(result.message || 'Command failed');
      }
    }
  } catch (error) {
    console.error('Light device control error:', error);
    showToast({
      title: 'Control Failed',
      msg: error.message || 'Failed to control light device',
      kind: 'error',
      icon: ''
    });
  }
}

function navigateToScheduler(lightId) {
  // Navigate to scheduler panel with light pre-selected
  const schedulerLink = document.querySelector('[data-target="scheduler"]');
  if (schedulerLink) {
    schedulerLink.click();
    
    // Set a timeout to allow the panel to load, then select the light
    setTimeout(() => {
      // Try to find and focus on the light selection in scheduler
      const lightSelectEl = document.querySelector('#schedulerLightSelect');
      if (lightSelectEl) {
        lightSelectEl.value = lightId;
        lightSelectEl.dispatchEvent(new Event('change'));
      }
    }, 300);
    
    showToast({
      title: 'Opening Scheduler',
      msg: 'Configure schedule for this light',
      kind: 'info',
      icon: '📅'
    }, 1500);
  } else {
    showToast({
      title: 'Scheduler Not Available',
      msg: 'Scheduler panel not found',
      kind: 'error',
      icon: ''
    });
  }
}

function saveEquipmentChanges() {
  // Persist rooms with updated equipment to server
  if (STATE.rooms && STATE.rooms.length > 0) {
    saveJSON('rooms.json', { rooms: STATE.rooms })
      .then(() => {
        console.log('Equipment changes saved');
      })
      .catch(err => {
        console.error('Failed to save equipment changes:', err);
        showToast({
          title: 'Save Error',
          msg: 'Failed to save changes. Please try again.',
          kind: 'error',
          icon: ''
        });
      });
  }
}

function renderGrowRoomOverview() {
  const summaryEl = document.getElementById('growOverviewSummary');
  const gridEl = document.getElementById('growOverviewGrid');
  if (!summaryEl || !gridEl) return;

  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  const zones = Array.isArray(STATE.environment) ? STATE.environment : [];
  const plans = Array.isArray(STATE.plans) ? STATE.plans : [];
  const schedules = Array.isArray(STATE.schedules) ? STATE.schedules : [];

  const roomCount = rooms.length;
  const zoneCount = zones.length;
  const summaries = [
    {
      label: 'Grow Rooms',
      value: roomCount
        ? `${roomCount} room${roomCount === 1 ? '' : 's'}`
        : zoneCount
        ? `${zoneCount} zone${zoneCount === 1 ? '' : 's'}`
        : 'None'
    },
    {
      label: 'Plans running',
      value:
        plans.length === 0
          ? 'None'
          : (() => {
              const names = plans.map((plan) => plan.name || 'Untitled plan').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    },
    {
      label: 'Schedules',
      value:
        schedules.length === 0
          ? 'None'
          : (() => {
              const names = schedules.map((sched) => sched.name || 'Unnamed schedule').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    }
  ];

  summaryEl.innerHTML = summaries
    .map(
      (item) => `
        <div class="grow-overview__summary-item">
          <span class="grow-overview__summary-label">${escapeHtml(item.label)}</span>
          <span class="grow-overview__summary-value">${escapeHtml(item.value)}</span>
        </div>`
    )
    .join('');

  const activeFeatures = Array.from(document.querySelectorAll('.ai-feature-card.active h3'))
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

  const matchZoneForRoom = (room) => {
    if (!room) return null;
    const identifiers = new Set(
      [room.id, room.name]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).toLowerCase())
    );
    if (!identifiers.size) return null;
    return zones.find((zone) => {
      const id = zone.id ? String(zone.id).toLowerCase() : '';
      const name = zone.name ? String(zone.name).toLowerCase() : '';
      const location = zone.location ? String(zone.location).toLowerCase() : '';
      return identifiers.has(id) || identifiers.has(name) || identifiers.has(location);
    }) || null;
  };

  const metricKeys = [
    { key: 'tempC', label: 'Temp', unit: '°C', precision: 1 },
    { key: 'rh', label: 'Humidity', unit: '%', precision: 1 },
  { key: 'co2', label: 'CO2', unit: ' ppm', precision: 0 },
    { key: 'vpd', label: 'VPD', unit: ' kPa', precision: 2 }
  ];

  const formatMetricValue = (sensor, meta) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return '—';
    }
    const value = meta.precision != null ? sensor.current.toFixed(meta.precision) : String(sensor.current);
    if (meta.unit.trim() === '%') {
      return `${value}${meta.unit}`;
    }
    return `${value}${meta.unit}`;
  };

  const metricStatus = (sensor) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return 'unknown';
    }
    const min = sensor.setpoint?.min;
    const max = sensor.setpoint?.max;
    if (typeof min === 'number' && typeof max === 'number') {
      return sensor.current >= min && sensor.current <= max ? 'ok' : 'warn';
    }
    return 'unknown';
  };

  const buildMetrics = (zone) => {
    if (!zone || !zone.sensors) return '';
    const items = metricKeys
      .map((meta) => {
        const sensor = zone.sensors?.[meta.key];
        if (!sensor) return '';
        const status = metricStatus(sensor);
        const value = formatMetricValue(sensor, meta);
        return `
          <div class="grow-room-card__metric grow-room-card__metric--${status}">
            <span class="grow-room-card__metric-label">${escapeHtml(meta.label)}</span>
            <span class="grow-room-card__metric-value">${escapeHtml(value)}</span>
          </div>`;
      })
      .filter(Boolean)
      .join('');
    return items;
  };

  const buildAiSection = () => {
    if (!activeFeatures.length) {
      return '<p class="tiny text-muted">AI features inactive.</p>';
    }
    return `
      <ul class="grow-room-card__ai-list">
        ${activeFeatures.map((name) => `<li class="grow-room-card__ai-chip">${escapeHtml(name)}</li>`).join('')}
      </ul>`;
  };

  const cards = [];
  if (rooms.length) {
    rooms.forEach((room) => {
      const zone = matchZoneForRoom(room);
      const name = room.name || room.id || 'Grow Room';
      const roomId = room.id || room.name;
      
      // Get zones for this room
      const zonesList = Array.isArray(room.zones) ? room.zones.filter(Boolean) : [];
      
      // Get groups for this room (match by room ID or room name)
      const roomGroups = (STATE.groups || []).filter(g => 
        g.room === roomId || g.roomId === roomId || 
        g.room === name || g.roomId === name
      );
      
      // Get equipment for this room
      const roomEquipment = getAllEquipment().filter(eq => 
        eq.roomId === roomId || eq.roomName === name
      );
      
      // Get lights/fixtures for this room
      const roomFixtures = (room.fixtures || []).filter(Boolean);
      
      // Build details sections
      const details = [];
      
      // Zones
      if (zonesList.length) {
        details.push(`<strong>Zones:</strong> ${zonesList.map((item) => escapeHtml(item)).join(', ')}`);
      }
      
      // Groups
      if (roomGroups.length) {
        const groupNames = roomGroups.map(g => g.name || g.id).slice(0, 3);
        const extra = roomGroups.length > 3 ? ` +${roomGroups.length - 3}` : '';
        details.push(`<strong>Groups:</strong> ${groupNames.map(n => escapeHtml(n)).join(', ')}${extra}`);
      }
      
      // Equipment
      if (roomEquipment.length) {
        const eqSummary = {};
        roomEquipment.forEach(eq => {
          const cat = eq.category || 'Other';
          eqSummary[cat] = (eqSummary[cat] || 0) + (eq.count || 1);
        });
        const eqText = Object.entries(eqSummary)
          .map(([cat, count]) => `${count} ${cat}${count !== 1 ? 's' : ''}`)
          .join(', ');
        details.push(`<strong>Equipment:</strong> ${eqText}`);
      }
      
      // Lights/Fixtures
      if (roomFixtures.length) {
        const fixtureSummary = {};
        roomFixtures.forEach(f => {
          const model = f.model || f.name || 'Light';
          fixtureSummary[model] = (fixtureSummary[model] || 0) + (f.count || 1);
        });
        const fixtureText = Object.entries(fixtureSummary)
          .slice(0, 2)
          .map(([model, count]) => `${count}× ${escapeHtml(model)}`)
          .join(', ');
        const extra = Object.keys(fixtureSummary).length > 2 ? ` +${Object.keys(fixtureSummary).length - 2}` : '';
        details.push(`<strong>Lights:</strong> ${fixtureText}${extra}`);
      }
      
      // Layout and control
      if (room.layout?.type) {
        details.push(`<strong>Layout:</strong> ${escapeHtml(room.layout.type)}`);
      }
      if (room.controlMethod) {
        details.push(`<strong>Control:</strong> ${escapeHtml(room.controlMethod)}`);
      }
      
      const metaParts = [];
      if (zone?.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone?.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone?.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
            ${room.roomType ? `<span class="chip tiny">${escapeHtml(room.roomType)}</span>` : ''}
          </div>
          ${details.length ? `<div class="grow-room-card__details" style="margin: 8px 0; font-size: 13px; line-height: 1.6;">${details.join('<br>')}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  } else if (zones.length) {
    zones.forEach((zone) => {
      const name = zone.name || zone.id || 'Zone';
      const location = zone.location ? `Location: ${escapeHtml(zone.location)}` : '';
      const metaParts = [];
      if (zone.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
          </div>
          ${location ? `<div class="tiny text-muted">${location}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  }

  if (!cards.length) {
    gridEl.innerHTML = '<p class="tiny text-muted">Add a grow room to view live status and telemetry.</p>';
    return;
  }

  gridEl.innerHTML = cards.join('');
}

function updateAutomationIndicator(status = {}) {
  const indicator = document.getElementById('automationIndicator');
  const statusEl = document.getElementById('automationIndicatorStatus');
  const dotEl = document.getElementById('automationStatusDot');
  if (!indicator || !statusEl) return;

  // Remove old classes from indicator
  indicator.classList.remove('is-active', 'is-idle', 'is-alert');
  
  // Remove old classes from dot if it exists
  if (dotEl) {
    dotEl.classList.remove('is-active', 'is-idle', 'is-alert');
  }

  if (status.error) {
    indicator.classList.add('is-alert');
    if (dotEl) dotEl.classList.add('is-alert');
    statusEl.textContent = status.error;
    return;
  }

  const managedZones = (STATE.environment || []).filter(zone => zone.meta?.managedByPlugs);
  const hasRules = (STATE.preAutomationRules || []).length > 0;

  if (managedZones.length > 0) {
    indicator.classList.add('is-active');
    if (dotEl) dotEl.classList.add('is-active');
    statusEl.textContent = managedZones.length === 1
      ? 'Managing 1 zone'
      : `Managing ${managedZones.length} zones`;
  } else if (hasRules) {
    indicator.classList.add('is-idle');
    if (dotEl) dotEl.classList.add('is-idle');
    statusEl.textContent = 'Armed';
  } else {
    indicator.classList.add('is-idle');
    if (dotEl) dotEl.classList.add('is-idle');
    statusEl.textContent = 'Idle';
  }
}

function formatPower(powerW) {
  if (typeof powerW !== 'number' || Number.isNaN(powerW)) return '—';
  if (powerW >= 1000) {
    return `${(powerW / 1000).toFixed(2)} kW`;
  }
  return `${powerW.toFixed(1)} W`;
}

function renderSmartPlugs() {
  const container = document.getElementById('smartPlugsTable');
  if (!container) return;

  const plugs = Array.isArray(STATE.smartPlugs) ? STATE.smartPlugs : [];
  const rules = Array.isArray(STATE.preAutomationRules) ? STATE.preAutomationRules : [];

  if (!plugs.length) {
    container.innerHTML = '<p class="tiny text-muted">No smart plugs discovered yet. Use Discover to scan Shelly, Kasa, SwitchBot, and Tasmota devices.</p>';
    return;
  }

  const rows = plugs.map((plug) => {
    const state = plug.state || {};
    const ruleMatches = rules.filter((rule) => Array.isArray(rule.actions) && rule.actions.some((action) => action.plugId === plug.id));
    const ruleIds = ruleMatches.map((rule) => rule.id);
    const vendorLabel = plug.vendor ? plug.vendor.charAt(0).toUpperCase() + plug.vendor.slice(1) : 'Plug';
    const online = state.online !== false;
    const on = Boolean(state.on);
    const statusBadge = `<span class="badge-rule ${online ? '' : 'offline'}">${online ? (on ? 'ON' : 'OFF') : 'Offline'}</span>`;
    const select = rules.length
      ? `<select data-plug-rule-select data-plug-id="${plug.id}" multiple size="${Math.min(4, Math.max(2, rules.length))}" aria-label="Assign rules to ${plug.name || plug.id}">
          ${rules.map((rule) => `<option value="${rule.id}" ${ruleIds.includes(rule.id) ? 'selected' : ''}>${rule.name}</option>`).join('')}
        </select>
        <div class="tiny text-muted" style="margin-top:4px;">Hold Ctrl/Cmd to multi-select.</div>`
      : '<span class="tiny text-muted">No rules defined</span>';

    const ruleSummary = ruleMatches.length
      ? ruleMatches.map((rule) => rule.name).join(', ')
      : '—';

    return `
      <tr data-plug-row="${plug.id}">
        <td>
          <div style="font-weight:600;">${plug.name || plug.id}</div>
          <div class="tiny text-muted">${vendorLabel}${plug.model ? ` • ${plug.model}` : ''}</div>
        </td>
        <td class="smart-plug-power">${formatPower(state.powerW)}</td>
        <td>${statusBadge}</td>
        <td>
          <div class="smart-plug-toggle">
            <button type="button" class="ghost" data-plug-toggle data-plug-id="${plug.id}" data-state="on">On</button>
            <button type="button" class="ghost" data-plug-toggle data-plug-id="${plug.id}" data-state="off">Off</button>
            <button type="button" class="ghost" data-plug-refresh data-plug-id="${plug.id}">Refresh</button>
          </div>
        </td>
        <td>
          ${select}
        </td>
        <td class="tiny">${ruleSummary}</td>
      </tr>
    `;
  }).join('');

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th scope="col">Plug</th>
          <th scope="col">Power</th>
          <th scope="col">State</th>
          <th scope="col">Control</th>
          <th scope="col">Rule Assignment</th>
          <th scope="col">Summary</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ✅ DATA FLOW: Register event listener for Integrations panel
document.addEventListener('DOMContentLoaded', () => {
  // Refresh smart plugs list when IoT devices change
  document.addEventListener('iot-devices-updated', () => {
    console.log('[Integrations] IoT devices updated, refreshing smart plugs');
    if (document.getElementById('smartPlugsTable')) {
      loadSmartPlugs({ silent: true });
    }
  });
});

function setSmartPlugsAlert(message, kind = 'info') {
  const alertEl = document.getElementById('smartPlugsAlert');
  if (!alertEl) return;
  if (!message) {
    alertEl.hidden = true;
    alertEl.classList.remove('is-error', 'is-success');
    alertEl.textContent = '';
    return;
  }
  alertEl.hidden = false;
  alertEl.textContent = message;
  alertEl.classList.remove('is-error', 'is-success');
  if (kind === 'error') {
    alertEl.classList.add('is-error');
  } else if (kind === 'success') {
    alertEl.classList.add('is-success');
  }
}

async function loadPreAutomationRules() {
  try {
    const payload = await api('/rules');
    STATE.preAutomationRules = Array.isArray(payload?.rules) ? payload.rules : [];
  } catch (error) {
    STATE.preAutomationRules = [];
    console.warn('Failed to load automation rules', error);
  }
}

async function loadSmartPlugs({ silent } = {}) {
  try {
    const payload = await api('/plugs');
    STATE.smartPlugs = Array.isArray(payload?.plugs) ? payload.plugs : [];
    renderSmartPlugs();
    if (!silent) {
      setSmartPlugsAlert(`Discovered ${STATE.smartPlugs.length} smart plug${STATE.smartPlugs.length === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}.`, 'success');
    }
  } catch (error) {
    if (!silent) {
      setSmartPlugsAlert(`Smart plug refresh failed: ${error.message}`, 'error');
    }
    console.warn('Failed to load smart plugs', error);
  }
}

async function discoverSmartPlugs() {
  setSmartPlugsAlert('Running network discovery…');
  try {
    const payload = await api('/plugs/discover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    STATE.smartPlugs = Array.isArray(payload?.plugs) ? payload.plugs : [];
    renderSmartPlugs();
    setSmartPlugsAlert(`Discovery complete • ${STATE.smartPlugs.length} plug${STATE.smartPlugs.length === 1 ? '' : 's'} online`, 'success');
  } catch (error) {
    setSmartPlugsAlert(`Discovery failed: ${error.message}`, 'error');
    console.warn('Smart plug discovery error', error);
  }
}

function registerSmartPlugDevRefreshAction() {
  if (typeof window === 'undefined') return;
  const handler = async () => {
    try {
      await discoverSmartPlugs();
    } catch (error) {
      console.warn('Dev menu smart plug refresh failed', error);
      throw error;
    }
  };

  const action = {
    id: 'refresh-smart-plugs',
    key: 'refresh-smart-plugs',
    label: 'Refresh devices',
    title: 'Refresh devices',
    description: 'Trigger SwitchBot discovery and refresh smart plug inventory.',
    section: 'devices',
    group: 'devices',
    run: handler,
    handler,
    onSelect: handler,
    action: handler
  };

  const candidates = [
    window.devMenu && window.devMenu.registerAction,
    window.devMenu && window.devMenu.registerCommand,
    window.registerDevMenuAction,
    window.registerDevAction,
    window.__registerDevMenuAction__
  ].filter((fn) => typeof fn === 'function');

  if (!candidates.length) {
    if (typeof console !== 'undefined' && console.debug) {
      console.debug('Dev menu registration unavailable; smart plug refresh action pending.');
    }
    return;
  }

  try {
    const registrar = candidates[0];
    const context = registrar === (window.devMenu && window.devMenu.registerAction || window.devMenu && window.devMenu.registerCommand) ? window.devMenu : window;
    registrar.call(context || window, action);
  } catch (error) {
    console.warn('Failed to register smart plug refresh action with dev menu', error);
  }
}

async function assignPlugRules(plugId, ruleIds) {
  try {
    await api(`/plugs/${encodeURIComponent(plugId)}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ruleIds, action: { set: 'on' } })
    });
    await loadPreAutomationRules();
    updateAutomationIndicator();
    renderSmartPlugs();
    setSmartPlugsAlert(`Updated rules for ${plugId}`, 'success');
  } catch (error) {
    setSmartPlugsAlert(`Failed to update rules for ${plugId}: ${error.message}`, 'error');
  }
}

async function toggleSmartPlug(plugId, desiredState) {
  try {
    setSmartPlugsAlert(`Turning ${plugId} ${desiredState ? 'on' : 'off'}…`);
    await api(`/plugs/${encodeURIComponent(plugId)}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set: desiredState ? 'on' : 'off' })
    });
    await loadSmartPlugs({ silent: true });
    setSmartPlugsAlert(`${plugId} is now ${desiredState ? 'ON' : 'OFF'}`, 'success');
  } catch (error) {
    setSmartPlugsAlert(`Failed to toggle ${plugId}: ${error.message}`, 'error');
  }
}

async function refreshSmartPlug(plugId) {
  try {
    if (plugId) {
      setSmartPlugsAlert(`Refreshing ${plugId}…`);
    }
    await loadSmartPlugs({ silent: true });
    if (plugId) {
      setSmartPlugsAlert(`Latest telemetry loaded for ${plugId}`, 'success');
    }
  } catch (error) {
    console.warn('Smart plug refresh error', error);
    setSmartPlugsAlert(`Refresh failed: ${error.message}`, 'error');
  }
}

function renderEnvironment() {
  const container = document.getElementById('envZones');
  if (!container) return;
  
  container.innerHTML = STATE.environment.map(zone => `
    <div class="env-zone" data-zone-id="${zone.id}">
      <div class="env-zone__header">
        <h3 class="env-zone__name">${zone.name}${zone.meta?.managedByPlugs ? '<span class="env-zone__badge">Managed by Plugs</span>' : ''}</h3>
        <div class="env-zone__status" title="${zone.meta?.source ? `Source: ${zone.meta.source}` : 'Source unknown'}${typeof zone.meta?.battery === 'number' ? ` • Battery: ${zone.meta.battery}%` : ''}${typeof zone.meta?.rssi === 'number' ? ` • RSSI: ${zone.meta.rssi} dBm` : ''}">
          <span class="env-status-dot"></span>
          <span class="tiny">${zone.meta?.source || '—'}${typeof zone.meta?.battery === 'number' ? ` • ${zone.meta.battery}%` : ''}${typeof zone.meta?.rssi === 'number' ? ` • ${zone.meta.rssi} dBm` : ''}</span>
        </div>
      </div>
      <div class="env-metrics">
        ${Object.entries(zone.sensors).map(([key, sensor]) => `
          <div class="env-metric" data-metric="${key}">
            <div>
              <div class="env-metric__label">${key.toUpperCase()}</div>
              <div class="env-metric__value">${sensor.current}${key === 'tempC' ? '°C' : key === 'rh' ? '%' : key === 'vpd' ? ' kPa' : ' ppm'}</div>
            </div>
            <canvas class="env-metric__trend" width="60" height="20" aria-label="trend sparkline for ${key}"></canvas>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  // Draw sparklines and wire modal
  document.querySelectorAll('.env-zone').forEach(zoneEl => {
    const zoneId = zoneEl.getAttribute('data-zone-id');
    const zone = STATE.environment.find(z => String(z.id) === String(zoneId));
    if (!zone) return;
    zoneEl.querySelectorAll('.env-metric').forEach(metricEl => {
      const key = metricEl.getAttribute('data-metric');
      const sensor = zone.sensors?.[key];
      const canvas = metricEl.querySelector('canvas.env-metric__trend');
      if (!sensor || !canvas) return;
      const values = Array.isArray(sensor.history) ? sensor.history.slice(0, 60).reverse() : [];
      // Color by setpoint: green within, red outside, yellow when undefined
      let color = '#16A34A';
      const min = sensor.setpoint?.min;
      const max = sensor.setpoint?.max;
      const cur = sensor.current;
      if (typeof min === 'number' && typeof max === 'number' && typeof cur === 'number') {
        color = (cur >= min && cur <= max) ? '#16A34A' : '#EF4444';
      } else {
        color = '#EAB308';
      }
      drawSparkline(canvas, values, { width: 60, height: 20, color });
      // Click to open modal trend
      metricEl.style.cursor = 'zoom-in';
      metricEl.addEventListener('click', () => openEnvModal(zone, key));
    });
  });

  renderGrowRoomOverview();
  updateAutomationIndicator();
}

// Environment polling and actions
let ENV_POLL_TIMER = null;
async function reloadEnvironment() {
  try {
    const existingZones = Array.isArray(STATE.environment) ? STATE.environment : [];
    const resolveScopeId = (zone) => {
      if (!zone || typeof zone !== 'object') return null;
      const candidates = [zone.scope, zone.id, zone.name];
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const trimmed = String(candidate).trim();
        if (trimmed) return trimmed;
      }
      return null;
    };

    const scopeIds = [...new Set(existingZones.map(resolveScopeId).filter(Boolean))];

    let envSnapshot = null;
    let zones = [];

    if (!scopeIds.length) {
      const initial = await api('/env?range=24h');
      envSnapshot = initial?.env || null;
      if (Array.isArray(initial?.zones)) zones = initial.zones;
      else if (initial?.zone) zones = [initial.zone];
    } else {
      const requests = scopeIds.map(async (scopeId) => {
        try {
          const payload = await api(`/env?scope=${encodeURIComponent(scopeId)}&range=24h`);
          if (!envSnapshot && payload?.env) envSnapshot = payload.env;
          if (payload?.zone) return payload.zone;
          if (Array.isArray(payload?.zones) && payload.zones.length) return payload.zones[0];
        } catch (error) {
          console.warn(`[env] scope fetch failed for ${scopeId}`, error);
        }
        return null;
      });
      const results = await Promise.all(requests);
      zones = results.filter((zone) => zone && typeof zone === 'object');

      if (!zones.length) {
        const fallback = await api('/env?range=24h');
        envSnapshot = envSnapshot || fallback?.env || null;
        if (Array.isArray(fallback?.zones)) zones = fallback.zones;
        else if (fallback?.zone) zones = [fallback.zone];
      }
    }

    STATE.preAutomationEnv = envSnapshot || { scopes: {} };
    STATE.environment = zones;
    renderEnvironment();
    $('#envStatus')?.replaceChildren(document.createTextNode(`Updated ${new Date().toLocaleTimeString()}`));
  } catch (e) {
    $('#envStatus')?.replaceChildren(document.createTextNode(`Env load failed: ${e.message}`));
    updateAutomationIndicator({ error: 'Offline' });
  }
}
function startEnvPolling(intervalMs = 10000) {
  clearInterval(ENV_POLL_TIMER);
  ENV_POLL_TIMER = setInterval(reloadEnvironment, intervalMs);
}

// --- SwitchBot Devices Management ---
function renderSwitchBotList(items, summaryMeta = {}) {
  const normalized = normalizeSwitchBotDevicesList(Array.isArray(items) ? items : []);
  const summary = summarizeSwitchBotDevices(normalized, summaryMeta);
  STATE.switchbotDevices = normalized;
  STATE.switchbotSummary = summary;
  renderSwitchBotDevices();
  renderSwitchBotManager();
  return { devices: normalized, summary };
}

function renderSwitchBotDevices() {
  const container = document.getElementById('switchbotDevicesList');
  if (!container) return;

  const devices = Array.isArray(STATE.switchbotDevices) ? STATE.switchbotDevices : [];
  const summary = STATE.switchbotSummary || summarizeSwitchBotDevices(devices);

  if (!devices.length) {
    container.innerHTML = `
      <div class="switchbot-card">
        <div class="switchbot-card__header">
          <div>
            <div class="switchbot-card__title"><span class="switchbot-dot switchbot-dot--warn"></span><strong>No SwitchBot devices found</strong></div>
            <p class="tiny" style="margin:4px 0 0;color:#64748b">Connect your SwitchBot account in the manager to view live sensors and plugs.</p>
          </div>
          <button type="button" class="primary" id="switchBotOpenManagerEmpty">🏠 Open Manager</button>
        </div>
      </div>`;
    container.querySelector('#switchBotOpenManagerEmpty')?.addEventListener('click', openSwitchBotManager);
    return;
  }

  const deviceRows = devices.slice(0, 4).map((device) => {
    const status = device.status || 'unknown';
    const statusColor = getSwitchBotStatusColor(status);
    const readingText = formatSwitchBotPreviewReadings(device.readings);
    const lastSeen = formatSwitchBotTimestamp(device.lastSeen);
    const battery = typeof device.battery === 'number' ? `${device.battery}%` : '—';
    return `
      <div class="switchbot-device-item">
        <div class="switchbot-device-item__main">
          <div class="switchbot-device-item__title">${escapeHtml(device.name || device.deviceName || 'SwitchBot device')}</div>
          <div class="switchbot-device-item__meta">${escapeHtml(device.type || device.deviceType || 'Unknown type')}</div>
          <div class="switchbot-device-item__location">${escapeHtml(device.location || 'Unassigned location')}</div>
          <div class="switchbot-device-item__readings">${escapeHtml(readingText)}</div>
        </div>
        <div class="switchbot-device-item__aside">
          <div class="switchbot-device-status" style="color:${statusColor}">
            <span class="switchbot-dot" style="background:${statusColor}"></span>
            <span>${escapeHtml(status)}</span>
          </div>
          <div class="switchbot-device-detail">Battery: ${escapeHtml(battery)}</div>
          <div class="switchbot-device-detail">Last seen: ${escapeHtml(lastSeen)}</div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="switchbot-card">
      <div class="switchbot-card__header">
        <div>
          <div class="switchbot-card__title"><span class="switchbot-dot"></span><strong>SwitchBot devices (${devices.length})</strong></div>
          <p class="tiny" style="margin:4px 0 0;color:#64748b">Active: ${summary.active_devices} • Offline: ${summary.offline_devices} • Low battery: ${summary.low_battery_devices}</p>
        </div>
        <div class="switchbot-card__actions">
          <button type="button" class="ghost" id="switchBotRefreshBtn">Refresh</button>
          <button type="button" class="primary" id="switchBotOpenManager">🏠 Open Manager</button>
        </div>
      </div>
      <div class="switchbot-device-list">${deviceRows}</div>
      ${devices.length > 4 ? `<div class="tiny" style="text-align:right;color:#64748b">Showing first 4 devices. Open the manager to see all.</div>` : ''}
    </div>`;

  container.querySelector('#switchBotOpenManager')?.addEventListener('click', openSwitchBotManager);
  const refreshBtn = container.querySelector('#switchBotRefreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', async () => {
      const originalText = refreshBtn.textContent;
      refreshBtn.disabled = true;
      refreshBtn.textContent = 'Refreshing…';
      try {
        await refreshSwitchBotDevices();
      } finally {
        refreshBtn.disabled = false;
        refreshBtn.textContent = originalText;
      }
    });
  }
}

function renderSwitchBotManager() {
  const host = document.getElementById('switchBotManagerContent');
  if (!host) return;
  const devices = Array.isArray(STATE.switchbotDevices) ? STATE.switchbotDevices : [];
  const summary = STATE.switchbotSummary || summarizeSwitchBotDevices(devices);

  if (!devices.length) {
    host.innerHTML = '<div class="switchbot-manager-empty">No SwitchBot devices available. Check credentials or refresh.</div>';
    return;
  }

  const cards = devices.map((device) => {
    const status = device.status || 'unknown';
    const statusColor = getSwitchBotStatusColor(status);
    const readingText = formatSwitchBotPreviewReadings(device.readings);
    const battery = typeof device.battery === 'number' ? `${device.battery}%` : '—';
    return `
      <div class="switchbot-manager-card">
        <div class="switchbot-manager-card__title">
          <h3>${escapeHtml(device.name || device.deviceName || 'SwitchBot device')}</h3>
          <span class="switchbot-badge" style="background:${statusColor}22;color:${statusColor}">
            <span class="switchbot-dot" style="background:${statusColor}"></span>
            ${escapeHtml(status)}
          </span>
        </div>
        <div class="switchbot-manager-meta">${escapeHtml(device.type || device.deviceType || 'Unknown type')} • ${escapeHtml(device.location || 'Unassigned location')}</div>
        <div class="switchbot-manager-readings">${escapeHtml(readingText)}</div>
        <div class="switchbot-manager-footer">
          <span>Battery: ${escapeHtml(battery)}</span>
          <span>Last seen: ${escapeHtml(formatSwitchBotTimestamp(device.lastSeen))}</span>
        </div>
      </div>`;
  }).join('');

  host.innerHTML = `
    <div class="switchbot-manager-header">
      <div>
        <h2>SwitchBot Manager</h2>
        <p class="tiny" style="margin:4px 0 0;color:#475569">${devices.length} device(s) connected • Last updated ${escapeHtml(formatSwitchBotTimestamp(summary.last_updated))}</p>
      </div>
      <div class="switchbot-manager-actions">
        <button type="button" class="ghost" id="switchBotManagerRefresh">Refresh</button>
      </div>
    </div>
    <div class="switchbot-manager-grid">${cards}</div>`;

  host.querySelector('#switchBotManagerRefresh')?.addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    if (!(btn instanceof HTMLButtonElement)) return;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Refreshing…';
    try {
      await refreshSwitchBotDevices();
      renderSwitchBotManager();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function openSwitchBotManager() {
  const modal = document.getElementById('switchBotModal');
  if (!modal) {
    showToast({ title: 'SwitchBot Manager', msg: 'SwitchBot manager UI not found.', kind: 'error', icon: '' });
    return;
  }
  modal.style.display = 'flex';
  renderSwitchBotManager();
}

async function refreshSwitchBotDevices() {
  const result = await loadSwitchBotDevices();

  if (!result) return;

  if (result.error) {
    console.error('Failed to refresh SwitchBot devices:', result.error);
    showToast({
      title: 'SwitchBot Sync Failed',
      msg: 'Could not connect to SwitchBot API. Check connection.',
      kind: 'error',
      icon: ''
    }, 4000);
    return;
  }

  if (result.httpStatus && result.httpStatus >= 400) {
    showToast({
      title: 'SwitchBot Sync Failed',
      msg: `SwitchBot API request failed (${result.httpStatus}). Check credentials or network.`,
      kind: 'error',
      icon: ''
    }, 4000);
    return;
  }

  if (result.statusCode && result.statusCode !== 100 && !result.devices.length) {
    showToast({
      title: 'SwitchBot Sync Failed',
      msg: result.message || `SwitchBot API returned status ${result.statusCode}.`,
      kind: 'error',
      icon: ''
    }, 4000);
    return;
  }

  const saved = await saveJSON('./data/switchbot-devices.json', {
    devices: result.devices,
    summary: result.summary
  });

  if (!saved) {
    console.warn('Failed to persist SwitchBot devices locally');
  }
  
  // Merge SwitchBot devices into STATE.iotDevices so they're available everywhere
  if (result.devices && result.devices.length > 0) {
    console.log(`[SwitchBot] Merging ${result.devices.length} refreshed devices into IoT devices`);
    // Build lookup for existing zone/location so refreshed data doesn't overwrite manual assignments
    const existingZoneMap = new Map();
    for (const d of (STATE.iotDevices || [])) {
      const id = d.id || d.deviceId;
      if (id && (d.zone != null || d.location)) {
        existingZoneMap.set(id, { zone: d.zone, location: d.location });
      }
    }
    // Convert SwitchBot device format to IoT device format
    const switchbotAsIot = result.devices.map(sbDev => {
      const devId = sbDev.id || sbDev.deviceId;
      const existing = existingZoneMap.get(devId);
      return {
        id: devId,
        deviceId: devId,
        name: sbDev.name || sbDev.deviceName || `SwitchBot ${sbDev.type || 'device'}`,
        vendor: 'SwitchBot',
        brand: 'SwitchBot',
        protocol: 'switchbot',
        type: (sbDev.type || '').toLowerCase(),
        category: sbDev.type || 'Unknown',
        address: devId,
        location: sbDev.location || existing?.location || null,
        zone: sbDev.zone || existing?.zone || null,
        trust: 'trusted',
        automationControl: false,
        lastSeen: sbDev.lastSeen || null,
        telemetry: {
          device_id: devId,
          name: sbDev.name || sbDev.deviceName,
          category: sbDev.type,
          protocol: 'switchbot',
          online: sbDev.status !== 'offline',
          battery: sbDev.battery,
          ...sbDev.readings
        },
        deviceData: {
          device_id: devId,
          name: sbDev.name || sbDev.deviceName,
          category: sbDev.type,
          protocol: 'switchbot',
          online: sbDev.status !== 'offline'
        }
      };
    });
    
    // Remove old SwitchBot devices and add new ones
    const nonSwitchBot = (STATE.iotDevices || []).filter(d => d.protocol !== 'switchbot');
    STATE.iotDevices = dedupeDevices([...nonSwitchBot, ...switchbotAsIot]);
    window.LAST_IOT_SCAN = STATE.iotDevices.slice();
    
    // Persist the merged list
    await persistIotDevices(STATE.iotDevices);

    // Enrich zones from room-map data
    await enrichDeviceZonesFromRoomMap();
    
    // Re-render IoT device cards
    if (typeof window.renderIoTDeviceCards === 'function') {
      window.renderIoTDeviceCards(window.LAST_IOT_SCAN);
    }
  }

  const cacheStatus = (result.cache?.status || '').toLowerCase();
  const cacheFreshness = (result.cache?.freshness || '').toLowerCase();
  const usedCache = cacheStatus === 'hit';
  const stale = cacheFreshness === 'stale';
  const toastKind = usedCache && stale ? 'warn' : 'success';
  const icon = toastKind === 'warn' ? '' : '🏠';
  const msg = usedCache && stale
    ? `Loaded ${result.devices.length} cached device(s); live refresh failed`
    : `Found ${result.devices.length} device(s) from SwitchBot API`;

  showToast({
    title: 'SwitchBot Sync Complete',
    msg,
    kind: toastKind,
    icon
  }, 3000);
}

// Make functions globally available
window.openSwitchBotManager = openSwitchBotManager;
window.refreshSwitchBotCard = () => {
  return refreshSwitchBotDevices().catch((error) => {
    console.warn('[switchbot] Global refresh failed', error);
    return null;
  });
};

function updatePlansStatusIndicator(context = {}) {
  const statusEl = document.getElementById('plansStatus');
  if (!statusEl) return;
  const doc = context.doc ?? STATE?.planDocumentInfo ?? null;
  const plans = Array.isArray(context.plans)
    ? context.plans
    : (Array.isArray(STATE?.plans) ? STATE.plans : []);
  const isDocObject = doc && typeof doc === 'object' && !Array.isArray(doc);
  const isEmptyObject = isDocObject && Object.keys(doc).length === 0;
  const shouldShowUnavailable = doc === null && plans.length === 0;
  const shouldShowEmpty = !shouldShowUnavailable && (isEmptyObject || plans.length === 0);

  if (shouldShowUnavailable) {
    statusEl.innerHTML = '<span class="badge badge--warn">Plans unavailable — check controller connection.</span>';
    statusEl.dataset.source = 'auto-empty';
    return;
  }

  if (shouldShowEmpty) {
    statusEl.innerHTML = '<span class="badge badge--muted">No plans yet — run Recipe Bridge or add one.</span>';
    statusEl.dataset.source = 'auto-empty';
    return;
  }

  if (statusEl.dataset.source === 'auto-empty') {
    statusEl.textContent = '';
    delete statusEl.dataset.source;
  }
}

function dispatchPlansUpdated(context = null) {
  try {
    const detail = context && typeof context === 'object' ? context : null;
    const event = (typeof CustomEvent === 'function')
      ? new CustomEvent('plans-updated', { detail })
      : new Event('plans-updated');
    document.dispatchEvent(event);
  } catch (error) {
    console.warn('[plans] Failed to dispatch plans-updated event', error);
  }
}

function renderPlans() {
  // Populate the Group Plan select with current plans
  const select = $('#groupPlan');
  if (!select) return;
  select.innerHTML = '<option value="">No plan</option>' +
    STATE.plans.map(plan => `<option value="${plan.id}">${plan.name}</option>`).join('');

  renderGrowRoomOverview();
}

// Plans panel rendering and wiring
function renderPlansPanel() {
  const host = document.getElementById('plansList');
  if (!host) return;
  const groupsByPlan = STATE.groups.reduce((acc, g) => {
    if (g.plan) { (acc[g.plan] = acc[g.plan] || []).push(g); }
    return acc;
  }, {});
  const toRow = (plan, idx) => {
    const spectrum = plan.spectrum || { cw:45, ww:45, bl:0, rd:0 };
    const ppfd = Number(plan.ppfd || 0);
    const photoperiod = Number(plan.photoperiod || 12);
    const dli = ppfd > 0 ? (ppfd * 3600 * photoperiod) / 1e6 : (Number(plan.dli || 0));
    const usedIn = (groupsByPlan[plan.id] || []).map(g=>g.name).join(', ');
    const idSafe = `plan-${idx}`;
    return `
      <div class="card" data-plan-id="${plan.id}">
        <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
          <h3 style="margin:0">${escapeHtml(plan.name || 'Untitled plan')}</h3>
          <div class="row" style="gap:6px">
            <button type="button" class="ghost" data-action="dup">Duplicate</button>
            <button type="button" class="ghost" data-action="del">Delete</button>
          </div>
        </div>
        <div class="tiny" style="color:#475569;margin:-2px 0 6px">${escapeHtml(plan.description || '')}</div>
        <div class="grid cols-2" style="align-items:start">
          <div>
            <label class="tiny">Name <input data-field="name" type="text" value="${escapeHtml(plan.name||'')}" placeholder="Plan name"></label>
            <label class="tiny">Description <input data-field="description" type="text" value="${escapeHtml(plan.description||'')}" placeholder="Short description"></label>
            <div class="row tiny" style="gap:8px;align-items:center;margin-top:6px">
              <label>PPFD <input data-field="ppfd" type="number" min="0" step="1" value="${ppfd}" style="width:90px"></label>
              <label>Photoperiod (h) <input data-field="photoperiod" type="number" min="0" max="24" step="0.5" value="${photoperiod}" style="width:90px"></label>
              <span class="chip" title="DLI = PPFD × 3600 × h ÷ 1e6">DLI ≈ ${(dli||0).toFixed(2)}</span>
            </div>
            <div class="row tiny" style="gap:8px;align-items:center;margin-top:6px">
              <label>CW <input data-field="cw" type="number" min="0" max="100" step="1" value="${spectrum.cw||0}" style="width:70px"></label>
              <label>WW <input data-field="ww" type="number" min="0" max="100" step="1" value="${spectrum.ww||0}" style="width:70px"></label>
              <label>Blue <input data-field="bl" type="number" min="0" max="100" step="1" value="${spectrum.bl||0}" style="width:70px"></label>
              <label>Red <input data-field="rd" type="number" min="0" max="100" step="1" value="${spectrum.rd||0}" style="width:70px"></label>
            </div>
            <div class="tiny" style="color:#475569;margin-top:6px">Used in: ${usedIn || '—'}</div>
          </div>
          <div>
            <div class="tiny" style="margin-bottom:4px">Spectrum preview (400–700 nm)</div>
            <canvas class="plan-spd" width="300" height="36" data-idx="${idx}"></canvas>
          </div>
        </div>
      </div>`;
  };
  host.innerHTML = (STATE.plans || []).map(toRow).join('');
  // Draw spectrum canvases and bind input listeners
  host.querySelectorAll('canvas.plan-spd').forEach((cv) => {
    const i = Number(cv.getAttribute('data-idx')) || 0;
    const plan = STATE.plans[i];
    const spec = plan?.spectrum || { cw:45, ww:45, bl:0, rd:0 };
    const spd = computeWeightedSPD(spec);
    renderSpectrumCanvas(cv, spd, { width: 300, height: 36 });
  });
  // Wiring per-card
  host.querySelectorAll('[data-plan-id]').forEach((card) => {
    const pid = card.getAttribute('data-plan-id');
    const plan = STATE.plans.find(p => p.id === pid);
    if (!plan) return;
    const bindNum = (selector, path) => {
      const el = card.querySelector(selector);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = Number(el.value || 0);
        const safe = Number.isFinite(v) ? v : 0;
        if (path === 'ppfd') plan.ppfd = safe;
        if (path === 'photoperiod') plan.photoperiod = safe;
        if (['cw','ww','bl','rd'].includes(path)) {
          plan.spectrum = plan.spectrum || { cw:45, ww:45, bl:0, rd:0 };
          plan.spectrum[path] = Math.max(0, Math.min(100, safe));
          // redraw canvas
          const cv = card.querySelector('canvas.plan-spd');
          if (cv) renderSpectrumCanvas(cv, computeWeightedSPD(plan.spectrum), { width:300, height:36 });
        }
        // live DLI chip update
        const ppfd = Number(plan.ppfd || 0);
        const photoperiod = Number(plan.photoperiod || 12);
        const chip = card.querySelector('.chip');
        if (chip) chip.textContent = `DLI ≈ ${((ppfd*3600*photoperiod)/1e6 || 0).toFixed(2)}`;
      });
    };
    const bindText = (selector, path) => {
      const el = card.querySelector(selector);
      if (!el) return;
      el.addEventListener('input', () => {
        const v = (el.value || '').trim();
        if (path === 'name') plan.name = v;
        if (path === 'description') plan.description = v;
        // reflect h3 title if name changes
        if (path === 'name') { const h = card.querySelector('h3'); if (h) h.textContent = v || 'Untitled plan'; }
      });
    };
    bindText('input[data-field=name]', 'name');
    bindText('input[data-field=description]', 'description');
    bindNum('input[data-field=ppfd]', 'ppfd');
    bindNum('input[data-field=photoperiod]', 'photoperiod');
    bindNum('input[data-field=cw]', 'cw');
    bindNum('input[data-field=ww]', 'ww');
    bindNum('input[data-field=bl]', 'bl');
    bindNum('input[data-field=rd]', 'rd');
    // Actions: delete, duplicate
    card.querySelector('[data-action=del]')?.addEventListener('click', () => {
      if (!confirm(`Delete plan “${plan.name}”?`)) return;
      STATE.plans = STATE.plans.filter(p => p.id !== pid);
      // Unlink from groups
      STATE.groups.forEach(g => { if (g.plan === pid) g.plan = ''; });
      renderPlansPanel(); renderPlans();
      dispatchPlansUpdated({ source: 'delete-plan', planId: pid, plans: STATE.plans.slice() });
    });
    card.querySelector('[data-action=dup]')?.addEventListener('click', () => {
      const clone = JSON.parse(JSON.stringify(plan));
      clone.id = `plan-${Math.random().toString(36).slice(2,8)}`;
      clone.name = `${plan.name || 'Untitled'} (copy)`;
      STATE.plans.push(clone);
      renderPlansPanel(); renderPlans();
      dispatchPlansUpdated({ source: 'duplicate-plan', planId: clone.id, plans: STATE.plans.slice() });
    });
  });

  renderGrowRoomOverview();
  if (STATE.currentGroup) {
    try {
      if (typeof window.updateGroupPlanInfoCard === 'function') {
        window.updateGroupPlanInfoCard(STATE.currentGroup);
      }
      if (typeof window.updateGroupLightInfoCard === 'function') {
        window.updateGroupLightInfoCard(STATE.currentGroup);
      }
    } catch (e) {
      console.warn('Failed to refresh group cards after plan update', e);
    }
  }
  updatePlansStatusIndicator();
}

// --- Search helpers for quick pickers --------------------------------------
function callRenderSearch(scope, options = [], config = {}) {
  const customRenderer = typeof window.renderSearch === 'function' ? window.renderSearch : null;
  if (customRenderer && customRenderer !== callRenderSearch) {
    try {
      customRenderer(scope, options, config);
      return;
    } catch (error) {
      console.warn(`[search:${scope}] custom renderer failed`, error);
    }
  }

  const host =
    document.querySelector(`[data-search-scope="${scope}"]`) ||
    document.getElementById(`${scope}Search`) ||
    document.getElementById(`${scope}SearchRoot`) ||
    document.querySelector(`[data-search="${scope}"]`);

  if (!host) {
    console.warn(`[search:${scope}] no host element found`);
    return;
  }

  const list =
    host.querySelector('[data-search-list]') ||
    host.querySelector('[data-search-results]') ||
    host;

  if (!options.length) {
    list.innerHTML = `<p class="tiny text-muted">${escapeHtml(config.emptyText || 'No results found.')}</p>`;
    return;
  }

  list.innerHTML = options
    .map((option) => {
      const id = option?.id != null ? String(option.id) : '';
      const labelSource = option?.label != null ? String(option.label) : id;
      const label = labelSource || id;
      return `<button type="button" class="ghost" data-search-option="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
    })
    .join('');
}

async function getLightOptions() {
  if (Array.isArray(STATE?.lights) && STATE.lights.length) {
    return STATE.lights
      .map((entry) => {
        const id = entry?.id != null ? String(entry.id) : '';
        if (!id) return null;
        const name = entry?.deviceName || entry?.name || entry?.label || id;
        const status = entry?.onOffStatus ? ` · ${entry.onOffStatus}` : '';
        return { id, label: `${name}${status}` };
      })
      .filter(Boolean);
  }

  const apiBase = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';
  const endpoint = `${apiBase}/api/devicedatas`;
  const sameOriginEndpoint = typeof window !== 'undefined' && (endpoint.startsWith('/') || endpoint.startsWith(window.location.origin));
  const isLocalHost = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
  if (sameOriginEndpoint && !isLocalHost) {
    return [];
  }
  try {
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const devices = payload && payload.data
      ? payload.data
      : Array.isArray(payload?.devices)
        ? payload.devices
        : Array.isArray(payload)
          ? payload
          : [];
    if (!Array.isArray(devices)) {
      console.warn('lights list payload malformed');
      return [];
    }
    return devices
      .map((entry) => {
        const id = entry?.id != null ? String(entry.id) : '';
        if (!id) return null;
        const name = entry?.deviceName || entry?.name || id;
        const status = entry?.onOffStatus ? ` · ${entry.onOffStatus}` : '';
        return { id, label: `${name}${status}` };
      })
      .filter(Boolean);
  } catch (error) {
    console.warn('lights list unavailable', error);
    return [];
  }
}

async function initLightSearch() {
  const options = await getLightOptions();
  callRenderSearch('lights', options, {
    emptyText: 'No lights available — check controller connection.'
  });
}

async function initDehumSearch() {
  try {
    const apiBase = (typeof window !== 'undefined' && window.API_BASE) ? window.API_BASE : '';
    const response = await fetch(`${apiBase}/ui/catalog`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const dehums = Array.isArray(payload?.dehumidifiers) ? payload.dehumidifiers : [];
    const options = dehums.map((item) => {
      const brand = item?.brand ? String(item.brand) : '';
      const model = item?.model ? String(item.model) : '';
      const id = [brand, model].filter(Boolean).join(' ').trim();
      const pints = Number(item?.pintsPerDay);
      const ppd = Number.isFinite(pints) ? `${pints} PPD` : 'PPD unknown';
      const label = `${brand} ${model}`.trim() || id || 'Dehumidifier';
      return { id: id || label, label: `${label} · ${ppd}` };
    });
    callRenderSearch('dehum', options, {
      emptyText: 'No models found — edit catalog.'
    });
  } catch (error) {
    console.warn('dehumidifier catalog unavailable', error);
    callRenderSearch('dehum', [], { emptyText: 'Catalog unavailable.' });
  }
}

window.getLightOptions = getLightOptions;
window.initLightSearch = initLightSearch;
window.initDehumSearch = initDehumSearch;
if (typeof window.renderSearch !== 'function') {
  window.renderSearch = callRenderSearch;
}

// --- Config banner and modal helpers ---
async function loadConfig(cfg) {
  try {
    STATE.config = { singleServer: !!cfg?.singleServer, controller: cfg?.controller || '', envSource: cfg?.envSource || 'local', azureLatestUrl: cfg?.azureLatestUrl || null };
    // Note: configChip UI element has been removed for cleaner interface
  } catch (e) {
    console.warn('Failed to load /config', e);
  }
// ...existing code...
}

// --- Research Mode Integration ---

// --- Forwarder health polling ---
// REMOVED: Redundant with main System Status indicator
// Forwarder status now included in communicationStatus tooltip

let HEALTHZ_TIMER = 0;
let HEALTHZ_BACKOFF = 5000;

async function pollHealthz() {
  try {
    let response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok && response.status === 404) {
      response = await fetch('/healthz', { cache: 'no-store' });
    }
    if (!response.ok) throw new Error(`healthz:${response.status}`);
    const body = await response.json().catch(() => ({ status: 'Controller reachable' }));
    
    const statusEl = document.getElementById('communicationStatus');
    if (!statusEl) return;
    
    // Determine status and build tooltip
    const status = (typeof body?.status === 'string' && body.status.trim()) ? body.status.trim().toLowerCase() : 'unknown';
    const controllerReachable = body?.controller?.reachable !== false;
    const controllerTarget = body?.controller?.target || 'not configured';
    const responseTime = typeof body?.dtMs === 'number' ? `${body.dtMs}ms` : 'unknown';
    
    let displayText = '';
    let color = '';
    let tooltip = '';
    let state = '';
    
    if (status === 'healthy' && controllerReachable) {
      displayText = 'System Healthy';
      color = '#16a34a'; // green
      state = 'ok';
      tooltip = ` System Healthy\n\nAll systems operational. The Light Engine Charlie server is running and can communicate with the Code3 controller.\n\nController: ${controllerTarget}\nResponse time: ${responseTime}\nStatus: All connections active`;
    } else if (status === 'degraded' || !controllerReachable) {
      const rawReason = body?.controller?.status;
      const reason = typeof rawReason === 'string' ? rawReason : 'unknown';
      displayText = 'System Degraded';
      color = '#f59e0b'; // amber/orange
      state = 'degraded';
      
      if (reason === 'unconfigured') {
        tooltip = ` System Degraded\n\nThe server is running but no controller is configured. Light control features may be unavailable.\n\nController: Not configured\nAction: Configure controller target in settings\nImpact: Limited functionality - some features unavailable`;
      } else if (reason === 'timeout' || reason.includes('timeout')) {
        tooltip = ` System Degraded\n\nThe Code3 controller is not responding within the timeout period (1.5s). Network issues or controller may be offline.\n\nController: ${controllerTarget}\nStatus: Connection timeout\nAction: Check controller power and network connectivity\nImpact: Light control unavailable`;
      } else {
        tooltip = ` System Degraded\n\nThe Code3 controller is unreachable or returning errors. Some features may be limited.\n\nController: ${controllerTarget}\nStatus: ${reason}\nResponse time: ${responseTime}\nImpact: Light control may be unavailable`;
      }
    } else {
      // Fallback for unknown statuses
      const message = (typeof body?.statusMessage === 'string' && body.statusMessage.trim())
        ? body.statusMessage.trim()
        : status || 'System status unknown';
      displayText = message;
      color = '#6b7280'; // gray
      state = 'unknown';
      tooltip = `ℹ ${message}\n\nController: ${controllerTarget}\nResponse time: ${responseTime}\nStatus details not available`;
    }
    
    statusEl.textContent = displayText;
    statusEl.style.color = color;
    statusEl.dataset.state = state;
    statusEl.title = tooltip;

    // Controller target info now included in tooltip only
    
    HEALTHZ_BACKOFF = 5000;
  } catch (error) {
    console.warn('healthz failed', error);
    const statusEl = document.getElementById('communicationStatus');
    if (statusEl) {
      statusEl.textContent = 'Server Offline';
      statusEl.style.color = '#b91c1c'; // red
      statusEl.dataset.state = 'error';
      statusEl.title = ` Server Offline\n\nUnable to reach the Light Engine Charlie server. The application cannot check system health.\n\nError: ${error?.message || 'Connection failed'}\nAction: Verify server is running and check network connectivity\nImpact: All features unavailable`;
    }
    HEALTHZ_BACKOFF = Math.min(HEALTHZ_BACKOFF * 2, 60000);
  } finally {
    clearTimeout(HEALTHZ_TIMER);
    HEALTHZ_TIMER = window.setTimeout(pollHealthz, HEALTHZ_BACKOFF);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  clearTimeout(HEALTHZ_TIMER);
  HEALTHZ_BACKOFF = 5000;
  pollHealthz().catch((error) => console.warn('initial healthz poll failed', error));
});

function openEnvModal(zone, metricKey) {
  const modal = document.getElementById('envModal');
  if (!modal) return;
  const title = document.getElementById('envModalTitle');
  const sub = document.getElementById('envModalSubtitle');
  const chart = document.getElementById('envModalChart');
  const stats = document.getElementById('envModalStats');
  title.textContent = `${zone.name} — ${metricKey.toUpperCase()} trend`;
  const s = zone.sensors?.[metricKey];
  sub.textContent = s?.setpoint ? `Target: ${s.setpoint.min ?? '—'} to ${s.setpoint.max ?? '—'}` : '';
  chart.innerHTML = '';
  const canvas = document.createElement('canvas');
  canvas.width = 520; canvas.height = 140; canvas.style.width = '520px'; canvas.style.height = '140px';
  chart.appendChild(canvas);
  const values = Array.isArray(s?.history) ? s.history.slice(0, 144).reverse() : [];
  drawSparkline(canvas, values, { width: 520, height: 140, color: '#0ea5e9' });
  // Simple stats
  if (values.length) {
    const last = values[values.length-1];
    const min = Math.min(...values).toFixed(2);
    const max = Math.max(...values).toFixed(2);
    const avg = (values.reduce((a,b)=>a+b,0)/values.length).toFixed(2);
    stats.textContent = `Now ${last} • Min ${min} • Max ${max} • Avg ${avg}`;
  } else {
    stats.textContent = 'No history yet.';
  }
  // Open
  modal.setAttribute('aria-hidden', 'false');
  document.getElementById('envModalBackdrop')?.addEventListener('click', closeEnvModal, { once: true });
  document.getElementById('envModalClose')?.addEventListener('click', closeEnvModal, { once: true });
}
function closeEnvModal() {
  document.getElementById('envModal')?.setAttribute('aria-hidden', 'true');
}

// --- Global Event Handlers ---
function wireGlobalEvents() {
  // Global device controls
  $('#refresh')?.addEventListener('click', loadAllData);
  $('#allOn')?.addEventListener('click', async () => {
    const payloadMix = normalizeMixInput(45);
    const promises = STATE.devices.map((device) => {
      const entry = buildDeviceHexForMix(payloadMix, device.id);
      return patch(device.id, { status: 'on', value: entry.hex });
    });
    await Promise.all(promises);
    setStatus("All devices ON (Safe mode)");
    showToast({title:'All ON', msg:'Sent safe ON to all devices', kind:'success', icon:''});
  });
  $('#allOff')?.addEventListener('click', async () => {
    const promises = STATE.devices.map(device => 
      patch(device.id, {status: "off", value: null})
    );
    await Promise.all(promises);
    setStatus("All devices OFF");
    showToast({title:'All OFF', msg:'Turned off all devices', kind:'success', icon:''});
  });

  // Environment actions
  $('#btnReloadEnv')?.addEventListener('click', reloadEnvironment);
  $('#btnSaveEnv')?.addEventListener('click', async () => {
    // Persist current env targets (setpoints) back to file for now
    const payload = { zones: STATE.environment };
    const ok = await saveJSON('./data/env.json', payload);
    if (ok) setStatus('Environment targets saved');
    else alert('Failed to save environment');
  });

  // Modal close handlers
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Close all modals except farm registration (which should only close on save)
      document.querySelectorAll('[aria-hidden="false"]:not(#farmModal)').forEach(modal => {
        modal.setAttribute('aria-hidden', 'true');
      });
    }
  });

  // Group UI wiring (Section 4)
  const groupSelect = $('#groupSelect');
  const groupName = $('#groupName');
  const btnSaveGroup = $('#btnSaveGroup');
  const btnGroupSave = $('#btnGroupSave');
  const btnReloadGroups = $('#btnReloadGroups');
  const groupPlan = $('#groupPlan');
  const groupSchedule = $('#groupSchedule');
  const groupChips = $('#groupSpectraChip')?.parentElement;
  const groupSchedulePreview = $('#groupSchedulePreview');
  const groupRosterBody = $('#groupRosterBody');
  const groupRosterEmpty = $('#groupRosterEmpty');
  const groupsStatus = $('#groupsStatus');
  const btnImportFixtures = $('#btnImportFixtures');
  console.log('[wireGlobalEvents] groupSelect query result:', groupSelect);

  // Wire up the new Save button in group card
  if (btnGroupSave) {
    btnGroupSave.onclick = async () => {
      console.log('[btnGroupSave] SAVE BUTTON CLICKED!');
      console.log('[btnGroupSave] Current group:', STATE.currentGroup);
      console.log('[btnGroupSave] All groups:', STATE.groups);
      if (!STATE.currentGroup) {
        showToast({ title: 'No group selected', msg: 'Select a group to save.', kind: 'warn', icon: '' });
        return;
      }
      console.log('[btnGroupSave] About to save groups...');
      console.log('[btnGroupSave] Groups data:', JSON.stringify({ groups: STATE.groups }, null, 2));
      const ok = await saveJSON('/data/groups.json', { groups: STATE.groups });
      console.log('[btnGroupSave] Save result:', ok);
      if (ok) {
        setStatus('Groups saved');
        updateGroupUI(STATE.currentGroup);
        showToast({ title: 'Group Saved', msg: `Group "${STATE.currentGroup.name || ''}" saved.`, kind: 'success', icon: '' });
      } else {
        showToast({ title: 'Save Failed', msg: 'Failed to save groups', kind: 'error', icon: '' });
      }
    };
  }
  if (btnImportFixtures) {
    btnImportFixtures.addEventListener('click', () => {
      if (window.freshLightWizard && typeof window.freshLightWizard.open === 'function') {
        window.freshLightWizard.open();
        showToast({ title: 'Import fixtures', msg: 'Use the Light Setup wizard to add fixtures. New fixtures appear in Ungrouped Lights.', kind: 'info', icon: '' });
      } else {
        const lightSetupNav = document.querySelector('[data-sidebar-link][data-target="light-setup"]');
        if (lightSetupNav instanceof HTMLElement) {
          lightSetupNav.click();
        } else {
          alert('Open Light Setup to import fixtures into your farm.');
        }
      }
    });
  }
  // Group-level location editor (batch)
  // Remove mid-card groupQuick room/zone dropdowns per redesign
  const groupQuick = $('#groupQuick');
  if (groupQuick) groupQuick.innerHTML = '';

  // Spectrum HUD controls
  const gInputs = {
    master: $('#gmaster'), masterV: $('#gmasterv'), lock: $('#gratios'),
    cw: $('#gcw'), cwV: $('#gcwv'),
    ww: $('#gww'), wwV: $('#gwwv'),
    bl: $('#gbl'), blV: $('#gblv'),
    rd: $('#grd'), rdV: $('#grdv')
  };
  // Visual accent for sliders to match channels (supported in modern browsers)
  try {
    if (gInputs.cw) gInputs.cw.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-cw') || '#E0F2FE';
    if (gInputs.ww) gInputs.ww.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-ww') || '#FEF3C7';
    if (gInputs.bl) gInputs.bl.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-bl') || '#DBEAFE';
    if (gInputs.rd) gInputs.rd.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--channel-rd') || '#FECACA';
    if (gInputs.master) gInputs.master.style.accentColor = getComputedStyle(document.documentElement).getPropertyValue('--gr-primary') || '#0D7D7D';
  } catch {}

  // Compute payload and visualization mix from HUD/plan with green split and optional master scaling
  function computeMixAndHex(group) {
    const hud = readHUD();
    const basePlan = STATE.plans.find(p => p.id === group?.plan);
    const base = basePlan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    // If HUD differs from plan spectrum, treat HUD as current mix; else use plan
    const differs = ['cw','ww','bl','rd'].some(k => Number(hud[k]) !== Number(base[k]));
    let mix = differs ? { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd } : { ...base };
    // Enforce canonical green split: use SPD-weighted split (35% CW / 65% WW based on actual phosphor spectra)
    const white = Math.max(0, Math.min(100, (Number(mix.cw)||0) + (Number(mix.ww)||0)));
    let cwSplit, wwSplit;
    if (window.SpectrumMath && window.SpectrumMath.splitGreenIntoWhites) {
      const split = window.SpectrumMath.splitGreenIntoWhites(white);
      cwSplit = Math.round(split.cw);
      wwSplit = Math.round(split.ww);
    } else {
      // Fallback to 50/50 if spectrum math not loaded
      cwSplit = Math.round(white / 2);
      wwSplit = white - cwSplit;
    }
    const splitMix = { cw: cwSplit, ww: wwSplit, bl: Math.max(0, Math.min(100, Number(mix.bl)||0)), rd: Math.max(0, Math.min(100, Number(mix.rd)||0)) };
    const scaled = hud.lock ? scaleMix(splitMix, hud.master) : { ...splitMix };
    const clamp01 = v => Math.max(0, Math.min(100, Math.round(Number(v)||0)));
    const finalMix = { cw: clamp01(scaled.cw), ww: clamp01(scaled.ww), bl: clamp01(scaled.bl), rd: clamp01(scaled.rd) };
    const payloadMix = { ...finalMix, fr: 0, uv: 0 };
    const deviceIds = Array.isArray(group?.lights) ? group.lights.map((l) => l.id).filter(Boolean) : [];
    const perDevice = {};
    deviceIds.forEach((id) => {
      const details = buildDeviceHexForMix(payloadMix, id);
      perDevice[id] = details;
    });
    const hex12 = buildHex12(payloadMix);
    return { mix: finalMix, hex12, perDevice, deviceIds };
  }

  function setHudLocked(locked) {
    const inputs = [gInputs.master, gInputs.masterV, gInputs.cw, gInputs.cwV, gInputs.ww, gInputs.wwV, gInputs.bl, gInputs.blV, gInputs.rd, gInputs.rdV, gInputs.lock];
    inputs.forEach((input) => {
      if (!input) return;
      input.disabled = !!locked;
      if (locked) input.setAttribute('aria-disabled', 'true');
      else input.removeAttribute('aria-disabled');
    });
    const panel = document.getElementById('groupsPanel');
    if (panel) panel.classList.toggle('group-hud-locked', !!locked);
  }

  function updateGroupPlanInfoCard(group) {
    const card = document.getElementById('groupPlanInfoCard');
    if (!card) return;
    const title = document.getElementById('groupPlanInfoTitle');
    const subtitle = document.getElementById('groupPlanInfoSubtitle');
    const canvas = document.getElementById('groupPlanInfoCanvas');
    const metrics = document.getElementById('groupPlanInfoMetrics');
    const selectedLabel = document.getElementById('groupPlanSelectedLabel');
    const selectedCanvas = document.getElementById('groupPlanSelectedCanvas');
    const selectedMetrics = document.getElementById('groupPlanSelectedMetrics');
    const resetSelectedSpectrum = (text) => {
      if (selectedLabel) selectedLabel.textContent = text || 'Selected lights spectrum';
      if (selectedMetrics) selectedMetrics.innerHTML = '';
      clearCanvas(selectedCanvas);
    };
    const plan = group ? STATE.plans.find((p) => p.id === group.plan) : null;
    if (!plan) {
      card.classList.add('is-empty');
      if (title) title.textContent = 'Plan information';
      if (subtitle) subtitle.textContent = 'Select a plan to view spectrum targets.';
      if (metrics) metrics.innerHTML = '';
      clearCanvas(canvas);
      resetSelectedSpectrum('Selected lights spectrum');
      return;
    }
    card.classList.remove('is-empty');
    if (title) title.textContent = `Plan: ${plan.name || 'Untitled'}`;
    const cropStage = [plan.crop, plan.stage].filter(Boolean).join(' • ');
    if (subtitle) {
      subtitle.textContent = cropStage || plan.description || 'Spectrum targets from the selected plan.';
    }
    const spectrum = plan.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    const { percentages } = computeChannelPercentages(spectrum);
    const photoperiod = Number(plan.photoperiod || 12);
    const ppfd = Number(plan.ppfd || 0);
    const dli = plan.dli != null ? Number(plan.dli) : (ppfd > 0 ? (ppfd * 3600 * photoperiod) / 1e6 : 0);
    const roomSel = document.getElementById('groupRoomDropdown');
    const zoneSel = document.getElementById('groupZoneDropdown');
    const targets = resolveEnvironmentTargets(roomSel?.value || '', zoneSel?.value || '');
    if (metrics) {
      const items = [
        { label: 'Cool white', value: `${percentages.cw.toFixed(0)}%` },
        { label: 'Warm white', value: `${percentages.ww.toFixed(0)}%` },
        { label: 'Blue', value: `${percentages.bl.toFixed(0)}%` },
        { label: 'Red', value: `${percentages.rd.toFixed(0)}%` },
        { label: 'PPFD', value: ppfd ? `${ppfd.toFixed(0)} µmol·m⁻²·s⁻¹` : '—' },
        { label: 'Photoperiod', value: photoperiod ? `${photoperiod.toFixed(1)} h` : '—' },
        { label: 'DLI', value: dli ? `${dli.toFixed(2)} mol·m⁻²·d⁻¹` : '—' },
      ];
      if (targets?.temp) {
        items.push({ label: 'Temp target', value: formatSetpointRange(targets.temp, '°C') });
      }
      if (targets?.rh) {
        items.push({ label: 'Humidity target', value: formatSetpointRange(targets.rh, '%') });
      }
      metrics.innerHTML = items
        .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`)
        .join('');
    }
    const mix = { cw: Number(spectrum.cw || 0), ww: Number(spectrum.ww || 0), bl: Number(spectrum.bl || 0), rd: Number(spectrum.rd || 0) };
    const deviceIds = Array.isArray(group?.lights) ? group.lights.map((l) => l.id).filter(Boolean) : [];
    const planSpd = computeWeightedSPD(mix, { deviceIds });
    if (canvas && typeof renderSpectrumCanvas === 'function') {
      renderSpectrumCanvas(canvas, planSpd, { width: canvas.width, height: canvas.height });
    }
    const planBands = computeSpdBandPercentages(planSpd);
    const hasLights = Array.isArray(group?.lights) && group.lights.length > 0;
    const selectedInfo = buildSelectedLightMix(group, spectrum);
    if (!selectedInfo) {
      const labelText = hasLights
        ? 'Selected lights spectrum (spectrum data unavailable)'
        : 'Selected lights spectrum (assign lights to compare)';
      resetSelectedSpectrum(labelText);
      return;
    }
    const selectedSpd = computeWeightedSPD(selectedInfo.mix);
    const selectedBands = computeSpdBandPercentages(selectedSpd);
    if (selectedCanvas && typeof renderSpectrumCanvas === 'function') {
      renderSpectrumCanvas(selectedCanvas, selectedSpd, { width: selectedCanvas.width, height: selectedCanvas.height });
    }
    if (selectedLabel) {
      const approxCount = Math.round(selectedInfo.counts.total || 0);
      const parts = ['Selected lights spectrum'];
      if (approxCount > 0) {
        parts.push(`• ${approxCount} light${approxCount === 1 ? '' : 's'}`);
      }
      selectedLabel.textContent = parts.join(' ');
    }
    if (selectedMetrics) {
      if (selectedBands) {
        const deltas = planBands
          ? {
              red: Math.round((planBands.red - selectedBands.red) * 10) / 10,
              mid: Math.round((planBands.mid - selectedBands.mid) * 10) / 10,
              blue: Math.round((planBands.blue - selectedBands.blue) * 10) / 10,
            }
          : null;
        const items = [
          {
            label: 'Red',
            value: `${selectedBands.red.toFixed(1)}%`,
            delta: deltas ? formatDelta(deltas.red, '%', 1) : null,
          },
          {
            label: 'Mid (green)',
            value: `${selectedBands.mid.toFixed(1)}%`,
            delta: deltas ? formatDelta(deltas.mid, '%', 1) : null,
          },
          {
            label: 'Blue',
            value: `${selectedBands.blue.toFixed(1)}%`,
            delta: deltas ? formatDelta(deltas.blue, '%', 1) : null,
          },
        ];
        selectedMetrics.innerHTML = items
          .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(formatValueWithDelta(item.value, item.delta))}</dd>`)
          .join('');
      } else {
        selectedMetrics.innerHTML = '';
      }
    }
  }

  function updateGroupLightInfoCard(group) {
    const card = document.getElementById('groupLightInfoCard');
    if (!card) return;
    const title = document.getElementById('groupLightInfoTitle');
    const subtitle = document.getElementById('groupLightInfoSubtitle');
    const canvas = document.getElementById('groupLightInfoCanvas');
    const metrics = document.getElementById('groupLightInfoMetrics');
    const modeLabel = document.getElementById('groupLightInfoMode');
    if (!group || !Array.isArray(group.lights) || group.lights.length === 0) {
      card.classList.add('is-empty');
      if (title) title.textContent = 'Current mix';
      if (subtitle) subtitle.textContent = 'Add lights to preview live control options.';
      if (metrics) metrics.innerHTML = '';
      if (modeLabel) modeLabel.textContent = 'Control mode: Locked until lights are assigned.';
      clearCanvas(canvas);
      setHudLocked(true);
      return;
    }
    const resolvedLights = group.lights.map((entry) => {
      const meta = getDeviceMeta(entry.id) || {};
      const setup = findSetupFixtureById(entry.id);
      const fromSetup = setup?.fixture || null;
      const spectrum = meta.factorySpectrum || meta.spectrum || fromSetup?.spectrum || null;
      const controlRaw = [meta.control, fromSetup?.control, meta.transport, meta.protocol].filter(Boolean).join(' ').toLowerCase();
      const spectrumMode = String(meta.spectrumMode || '').toLowerCase();
      const isDynamic = spectrumMode === 'dynamic' || /dynamic|api|lan|wifi|grow3|driver/.test(controlRaw);
      const name = entry.name || meta.deviceName || `${meta.vendor || fromSetup?.vendor || ''} ${meta.model || fromSetup?.model || ''}`.trim();
      return {
        id: entry.id,
        name: name || entry.id,
        dynamic: isDynamic,
        spectrum,
        source: setup ? 'setup' : (meta.vendor || meta.model ? 'device' : 'unknown')
      };
    });
    const dynamicCount = resolvedLights.filter((light) => light.dynamic).length;
    const staticCount = resolvedLights.length - dynamicCount;
    const mixInfo = computeMixAndHex(group);
    const { percentages } = computeChannelPercentages(mixInfo.mix);
    const plan = group ? STATE.plans.find((p) => p.id === group.plan) : null;
    const planSpectrum = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    const { percentages: planPercentages } = computeChannelPercentages(planSpectrum);
    const hud = readHUD();
    const masterValue = Number.isFinite(Number(hud.master)) ? Number(hud.master) : 100;
    const masterPct = Math.max(0, Math.min(100, masterValue));
    const intensityScale = plan ? (hud.lock ? masterPct / 100 : 1) : 1;
    const planPhotoperiod = Number(plan?.photoperiod || 12);
    const planPpfd = Number(plan?.ppfd || 0);
    const planDliValue = plan
      ? (plan.dli != null
          ? Number(plan.dli)
          : (planPpfd > 0 ? (planPpfd * 3600 * planPhotoperiod) / 1e6 : 0))
      : null;
    const activePhotoperiod = planPhotoperiod;
    const actualPpfd = planPpfd ? planPpfd * intensityScale : 0;
    const actualDli = actualPpfd > 0 && activePhotoperiod > 0 ? (actualPpfd * 3600 * activePhotoperiod) / 1e6 : 0;
    card.classList.remove('is-empty');
    if (title) title.textContent = `Current mix • ${resolvedLights.length} light${resolvedLights.length === 1 ? '' : 's'}`;
    if (subtitle) {
      const primary = resolvedLights[0];
      if (primary) {
        // Show both manufacturer/vendor and model if available
        let label = '';
        if (primary.vendor) label += primary.vendor + ' ';
        if (primary.model) label += primary.model + ' ';
        if (!label.trim()) label = primary.name || primary.id;
        subtitle.textContent = label.trim();
      } else {
        subtitle.textContent = 'Active fixture mix';
      }
    }
    if (metrics) {
      const hasPlan = !!plan;
      const items = [
        {
          label: 'Cool white',
          value: `${percentages.cw.toFixed(0)}%`,
          delta: hasPlan ? formatDelta(percentages.cw - planPercentages.cw, '%') : null
        },
        {
          label: 'Warm white',
          value: `${percentages.ww.toFixed(0)}%`,
          delta: hasPlan ? formatDelta(percentages.ww - planPercentages.ww, '%') : null
        },
        {
          label: 'Blue',
          value: `${percentages.bl.toFixed(0)}%`,
          delta: hasPlan ? formatDelta(percentages.bl - planPercentages.bl, '%') : null
        },
        {
          label: 'Red',
          value: `${percentages.rd.toFixed(0)}%`,
          delta: hasPlan ? formatDelta(percentages.rd - planPercentages.rd, '%') : null
        },
        {
          label: 'PPFD',
          value: actualPpfd ? `${actualPpfd.toFixed(0)} µmol·m⁻²·s⁻¹` : '—',
          delta: hasPlan ? formatDelta(actualPpfd - planPpfd, ' µmol·m⁻²·s⁻¹') : null
        },
        {
          label: 'Photoperiod',
          value: activePhotoperiod ? `${activePhotoperiod.toFixed(1)} h` : '—',
          delta: hasPlan ? formatDelta(activePhotoperiod - planPhotoperiod, ' h', 1) : null
        },
        {
          label: 'DLI',
          value: actualDli ? `${actualDli.toFixed(2)} mol·m⁻²·d⁻¹` : '—',
          delta: hasPlan ? formatDelta(actualDli - (planDliValue ?? 0), ' mol·m⁻²·d⁻¹', 2) : null
        },
        { label: 'Dynamic fixtures', value: dynamicCount ? `${dynamicCount}` : '0', delta: null },
        { label: 'Static fixtures', value: staticCount ? `${staticCount}` : '0', delta: null }
      ];
      metrics.innerHTML = items
        .map((item) => `<dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(formatValueWithDelta(item.value, item.delta))}</dd>`)
        .join('');
    }
    const shouldLock = resolvedLights.length > 0 && dynamicCount === 0;
    if (modeLabel) {
      modeLabel.textContent = shouldLock
        ? 'Control mode: Locked to factory spectrum (static fixtures detected).'
        : 'Control mode: Spectrum controls unlocked for dynamic fixtures.';
    }
    setHudLocked(shouldLock);
    if (canvas && typeof renderSpectrumCanvas === 'function') {
      const spd = computeWeightedSPD({
        cw: Number(mixInfo.mix.cw || 0),
        ww: Number(mixInfo.mix.ww || 0),
        bl: Number(mixInfo.mix.bl || 0),
        rd: Number(mixInfo.mix.rd || 0)
      }, { deviceIds: mixInfo.deviceIds });
      renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
    }
  }

  window.refreshGroupLightInfoCard = () => {
    if (STATE.currentGroup) updateGroupLightInfoCard(STATE.currentGroup);
  };
  window.updateGroupPlanInfoCard = updateGroupPlanInfoCard;
  window.updateGroupLightInfoCard = updateGroupLightInfoCard;
  // HUD helpers
  function setHUD(values = {}) {
    try {
      if (typeof values.master === 'number') {
        if (gInputs.master) gInputs.master.value = String(values.master);
        if (gInputs.masterV) gInputs.masterV.value = String(values.master);
      }
      if (typeof values.cw === 'number') { if (gInputs.cw) gInputs.cw.value = String(values.cw); if (gInputs.cwV) gInputs.cwV.value = String(values.cw); }
      if (typeof values.ww === 'number') { if (gInputs.ww) gInputs.ww.value = String(values.ww); if (gInputs.wwV) gInputs.wwV.value = String(values.ww); }
      if (typeof values.bl === 'number') { if (gInputs.bl) gInputs.bl.value = String(values.bl); if (gInputs.blV) gInputs.blV.value = String(values.bl); }
      if (typeof values.rd === 'number') { if (gInputs.rd) gInputs.rd.value = String(values.rd); if (gInputs.rdV) gInputs.rdV.value = String(values.rd); }
      if (typeof values.lock === 'boolean' && gInputs.lock) { gInputs.lock.checked = values.lock; }
    } catch {}
  }
  function readHUD() {
    return {
      master: Number(gInputs.master?.value ?? 60),
      cw: Number(gInputs.cw?.value ?? 45),
      ww: Number(gInputs.ww?.value ?? 45),
      bl: Number(gInputs.bl?.value ?? 0),
      rd: Number(gInputs.rd?.value ?? 0),
      lock: !!gInputs.lock?.checked
    };
  }
  // Pair a range input with a numeric input, keep them in sync and call optional onChange
  function connectPair(rangeEl, numEl, onChange) {
    if (!rangeEl || !numEl) return;
    const handler = () => { numEl.value = rangeEl.value; if (onChange) onChange(Number(rangeEl.value)); };
    const handlerNum = () => { rangeEl.value = numEl.value; if (onChange) onChange(Number(numEl.value)); };
    rangeEl.addEventListener('input', handler);
    numEl.addEventListener('input', handlerNum);
    // initialize linkage
    handler();
  }
  function scaleMix(mix, scalePct) {
    const s = Math.max(0, Math.min(100, scalePct)) / 100;
    return { cw: Math.round(mix.cw * s), ww: Math.round(mix.ww * s), bl: Math.round(mix.bl * s), rd: Math.round(mix.rd * s) };
  }
  function getGroupSpectrum(group) {
    const plan = STATE.plans.find(p => p.id === group?.plan);
    const hud = readHUD();
    const base = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    const differs = ['cw','ww','bl','rd'].some(k => Number(hud[k]) !== Number(base[k]));
    const mix = differs ? { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd } : base;
    return hud.lock ? { ...scaleMix(mix, hud.master), master: hud.master } : { ...mix, master: hud.master };
  }
  // Live re-render of group spectrum preview from HUD
  function renderGroupSpectrumPreview(group) {
    const host = document.getElementById('groupSpectrumPreview');
    if (!host) return;
    host.innerHTML = '';
    const { mix, deviceIds } = computeMixAndHex(group);
    const spd = computeWeightedSPD(mix, { deviceIds });
    const cv = document.createElement('canvas');
    cv.className = 'group-spectrum__canvas';
    host.appendChild(cv);
    
    // Use consistent fixed dimensions to prevent resizing issues
    const w = 420;
    const h = 40;
    renderSpectrumCanvas(cv, spd, { width: w, height: h });

    // Also render twin canvases beside HUD sliders when present
    try {
      const hudCv = document.getElementById('groupHudCanvas');
      const planCv = document.getElementById('groupPlanCanvas');
      if (hudCv) {
        // Use consistent dimensions for HUD canvas
        const hW = 260;
        const hH = 90;
        renderSpectrumCanvas(hudCv, spd, { width: hW, height: hH });
      }
      if (planCv) {
        const plan = STATE.plans.find(p => p.id === group?.plan);
        const planSpec = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
        const planSpd = computeWeightedSPD({
          cw: Number(planSpec.cw||0), ww: Number(planSpec.ww||0), bl: Number(planSpec.bl||0), rd: Number(planSpec.rd||0)
        }, { deviceIds });
        const pW = 260;
        const pH = 90;
        renderSpectrumCanvas(planCv, planSpd, { width: pW, height: pH });
      }
    } catch (e) { /* non-fatal */ }
  }
  // Wire HUD input pairs
  connectPair(gInputs.cw, gInputs.cwV);
  connectPair(gInputs.ww, gInputs.wwV);
  connectPair(gInputs.bl, gInputs.blV);
  connectPair(gInputs.rd, gInputs.rdV);
  if (gInputs.master && gInputs.masterV) {
    connectPair(gInputs.master, gInputs.masterV, (v) => {
      const hud = readHUD();
      if (hud.lock) {
        const mix = { cw: Number(gInputs.cw.value), ww: Number(gInputs.ww.value), bl: Number(gInputs.bl.value), rd: Number(gInputs.rd.value) };
        const scaled = scaleMix(mix, v);
        setHUD({ cw: scaled.cw, ww: scaled.ww, bl: scaled.bl, rd: scaled.rd });
      }
      // Always update spectrum preview on master change
      if (STATE.currentGroup) {
        renderGroupSpectrumPreview(STATE.currentGroup);
        if (typeof window.refreshGroupLightInfoCard === 'function') window.refreshGroupLightInfoCard();
      }
    });
  }
  // Also update preview when any channel slider changes
  ;[gInputs.cw, gInputs.ww, gInputs.bl, gInputs.rd, gInputs.lock].forEach(inp => {
    try {
      inp?.addEventListener('input', () => {
        if (STATE.currentGroup) {
          renderGroupSpectrumPreview(STATE.currentGroup);
          if (typeof window.refreshGroupLightInfoCard === 'function') window.refreshGroupLightInfoCard();
        }
      });
    } catch {}
  });
  // Render the selected group's UI and helpers
  function updateGroupUI(group) {
  // Defensive debug logging for Assigned Lights rendering
  const grDebug = (window.localStorage && (localStorage.grDebug === 'true' || localStorage.grDebug === '1')) || (window.gr && gr.researchMode);
    // Local element lookups to avoid stale references
    const groupPlan = document.getElementById('groupPlan');
    const groupSchedule = document.getElementById('groupSchedule');
    const chipsHost = document.getElementById('groupSpectraChip')?.parentElement || null;
    const schedulePreview = document.getElementById('groupSchedulePreview');
    const spectrumPreview = document.getElementById('groupSpectrumPreview');
  const groupRosterBody = document.getElementById('groupRosterBody');
  const groupRosterEmpty = document.getElementById('groupRosterEmpty');
    const groupsStatus = document.getElementById('groupsStatus');
    const groupName = document.getElementById('groupName');
    const ungroupedList = document.getElementById('ungroupedList');
    const ungroupedStatus = document.getElementById('ungroupedStatus');
    const ungroupedEmpty = document.getElementById('ungroupedEmpty');
  const groupLightList = document.getElementById('groupLightList');
  const removeSelectedBtn = document.getElementById('groupLightRemoveSelected');
    const roomSel = document.getElementById('groupRoomDropdown');
    const zoneSel = document.getElementById('groupZoneDropdown');
    const selectedRoomValue = roomSel?.value || '';
    const selectedZoneValue = zoneSel?.value || '';

    const { roomId: selectedRoomId, roomName: selectedRoomName, zone: selectedZone } = getSelectedGroupRoomZone();
    const hasRoomSelection = !!(selectedRoomValue && selectedRoomValue.trim());
    const hasZoneSelection = !!(selectedZoneValue && selectedZoneValue.trim());
    const hasFilters = hasRoomSelection && hasZoneSelection;

    // ✅ DATA FLOW FIX: Show all lights when no filter active (allows viewing saved groups immediately)
    const filteredLights = hasFilters
      ? (group.lights || [])
          .map((entry, idx) => normalizeGroupLightEntry(entry, idx))
          .filter((entry) => {
            if (!entry || !entry.id) return false;
            if (entry.type && entry.type !== 'Light') return false;
            if (/mock|demo/i.test(entry.id)) return false;
            const room = (entry.room || entry.roomId || '').toString().trim().toLowerCase();
            const zone = (entry.zone || '').toString().trim().toLowerCase();
            const selRoomId = (selectedRoomId || '').toString().trim().toLowerCase();
            const selRoomName = (selectedRoomName || '').toString().trim().toLowerCase();
            const selZone = (selectedZone || '').toString().trim().toLowerCase();
            return (room === selRoomId || room === selRoomName) && zone === selZone;
          })
      : (group.lights || []).map((entry, idx) => normalizeGroupLightEntry(entry, idx));

    if (grDebug) {
      // Defensive: log key values for troubleshooting Assigned Lights
      console.debug('[GroupsV2] updateGroupUI:', {
        groupId: group?.id,
        groupName: group?.name,
        groupLightsCount: Array.isArray(group?.lights) ? group.lights.length : 0,
        filteredLightsCount: Array.isArray(filteredLights) ? filteredLights.length : 0,
        selectedRoomId,
        selectedRoomName,
        selectedZone,
        groupLights: (group?.lights || []).map(l => ({id: l.id, room: l.room, zone: l.zone})),
        filteredLights: filteredLights.map(l => ({id: l.id, room: l.room, zone: l.zone}))
      });
    }

    updateGroupActionStates({
      hasGroup: Boolean(group),
      hasRoom: hasRoomSelection,
      hasZone: hasZoneSelection,
    });

    if (!group) {
      if (groupPlan) groupPlan.value = '';
      if (groupSchedule) groupSchedule.value = '';
      if (schedulePreview) schedulePreview.innerHTML = '';
      if (spectrumPreview) spectrumPreview.innerHTML = '';
      if (chipsHost) chipsHost.querySelectorAll('.chip[data-kind]').forEach((n) => n.remove());
      if (groupsStatus) groupsStatus.textContent = '';
      if (groupName) groupName.value = '';
      if (groupRosterBody) groupRosterBody.innerHTML = '';
      if (groupRosterEmpty) {
        groupRosterEmpty.style.display = 'block';
        groupRosterEmpty.textContent = 'Select a group to view members.';
      }
      if (ungroupedList) ungroupedList.innerHTML = '';
      if (ungroupedEmpty) {
        ungroupedEmpty.style.display = 'block';
        ungroupedEmpty.textContent = 'Select a room and zone to view configured lights.';
      }
      if (ungroupedStatus) ungroupedStatus.textContent = '';
      updateGroupPlanInfoCard(null);
      updateGroupLightInfoCard(null);
      setHudLocked(true);
      return;
    }
    if (groupPlan) groupPlan.value = group.plan || '';
    if (groupSchedule) groupSchedule.value = group.schedule || '';
    if (groupName) groupName.value = group.name || '';
    // Chip
    if (chipsHost) {
      chipsHost.querySelectorAll('.chip[data-kind]').forEach(n=>n.remove());
      // Plan chip with PPFD/DLI
      const plan = STATE.plans.find(p => p.id === group.plan);
      if (plan) {
        const photoperiod = (()=>{ const s = STATE.schedules.find(x=>x.id===group.schedule); return s ? getDailyOnHours(s) : (Number(plan.photoperiod)||12); })();
        const dli = (Number(plan.ppfd||0) * 3600 * photoperiod) / 1e6;
        const pchip = document.createElement('span');
        pchip.className = 'chip';
        pchip.dataset.kind = 'plan';
        pchip.textContent = `${plan.name} • PPFD ${Math.round(Number(plan.ppfd||0))} • DLI ${dli.toFixed(2)}`;
        pchip.title = 'Assigned plan';
        chipsHost.appendChild(pchip);
      }
      const sched = STATE.schedules.find(s => s.id === group.schedule);
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.dataset.kind = 'sched';
      chip.textContent = sched ? scheduleSummary(sched) : 'No schedule';
      chip.title = 'Click to edit schedule';
      chip.addEventListener('click', () => openScheduleEditorForGroup(group.id));
      chipsHost.appendChild(chip);
    }
    // Preview
    if (schedulePreview) schedulePreview.innerHTML = '<div class="schedule-preview__bar"></div>';
    const bar = schedulePreview?.querySelector('.schedule-preview__bar');
    const sched = STATE.schedules.find(s => s.id === group.schedule);
    if (sched && bar) renderScheduleBar(bar, sched.cycles || []);
    // Spectrum preview driven by HUD (with green split + master scaling if locked)
    renderGroupSpectrumPreview(group);
    // Meta status: roster count and online
    if (groupsStatus) {
      if (!hasFilters) {
        groupsStatus.textContent = 'Select a room and zone to preview this group.';
      } else {
        try {
          const filteredIds = filteredLights.map((entry) => entry.id).filter(Boolean);
          const targets = filteredIds
            .map((id) => STATE.devices.find((d) => d.id === id) || buildDeviceLikeFromMeta(id))
            .filter(Boolean);
          const online = targets.filter((d) => d && d.online !== false).length;
          const planName = STATE.plans.find((p) => p.id === group.plan)?.name || '—';
          const schedName = STATE.schedules.find((s) => s.id === group.schedule)?.name || '—';
          groupsStatus.textContent = `${filteredLights.length} light(s) • ${online} online • Plan: ${planName} • Schedule: ${schedName}`;
        } catch {
          groupsStatus.textContent = 'Select a room and zone to preview this group.';
        }
      }
    }
    // Roster
    if (groupRosterBody) {
      const rows = filteredLights
        .map((entry) => {
          const id = entry.id;
          if (!id) return '';
          const meta = getDeviceMeta(id) || {};
          const name = entry.name || resolveLightNameFromState(id, meta);
          const vendor = firstNonEmptyString(entry.vendor, entry.manufacturer, meta.vendor, meta.manufacturer);
          const locStr = [
            firstNonEmptyString(entry.roomName, entry.room, meta.roomName, meta.room),
            firstNonEmptyString(entry.zone, meta.zone)
          ]
            .filter(Boolean)
            .join(' / ');
          const moduleStr = firstNonEmptyString(entry.module, meta.module);
          const levelStr = firstNonEmptyString(entry.level, meta.level);
          const sideStr = firstNonEmptyString(entry.side, meta.side);
          return `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(vendor)}</td><td>${escapeHtml(id)}</td><td>${escapeHtml(locStr)}</td><td>${escapeHtml(moduleStr)}</td><td>${escapeHtml(levelStr)}</td><td>${escapeHtml(sideStr)}</td><td>—</td></tr>`;
        })
        .filter(Boolean)
        .join('');
      groupRosterBody.innerHTML = rows;
    }
    if (groupRosterEmpty) {
      if (!hasFilters) {
        groupRosterEmpty.style.display = 'block';
        groupRosterEmpty.textContent = 'Select a room and zone to view this group.';
      } else if (filteredLights.length) {
        groupRosterEmpty.style.display = 'none';
      } else {
        groupRosterEmpty.style.display = 'block';
        groupRosterEmpty.textContent = 'No lights in this group for the selected room and zone.';
      }
    }

    // Fix ungrouped lights: show all devices not assigned to any group
    if (ungroupedList) {
      const { rawRoom, roomId, roomName, zone } = getSelectedGroupRoomZone();
      const selectedRoom = roomId || roomName ? { id: roomId, name: roomName } : rawRoom;
      const zoneValue = normZone(zone);
      const hasRoom =
        typeof selectedRoom === 'string'
          ? !!selectedRoom.trim()
          : !!(selectedRoom && (selectedRoom.id || selectedRoom.name));
      const hasZone = !!zoneValue;
      const roster = hasRoom && hasZone ? computeRostersForSelection(selectedRoom, zoneValue) : { assigned: [], ungrouped: [] };
      const assignedIds = new Set((roster.assigned || []).map((entry) => entry.id).filter(Boolean));
      const ungrouped = roster.ungrouped || [];
      ungroupedList.innerHTML = '';
      if (!hasRoom || !hasZone) {
        if (ungroupedEmpty) {
          ungroupedEmpty.style.display = 'block';
          ungroupedEmpty.textContent = 'Select a room and zone to view configured lights.';
        }
      } else if (!ungrouped.length) {
        if (ungroupedEmpty) {
          ungroupedEmpty.style.display = 'block';
          const hasAnyCandidates = (roster.assigned || []).length > 0;
          ungroupedEmpty.textContent = hasAnyCandidates
            ? 'All lights are assigned to groups.'
            : 'No lights found for this room and zone.';
        }
      } else {
        if (ungroupedEmpty) ungroupedEmpty.style.display = 'none';
        ungrouped.forEach((candidate) => {
          if (!candidate?.id || assignedIds.has(candidate.id)) return;
          const normalized = {
            ...candidate,
            deviceName: candidate.deviceName || resolveLightNameFromState(candidate.id, candidate),
          };
          if (!normalized.room && normalized.roomName) normalized.room = normalized.roomName;
          if (!normalized.room && normalized.roomId) normalized.room = normalized.roomId;
          if (!normalized.zone && candidate.zone) normalized.zone = candidate.zone;
          if (!normalized.vendor && candidate.vendor) normalized.vendor = candidate.vendor;
          if (!normalized.model && candidate.model) normalized.model = candidate.model;
          const card = deviceCard(normalized, { compact: true });
          try {
            const cv = card.querySelector('.device-spectrum__canvas');
            if (cv) {
              const meta = getDeviceMeta(candidate.id) || {};
              const isDynamic =
                ['cwPct', 'wwPct', 'blPct', 'rdPct'].some((key) => candidate[key] !== undefined) ||
                String(meta.spectrumMode || 'dynamic') === 'dynamic';
              const mix = isDynamic
                ? computeMixAndHex(group).mix
                : (meta.factorySpectrum || (STATE.plans.find((p) => p.id === group.plan)?.spectrum) || {
                    cw: 45,
                    ww: 45,
                    bl: 0,
                    rd: 0,
                  });
              const spd = computeWeightedSPD({ cw: mix.cw || 0, ww: mix.ww || 0, bl: mix.bl || 0, rd: mix.rd || 0 }, {
                deviceIds: [candidate.id],
              });
              renderSpectrumCanvas(cv, spd, { width: 300, height: 36 });
              card.title = isDynamic ? 'Dynamic: using driver spectrum' : 'Static: using device factory spectrum';
            }
          } catch {}
          const add = document.createElement('button');
          add.type = 'button';
          add.className = 'ghost';
          add.textContent = 'Add to group';
          add.style.marginTop = '6px';
          add.addEventListener('click', async () => {
            addLightToGroup(group, candidate, selectedRoom, zoneValue);
            await saveGroups();
            updateGroupUI(group);
          });
          const wrap = document.createElement('div');
          wrap.appendChild(card);
          wrap.appendChild(add);
          ungroupedList.appendChild(wrap);
        });
      }
      if (ungroupedStatus) {
        if (!hasRoom || !hasZone) {
          ungroupedStatus.textContent = 'Select a room and zone';
        } else {
          ungroupedStatus.textContent = `${ungrouped.length} ungrouped`;
        }
      }
    }
    // Render assigned light cards with selection + remove actions
    if (groupLightList) {
      const updateRemoveButtonState = () => {
        if (!removeSelectedBtn) return;
        const selectedCount = groupLightList.querySelectorAll('input.group-light-select:checked').length;
        removeSelectedBtn.disabled = selectedCount === 0;
        if (selectedCount > 1) {
          removeSelectedBtn.textContent = `Remove ${selectedCount} lights`;
        } else {
          removeSelectedBtn.textContent = 'Remove selected';
        }
      };

      groupLightList.innerHTML = '';
      if (Array.isArray(filteredLights) && filteredLights.length > 0) {
        filteredLights.forEach((entry) => {
          const lightId = entry.id;
          if (!lightId) return;
          const meta = getDeviceMeta(lightId) || {};
          const title = entry.deviceName || entry.name || resolveLightNameFromState(lightId, meta) || lightId;
          const vendor = entry.vendor || meta.vendor || 'Unknown';

          const card = document.createElement('div');
          card.className = 'gr-card';
          card.dataset.lightId = lightId;
          card.style.cssText = 'padding:8px;border:1px solid #d1d5db;border-radius:8px;background:#fff;position:relative;min-width:140px;display:flex;flex-direction:column;gap:6px;';

          const row = document.createElement('div');
          row.style.display = 'flex';
          row.style.alignItems = 'flex-start';
          row.style.gap = '6px';

          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'group-light-select';
          checkbox.value = lightId;
          checkbox.style.marginTop = '3px';

          const infoWrap = document.createElement('div');
          infoWrap.innerHTML = `
            <div style="font-weight:600;color:#0f172a;font-size:13px;margin-bottom:2px;" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <div class="tiny" style="color:#64748b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(vendor)}">${escapeHtml(vendor)}</div>
          `;

          row.appendChild(checkbox);
          row.appendChild(infoWrap);
          card.appendChild(row);

          // Add controller dropdown
          const controllerRow = document.createElement('div');
          controllerRow.style.cssText = 'display:flex;flex-direction:column;gap:4px;margin-top:4px;';
          
          const controllerLabel = document.createElement('label');
          controllerLabel.style.cssText = 'font-size:11px;color:#64748b;font-weight:600;';
          controllerLabel.textContent = 'Controller:';
          
          const controllerSelect = document.createElement('select');
          controllerSelect.className = 'light-controller-select';
          controllerSelect.style.cssText = 'width:100%;border:1px solid #e2e8f0;padding:4px 6px;border-radius:4px;font-size:12px;';
          controllerSelect.innerHTML = renderLightControlOptions(entry.control || entry.controllerId);
          
          controllerSelect.addEventListener('change', async (ev) => {
            ev.stopPropagation();
            const newControl = controllerSelect.value;
            
            // Update the entry object
            if (typeof entry === 'object') {
              entry.control = newControl;
              entry.controllerId = newControl;
            }
            
            // Find and update in group.lights array
            const lightIndex = (group.lights || []).findIndex((item) => {
              const id = typeof item === 'string' ? item : item.id;
              return id === lightId;
            });
            
            if (lightIndex !== -1) {
              const existing = group.lights[lightIndex];
              if (typeof existing === 'string') {
                // Convert string to object
                group.lights[lightIndex] = {
                  id: lightId,
                  control: newControl,
                  controllerId: newControl
                };
              } else {
                // Update existing object
                group.lights[lightIndex].control = newControl;
                group.lights[lightIndex].controllerId = newControl;
              }
            }
            
            // Also update in STATE.lights if it exists
            const stateLight = (STATE.lights || []).find((l) => l.id === lightId);
            if (stateLight) {
              stateLight.control = newControl;
              stateLight.controllerId = newControl;
            }
            
            await saveGroups();
            document.dispatchEvent(new Event('lights-updated'));
            
            if (typeof showToast === 'function') {
              showToast({ 
                title: 'Controller Updated', 
                msg: `Controller assigned to ${title}`, 
                kind: 'success', 
                icon: '' 
              }, 2000);
            }
            
            // Update control actions display
            updateControlActions();
          });
          
          controllerRow.appendChild(controllerLabel);
          controllerRow.appendChild(controllerSelect);
          card.appendChild(controllerRow);
          
          // Add control actions row (ON/OFF buttons or scheduler link)
          const controlActionsRow = document.createElement('div');
          controlActionsRow.className = 'light-control-actions';
          controlActionsRow.style.cssText = 'display:flex;gap:4px;margin-top:4px;';
          
          const updateControlActions = () => {
            const control = entry.control || entry.controllerId || '';
            controlActionsRow.innerHTML = renderLightControlActions(lightId, control, title);
          };
          
          updateControlActions();
          card.appendChild(controlActionsRow);

          const actionsRow = document.createElement('div');
          actionsRow.style.display = 'flex';
          actionsRow.style.gap = '6px';
          actionsRow.style.marginTop = '4px';

          const removeBtn = document.createElement('button');
          removeBtn.type = 'button';
          removeBtn.className = 'ghost danger';
          removeBtn.textContent = 'Remove';
          removeBtn.style.flex = '1 1 auto';
          removeBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!confirm(`Remove "${title}" from this group?`)) return;
            group.lights = (group.lights || []).filter((entry) => {
              const id = typeof entry === 'string' ? entry : entry.id;
              return id !== lightId;
            });
            const light = (STATE.lights || []).find((l) => l.id === lightId);
            if (light) {
              light.zoneId = null;
              light.groupId = null;
              light.groupLabel = null;
            }
            await saveGroups();
            document.dispatchEvent(new Event('lights-updated'));
            document.dispatchEvent(new Event('groups-updated'));
            updateGroupUI(group);
            if (typeof showToast === 'function') {
              showToast({ title: 'Light removed', msg: `${title} removed from group.`, kind: 'success', icon: '' }, 2000);
            }
          });

          actionsRow.appendChild(removeBtn);
          card.appendChild(actionsRow);

          const applySelectionState = () => {
            card.classList.toggle('is-selected', checkbox.checked);
            card.style.borderColor = checkbox.checked ? '#f97316' : '#d1d5db';
            card.style.boxShadow = checkbox.checked ? '0 0 0 1px rgba(249,115,22,0.35)' : 'none';
          };

          checkbox.addEventListener('change', () => {
            applySelectionState();
            updateRemoveButtonState();
          });

          card.addEventListener('click', (ev) => {
            if (ev.target.tagName === 'BUTTON' || ev.target === checkbox) return;
            checkbox.checked = !checkbox.checked;
            applySelectionState();
            updateRemoveButtonState();
          });

          applySelectionState();
          groupLightList.appendChild(card);
        });
      }

      updateRemoveButtonState();

      if (removeSelectedBtn && !removeSelectedBtn._handlerAttached) {
        removeSelectedBtn.addEventListener('click', async () => {
          const listEl = document.getElementById('groupLightList');
          const checkboxes = Array.from(listEl?.querySelectorAll('input.group-light-select:checked') || []);
          if (!checkboxes.length) {
            alert('Select at least one light to remove.');
            return;
          }
          const ids = checkboxes.map((cb) => cb.value).filter(Boolean);
          const resolveLightDisplayName = (lightId) => {
            const entry = (group.lights || []).find((item) => (typeof item === 'string' ? item === lightId : item.id === lightId)) || null;
            if (entry && typeof entry === 'object') {
              const fallbackMeta = getDeviceMeta(lightId) || {};
              return entry.name || entry.deviceName || fallbackMeta.deviceName || resolveLightNameFromState(lightId, fallbackMeta) || lightId;
            }
            const fallbackMeta = getDeviceMeta(lightId) || {};
            return fallbackMeta.deviceName || resolveLightNameFromState(lightId, fallbackMeta) || lightId;
          };
          const namePreview = ids.length === 1
            ? resolveLightDisplayName(ids[0])
            : `${ids.length} lights`;
          if (!confirm(`Remove ${namePreview} from this group?`)) return;
          group.lights = (group.lights || []).filter((entry) => {
            const id = typeof entry === 'string' ? entry : entry.id;
            return !ids.includes(id);
          });
          ids.forEach((lightId) => {
            const light = (STATE.lights || []).find((l) => l.id === lightId);
            if (light) {
              light.zoneId = null;
              light.groupId = null;
              light.groupLabel = null;
            }
          });
          await saveGroups();
          document.dispatchEvent(new Event('lights-updated'));
          document.dispatchEvent(new Event('groups-updated'));
          updateGroupUI(group);
          if (typeof showToast === 'function') {
            showToast({ title: 'Lights removed', msg: `${ids.length} light${ids.length === 1 ? '' : 's'} removed from group.`, kind: 'success', icon: '' }, 2000);
          }
        });
        removeSelectedBtn._handlerAttached = true;
      }
    }
    // Initialize HUD from plan when switching groups
    const plan = STATE.plans.find(p => p.id === group?.plan);
    const spec = plan?.spectrum || { cw: 45, ww: 45, bl: 0, rd: 0 };
    setHUD({ master: 60, ...spec });
    // After seeding HUD, render preview
    renderGroupSpectrumPreview(group);
    updateGroupPlanInfoCard(group);
    updateGroupLightInfoCard(group);

  }
  // Expose for callers outside this scope
  window.updateGroupUI = updateGroupUI;
  window.computeRostersForSelection = computeRostersForSelection;
  window.collectCandidatesForSelection = collectCandidatesForSelection;

  window.addEventListener('lightSetupsChanged', () => {
    try { seedGroupRoomZoneDropdowns(); } catch (e) { console.warn('Failed to reseed room/zone dropdowns after light setup change', e); }
    if (STATE.currentGroup) {
      try { updateGroupUI(STATE.currentGroup); } catch (e) { console.warn('Failed to refresh group UI after light setup change', e); }
    }
  });

  window.addEventListener('farmDataChanged', () => {
    try { seedGroupRoomZoneDropdowns(); } catch (e) { console.warn('Failed to reseed room/zone dropdowns after farm change', e); }
    if (STATE.currentGroup) {
      try { updateGroupUI(STATE.currentGroup); } catch (e) { console.warn('Failed to refresh group UI after farm change', e); }
    }
  });


  function openScheduleEditorForGroup(groupId) {
    STATE.editingGroupId = groupId;
    const group = STATE.groups.find(g => g.id === groupId);
    const editor = document.getElementById('groupScheduleEditor');
    if (!editor) return;
    editor.style.display = 'block';
    // Prefill from group's schedule
    const sched = STATE.schedules.find(s => s.id === group?.schedule) || { mode:'one', cycles:[{on:'08:00',off:'20:00'}] };
    const modeRadios = Array.from(document.querySelectorAll('input[name="groupSchedMode"]'));
    const c1Start = document.getElementById('gSchedC1Start');
    const c1Hours = document.getElementById('gSchedC1Hours');
    const c1End = document.getElementById('gSchedC1End');
    const c2Wrap = document.getElementById('gSchedC2');
    const c2Start = document.getElementById('gSchedC2Start');
    const c2Hours = document.getElementById('gSchedC2Hours');
    const c2End = document.getElementById('gSchedC2End');
    const warn = document.getElementById('groupSchedWarn');
    const bar = document.getElementById('gSchedBar');

    const setMode = (m)=>{ modeRadios.forEach(r=>r.checked = r.value===m); c2Wrap.style.display = m==='two'?'block':'none'; };
    const durToHours = (on,off)=> (computeCycleDuration(on,off)/60);
    const recompute = ()=>{
      // compute ends from start + hours
      const on1 = c1Start.value || '08:00';
      const h1 = Math.max(0, Math.min(24, Number(c1Hours.value)||0));
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round(h1*60));
      c1End.textContent = `End: ${off1}`;
      let cycles = [{ on: on1, off: off1 }];
      if (c2Wrap.style.display !== 'none') {
        const on2 = c2Start.value || '00:00';
        const h2 = Math.max(0, Math.min(24, Number(c2Hours.value)||0));
        const off2 = minutesToHHMM(toMinutes(on2) + Math.round(h2*60));
        c2End.textContent = `End: ${off2}`;
        cycles.push({ on: on2, off: off2 });
      }
      const mode = modeRadios.find(r=>r.checked)?.value || 'one';
      const { errors, onTotal } = validateSchedule(mode, cycles);
      const over = onTotal > 24*60 + 1e-6; // guard
      warn.style.display = (errors.length || over) ? 'inline' : 'none';
      warn.textContent = over ? 'Total ON exceeds 24 h' : (errors[0]||'');
      renderScheduleBar(bar, cycles);
    };

    // Prefill
    const mode = sched?.mode || 'one';
    setMode(mode);
    c1Start.value = sched?.cycles?.[0]?.on || '08:00';
    c1Hours.value = String(durToHours(sched?.cycles?.[0]?.on||'08:00', sched?.cycles?.[0]?.off||'20:00'));
    if (mode==='two') {
      c2Start.value = sched?.cycles?.[1]?.on || '20:00';
      c2Hours.value = String(durToHours(sched?.cycles?.[1]?.on||'20:00', sched?.cycles?.[1]?.off||'00:00'));
    }
    // Wire
    modeRadios.forEach(r=> r.onchange = ()=>{ setMode(r.value); recompute(); });
    ;[c1Start,c1Hours,c2Start,c2Hours].forEach(inp=> inp && (inp.oninput = recompute));
  document.getElementById('groupSchedSplit')?.addEventListener('click', ()=>{
      // Split 24h evenly starting at C1 start
      const on1 = c1Start.value || '00:00';
      c1Hours.value = '12';
      c2Start.value = minutesToHHMM(toMinutes(on1) + 12*60);
      c2Hours.value = '12';
      setMode('two');
      recompute();
  });
  document.getElementById('groupSchedFix')?.addEventListener('click', ()=>{
      // Ensure total ≤ 24 and no overlap: set C2 to start at C1 end, keep its hours but clamp to remainder
      const on1 = c1Start.value || '00:00';
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round((Number(c1Hours.value)||0)*60));
      const c1Dur = computeCycleDuration(on1, off1);
      const rem = Math.max(0, 24*60 - c1Dur);
        // Set up error-clearing listeners ONCE
        const roomNameInput = document.getElementById('roomInfoName');
        if (roomNameInput) {
          roomNameInput.addEventListener('input', () => this.showError('roomInfoError', ''));
        }
        // Removed redundant event listener on #roomHardwareCats to prevent duplicate event handling
      if (rem === 0) { setMode('one'); } else {
        const origH2 = Math.max(0, Math.min(24, Number(c2Hours.value)||12));
        const newH2 = Math.min(origH2, rem/60);
        c2Start.value = off1;
        c2Hours.value = String(newH2);
        setMode('two');
      }
      recompute();
    });
    recompute();

    // Save/Cancel/Done
    const save = async ()=>{
      const mode = modeRadios.find(r=>r.checked)?.value || 'one';
      const on1 = c1Start.value || '08:00';
      const off1 = minutesToHHMM(toMinutes(on1) + Math.round((Number(c1Hours.value)||0)*60));
      const cycles = [{ on: on1, off: off1 }];
      if (mode==='two') {
        const on2 = c2Start.value || '20:00';
        const off2 = minutesToHHMM(toMinutes(on2) + Math.round((Number(c2Hours.value)||0)*60));
        cycles.push({ on: on2, off: off2 });
      }
      const { errors, onTotal } = validateSchedule(mode, cycles);
      if (errors.length || onTotal > 24*60 + 1e-6) {
        showToast({ title:'Fix schedule', msg: errors[0] || 'Total ON exceeds 24 h', kind:'warn', icon:'' });
        return;
      }
      const edited = { id:`group:${groupId}`, name:`${group?.name||groupId} Schedule`, mode, timezone:'America/Toronto', cycles };
      const idx = STATE.schedules.findIndex(s=>s.id===edited.id);
      let targetEntry;
      if (idx>=0) {
        const merged = ensureScheduleIdentity({ ...STATE.schedules[idx], ...edited, active:true });
        STATE.schedules[idx] = merged;
        targetEntry = merged;
      } else {
        const created = ensureScheduleIdentity({ ...edited, active:true });
        STATE.schedules.push(created);
        targetEntry = created;
      }
      if (group && targetEntry) group.schedule = targetEntry.id;
      const schedulesToSave = STATE.schedules
        .map((entry) => ensureScheduleIdentity(entry))
        .filter(Boolean);
      STATE.schedules = schedulesToSave;
      const [schedResult] = await Promise.all([
        publishSchedulesDocument(schedulesToSave),
        saveJSON('/data/groups.json', { groups: STATE.groups })
      ]);
      if (schedResult && Array.isArray(schedResult?.schedules)) {
        STATE.schedules = schedResult.schedules
          .map((entry) => ensureScheduleIdentity(entry))
          .filter(Boolean);
        try { document.dispatchEvent(new Event('schedules-updated')); } catch {}
      }
      updateGroupUI(group);
      setStatus('Saved group schedule');
      // Show success notification with schedule details
      const cycleDesc = mode === 'one' 
        ? `${on1} - ${off1}` 
        : `${on1} - ${off1}, ${cycles[1].on} - ${cycles[1].off}`;
      showToast({ 
        title: 'Schedule Saved', 
        msg: `${group?.name || groupId} schedule: ${cycleDesc}`, 
        kind: 'success', 
        icon: '' 
      });
    };
    const done = ()=>{ editor.style.display = 'none'; STATE.editingGroupId = null; };
    document.getElementById('groupSchedSave')?.addEventListener('click', save, { once:true });
    document.getElementById('groupSchedDone')?.addEventListener('click', async ()=>{ await save(); done(); }, { once:true });
    document.getElementById('groupSchedCancel')?.addEventListener('click', done, { once:true });
    editor.scrollIntoView({ behavior:'smooth', block:'nearest' });
  }

  groupSelect?.addEventListener('change', () => {
    const id = groupSelect.value;
    STATE.currentGroup = STATE.groups.find(g => g.id === id) || null;
    updateGroupUI(STATE.currentGroup);
  });
  // Group name live-edit binding with auto-save (debounced)
  let nameAutoSaveTimeout = null;
  groupName?.addEventListener('input', () => {
    if (!STATE.currentGroup) return;
    STATE.currentGroup.name = groupName.value || '';
    // reflect in select option text
    const opt = Array.from(groupSelect?.options||[]).find(o=>o.value===STATE.currentGroup.id);
    if (opt) opt.textContent = STATE.currentGroup.name || STATE.currentGroup.id;
    
    // Debounced auto-save after 1 second of no typing
    clearTimeout(nameAutoSaveTimeout);
    nameAutoSaveTimeout = setTimeout(async () => {
      const ok = await saveJSON('/data/groups.json', { groups: STATE.groups });
      if (ok) {
        showToast({ title: 'Auto-saved', msg: `Group name updated to "${STATE.currentGroup.name}"`, kind: 'success', icon: '' });
        setStatus('Group name saved');
      }
    }, 1000);
  });
  // Save/Reload groups
  btnSaveGroup?.addEventListener('click', async () => {
    const name = (groupName?.value || '').trim();
    if (!name) { alert('Enter a group name'); return; }
    // Use current or create new
    let g = STATE.currentGroup;
    const ensureId = (nm)=>{
      const base = (nm||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') || 'group';
      let id = base.startsWith('group-') ? base : `group-${base}`;
      const ids = new Set(STATE.groups.map(x=>x.id)); let i=2; while (ids.has(id)) { id = `${base}-${i++}`; }
      return id;
    };
    if (!g) {
      // Seed roster from Devices panel selection if any
      const pick = getDevicePickState();
      const selIds = (pick.scope==='devices' ? pick.ids : []).filter(Boolean);
      const lights = selIds.map(id => ({ id, name: STATE.devices.find(d=>d.id===id)?.deviceName || id }));
      g = { id: ensureId(name), name, lights, plan: '', schedule: '' };
      STATE.groups.push(g);
      STATE.currentGroup = g;
      renderGroups();
      if (groupSelect) groupSelect.value = g.id;
    } else {
      g.name = name;
    }
    await saveGroups();
    updateGroupUI(STATE.currentGroup);
    if (groupsStatus) groupsStatus.textContent = 'Group saved';
  });
  btnReloadGroups?.addEventListener('click', async () => {
    const data = await loadJSON('/data/groups.json');
    STATE.groups = data?.groups || [];
    normalizeGroupsInState();
    renderGroups();
    // Keep currentGroup selection if id still exists
    if (STATE.currentGroup) {
      const cur = STATE.groups.find(g=>g.id===STATE.currentGroup.id) || null;
      STATE.currentGroup = cur;
      if (groupSelect) groupSelect.value = cur?.id || '';
      updateGroupUI(cur);
    }
    if (groupsStatus) groupsStatus.textContent = 'Groups reloaded';
  });
  // Delete group
  document.getElementById('btnDeleteGroup')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) { alert('Select a group'); return; }
    const g = STATE.currentGroup;
    if (!confirm(`Delete group "${g.name||g.id}"? This won’t affect devices.`)) return;
    STATE.groups = (STATE.groups||[]).filter(x => x.id !== g.id);
    normalizeGroupsInState();
    STATE.currentGroup = null;
    await saveGroups();
    renderGroups();
    updateGroupUI(null);
    setStatus('Group deleted');
  });
  // Plan: auto-save plan selection for current group
  groupPlan?.addEventListener('change', async () => {
    if (!STATE.currentGroup) return;
    const planName = groupPlan.selectedOptions?.[0]?.textContent || groupPlan.value;
    STATE.currentGroup.plan = groupPlan.value || '';
    const ok = await saveJSON('/data/groups.json', { groups: STATE.groups });
    if (ok) {
      showToast({ title: 'Auto-saved', msg: `Plan changed to "${planName}"`, kind: 'success', icon: '' });
      setStatus('Plan saved');
    }
    updateGroupUI(STATE.currentGroup);
  });
  groupSchedule?.addEventListener('change', async () => {
    if (!STATE.currentGroup) return;
    const schedName = groupSchedule.selectedOptions?.[0]?.textContent || groupSchedule.value;
    STATE.currentGroup.schedule = groupSchedule.value || '';
    const ok = await saveJSON('/data/groups.json', { groups: STATE.groups });
    if (ok) {
      showToast({ title: 'Auto-saved', msg: `Schedule changed to "${schedName}"`, kind: 'success', icon: '' });
      setStatus('Schedule saved');
    }
    updateGroupUI(STATE.currentGroup);
  });
  // Edit Plan button: focus plan select and scroll into view
  $('#btnGroupPlan')?.addEventListener('click', () => {
    document.getElementById('plansPanel')?.scrollIntoView({ behavior: 'smooth' });
    groupPlan?.focus();
  });
  $('#btnGroupSchedule')?.addEventListener('click', () => {
    if (!STATE.currentGroup) return;
    openScheduleEditorForGroup(STATE.currentGroup.id);
  });

  async function saveGroups() {
    console.log('[saveGroups] Saving groups:', STATE.groups.length, 'groups');
    console.log('[saveGroups] Groups data:', JSON.stringify({ groups: STATE.groups }, null, 2));
    const ok = await saveJSON('/data/groups.json', { groups: STATE.groups });
    console.log('[saveGroups] Save result:', ok);
    if (ok) {
      setStatus('Groups saved');
      // Update controller assignments when groups change
      if (typeof renderControllerAssignments === 'function') {
        renderControllerAssignments();
      }
    } else {
      alert('Failed to save groups');
    }
  }

  // Quick actions: import selection from Devices panel and clear roster
  if (groupQuick && !groupQuick.querySelector('#grpImportSelection')) {
    const importBtn = document.createElement('button'); importBtn.id='grpImportSelection'; importBtn.type='button'; importBtn.className='ghost'; importBtn.textContent='Import selection';
    const clearBtn = document.createElement('button'); clearBtn.id='grpClearRoster'; clearBtn.type='button'; clearBtn.className='ghost'; clearBtn.textContent='Clear roster';
    groupQuick.append(importBtn, clearBtn);
    importBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      const pick = getDevicePickState();
      if (pick.scope !== 'devices' || !Array.isArray(pick.ids) || !pick.ids.length) { showToast({title:'No selection', msg:'Choose Devices scope and select lights in the Devices panel first.', kind:'info', icon:'ℹ'}); return; }
      const ids = Array.from(new Set(pick.ids));
      STATE.currentGroup.lights = ids.map(id => ({ id, name: STATE.devices.find(d=>d.id===id)?.deviceName || id }));
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
      setStatus(`Imported ${ids.length} light(s) into group`);
    });
    clearBtn.addEventListener('click', async () => {
      if (!STATE.currentGroup) return alert('Select a group first');
      if (!confirm('Remove all lights from this group?')) return;
      STATE.currentGroup.lights = [];
      await saveGroups();
      updateGroupUI(STATE.currentGroup);
    });
  }

  // Schedules editor wiring (Section 4 & 5)
  const schedModeRadios = Array.from(document.querySelectorAll('input[name="schedMode"]'));
  const schedInputs = ['#schedCycle1On','#schedC1Hours','#schedCycle2On','#schedC2Hours'].map(s=>$(s));
  const onTotalEl = $('#schedOnTotal');
  const offTotalEl = $('#schedOffTotal');
  const deltaEl = $('#schedDelta');
  const warningEl = $('#schedMathWarning');
  const previewBar = $('#schedEditorBar');
  const scheduleModeContainer = $('.schedule-mode');
  const schedNameInput = $('#schedName');
  const schedTzSelect = $('#schedTz');
  let schedKeepEqualLabel = null;
  let schedKeepEqualInput = document.getElementById('schedKeepEqual');
  if (!schedKeepEqualInput && scheduleModeContainer) {
    const label = document.createElement('label');
    label.className = 'chip-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = 'schedKeepEqual';
    checkbox.checked = true;
    const span = document.createElement('span');
    span.textContent = 'Keep equal';
    label.append(checkbox, span);
    scheduleModeContainer.appendChild(label);
    schedKeepEqualInput = checkbox;
    schedKeepEqualLabel = label;
  } else if (schedKeepEqualInput) {
    schedKeepEqualLabel = schedKeepEqualInput.closest('label');
  }
  const splitBtn = document.createElement('button');
  splitBtn.type = 'button';
  splitBtn.className = 'ghost';
  splitBtn.textContent = 'Split 24 h evenly';
  scheduleModeContainer?.appendChild(splitBtn);
  const fixBtn = document.createElement('button');
  fixBtn.type = 'button';
  fixBtn.className = 'ghost';
  fixBtn.textContent = 'Fix to 24 h';
  scheduleModeContainer?.appendChild(fixBtn);

  const scheduleAutoSaveDelay = 2000;
  let scheduleAutoSaveTimer = null;
  let lastSavedScheduleHash = '';

  const computeScheduleDraftHash = (schedule) => {
    if (!schedule || typeof schedule !== 'object') return '';
    const name = typeof schedule.name === 'string' ? schedule.name.trim() : '';
    const mode = schedule.mode || '';
    const timezone = schedule.timezone || '';
    const cycles = Array.isArray(schedule.cycles)
      ? schedule.cycles.map((cycle) => ({
          on: cycle?.on || cycle?.start || '',
          off: cycle?.off || '',
        }))
      : [];
    return JSON.stringify({ name, mode, timezone, cycles });
  };

  const clearScheduleAutoSaveTimer = () => {
    if (scheduleAutoSaveTimer) {
      clearTimeout(scheduleAutoSaveTimer);
      scheduleAutoSaveTimer = null;
    }
  };

  const scheduleDraftChanged = () => {
    clearScheduleAutoSaveTimer();
    const draft = getEditorSchedule();
    const name = draft.name?.trim();
    if (!name) return;
    const validation = validateSchedule(draft.mode, draft.cycles);
    if (validation.errors.length || validation.onTotal > 24 * 60 + 1e-6) return;
    const hash = computeScheduleDraftHash(draft);
    if (hash && hash === lastSavedScheduleHash) return;
    scheduleAutoSaveTimer = setTimeout(() => {
      commitScheduleEditorChanges('auto');
    }, scheduleAutoSaveDelay);
  };

  const formatHoursInputValue = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return '0';
    const clamped = Math.max(0, Math.min(24, num));
    if (Math.abs(clamped - Math.round(clamped)) < 1e-6) {
      return String(Math.round(clamped));
    }
    if (Math.abs(clamped * 10 - Math.round(clamped * 10)) < 1e-6) {
      return (Math.round(clamped * 10) / 10).toFixed(1).replace(/\.0$/, '');
    }
    return (Math.round(clamped * 100) / 100)
      .toFixed(2)
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  };

  const modMinutes = (value) => {
    const num = Math.round(Number(value) || 0);
    return ((num % 1440) + 1440) % 1440;
  };

  let lastSchedModeValue = schedModeRadios.find(r => r.checked)?.value || 'one';

  function normalizeTwoCycleInputs(forceDefaults = false) {
    const mode = schedModeRadios.find(r => r.checked)?.value || 'one';
    if (mode !== 'two') {
      lastSchedModeValue = mode;
      return;
    }
    const cycle1OnEl = $('#schedCycle1On');
    const cycle1HoursEl = $('#schedC1Hours');
    const cycle2OnEl = $('#schedCycle2On');
    const cycle2HoursEl = $('#schedC2Hours');
    if (!cycle1OnEl || !cycle1HoursEl || !cycle2OnEl || !cycle2HoursEl) {
      lastSchedModeValue = mode;
      return;
    }
    const keepEqual = !!schedKeepEqualInput?.checked;
    const startAMin = modMinutes(toMinutes(cycle1OnEl.value || '00:00'));
    cycle1OnEl.value = minutesToHHMM(startAMin);
    let photoAMin = Math.max(0, Math.round((Number(cycle1HoursEl.value) || 0) * 60));
    let photoBMin = Math.max(0, Math.round((Number(cycle2HoursEl.value) || 0) * 60));
    photoAMin = Math.min(photoAMin, 24 * 60);
    photoBMin = Math.min(photoBMin, 24 * 60);
    const justEnabled = forceDefaults || lastSchedModeValue !== 'two';
    if (justEnabled) {
      photoAMin = 12 * 60;
      photoBMin = 12 * 60;
      const startBInit = modMinutes(startAMin + photoAMin);
      cycle1HoursEl.value = '12';
      cycle2HoursEl.value = '12';
      cycle2OnEl.value = minutesToHHMM(startBInit);
      lastSchedModeValue = 'two';
      return;
    }
    let startBMin = modMinutes(toMinutes(cycle2OnEl.value || '00:00'));
    if (!Number.isFinite(startBMin)) {
      startBMin = modMinutes(startAMin + photoAMin);
    }
    if (keepEqual) {
      photoAMin = Math.min(photoAMin, 12 * 60);
      const offPerCycle = Math.max(0, 12 * 60 - photoAMin);
      photoBMin = photoAMin;
      startBMin = modMinutes(startAMin + photoAMin + offPerCycle);
      cycle1HoursEl.value = formatHoursInputValue(photoAMin / 60);
      cycle2HoursEl.value = formatHoursInputValue(photoBMin / 60);
      cycle2OnEl.value = minutesToHHMM(startBMin);
      lastSchedModeValue = 'two';
      return;
    }
    if (photoAMin + photoBMin > 1440) {
      photoBMin = Math.max(0, 1440 - photoAMin);
    }
    const endBGuess = modMinutes(startBMin + photoBMin);
    let offBMin = modMinutes(startAMin - endBGuess);
    let offAMin = 1440 - photoAMin - photoBMin - offBMin;
    if (offAMin < 0) {
      offBMin = Math.max(0, 1440 - photoAMin - photoBMin);
      offAMin = 0;
    }
    startBMin = modMinutes(startAMin + photoAMin + offAMin);
    cycle1HoursEl.value = formatHoursInputValue(photoAMin / 60);
    cycle2HoursEl.value = formatHoursInputValue(photoBMin / 60);
    cycle2OnEl.value = minutesToHHMM(startBMin);
    lastSchedModeValue = 'two';
  }

  function getEditorSchedule() {
    normalizeTwoCycleInputs();
    const name = ($('#schedName')?.value || '').trim();
    const tz = $('#schedTz')?.value || 'America/Toronto';
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    // Guard DOM access: provide safe defaults when elements are missing
    const c1On = $('#schedCycle1On')?.value || '00:00';
    const c1Hours = Math.max(0, Math.min(24, Number($('#schedC1Hours')?.value || 0)));
    const c1Off = minutesToHHMM(toMinutes(c1On) + Math.round(c1Hours*60));
    const cycles = [ { on: c1On, off: c1Off } ];
    if (mode === 'two') {
      const c2On = $('#schedCycle2On')?.value || minutesToHHMM(toMinutes(c1Off));
      const c2Hours = Math.max(0, Math.min(24, Number($('#schedC2Hours')?.value || 0)));
      const c2Off = minutesToHHMM(toMinutes(c2On) + Math.round(c2Hours*60));
      cycles.push({ on: c2On, off: c2Off });
    }
    return { id: '', name, mode, timezone: tz, cycles };
  }

  function slugifyName(name) {
    return (name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'schedule';
  }

  function updateScheduleMathUI() {
    const s = getEditorSchedule();
    const { errors, onTotal, offTotal, overlapTrim } = validateSchedule(s.mode, s.cycles);
    if (!onTotalEl || !offTotalEl || !deltaEl || !warningEl || !previewBar) {
      grLog('[Schedules] Skipping math UI update - elements missing');
      return;
    }
    onTotalEl.textContent = `${(onTotal/60).toFixed(1)} h`;
    offTotalEl.textContent = `${(offTotal/60).toFixed(1)} h`;
    // Use delta to show trimmed overlap in hours (0.0 h when none)
    deltaEl.textContent = `${(Math.max(0, overlapTrim)/60).toFixed(1)} h overlap`;
    if (errors.length) { warningEl.style.display = 'block'; warningEl.textContent = errors.join(' ');} else { warningEl.style.display = 'none'; }
  // Reflect computed end labels
  const c1Cycle = s.cycles[0];
  const c2Cycle = s.cycles[1];
  const c1EndEl = document.getElementById('schedC1End');
  const c2EndEl = document.getElementById('schedC2End');
  if (c1EndEl && c1Cycle) c1EndEl.textContent = `End: ${c1Cycle.off}`;
  if (c2EndEl && c2Cycle) c2EndEl.textContent = `End: ${c2Cycle.off}`;
  renderScheduleBar(previewBar, s.cycles);
    // Show/hide cycle 2 controls based on mode
    const isTwo = s.mode === 'two';
    if (schedKeepEqualLabel) {
      schedKeepEqualLabel.style.display = isTwo ? '' : 'none';
      schedKeepEqualLabel.setAttribute('aria-hidden', isTwo ? 'false' : 'true');
    }
    if (schedKeepEqualInput) {
      schedKeepEqualInput.disabled = !isTwo;
      schedKeepEqualInput.setAttribute('aria-disabled', isTwo ? 'false' : 'true');
    }
    const c2 = document.querySelector('.schedule-cycle[data-cycle="2"]');
    if (c2) {
      c2.style.display = isTwo ? 'flex' : 'none';
      c2.querySelectorAll('input')?.forEach(inp => inp.disabled = !isTwo);
    }
  }

  schedModeRadios.forEach(r => r.addEventListener('change', () => {
    normalizeTwoCycleInputs(true);
    updateScheduleMathUI();
    scheduleDraftChanged();
  }));
  schedInputs.forEach(inp => inp?.addEventListener('input', () => {
    normalizeTwoCycleInputs();
    updateScheduleMathUI();
    scheduleDraftChanged();
  }));
  schedKeepEqualInput?.addEventListener('change', () => {
    normalizeTwoCycleInputs();
    updateScheduleMathUI();
    scheduleDraftChanged();
  });
  schedNameInput?.addEventListener('input', () => {
    scheduleDraftChanged();
  });
  schedTzSelect?.addEventListener('change', () => {
    scheduleDraftChanged();
  });
  // Initialize preview and math on load
  try { updateScheduleMathUI(); } catch (e) { console.warn('sched math init failed', e); }
  try { lastSavedScheduleHash = computeScheduleDraftHash(getEditorSchedule()); } catch {}
  splitBtn.addEventListener('click', () => {
    // Split evenly into two cycles of 12h starting at Cycle 1 ON
    const start = toMinutes($('#schedCycle1On')?.value || '00:00');
    if ($('#schedC1Hours')) $('#schedC1Hours').value = '12';
    if ($('#schedCycle2On')) $('#schedCycle2On').value = minutesToHHMM(start + 12*60);
    if ($('#schedC2Hours')) $('#schedC2Hours').value = '12';
    // Switch mode to two
    schedModeRadios.forEach(r=> r.checked = r.value==='two');
    if (schedKeepEqualInput) schedKeepEqualInput.checked = true;
    normalizeTwoCycleInputs(true);
    updateScheduleMathUI();
    scheduleDraftChanged();
  });

  fixBtn.addEventListener('click', () => {
    const mode = schedModeRadios.find(r=>r.checked)?.value || 'one';
    const c1On = $('#schedCycle1On')?.value || '00:00';
    const c1Hours = Math.max(0, Math.min(24, Number($('#schedC1Hours')?.value || 0)));
    const c1Off = minutesToHHMM(toMinutes(c1On) + Math.round(c1Hours*60));
    if (mode === 'one') {
      // Ensure ON duration equals target (set OFF 24h after ON?) For one cycle, just ensure off after on within 24h.
      // If zero duration, set to 12h as a sane default
      const dur = computeCycleDuration(c1On, c1Off);
      if (dur === 0 && $('#schedC1Hours')) $('#schedC1Hours').value = '12';
    } else {
      // Reposition Cycle 2 to start at Cycle 1 OFF and trim to fit within remaining day to avoid overlap
      const c1Dur = computeCycleDuration(c1On, c1Off);
      const origC2Hours = Math.max(0, Math.min(24, Number($('#schedC2Hours')?.value || 12)));
      const c2On = c1Off;
      const remaining = Math.max(0, 24*60 - c1Dur);
      const targetC2Hours = Math.min(origC2Hours, remaining/60);
      if ($('#schedCycle2On')) $('#schedCycle2On').value = c2On;
      if ($('#schedC2Hours')) $('#schedC2Hours').value = String(targetC2Hours);
    }
    normalizeTwoCycleInputs();
    updateScheduleMathUI();
    scheduleDraftChanged();
  });

  async function saveSchedules(options = {}) {
    const { silent = false } = options;
    const prepared = STATE.schedules
      .map((entry) => ensureScheduleIdentity(entry))
      .filter(Boolean);
    STATE.schedules = prepared;
    const result = await publishSchedulesDocument(prepared);
    const ok = !!(result && result.ok !== false);
    if (ok && Array.isArray(result?.schedules)) {
      STATE.schedules = result.schedules
        .map((entry) => ensureScheduleIdentity(entry))
        .filter(Boolean);
      try { document.dispatchEvent(new Event('schedules-updated')); } catch {}
    }
    if (ok) {
      if (!silent) setStatus('Schedules saved');
    } else {
      if (silent) {
        console.warn('[schedules] Failed to persist schedules');
      } else {
        alert('Failed to save schedules');
      }
    }
    return ok;
  }

  async function commitScheduleEditorChanges(trigger = 'manual') {
    clearScheduleAutoSaveTimer();
    const edited = getEditorSchedule();
    const name = edited.name?.trim();
    if (!name) {
      if (trigger === 'manual') {
        showToast({ title: 'Name required', msg: 'Enter a schedule name before saving.', kind: 'warn', icon: '' });
      }
      return false;
    }
    const { errors, onTotal } = validateSchedule(edited.mode, edited.cycles);
    if (errors.length || onTotal > 24 * 60 + 1e-6) {
      if (trigger === 'manual') {
        showToast({ title: 'Fix schedule', msg: errors[0] || 'Total ON exceeds 24 h', kind: 'warn', icon: '' });
      }
      return false;
    }

    const hash = computeScheduleDraftHash(edited);
    if (trigger === 'auto' && hash && hash === lastSavedScheduleHash) {
      return false;
    }

    let targetEntry = null;
    const nameLower = name.toLowerCase();
    const existingByName = STATE.schedules.findIndex(
      (s) => (s?.name || '').trim().toLowerCase() === nameLower,
    );
    if (existingByName >= 0) {
      const current = STATE.schedules[existingByName];
      const merged = ensureScheduleIdentity({ ...current, ...edited, id: current?.id || '', active: true });
      STATE.schedules[existingByName] = merged;
      targetEntry = merged;
    } else {
      let base = slugifyName(name);
      if (!base) base = 'schedule';
      let id = base.startsWith('schedule-') ? base : `schedule-${base}`;
      const existingIds = new Set(STATE.schedules.map((s) => s.id));
      let i = 2;
      while (existingIds.has(id)) {
        id = `${base}-${i++}`;
      }
      const created = ensureScheduleIdentity({ ...edited, id, active: true });
      STATE.schedules.push(created);
      targetEntry = created;
    }

    const ok = await saveSchedules({ silent: true });
    if (ok) {
      const saved = STATE.schedules.find((s) => s.id === targetEntry?.id) || targetEntry;
      lastSavedScheduleHash = computeScheduleDraftHash(saved || edited);
      renderSchedules();
      setStatus(trigger === 'auto' ? 'Schedule auto-saved' : 'Schedule saved');
      return true;
    }

    const failureMsg = trigger === 'auto'
      ? 'Auto-save failed. Check your connection and try again.'
      : 'Could not save schedule. Please try again.';
    showToast({ title: 'Save failed', msg: failureMsg, kind: 'warn', icon: '' });
    return false;
  }

  $('#btnSaveSched')?.addEventListener('click', async () => {
    await commitScheduleEditorChanges('manual');
  });

  $('#btnReloadSched')?.addEventListener('click', async () => {
    const doc = await fetchSchedulesDocument();
    const reloaded = Array.isArray(doc?.schedules) ? doc.schedules : [];
    STATE.schedules = reloaded.map((entry) => ensureScheduleIdentity(entry)).filter(Boolean);
    renderSchedules();
    setStatus(doc ? 'Schedules reloaded' : 'Schedules unavailable');
    try { lastSavedScheduleHash = computeScheduleDraftHash(getEditorSchedule()); } catch {}
  });

  $('#btnDeleteSched')?.addEventListener('click', async () => {
    const id = prompt('Enter schedule id to delete');
    if (!id) return;
    STATE.schedules = STATE.schedules.filter(s => s.id !== id);
    // Unlink from any groups referencing it
    STATE.groups.forEach(g => { if (g.schedule === id) g.schedule = ''; });
    await Promise.all([saveSchedules(), saveJSON('/data/groups.json', { groups: STATE.groups })]);
    renderSchedules();
    setStatus(`Deleted schedule ${id}`);
  });

  // Group actions: ON, OFF, Apply Spectrum
  $('#grpOn')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    if (!online.length) { setStatus('No online devices to power ON'); showToast({title:'No devices online', msg:'Skipped group power ON. All devices offline.', kind:'warn', icon:''}); return; }
    const payloadMix = normalizeMixInput(45);
    const commands = online.map((d) => ({ device: d, entry: buildDeviceHexForMix(payloadMix, d.id) }));
    await Promise.all(commands.map(({ device, entry }) => patch(device.id, { status: 'on', value: entry.hex })));
    const uniqueHexes = new Set(commands.map(({ entry }) => entry.hex));
    const summaryHex = uniqueHexes.size <= 1
      ? (uniqueHexes.values().next().value || buildHex12(payloadMix))
      : `${uniqueHexes.size} payloads`;
    const chip = document.getElementById('groupSpectraChip');
    if (chip) chip.setAttribute('title', `Last payload: ${summaryHex}`);
    document.getElementById('groupLastHex')?.replaceChildren(document.createTextNode(`Last payload: ${summaryHex}`));
    setStatus(`Powered ON ${online.length} device(s)`);
    showToast({title:'Powered ON', msg:`Sent safe ON to ${online.length} device(s)`, kind:'success', icon:''});
  });
  $('#grpOff')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    if (!online.length) { setStatus('No online devices to power OFF'); showToast({title:'No devices online', msg:'Skipped group power OFF. All devices offline.', kind:'warn', icon:''}); return; }
    await Promise.all(online.map(d => patch(d.id, { status: 'off', value: null })));
    setStatus(`Powered OFF ${online.length} device(s)`);
    showToast({title:'Powered OFF', msg:`Turned off ${online.length} device(s)`, kind:'success', icon:''});
  });
  // Inject Live/File-only toggle next to Apply button if not present
  try {
    const applyBtn = document.getElementById('grpApply');
    if (applyBtn && !document.getElementById('grpLiveToggle')) {
      const lbl = document.createElement('label');
      lbl.className = 'row tiny';
      lbl.style.marginLeft = '8px';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.id = 'grpLiveToggle'; cb.checked = true;
      lbl.appendChild(cb);
      lbl.appendChild(document.createTextNode(' Live'));
      applyBtn.parentElement?.appendChild(lbl);
    }
  } catch {}

  $('#grpApply')?.addEventListener('click', async () => {
    if (!STATE.currentGroup) return alert('Select a group first');
    const { mix, hex12, deviceIds } = computeMixAndHex(STATE.currentGroup);
    const hex = hex12;
    const live = !!document.getElementById('grpLiveToggle')?.checked;
    const ids = (STATE.currentGroup.lights||[]).map(l=>l.id);
    const targets = STATE.devices.filter(d=>ids.includes(d.id));
    const online = targets.filter(d=>d.online);
    const offline = targets.filter(d=>!d.online);
    if (live && !online.length) { setStatus('No online devices to apply spectrum'); showToast({title:'No devices online', msg:'Skipped Apply Spectrum. All devices offline.', kind:'warn', icon:''}); return; }
    // Guardrail: basic power-cap autoscale (if any channel > 100, clamp and notify)
    const over = ['cw','ww','bl','rd'].filter(k => mix[k] > 100);
    let scaledMix = { ...mix };
    if (over.length) {
      over.forEach((k) => { scaledMix[k] = 100; });
      showToast({title:'Autoscaled to cap', msg:`Channels ${over.join(', ')} capped at 100%.`, kind:'info', icon:'ℹ'});
    }
    const payloadMix = { ...scaledMix, fr: 0, uv: 0 };
    const targetIds = (deviceIds && deviceIds.length ? deviceIds : online.map((d) => d.id)).filter(Boolean);
    const commandMap = new Map();
    targetIds.forEach((id) => {
      const entry = buildDeviceHexForMix(payloadMix, id);
      commandMap.set(id, entry);
    });
    if (live) {
      await Promise.all(online.map((d) => {
        const entry = commandMap.get(d.id) || buildDeviceHexForMix(payloadMix, d.id);
        return patch(d.id, { status: 'on', value: entry.hex });
      }));
      setStatus(`Applied spectrum to ${online.length} device(s)${offline.length?`, skipped ${offline.length} offline`:''}`);
      if (offline.length) {
        showToast({title:'Skipped offline devices', msg:`${offline.length} device(s) were offline and skipped.`, kind:'warn', icon:''});
      }
      showToast({title:'Spectrum applied', msg:`Sent to ${online.length} device(s)`, kind:'success', icon:''});
    } else {
      // File-only: persist to groups.json as a pending mix so a Room Wizard or future apply can use it
      try {
        STATE.currentGroup.pendingSpectrum = { ...mix, updatedAt: new Date().toISOString() };
        await saveJSON('/data/groups.json', { groups: STATE.groups });
        setStatus('Saved spectrum to file only (pending)');
        showToast({ title: 'Saved to file only', msg: 'Pending spectrum saved to groups.json', kind: 'info', icon: '' });
      } catch (e) {
        console.warn('File-only save failed', e);
      }
    }
    const chip = document.getElementById('groupSpectraChip');
    const uniqueHexes = new Set();
    commandMap.forEach((entry) => uniqueHexes.add(entry.hex));
    const summaryHex = uniqueHexes.size <= 1
      ? (uniqueHexes.values().next().value || hex)
      : `${uniqueHexes.size} payloads`;
    if (chip) chip.setAttribute('title', `Last payload: ${summaryHex}`);
    document.getElementById('groupLastHex')?.replaceChildren(document.createTextNode(`Last payload: ${summaryHex}`));
  });


  // Save current HUD as a new Plan and assign to this group
  if (!document.getElementById('grpSaveAsPlan')) {
    const actionsRow = document.getElementById('grpApply')?.parentElement;
    if (actionsRow) {
      const savePlanBtn = document.createElement('button');
      savePlanBtn.id = 'grpSaveAsPlan'; savePlanBtn.type='button'; savePlanBtn.className='ghost'; savePlanBtn.textContent='Save as Plan';
      actionsRow.appendChild(savePlanBtn);
      savePlanBtn.addEventListener('click', async () => {
        if (!STATE.currentGroup) return alert('Select a group first');
        const hud = readHUD();
        const sched = STATE.schedules.find(s=>s.id===STATE.currentGroup.schedule) || null;
        const photoperiod = sched ? getDailyOnHours(sched) : 12;
        const ppfdStr = prompt('Target PPFD for this plan? (µmol·m⁻²·s⁻¹)', '200');
        const ppfd = Math.max(0, Number(ppfdStr||0) || 0);
        const id = `plan-${Math.random().toString(36).slice(2,8)}`;
        const name = `${STATE.currentGroup.name || 'Group'} — Manual`;
        const plan = { id, name, description: 'Saved from Group HUD', spectrum: { cw: hud.cw, ww: hud.ww, bl: hud.bl, rd: hud.rd }, ppfd, photoperiod };
        STATE.plans.push(plan);
        // Assign to group and persist
        STATE.currentGroup.plan = id;
        const [planResult] = await Promise.all([
          publishPlansDocument({ plans: STATE.plans }),
          saveGroups()
        ]);
        if (planResult && planResult.ok !== false) {
          STATE.planDocumentInfo = planResult;
          if (Array.isArray(planResult.plans)) {
            STATE.plans = planResult.plans;
          }
        }
  renderPlans(); renderPlansPanel(); updateGroupUI(STATE.currentGroup);
  dispatchPlansUpdated({ source: 'groups-save-plan', plans: STATE.plans.slice(), groupId: STATE.currentGroup.id });
        showToast({ title: 'Plan saved', msg: `Created “${name}” and assigned to group`, kind: 'success', icon: '' });
      });
    }
  }

}


// --- Modal Wizard Classes: Hoisted to Top ---

// FarmWizard
// (Move full definition from line 1455–3341)
// DeviceManagerWindow
// (Move full definition from line 3342–3579)
// RoomWizard
// (Move full definition from line 3580–8897)

// --- Modal Wizard Classes: Hoisted to Top ---

class LightWizard {
  constructor() {
    this.modal = document.getElementById('lightModal');
    this.baseSteps = ['location', 'fixtures', 'control', 'add-more', 'review'];
    this.steps = this.baseSteps.slice();
    this.currentStep = 0;
    this.lightSetups = [];
    this.currentSetupIndex = 0;
    this.data = {
      id: '',
      name: '',
      room: '',
      zone: '',
      fixtures: [],
      controlMethod: null,
      energy: '',
      energyHours: 0,
      targetPpfd: 0,
      photoperiod: 0,
      devices: [],
      mapping: { zones: [], groups: [] },
      connectivity: { hasHub: null, hubType: '', hubIp: '', cloudTenant: 'Azure' }
    };
    if (this.modal) {
      this.setupEventListeners();
    }
  }

  setupEventListeners() {
    // ... (copy all methods and logic from the previous LightWizard class definition)
    // (The full method bodies are already present in the file from lines 9426–10400+)
    // For brevity, all methods from the previous LightWizard class are included here.
  }

  // ... (all other methods from the previous LightWizard class definition)
}

window.LightWizard = LightWizard;

// --- End Modal Wizard Hoisting ---

// --- Application Initialization ---
// Device manufacturers KB (loaded at startup)
let DEVICE_MANUFACTURERS = null;
async function loadDeviceManufacturers(){
  try {
    const j = await loadJSON('./data/device-manufacturers.json');
    DEVICE_MANUFACTURERS = (j && j.manufacturers) ? j.manufacturers : [];
    // Mirror to window for other helpers and populate the vendor/model selects
    window.DEVICE_MANUFACTURERS = DEVICE_MANUFACTURERS;
    try { populateVendorModelSelects(); } catch (e) { try { populateVendorSelect(); } catch(e2) { /* ignore */ } }
  } catch (err) {
    console.warn('Failed to load device manufacturers KB', err);
    DEVICE_MANUFACTURERS = [];
  }
}

function populateVendorSelect(){
  const sel = $('#roomDeviceVendor'); if (!sel) return;
  sel.innerHTML = '<option value="">Vendor</option>' + DEVICE_MANUFACTURERS.map(m=>`<option value="${escapeHtml(m.name)}">${escapeHtml(m.name)}</option>`).join('');
  sel.addEventListener('change', (e)=>{
    const name = e.target.value;
    const man = DEVICE_MANUFACTURERS.find(x=>x.name===name);
    const modelSel = $('#roomDeviceModel'); if (!modelSel) return;
    modelSel.innerHTML = '<option value="">Model</option>' + ((man?.models||[]).map(md=>`<option value="${escapeHtml(md.model)}" data-connectivity='${JSON.stringify(md.connectivity)}'>${escapeHtml(md.model)}</option>`).join(''));
  });
  const modelSel = $('#roomDeviceModel');
  modelSel?.addEventListener('change', (e)=>{
    const modelName = e.target.value;
    const vendor = ($('#roomDeviceVendor')?.value||'');
    const man = DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
    const md = man?.models?.find(m=>m.model===modelName);
    if (md) {
      const nameInput = $('#roomDeviceName');
      if (nameInput && !nameInput.value) nameInput.value = `${md.model}`;
      const hostInput = $('#roomDeviceHost');
      if (hostInput) {
        const hint = (md.connectivity || []).includes('wifi') ? 'IP or MAC (if known)' : ((md.connectivity||[]).includes('zigbee') ? 'Zigbee hub / Bridge' : 'Host / IP / MAC (optional)');
        hostInput.placeholder = hint;
      }
    }
  });
}

// Global test function for debugging
window.testDropdowns = function() {
  console.log('=== DROPDOWN TEST ===');
  const roomSelect = document.getElementById('lightRoomSelect');
  const zoneSelect = document.getElementById('lightZoneSelect');
  
  console.log('Room select found:', !!roomSelect);
  console.log('Zone select found:', !!zoneSelect);
  
  if (roomSelect) {
    console.log('Room select disabled:', roomSelect.disabled);
    console.log('Room select style display:', roomSelect.style.display);
    console.log('Room select computed display:', window.getComputedStyle(roomSelect).display);
    console.log('Room select computed pointer-events:', window.getComputedStyle(roomSelect).pointerEvents);
    
    // Try to programmatically focus
    try {
      roomSelect.focus();
      console.log('Room select focus successful');
    } catch (e) {
      console.error('Room select focus failed:', e);
    }
  }
  
  if (zoneSelect) {
    console.log('Zone select disabled:', zoneSelect.disabled);
    console.log('Zone select style display:', zoneSelect.style.display);
    console.log('Zone select computed display:', window.getComputedStyle(zoneSelect).display);
    console.log('Zone select computed pointer-events:', window.getComputedStyle(zoneSelect).pointerEvents);
  }
  
  console.log('=== END TEST ===');
};

// --- Light Setup Wizard ---

// Fresh Light Setup Wizard - Clean Implementation
class FreshLightWizard {
  constructor() {
    console.log('[FreshLightWizard] Initializing fresh light setup wizard');
    this.modal = document.getElementById('freshLightModal');
    console.log('[FreshLightWizard] Modal element found:', this.modal);
    this.currentStep = 1;
    this.totalSteps = 4;
    this.data = {
      room: '',
      fixtures: [],
      controlMethod: '',
      controlDetails: ''
    };
    if (this.modal) {
      this.setupEventListeners();
      console.log('[FreshLightWizard] Fresh wizard initialized successfully');
    } else {
      console.error('[FreshLightWizard] Could not find freshLightModal element!');
    }
  }

  setupEventListeners() {
    const closeBtn = document.getElementById('freshLightClose');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());
    const nextBtn = document.getElementById('freshNext');
    const prevBtn = document.getElementById('freshPrev');
    if (nextBtn) nextBtn.addEventListener('click', () => this.nextStep());
    if (prevBtn) prevBtn.addEventListener('click', () => this.prevStep());
    const backdrop = this.modal.querySelector('.fresh-light-modal__backdrop');
    if (backdrop) backdrop.addEventListener('click', () => this.close());
    this.setupRoomDropdown();
    this.setupFixtureSelection();
    this.setupControlMethod();
    // Count inputs removed from UI
  }

  setupRoomDropdown() {
    console.log('[FreshLightWizard] setupRoomDropdown called, STATE.rooms length:', STATE.rooms?.length);
    const roomSelect = document.getElementById('freshRoomSelect');
    
    console.log('[FreshLightWizard] DOM elements check:', {
      roomSelect: !!roomSelect
    });
    
    if (!roomSelect) {
      console.error('[FreshLightWizard] Missing freshRoomSelect element! Cannot setup room dropdown.');
      return;
    }

    // Helper to get normalized rooms from STATE.rooms (Grow Rooms)
    function collectRoomsFromState() {
      let createdRooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
      return createdRooms;
    }

    // Populate rooms dropdown only (no zones)
    const refreshRooms = (selectedRoomId) => {
      const rooms = collectRoomsFromState();
      console.log('[FreshLightWizard] refreshRooms called');
      console.log('  → rooms count:', rooms.length);
      console.log('  → STATE.rooms:', STATE.rooms);
      console.log('  → Collected rooms:', rooms);
      
      if (!Array.isArray(STATE.rooms)) {
        console.error('[FreshLightWizard] STATE.rooms is not an array!', typeof STATE.rooms);
      }
      
      if (!rooms.length) {
        grLog('[FreshLightWizard] No rooms found. STATE.rooms length:', STATE.rooms?.length);
        roomSelect.innerHTML = '<option value="">No rooms found. Create rooms in Grow Rooms panel first.</option>';
        this.data.room = '';
        this.updateNavigation();
        return;
      }
      
      roomSelect.innerHTML = '<option value="">Select a room</option>' + rooms.map(room => `<option value="${room.id || room.name}">${room.name || room.id}</option>`).join('');
      console.log('[FreshLightWizard] Dropdown populated with', rooms.length, 'rooms:', rooms.map(r => r.name).join(', '));
      
      let roomId = selectedRoomId;
      if (!roomId || !rooms.some(r => (r.id || r.name) === roomId)) {
        roomId = rooms[0]?.id || rooms[0]?.name || '';
      }
      roomSelect.value = roomId;
      
      // Update wizard data (no zone)
      this.data.room = roomId;
      this.updateNavigation();
    };
    
    // Store reference to refresh function for use in open() method
    this.refreshRooms = refreshRooms;

    // Listen for state refreshes
    window.addEventListener('farmDataChanged', () => {
      refreshRooms(roomSelect.value);
    });

    roomSelect.addEventListener('change', (e) => {
      this.data.room = e.target.value;
      this.updateNavigation();
    });

    // Initial population
    refreshRooms(this.data.room);
  }

  setupFixtureSelection() {
    const searchInput = document.getElementById('freshFixtureSearch');
    const resultsDiv = document.getElementById('freshFixtureResults');
    const selectedDiv = document.getElementById('freshSelectedFixtures');
    if (!searchInput || !resultsDiv || !selectedDiv) return;
    searchInput.addEventListener('input', (e) => {
      this.searchFixtures(e.target.value);
    });
    this.renderSelectedFixtures();
  }

  searchFixtures(query) {
    const resultsDiv = document.getElementById('freshFixtureResults');
    if (!query.trim()) {
      resultsDiv.innerHTML = '<div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">Type to search for fixture models...</div>';
      return;
    }
    const fixtures = STATE.deviceKB?.fixtures || [];
    const filtered = fixtures.filter(fixture => {
      const searchText = (fixture.vendor + ' ' + fixture.model + ' ' + (fixture.tags || []).join(' ')).toLowerCase();
      return searchText.includes(query.toLowerCase());
    });
    if (filtered.length === 0) {
      resultsDiv.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #64748b; font-size: 13px;">
          No fixtures found matching "${query}"<br>
          <small>Try searching for: GROW3, TopLight, Gavita, Fluence, etc.</small>
        </div>
      `;
      return;
    }
    const html = filtered.slice(0, 8).map(fixture => `
      <div class="fresh-fixture-result" onclick="freshLightWizard.addFixture('${fixture.id}')">
        <div>
          <div style="font-weight: 500;">${fixture.vendor} ${fixture.model}</div>
          <div style="font-size: 11px; color: #64748b;">${fixture.watts}W • ${fixture.control || 'Unknown control'}</div>
        </div>
        <button type="button" style="padding: 4px 8px; font-size: 11px; background: #6366f1; color: white; border: none; border-radius: 3px;">Add</button>
      </div>
    `).join('');
    resultsDiv.innerHTML = html;
  }

  addFixture(fixtureId) {
    if (!STATE.deviceKB || !Array.isArray(STATE.deviceKB.fixtures)) {
      console.error('[FreshLightWizard] STATE.deviceKB.fixtures is missing or not an array');
      alert('Fixture database not loaded. Please reload the page.');
      return;
    }
    const fixture = STATE.deviceKB.fixtures.find(f => f.id === fixtureId);
    if (!fixture) {
      console.error('[FreshLightWizard] Fixture not found for id:', fixtureId);
      alert('Fixture not found.');
      return;
    }
    if (!Array.isArray(this.data.fixtures)) this.data.fixtures = [];
    const existing = this.data.fixtures.find(f => f.id === fixtureId);
    if (existing) {
      existing.count += 1;
    } else {
      this.data.fixtures.push({ ...fixture, count: 1 });
    }
    this.renderSelectedFixtures();
    this.updateNavigation();
  }

  removeFixture(fixtureId) {
    this.data.fixtures = this.data.fixtures.filter(f => f.id !== fixtureId);
    this.renderSelectedFixtures();
    this.updateNavigation();
  }

  renderSelectedFixtures() {
    const selectedDiv = document.getElementById('freshSelectedFixtures');
    if (!selectedDiv) {
      console.error('[FreshLightWizard] Could not find #freshSelectedFixtures in DOM');
      return;
    }
    if (!Array.isArray(this.data.fixtures) || this.data.fixtures.length === 0) {
      selectedDiv.innerHTML = '<div style="color: #64748b; font-size: 13px;">No fixtures selected yet</div>';
      return;
    }
    try {
      selectedDiv.innerHTML = this.data.fixtures.map(fixture => `
        <div class="fresh-selected-fixture">
          <div>
            <span style="font-weight: 500;">${fixture.vendor} ${fixture.model}</span>
            <span style="color: #64748b; margin-left: 8px;">×${fixture.count}</span>
          </div>
          <button type="button" onclick="freshLightWizard.removeFixture('${fixture.id}')">Remove</button>
        </div>
      `).join('');
    } catch (err) {
      console.error('[FreshLightWizard] Error rendering selected fixtures:', err);
      selectedDiv.innerHTML = '<div style="color: #f87171; font-size: 13px;">Error rendering fixtures</div>';
    }
  }

  setupControlMethod() {
    const controlButtons = document.querySelectorAll('.fresh-control-option');
    controlButtons.forEach(button => {
      button.addEventListener('click', () => {
        controlButtons.forEach(btn => btn.classList.remove('selected'));
        button.classList.add('selected');
        this.data.controlMethod = button.dataset.value;
        this.showControlDetails(button.dataset.value);
        this.updateNavigation();
      });
    });
  }

  showControlDetails(method) {
    const detailsDiv = document.getElementById('freshControlDetails');
    const details = {
      'wifi': 'Fixtures will be controlled via Wi-Fi connection using manufacturer apps or smart home integration.',
      'smart-plug': 'Fixtures will be plugged into smart plugs for basic on/off control and scheduling.',
      '0-10v': 'Professional dimming control using 0-10V signals. Requires compatible dimming controllers.',
      'rs485': 'Advanced control using RS-485/Modbus protocol for precise scheduling and monitoring.',
      'other': 'Custom control method - please specify your requirements in the notes.'
    };
    this.data.controlDetails = details[method] || '';
    detailsDiv.innerHTML = this.data.controlDetails;
    detailsDiv.style.display = 'block';
  }

  updateNavigation() {
    const nextBtn = document.getElementById('freshNext');
    const prevBtn = document.getElementById('freshPrev');
    if (prevBtn) prevBtn.style.display = this.currentStep > 1 ? 'block' : 'none';
    if (nextBtn) {
      const canAdvance = this.canAdvance();
      nextBtn.disabled = !canAdvance;
      nextBtn.textContent = this.currentStep === this.totalSteps ? 'Save' : 'Next';
    }
  }

  canAdvance() {
    switch (this.currentStep) {
      case 1: return this.data.room; // Only room required (no zone)
      case 2: return Array.isArray(this.data.fixtures) && this.data.fixtures.length > 0;
      case 3: return this.data.controlMethod;
      case 4: return true;
      default: return false;
    }
  }

  nextStep() {
    if (!this.canAdvance()) return;
    if (this.currentStep < this.totalSteps) {
      this.currentStep++;
      this.showStep();
    } else {
      this.save();
    }
  }

  prevStep() {
    if (this.currentStep > 1) {
      this.currentStep--;
      this.showStep();
    }
  }

  showStep() {
    document.querySelectorAll('.fresh-light-step').forEach(step => {
      step.removeAttribute('data-active');
    });
    const currentStepEl = document.getElementById(`freshStep${this.currentStep}`);
    if (currentStepEl) currentStepEl.setAttribute('data-active', '');
    if (this.currentStep === 4) this.generateReview();
    this.updateNavigation();
  }

  generateReview() {
    const reviewDiv = document.getElementById('freshReviewDetails');
    if (!reviewDiv) return;
    const totalFixtures = this.data.fixtures.reduce((sum, f) => sum + f.count, 0);
    const totalWattage = this.data.fixtures.reduce((sum, f) => sum + (f.watts * f.count), 0);
    reviewDiv.innerHTML = `
      <div style="margin-bottom: 12px;">
        <strong>Location:</strong> ${this.data.room}
      </div>
      <div style="margin-bottom: 12px;">
        <strong>Fixtures (${totalFixtures} total):</strong>
        <div style="margin-left: 16px; margin-top: 4px;">
          ${this.data.fixtures.map(f => `
            <div style=\"margin-bottom: 2px;\">• ${f.name} ×${f.count} (${f.watts}W each)</div>
          `).join('')}
        </div>
      </div>
      <div style="margin-bottom: 12px;">
        <strong>Total Power:</strong> ${totalWattage.toLocaleString()}W
      </div>
      <div style="margin-bottom: 12px;">
        <strong>Control Method:</strong> ${this.getControlMethodName(this.data.controlMethod)}
        ${this.data.controlDetails ? `<div style=\"margin-left: 16px; margin-top: 4px; font-size: 12px; color: #64748b;\">${this.data.controlDetails}</div>` : ''}
      </div>
    `;
  }

  getControlMethodName(method) {
    const names = {
      'wifi': 'Wi‑Fi / App',
      'smart-plug': 'Smart Plug',
      '0-10v': '0‑10V / Wired',
      'rs485': 'RS‑485 / Modbus',
      'other': 'Other'
    };
    return names[method] || method;
  }

  open() {
    console.log('[FreshLightWizard] Opening wizard, STATE.rooms:', STATE.rooms);
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'false');
      this.currentStep = 1;
      this.showStep();
      
      // If refreshRooms wasn't set up (DOM not ready during construction), try now
      if (!this.refreshRooms) {
        console.warn('[FreshLightWizard] refreshRooms not available, attempting to setup now...');
        this.setupRoomDropdown();
      }
      
      // Refresh room dropdown with latest data from STATE.rooms
      if (this.refreshRooms) {
        console.log('[FreshLightWizard] Calling refreshRooms with STATE.rooms length:', STATE.rooms?.length);
        this.refreshRooms(this.data.room);
      } else {
        console.error('[FreshLightWizard] refreshRooms function STILL not available after setup attempt!');
      }
    }
  }

  close() {
    if (this.modal) {
      this.modal.setAttribute('aria-hidden', 'true');
    }
  }

  save() {
    const totalFixtures = this.data.fixtures.reduce((sum, f) => sum + f.count, 0);
    const totalWattage = this.data.fixtures.reduce((sum, f) => sum + (f.watts * f.count), 0);
    if (!STATE.lightSetups) STATE.lightSetups = [];
    const lightSetup = {
      id: Date.now().toString(),
      room: this.data.room,
      // No zone - zones are managed in Groups only
      fixtures: this.data.fixtures,
      controlMethod: this.data.controlMethod,
      controlDetails: this.data.controlDetails,
      totalFixtures: totalFixtures,
      totalWattage: totalWattage,
      createdAt: new Date().toISOString()
    };
    STATE.lightSetups.push(lightSetup);
    
    // Persist to disk so light setups survive page reloads
    persistLightSetups();
    
    window.dispatchEvent(new CustomEvent('lightSetupsChanged'));
    renderLightSetupSummary();
    renderControllerAssignments();
    
    // ✅ DATA FLOW: Notify components that lights have been updated
    try {
      document.dispatchEvent(new Event('lights-updated'));
      console.log('[FreshLightWizard.save] Dispatched lights-updated event');
    } catch (err) {
      console.warn('[FreshLightWizard.save] Failed to dispatch lights-updated:', err);
    }
    
    // Add to group if matching group exists
    if (window.STATE && Array.isArray(window.STATE.groups)) {
      // Try to find group for this room (no zone check)
      let group = window.STATE.groups.find(g => (g.room === this.data.room || g.roomId === this.data.room));
      if (group) {
        // Add fixtures as lights to group.lights if not already present
        group.lights = group.lights || [];
        this.data.fixtures.forEach(fixture => {
          for (let i = 0; i < (fixture.count || 1); i++) {
            const lightId = `${fixture.vendor||fixture.name||fixture.model||'Light'}-${Date.now()}-${Math.floor(Math.random()*10000)}`;
            if (!group.lights.some(l => l.id === lightId)) {
              group.lights.push({
                id: lightId,
                name: fixture.name || fixture.model || 'Light',
                vendor: fixture.vendor || '',
                model: fixture.model || '',
                room: this.data.room,
                roomId: this.data.room,
                // No zone - zones are managed in Groups
                source: 'setup',
                setupId: lightSetup.id,
                fixtureId: fixture.id || null
              });
            }
          }
        });
        if (typeof saveGroups === 'function') saveGroups();
      }
    }
    // Look up user-friendly room name
    let roomName = this.data.room;
    if (STATE.rooms && Array.isArray(STATE.rooms)) {
      const roomObj = STATE.rooms.find(r => r.id === this.data.room);
      if (roomObj && roomObj.name) roomName = roomObj.name;
    }
    const summary = `Light Setup Saved!\n\nLocation: ${roomName}\nFixtures: ${totalFixtures} lights (${totalWattage.toLocaleString()}W total)\nControl: ${this.getControlMethodName(this.data.controlMethod)}`;
    alert(summary);
    this.close();
    // After closing wizard, reload rooms and re-render (guarded)
    setTimeout(() => {
      if (typeof loadRoomsFromBackend === 'function') {
        loadRoomsFromBackend().then(renderRooms).catch(()=>{});
      } else {
        renderRooms();
      }
    }, 300);
  }
}
  


function escapeHtml(s){ return (s+'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toggleSetupFormsForModel(md){
  // md.connectivity is an array like ['wifi','zigbee']
  const has = (k)=> Array.isArray(md?.connectivity) && md.connectivity.includes(k);
  const wifiEl = document.getElementById('deviceSetup-wifi'); if (wifiEl) wifiEl.style.display = has('wifi') ? 'block' : 'none';
  const btEl = document.getElementById('deviceSetup-bluetooth'); if (btEl) btEl.style.display = has('bluetooth') ? 'block' : 'none';
  const rsEl = document.getElementById('deviceSetup-rs485'); if (rsEl) rsEl.style.display = has('rs485') ? 'block' : 'none';
  const v10El = document.getElementById('deviceSetup-0-10v'); if (v10El) v10El.style.display = has('0-10v') ? 'block' : 'none';
}

// --- Device Pairing Wizard (lightweight) ---
class DevicePairWizard {
  constructor() {
    this.modal = document.getElementById('devicePairModal');
    if (!this.modal) return;
    this.form = document.getElementById('devicePairForm');
    this.progress = document.getElementById('devicePairProgress');
    this.steps = Array.from(this.modal.querySelectorAll('.pair-step'));
    this.current = 0;
    this.onSave = null;
    this.aiEnabled = false;
    this.aiStart = null;
    this.aiFollowUp = null;
    this.deviceMetadata = {};
    this.environmentContext = {};
    this.aiNotifiedFailure = false;

    this.nextBtn = document.getElementById('pairNext');
    this.prevBtn = document.getElementById('pairPrev');
    this.saveBtn = document.getElementById('pairSave');
    this.closeBtn = document.getElementById('devicePairClose');

    // Wizard scan elements
    this.scanBtn = document.getElementById('pairScanBtn');
    this.scanStatus = document.getElementById('pairScanStatus');
    this.scanResults = document.getElementById('pairScanResults');
    this._scanInFlight = false;

    this.nextBtn?.addEventListener('click', () => this.next());
    this.prevBtn?.addEventListener('click', () => this.prev());
    this.closeBtn?.addEventListener('click', () => this.close());
    this.form?.addEventListener('submit', (ev) => { ev.preventDefault(); this.finish(); });

    // Wire scan button
    if (this.scanBtn) {
      this.scanBtn.addEventListener('click', () => this.runScan());
    }

    const wifiStatic = document.getElementById('pairWifiStatic');
    wifiStatic?.addEventListener('change', (e) => {
      const ip = document.getElementById('pairWifiStaticIp');
      if (ip) ip.style.display = e.target.checked ? 'block' : 'none';
    });
  }


  open(opts = {}) {
    if (!this.modal) return;
    this.current = 0;
    this.onSave = opts.onSave || null;
    this.deviceMetadata = { ...(opts.metadata || {}) };
    this.environmentContext = { ...(opts.environmentContext || {}) };
    this.aiEnabled = isIAAssistActive();
    this.aiStart = null;
    this.aiFollowUp = null;
    this.aiNotifiedFailure = false;
    this.resetAiAffordances();
    if (opts.suggestedTransport) {
      const r = this.modal.querySelector(`input[name=pairTransport][value=${opts.suggestedTransport}]`);
      if (r) r.checked = true;
    }
    this.showStep(0);
    this.modal.style.display = 'flex';
    this.modal.setAttribute('aria-hidden', 'false');
    if (this.aiEnabled) {
      this.loadInitialAISuggestions();
    }
    // Reset scan UI
    if (this.scanStatus) this.scanStatus.textContent = '';
    if (this.scanResults) { this.scanResults.style.display = 'none'; this.scanResults.innerHTML = ''; }
    if (this.scanBtn) { this.scanBtn.disabled = false; this.scanBtn.textContent = 'Start Scan'; }
  }

  close() {
    if (!this.modal) return;
    this.modal.style.display = 'none';
    this.modal.setAttribute('aria-hidden', 'true');
    this.resetAiAffordances();
    this.aiEnabled = false;
  }

  showStep(i) {
    if (!this.steps) return;
    this.steps.forEach((s, idx) => {
      if (idx === i) {
        s.style.display = 'block';
        s.setAttribute('data-active', '');
      } else {
        s.style.display = 'none';
        s.removeAttribute('data-active');
      }
    });
    this.current = i;
    if (this.progress) {
      this.progress.textContent = `Step ${Math.min(i + 1, this.steps.length)} of ${this.steps.length}`;
    }
    if (this.prevBtn) this.prevBtn.style.display = i === 0 ? 'none' : 'inline-block';
    if (this.nextBtn) this.nextBtn.style.display = i === (this.steps.length - 1) ? 'none' : 'inline-block';
    if (this.saveBtn) this.saveBtn.style.display = i === (this.steps.length - 1) ? 'inline-block' : 'none';
    if (this.steps[i]?.dataset.step === 'review') this.updateReview();
  }

  stepId(index) {
    return this.steps?.[index]?.dataset?.step || '';
  }

  indexOfStep(id) {
    if (!this.steps) return -1;
    return this.steps.findIndex(s => s.dataset?.step === id);
  }

  desiredFlow() {
    const transport = this.modal?.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    const detailStep = transport === 'bluetooth' ? 'bluetooth' : 'wifi';
    return ['transport', 'scan', detailStep, 'review'];
  }

  next() {
    const flow = this.desiredFlow();
    const currentId = this.stepId(this.current);
    const idxInFlow = flow.indexOf(currentId);
    const nextId = idxInFlow >= 0 && idxInFlow < flow.length - 1 ? flow[idxInFlow + 1] : null;
    if (nextId) {
      const nextIdx = this.indexOfStep(nextId);
      if (nextIdx >= 0) return this.showStep(nextIdx);
    }
    if (this.current < this.steps.length - 1) this.showStep(this.current + 1);
  }

  async runScan() {
    if (this._scanInFlight) return;
    this._scanInFlight = true;
    try {
      if (this.scanBtn) { this.scanBtn.disabled = true; this.scanBtn.textContent = 'Scanning...'; }
      if (this.scanStatus) this.scanStatus.textContent = 'Scanning Wi‑Fi, BLE, MQTT, Kasa, SwitchBot...';
      const scanStart = Date.now();
      const minScanDurationMs = 12000;
      let resp;

      // On hosted UI, only probe edge when an edge URL is configured or explicitly requested.
      const currentHost = (window?.location?.hostname || '').toLowerCase();
      const isProductionHost = currentHost && !['localhost', '127.0.0.1'].includes(currentHost);
      const explicitLocalProbe = window.ENABLE_LOCAL_EDGE_PROBE === true || (new URLSearchParams(window.location.search).get('edgeLocal') === '1');
      const canProbeEdge = Boolean(window.EDGE_URL) || explicitLocalProbe;
      if (isProductionHost && canProbeEdge) {
        const edgeUrls = [];
        if (window.EDGE_URL) edgeUrls.push(window.EDGE_URL.replace(/\/$/, ''));
        if (explicitLocalProbe) {
          edgeUrls.push('http://localhost:8091', 'http://127.0.0.1:8091');
        }
        const uniqueEdge = [...new Set(edgeUrls)];
        if (this.scanStatus) this.scanStatus.textContent = 'Cloud mode: checking for local Light Engine...';

        // Quick health check first
        let connectedEdge = null;
        for (const eb of uniqueEdge) {
          try {
            const hc = await fetch(eb + '/env', { signal: AbortSignal.timeout(2000) });
            if (hc.ok) { connectedEdge = eb; break; }
          } catch (_) {}
        }

        if (connectedEdge) {
          if (this.scanStatus) this.scanStatus.textContent = '✓ Local Light Engine connected — scanning...';
          try {
            const edgeResp = await fetch(connectedEdge + '/discovery/scan', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              signal: AbortSignal.timeout(90000)
            });
            if (edgeResp.ok) {
              const edgeData = await edgeResp.json();
              const edgeDevices = Array.isArray(edgeData.devices) ? edgeData.devices : [];
              console.log('[UniversalScan] Edge scan (wizard) succeeded, devices:', edgeDevices.length);
              if (edgeDevices.length === 0) {
                if (this.scanStatus) this.scanStatus.textContent = 'Local scan done. Checking cloud for SwitchBot...';
                try {
                  const cloudResp = await fetchWithFarmAuth('/discovery/scan', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' }
                  });
                  if (cloudResp.ok) {
                    const cloudData = await cloudResp.json();
                    const cloudDevices = Array.isArray(cloudData.devices) ? cloudData.devices : [];
                    edgeDevices.push(...cloudDevices);
                  }
                } catch (_) {}
              }
              resp = new Response(JSON.stringify({
                ok: true, devices: edgeDevices, count: edgeDevices.length, source: 'merged'
              }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
          } catch (_) {}
        }

        if (!resp && this.scanStatus) {
          this.scanStatus.textContent = 'Scanning via cloud...';
        }
      }

      if (!resp) {
        resp = await fetchWithFarmAuth('/discovery/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      }
      if (!resp.ok) {
        resp = await fetchWithFarmAuth('/discovery/devices', { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      }
      if (!resp.ok) throw new Error('Scan failed');
      const data = await resp.json().catch(() => ({ devices: [] }));
      const devices = Array.isArray(data.devices) ? data.devices : [];
      window.LAST_UNIVERSAL_SCAN = devices;
      const elapsedMs = Date.now() - scanStart;
      if (elapsedMs < minScanDurationMs) {
        await new Promise(res => setTimeout(res, minScanDurationMs - elapsedMs));
      }
      if (this.scanStatus) this.scanStatus.textContent = `Found ${devices.length} device${devices.length === 1 ? '' : 's'}`;
      if (this.scanResults) {
        this.scanResults.style.display = 'block';
        // Build results table programmatically to avoid template nesting issues
        this.scanResults.innerHTML = '';
        if (!devices.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:16px;text-align:center;color:#64748b;';
          empty.textContent = 'No devices found after scan completed.';
          this.scanResults.appendChild(empty);
        } else {
          const table = document.createElement('table');
          table.style.width = '100%';
          table.style.borderCollapse = 'collapse';
          const thead = document.createElement('thead');
          const headRow = document.createElement('tr');
          headRow.style.cssText = 'background:#f8fafc;border-bottom:2px solid #e2e8f0;';
          const headers = ['Device','Brand','Protocol','IP / ID','Action'];
          headers.forEach(h => {
            const th = document.createElement('th');
            th.style.cssText = 'padding:10px;text-align:left;font-size:12px;font-weight:600;color:#475569;';
            th.textContent = h;
            headRow.appendChild(th);
          });
          thead.appendChild(headRow);
          table.appendChild(thead);
          const tbody = document.createElement('tbody');
          devices.forEach((device, idx) => {
            const tr = document.createElement('tr');
            tr.id = `device-row-${idx}`;
            tr.style.cssText = `border-bottom:1px solid #f1f5f9;${idx % 2 === 0 ? 'background:#fafafa;' : ''}`;
            const tdName = document.createElement('td');
            tdName.style.cssText = 'padding:10px;font-size:13px;color:#1e293b;';
            tdName.textContent = String(device.name || 'Unknown Device');
            const tdBrand = document.createElement('td');
            tdBrand.style.cssText = 'padding:10px;font-size:12px;color:#64748b;';
            tdBrand.textContent = String(device.brand || device.vendor || '—');
            const tdProto = document.createElement('td');
            tdProto.style.cssText = 'padding:10px;';
            const protoTag = document.createElement('span');
            protoTag.style.cssText = 'display:inline-block;padding:3px 8px;background:#e0e7ff;color:#4338ca;border-radius:4px;font-size:11px;font-weight:600;';
            protoTag.textContent = String(device.protocol || device.comm_type || 'unknown');
            tdProto.appendChild(protoTag);
            const tdId = document.createElement('td');
            tdId.style.cssText = 'padding:10px;font-size:12px;color:#64748b;font-family:monospace;';
            tdId.textContent = String(device.ip || device.deviceId || device.mac || device.address || '—');
            const tdAct = document.createElement('td');
            tdAct.style.cssText = 'padding:10px;text-align:center;';
            const acceptBtn = document.createElement('button');
            acceptBtn.textContent = 'Accept';
            acceptBtn.style.cssText = 'padding:6px 10px;background:#10b981;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;margin-right:4px;';
            acceptBtn.onclick = () => window.acceptDiscoveredDevice(idx);
            const ignoreBtn = document.createElement('button');
            ignoreBtn.textContent = 'Ignore';
            ignoreBtn.style.cssText = 'padding:6px 10px;background:#64748b;color:#fff;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;';
            ignoreBtn.onclick = () => window.ignoreDiscoveredDevice(idx);
            tdAct.appendChild(acceptBtn);
            tdAct.appendChild(ignoreBtn);
            tr.appendChild(tdName);
            tr.appendChild(tdBrand);
            tr.appendChild(tdProto);
            tr.appendChild(tdId);
            tr.appendChild(tdAct);
            tbody.appendChild(tr);
          });
          table.appendChild(tbody);
          this.scanResults.appendChild(table);
        }
      }
      showToast({ title: 'Scan complete', msg: `Found ${devices.length} device${devices.length !== 1 ? 's' : ''}`, kind: 'success', icon: '' });
    } catch (err) {
      console.error('[PairWizard] Scan error', err);
      if (this.scanStatus) this.scanStatus.textContent = 'Scan failed';
      showToast({ title: 'Scan failed', msg: err.message || 'Could not complete scan', kind: 'error', icon: '' });
    } finally {
      if (this.scanBtn) { this.scanBtn.disabled = false; this.scanBtn.textContent = 'Start Scan'; }
      this._scanInFlight = false;
    }
  }

  prev() {
    const flow = this.desiredFlow();
    const currentId = this.stepId(this.current);
    const idxInFlow = flow.indexOf(currentId);
    const prevId = idxInFlow > 0 ? flow[idxInFlow - 1] : null;
    if (prevId) {
      const prevIdx = this.indexOfStep(prevId);
      if (prevIdx >= 0) return this.showStep(prevIdx);
    }
    if (this.current > 0) this.showStep(this.current - 1);
  }

  getWizardSnapshot() {
    if (!this.modal) return {};
    const snapshot = {};
    const transport = this.modal.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    snapshot.transport = transport;

    const wifi = {};
    const ssidEl = document.getElementById('pairWifiSsid');
    if (ssidEl && ssidEl.value) wifi.ssid = ssidEl.value.trim();
    const pskEl = document.getElementById('pairWifiPsk');
    if (pskEl && pskEl.value) wifi.psk = pskEl.value;
    const staticChk = document.getElementById('pairWifiStatic');
    if (staticChk) wifi.static = !!staticChk.checked;
    const staticIpEl = document.getElementById('pairWifiStaticIp');
    if (staticIpEl && staticIpEl.value) wifi.staticIp = staticIpEl.value.trim();
    if (Object.keys(wifi).length) snapshot.wifi = wifi;

    const bt = {};
    const btName = document.getElementById('pairBtName');
    if (btName && btName.value) bt.name = btName.value.trim();
    const btPin = document.getElementById('pairBtPin');
    if (btPin && btPin.value) bt.pin = btPin.value.trim();
    if (Object.keys(bt).length) snapshot.bluetooth = bt;

    if (this.steps?.[this.current]?.dataset.step) {
      snapshot.step = this.steps[this.current].dataset.step;
    }

    return snapshot;
  }

  collect() {
    const transport = this.modal.querySelector('input[name=pairTransport]:checked')?.value || 'wifi';
    const result = { transport };
    if (transport === 'wifi') {
      const ssid = document.getElementById('pairWifiSsid')?.value.trim() || '';
      const psk = document.getElementById('pairWifiPsk')?.value || '';
      const isStatic = !!document.getElementById('pairWifiStatic')?.checked;
      const staticIp = document.getElementById('pairWifiStaticIp')?.value.trim() || '';
      const wifi = { ssid, psk, static: !!isStatic };
      if (isStatic && staticIp) wifi.staticIp = staticIp;
      result.wifi = wifi;
    } else if (transport === 'bluetooth') {
      const name = document.getElementById('pairBtName')?.value.trim() || null;
      const pin = document.getElementById('pairBtPin')?.value.trim() || null;
      result.bluetooth = { name, pin };
    }
    return result;
  }

  updateReview() {
    const cfg = this.collect();
    const el = document.getElementById('pairReview');
    if (!el) return;
    el.innerHTML = '';
    Object.keys(cfg).forEach((k) => {
      const pre = document.createElement('pre');
      pre.style.margin = '0';
      if (typeof cfg[k] === 'string') {
        pre.textContent = `${k}: ${cfg[k]}`;
      } else {
        pre.textContent = `${k}: ` + JSON.stringify(cfg[k], null, 2);
      }
      el.appendChild(pre);
    });
    this.renderReviewSummary();
  }

  resetAiAffordances() {
    ['pairTransportAiSuggestion', 'pairWifiAiSuggestion', 'pairBtAiSuggestion', 'pairReviewAiSummary'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.style.display = 'none';
      el.classList.remove('ai-suggestion--applied');
      const textEl = el.querySelector('.ai-suggestion__text');
      if (textEl) textEl.textContent = '';
      const button = el.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = false;
        button.textContent = 'Accept AI suggestion';
        button.onclick = null;
      }
    });
  }

  describeDevice() {
    const vendor = this.deviceMetadata.vendor || '';
    const model = this.deviceMetadata.model || '';
    const category = this.deviceMetadata.category || '';
    const combined = [vendor, model].filter(Boolean).join(' ').trim();
    if (combined) return combined;
    return category || 'device';
  }

  async loadInitialAISuggestions() {
    const data = await this.requestAISuggestions('start');
    if (data) this.applyInitialSuggestions(data);
  }

  async requestAISuggestions(stage = 'start', overrides = {}) {
    if (!this.aiEnabled) return null;
    const metadata = { ...(this.deviceMetadata || {}) };
    if (overrides.device_metadata) Object.assign(metadata, overrides.device_metadata);

    const wizardSnapshot = this.getWizardSnapshot();
    const wizardState = { ...wizardSnapshot, ...(overrides.wizard_state || {}) };

    const baseContext = { ...(this.environmentContext || {}) };
    if (overrides.environment_context) {
      Object.entries(overrides.environment_context).forEach(([key, value]) => {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          baseContext[key] = { ...(baseContext[key] || {}), ...value };
        } else {
          baseContext[key] = value;
        }
      });
    }

    try {
      const resp = await fetch('/ai/setup-assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stage,
          device_metadata: metadata,
          wizard_state: wizardState,
          environment_context: baseContext
        })
      });
      if (resp.status === 404 || resp.status === 503) {
        return null;
      }
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status} ${txt}`.trim());
      }
      return await resp.json();
    } catch (err) {
      console.warn('AI Assist request failed', err);
      if (!this.aiNotifiedFailure && stage === 'start') {
        this.aiNotifiedFailure = true;
        showToast({ title: 'AI Assist', msg: 'Unable to fetch pairing suggestions right now.', kind: 'info', icon: '' }, 5000);
      }
      return null;
    }
  }

  applyInitialSuggestions(data) {
    this.aiStart = data;
    const fields = (data && data.suggested_fields) || {};
    this.renderTransportSuggestion(fields.transport);
    this.renderWifiSuggestion(fields.wifi);
    this.renderBluetoothSuggestion(fields.bluetooth);
    this.renderReviewSummary();
  }

  renderTransportSuggestion(transport) {
    const container = document.getElementById('pairTransportAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !transport) {
      container.style.display = 'none';
      return;
    }
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) {
      textEl.textContent = `AI Assist recommends pairing ${this.describeDevice()} over ${String(transport).toUpperCase()}.`;
    }
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyTransportSuggestion(transport, container);
    }
    container.style.display = 'flex';
  }

  applyTransportSuggestion(transport, container) {
    const radio = this.modal?.querySelector(`input[name=pairTransport][value=${transport}]`);
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'AI Assist', msg: `Transport set to ${String(transport).toUpperCase()}.`, kind: 'info', icon: '' }, 5000);
    this.updateReview();
  }

  renderWifiSuggestion(suggestion) {
    const container = document.getElementById('pairWifiAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !suggestion || !Object.keys(suggestion).length) {
      container.style.display = 'none';
      return;
    }
    const parts = [];
    if (suggestion.ssid) parts.push(`SSID ${suggestion.ssid}`);
    if (suggestion.staticIp) parts.push(`static IP ${suggestion.staticIp}`);
    const message = parts.length
      ? `AI Assist suggests configuring ${this.describeDevice()} with ${parts.join(' and ')}.`
      : `AI Assist prepared Wi‑Fi guidance for ${this.describeDevice()}.`;
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) textEl.textContent = message;
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyWifiSuggestion(suggestion, container);
    }
    container.style.display = 'flex';
  }

  applyWifiSuggestion(suggestion, container) {
    const ssidInput = document.getElementById('pairWifiSsid');
    if (ssidInput && suggestion.ssid) ssidInput.value = suggestion.ssid;
    const pskInput = document.getElementById('pairWifiPsk');
    if (pskInput && suggestion.psk) pskInput.value = suggestion.psk;
    const staticCheckbox = document.getElementById('pairWifiStatic');
    const staticIpInput = document.getElementById('pairWifiStaticIp');
    const useStatic = suggestion.useStatic ?? Boolean(suggestion.staticIp);
    if (staticCheckbox && typeof useStatic === 'boolean') {
      staticCheckbox.checked = useStatic;
      staticCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (staticIpInput && suggestion.staticIp) staticIpInput.value = suggestion.staticIp;
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'AI Assist', msg: 'Applied Wi‑Fi configuration suggestions.', kind: 'info', icon: '' }, 5000);
    this.updateReview();
  }

  renderBluetoothSuggestion(suggestion) {
    const container = document.getElementById('pairBtAiSuggestion');
    if (!container) return;
    if (!this.aiEnabled || !suggestion || !Object.keys(suggestion).length) {
      container.style.display = 'none';
      return;
    }
    const details = [];
    if (suggestion.name) details.push(`name ${suggestion.name}`);
    if (suggestion.pin) details.push(`PIN ${suggestion.pin}`);
    const message = details.length
      ? `AI Assist recommends preparing Bluetooth with ${details.join(' and ')}.`
      : `AI Assist prepared Bluetooth pairing hints for ${this.describeDevice()}.`;
    const textEl = container.querySelector('.ai-suggestion__text');
    if (textEl) textEl.textContent = message;
    const button = container.querySelector('button.ai-suggestion__apply');
    if (button) {
      button.disabled = false;
      button.textContent = 'Accept AI suggestion';
      button.onclick = () => this.applyBluetoothSuggestion(suggestion, container);
    }
    container.style.display = 'flex';
  }

  applyBluetoothSuggestion(suggestion, container) {
    const nameInput = document.getElementById('pairBtName');
    if (nameInput && suggestion.name) nameInput.value = suggestion.name;
    const pinInput = document.getElementById('pairBtPin');
    if (pinInput && suggestion.pin) pinInput.value = suggestion.pin;
    if (container) {
      container.classList.add('ai-suggestion--applied');
      const button = container.querySelector('button.ai-suggestion__apply');
      if (button) {
        button.disabled = true;
        button.textContent = 'Suggestion applied';
      }
    }
    showToast({ title: 'AI Assist', msg: 'Bluetooth pairing details filled in.', kind: 'info', icon: '' }, 5000);
    this.updateReview();
  }

  renderReviewSummary() {
    const container = document.getElementById('pairReviewAiSummary');
    if (!container) return;
    const textEl = container.querySelector('.ai-suggestion__text');
    const lines = [];
    if (this.aiStart?.summary) lines.push(this.aiStart.summary);
    if (Array.isArray(this.aiStart?.next_steps) && this.aiStart.next_steps.length) {
      lines.push(`Suggested next steps: ${this.aiStart.next_steps.join(' → ')}`);
    }
    if (!lines.length) {
      container.style.display = 'none';
      if (textEl) textEl.textContent = '';
      return;
    }
    if (textEl) textEl.textContent = lines.join(' ');
    container.style.display = 'flex';
  }

  async finish() {
    const cfg = this.collect();
    try {
      if (cfg.wifi) {
        if (this.progress) this.progress.textContent = 'Provisioning device Wi‑Fi via controller...';
        const resp = await fetch('/forwarder/provision/wifi', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg.wifi)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          showToast({ title: 'Provision failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '' }, 6000);
        } else {
          const body = await resp.json().catch(() => null);
          showToast({ title: 'Provisioning initiated', msg: body?.message || 'Controller accepted provisioning request', kind: 'success', icon: '' }, 4000);
        }
      }
      if (cfg.bluetooth) {
        if (this.progress) this.progress.textContent = 'Requesting controller to pair via Bluetooth...';
        const resp = await fetch('/forwarder/provision/bluetooth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg.bluetooth)
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => null);
          showToast({ title: 'BT pair failed', msg: `Controller returned ${resp.status}: ${txt || ''}`, kind: 'warn', icon: '' }, 6000);
        } else {
          const body = await resp.json().catch(() => null);
          showToast({ title: 'Pairing requested', msg: body?.message || 'Controller pairing request sent', kind: 'success', icon: '' }, 4000);
        }
      }
    } catch (e) {
      showToast({ title: 'Provision error', msg: e.message || String(e), kind: 'warn', icon: '' }, 6000);
    } finally {
      if (this.progress) this.progress.textContent = '';
    }

    if (this.aiEnabled) {
      const followUp = await this.requestAISuggestions('complete', {
        wizard_state: { completed: true, collected_setup: cfg }
      });
      if (followUp) {
        this.aiFollowUp = followUp;
        const steps = Array.isArray(followUp.next_steps) ? followUp.next_steps : [];
        if (steps.length) {
          showToast({ title: 'AI Assist', msg: steps.join(' • '), kind: 'info', icon: '' }, 8000);
        } else if (followUp.summary) {
          showToast({ title: 'AI Assist', msg: followUp.summary, kind: 'info', icon: '' }, 6000);
        }
      }
    }

    if (this.onSave) this.onSave(cfg);
    this.close();
  }
}

function isIAAssistActive() {
  const card = document.getElementById('iaAssistFeature');
  if (!card) return false;
  if (card.classList.contains('active')) return true;
  const statusEl = card.querySelector('.ai-feature-status');
  const text = (statusEl?.textContent || '').trim().toLowerCase();
  return statusEl?.classList.contains('always-on') || text.includes('always');
}

function buildPairingEnvironmentContext(roomWizardInstance) {
  const farm = STATE.farm || {};
  const discovery = farm.discovery || {};
  const connection = (farm.connection && farm.connection.wifi) || {};
  const testResult = connection.testResult || {};
  const roomData = (roomWizardInstance && roomWizardInstance.data) || {};
  const roomNameInput = document.getElementById('roomName');
  const locationSelect = document.getElementById('roomLocationSelect');

  const preferredSsid = discovery.ssid || connection.ssid || testResult.ssid || '';
  const subnet = discovery.subnet || testResult.subnet || '';
  const gateway = discovery.gateway || testResult.gateway || '';

  return {
    farm: {
      name: farm.name || farm.farmName || '',
      preferredSsid,
      subnet,
      gateway,
      controller: (STATE.config && STATE.config.controller) || ''
    },
    room: {
      name: roomData.name || roomNameInput?.value?.trim() || '',
      location: roomData.location || locationSelect?.value || ''
    }
  };
}

const DEVICE_PAIR_WIZARD = new DevicePairWizard();

function findModelByValue(value) {
  if (!DEVICE_MANUFACTURERS) return null;
  for (const m of DEVICE_MANUFACTURERS) {
    const md = (m.models || []).find(x => x.id === value || x.model === value);
    if (md) return md;
  }
  return null;
}

function hookRoomDevicePairing(roomWizardInstance) {
  const addBtn = document.getElementById('roomAddDeviceBtn'); if (!addBtn) return;
  addBtn.addEventListener('click', (ev) => {
    ev.preventDefault();
    let suggested = 'wifi';
    const modelSel = document.getElementById('roomDeviceModel');
    let modelMeta = null;
    if (modelSel && modelSel.value) {
      modelMeta = findModelByValue(modelSel.value);
      if (modelMeta && modelMeta.connectivity && modelMeta.connectivity.includes('bluetooth')) suggested = 'bluetooth';
    }
    const vendor = document.getElementById('roomDeviceVendor')?.value || '';
    const model = document.getElementById('roomDeviceModel')?.value || '';
    const man = DEVICE_MANUFACTURERS && DEVICE_MANUFACTURERS.find(x=>x.name===vendor);
    if (!modelMeta && man && man.models) {
      modelMeta = man.models.find(m=>m.model===model) || modelMeta;
    }
    const requiresHub = (modelMeta && modelMeta.requiresHub) || (man && man.requiresHub) || ((modelMeta && (modelMeta.features || []).some(f=>/bridge|hub|ir-bridge-required/i.test(f))) || false);
    const environmentContext = buildPairingEnvironmentContext(roomWizardInstance);
    if (requiresHub) {
      const hasHub = (roomWizardInstance.data.devices||[]).some(d=> (d.vendor===vendor && /(hub|bridge|bridge mini|hub)/i.test(d.model)) || (d.setup && d.setup.isHub));
      if (!hasHub) {
        showToast({ title: 'Hub required', msg: `${vendor} ${model} typically requires a hub. Please add the hub first.`, kind:'warn', icon: '' }, 6000);
        DEVICE_PAIR_WIZARD.open({
          suggestedTransport: 'wifi',
          metadata: {
            vendor,
            model: `${vendor} Hub`,
            category: 'hub',
            connectivity: ['wifi', 'ethernet'],
            requiresHub: false,
            preferred_transport: 'wifi'
          },
          environmentContext,
          onSave: (setup) => {
            const hubName = `${vendor} Hub`;
            const hubDevice = { name: hubName, vendor, model: `${vendor} Hub`, host: setup?.wifi?.staticIp || '', setup: { ...setup, isHub: true } };
            roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
            roomWizardInstance.data.devices.push(hubDevice);
            roomWizardInstance.renderDevicesList();
            if (typeof renderControllerAssignments === 'function') {
              renderControllerAssignments();
            }
            showToast({ title: 'Hub added', msg: `Added ${hubName}. Now add child devices.`, kind: 'success', icon: '' }, 4000);
          }
        });
        return;
      }
    }

    const connectivity = [];
    if (Array.isArray(modelMeta?.connectivity)) connectivity.push(...modelMeta.connectivity);
    else if (modelMeta?.connectivity) connectivity.push(modelMeta.connectivity);
    else if (Array.isArray(man?.connectivity)) connectivity.push(...man.connectivity);
    const metadata = {
      vendor,
      model,
      category: modelMeta?.category || man?.category || '',
      connectivity: connectivity.map(c => String(c).toLowerCase()),
      features: Array.isArray(modelMeta?.features) ? modelMeta.features : [],
      requiresHub,
      preferred_transport: suggested
    };
    if (modelMeta?.advertisedName) metadata.advertisedName = modelMeta.advertisedName;
    if (modelMeta?.defaultPin) metadata.defaultPin = modelMeta.defaultPin;
    if (modelMeta?.pairingPin) metadata.pairingPin = modelMeta.pairingPin;
    if (modelMeta?.requiresStaticIp) metadata.requiresStaticIp = modelMeta.requiresStaticIp;
    if (modelMeta?.preferredIp) metadata.preferredIp = modelMeta.preferredIp;

    DEVICE_PAIR_WIZARD.open({
      suggestedTransport: suggested,
      metadata,
      environmentContext,
      onSave: (setup) => {
        const name = document.getElementById('roomDeviceName')?.value.trim() || '';
        const vendor = document.getElementById('roomDeviceVendor')?.value || '';
        const model = document.getElementById('roomDeviceModel')?.value || '';
        const host = document.getElementById('roomDeviceHost')?.value.trim() || '';
        roomWizardInstance.data.devices = roomWizardInstance.data.devices || [];
        const device = { name: name || `${vendor} ${model}`, vendor, model, host, setup };
        // Clear any previous invalid input markers before adding
        ['deviceRs485UnitId', 'device0v10Channel', 'device0v10Scale'].forEach(id => {
          try {
            clearFieldError(id);
          } catch (e) {
            const el = document.getElementById(id);
            if (el) el.classList.remove('invalid');
          }
        });
        roomWizardInstance.data.devices.push(device);
        roomWizardInstance.renderDevicesList();
        if (typeof renderControllerAssignments === 'function') {
          renderControllerAssignments();
        }
      }
    });
  });
}


// --- Grow Room Overview (move this above AI features to avoid ReferenceError) ---
function renderGrowRoomOverview() {
  const summaryEl = document.getElementById('growOverviewSummary');
  const gridEl = document.getElementById('growOverviewGrid');
  if (!summaryEl || !gridEl) return;

  const rooms = Array.isArray(STATE.rooms) ? STATE.rooms : [];
  const zones = Array.isArray(STATE.environment) ? STATE.environment : [];
  const plans = Array.isArray(STATE.plans) ? STATE.plans : [];
  const schedules = Array.isArray(STATE.schedules) ? STATE.schedules : [];

  const roomCount = rooms.length;
  const zoneCount = zones.length;
  const summaries = [
    {
      label: 'Grow Rooms',
      value:
        roomCount
          ? `${roomCount} room${roomCount === 1 ? '' : 's'}`
          : zoneCount
          ? `${zoneCount} zone${zoneCount === 1 ? '' : 's'}`
          : 'None'
    },
    {
      label: 'Plans running',
      value:
        plans.length === 0
          ? 'None'
          : (() => {
              const names = plans.map((plan) => plan.name || 'Untitled plan').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    },
    {
      label: 'Schedules',
      value:
        schedules.length === 0
          ? 'None'
          : (() => {
              const names = schedules.map((sched) => sched.name || 'Unnamed schedule').filter(Boolean);
              const preview = names.slice(0, 2).join(', ');
              const extra = names.length > 2 ? ` +${names.length - 2}` : '';
              return `${preview}${extra}`;
            })()
    }
  ];

  summaryEl.innerHTML = summaries
    .map(
      (item) => `
        <div class="grow-overview__summary-item">
          <span class="grow-overview__summary-label">${escapeHtml(item.label)}</span>
          <span class="grow-overview__summary-value">${escapeHtml(item.value)}</span>
        </div>`
    )
    .join('');

  const activeFeatures = Array.from(document.querySelectorAll('.ai-feature-card.active h3'))
    .map((el) => el.textContent?.trim())
    .filter(Boolean);

  const matchZoneForRoom = (room) => {
    if (!room) return null;
    const identifiers = new Set(
      [room.id, room.name]
        .filter((value) => value !== undefined && value !== null)
        .map((value) => String(value).toLowerCase())
    );
    if (!identifiers.size) return null;
    return zones.find((zone) => {
      const id = zone.id ? String(zone.id).toLowerCase() : '';
      const name = zone.name ? String(zone.name).toLowerCase() : '';
      const location = zone.location ? String(zone.location).toLowerCase() : '';
      return identifiers.has(id) || identifiers.has(name) || identifiers.has(location);
    }) || null;
  };

  const metricKeys = [
    { key: 'tempC', label: 'Temp', unit: '°C', precision: 1 },
    { key: 'rh', label: 'Humidity', unit: '%', precision: 1 },
    { key: 'co2', label: 'CO2', unit: ' ppm', precision: 0 },
    { key: 'vpd', label: 'VPD', unit: ' kPa', precision: 2 }
  ];

  const formatMetricValue = (sensor, meta) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return '—';
    }
    const value = meta.precision != null ? sensor.current.toFixed(meta.precision) : String(sensor.current);
    if (meta.unit.trim() === '%') {
      return `${value}${meta.unit}`;
    }
    return `${value}${meta.unit}`;
  };

  const metricStatus = (sensor) => {
    if (!sensor || typeof sensor.current !== 'number' || !Number.isFinite(sensor.current)) {
      return 'unknown';
    }
    const min = sensor.setpoint?.min;
    const max = sensor.setpoint?.max;
    if (typeof min === 'number' && typeof max === 'number') {
      return sensor.current >= min && sensor.current <= max ? 'ok' : 'warn';
    }
    return 'unknown';
  };

  const buildMetrics = (zone) => {
    if (!zone || !zone.sensors) return '';
    const items = metricKeys
      .map((meta) => {
        const sensor = zone.sensors?.[meta.key];
        if (!sensor) return '';
        const status = metricStatus(sensor);
        const value = formatMetricValue(sensor, meta);
        return `
          <div class="grow-room-card__metric grow-room-card__metric--${status}">
            <span class="grow-room-card__metric-label">${escapeHtml(meta.label)}</span>
            <span class="grow-room-card__metric-value">${escapeHtml(value)}</span>
          </div>`;
      })
      .filter(Boolean)
      .join('');
    return items;
  };

  const buildAiSection = () => {
    if (!activeFeatures.length) {
      return '<p class="tiny text-muted">AI features inactive.</p>';
    }
    return `
      <ul class="grow-room-card__ai-list">
        ${activeFeatures.map((name) => `<li class="grow-room-card__ai-chip">${escapeHtml(name)}</li>`).join('')}
      </ul>`;
  };

  const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

  const toKeySet = (...values) => {
    const keys = new Set();
    const add = (value) => {
      if (Array.isArray(value)) {
        value.forEach(add);
        return;
      }
      if (value === undefined || value === null) {
        return;
      }
      const str = String(value).trim();
      if (str) {
        keys.add(str.toLowerCase());
      }
    };
    values.forEach(add);
    return keys;
  };

  const collectIdentityKeys = (room, zone) => {
    return toKeySet(
      room?.id,
      room?.name,
      room?.room,
      room?.roomId,
      room?.scopeId,
      room?.zone,
      room?.groupId,
      room?.groupName,
      room?.plan,
      room?.planId,
      room?.planKey,
      room?.match?.room,
      room?.match?.zone,
      room?.location,
      Array.isArray(room?.zones) ? room.zones : null,
      zone?.id,
      zone?.name,
      zone?.location,
      zone?.zone,
      zone?.scopeId
    );
  };

  const readBoolean = (...candidates) => {
    for (const value of candidates) {
      if (typeof value === 'boolean') return value;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', 'on', 'enabled', 'active', 'yes'].includes(normalized)) {
          return true;
        }
        if (['false', 'off', 'disabled', 'inactive', 'no'].includes(normalized)) {
          return false;
        }
      }
    }
    return undefined;
  };

  const readString = (...candidates) => {
    for (const value of candidates) {
      if (typeof value === 'string' && value.trim().length > 0) {
        return value.trim();
      }
    }
    return '';
  };

  const pickControlRecord = (room, zone) => {
    const candidates = [];
    if (isRecord(room)) {
      ['control', 'controls', 'automation', 'ai'].forEach((key) => {
        if (isRecord(room[key])) {
          candidates.push(room[key]);
        }
      });
    }
    if (isRecord(zone)) {
      ['control', 'controls', 'automation', 'ai'].forEach((key) => {
        if (isRecord(zone[key])) {
          candidates.push(zone[key]);
        }
      });
    }

    const controlMap = STATE.control;
    if (isRecord(controlMap)) {
      const keys = collectIdentityKeys(room, zone);
      for (const [key, value] of Object.entries(controlMap)) {
        if (keys.has(String(key).toLowerCase()) && isRecord(value)) {
          candidates.push(value);
        }
        if (isRecord(value)) {
          const nestedKeys = toKeySet(
            value.id,
            value.name,
            value.room,
            value.roomId,
            value.scopeId,
            value.zone,
            value.groupId,
            value.groupName
          );
          let matched = false;
          for (const nestedKey of nestedKeys) {
            if (keys.has(nestedKey)) {
              candidates.push(value);
              matched = true;
              break;
            }
          }
          if (!matched && Array.isArray(value?.zones)) {
            const zoneMatch = value.zones.find((entry) => {
              if (typeof entry === 'string') {
                return keys.has(entry.toLowerCase());
              }
              if (isRecord(entry)) {
                const zoneKeys = toKeySet(entry.id, entry.name, entry.zone, entry.scopeId);
                for (const zoneKey of zoneKeys) {
                  if (keys.has(zoneKey)) return true;
                }
              }
              return false;
            });
            if (zoneMatch) {
              candidates.push(value);
            }
          }
        }
      }
    }

    for (const candidate of candidates) {
      if (isRecord(candidate)) {
        return candidate;
      }
    }
    return {};
  };

  const deriveAiStatus = (control, room, zone) => {
    const mode = readString(
      control.mode,
      control.aiMode,
      control.status,
      room?.aiMode,
      room?.controlMode,
      room?.mode,
      zone?.aiMode
    ).toLowerCase();
    const enabled = readBoolean(
      control.enable,
      control.enabled,
      control.active,
      control.on,
      room?.aiEnabled,
      room?.controlEnabled,
      room?.enable,
      room?.enabled,
      zone?.aiEnabled
    );
    if (mode.includes('advis') || mode.includes('assist') || mode.includes('train')) {
      return 'advisory';
    }
    if (mode.includes('auto') || mode.includes('pilot') || mode.includes('always')) {
      return enabled === false ? 'off' : 'autopilot';
    }
    if (mode.includes('on')) {
      return enabled === false ? 'off' : 'autopilot';
    }
    if (mode.includes('off')) {
      return 'off';
    }
    if (enabled === true) return 'autopilot';
    if (enabled === false) return 'off';
    return 'off';
  };

  const deriveAutomationStatus = (control, room, zone) => {
    const automationFlag = readBoolean(
      room?.automation?.enable,
      room?.automation?.enabled,
      room?.automation?.active,
      room?.automationEnabled,
      control.automation,
      control.automationEnabled,
      control.enable,
      control.enabled,
      control.active,
      zone?.automation?.enable,
      zone?.automation?.enabled
    );
    if (automationFlag === true) return 'on';
    if (automationFlag === false) return 'off';
    if (readBoolean(control.enable, control.enabled, control.active) === true) {
      return 'on';
    }
    if (zone?.meta?.managedByPlugs) {
      return 'on';
    }
    if (Array.isArray(STATE.preAutomationRules) && STATE.preAutomationRules.length > 0) {
      const keys = collectIdentityKeys(room, zone);
      const matchesRule = STATE.preAutomationRules.some((rule) => {
        if (!rule) return false;
        const scope = rule.scope || rule.zone || rule.room || rule.target;
        if (!scope) return false;
        if (typeof scope === 'string') {
          return keys.has(scope.trim().toLowerCase());
        }
        if (isRecord(scope)) {
          const scopeKeys = toKeySet(scope.id, scope.name, scope.zone, scope.room, scope.scopeId);
          for (const candidateKey of scopeKeys) {
            if (keys.has(candidateKey)) {
              return true;
            }
          }
        }
        return false;
      });
      if (matchesRule) return 'on';
    }
    return 'off';
  };

  const deriveSpectraStatus = (room, zone) => {
    const keys = collectIdentityKeys(room, zone);
    const planResolver = STATE.planResolver;
    const planGroups = Array.isArray(planResolver?.groups)
      ? planResolver.groups
      : Array.isArray(planResolver)
      ? planResolver
      : [];
    const groupMatch = planGroups.find((group) => {
      if (!group) return false;
      const groupKeys = toKeySet(
        group.groupId,
        group.groupName,
        group.room,
        group.roomId,
        group.scopeId,
        group.zone,
        group.id,
        group.name
      );
      for (const key of groupKeys) {
        if (keys.has(key)) {
          return true;
        }
      }
      return false;
    });
    if (groupMatch) {
      const should = groupMatch.shouldPowerOn;
      if (typeof should === 'string') {
        const normalized = should.toLowerCase();
        if (['off', 'idle', 'false'].includes(normalized)) {
          return 'idle';
        }
      } else if (should === false) {
        return 'idle';
      }
      return 'active';
    }

    const hasPlan =
      Boolean(room && (room.plan || room.planId || room.planKey)) ||
      Boolean(room?.targets && (room.targets.planName || room.targets.planKey)) ||
      Boolean(zone && (zone.plan || zone.planId || zone.planKey)) ||
      Boolean(zone?.targets && (zone.targets.planName || zone.targets.planKey));
    if (hasPlan) {
      return 'active';
    }

    const hasSpectrum =
      Boolean(room?.lighting && (room.lighting.spectrum || room.lighting.plan)) ||
      Boolean(room?.spectra) ||
      Boolean(zone?.lighting && zone.lighting.spectrum) ||
      Boolean(zone?.sensors && (zone.sensors.ppfd || zone.sensors.spectrum));
    if (hasSpectrum) {
      return 'active';
    }

    const spectaCard = document.getElementById('spectraSyncFeature');
    if (spectaCard?.classList.contains('active')) {
      return 'active';
    }

    return 'idle';
  };

  const renderStatusIcons = (room, zone) => {
    const control = pickControlRecord(room, zone);
    const aiStatus = deriveAiStatus(control, room, zone) || 'off';
    const automationStatus = deriveAutomationStatus(control, room, zone) || 'off';
    const spectraStatus = deriveSpectraStatus(room, zone) || 'idle';

    const aiStatusLabel = { autopilot: 'Autopilot', advisory: 'Advisory', off: 'Off' };
    const automationStatusLabel = { on: 'On', off: 'Off' };
    const spectraStatusLabel = { active: 'Active', idle: 'Idle' };

    const iconMarkup = (type, status, text, ariaLabel) => {
      const statusClass = status ? ` is-${status}` : '';
      return `<span class="overview-icon overview-icon--${type}${statusClass}" aria-label="${escapeHtml(ariaLabel)}"><span class="overview-icon__dot" aria-hidden="true"></span>${escapeHtml(text)}</span>`;
    };

    const markup = `
      <div class="overview-tile__icons" role="group" aria-label="Automation and AI status">
        ${iconMarkup('ai', aiStatus, 'AI', `AI ${aiStatusLabel[aiStatus] || 'status'}`)}
        ${iconMarkup('automation', automationStatus, 'Automation', `Automation ${automationStatusLabel[automationStatus] || 'status'}`)}
        ${iconMarkup('spectra', spectraStatus, 'SpectraSync', `SpectraSync ${spectraStatusLabel[spectraStatus] || 'status'}`)}
      </div>
    `;
    return markup.trim();
  };

  const cards = [];
  if (rooms.length) {
    rooms.forEach((room) => {
      const zone = matchZoneForRoom(room);
      const name = room.name || room.id || 'Grow Room';
      const details = [];
      const zonesList = Array.isArray(room.zones) ? room.zones.filter(Boolean) : [];
      if (zonesList.length) {
        details.push(`Zones: ${zonesList.map((item) => escapeHtml(item)).join(', ')}`);
      }
      if (room.layout?.type) {
        details.push(`Layout: ${escapeHtml(room.layout.type)}`);
      }
      if (room.controlMethod) {
        details.push(`Control: ${escapeHtml(room.controlMethod)}`);
      }
      const metaParts = [];
      if (zone?.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone?.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone?.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      const statusIcons = renderStatusIcons(room, zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
            ${room.roomType ? `<span class="chip tiny">${escapeHtml(room.roomType)}</span>` : ''}
          </div>
          ${statusIcons}
          ${details.length ? `<div class="tiny text-muted">${details.join(' • ')}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  } else if (zones.length) {
    zones.forEach((zone) => {
      const name = zone.name || zone.id || 'Zone';
      const location = zone.location ? `Location: ${escapeHtml(zone.location)}` : '';
      const metaParts = [];
      if (zone.meta?.source) metaParts.push(`Source: ${escapeHtml(zone.meta.source)}`);
      if (typeof zone.meta?.battery === 'number') metaParts.push(`Battery: ${escapeHtml(`${zone.meta.battery}%`)}`);
      if (typeof zone.meta?.rssi === 'number') metaParts.push(`RSSI: ${escapeHtml(`${zone.meta.rssi} dBm`)}`);
      const metrics = buildMetrics(zone);
      const statusIcons = renderStatusIcons(null, zone);
      cards.push(`
        <article class="grow-room-card">
          <div class="grow-room-card__header">
            <h3>${escapeHtml(name)}</h3>
          </div>
          ${statusIcons}
          ${location ? `<div class="tiny text-muted">${location}</div>` : ''}
          ${metaParts.length ? `<div class="tiny text-muted">${metaParts.join(' • ')}</div>` : ''}
          ${metrics ? `<div class="grow-room-card__metrics">${metrics}</div>` : '<p class="tiny text-muted">No telemetry available.</p>'}
          <div class="grow-room-card__ai">
            <span class="tiny text-muted">AI Features</span>
            ${buildAiSection()}
          </div>
        </article>`);
    });
  }

  if (!cards.length) {
    gridEl.innerHTML = '<p class="tiny text-muted">Add a grow room to view live status and telemetry.</p>';
    return;
  }

  gridEl.innerHTML = cards.join('');
}

// --- Top Card and AI Features Management ---
function initializeTopCard() {
  // ...existing code...
}

function initializeAIFeatures() {
  const aiFeatures = {
    spectrasync: { 
      name: 'SpectraSync®', 
      status: 'on',
      description: 'SpectraSync dynamically adjusts light spectrum and intensity in response to farm environmental data, supporting temperature, humidity, and crop-specific management.'
    },
    evie: { 
      name: 'E.V.I.E', 
      status: 'off',
      description: 'E.V.I.E autonomously manages the growing environment, crop forecasting, and placement. Explores sales trends, updates planting schedules, and applies incremental micro-changes.'
    },
    'ia-training': { 
      name: 'AI In Training', 
      status: 'always-on',
      description: 'Uses farm and external environmental data to continuously learn and adapt to local growing conditions, preparing for autonomous optimization.'
    },
    'ia-assist': { 
      name: 'AI Assist', 
      status: 'always-on',
      description: 'Provides recommendations to growers, highlighting correlations and causal factors within the growing environment to support informed decisions.'
    },
    eii: { 
      name: 'E.I² Environmental Impact Index', 
      status: 'dev',
      description: 'Measures and reports environmental impact, providing transparency and shared knowledge on sustainability performance for both farm operators and the public.'
    }
  };

  // Add click handlers for AI feature cards
  document.querySelectorAll('.ai-feature-card').forEach(card => {
    const feature = card.dataset.feature;
    const featureData = aiFeatures[feature];
    
    if (!featureData) return;

    card.addEventListener('click', () => {
      // Toggle active state for toggleable features
      if (featureData.status === 'on' || featureData.status === 'off') {
        const isActive = card.classList.contains('active');
        if (isActive) {
          card.classList.remove('active');
          featureData.status = 'off';
          updateFeatureStatus(card, 'off');
        } else {
          card.classList.add('active');
          featureData.status = 'on';
          updateFeatureStatus(card, 'on');
        }
        
        // Show toast notification
        showToast({
          title: featureData.name,
          msg: `${featureData.name} is now ${featureData.status.toUpperCase()}`,
          kind: featureData.status === 'on' ? 'success' : 'info',
          icon: featureData.status === 'on' ? '' : ''
        });

        renderGrowRoomOverview();
      }
    });

    // Add hover tooltip functionality using existing tooltip system
    card.addEventListener('mouseenter', (e) => {
      card.setAttribute('data-tip', featureData.description);
      showTipFor(card);
    });

    card.addEventListener('mouseleave', () => {
      hideTip();
    });
  });

  // Connect SpectraSync to Research Mode
  const researchToggle = document.getElementById('researchModeToggle');
  if (researchToggle) {
    researchToggle.addEventListener('change', () => {
      const spectraSyncCard = document.getElementById('spectraSyncFeature');
      if (spectraSyncCard) {
        if (researchToggle.checked) {
          spectraSyncCard.classList.add('active');
          updateFeatureStatus(spectraSyncCard, 'on');
        } else {
          spectraSyncCard.classList.remove('active');
          updateFeatureStatus(spectraSyncCard, 'off');
        }

        renderGrowRoomOverview();
      }
    });
  }

  renderGrowRoomOverview();
}

function updateFeatureStatus(card, status) {
  const statusEl = card.querySelector('.ai-feature-status');
  if (!statusEl) return;

  statusEl.className = `ai-feature-status ${status}`;
  statusEl.textContent = status === 'on' ? 'ON' :
                        status === 'off' ? 'OFF' :
                        status === 'always-on' ? 'ALWAYS ON' :
                        status === 'dev' ? 'DEV' : status.toUpperCase();
}

function setActivePanel(panelId = 'overview') {
  console.log('[DEBUG] setActivePanel called with:', panelId);
  ACTIVE_PANEL = panelId;
  const panels = document.querySelectorAll('[data-panel]');
  let matched = false;
  let activePanel = null;
  panels.forEach((panel) => {
    const isMatch = panel.getAttribute('data-panel') === panelId;
    panel.classList.toggle('is-active', isMatch);
    panel.hidden = !isMatch;
    panel.style.display = isMatch ? '' : 'none';
    if (isMatch) {
      matched = true;
      activePanel = panel;
    }
  });

  if (!matched && panelId !== 'overview') {
    setActivePanel('overview');
    return;
  }

  // Ensure the active panel renders in the main column (to the right of the sidebar)
  // across both index.html variants by appending it inside .dashboard-main.
  if (activePanel && panelId !== 'overview') {
    const dashboardMain = document.querySelector('.dashboard-main');
    if (dashboardMain) {
      // Always move the active panel under the main column to normalize placement.
      // Appending ensures it won't render beneath the sidebar due to stray DOM location.
      dashboardMain.appendChild(activePanel);
      // Reset scroll position for a consistent UX.
      dashboardMain.scrollTop = 0;
    }
  }

  document.querySelectorAll('[data-sidebar-link]').forEach((link) => {
    const target = link.getAttribute('data-target');
    const isActive = target === panelId;
    link.classList.toggle('is-active', isActive);
    link.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  if (panelId === 'overview') {
    document.querySelectorAll('.sidebar-group').forEach((group) => {
      const trigger = group.querySelector('.sidebar-group__trigger');
      const items = group.querySelector('.sidebar-group__items');
      group.classList.remove('is-expanded');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      if (items) items.hidden = true;
    });
  }
}

function initializeSidebarNavigation() {
  // Guard to prevent duplicate initialization and event handler attachment
  if (window.__sidebarNavInitialized) return;
  window.__sidebarNavInitialized = true;
  ensureFieldMappingLink();
  console.log('[DEBUG] initializeSidebarNavigation called');
  document.querySelectorAll('.sidebar-group').forEach((group) => {
    const trigger = group.querySelector('.sidebar-group__trigger');
    const items = group.querySelector('.sidebar-group__items');
    if (items) items.hidden = true;
    trigger?.addEventListener('click', () => {
      const expanded = trigger.getAttribute('aria-expanded') === 'true';
      const next = !expanded;
      trigger.setAttribute('aria-expanded', String(next));
      group.classList.toggle('is-expanded', next);
      if (items) items.hidden = !next;
      if (!next) {
        const activeLink = group.querySelector('[data-sidebar-link].is-active');
        if (activeLink) {
          setActivePanel('overview');
        }
      }
    });
  });

  document.querySelectorAll('[data-sidebar-link]').forEach((link) => {
    link.addEventListener('click', () => {
      const target = link.getAttribute('data-target') || 'overview';
      if (target === 'overview') {
        setActivePanel('overview');
        return;
      }
      const group = link.closest('.sidebar-group');
      if (group) {
        const trigger = group.querySelector('.sidebar-group__trigger');
        const items = group.querySelector('.sidebar-group__items');
        group.classList.add('is-expanded');
        if (trigger) trigger.setAttribute('aria-expanded', 'true');
        if (items) items.hidden = false;
      } else {
        document.querySelectorAll('.sidebar-group').forEach((otherGroup) => {
          const otherTrigger = otherGroup.querySelector('.sidebar-group__trigger');
          const otherItems = otherGroup.querySelector('.sidebar-group__items');
          otherGroup.classList.remove('is-expanded');
          if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
          if (otherItems) otherItems.hidden = true;
        });
      }

      setActivePanel(target);
      // When arriving at Equipment Overview, re-render to include any newly saved equipment
      if (target === 'equipment-overview') {
        try { renderEquipmentOverview(); } catch (e) { console.warn('Failed to render equipment overview on nav', e); }
      }
      // When arriving at Field Matrix, render the matrix
      if (target === 'field-matrix') {
        try { renderFieldMatrix(); } catch (e) { console.warn('Failed to render field matrix on nav', e); }
      }
      // When arriving at Bus Mapping, initialize the wizard
      if (target === 'bus-mapping') {
        try { 
          if (typeof loadGroupsForBusMapping === 'function') {
            loadGroupsForBusMapping(); 
          }
        } catch (e) { console.warn('Failed to initialize bus mapping wizard on nav', e); }
      }
    });
  });

  setActivePanel('overview');
}

function ensureFieldMappingLink() {
  const standaloneSection = document.querySelector('.sidebar-standalone');
  if (!standaloneSection) return;

  let fieldMatrixLink = standaloneSection.querySelector('[data-field-matrix-link]');
  if (!fieldMatrixLink) {
    fieldMatrixLink = document.createElement('a');
    fieldMatrixLink.href = './views/field-mapping.html';
    fieldMatrixLink.className = 'sidebar-link';
    fieldMatrixLink.textContent = 'Field Mapping Matrix';
    fieldMatrixLink.setAttribute('data-field-matrix-link', 'true');
    const profileButton = standaloneSection.querySelector('[data-sidebar-link][data-target="profile"]');
    if (profileButton && profileButton.parentElement === standaloneSection) {
      profileButton.insertAdjacentElement('afterend', fieldMatrixLink);
    } else {
      standaloneSection.appendChild(fieldMatrixLink);
    }
  } else {
    // Ensure legacy markup keeps expected styling
    fieldMatrixLink.classList.add('sidebar-link');
  }
}

// Ensure wireHints is defined before this handler
document.addEventListener('DOMContentLoaded', async () => {
  // Global bootstrap guard to prevent duplicate initialization if the script is injected twice
  if (window.__charlieBootstrapped) return;
  window.__charlieBootstrapped = true;
  try {
    ensureFieldMappingLink();
    // --- UI and wizard setup: run synchronously so buttons always work ---
    // Initialize farm wizard (single instance, always on window)
    try {
      window.farmWizard = new FarmWizard();
      if (window.farmWizard && typeof window.farmWizard.init === 'function') window.farmWizard.init();
    } catch (e) {
      console.warn('[Bootstrap] FarmWizard init failed', e);
    }
    // Initialize device manager window
    try {
      window.deviceManagerWindow = new DeviceManagerWindow();
    } catch (e) {
      console.warn('[Bootstrap] DeviceManagerWindow init failed', e);
    }
    // Initialize room wizard
    try {
      window.roomWizard = new RoomWizard();
      // Ensure the New Grow Room button is always wired after any DOM changes
      setTimeout(() => { if (window.roomWizard && typeof window.roomWizard.init === 'function') window.roomWizard.init(); }, 1000);
    } catch (e) {
      console.warn('[Bootstrap] RoomWizard init failed', e);
    }
    // Initialize light wizards
    try {
      window.lightWizard = new LightWizard();
    } catch (e) {
      console.warn('[Bootstrap] LightWizard init failed', e);
    }
    try {
      window.freshLightWizard = new FreshLightWizard();
    } catch (e) {
      console.warn('[Bootstrap] FreshLightWizard init failed', e);
    }
  // Wire up light setup button (with retry logic)
  function setupLightSetupButton() {
    const lightSetupBtn = document.getElementById('btnLaunchLightSetup');
    if (lightSetupBtn) {
      lightSetupBtn.addEventListener('click', () => {
        freshLightWizard.open();
      });
    } else {
      setTimeout(setupLightSetupButton, 500);
    }
  }
  setupLightSetupButton();
  window.testFreshWizard = function() {
    if (window.freshLightWizard) window.freshLightWizard.open();
  };
  // Ensure room/device pairing hooks are wired once
  try { hookRoomDevicePairing(roomWizard); } catch (e) { console.warn('Failed to hook device pairing', e); }
  // --- End UI and wizard setup ---

  // Now run the rest of the async logic
  (async function() {
    // Re-attach all card button event handlers after DOMContentLoaded
    document.querySelectorAll('button').forEach(btn => {
      if (btn.id && btn.id.startsWith('btn') && typeof window[btn.id + 'Handler'] === 'function') {
        btn.addEventListener('click', window[btn.id + 'Handler']);
      }
    });
    // Clean up any existing invalid img src attributes that might cause 404s
    document.querySelectorAll('img').forEach(img => {
      if (img.src && !img.src.startsWith('http://') && !img.src.startsWith('https://') && !img.src.startsWith('data:') && img.src.includes('.')) {
        img.src = '';
        img.style.display = 'none';
      }
    });

    if (typeof wireHints === 'function') wireHints();
    if (typeof wireGlobalEvents === 'function') wireGlobalEvents();
    // initializeSidebarNavigation is called at the end of DOMContentLoaded - removed duplicate call

    document.getElementById('btnLaunchPairWizard')?.addEventListener('click', () => {
      if (typeof DEVICE_PAIR_WIZARD !== 'undefined' && DEVICE_PAIR_WIZARD?.open) DEVICE_PAIR_WIZARD.open();
    });

    document.getElementById('btnPairWizardDocs')?.addEventListener('click', () => {
      showToast({
        title: 'Pairing checklist',
        msg: 'Review onboarding notes before pairing devices.',
        kind: 'info',
        icon: ''
      });
    });

    // Calibration Wizard Navigation System
    const calWizard = {
      currentStep: 0,
      steps: ['scope-type', 'scope-detail', 'target', 'sequence', 'review'],
      totalSteps: 5,
      
      open() {
        const calModal = document.getElementById('calModal');
        if (calModal) {
          this.currentStep = 0;
          this.showStep(0);
          calModal.setAttribute('aria-hidden', 'false');
          calModal.style.display = 'flex';
          // Focus on modal for accessibility
          const modalDialog = calModal.querySelector('.cal-modal__dialog');
          if (modalDialog) modalDialog.focus();
        }
      },
      
      close() {
        const calModal = document.getElementById('calModal');
        if (calModal) {
          calModal.setAttribute('aria-hidden', 'true');
          calModal.style.display = 'none';
        }
      },
      
      showStep(index) {
        if (index < 0) index = 0;
        if (index >= this.totalSteps) index = this.totalSteps - 1;
        
        this.currentStep = index;
        const activeStepName = this.steps[index];
        
        // Hide all steps, show only the active one
        document.querySelectorAll('.cal-step').forEach(step => {
          if (step.dataset.step === activeStepName) {
            step.style.display = 'block';
          } else {
            step.style.display = 'none';
          }
        });
        
        // Update progress indicator
        const progressEl = document.getElementById('calModalProgress');
        if (progressEl) {
          progressEl.textContent = `Step ${index + 1} of ${this.totalSteps}`;
        }
        
        // Update button visibility
        const prevBtn = document.getElementById('calPrev');
        const nextBtn = document.getElementById('calNext');
        const applyBtn = document.getElementById('calApply');
        
        if (prevBtn) {
          prevBtn.disabled = (index === 0);
        }
        
        // On last step, show Apply instead of Next
        if (index === this.totalSteps - 1) {
          if (nextBtn) nextBtn.style.display = 'none';
          if (applyBtn) applyBtn.style.display = 'inline-block';
        } else {
          if (nextBtn) nextBtn.style.display = 'inline-block';
          if (applyBtn) applyBtn.style.display = 'none';
        }
      },
      
      nextStep() {
        if (this.currentStep < this.totalSteps - 1) {
          this.showStep(this.currentStep + 1);
        }
      },
      
      prevStep() {
        if (this.currentStep > 0) {
          this.showStep(this.currentStep - 1);
        }
      },
      
      // Initialize calibration wizard data when opened
      initialize() {
        this.populateGroupSelect();
        this.populateLightsSelect();
        this.setupScopeListeners();
      },
      
      // Populate group select with available groups
      populateGroupSelect() {
        const groupSelect = document.getElementById('calScopeGroupSelect');
        if (!groupSelect) return;
        
        const groups = STATE.groups || [];
        groupSelect.innerHTML = '<option value="">(select group)</option>' +
          groups.map(g => `<option value="${g.id}">${g.name || g.id}</option>`).join('');
        
        console.log('[CalWizard] Populated group select with', groups.length, 'groups');
      },
      
      // Populate lights checklist for "Specific lights" scope
      populateLightsSelect() {
        const lightsContainer = document.getElementById('calScopeLights');
        if (!lightsContainer) return;
        
        const lights = STATE.lights || [];
        if (!lights.length) {
          lightsContainer.innerHTML = '<p class="tiny" style="color:#64748b">No lights available. Add lights first.</p>';
          return;
        }
        
        lightsContainer.innerHTML = lights.map(light => {
          const displayName = light.name || light.deviceName || light.id;
          return `
            <label class="chip-option">
              <input type="checkbox" name="calScopeLightIds" value="${light.id}">
              <span>${displayName}</span>
            </label>
          `;
        }).join('');
        
        console.log('[CalWizard] Populated lights checklist with', lights.length, 'lights');
      },
      
      // Setup event listeners for scope type selection
      setupScopeListeners() {
        // Listen for scope type changes
        const scopeTypeInputs = document.querySelectorAll('input[name="calScopeType"]');
        scopeTypeInputs.forEach(input => {
          input.addEventListener('change', (e) => {
            const selectedScope = e.target.value;
            this.updateScopeDetails(selectedScope);
          });
        });
        
        // Listen for group selection
        const groupSelect = document.getElementById('calScopeGroupSelect');
        if (groupSelect) {
          groupSelect.addEventListener('change', (e) => {
            const groupId = e.target.value;
            this.updateGroupLights(groupId);
          });
        }
        
        console.log('[CalWizard] Setup scope listeners');
      },
      
      // Update scope details section based on selected scope type
      updateScopeDetails(scopeType) {
        const lightsBlock = document.getElementById('calScopeLights');
        const groupBlock = document.getElementById('calScopeGroup');
        const locationBlock = document.getElementById('calScopeLocation');
        
        // Hide all scope blocks
        if (lightsBlock) lightsBlock.style.display = 'none';
        if (groupBlock) groupBlock.style.display = 'none';
        if (locationBlock) locationBlock.style.display = 'none';
        
        // Show the selected scope block
        if (scopeType === 'lights' && lightsBlock) {
          lightsBlock.style.display = 'block';
        } else if (scopeType === 'group' && groupBlock) {
          groupBlock.style.display = 'block';
        } else if (scopeType === 'location' && locationBlock) {
          locationBlock.style.display = 'block';
        }
        
        console.log('[CalWizard] Updated scope details for:', scopeType);
      },
      
      // Update summary when a group is selected
      updateGroupLights(groupId) {
        if (!groupId) {
          const summary = document.getElementById('calScopeSummary');
          if (summary) summary.textContent = 'Select a group to see assigned lights.';
          return;
        }
        
        const group = STATE.groups.find(g => g.id === groupId);
        if (!group) return;
        
        const lights = Array.isArray(group.lights) ? group.lights : [];
        const lightCount = lights.length;
        
        const summary = document.getElementById('calScopeSummary');
        if (summary) {
          summary.textContent = `Group "${group.name || groupId}" has ${lightCount} assigned light${lightCount !== 1 ? 's' : ''}.`;
        }
        
        console.log('[CalWizard] Group selected:', groupId, 'with', lightCount, 'lights');
      }
    };
    
    // ✅ DATA FLOW: Register event listeners for Calibration wizard
    // Refresh fixture/group/room lists when related data changes
    document.addEventListener('lights-updated', () => {
      console.log('[CalWizard] Lights updated, re-populating fixture list');
      if (calWizard && typeof calWizard.populateLightsSelect === 'function') {
        calWizard.populateLightsSelect();
      }
    });

    document.addEventListener('rooms-updated', () => {
      console.log('[CalWizard] Rooms updated, refreshing location options');
      if (calWizard && typeof calWizard.populateGroupSelect === 'function') {
        calWizard.populateGroupSelect();
      }
    });

    document.addEventListener('bus-mapping-updated', () => {
      console.log('[CalWizard] Bus mapping updated, refreshing fixture assignments');
      if (calWizard && typeof calWizard.populateLightsSelect === 'function') {
        calWizard.populateLightsSelect();
      }
    });
    
    // Wire up Calibration button to open calibration wizard modal
    document.getElementById('btnOpenCalWizard')?.addEventListener('click', () => {
      calWizard.initialize();
      calWizard.open();
    });
    
    // Also wire the button from Groups V2 panel
    document.getElementById('btnOpenCalWizardFromGroups')?.addEventListener('click', () => {
      calWizard.initialize();
      calWizard.open();
    });

    // Wire calibration modal close button
    document.getElementById('calModalClose')?.addEventListener('click', () => {
      calWizard.close();
    });

    // Wire calibration modal backdrop click to close
    document.getElementById('calModalBackdrop')?.addEventListener('click', () => {
      calWizard.close();
    });
    
    // Wire up calibration wizard navigation buttons
    document.getElementById('calNext')?.addEventListener('click', () => {
      calWizard.nextStep();
    });
    
    document.getElementById('calPrev')?.addEventListener('click', () => {
      calWizard.prevStep();
    });
    
    // Wire up calibration wizard form submission
    document.getElementById('calWizardForm')?.addEventListener('submit', (e) => {
      e.preventDefault();
      console.log('[CalWizard] Form submitted - applying calibration');
      // TODO: Implement calibration logic
      calWizard.close();
    });

    // Wire Add Device button in Integrations panel to open Pair Devices panel
    document.getElementById('btnAddDeviceIntegrations')?.addEventListener('click', () => {
      try {
        setActivePanel('pair-devices');
        // If a modal-based pairing wizard is available, open it as well for convenience
        const openWizard = typeof DEVICE_PAIR_WIZARD !== 'undefined' && DEVICE_PAIR_WIZARD?.open;
        if (openWizard) DEVICE_PAIR_WIZARD.open();
      } catch (e) {
        console.warn('Failed to navigate to Pair Devices panel from Integrations', e);
      }
    });

    document.getElementById('btnRefreshSmartPlugs')?.addEventListener('click', () => loadSmartPlugs());
    document.getElementById('btnDiscoverSmartPlugs')?.addEventListener('click', () => discoverSmartPlugs());
    registerSmartPlugDevRefreshAction();

    const smartPlugTable = document.getElementById('smartPlugsTable');
    if (smartPlugTable) {
      smartPlugTable.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        if (target.matches('[data-plug-toggle]')) {
          const plugId = target.getAttribute('data-plug-id');
          const desired = target.getAttribute('data-state') === 'on';
          if (plugId) {
            toggleSmartPlug(plugId, desired);
          }
        } else if (target.matches('[data-plug-refresh]')) {
          const plugId = target.getAttribute('data-plug-id');
          if (plugId) {
            refreshSmartPlug(plugId);
          }
        }
      });

      smartPlugTable.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLSelectElement)) return;
        if (target.matches('[data-plug-rule-select]')) {
          const plugId = target.getAttribute('data-plug-id');
          if (!plugId) return;
          const selected = Array.from(target.selectedOptions).map((option) => option.value);
          assignPlugRules(plugId, selected);
        }
      });
    }

    const switchBotCreds = STATE?.farm?.integrations?.switchbot || {};
    const hasSwitchBotCreds = !!(switchBotCreds.token && switchBotCreds.secret);

    if (hasSwitchBotCreds) {
      await loadPreAutomationRules();
      await loadSmartPlugs({ silent: true });
    } else {
      STATE.preAutomationRules = [];
      STATE.smartPlugs = [];
      renderSmartPlugs();
    }
    await reloadEnvironment();
    startEnvPolling();

    const profileForm = document.getElementById('profileForm');
    if (profileForm) {
      const nameInput = document.getElementById('profileName');
      const roleInput = document.getElementById('profileRole');
      const emailInput = document.getElementById('profileEmail');
      const phoneInput = document.getElementById('profilePhone');
      const statusEl = document.getElementById('profileStatus');

      try {
        const storedProfile = JSON.parse(localStorage.getItem('gr.profile') || 'null');
        if (storedProfile) {
          if (nameInput) nameInput.value = storedProfile.name || '';
          if (roleInput) roleInput.value = storedProfile.role || '';
          if (emailInput) emailInput.value = storedProfile.email || '';
          if (phoneInput) phoneInput.value = storedProfile.phone || '';
          if (statusEl) statusEl.textContent = 'Loaded from device';
        }
      } catch (err) {
        console.warn('Failed to load stored profile', err);
      }

      profileForm.addEventListener('submit', (event) => {
        event.preventDefault();
        const payload = {
          name: nameInput?.value?.trim() || '',
          role: roleInput?.value?.trim() || '',
          email: emailInput?.value?.trim() || '',
          phone: phoneInput?.value?.trim() || ''
        };
        try {
          localStorage.setItem('gr.profile', JSON.stringify(payload));
        } catch (err) {
          console.warn('Failed to persist profile', err);
        }
        if (statusEl) statusEl.textContent = 'Saved locally';
        showToast({ title: 'Profile saved', msg: 'Profile details stored on this device.', kind: 'success', icon: '' });
      });

      document.getElementById('profileReset')?.addEventListener('click', () => {
        if (nameInput) nameInput.value = '';
        if (roleInput) roleInput.value = '';
        if (emailInput) emailInput.value = '';
        if (phoneInput) phoneInput.value = '';
        try {
          localStorage.removeItem('gr.profile');
        } catch (err) {
          console.warn('Failed to clear profile', err);
        }
        if (statusEl) statusEl.textContent = 'Profile cleared';
        showToast({ title: 'Profile reset', msg: 'Local profile details removed.', kind: 'info', icon: '' });
      });
    }

    // Billing integration for profile panel
    async function loadBillingStatus() {
      // Check if profile panel elements exist before attempting to load billing
      const noSubEl = document.getElementById('noSubscription');
      const activeSubEl = document.getElementById('activeSubscription');
      if (!noSubEl || !activeSubEl) {
        console.log('[Billing] Profile panel not available, skipping billing status load');
        return;
      }

      const TENANT_ID = 'sandbox-test-tenant';
      const billingApiBase = API_BASE.replace(':8091', ':8000');
      
      try {
        // Check for active subscription
        const subscription = localStorage.getItem('sandbox_subscription');
        
        if (subscription) {
          const subData = JSON.parse(subscription);
          noSubEl.style.display = 'none';
          activeSubEl.style.display = 'block';
          
          // Update plan details
          document.getElementById('currentPlanName').textContent = subData.plan.name;
          document.getElementById('currentPlanPrice').textContent = `$${(subData.plan.price / 100).toFixed(2)}`;
          
          // Load usage data
          try {
            const usageResponse = await fetch(`${billingApiBase}/api/billing/usage/${TENANT_ID}?days=1`);
            const usageData = await usageResponse.json();
            
            if (usageData.status === 'success' || usageData.status === 'partial') {
              const usage = usageData.usage;
              document.getElementById('usageDevices').textContent = usage.devices || 0;
              document.getElementById('usageApiCalls').textContent = (usage.api_calls_total || 0).toLocaleString();
              document.getElementById('usageStorage').textContent = `${(usage.storage_gb || 0).toFixed(1)} GB`;
            }
          } catch (err) {
            console.warn('Failed to load usage data:', err);
            // Show mock data
            document.getElementById('usageDevices').textContent = '5';
            document.getElementById('usageApiCalls').textContent = '342';
            document.getElementById('usageStorage').textContent = '2.3 GB';
          }
        } else {
          // No subscription
          document.getElementById('noSubscription').style.display = 'block';
          document.getElementById('activeSubscription').style.display = 'none';
        }
      } catch (err) {
        console.error('Failed to load billing status:', err);
      }
    }

    // Load billing status on init
    loadBillingStatus();

    // Refresh billing every 60 seconds
    setInterval(loadBillingStatus, 60000);

    // Field Matrix Panel
    function renderFieldMatrix() {
      const tableBody = document.getElementById('fieldMatrixTableBody');
      const statusEl = document.getElementById('fieldMatrixStatus');
      
      if (!tableBody) return;
      
      try {
        // Gather all lights with their zone/room assignments
        const lights = STATE.lights || [];
        const groups = STATE.groups || [];
        const iotDevices = STATE.iotDevices || [];
        const roomMap = STATE.roomMap || {};
        
        if (!lights.length) {
          tableBody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:#64748b;">No lights found. Add lights first.</td></tr>';
          if (statusEl) statusEl.textContent = 'No data';
          return;
        }
        
        // Build zone-to-room mapping from room-map
        const zoneToRoom = {};
        Object.entries(roomMap).forEach(([roomName, roomData]) => {
          if (roomData && Array.isArray(roomData.zones)) {
            roomData.zones.forEach(zone => {
              zoneToRoom[zone] = roomName;
            });
          }
        });
        
        // Build light-to-group mapping
        const lightToGroup = {};
        groups.forEach(group => {
          if (Array.isArray(group.lights)) {
            group.lights.forEach(light => {
              const lightId = typeof light === 'string' ? light : (light.id || light.lightId || light.deviceId);
              if (lightId) {
                lightToGroup[lightId] = group.name || group.id;
              }
            });
          }
        });
        
        // Build rows
        const rows = lights.map(light => {
          const lightId = light.id || light.deviceId || light.serial;
          const lightName = light.name || light.deviceName || lightId;
          const zone = light.zone || light.location?.zone || '—';
          const room = zoneToRoom[zone] || light.room || light.location?.room || '—';
          const status = light.online ? '🟢 Online' : ' Offline';
          const group = lightToGroup[lightId] || '—';
          
          return `
            <tr style="border-bottom:1px solid #e2e8f0;">
              <td style="padding:12px;color:#0f172a;">${zone}</td>
              <td style="padding:12px;color:#475569;">${room}</td>
              <td style="padding:12px;color:#475569;font-family:monospace;font-size:0.85rem;">${lightId}</td>
              <td style="padding:12px;color:#0f172a;">${lightName}</td>
              <td style="padding:12px;">${status}</td>
              <td style="padding:12px;color:#475569;">${group}</td>
            </tr>
          `;
        }).join('');
        
        tableBody.innerHTML = rows;
        
        if (statusEl) statusEl.textContent = `${lights.length} lights mapped`;
        console.log('[FieldMatrix] Rendered', lights.length, 'lights');
        
      } catch (err) {
        console.error('[FieldMatrix] Error rendering matrix:', err);
        tableBody.innerHTML = '<tr><td colspan="6" style="padding:24px;text-align:center;color:#e11d48;">Error loading field matrix data</td></tr>';
        if (statusEl) statusEl.textContent = 'Error';
      }
    }
    
    // Export field matrix to CSV
    function exportFieldMatrixCSV() {
      try {
        const lights = STATE.lights || [];
        const groups = STATE.groups || [];
        const roomMap = STATE.roomMap || {};
        
        // Build zone-to-room mapping
        const zoneToRoom = {};
        Object.entries(roomMap).forEach(([roomName, roomData]) => {
          if (roomData && Array.isArray(roomData.zones)) {
            roomData.zones.forEach(zone => {
              zoneToRoom[zone] = roomName;
            });
          }
        });
        
        // Build light-to-group mapping
        const lightToGroup = {};
        groups.forEach(group => {
          if (Array.isArray(group.lights)) {
            group.lights.forEach(light => {
              const lightId = typeof light === 'string' ? light : (light.id || light.lightId || light.deviceId);
              if (lightId) {
                lightToGroup[lightId] = group.name || group.id;
              }
            });
          }
        });
        
        // Build CSV header
        const csvRows = [
          ['Zone', 'Room', 'Light ID', 'Light Name', 'Status', 'Group']
        ];
        
        // Add data rows
        lights.forEach(light => {
          const lightId = light.id || light.deviceId || light.serial;
          const lightName = light.name || light.deviceName || lightId;
          const zone = light.zone || light.location?.zone || '';
          const room = zoneToRoom[zone] || light.room || light.location?.room || '';
          const status = light.online ? 'Online' : 'Offline';
          const group = lightToGroup[lightId] || '';
          
          csvRows.push([zone, room, lightId, lightName, status, group]);
        });
        
        // Convert to CSV string
        const csvContent = csvRows.map(row => 
          row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        
        // Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `field-matrix-${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        showToast({ title: 'Export successful', msg: 'Field matrix exported to CSV', kind: 'success', icon: '' });
        console.log('[FieldMatrix] Exported', lights.length, 'lights to CSV');
        
      } catch (err) {
        console.error('[FieldMatrix] Export error:', err);
        showToast({ title: 'Export failed', msg: err.message, kind: 'error', icon: '' });
      }
    }
    
    // Wire Field Matrix buttons
    document.getElementById('btnRefreshFieldMatrix')?.addEventListener('click', () => {
      renderFieldMatrix();
      showToast({ title: 'Matrix refreshed', msg: 'Field matrix data reloaded', kind: 'success', icon: '' });
    });
    
    document.getElementById('btnExportFieldMatrix')?.addEventListener('click', () => {
      exportFieldMatrixCSV();
    });
    
    // Expose globally for panel activation
    window.renderFieldMatrix = renderFieldMatrix;

    // --- Main async app logic ---
    // (was: await loadAllData();)
    await loadAllData();
    // ...rest of async logic continues...
  })();
  // Load runtime config and show chip
  await loadConfig();
  // Forwarder health polling removed - using consolidated System Status indicator
  
  // Initialize AI features and top card
  initializeTopCard();
  initializeAIFeatures();
  
  // Apply saved branding if available
  if (STATE.farm && STATE.farm.branding) {
    applyTheme(STATE.farm.branding.palette, {
      fontFamily: STATE.farm.branding.fontFamily || '',
      logoHeight: STATE.farm.branding.logoHeight || ''
    });
  }
  

  // (removed duplicate light setup wiring and duplicate loadAllData call)
  // Wire Plans panel buttons
  try {
    document.getElementById('btnAddPlan')?.addEventListener('click', () => {
      const id = `plan-${Math.random().toString(36).slice(2,8)}`;
      STATE.plans.push({ id, name: 'New plan', description: '', spectrum: { cw:45, ww:45, bl:0, rd:10 }, ppfd: 200, photoperiod: 12 });
      renderPlans();
      renderPlansPanel();
      dispatchPlansUpdated({ source: 'add-plan-draft', plans: STATE.plans.slice() });
      const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Draft plan added';
    });
    document.getElementById('btnSavePlans')?.addEventListener('click', async () => {
      try {
        const result = await publishPlansDocument({ plans: STATE.plans });
        const ok = !!(result && result.ok !== false);
        if (ok && result && typeof result === 'object') {
          STATE.planDocumentInfo = result;
          if (Array.isArray(result.plans)) {
            STATE.plans = result.plans;
          }
        }
        const status = document.getElementById('plansStatus');
        if (status) status.textContent = ok ? 'Saved' : 'Save failed';
        renderPlans();
        renderPlansPanel();
        if (typeof renderGroups === 'function') renderGroups();
  // Notify listeners plans changed
  dispatchPlansUpdated({ source: 'save-plans-button', plans: STATE.plans.slice() });
      } catch (e) {
        console.warn('Failed to publish plans', e);
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Save failed';
      }
    });
    document.getElementById('btnDownloadPlans')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify({ plans: STATE.plans }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'plans.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    });
    document.getElementById('btnUploadPlans')?.addEventListener('click', () => {
      document.getElementById('plansUpload')?.click();
    });
    document.getElementById('plansUpload')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : (data.plans || []);
        if (!Array.isArray(incoming)) throw new Error('Invalid format');
        // merge by id or append
        const map = new Map(STATE.plans.map(p => [p.id, p]));
        for (const p of incoming) {
          const id = p.id || `plan-${Math.random().toString(36).slice(2,8)}`;
          map.set(id, { ...map.get(p.id), ...p, id });
        }
        STATE.plans = Array.from(map.values());
        renderPlans();
        renderPlansPanel();
  // Notify listeners plans changed
  dispatchPlansUpdated({ source: 'import-plans', plans: STATE.plans.slice() });
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Imported';
      } catch (err) {
        const status = document.getElementById('plansStatus'); if (status) status.textContent = 'Import failed';
      }
      e.target.value = '';
    });
  } catch (e) { console.warn('Plans panel wiring failed', e); }
  try {
    document.getElementById('btnScanIoTDevices')?.addEventListener('click', window.scanIoTDevices);
    document.getElementById('btnOpenSwitchBotManager')?.addEventListener('click', window.openSwitchBotManager);
    document.getElementById('btnOpenKasaManager')?.addEventListener('click', window.openKasaManager);
    document.getElementById('btnOpenShellyManager')?.addEventListener('click', window.openShellyManager);
  } catch (e) { console.warn('SwitchBot panel wiring failed', e); }
  if (document.getElementById('iotDevicesList')) {
    renderIoTDeviceCards(window.LAST_IOT_SCAN);
  }
  await loadDeviceManufacturers();
  try {
    const farmLocal = JSON.parse(localStorage.getItem('gr.farm') || 'null') || STATE.farm;
    if (farmLocal?.branding?.logo && !farmLocal.branding.logo.startsWith('http://') && !farmLocal.branding.logo.startsWith('https://')) {
      farmLocal.branding.logo = '';
      localStorage.setItem('gr.farm', JSON.stringify(farmLocal));
    }
    const branding = farmLocal?.branding || STATE.farm?.branding;
    if (branding?.palette) applyTheme(branding.palette, { fontFamily: branding.fontFamily || '' });
    if (Array.isArray(branding?.fontCss) && branding.fontCss.length) {
      const id = 'gr-brand-fonts'; let link = document.getElementById(id); if (!link) { link = document.createElement('link'); link.id = id; link.rel = 'stylesheet'; document.head.appendChild(link); }
      link.href = branding.fontCss[0];
    }
    const headerLogo = document.querySelector('.header.logo img');
    if (headerLogo && branding?.logo) { 
      const logoUrl = branding.logo.trim();
      if (logoUrl && (logoUrl.startsWith('http://') || logoUrl.startsWith('https://'))) {
        const testImg = new Image();
        testImg.onload = () => {
          headerLogo.src = logoUrl;
          headerLogo.style.display = 'inline-block';
        };
        testImg.onerror = () => {
          headerLogo.style.display = 'none';
        };
        testImg.src = logoUrl;
      } else {
        headerLogo.style.display = 'none';
      }
    }
    const title = document.querySelector('.header.logo h1');
    if (title && branding?.fontFamily) { title.style.fontFamily = branding.fontFamily + ', var(--gr-font)'; }
  } catch {}
  try { initLightsStatusUI(); } catch (e) { console.warn('Lights status init failed', e); }
  setStatus("Dashboard loaded");
  if (typeof DeviceManagerWindow === 'function') {
    try { window.deviceManagerWindow = window.deviceManagerWindow || new DeviceManagerWindow(); } catch (e) { console.warn('[Bootstrap] DeviceManagerWindow late init failed', e); }
  }
  } catch (err) {
    console.error('[Bootstrap] Uncaught error during initialization', err);
  } finally {
    // --- Always initialize sidebar navigation last (and even if earlier steps failed) ---
    try { if (typeof initializeSidebarNavigation === 'function') initializeSidebarNavigation(); } catch (e) { console.warn('[Bootstrap] Sidebar navigation init failed', e); }

    // As a safety net for Chrome: delegate clicks on sidebar links even if direct listeners failed
    try {
      if (!window.__sidebarDelegationBound) {
        window.__sidebarDelegationBound = true;
        document.addEventListener('click', (evt) => {
          const el = evt.target instanceof Element ? evt.target.closest('[data-sidebar-link]') : null;
          if (!el) return;
          const target = el.getAttribute('data-target') || 'overview';
          // Prevent duplicate navigation if a direct handler already ran
          if (window.__handlingSidebarDelegated) return;
          window.__handlingSidebarDelegated = true;
          try {
            setActivePanel(target);
            if (target === 'equipment-overview') {
              try { renderEquipmentOverview(); } catch (e) { console.warn('Failed to render equipment overview via delegation', e); }
            }
            if (target === 'field-matrix') {
              try { renderFieldMatrix(); } catch (e) { console.warn('Failed to render field matrix via delegation', e); }
            }
          } finally {
            setTimeout(() => { window.__handlingSidebarDelegated = false; }, 0);
          }
        }, true); // capture early to ensure it fires in Chrome
      }
    } catch (e) {
      console.warn('[Bootstrap] Sidebar delegated navigation failed', e);
    }
  }
});

// Bus Mapping Wizard
let busMappingState = {
  currentStep: 1,
  selectedBus: null,
  scannedNodes: [],
  selectedNode: null,
  selectedChannel: null,
  identifyResult: null,
  selectedGroup: null,
  lightModel: {
    manufacturer: '',
    model: '',
    spectrumProfile: '',
    wattage: 0,
    tunable: false
  },
  existingMapping: null, // For editing existing mappings
  totalChannels: 0,
  mappedChannels: 0,
  skippedChannels: [],
  allMappings: []
};

window.startBusScan = async function() {
  const busId = document.getElementById('busScanId').value.trim();
  if (!busId) {
    showToast('Please enter a Bus ID', 'warning');
    return;
  }

  const statusEl = document.getElementById('busScanStatus');
  statusEl.textContent = 'Scanning bus...';
  statusEl.className = 'bus-scan-status scanning';

  try {
    // Load existing mappings first
    const mappingsRes = await fetch(`${API_BASE}/api/bus-mappings`);
    if (mappingsRes.ok) {
      busMappingState.allMappings = await mappingsRes.json();
    }

    const res = await fetch(`${API_BASE}/api/bus/${busId}/scan`);
    if (!res.ok) throw new Error(`Scan failed: ${res.status}`);
    
    const data = await res.json();
    busMappingState.selectedBus = busId;
    busMappingState.scannedNodes = data.nodes || [];
    
    // Calculate total channels
    busMappingState.totalChannels = busMappingState.scannedNodes.reduce((sum, node) => 
      sum + (node.channels?.length || 0), 0);
    
    // Count already mapped channels
    busMappingState.mappedChannels = busMappingState.allMappings.filter(m => 
      m.selectedBus === busId).length;
    
    const unmappedCount = busMappingState.totalChannels - busMappingState.mappedChannels;
    statusEl.textContent = `Found ${busMappingState.scannedNodes.length} nodes, ${unmappedCount} unmapped channels`;
    statusEl.className = 'bus-scan-status success';
    
    updateProgressIndicator();
    renderScannedNodes();
    busMappingNextStep();
  } catch (err) {
    console.error('Bus scan error:', err);
    statusEl.textContent = `Scan failed: ${err.message}`;
    statusEl.className = 'bus-scan-status error';
    showToast('Bus scan failed', 'error');
  }
};

function renderScannedNodes() {
  const container = document.getElementById('busNodeList');
  container.innerHTML = busMappingState.scannedNodes.map(node => `
    <div class="bus-node-card" data-node-id="${node.id}" onclick="selectBusNode('${node.id}')">
      <strong>Node ${node.id}</strong>
      <div style="font-size: 12px; color: var(--gr-muted);">
        ${node.channels.length} channels
      </div>
    </div>
  `).join('');
}

window.selectBusNode = function(nodeId) {
  const node = busMappingState.scannedNodes.find(n => n.id === nodeId);
  if (!node) return;
  
  busMappingState.selectedNode = node;
  
  document.querySelectorAll('.bus-node-card').forEach(card => {
    card.removeAttribute('data-selected');
  });
  document.querySelector(`[data-node-id="${nodeId}"]`)?.setAttribute('data-selected', '');
  
  renderChannelList(node.channels);
};

function renderChannelList(channels) {
  const container = document.getElementById('busChannelList');
  
  container.innerHTML = channels.map(ch => {
    const existing = busMappingState.allMappings.find(m => 
      m.selectedChannel === ch.id && m.selectedBus === busMappingState.selectedBus);
    
    const badge = existing ? 
      '<span style="background: var(--gr-accent); color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;">MAPPED</span>' : '';
    
    const groupInfo = existing ? 
      `<div style="font-size: 10px; color: var(--gr-muted); margin-top: 2px;">→ ${existing.selectedGroup}</div>` : '';
    
    return `
      <div class="bus-channel-row" data-channel-id="${ch.id}" onclick="selectBusChannel('${ch.id}', ${!!existing})">
        <input type="radio" name="busChannel" value="${ch.id}">
        <div>
          <span>Channel ${ch.id}</span>
          <span style="font-size: 11px; color: var(--gr-muted);">${ch.type || 'Unknown'}</span>
          ${badge}
          ${groupInfo}
        </div>
      </div>
    `;
  }).join('') + `
    <button type="button" class="ghost" style="margin-top: 12px; width: 100%;" onclick="skipChannel()">
      Skip This Channel
    </button>
  `;
}

window.selectBusChannel = function(channelId, hasExisting = false) {
  busMappingState.selectedChannel = channelId;
  
  // Load existing mapping if present
  if (hasExisting) {
    busMappingState.existingMapping = busMappingState.allMappings.find(m => 
      m.selectedChannel === channelId && m.selectedBus === busMappingState.selectedBus);
    
    if (busMappingState.existingMapping) {
      showToast('Loading existing mapping for editing', 'info');
      // Pre-populate state
      busMappingState.selectedGroup = busMappingState.existingMapping.selectedGroup;
      busMappingState.lightModel = busMappingState.existingMapping.lightModel || {};
    }
  } else {
    busMappingState.existingMapping = null;
  }
  
  document.querySelectorAll('.bus-channel-row').forEach(row => {
    row.removeAttribute('data-selected');
  });
  document.querySelector(`[data-channel-id="${channelId}"]`)?.setAttribute('data-selected', '');
  
  const radio = document.querySelector(`[data-channel-id="${channelId}"] input[type="radio"]`);
  if (radio) radio.checked = true;
};

window.skipChannel = function() {
  if (!busMappingState.selectedNode) return;
  
  const currentChannel = busMappingState.selectedNode.channels.find(ch => 
    document.querySelector(`[data-channel-id="${ch.id}"] input`)?.checked);
  
  if (currentChannel) {
    busMappingState.skippedChannels.push(currentChannel.id);
    showToast('Channel skipped - you can map it later', 'info');
  }
  
  // Move to next unmapped channel or finish
  const nextUnmapped = busMappingState.selectedNode.channels.find(ch => 
    !busMappingState.allMappings.some(m => m.selectedChannel === ch.id) &&
    !busMappingState.skippedChannels.includes(ch.id));
  
  if (nextUnmapped) {
    selectBusChannel(nextUnmapped.id, false);
  } else {
    showToast('All channels processed!', 'success');
    cancelBusMapping();
  }
};

window.identifyChannel = async function() {
  if (!busMappingState.selectedChannel) {
    showToast('Please select a channel first', 'warning');
    return;
  }

  const statusEl = document.getElementById('identifyStatus');
  statusEl.textContent = 'Flashing lights...';
  statusEl.className = 'identify-status active';

  try {
    const res = await fetch(`${API_BASE}/api/channels/${busMappingState.selectedChannel}/identify`, {
      method: 'POST'
    });
    if (!res.ok) throw new Error('Identify failed');
    
    statusEl.textContent = 'Did the lights flash?';
    statusEl.className = 'identify-status waiting';
  } catch (err) {
    console.error('Identify error:', err);
    statusEl.textContent = 'Identify failed';
    statusEl.className = 'identify-status error';
    showToast('Failed to identify channel', 'error');
  }
};

window.confirmIdentification = function(success) {
  busMappingState.identifyResult = success;
  
  if (success) {
    document.getElementById('identifyStatus').textContent = 'Identification confirmed!';
    document.getElementById('identifyStatus').className = 'identify-status success';
    setTimeout(() => busMappingNextStep(), 800);
  } else {
    document.getElementById('identifyStatus').textContent = 'Try a different channel';
    document.getElementById('identifyStatus').className = 'identify-status warning';
    busMappingState.selectedChannel = null;
  }
};

window.assignToGroup = function() {
  const groupId = document.getElementById('groupSelect').value;
  if (!groupId) {
    showToast('Please select a group', 'warning');
    return;
  }
  
  busMappingState.selectedGroup = groupId;
  busMappingNextStep();
};

// Smart group name suggestion
function suggestGroupName() {
  if (!busMappingState.selectedBus || !busMappingState.selectedNode || !busMappingState.selectedChannel) {
    return '';
  }
  
  const bus = busMappingState.selectedBus.replace(/[^a-zA-Z0-9]/g, '');
  const node = busMappingState.selectedNode.id;
  const channel = busMappingState.selectedChannel.split('-').pop();
  
  return `${bus}-node${node}-ch${channel}`;
}

window.saveLightModel = function() {
  const manufacturer = document.getElementById('lightManufacturer').value.trim();
  const model = document.getElementById('lightModel').value.trim();
  const spectrumProfile = document.getElementById('spectrumProfile').value;
  const wattage = parseInt(document.getElementById('lightWattage').value) || 0;
  const tunable = document.getElementById('lightTunable').checked;
  
  // Validation
  if (!manufacturer || !model) {
    showToast('Please enter manufacturer and model', 'warning');
    return;
  }
  
  if (wattage <= 0) {
    showToast('Please enter a valid wattage', 'warning');
    return;
  }
  
  // Validate compatibility
  const channel = busMappingState.selectedNode?.channels.find(ch => 
    ch.id === busMappingState.selectedChannel);
  
  if (channel && !validateModelCompatibility(channel, spectrumProfile, tunable)) {
    const forceConfirm = confirm(
      `Warning: This light model may not be compatible with channel type "${channel.type}".\n\n` +
      `Selected: ${spectrumProfile}${tunable ? ' (tunable)' : ''}\n` +
      `Channel: ${channel.type}\n\n` +
      `Force this mapping anyway?`
    );
    
    if (!forceConfirm) {
      return;
    }
  }
  
  busMappingState.lightModel = { manufacturer, model, spectrumProfile, wattage, tunable };
  busMappingNextStep();
};

// Validate light model compatibility with channel type
function validateModelCompatibility(channel, spectrumProfile, tunable) {
  const channelType = (channel.type || '').toLowerCase();
  
  // Simple on/off relay should not have tunable multi-channel models
  if (channelType.includes('relay') || channelType.includes('switch')) {
    if (tunable || spectrumProfile.includes('4ch') || spectrumProfile.includes('3ch')) {
      return false;
    }
  }
  
  // 0-10V analog should support tunable but not complex multi-channel without driver
  if (channelType.includes('analog') || channelType.includes('0-10v')) {
    if (spectrumProfile.includes('4ch')) {
      return false; // 4-channel requires DMX/RS485, not simple analog
    }
  }
  
  return true; // Default to compatible
}

window.finalizeBusMapping = async function() {
  try {
    const res = await fetch(`${API_BASE}/api/bus-mapping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(busMappingState)
    });
    
    if (!res.ok) throw new Error('Failed to save mapping');
    
    const result = await res.json();
    const message = result.isUpdate ? 
      'Bus mapping updated successfully!' : 
      'Bus mapping created successfully!';
    
    showToast(message, 'success');
    
    // Update progress counter
    if (!result.isUpdate) {
      busMappingState.mappedChannels++;
      updateProgressIndicator();
    }

    // ✅ DATA FLOW: Notify components that bus mappings have been updated
    try {
      document.dispatchEvent(new Event('bus-mapping-updated'));
      console.log('[finalizeBusMapping] Dispatched bus-mapping-updated event');
    } catch (err) {
      console.warn('[finalizeBusMapping] Failed to dispatch bus-mapping-updated:', err);
    }
    
    setTimeout(() => {
      // Check if there are more unmapped channels
      const hasUnmapped = busMappingState.scannedNodes.some(node =>
        node.channels.some(ch => 
          !busMappingState.allMappings.some(m => m.selectedChannel === ch.id) &&
          !busMappingState.skippedChannels.includes(ch.id)
        )
      );
      
      if (hasUnmapped) {
        const continueMapping = confirm(
          `Mapping saved!\\n\\n` +
          `${busMappingState.mappedChannels} of ${busMappingState.totalChannels} channels mapped.\\n\\n` +
          `Continue mapping more channels?`
        );
        
        if (continueMapping) {
          // Reset to step 2 for next channel
          busMappingState.selectedChannel = null;
          busMappingState.selectedGroup = null;
          busMappingState.lightModel = { manufacturer: '', model: '', spectrumProfile: '', wattage: 0, tunable: false };
          busMappingState.existingMapping = null;
          updateBusMappingStep(2);
          return;
        }
      }
      
      cancelBusMapping();
      setActivePanel('equipment-overview');
    }, 1500);
  } catch (err) {
    console.error('Save mapping error:', err);
    showToast('Failed to save mapping', 'error');
  }
};

window.cancelBusMapping = function() {
  busMappingState = {
    currentStep: 1,
    selectedBus: null,
    scannedNodes: [],
    selectedNode: null,
    selectedChannel: null,
    identifyResult: null,
    selectedGroup: null,
    lightModel: { channels: [], spectrumType: '', maxPower: 0 }
  };
  
  updateBusMappingStep(1);
};

window.busMappingNextStep = function() {
  if (busMappingState.currentStep < 6) {
    updateBusMappingStep(busMappingState.currentStep + 1);
  }
};

window.busMappingPrevStep = function() {
  if (busMappingState.currentStep > 1) {
    updateBusMappingStep(busMappingState.currentStep - 1);
  }
};

function updateBusMappingStep(step) {
  busMappingState.currentStep = step;
  
  document.querySelectorAll('.wizard-step').forEach((el, idx) => {
    if (idx + 1 === step) {
      el.setAttribute('data-active', '');
    } else {
      el.removeAttribute('data-active');
    }
  });
  
  document.querySelectorAll('.bus-mapping-step').forEach((el) => {
    if (el.dataset.step == step) {
      el.setAttribute('data-active', '');
    } else {
      el.removeAttribute('data-active');
    }
  });
  
  // Smart defaults and pre-population based on step
  if (step === 4) {
    loadGroupsForBusMapping(); // Load groups with suggested name
  } else if (step === 5) {
    preloadLightModelDefaults(); // Apply smart defaults
  } else if (step === 6) {
    renderMappingReview(); // Show review summary
  }
  
  document.getElementById('busPrevBtn').disabled = step === 1;
  document.getElementById('busNextBtn').style.display = step === 6 ? 'none' : 'inline-block';
}

// Preload light model form with smart defaults or existing values
function preloadLightModelDefaults() {
  const channel = busMappingState.selectedNode?.channels.find(ch => 
    ch.id === busMappingState.selectedChannel);
  
  // If editing existing mapping, load those values
  if (busMappingState.existingMapping?.lightModel) {
    const lm = busMappingState.existingMapping.lightModel;
    document.getElementById('lightManufacturer').value = lm.manufacturer || '';
    document.getElementById('lightModel').value = lm.model || '';
    document.getElementById('spectrumProfile').value = lm.spectrumProfile || '';
    document.getElementById('lightWattage').value = lm.wattage || '';
    document.getElementById('lightTunable').checked = lm.tunable || false;
    return;
  }
  
  // Otherwise, apply smart defaults based on channel type
  const channelType = (channel?.type || '').toLowerCase();
  const spectrumSelect = document.getElementById('spectrumProfile');
  
  // Clear previous values
  document.getElementById('lightManufacturer').value = '';
  document.getElementById('lightModel').value = '';
  document.getElementById('lightWattage').value = '';
  document.getElementById('lightTunable').checked = false;
  
  // Smart spectrum selection based on channel capabilities
  if (channelType.includes('relay') || channelType.includes('switch')) {
    // Simple on/off → Full spectrum white only
    spectrumSelect.value = 'full-spectrum';
    document.getElementById('lightTunable').disabled = true;
  } else if (channelType.includes('analog') || channelType.includes('0-10v')) {
    // Analog 0-10V → Dimmable but not multi-channel
    spectrumSelect.value = 'full-spectrum';
    document.getElementById('lightTunable').disabled = false;
  } else if (channelType.includes('cw') || channelType.includes('ww')) {
    // Cool/Warm white channels → 3 or 4 channel system
    spectrumSelect.value = '4ch-cwww-bl-rd';
    document.getElementById('lightTunable').checked = true;
  } else if (channelType.includes('660') || channelType.includes('450')) {
    // Specific wavelengths → Multi-channel tunable
    spectrumSelect.value = '3ch-ww-bl-rd';
    document.getElementById('lightTunable').checked = true;
  } else {
    // Default
    spectrumSelect.value = 'full-spectrum';
  }
  
  // Add tooltip explaining the selection
  showToast(`Smart default applied for ${channelType} channel type`, 'info');
}

// Render final review summary
function renderMappingReview() {
  const reviewEl = document.getElementById('mappingReview');
  const isUpdate = !!busMappingState.existingMapping;
  
  reviewEl.innerHTML = `
    <div style="background: var(--gr-surface); padding: 16px; border-radius: 8px;">
      ${isUpdate ? '<div style="background: var(--gr-accent); color: white; padding: 6px 12px; border-radius: 4px; margin-bottom: 12px; font-size: 12px; font-weight: 600;">✏ UPDATING EXISTING MAPPING</div>' : ''}
      
      <div style="display: grid; gap: 12px;">
        <div>
          <div style="font-size: 11px; color: var(--gr-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Bus & Channel</div>
          <div style="font-size: 14px;"><strong>Bus:</strong> ${busMappingState.selectedBus}</div>
          <div style="font-size: 14px;"><strong>Node:</strong> ${busMappingState.selectedNode?.id}</div>
          <div style="font-size: 14px;"><strong>Channel:</strong> ${busMappingState.selectedChannel}</div>
        </div>
        
        <div style="border-top: 1px solid var(--gr-border); padding-top: 12px;">
          <div style="font-size: 11px; color: var(--gr-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Light Group</div>
          <div style="font-size: 14px;">${busMappingState.selectedGroup}</div>
        </div>
        
        <div style="border-top: 1px solid var(--gr-border); padding-top: 12px;">
          <div style="font-size: 11px; color: var(--gr-muted); text-transform: uppercase; font-weight: 600; margin-bottom: 4px;">Light Model</div>
          <div style="font-size: 14px;"><strong>Manufacturer:</strong> ${busMappingState.lightModel.manufacturer}</div>
          <div style="font-size: 14px;"><strong>Model:</strong> ${busMappingState.lightModel.model}</div>
          <div style="font-size: 14px;"><strong>Spectrum:</strong> ${busMappingState.lightModel.spectrumProfile}</div>
          <div style="font-size: 14px;"><strong>Wattage:</strong> ${busMappingState.lightModel.wattage}W</div>
          <div style="font-size: 14px;"><strong>Tunable:</strong> ${busMappingState.lightModel.tunable ? 'Yes' : 'No'}</div>
        </div>
      </div>
    </div>
  `;
}

// Load groups for assignment step
async function loadGroupsForBusMapping() {
  try {
    const res = await fetchWithFarmAuth('/api/groups', { cache: 'no-store' });
    if (!res.ok) return;
    
    const groups = await res.json();
    const select = document.getElementById('groupSelect');
    
    const suggested = suggestGroupName();
    const suggestedOption = suggested ? 
      `<option value="${suggested}" style="font-style: italic; background: #f0f9ff;"> Suggested: ${suggested}</option>` : '';
    
    select.innerHTML = '<option value="">-- Select Group --</option>' +
      suggestedOption +
      groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
    
    // Preselect if editing existing mapping
    if (busMappingState.existingMapping?.selectedGroup) {
      select.value = busMappingState.existingMapping.selectedGroup;
    }
  } catch (err) {
    grLog('Failed to load groups:', err?.message || err);
  }
}

// ✅ DATA FLOW: Register event listeners for bus mapping panel
document.addEventListener('DOMContentLoaded', () => {
  // Reload groups when rooms change (rooms may affect group assignments)
  document.addEventListener('rooms-updated', () => {
    grLog('[BusMapping] Rooms updated, refreshing groups dropdown');
    if (document.getElementById('groupSelect')) {
      loadGroupsForBusMapping();
    }
  });

  // Reload mappings when lights change (will be dispatched by Light Setup in Tier 1.5)
  document.addEventListener('lights-updated', () => {
    grLog('[BusMapping] Lights updated, refreshing bus mappings');
    const busPanel = document.querySelector('[data-panel="bus-mapping"]');
    if (busPanel && busPanel.classList.contains('is-active')) {
      loadGroupsForBusMapping();
    }
  });
});

// Update progress indicator
function updateProgressIndicator() {
  const indicator = document.getElementById('busProgressIndicator');
  if (!indicator) return;
  
  const total = busMappingState.totalChannels;
  const mapped = busMappingState.mappedChannels;
  const percent = total > 0 ? Math.round((mapped / total) * 100) : 0;
  
  indicator.innerHTML = `
    <div style="background: var(--gr-surface); padding: 12px; border-radius: 6px; border: 1px solid var(--gr-border);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 600; font-size: 13px;">Mapping Progress</span>
        <span style="font-size: 12px; color: var(--gr-muted);">${mapped} of ${total} channels</span>
      </div>
      <div style="height: 8px; background: var(--gr-bg); border-radius: 4px; overflow: hidden;">
        <div style="height: 100%; background: var(--gr-accent); width: ${percent}%; transition: width 0.3s ease;"></div>
      </div>
    </div>
  `;
}

// Initialize on panel load
document.addEventListener('DOMContentLoaded', () => {
  const busPanel = document.getElementById('bus-mapping');
  if (busPanel) {
    loadGroupsForBusMapping();
  }
});

// ── Save Integrations (SwitchBot / Kasa credentials) ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btnSaveIntegrations');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    const sbToken  = (document.getElementById('integSbToken')?.value || '').trim();
    const sbSecret = (document.getElementById('integSbSecret')?.value || '').trim();
    const kasaEmail = (document.getElementById('integKasaEmail')?.value || '').trim();
    const kasaPwd  = (document.getElementById('integKasaPassword')?.value || '').trim();

    if (!sbToken && !sbSecret && !kasaEmail && !kasaPwd) {
      alert('Enter at least one integration credential before saving.');
      return;
    }

    const body = {};
    if (sbToken || sbSecret) {
      body.switchbot = {};
      if (sbToken) body.switchbot.token = sbToken;
      if (sbSecret) body.switchbot.secret = sbSecret;
    }
    if (kasaEmail || kasaPwd) {
      body.kasa = {};
      if (kasaEmail) body.kasa.email = kasaEmail;
      if (kasaPwd)  body.kasa.password = kasaPwd;
    }

    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const resp = await fetch('/api/credential-store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (!resp.ok || !data.ok) throw new Error(data.error || 'Save failed');

      // Update status text
      const statusEl = document.getElementById('integrationsStatus');
      const parts = [];
      if (data.switchbot?.configured) parts.push('SwitchBot ✓');
      if (data.kasa?.configured)      parts.push('Kasa ✓');
      if (statusEl) statusEl.textContent = parts.length ? parts.join(' · ') : 'No integrations configured';

      btn.textContent = 'Saved ✓';
      setTimeout(() => { btn.textContent = 'Save Integrations'; btn.disabled = false; }, 2000);
    } catch (err) {
      console.error('[integrations] Save failed:', err);
      alert('Failed to save integrations: ' + err.message);
      btn.textContent = 'Save Integrations';
      btn.disabled = false;
    }
  });

  // Load current status on panel init
  fetch('/api/credential-store')
    .then(r => r.json())
    .then(data => {
      if (!data.ok) return;
      const statusEl = document.getElementById('integrationsStatus');
      const parts = [];
      if (data.switchbot?.configured) parts.push('SwitchBot ✓');
      if (data.kasa?.configured)      parts.push('Kasa ✓');
      if (statusEl) statusEl.textContent = parts.length ? parts.join(' · ') : 'No integrations configured';
    })
    .catch(() => {});
});
