/**
 * Client-side authentication protection for farm interfaces
 * Checks for valid JWT token before allowing access to protected pages
 */

(function() {
  'use strict';

  // Public pages that don't require authentication
  const PUBLIC_PAGES = [
    '/farm-sales-shop.html',  // Customer-facing online store
    '/health',                 // System health check
    '/healthz'                 // Simple health check
  ];

  // Check if current page requires authentication
  function requiresAuth() {
    const currentPath = window.location.pathname;
    
    // Check if it's a public page
    if (PUBLIC_PAGES.some(page => currentPath.endsWith(page))) {
      return false;
    }
    
    // Landing page and farm admin interfaces require auth
    if (currentPath === '/' || 
        currentPath.includes('farm-admin') || 
        currentPath.includes('farm-sales-pos') ||
        currentPath.includes('index.charlie')) {
      return true;
    }
    
    return false;
  }

  // Check if user has valid token
  function hasValidToken() {
    let token = localStorage.getItem('token');
    // Also check legacy auth_token key
    if (!token) {
      token = localStorage.getItem('auth_token');
      // Migrate to standard 'token' key
      if (token) {
        localStorage.setItem('token', token);
        localStorage.removeItem('auth_token');
      }
    }
    
    if (!token) return false;
    
    // Token is JWT from server - basic validation
    // Server will fully validate on API calls
    // Just check it exists and looks like a JWT (has two dots)
    if (token && token.split('.').length === 3) {
      return true;
    }
    
    // If token format is invalid, remove it
    localStorage.removeItem('token');
    localStorage.removeItem('auth_token');
    return false;
  }

  // Redirect to login page
  function redirectToLogin() {
    const returnUrl = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `/LE-login.html?return=${returnUrl}`;
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
    const token = localStorage.getItem('token');
    if (token && url.includes('/api/')) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    return originalFetch(url, options);
  };

})();
