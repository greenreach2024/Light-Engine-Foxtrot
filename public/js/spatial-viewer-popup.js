/*
 * Spatial Viewer Popup
 *
 * In-place modal overlay that loads /views/3d-farm-viewer.html in an iframe
 * so callers can surface the 3D viewer (Heat Map + Draw-Zones modes rolled
 * in) from Farm Setup, Grow Management, and any other operator surface
 * without navigating away from the parent page.
 *
 * Usage:
 *   <script src="/js/spatial-viewer-popup.js"></script>
 *   <button onclick="SpatialViewerPopup.open({ mode: 'heatmap', roomId: 'R-001' })">Heat Map</button>
 *   <a href="#" data-spatial-viewer="draw-zones" data-room-id="R-001">Draw zones</a>
 *
 * Modes (all mapped to 3d-farm-viewer.html query params):
 *   - 'view'       : default 3D view
 *   - 'heatmap'    : opens with the heatmap overlay active
 *   - 'draw-zones' : opens in zone-edit mode for the Room Mapper use case
 *
 * Any <a data-spatial-viewer="..."> or button with the same attribute is
 * auto-wired on DOMContentLoaded so existing link-row markup just works
 * after adding the attribute.
 */
(function () {
  'use strict';

  var OVERLAY_ID = 'spatialViewerPopupOverlay';
  var IFRAME_ID = 'spatialViewerPopupFrame';
  var SIDEBAR_LIST_ID = 'spatialViewerPopupSummaryList';
  var SIDEBAR_STATUS_ID = 'spatialViewerPopupSummaryStatus';
  var _summaryTimer = null;

  function buildViewerUrl(opts) {
    var params = new URLSearchParams();
    if (opts && opts.mode) params.set('mode', opts.mode);
    if (opts && opts.roomId) params.set('roomId', opts.roomId);
    if (opts && opts.zoneId) params.set('zoneId', opts.zoneId);
    // Suppress the in-viewer top-nav chrome when embedded so the modal
    // owns the "close" affordance. The viewer treats this param as a hint.
    params.set('embedded', '1');
    var qs = params.toString();
    return '/views/3d-farm-viewer.html' + (qs ? ('?' + qs) : '');
  }

  function ensureOverlay() {
    var existing = document.getElementById(OVERLAY_ID);
    if (existing) return existing;

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Spatial viewer');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:rgba(2,6,23,0.82)', 'backdrop-filter:blur(6px)',
      'display:none', 'align-items:stretch', 'justify-content:flex-start',
      'padding:24px'
    ].join(';');

    var shell = document.createElement('div');
    shell.style.cssText = [
      'position:relative', 'width:min(1660px, 100%)', 'height:min(92vh, 960px)',
      'background:#0f172a', 'border:1px solid rgba(148,163,184,0.35)',
      'border-radius:14px', 'box-shadow:0 30px 80px rgba(0,0,0,0.55)',
      'overflow:hidden', 'display:flex', 'flex-direction:column', 'margin-right:auto'
    ].join(';');

    var header = document.createElement('div');
    header.style.cssText = [
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'gap:12px', 'padding:10px 14px',
      'border-bottom:1px solid rgba(148,163,184,0.2)',
      'background:linear-gradient(180deg,#0b1220,#0f172a)'
    ].join(';');

    var titleEl = document.createElement('div');
    titleEl.id = OVERLAY_ID + 'Title';
    titleEl.style.cssText = 'color:#e2e8f0;font-weight:600;font-size:14px;letter-spacing:0.02em;';
    titleEl.textContent = 'Spatial viewer';

    var actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;align-items:center;';

    var openExternalBtn = document.createElement('a');
    openExternalBtn.id = OVERLAY_ID + 'External';
    openExternalBtn.target = '_blank';
    openExternalBtn.rel = 'noopener';
    openExternalBtn.textContent = 'Open in new tab';
    openExternalBtn.style.cssText = [
      'color:#94a3b8', 'text-decoration:none', 'font-size:12px',
      'padding:4px 10px', 'border-radius:6px',
      'border:1px solid rgba(148,163,184,0.25)'
    ].join(';');

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Close spatial viewer');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText = [
      'background:#1e293b', 'color:#e2e8f0',
      'border:1px solid rgba(148,163,184,0.35)', 'border-radius:6px',
      'min-width:32px', 'height:32px', 'cursor:pointer',
      'font-size:14px', 'line-height:1'
    ].join(';');
    closeBtn.addEventListener('click', close);

    actions.appendChild(openExternalBtn);
    actions.appendChild(closeBtn);
    header.appendChild(titleEl);
    header.appendChild(actions);

    var content = document.createElement('div');
    content.style.cssText = [
      'display:flex', 'flex:1', 'min-height:0', 'align-items:stretch'
    ].join(';');

    var frame = document.createElement('iframe');
    frame.id = IFRAME_ID;
    frame.setAttribute('title', 'Spatial viewer');
    frame.style.cssText = 'flex:1;min-width:0;width:100%;border:0;background:#020617;';

    var sidebar = document.createElement('aside');
    sidebar.style.cssText = [
      'width:320px', 'max-width:38vw', 'border-left:1px solid rgba(148,163,184,0.2)',
      'background:rgba(15,23,42,0.88)', 'padding:12px', 'display:grid', 'gap:8px',
      'overflow:auto'
    ].join(';');
    var sh = document.createElement('h4');
    sh.textContent = 'Selection Summary';
    sh.style.cssText = 'margin:0;color:#e2e8f0;font-size:12px;letter-spacing:0.06em;text-transform:uppercase;';
    var list = document.createElement('div');
    list.id = SIDEBAR_LIST_ID;
    list.style.cssText = 'display:grid;gap:6px;';
    var st = document.createElement('div');
    st.id = SIDEBAR_STATUS_ID;
    st.style.cssText = 'border:1px solid rgba(248,113,113,0.35);border-radius:8px;background:rgba(127,29,29,0.35);color:#fecaca;padding:8px 10px;font-size:12px;font-weight:600;';
    st.textContent = 'Selections not implemented';
    sidebar.appendChild(sh);
    sidebar.appendChild(list);
    sidebar.appendChild(st);

    shell.appendChild(header);
    content.appendChild(frame);
    content.appendChild(sidebar);
    shell.appendChild(content);
    overlay.appendChild(shell);

    overlay.addEventListener('click', function (ev) {
      if (ev.target === overlay) close();
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && overlay.style.display === 'flex') close();
    });

    document.body.appendChild(overlay);
    return overlay;
  }

  function titleFor(mode) {
    switch (mode) {
      case 'heatmap': return 'Heat Map (3D viewer)';
      case 'draw-zones': return 'Room Mapper (3D viewer)';
      default: return '3D Farm Viewer';
    }
  }

  function open(opts) {
    opts = opts || {};
    var overlay = ensureOverlay();
    var frame = document.getElementById(IFRAME_ID);
    var titleEl = document.getElementById(OVERLAY_ID + 'Title');
    var external = document.getElementById(OVERLAY_ID + 'External');
    var url = buildViewerUrl(opts);
    var externalUrl = url.replace(/([?&])embedded=1(&|$)/, function (_m, a, b) { return b ? a : ''; });
    if (externalUrl.endsWith('?') || externalUrl.endsWith('&')) {
      externalUrl = externalUrl.slice(0, -1);
    }
    if (titleEl) titleEl.textContent = opts.title || titleFor(opts.mode);
    if (external) external.href = externalUrl || '/views/3d-farm-viewer.html';
    if (frame) frame.src = url;
    overlay.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    startSummaryRefresh();
  }

  function close() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (!overlay) return;
    overlay.style.display = 'none';
    document.body.style.overflow = '';
    var frame = document.getElementById(IFRAME_ID);
    // Clear src so the viewer is fully torn down on close. Prevents stale
    // scene state and keeps GPU / socket resources from leaking across opens.
    if (frame) frame.src = 'about:blank';
    stopSummaryRefresh();
  }

  function normalizeRooms(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.rooms)) return body.rooms;
    return [];
  }

  function roomDimsLabel(room) {
    if (!room) return 'Not set';
    var dims = room.dimensions || {};
    var l = Number(room.length_m || room.lengthM || dims.length_m || dims.lengthM || 0);
    var w = Number(room.width_m || room.widthM || dims.width_m || dims.widthM || 0);
    var h = Number(room.ceiling_height_m || room.ceilingHeightM || room.height_m || room.heightM || dims.height_m || dims.heightM || 0);
    if (l > 0 && w > 0 && h > 0) return l + 'm x ' + w + 'm x ' + h + 'm';
    if (l > 0 && w > 0) return l + 'm x ' + w + 'm';
    return 'Not set';
  }

  function renderSidebar(snapshot) {
    var list = document.getElementById(SIDEBAR_LIST_ID);
    var status = document.getElementById(SIDEBAR_STATUS_ID);
    if (!list || !status) return;

    var rows = [
      ['Room', snapshot.roomName || 'None'],
      ['Dimensions', snapshot.roomDims || 'Not set'],
      ['Zones', String(snapshot.zoneCount || 0)],
      ['Draft template', snapshot.draftTemplate || 'None'],
      ['Draft units', snapshot.draftUnits > 0 ? String(snapshot.draftUnits) : 'None'],
      ['Implemented in', snapshot.implementedIn || 'Not saved']
    ];

    list.innerHTML = rows.map(function (r) {
      return '<div style="display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#cbd5e1;border-bottom:1px dashed rgba(148,163,184,0.18);padding-bottom:4px;"><span style="color:#94a3b8;">' + r[0] + '</span><span>' + r[1] + '</span></div>';
    }).join('');

    if (snapshot.hasDraft && !snapshot.implemented) {
      status.textContent = 'Selections not implemented';
      status.style.borderColor = 'rgba(248,113,113,0.35)';
      status.style.background = 'rgba(127,29,29,0.35)';
      status.style.color = '#fecaca';
    } else if (snapshot.implemented) {
      status.textContent = 'Selections implemented';
      status.style.borderColor = 'rgba(74,222,128,0.35)';
      status.style.background = 'rgba(20,83,45,0.35)';
      status.style.color = '#bbf7d0';
    } else {
      status.textContent = 'Selections not implemented';
      status.style.borderColor = 'rgba(248,113,113,0.35)';
      status.style.background = 'rgba(127,29,29,0.35)';
      status.style.color = '#fecaca';
    }
  }

  function readDraft() {
    var rbp = window.__roomBuildPlan || null;
    if (rbp && rbp.template) {
      return {
        hasDraft: true,
        draftTemplate: rbp.template.name || rbp.template.id || 'Selected',
        draftUnits: Number(rbp.desiredUnits || 0) || 0
      };
    }
    try {
      var raw = window.localStorage && window.localStorage.getItem('growWorkspaceDraft');
      if (!raw) return { hasDraft: false, draftTemplate: 'None', draftUnits: 0 };
      var d = JSON.parse(raw);
      return {
        hasDraft: true,
        draftTemplate: d.templateId || 'Selected',
        draftUnits: Number(d.desiredUnits || 0) || 0
      };
    } catch (_) {
      return { hasDraft: false, draftTemplate: 'None', draftUnits: 0 };
    }
  }

  function collectSummary() {
    var _f = window.authFetch || window.fetch;
    return _f('/data/rooms.json?_=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (body) {
        var rooms = normalizeRooms(body);
        var room = rooms[0] || null;
        var persisted = rooms.find(function (x) { return x && x.buildPlan && x.buildPlan.status === 'accepted'; }) || null;
        var draft = readDraft();
        return {
          roomName: room ? (room.name || room.room_name || room.id || 'Room') : 'None',
          roomDims: roomDimsLabel(room),
          zoneCount: room && Array.isArray(room.zones) ? room.zones.length : 0,
          draftTemplate: draft.draftTemplate,
          draftUnits: draft.draftUnits,
          hasDraft: draft.hasDraft,
          implemented: !!persisted,
          implementedIn: persisted ? (persisted.name || persisted.room_name || persisted.id || 'Saved room') : 'Not saved'
        };
      })
      .catch(function () {
        var draft = readDraft();
        return {
          roomName: 'Unavailable',
          roomDims: 'Unavailable',
          zoneCount: 0,
          draftTemplate: draft.draftTemplate,
          draftUnits: draft.draftUnits,
          hasDraft: draft.hasDraft,
          implemented: !!(window.__gmPlanState && window.__gmPlanState.implemented),
          implementedIn: (window.__gmPlanState && window.__gmPlanState.implemented) ? 'Saved room' : 'Not saved'
        };
      });
  }

  function startSummaryRefresh() {
    stopSummaryRefresh();
    function tick() {
      collectSummary().then(renderSidebar);
    }
    tick();
    _summaryTimer = window.setInterval(tick, 1500);
  }

  function stopSummaryRefresh() {
    if (_summaryTimer) {
      window.clearInterval(_summaryTimer);
      _summaryTimer = null;
    }
  }

  function wireAutoLinks(root) {
    (root || document).querySelectorAll('[data-spatial-viewer]').forEach(function (el) {
      if (el.__svpBound) return;
      el.__svpBound = true;
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        open({
          mode: el.getAttribute('data-spatial-viewer') || 'view',
          roomId: el.getAttribute('data-room-id') || '',
          zoneId: el.getAttribute('data-zone-id') || '',
          title: el.getAttribute('data-spatial-viewer-title') || ''
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { wireAutoLinks(); });
  } else {
    wireAutoLinks();
  }

  window.SpatialViewerPopup = { open: open, close: close, wireAutoLinks: wireAutoLinks };
})();
