/**
 * Light Engine Desktop - Express Server
 * Simplified server for desktop deployment (inventory-only mode)
 * 
 * This is a lightweight wrapper that:
 * 1. Uses SQLite instead of PostgreSQL
 * 2. Disables automation features
 * 3. Runs on localhost only
 * 4. Uses local file storage
 */

// Load the main server from parent directory
const path = require('path');
const parentServer = path.join(__dirname, '..', 'server-foxtrot.js');

console.log('[Desktop Server] Loading main server from:', parentServer);
console.log('[Desktop Server] Mode: inventory-only');
console.log('[Desktop Server] Database: SQLite');
console.log('[Desktop Server] Port:', process.env.PORT || 8091);

// Import and run the main server
// The DEPLOYMENT_MODE=inventory-only env var will disable automation
require(parentServer);
