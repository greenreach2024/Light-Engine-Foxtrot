/**
 * Grow Management — Room Build Plan
 * ==================================
 *
 * Listens for `grow-template:selected` (fired by grow-management-template-gallery.js)
 * and renders a "Room Build Plan" card that turns the scoring engine's raw load
 * totals into an operator-facing equipment sizing list, then drives Evie's
 * spatial capacity plan: unit count, per-zone fit status, multi-zone prompt,
 * and the "zones are for photoperiod/maintenance/environment separation"
 * advisory.
 *
 * Consumes window.RoomLayoutSolver (public/lib/room-layout-solver.js).
 *
 * Matches FARM_SETUP_WORKFLOW_PROPOSAL.md §2 Phase A: template click computes
 * lighting kW, transpiration kg/day, cooling tons, fan CFM AND now asks Evie
 * to fit the selected unit count into the room's zones before staging a group.
 */
(function () {
  'use strict';

  const PANEL_ID       = 'roomBuildPlan';
  const BODY_ID        = 'rbpBody';
  const SPATIAL_ID     = 'rbpSpatial';
  const EVIE_ID        = 'rbpEvie';
  const UNIT_COUNT_ID  = 'rbpUnitCount';
  const AUTOFIT_ID     = 'rbpAutoFit';
  const ZONE_COUNT_ID  = 'rbpZoneCount';
  const TITLE_ID       = 'rbpTitle';
  const SUBTITLE_ID    = 'rbpSubtitle';
  const PREFILL_BTN    = 'rbpPrefillBtn';
  const ASSIGN_BTN     = 'rbpAssignLightsBtn';
  const SAVE_PLAN_BTN  = 'rbpSavePlanBtn';
  const CLEAR_BTN      = 'rbpClearBtn';
  const ROOM_SELECT_ID = 'groupsV2RoomSelect';
  const ZONE_SELECT_ID = 'groupsV2ZoneSelect';
  const GROUP_NAME_ID  = 'groupsV2ZoneName';

  // Default room dimensions used only if neither the server nor localStorage
  // has a value. The Main Grow Room demo room is 27m x 18m; defaults are a
  // safe generic box so the solver still produces useful output.
  const DEFAULT_ROOM = { lengthM: 20, widthM: 15, heightM: 3.5 };

  const W_PER_TON = 3517;
  const KG_TO_LITRES = 1.0;

  let state = {
    template: null,
    scores: null,
    room: null,
    cropClass: null,
    desiredUnits: 0,
    autoFit: true,
    zoneRects: [],
    spatialPlan: null,
    zoneRecommendation: null,
    customization: null
  };

  function $(id) { return document.getElementById(id); }

  function fmt(n, digits = 0) {
    if (n == null || !Number.isFinite(n)) return '--';
    return Number(n).toFixed(digits);
  }

  function sum(a) { return a.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0); }

  function metersToInches(m) {
    return Number(m || 0) * 39.37007874;
  }

  function computeLocationsFromSpacing(lengthIn, widthIn, borderInPerSide, spacingIn) {
    const usableL = Math.max(0, Number(lengthIn || 0) - (2 * Number(borderInPerSide || 0)));
    const usableW = Math.max(0, Number(widthIn || 0) - (2 * Number(borderInPerSide || 0)));
    const spacing = Math.max(0.1, Number(spacingIn || 0));
    const nx = Math.max(1, Math.floor(usableL / spacing) + 1);
    const ny = Math.max(1, Math.floor(usableW / spacing) + 1);
    return {
      usableLengthIn: usableL,
      usableWidthIn: usableW,
      locationsX: nx,
      locationsY: ny,
      locationsPerLevel: nx * ny
    };
  }

  function computeSpacingFromLocations(lengthIn, widthIn, borderInPerSide, locationsX, locationsY) {
    const usableL = Math.max(0, Number(lengthIn || 0) - (2 * Number(borderInPerSide || 0)));
    const usableW = Math.max(0, Number(widthIn || 0) - (2 * Number(borderInPerSide || 0)));
    const nx = Math.max(1, Number(locationsX || 1));
    const ny = Math.max(1, Number(locationsY || 1));
    const sx = nx > 1 ? usableL / (nx - 1) : usableL;
    const sy = ny > 1 ? usableW / (ny - 1) : usableW;
    return {
      spacingInX: Number(sx.toFixed(3)),
      spacingInY: Number(sy.toFixed(3)),
      spacingIn: Number(((sx + sy) / 2).toFixed(3))
    };
  }

  function getTemplateCustomizationDefaults(template, cropClass) {
    const t = template || {};
    const c = cropClass || t.defaultCropClass || 'leafy_greens';
    const footprint = t.footprintM || { length: 0, width: 0 };
    const lengthIn = metersToInches(footprint.length);
    const widthIn = metersToInches(footprint.width);
    const levels = Math.max(1, Number(t.tierCount || 1));
    const borderInPerSide = 1;
    const totalByClass = t.plantLocations?.totalByClass?.[c];
    const perLevelTarget = Number.isFinite(totalByClass)
      ? Math.max(1, Math.round(Number(totalByClass) / levels))
      : Math.max(1, Number(t.plantsPerTrayByClass?.[c] || 12));
    const side = Math.max(1, Math.round(Math.sqrt(perLevelTarget)));
    const spacingHint = side > 1 ? Math.max(0.1, (Math.max(0, lengthIn - 2) / (side - 1))) : Math.max(4, Math.min(lengthIn, widthIn) / 2);
    const loc = computeLocationsFromSpacing(lengthIn, widthIn, borderInPerSide, spacingHint);
    return {
      levels,
      borderInPerSide,
      spacingIn: Number(spacingHint.toFixed(3)),
      spacingLinked: true,
      locationsX: loc.locationsX,
      locationsY: loc.locationsY,
      locationsPerLevel: loc.locationsPerLevel,
      totalLocations: loc.locationsPerLevel * levels,
      footprintLengthIn: Number(lengthIn.toFixed(3)),
      footprintWidthIn: Number(widthIn.toFixed(3))
    };
  }

  function recalcCustomization(customization) {
    const c = Object.assign({}, customization || {});
    const levels = Math.max(1, Number(c.levels || 1));
    const border = Math.max(0, Number(c.borderInPerSide || 1));
    const lengthIn = Math.max(0, Number(c.footprintLengthIn || 0));
    const widthIn = Math.max(0, Number(c.footprintWidthIn || 0));
    c.levels = levels;
    c.borderInPerSide = border;
    c.footprintLengthIn = lengthIn;
    c.footprintWidthIn = widthIn;

    if (c.spacingLinked) {
      const bySpacing = computeLocationsFromSpacing(lengthIn, widthIn, border, c.spacingIn);
      c.locationsX = bySpacing.locationsX;
      c.locationsY = bySpacing.locationsY;
      c.locationsPerLevel = bySpacing.locationsPerLevel;
      c.usableLengthIn = bySpacing.usableLengthIn;
      c.usableWidthIn = bySpacing.usableWidthIn;
      c.spacingInX = Number(c.spacingIn || 0);
      c.spacingInY = Number(c.spacingIn || 0);
    } else {
      c.locationsX = Math.max(1, Number(c.locationsX || 1));
      c.locationsY = Math.max(1, Number(c.locationsY || 1));
      c.locationsPerLevel = c.locationsX * c.locationsY;
      const byLoc = computeSpacingFromLocations(lengthIn, widthIn, border, c.locationsX, c.locationsY);
      c.spacingIn = byLoc.spacingIn;
      c.spacingInX = byLoc.spacingInX;
      c.spacingInY = byLoc.spacingInY;
      c.usableLengthIn = Math.max(0, lengthIn - (2 * border));
      c.usableWidthIn = Math.max(0, widthIn - (2 * border));
    }

    // Explicit layoutMode field (proposal item 1) -- mirrors spacingLinked
    // for consumers that prefer the enum form.
    c.layoutMode = c.spacingLinked ? 'auto_by_spacing' : 'manual_locations';

    // Anisotropic-spacing warning: triggered when Sx and Sy diverge by more
    // than 10% in manual_locations mode (spacing hints differ across axes).
    c.anisotropic = false;
    c.anisotropicWarning = null;
    if (!c.spacingLinked && Number.isFinite(c.spacingInX) && Number.isFinite(c.spacingInY)) {
      const sx = Number(c.spacingInX);
      const sy = Number(c.spacingInY);
      const maxS = Math.max(sx, sy);
      const minS = Math.max(0.0001, Math.min(sx, sy));
      if (maxS / minS > 1.1) {
        c.anisotropic = true;
        c.anisotropicWarning = `Spacing differs between axes (X: ${sx.toFixed(2)} in, Y: ${sy.toFixed(2)} in).`;
      }
    }

    c.totalLocations = Math.max(1, c.locationsPerLevel) * levels;
    return c;
  }

  function fetchRooms() {
    const _f = window.authFetch || fetch;
    const bust = (url) => (window.DataFlowBus && window.DataFlowBus.cacheBust)
      ? window.DataFlowBus.cacheBust(url)
      : url;

    async function fetchOne(url) {
      const r = await _f(bust(url), { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return [];
      const body = await r.json();
      if (Array.isArray(body)) return body;
      if (Array.isArray(body.rooms)) return body.rooms;
      if (Array.isArray(body.items)) return body.items;
      return [];
    }

    // Grow Management writes canonical room payloads to /data/rooms.json.
    // Read it first so sparse /api/rooms DB rows cannot overwrite richer
    // room state (zones, installedSystems, buildPlan).
    return fetchOne('/data/rooms.json')
      .then((rooms) => {
        if (Array.isArray(rooms) && rooms.length) return rooms;
        return fetchOne('/api/rooms');
      })
      .then((rooms) => {
        if (Array.isArray(rooms) && rooms.length) return rooms;
        if (Array.isArray(window.__ffFlowRooms) && window.__ffFlowRooms.length) return window.__ffFlowRooms;
        if (window.STATE && Array.isArray(window.STATE.rooms) && window.STATE.rooms.length) return window.STATE.rooms;
        return [];
      })
      .catch(() => {
        if (Array.isArray(window.__ffFlowRooms) && window.__ffFlowRooms.length) return window.__ffFlowRooms;
        if (window.STATE && Array.isArray(window.STATE.rooms) && window.STATE.rooms.length) return window.STATE.rooms;
        return [];
      });
  }

  function selectedRoom(rooms) {
    const sel = $(ROOM_SELECT_ID);
    const id = sel && sel.value;
    const normalize = (value) => String(value || '').trim().toLowerCase();
    const roomKeys = (room) => [room?.id, room?.room_id, room?.roomId, room?.name, room?.room_name];
    const hasRealDims = (room) => {
      const dims = room?.dimensions || room?.dims || {};
      const len = Number(dims.lengthM ?? dims.length_m ?? room?.lengthM ?? room?.length_m ?? room?.length);
      const wid = Number(dims.widthM ?? dims.width_m ?? room?.widthM ?? room?.width_m ?? room?.width);
      const hgt = Number(
        dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? dims.height_m ?? dims.ceiling_height_m
          ?? room?.ceilingHeightM ?? room?.ceiling_height_m ?? room?.height_m ?? room?.height
      );
      return [len, wid, hgt].every(v => Number.isFinite(v) && v > 0);
    };

    if (id) {
      const wanted = normalize(id);
      const matched = rooms.find((room) => roomKeys(room).some((key) => normalize(key) === wanted));
      if (matched) return matched;
    }

    // Resilient fallback: when the room select has not been initialized yet,
    // prefer the first room with valid dimensions so EVIE can still compute.
    return rooms.find(hasRealDims) || rooms[0] || null;
  }

  function roomPayload(room) {
    if (!room) return null;
    const dims = room.dimensions || room.dims || {};
    // Accept every shape rooms are written in across the codebase: nested
    // {dimensions:{length_m,...}} (zone drawer, room editor), top-level
    // snake_case {length_m, width_m, ceiling_height_m} (most common; see
    // grow-management.html lines 1365-1400), and top-level camelCase
    // {lengthM, widthM, ceilingHeightM}.
    const len = Number(dims.lengthM ?? dims.length_m ?? room.lengthM ?? room.length_m ?? room.length);
    const wid = Number(dims.widthM ?? dims.width_m ?? room.widthM ?? room.width_m ?? room.width);
    const hgt = Number(
      dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? dims.height_m ?? dims.ceiling_height_m
        ?? room.ceilingHeightM ?? room.ceiling_height_m ?? room.height_m ?? room.height
    );
    const envelope = room.envelope?.class || room.envelopeClass || 'typical';
    const supplyCFM = Number(room.supplyCFM ?? room.supply_cfm ?? 0) || null;
    const out = {};
    if ([len, wid, hgt].every(v => Number.isFinite(v) && v > 0)) {
      out.dimensions = { lengthM: len, widthM: wid, ceilingHeightM: hgt };
    }
    if (envelope) out.envelope = { class: envelope };
    if (supplyCFM) out.supplyCFM = supplyCFM;
    return Object.keys(out).length ? out : null;
  }

  /**
   * Pull the current room's dimensions from the 3D-farm-viewer's localStorage
   * store (written by its "edit room" dialog), falling back to the room
   * payload fields. Returns null (NOT a DEFAULT_ROOM) when no real dimensions
   * are available so callers can show a prompt to set them instead of
   * silently running the solver against a generic 20x15 box.
   */
  function readRoomDims(room) {
    if (!room) return null;
    // Canonical saved room payload is the source of truth. Read this first
    // so stale localStorage edits cannot override persisted dimensions.
    const payload = roomPayload(room);
    if (payload?.dimensions) {
      return {
        lengthM: payload.dimensions.lengthM,
        widthM: payload.dimensions.widthM,
        heightM: payload.dimensions.ceilingHeightM
      };
    }

    try {
      const raw = localStorage.getItem('farm3d_roomDims');
      if (raw) {
        const all = JSON.parse(raw) || {};
        const rd = all[room.id];
        if (rd && Number.isFinite(+rd.length) && Number.isFinite(+rd.width) && +rd.length > 0 && +rd.width > 0) {
          return {
            lengthM: +rd.length,
            widthM: +rd.width,
            heightM: Number.isFinite(+rd.height) && +rd.height > 0 ? +rd.height : DEFAULT_ROOM.heightM
          };
        }
      }
    } catch (_) { /* ignore localStorage parse errors */ }

    // Last-chance direct read from room — handles rooms saved with only
    // length/width (no ceiling) so the solver still uses real dims.
    const dims = room.dimensions || room.dims || {};
    const len = Number(dims.lengthM ?? dims.length_m ?? room.lengthM ?? room.length_m ?? room.length);
    const wid = Number(dims.widthM ?? dims.width_m ?? room.widthM ?? room.width_m ?? room.width);
    const hgt = Number(
      dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? dims.height_m ?? dims.ceiling_height_m
        ?? room.ceilingHeightM ?? room.ceiling_height_m ?? room.height_m ?? room.height
    );
    if (Number.isFinite(len) && len > 0 && Number.isFinite(wid) && wid > 0) {
      return {
        lengthM: len,
        widthM: wid,
        heightM: Number.isFinite(hgt) && hgt > 0 ? hgt : DEFAULT_ROOM.heightM
      };
    }
    // Explicit null (no silent DEFAULT_ROOM). Previously we returned a
    // generic 20x15 box here, which made the solver recommend ~48 units
    // for a small 6x3 room and looked like the template was ignoring the
    // operator's setup.
    return null;
  }

  /**
   * Split a room rectangle into N zone rectangles along the long axis.
   * Returns an array of {id, name, lengthM, widthM} in walk-through order.
   */
  function zoneRectsFromRoom(room, zoneNames) {
    const dims = readRoomDims(room);
    if (!dims) return [];
    const long = Math.max(dims.lengthM, dims.widthM);
    const short = Math.min(dims.lengthM, dims.widthM);
    const names = Array.isArray(zoneNames) && zoneNames.length ? zoneNames : ['Zone 1'];
    const segment = long / names.length;
    return names.map((name, i) => ({
      id: `${room?.id || 'room'}-z${i + 1}`,
      name: typeof name === 'string' ? name : (name?.name || `Zone ${i + 1}`),
      lengthM: Number(segment.toFixed(2)),
      widthM: Number(short.toFixed(2)),
      heightM: dims.heightM
    }));
  }

  function zoneNamesForRoom(room) {
    // The operator is the source of truth for zone count. Only fall back to a
    // single default zone if room.zones is missing entirely — never multiply
    // zones silently (historical default was 2, which caused the Room Build
    // Plan to show 2 zones after the operator explicitly set the count to 1).
    if (!room) return ['Zone 1'];
    if (Array.isArray(room.zones) && room.zones.length) {
      return room.zones.map((z) => typeof z === 'string' ? z : (z?.name || 'Zone'));
    }
    return ['Zone 1'];
  }

  async function scoreFor(templateId, cropClass, room) {
    const _f = window.authFetch || fetch;
    const res = await _f(`/api/grow-systems/${encodeURIComponent(templateId)}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropClass, quantity: 1, room })
    });
    if (!res.ok) throw new Error('score ' + res.status);
    const body = await res.json();
    return body.scores;
  }

  function equipmentLines(template, scores, cropClass, customization) {
    const lines = [];

    const fixtureClass = template.defaultFixtureClass || {};
    const plantsPerTray = template.plantsPerTrayByClass?.[cropClass];
    const tiers = Number(customization?.levels || template.tierCount || 1);
    const traysPerTier = template.traysPerTier || 1;
    const derivedSites = plantsPerTray ? plantsPerTray * traysPerTier * tiers : null;
    // plantLocations.totalByClass is the authoritative, user-facing count
    // (manual_override on templates like NFT/DWC where the raw tier x tray x
    // plants math over-counts). Fall back to the derived figure otherwise.
    const overrideSites = template.plantLocations?.totalByClass?.[cropClass];
    const totalSites = Number.isFinite(customization?.totalLocations)
      ? Number(customization.totalLocations)
      : (Number.isFinite(overrideSites) ? overrideSites : derivedSites);
    const sitesNote = (() => {
      if (!Number.isFinite(totalSites)) return null;
      if (Number.isFinite(overrideSites)) {
        const src = template.plantLocations?.source === 'manual_override' ? 'authoritative' : 'template';
        return `${totalSites} plant sites (${src})`;
      }
      return `${totalSites} plant sites (${tiers} tier\u00d7${traysPerTier} tray\u00d7${plantsPerTray}/tray)`;
    })();
    const photoperiod = fixtureClass.photoperiodHoursByClass?.[cropClass];

    lines.push({
      label: 'Crop class',
      value: cropClass.replace(/_/g, ' '),
      note: sitesNote
    });

    if (photoperiod) {
      lines.push({ label: 'Photoperiod', value: `${photoperiod} h/day`, note: 'from recipe (override in Crop Scheduler)' });
    }

    const fixtureW = fixtureClass.fixtureWattsNominal || 0;
    const fixturesPerTier = fixtureClass.fixturesPerTierUnit || 1;
    const totalFixtures = fixturesPerTier * (tiers || 1);
    const totalLightingW = sum([fixtureW * totalFixtures]);
    const baseLightingKW = scores?.heatManagement?.lightingKW ?? (totalLightingW / 1000);
    const baseTier = Math.max(1, Number(template.tierCount || 1));
    const tierFactor = Math.max(0.1, tiers / baseTier);
    const baseSites = Number.isFinite(template.plantLocations?.totalByClass?.[cropClass])
      ? Number(template.plantLocations.totalByClass[cropClass])
      : Math.max(1, Number(derivedSites || 1));
    const siteFactor = Math.max(0.1, Number(totalSites || 1) / baseSites);
    const loadFactor = Number(((tierFactor + siteFactor) / 2).toFixed(4));
    const lightingKW = baseLightingKW * loadFactor;

    lines.push({
      label: 'Lighting',
      value: `${fmt(lightingKW, 2)} kW`,
      note: totalFixtures
        ? `${totalFixtures} fixture${totalFixtures !== 1 ? 's' : ''} \u00d7 ${fixtureW} W @ ${fixtureClass.efficacyUmolPerJ || '--'} umol/J`
        : (template.lightingSpecSummary || null)
    });

    const pumpW = template.powerClassW?.pumpsPer10kPlants || 0;
    const pumpsPer10k = template.requiredChannels?.pumpsPer10kPlants || 0;
    const pumpScaleFactor = totalSites ? Math.max(1, totalSites / 10000) : 1;
    const pumpCount = Math.max(1, Math.round(pumpsPer10k * pumpScaleFactor));
    if (pumpW > 0) {
      lines.push({
        label: 'Pumps',
        value: `${pumpCount} unit${pumpCount !== 1 ? 's' : ''}`,
        note: `~${fmt(pumpW * pumpCount, 0)} W total`
      });
    }

    const kgDay = Number.isFinite(scores?.transpiration?.dailyWaterKg)
      ? scores.transpiration.dailyWaterKg * loadFactor
      : null;
    if (Number.isFinite(kgDay)) {
      const litresDay = kgDay * KG_TO_LITRES;
      lines.push({
        label: 'Transpiration',
        value: `${fmt(kgDay, 1)} kg/day`,
        note: `\u2248 ${fmt(litresDay, 0)} L/day latent \u2014 size dehumidification accordingly`
      });
    }

    const totalHeatW = Number.isFinite(scores?.heatManagement?.totalHeatW)
      ? scores.heatManagement.totalHeatW * loadFactor
      : null;
    if (Number.isFinite(totalHeatW) && totalHeatW > 0) {
      const tons = totalHeatW / W_PER_TON;
      lines.push({
        label: 'Cooling load',
        value: `${fmt(tons, 2)} tons`,
        note: `${fmt(totalHeatW, 0)} W total (lighting + latent + sensible transpiration)`
      });
    }

    const reqCFM = Number.isFinite(scores?.envBenchmark?.inputs?.airflow?.requiredCFM)
      ? scores.envBenchmark.inputs.airflow.requiredCFM * loadFactor
      : null;
    if (Number.isFinite(reqCFM) && reqCFM > 0) {
      lines.push({
        label: 'Supply fan',
        value: `${fmt(reqCFM, 0)} CFM`,
        note: 'per room envelope ACH; split across fixtures as needed'
      });
    }

    if (scores?.tier) {
      const e = scores.envBenchmark?.score;
      lines.push({
        label: 'Env benchmark',
        value: `${fmt(e, 0)} \u2014 ${scores.tier}`,
        note: 'higher is easier to operate; see template card for breakdown'
      });
    }

    return lines;
  }

  function injectStyles() {
    if ($('rbp-styles')) return;
    const style = document.createElement('style');
    style.id = 'rbp-styles';
    style.textContent = `
      #${PANEL_ID} .rbp-cell { display:flex;flex-direction:column;gap:2px;padding:10px 12px;background:rgba(15,23,42,0.6);border:1px solid rgba(59,130,246,0.18);border-radius:10px; }
      #${PANEL_ID} .rbp-cell__label { font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#64748b;font-weight:600; }
      #${PANEL_ID} .rbp-cell__value { font-size:1.1rem;font-weight:700;color:#f1f5f9;line-height:1.2; }
      #${PANEL_ID} .rbp-cell__note  { font-size:0.72rem;color:#94a3b8; }

      #${PANEL_ID} .rbp-section-title { font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;font-weight:700;margin:16px 0 8px; }
      #${PANEL_ID} .rbp-spatial { display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px; }
      #${PANEL_ID} .rbp-zone { padding:12px;background:rgba(15,23,42,0.6);border:1px solid rgba(59,130,246,0.18);border-radius:10px; }
      #${PANEL_ID} .rbp-zone.rbp-zone--fit { border-color:rgba(34,197,94,0.5); }
      #${PANEL_ID} .rbp-zone.rbp-zone--over { border-color:rgba(239,68,68,0.7);background:rgba(69,10,10,0.35); }
      #${PANEL_ID} .rbp-zone__name { font-weight:700;color:#f1f5f9;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;gap:8px; }
      #${PANEL_ID} .rbp-zone__cap { font-size:1.4rem;font-weight:700;color:#e2e8f0; }
      #${PANEL_ID} .rbp-zone__meta { font-size:0.72rem;color:#94a3b8;margin-top:4px; }
      #${PANEL_ID} .rbp-zone__canvas { width:100%;height:140px;margin-top:8px;background:rgba(2,6,23,0.6);border-radius:6px;border:1px dashed rgba(148,163,184,0.2); }
      #${PANEL_ID} .rbp-pill { display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em; }
      #${PANEL_ID} .rbp-pill--ok { background:rgba(34,197,94,0.15);color:#86efac;border:1px solid rgba(34,197,94,0.4); }
      #${PANEL_ID} .rbp-pill--warn { background:rgba(250,204,21,0.15);color:#fde047;border:1px solid rgba(250,204,21,0.4); }
      #${PANEL_ID} .rbp-pill--err { background:rgba(239,68,68,0.18);color:#fca5a5;border:1px solid rgba(239,68,68,0.45); }

      #${PANEL_ID} .rbp-evie { margin-top:14px;padding:14px 16px;background:linear-gradient(135deg,rgba(56,189,248,0.08),rgba(139,92,246,0.08));border:1px solid rgba(56,189,248,0.3);border-radius:12px; }
      #${PANEL_ID} .rbp-evie__head { display:flex;align-items:center;gap:10px;margin-bottom:6px; }
      #${PANEL_ID} .rbp-evie__avatar { width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#38bdf8,#a855f7);display:flex;align-items:center;justify-content:center;font-weight:800;color:#0f172a;font-size:0.78rem; }
      #${PANEL_ID} .rbp-evie__name { font-weight:800;color:#e0f2fe;letter-spacing:0.02em; }
      #${PANEL_ID} .rbp-evie__role { font-size:0.68rem;text-transform:uppercase;letter-spacing:0.06em;color:#94a3b8; }
      #${PANEL_ID} .rbp-evie__body { color:#e2e8f0;font-size:0.88rem;line-height:1.45; }
      #${PANEL_ID} .rbp-evie__prompt { margin-top:10px;padding:10px 12px;background:rgba(15,23,42,0.55);border:1px dashed rgba(250,204,21,0.4);border-radius:8px;color:#fde047;font-size:0.82rem; }
      #${PANEL_ID} .rbp-evie__actions { margin-top:10px;display:flex;gap:8px;flex-wrap:wrap; }
      #${PANEL_ID} .rbp-evie__btn { background:rgba(56,189,248,0.18);color:#e0f2fe;border:1px solid rgba(56,189,248,0.5);border-radius:8px;padding:6px 12px;font-size:0.78rem;font-weight:600;cursor:pointer; }
      #${PANEL_ID} .rbp-evie__btn:hover { background:rgba(56,189,248,0.3); }

      #${PANEL_ID} .rbp-controls { display:flex;gap:14px;flex-wrap:wrap;align-items:flex-end;margin-bottom:12px; }
      #${PANEL_ID} .rbp-ctl { display:flex;flex-direction:column;gap:4px; }
      #${PANEL_ID} .rbp-ctl label { font-size:0.68rem;text-transform:uppercase;letter-spacing:0.04em;color:#94a3b8;font-weight:600; }
      #${PANEL_ID} .rbp-ctl input[type="number"] { background:rgba(15,23,42,0.8);color:#f1f5f9;border:1px solid rgba(148,163,184,0.3);border-radius:6px;padding:6px 10px;width:110px;font-size:0.9rem;min-height:32px; }
      #${PANEL_ID} .rbp-ctl--toggle { flex-direction:row;align-items:center;gap:6px;padding-bottom:6px; }
      #${PANEL_ID} .rbp-ctl__hint { font-size:0.68rem;color:#64748b;margin-top:2px; }

      #rbp-breadcrumb { display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 14px;margin:0 16px 12px;background:rgba(15,23,42,0.55);border:1px solid rgba(59,130,246,0.2);border-radius:10px;color:#94a3b8;font-size:0.78rem; }
      #rbp-breadcrumb .rbp-crumb { color:#64748b; }
      #rbp-breadcrumb .rbp-crumb--active { color:#38bdf8;font-weight:700; }
      #rbp-breadcrumb .rbp-crumb__sep { color:#475569; }
    `;
    document.head.appendChild(style);
  }

  /**
   * Draw a top-down placement diagram for a zone. Pure 2D canvas, no Three.js;
   * meant as a compact thumbnail inside each zone card.
   */
  function drawZoneCanvas(canvas, plan) {
    if (!canvas || !plan || !plan.ok) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 240;
    const cssH = canvas.clientHeight || 140;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const pad = 8;
    const zw = plan.zone.lengthM; // draw zone long-axis horizontal
    const zh = plan.zone.widthM;
    const zoneLong = Math.max(zw, zh);
    const zoneShort = Math.min(zw, zh);
    const scale = Math.min((cssW - 2 * pad) / zoneLong, (cssH - 2 * pad) / zoneShort);
    const offX = pad;
    const offY = pad;
    const zoneW = zoneLong * scale;
    const zoneH = zoneShort * scale;

    // zone outline (plumbing wall = top)
    ctx.strokeStyle = 'rgba(148,163,184,0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(offX, offY, zoneW, zoneH);
    ctx.fillStyle = 'rgba(56,189,248,0.08)';
    ctx.fillRect(offX, offY, zoneW, 4); // plumbing wall highlight
    ctx.fillStyle = 'rgba(56,189,248,0.9)';
    ctx.font = '9px system-ui, sans-serif';
    ctx.fillText('plumbing wall', offX + 2, offY - 1);

    const placements = plan.placements(plan.maxUnits);
    placements.forEach((p) => {
      // envelope (working clearance) — light overlay
      ctx.fillStyle = p.fitsInZone ? 'rgba(59,130,246,0.15)' : 'rgba(239,68,68,0.25)';
      ctx.fillRect(
        offX + p.envelope.x * scale,
        offY + p.envelope.y * scale,
        p.envelope.lengthM * scale,
        p.envelope.widthM * scale
      );
      // unit body
      ctx.fillStyle = p.fitsInZone ? 'rgba(34,197,94,0.85)' : 'rgba(239,68,68,0.9)';
      ctx.fillRect(
        offX + p.x * scale,
        offY + p.y * scale,
        p.lengthM * scale,
        p.widthM * scale
      );
      ctx.strokeStyle = 'rgba(2,6,23,0.6)';
      ctx.strokeRect(
        offX + p.x * scale,
        offY + p.y * scale,
        p.lengthM * scale,
        p.widthM * scale
      );
    });

    // dimension label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(`${zoneLong.toFixed(1)} m \u00d7 ${zoneShort.toFixed(1)} m`, offX + 2, offY + zoneH + 11);
  }

  function ensureBreadcrumb() {
    if (document.getElementById('rbp-breadcrumb')) return;
    const panel = $(PANEL_ID);
    if (!panel) return;
    const crumb = document.createElement('div');
    crumb.id = 'rbp-breadcrumb';
    crumb.innerHTML = [
      '<span class="rbp-crumb rbp-crumb--active">1. Room</span>',
      '<span class="rbp-crumb__sep">\u203a</span>',
      '<span class="rbp-crumb">2. Zones</span>',
      '<span class="rbp-crumb__sep">\u203a</span>',
      '<span class="rbp-crumb">3. Grow units</span>',
      '<span class="rbp-crumb__sep">\u203a</span>',
      '<span class="rbp-crumb">4. Lights</span>',
      '<span class="rbp-crumb__sep">\u203a</span>',
      '<span class="rbp-crumb">5. Equipment</span>',
      '<span class="rbp-crumb__sep">\u203a</span>',
      '<span class="rbp-crumb">6. Controllers</span>'
    ].join('');
    panel.parentNode.insertBefore(crumb, panel);
  }

  function updateBreadcrumbActive(step) {
    const crumb = document.getElementById('rbp-breadcrumb');
    if (!crumb) return;
    const items = crumb.querySelectorAll('.rbp-crumb');
    items.forEach((el, i) => {
      el.classList.toggle('rbp-crumb--active', i === step);
    });
  }

  function renderBody() {
    const body = $(BODY_ID);
    if (!body) return;
    if (!state.template) { body.innerHTML = ''; return; }
    const lines = equipmentLines(state.template, state.scores, state.cropClass, state.customization);
    body.innerHTML = lines.map(l => `
      <div class="rbp-cell">
        <span class="rbp-cell__label">${l.label}</span>
        <span class="rbp-cell__value">${l.value}</span>
        ${l.note ? `<span class="rbp-cell__note">${l.note}</span>` : ''}
      </div>
    `).join('');
  }

  function ensureSpatialContainer() {
    let el = $(SPATIAL_ID);
    if (el) return el;
    const panel = $(PANEL_ID);
    if (!panel) return null;
    el = document.createElement('div');
    el.id = SPATIAL_ID;
    el.style.marginTop = '16px';
    // Insert AFTER the Evie recommendation container so the assistant card
    // reads above the per-zone capacity grid (the assistant's narrative is
    // what tells the operator how many zones to plan for, so it must appear
    // before the zone-count math).
    const evie = ensureEvieContainer();
    if (evie && evie.parentNode === panel) {
      panel.insertBefore(el, evie.nextSibling);
    } else {
      const body = $(BODY_ID);
      (body && body.parentNode === panel) ? panel.appendChild(el) : panel.appendChild(el);
    }
    return el;
  }

  function renderSpatial() {
    const el = ensureSpatialContainer();
    if (!el) return;
    if (!state.template) { el.innerHTML = ''; return; }

    const solver = window.RoomLayoutSolver;
    if (!solver) {
      el.innerHTML = '<div class="tiny" style="color:#fca5a5;padding:8px;">RoomLayoutSolver not loaded.</div>';
      return;
    }
    if (!state.template.spatialContract) {
      el.innerHTML = '<div class="tiny" style="color:#fde047;padding:8px;">No spatial contract on this template \u2014 spatial planning unavailable.</div>';
      return;
    }

    // Refuse to invent a spatial plan when the operator hasn't given us real
    // room dimensions. Silently falling back to a generic 20m x 15m room
    // produced bogus "48 units" recommendations for small rooms. Tell the
    // operator exactly what's missing and link them to where they can fix it.
    // Build the node with DOM APIs (not innerHTML interpolation) so a room
    // named `<img src=x onerror=alert(1)>` stays text, not script.
    const dimsCheck = readRoomDims(state.room);
    if (!state.room || !dimsCheck) {
      el.textContent = '';
      const box = document.createElement('div');
      box.className = 'rbp-empty';
      box.setAttribute('style', 'padding:12px 14px;border:1px dashed rgba(252,211,77,0.4);border-radius:10px;background:rgba(30,41,59,0.55);color:#fde68a;font-size:0.9rem;line-height:1.5;');
      const strong = document.createElement('strong');
      strong.setAttribute('style', 'color:#fef3c7;');
      strong.textContent = 'Evie needs your room dimensions.';
      box.appendChild(strong);
      box.appendChild(document.createTextNode(" I can't recommend a grow-unit count \u2014 "));
      if (state.room) {
        const quote = document.createElement('span');
        const rawName = (state.room.name || state.room.id || '').toString();
        quote.textContent = `"${rawName}"`;
        box.appendChild(quote);
        box.appendChild(document.createTextNode(' has no length/width saved. Open '));
      } else {
        box.appendChild(document.createTextNode('no room is selected. Open '));
      }
      const link = document.createElement('a');
      link.href = '/farm-admin.html#farm-setup';
      link.setAttribute('style', 'color:#60a5fa;');
      link.textContent = 'Farm Setup \u2192 Rooms';
      box.appendChild(link);
      box.appendChild(document.createTextNode(
        ' or the 3D viewer\'s "Edit room" dialog and enter real length, width, and ceiling height in metres. I refuse to guess so you don\'t end up ordering 48 units for a 6 \u00d7 3 m room.'
      ));
      el.appendChild(box);
      return;
    }

    const zones = state.zoneRects;
    const perZonePlan = zones.map((zr) => solver.solveLayout(state.template, zr));
    const totalCapacity = perZonePlan.reduce((a, z) => a + (z.maxUnits || 0), 0);

    if (state.autoFit) {
      // Auto-fit sets desired to the zones' maximum capacity. Using Math.max
      // against the previous value would silently clamp a manual 3 up to 48
      // and feel like the field is ignoring the operator; the input listener
      // below turns auto-fit off whenever the operator types, so by the time
      // we reach this branch we genuinely want totalCapacity.
      state.desiredUnits = totalCapacity;
    } else {
      // Keep the manual value inside [0, totalCapacity] so the spatial plan
      // and the "max N across all zones" hint stay consistent.
      state.desiredUnits = Math.max(0, Math.min(state.desiredUnits || 0, totalCapacity));
    }
    const desired = Math.max(0, Math.round(state.desiredUnits || 0));

    const rec = solver.recommendZones(desired, zones, state.template);
    state.spatialPlan = { perZonePlan, desired, totalCapacity };
    state.zoneRecommendation = rec;

    const contract = state.template.spatialContract;
    const orientationLabel = contract.orientation === 'double_sided'
      ? 'Double-sided rack (towers front/back)'
      : contract.orientation === 'single_sided'
        ? 'Free-standing tile'
        : 'Butt end-to-end against plumbing wall';

    const c = state.customization || getTemplateCustomizationDefaults(state.template, state.cropClass);
    const configuredStrip = (function () {
      const list = Array.isArray(state.room && state.room.installedSystems) ? state.room.installedSystems : [];
      if (!list.length) return '';
      const chips = list.map((s, idx) => {
        const cs = s.customization || {};
        const label = s.templateId + (Number.isFinite(cs.totalLocations) ? ' · ' + cs.totalLocations + ' loc' : '') + ' × ' + (Number(s.quantity || 1));
        return `<span class="rbp-chip" data-template-id="${s.templateId}" data-installed-idx="${idx}" style="display:inline-flex;align-items:center;gap:6px;padding:4px 6px 4px 10px;border-radius:999px;background:#0f172a;border:1px solid #334155;color:#e2e8f0;font-size:0.72rem;">${label}<button type="button" class="rbp-chip-remove" data-installed-idx="${idx}" title="Remove this configured system from the room" aria-label="Remove ${s.templateId}" style="all:unset;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:999px;background:#1e293b;color:#f87171;font-weight:700;line-height:1;border:1px solid #475569;">×</button></span>`;
      }).join('');
      return `<div class="rbp-configured" style="display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px;">
        <span style="color:#94a3b8;font-size:0.72rem;align-self:center;">Configured systems:</span>${chips}
      </div>`;
    })();
    const anisoBanner = c.anisotropicWarning
      ? `<div class="rbp-warn" style="margin:6px 0 10px;padding:8px 12px;border-radius:8px;background:#422006;border:1px solid #a16207;color:#fde68a;font-size:0.78rem;">${c.anisotropicWarning} Consider relinking spacing for even plant placement.</div>`
      : '';
    const controlsHtml = `
      ${configuredStrip}
      ${anisoBanner}
      <div class="rbp-controls">
        <div class="rbp-ctl">
          <label for="rbpLevels">Levels</label>
          <input id="rbpLevels" type="number" min="1" max="20" step="1" value="${c.levels}"/>
          <span class="rbp-ctl__hint">Adjust stacked growing levels</span>
        </div>
        <div class="rbp-ctl">
          <label for="rbpSpacingIn">Hole spacing (in, center-to-center)</label>
          <input id="rbpSpacingIn" type="number" min="0.1" max="36" step="0.1" value="${c.spacingIn}"/>
          <span class="rbp-ctl__hint">2 in total border deducted from footprint</span>
        </div>
        <div class="rbp-ctl">
          <label for="rbpLocationsX">Plant sites along length (X)</label>
          <input id="rbpLocationsX" type="number" min="1" max="500" step="1" value="${c.locationsX}" ${c.spacingLinked ? 'disabled' : ''}/>
        </div>
        <div class="rbp-ctl">
          <label for="rbpLocationsY">Plant sites along width (Y)</label>
          <input id="rbpLocationsY" type="number" min="1" max="500" step="1" value="${c.locationsY}" ${c.spacingLinked ? 'disabled' : ''}/>
        </div>
        <div class="rbp-ctl rbp-ctl--toggle">
          <input id="rbpSpacingLinked" type="checkbox" ${c.spacingLinked ? 'checked' : ''}/>
          <label for="rbpSpacingLinked">Link spacing and locations</label>
        </div>
        <div class="rbp-ctl">
          <label>Total locations</label>
          <span style="color:#e2e8f0;font-size:0.88rem;padding-bottom:6px;">${c.totalLocations} (${c.locationsPerLevel}/level)</span>
        </div>
        <div class="rbp-ctl">
          <label for="${UNIT_COUNT_ID}">Grow units</label>
          <input id="${UNIT_COUNT_ID}" type="number" min="0" max="${totalCapacity}" step="1" value="${desired}"/>
          <span class="rbp-ctl__hint">${state.autoFit ? 'auto-fit: ' + totalCapacity : 'manual'} · max ${totalCapacity} across all zones</span>
        </div>
        <div class="rbp-ctl rbp-ctl--toggle">
          <input id="${AUTOFIT_ID}" type="checkbox" ${state.autoFit ? 'checked' : ''}/>
          <label for="${AUTOFIT_ID}">Auto-fit zones</label>
        </div>
        <div class="rbp-ctl">
          <label>Orientation</label>
          <span style="color:#e2e8f0;font-size:0.88rem;padding-bottom:6px;">${orientationLabel}</span>
        </div>
        <div class="rbp-ctl">
          <label>Plumbing</label>
          <span style="color:#e2e8f0;font-size:0.88rem;padding-bottom:6px;">${contract.plumbingSide === 'wall' ? 'Along long wall' : 'Flexible'}</span>
        </div>
        <div class="rbp-ctl" style="min-width:260px;display:none;" data-rbp-legacy-actions>
          <!-- Legacy inline action buttons retained for backward compatibility
               with anything that still queries them by id. The visible flow
               nav lives below the zone grid via .gm-flow-nav. -->
          <button id="rbpDoneSystems" type="button" class="rbp-evie__btn">Done with grow systems</button>
          <button id="rbpAnotherSystem" type="button" class="rbp-evie__btn">Configure another system</button>
        </div>
      </div>
    `;

    let running = 0;
    const zonesHtml = perZonePlan.map((plan, i) => {
      const take = Math.max(0, Math.min(plan.maxUnits || 0, Math.max(0, desired - running)));
      running += take;
      const fitClass = (take === 0 && desired > 0 && desired > running)
        ? 'rbp-zone--over'
        : (take >= (plan.maxUnits || 0) && desired > running - take ? 'rbp-zone--fit' : '');
      const pill = take > 0
        ? `<span class="rbp-pill rbp-pill--ok">${take} placed</span>`
        : '<span class="rbp-pill rbp-pill--warn">empty</span>';

      const meta = `${plan.unitsPerRow} per row \u00d7 ${plan.rowsMax} rows \u00b7 ${plan.rowDepthM} m row depth`;
      return `
        <div class="rbp-zone ${fitClass}" data-zone-index="${i}">
          <div class="rbp-zone__name">
            <span>${plan.zone.name || `Zone ${i + 1}`}</span>
            ${pill}
          </div>
          <div class="rbp-zone__cap">${plan.maxUnits} <span style="font-size:0.75rem;color:#94a3b8;font-weight:500;">max fits</span></div>
          <div class="rbp-zone__meta">${meta}</div>
          <canvas class="rbp-zone__canvas" data-zone-canvas="${i}" width="240" height="140"></canvas>
          <div class="rbp-zone__meta">${plan.zone.lengthM} m \u00d7 ${plan.zone.widthM} m (${plan.zone.areaM2?.toFixed ? plan.zone.areaM2.toFixed(1) : plan.zone.areaM2} m\u00b2)</div>
        </div>`;
    }).join('');

    // Preserve focus + caret position across the innerHTML swap so the
    // operator can type multi-digit numbers in the grow-units input without
    // losing focus after each keystroke.
    const prevActive = document.activeElement;
    const preserveUnits = prevActive && prevActive.id === UNIT_COUNT_ID;
    const selStart = preserveUnits ? prevActive.selectionStart : null;
    const selEnd   = preserveUnits ? prevActive.selectionEnd : null;

    el.innerHTML = `
      <div class="rbp-section-title">Zone capacity \u00b7 Evie spatial plan</div>
      ${controlsHtml}
      <div class="rbp-spatial">${zonesHtml}</div>
      <div class="gm-flow-nav" role="group" aria-label="Grow system workflow actions">
        <button id="rbpAnotherSystemNav" type="button" class="gm-flow-nav__btn gm-flow-nav__btn--ghost" title="Add a second growing system to this room (e.g. NFT plus DWC)">
          + Add another grow system
        </button>
        <button id="rbpDoneSystemsNav" type="button" class="gm-flow-nav__btn gwen-action" title="All grow systems for this room are configured. Move on to Equipment.">
          Done with grow systems &rarr;
        </button>
      </div>
    `;

    // Paint canvases with solver placements (capped at take per zone but we
    // draw the full maxUnits so operators can see the room's capacity at a
    // glance — desired-units overlay can come later).
    perZonePlan.forEach((plan, i) => {
      const canvas = el.querySelector(`canvas[data-zone-canvas="${i}"]`);
      if (canvas) drawZoneCanvas(canvas, plan);
    });

    // Wire chip remove buttons. Each click pulls the latest rooms.json,
    // splices the matching installedSystems entry out of state.room
    // (matched by templateId so stale indexes from another tab don't drop
    // the wrong row), POSTs /api/setup/save-rooms, and lets the LE
    // reconciler rebuild groups.json + emit SSE so the breadcrumb, KPIs,
    // and 3D viewer all refresh.
    el.querySelectorAll('.rbp-chip-remove').forEach((btn) => {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault(); ev.stopPropagation();
        const idx = Number(btn.getAttribute('data-installed-idx'));
        const room = state.room;
        if (!room || !Array.isArray(room.installedSystems) || !Number.isFinite(idx)) return;
        const removed = room.installedSystems[idx];
        if (!removed) return;
        const ok = window.confirm(`Remove "${removed.templateId}" × ${Number(removed.quantity || 1)} from ${room.name || room.id}? This deletes its groups from the farm.`);
        if (!ok) return;
        btn.disabled = true;
        try {
          const _f = window.authFetch || fetch;
          const roomsResp = await _f('/data/rooms.json?_=' + Date.now(), { cache: 'no-store' });
          if (!roomsResp.ok) throw new Error('rooms.json ' + roomsResp.status);
          const persistedRaw = await roomsResp.json();
          const persisted = Array.isArray(persistedRaw) ? persistedRaw : (persistedRaw && Array.isArray(persistedRaw.rooms) ? persistedRaw.rooms : []);
          const matchKey = String(room.id || room.name || '').toLowerCase();
          const target = persisted.find((r) => String(r.id || r.name || '').toLowerCase() === matchKey) || room;
          const installed = Array.isArray(target.installedSystems) ? target.installedSystems.slice() : [];
          // Remove by templateId match against the chip we clicked, not by
          // raw index, in case another tab already mutated the array.
          const dropAt = installed.findIndex((s) => s && s.templateId === removed.templateId && Number(s.quantity) === Number(removed.quantity));
          const finalDropAt = dropAt === -1 ? installed.findIndex((s) => s && s.templateId === removed.templateId) : dropAt;
          if (finalDropAt === -1) throw new Error('installedSystems entry not found');
          installed.splice(finalDropAt, 1);
          const nextRoom = Object.assign({}, target, { installedSystems: installed });
          // Drop buildPlan if no systems remain so Equipment step can reset.
          if (!installed.length) nextRoom.buildPlan = null;
          const nextRooms = persisted.map((r) => (String(r.id || r.name || '').toLowerCase() === matchKey ? nextRoom : r));
          const saveResp = await _f('/api/setup/save-rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rooms: nextRooms })
          });
          if (!saveResp.ok) throw new Error('save-rooms ' + saveResp.status);
          state.room = nextRoom;
          renderSpatial();
          if (typeof window.showToast === 'function') {
            window.showToast({ title: 'System removed', msg: `${removed.templateId} removed from ${room.name || room.id}.`, kind: 'success' }, 3000);
          }
          document.dispatchEvent(new CustomEvent('room-build-plan:saved', { detail: { roomId: room.id, removed: removed.templateId } }));
        } catch (err) {
          console.error('[rbp] remove configured system failed:', err);
          if (typeof window.showToast === 'function') {
            window.showToast({ title: 'Remove failed', msg: String(err && err.message || err), kind: 'error' }, 5000);
          } else {
            window.alert('Remove failed: ' + (err && err.message || err));
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

    const unitsInput = $(UNIT_COUNT_ID);
    if (unitsInput) {
      if (preserveUnits) {
        try { unitsInput.focus({ preventScroll: true }); } catch (_) { unitsInput.focus(); }
        if (typeof unitsInput.setSelectionRange === 'function' && selStart != null) {
          try { unitsInput.setSelectionRange(selStart, selEnd); } catch (_) { /* ignore */ }
        }
      }
      unitsInput.addEventListener('input', (e) => {
        // Typing in the grow-units field means the operator wants to override
        // the auto-fit recommendation. Flipping autoFit off here lets the
        // render branch above respect the entered value instead of snapping
        // it back to totalCapacity on re-render.
        state.autoFit = false;
        state.desiredUnits = Math.max(0, Number(e.target.value) || 0);
        renderSpatial();
        renderEvie();
      });
    }
    const autoEl = $(AUTOFIT_ID);
    if (autoEl) {
      autoEl.addEventListener('change', (e) => {
        state.autoFit = !!e.target.checked;
        if (state.autoFit) state.desiredUnits = totalCapacity;
        renderSpatial();
        renderEvie();
      });
    }

    const levelsEl = document.getElementById('rbpLevels');
    const spacingEl = document.getElementById('rbpSpacingIn');
    const locXEl = document.getElementById('rbpLocationsX');
    const locYEl = document.getElementById('rbpLocationsY');
    const linkedEl = document.getElementById('rbpSpacingLinked');
    function syncCustomizationFromInputs(source) {
      if (!state.customization) return;
      const next = Object.assign({}, state.customization, {
        levels: levelsEl ? Number(levelsEl.value) : state.customization.levels,
        spacingIn: spacingEl ? Number(spacingEl.value) : state.customization.spacingIn,
        locationsX: locXEl ? Number(locXEl.value) : state.customization.locationsX,
        locationsY: locYEl ? Number(locYEl.value) : state.customization.locationsY,
        spacingLinked: linkedEl ? !!linkedEl.checked : state.customization.spacingLinked
      });
      if (source === 'locations') next.spacingLinked = false;
      state.customization = recalcCustomization(next);
      renderBody();
      renderSpatial();
      renderEvie();
      document.dispatchEvent(new CustomEvent('grow-system-config:changed', {
        detail: {
          templateId: state.template && state.template.id,
          roomId: state.room && state.room.id,
          customization: state.customization
        }
      }));
    }
    if (levelsEl) levelsEl.addEventListener('input', function () { syncCustomizationFromInputs('levels'); });
    if (spacingEl) spacingEl.addEventListener('input', function () { syncCustomizationFromInputs('spacing'); });
    if (locXEl) locXEl.addEventListener('input', function () { syncCustomizationFromInputs('locations'); });
    if (locYEl) locYEl.addEventListener('input', function () { syncCustomizationFromInputs('locations'); });
    if (linkedEl) linkedEl.addEventListener('change', function () { syncCustomizationFromInputs('linked'); });

    const doneBtn = document.getElementById('rbpDoneSystems');
    const anotherBtn = document.getElementById('rbpAnotherSystem');
    const doneNavBtn = document.getElementById('rbpDoneSystemsNav');
    const anotherNavBtn = document.getElementById('rbpAnotherSystemNav');
    function handleDone() {
      updateBreadcrumbActive(4);
      const equip = document.getElementById('flow-equipment');
      if (equip) equip.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function handleAnother() {
      // Clear template-scoped state so the gallery selection triggers a
      // fresh configure flow, but preserve state.room (and its
      // installedSystems list) so the Configured Systems strip keeps
      // showing prior saves. Dispatch a hint event for setup-agent.
      state.template = null;
      state.scores = null;
      state.cropClass = null;
      state.desiredUnits = 0;
      state.autoFit = true;
      state.zoneRects = [];
      state.spatialPlan = null;
      state.zoneRecommendation = null;
      state.customization = null;
      hide();
      document.dispatchEvent(new CustomEvent('grow-system-config:another', {
        detail: { roomId: state.room && state.room.id }
      }));
      const gallery = document.getElementById('growTemplateGallery');
      if (gallery) gallery.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (doneBtn) doneBtn.addEventListener('click', handleDone);
    if (anotherBtn) anotherBtn.addEventListener('click', handleAnother);
    if (doneNavBtn) doneNavBtn.addEventListener('click', handleDone);
    if (anotherNavBtn) anotherNavBtn.addEventListener('click', handleAnother);
  }

  function ensureEvieContainer() {
    let el = $(EVIE_ID);
    if (el) return el;
    const panel = $(PANEL_ID);
    if (!panel) return null;
    el = document.createElement('div');
    el.id = EVIE_ID;
    panel.appendChild(el);
    return el;
  }

  function renderEvie() {
    const el = ensureEvieContainer();
    if (!el) return;
    if (!state.template) { el.innerHTML = ''; return; }
    const rec = state.zoneRecommendation;
    if (!rec) { el.innerHTML = ''; return; }
    const plan = state.spatialPlan || {};
    const shortfall = rec.shortfall || 0;
    const usedZones = Array.isArray(rec.usedZones) ? rec.usedZones : [];
    const selectedZoneCount = Array.isArray(state.zoneRects) ? state.zoneRects.length : 0;

    let rationale = rec.rationale || '';
    if (shortfall === 0 && usedZones.length > 1) {
      rationale = `${plan.desired} units are distributed across your selected zones: ${usedZones.map((u) => `${u.units} in ${u.zoneName}`).join(', ')}.`;
    }
    if (shortfall === 0 && usedZones.length <= 1 && selectedZoneCount > 1 && plan.desired > 0) {
      rationale = `${plan.desired} units fit in ${usedZones.length || 1} zone. Additional selected zones remain available for schedule or climate separation.`;
    }

    const promptHtml = (shortfall > 0)
      ? `<div class="rbp-evie__prompt">
           <strong>Capacity alert:</strong> ${plan.desired} units exceed current zone capacity by ${shortfall}. Reduce unit count, enlarge a zone, or add another zone.
         </div>`
      : '';

    const actionsHtml = (shortfall === 0 && rec.recommendedZones > 1)
      ? `<div class="rbp-evie__actions">
           <button class="rbp-evie__btn" data-act="split">Split across ${rec.recommendedZones} zones</button>
         </div>`
      : '';

    el.innerHTML = `
      <div class="rbp-evie">
        <div class="rbp-evie__head">
          <div class="rbp-evie__avatar">E</div>
          <div>
            <div class="rbp-evie__name">Evie</div>
            <div class="rbp-evie__role">Grow assistant \u00b7 zone recommendation</div>
          </div>
        </div>
        <div class="rbp-evie__body">
          ${rationale}
          <br/><br/>
          Zones are user-defined partitions for schedule separation, cleaning rotation, and optional climate isolation within the same room.
        </div>
        ${promptHtml}
        ${actionsHtml}
      </div>
    `;

    const splitBtn = el.querySelector('[data-act="split"]');
    if (splitBtn) {
      splitBtn.addEventListener('click', () => {
        const evt = new CustomEvent('grow-template:evie-split', {
          detail: { recommendation: rec, zones: state.zoneRects, template: state.template }
        });
        document.dispatchEvent(evt);
        if (typeof window.showToast === 'function') {
          window.showToast({
            title: 'Split acknowledged',
            msg: `Evie staged a ${rec.recommendedZones}-zone plan. Assign templates to each zone in the group form.`,
            kind: 'info'
          }, 3000);
        }
      });
    }
  }

  function renderHeader() {
    const title = $(TITLE_ID);
    const subtitle = $(SUBTITLE_ID);
    if (state.template) {
      if (title) title.textContent = `Room Build Plan \u2014 ${state.template.name}`;
      if (subtitle) {
        const roomName = state.room?.name || state.room?.id || 'no room selected';
        const zonesLabel = state.zoneRects?.length
          ? `${state.zoneRects.length} zone${state.zoneRects.length !== 1 ? 's' : ''}`
          : 'zones tbd';
        subtitle.textContent = `${state.template.name} \u00b7 ${roomName} \u00b7 ${zonesLabel} \u00b7 Crop class: ${state.cropClass}`;
      }
    } else {
      if (title) title.textContent = 'Room Build Plan';
      if (subtitle) subtitle.textContent = 'Select a template above to stage a build plan.';
    }
  }

  function show() {
    const panel = $(PANEL_ID);
    if (panel) panel.style.display = '';
    ensureBreadcrumb();
    updateBreadcrumbActive(2); // Grow units step
  }

  function hide() {
    const panel = $(PANEL_ID);
    if (panel) panel.style.display = 'none';
  }

  async function handleSelection({ templateId, template }) {
    if (!template) return;
    const isSameTemplate = !!(state.template && template && state.template.id === template.id);
    injectStyles();
    state.template = template;
    state.cropClass = template.defaultCropClass
      || (template.suitableCropClasses || [])[0]
      || 'leafy_greens';

    show();
    renderHeader();
    $(BODY_ID).innerHTML = '<div class="tiny" style="color:#94a3b8;padding:12px;">Computing build plan\u2026</div>';

    try {
      const rooms = await fetchRooms();
      state.room = selectedRoom(rooms);
      state.zoneRects = zoneRectsFromRoom(state.room, zoneNamesForRoom(state.room));
      // Only reset unit controls when the operator changes template.
      // For room/zone refresh events on the same template, preserve the
      // operator's manual grow-unit selection.
      if (!isSameTemplate) {
        state.autoFit = true;
        state.desiredUnits = 0;
        state.customization = recalcCustomization(getTemplateCustomizationDefaults(template, state.cropClass));
      } else if (!state.customization) {
        state.customization = recalcCustomization(getTemplateCustomizationDefaults(template, state.cropClass));
      }
      state.scores = await scoreFor(templateId, state.cropClass, roomPayload(state.room));
    } catch (err) {
      console.warn('[room-build-plan] score failed', err);
      state.scores = null;
    }
    renderHeader();
    renderBody();
    renderSpatial();
    renderEvie();
  }

  function stagePrefill() {
    if (!state.template) return;
    const nameInput = $(GROUP_NAME_ID);
    if (nameInput && !nameInput.value) {
      nameInput.value = `${state.template.name} \u2014 Group 1`;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.__roomBuildPlan = {
      templateId: state.template.id,
      template: state.template,
      cropClass: state.cropClass,
      scores: state.scores,
      desiredUnits: state.desiredUnits,
      zoneRects: state.zoneRects,
      spatialPlan: state.spatialPlan,
      zoneRecommendation: state.zoneRecommendation,
      customization: state.customization
    };
    try {
      if (window.localStorage) {
        window.localStorage.setItem('growWorkspaceDraft', JSON.stringify({
          ts: Date.now(),
          source: 'grow-management',
          roomId: state.room && state.room.id,
          templateId: state.template && state.template.id,
          desiredUnits: state.desiredUnits,
          customization: state.customization || null
        }));
      }
    } catch (_) { /* ignore */ }
    if (window.DataFlowBus && typeof window.DataFlowBus.emit === 'function') {
      window.DataFlowBus.emit('grow-workspace', {
        kind: 'grow-workspace',
        roomId: state.room && state.room.id,
        templateId: state.template && state.template.id,
        desiredUnits: state.desiredUnits,
        customization: state.customization || null
      });
    }
    const panel = document.getElementById('groupsV2Panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    updateBreadcrumbActive(3); // Lights next
    if (typeof window.showToast === 'function') {
      window.showToast({
        title: 'Template staged',
        msg: `Group form prefilled for ${state.template.name}. Assign lights, review, then Save Group.`,
        kind: 'success'
      }, 3000);
    }
  }

  function scrollToLightAssignment() {
    const selectEl = document.getElementById('groupsV2UnassignedLightsSelect');
    const card = selectEl && selectEl.closest('.gm-card');
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    updateBreadcrumbActive(3); // Lights step
  }

  function clear() {
    state = {
      template: null, scores: null, room: null, cropClass: null,
      desiredUnits: 0, autoFit: true, zoneRects: [],
      spatialPlan: null, zoneRecommendation: null, customization: null
    };
    hide();
    renderHeader();
    const spatial = $(SPATIAL_ID); if (spatial) spatial.innerHTML = '';
    const evie = $(EVIE_ID); if (evie) evie.innerHTML = '';
    if (window.__roomBuildPlan) delete window.__roomBuildPlan;
    document.querySelectorAll('.tg-card[aria-pressed="true"]')
      .forEach(c => c.setAttribute('aria-pressed', 'false'));
  }

  // Persist the currently-staged build plan to rooms.json. Merges a
  // buildPlan block + installedSystems[] entry onto the selected room
  // and POSTs the full rooms array to /api/setup/save-rooms. Shape
  // matches lib/schema-validator.js roomsSchema (buildPlan + installedSystems).
  async function saveBuildPlan() {
    if (!state.template || !state.room) {
      if (typeof window.showToast === 'function') {
        window.showToast({ title: 'Nothing to save', msg: 'Pick a template first.', kind: 'warn' }, 3000);
      }
      return;
    }
    try {
      const _fRooms = window.authFetch || fetch;
      const roomsResp = await _fRooms('/data/rooms.json');
      const roomsDoc = roomsResp.ok ? await roomsResp.json() : { rooms: [] };
      const rooms = Array.isArray(roomsDoc.rooms) ? roomsDoc.rooms : [];
      const idx = rooms.findIndex(r => r.id === state.room.id);
      if (idx === -1) {
        if (typeof window.showToast === 'function') {
          window.showToast({ title: 'Room not found', msg: `Could not find ${state.room.name || state.room.id}.`, kind: 'error' }, 4000);
        }
        return;
      }

      const room = rooms[idx];
      const tpl  = state.template;
      const sc   = state.scores || {};
      const qty  = Math.max(1, state.desiredUnits || 1);
      const customization = recalcCustomization(state.customization || getTemplateCustomizationDefaults(tpl, state.cropClass));

      // computedLoad matches buildPlanSchema.computedLoad. Derive
      // from scores where available, from template otherwise.
      const baseLightingKW = Number.isFinite(sc.power?.lightingW)
        ? sc.power.lightingW / 1000
        : (Number.isFinite(tpl.powerClassW?.lightingPerUnit)
            ? (tpl.powerClassW.lightingPerUnit * qty) / 1000
            : 0);
      const baseSites = Number.isFinite(tpl.plantLocations?.totalByClass?.[state.cropClass])
        ? Number(tpl.plantLocations.totalByClass[state.cropClass])
        : Math.max(1, Number(tpl.plantsPerTrayByClass?.[state.cropClass] || 1) * Math.max(1, Number(tpl.tierCount || 1)));
      const siteFactor = Math.max(0.1, Number(customization.totalLocations || baseSites) / baseSites);
      const tierFactor = Math.max(0.1, Number(customization.levels || tpl.tierCount || 1) / Math.max(1, Number(tpl.tierCount || 1)));
      const loadFactor = Number(((siteFactor + tierFactor) / 2).toFixed(4));

      const pumpKW = Number.isFinite(tpl.powerClassW?.pumpsPer10kPlants)
        ? (tpl.powerClassW.pumpsPer10kPlants * Math.max(1, (tpl.plantSitesPerUnit || 0) * qty / 10000)) / 1000
        : 0;
      const lightingKW = baseLightingKW * loadFactor;
      const coolingTons = Number.isFinite(sc.heatManagement?.totalHeatW)
        ? (sc.heatManagement.totalHeatW * loadFactor) / W_PER_TON : 0;
      const dehumLPerDay = Number.isFinite(sc.transpiration?.dailyWaterKg)
        ? (sc.transpiration.dailyWaterKg * loadFactor) * KG_TO_LITRES : 0;
      const supplyFanCFM = Number.isFinite(sc.envBenchmark?.inputs?.airflow?.requiredCFM)
        ? sc.envBenchmark.inputs.airflow.requiredCFM * loadFactor : 0;

      const buildPlan = {
        status: 'accepted',
        generatedAt: new Date().toISOString(),
        computedLoad: {
          lightingKW: Number(lightingKW.toFixed(3)),
          coolingTons: Number(coolingTons.toFixed(3)),
          dehumLPerDay: Number(dehumLPerDay.toFixed(2)),
          supplyFanCFM: Math.round(supplyFanCFM),
          pumpKW: Number(pumpKW.toFixed(3)),
          totalCircuitKW: Number((lightingKW + pumpKW).toFixed(3))
        },
        acceptedEquipment: [],
        reservedControllerSlots: []
      };
      // acceptedEquipment: one line per non-zero category so Phase B
      // discovery has concrete targets to bind into.
      if (coolingTons > 0)   buildPlan.acceptedEquipment.push({ category: 'hvac',         templateId: tpl.id, quantity: 1, notes: `${coolingTons.toFixed(2)} tons cooling` });
      if (dehumLPerDay > 0)  buildPlan.acceptedEquipment.push({ category: 'dehumidifier', templateId: tpl.id, quantity: 1, notes: `${Math.round(dehumLPerDay)} L/day` });
      if (supplyFanCFM > 0)  buildPlan.acceptedEquipment.push({ category: 'fans',         templateId: tpl.id, quantity: 1, notes: `${Math.round(supplyFanCFM)} CFM supply` });
      if (lightingKW > 0)    buildPlan.acceptedEquipment.push({ category: 'lights',       templateId: tpl.id, quantity: qty, notes: `${lightingKW.toFixed(2)} kW total` });
      if (pumpKW > 0)        buildPlan.acceptedEquipment.push({ category: 'pumps',        templateId: tpl.id, quantity: 1, notes: `${(pumpKW * 1000).toFixed(0)} W recirculating` });

      // installedSystems[]: upsert on templateId; updates quantity if
      // the template is already installed.
      const installed = Array.isArray(room.installedSystems) ? room.installedSystems.slice() : [];
      const existing = installed.findIndex(s => s && s.templateId === tpl.id);
      const entry = { templateId: tpl.id, quantity: qty, customization };
      if (existing === -1) installed.push(entry);
      else installed[existing] = Object.assign({}, installed[existing], entry);

      rooms[idx] = Object.assign({}, room, {
        installedSystems: installed,
        buildPlan: buildPlan
      });

      const _fSave = window.authFetch || fetch;
      const saveResp = await _fSave('/api/setup/save-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rooms })
      });
      if (!saveResp.ok) {
        const text = await saveResp.text().catch(() => '');
        throw new Error(`save-rooms ${saveResp.status}: ${text}`);
      }
      if (typeof window.showToast === 'function') {
        window.showToast({
          title: 'Build plan saved',
          msg: `${tpl.name} × ${qty} persisted to ${room.name || room.id}. Equipment step now shows the accepted plan.`,
          kind: 'success'
        }, 3500);
      }
      document.dispatchEvent(new CustomEvent('room-build-plan:saved', {
        detail: { roomId: room.id, templateId: tpl.id, quantity: qty, buildPlan, customization }
      }));
      // Refresh local state.room so the Configured Systems strip reflects
      // the newly saved installedSystems entry without requiring a reload.
      try {
        state.room = Object.assign({}, state.room, {
          installedSystems: installed,
          buildPlan: buildPlan
        });
        renderSpatial();
      } catch (_) { /* non-fatal */ }
      try {
        if (window.localStorage) {
          window.localStorage.setItem('growWorkspaceDraft', JSON.stringify({
            ts: Date.now(),
            source: 'grow-management',
            roomId: room.id,
            templateId: tpl.id,
            desiredUnits: qty,
            customization
          }));
        }
      } catch (_) { /* ignore */ }
      if (window.DataFlowBus && typeof window.DataFlowBus.emit === 'function') {
        window.DataFlowBus.emit('grow-workspace', {
          kind: 'grow-workspace',
          roomId: room.id,
          templateId: tpl.id,
          desiredUnits: qty,
          customization
        });
      }
    } catch (err) {
      console.error('[rbp] saveBuildPlan failed:', err);
      if (typeof window.showToast === 'function') {
        window.showToast({ title: 'Save failed', msg: err.message || 'Unknown error', kind: 'error' }, 4000);
      }
    }
  }

  function wire() {
    injectStyles();
    ensureBreadcrumb();
    document.addEventListener('grow-template:selected', (ev) => handleSelection(ev.detail || {}));
    const prefillBtn = $(PREFILL_BTN);
    const assignBtn  = $(ASSIGN_BTN);
    const savePlanBtn= $(SAVE_PLAN_BTN);
    const clearBtn   = $(CLEAR_BTN);
    if (prefillBtn) prefillBtn.addEventListener('click', stagePrefill);
    if (assignBtn)  assignBtn.addEventListener('click', scrollToLightAssignment);
    if (savePlanBtn) savePlanBtn.addEventListener('click', saveBuildPlan);
    if (clearBtn)   clearBtn.addEventListener('click', clear);

    const roomSel = $(ROOM_SELECT_ID);
    if (roomSel) {
      roomSel.addEventListener('change', async () => {
        if (!state.template) return;
        await handleSelection({ templateId: state.template.id, template: state.template });
      });
    }

    // Subscribe to the cross-page data bus so zone-count changes in the
    // stepper or the draw-zones drawer re-run the plan with the new zone
    // names. Without this the RBP keeps its in-memory closure and renders
    // the old (pre-save) zone count even after /api/rooms reflects the new
    // value. Also listen to the legacy `rooms-updated` DOM event for older
    // producers that haven't adopted the bus yet.
    function refetchAndRender() {
      if (!state.template) return;
      handleSelection({ templateId: state.template.id, template: state.template });
    }
    if (window.DataFlowBus && typeof window.DataFlowBus.on === 'function') {
      window.DataFlowBus.on('rooms', refetchAndRender);
      window.DataFlowBus.on('zones', refetchAndRender);
    }
    document.addEventListener('rooms-updated', refetchAndRender);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
