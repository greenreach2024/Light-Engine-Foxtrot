// Helper: safely escape HTML to prevent XSS
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

function toNumberOrNull(val) {
  var n = Number(val);
  return isNaN(n) ? null : n;
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

// Schedule helper: compute cycle duration in minutes
function computeCycleDuration(on, off) {
  const start = toMinutes(on);
  const end = toMinutes(off);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  let diff = end - start;
  if (diff < 0) diff += 1440;
  if (diff < 0) diff = 0;
  if (diff > 1440) diff = 1440;
  if (start === end) {
    return 0; // Ambiguous case (either 0 h or 24 h). Treat as 0.
  }
  return diff;
}

// Schedule helper: build cycle segments for overlap calculation
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

// Schedule helper: validate schedule and compute totals
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

// Schedule helper: get daily ON time in hours
function getDailyOnHours(schedule) {
  if (!schedule || typeof schedule !== 'object') return 0;
  const { onTotal } = validateSchedule(schedule.mode, schedule.cycles);
  return Math.max(0, onTotal) / 60;
}

// Schedule helper: generate human-readable schedule summary
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

// Debounce utility to prevent cascading updates
function createDebounced(fn, delayMs = 300) {
  let timeoutId = null;
  let lastArgs = null;
  const debounced = function(...args) {
    lastArgs = args;
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      fn.apply(this, lastArgs);
      timeoutId = null;
    }, delayMs);
  };
  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };
  return debounced;
}

// Conditional logger for Groups V2 (enabled when gr.researchMode is true)
function g2debug() {
  try {
    const gr = window.gr || {};
    const enabled = gr.researchMode === true || localStorage.getItem('gr.researchMode') === 'true';
    if (!enabled) return;
    const args = Array.prototype.slice.call(arguments);
    args.unshift('[Groups V2]');
    // eslint-disable-next-line no-console
    console.log.apply(console, args);
  } catch (e) {
    // swallow
  }
}

let groupsV2DomReady = false;
const groupsV2PendingRefresh = {
  loadGroup: false,
  planSelectors: false,
  scheduleDropdown: false,
  unassignedLights: false,
};

function flushGroupsV2PendingRefresh() {
  if (!groupsV2DomReady) return;
  if (groupsV2PendingRefresh.loadGroup) {
    groupsV2PendingRefresh.loadGroup = false;
    try {
      requestGroupsV2LoadGroupRefresh();
    } catch (error) {
      console.warn('[Groups V2] Failed to refresh load group dropdown', error);
    }
  }
  if (groupsV2PendingRefresh.planSelectors) {
    groupsV2PendingRefresh.planSelectors = false;
    try {
      requestGroupsV2PlanRefresh();
    } catch (error) {
      console.warn('[Groups V2] Failed to refresh plan selectors', error);
    }
  }
  if (groupsV2PendingRefresh.scheduleDropdown) {
    groupsV2PendingRefresh.scheduleDropdown = false;
    try {
      requestGroupsV2ScheduleRefresh();
    } catch (error) {
      console.warn('[Groups V2] Failed to refresh schedule dropdown', error);
    }
  }
  if (groupsV2PendingRefresh.unassignedLights) {
    groupsV2PendingRefresh.unassignedLights = false;
    try {
      requestGroupsV2UnassignedLightsRefresh();
    } catch (error) {
      console.warn('[Groups V2] Failed to refresh unassigned lights dropdown', error);
    }
  }
}

function markGroupsV2DomReady() {
  if (groupsV2DomReady) return;
  groupsV2DomReady = true;
  flushGroupsV2PendingRefresh();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', markGroupsV2DomReady, { once: true });
} else {
  setTimeout(markGroupsV2DomReady, 0);
}

// Lightweight helpers used by Groups V2; define here if not already present on the page
if (typeof window.firstNonEmpty !== 'function') {
  window.firstNonEmpty = function firstNonEmpty() {
    for (let i = 0; i < arguments.length; i++) {
      const v = arguments[i];
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v.trim() === '') continue;
      return v;
    }
    return null;
  };
}

