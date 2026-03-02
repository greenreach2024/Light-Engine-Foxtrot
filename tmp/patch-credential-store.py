#!/usr/bin/env python3
"""Patch server-foxtrot.js: add credential-store routes and proxy exclusion."""
import sys

filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/server-foxtrot.js'

with open(filepath, 'r') as f:
    content = f.read()

# 1. Insert credential-store GET+POST routes after integrationsRouter mount
old1 = "app.use('/api/integrations', integrationsRouter);\n\n/**\n * Device Wizard API"
new1 = r"""app.use('/api/integrations', integrationsRouter);

// ── Credential Store: Save/Load SwitchBot & Kasa credentials ──────────────
app.get('/api/credential-store', (req, res) => {
  try {
    const integ = getFarmIntegrations();
    res.json({
      ok: true,
      switchbot: { configured: Boolean(integ.switchbot.token && integ.switchbot.secret) },
      kasa: { configured: Boolean(integ.kasa.email && integ.kasa.password) }
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/credential-store', (req, res) => {
  try {
    const { switchbot, kasa } = req.body || {};
    const farm = readFarmProfile() || {};
    const existing = farm.integrations || {};

    if (switchbot) {
      existing.switchbot = existing.switchbot || {};
      if (typeof switchbot.token === 'string') existing.switchbot.token = switchbot.token.trim();
      if (typeof switchbot.secret === 'string') existing.switchbot.secret = switchbot.secret.trim();
      if (typeof switchbot.region === 'string') existing.switchbot.region = switchbot.region.trim();
    }
    if (kasa) {
      existing.kasa = existing.kasa || {};
      if (typeof kasa.email === 'string') existing.kasa.email = kasa.email.trim();
      if (typeof kasa.password === 'string') existing.kasa.password = kasa.password.trim();
    }

    farm.integrations = existing;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FARM_PATH, JSON.stringify(farm, null, 2));

    // Clear SwitchBot caches so new credentials take effect immediately
    try {
      switchBotDevicesCache.payload = null;
      switchBotDevicesCache.fetchedAt = 0;
      switchBotDevicesCache.inFlight = null;
      switchBotDevicesCache.lastError = null;
      for (const entry of switchBotStatusCache.values()) {
        entry.payload = null;
        entry.fetchedAt = 0;
        entry.inFlight = null;
        entry.lastError = null;
      }
      lastSwitchBotRequest = 0;
    } catch {}

    console.log('[integrations] Credentials saved to farm.json');
    const integ = getFarmIntegrations();
    res.json({
      ok: true,
      switchbot: { configured: Boolean(integ.switchbot.token && integ.switchbot.secret) },
      kasa: { configured: Boolean(integ.kasa.email && integ.kasa.password) }
    });
  } catch (e) {
    console.error('[integrations] Save error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * Device Wizard API"""

if old1 in content:
    content = content.replace(old1, new1, 1)
    print("1. Routes inserted OK")
else:
    print("1. FAILED: insertion point not found")
    sys.exit(1)

# 2. Add proxy exclusion
old2 = "'/devices/scan'    // P1: Device scanner endpoint\n      ];"
new2 = "'/devices/scan',   // P1: Device scanner endpoint\n        '/credential-store' // Integration credentials save/load\n      ];"
if old2 in content:
    content = content.replace(old2, new2, 1)
    print("2. Proxy exclusion added OK")
else:
    print("2. FAILED: proxy exclusion point not found")
    sys.exit(1)

with open(filepath, 'w') as f:
    f.write(content)

print("Done. File patched successfully.")
