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
      'display:none', 'align-items:center', 'justify-content:center',
      'padding:24px'
    ].join(';');

    var shell = document.createElement('div');
    shell.style.cssText = [
      'position:relative', 'width:min(1440px, 100%)', 'height:min(92vh, 960px)',
      'background:#0f172a', 'border:1px solid rgba(148,163,184,0.35)',
      'border-radius:14px', 'box-shadow:0 30px 80px rgba(0,0,0,0.55)',
      'overflow:hidden', 'display:flex', 'flex-direction:column'
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

    var frame = document.createElement('iframe');
    frame.id = IFRAME_ID;
    frame.setAttribute('title', 'Spatial viewer');
    frame.style.cssText = 'flex:1;width:100%;border:0;background:#020617;';

    shell.appendChild(header);
    shell.appendChild(frame);
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