if (typeof window.readPhotoperiodHours !== 'function') {
  window.readPhotoperiodHours = function readPhotoperiodHours(v) {
    if (v == null) return null;
    if (typeof v === 'number' && isFinite(v)) return v;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return null;
      // Accept formats like "18", "18h", "18 H", "18/6", "12-12" (pick first number)
      const slash = s.match(/^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (slash) return Number(slash[1]);
      const dash = s.match(/^\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
      if (dash) return Number(dash[1]);
      const num = s.match(/\d+(?:\.\d+)?/);
      if (num) return Number(num[0]);
      return null;
    }
    return null;
  };
}

// Derive normalized runtime hints from a plan; tolerant to various shapes
if (typeof window.derivePlanRuntime !== 'function') {
  window.derivePlanRuntime = function derivePlanRuntime(plan) {
    const out = { lightDays: [], photoperiod: null, photoperiodHours: null, ppfd: null, dli: null, spectrum: null };
    if (!plan || typeof plan !== 'object') return out;
    // Check both plan.light.days (recipe format) and plan.days (flat format)
    const daysSrc = (plan.light && Array.isArray(plan.light.days)) ? plan.light.days 
                  : Array.isArray(plan.days) ? plan.days 
                  : [];
    const lightDays = daysSrc.map((row) => {
      const day = toNumberOrNull(row?.day ?? row?.d);
      const ppfd = toNumberOrNull(row?.ppfd);
      const dli = toNumberOrNull(row?.dli);
      const stage = typeof row?.stage === 'string' ? row.stage : '';
      const photoperiod = readPhotoperiodHours(row?.photoperiod);
      // Support either "mix" or flat cw/ww/bl/rd keys
      const mixRow = (row && typeof row === 'object' && row.mix && typeof row.mix === 'object') ? row.mix : row;
      
      // DEBUG: Log raw values before creating mix
      if (day <= 3) {
        console.log(`[derivePlanRuntime] Day ${day} RAW:`, {
          rawCw: mixRow?.cw,
          rawWw: mixRow?.ww,
          rawBl: mixRow?.bl,
          rawGn: mixRow?.gn,
          rawRd: mixRow?.rd,
          rawFr: mixRow?.fr
        });
      }
      
      const mix = {
        cw: toNumberOrNull(mixRow?.cw) ?? 0,
        ww: toNumberOrNull(mixRow?.ww) ?? 0,
        bl: toNumberOrNull(mixRow?.bl ?? mixRow?.blue) ?? 0,
        gn: toNumberOrNull(mixRow?.gn ?? mixRow?.green) ?? 0,
        rd: toNumberOrNull(mixRow?.rd ?? mixRow?.red) ?? 0,
        fr: toNumberOrNull(mixRow?.fr ?? mixRow?.far_red) ?? 0,
      };
      
      // DEBUG: Log created mix
      if (day <= 3) {
        console.log(`[derivePlanRuntime] Day ${day} CREATED MIX:`, mix);
      }
      
      return { day, ppfd, dli, stage, photoperiod, mix };
    }).filter(Boolean);
    out.lightDays = lightDays;
    // Compute defaults/summary
    const defaultPhotoperiod = readPhotoperiodHours(window.firstNonEmpty(plan.photoperiod, plan.defaults?.photoperiod));
    out.photoperiod = defaultPhotoperiod;
    out.photoperiodHours = defaultPhotoperiod;
    out.ppfd = toNumberOrNull(plan.ppfd);
    out.dli = toNumberOrNull(plan.dli);
    // Spectrum: prefer plan.spectrum; else average mix over defined days; else plan.light?.mix
    if (plan.spectrum && typeof plan.spectrum === 'object') out.spectrum = plan.spectrum;
    else if (lightDays.length) {
      let cw = 0, ww = 0, bl = 0, gn = 0, rd = 0, fr = 0, c = 0;
      lightDays.forEach((d) => { 
        cw += d.mix.cw || 0; 
        ww += d.mix.ww || 0; 
        bl += d.mix.bl || 0; 
        gn += d.mix.gn || 0; 
        rd += d.mix.rd || 0; 
        fr += d.mix.fr || 0; 
        c++; 
      });
      if (c > 0) out.spectrum = { 
        cw: cw / c, 
        ww: ww / c, 
        bl: bl / c, 
        gn: gn / c, 
        rd: rd / c, 
        fr: fr / c 
      };
    } else if (plan.light && plan.light.mix) {
      out.spectrum = {
        cw: toNumberOrNull(plan.light.mix.cw) ?? 0,
        ww: toNumberOrNull(plan.light.mix.ww) ?? 0,
        bl: toNumberOrNull(plan.light.mix.bl) ?? 0,
        gn: toNumberOrNull(plan.light.mix.gn) ?? 0,
        rd: toNumberOrNull(plan.light.mix.rd) ?? 0,
        fr: toNumberOrNull(plan.light.mix.fr) ?? 0,
      };
    }
    return out;
  };
}

// Convenience getters used by Plan Card
if (typeof window.getPlanPhotoperiodHours !== 'function') {
  window.getPlanPhotoperiodHours = function getPlanPhotoperiodHours(plan) {
    const derived = plan?._derived || derivePlanRuntime(plan);
    const fromPlan = readPhotoperiodHours(window.firstNonEmpty(plan?.photoperiod, plan?.defaults?.photoperiod));
    if (fromPlan != null) return fromPlan;
    // Try first defined photoperiod on day entries
    const d = (derived.lightDays || []).find((it) => it.photoperiod != null);
    return d ? d.photoperiod : (derived?.photoperiodHours ?? null);
  };
}

if (typeof window.getPlanPPFD !== 'function') {
  window.getPlanPPFD = function getPlanPPFD(plan) {
    // Use today’s target if available
    try {
      const dayNumber = (function() {
        const seedInput = document.getElementById('groupsV2SeedDate');
        const dpsInput = document.getElementById('groupsV2Dps');
        // Basic day calc mirroring getGroupsV2DayNumber
        if (dpsInput && !dpsInput.disabled) {
          const d = toNumberOrNull(dpsInput.value);
          if (d != null) return Math.max(0, Math.round(d));
        }
        const seed = (seedInput && seedInput.value) ? new Date(seedInput.value) : null;
        if (seed && isFinite(seed.getTime())) {
          seed.setHours(0,0,0,0);
          const now = new Date(); now.setHours(0,0,0,0);
          const diff = Math.floor((now.getTime() - seed.getTime()) / (24*60*60*1000));
          return diff < 0 ? 0 : diff + 1;
        }
        return 1;
      })();
      const t = resolvePlanTargetsForDay(plan, dayNumber);
      if (t && t.ppfd != null) return t.ppfd;
    } catch {}
    const derived = plan?._derived || derivePlanRuntime(plan);
    return toNumberOrNull(window.firstNonEmpty(plan?.ppfd, derived?.ppfd));
  };
}

if (typeof window.getPlanDli !== 'function') {
  window.getPlanDli = function getPlanDli(plan) {
    try {
      const dayNumber = 1;
      const t = resolvePlanTargetsForDay(plan, dayNumber);
      if (t && t.dli != null) return t.dli;
      // If DLI not explicitly set, compute from PPFD and photoperiod
      const ppfd = window.getPlanPPFD(plan);
      const hours = window.getPlanPhotoperiodHours(plan);
      if (ppfd != null && hours != null) {
        return (ppfd * 3600 * hours) / 1e6;
      }
    } catch {}
    const derived = plan?._derived || derivePlanRuntime(plan);
    return toNumberOrNull(window.firstNonEmpty(plan?.dli, derived?.dli));
  };
}

if (typeof window.formatPlanPhotoperiodDisplay !== 'function') {
  window.formatPlanPhotoperiodDisplay = function formatPlanPhotoperiodDisplay(v) {
    if (v == null) return '—';
    const hours = readPhotoperiodHours(v);
    return (hours != null && isFinite(hours)) ? `${hours} h` : String(v);
  };
}

window.addEventListener('lightSetupsChanged', () => {
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  const setups = Array.isArray(window.STATE.lightSetups) ? window.STATE.lightSetups : [];

  const existingIds = new Set(window.STATE.lights.map(l => String(l.id)));

  setups.forEach(setup => {
    (setup.fixtures || []).forEach(fixture => {
      const count = Math.max(1, Number(fixture.count || 1));
      const baseId = String(fixture.serial || fixture.id || `${fixture.vendor||'Light'}-${fixture.model||'Fixture'}`);
      const baseName = String(fixture.name || `${fixture.vendor||'Light'} ${fixture.model||'Fixture'}`);

      for (let i = 1; i <= count; i++) {
        // Create unique identifier per unit if multiple or if ID collision exists
        let candidateId = count > 1 ? `${baseId}#${i}` : baseId;
        let suffix = i;
        while (existingIds.has(String(candidateId))) {
          suffix += 1;
          candidateId = `${baseId}#${suffix}`;
        }
        // Track the new ID to avoid duplicates in this pass
        existingIds.add(String(candidateId));

        // Push a normalized light entry into STATE.lights
        window.STATE.lights.push({
          ...fixture,
          id: candidateId,
          name: baseName,
          serial: fixture.serial || candidateId,
          roomId: setup.room,
          zoneId: null, // Unassigned by default
          groupId: null,
          groupLabel: null,
          source: fixture.source || 'setup',
          fromSetup: true
        });
      }
    });
  });
  document.dispatchEvent(new Event('lights-updated'));
});

// Load zones dynamically from room mapper
async function loadZonesFromRoomMapper() {
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  if (!zoneSelect) return;

  try {
    // Load room map data
    const response = await fetch('/data/room-map.json');
    if (!response.ok) {
      console.warn('[Groups V2] No room map data available, using default zones');
      populateDefaultZones(zoneSelect);
      return;
    }

    const roomMap = await response.json();
    const zones = roomMap.zones || [];

    if (zones.length === 0) {
      console.warn('[Groups V2] No zones found in room mapper');
      populateDefaultZones(zoneSelect);
      return;
    }

    // Clear and populate with mapped zones
    zoneSelect.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    zoneSelect.appendChild(noneOpt);

    // Add each zone from room mapper
    zones.forEach(zone => {
      const opt = document.createElement('option');
      opt.value = String(zone.zone);
      opt.textContent = zone.name || `Zone ${zone.zone}`;
      zoneSelect.appendChild(opt);
    });

    console.log(`[Groups V2] Loaded ${zones.length} zones from room mapper`);
  } catch (error) {
    console.error('[Groups V2] Failed to load zones from room mapper:', error);
    populateDefaultZones(zoneSelect);
  }
}

// Fallback to default zones if room mapper not available
function populateDefaultZones(zoneSelect) {
  zoneSelect.innerHTML = '';
  const noneOpt = document.createElement('option');
  noneOpt.value = '';
  noneOpt.textContent = '(none)';
  zoneSelect.appendChild(noneOpt);
  
  for (let i = 1; i <= 9; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Zone ${i}`;
    zoneSelect.appendChild(opt);
  }
}

// Expose globally for use by room mapper and other tools
window.refreshGroupsV2Zones = loadZonesFromRoomMapper;

document.addEventListener('DOMContentLoaded', () => {
  // Populate the Zones dropdown from room mapper
  loadZonesFromRoomMapper();
  
  // Wire up Apply to Current Plan button
  const applyPlanBtn = document.getElementById('applyPlanToGroupBtn');
  if (applyPlanBtn) {
    applyPlanBtn.addEventListener('click', () => {
      const planSelect = document.getElementById('groupsV2PlanSelect');
      const planId = groupsV2FormState.planId || (planSelect && planSelect.value);
      if (!planId) {
        alert('Select a plan to apply.');
        return;
      }
      const plans = getGroupsV2Plans();
      const plan = plans.find((p) => (p.id || p.name) === planId);
      if (!plan) {
        alert('Plan not found.');
        return;
      }
      const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
      if (!groups.length) {
        alert('No group to apply plan to.');
        return;
      }
      const group = groups[groups.length - 1];
      const targetPlanId = plan.id || plan.name || planId;
      group.plan = targetPlanId ? String(targetPlanId) : '';
      const config = buildGroupsV2PlanConfig(plan);
      if (config) group.planConfig = config;
      else delete group.planConfig;
      groupsV2FormState.planId = group.plan;
      document.dispatchEvent(new Event('groups-updated'));
      updateGroupsV2Preview();
      if (typeof showToast === 'function') {
        const preview = computeGroupsV2PreviewData(plan);
        const summary = preview && preview.stage
          ? `Today: ${preview.stage} • ${Number.isFinite(preview.ppfd) ? `${Math.round(preview.ppfd)} µmol` : 'PPFD —'}`
          : 'Plan applied to current group.';
        showToast({ title: 'Plan Applied', msg: summary, kind: 'success', icon: '' });
      }
    });
  }
  const assignBtn = document.getElementById('assignLightsToGroupBtn');
  if (assignBtn) {
    assignBtn.addEventListener('click', () => {
      if (assignBtn.disabled) return;
      const select = document.getElementById('groupsV2UnassignedLightsSelect');
      const controllerSelect = document.getElementById('groupsV2AssignController');
      if (!select) return;
      // Single-select mode: only one light can be assigned at a time
      const selectedValue = select.value;
      const selectedController = controllerSelect ? controllerSelect.value : '';
      g2debug('assign clicked', { selectedValue, selectedController });
      if (!selectedValue) {
        alert('Select a light to assign.');
        return;
      }
      const selectedIds = [selectedValue];
      const group = getGroupsV2ActiveGroup();
      if (!group) {
        alert('Load or create a group before assigning lights.');
        return;
      }
      if (!Array.isArray(group.lights)) group.lights = [];
      const groupId = group.id || formatGroupsV2GroupLabel(group) || '';
      const groupLabel = formatGroupsV2GroupLabel(group) || groupId || 'current group';
      const selectedSet = new Set(selectedIds.map((value) => String(value)));
      const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
      
      // Find controller details if one was selected
      let controllerDetails = null;
      if (selectedController) {
        controllerDetails = lightsDb.find((light) => 
          String(light?.id) === String(selectedController) || 
          String(light?.serial) === String(selectedController) ||
          String(light?.deviceId) === String(selectedController) ||
          String(light?.name) === String(selectedController)
        );
      }
      if (window.STATE && Array.isArray(window.STATE.groups)) {
        window.STATE.groups.forEach((entry) => {
          if (!entry || entry === group || !Array.isArray(entry.lights)) return;
          entry.lights = entry.lights.filter((ref) => {
            // CRITICAL: Use same identifier priority order as dropdown (line 1067)
            // Priority: id → serial → deviceId → name
            const refId = typeof ref === 'string'
              ? ref
              : (ref && (ref.id || ref.serial || ref.deviceId || ref.lightId || ref.name));
            return refId == null || !selectedSet.has(String(refId));
          });
        });
      }
      selectedIds.forEach((id) => {
        const existing = group.lights.find((ref) => {
          if (!ref) return false;
          if (typeof ref === 'string') return String(ref) === String(id);
          // CRITICAL: Use same identifier priority order as dropdown (line 1067)
          // Priority: id → serial → deviceId → name
          const refId = ref.id || ref.serial || ref.deviceId || ref.lightId || ref.name;
          return String(refId) === String(id);
        });
        // Match against all possible identifier fields in same priority order
        const source = lightsDb.find((light) => 
          String(light?.id) === String(id) || 
          String(light?.serial) === String(id) ||
          String(light?.deviceId) === String(id) ||
          String(light?.name) === String(id)
        ) || null;
        if (!existing) {
          if (source) {
            const payload = {
              id: source.id || id,
              name: source.name || source.label,
              vendor: source.manufacturer || source.vendor,
              // Preserve tunability properties (critical for spectrum control)
              dynamicSpectrum: source.dynamicSpectrum,
              tunable: source.tunable,
              spectrally_tunable: source.spectrally_tunable,
              // Preserve light performance data
              ppf: source.ppf,
              ppfd: source.ppfd,
              spectrum: source.spectrum,
              spectra: source.spectra,
              // Preserve control/communication metadata
              control: source.control,
              transport: source.transport,
              protocol: source.protocol,
              spectrumMode: source.spectrumMode,
              // Preserve controller/device identification (CRITICAL for individual control)
              controllerId: source.controllerId,
              deviceId: source.deviceId,
              controllerIp: source.controllerIp,
              controllerPort: source.controllerPort,
              ipAddress: source.ipAddress,
              ip: source.ip,
            };
            
            // Add controller information if a controller was selected
            if (controllerDetails) {
              payload.assignedController = {
                id: controllerDetails.id || controllerDetails.deviceId,
                name: controllerDetails.name,
                protocol: controllerDetails.protocol,
                ip: controllerDetails.ip || controllerDetails.ipAddress,
                port: controllerDetails.port,
                deviceType: controllerDetails.deviceType,
                isPlug: controllerDetails.isPlug
              };
              // Also set controllerId for backward compatibility
              if (!payload.controllerId) {
                payload.controllerId = controllerDetails.id || controllerDetails.deviceId;
              }
              if (!payload.controllerIp && controllerDetails.ip) {
                payload.controllerIp = controllerDetails.ip;
              }
              if (!payload.controllerPort && controllerDetails.port) {
                payload.controllerPort = controllerDetails.port;
              }
            }
            
            group.lights.push(payload);
          } else {
            const payload = { id };
            // Add controller info even if source light not found
            if (controllerDetails) {
              payload.assignedController = {
                id: controllerDetails.id || controllerDetails.deviceId,
                name: controllerDetails.name,
                protocol: controllerDetails.protocol,
                ip: controllerDetails.ip || controllerDetails.ipAddress,
                port: controllerDetails.port,
                deviceType: controllerDetails.deviceType,
                isPlug: controllerDetails.isPlug
              };
              payload.controllerId = controllerDetails.id || controllerDetails.deviceId;
            }
            group.lights.push(payload);
          }
        }
        if (source) {
          if (group.zone) source.zoneId = group.zone;
          source.groupId = groupId || groupLabel;
          source.groupLabel = groupLabel;
        }
      });
      g2debug('assigned lights to group', { group: groupId || groupLabel, addedCount: selectedIds.length, newGroupLightCount: Array.isArray(group.lights) ? group.lights.length : 0 });
      populateGroupsV2UnassignedLightsDropdown();
      g2debug('dispatching events after assign');
      document.dispatchEvent(new Event('groups-updated'));
      document.dispatchEvent(new Event('lights-updated'));
      if (typeof window.saveLights === 'function') {
        window.saveLights();
      }
      // Refresh the assigned lights card to show newly assigned lights
      const plan = getGroupsV2SelectedPlan();
      if (typeof renderGroupsV2LightCard === 'function') {
        g2debug('rendering light card after assign');
        renderGroupsV2LightCard(plan);
      }
      if (typeof showToast === 'function') {
        const controllerMsg = controllerDetails 
          ? ` via ${controllerDetails.name || 'controller'}` 
          : '';
        showToast({ title: 'Light Assigned', msg: `Light added to ${groupLabel}${controllerMsg}.`, kind: 'success' });
      }
      
      // Reset controller selection after assignment
      if (controllerSelect) {
        controllerSelect.value = '';
      }
    });
  }

  // Save Light Assignments Button
  const saveLightAssignmentsBtn = document.getElementById('groupsV2SaveLightAssignments');
  if (saveLightAssignmentsBtn) {
    saveLightAssignmentsBtn.addEventListener('click', async () => {
      const group = getGroupsV2ActiveGroup();
      if (!group) {
        if (typeof showToast === 'function') {
          showToast({ title: 'No Group Selected', msg: 'Please select a group to save light assignments.', kind: 'error' });
        }
        return;
      }
      
      try {
        // Save the group with current light assignments
        await saveGroupsV2Group('draft');
        
        // Also persist lights to ensure groupId/zoneId are saved
        if (typeof window.saveLights === 'function') {
          await window.saveLights();
        }
        
        if (typeof showToast === 'function') {
          const groupLabel = formatGroupsV2GroupLabel(group) || 'Group';
          showToast({ 
            title: 'Assignments Saved', 
            msg: `Light assignments for ${groupLabel} have been saved.`, 
            kind: 'success',
            icon: '💾'
          });
        }
      } catch (error) {
        console.error('[Groups V2] Failed to save light assignments:', error);
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Save Failed', 
            msg: 'Failed to save light assignments. Please try again.', 
            kind: 'error' 
          });
        }
      }
    });
  }

  // Test Group Lights Button
  const testGroupLightsBtn = document.getElementById('groupsV2TestGroupLights');
  const testingIndicator = document.getElementById('groupsV2TestingIndicator');
  if (testGroupLightsBtn) {
    testGroupLightsBtn.addEventListener('click', async () => {
      const group = getGroupsV2ActiveGroup();
      if (!group) {
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'No Group Selected', 
            msg: 'Please select a group to test.', 
            kind: 'error' 
          });
        }
        return;
      }

      if (!group.lights || group.lights.length === 0) {
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'No Lights Assigned', 
            msg: 'Please assign lights to the group before testing.', 
            kind: 'error' 
          });
        }
        return;
      }

      try {
        // Disable button during test
        testGroupLightsBtn.disabled = true;
        testGroupLightsBtn.textContent = '⏳ Testing...';

        // Show testing indicator
        if (testingIndicator) {
          testingIndicator.style.display = 'flex';
        }

        const groupLabel = formatGroupsV2GroupLabel(group) || 'Group';
        const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
        
        let successCount = 0;
        let errorCount = 0;
        const results = [];

        // Test each light by sending a simple status query or brief blink
        for (const lightRef of group.lights) {
          // If lightRef is a full object with protocol/controllerId, use it directly
          // Otherwise try to look it up in STATE.lights database
          let light = null;
          let lightId = null;
          
          if (typeof lightRef === 'object' && lightRef !== null) {
            // lightRef is an object - use it if it has protocol info
            if (lightRef.protocol || lightRef.controllerId) {
              light = lightRef;
              lightId = lightRef.id || lightRef.lightId || lightRef.deviceId || lightRef.serial;
            } else {
              // Object but missing key fields - try to look it up
              lightId = lightRef.id || lightRef.lightId || lightRef.deviceId || lightRef.serial;
            }
          } else {
            // lightRef is a string ID
            lightId = lightRef;
          }
          
          // If we don't have a light object yet, try to find it in STATE.lights
          if (!light && lightId) {
            light = lightsDb.find(l => 
              String(l?.id) === String(lightId) || 
              String(l?.serial) === String(lightId)
            );
          }

          if (!light) {
            console.warn(`[Groups V2 Test] Light ${lightId} not found - no protocol data available`);
            errorCount++;
            results.push({ id: lightId, status: 'not found', error: 'Light data not available' });
            continue;
          }

          const lightName = light.name || light.label || lightId || 'Unknown Light';

          try {
            // Test based on protocol
            if (light.protocol === 'grow3' || light.vendor === 'Grow3') {
              // Test Grow3 by querying status via proxy endpoint
              const controllerId = light.controllerId || light.deviceId;
              
              console.log(`[Groups V2 Test] Testing GROW3 light: ${lightName}, controllerId: ${controllerId}, lightId: ${lightId}`);
              
              // Check controller health by querying devices endpoint
              // Note: Grow3 controller doesn't have /healthz, so we use /api/devicedatas as health check
              const devicesResponse = await fetch('/api/grow3/api/devicedatas', {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
              });
              
              if (devicesResponse.ok) {
                const devicesData = await devicesResponse.json();
                const devices = devicesData.data || devicesData;
                const deviceExists = Array.isArray(devices) && devices.some(d => String(d.id) === String(controllerId));
                
                if (deviceExists) {
                  // Device found - make it blink!
                  try {
                    console.log(`[Groups V2 Test] Starting blink sequence for ${lightName} (controllerId: ${controllerId})`);
                    
                    // Blink sequence: Off → On → Off → On
                    // Turn off
                    await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'off' }),
                      signal: AbortSignal.timeout(3000)
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                    
                    // Turn on with current spectrum
                    const spectrum = light.spectrum || { cw: 25, ww: 25, bl: 25, rd: 25 };
                    const channels = [
                      Math.round(spectrum.cw || 25),
                      Math.round(spectrum.ww || 25),
                      Math.round(spectrum.bl || 25),
                      Math.round(spectrum.rd || 25)
                    ];
                    
                    // Encode channels to HEX12 format (Grow3 00–40 range; last 2 bytes unused)
                    const encodeChannels = (channels) => {
                      const converter = typeof percentToDriverByte === 'function'
                        ? percentToDriverByte
                        : (v) => {
                          const pct = Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
                          // Fallback assumes 0-64 scale
                          return Math.round((pct / 100) * 64);
                        };
                      const hex4 = channels
                        .map((v) => converter(v).toString(16).padStart(2, '0'))
                        .join('')
                        .toUpperCase();
                      return hex4 + '0000'; // [CW][WW][BL][RD][00][00]
                    };

                    const hexValue = encodeChannels(channels);
                    
                    await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'on', value: hexValue }),
                      signal: AbortSignal.timeout(3000)
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                    
                    // Turn off again
                    await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ status: 'off' }),
                      signal: AbortSignal.timeout(3000)
                    });
                    
                    await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms

                    // Restore original device state if known; otherwise turn back on briefly
                    try {
                      // Best-effort lookup from devices list fetched earlier
                      const original = Array.isArray(devices)
                        ? devices.find(d => String(d.id) === String(controllerId))
                        : null;
                      const originalStatus = original?.status || null;
                      const originalValue = original?.value || null;

                      if (originalStatus === 'off') {
                        await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'off', value: null }),
                          signal: AbortSignal.timeout(3000)
                        });
                      } else if (originalStatus === 'on') {
                        await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'on', value: typeof originalValue === 'string' ? originalValue : hexValue }),
                          signal: AbortSignal.timeout(3000)
                        });
                      } else {
                        // Unknown original state: default to a final ON so it’s visible
                        await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ status: 'on', value: hexValue }),
                          signal: AbortSignal.timeout(3000)
                        });
                      }
                    } catch (restoreErr) {
                      // Fallback: turn back on with test value
                      await fetch(`/api/grow3/api/devicedatas/device/${controllerId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ status: 'on', value: hexValue }),
                        signal: AbortSignal.timeout(3000)
                      });
                    }
                    
                    successCount++;
                    results.push({ id: lightId, name: lightName, status: 'online', protocol: 'grow3', blinked: true });
                  } catch (blinkError) {
                    console.warn(`[Groups V2 Test] Blink failed for ${lightName}, but device exists:`, blinkError);
                    successCount++;
                    results.push({ id: lightId, name: lightName, status: 'online', protocol: 'grow3', blinked: false });
                  }
                } else {
                  errorCount++;
                  results.push({ id: lightId, name: lightName, status: 'not found', error: `Device ${controllerId} not found on controller` });
                }
              } else {
                errorCount++;
                results.push({ id: lightId, name: lightName, status: 'offline', error: 'Cannot query devices' });
              }
            } else if (light.protocol === 'kasa') {
              // Test Kasa by blinking the device
              const ipAddress = light.ipAddress || light.ip;
              if (!ipAddress) {
                throw new Error('No IP address for Kasa device');
              }

              // First check if device responds
              const infoResponse = await fetch('/api/kasa/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ipAddress }),
                signal: AbortSignal.timeout(5000)
              });

              if (infoResponse.ok) {
                // Device is online - make it blink!
                try {
                  // Blink sequence: Off → On → Off → On
                  // Turn off
                  await fetch(`/api/kasa/device/${ipAddress}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: 'off' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn on
                  await fetch(`/api/kasa/device/${ipAddress}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: 'on' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn off again
                  await fetch(`/api/kasa/device/${ipAddress}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: 'off' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn back on
                  await fetch(`/api/kasa/device/${ipAddress}/power`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ state: 'on' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  const data = await infoResponse.json();
                  successCount++;
                  results.push({ id: lightId, name: lightName, status: 'online', protocol: 'kasa', info: data, blinked: true });
                } catch (blinkError) {
                  console.warn(`[Groups V2 Test] Blink failed for ${lightName}, but device is online:`, blinkError);
                  const data = await infoResponse.json();
                  successCount++;
                  results.push({ id: lightId, name: lightName, status: 'online', protocol: 'kasa', info: data, blinked: false });
                }
              } else {
                errorCount++;
                results.push({ id: lightId, name: lightName, status: 'offline', error: 'Device not responding' });
              }
            } else if (light.protocol === 'switchbot') {
              // Test SwitchBot by checking device status and blinking
              const deviceId = light.deviceId;
              if (!deviceId || deviceId.includes('|')) {
                throw new Error('Invalid SwitchBot device ID');
              }

              const statusResponse = await fetch(`/api/switchbot/status/${deviceId}`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
              });

              if (statusResponse.ok) {
                const data = await statusResponse.json();
                
                // Device is online - make it blink!
                try {
                  // Blink sequence: Off → On → Off → On
                  // Turn off
                  await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'turnOff' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn on
                  await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'turnOn' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn off again
                  await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'turnOff' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  await new Promise(resolve => setTimeout(resolve, 300)); // Wait 300ms
                  
                  // Turn back on
                  await fetch(`/api/switchbot/devices/${deviceId}/commands`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: 'turnOn' }),
                    signal: AbortSignal.timeout(3000)
                  });
                  
                  successCount++;
                  results.push({ id: lightId, name: lightName, status: 'online', protocol: 'switchbot', info: data, blinked: true });
                } catch (blinkError) {
                  console.warn(`[Groups V2 Test] Blink failed for ${lightName}, but device is online:`, blinkError);
                  successCount++;
                  results.push({ id: lightId, name: lightName, status: 'online', protocol: 'switchbot', info: data, blinked: false });
                }
              } else {
                errorCount++;
                results.push({ id: lightId, name: lightName, status: 'offline', error: 'Device not responding' });
              }
            } else {
              // Unknown protocol
              errorCount++;
              results.push({ id: lightId, name: lightName, status: 'unsupported', error: `Protocol ${light.protocol} not supported for testing` });
            }
          } catch (error) {
            console.error(`[Groups V2 Test] Failed to test light ${lightName}:`, error);
            errorCount++;
            results.push({ id: lightId, name: lightName, status: 'error', error: error.message });
          }
        }

        // Hide testing indicator
        if (testingIndicator) {
          setTimeout(() => {
            testingIndicator.style.display = 'none';
          }, 3000);
        }

        // Log detailed results
        console.log('[Groups V2 Test] Results:', results);

        // Show result toast
        if (typeof showToast === 'function') {
          if (errorCount === 0) {
            showToast({ 
              title: 'All Lights Online ✨', 
              msg: ` All ${successCount} light(s) in ${groupLabel} blinked successfully!`, 
              kind: 'success',
              icon: '🔦'
            }, 3000);
          } else if (successCount === 0) {
            showToast({ 
              title: 'All Lights Offline', 
              msg: ` None of the ${errorCount} light(s) in ${groupLabel} are responding. Check connections and power.`, 
              kind: 'error',
              icon: ''
            }, 4000);
          } else {
            showToast({ 
              title: 'Mixed Results', 
              msg: `${successCount} online, ${errorCount} offline. Check console for details.`, 
              kind: 'warning',
              icon: ''
            }, 4000);
          }
        }

      } catch (error) {
        console.error('[Groups V2] Failed to test group lights:', error);
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Test Failed', 
            msg: `Failed to test lights: ${error.message}`, 
            kind: 'error' 
          });
        }
      } finally {
        // Re-enable button
        testGroupLightsBtn.disabled = false;
        testGroupLightsBtn.textContent = '🔦 Test Group Lights';
        
        // Hide testing indicator if still visible
        if (testingIndicator) {
          setTimeout(() => {
            testingIndicator.style.display = 'none';
          }, 3000);
        }
      }
    });
  }

  // Run Group Button
  const runGroupBtn = document.getElementById('groupsV2RunGroup');
  const runningIndicator = document.getElementById('groupsV2RunningIndicator');
  if (runGroupBtn) {
    runGroupBtn.addEventListener('click', async () => {
      try {
        // Disable button during execution
        runGroupBtn.disabled = true;
        runGroupBtn.textContent = '⏳ Saving & Running...';

        // FIRST: Save all current settings as deployed
        console.log('[Groups V2] Run clicked - saving all settings first...');
        const savedGroup = await saveGroupsV2Group('deployed');
        
        if (!savedGroup) {
          console.error('[Groups V2] Failed to save group before running');
          if (typeof showToast === 'function') {
            showToast({ 
              title: 'Save Failed', 
              msg: 'Could not save group settings. Please check the form and try again.', 
              kind: 'error',
              icon: ''
            });
          }
          return;
        }

        console.log('[Groups V2] Group saved successfully, now executing...');

        // Get the saved group (refreshed from STATE)
        const group = getGroupsV2ActiveGroup();
        if (!group) {
          if (typeof showToast === 'function') {
            showToast({ title: 'No Group Selected', msg: 'Please select a group to run.', kind: 'error' });
          }
          return;
        }

        if (!group.lights || group.lights.length === 0) {
          if (typeof showToast === 'function') {
            showToast({ 
              title: 'No Lights Assigned', 
              msg: 'Please assign lights to the group before running.', 
              kind: 'error' 
            });
          }
          return;
        }

        if (!group.plan) {
          if (typeof showToast === 'function') {
            showToast({ 
              title: 'No Plan Selected', 
              msg: 'Please select a plan before running the group.', 
              kind: 'error' 
            });
          }
          return;
        }

        // SECOND: Execute the group by applying the plan to all assigned lights
        runGroupBtn.textContent = '⏳ Running...';
        
        const plan = (window.STATE?.plans || []).find(p => p.id === group.plan);
        if (!plan) {
          throw new Error('Plan not found');
        }

        const groupLabel = formatGroupsV2GroupLabel(group) || 'Group';
        let successCount = 0;
        let errorCount = 0;

        // Apply spectrum to each assigned light
        for (const lightRef of group.lights) {
          try {
            const lightId = typeof lightRef === 'string' ? lightRef : (lightRef.id || lightRef.serial || lightRef.deviceId || lightRef.name);
            const light = (window.STATE?.lights || []).find(l => 
              l.id === lightId || l.serial === lightId || l.deviceId === lightId || l.name === lightId
            );

            if (!light) {
              console.warn(`[Groups V2] Light not found: ${lightId}`);
              errorCount++;
              continue;
            }

            // Get current spectrum from plan
            const spectrum = plan.spectrum || {};
            
            // Apply based on protocol
            if (light.protocol === 'grow3' || light.vendor === 'Grow3') {
              // Apply to Grow3 controller
              if (typeof window.sendGrow3SpectrumCommand === 'function') {
                await window.sendGrow3SpectrumCommand(spectrum);
                successCount++;
              }
            } else if (light.protocol === 'kasa') {
              // Turn on Kasa plug
              const response = await fetch(`/api/kasa/control`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ipAddress: light.ipAddress || light.ip, command: 'on' })
              });
              if (response.ok) successCount++;
              else errorCount++;
            } else if (light.protocol === 'switchbot') {
              // Turn on SwitchBot device
              const deviceId = light.deviceId || lightId;
              const response = await fetch(`/api/switchbot/command`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deviceId, command: 'turnOn' })
              });
              if (response.ok) successCount++;
              else errorCount++;
            } else {
              console.warn(`[Groups V2] Unsupported protocol for light: ${lightId}`);
              errorCount++;
            }
          } catch (error) {
            console.error(`[Groups V2] Failed to control light:`, error);
            errorCount++;
          }
        }

        // Show running indicator
        if (runningIndicator) {
          runningIndicator.style.display = 'flex';
          // Hide after 5 seconds
          setTimeout(() => {
            runningIndicator.style.display = 'none';
          }, 5000);
        }

        // Show result toast
        if (typeof showToast === 'function') {
          if (errorCount === 0) {
            showToast({ 
              title: 'Group Saved & Running', 
              msg: `${groupLabel} settings saved and deployed with ${successCount} light(s).`, 
              kind: 'success',
              icon: ''
            });
          } else {
            showToast({ 
              title: 'Group Saved, Partially Running', 
              msg: `Settings saved. ${successCount} light(s) activated, ${errorCount} failed.`, 
              kind: 'warning',
              icon: ''
            });
          }
        }

      } catch (error) {
        console.error('[Groups V2] Failed to run group:', error);
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Run Failed', 
            msg: `Failed to run group: ${error.message}`, 
            kind: 'error' 
          });
        }
      } finally {
        // Re-enable button
        runGroupBtn.disabled = false;
        runGroupBtn.textContent = '▶ Run Group';
      }
    });
  }
});
// Light spec for TopLight MH Model-300W-22G12
const TOPLIGHT_MH_300W_SPEC = {
  watts: 300,
  ppf: 709,
  ppe: 2.59,
  powerInput: '100~277VAC 50/60Hz',
  colorRange: '400-700',
  uv: 'NO',
  farRed: 'NO',
  spectrumBooster: 'BLUE',
  factoryDefaultRatio: '0.68:1',
  bestRatioRange: '0.68:1~2:1',
  dimming: 'YES',
  controlBox: 'YES',
  app: 'YES',
  bluetooth: 'YES',
  wifi: 'YES',
  lynx3: 'YES',
  smartune: 'YES',
  cooling: 'PASSIVE, FANLESS COOLING',
  dimensions: '1240mm x 140mm x 76 mm (48.4\" x 5.5\" x 3.0\")',
  weight: '6.35 kg (14 lbs)',
  ipRating: 'IP66',
};

function renderLightInfoCard(light) {
  if (!light) return '';
  // Try to find the full light object from STATE.lights by id or serial
  const db = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
  const dbLight = db.find(l => l.id === light.id || l.serial === light.serial) || light;
  
  // Highlight tunable/static status at the top
  let html = '';
  
  // Check for tunability in multiple field formats:
  // - dynamicSpectrum (boolean): legacy field
  // - spectrally_tunable (string "Yes"/"No"): lights-catalog.json field
  // - tunable (boolean): some light objects use this
  let isDynamic = false;
  let isStatic = false;
  let tunableUnknown = true;
  
  if (typeof dbLight.dynamicSpectrum === 'boolean') {
    // Legacy boolean field
    isDynamic = dbLight.dynamicSpectrum === true;
    isStatic = dbLight.dynamicSpectrum === false;
    tunableUnknown = false;
  } else if (dbLight.spectrally_tunable) {
    // lights-catalog.json field (string "Yes" or "No")
    const spectrallyTunable = String(dbLight.spectrally_tunable).toLowerCase();
    isDynamic = spectrallyTunable === 'yes' || spectrallyTunable === 'true';
    isStatic = spectrallyTunable === 'no' || spectrallyTunable === 'false';
    tunableUnknown = false;
  } else if (typeof dbLight.tunable === 'boolean') {
    // Some lights use 'tunable' field
    isDynamic = dbLight.tunable === true;
    isStatic = dbLight.tunable === false;
    tunableUnknown = false;
  }
  
  if (isDynamic) {
    html += '<div style="padding: 8px; margin-bottom: 10px; background: #dbeafe; border: 2px solid #3b82f6; border-radius: 6px;">';
    html += '<div style="font-weight: 700; color: #1e40af; margin-bottom: 4px;"> TUNABLE SPECTRUM</div>';
    html += '<div style="font-size: 0.75rem; color: #1e3a8a; line-height: 1.3;">This fixture can dynamically adjust its spectrum to match grow recipes.</div>';
    html += '</div>';
  } else if (isStatic) {
    html += '<div style="padding: 8px; margin-bottom: 10px; background: #fef3c7; border: 2px solid #f59e0b; border-radius: 6px;">';
    html += '<div style="font-weight: 700; color: #92400e; margin-bottom: 4px;"> STATIC SPECTRUM</div>';
    html += '<div style="font-size: 0.75rem; color: #78350f; line-height: 1.3;">This fixture has a factory-set spectrum and supports dimming only. Spectrum cannot be adjusted to match recipes.</div>';
    html += '</div>';
  } else if (tunableUnknown) {
    html += '<div style="padding: 8px; margin-bottom: 10px; background: #f3f4f6; border: 2px solid #9ca3af; border-radius: 6px;">';
    html += '<div style="font-weight: 700; color: #374151; margin-bottom: 4px;">? SPECTRUM CAPABILITY UNKNOWN</div>';
    html += '<div style="font-size: 0.75rem; color: #4b5563; line-height: 1.3;">Spectrum tunability not specified in database.</div>';
    html += '</div>';
  }
  
  // Show all available fields
  Object.entries(dbLight).forEach(([key, value]) => {
    if (typeof value === 'object' && value !== null) return;
    // Skip tunability fields since we already highlighted them above
    if (key === 'dynamicSpectrum' || key === 'spectrally_tunable' || key === 'tunable') return;
    html += `<div><strong>${key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}:</strong> ${value ?? ''}</div>`;
  });
  
  // Add spectrum visualization if spectrum data is available
  if (dbLight.spectrum || dbLight.spectra) {
    const spectrum = dbLight.spectrum || dbLight.spectra;
    
    // Add spectrograph canvas
    html += '<div style="margin-top:10px;"><canvas id="lightInfoSpectrumCanvas" width="300" height="60" style="border-radius:6px; background:#f8fafc; box-shadow:0 1px 4px #0001;"></canvas></div>';
    
    // Add numerical spectrum breakdown
    if (typeof spectrum === 'object') {
      const channelLabels = {
        cw: 'Cool White',
        ww: 'Warm White',
        bl: 'Blue (450nm)',
        rd: 'Red (660nm)',
        fr: 'Far Red (730nm)'
      };
      
      html += '<div style="margin-top:10px; padding:10px; background:rgba(59,130,246,0.1); border-radius:6px;">';
      html += '<div style="font-weight:600; margin-bottom:6px; color:#60a5fa;">Spectrum Breakdown</div>';
      html += '<div style="display:grid; grid-template-columns:auto 1fr; gap:4px 10px; font-size:0.875rem;">';
      
      Object.entries(spectrum).forEach(([key, value]) => {
        if (typeof value === 'number' || !isNaN(Number(value))) {
          const label = channelLabels[key.toLowerCase()] || key.toUpperCase();
          const numValue = Number(value);
          const percentage = numValue > 0 ? numValue.toFixed(1) + '%' : '0%';
          html += `<div style="color:#94a3b8;">${label}:</div><div style="color:#e2e8f0; font-weight:500;">${percentage}</div>`;
        }
      });
      
      html += '</div></div>';
    }
    
    // Render the canvas after DOM update
    setTimeout(() => {
      const canvas = document.getElementById('lightInfoSpectrumCanvas');
      if (!canvas) return;
      
      // Check if rendering functions are available
      const hasRenderFunc = typeof renderSpectrumCanvas === 'function';
      const hasComputeFunc = typeof computeWeightedSPD === 'function';
      
      if (hasRenderFunc) {
        // Use computeWeightedSPD if available, otherwise use raw spectrum
        let spd = hasComputeFunc ? computeWeightedSPD(spectrum) : spectrum;
        renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
      } else {
        // Fallback: Simple bar chart rendering
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#333';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Spectrum visualization unavailable', canvas.width / 2, canvas.height / 2);
      }
    }, 0);
  }
  
  if (!html) html = '<em>No info available for this light.</em>';
  return html;
}

// Render assigned lights cards in Groups V2 panel with delete buttons
// Show light info card when a light is highlighted in the unassigned lights field
document.addEventListener('DOMContentLoaded', () => {
  const unassignedSelect = document.getElementById('groupsV2UnassignedLightsSelect');
  const card = document.getElementById('lightInfoCard');
  const cardBody = document.getElementById('lightInfoCardBody');
  if (!unassignedSelect || !card || !cardBody) return;
  function updateCard() {
    const lights = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
    // Single-select mode - get the selected value directly
    const selectedId = unassignedSelect.value;
    if (!selectedId) {
      cardBody.innerHTML = '';
      card.style.display = 'none';
      return;
    }
    const light = lights.find((entry) => {
      if (!entry) return false;
      // Match using same priority order as dropdown
      const identifier = entry.id || entry.serial || entry.deviceId || entry.name;
      return identifier != null && String(identifier) === String(selectedId);
    });
    if (light) {
      cardBody.innerHTML = renderLightInfoCard(light);
      card.style.display = 'block';
    } else {
      cardBody.innerHTML = '';
      card.style.display = 'none';
    }
  }
  unassignedSelect.addEventListener('change', updateCard);
  unassignedSelect.addEventListener('focus', updateCard);
  unassignedSelect.addEventListener('click', updateCard);
  // Show info for first light if present
  setTimeout(updateCard, 100);
});
// Hard code five lights for room GreenReach
document.addEventListener('DOMContentLoaded', () => {
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  const greenReachLights = [
    {
      id: '22G12-001',
      name: 'TopLight MH Model-300W-22G12',
      serial: '22G12-001',
      manufacturer: 'TopLight',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
  groupId: null,
  groupLabel: null,
      watts: 300,
      ppf: 709,
      ppe: 2.59,
      tunable: true,
      dimmable: true,
      comm: 'WiFi',
      spectrum: { blue: 45, green: 5, red: 45, farRed: 5 },
      colorRange: '400-700'
    },
    {
      id: '22G12-002',
      name: 'TopLight MH Model-300W-22G12',
      serial: '22G12-002',
      manufacturer: 'TopLight',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
  groupId: null,
  groupLabel: null,
      watts: 300,
      ppf: 709,
      ppe: 2.59,
      tunable: true,
      dimmable: true,
      comm: 'WiFi',
      spectrum: { blue: 45, green: 5, red: 45, farRed: 5 },
      colorRange: '400-700'
    },
    {
      id: 'VERTIMAX-001',
      name: 'P.L. Light VertiMax 640W',
      serial: 'VERTIMAX-001',
      manufacturer: 'P.L. Light Systems',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
  groupId: null,
  groupLabel: null,
      watts: 640,
      ppf: 1738,
      ppe: 2.7,
      tunable: false,
      dimmable: true,
      comm: '0-10V',
      colorRange: '400-700',
      spectrum: null
    },
    {
      id: 'FLUENCE-001',
      name: 'Fluence SPYDR 2x',
      serial: 'FLUENCE-001',
      manufacturer: 'Fluence',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
  groupId: null,
  groupLabel: null,
      watts: 685,
      ppf: 1700,
      ppe: 2.5,
      tunable: false,
      dimmable: true,
      comm: 'BLE',
      colorRange: '400-700',
      spectrum: null
    },
    {
      id: 'GENERIC-PLUG-001',
      name: 'Generic LED via Smart Plug',
      serial: 'GENERIC-PLUG-001',
      manufacturer: 'Generic',
      room: 'GreenReach',
      roomId: 'GreenReach',
      zoneId: undefined,
  groupId: null,
  groupLabel: null,
      watts: 100,
      ppf: 220,
      ppe: 2.2,
      tunable: false,
      dimmable: false,
      comm: 'SmartPlug',
      smartPlug: true,
      colorRange: '400-700',
      spectrum: null
    },
  ];
  // Add if not already present
  greenReachLights.forEach(light => {
    if (!window.STATE.lights.some(l => l.id === light.id)) {
      window.STATE.lights.push({
        ...light,
        zoneId: light.zoneId ?? null,
        groupId: light.groupId ?? null,
        groupLabel: light.groupLabel ?? null,
      });
    }
  });
  // Optionally trigger update event
  document.dispatchEvent(new Event('lights-updated'));
});

// Clear the form for creating a new group
function resetGroupsV2Form() {
  const nameInput = document.getElementById('groupsV2ZoneName');
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  const roomSelect = document.getElementById('groupsV2RoomSelect');
  const loadSelect = document.getElementById('groupsV2LoadGroup');
  
  if (nameInput) nameInput.value = '';
  if (zoneSelect) zoneSelect.value = '';
  if (roomSelect) roomSelect.value = 'GreenReach';
  if (loadSelect) loadSelect.value = '';
  
  // Reset form state to defaults
  groupsV2FormState.planId = '';
  groupsV2FormState.planSearch = '';
  groupsV2FormState.anchorMode = 'seedDate';
  groupsV2FormState.seedDate = '';
  groupsV2FormState.dps = null;
  groupsV2FormState.holdDay = 1;
  groupsV2FormState.schedule = { ...GROUPS_V2_DEFAULTS.schedule };
  groupsV2FormState.gradients = { ...GROUPS_V2_DEFAULTS.gradients };
  groupsV2FormState.targetHumidity = null;
  
  // Clear status badge
  updateGroupsV2StatusBadge(null);
  
  // Refresh UI
  populateGroupsV2PlanDropdown('');
  applyGroupsV2StateToInputs();
  updateGroupsV2AnchorInputs();
  debouncedUpdateGroupsV2Preview();
  renderGroupsV2LightCard(null);
  
  // Show toast
  if (typeof showToast === 'function') {
    showToast({ 
      title: 'New Group', 
      msg: 'Form cleared - ready to create a new group', 
      kind: 'info', 
      icon: '' 
    }, 1500);
  }
}

// Handle New Group button
document.addEventListener('DOMContentLoaded', () => {
  const newGroupBtn = document.getElementById('groupsV2NewGroup');
  if (newGroupBtn) {
    newGroupBtn.addEventListener('click', () => {
      resetGroupsV2Form();
    });
  }
});

// Update status badge to show current group's deployment status
function updateGroupsV2StatusBadge(group) {
  const badge = document.getElementById('groupsV2StatusBadge');
  if (!badge) return;
  
  if (!group) {
    badge.style.display = 'none';
    return;
  }
  
  const status = group.status || 'draft';
  badge.style.display = 'block';
  
  if (status === 'deployed') {
    badge.textContent = ' DEPLOYED';
    badge.style.background = 'linear-gradient(135deg,#10b981 0%,#059669 100%)';
    badge.style.color = 'white';
  } else {
    badge.textContent = ' DRAFT';
    badge.style.background = 'linear-gradient(135deg,#fbbf24 0%,#f59e0b 100%)';
    badge.style.color = 'white';
  }
}

// Save or update a group (handles both new and existing groups)
async function saveGroupsV2Group(status = 'draft') {
  console.log('[groups-v2] saveGroupsV2Group called with status:', status);
  
  const nameInput = document.getElementById('groupsV2ZoneName');
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  const roomSelect = document.getElementById('groupsV2RoomSelect');
  const loadSelect = document.getElementById('groupsV2LoadGroup');
  
  console.log('[groups-v2] Form elements found:', {
    nameInput: !!nameInput,
    zoneSelect: !!zoneSelect,
    roomSelect: !!roomSelect,
    loadSelect: !!loadSelect
  });
  
  if (!nameInput || !zoneSelect || !roomSelect) {
    console.warn('[groups-v2] Missing required form elements!');
    return null;
  }
  
  const groupName = nameInput.value.trim();
  const zone = zoneSelect.value;
  const room = roomSelect.value;
  
  console.log('[groups-v2] Form values:', { groupName, zone, room });
  console.log('[groups-v2] Form validation:', { 
    hasName: !!groupName, 
    hasZone: !!zone, 
    hasRoom: !!room,
    zoneOptions: zoneSelect.options.length,
    roomOptions: roomSelect.options.length
  });
  
  if (!groupName || !zone || !room) {
    const missing = [];
    if (!groupName) missing.push('group name');
    if (!room) missing.push('room');
    if (!zone) missing.push('zone');
    const msg = `Please provide: ${missing.join(', ')}`;
    console.warn('[groups-v2] Save blocked:', msg);
    alert(msg);
    return null;
  }
  
  // Initialize STATE if needed
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.groups)) window.STATE.groups = [];
  
  // Generate id
  const id = `${room}:${zone}:${groupName}`;
  
  // Check if we're updating an existing group
  let existingGroup = window.STATE.groups.find(g => g.id === id);
  const isUpdate = !!existingGroup;
  
  // If not updating via id match, check if the currently loaded group should be updated
  if (!existingGroup && loadSelect && loadSelect.value) {
    const loadedGroup = window.STATE.groups.find(g => g.id === loadSelect.value);
    if (loadedGroup) {
      // User changed room/zone/name - this creates a new group
      const newRoomZoneName = `${room}:${zone}:${groupName}`;
      if (loadedGroup.id !== newRoomZoneName) {
        // Different id - check if new id already exists
        const conflictGroup = window.STATE.groups.find(g => g.id === newRoomZoneName);
        if (conflictGroup) {
          alert('A group with this name, room, and zone already exists.');
          return null;
        }
        // Not a conflict - this will create a new group (existing logic handles it)
      } else {
        existingGroup = loadedGroup;
      }
    }
  }
  
  const plan = getGroupsV2SelectedPlan();
  const planId = groupsV2FormState.planId || plan?.id || plan?.name || '';
  const config = buildGroupsV2PlanConfig(plan);
  
  // Build or update group record
  const groupRecord = existingGroup || { id, name: groupName, room, zone, lights: [] };
  groupRecord.name = groupName;
  groupRecord.room = room;
  groupRecord.zone = zone;
  groupRecord.status = status;
  groupRecord.lastModified = new Date().toISOString();
  
  // Preserve lights array if it exists
  if (!Array.isArray(groupRecord.lights)) {
    groupRecord.lights = [];
  }
  
  if (planId) groupRecord.plan = planId;
  if (config) {
    groupRecord.planConfig = config;
    // Compatibility: also persist seed date at top-level for older readers
    if (config.anchor && config.anchor.mode === 'seedDate' && config.anchor.seedDate) {
      groupRecord.seedDate = config.anchor.seedDate;
      // Some legacy views look for planSeedDate specifically
      groupRecord.planSeedDate = config.anchor.seedDate;
    } else {
      // Clear legacy fields if not in seedDate mode to avoid stale values
      delete groupRecord.seedDate;
      delete groupRecord.planSeedDate;
    }
  }
  
  // Add to STATE if new
  if (!existingGroup) {
    window.STATE.groups.push(groupRecord);
  }
  
  // Handle schedule
  let scheduleMessage = '';
  try {
    const scheduleConfig = buildGroupsV2ScheduleConfig();
    const result = await upsertGroupScheduleForGroup(id, scheduleConfig, { name: `${groupName} Schedule` });
    const schedule = result?.schedule
      || (Array.isArray(result?.schedules) ? result.schedules.find((entry) => entry && entry.groupId === id) : null);
    if (schedule) {
      mergeScheduleIntoState(schedule);
      groupRecord.schedule = schedule.id || schedule.groupId;
      scheduleMessage = ' • Schedule linked';
    }
  } catch (error) {
    console.warn('[groups-v2] Failed to upsert schedule', error);
    scheduleMessage = ' • Schedule sync failed';
  }
  
  // Persist to server
  try {
    console.log('[groups-v2] Saving groups to server...', window.STATE.groups.length, 'groups');
    const response = await fetch('/data/groups.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: window.STATE.groups })
    });
    
    console.log('[groups-v2] Server response status:', response.status, response.statusText);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[groups-v2] Server returned error:', errorText);
      throw new Error(`Failed to save groups: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log('[groups-v2] Save successful:', result);
  } catch (error) {
    console.error('[groups-v2] Failed to persist groups:', error);
    if (typeof showToast === 'function') {
      showToast({ title: 'Save Failed', msg: `Could not save to server: ${error.message}`, kind: 'error', icon: '' });
    } else {
      alert(`Failed to save groups: ${error.message}`);
    }
    return null;
  }
  
  // Update UI
  document.dispatchEvent(new Event('groups-updated'));
  updateGroupsV2StatusBadge(groupRecord);
  
  // Update load dropdown to show this group as selected
  if (loadSelect) {
    loadSelect.value = id;
  }
  
  // Refresh assigned lights display
  if (typeof renderGroupsV2LightCard === 'function') {
    renderGroupsV2LightCard(plan);
  }
  
  // Show success toast
  if (typeof showToast === 'function') {
    const statusLabel = status === 'deployed' ? 'Deployed' : 'Saved as Draft';
    const statusIcon = status === 'deployed' ? '' : '💾';
    const details = [`${groupName} (${room}:${zone})`];
    if (planId) details.push(`Plan ${plan?.name || planId}`);
    
    const kind = scheduleMessage.includes('failed') ? 'warn' : 'success';
    const icon = scheduleMessage.includes('failed') ? '' : statusIcon;
    
    showToast({ 
      title: statusLabel, 
      msg: `${details.join(' • ')}${scheduleMessage}`, 
      kind, 
      icon 
    }, 2000);
  }
  
  return groupRecord;
}

/**
 * Save a group object directly to STATE and persist to server.
 * Used for programmatic updates like harvest workflow.
 * @param {object} groupObject - The group object to save
 * @returns {Promise<object|null>} The saved group or null on failure
 */
async function saveGroupsV2GroupObject(groupObject) {
  if (!groupObject || !groupObject.id) {
    console.error('[groups-v2] saveGroupsV2GroupObject: Invalid group object', groupObject);
    return null;
  }
  
  // Initialize STATE if needed
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.groups)) window.STATE.groups = [];
  
  // Find and update or add new
  const existingIndex = window.STATE.groups.findIndex(g => g.id === groupObject.id);
  if (existingIndex >= 0) {
    window.STATE.groups[existingIndex] = groupObject;
  } else {
    window.STATE.groups.push(groupObject);
  }
  
  // Persist to server
  try {
    console.log('[groups-v2] Saving group object to server:', groupObject.id);
    const response = await fetch('/data/groups.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groups: window.STATE.groups })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('[groups-v2] Server returned error:', errorText);
      throw new Error(`Failed to save groups: ${response.status} ${errorText}`);
    }
    
    const result = await response.json();
    console.log('[groups-v2] Save successful:', result);
    
    // Update UI
    document.dispatchEvent(new Event('groups-updated'));
    
    return groupObject;
  } catch (error) {
    console.error('[groups-v2] Failed to persist group object:', error);
    if (typeof showToast === 'function') {
      showToast({ 
        title: 'Save Failed', 
        msg: `Could not save to server: ${error.message}`, 
        kind: 'error', 
        icon: '' 
      });
    }
    return null;
  }
}

