/**
 * Purchase Routes — Admin Auth Migration Tests
 * Validates admin endpoints now require Bearer token instead of admin_key query param.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../config/database.js', () => ({
  query: jest.fn(),
  isDatabaseAvailable: jest.fn(() => false),
}));

jest.unstable_mockModule('../services/email.js', () => ({
  sendWelcomeEmail: jest.fn(),
}));

jest.unstable_mockModule('../middleware/adminAuth.js', () => ({
  adminAuthMiddleware: jest.fn((req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Authentication required' });
    }
    next();
  }),
}));

const purchaseMod = await import('../routes/purchase.js');
const router = purchaseMod.default;

function getRoutes(router) {
  const routes = [];
  if (router.stack) {
    router.stack.forEach(layer => {
      if (layer.route) {
        Object.keys(layer.route.methods).forEach(method => {
          routes.push({ path: layer.route.path, method, middlewareCount: layer.route.stack.length });
        });
      }
    });
  }
  return routes;
}

describe('Purchase admin endpoints auth migration', () => {
  const adminEndpoints = [
    { method: 'delete', path: '/api/purchase/farm/:farmId' },
    { method: 'get', path: '/api/purchase/sessions' },
    { method: 'post', path: '/api/purchase/manual-verify/:sessionId' },
    { method: 'patch', path: '/api/purchase/farm/:farmId' },
    { method: 'get', path: '/api/purchase/farms' },
    { method: 'post', path: '/api/purchase/fix-admin-role' },
  ];

  const routes = getRoutes(router);

  adminEndpoints.forEach(({ method, path }) => {
    test(`${method.toUpperCase()} ${path} has middleware guard (not just handler)`, () => {
      const match = routes.find(r => r.path === path && r.method === method);
      expect(match).toBeDefined();
      expect(match.middlewareCount).toBeGreaterThanOrEqual(2);
    });
  });

  test('no routes contain admin_key query param check', async () => {
    const fs = await import('fs');
    const content = fs.readFileSync(new URL('../routes/purchase.js', import.meta.url), 'utf8');
    expect(content).not.toContain('req.query.admin_key');
  });
});
