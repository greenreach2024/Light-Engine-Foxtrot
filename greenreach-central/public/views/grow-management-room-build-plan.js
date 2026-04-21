/**
 * Grow Management — Room Build Plan
 * ==================================
 *
 * Listens for `grow-template:selected` (fired by grow-management-template-gallery.js)
 * and renders a "Room Build Plan" card that turns the scoring engine's raw load
 * totals into an operator-facing equipment sizing list, then provides a one-click
 * "Stage group from template" prefill into the existing Groups V2 form.
 *
 * This is the template-click enhancement called out in
 * docs/features/FARM_SETUP_WORKFLOW_PROPOSAL.md §2 Phase A: selecting a template
 * should compute lighting kW, transpiration kg/day, cooling load, fan CFM, and
 * stage a proposed build — not just highlight the card border.
 */
(function () {
  'use strict';

  const PANEL_ID       = 'roomBuildPlan';
  const BODY_ID        = 'rbpBody';
  const TITLE_ID       = 'rbpTitle';
  const SUBTITLE_ID    = 'rbpSubtitle';
  const PREFILL_BTN    = 'rbpPrefillBtn';
  const ASSIGN_BTN     = 'rbpAssignLightsBtn';
  const CLEAR_BTN      = 'rbpClearBtn';
  const ROOM_SELECT_ID = 'groupsV2RoomSelect';
  const ZONE_SELECT_ID = 'groupsV2ZoneSelect';
  const GROUP_NAME_ID  = 'groupsV2ZoneName';

  // 1 cooling ton = 3517 W sensible. Round up to conservative ton sizes.
  const W_PER_TON = 3517;

  // kg of water per day per L of dehumidifier capacity, conservative.
  // Commercial units ship 40-90 L/day; we keep a 1:1 kg:L mapping because
  // leafy-green transpiration is the dominant latent load here.
  const KG_TO_LITRES = 1.0;

  let state = { template: null, scores: null, room: null, cropClass: null };

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

    // ---- Plant sites ----
    const plantsPerTray = template.plantsPerTrayByClass?.[cropClass];
    const tiers = template.tierCount || 1;
    const traysPerTier = template.traysPerTier || 1;
    const totalSites = plantsPerTray ? plantsPerTray * traysPerTier * tiers : null;
    const photoperiod = template.photoperiodHoursByClass?.[cropClass];

    lines.push({
      label: 'Crop class',
      value: cropClass.replace('_', ' '),
      note: totalSites ? `${totalSites} plant sites (${tiers} tier\u00d7${traysPerTier} tray\u00d7${plantsPerTray}/tray)` : null
    });

    if (photoperiod) {
      lines.push({ label: 'Photoperiod', value: `${photoperiod} h/day`, note: 'from recipe (override in Crop Scheduler)' });
    }

    // ---- Lighting ----
    const fixtureW = template.fixtureWattsNominal || 0;
    const fixturesPerTier = template.fixturesPerTierUnit || 1;
    const totalFixtures = fixturesPerTier * (tiers || 1);
    const totalLightingW = sum([fixtureW * totalFixtures]);
    const lightingKW = scores?.heatManagement?.lightingKW ?? (totalLightingW / 1000);

    lines.push({
      label: 'Lighting',
      value: `${fmt(lightingKW, 2)} kW`,
      note: totalFixtures
        ? `${totalFixtures} fixture${totalFixtures !== 1 ? 's' : ''} \u00d7 ${fixtureW} W @ ${template.efficacyUmolPerJ || '--'} umol/J`
        : (template.lightingSpecSummary || null)
    });

    // ---- Pumps ----
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

    // ---- Transpiration / dehumidification sizing ----
    const kgDay = scores?.transpiration?.dailyWaterKg;
    if (Number.isFinite(kgDay)) {
      const litresDay = kgDay * KG_TO_LITRES;
      lines.push({
        label: 'Transpiration',
        value: `${fmt(kgDay, 1)} kg/day`,
        note: `\u2248 ${fmt(litresDay, 0)} L/day latent \u2014 size dehumidification accordingly`
      });
    }

    // ---- Cooling sizing ----
    const totalHeatW = scores?.heatManagement?.totalHeatW;
    if (Number.isFinite(totalHeatW) && totalHeatW > 0) {
      const tons = totalHeatW / W_PER_TON;
      lines.push({
        label: 'Cooling load',
        value: `${fmt(tons, 2)} tons`,
        note: `${fmt(totalHeatW, 0)} W total (lighting + latent + sensible transpiration)`
      });
    }

    // ---- Airflow ----
    const reqCFM = scores?.envBenchmark?.inputs?.airflow?.requiredCFM;
    if (Number.isFinite(reqCFM) && reqCFM > 0) {
      lines.push({
        label: 'Supply fan',
        value: `${fmt(reqCFM, 0)} CFM`,
        note: 'per room envelope ACH; split across fixtures as needed'
      });
    }

    // ---- Environment benchmark tier ----
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
    `;
    document.head.appendChild(style);
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

  function renderHeader() {
    const title = $(TITLE_ID);
    const subtitle = $(SUBTITLE_ID);
    if (state.template) {
      if (title) title.textContent = `Room Build Plan \u2014 ${state.template.name}`;
      if (subtitle) {
        const roomName = state.room?.name || state.room?.id || 'no room selected';
        subtitle.textContent = `Template: ${state.template.name} \u00b7 Room: ${roomName} \u00b7 Crop class: ${state.cropClass}`;
      }
    } else {
      if (title) title.textContent = 'Room Build Plan';
      if (subtitle) subtitle.textContent = 'Select a template above to stage a build plan.';
    }
  }

  function show() {
    const panel = $(PANEL_ID);
    if (panel) panel.style.display = '';
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
      state.scores = await scoreFor(templateId, state.cropClass, roomPayload(state.room));
    } catch (err) {
      console.warn('[room-build-plan] score failed', err);
      state.scores = null;
    }
    renderHeader();
    renderBody();
  }

  function stagePrefill() {
    if (!state.template) return;
    const nameInput = $(GROUP_NAME_ID);
    if (nameInput && !nameInput.value) {
      nameInput.value = `${state.template.name} \u2014 Group 1`;
      nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
    // Record the chosen template on the group-form scope so Save Group can
    // pick it up without needing a new field.
    window.__roomBuildPlan = {
      templateId: state.template.id,
      template: state.template,
      cropClass: state.cropClass,
      scores: state.scores
    };
    const panel = document.getElementById('groupsV2Panel');
    if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
  }

  function clear() {
    state = { template: null, scores: null, room: null, cropClass: null };
    hide();
    renderHeader();
    if (window.__roomBuildPlan) delete window.__roomBuildPlan;
    document.querySelectorAll('.tg-card[aria-pressed="true"]')
      .forEach(c => c.setAttribute('aria-pressed', 'false'));
  }

  function wire() {
    document.addEventListener('grow-template:selected', (ev) => handleSelection(ev.detail || {}));
    const prefillBtn = $(PREFILL_BTN);
    const assignBtn  = $(ASSIGN_BTN);
    const clearBtn   = $(CLEAR_BTN);
    if (prefillBtn) prefillBtn.addEventListener('click', stagePrefill);
    if (assignBtn)  assignBtn.addEventListener('click', scrollToLightAssignment);
    if (clearBtn)   clearBtn.addEventListener('click', clear);

    // Re-score when the active room changes.
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