// Handle Save Draft button for Groups V2 card
document.addEventListener('DOMContentLoaded', () => {
  const saveDraftBtn = document.getElementById('groupsV2SaveDraft');
  if (saveDraftBtn) {
    saveDraftBtn.addEventListener('click', async () => {
      await saveGroupsV2Group('draft');
    });
  }
});

// Handle Save & Deploy button for Groups V2 card
document.addEventListener('DOMContentLoaded', () => {
  const saveDeployBtn = document.getElementById('groupsV2SaveAndDeploy');
  if (saveDeployBtn) {
    saveDeployBtn.addEventListener('click', async () => {
      const group = await saveGroupsV2Group('deployed');
      if (group && typeof showToast === 'function') {
        showToast({ 
          title: 'Group Deployed', 
          msg: `${group.name} is now active in the automation system`, 
          kind: 'success', 
          icon: '' 
        }, 2500);
      }
    });
  }
});

// Handle Harvest button for Groups V2 card
document.addEventListener('DOMContentLoaded', () => {
  const harvestBtn = document.getElementById('groupsV2HarvestBtn');
  if (harvestBtn) {
    harvestBtn.addEventListener('click', async () => {
      const group = getGroupsV2ActiveGroup();
      if (!group) {
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'No Group Selected', 
            msg: 'Please select a group to harvest', 
            kind: 'error' 
          });
        }
        return;
      }

      // Confirm harvest action
      const confirmed = confirm(`Harvest "${group.name}"?\n\nThis will archive the group and reset it for a new growing cycle.`);
      if (!confirmed) return;

      try {
        // Archive the group (set status to harvested, clear lights)
        const harvestedGroup = {
          ...group,
          status: 'harvested',
          harvestedAt: new Date().toISOString(),
          lights: []
        };

        // Save the harvested group
        await saveGroupsV2GroupObject(harvestedGroup);

        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Harvest Complete', 
            msg: `${group.name} has been harvested and archived`, 
            kind: 'success', 
            icon: '🌾' 
          }, 3000);
        }

        // Clear the form
        clearGroupsV2Form();
        populateGroupsV2LoadDropdown();

      } catch (error) {
        console.error('[Groups V2] Harvest failed:', error);
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Harvest Failed', 
            msg: `Failed to harvest group: ${error.message}`, 
            kind: 'error' 
          });
        }
      }
    });
  }
});

// Handle Delete Group button
document.addEventListener('DOMContentLoaded', () => {
  const deleteGroupBtn = document.getElementById('groupsV2DeleteGroup');
  if (deleteGroupBtn) {
    deleteGroupBtn.addEventListener('click', async () => {
      const loadSelect = document.getElementById('groupsV2LoadGroup');
      if (!loadSelect || !loadSelect.value) {
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'No Group Selected', 
            msg: 'Please select a group from the dropdown to delete', 
            kind: 'error', 
            icon: '' 
          });
        } else {
          alert('Please select a group from the dropdown to delete');
        }
        return;
      }

      const group = getGroupsV2ActiveGroup();
      if (!group) {
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Group Not Found', 
            msg: 'Could not find the selected group', 
            kind: 'error', 
            icon: '' 
          });
        } else {
          alert('Could not find the selected group');
        }
        return;
      }

      const groupLabel = formatGroupsV2GroupLabel(group);
      const confirmMsg = `Delete group "${group.name}"?\n\nRoom: ${group.room}\nZone: ${group.zone}\n\nThis action cannot be undone.`;
      
      if (!confirm(confirmMsg)) {
        return;
      }

      try {
        // Remove from STATE.groups
        if (!window.STATE) window.STATE = {};
        if (!Array.isArray(window.STATE.groups)) window.STATE.groups = [];
        
        const initialLength = window.STATE.groups.length;
        window.STATE.groups = window.STATE.groups.filter(g => {
          if (!g) return false;
          const gId = g.id || formatGroupsV2GroupLabel(g);
          const targetId = group.id || groupLabel;
          return gId !== targetId;
        });

        if (window.STATE.groups.length === initialLength) {
          console.warn('[Groups V2] Group not found in STATE.groups array');
          if (typeof showToast === 'function') {
            showToast({ 
              title: 'Delete Failed', 
              msg: 'Group was not found in state', 
              kind: 'error', 
              icon: '' 
            });
          }
          return;
        }

        // Clear groupId/groupLabel/zoneId from lights that were assigned to this group
        const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
        const groupIdToMatch = group.id || groupLabel;
        
        lightsDb.forEach(light => {
          if (!light) return;
          
          // Check if this light was assigned to the deleted group
          const lightGroupId = light.groupId;
          const lightGroupLabel = light.groupLabel;
          
          if (lightGroupId === groupIdToMatch || lightGroupLabel === groupLabel) {
            // Clear all group-related fields
            delete light.groupId;
            delete light.groupLabel;
            delete light.zoneId;
            
            console.log(`[Groups V2] Unlinked light ${light.id || light.name} from deleted group ${groupLabel}`);
          }
        });
        
        console.log(`[Groups V2] Cleared group references from ${lightsDb.filter(l => !l.groupId).length} lights`);

        // Delete associated schedule if it exists
        if (group.schedule && window.STATE && Array.isArray(window.STATE.schedules)) {
          window.STATE.schedules = window.STATE.schedules.filter(s => s.id !== group.schedule);
        }

        // Persist to server
        try {
          const response = await fetch('/data/groups.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groups: window.STATE.groups })
          });
          if (!response.ok) throw new Error('Failed to save groups to server');
        } catch (error) {
          console.error('[groups-v2] Failed to persist groups after deletion:', error);
        }

        // Also persist lights state
        if (typeof window.saveLights === 'function') {
          try {
            await window.saveLights();
          } catch (error) {
            console.warn('[groups-v2] Failed to persist lights after group deletion:', error);
          }
        }

        // Clear the form
        resetGroupsV2Form();

        // Update UI
        document.dispatchEvent(new Event('groups-updated'));
        document.dispatchEvent(new Event('lights-updated'));
        populateGroupsV2LoadGroupDropdown();
        populateGroupsV2UnassignedLightsDropdown(); // Refresh unassigned lights to show newly available lights
        renderGroupsV2LightCard(null);

        // Show success toast
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Group Deleted', 
            msg: `${group.name} has been permanently deleted`, 
            kind: 'success', 
            icon: '🗑' 
          }, 2000);
        }

        console.log(`[Groups V2] Deleted group: ${groupLabel}`);
      } catch (error) {
        console.error('[Groups V2] Error deleting group:', error);
        if (typeof showToast === 'function') {
          showToast({ 
            title: 'Delete Failed', 
            msg: error.message || 'An error occurred while deleting the group', 
            kind: 'error', 
            icon: '' 
          });
        } else {
          alert(`Error deleting group: ${error.message}`);
        }
      }
    });
  }
});

// DEPRECATED: Old Save Group button - kept for backwards compatibility
// Use Save Draft or Save & Deploy instead
document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('groupsV2SaveGroup');
  if (saveBtn) {
    saveBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('groupsV2ZoneName');
      const zoneSelect = document.getElementById('groupsV2ZoneSelect');
      const roomSelect = document.getElementById('groupsV2RoomSelect');
      if (!nameInput || !zoneSelect || !roomSelect) return;
      const groupName = nameInput.value.trim();
      const zone = zoneSelect.value;
      const room = roomSelect.value;
      if (!groupName || !zone || !room) {
        alert('Enter a group name, select a room, and select a zone.');
        return;
      }
      // Add to window.STATE.groups
      if (!window.STATE) window.STATE = {};
      if (!Array.isArray(window.STATE.groups)) window.STATE.groups = [];
      // Generate a unique id
      const id = `${room}:${zone}:${groupName}`;
      // Check for existing group with same id
      const exists = window.STATE.groups.find(g => (g.id === id || (g.room === room && g.zone === zone && g.name === groupName)));
      if (exists) {
        alert('A group with this name, room, and zone already exists.');
        return;
      }
      const plan = getGroupsV2SelectedPlan();
      const planId = groupsV2FormState.planId || plan?.id || plan?.name || '';
      const groupRecord = { id, name: groupName, room, zone };
      if (planId) groupRecord.plan = planId;
      const config = buildGroupsV2PlanConfig(plan);
      if (config) groupRecord.planConfig = config;
      window.STATE.groups.push(groupRecord);
      const statusEl = document.getElementById('groupsV2Status');
      let scheduleMessage = '';
      try {
        const scheduleConfig = buildGroupsV2ScheduleConfig();
        const result = await upsertGroupScheduleForGroup(id, scheduleConfig, { name: `${groupName} Schedule` });
        const schedule = result?.schedule
          || (Array.isArray(result?.schedules) ? result.schedules.find((entry) => entry && entry.groupId === id) : null);
        if (schedule) {
          mergeScheduleIntoState(schedule);
          groupRecord.schedule = schedule.id || schedule.groupId;
          scheduleMessage = ' • Schedule linked';
        }
      } catch (error) {
        console.warn('[groups-v2] Failed to upsert schedule', error);
        if (typeof showToast === 'function') {
          showToast({ title: 'Schedule not saved', msg: error?.message || 'Failed to sync schedule.', kind: 'warn', icon: '' });
        }
        scheduleMessage = ' • Schedule sync failed';
      }
      // Dispatch event to update dropdown
      document.dispatchEvent(new Event('groups-updated'));
      // Optionally clear the input
      nameInput.value = '';
      // Optionally show a toast
      if (typeof showToast === 'function') {
        const details = [`${groupName} (${room}:${zone})`];
        if (planId) details.push(`Plan ${plan?.name || planId}`);
        if (scheduleMessage.includes('failed')) {
          showToast({ title: 'Group Saved', msg: `${details.join(' • ')}${scheduleMessage}`, kind: 'warn', icon: '' });
        } else {
          showToast({ title: 'Group Saved', msg: `${details.join(' • ')}${scheduleMessage}`, kind: 'success', icon: '' });
        }
      }
      if (statusEl) {
        statusEl.textContent = `Saved group ${groupName}${scheduleMessage}`;
      }
    });
  }
});

// Sync IoT devices into STATE.lights so they appear in unassigned dropdown
function syncIoTDevicesIntoLights() {
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.lights)) window.STATE.lights = [];
  if (!Array.isArray(window.STATE.iotDevices)) return;
  
  // Light-capable protocols that should be included
  const lightProtocols = ['grow3', 'kasa', 'tasmota', 'shelly', 'mqtt', 'modbus', 'http'];
  
  window.STATE.iotDevices.forEach(device => {
    if (!device) return;
    
    // Check if device is a light or plug that can control lights
    const protocol = String(device.protocol || '').toLowerCase();
    const deviceType = String(device.deviceType || device.type || '').toLowerCase();
    const category = String(device.category || '').toLowerCase();
    const vendor = String(device.vendor || '').toLowerCase();
    
    // Include lights AND plugs (plugs can control lights)
    const isLight = lightProtocols.includes(protocol) || 
                    deviceType.includes('light') || 
                    deviceType.includes('grow');
    
    const isPlug = deviceType.includes('plug') || 
                   category.includes('plug') ||
                   protocol.includes('kasa') || 
                   protocol.includes('tp-link') ||
                   vendor.includes('kasa') || 
                   vendor.includes('tp-link');
    
    if (!isLight && !isPlug) return;
    
    // Use device ID as identifier
    const deviceId = device.id || device.deviceId || device.serial || device.mac;
    if (!deviceId) return;
    
    // Check if already in STATE.lights
    const existingLight = window.STATE.lights.find(l => 
      l.id === deviceId || l.deviceId === deviceId || l.serial === deviceId
    );
    
    if (existingLight) {
      // Update existing entry with IoT flags if missing
      if (!existingLight.fromIoT) {
        existingLight.fromIoT = true;
        existingLight.isPlug = isPlug;
        existingLight.deviceType = isPlug ? 'plug' : 'light';
      }
      // Don't re-add if already exists
      return;
    }
    
    // Determine device type label
    const typeLabel = isPlug ? 'Smart Plug' : 'Light';
    const deviceName = device.name || device.label || device.deviceName || 
                       `${device.manufacturer || 'Unknown'} ${device.model || typeLabel}`;
    
    // Add IoT device to lights array
    window.STATE.lights.push({
      id: deviceId,
      deviceId: deviceId,
      name: deviceName,
      serial: device.serial || deviceId,
      manufacturer: device.manufacturer || device.vendor || 'Unknown',
      model: device.model || typeLabel,
      protocol: device.protocol || 'unknown',
      ip: device.ip || device.address,
      port: device.port,
      mac: device.mac,
      deviceType: isPlug ? 'plug' : 'light',
      category: device.category,
      dynamicSpectrum: protocol === 'grow3' || protocol === 'modbus',
      spectrally_tunable: protocol === 'grow3' ? 'Yes' : 'No',
      isPlug: isPlug, // Flag to identify plugs
      fromIoT: true // Mark as coming from IoT devices
    });
  });
}

