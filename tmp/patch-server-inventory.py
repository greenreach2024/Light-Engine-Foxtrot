#!/usr/bin/env python3
"""Patch greenreach-central/server.js: add import, remove stubs, mount new router."""
filepath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central/server.js'
with open(filepath, 'r') as f:
    content = f.read()

changes = 0

# 1. Add import for inventory-mgmt.js
old1 = "import inventoryRoutes from './routes/inventory.js';\nimport ordersRoutes from './routes/orders.js';"
new1 = "import inventoryRoutes from './routes/inventory.js';\nimport inventoryMgmtRoutes from './routes/inventory-mgmt.js';\nimport ordersRoutes from './routes/orders.js';"

if old1 in content:
    content = content.replace(old1, new1, 1)
    changes += 1
    print('1. Import added: DONE')
else:
    if 'inventoryMgmtRoutes' in content:
        print('1. Import: ALREADY PRESENT')
    else:
        print('1. Import: NOT FOUND')

# 2. Remove 8 stub routes
old2 = """app.get('/api/inventory/dashboard', async (_req, res) => {
  return res.json({
    ok: true,
    total_value: 0,
    alerts_by_category: {
      seeds: [],
      nutrients: [],
      packaging: [],
      equipment: [],
      supplies: []
    }
  });
});

app.get('/api/inventory/reorder-alerts', (_req, res) => {
  return res.json({ ok: true, alerts: [] });
});

app.get('/api/inventory/usage/weekly-summary', (_req, res) => {
  return res.json({
    ok: true,
    summary: {
      seeds_used: {},
      nutrients_used_ml: {},
      grow_media_kg: 0
    }
  });
});

app.get('/api/inventory/seeds/list', (_req, res) => {
  return res.json({ ok: true, seeds: [] });
});

app.get('/api/inventory/nutrients/list', (_req, res) => {
  return res.json({ ok: true, nutrients: [] });
});

app.get('/api/inventory/packaging/list', (_req, res) => {
  return res.json({ ok: true, packaging: [] });
});

app.get('/api/inventory/equipment/list', (_req, res) => {
  return res.json({ ok: true, equipment: [] });
});

app.get('/api/inventory/supplies/list', (_req, res) => {
  return res.json({ ok: true, supplies: [] });
});"""

new2 = """// Inventory management stubs removed — now served by inventoryMgmtRoutes"""

if old2 in content:
    content = content.replace(old2, new2, 1)
    changes += 1
    print('2. Stubs removed: DONE')
else:
    if "app.get('/api/inventory/dashboard'" in content:
        print('2. Stubs: PATTERN MISMATCH (stubs still present)')
    else:
        print('2. Stubs: ALREADY REMOVED')

# 3. Mount inventoryMgmtRoutes before inventoryRoutes
old3 = "app.use('/api/inventory', authMiddleware, inventoryRoutes);"
new3 = "app.use('/api/inventory', authMiddleware, inventoryMgmtRoutes);  // seeds, nutrients, packaging, equipment, supplies\napp.use('/api/inventory', authMiddleware, inventoryRoutes);     // crop inventory (current, forecast, sync)"

if old3 in content:
    content = content.replace(old3, new3, 1)
    changes += 1
    print('3. Router mounted: DONE')
elif 'inventoryMgmtRoutes' in content:
    print('3. Router: ALREADY MOUNTED')
else:
    print('3. Router mount: NOT FOUND')

if changes > 0:
    with open(filepath, 'w') as f:
        f.write(content)
    print(f'\nDone: {changes}/3 changes applied to server.js')
else:
    print('\nNo changes needed')
