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
    zoneRecommendation: null
  };

  function $(id) { return document.getElementById(id); }

  function fmt(n, digits = 0) {
    if (n == null || !Number.isFinite(n)) return '--';
    return Number(n).toFixed(digits);
  }

  function sum(a) { return a.reduce((t, x) => t + (Number.isFinite(x) ? x : 0), 0); }

  function fetchRooms() {
    return fetch('/api/rooms', { credentials: 'same-origin' })
      .then(r => r.ok ? r.json() : [])
      .then(body => Array.isArray(body) ? body : (body.rooms || body.items || []))
      .catch(() => []);
  }

  function selectedRoom(rooms) {
    const sel = $(ROOM_SELECT_ID);
    const id = sel && sel.value;
    if (!id) return null;
    return rooms.find(r => r.id === id || r.name === id) || null;
  }

  function roomPayload(room) {
    if (!room) return null;
    const dims = room.dimensions || room.dims || {};
    const len = Number(dims.lengthM ?? dims.length_m ?? room.lengthM);
    const wid = Number(dims.widthM ?? dims.width_m ?? room.widthM);
    const hgt = Number(dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? room.ceilingHeightM);
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
   * store (written by its "edit room" dialog). Falls back to the room payload
   * fields and, as a last resort, DEFAULT_ROOM.
   */
  function readRoomDims(room) {
    if (!room) return { ...DEFAULT_ROOM };
    try {
      const raw = localStorage.getItem('farm3d_roomDims');
      if (raw) {
        const all = JSON.parse(raw) || {};
        const rd = all[room.id];
        if (rd && Number.isFinite(+rd.length) && Number.isFinite(+rd.width)) {
          return {
            lengthM: +rd.length,
            widthM: +rd.width,
            heightM: Number.isFinite(+rd.height) ? +rd.height : DEFAULT_ROOM.heightM
          };
        }
      }
    } catch (_) { /* ignore localStorage parse errors */ }

    const payload = roomPayload(room);
    if (payload?.dimensions) {
      return {
        lengthM: payload.dimensions.lengthM,
        widthM: payload.dimensions.widthM,
        heightM: payload.dimensions.ceilingHeightM
      };
    }
    return { ...DEFAULT_ROOM };
  }

  /**
   * Split a room rectangle into N zone rectangles along the long axis.
   * Returns an array of {id, name, lengthM, widthM} in walk-through order.
   */
  function zoneRectsFromRoom(room, zoneNames) {
    const dims = readRoomDims(room);
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
    if (!room) return ['Zone 1', 'Zone 2'];
    if (Array.isArray(room.zones) && room.zones.length) {
      return room.zones.map((z) => typeof z === 'string' ? z : (z?.name || 'Zone'));
    }
    return ['Zone 1', 'Zone 2'];
  }

  async function scoreFor(templateId, cropClass, room) {
    const res = await fetch(`/api/grow-systems/${encodeURIComponent(templateId)}/score`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cropClass, quantity: 1, room })
    });
    if (!res.ok) throw new Error('score ' + res.status);
    const body = await res.json();
    return body.scores;
  }

  function equipmentLines(template, scores, cropClass) {
    const lines = [];

    const fixtureClass = template.defaultFixtureClass || {};
    const plantsPerTray = template.plantsPerTrayByClass?.[cropClass];
    const tiers = template.tierCount || 1;
    const traysPerTier = template.traysPerTier || 1;
    const totalSites = plantsPerTray ? plantsPerTray * traysPerTier * tiers : null;
    const photoperiod = fixtureClass.photoperiodHoursByClass?.[cropClass];

    lines.push({
      label: 'Crop class',
      value: cropClass.replace(/_/g, ' '),
      note: totalSites ? `${totalSites} plant sites (${tiers} tier\u00d7${traysPerTier} tray\u00d7${plantsPerTray}/tray)` : null
    });

    if (photoperiod) {
      lines.push({ label: 'Photoperiod', value: `${photoperiod} h/day`, note: 'from recipe (override in Crop Scheduler)' });
    }

    const fixtureW = fixtureClass.fixtureWattsNominal || 0;
    const fixturesPerTier = fixtureClass.fixturesPerTierUnit || 1;
    const totalFixtures = fixturesPerTier * (tiers || 1);
    const totalLightingW = sum([fixtureW * totalFixtures]);
    const lightingKW = scores?.heatManagement?.lightingKW ?? (totalLightingW / 1000);

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

    const kgDay = scores?.transpiration?.dailyWaterKg;
    if (Number.isFinite(kgDay)) {
      const litresDay = kgDay * KG_TO_LITRES;
      lines.push({
        label: 'Transpiration',
        value: `${fmt(kgDay, 1)} kg/day`,
        note: `\u2248 ${fmt(litresDay, 0)} L/day latent \u2014 size dehumidification accordingly`
      });
    }

    const totalHeatW = scores?.heatManagement?.totalHeatW;
    if (Number.isFinite(totalHeatW) && totalHeatW > 0) {
      const tons = totalHeatW / W_PER_TON;
      lines.push({
        label: 'Cooling load',
        value: `${fmt(tons, 2)} tons`,
        note: `${fmt(totalHeatW, 0)} W total (lighting + latent + sensible transpiration)`
      });
    }

    const reqCFM = scores?.envBenchmark?.inputs?.airflow?.requiredCFM;
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
    const lines = equipmentLines(state.template, state.scores, state.cropClass);
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
    // Insert after the body grid
    const body = $(BODY_ID);
    (body && body.parentNode === panel) ? panel.appendChild(el) : panel.appendChild(el);
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

    const zones = state.zoneRects;
    const perZonePlan = zones.map((zr) => solver.solveLayout(state.template, zr));
    const totalCapacity = perZonePlan.reduce((a, z) => a + (z.maxUnits || 0), 0);

    if (state.autoFit) {
      state.desiredUnits = Math.max(state.desiredUnits || 0, totalCapacity);
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

    const controlsHtml = `
      <div class="rbp-controls">
        <div class="rbp-ctl">
          <label for="${UNIT_COUNT_ID}">Grow units</label>
          <input id="${UNIT_COUNT_ID}" type="number" min="0" step="1" value="${desired}" ${state.autoFit ? 'disabled' : ''}/>
          <span class="rbp-ctl__hint">max ${totalCapacity} across all zones</span>
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
      </div>
    `;

    let running = 0;
    const zonesHtml = perZonePlan.map((plan, i) => {
      const take = Math.max(0, Math.min(plan.maxUnits || 0, Math.max(0, desired - running)));
      running += take;
      const fitClass = (take === 0 && desired > 0)
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
    `;

    // Paint canvases with solver placements (capped at take per zone but we
    // draw the full maxUnits so operators can see the room's capacity at a
    // glance — desired-units overlay can come later).
    perZonePlan.forEach((plan, i) => {
      const canvas = el.querySelector(`canvas[data-zone-canvas="${i}"]`);
      if (canvas) drawZoneCanvas(canvas, plan);
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

    const promptHtml = (shortfall > 0 || (rec.recommendedZones > 1 && plan.desired > (rec.perZone[0]?.maxUnits || 0)))
      ? `<div class="rbp-evie__prompt">
           <strong>Prompt:</strong> ${plan.desired} units exceed Zone 1's capacity (${rec.perZone[0]?.maxUnits || 0}). Should both zones be used for the selected number of growing units?
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
          ${rec.rationale}
          <br/><br/>
          Zones are an effective way to manage planting schedules, room maintenance, and unique growing environments within the same room (depending on the equipment available).
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
      // Reset desired units when switching templates; auto-fit will pick up capacity on render.
      state.autoFit = true;
      state.desiredUnits = 0;
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
      zoneRecommendation: state.zoneRecommendation
    };
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
      spatialPlan: null, zoneRecommendation: null
    };
    hide();
    renderHeader();
    const spatial = $(SPATIAL_ID); if (spatial) spatial.innerHTML = '';
    const evie = $(EVIE_ID); if (evie) evie.innerHTML = '';
    if (window.__roomBuildPlan) delete window.__roomBuildPlan;
    document.querySelectorAll('.tg-card[aria-pressed="true"]')
      .forEach(c => c.setAttribute('aria-pressed', 'false'));
  }

  function wire() {
    injectStyles();
    ensureBreadcrumb();
    document.addEventListener('grow-template:selected', (ev) => handleSelection(ev.detail || {}));
    const prefillBtn = $(PREFILL_BTN);
    const assignBtn  = $(ASSIGN_BTN);
    const clearBtn   = $(CLEAR_BTN);
    if (prefillBtn) prefillBtn.addEventListener('click', stagePrefill);
    if (assignBtn)  assignBtn.addEventListener('click', scrollToLightAssignment);
    if (clearBtn)   clearBtn.addEventListener('click', clear);

    const roomSel = $(ROOM_SELECT_ID);
    if (roomSel) {
      roomSel.addEventListener('change', async () => {
        if (!state.template) return;
        await handleSelection({ templateId: state.template.id, template: state.template });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