// Populate Controller Assignment dropdown with available controllers from IoT devices
function populateGroupsV2ControllerDropdown() {
  const select = document.getElementById('groupsV2AssignController');
  if (!select) return;
  
  const previouslySelected = select.value || '';
  select.innerHTML = '<option value="">No controller (manual control)</option>';
  
  const lights = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
  
  // Filter to only show plugs and controllers
  const controllers = lights.filter((light) => {
    if (!light) return false;
    // Include plugs and devices marked as controllers
    if (light.isPlug === true) return true;
    if (light.deviceType === 'plug') return true;
    if (light.deviceType === 'controller') return true;
    return false;
  });
  
  if (controllers.length > 1) {
    controllers.sort((a, b) => String(a.name || a.id || '').localeCompare(String(b.name || b.id || '')));
  }
  
  controllers.forEach((controller) => {
    const opt = document.createElement('option');
    const identifier = controller.id || controller.serial || controller.deviceId || controller.name || '';
    opt.value = identifier;
    
    // Show type indicator
    const typeIcon = controller.isPlug ? '🔌 ' : '🎛 ';
    const deviceName = controller.name || controller.label || 'Unknown Device';
    const protocolLabel = controller.protocol ? ` (${controller.protocol})` : '';
    
    opt.textContent = typeIcon + deviceName + protocolLabel;
    if (previouslySelected === opt.value) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  
  g2debug('populate controller dropdown', { controllersCount: controllers.length });
}

// Populate Unassigned Lights dropdown from light setup wizard and IoT devices
function populateGroupsV2UnassignedLightsDropdown() {
  const select = document.getElementById('groupsV2UnassignedLightsSelect');
  if (!select) return;
  
  // Sync IoT devices into lights before populating
  syncIoTDevicesIntoLights();
  
  // Also populate the controller dropdown
  populateGroupsV2ControllerDropdown();
  
  const previouslySelected = select.value || '';
  select.innerHTML = '';
  const lights = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
  const assignedIds = getGroupsV2AssignedLightIds();
  const activeGroup = getGroupsV2ActiveGroup();
  // Filter out fixtures already linked to any group, AND exclude plugs/controllers
  const unassigned = lights.filter((light) => {
    if (!light) return false;
    
    // EXCLUDE plugs and controllers - they are not assignable as lights
    if (light.isPlug === true) return false;
    if (light.deviceType === 'plug') return false;
    if (light.deviceType === 'controller') return false;
    
    // CRITICAL: Use same identifier priority order as dropdown option values (line 1067)
    // Priority: id → serial → deviceId → name
    const identifier = light.id || light.serial || light.deviceId || light.name || null;
    if (!identifier) return false;
    if (assignedIds.has(String(identifier))) return false;
    if (light.groupId) return false;
    return true;
  });
  const assignBtn = document.getElementById('assignLightsToGroupBtn');
  const setAssignDisabled = (disabled) => {
    if (assignBtn) assignBtn.disabled = !!disabled;
    select.disabled = !!disabled;
  };
  if (unassigned.length > 1) {
    unassigned.sort((a, b) => String(a.name || a.id || '').localeCompare(String(b.name || b.id || '')));
  }
  g2debug('populate unassigned dropdown', { totalLights: lights.length, alreadyAssigned: assignedIds.size, unassigned: unassigned.length });
  // Disable if no unassigned lights or no active group context
  if (unassigned.length === 0 || !activeGroup) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = !activeGroup ? '(select or create a group first)' : '(none)';
    opt.selected = true;
    select.appendChild(opt);
    setAssignDisabled(true);
    select.dispatchEvent(new Event('change'));
    return;
  }
  setAssignDisabled(false);
  unassigned.forEach((light) => {
    const opt = document.createElement('option');
    const identifier = light.id || light.serial || light.deviceId || light.name || '';
    opt.value = identifier;
    
    // Show type indicator for plugs vs lights
    const typeIcon = light.isPlug ? '🔌 ' : light.fromIoT ? ' ' : '';
    const typeLabel = light.isPlug ? '[Plug] ' : '';
    
    // Show name and S/N (ID) for clarity
    const idLabel = light.id || light.serial || light.deviceId || '';
    const baseName = light.name || (idLabel || '(unnamed device)');
    const label = typeIcon + typeLabel + baseName + 
                  (idLabel && light.name ? ` (${idLabel})` : '');
    opt.textContent = label;
    if (previouslySelected === opt.value) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
  if (!select.selectedOptions.length && select.options.length > 0) {
    select.options[0].selected = true;
  }
  select.dispatchEvent(new Event('change'));
}

function requestGroupsV2UnassignedLightsRefresh() {
  if (!groupsV2DomReady) {
    groupsV2PendingRefresh.unassignedLights = true;
    return;
  }
  populateGroupsV2UnassignedLightsDropdown();
}

document.addEventListener('DOMContentLoaded', () => {
  requestGroupsV2UnassignedLightsRefresh();
});

document.addEventListener('lights-updated', requestGroupsV2UnassignedLightsRefresh);
document.addEventListener('groups-updated', requestGroupsV2UnassignedLightsRefresh);

const GROUPS_V2_DEFAULTS = {
  schedule: {
    mode: 'one',
    timezone: 'America/Toronto',
    startTime: '08:00',
    photoperiodHours: 12,
    cycles: [
      { on: '08:00', hours: 12, off: '20:00' },
      { on: '20:00', hours: 6, off: '02:00' },
    ],
    rampUpMin: 10,
    rampDownMin: 10,
  },
  gradients: { ppfd: 0, blue: 0, tempC: 0, rh: 0 },
};

function normalizePhotoperiodHours(hours, maxHours = 24) {
  const num = Number(hours);
  if (!Number.isFinite(num)) return 0;
  const safeMax = Number.isFinite(maxHours) ? Math.max(0, maxHours) : 24;
  const clamped = Math.max(0, Math.min(safeMax, num));
  return Math.round(clamped * 4) / 4;
}

function normalizeTimeString(value, fallback = '08:00') {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^\d{1,2}:\d{2}$/.test(trimmed)) {
      const minutes = toMinutes(trimmed);
      if (Number.isFinite(minutes)) {
        return minutesToHHMM(minutes);
      }
    }
  }
  return typeof fallback === 'string' && fallback ? fallback : '08:00';
}

function distributeMinutes(total, parts) {
  const safeTotal = Math.max(0, Math.round(Number(total) || 0));
  const safeParts = Math.max(1, Math.round(Number(parts) || 1));
  const base = Math.floor(safeTotal / safeParts);
  const remainder = safeTotal - base * safeParts;
  return Array.from({ length: safeParts }, (_, index) => base + (index < remainder ? 1 : 0));
}

function generateGroupsV2Cycles(mode, startTime, photoperiodHours) {
  const normalizedMode = mode === 'two' ? 'two' : 'one';
  const safeStart = normalizeTimeString(startTime, GROUPS_V2_DEFAULTS.schedule.startTime);
  const normalizedHours = normalizePhotoperiodHours(photoperiodHours);
  const totalOnMinutes = Math.max(0, Math.round(normalizedHours * 60));
  const totalOffMinutes = Math.max(0, 1440 - totalOnMinutes);
  const cycleCount = normalizedMode === 'two' ? 2 : 1;
  const onMinutesParts = distributeMinutes(totalOnMinutes, cycleCount);
  const offMinutesParts = distributeMinutes(totalOffMinutes, cycleCount);
  let cursor = toMinutes(safeStart);
  if (!Number.isFinite(cursor)) cursor = toMinutes(GROUPS_V2_DEFAULTS.schedule.startTime);
  if (!Number.isFinite(cursor)) cursor = 0;
  const cycles = [];
  for (let i = 0; i < cycleCount; i += 1) {
    const onMinutes = onMinutesParts[i];
    const offMinutes = offMinutesParts[i];
    const cycleOn = minutesToHHMM(cursor);
    const cycleOff = minutesToHHMM(cursor + onMinutes);
    cycles.push({ on: cycleOn, off: cycleOff, hours: onMinutes / 60 });
    cursor = (cursor + onMinutes + offMinutes) % 1440;
  }
  return { startTime: safeStart, photoperiodHours: normalizedHours, cycles };
}

function computePhotoperiodFromCycles(rawCycles, mode, fallbackHours) {
  if (Array.isArray(rawCycles) && rawCycles.length) {
    const activeCount = mode === 'two' ? 2 : 1;
    let total = 0;
    for (let i = 0; i < activeCount; i += 1) {
      const entry = rawCycles[i];
      if (!entry) continue;
      const directHours = toNumberOrNull(entry.hours);
      if (Number.isFinite(directHours)) {
        total += directHours;
        continue;
      }
      const duration = computeCycleDuration(entry.on, entry.off) / 60;
      if (Number.isFinite(duration)) total += duration;
    }
    if (total > 0) return total;
  }
  return Number.isFinite(fallbackHours) ? fallbackHours : GROUPS_V2_DEFAULTS.schedule.photoperiodHours;
}

function createDefaultGroupsV2Schedule() {
  const defaults = GROUPS_V2_DEFAULTS.schedule;
  const baseMode = defaults.mode === 'two' ? 'two' : 'one';
  const start = normalizeTimeString(defaults.startTime, defaults.cycles[0]?.on || '08:00');
  const photoperiod = normalizePhotoperiodHours(
    Number.isFinite(defaults.photoperiodHours)
      ? defaults.photoperiodHours
      : computePhotoperiodFromCycles(defaults.cycles, baseMode, 12),
  );
  const generated = generateGroupsV2Cycles('two', start, photoperiod);
  return {
    mode: baseMode,
    timezone: defaults.timezone,
    startTime: generated.startTime,
    photoperiodHours: generated.photoperiodHours,
    cycles: generated.cycles,
    rampUpMin: defaults.rampUpMin,
    rampDownMin: defaults.rampDownMin,
  };
}

function normalizeCycleHours(hours) {
  const num = Number(hours);
  if (!Number.isFinite(num)) return 0;
  const clamped = Math.max(0, Math.min(24, num));
  return Math.round(clamped * 2) / 2;
}

function computeGroupsV2CycleOff(on, hours) {
  if (typeof on !== 'string' || !on) return null;
  const match = on.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const minutes = toMinutes(on);
  if (!Number.isFinite(minutes)) return null;
  const durationMinutes = Math.max(0, Math.round(normalizeCycleHours(hours) * 60));
  return minutesToHHMM(minutes + durationMinutes);
}

function formatCycleHoursValue(hours) {
  if (!Number.isFinite(hours)) return '';
  const normalized = Math.max(0, Number(hours));
  if (Math.abs(normalized - Math.round(normalized)) < 1e-6) {
    return String(Math.round(normalized));
  }
  if (Math.abs(normalized * 10 - Math.round(normalized * 10)) < 1e-6) {
    return (Math.round(normalized * 10) / 10).toFixed(1).replace(/\.0$/, '');
  }
  return (Math.round(normalized * 100) / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1');
}

function normalizeGroupsV2Schedule(schedule) {
  const defaults = createDefaultGroupsV2Schedule();
  const base = schedule && typeof schedule === 'object' ? schedule : {};
  const inferredCycles = base.cyclesSelected === 2 || base.mode === 'two' ? 2 : 1;
  const mode = inferredCycles === 2 ? 'two' : 'one';
  const timezone = typeof base.timezone === 'string' && base.timezone ? base.timezone : defaults.timezone;
  const rampUpMin = toNumberOrNull(base.cycleA?.rampUpMin ?? base.rampUpMin) ?? defaults.rampUpMin;
  const rampDownMin = toNumberOrNull(base.cycleA?.rampDownMin ?? base.rampDownMin) ?? defaults.rampDownMin;
  const startCandidate = normalizeTimeString(
    base.cycleA?.start
      ?? base.startTime
      ?? base.start
      ?? (Array.isArray(base.cycles) && base.cycles[0]?.on),
    defaults.startTime,
  );
  let providedPhotoperiod = toNumberOrNull(base.photoperiodHours ?? base.durationHours);
  if (!Number.isFinite(providedPhotoperiod)) {
    const cycleAOn = toNumberOrNull(base.cycleA?.onHours);
    const cycleBOn = toNumberOrNull(base.cycleB?.onHours);
    if (Number.isFinite(cycleAOn)) {
      if (mode === 'two') {
        if (Number.isFinite(cycleBOn)) providedPhotoperiod = Math.max(0, cycleAOn + cycleBOn);
        else providedPhotoperiod = Math.max(0, cycleAOn * 2);
      } else {
        providedPhotoperiod = Math.max(0, cycleAOn);
      }
    }
  }
  const fallbackPhotoperiod = computePhotoperiodFromCycles(base.cycles, mode, defaults.photoperiodHours);
  const photoperiodHours = normalizePhotoperiodHours(
    Number.isFinite(providedPhotoperiod) ? providedPhotoperiod : fallbackPhotoperiod,
  );
  const generated = generateGroupsV2Cycles(mode, startCandidate, photoperiodHours);
  const twoCycle = generateGroupsV2Cycles('two', generated.startTime, generated.photoperiodHours).cycles;
  return {
    mode,
    timezone,
    rampUpMin,
    rampDownMin,
    startTime: generated.startTime,
    photoperiodHours: generated.photoperiodHours,
    cycles: twoCycle,
  };
}

function ensureGroupsV2ScheduleState() {
  const normalized = normalizeGroupsV2Schedule(groupsV2FormState.schedule);
  groupsV2FormState.schedule = normalized;
  return normalized;
}

function hydrateGroupsV2ScheduleState(scheduleCfg) {
  const defaults = createDefaultGroupsV2Schedule();
  if (!scheduleCfg || typeof scheduleCfg !== 'object') return createDefaultGroupsV2Schedule();
  const inferredCycles = scheduleCfg.cyclesSelected === 2 || scheduleCfg.mode === 'two' ? 2 : 1;
  const mode = inferredCycles === 2 ? 'two' : 'one';
  const timezone = typeof scheduleCfg.timezone === 'string' && scheduleCfg.timezone
    ? scheduleCfg.timezone
    : defaults.timezone;
  const rampUpMin = toNumberOrNull(scheduleCfg.cycleA?.rampUpMin ?? scheduleCfg.rampUpMin) ?? defaults.rampUpMin;
  const rampDownMin = toNumberOrNull(scheduleCfg.cycleA?.rampDownMin ?? scheduleCfg.rampDownMin) ?? defaults.rampDownMin;
  const baseCycles = Array.isArray(scheduleCfg.cycles)
    ? scheduleCfg.cycles.slice(0, 2).map((cycle) => ({ ...cycle }))
    : [];
  const cycleAStart = scheduleCfg.cycleA?.start
    ?? scheduleCfg.startTime
    ?? scheduleCfg.start
    ?? (baseCycles[0]?.on ?? defaults.startTime);
  const cycleAOn = toNumberOrNull(scheduleCfg.cycleA?.onHours);
  const cycleBOn = toNumberOrNull(scheduleCfg.cycleB?.onHours);
  let photoperiodHours = toNumberOrNull(scheduleCfg.photoperiodHours ?? scheduleCfg.durationHours);
  if (!Number.isFinite(photoperiodHours) && Number.isFinite(cycleAOn)) {
    if (mode === 'two') {
      photoperiodHours = Number.isFinite(cycleBOn) ? cycleAOn + cycleBOn : cycleAOn * 2;
    } else {
      photoperiodHours = cycleAOn;
    }
  }
  if (!baseCycles.length && typeof cycleAStart === 'string') {
    const perCycle = Number.isFinite(cycleAOn)
      ? cycleAOn
      : mode === 'two'
        ? normalizePhotoperiodHours(photoperiodHours ?? defaults.photoperiodHours, 24) / 2
        : normalizePhotoperiodHours(photoperiodHours ?? defaults.photoperiodHours, 24);
    const cycleAOff = computeGroupsV2CycleOff(cycleAStart, perCycle);
    baseCycles.push({ on: cycleAStart, off: cycleAOff, hours: perCycle });
    if (mode === 'two') {
      const windowHours = Number.isFinite(scheduleCfg.constraints?.windowHours)
        ? scheduleCfg.constraints.windowHours
        : 12;
      const startB = scheduleCfg.cycleB?.start
        ?? minutesToHHMM((toMinutes(cycleAStart) + Math.max(0, Number(windowHours)) * 60) % 1440);
      const perCycleB = Number.isFinite(cycleBOn) ? cycleBOn : perCycle;
      const cycleBOff = computeGroupsV2CycleOff(startB, perCycleB);
      baseCycles.push({ on: startB, off: cycleBOff, hours: perCycleB });
    }
  }
  const base = {
    mode,
    timezone,
    rampUpMin,
    rampDownMin,
    startTime: cycleAStart ?? defaults.startTime,
    photoperiodHours,
    cycles: baseCycles,
    cyclesSelected: inferredCycles,
    cycleA: scheduleCfg.cycleA,
    cycleB: scheduleCfg.cycleB,
    constraints: scheduleCfg.constraints,
  };
  return normalizeGroupsV2Schedule(base);
}

function buildGroupsV2ScheduleConfig() {
  const scheduleState = ensureGroupsV2ScheduleState();
  const defaults = createDefaultGroupsV2Schedule();
  const mode = scheduleState.mode === 'two' ? 'two' : 'one';
  const timezone = typeof scheduleState.timezone === 'string' && scheduleState.timezone
    ? scheduleState.timezone
    : defaults.timezone;
  const startTime = normalizeTimeString(scheduleState.startTime, defaults.startTime);
  const basePhotoperiod = Number.isFinite(scheduleState.photoperiodHours)
    ? scheduleState.photoperiodHours
    : defaults.photoperiodHours;
  const cycleOnHours = mode === 'two'
    ? normalizePhotoperiodHours(basePhotoperiod / 2, 12)
    : normalizePhotoperiodHours(basePhotoperiod, 24);
  const totalOnHours = mode === 'two' ? cycleOnHours * 2 : cycleOnHours;
  let rampUpMin = toNumberOrNull(scheduleState.rampUpMin) ?? defaults.rampUpMin;
  let rampDownMin = toNumberOrNull(scheduleState.rampDownMin) ?? defaults.rampDownMin;
  rampUpMin = Math.max(0, Math.min(120, rampUpMin));
  rampDownMin = Math.max(0, Math.min(120, rampDownMin));
  const maxRampTotal = Math.max(0, cycleOnHours * 60);
  if (rampUpMin + rampDownMin > maxRampTotal) {
    if (rampUpMin >= maxRampTotal) {
      rampUpMin = maxRampTotal;
      rampDownMin = 0;
    } else {
      rampDownMin = maxRampTotal - rampUpMin;
    }
  }
  const windowHours = mode === 'two' ? 12 : 24;
  const startMinutes = toMinutes(startTime);
  const cycleADurationMinutes = Math.max(0, Math.round(cycleOnHours * 60));
  const cycleAOff = minutesToHHMM((startMinutes + cycleADurationMinutes) % 1440);
  let cycleBStart = null;
  let cycleBOff = null;
  if (mode === 'two') {
    const startBMinutes = (startMinutes + windowHours * 60) % 1440;
    cycleBStart = minutesToHHMM(startBMinutes);
    cycleBOff = minutesToHHMM((startBMinutes + cycleADurationMinutes) % 1440);
  }
  const selectedCycles = [
    { on: startTime, off: cycleAOff, hours: cycleOnHours },
  ];
  if (mode === 'two' && cycleBStart) {
    selectedCycles.push({ on: cycleBStart, off: cycleBOff, hours: cycleOnHours });
  }
  const scheduleConfig = {
    period: 'photoperiod',
    cyclesSelected: mode === 'two' ? 2 : 1,
    timezone,
    cycleA: { start: startTime, onHours: cycleOnHours, rampUpMin, rampDownMin },
    cycleB: mode === 'two'
      ? { start: cycleBStart, onHours: cycleOnHours, rampUpMin, rampDownMin }
      : null,
    mode,
    startTime,
    photoperiodHours: totalOnHours,
    durationHours: totalOnHours,
    rampUpMin,
    rampDownMin,
    cycles: selectedCycles,
    totalOnHours,
    totalOffHours: Math.max(0, 24 - totalOnHours),
  };
  if (mode === 'two') {
    scheduleConfig.constraints = { windowHours };
  }
  return scheduleConfig;
}

function getApiBase() {
  if (typeof window !== 'undefined' && typeof window.API_BASE === 'string') {
    const trimmed = window.API_BASE.trim();
    return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
  }
  return '';
}

// Best-effort retrieval of farm PIN to satisfy PIN-gated endpoints (/sched, /groups, etc.)
function getFarmPin() {
  try {
    // 1) Explicit global override (if page sets window.FARM_PIN)
    if (typeof window !== 'undefined' && typeof window.FARM_PIN === 'string' && window.FARM_PIN.trim()) {
      return window.FARM_PIN.trim();
    }
    // 2) URL query parameter (?pin=1234)
    if (typeof window !== 'undefined' && typeof window.location === 'object') {
      const usp = new URLSearchParams(window.location.search || '');
      const qsPin = (usp.get('pin') || '').trim();
      if (qsPin) return qsPin;
    }
    // 3) Local storage cache (manually set via devtools or future UI)
    if (typeof localStorage !== 'undefined') {
      const lsPin = (localStorage.getItem('gr.farmPin') || '').trim();
      if (lsPin) return lsPin;
    }
  } catch {}
  return '';
}

function buildScheduleCyclesPayload(scheduleConfig) {
  const cycles = Array.isArray(scheduleConfig?.cycles) ? scheduleConfig.cycles : [];
  const rampUp = toNumberOrNull(scheduleConfig?.rampUpMin);
  const rampDown = toNumberOrNull(scheduleConfig?.rampDownMin);
  const rampPayload = {};
  if (Number.isFinite(rampUp) && rampUp >= 0) rampPayload.up = rampUp;
  if (Number.isFinite(rampDown) && rampDown >= 0) rampPayload.down = rampDown;
  const includeRamp = Object.keys(rampPayload).length > 0;

  return cycles.slice(0, 2).map((cycle) => {
    if (!cycle) return null;
    const rawStart = typeof cycle.on === 'string' && cycle.on ? cycle.on : cycle.start;
    const start = normalizeTimeString(rawStart, '00:00');
    const rawOff = typeof cycle.off === 'string' && cycle.off ? cycle.off : cycle.end;
    let off = rawOff ? normalizeTimeString(rawOff, null) : null;
    let photo = toNumberOrNull(cycle.hours ?? cycle.photo);
    if (!Number.isFinite(photo)) {
      const duration = typeof computeCycleDuration === 'function'
        ? computeCycleDuration(rawStart || start, rawOff || off || start)
        : null;
      if (Number.isFinite(duration)) {
        photo = duration / 60;
      }
    }
    if (!Number.isFinite(photo)) photo = 0;
    photo = Math.max(0, Math.min(24, photo));
    if (!off) {
      const baseMinutes = typeof toMinutes === 'function' ? toMinutes(start) : null;
      const computedMinutes = Number.isFinite(baseMinutes)
        ? baseMinutes + Math.round(photo * 60)
        : Math.round(photo * 60);
      off = minutesToHHMM(computedMinutes);
    }
    const payload = {
      start,
      off,
      photo,
    };
    if (includeRamp) {
      payload.ramp = { ...rampPayload };
    }
    if (cycle.spectrum && typeof cycle.spectrum === 'object') {
      payload.spectrum = cycle.spectrum;
    }
    return payload;
  }).filter(Boolean);
}

function buildSchedulePayload(groupId, scheduleConfig, metadata = {}) {
  if (!groupId) return null;
  const cycles = buildScheduleCyclesPayload(scheduleConfig);
  if (!cycles.length) return null;
  const payload = {
    groupId,
    cycles,
  };
  if (metadata && typeof metadata.name === 'string' && metadata.name.trim()) {
    payload.name = metadata.name.trim();
  }
  if (typeof scheduleConfig?.mode === 'string') {
    payload.mode = scheduleConfig.mode;
  }
  if (typeof scheduleConfig?.timezone === 'string' && scheduleConfig.timezone) {
    payload.timezone = scheduleConfig.timezone;
  }
  const photoperiod = toNumberOrNull(scheduleConfig?.photoperiodHours);
  if (Number.isFinite(photoperiod)) {
    payload.photoperiodHours = photoperiod;
  }
  return payload;
}

async function upsertGroupScheduleForGroup(groupId, scheduleConfig, metadata = {}) {
  const payload = buildSchedulePayload(groupId, scheduleConfig, metadata);
  if (!payload) {
    throw new Error('Unable to build schedule payload.');
  }
  const apiBase = getApiBase();
  const url = `${apiBase}/sched/${encodeURIComponent(groupId)}`;
  const headers = { 'Content-Type': 'application/json' };
  const farmPin = getFarmPin();
  if (farmPin) headers['x-farm-pin'] = farmPin;
  const response = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const message = await response.text().catch(() => '');
    // Surface a friendlier hint when PIN is required
    if (response.status === 403 && /pin-required/i.test(message || '')) {
      try {
        window.showToast?.({ title: 'Schedule Save Blocked', msg: 'PIN required to save schedules. Add ?pin=YOUR_PIN to the URL or set localStorage["gr.farmPin"].', kind: 'error', icon: '🔒' });
      } catch {}
    }
    throw new Error(message || `Failed to save schedule (HTTP ${response.status})`);
  }
  return response.json();
}

function mergeScheduleIntoState(schedule) {
  if (!schedule || typeof schedule !== 'object') return;
  if (!window.STATE) window.STATE = {};
  if (!Array.isArray(window.STATE.schedules)) window.STATE.schedules = [];
  const idx = window.STATE.schedules.findIndex((entry) => entry && entry.groupId === schedule.groupId);
  if (idx >= 0) {
    window.STATE.schedules[idx] = schedule;
  } else {
    window.STATE.schedules.push(schedule);
  }
  document.dispatchEvent(new Event('schedules-updated'));
}

function updateGroupsV2ScheduleUI() {
  const scheduleState = ensureGroupsV2ScheduleState();
  const defaults = createDefaultGroupsV2Schedule();
  const mode = scheduleState.mode === 'two' ? 'two' : 'one';
  const modeRadios = document.querySelectorAll('input[name="groupsV2ScheduleMode"]');
  modeRadios.forEach((radio) => {
    radio.checked = radio.value === mode;
  });
  const startTime = normalizeTimeString(scheduleState.startTime, defaults.startTime);
  const photoperiodHours = normalizePhotoperiodHours(
    Number.isFinite(scheduleState.photoperiodHours)
      ? scheduleState.photoperiodHours
      : defaults.photoperiodHours,
  );
  const singleCycle = generateGroupsV2Cycles('one', startTime, photoperiodHours).cycles[0];
  const twoCycles = generateGroupsV2Cycles('two', startTime, photoperiodHours).cycles;

  const c1OnInput = document.getElementById('groupsV2Cycle1On');
  if (c1OnInput) c1OnInput.value = singleCycle?.on || startTime;
  const c1HoursInput = document.getElementById('groupsV2Cycle1Hours');
  if (c1HoursInput) {
    const cycleHours = mode === 'two'
      ? twoCycles[0]?.hours ?? photoperiodHours / 2
      : singleCycle?.hours ?? photoperiodHours;
    c1HoursInput.value = formatCycleHoursValue(cycleHours);
    c1HoursInput.max = mode === 'two' ? '12' : '24';
    c1HoursInput.setAttribute('max', mode === 'two' ? '12' : '24');
  }
  const c1End = document.getElementById('groupsV2Cycle1End');
  if (c1End) {
    const endLabel = mode === 'two' ? twoCycles[0]?.off : singleCycle?.off;
    c1End.textContent = `End: ${endLabel || '--:--'}`;
  }

  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  if (cycle2Container) {
    const isTwo = mode === 'two';
    cycle2Container.style.display = isTwo ? 'flex' : 'none';
    const c2 = twoCycles[1] || twoCycles[0] || {
      on: defaults.cycles[1]?.on || startTime,
      off: defaults.cycles[1]?.off || startTime,
      hours: defaults.cycles[1]?.hours ?? photoperiodHours / 2,
    };
    const c2OnInput = document.getElementById('groupsV2Cycle2On');
    if (c2OnInput) {
      c2OnInput.value = c2.on;
      c2OnInput.readOnly = true;
      c2OnInput.setAttribute('aria-readonly', 'true');
      c2OnInput.disabled = !isTwo;
    }
    const c2HoursInput = document.getElementById('groupsV2Cycle2Hours');
    if (c2HoursInput) {
      c2HoursInput.value = formatCycleHoursValue(c2.hours);
      c2HoursInput.readOnly = true;
      c2HoursInput.setAttribute('aria-readonly', 'true');
      c2HoursInput.disabled = !isTwo;
    }
    const c2End = document.getElementById('groupsV2Cycle2End');
    if (c2End) c2End.textContent = `End: ${c2.off || '--:--'}`;
  }
  const addCycleBtn = document.getElementById('groupsV2AddCycle2Btn');
  if (addCycleBtn) {
    addCycleBtn.style.display = mode === 'two' ? 'none' : 'inline-block';
  }
  const summaryEl = document.getElementById('groupsV2ScheduleSummary');
  if (summaryEl) {
    const summaryConfig = buildGroupsV2ScheduleConfig();
    const summaryText = scheduleSummary(summaryConfig);
    summaryEl.textContent = summaryText && summaryText !== 'No schedule'
      ? `Summary: ${summaryText}`
      : '';
  }
}

const groupsV2FormState = {
  planId: '',
  planSearch: '',
  anchorMode: 'seedDate',
  seedDate: formatDateInputValue(new Date()),
  dps: 1,
  holdDay: 1, // Day number to hold/repeat for "hold" anchor mode
  schedule: createDefaultGroupsV2Schedule(),
  gradients: { ...GROUPS_V2_DEFAULTS.gradients },
  targetHumidity: null, // User input for target humidity percentage
  zone: '', // Zone selection (1-9)
  zoneName: '', // Custom group name
};

// Create debounced version of updateGroupsV2Preview to prevent cascading updates
const debouncedUpdateGroupsV2Preview = createDebounced(() => {
  updateGroupsV2Preview();
}, 150);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDateInputValue(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLocalDateInput(value) {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const date = new Date(y, m - 1, d);
  if (!Number.isFinite(date.getTime())) return null;
  date.setHours(0, 0, 0, 0);
  return date;
}

function formatSigned(value, precision = 1) {
  const num = Number(value);
  if (!Number.isFinite(num) || Math.abs(num) < 1e-9) return '0';
  const abs = Math.abs(num);
  const formatted = abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(precision);
  return `${num > 0 ? '+' : '-'}${formatted}`;
}

function getGroupsV2Plans() {
  return (window.STATE && Array.isArray(window.STATE.plans)) ? window.STATE.plans : [];
}

function planMatchesSearch(plan, query) {
  if (!query) return true;
  const needle = query.toLowerCase();
  if (!needle) return true;
  const derived = plan?._derived;
  const applies = derived?.appliesTo || plan?.meta?.appliesTo || {};
  const haystack = [
    plan?.id,
    plan?.name,
    plan?.label,
    plan?.meta?.label,
    plan?.kind,
    plan?.crop,
    ...(Array.isArray(plan?.meta?.category) ? plan.meta.category : []),
    ...(Array.isArray(applies.category) ? applies.category : []),
    ...(Array.isArray(applies.varieties) ? applies.varieties : []),
    ...(Array.isArray(derived?.notes) ? derived.notes : []),
  ];
  return haystack.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes(needle));
}

function getGroupsV2SelectedPlan() {
  const plans = getGroupsV2Plans();
  const id = groupsV2FormState.planId || '';
  console.log('[getGroupsV2SelectedPlan] Looking for plan with id:', id);
  console.log('[getGroupsV2SelectedPlan] groupsV2FormState.planId:', groupsV2FormState.planId);
  if (!id) return null;
  const selectedPlan = plans.find((plan) => (plan.id === id) || (plan.key === id) || (plan.name === id)) || null;
  console.log('[getGroupsV2SelectedPlan] Found plan:', selectedPlan ? selectedPlan.name : 'null');
  return selectedPlan;
}

function updateGroupsV2AnchorInputs() {
  const seedInput = document.getElementById('groupsV2SeedDate');
  const dpsInput = document.getElementById('groupsV2Dps');
  const holdInput = document.getElementById('groupsV2HoldDay');
  const seedWrapper = document.getElementById('groupsV2SeedWrapper');
  const dpsWrapper = document.getElementById('groupsV2DpsWrapper');
  const seedButton = document.getElementById('groupsV2SeedDateBtn');
  const dpsButton = document.getElementById('groupsV2DpsBtn');
  const mode = groupsV2FormState.anchorMode;
  const isSeed = mode === 'seedDate';
  const isDps = mode === 'dps';
  const isHold = mode === 'hold';
  
  // Update seed input state
  if (seedInput) {
    seedInput.disabled = !isSeed;
    seedInput.setAttribute('aria-disabled', !isSeed ? 'true' : 'false');
  }
  
  // Update DPS input state
  if (dpsInput) {
    dpsInput.disabled = !isDps;
    dpsInput.setAttribute('aria-disabled', !isDps ? 'true' : 'false');
    // If DPS mode is active, focus the input
    if (isDps && dpsInput !== document.activeElement) {
      dpsInput.focus();
    }
  }
  
  // Update hold input state
  if (holdInput) {
    holdInput.disabled = !isHold;
    holdInput.setAttribute('aria-disabled', !isHold ? 'true' : 'false');
    // If hold mode is active, focus the input
    if (isHold && holdInput !== document.activeElement) {
      holdInput.focus();
    }
  }
  
  // Update wrapper visibility
  if (seedWrapper) seedWrapper.style.display = isSeed ? 'flex' : 'none';
  if (dpsWrapper) dpsWrapper.style.display = isDps ? 'flex' : 'none';
  
  // Update button states
  if (seedButton) seedButton.setAttribute('aria-pressed', isSeed ? 'true' : 'false');
  if (dpsButton) dpsButton.setAttribute('aria-pressed', isDps ? 'true' : 'false');
  
  console.log('[Groups V2] Updated anchor inputs - mode:', mode, 'isSeed:', isSeed, 'isDps:', isDps, 'isHold:', isHold);
}

function applyGroupsV2StateToInputs() {
  const searchSelect = document.getElementById('groupsV2PlanSearch');
  if (searchSelect) searchSelect.value = groupsV2FormState.planSearch || '';
  const planSelect = document.getElementById('groupsV2PlanSelect');
  if (planSelect) planSelect.value = groupsV2FormState.planId || '';
  const seedInput = document.getElementById('groupsV2SeedDate');
  if (seedInput) seedInput.value = groupsV2FormState.seedDate || '';
  const dpsInput = document.getElementById('groupsV2Dps');
  if (dpsInput) dpsInput.value = groupsV2FormState.dps != null ? String(groupsV2FormState.dps) : '';
  const holdInput = document.getElementById('groupsV2HoldDay');
  if (holdInput) holdInput.value = groupsV2FormState.holdDay != null ? String(groupsV2FormState.holdDay) : '1';
  updateGroupsV2ScheduleUI();
  const gradientMap = {
    groupsV2GradientPpfd: 'ppfd',
    groupsV2GradientBlue: 'blue',
    groupsV2GradientTemp: 'tempC',
    groupsV2GradientRh: 'rh',
  };
  Object.entries(gradientMap).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    const value = groupsV2FormState.gradients[key];
    const defaultValue = GROUPS_V2_DEFAULTS.gradients[key] ?? 0;
    input.value = value != null ? String(value) : String(defaultValue);
  });
  const anchorRadios = document.querySelectorAll('input[name="groupsV2AnchorMode"]');
  anchorRadios.forEach((radio) => { 
    radio.checked = radio.value === groupsV2FormState.anchorMode; 
  });
  
  // Apply target humidity
  const targetHumidityInput = document.getElementById('groupsV2TargetHumidity');
  if (targetHumidityInput) {
    targetHumidityInput.value = groupsV2FormState.targetHumidity != null ? String(groupsV2FormState.targetHumidity) : '';
  }
  
  // Update harvest button visibility based on plan progress
  updateGroupsV2HarvestButtonVisibility();
}

/**
 * Show/hide harvest button based on whether group has reached plan end
 */
function updateGroupsV2HarvestButtonVisibility() {
  const harvestBtn = document.getElementById('groupsV2HarvestBtn');
  if (!harvestBtn) return;
  
  // Get current day number
  const dayNumber = getGroupsV2DayNumber();
  if (dayNumber === null) {
    harvestBtn.style.display = 'none';
    return;
  }
  
  // Get selected plan
  const plan = getGroupsV2SelectedPlan();
  if (!plan) {
    harvestBtn.style.display = 'none';
    return;
  }
  
  // Get plan's max day
  const derived = plan._derived || derivePlanRuntime(plan);
  let maxDay = null;
  
  if (Array.isArray(derived?.lightDays) && derived.lightDays.length > 0) {
    // Find highest day number in lightDays
    maxDay = Math.max(...derived.lightDays.map(ld => Number.isFinite(ld.day) ? ld.day : 0));
  }
  
  // Also check plan.duration if available
  if (plan.duration && Number.isFinite(plan.duration)) {
    const durationDays = plan.duration;
    maxDay = maxDay !== null ? Math.max(maxDay, durationDays) : durationDays;
  }
  
  // Show button if we're at or past the plan's end
  if (maxDay !== null && dayNumber >= maxDay) {
    harvestBtn.style.display = 'inline-block';
    console.log('[Groups V2] Harvest button shown - day', dayNumber, 'of', maxDay);
  } else {
    harvestBtn.style.display = 'none';
  }
}

function getGroupsV2DayNumber() {
  if (groupsV2FormState.anchorMode === 'hold') {
    // Hold mode: always return the specified holdDay
    const holdDay = toNumberOrNull(groupsV2FormState.holdDay);
    return holdDay != null ? Math.max(1, Math.round(holdDay)) : 1;
  }
  if (groupsV2FormState.anchorMode === 'dps') {
    const dps = toNumberOrNull(groupsV2FormState.dps);
    return dps != null ? Math.max(0, Math.round(dps)) : null;
  }
  const seed = parseLocalDateInput(groupsV2FormState.seedDate);
  if (!seed) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - seed.getTime()) / MS_PER_DAY);
  return diff < 0 ? 0 : diff + 1;
}

function resolvePlanTargetsForDay(plan, dayNumber) {
  if (!plan || typeof plan !== 'object') return null;
  const derived = plan._derived || derivePlanRuntime(plan);
  const lightDays = Array.isArray(derived?.lightDays) ? derived.lightDays.slice() : [];
  if (!lightDays.length) {
    const basePhotoperiod = firstNonEmpty(plan.photoperiod, derived?.photoperiod, plan.defaults?.photoperiod);
    const photoperiodHours = readPhotoperiodHours(basePhotoperiod) ?? derived?.photoperiodHours ?? null;
    return {
      stage: plan.stage || '',
      ppfd: toNumberOrNull(firstNonEmpty(plan.ppfd, derived?.ppfd)),
      dli: toNumberOrNull(firstNonEmpty(plan.dli, derived?.dli)),
      photoperiod: basePhotoperiod,
      photoperiodHours,
    };
  }
  const sorted = lightDays.slice().sort((a, b) => {
    const aDay = Number.isFinite(a.day) ? a.day : 0;
    const bDay = Number.isFinite(b.day) ? b.day : 0;
    return aDay - bDay;
  });
  const effectiveDay = Math.max(1, Number.isFinite(dayNumber) ? dayNumber : 1);
  let target = sorted[0];
  for (const entry of sorted) {
    const start = Number.isFinite(entry.day) ? entry.day : null;
    if (start === null) {
      if (!target) target = entry;
      continue;
    }
    if (effectiveDay >= start) target = entry;
    else break;
  }
  const photoperiodHours = readPhotoperiodHours(target?.photoperiod) ?? derived?.photoperiodHours ?? null;
  const ppfd = toNumberOrNull(firstNonEmpty(target?.ppfd, derived?.ppfd, plan.ppfd));
  const dli = toNumberOrNull(firstNonEmpty(target?.dli, plan.dli, derived?.dli));
  return {
    stage: target?.stage || plan.stage || '',
    ppfd,
    dli,
    photoperiod: target?.photoperiod,
    photoperiodHours,
  };
}

function computeGroupsV2PreviewData(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return null;
  const dayNumber = getGroupsV2DayNumber();
  const target = resolvePlanTargetsForDay(plan, dayNumber ?? 1) || {};
  const scheduleConfig = buildGroupsV2ScheduleConfig();
  const scheduleHours = Number.isFinite(scheduleConfig.durationHours) ? scheduleConfig.durationHours : null;
  const basePhotoperiod = target.photoperiodHours ?? readPhotoperiodHours(firstNonEmpty(plan.photoperiod, plan.defaults?.photoperiod, plan._derived?.photoperiod));
  const photoperiodHours = Number.isFinite(scheduleHours) && scheduleHours > 0 ? scheduleHours : basePhotoperiod;
  const planPpfd = toNumberOrNull(firstNonEmpty(target.ppfd, plan.ppfd, plan._derived?.ppfd));
  const gradientPpfd = toNumberOrNull(groupsV2FormState.gradients.ppfd) || 0;
  const hours = Number.isFinite(photoperiodHours) ? Math.max(0, photoperiodHours) : null;
  const targetDli = toNumberOrNull(firstNonEmpty(target.dli, plan.dli, plan._derived?.dli));
  let basePpfd = Number.isFinite(planPpfd) ? planPpfd : null;
  let ppfdAdjustedForDli = false;
  let aiSuggestion = '';
  if (Number.isFinite(targetDli) && hours != null && hours > 0) {
    basePpfd = (targetDli * 1e6) / (3600 * hours);
    ppfdAdjustedForDli = true;
  }
  if ((basePpfd == null || !Number.isFinite(basePpfd)) && hours != null && hours > 0) {
    basePpfd = 200;
    const recommendedDli = (basePpfd * 3600 * hours) / 1e6;
    aiSuggestion = `AI Assist recommends starting at ${Math.round(basePpfd)} µmol·m⁻²·s⁻¹ (${recommendedDli.toFixed(1)} mol·m⁻²·d⁻¹) until plan targets are defined.`;
  } else if ((basePpfd == null || !Number.isFinite(basePpfd)) && (!hours || hours === 0)) {
    aiSuggestion = 'AI Assist recommends selecting a photoperiod to receive PPFD guidance.';
  }
  const adjustedPpfd = basePpfd != null ? basePpfd + gradientPpfd : null;
  const safePpfd = adjustedPpfd != null ? Math.max(0, adjustedPpfd) : null;
  const dli = safePpfd != null && hours != null ? (safePpfd * 3600 * hours) / 1e6 : null;
  return {
    planId: plan.id || plan.name || '',
    day: dayNumber != null ? Math.max(0, dayNumber) : null,
    stage: target.stage || '',
    basePpfd,
    ppfd: safePpfd,
    basePhotoperiod,
    photoperiodHours: hours,
    dli,
    targetDli: Number.isFinite(targetDli) ? targetDli : null,
    ppfdAdjustedForDli,
    aiSuggestion,
    gradients: { ...groupsV2FormState.gradients },
    schedule: scheduleConfig,
    anchor: {
      mode: groupsV2FormState.anchorMode,
      seedDate: groupsV2FormState.anchorMode === 'seedDate' ? (groupsV2FormState.seedDate || null) : null,
      dps: groupsV2FormState.anchorMode === 'dps' ? toNumberOrNull(groupsV2FormState.dps) : null,
      holdDay: groupsV2FormState.anchorMode === 'hold' ? toNumberOrNull(groupsV2FormState.holdDay) : null,
    },
  };
}

