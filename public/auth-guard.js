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
    const token = localStorage.getItem('farm_auth_token');
    if (!token) return false;
    
    try {
      // Decode JWT (basic validation, server will do full validation)
      const payload = JSON.parse(atob(token.split('.')[1]));
      const exp = payload.exp * 1000; // Convert to milliseconds
      
      // Check if token is expired
      if (Date.now() >= exp) {
        localStorage.removeItem('farm_auth_token');
        return false;
      }
      
      return true;
    } catch (e) {
      localStorage.removeItem('farm_auth_token');
      return false;
    }
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
    const token = localStorage.getItem('farm_auth_token');
    if (token && url.includes('/api/')) {
      options.headers = options.headers || {};
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    return originalFetch(url, options);
  };

})();
