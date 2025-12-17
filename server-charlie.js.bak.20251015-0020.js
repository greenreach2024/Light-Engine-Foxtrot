// Copilot: backup before healthz guard
const fs = require('fs');
const src = 'server-charlie.js';
const dest = `server-charlie.js.bak.20251015-0020`;
fs.copyFileSync(src, dest);
