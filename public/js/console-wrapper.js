/**
 * Client-side console wrapper for demo mode
 * Suppresses browser console output when demo mode is detected
 * 
 * This script should be loaded EARLY in the page (before other scripts)
 */

(function() {
  'use strict';

  // Detect demo mode from multiple sources
  function isDemoMode() {
    // Check URL parameter
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('demo') === 'true') return true;
    
    // Check localStorage
    if (localStorage.getItem('demoMode') === 'true') return true;
    
    // Check if deployed on demo domain
    if (window.location.hostname.includes('demo')) return true;
    
    return false;
  }

  // Only suppress console if in demo mode
  if (!isDemoMode()) {
    return;
  }

  // Store original console methods
  const originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
    table: console.table,
    group: console.group,
    groupEnd: console.groupEnd
  };

  // Create silent versions
  const noop = function() {};

  // Suppress most console output
  console.log = noop;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
  console.table = noop;
  console.group = noop;
  console.groupEnd = noop;
  
  // Keep critical errors but make them less verbose
  console.error = function(...args) {
    // Only log actual errors, not warnings
    if (args[0] && typeof args[0] === 'string' && 
        (args[0].includes('Failed') || args[0].includes('Error') || args[0] === 'Error')) {
      // Silently log to prevent console clutter
      // You can uncomment below if you want to see critical errors
      // originalConsole.error(...args);
    }
  };

  // Provide escape hatch for developers
  window.__originalConsole = originalConsole;
  
  // Add a way to temporarily enable logging
  window.enableConsole = function() {
    Object.assign(console, originalConsole);
    console.log('✅ Console logging re-enabled');
  };

  window.disableConsole = function() {
    console.log = noop;
    console.info = noop;
    console.debug = noop;
    console.warn = noop;
    console.table = noop;
    console.group = noop;
    console.groupEnd = noop;
    originalConsole.log('🤫 Console logging disabled');
  };

  // Log that we've activated (using original console before suppressing)
  originalConsole.log('🤫 Demo mode detected - console output suppressed');
  originalConsole.log('💡 Run window.enableConsole() to temporarily enable logging');
})();
