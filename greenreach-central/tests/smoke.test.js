/**
 * Smoke Tests — Module Loading
 * Verifies all critical route modules import without errors.
 */

describe('Module import smoke tests', () => {
  test('purchase routes load', async () => {
    const mod = await import('../routes/purchase.js');
    expect(mod.default).toBeDefined();
  });

  test('farm-sales routes load', async () => {
    const mod = await import('../routes/farm-sales.js');
    expect(mod.default).toBeDefined();
  });

  test('wholesale routes load', async () => {
    const mod = await import('../routes/wholesale.js');
    expect(mod.default).toBeDefined();
  });

  test('procurement-admin routes load', async () => {
    const mod = await import('../routes/procurement-admin.js');
    expect(mod.default).toBeDefined();
  });

  test('billing routes load', async () => {
    const mod = await import('../routes/billing.js');
    expect(mod.default).toBeDefined();
  });

  test('adminAuth middleware loads', async () => {
    const mod = await import('../middleware/adminAuth.js');
    expect(typeof mod.adminAuthMiddleware).toBe('function');
  });

  test('auth middleware loads', async () => {
    const mod = await import('../middleware/auth.js');
    expect(typeof mod.authMiddleware).toBe('function');
  });

  test('database config loads', async () => {
    const mod = await import('../config/database.js');
    expect(typeof mod.isDatabaseAvailable).toBe('function');
  });

  test('wholesaleMemoryStore loads', async () => {
    const mod = await import('../services/wholesaleMemoryStore.js');
    expect(typeof mod.createBuyer).toBe('function');
  });
});