function updateGroupsV2Preview() {
  try {
    const activeGroup = getGroupsV2ActiveGroup && getGroupsV2ActiveGroup();
    g2debug('updateGroupsV2Preview', { planId: (window.groupsV2FormState && window.groupsV2FormState.planId) || null, groupId: activeGroup?.id || null });
  } catch (e) { /* ignore */ }
  const previewEl = document.getElementById('groupsV2PlanPreview');
  if (!previewEl) return;
  const plan = getGroupsV2SelectedPlan();
  if (!plan) {
    previewEl.innerHTML = '<div class="tiny text-muted">Select a plan to preview today’s stage, PPFD, photoperiod, and DLI.</div>';
    return;
  }
  const preview = computeGroupsV2PreviewData(plan);
  if (!preview) {
    previewEl.innerHTML = '<div class="tiny text-muted">Enter a seed date or DPS to preview today’s targets.</div>';
    return;
  }
  const dayLabel = preview.day != null ? `Day ${preview.day}` : 'Day —';
  const stage = preview.stage || '—';
  const photoperiodLabel = Number.isFinite(preview.photoperiodHours) ? `${formatCycleHoursValue(preview.photoperiodHours)} h` : '—';
  const ppfdLabel = Number.isFinite(preview.ppfd) ? `${Math.round(preview.ppfd)} µmol·m⁻²·s⁻¹` : '—';
  const dliLabel = Number.isFinite(preview.dli) ? `${preview.dli.toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  const basePhotoperiodLabel = Number.isFinite(preview.basePhotoperiod) ? `${formatCycleHoursValue(preview.basePhotoperiod)} h plan` : '';
  const basePpfdLabel = Number.isFinite(preview.basePpfd) ? `${Math.round(preview.basePpfd)} µmol plan` : '';
  const gradients = preview.gradients || {};
  const gradientParts = [];
  const gradientPpfd = toNumberOrNull(gradients.ppfd);
  const gradientBlue = toNumberOrNull(gradients.blue);
  const gradientTemp = toNumberOrNull(gradients.tempC);
  const gradientRh = toNumberOrNull(gradients.rh);
  if (Number.isFinite(gradientPpfd) && gradientPpfd !== 0) gradientParts.push(`PPFD ${formatSigned(gradientPpfd, 0)} µmol`);
  if (Number.isFinite(gradientBlue) && gradientBlue !== 0) gradientParts.push(`Blue ${formatSigned(gradientBlue, 1)}%`);
  if (Number.isFinite(gradientTemp) && gradientTemp !== 0) gradientParts.push(`Temp ${formatSigned(gradientTemp, 1)}°C`);
  if (Number.isFinite(gradientRh) && gradientRh !== 0) gradientParts.push(`RH ${formatSigned(gradientRh, 1)}%`);
  const gradientHtml = gradientParts.length
    ? `<div class="tiny text-muted">Gradients: ${gradientParts.map((part) => escapeHtml(part)).join(' • ')}</div>`
    : '';
  const notes = [];
  if (preview.ppfdAdjustedForDli && Number.isFinite(preview.targetDli)) {
    notes.push(`PPFD auto-scaled to maintain ${preview.targetDli.toFixed(2)} mol·m⁻²·d⁻¹.`);
  }
  if (preview.aiSuggestion) {
    notes.push(preview.aiSuggestion);
  }
  const notesHtml = notes.length
    ? `<div class="tiny text-muted">${notes.map((note) => escapeHtml(note)).join('<br>')}</div>`
    : '';
  
  // Preview card removed - hide the element if it exists
  previewEl.style.display = 'none';
  previewEl.innerHTML = ''; // Clear any content
  
  // Also update target temperature display
  updateGroupsV2TargetTemp();
  renderGroupsV2LightCard(plan, { dayNumber: preview?.day });
}

function updateGroupsV2TargetTemp() {
  const targetTempEl = document.getElementById('groupsV2TargetTemp');
  if (!targetTempEl) return;
  
  const plan = getGroupsV2SelectedPlan();
  if (!plan || !plan.env || !Array.isArray(plan.env.days)) {
    targetTempEl.innerHTML = '<span class="text-muted">—</span>';
    return;
  }
  
  // Get current day from preview
  const preview = computeGroupsV2PreviewData(plan);
  const currentDay = preview?.day || 1;
  
  // Find the temperature for the current day (or closest day)
  const envDays = plan.env.days
    .map((row) => ({ d: toNumberOrNull(row?.d ?? row?.day), tempC: toNumberOrNull(row?.tempC ?? row?.temp_c ?? row?.temp) }))
    .filter((r) => r.d != null && r.tempC != null)
    .sort((a, b) => a.d - b.d);
  let targetTemp = null;
  
  for (const envDay of envDays) {
    if (envDay.d <= currentDay) {
      targetTemp = envDay.tempC;
    } else {
      break;
    }
  }
  
  if (targetTemp != null && Number.isFinite(targetTemp)) {
    targetTempEl.innerHTML = `<strong style="color:#16a34a;">${targetTemp}°C</strong>`;
  } else {
    targetTempEl.innerHTML = '<span class="text-muted">—</span>';
  }
}

function buildGroupsV2PlanConfig(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return null;
  const preview = computeGroupsV2PreviewData(plan);
  const updatedAt = new Date().toISOString();
  const schedule = buildGroupsV2ScheduleConfig();
  const gradients = {
    ppfd: toNumberOrNull(groupsV2FormState.gradients.ppfd) ?? GROUPS_V2_DEFAULTS.gradients.ppfd,
    blue: toNumberOrNull(groupsV2FormState.gradients.blue) ?? GROUPS_V2_DEFAULTS.gradients.blue,
    tempC: toNumberOrNull(groupsV2FormState.gradients.tempC) ?? GROUPS_V2_DEFAULTS.gradients.tempC,
    rh: toNumberOrNull(groupsV2FormState.gradients.rh) ?? GROUPS_V2_DEFAULTS.gradients.rh,
  };
  const anchor = {
    mode: groupsV2FormState.anchorMode,
    seedDate: groupsV2FormState.anchorMode === 'seedDate' ? (groupsV2FormState.seedDate || null) : null,
    dps: groupsV2FormState.anchorMode === 'dps' ? toNumberOrNull(groupsV2FormState.dps) : null,
    holdDay: groupsV2FormState.anchorMode === 'hold' ? toNumberOrNull(groupsV2FormState.holdDay) : null,
  };
  const config = { anchor, schedule, gradients, updatedAt };
  
  // Add target humidity if set
  const targetHumidity = toNumberOrNull(groupsV2FormState.targetHumidity);
  if (targetHumidity != null) {
    config.targetHumidity = targetHumidity;
  }
  
  if (preview) {
    // Seed environmental target summaries for automation (e.g., tempC today)
    const envTarget = (() => {
      if (!plan.env || !Array.isArray(plan.env.days)) return null;
      const currentDay = preview?.day || 1;
      const envDays = plan.env.days
        .map((row) => ({ d: toNumberOrNull(row?.d ?? row?.day), tempC: toNumberOrNull(row?.tempC ?? row?.temp_c ?? row?.temp) }))
        .filter((r) => r.d != null)
        .sort((a, b) => a.d - b.d);
      let targetTemp = null;
      for (const envDay of envDays) {
        if (envDay.d <= currentDay && envDay.tempC != null) targetTemp = envDay.tempC;
        else if (envDay.d > currentDay) break;
      }
      return targetTemp != null ? { tempC: targetTemp } : null;
    })();
    config.preview = { ...preview, updatedAt, ...(envTarget ? { env: envTarget } : {}) };
  }
  return config;
}

function initializeGroupsV2Form() {
  if (initializeGroupsV2Form._initialized) return;
  initializeGroupsV2Form._initialized = true;
  applyGroupsV2StateToInputs();
  const planSearchSelect = document.getElementById('groupsV2PlanSearch');
  if (planSearchSelect) {
    planSearchSelect.addEventListener('change', (event) => {
      groupsV2FormState.planSearch = event.target.value || '';
      populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
    });
  }
  const seedInput = document.getElementById('groupsV2SeedDate');
  if (seedInput) {
    seedInput.addEventListener('input', (event) => {
      groupsV2FormState.seedDate = event.target.value || '';
      debouncedUpdateGroupsV2Preview();
    });
  }
  const dpsInput = document.getElementById('groupsV2Dps');
  if (dpsInput) {
    const handleDpsChange = (event) => {
      groupsV2FormState.dps = toNumberOrNull(event.target.value);
      debouncedUpdateGroupsV2Preview();
    };
    dpsInput.addEventListener('input', handleDpsChange);
    dpsInput.addEventListener('change', handleDpsChange);
  }
  const holdInput = document.getElementById('groupsV2HoldDay');
  if (holdInput) {
    const handleHoldChange = (event) => {
      groupsV2FormState.holdDay = toNumberOrNull(event.target.value) || 1;
      debouncedUpdateGroupsV2Preview();
    };
    holdInput.addEventListener('input', handleHoldChange);
    holdInput.addEventListener('change', handleHoldChange);
  }
  const scheduleModeRadios = document.querySelectorAll('input[name="groupsV2ScheduleMode"]');
  scheduleModeRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      const schedule = ensureGroupsV2ScheduleState();
      const nextMode = event.target.value === 'two' ? 'two' : 'one';
      if (schedule.mode === nextMode) return;
      const previousTotal = normalizePhotoperiodHours(
        Number.isFinite(schedule.photoperiodHours) ? schedule.photoperiodHours : 0,
        24,
      );
      let nextTotal = previousTotal;
      if (nextMode === 'two') {
        let perCycle = previousTotal > 0 ? previousTotal / 2 : 6;
        if (!Number.isFinite(perCycle) || perCycle <= 0) perCycle = 6;
        perCycle = normalizePhotoperiodHours(perCycle, 12);
        nextTotal = Math.min(24, perCycle * 2);
      } else {
        const perCycle = normalizePhotoperiodHours(previousTotal / 2, 12);
        nextTotal = normalizePhotoperiodHours(perCycle * 2, 24);
      }
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: nextMode, photoperiodHours: nextTotal });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
    });
  });
  const defaultSchedule = createDefaultGroupsV2Schedule();
  const c1OnInput = document.getElementById('groupsV2Cycle1On');
  if (c1OnInput) {
    const handleStartChange = (event) => {
      const schedule = ensureGroupsV2ScheduleState();
      const fallback = defaultSchedule.startTime || defaultSchedule.cycles[0]?.on || '08:00';
      const value = normalizeTimeString(event.target.value, fallback);
      const updated = normalizeGroupsV2Schedule({ ...schedule, startTime: value });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
    };
    c1OnInput.addEventListener('change', handleStartChange);
    c1OnInput.addEventListener('input', handleStartChange);
  }
  const c1HoursInput = document.getElementById('groupsV2Cycle1Hours');
  if (c1HoursInput) {
    c1HoursInput.addEventListener('input', (event) => {
      const schedule = ensureGroupsV2ScheduleState();
      const mode = schedule.mode === 'two' ? 'two' : 'one';
      const maxHours = mode === 'two' ? 12 : 24;
      const perCycle = normalizePhotoperiodHours(event.target.value, maxHours);
      const total = mode === 'two' ? Math.min(24, perCycle * 2) : perCycle;
      const updated = normalizeGroupsV2Schedule({ ...schedule, photoperiodHours: total });
      groupsV2FormState.schedule = updated;
      c1HoursInput.value = formatCycleHoursValue(perCycle);
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
      
      // Update plan card with new photoperiod-adjusted PPFD/DLI
      const plan = getGroupsV2SelectedPlan();
      if (plan) {
        const planCard = document.getElementById('groupsV2PlanCard');
        const currentDay = (planCard && planCard._currentDay) ? planCard._currentDay : 1;
        renderGroupsV2PlanCard(plan, currentDay);
      }
    });
  }
  const splitEvenBtn = document.getElementById('groupsV2SplitEvenBtn');
  if (splitEvenBtn) {
    splitEvenBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: 'two', photoperiodHours: 12 });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
      
      // Update plan card with new photoperiod-adjusted PPFD/DLI
      const plan = getGroupsV2SelectedPlan();
      if (plan) {
        const planCard = document.getElementById('groupsV2PlanCard');
        const currentDay = (planCard && planCard._currentDay) ? planCard._currentDay : 1;
        renderGroupsV2PlanCard(plan, currentDay);
      }
    });
  }
  const maxLightBtn = document.getElementById('groupsV2MaxLightBtn');
  if (maxLightBtn) {
    maxLightBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({ ...schedule, mode: 'two', photoperiodHours: 22 });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
      
      // Update plan card with new photoperiod-adjusted PPFD/DLI
      const plan = getGroupsV2SelectedPlan();
      if (plan) {
        const planCard = document.getElementById('groupsV2PlanCard');
        const currentDay = (planCard && planCard._currentDay) ? planCard._currentDay : 1;
        renderGroupsV2PlanCard(plan, currentDay);
      }
    });
  }
  const resetRampsBtn = document.getElementById('groupsV2ResetRampsBtn');
  if (resetRampsBtn) {
    resetRampsBtn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const defaultsSchedule = createDefaultGroupsV2Schedule();
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        rampUpMin: defaultsSchedule.rampUpMin,
        rampDownMin: defaultsSchedule.rampDownMin,
      });
      groupsV2FormState.schedule = updated;
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
    });
  }
  const gradientMap = {
    groupsV2GradientPpfd: 'ppfd',
    groupsV2GradientBlue: 'blue',
    groupsV2GradientTemp: 'tempC',
    groupsV2GradientRh: 'rh',
  };
  Object.entries(gradientMap).forEach(([id, key]) => {
    const input = document.getElementById(id);
    if (!input) return;
    input.addEventListener('input', (event) => {
      const value = toNumberOrNull(event.target.value);
      const defaultValue = GROUPS_V2_DEFAULTS.gradients[key] ?? 0;
      groupsV2FormState.gradients[key] = value != null ? value : defaultValue;
      debouncedUpdateGroupsV2Preview();
      
      // Update plan card if temperature gradient changed
      if (key === 'tempC') {
        const plan = getGroupsV2SelectedPlan();
        if (plan) {
          const planCard = document.getElementById('groupsV2PlanCard');
          const currentDay = (planCard && planCard._currentDay) ? planCard._currentDay : 1;
          updatePlanCardForDay(plan, currentDay);
        }
      }
    });
  });
  
  // Wire up target humidity input
  const targetHumidityInput = document.getElementById('groupsV2TargetHumidity');
  if (targetHumidityInput) {
    targetHumidityInput.addEventListener('input', (event) => {
      const value = toNumberOrNull(event.target.value);
      groupsV2FormState.targetHumidity = value;
      // No need to update preview since humidity doesn't affect the plan preview
    });
  }
  
  // Wire up zone select and group name inputs
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  if (zoneSelect) {
    zoneSelect.addEventListener('change', (event) => {
      groupsV2FormState.zone = event.target.value || '';
      console.log('[Groups V2] Zone selected:', groupsV2FormState.zone);
    });
  }
  
  const zoneNameInput = document.getElementById('groupsV2ZoneName');
  if (zoneNameInput) {
    zoneNameInput.addEventListener('input', (event) => {
      groupsV2FormState.zoneName = event.target.value || '';
      console.log('[Groups V2] Group name updated:', groupsV2FormState.zoneName);
    });
  }
  
  const anchorRadios = document.querySelectorAll('input[name="groupsV2AnchorMode"]');
  anchorRadios.forEach((radio) => {
    radio.addEventListener('change', (event) => {
      if (!event.target.checked) return;
      const value = event.target.value;
      if (value === 'hold') {
        groupsV2FormState.anchorMode = 'hold';
      } else if (value === 'dps') {
        groupsV2FormState.anchorMode = 'dps';
      } else {
        groupsV2FormState.anchorMode = 'seedDate';
      }
      updateGroupsV2AnchorInputs();
      debouncedUpdateGroupsV2Preview();
    });
  });
  updateGroupsV2AnchorInputs();
}
// Populate Groups V2 Plan and Schedule dropdowns from setup cards
// REMOVED: populateGroupsV2PlanSearchDropdown() - redundant search dropdown removed
// The groupsV2PlanSelect dropdown shows all plans loaded from lighting-recipes.json (single source of truth)

function populateGroupsV2PlanDropdown(filterQuery) {
  const select = document.getElementById('groupsV2PlanSelect');
  if (!select) return;
  
  // Don't repopulate if user is actively interacting with the dropdown
  if (document.activeElement === select) {
    console.log('[Groups V2] Skipping plan dropdown repopulation - user is interacting with it');
    return;
  }
  
  const query = typeof filterQuery === 'string'
    ? filterQuery.trim().toLowerCase()
    : (groupsV2FormState.planSearch || '').trim().toLowerCase();
  while (select.options.length > 1) select.remove(1);
  const plans = getGroupsV2Plans();
  const filtered = !query ? plans : plans.filter((plan) => planMatchesSearch(plan, query));
  if (!filtered.length) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(no matching plans)';
    placeholder.disabled = true;
    select.appendChild(placeholder);
  } else {
    filtered.forEach((plan) => {
      const opt = document.createElement('option');
      const value = plan.id || plan.key || plan.name || '';
      opt.value = value;
      opt.dataset.id = plan.id || '';
      opt.dataset.key = plan.key || '';
      opt.textContent = plan.name || plan.label || plan.id || '(unnamed plan)';
      select.appendChild(opt);
    });
  }
  const current = groupsV2FormState.planId;
  const hasMatch = filtered.some((plan) => (plan.id === current) || (plan.key === current) || (plan.name === current));
  if (hasMatch) {
    select.value = current;
  } else {
    select.value = '';
    if (current) groupsV2FormState.planId = '';
  }
  if (!select.value && filtered.length === 1) {
    const fallback = filtered[0].id || filtered[0].key || filtered[0].name || '';
    select.value = fallback;
  }
  if (!select._planListenerAttached) {
    select.addEventListener('change', () => {
      const opt = select.selectedOptions && select.selectedOptions[0];
      const raw = select.value || '';
      const chosenId = (opt && (opt.dataset.id || opt.dataset.key)) || raw;
      console.log('[Groups V2] Plan dropdown changed - raw:', raw, 'chosenId:', chosenId);
      groupsV2FormState.planId = chosenId || raw || '';
      console.log('[Groups V2] Updated groupsV2FormState.planId to:', groupsV2FormState.planId);
      const plan = getGroupsV2SelectedPlan();
      console.log('[Groups V2] Retrieved plan after dropdown change:', plan ? plan.name : 'null');
      renderGroupsV2PlanCard(plan);
      debouncedUpdateGroupsV2Preview();
      // If a group is currently active, auto-apply and persist the plan selection
      try {
        applyPlanSelectionToCurrentGroup(plan);
      } catch (e) {
        console.warn('[Groups V2] Failed to auto-apply plan to group:', e);
      }
    });
    select._planListenerAttached = true;
  }
  groupsV2FormState.planId = select.value || '';
  const plan = getGroupsV2SelectedPlan();
  renderGroupsV2PlanCard(plan);
  debouncedUpdateGroupsV2Preview();
}

// Apply current plan selection to the active group and persist
function applyPlanSelectionToCurrentGroup(planOverride) {
  const plan = planOverride || getGroupsV2SelectedPlan();
  if (!plan) return;
  if (!window.STATE || !Array.isArray(window.STATE.groups) || !window.STATE.groups.length) return;
  // Determine active group: prefer selection from 'Load Group' dropdown, else last group
  const loadSelect = document.getElementById('groupsV2LoadGroup');
  let group = null;
  if (loadSelect && loadSelect.value) {
    const id = loadSelect.value;
    group = window.STATE.groups.find((g) => g && (g.id === id));
  }
  if (!group) group = window.STATE.groups[window.STATE.groups.length - 1];
  if (!group) return;
  const targetPlanId = plan.id || plan.key || plan.name || groupsV2FormState.planId || '';
  if (!targetPlanId) return;
  group.plan = String(targetPlanId);
  const cfg = buildGroupsV2PlanConfig(plan);
  if (cfg) group.planConfig = cfg; else delete group.planConfig;
  // Persist to server via app's saveGroups helper (deferred to avoid blocking UI)
  if (typeof window.saveGroups === 'function') {
    setTimeout(() => {
      try {
        window.saveGroups();
      } catch (e) {
        console.warn('[Groups V2] Failed to save groups:', e);
      }
    }, 100);
  }
  // Notify UX
  try { document.dispatchEvent(new Event('groups-updated')); } catch {}
  if (typeof window.showToast === 'function') {
    const label = plan.name || plan.id || 'plan';
    window.showToast({ title: 'Plan Saved', msg: `Applied ${label} to group ${group.name || group.id}`, kind: 'success', icon: '' }, 1500);
  }
  renderGroupsV2LightCard(plan);
}

/**
 * Calculate spectral band percentages from SPD data for display.
 * 
 * IMPORTANT: "Green" (500-600nm) represents the ENTIRE mid-spectrum range,
 * including cyan, true green, yellow, and amber wavelengths. This is NOT just 
 * "visually green" light.
 * 
 * For fixtures with only adjustable red/blue channels:
 * - The absolute mid-spectrum (green) output is FIXED (cannot be adjusted)
 * - The percentage shown will vary as total output changes when red/blue are adjusted
 * - This is correct behavior: percentage = fixed_output / changing_total
 * 
 * Spectral bands:
 * - Blue: 400-500nm (violet, blue)
 * - Green: 500-600nm (cyan, green, yellow, amber) ← ENTIRE MID-SPECTRUM
 * - Red: 600-680nm (orange, red)
 * - Deep Red/Far-Red: 680-750nm (far-red, approaching infrared)
 * 
 * @param {Object} spd - SPD object with wavelengths and display arrays
 * @returns {Object} - { blue, green, red, deepRed } percentages as strings with 1 decimal
 */
function calculateSpectrumColorPercentages(spd) {
  if (!spd || !Array.isArray(spd.wavelengths) || !Array.isArray(spd.display)) {
    return { blue: 0, green: 0, red: 0, deepRed: 0 };
  }
  
  const wavelengths = spd.wavelengths;
  const display = spd.display;
  
  let blueSum = 0, greenSum = 0, redSum = 0, deepRedSum = 0, total = 0;
  
  for (let i = 0; i < wavelengths.length; i++) {
    const wl = wavelengths[i];
    const val = display[i] || 0;
    
    if (wl >= 400 && wl < 500) {
      blueSum += val;
    } else if (wl >= 500 && wl < 600) {
      greenSum += val;  // Mid-spectrum: entire 500-600nm band (cyan→green→yellow→amber)
    } else if (wl >= 600 && wl < 680) {
      redSum += val;
    } else if (wl >= 680 && wl < 750) {
      deepRedSum += val;
    }
    total += val;
  }
  
  if (total === 0) {
    return { blue: 0, green: 0, red: 0, deepRed: 0 };
  }
  
  return {
    blue: (blueSum / total * 100).toFixed(1),
    green: (greenSum / total * 100).toFixed(1),  // Percentage of total output in 500-600nm range
    red: (redSum / total * 100).toFixed(1),
    deepRed: (deepRedSum / total * 100).toFixed(1)
  };
}

/**
 * Calculate detailed mid-spectrum breakdown (500-600nm).
 * Assumes uniform distribution across the mid-spectrum range.
 * 
 * Sub-bands based on wavelength spans:
 * - Cyan: 500-520nm (20nm = 20% of 100nm mid-spectrum)
 * - True Green: 520-560nm (40nm = 40% of 100nm mid-spectrum)
 * - Yellow: 560-590nm (30nm = 30% of 100nm mid-spectrum)
 * - Amber: 590-600nm (10nm = 10% of 100nm mid-spectrum)
 * 
 * @param {Object} spd - SPD object with wavelengths and display arrays
 * @param {number} greenPercentage - Total green (500-600nm) percentage from calculateSpectrumColorPercentages
 * @returns {Object} - { cyan, trueGreen, yellow, amber } percentages
 */
function calculateMidSpectrumBreakdown(spd, greenPercentage) {
  const greenPct = parseFloat(greenPercentage) || 0;
  
  if (!spd || !Array.isArray(spd.wavelengths) || !Array.isArray(spd.display)) {
    // Uniform distribution assumption
    return {
      cyan: (greenPct * 0.20).toFixed(1),      // 20% of mid-spectrum
      trueGreen: (greenPct * 0.40).toFixed(1), // 40% of mid-spectrum
      yellow: (greenPct * 0.30).toFixed(1),    // 30% of mid-spectrum
      amber: (greenPct * 0.10).toFixed(1)      // 10% of mid-spectrum
    };
  }
  
  // Calculate actual distribution from SPD data
  const wavelengths = spd.wavelengths;
  const display = spd.display;
  
  let cyanSum = 0, trueGreenSum = 0, yellowSum = 0, amberSum = 0, midTotal = 0;
  
  for (let i = 0; i < wavelengths.length; i++) {
    const wl = wavelengths[i];
    const val = display[i] || 0;
    
    if (wl >= 500 && wl < 520) {
      cyanSum += val;
      midTotal += val;
    } else if (wl >= 520 && wl < 560) {
      trueGreenSum += val;
      midTotal += val;
    } else if (wl >= 560 && wl < 590) {
      yellowSum += val;
      midTotal += val;
    } else if (wl >= 590 && wl < 600) {
      amberSum += val;
      midTotal += val;
    }
  }
  
  if (midTotal === 0) {
    // Fall back to uniform distribution
    return {
      cyan: (greenPct * 0.20).toFixed(1),
      trueGreen: (greenPct * 0.40).toFixed(1),
      yellow: (greenPct * 0.30).toFixed(1),
      amber: (greenPct * 0.10).toFixed(1)
    };
  }
  
  // Calculate actual percentages based on SPD distribution
  const total = Array.isArray(spd.samples) ? spd.samples.reduce((sum, v) => sum + v, 0) : 
                (Array.isArray(spd.display) ? spd.display.reduce((sum, v) => sum + v, 0) : 1);
  
  return {
    cyan: (cyanSum / total * 100).toFixed(1),
    trueGreen: (trueGreenSum / total * 100).toFixed(1),
    yellow: (yellowSum / total * 100).toFixed(1),
    amber: (amberSum / total * 100).toFixed(1)
  };
}

// Get plan data for a specific day
function getPlanDayData(plan, dayNumber) {
  if (!plan) return null;
  
  const derived = plan._derived || derivePlanRuntime(plan);
  
  // Check multiple locations for days data
  let days = [];
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    days = plan.days;
  } else if (Array.isArray(derived?.days) && derived.days.length > 0) {
    days = derived.days;
  } else if (Array.isArray(derived?.lightDays) && derived.lightDays.length > 0) {
    days = derived.lightDays;
  } else if (plan.light && Array.isArray(plan.light.days) && plan.light.days.length > 0) {
    days = plan.light.days;
  }
  
  // Find the specific day or interpolate to nearest
  let dayData = days.find(d => (d.day === dayNumber || d.d === dayNumber));
  
  if (!dayData && days.length > 0) {
    // Find the closest day <= requested day
    const sortedDays = days
      .map(d => ({ ...d, dayNum: d.day || d.d || 0 }))
      .sort((a, b) => a.dayNum - b.dayNum);
    
    const closestDay = sortedDays.reduce((prev, curr) => {
      if (curr.dayNum <= dayNumber) return curr;
      return prev;
    }, sortedDays[0]);
    
    dayData = closestDay;
  }
  
  if (!dayData) {
    // Fallback to plan defaults
    return {
      spectrum: plan.spectrum || derived?.spectrum || { cw: 45, ww: 45, bl: 0, gn: 0, rd: 0, fr: 0 },
      ppfd: plan.ppfd || derived?.ppfd || 0,
      dli: plan.dli || derived?.dli || 0,
      photoperiod: plan.photoperiod || derived?.photoperiod || 0,
      tempC: plan.tempC || (plan.env && plan.env.tempC) || 22
    };
  }
  
  // Extract day-specific data
  // Check for spectrum in multiple formats: mix, spectrum, or flat keys (cw/ww/bl/gn/rd/fr)
  let spectrum;
  let bandTargets = null;
  if (dayData.mix && typeof dayData.mix === 'object') {
    console.log('[getPlanDayData] Using dayData.mix:', dayData.mix);
    spectrum = dayData.mix;
  } else if (dayData.spectrum && typeof dayData.spectrum === 'object') {
    console.log('[getPlanDayData] Using dayData.spectrum:', dayData.spectrum);
    spectrum = dayData.spectrum;
  } else if (typeof dayData.cw !== 'undefined' || typeof dayData.ww !== 'undefined' || typeof dayData.bl !== 'undefined' || typeof dayData.gn !== 'undefined' || typeof dayData.rd !== 'undefined' || typeof dayData.fr !== 'undefined') {
    // Flat format: cw, ww, bl, gn, rd, fr at top level of dayData (or blue, green, red, far_red aliases)
    console.log('[getPlanDayData] Using flat format. dayData:', { cw: dayData.cw, ww: dayData.ww, bl: dayData.bl, gn: dayData.gn, rd: dayData.rd, fr: dayData.fr, blue: dayData.blue, green: dayData.green, red: dayData.red, far_red: dayData.far_red });
    spectrum = {
      cw: dayData.cw || 0,
      ww: dayData.ww || 0,
      bl: dayData.bl || dayData.blue || 0,
      gn: dayData.gn || dayData.green || 0,
      rd: dayData.rd || dayData.red || 0,
      fr: dayData.fr || dayData.far_red || 0
    };
    console.log('[getPlanDayData] Created spectrum:', spectrum);
  } else {
    console.log('[getPlanDayData] Using fallback spectrum');
    spectrum = plan.spectrum || derived?.spectrum || { cw: 45, ww: 45, bl: 0, gn: 0, rd: 0, fr: 0 };
  }

  // If upstream provided explicit bandTargets, preserve them
  if (dayData.bandTargets && typeof dayData.bandTargets === 'object') {
    bandTargets = {
      B: toNumberOrNull(dayData.bandTargets.B) ?? 0,
      G: toNumberOrNull(dayData.bandTargets.G) ?? 0,
      R: toNumberOrNull(dayData.bandTargets.R) ?? 0,
      FR: toNumberOrNull(dayData.bandTargets.FR) ?? 0,
    };
  } else {
    // Heuristic: If entry looks band-based (CW/WW missing or zero while BL/GN/RD/FR present), derive band targets from spectrum
    const cw = Number(spectrum.cw || 0);
    const ww = Number(spectrum.ww || 0);
    const bl = Number(spectrum.bl || 0);
    const gn = Number(spectrum.gn || 0);
    const rd = Number(spectrum.rd || 0);
    const fr = Number(spectrum.fr || 0);
    const whitesSum = cw + ww;
    const bandsSum = bl + gn + rd + fr;
    // Consider it band-based when whites are zero (or undefined) and at least one band is non-zero
    if (whitesSum === 0 && bandsSum > 0) {
      bandTargets = { B: bl, G: gn, R: rd, FR: fr };
      console.log('[getPlanDayData] Derived bandTargets from band-based spectrum:', bandTargets);
    }
  }
  
  // Convert band targets to channels if needed
  if (bandTargets) {
    const cw = Number(spectrum.cw || 0);
    const ww = Number(spectrum.ww || 0);
    const needsConversion = (cw === 0 && ww === 0);
    
    if (needsConversion) {
      if (typeof window.solveChannelsFromBands === 'function' && window.STATE && window.STATE.calibrationMatrix) {
        // Use full solver if calibration matrix available
        try {
          const solverResult = window.solveChannelsFromBands(bandTargets, window.STATE.calibrationMatrix, {tolerance: 0.05, maxPower: 100});
          if (solverResult?.channels) {
            spectrum.cw = Number(solverResult.channels.cw || 0);
            spectrum.ww = Number(solverResult.channels.ww || 0);
            spectrum.bl = Number(solverResult.channels.bl || 0);
            spectrum.rd = Number(solverResult.channels.rd || 0);
            console.log('[getPlanDayData] Converted bands to channels:', spectrum);
          }
        } catch (err) {
          console.warn('[getPlanDayData] Solver failed:', err);
        }
      } else {
        // Fallback heuristic: Green from whites, blue/red stay on BL/RD
        const greenFraction = bandTargets.G / 100;
        const whitePower = greenFraction * 100;
        spectrum.cw = whitePower * 0.5;
        spectrum.ww = whitePower * 0.5;
        spectrum.bl = bandTargets.B;
        spectrum.rd = bandTargets.R;
        console.log('[getPlanDayData] Fallback conversion:', spectrum);
      }
    }
  }
  
  const ppfd = dayData.ppfd || dayData.intensity || 0;
  const photoperiodHours = dayData.hours || dayData.photoperiod || plan.photoperiod || derived?.photoperiod || 0;
  const dli = dayData.dli || ((ppfd && photoperiodHours) ? (ppfd * photoperiodHours * 3600 / 1000000) : 0);
  const tempC = dayData.tempC || dayData.temp || (plan.env && plan.env.tempC) || 22;
  
  return {
    spectrum,
    bandTargets,
    ppfd,
    dli,
    photoperiod: typeof photoperiodHours === 'string' ? photoperiodHours : photoperiodHours,
    tempC,
    day: dayNumber
  };
}

// Get total number of days in a plan
function getPlanTotalDays(plan) {
  if (!plan) return 1;
  
  const derived = plan._derived || derivePlanRuntime(plan);
  
  // Check multiple locations for days data
  let days = [];
  if (Array.isArray(plan.days) && plan.days.length > 0) {
    days = plan.days;
  } else if (Array.isArray(derived?.days) && derived.days.length > 0) {
    days = derived.days;
  } else if (Array.isArray(derived?.lightDays) && derived.lightDays.length > 0) {
    days = derived.lightDays;
  } else if (plan.light && Array.isArray(plan.light.days) && plan.light.days.length > 0) {
    days = plan.light.days;
  }
  
  if (days.length === 0) return 1;
  
  // Find the maximum day number
  let maxDay = 0;
  days.forEach(d => {
    const dayNum = d.day || d.d || 0;
    if (dayNum > maxDay) maxDay = dayNum;
  });
  
  return maxDay || days.length || 1;
}

function ensureGroupsV2PlanDeck() {
  let deck = document.getElementById('groupsV2PlanDeck');
  if (deck) return deck;
  const planControls = document.getElementById('groupsV2PlanControls');
  const planForm = document.getElementById('groupsV2PlanForm');
  const host = (planControls && planControls.parentNode) ? planControls.parentNode : planForm;
  if (!host) return null;
  deck = document.createElement('div');
  deck.id = 'groupsV2PlanDeck';
  deck.style.display = 'grid';
  deck.style.gridTemplateColumns = 'repeat(auto-fit,minmax(280px,1fr))';
  deck.style.gap = '12px';
  deck.style.margin = '12px 0 18px 0';
  deck.style.alignItems = 'stretch';
  if (planControls && planControls.parentNode) {
    planControls.parentNode.insertBefore(deck, planControls.nextSibling);
  } else {
    host.appendChild(deck);
  }
  return deck;
}

// Keep Plan and Light cards visually aligned: same header start and overall height
function alignGroupsV2CardLayout() {
  try {
    const planCard = document.getElementById('groupsV2PlanCard');
    const lightCard = document.getElementById('groupsV2LightCard');
    if (!planCard || !lightCard) return;

    const planHeader = planCard.querySelector('.group-info-card__header');
    const lightHeader = lightCard.querySelector('.group-info-card__header');
    if (!planHeader || !lightHeader) return;

    const BUFFER = 16; // small breathing room to avoid immediate scrollbars

    // Reset any previous constraints before measuring
    [planHeader, lightHeader].forEach(h => { h.style.minHeight = ''; });
    [planCard, lightCard].forEach(c => { c.style.minHeight = ''; c.style.maxHeight = ''; c.style.overflow = ''; c.style.display = ''; c.style.flexDirection = ''; });
    const planBody = planCard.querySelector('.group-info-card__body');
    const lightBody = lightCard.querySelector('.group-info-card__body');
    if (planBody) { planBody.style.maxHeight = ''; planBody.style.overflow = ''; }
    if (lightBody) { lightBody.style.maxHeight = ''; lightBody.style.overflow = ''; }

    // Measure plan header height and apply as minimum to both headers (align starting point)
    const headerRect = planHeader.getBoundingClientRect();
    const headerHeight = Math.ceil(headerRect.height || 0);
    if (headerHeight > 0) {
      planHeader.style.minHeight = headerHeight + 'px';
      lightHeader.style.minHeight = headerHeight + 'px';
    }

    // Target the plan card's current height as the cap for both cards
    const planRect = planCard.getBoundingClientRect();
    const targetHeight = Math.ceil(planRect.height || 0);
    if (targetHeight > 0) {
      // Cap both cards and make their content areas scroll when needed
      [planCard, lightCard].forEach(c => {
        c.style.display = 'flex';
        c.style.flexDirection = 'column';
        c.style.maxHeight = (targetHeight + BUFFER) + 'px';
        c.style.overflow = 'hidden';
      });

      // Compute available height for each body = target - (sum of non-body children heights)
      const computeBodyMax = (card, body) => {
        if (!card || !body) return null;
        let nonBodyHeight = 0;
        Array.from(card.children).forEach(ch => {
          if (ch !== body) {
            const r = ch.getBoundingClientRect();
            nonBodyHeight += Math.ceil(r.height || 0);
          }
        });
        const max = targetHeight - nonBodyHeight - BUFFER;
        return max > 80 ? max : 80; // ensure a minimum usable area
      };

      const planBodyMax = computeBodyMax(planCard, planBody);
      const lightBodyMax = computeBodyMax(lightCard, lightBody);

      if (planBody && planBodyMax) {
        planBody.style.maxHeight = planBodyMax + 'px';
        planBody.style.overflow = 'auto';
      }
      if (lightBody && lightBodyMax) {
        lightBody.style.maxHeight = lightBodyMax + 'px';
        lightBody.style.overflow = 'auto';
      }

      // Additionally cap the Assigned Fixtures list specifically so it doesn't dominate
      const assigned = lightCard.querySelector('#groupsV2AssignedLightsList');
      if (assigned && lightBodyMax) {
        // Measure other content inside the light body aside from the assigned list
        const bodyChildren = Array.from(lightBody.children);
        let others = 0;
        bodyChildren.forEach(ch => {
          if (ch !== assigned) {
            const r = ch.getBoundingClientRect();
            others += Math.ceil(r.height || 0);
          }
        });
        let assignedMax = lightBodyMax - others - BUFFER;
        const MIN_ASSIGNED = 120;
        if (!Number.isFinite(assignedMax) || assignedMax < MIN_ASSIGNED) assignedMax = MIN_ASSIGNED;
        assigned.style.maxHeight = Math.floor(assignedMax) + 'px';
        assigned.style.overflowY = 'auto';
      }
    }
  } catch (err) {
    console.warn('[Groups V2] alignGroupsV2CardLayout failed:', err);
  }
}

function formatGroupsV2GroupLabel(group) {
  if (!group || typeof group !== 'object') return '';
  const room = group.room || group.roomName || '';
  const zone = group.zone || '';
  const name = group.name || group.label || '';
  return [room, zone, name].filter(Boolean).join(':');
}

function getGroupsV2ActiveGroup() {
  if (!window.STATE || !Array.isArray(window.STATE.groups) || !window.STATE.groups.length) return null;
  const groups = window.STATE.groups;
  const loadSelect = document.getElementById('groupsV2LoadGroup');
  if (loadSelect && loadSelect.value) {
    const raw = loadSelect.value;
    const direct = groups.find((g) => g && String(g.id || '') === String(raw));
    if (direct) return direct;
    const byLabel = groups.find((g) => formatGroupsV2GroupLabel(g) === raw);
    if (byLabel) return byLabel;
  }
  return groups[groups.length - 1] || null;
}

function getGroupsV2AssignedLightIds() {
  const assigned = new Set();
  if (!window.STATE || !Array.isArray(window.STATE.groups)) return assigned;
  window.STATE.groups.forEach((group) => {
    if (!group || !Array.isArray(group.lights)) return;
    group.lights.forEach((entry) => {
      if (!entry) return;
      // CRITICAL: Use same identifier priority order as dropdown option values (line 1067)
      // Priority: id → serial → deviceId → name
      const identifier = typeof entry === 'string'
        ? entry
        : (entry.id || entry.serial || entry.deviceId || entry.lightId || entry.name || null);
      if (identifier != null) assigned.add(String(identifier));
    });
  });
  return assigned;
}

// Render the plan card for Group V2 Setup
function renderGroupsV2PlanCard(plan, dayNumber) {
  const deck = ensureGroupsV2PlanDeck();
  if (!deck) return;
  let card = document.getElementById('groupsV2PlanCard');
  if (!card) {
    card = document.createElement('section');
    card.id = 'groupsV2PlanCard';
    card.className = 'group-info-card';
    deck.appendChild(card);
  } else if (card.parentElement !== deck) {
    deck.appendChild(card);
  }
  if (!plan) {
    card.classList.add('is-empty');
    card.innerHTML = '<div class="tiny text-muted">Select a plan to view spectrum, DLI, and PPFD targets.</div>';
    renderGroupsV2LightCard(null);
    return;
  }
  card.classList.remove('is-empty');
  
  // Determine current day
  const totalDays = getPlanTotalDays(plan);
  const currentDay = Number.isFinite(dayNumber) ? Math.max(1, Math.min(dayNumber, totalDays)) : 1;
  
  // Get day-specific data
  const dayData = getPlanDayData(plan, currentDay);
  const spectrum = dayData.spectrum;
  const initialBandTargets = null; // Matrix solver disabled
  
  // Use schedule photoperiod if available, otherwise use plan photoperiod
  const scheduleConfig = buildGroupsV2ScheduleConfig();
  const scheduleHours = Number.isFinite(scheduleConfig.durationHours) ? scheduleConfig.durationHours : null;
  const planPhotoperiod = dayData.photoperiod;
  const photoperiod = Number.isFinite(scheduleHours) && scheduleHours > 0 ? scheduleHours : planPhotoperiod;
  
  // Recalculate PPFD based on DLI target if photoperiod is set
  const planPpfd = dayData.ppfd;
  const planDli = dayData.dli;
  let ppfd = planPpfd;
  let dli = planDli;
  
  // If DLI target exists and photoperiod is set, recalculate PPFD to achieve DLI
  if (Number.isFinite(planDli) && planDli > 0 && Number.isFinite(photoperiod) && photoperiod > 0) {
    ppfd = (planDli * 1e6) / (3600 * photoperiod);
    dli = planDli; // Keep target DLI
  } else if (Number.isFinite(ppfd) && Number.isFinite(photoperiod) && photoperiod > 0) {
    // Recalculate DLI from PPFD and photoperiod
    dli = (ppfd * 3600 * photoperiod) / 1e6;
  }
  
  // Get temperature from plan (checking gradients)
  const planTempC = dayData.tempC;
  const gradientTemp = toNumberOrNull(groupsV2FormState.gradients.tempC) || 0;
  const tempC = Number.isFinite(planTempC) ? planTempC + gradientTemp : planTempC;
  
  const hasPpfd = Number.isFinite(ppfd) && ppfd > 0;
  const hasDli = Number.isFinite(dli) && dli > 0;
  const hasTemp = Number.isFinite(tempC);
  
  const ppfdLabel = hasPpfd ? `${Number(ppfd).toFixed(0)} µmol·m⁻²·s⁻¹` : '—';
  const dliLabel = hasDli ? `${Number(dli).toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  const photoperiodLabel = Number.isFinite(photoperiod) && photoperiod > 0 ? `${Number(photoperiod).toFixed(1)} h` : '—';
  const tempLabel = hasTemp ? `${Number(tempC).toFixed(1)}°C` : '—';
  
  const description = plan.description || 'Spectrum and targets for this plan.';
  
  // Get spectrum weighting percentages (all 6 channels)
  let cwPct = Number(spectrum.cw || 0);
  let wwPct = Number(spectrum.ww || 0);
  let blPct = Number(spectrum.bl || 0);
  let gnPct = Number(spectrum.gn || 0);
  let rdPct = Number(spectrum.rd || 0);
  let frPct = Number(spectrum.fr || 0);

  // Check if spectrum needs conversion from bands to channels
  // Use solver if: 1) dayBandTargets exist, OR 2) spectrum has band data but no/minimal channel data
  const dayBandTargets = dayData && dayData.bandTargets ? dayData.bandTargets : null;
  const hasBands = (blPct > 0 || gnPct > 0 || rdPct > 0 || frPct > 0);
  const hasChannels = (cwPct > 0 || wwPct > 0);
  const needsConversion = dayBandTargets || (hasBands && !hasChannels);
  
  let solvedChannels = null;
  if (needsConversion && typeof window.solveChannelsFromBands === 'function' && window.STATE && window.STATE.calibrationMatrix) {
    try {
      const intensity = 100; // percentage; can be extended later if dayData includes intensity
      // Use dayBandTargets if available, otherwise use spectrum bands
      const bands = dayBandTargets ? dayBandTargets : {
        B: blPct,
        G: gnPct,
        R: rdPct,
        FR: frPct
      };
      console.log('[Groups V2] Converting spectral bands to channel mix:', bands);
      const solverResult = window.solveChannelsFromBands(
        { B: bands.B || 0, G: bands.G || 0, R: bands.R || 0, FR: bands.FR || 0 },
        window.STATE.calibrationMatrix,
        { tolerance: 0.05, maxPower: 100 }
      );
      if (solverResult && solverResult.channels) {
        solvedChannels = solverResult.channels; // values already in 0-100%
        cwPct = Number(solvedChannels.cw || 0);
        wwPct = Number(solvedChannels.ww || 0);
        blPct = Number(solvedChannels.bl || 0);
        rdPct = Number(solvedChannels.rd || 0);
        console.log('[Groups V2] Solved channel mix:', { cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct });
      }
    } catch (err) {
      console.warn('[Groups V2] Spectrum solver failed, falling back to plan mix:', err);
    }
  } else if (needsConversion) {
    // FALLBACK: Use heuristic conversion when calibration matrix unavailable
    console.log('[Groups V2] Using fallback heuristic (no calibration matrix)');
    const bands = dayBandTargets ? dayBandTargets : {
      B: blPct,
      G: gnPct,
      R: rdPct,
      FR: frPct
    };
    
    // Heuristic assumptions:
    // - Green primarily from whites (CW + WW split evenly)
    // - Blue stays on BL channel (minimal white contribution)
    // - Red stays on RD channel (minimal white contribution)
    const greenFraction = bands.G / 100;
    const whitePower = greenFraction * 100;
    
    cwPct = whitePower * 0.5;
    wwPct = whitePower * 0.5;
    blPct = bands.B;
    rdPct = bands.R;
    
    console.log('[Groups V2] Fallback channels:', {cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct});
  }
  
  // Card HTML
  card.innerHTML = `
    <header class="group-info-card__header" style="display: flex; justify-content: space-between; align-items: flex-start;">
      <div>
        <h3>Plan: ${escapeHtml(plan.name || 'Untitled')}</h3>
        <p class="tiny text-muted">${escapeHtml(description)}</p>
      </div>
      <button type="button" class="ghost danger" data-action="delete-plan" style="margin-top: 4px; white-space: nowrap;">Delete Plan</button>
    </header>
    <div class="group-info-card__body" style="flex-direction: column; gap: 10px;">
  <canvas id="groupsV2PlanSpectrumCanvas" class="group-info-card__canvas" width="280" height="100" role="img" aria-label="Plan spectrum preview" style="width: 100%;"></canvas>
      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; min-height: 85px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #475569;">Channel Mix</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          <dt style="font-size: 0.65rem;">Cool White</dt><dd id="groupsV2PlanCw">${cwPct.toFixed(1)}%</dd>
          <dt style="font-size: 0.65rem;">Warm White</dt><dd id="groupsV2PlanWw">${wwPct.toFixed(1)}%</dd>
          <dt style="font-size: 0.65rem;">Blue</dt><dd id="groupsV2PlanBl">${blPct.toFixed(1)}%</dd>
          <dt style="font-size: 0.65rem;">Red</dt><dd id="groupsV2PlanRd">${rdPct.toFixed(1)}%</dd>
        </dl>
      </div>
      <div id="groupsV2PlanColorBreakdown" style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px; min-height: 95px; display: none;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #0369a1;">Spectral Distribution</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          <dt style="font-size: 0.65rem;" title="Violet and blue wavelengths">Blue (400-500nm)</dt><dd id="groupsV2PlanBlue">—</dd>
          <dt style="font-size: 0.65rem;" title="Mid-spectrum: cyan, green, yellow, amber">Green (500-600nm)</dt><dd id="groupsV2PlanGreen">—</dd>
          <dt style="font-size: 0.65rem;" title="Orange and red wavelengths">Red (600-680nm)</dt><dd id="groupsV2PlanRed">—</dd>
          <dt style="font-size: 0.65rem;" title="Far-red and near-infrared">Deep Red (680-750nm)</dt><dd id="groupsV2PlanDeepRed">—</dd>
        </dl>
        <details style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #bae6fd;">
          <summary style="cursor: pointer; font-size: 0.7rem; color: #0369a1; font-weight: 500; user-select: none;">
            ▸ Mid-Spectrum Breakdown
          </summary>
          <div style="margin-top: 10px; padding: 8px; background: rgba(240, 249, 255, 0.5); border-radius: 4px;">
            <div style="font-size: 0.65rem; color: #64748b; margin-bottom: 6px;">
              Assuming uniform distribution across 500-600nm:
            </div>
            <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.7rem;">
              <dt style="font-size: 0.6rem; color: #0891b2;">Cyan (500-520nm)</dt><dd id="groupsV2PlanCyan" style="color: #0891b2;">—</dd>
              <dt style="font-size: 0.6rem; color: #10b981;">True Green (520-560nm)</dt><dd id="groupsV2PlanTrueGreen" style="color: #10b981;">—</dd>
              <dt style="font-size: 0.6rem; color: #eab308;">Yellow (560-590nm)</dt><dd id="groupsV2PlanYellow" style="color: #eab308;">—</dd>
              <dt style="font-size: 0.6rem; color: #f97316;">Amber (590-600nm)</dt><dd id="groupsV2PlanAmber" style="color: #f97316;">—</dd>
            </dl>
          </div>
        </details>
      </div>
      

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; min-height: 115px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #166534;">Plan Day Targets</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          <dt style="font-size: 0.65rem;">Target PPFD</dt><dd id="groupsV2PlanPpfd">${ppfdLabel}</dd>
          <dt style="font-size: 0.65rem;">Target DLI</dt><dd id="groupsV2PlanDli">${dliLabel}</dd>
          <dt style="font-size: 0.65rem;">Photoperiod</dt><dd id="groupsV2PlanPhotoperiod">${photoperiodLabel}</dd>
          <dt style="font-size: 0.65rem;">Temperature</dt><dd id="groupsV2PlanTemp">${tempLabel}</dd>
        </dl>
      </div>
    </div>
    <div style="background: #fefce8; border: 1px solid #fde047; border-radius: 6px; padding: 12px; margin-top: 12px;">
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
        <label for="groupsV2PlanDaySlider" class="tiny" style="font-weight: 600; color: #854d0e;">Day Timeline</label>
        <span id="groupsV2PlanDayLabel" class="tiny" style="font-weight: 600; color: #854d0e;">Day ${currentDay} of ${totalDays}</span>
      </div>
      ${totalDays > 1 ? `
      <input 
        type="range" 
        id="groupsV2PlanDaySlider" 
        min="1" 
        max="${totalDays}" 
        value="${currentDay}" 
        step="1"
      >
      <div style="display: flex; justify-content: space-between; margin-top: 4px;">
        <span class="tiny text-muted">Day 1</span>
        <span class="tiny text-muted">Day ${totalDays}</span>
      </div>
      ` : `
      <div class="tiny text-muted" style="text-align: center; padding: 8px; background: #fef9c3; border-radius: 4px;">
        This plan has only one day. Multi-day plans will show an interactive timeline here.
      </div>
      `}
    </div>
  `;
  
  // Store plan reference for slider updates
  card._currentPlan = plan;
  card._currentDay = currentDay;
  
  // Solver UI remains hidden; we only use the solver to compute a displayable mix when bandTargets are present

  // Render spectrum graph if function available
  const canvas = document.getElementById('groupsV2PlanSpectrumCanvas');
  if (canvas && typeof renderSpectrumCanvas === 'function' && typeof computeWeightedSPD === 'function') {
    // Use solved mix if available, otherwise the plan-provided mix
    const mix = { cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct };
    const spd = computeWeightedSPD(mix);
    renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
    
    // Calculate and display color percentages from SPD
    const colorPcts = calculateSpectrumColorPercentages(spd);
    const colorBreakdownDiv = document.getElementById('groupsV2PlanColorBreakdown');
    if (colorBreakdownDiv) {
      colorBreakdownDiv.style.display = 'block';
      document.getElementById('groupsV2PlanBlue').textContent = `${colorPcts.blue}%`;
      document.getElementById('groupsV2PlanGreen').textContent = `${colorPcts.green}%`;
      document.getElementById('groupsV2PlanRed').textContent = `${colorPcts.red}%`;
      document.getElementById('groupsV2PlanDeepRed').textContent = `${colorPcts.deepRed}%`;
    }
  }
  
  renderGroupsV2LightCard(plan, { dayNumber: currentDay });
  // Attach slider event handler (must happen after innerHTML is set, and only if slider exists for multi-day plans)
  setTimeout(() => {
    const slider = document.getElementById('groupsV2PlanDaySlider');
    if (slider && !slider._listenerAttached) {
      let rafId = null;
      
      // Use 'input' for real-time updates with throttling via requestAnimationFrame
      slider.addEventListener('input', (e) => {
        const newDay = parseInt(e.target.value, 10);
        
        // Cancel any pending animation frame
        if (rafId) {
          cancelAnimationFrame(rafId);
        }
        
        // Schedule update on next animation frame (throttles to 60fps)
        rafId = requestAnimationFrame(() => {
          updatePlanCardForDay(card._currentPlan, newDay);
          rafId = null;
        });
      });
      
      // Use 'change' for final value logging
      slider.addEventListener('change', (e) => {
        const newDay = parseInt(e.target.value, 10);
        console.log('[Groups V2] Day changed to:', newDay);
        updatePlanCardForDay(card._currentPlan, newDay);
      });
      
      slider._listenerAttached = true;
    } else if (totalDays === 1) {
      console.log('[Groups V2] Plan has only 1 day - slider not rendered');
    }
    
    // Attach delete button handler
    const deleteBtn = card.querySelector('[data-action="delete-plan"]');
    if (deleteBtn && !deleteBtn._listenerAttached) {
      deleteBtn.addEventListener('click', () => {
        const planName = plan.name || 'Untitled';
        if (!confirm(`Delete plan "${planName}"?`)) return;
        
        // Remove from STATE.plans
        if (window.STATE && Array.isArray(window.STATE.plans)) {
          window.STATE.plans = window.STATE.plans.filter(p => p.id !== plan.id);
        }
        
        // Unlink from any groups that reference this plan
        if (window.STATE && Array.isArray(window.STATE.groups)) {
          window.STATE.groups.forEach(g => {
            if (g.plan === plan.id) {
              g.plan = '';
            }
          });
        }
        
        // Clear the current plan selection
        groupsV2FormState.planId = '';
        
        // Reset the plan dropdown
        const planSelect = document.getElementById('groupsV2PlanSelect');
        if (planSelect) {
          planSelect.value = '';
        }
        
        // Clear the plan card
        renderGroupsV2PlanCard(null);
        
        // Refresh UI
        populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
        populateGroupsV2ScheduleDropdown();
        
        console.log(`[Groups V2] Plan "${planName}" deleted successfully`);
      });
      deleteBtn._listenerAttached = true;
    }
  }, 0);

  // After both cards have rendered, align their headers and heights
  setTimeout(() => alignGroupsV2CardLayout(), 0);
}

// Update plan card data for a specific day without full re-render
function updatePlanCardForDay(plan, dayNumber) {
  if (!plan) return;
  
  const totalDays = getPlanTotalDays(plan);
  const currentDay = Math.max(1, Math.min(dayNumber, totalDays));
  const dayData = getPlanDayData(plan, currentDay);
  
  // Update day label
  const dayLabel = document.getElementById('groupsV2PlanDayLabel');
  if (dayLabel) dayLabel.textContent = `Day ${currentDay} of ${totalDays}`;
  const container = document.getElementById('groupsV2PlanCard');
  if (container) container._currentDay = currentDay;
  
  // Update spectrum values
  const spectrum = dayData.spectrum;
  console.log(`[updatePlanCardForDay] Day ${currentDay} spectrum:`, spectrum);
  let cwPct = Number(spectrum.cw || 0);
  let wwPct = Number(spectrum.ww || 0);
  let blPct = Number(spectrum.bl || 0);
  let gnPct = Number(spectrum.gn || 0);
  let rdPct = Number(spectrum.rd || 0);
  let frPct = Number(spectrum.fr || 0);
  console.log(`[updatePlanCardForDay] Extracted: CW=${cwPct}, WW=${wwPct}, BL=${blPct}, GN=${gnPct}, RD=${rdPct}, FR=${frPct}`);

  // Check if spectrum needs conversion from bands to channels
  // Use solver if: 1) dayBandTargets exist, OR 2) spectrum has band data but no/minimal channel data
  const dayBandTargets = dayData && dayData.bandTargets ? dayData.bandTargets : null;
  const hasBands = (blPct > 0 || gnPct > 0 || rdPct > 0 || frPct > 0);
  const hasChannels = (cwPct > 0 || wwPct > 0);
  const needsConversion = dayBandTargets || (hasBands && !hasChannels);
  
  if (needsConversion && typeof window.solveChannelsFromBands === 'function' && window.STATE && window.STATE.calibrationMatrix) {
    try {
      // Use dayBandTargets if available, otherwise use spectrum bands
      const bands = dayBandTargets ? dayBandTargets : {
        B: blPct,
        G: gnPct,
        R: rdPct,
        FR: frPct
      };
      console.log('[updatePlanCardForDay] Converting spectral bands to channel mix:', bands);
      const solverResult = window.solveChannelsFromBands(
        { B: bands.B || 0, G: bands.G || 0, R: bands.R || 0, FR: bands.FR || 0 },
        window.STATE.calibrationMatrix,
        { tolerance: 0.05, maxPower: 100 }
      );
      if (solverResult && solverResult.channels) {
        cwPct = Number(solverResult.channels.cw || 0);
        wwPct = Number(solverResult.channels.ww || 0);
        blPct = Number(solverResult.channels.bl || 0);
        rdPct = Number(solverResult.channels.rd || 0);
        console.log('[updatePlanCardForDay] Solved channel mix:', { cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct });
      }
    } catch (err) {
      console.warn('[updatePlanCardForDay] Spectrum solver failed:', err);
    }
  } else if (needsConversion) {
    // FALLBACK: Use heuristic conversion when calibration matrix unavailable
    console.log('[updatePlanCardForDay] Using fallback heuristic (no calibration matrix)');
    const bands = dayBandTargets ? dayBandTargets : {
      B: blPct,
      G: gnPct,
      R: rdPct,
      FR: frPct
    };
    
    // Heuristic assumptions:
    // - Green primarily from whites (CW + WW split evenly)
    // - Blue stays on BL channel (minimal white contribution)
    // - Red stays on RD channel (minimal white contribution)
    const greenFraction = bands.G / 100;
    const whitePower = greenFraction * 100;
    
    cwPct = whitePower * 0.5;
    wwPct = whitePower * 0.5;
    blPct = bands.B;
    rdPct = bands.R;
    
    console.log('[updatePlanCardForDay] Fallback channels:', {cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct});
  }
  
  const cwEl = document.getElementById('groupsV2PlanCw');
  const wwEl = document.getElementById('groupsV2PlanWw');
  const blEl = document.getElementById('groupsV2PlanBl');
  const gnEl = document.getElementById('groupsV2PlanGn');
  const rdEl = document.getElementById('groupsV2PlanRd');
  const frEl = document.getElementById('groupsV2PlanFr');
  
  if (cwEl) cwEl.textContent = `${cwPct.toFixed(1)}%`;
  if (wwEl) wwEl.textContent = `${wwPct.toFixed(1)}%`;
  if (blEl) blEl.textContent = `${blPct.toFixed(1)}%`;
  if (gnEl) gnEl.textContent = `${gnPct.toFixed(1)}%`;
  if (rdEl) rdEl.textContent = `${rdPct.toFixed(1)}%`;
  if (frEl) frEl.textContent = `${frPct.toFixed(1)}%`;
  
  // Update targets with schedule photoperiod and recalculated PPFD/DLI
  const scheduleConfig = buildGroupsV2ScheduleConfig();
  const scheduleHours = Number.isFinite(scheduleConfig.durationHours) ? scheduleConfig.durationHours : null;
  const planPhotoperiod = dayData.photoperiod;
  const photoperiod = Number.isFinite(scheduleHours) && scheduleHours > 0 ? scheduleHours : planPhotoperiod;
  
  // Recalculate PPFD based on DLI target if photoperiod is set
  const planPpfd = dayData.ppfd;
  const planDli = dayData.dli;
  let ppfd = planPpfd;
  let dli = planDli;
  
  // If DLI target exists and photoperiod is set, recalculate PPFD to achieve DLI
  if (Number.isFinite(planDli) && planDli > 0 && Number.isFinite(photoperiod) && photoperiod > 0) {
    ppfd = (planDli * 1e6) / (3600 * photoperiod);
    dli = planDli; // Keep target DLI
  } else if (Number.isFinite(ppfd) && Number.isFinite(photoperiod) && photoperiod > 0) {
    // Recalculate DLI from PPFD and photoperiod
    dli = (ppfd * 3600 * photoperiod) / 1e6;
  }
  
  // Get temperature from plan (checking gradients)
  const planTempC = dayData.tempC;
  const gradientTemp = toNumberOrNull(groupsV2FormState.gradients.tempC) || 0;
  const tempC = Number.isFinite(planTempC) ? planTempC + gradientTemp : planTempC;
  
  const ppfdEl = document.getElementById('groupsV2PlanPpfd');
  const dliEl = document.getElementById('groupsV2PlanDli');
  const photoperiodEl = document.getElementById('groupsV2PlanPhotoperiod');
  const tempEl = document.getElementById('groupsV2PlanTemp');
  
  if (ppfdEl) ppfdEl.textContent = Number.isFinite(ppfd) && ppfd > 0 ? `${Number(ppfd).toFixed(0)} µmol·m⁻²·s⁻¹` : '—';
  if (dliEl) dliEl.textContent = Number.isFinite(dli) && dli > 0 ? `${Number(dli).toFixed(2)} mol·m⁻²·d⁻¹` : '—';
  if (photoperiodEl) photoperiodEl.textContent = Number.isFinite(photoperiod) && photoperiod > 0 ? `${Number(photoperiod).toFixed(1)} h` : '—';
  if (tempEl) tempEl.textContent = Number.isFinite(tempC) ? `${Number(tempC).toFixed(1)}°C` : '—';
  
  // Re-render spectrum canvas
  const canvas = document.getElementById('groupsV2PlanSpectrumCanvas');
  if (canvas && typeof renderSpectrumCanvas === 'function' && typeof computeWeightedSPD === 'function') {
  // Use solver-computed mix if available, otherwise plan-provided channels
  const actualMix = { cw: cwPct, ww: wwPct, bl: blPct, rd: rdPct };
    
    // Compute SPD with 4 physical LED driver channels
    const mix = actualMix;
    console.log('[updatePlanCardForDay] Computing SPD with 4-channel mix:', mix);
  const spd = computeWeightedSPD(mix);
    console.log('[updatePlanCardForDay] SPD weights:', spd.weights);
    renderSpectrumCanvas(canvas, spd, { width: canvas.width, height: canvas.height });
    
    // Update spectral distribution (wavelength-based output percentages)
  const colorPcts = calculateSpectrumColorPercentages(spd);
    console.log('[updatePlanCardForDay] Spectral band percentages:', colorPcts);
    document.getElementById('groupsV2PlanBlue').textContent = `${colorPcts.blue}%`;
    document.getElementById('groupsV2PlanGreen').textContent = `${colorPcts.green}%`;
    document.getElementById('groupsV2PlanRed').textContent = `${colorPcts.red}%`;
    document.getElementById('groupsV2PlanDeepRed').textContent = `${colorPcts.deepRed}%`;
    
    // Update mid-spectrum breakdown
  const midBreakdown = calculateMidSpectrumBreakdown(spd, colorPcts.green);
    console.log('[updatePlanCardForDay] Mid-spectrum breakdown:', midBreakdown);
    const cyanEl = document.getElementById('groupsV2PlanCyan');
    const trueGreenEl = document.getElementById('groupsV2PlanTrueGreen');
    const yellowEl = document.getElementById('groupsV2PlanYellow');
    const amberEl = document.getElementById('groupsV2PlanAmber');
    if (cyanEl) cyanEl.textContent = `${midBreakdown.cyan}%`;
    if (trueGreenEl) trueGreenEl.textContent = `${midBreakdown.trueGreen}%`;
    if (yellowEl) yellowEl.textContent = `${midBreakdown.yellow}%`;
    if (amberEl) amberEl.textContent = `${midBreakdown.amber}%`;
  }

  renderGroupsV2LightCard(plan, { dayNumber: currentDay });

  // Keep card alignment consistent when day changes adjust heights
  setTimeout(() => alignGroupsV2CardLayout(), 0);
}

/**
 * Update the solver UI section with band targets and results
 */
function updateSolverUI(bandTargets, solverResult, intensity) {
  const solverSection = document.getElementById('groupsV2SolverSection');
  if (!solverSection) {
    console.warn('[updateSolverUI] Solver section not found in DOM');
    return;
  }
  
  // Show the solver section
  solverSection.style.display = 'block';
  
  // Update target bands
  document.getElementById('groupsV2SolverTargetB').textContent = `${(bandTargets.B || 0).toFixed(1)}%`;
  document.getElementById('groupsV2SolverTargetG').textContent = `${(bandTargets.G || 0).toFixed(1)}%`;
  document.getElementById('groupsV2SolverTargetR').textContent = `${(bandTargets.R || 0).toFixed(1)}%`;
  document.getElementById('groupsV2SolverTargetFR').textContent = `${(bandTargets.FR || 0).toFixed(1)}%`;
  
  // Update achieved bands
  const achieved = solverResult.achieved;
  document.getElementById('groupsV2SolverAchievedB').textContent = `${(achieved.B * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverAchievedG').textContent = `${(achieved.G * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverAchievedR').textContent = `${(achieved.R * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverAchievedFR').textContent = `${(achieved.FR * 100).toFixed(1)}%`;
  
  // Update computed channels
  const channels = solverResult.channels;
  document.getElementById('groupsV2SolverCw').textContent = `${(channels.cw * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverWw').textContent = `${(channels.ww * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverBl').textContent = `${(channels.bl * 100).toFixed(1)}%`;
  document.getElementById('groupsV2SolverRd').textContent = `${(channels.rd * 100).toFixed(1)}%`;
  
  // Update error metric
  const errorPct = (solverResult.error * 100).toFixed(2);
  const errorEl = document.getElementById('groupsV2SolverError');
  errorEl.textContent = `${errorPct}%`;
  
  // Color code error: green if within tolerance, yellow if close, red if poor
  if (solverResult.withinTolerance) {
    errorEl.style.color = '#16a34a';
    errorEl.title = 'Excellent fit - within tolerance';
  } else if (solverResult.error < 0.10) {
    errorEl.style.color = '#ca8a04';
    errorEl.title = 'Good fit - slightly outside tolerance';
  } else {
    errorEl.style.color = '#dc2626';
    errorEl.title = 'Poor fit - check fixture capabilities';
  }
  
  console.log('[updateSolverUI] Updated solver UI with results');
}

/**
 * Hide the solver UI section (for legacy channel-based recipes)
 */
function hideSolverUI() {
  const solverSection = document.getElementById('groupsV2SolverSection');
  if (solverSection) {
    solverSection.style.display = 'none';
  }
}

function renderGroupsV2LightCard(plan, options) {
  const deck = ensureGroupsV2PlanDeck();
  if (!deck) return;
  let card = document.getElementById('groupsV2LightCard');
  if (!card) {
    card = document.createElement('section');
    card.id = 'groupsV2LightCard';
    card.className = 'group-info-card';
    deck.appendChild(card);
  } else if (card.parentElement !== deck) {
    deck.appendChild(card);
  }

  const group = getGroupsV2ActiveGroup();
  const inferredDay = options && Number.isFinite(options.dayNumber)
    ? options.dayNumber
    : (document.getElementById('groupsV2PlanCard') && Number.isFinite(document.getElementById('groupsV2PlanCard')._currentDay)
        ? document.getElementById('groupsV2PlanCard')._currentDay
        : (typeof getGroupsV2DayNumber === 'function' ? getGroupsV2DayNumber() || 1 : 1));
  const dayNumber = Number.isFinite(inferredDay) && inferredDay > 0 ? inferredDay : 1;
  
  // PRIORITY: Use the group's assigned plan if it exists, otherwise use the passed-in plan
  let effectivePlan = plan;
  if (group && group.plan) {
    const plans = getGroupsV2Plans();
    const groupPlan = plans.find((p) => (p.id === group.plan) || (p.key === group.plan) || (p.name === group.plan));
    if (groupPlan) {
      effectivePlan = groupPlan;
      console.log('[renderGroupsV2LightCard] Using group assigned plan:', groupPlan.name, 'instead of dropdown plan:', plan ? plan.name : 'null');
    }
  }
  
  const planDayData = effectivePlan ? getPlanDayData(effectivePlan, dayNumber) : null;

  if (!group) {
    card.classList.add('is-empty');
    card.innerHTML = '<div class="tiny text-muted">Load a group to compare assigned fixtures with the selected plan.</div>';
    return;
  }
  const lights = Array.isArray(group.lights) ? group.lights : [];
  if (!lights.length) {
    card.classList.add('is-empty');
    card.innerHTML = '<div class="tiny text-muted">Assign fixtures to this group to see spectrum coverage and PPF comparisons.</div>';
    return;
  }

  // Determine effective plan spectrum for tunable driver targets:
  // - If bandTargets exist, use spectrum solver to compute channel mix so tunable lights mirror plan spectrum
  // - Otherwise, use plan-provided spectrum
  let effectivePlanSpectrumForDrivers = (planDayData && planDayData.spectrum) || (effectivePlan && effectivePlan.spectrum) || { cw: 45, ww: 45, bl: 0, rd: 0 };
  if (planDayData && planDayData.bandTargets && typeof window.solveChannelsFromBands === 'function' && window.STATE && window.STATE.calibrationMatrix) {
    try {
      const r = window.solveChannelsFromBands(
        { B: planDayData.bandTargets.B || 0, G: planDayData.bandTargets.G || 0, R: planDayData.bandTargets.R || 0, FR: planDayData.bandTargets.FR || 0 },
        window.STATE.calibrationMatrix,
        { tolerance: 0.05, maxPower: 100 }
      );
      if (r && r.channels) {
        effectivePlanSpectrumForDrivers = {
          cw: Number(r.channels.cw || 0),
          ww: Number(r.channels.ww || 0),
          bl: Number(r.channels.bl || 0),
          rd: Number(r.channels.rd || 0),
        };
      }
    } catch (err) {
      console.warn('[renderGroupsV2LightCard] Spectrum solver failed for drivers, using plan spectrum:', err);
    }
  }
  const fallbackSpectrum = effectivePlanSpectrumForDrivers;
  console.log('[renderGroupsV2LightCard] Plan spectrum for tunable lights (effective):', fallbackSpectrum);
  console.log('[renderGroupsV2LightCard] planDayData:', planDayData);
  console.log('[renderGroupsV2LightCard] Day number:', dayNumber);
  

  const mixInfo = buildSelectedLightMix(group, fallbackSpectrum);
  console.log('[renderGroupsV2LightCard] mixInfo from buildSelectedLightMix:', mixInfo);

  // Always render a card, even if mixInfo is null (missing spectrum/factory data)
  if (!mixInfo) {
    // Defensive: only show fallback if group and lights are valid
    if (!group || !Array.isArray(lights) || lights.length === 0) {
      card.classList.add('is-empty');
      card.innerHTML = '<div class="tiny text-muted">Assign fixtures to this group to see spectrum coverage and PPF comparisons.</div>';
      return;
    }
    // Fallback: show warning, assigned lights, and minimal info
    card.classList.remove('is-empty');
    try {
      // Limit to 50 lights to prevent UI hang
      const safeLights = lights.slice(0, 50);
      const records = [];
      let totalFixtures = 0;
      for (let i = 0; i < safeLights.length; ++i) {
        const entry = safeLights[i];
        const entryObj = (entry && typeof entry === 'object') ? entry : null;
        const lightId = entryObj ? (entryObj.id || entryObj.lightId || entryObj.deviceId) : (typeof entry === 'string' ? entry : null);
        if (!lightId) continue;
        const meta = getDeviceMeta(lightId) || {};
        const setupInfo = findSetupFixtureById(lightId);
        const setupFixture = setupInfo ? setupInfo.fixture : null;
        const vendor = meta.vendor || (setupFixture && setupFixture.vendor) || '';
        const model = meta.model || (setupFixture && setupFixture.model) || '';
        const displayName = entryObj && entryObj.name
          ? entryObj.name
          : (meta.deviceName || [vendor, model].filter(Boolean).join(' ').trim() || lightId);
        const countCandidate = entryObj
          ? (entryObj.count ?? entryObj.qty ?? entryObj.quantity ?? entryObj.units ?? entryObj.total)
          : null;
        const parsedCount = Number(countCandidate);
        const weight = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
        records.push({ id: lightId, name: displayName, weight });
        totalFixtures += weight;
      }
      const summaryMap = new Map();
      records.forEach((record) => {
        const label = record.name || record.id;
        const prev = summaryMap.get(label) || 0;
        summaryMap.set(label, prev + record.weight);
      });
      const summaryEntries = Array.from(summaryMap.entries()).sort((a, b) => b[1] - a[1]);
      const summaryParts = summaryEntries.slice(0, 3).map(([label, count]) => {
        const rounded = Math.abs(count - Math.round(count)) < 0.01 ? String(Math.round(count)) : count.toFixed(1);
        return `${label} ×${rounded}`;
      });
      if (summaryEntries.length > summaryParts.length) summaryParts.push('...');
      const summaryText = summaryParts.length ? summaryParts.join(' • ') : 'Assign fixtures to populate info.';
      const groupLabel = formatGroupsV2GroupLabel(group) || (group && group.name) || 'Active group';
      card.innerHTML = `
        <div class="groups-v2-lightcard-fallback">
          <div class="text-warning" style="font-size:1rem;margin-bottom:0.5em;"> Spectrum/factory data missing for one or more assigned lights.</div>
          <div class="tiny text-muted" style="margin-bottom:0.5em;">Some static lights may not report spectrum or PPF. Info shown below is limited.</div>
          <div style="font-weight:600;">${escapeHtml(groupLabel)}</div>
          <div style="margin:0.5em 0 0.25em 0;">${escapeHtml(summaryText)}</div>
          <div class="tiny text-muted">Total fixtures: ${totalFixtures}</div>
        </div>
      `;
    } catch (err) {
      card.classList.add('is-empty');
      card.innerHTML = '<div class="tiny text-danger">Error rendering info card: ' + escapeHtml(err && err.message ? err.message : String(err)) + '</div>';
    }
    return;
  }

  const actualMix = {
    cw: Number(mixInfo.mix.cw || 0),
    ww: Number(mixInfo.mix.ww || 0),
    bl: Number(mixInfo.mix.bl || 0),
    rd: Number(mixInfo.mix.rd || 0),
  };
  const records = [];
  let totalFixtures = 0;
  let dynamicFixtures = 0;
  let staticFixtures = 0;
  let totalPpf = 0;
  let ppfSamples = 0;

  lights.forEach((entry, idx) => {
    const entryObj = (entry && typeof entry === 'object') ? entry : null;
    const lightId = entryObj ? (entryObj.id || entryObj.lightId || entryObj.deviceId) : (typeof entry === 'string' ? entry : null);
    if (!lightId) return;
    const meta = getDeviceMeta(lightId) || {};
    const setupInfo = findSetupFixtureById(lightId);
    const setupFixture = setupInfo ? setupInfo.fixture : null;
    
    // Look up light in database to get dynamicSpectrum property
    const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
    const dbLight = lightsDb.find(l => 
      l.id === lightId || 
      l.serial === lightId || 
      l.deviceId === lightId ||
      (entryObj && (l.id === entryObj.id || l.serial === entryObj.serial || l.deviceId === entryObj.deviceId))
    );
    
    const controlRaw = [meta.control, setupFixture && setupFixture.control, meta.transport, meta.protocol]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const spectrumMode = String(meta.spectrumMode || '').toLowerCase();
    
    // Check if light is tunable using database dynamicSpectrum property
    // Priority: entryObj (assigned light) > database dynamicSpectrum > explicit tunable property > inferred from control
    let isTunable = null;
    
    // First check the assigned light object itself (preserves tunability on assignment)
    if (entryObj && typeof entryObj.dynamicSpectrum === 'boolean') {
      isTunable = entryObj.dynamicSpectrum;
    } else if (entryObj && typeof entryObj.tunable === 'boolean') {
      isTunable = entryObj.tunable;
    } else if (entryObj && entryObj.spectrally_tunable) {
      const spectrallyTunable = String(entryObj.spectrally_tunable).toLowerCase();
      isTunable = (spectrallyTunable === 'yes' || spectrallyTunable === 'true');
    }
    // Then check database
    else if (dbLight && typeof dbLight.dynamicSpectrum === 'boolean') {
      isTunable = dbLight.dynamicSpectrum;
    } else if (dbLight && typeof dbLight.tunable === 'boolean') {
      isTunable = dbLight.tunable;
    } else if (dbLight && dbLight.spectrally_tunable) {
      const spectrallyTunable = String(dbLight.spectrally_tunable).toLowerCase();
      isTunable = (spectrallyTunable === 'yes' || spectrallyTunable === 'true');
    }
    // Then check meta/setup
    else if (typeof meta.tunable === 'boolean') {
      isTunable = meta.tunable;
    } else if (typeof setupFixture?.tunable === 'boolean') {
      isTunable = setupFixture.tunable;
    }
    
    // If still unknown, infer from control method (fallback only)
    const isDynamic = isTunable === true || 
      (isTunable !== false && (spectrumMode === 'dynamic' || /dynamic|api|lan|wifi|grow3|driver/.test(controlRaw)));
    
    const countCandidate = entryObj
      ? (entryObj.count ?? entryObj.qty ?? entryObj.quantity ?? entryObj.units ?? entryObj.total)
      : null;
    const parsedCount = Number(countCandidate);
    const weight = Number.isFinite(parsedCount) && parsedCount > 0 ? parsedCount : 1;
    const vendor = meta.vendor || (setupFixture && setupFixture.vendor) || '';
    const model = meta.model || (setupFixture && setupFixture.model) || '';
    const displayName = entryObj && entryObj.name
      ? entryObj.name
      : (meta.deviceName || [vendor, model].filter(Boolean).join(' ').trim() || lightId);
    const ppfCandidates = [
      entryObj && entryObj.ppf,
      entryObj && entryObj.ppfd,
      entryObj && entryObj.ppfAvg,
      entryObj && entryObj.metrics && entryObj.metrics.ppf,
      entryObj && entryObj.metrics && entryObj.metrics.ppfd,
      entryObj && entryObj.output && entryObj.output.ppf,
      entryObj && entryObj.output && entryObj.output.ppfd,
      meta.ppf,
      meta.ppfd,
      meta.ppfdTarget,
      meta.metrics && meta.metrics.ppf,
      meta.metrics && meta.metrics.ppfd,
      meta.output && meta.output.ppf,
      meta.output && meta.output.ppfd,
      setupFixture && setupFixture.ppf,
      setupFixture && setupFixture.ppfd,
      setupFixture && setupFixture.metrics && setupFixture.metrics.ppf,
      setupFixture && setupFixture.metrics && setupFixture.metrics.ppfd
    ];
    let ppf = null;
    for (const candidate of ppfCandidates) {
      const value = Number(candidate);
      if (Number.isFinite(value) && value > 0) {
        ppf = value;
        break;
      }
    }
    records.push({ id: lightId, name: displayName, weight, dynamic: isDynamic, ppf });
    totalFixtures += weight;
    if (isDynamic) dynamicFixtures += weight;
    else staticFixtures += weight;
    if (Number.isFinite(ppf) && ppf > 0) {
      totalPpf += ppf * weight;
      ppfSamples += weight;
    }
  });

  if (!records.length || totalFixtures <= 0) {
    card.classList.add('is-empty');
    card.innerHTML = '<div class="tiny text-muted">Fixture details are missing for this group.</div>';
    return;
  }

  const planSpectrum = effectivePlanSpectrumForDrivers;
  console.log('[renderGroupsV2LightCard] planSpectrum for comparison:', planSpectrum);

  const planPercentages = computeChannelPercentages(planSpectrum).percentages;
  console.log('[renderGroupsV2LightCard] planPercentages after normalization:', planPercentages);
  console.log('[renderGroupsV2LightCard] actualMix from lights (combined static + tunable targets):', actualMix);

  const channels = [
    { key: 'cw', label: 'Cool White' },
    { key: 'ww', label: 'Warm White' },
    { key: 'bl', label: 'Blue' },
    { key: 'rd', label: 'Red' },
  ];

  const hasDynamic = (mixInfo && mixInfo.counts && Number(mixInfo.counts.dynamic) > 0);

  // What the drivers for tunable lights will be commanded to (should match plan)
  const driverChannelHtml = channels.map((channel) => {
    const planValue = planPercentages[channel.key] || 0;
    // Driver targets equal plan for tunable lights
    const formatted = `${planValue.toFixed(1)}%`;
    console.log(`[renderGroupsV2LightCard] DRIVER TARGET ${channel.label}: plan=${planValue.toFixed(1)}%`);
    return `<dt style="font-size:0.65rem;">${escapeHtml(channel.label)}</dt><dd>${escapeHtml(formatted)}</dd>`;
  }).join('');

  // The resulting group mix (tunable targets blended with static factory spectra)
  const groupChannelHtml = channels.map((channel) => {
    const actual = actualMix[channel.key] || 0;
    const planValue = planPercentages[channel.key] || 0;
    // Delta here reflects deviation due to static fixtures
    const delta = effectivePlan ? formatDelta(actual - planValue, '%', 1) : null;
    const formatted = formatValueWithDelta(`${actual.toFixed(1)}%`, delta);
    console.log(`[renderGroupsV2LightCard] GROUP MIX ${channel.label}: actual=${actual.toFixed(1)}%, plan=${planValue.toFixed(1)}%, delta=${delta}`);
    return `<dt style="font-size:0.65rem;">${escapeHtml(channel.label)}</dt><dd>${escapeHtml(formatted)}</dd>`;
  }).join('');

  const avgPpf = ppfSamples > 0 ? totalPpf / ppfSamples : null;

  // Align plan targets with driver target logic and schedule (photoperiod) just like the Plan card
  // PRIORITY: Use day-specific planDayData first (updated by slider), fallback to preview data
  const scheduleConfig = buildGroupsV2ScheduleConfig();
  const scheduleHours = Number.isFinite(scheduleConfig.durationHours) ? scheduleConfig.durationHours : null;
  
  // Get day-specific PPFD and DLI from planDayData (takes priority for slider updates)
  const dayPpfd = planDayData && Number.isFinite(planDayData.ppfd) ? Number(planDayData.ppfd) : null;
  const dayDli = planDayData && Number.isFinite(planDayData.dli) ? Number(planDayData.dli) : null;
  
  // Get photoperiod: schedule override > day-specific > plan default
  const dayPhotoperiodHours = planDayData
    ? (Number.isFinite(planDayData.photoperiodHours)
        ? Number(planDayData.photoperiodHours)
        : readPhotoperiodHours(planDayData.photoperiod))
    : null;
  const planPhotoperiodHours = Number.isFinite(scheduleHours) && scheduleHours > 0 
    ? scheduleHours 
    : dayPhotoperiodHours;
  
  // Calculate PPFD and DLI (recalculate if photoperiod differs from plan)
  let planPpfdValue = dayPpfd;
  let planDliValue = dayDli;
  
  // If DLI target exists and photoperiod is set, recalculate PPFD to achieve DLI
  if (Number.isFinite(dayDli) && dayDli > 0 && Number.isFinite(planPhotoperiodHours) && planPhotoperiodHours > 0) {
    planPpfdValue = (dayDli * 1e6) / (3600 * planPhotoperiodHours);
    planDliValue = dayDli; // Keep target DLI
  } else if (Number.isFinite(planPpfdValue) && Number.isFinite(planPhotoperiodHours) && planPhotoperiodHours > 0) {
    // Recalculate DLI from PPFD and photoperiod
    planDliValue = (planPpfdValue * 3600 * planPhotoperiodHours) / 1e6;
  }
  
  // Apply temperature gradient (to match Plan card behavior)
  const baseTempValue = planDayData && Number.isFinite(planDayData.tempC) ? Number(planDayData.tempC) : null;
  const tempGradient = toNumberOrNull(groupsV2FormState?.gradients?.tempC) || 0;
  const planTempValue = Number.isFinite(baseTempValue) ? (baseTempValue + tempGradient) : baseTempValue;
  
  // Calculate actual fixture output PPFD and DLI based on current intensity and plan target
  // The fixture output should match the plan's PPFD target when operating at the planned spectrum
  // Use the plan's PPFD as the fixture output target (this is what we're trying to achieve)
  const fixturePpfdValue = planPpfdValue;
  
  // Calculate fixture DLI: PPFD × photoperiod × 3.6 / 1000
  const fixtureDliValue = (fixturePpfdValue != null && planPhotoperiodHours != null && planPhotoperiodHours > 0)
    ? (fixturePpfdValue * planPhotoperiodHours * 3.6 / 1000)
    : planDliValue;

  const metrics = [
    { label: 'Total fixtures', value: Math.abs(totalFixtures - Math.round(totalFixtures)) < 0.01 ? String(Math.round(totalFixtures)) : totalFixtures.toFixed(1) },
    { label: 'Dynamic fixtures', value: Math.abs(dynamicFixtures - Math.round(dynamicFixtures)) < 0.01 ? String(Math.round(dynamicFixtures)) : dynamicFixtures.toFixed(1) },
    { label: 'Static fixtures', value: Math.abs(staticFixtures - Math.round(staticFixtures)) < 0.01 ? String(Math.round(staticFixtures)) : staticFixtures.toFixed(1) },
    { label: 'PPF (avg)', value: avgPpf != null ? `${avgPpf.toFixed(0)} µmol/s` : '—' },
    { label: 'PPF (total)', value: totalPpf > 0 ? `${Math.round(totalPpf)} µmol/s` : '—' },
    { label: 'Output PPFD', value: fixturePpfdValue != null ? `${fixturePpfdValue.toFixed(0)} µmol·m⁻²·s⁻¹` : '—' },
    { label: 'Output DLI', value: fixtureDliValue != null ? `${fixtureDliValue.toFixed(2)} mol·m⁻²·d⁻¹` : '—' },
    { label: 'Photoperiod', value: planPhotoperiodHours != null ? `${planPhotoperiodHours.toFixed(1)} h` : '—' },
    { label: 'Temperature', value: planTempValue != null ? `${planTempValue.toFixed(1)}°C` : '—' },
  ];
  const metricsHtml = metrics
    .map((item) => `<dt style="font-size: 0.65rem;">${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd>`)
    .join('');

  const summaryMap = new Map();
  records.forEach((record) => {
    const label = record.name || record.id;
    const prev = summaryMap.get(label) || 0;
    summaryMap.set(label, prev + record.weight);
  });
  const summaryEntries = Array.from(summaryMap.entries()).sort((a, b) => b[1] - a[1]);
  const summaryParts = summaryEntries.slice(0, 3).map(([label, count]) => {
    const rounded = Math.abs(count - Math.round(count)) < 0.01 ? String(Math.round(count)) : count.toFixed(1);
    return `${label} ×${rounded}`;
  });
  if (summaryEntries.length > summaryParts.length) summaryParts.push('...');
  if (ppfSamples === 0) summaryParts.push('PPF data not available');
  const summaryText = summaryParts.length ? summaryParts.join(' • ') : 'Assign fixtures to populate mix and output.';

  const groupLabel = formatGroupsV2GroupLabel(group) || (group.name || 'Active group');
  const headerNote = effectivePlan
    ? `Fixtures in ${groupLabel} compared to ${effectivePlan.name || 'selected plan'} • Day ${dayNumber}`
    : `Fixtures in ${groupLabel}`;
  
  // Build assigned lights list HTML with remove buttons and tunable/static indicators
  const assignedLightsHtml = records.map((record) => {
    const displayName = escapeHtml(record.name || record.id);
    const count = record.weight;
    const countDisplay = Math.abs(count - Math.round(count)) < 0.01 ? `×${Math.round(count)}` : `×${count.toFixed(1)}`;
    const typeIndicator = record.dynamic 
      ? '<span style="display: inline-block; padding: 1px 6px; margin-left: 6px; background: #dbeafe; color: #1e40af; border: 1px solid #93c5fd; border-radius: 3px; font-size: 0.65rem; font-weight: 600;" title="Tunable spectrum - can adjust to match grow recipe">TUNABLE</span>'
      : '<span style="display: inline-block; padding: 1px 6px; margin-left: 6px; background: #fef3c7; color: #92400e; border: 1px solid #fde047; border-radius: 3px; font-size: 0.65rem; font-weight: 600;" title="Static spectrum - factory-set spectrum, dimming only">STATIC</span>';
    return `
      <div style="display: flex; justify-content: space-between; align-items: center; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; margin-bottom: 4px;">
        <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
          <span class="tiny" style="font-weight: 500; color: #1e293b; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName} ${countDisplay}</span>
          ${typeIndicator}
        </div>
        <button class="groupsV2RemoveLightBtn" data-light-id="${escapeHtml(record.id)}" type="button" 
                style="padding: 2px 8px; font-size: 0.7rem; background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; border-radius: 4px; cursor: pointer; font-weight: 500; margin-left: 8px; flex-shrink: 0;"
                title="Remove this light from the group">
          Remove
        </button>
      </div>
    `;
  }).join('');
  
  // Add explanation for static lights if any are present
  const hasStaticLights = staticFixtures > 0;
  const staticLightNote = hasStaticLights ? `
    <div style="background: #fef9c3; border: 1px solid #fde047; border-radius: 6px; padding: 8px; margin-top: 8px;">
      <div style="font-size: 0.7rem; color: #854d0e; line-height: 1.4;">
        <strong>ℹ Static Lights:</strong> This group contains ${staticFixtures} static fixture${staticFixtures > 1 ? 's' : ''}. 
        Static lights maintain their factory-set spectrum and can only be dimmed. 
        They do not adjust spectrum to match grow recipes.
      </div>
    </div>
  ` : '';

  card.classList.remove('is-empty');
  card.innerHTML = `
    <header class="group-info-card__header" style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <h3>Assigned Lights</h3>
        <p class="tiny text-muted">${escapeHtml(headerNote)}</p>
      </div>
    </header>
    <div class="group-info-card__body" style="flex-direction: column; gap: 10px;">
      <canvas id="groupsV2LightSpectrumCanvas" class="group-info-card__canvas" width="280" height="100" role="img" aria-label="Assigned light spectrum" style="width: 100%;"></canvas>

      ${hasDynamic ? `
      <div style="background: #ecfdf5; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; min-height: 85px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #065f46;">Driver target (tunable lights)</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          ${driverChannelHtml}
        </dl>
      </div>
      ` : ''}

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; min-height: 85px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #475569;">Resulting group mix</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          ${groupChannelHtml}
        </dl>
      </div>

  <div id="groupsV2LightColorBreakdown" style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 10px; min-height: 95px; display: none;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #0369a1;">Spectral Distribution</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          <dt style="font-size: 0.65rem;" title="Violet and blue wavelengths">Blue (400-500nm)</dt><dd id="groupsV2LightBlue">—</dd>
          <dt style="font-size: 0.65rem;" title="Mid-spectrum: cyan, green, yellow, amber">Green (500-600nm)</dt><dd id="groupsV2LightGreen">—</dd>
          <dt style="font-size: 0.65rem;" title="Orange and red wavelengths">Red (600-680nm)</dt><dd id="groupsV2LightRed">—</dd>
          <dt style="font-size: 0.65rem;" title="Far-red and near-infrared">Deep Red (680-750nm)</dt><dd id="groupsV2LightDeepRed">—</dd>
        </dl>
        <details style="margin-top: 10px; padding-top: 10px; border-top: 1px solid #bae6fd;">
          <summary style="cursor: pointer; font-size: 0.7rem; color: #0369a1; font-weight: 500; user-select: none;">
            ▸ Mid-Spectrum Breakdown
          </summary>
          <div style="margin-top: 10px; padding: 8px; background: rgba(240, 249, 255, 0.5); border-radius: 4px;">
            <div style="font-size: 0.65rem; color: #64748b; margin-bottom: 6px;">
              Assuming uniform distribution across 500-600nm:
            </div>
            <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.7rem;">
              <dt style="font-size: 0.6rem; color: #0891b2;">Cyan (500-520nm)</dt><dd id="groupsV2LightCyan" style="color: #0891b2;">—</dd>
              <dt style="font-size: 0.6rem; color: #10b981;">True Green (520-560nm)</dt><dd id="groupsV2LightTrueGreen" style="color: #10b981;">—</dd>
              <dt style="font-size: 0.6rem; color: #eab308;">Yellow (560-590nm)</dt><dd id="groupsV2LightYellow" style="color: #eab308;">—</dd>
              <dt style="font-size: 0.6rem; color: #f97316;">Amber (590-600nm)</dt><dd id="groupsV2LightAmber" style="color: #f97316;">—</dd>
            </dl>
          </div>
        </details>
      </div>

      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; min-height: 115px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #166534;">Fixture Output</div>
        <dl class="group-info-card__metrics" style="width: 100%; grid-template-columns: repeat(2, 1fr); gap: 4px 8px; font-size: 0.75rem;">
          ${metricsHtml}
        </dl>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px;">
        <div class="tiny" style="font-weight: 600; margin-bottom: 6px; color: #854d0e;">Assigned Fixtures</div>
        <div id="groupsV2AssignedLightsList">
          ${assignedLightsHtml}
        </div>
        ${staticLightNote}
      </div>

      <div id="groupsV2LightSummary" class="tiny text-muted" style="line-height: 1.4;">${escapeHtml(summaryText)}</div>
    </div>
  `;

  const deviceIds = records.map((record) => record.id);
  const spectrumCanvas = document.getElementById('groupsV2LightSpectrumCanvas');
  if (spectrumCanvas && typeof renderSpectrumCanvas === 'function' && typeof computeWeightedSPD === 'function') {
    // Only use the 4 physical LED driver channels (CW, WW, BL, RD)
    // Spectral bands (blue, green, red, far-red) are computed FROM these channels via SPD
    const mix = {
      cw: actualMix.cw,
      ww: actualMix.ww,
      bl: actualMix.bl,
      rd: actualMix.rd
    };
    console.log('[renderGroupsV2LightCard] Computing SPD for mix:', mix, 'deviceIds:', deviceIds);
    const spd = computeWeightedSPD(mix, { deviceIds });
    console.log('[renderGroupsV2LightCard] SPD result:', {
      wavelengths: spd.wavelengths?.length,
      samples: spd.samples?.length,
      display: spd.display?.length,
      mix: spd.mix,
      weights: spd.weights,
      deviceCount: spd.deviceCount
    });
    renderSpectrumCanvas(spectrumCanvas, spd, { width: spectrumCanvas.width, height: spectrumCanvas.height });
    const colorPcts = calculateSpectrumColorPercentages(spd);
    console.log('[renderGroupsV2LightCard] Spectral band percentages:', colorPcts);
    const lightBreakdown = document.getElementById('groupsV2LightColorBreakdown');
    if (colorPcts && lightBreakdown) {
      lightBreakdown.style.display = 'block';
      const blueEl = document.getElementById('groupsV2LightBlue');
      const greenEl = document.getElementById('groupsV2LightGreen');
      const redEl = document.getElementById('groupsV2LightRed');
      const deepRedEl = document.getElementById('groupsV2LightDeepRed');
      if (blueEl) blueEl.textContent = `${colorPcts.blue}%`;
      if (greenEl) greenEl.textContent = `${colorPcts.green}%`;
      if (redEl) redEl.textContent = `${colorPcts.red}%`;
      if (deepRedEl) deepRedEl.textContent = `${colorPcts.deepRed}%`;
      
      // Update mid-spectrum breakdown
      const midBreakdown = calculateMidSpectrumBreakdown(spd, colorPcts.green);
      console.log('[renderGroupsV2LightCard] Mid-spectrum breakdown:', midBreakdown);
      const cyanEl = document.getElementById('groupsV2LightCyan');
      const trueGreenEl = document.getElementById('groupsV2LightTrueGreen');
      const yellowEl = document.getElementById('groupsV2LightYellow');
      const amberEl = document.getElementById('groupsV2LightAmber');
      if (cyanEl) cyanEl.textContent = `${midBreakdown.cyan}%`;
      if (trueGreenEl) trueGreenEl.textContent = `${midBreakdown.trueGreen}%`;
      if (yellowEl) yellowEl.textContent = `${midBreakdown.yellow}%`;
      if (amberEl) amberEl.textContent = `${midBreakdown.amber}%`;
    } else if (lightBreakdown) {
      lightBreakdown.style.display = 'none';
    }
  } else {
    const lightBreakdown = document.getElementById('groupsV2LightColorBreakdown');
    if (lightBreakdown) lightBreakdown.style.display = 'none';
  }
  
  // Attach event handlers to remove buttons
  const removeButtons = card.querySelectorAll('.groupsV2RemoveLightBtn');
  removeButtons.forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const lightId = btn.getAttribute('data-light-id');
      if (!lightId) return;
      
      // Find the light in the group's lights array and remove it
      const currentGroup = getGroupsV2ActiveGroup();
      if (!currentGroup || !Array.isArray(currentGroup.lights)) return;
      
      const initialLength = currentGroup.lights.length;
      currentGroup.lights = currentGroup.lights.filter((ref) => {
        const refId = typeof ref === 'string'
          ? ref
          : (ref && (ref.id || ref.lightId || ref.deviceId || ref.serial));
        return String(refId) !== String(lightId);
      });
      
      if (currentGroup.lights.length === initialLength) {
        console.warn(`[Groups V2] Light ${lightId} not found in group lights array`);
        return;
      }
      
      // Clear groupId and groupLabel from the light in STATE.lights
      const lightsDb = (window.STATE && Array.isArray(window.STATE.lights)) ? window.STATE.lights : [];
      const lightRecord = lightsDb.find((light) => String(light?.id) === String(lightId) || String(light?.serial) === String(lightId));
      if (lightRecord) {
        delete lightRecord.groupId;
        delete lightRecord.groupLabel;
        if (lightRecord.zoneId) delete lightRecord.zoneId;
      }
      
      // Update UI
      populateGroupsV2UnassignedLightsDropdown();
      document.dispatchEvent(new Event('groups-updated'));
      document.dispatchEvent(new Event('lights-updated'));
      
      // Save changes
      if (typeof window.saveLights === 'function') {
        window.saveLights();
      }
      
      // Re-render the light card
      const currentPlan = getGroupsV2SelectedPlan();
      renderGroupsV2LightCard(currentPlan, { dayNumber });
      
      // Show toast notification
      const lightName = lightRecord ? (lightRecord.name || lightId) : lightId;
      if (typeof showToast === 'function') {
        showToast({ 
          title: 'Light Removed', 
          msg: `${lightName} returned to unassigned lights.`, 
          kind: 'info' 
        });
      }
    });
  });

  // After (re)rendering the light card, align it with the plan card
  setTimeout(() => alignGroupsV2CardLayout(), 0);
}

