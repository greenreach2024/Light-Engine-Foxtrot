/**
 * Console Guard - Disables console methods in production
 * 
 * Detects production environment and silences console output
 * to prevent sensitive data leakage through browser DevTools.
 * 
 * Detection methods:
 * 1. Check for ?debug=true query parameter (enables console)
 * 2. Check for localStorage.debug flag
 * 3. Check hostname (localhost/127.0.0.1 = development)
 * 4. Default to production mode for all other cases
 */

(function() {
  'use strict';

  // Check if we're in development mode
  function isDevelopmentMode() {
    const urlParams = new URLSearchParams(window.location.search);
    const debugParam = urlParams.get('debug') === 'true';
    const debugStorage = localStorage.getItem('debug') === 'true';
    const isLocalhost = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' ||
                        window.location.hostname === '0.0.0.0';
    
    return debugParam || debugStorage || isLocalhost;
  }

  // If not in development, disable console
  if (!isDevelopmentMode()) {
    const noop = function() {};
    const methods = ['log', 'debug', 'info', 'warn', 'error', 'trace', 'dir', 'dirxml', 
                     'group', 'groupCollapsed', 'groupEnd', 'time', 'timeEnd', 'assert', 
                     'profile', 'profileEnd'];
    
    // Store original console for potential restoration
    window._originalConsole = {};
    
    methods.forEach(function(method) {
      if (console[method]) {
        window._originalConsole[method] = console[method];
        console[method] = noop;
      }
    });

    // Add a marker so we know console is disabled
    console._disabled = true;
    
    // Provide a way to re-enable console if needed
    window.enableConsole = function() {
      localStorage.setItem('debug', 'true');
      window.location.reload();
    };
  } else {
    console._disabled = false;
    console.log('[Console Guard] Development mode detected - console enabled');
  }
})();
