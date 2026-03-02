#!/usr/bin/env python3
"""Patch greenreach-central/server.js to add /api/credential-store routes."""
import os

SERVER_PATH = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central/server.js'

with open(SERVER_PATH, 'r') as f:
    content = f.read()

# Check if already patched
if '/api/credential-store' in content:
    print('Already patched — credential-store routes exist.')
    exit(0)

MARKER = "app.get('/farm', async (req, res) => {"

CREDENTIAL_BLOCK = """// ── Credential Store (SwitchBot / Kasa integration credentials) ────────────
app.get('/api/credential-store', (req, res) => {
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    const farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8'));
    const integrations = farm.integrations || {};
    return res.json({
      ok: true,
      switchbot: { configured: !!(integrations.switchbot && integrations.switchbot.token) },
      kasa:      { configured: !!(integrations.kasa && integrations.kasa.email) }
    });
  } catch (err) {
    logger.warn('[credential-store] GET error:', err.message);
    return res.json({ ok: true, switchbot: { configured: false }, kasa: { configured: false } });
  }
});

app.post('/api/credential-store', express.json(), (req, res) => {
  try {
    const farmJsonPath = path.join(FARM_DATA_DIR, 'farm.json');
    let farm = {};
    try { farm = JSON.parse(fs.readFileSync(farmJsonPath, 'utf8')); } catch (_) { /* new file */ }
    if (!farm.integrations) farm.integrations = {};
    const body = req.body || {};
    if (body.switchbot) {
      farm.integrations.switchbot = {
        token:  body.switchbot.token  || '',
        secret: body.switchbot.secret || '',
        region: body.switchbot.region || ''
      };
    }
    if (body.kasa) {
      farm.integrations.kasa = {
        email:    body.kasa.email    || '',
        password: body.kasa.password || ''
      };
    }
    fs.writeFileSync(farmJsonPath, JSON.stringify(farm, null, 2));
    const integrations = farm.integrations;
    return res.json({
      ok: true,
      switchbot: { configured: !!(integrations.switchbot && integrations.switchbot.token) },
      kasa:      { configured: !!(integrations.kasa && integrations.kasa.email) }
    });
  } catch (err) {
    logger.error('[credential-store] POST error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

"""

if MARKER not in content:
    print(f'ERROR: Could not find marker: {MARKER}')
    exit(1)

content = content.replace(MARKER, CREDENTIAL_BLOCK + MARKER)

with open(SERVER_PATH, 'w') as f:
    f.write(content)

print('Done. Credential-store routes added to GRC server.js')