function populateGroupsV2ScheduleDropdown() {
  const select = document.getElementById('groupsV2ScheduleSelect');
  if (!select) return;
  
  // Don't repopulate if user is actively interacting with the dropdown
  if (document.activeElement === select) {
    console.log('[Groups V2] Skipping schedule dropdown repopulation - user is interacting with it');
    return;
  }
  
  while (select.options.length > 1) select.remove(1);
  const schedules = (window.STATE && Array.isArray(window.STATE.schedules)) ? window.STATE.schedules : [];
  schedules.forEach(sched => {
    const opt = document.createElement('option');
    opt.value = sched.id || sched.name || '';
    opt.textContent = sched.name || sched.label || sched.id || '(unnamed schedule)';
    select.appendChild(opt);
  });
}

function requestGroupsV2PlanRefresh() {
  if (!groupsV2DomReady) {
    groupsV2PendingRefresh.planSelectors = true;
    return;
  }
  populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
}

function requestGroupsV2ScheduleRefresh() {
  if (!groupsV2DomReady) {
    groupsV2PendingRefresh.scheduleDropdown = true;
    return;
  }
  populateGroupsV2ScheduleDropdown();
}

document.addEventListener('DOMContentLoaded', () => {
  // ...existing code...
  initializeGroupsV2Form();
  requestGroupsV2PlanRefresh();
  requestGroupsV2ScheduleRefresh();
  debouncedUpdateGroupsV2Preview();
  // Re-align cards on resize
  let _alignRaf = null;
  window.addEventListener('resize', () => {
    if (_alignRaf) cancelAnimationFrame(_alignRaf);
    _alignRaf = requestAnimationFrame(() => {
      alignGroupsV2CardLayout();
      _alignRaf = null;
    });
  });
});

