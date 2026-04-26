/**
 * Client-side authentication protection for farm interfaces
 * Checks for valid JWT token before allowing access to protected pages
 */

(function() {
  'use strict';

  // Production hardening: suppress client-side console telemetry unless explicitly enabled.
  const __grLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const __grDebugEnabled = __grLocalHost || localStorage.getItem('gr.debug') === 'true';
  if (!__grDebugEnabled && typeof console !== 'undefined') {
    const noop = function() {};
    console.log = noop;
    console.debug = noop;
    console.info = noop;
    console.warn = noop;
  }

  // Public pages that don't require authentication
  const PUBLIC_PAGES = [
    '/',
    '/index.html',
    '/farm-admin-login.html',
    '/LE-farm-admin.html',
    '/farm-sales-shop.html',  // Customer-facing online store
    '/health',                // System health check
    '/healthz'                // Simple health check
  ];

  // Central admin surfaces use `admin_token`, not the farm `token`. This guard
  // must never redirect those surfaces (or iframes embedded inside them) to
  // the farm login — admins logged in with admin_token were being bounced
  // back to /farm-admin-login.html when Central loaded farm views in iframes.
  const CENTRAL_ADMIN_PATTERNS = [
    /^\/GR-central-admin/i,
    /^\/GR-admin/i,
    /^\/GR-wholesale/i,
    /^\/GR-farm-performance/i,
    /^\/GR-central-admin-login/i
  ];

  function isCentralAdminPath(pathname) {
    if (!pathname) return false;
    return CENTRAL_ADMIN_PATTERNS.some(rx => rx.test(pathname));
  }

  // When this page is embedded in an iframe, return the parent page's pathname
  // if we can read it (same-origin) — otherwise fall back to document.referrer.
  function getParentPathname() {
    try {
      if (window.parent && window.parent !== window && window.parent.location) {
        return window.parent.location.pathname || '';
      }
    } catch (_) { /* cross-origin */ }
    try {
      if (document.referrer) {
        return new URL(document.referrer, window.location.origin).pathname || '';
      }
    } catch (_) {}
    return '';
  }

  function isInCentralAdminContext() {
    if (isCentralAdminPath(window.location.pathname)) return true;
    if (isEmbeddedFrame() && isCentralAdminPath(getParentPathname())) return true;
    return false;
  }

  function sanitizeReturnPath(rawPath) {
    const defaultPath = '/LE-farm-admin.html';
    let returnPath = rawPath || '';

    for (let i = 0; i < 6 && returnPath; i++) {
      let decoded = returnPath;
      try {
        decoded = decodeURIComponent(returnPath);
      } catch (_) {}

      try {
        const parsed = new URL(decoded, window.location.origin);
        const nestedReturn = parsed.searchParams.get('return');
        if (nestedReturn) {
          returnPath = nestedReturn;
          continue;
        }
        returnPath = parsed.pathname + parsed.search + parsed.hash;
      } catch (_) {
        returnPath = decoded;
      }

      break;
    }

    if (!returnPath) return defaultPath;

    let safePath = String(returnPath).trim();
    try {
      const parsed = new URL(safePath, window.location.origin);
      if (parsed.origin !== window.location.origin) return defaultPath;
      safePath = parsed.pathname + parsed.search + parsed.hash;
    } catch (_) {
      return defaultPath;
    }

    if (!safePath.startsWith('/')) {
      safePath = `/${safePath.replace(/^\/+/, '')}`;
    }

    if (!safePath || safePath.includes('farm-admin-login')) {
      return defaultPath;
    }

    return safePath;
  }

  function isEmbeddedFrame() {
    try {
      return window.self !== window.top;
    } catch (_) {
      return true;
    }
  }

  function buildReturnPath() {
    const currentPath = sanitizeReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    if (!isEmbeddedFrame()) return currentPath;

    try {
      if (window.parent && window.parent.location && window.parent.location.origin === window.location.origin) {
        return sanitizeReturnPath(`${window.parent.location.pathname}${window.parent.location.search}${window.parent.location.hash}`);
      }
    } catch (_) {}

    try {
      if (document.referrer) {
        const ref = new URL(document.referrer, window.location.origin);
        if (ref.origin === window.location.origin) {
          return sanitizeReturnPath(`${ref.pathname}${ref.search}${ref.hash}`);
        }
      }
    } catch (_) {}

    return currentPath;
  }

  // Check if current page requires authentication
  function requiresAuth() {
    const currentPath = window.location.pathname;

    // Central admin surfaces are guarded by their own admin_token flow;
    // the farm token this guard checks doesn't apply. Also bail when we are
    // an iframe embedded inside a Central admin page so we never kick the
    // top window out to the farm login.
    if (isInCentralAdminContext()) {
      return false;
    }

    // Check if it's a public page
    if (PUBLIC_PAGES.some(page => currentPath.endsWith(page))) {
      return false;
    }
    
    // Login pages never require auth (prevents redirect loop)
    if (currentPath.includes('login')) {
      return false;
    }

    // Farm admin interfaces require auth
    if (currentPath.includes('farm-admin') || 
        currentPath.includes('farm-sales-pos') ||
        currentPath.startsWith('/views/')) {
      return true;
    }
    
    return false;
  }

  // Clear all farm-scoped storage keys (prevents cross-farm data leakage)
  function clearFarmStorage() {
    const keys = [
      'farm_id', 'farmId', 'farm_name', 'farmName', 'email',
      'token', 'auth_token', 'farm_admin_session',
      'gr.farm', 'farmSettings', 'qualityStandards', 'setup_completed',
      'ai_pricing_recommendations', 'ai_pricing_last_check', 'ai_pricing_history',
      'pricing_version', 'usd_to_cad_rate',
      'impersonation_token', 'impersonation_farm', 'impersonation_expires',
      'adminFarmId'
    ];
    for (const k of keys) {
      try { localStorage.removeItem(k); } catch (_) {}
      try { sessionStorage.removeItem(k); } catch (_) {}
    }
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const n = localStorage.key(i);
        if (n && n.startsWith('pricing_')) localStorage.removeItem(n);
      }
    } catch (_) {}
  }

  function decodeJwtPayload(token) {
    try {
      const parts = String(token || '').split('.');
      if (parts.length !== 3 || !parts[1]) return null;

      // JWT payload is base64url, not plain base64.
      let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const pad = base64.length % 4;
      if (pad) base64 += '='.repeat(4 - pad);

      return JSON.parse(atob(base64));
    } catch (_) {
      return null;
    }
  }

  // Check if user has valid token
  function hasValidToken() {
    let token = sessionStorage.getItem('token') || localStorage.getItem('token');
    // Also check legacy auth_token key
    if (!token) {
      token = localStorage.getItem('auth_token');
      // Migrate to session storage to avoid local-only dependency
      if (token) {
        sessionStorage.setItem('token', token);
        localStorage.removeItem('auth_token');
      }
    }
    
    if (!token) return false;
    
    // Token is JWT from server - basic validation
    // Server will fully validate on API calls
    // Just check it exists and looks like a JWT (has two dots)
    if (token && token.split('.').length === 3) {
      const payload = decodeJwtPayload(token);
      if (!payload) {
        // Decode-only issues should not wipe farm state on the client.
        console.warn('[auth-guard] Token payload decode failed; deferring full validation to server');
        return true;
      }

      if (payload.exp) {
        const expiryTime = payload.exp * 1000; // Convert to milliseconds
        const now = Date.now();
        if (now >= expiryTime) {
          // Token expired, clear all farm data
          console.log('[auth-guard] Token expired, clearing...');
          clearFarmStorage();
          return false;
        }
      }
      return true;
    }

    // Non-JWT session token: validate against stored session expiry if present
    const sessionRaw = sessionStorage.getItem('farm_admin_session') ||
      localStorage.getItem('farm_admin_session');
    if (sessionRaw) {
      try {
        const session = JSON.parse(sessionRaw);
        if (session.expiresAt && session.expiresAt < Date.now()) {
          console.log('[auth-guard] Session expired, clearing...');
          clearFarmStorage();
          return false;
        }
        return true;
      } catch (e) {
        console.warn('[auth-guard] Invalid session format');
        return false;
      }
    }
    
    // Token exists but format is unknown; don't clear storage on client-only checks.
    return false;
  }

  // Redirect to login page (cloud-aware)
  function redirectToLogin() {
    // Never redirect when we're running inside a Central admin page — that
    // would bounce an admin (logged in with admin_token) back to the farm
    // login. The admin page has its own auth guard on admin_token.
    if (isInCentralAdminContext()) return;

    // In cloud mode, login page is on the same subdomain
    const loginBase = window.IS_CLOUD ? window.location.origin : '';
    const returnPath = encodeURIComponent(buildReturnPath());
    const target = `${loginBase}/farm-admin-login.html?return=${returnPath}`;

    if (isEmbeddedFrame()) {
      // Only navigate the top window if the parent is itself a farm surface.
      // Otherwise, only redirect our own iframe so we don't hijack the parent.
      const parentPath = getParentPathname();
      const parentIsFarm = parentPath && (
        parentPath.includes('farm-admin') ||
        parentPath.includes('farm-sales-pos') ||
        parentPath.startsWith('/views/')
      );
      if (parentIsFarm) {
        try {
          window.top.location.href = target;
          return;
        } catch (_) {}
      } else {
        // Parent is not a farm page (Central admin or unknown) — stay inside
        // our iframe so we don't navigate the top window away.
        window.location.href = target;
        return;
      }
    }

    window.location.href = target;
  }

  // Main authentication check
  function checkAuth() {
    if (requiresAuth() && !hasValidToken()) {
      redirectToLogin();
    }
  }

  // Run auth check immediately
  checkAuth();

  // Also add token to API requests + prepend API_BASE for relative URLs
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');

    // Resolve relative URLs against API_BASE only when it is same-origin.
    // This prevents accidental cross-origin fetches when API_BASE points at Central.
    let resolvedUrl = url;
    if (typeof url === 'string' && url.startsWith('/') && window.API_BASE) {
      try {
        const base = new URL(window.API_BASE, window.location.origin);
        if (base.origin === window.location.origin) {
          resolvedUrl = base.origin + url;
        }
      } catch (_) {
        // Keep original relative URL on malformed API_BASE
      }
    }

    // Inject JWT for ALL authenticated requests — /api/, /data/, and /env endpoints.
    // CRITICAL: /data/*.json requests MUST carry the JWT so the farmDataMiddleware
    // can scope responses to the authenticated farm. Without this, requests fall
    // through to unscoped flat files, leaking cross-farm data.
    // IMPORTANT: Never overwrite an Authorization header the caller already set
    // (e.g., central-admin uses admin_token, not the farm token stored here).
    const needsAuth = typeof resolvedUrl === 'string' && (resolvedUrl.includes('/api/') || resolvedUrl.includes('/data/') || /\/env(\?|$)/.test(resolvedUrl));
    if (token && needsAuth) {
      options.headers = options.headers || {};
      if (!options.headers['Authorization'] && !options.headers['authorization']) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }
    }

    // Inject farm slug header in cloud mode for tenant routing
    if (window.FARM_SLUG && needsAuth) {
      options.headers = options.headers || {};
      options.headers['X-Farm-Slug'] = window.FARM_SLUG;
    }

    return originalFetch(resolvedUrl, options);
  };

})();
