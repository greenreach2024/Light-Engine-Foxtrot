/**
 * Console wrapper for demo mode
 * Suppresses console output when DEMO_MODE is enabled
 * 
 * Usage:
 *   import { setupConsoleWrapper } from './server/utils/console-wrapper.js';
 *   setupConsoleWrapper(); // Call early in server initialization
 */

let originalConsole = null;
let demoModeEnabled = false;

/**
 * Setup console wrapper to suppress logs in demo mode
 */
export function setupConsoleWrapper() {
  demoModeEnabled = process.env.DEMO_MODE === 'true';
  
  if (!demoModeEnabled) {
    return; // No need to wrap if not in demo mode
  }

  // Store original console methods
  if (!originalConsole) {
    originalConsole = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug
    };
  }

  // Create silent versions that only log critical errors
  const noop = () => {};
  
  // Create filtered log function that allows admin operations
  const filteredLog = (...args) => {
    const msg = args[0];
    if (msg && typeof msg === 'string') {
      // Allow admin-related logs (user creation, emails, auth)
      if (msg.includes('[Admin]') || 
          msg.includes('[SES]') || 
          msg.includes('[email]') ||
          msg.includes('Admin POST /users')) {
        originalConsole.log(...args);
      }
    }
  };
  
  console.log = filteredLog;
  console.info = noop;
  console.debug = noop;
  console.warn = noop;
  
  // Keep error logging but make it less verbose
  console.error = (...args) => {
    // Only log critical startup/deployment errors and admin operations
    const msg = args[0];
    if (msg && typeof msg === 'string') {
      // Allow critical errors that prevent server from starting
      if (msg.includes('Failed to start') || 
          msg.includes('Cannot bind to port') ||
          msg.includes('EADDRINUSE') ||
          msg.includes('ECONNREFUSED') && msg.includes('database')) {
        originalConsole.error(...args);
      }
      // Allow admin-related errors
      if (msg.includes('[Admin]') || 
          msg.includes('[SES]') || 
          msg.includes('[email]')) {
        originalConsole.error(...args);
      }
      // Suppress common non-critical errors in demo mode
      // - ML dependencies missing (expected in demo)
      // - SwitchBot/device credentials (expected in demo)
      // - Python backend unavailable (expected in demo)
      // - Sensor/device files not found (expected in demo)
    }
  };

  originalConsole.log('🤫 Console output suppressed in DEMO_MODE');
}

/**
 * Restore original console methods
 */
export function restoreConsole() {
  if (originalConsole) {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  }
}

/**
 * Get a logger that respects demo mode
 * This can be used for force logging when needed
 */
export function getLogger() {
  return originalConsole || console;
}