document.addEventListener('plans-updated', () => {
  console.log('[Groups V2] plans-updated event received');
  requestGroupsV2PlanRefresh();
});

document.addEventListener('schedules-updated', () => {
  console.log('[Groups V2] schedules-updated event received');
  requestGroupsV2ScheduleRefresh();
});

// Listen for farmDataChanged event (attach once)
if (!window._groupsV2FarmDataListenerAttached) {
  window.addEventListener('farmDataChanged', () => {
    console.log('[Groups V2] farmDataChanged event received - repopulating dropdowns');
    requestGroupsV2PlanRefresh();
    requestGroupsV2ScheduleRefresh();
    debouncedUpdateGroupsV2Preview();
  });
  window._groupsV2FarmDataListenerAttached = true;
}

document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('groupsV2LoadGroup');
  if (!select || select._groupsV2ListenerAttached) return;
  select._groupsV2ListenerAttached = true; // Set flag immediately to prevent duplicate listeners
  select.addEventListener('change', () => {
    const groupId = select.value;
    if (!groupId) {
      updateGroupsV2StatusBadge(null);
      return;
    }
    const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
    const matchById = groups.find((g) => g && typeof g.id === 'string' && g.id === groupId);
    const matchByLabel = groups.find((g) => {
      if (!g) return false;
      return formatGroupsV2GroupLabel(g) === groupId;
    });
    const group = matchById || matchByLabel || null;
    if (!group) {
      updateGroupsV2StatusBadge(null);
      return;
    }
    
    // Update status badge
    updateGroupsV2StatusBadge(group);
    
    // Populate form fields with group data
    const nameInput = document.getElementById('groupsV2ZoneName');
    const zoneSelect = document.getElementById('groupsV2ZoneSelect');
    const roomSelect = document.getElementById('groupsV2RoomSelect');
    
    if (nameInput) nameInput.value = group.name || '';
    if (zoneSelect) zoneSelect.value = group.zone || '';
    if (roomSelect) roomSelect.value = group.room || '';
    
    const planId = typeof group.plan === 'string'
      ? group.plan
      : (group.plan && typeof group.plan === 'object' ? (group.plan.id || group.plan.name) : '');
    groupsV2FormState.planId = planId || '';
    groupsV2FormState.planSearch = '';
    const cfg = group.planConfig && typeof group.planConfig === 'object' ? group.planConfig : {};
    const anchor = cfg.anchor && typeof cfg.anchor === 'object' ? cfg.anchor : {};
    const seed = typeof anchor.seedDate === 'string' ? anchor.seedDate : '';
    const parsedSeed = parseLocalDateInput(seed);
    // Restore anchor mode (handle all three modes: seedDate, dps, hold)
    if (anchor.mode === 'hold') {
      groupsV2FormState.anchorMode = 'hold';
    } else if (anchor.mode === 'dps') {
      groupsV2FormState.anchorMode = 'dps';
    } else {
      groupsV2FormState.anchorMode = 'seedDate';
    }
    groupsV2FormState.seedDate = parsedSeed ? formatDateInputValue(parsedSeed) : '';
    groupsV2FormState.dps = toNumberOrNull(anchor.dps);
    groupsV2FormState.holdDay = toNumberOrNull(anchor.holdDay) || 1;
    const scheduleCfg = cfg.schedule && typeof cfg.schedule === 'object' ? cfg.schedule : {};
    groupsV2FormState.schedule = hydrateGroupsV2ScheduleState(scheduleCfg);
    const gradientCfg = cfg.gradients && typeof cfg.gradients === 'object' ? cfg.gradients : {};
    groupsV2FormState.gradients = {
      ppfd: toNumberOrNull(gradientCfg.ppfd) ?? GROUPS_V2_DEFAULTS.gradients.ppfd,
      blue: toNumberOrNull(gradientCfg.blue) ?? GROUPS_V2_DEFAULTS.gradients.blue,
      tempC: toNumberOrNull(gradientCfg.tempC) ?? GROUPS_V2_DEFAULTS.gradients.tempC,
      rh: toNumberOrNull(gradientCfg.rh) ?? GROUPS_V2_DEFAULTS.gradients.rh,
    };
    // Load target humidity if present
    groupsV2FormState.targetHumidity = toNumberOrNull(cfg.targetHumidity);
    populateGroupsV2PlanDropdown(groupsV2FormState.planSearch);
    applyGroupsV2StateToInputs();
    updateGroupsV2AnchorInputs();
    debouncedUpdateGroupsV2Preview();
    renderGroupsV2LightCard(getGroupsV2SelectedPlan());
  });
});
// Populate Groups V2 Load Group dropdown with saved groups, format: Room Name:Zone:Name
function populateGroupsV2LoadGroupDropdown() {
  const select = document.getElementById('groupsV2LoadGroup');
  if (!select) return;
  
  const currentValue = select.value;
  
  // Remove all except the first (none)
  while (select.options.length > 1) select.remove(1);
  
  // Get currently selected room and zone
  const roomSelect = document.getElementById('groupsV2RoomSelect');
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  const selectedRoom = roomSelect ? roomSelect.value : '';
  const selectedZone = zoneSelect ? zoneSelect.value : '';
  
  // Get groups from window.STATE.groups
  const groups = (window.STATE && Array.isArray(window.STATE.groups)) ? window.STATE.groups : [];
  console.log('[Groups V2] Load dropdown - STATE.groups:', groups.length, 'total groups');
  if (groups.length > 0) {
    console.log('[Groups V2] Load dropdown - First group:', groups[0]);
  } else {
    console.warn('[Groups V2] Load dropdown - No groups in STATE! Check if groups.json loaded.');
  }
  
  // Filter groups by selected room and zone
  const filteredGroups = groups.filter(group => {
    const groupRoom = group.room || group.roomName || '';
    const groupZone = group.zone || '';
    
    // Match room (case-insensitive)
    const roomMatches = !selectedRoom || groupRoom.toLowerCase() === selectedRoom.toLowerCase();
    // Match zone (case-insensitive)
    const zoneMatches = !selectedZone || groupZone.toLowerCase() === selectedZone.toLowerCase();
    
    return roomMatches && zoneMatches;
  });
  
  // Sort: deployed first, then drafts; within each category, alphabetically
  const sortedGroups = [...filteredGroups].sort((a, b) => {
    const statusA = a.status || 'draft';
    const statusB = b.status || 'draft';
    
    // Deployed before drafts
    if (statusA === 'deployed' && statusB !== 'deployed') return -1;
    if (statusA !== 'deployed' && statusB === 'deployed') return 1;
    
    // Within same status, alphabetically by label
    const labelA = formatGroupsV2GroupLabel(a);
    const labelB = formatGroupsV2GroupLabel(b);
    return labelA.localeCompare(labelB);
  });
  
  sortedGroups.forEach(group => {
    const label = formatGroupsV2GroupLabel(group);
    const status = group.status || 'draft';
    const statusIcon = status === 'deployed' ? '✓' : '•';
    
    const opt = document.createElement('option');
    opt.value = group.id || label;
    opt.textContent = `${statusIcon} ${label || '(unnamed group)'}`;
    opt.dataset.status = status;
    
    // Style deployed vs draft
    if (status === 'deployed') {
      opt.style.fontWeight = '600';
    } else {
      opt.style.fontStyle = 'italic';
      opt.style.color = '#64748b';
    }
    
    select.appendChild(opt);
  });
  
  // Restore previous selection if it still exists
  if (currentValue) {
    const stillExists = Array.from(select.options).some(opt => opt.value === currentValue);
    if (stillExists) {
      select.value = currentValue;
    }
  }
  
  // Log for debugging
  console.log(`[Groups V2] Load dropdown: ${sortedGroups.length} groups for room="${selectedRoom}", zone="${selectedZone}"`);
}

