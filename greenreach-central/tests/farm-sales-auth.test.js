/**
 * Farm Sales Auth Tests
 * Validates all /farm-sales/* routes have auth middleware applied.
 */

import { jest } from '@jest/globals';

jest.unstable_mockModule('../config/database.js', () => ({
  query: jest.fn(),
  isDatabaseAvailable: jest.fn(() => false),
}));

const mockAuthMiddleware = jest.fn((req, res, next) => next());
jest.unstable_mockModule('../middleware/auth.js', () => ({
  authMiddleware: mockAuthMiddleware,
}));

const farmSalesMod = await import('../routes/farm-sales.js');
const router = farmSalesMod.default;

function getRoutes(router) {
  const routes = [];
  if (router.stack) {
    router.stack.forEach(layer => {
      if (layer.route) {
        const methods = Object.keys(layer.route.methods);
        routes.push({
          path: layer.route.path,
          methods,
          middlewareCount: layer.route.stack.length,
        });
      }
    });
  }
  return routes;
}

describe('Farm sales route auth coverage', () => {
  const routes = getRoutes(router);
  const publicPaths = ['/config/app', '/farm-auth/demo-tokens', '/demo/intro-cards'];
  const protectedRoutes = routes.filter(r => !publicPaths.includes(r.path));

  protectedRoutes.forEach(({ path, methods, middlewareCount }) => {
    test(`${Object.keys(methods).join(',').toUpperCase()} ${path} has auth middleware`, () => {
      expect(middlewareCount).toBeGreaterThanOrEqual(2);
    });
  });

  publicPaths.forEach(path => {
    test(`${path} is public (no auth required)`, () => {
      const match = routes.find(r => r.path === path);
      if (match) {
        expect(match.middlewareCount).toBe(1);
      }
    });
  });
});
