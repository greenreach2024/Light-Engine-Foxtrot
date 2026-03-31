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

  // Check if current page requires authentication
  function requiresAuth() {
    const currentPath = window.location.pathname;
    
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
        currentPath.includes('farm-sales-pos')) {
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
      // Decode JWT payload to check expiry
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
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
      } catch (e) {
        // Invalid JWT format, clear all farm data
        console.log('[auth-guard] Invalid token format, clearing...');
        clearFarmStorage();
        return false;
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
        console.log('[auth-guard] Invalid session format, clearing...');
        clearFarmStorage();
        return false;
      }
    }
    
    // If token format is invalid, clear all farm data
    clearFarmStorage();
    return false;
  }

  // Redirect to login page (cloud-aware)
  function redirectToLogin() {
    // In cloud mode, login page is on the same subdomain
    const loginBase = window.IS_CLOUD ? window.location.origin : '';
    window.location.href = `${loginBase}/farm-admin-login.html`;
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