function requestGroupsV2LoadGroupRefresh() {
  if (!groupsV2DomReady) {
    groupsV2PendingRefresh.loadGroup = true;
    return;
  }
  populateGroupsV2LoadGroupDropdown();
}

document.addEventListener('DOMContentLoaded', () => {
  requestGroupsV2LoadGroupRefresh();
});

document.addEventListener('groups-updated', requestGroupsV2LoadGroupRefresh);

document.addEventListener('groups-updated', () => {
  renderGroupsV2LightCard(getGroupsV2SelectedPlan());
});

document.addEventListener('lights-updated', () => {
  renderGroupsV2LightCard(getGroupsV2SelectedPlan());
});
// Populate Groups V2 Room dropdown with 'GreenReach' and rooms from STATE.rooms
function populateGroupsV2RoomDropdown() {
  const select = document.getElementById('groupsV2RoomSelect');
  if (!select) return;
  // Remove all except the first (GreenReach)
  while (select.options.length > 1) select.remove(1);
  const seen = new Set(['GreenReach']);
  if (window.STATE && Array.isArray(window.STATE.rooms)) {
    window.STATE.rooms.forEach(room => {
      if (!room || !room.name || seen.has(room.name)) return;
      const opt = document.createElement('option');
      opt.value = room.name;
      opt.textContent = room.name;
      select.appendChild(opt);
      seen.add(room.name);
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  populateGroupsV2RoomDropdown();
  // If rooms can change dynamically, listen for a custom event to refresh
  document.addEventListener('rooms-updated', populateGroupsV2RoomDropdown);
  
  // Add event listeners to room and zone selects to filter the load group dropdown
  const roomSelect = document.getElementById('groupsV2RoomSelect');
  const zoneSelect = document.getElementById('groupsV2ZoneSelect');
  
  if (roomSelect) {
    roomSelect.addEventListener('change', () => {
      console.log('[Groups V2] Room changed:', roomSelect.value);
      populateGroupsV2LoadGroupDropdown();
    });
  }
  
  if (zoneSelect) {
    zoneSelect.addEventListener('change', () => {
      console.log('[Groups V2] Zone changed:', zoneSelect.value);
      populateGroupsV2LoadGroupDropdown();
    });
  }
});
// Wire up Groups V2 sidebar button to open Group V2 Setup card
document.addEventListener('DOMContentLoaded', () => {
  const groupsV2Btn = document.querySelector('[data-sidebar-link][data-target="groups-v2"]');
  if (groupsV2Btn) {
    groupsV2Btn.addEventListener('click', (e) => {
      e.preventDefault();
      setActivePanel('groups-v2');
    });
  }
});

// Wire up Seed Date button to toggle anchor mode
document.addEventListener('DOMContentLoaded', () => {
  const seedDateBtn = document.getElementById('groupsV2SeedDateBtn');
  if (seedDateBtn) {
    seedDateBtn.addEventListener('click', () => {
      const isPressed = seedDateBtn.getAttribute('aria-pressed') === 'true';
      if (!isPressed) {
        groupsV2FormState.anchorMode = 'seedDate';
        seedDateBtn.setAttribute('aria-pressed', 'true');
        // Update DPS button
        const dpsBtn = document.getElementById('groupsV2DpsBtn');
        if (dpsBtn) dpsBtn.setAttribute('aria-pressed', 'false');
        updateGroupsV2AnchorInputs();
        debouncedUpdateGroupsV2Preview();
      }
    });
  }
});

// Wire up DPS button to toggle anchor mode
document.addEventListener('DOMContentLoaded', () => {
  const dpsBtn = document.getElementById('groupsV2DpsBtn');
  if (dpsBtn) {
    dpsBtn.addEventListener('click', () => {
      const isPressed = dpsBtn.getAttribute('aria-pressed') === 'true';
      console.log('[Groups V2] DPS button clicked - current aria-pressed:', isPressed);
      if (!isPressed) {
        groupsV2FormState.anchorMode = 'dps';
        dpsBtn.setAttribute('aria-pressed', 'true');
        // Update Seed Date button
        const seedDateBtn = document.getElementById('groupsV2SeedDateBtn');
        if (seedDateBtn) seedDateBtn.setAttribute('aria-pressed', 'false');
        updateGroupsV2AnchorInputs();
        // Force focus to DPS input after a micro-delay to ensure it's enabled
        setTimeout(() => {
          const dpsInput = document.getElementById('groupsV2Dps');
          if (dpsInput && !dpsInput.disabled) {
            dpsInput.focus();
            console.log('[Groups V2] DPS input focused');
          }
        }, 0);
        debouncedUpdateGroupsV2Preview();
        console.log('[Groups V2] DPS mode activated');
      }
    });
  }
});

// Wire up Add Cycle 2 button
document.addEventListener('DOMContentLoaded', () => {
  const addCycle2Btn = document.getElementById('groupsV2AddCycle2Btn');
  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  if (addCycle2Btn && cycle2Container) {
    addCycle2Btn.addEventListener('click', () => {
      console.log('[Groups V2] Add Cycle 2 button clicked');
      const schedule = ensureGroupsV2ScheduleState();
      const baselineHours = Number.isFinite(schedule.photoperiodHours) && schedule.photoperiodHours > 0
        ? schedule.photoperiodHours
        : GROUPS_V2_DEFAULTS.schedule.photoperiodHours;
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        mode: 'two',
        photoperiodHours: baselineHours,
      });
      groupsV2FormState.schedule = updated;
      console.log('[Groups V2] Updated schedule to two-cycle mode:', updated);
      // Manually set the container display BEFORE updateGroupsV2ScheduleUI
      cycle2Container.style.display = 'flex';
      addCycle2Btn.style.display = 'none';
      updateGroupsV2ScheduleUI();
      debouncedUpdateGroupsV2Preview();
      console.log('[Groups V2] Add Cycle 2 complete - container visible:', cycle2Container.style.display);
    });
  }
});

// Wire up Remove Cycle 2 button
document.addEventListener('DOMContentLoaded', () => {
  const removeCycle2Btn = document.getElementById('groupsV2RemoveCycle2Btn');
  const cycle2Container = document.getElementById('groupsV2Cycle2Container');
  const addCycle2Btn = document.getElementById('groupsV2AddCycle2Btn');
  if (removeCycle2Btn && cycle2Container && addCycle2Btn) {
    removeCycle2Btn.addEventListener('click', () => {
      const schedule = ensureGroupsV2ScheduleState();
      const updated = normalizeGroupsV2Schedule({
        ...schedule,
        mode: 'one',
      });
      groupsV2FormState.schedule = updated;
      cycle2Container.style.display = 'none';
      addCycle2Btn.style.display = 'inline-block';
      updateGroupsV2ScheduleUI();
      updateGroupsV2Preview();
    });
  }
});

// Wire up calibration button in Groups V2 panel
document.addEventListener('DOMContentLoaded', () => {
  // Handle both old and new calibration button IDs
  const calBtns = [
    document.getElementById('btnOpenCalWizardFromGroups'),
    document.getElementById('btnOpenCalWizardFromGroupsV2')
  ].filter(Boolean);
  
  calBtns.forEach(calBtn => {
    calBtn.addEventListener('click', () => {
      // Navigate to calibration panel using the same mechanism as sidebar links
      if (typeof setActivePanel === 'function') {
        setActivePanel('calibration');
      } else {
        // Fallback: manually trigger the calibration panel navigation
        const calibrationLink = document.querySelector('[data-sidebar-link][data-target="calibration"]');
        if (calibrationLink) {
          calibrationLink.click();
        } else {
          // Last resort: show the calibration panel directly
          // Last resort: show the calibration panel directly
          const calibrationPanel = document.getElementById('calibrationPanel');
          if (calibrationPanel) {
            calibrationPanel.style.display = 'block';
          }
        }
      }
    });
  });
});
