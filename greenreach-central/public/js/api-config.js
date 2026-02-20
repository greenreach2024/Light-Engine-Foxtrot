/**
 * api-config.js — Universal frontend configuration for Light Engine Foxtrot
 *
 * Auto-detects cloud vs local environment and sets:
 *   window.API_BASE   – Base URL for all API calls (e.g., '' for same-origin, or 'https://farm.greenreachgreens.com')
 *   window.FARM_SLUG  – Farm subdomain slug (e.g., 'notable-sprout') or null in local mode
 *   window.IS_CLOUD   – true when running on greenreachgreens.com
 *   window.EDGE_URL   – URL to the local edge device (if configured), null otherwise
 *
 * Include this script early (before auth-guard.js and app.foxtrot.js):
 *   <script src="/js/api-config.js"></script>
 *
 * Design: In cloud mode, frontend and API are served from the same origin
 * (e.g., notable-sprout.greenreachgreens.com), so API_BASE is '' (same-origin).
 * Relative fetch('/api/groups') resolves correctly without URL rewriting.
 * API_BASE is only non-empty when pages need cross-origin calls (e.g., edge device).
 */

(function () {
  'use strict';

  const hostname = window.location.hostname;
  const origin   = window.location.origin;

  // ── Cloud detection ────────────────────────────────────────────
  const isCloud = hostname.endsWith('.greenreachgreens.com') ||
                  hostname === 'greenreachgreens.com';

  // ── Farm slug from subdomain ───────────────────────────────────
  // notable-sprout.greenreachgreens.com → 'notable-sprout'
  let farmSlug = null;
  if (isCloud && hostname !== 'greenreachgreens.com') {
    farmSlug = hostname.split('.')[0];
  }

  // ── API base URL ───────────────────────────────────────────────
  // Same-origin in both modes: relative fetch('/api/...') just works.
  // API_BASE is the origin for pages that construct full URLs.
  const apiBase = origin;

  // ── Edge device URL (optional) ─────────────────────────────────
  // Stored in localStorage so growers can pair their local device.
  // Example: http://192.168.1.42:8091
  const edgeUrl = localStorage.getItem('gr.edge_url') || null;

  // ── Expose globals ─────────────────────────────────────────────
  window.API_BASE  = apiBase;
  window.FARM_SLUG = farmSlug;
  window.IS_CLOUD  = isCloud;
  window.EDGE_URL  = edgeUrl;

  // ── Debug logging (opt-in) ─────────────────────────────────────
  const debug = localStorage.getItem('gr.debug') === 'true' ||
                hostname === 'localhost' || hostname === '127.0.0.1';
  if (debug) {
    console.debug('[api-config]', {
      API_BASE: apiBase,
      FARM_SLUG: farmSlug,
      IS_CLOUD: isCloud,
      EDGE_URL: edgeUrl
    });
  }
})();
