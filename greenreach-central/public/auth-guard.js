/**
 * Client-side authentication protection for farm interfaces
 * Checks for valid JWT token before allowing access to protected pages
 */

(function() {
  'use strict';

  // Public pages that don't require authentication
  const PUBLIC_PAGES = [
    '/',
    '/index.html',
    '/greenreach-org.html',
    '/farm-sales-shop.html',  // Customer-facing online store
    '/health',                // System health check
    '/healthz'                // Simple health check
  ];

  // Check if current page requires authentication
  function requiresAuth() {
    const currentPath = window.location.pathname;
    
    // Check if it's a public page
    if (PUBLIC_PAGES.some(page => currentPath.endsWith(page))) {
      return false;
    }
    
    // Landing page and farm admin interfaces require auth
    if (currentPath.includes('farm-admin') || 
        currentPath.includes('farm-sales-pos')) {
      return true;
    }
    
    return false;
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
            // Token expired, remove it
            console.log('[auth-guard] Token expired, clearing...');
            localStorage.removeItem('token');
            localStorage.removeItem('auth_token');
            sessionStorage.removeItem('token');
            return false;
          }
        }
      } catch (e) {
        // Invalid JWT format, remove it
        console.log('[auth-guard] Invalid token format, clearing...');
        localStorage.removeItem('token');
        localStorage.removeItem('auth_token');
        sessionStorage.removeItem('token');
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
          localStorage.removeItem('farm_admin_session');
          sessionStorage.removeItem('farm_admin_session');
          sessionStorage.removeItem('token');
          localStorage.removeItem('token');
          return false;
        }
        return true;
      } catch (e) {
        console.log('[auth-guard] Invalid session format, clearing...');
        localStorage.removeItem('farm_admin_session');
        sessionStorage.removeItem('farm_admin_session');
        sessionStorage.removeItem('token');
        localStorage.removeItem('token');
        return false;
      }
    }
    
    // If token format is invalid, remove it
    localStorage.removeItem('token');
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem('token');
    return false;
  }

  // Redirect to login page
  function redirectToLogin() {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/login.html?return=${returnUrl}`;
  }

  // Main authentication check
  function checkAuth() {
    if (requiresAuth() && !hasValidToken()) {
      redirectToLogin();
    }
  }

  // Run auth check immediately
  checkAuth();

  // Also add token to API requests
  const originalFetch = window.fetch;
  window.fetch = function(url, options = {}) {
    const token = sessionStorage.getItem('token') || localStorage.getItem('token');
    if (token && url.includes('/api/')) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    return originalFetch(url, options);
  };

})();
