/**
 * Shared auth-aware fetch for farm-scoped data endpoints.
 *
 * The farm-data middleware + authMiddleware on greenreach-central resolves
 * farmId from (in order): Bearer JWT, x-api-key + x-farm-id, x-farm-id alone,
 * subdomain slug, env default. On the apex greenreachgreens.com host (no
 * subdomain), only the Bearer JWT path works, which means every fetch() from
 * the browser needs to forward the token the operator signed in with.
 *
 * grow-management.html / farm-setup.html / groups-v2.js historically used
 * plain fetch() without an Authorization header, so POST /api/setup/save-rooms
 * and POST /data/groups.json silently 401'd, which presented to the user as
 * "dimensions don't persist" and "group delete doesn't persist". This helper
 * patches the issue by injecting the token + farm pin on every request.
 *
 * Exposes window.authFetch(url, opts) — drop-in fetch replacement.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  function readToken() {
    try {
      return localStorage.getItem('token') || sessionStorage.getItem('token') || '';
    } catch (_) { return ''; }
  }
  function readFarmPin() {
    try {
      var qp = new URL(window.location.href).searchParams.get('farmPin');
      if (qp) return qp.trim();
      var ls = localStorage.getItem('gr.farmPin') || '';
      return ls.trim();
    } catch (_) { return ''; }
  }
  function readFarmId() {
    try {
      return localStorage.getItem('farmId') || '';
    } catch (_) { return ''; }
  }

  function authFetch(url, opts) {
    opts = opts || {};
    var headers = new Headers(opts.headers || {});
    var token = readToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', 'Bearer ' + token);
    }
    var pin = readFarmPin();
    if (pin && !headers.has('x-farm-pin') && !headers.has('X-Farm-PIN')) {
      headers.set('x-farm-pin', pin);
    }
    // Only include x-farm-id when we also have a token — the server validates
    // it against the JWT and rejects mismatches.
    var farmId = readFarmId();
    if (token && farmId && !headers.has('x-farm-id') && !headers.has('X-Farm-ID')) {
      headers.set('x-farm-id', farmId);
    }
    if (opts.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    var finalOpts = Object.assign({}, opts, { headers: headers });
    if (!finalOpts.credentials) finalOpts.credentials = 'same-origin';
    return fetch(url, finalOpts);
  }

  window.authFetch = authFetch;
  // Back-compat alias used by some call sites.
  window.__authFetch = authFetch;
})();
