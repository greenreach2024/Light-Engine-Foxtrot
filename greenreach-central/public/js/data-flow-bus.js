/*
 * data-flow-bus.js
 *
 * Tiny cross-page event bus for farm data. Every save/delete in the app
 * should call `DataFlowBus.emit('rooms' | 'zones' | 'groups' | 'templates' | 'lights')`.
 * Every card/module that reads those datasets should subscribe with
 * `DataFlowBus.on(kind, handler)` and re-fetch when the handler fires.
 *
 * The bus dispatches a `data-updated` CustomEvent on `window` (for same-page
 * subscribers) AND writes a versioned key to `localStorage` so other tabs /
 * iframes / popups (e.g. the 3D viewer, planting scheduler, AI crop
 * recommendations) can listen via the `storage` event and stay in sync.
 *
 * It also exposes `DataFlowBus.cacheBust(url)` which appends `?_=<ts>` so
 * readers can defeat stale-cache hits on JSON endpoints. Use this on every
 * `/data/*.json` and `/api/rooms|/api/zones|/api/groups` fetch — without it
 * the browser / service-worker / CDN may serve data that predates the most
 * recent save.
 */
(function initDataFlowBus() {
  'use strict';
  if (window.DataFlowBus) return;

  var STORAGE_PREFIX = 'gr-data-updated:';
  var EVENT_NAME = 'data-updated';
  var VALID_KINDS = ['rooms', 'zones', 'groups', 'templates', 'lights', 'equipment', 'all'];

  function validKind(kind) {
    return typeof kind === 'string' && VALID_KINDS.indexOf(kind) !== -1;
  }

  function emit(kind, detail) {
    if (!validKind(kind)) {
      console.warn('[DataFlowBus] invalid kind:', kind, '— expected one of', VALID_KINDS.join(', '));
      return;
    }
    var payload = { kind: kind, detail: detail || null, ts: Date.now() };
    try {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: payload }));
    } catch (_) { /* older browsers */ }
    try {
      // Storage event fires in OTHER tabs/iframes of the same origin, so
      // write + immediately update so we leave a trail for late subscribers.
      localStorage.setItem(STORAGE_PREFIX + kind, JSON.stringify(payload));
    } catch (_) { /* private browsing / quota */ }
  }

  function on(kind, handler) {
    if (!validKind(kind) || typeof handler !== 'function') return function () {};
    function sameTab(ev) {
      var d = ev && ev.detail;
      if (!d) return;
      if (d.kind === kind || kind === 'all' || d.kind === 'all') handler(d);
    }
    function crossTab(ev) {
      if (!ev || !ev.key || ev.key.indexOf(STORAGE_PREFIX) !== 0) return;
      var k = ev.key.slice(STORAGE_PREFIX.length);
      if (!(k === kind || kind === 'all' || k === 'all')) return;
      try {
        var parsed = ev.newValue ? JSON.parse(ev.newValue) : { kind: k };
        handler(parsed);
      } catch (_) {
        handler({ kind: k });
      }
    }
    window.addEventListener(EVENT_NAME, sameTab);
    window.addEventListener('storage', crossTab);
    return function unsubscribe() {
      window.removeEventListener(EVENT_NAME, sameTab);
      window.removeEventListener('storage', crossTab);
    };
  }

  function cacheBust(url) {
    if (typeof url !== 'string' || !url) return url;
    var sep = url.indexOf('?') === -1 ? '?' : '&';
    return url + sep + '_=' + Date.now();
  }

  window.DataFlowBus = {
    emit: emit,
    on: on,
    cacheBust: cacheBust,
    KINDS: VALID_KINDS.slice()
  };
})();
