#!/usr/bin/env python3
"""Patch greenreach-central/server.js to add IoT edge-proxy routes for:
  - /discovery/capabilities (GET)
  - /discovery/scan (POST)
  - /api/switchbot/* (proxy to edge)
  - /switchbot/devices (proxy to edge)
  - /api/kasa/* (proxy to edge)
  - /api/bus-mappings, /api/bus-mapping, /api/bus/:busId/scan (proxy to edge)
"""
import os, sys

SERVER_PATH = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central/server.js'

with open(SERVER_PATH, 'r') as f:
    content = f.read()

# Check if already patched
if 'edgeProxy' in content and '/discovery/capabilities' in content:
    print('Already patched — IoT edge-proxy routes exist.')
    sys.exit(0)

# Find the discovery proxy mount point to insert after it
MARKER = "app.use('/api/discovery/devices', discoveryProxyRoutes); // API alias for discovery proxy"

if MARKER not in content:
    print(f'ERROR: Could not find marker: {MARKER}')
    sys.exit(1)

IOT_PROXY_BLOCK = """

// ── IoT Edge Proxy — forwards IoT/device API calls to Foxtrot edge server ──
function resolveEdgeUrlForProxy() {
  if (process.env.FARM_EDGE_URL) return process.env.FARM_EDGE_URL.replace(/\\/$/, '');
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    const farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    if (farm.url) return farm.url.replace(/\\/$/, '');
  } catch (_) { /* ignore */ }
  return null;
}

async function edgeProxy(req, res, edgePath, method = 'GET', body = null) {
  const edgeUrl = resolveEdgeUrlForProxy();
  if (!edgeUrl) {
    return res.status(503).json({
      error: 'No edge server configured',
      message: 'Set FARM_EDGE_URL or configure farm.json url field',
      timestamp: new Date().toISOString()
    });
  }
  const url = `${edgeUrl}${edgePath}`;
  const opts = {
    method,
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000)
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);
  try {
    logger.info(`[EdgeProxy] ${method} ${url}`);
    const response = await fetch(url, opts);
    const text = await response.text();
    res.status(response.status).type('json').send(text);
  } catch (err) {
    if (err?.name === 'AbortError' || err?.name === 'TimeoutError') {
      return res.status(504).json({ error: 'Gateway timeout', message: 'Edge server did not respond', timestamp: new Date().toISOString() });
    }
    logger.error(`[EdgeProxy] ${method} ${edgePath} error:`, err.message);
    return res.status(502).json({ error: 'Edge proxy failure', message: err.message, timestamp: new Date().toISOString() });
  }
}

// Discovery endpoints
app.get('/discovery/capabilities', (req, res) => edgeProxy(req, res, '/discovery/capabilities'));
app.post('/discovery/scan', express.json(), (req, res) => edgeProxy(req, res, '/discovery/scan', 'POST', req.body));

// SwitchBot endpoints
app.post('/api/switchbot/discover', express.json(), (req, res) => edgeProxy(req, res, '/api/switchbot/discover', 'POST', req.body));
app.get('/switchbot/devices', (req, res) => edgeProxy(req, res, '/switchbot/devices'));
app.get('/api/switchbot/devices/:id/status', (req, res) => edgeProxy(req, res, `/api/switchbot/devices/${req.params.id}/status?${new URLSearchParams(req.query)}`));
app.post('/api/switchbot/devices/:id/commands', express.json(), (req, res) => edgeProxy(req, res, `/api/switchbot/devices/${req.params.id}/commands`, 'POST', req.body));

// Kasa endpoints
app.post('/api/kasa/discover', express.json(), (req, res) => edgeProxy(req, res, '/api/kasa/discover', 'POST', req.body));
app.post('/api/kasa/configure', express.json(), (req, res) => edgeProxy(req, res, '/api/kasa/configure', 'POST', req.body));
app.post('/api/kasa/device/:host/power', express.json(), (req, res) => edgeProxy(req, res, `/api/kasa/device/${req.params.host}/power`, 'POST', req.body));

// Bus/DMX endpoints
app.get('/api/bus-mappings', (req, res) => edgeProxy(req, res, '/api/bus-mappings'));
app.post('/api/bus-mapping', express.json(), (req, res) => edgeProxy(req, res, '/api/bus-mapping', 'POST', req.body));
app.get('/api/bus/:busId/scan', (req, res) => edgeProxy(req, res, `/api/bus/${req.params.busId}/scan`));
"""

content = content.replace(MARKER, MARKER + IOT_PROXY_BLOCK)

with open(SERVER_PATH, 'w') as f:
    f.write(content)

print('Done. IoT edge-proxy routes added to GRC server.js')
print('Added: /discovery/capabilities, /discovery/scan, /api/switchbot/*, /switchbot/devices, /api/kasa/*, /api/bus-*')
