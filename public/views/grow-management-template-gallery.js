/**
 * Grow Management — Template Gallery
 * ===================================
 *
 * Renders the top-of-page "pick a grow system" card gallery. Each card shows:
 *   - a cinematic SVG illustration of the template category
 *   - name + tagline + dimensions
 *   - generic recommended lighting spec (no brand)
 *   - three scores (transpiration, heat management, environmental benchmark)
 *     scoped to the currently selected room and the template's default crop
 *     class at quantity=1.
 *
 * The gallery is additive and read-only. Clicking a card fires a
 * `grow-template:selected` CustomEvent on document with
 *   detail = { templateId, template }
 * so groups-v2.js (or future code) can react — but the existing group
 * create flow is untouched for now.
 *
 * All scoring is computed server-side via POST /api/grow-systems/:id/score.
 */
(function () {
  'use strict';

  const MOUNT_SELECTOR = '[data-template-gallery-mount]';
  const ROOM_SELECT_ID = 'groupsV2RoomSelect';

  function fmt(n, digits = 0) {
    if (n == null || !Number.isFinite(n)) return '--';
    return Number(n).toFixed(digits);
  }

  function tierClass(tier) {
    switch (tier) {
      case 'benchmark': return 'tg-tier-benchmark';
      case 'favorable': return 'tg-tier-favorable';
      case 'manageable': return 'tg-tier-manageable';
      case 'demanding': return 'tg-tier-demanding';
      case 'stressed': return 'tg-tier-stressed';
      default: return '';
    }
  }

  function scoreColor(score) {
    // Lower = better for T/H (less load). 0-30 green, 30-60 amber, 60+ red.
    if (score < 30) return '#16a34a';
    if (score < 60) return '#eab308';
    return '#ef4444';
  }

  function envColor(score) {
    // Higher = better for E (benchmark). 70+ green, 40-70 amber, <40 red.
    if (score >= 70) return '#16a34a';
    if (score >= 40) return '#eab308';
    return '#ef4444';
  }

  async function fetchRegistry() {
    const res = await fetch('/api/grow-systems', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Failed to load /api/grow-systems: ' + res.status);
    const body = await res.json();
    return body.templates || body.registry?.templates || [];
  }

  async function fetchRooms() {
    try {
      const _f = window.authFetch || fetch;
      const bust = (url) => (window.DataFlowBus && window.DataFlowBus.cacheBust)
        ? window.DataFlowBus.cacheBust(url)
        : url;
      async function fetchOne(url) {
        const res = await _f(bust(url), { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok) return [];
        const body = await res.json();
        if (Array.isArray(body)) return body;
        if (Array.isArray(body.rooms)) return body.rooms;
        if (Array.isArray(body.items)) return body.items;
        return [];
      }
      let rooms = await fetchOne('/data/rooms.json');
      if (!rooms.length) rooms = await fetchOne('/api/rooms');
      if (!rooms.length && Array.isArray(window.__ffFlowRooms)) rooms = window.__ffFlowRooms;
      if (!rooms.length && window.STATE && Array.isArray(window.STATE.rooms)) rooms = window.STATE.rooms;
      return Array.isArray(rooms) ? rooms : [];
    } catch (_) {
      if (Array.isArray(window.__ffFlowRooms) && window.__ffFlowRooms.length) return window.__ffFlowRooms;
      if (window.STATE && Array.isArray(window.STATE.rooms) && window.STATE.rooms.length) return window.STATE.rooms;
      return [];
    }
  }

  function selectedRoom(rooms) {
    const sel = document.getElementById(ROOM_SELECT_ID);
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

    return rooms.find(hasRealDims) || rooms[0] || null;
  }

  function roomScoringPayload(room) {
    if (!room) return null;
    // Room schema varies; normalize.
    const dims = room.dimensions || room.dims || {};
    const len = Number(dims.lengthM ?? dims.length_m ?? room.lengthM ?? room.length_m ?? room.length);
    const wid = Number(dims.widthM ?? dims.width_m ?? room.widthM ?? room.width_m ?? room.width);
    const hgt = Number(
      dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? dims.height_m ?? dims.ceiling_height_m
        ?? room.ceilingHeightM ?? room.ceiling_height_m ?? room.height_m ?? room.height
    );
    const envelope = room.envelope?.class || room.envelopeClass || 'typical';
    const supplyCFM = Number(room.supplyCFM ?? room.supply_cfm ?? 0) || null;
    const out = {};
    if (Number.isFinite(len) && Number.isFinite(wid) && Number.isFinite(hgt) && len > 0 && wid > 0 && hgt > 0) {
      out.dimensions = { lengthM: len, widthM: wid, ceilingHeightM: hgt };
    }
    if (envelope) out.envelope = { class: envelope };
    if (supplyCFM) out.supplyCFM = supplyCFM;
    return Object.keys(out).length ? out : null;
  }

  async function scoreTemplate(templateId, cropClass, room) {
    const body = { cropClass, quantity: 1, room };
    const _f = window.authFetch || fetch;
    const res = await _f(`/api/grow-systems/${encodeURIComponent(templateId)}/score`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Score failed for ${templateId}: ${res.status}`);
    const data = await res.json();
    return data.scores;
  }

  function renderCard(template, scores, templateNameById) {
    const cropClass = template.defaultCropClass || (template.suitableCropClasses || [])[0] || 'leafy_greens';
    const footprintStr = template.footprintM
      ? `${template.footprintM.length} m \u00d7 ${template.footprintM.width} m \u00d7 ${template.heightM || '?'} m`
      : '';
    const plants = template.plantsPerTrayByClass?.[cropClass];
    const totalSites = plants ? plants * (template.traysPerTier || 1) * (template.tierCount || 1) : null;

    const t = scores?.transpiration;
    const h = scores?.heatManagement;
    const e = scores?.envBenchmark;
    const siteSource = Number.isFinite(template.plantLocations?.totalByClass?.[cropClass])
      ? template.plantLocations.totalByClass[cropClass]
      : totalSites;
    const authoritativeSites = Number.isFinite(siteSource) ? siteSource : totalSites;

    return `
      <article class="tg-card" data-template-id="${template.id}" tabindex="0" role="button" aria-label="Select ${template.name}">
        <div class="tg-card__art">
          <img src="${template.image || ''}" alt="" loading="lazy">
          ${template.deprecated ? `<div style="position:absolute;top:8px;right:8px;background:#ef4444;color:#fff;font-size:0.65rem;padding:4px 8px;border-radius:4px;font-weight:600;text-transform:uppercase;">Deprecated</div>` : ''}
        </div>
        <div class="tg-card__body">
          <header class="tg-card__head">
            <h3>${template.name}${template.deprecated ? ' <span style="color:#f87171">(Legacy)</span>' : ''}</h3>
            ${template.tagline ? `<p class="tg-card__tagline">${template.tagline}</p>` : ''}
            ${template.deprecated && template.mergedTemplateId ? `<p class="tg-card__tagline" style="color:#fca5a5;">Merged into <strong>${templateNameById[template.mergedTemplateId] || template.mergedTemplateId}</strong></p>` : ''}
          </header>
          <dl class="tg-card__specs">
            <div><dt>Dimensions</dt><dd>${footprintStr}</dd></div>
            ${authoritativeSites ? `<div><dt>Plant sites</dt><dd>${authoritativeSites} (${cropClass.replace('_', ' ')})</dd></div>` : ''}
            ${template.lightingSpecSummary ? `<div><dt>Lighting</dt><dd>${template.lightingSpecSummary}</dd></div>` : ''}
          </dl>
          <div class="tg-card__scores">
            <div class="tg-score">
              <span class="tg-score__label">Transpiration</span>
              <span class="tg-score__value" style="color:${scoreColor(t?.score ?? 0)}">${fmt(t?.score, 0)}</span>
              <span class="tg-score__unit">${fmt(t?.dailyWaterKg, 1)} kg/day</span>
            </div>
            <div class="tg-score">
              <span class="tg-score__label">Heat mgmt</span>
              <span class="tg-score__value" style="color:${scoreColor(h?.score ?? 0)}">${fmt(h?.score, 0)}</span>
              <span class="tg-score__unit">${fmt(h?.wPerM3, 0)} W/m\u00b3</span>
            </div>
            <div class="tg-score ${tierClass(scores?.tier)}">
              <span class="tg-score__label">Env benchmark</span>
              <span class="tg-score__value" style="color:${envColor(e?.score ?? 0)}">${fmt(e?.score, 0)}</span>
              <span class="tg-score__unit">${scores?.tier || '\u2014'}</span>
            </div>
          </div>
          <details class="tg-card__math">
            <summary>Show your math</summary>
            ${renderMath(template, scores, cropClass, totalSites, authoritativeSites)}
          </details>
        </div>
      </article>
    `;
  }

  function renderMath(template, scores, cropClass, derivedSites, authoritativeSites) {
    const t = scores?.transpiration || {};
    const h = scores?.heatManagement || {};
    const e = scores?.envBenchmark || {};
    const fixture = template.defaultFixtureClass || {};
    const gPerPlant = template.transpiration?.gPerPlantPerDayByClass?.[cropClass];
    const kgDay = t.dailyWaterKg;
    const fixtureW = fixture.fixtureWattsNominal || 0;
    const fixturesPerTier = fixture.fixturesPerTierUnit || 1;
    const tiers = template.tierCount || 1;
    const totalFixtures = fixturesPerTier * tiers;
    const lightingW = fixtureW * totalFixtures;
    const volumeM3 = h.volumeM3;
    const totalHeatW = h.totalHeatW;
    const rows = [];
    if (Number.isFinite(kgDay)) {
      // Scoring now uses authoritative plantLocations.totalByClass when
      // present, so show that count in the visible formula.
      const plantCountForMath = Number.isFinite(authoritativeSites)
        ? authoritativeSites
        : (Number.isFinite(derivedSites) ? derivedSites : null);
      let derivation;
      if (plantCountForMath !== null && Number.isFinite(gPerPlant)) {
        derivation = `${plantCountForMath} plants \u00d7 ${gPerPlant} g/plant/day \u00f7 1000 = ${kgDay.toFixed(2)} kg/day`;
      } else {
        derivation = `${kgDay.toFixed(2)} kg/day (server-computed)`;
      }
      rows.push(mathRow('Transpiration', derivation, 'Daily latent load \u2014 sizes dehumidification.'));
    }
    if (Number.isFinite(lightingW) && Number.isFinite(volumeM3) && volumeM3 > 0) {
      const wPerM3 = h.wPerM3;
      rows.push(mathRow('Heat mgmt', `${totalFixtures} fixtures \u00d7 ${fixtureW} W = ${lightingW} W \u00f7 ${volumeM3.toFixed(1)} m\u00b3 = ${fmt(wPerM3, 0)} W/m\u00b3`, `+ transpiration latent = ${fmt(totalHeatW, 0)} W total cooling load.`));
    }
    if (Number.isFinite(e.score)) {
      const inp = e.inputs || {};
      const pp = inp.airflow?.requiredCFM ? `${fmt(inp.airflow.requiredCFM, 0)} CFM airflow, ` : '';
      rows.push(mathRow('Env benchmark', `weighted \u0394 from setpoint across lighting, VPD, ${pp}humidity = ${fmt(e.score, 0)}`, `tier: ${scores?.tier || '\u2014'} \u2014 higher is easier to operate.`));
    }
    if (!rows.length) return '<p class="tg-math__empty">Scores unavailable for this template.</p>';
    return `<div class="tg-math">${rows.join('')}</div>`;
  }
  function mathRow(label, formula, note) {
    return `<div class="tg-math__row"><span class="tg-math__label">${label}</span><code class="tg-math__formula">${formula}</code>${note ? `<span class="tg-math__note">${note}</span>` : ''}</div>`;
  }

  function injectStyles() {
    if (document.getElementById('tg-gallery-styles')) return;
    const style = document.createElement('style');
    style.id = 'tg-gallery-styles';
    style.textContent = `
      .tg-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; margin-bottom: 16px; }
      .tg-card { display: flex; flex-direction: column; background: #0f172a; border: 1px solid #1e293b; border-radius: 12px; overflow: hidden; color: #e2e8f0; cursor: pointer; transition: transform .12s ease, border-color .12s ease; }
      .tg-card:hover, .tg-card:focus { transform: translateY(-2px); border-color: #38bdf8; outline: none; }
      .tg-card[aria-pressed="true"] { border-color: #22d3ee; box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.25); }
      .tg-card__art { aspect-ratio: 16/9; background: #1e293b; }
      .tg-card__art img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .tg-card__body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 10px; flex: 1; }
      .tg-card__head h3 { margin: 0 0 4px; font-size: 1rem; color: #f8fafc; }
      .tg-card__tagline { margin: 0; font-size: 0.8rem; color: #94a3b8; }
      .tg-card__specs { margin: 0; display: grid; gap: 4px; font-size: 0.78rem; }
      .tg-card__specs > div { display: grid; grid-template-columns: 96px 1fr; gap: 8px; }
      .tg-card__specs dt { color: #64748b; font-weight: 500; }
      .tg-card__specs dd { margin: 0; color: #e2e8f0; }
      .tg-card__scores { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding-top: 10px; border-top: 1px solid #1e293b; }
      .tg-score { display: flex; flex-direction: column; gap: 2px; }
      .tg-score__label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; }
      .tg-score__value { font-size: 1.4rem; font-weight: 700; line-height: 1; }
      .tg-score__unit { font-size: 0.7rem; color: #94a3b8; }
      .tg-gallery-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 10px; }
      .tg-gallery-toolbar h2 { margin: 0; font-size: 1rem; color: #f8fafc; }
      .tg-gallery-toolbar p { margin: 0; font-size: 0.8rem; color: #94a3b8; }
      .tg-card__math { border-top: 1px dashed #1e293b; padding-top: 8px; margin-top: 2px; }
      .tg-card__math summary { cursor: pointer; font-size: 0.72rem; color: #60a5fa; list-style: none; user-select: none; }
      .tg-card__math summary::-webkit-details-marker { display: none; }
      .tg-card__math[open] summary { color: #93c5fd; }
      .tg-math { display: flex; flex-direction: column; gap: 6px; margin-top: 6px; }
      .tg-math__row { display: flex; flex-direction: column; gap: 2px; padding: 6px 8px; background: rgba(15, 23, 42, 0.6); border: 1px solid rgba(59, 130, 246, 0.18); border-radius: 6px; }
      .tg-math__label { font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.04em; color: #64748b; font-weight: 600; }
      .tg-math__formula { font-size: 0.75rem; color: #e2e8f0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: normal; }
      .tg-math__note { font-size: 0.7rem; color: #94a3b8; }
      .tg-math__empty { margin: 6px 0 0; font-size: 0.72rem; color: #94a3b8; }
    `;
    document.head.appendChild(style);
  }

  async function render(mount) {
    injectStyles();
    mount.innerHTML = `
      <div class="tg-gallery-toolbar">
        <div>
          <h2>Grow-system templates</h2>
          <p>Pick a template to stage a group. Scores reflect the selected room at 1 unit, default crop class.</p>
        </div>
      </div>
      <div class="tg-gallery" data-tg-grid>Loading templates\u2026</div>
    `;
    const grid = mount.querySelector('[data-tg-grid]');
    try {
      const [allTemplates, rooms] = await Promise.all([fetchRegistry(), fetchRooms()]);
      // Include deprecated templates but mark them visually; users should be able to edit legacy rooms
      const templates = allTemplates; // All templates, including deprecated
      const room = roomScoringPayload(selectedRoom(rooms));
      const templateNameById = Object.fromEntries(templates.map((template) => [template.id, template.name]));
      const cards = await Promise.all(templates.map(async t => {
        const cropClass = t.defaultCropClass || (t.suitableCropClasses || [])[0] || 'leafy_greens';
        try {
          const scores = await scoreTemplate(t.id, cropClass, room);
          return renderCard(t, scores, templateNameById);
        } catch (err) {
          console.warn('[template-gallery] score failed for', t.id, err);
          return renderCard(t, null, templateNameById);
        }
      }));
      grid.innerHTML = cards.join('');

      grid.addEventListener('click', (ev) => {
        const card = ev.target.closest('.tg-card');
        if (!card) return;
        const id = card.dataset.templateId;
        grid.querySelectorAll('.tg-card').forEach(c => c.setAttribute('aria-pressed', 'false'));
        card.setAttribute('aria-pressed', 'true');
        document.dispatchEvent(new CustomEvent('grow-template:selected', {
          detail: { templateId: id, template: templates.find(t => t.id === id) }
        }));
        // Group-first (April 24, 2026): cache selection on window so the
        // Build Stock Groups modal can stamp `templateId` onto new groups
        // without plumbing state through the template-gallery -> BSG boundary.
        // See docs/features/GROUP_LEVEL_MANAGEMENT_UPDATES.md section 4.1.
        try {
          window.__selectedGrowTemplate = { id, ...(templates.find(t => t.id === id) || {}) };
        } catch (e) { /* ignore */ }
      });
    } catch (err) {
      console.error('[template-gallery] render failed', err);
      grid.innerHTML = `<p style="color:#f87171;font-size:0.8rem;">Could not load templates: ${err.message}</p>`;
    }
  }

  function init() {
    const mount = document.querySelector(MOUNT_SELECTOR);
    if (!mount) return;
    render(mount);
    // Re-score when the room changes so scores reflect actual room volume.
    const roomSel = document.getElementById(ROOM_SELECT_ID);
    if (roomSel) roomSel.addEventListener('change', () => render(mount));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
