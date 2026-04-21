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
      const res = await fetch('/api/rooms', { credentials: 'same-origin' });
      if (!res.ok) return [];
      const body = await res.json();
      if (Array.isArray(body)) return body;
      if (Array.isArray(body.rooms)) return body.rooms;
      if (Array.isArray(body.items)) return body.items;
      return [];
    } catch (_) {
      return [];
    }
  }

  function selectedRoom(rooms) {
    const sel = document.getElementById(ROOM_SELECT_ID);
    const id = sel && sel.value;
    if (!id) return null;
    return rooms.find(r => r.id === id || r.name === id) || null;
  }

  function roomScoringPayload(room) {
    if (!room) return null;
    // Room schema varies; normalize.
    const dims = room.dimensions || room.dims || {};
    const len = Number(dims.lengthM ?? dims.length_m ?? room.lengthM);
    const wid = Number(dims.widthM ?? dims.width_m ?? room.widthM);
    const hgt = Number(dims.ceilingHeightM ?? dims.heightM ?? dims.ceilingM ?? room.ceilingHeightM);
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
    const res = await fetch(`/api/grow-systems/${encodeURIComponent(templateId)}/score`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`Score failed for ${templateId}: ${res.status}`);
    const data = await res.json();
    return data.scores;
  }

  function renderCard(template, scores) {
    const cropClass = template.defaultCropClass || (template.suitableCropClasses || [])[0] || 'leafy_greens';
    const footprintStr = template.footprintM
      ? `${template.footprintM.length} m \u00d7 ${template.footprintM.width} m \u00d7 ${template.heightM || '?'} m`
      : '';
    const plants = template.plantsPerTrayByClass?.[cropClass];
    const totalSites = plants ? plants * (template.traysPerTier || 1) * (template.tierCount || 1) : null;

    const t = scores?.transpiration;
    const h = scores?.heatManagement;
    const e = scores?.envBenchmark;

    return `
      <article class="tg-card" data-template-id="${template.id}" tabindex="0" role="button" aria-label="Select ${template.name}">
        <div class="tg-card__art">
          <img src="${template.image || ''}" alt="" loading="lazy">
        </div>
        <div class="tg-card__body">
          <header class="tg-card__head">
            <h3>${template.name}</h3>
            ${template.tagline ? `<p class="tg-card__tagline">${template.tagline}</p>` : ''}
          </header>
          <dl class="tg-card__specs">
            <div><dt>Dimensions</dt><dd>${footprintStr}</dd></div>
            ${totalSites ? `<div><dt>Plant sites</dt><dd>${totalSites} (${cropClass.replace('_', ' ')})</dd></div>` : ''}
            ${template.lightingSpecSummary ? `<div><dt>Lighting</dt><dd>${template.lightingSpecSummary}</dd></div>` : ''}
          </dl>
          <div class="tg-card__scores">
            <div class="tg-score">
              <span class="tg-score__label">Transpiration</span>
              <span class="tg-score__value" style="color:${scoreColor(t?.score ?? 0)}">${fmt(t?.score, 0)}</span>
              <span class="tg-score__unit">${fmt(t?.kgPerDay, 1)} kg/day</span>
            </div>
            <div class="tg-score">
              <span class="tg-score__label">Heat mgmt</span>
              <span class="tg-score__value" style="color:${scoreColor(h?.score ?? 0)}">${fmt(h?.score, 0)}</span>
              <span class="tg-score__unit">${fmt(h?.wPerM3, 0)} W/m\u00b3</span>
            </div>
            <div class="tg-score ${tierClass(e?.tier)}">
              <span class="tg-score__label">Env benchmark</span>
              <span class="tg-score__value" style="color:${envColor(e?.score ?? 0)}">${fmt(e?.score, 0)}</span>
              <span class="tg-score__unit">${e?.tier || '\u2014'}</span>
            </div>
          </div>
        </div>
      </article>
    `;
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
      const [templates, rooms] = await Promise.all([fetchRegistry(), fetchRooms()]);
      const room = roomScoringPayload(selectedRoom(rooms));
      const cards = await Promise.all(templates.map(async t => {
        const cropClass = t.defaultCropClass || (t.suitableCropClasses || [])[0] || 'leafy_greens';
        try {
          const scores = await scoreTemplate(t.id, cropClass, room);
          return renderCard(t, scores);
        } catch (err) {
          console.warn('[template-gallery] score failed for', t.id, err);
          return renderCard(t, null);
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
