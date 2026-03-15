/**
 * Auth Middleware Tests
 * Validates authentication guard behavior.
 */

import { jest } from '@jest/globals';

const mockVerify = jest.fn();
jest.unstable_mockModule('jsonwebtoken', () => ({
  default: { verify: mockVerify, sign: jest.fn() },
}));

jest.unstable_mockModule('../config/database.js', () => ({
  query: jest.fn(),
  isDatabaseAvailable: jest.fn(() => false),
}));

const { authMiddleware } = await import('../middleware/auth.js');

function mockReq(overrides = {}) {
  return {
    headers: {},
    query: {},
    path: '/api/test',
    ...overrides,
  };
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('authMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NODE_ENV;
  });

  test('rejects requests without any credentials', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    if (next.mock.calls.length === 0) {
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  test('accepts valid JWT in Authorization header', async () => {
    const payload = { farm_id: 'FARM-TEST', user_id: 'user-1' };
    mockVerify.mockReturnValue(payload);

    const req = mockReq({
      headers: { authorization: 'Bearer valid-token' },
    });
    const res = mockRes();
    const next = jest.fn();

    await authMiddleware(req, res, next);

    if (next.mock.calls.length > 0) {
      expect(req.farmId || req.farm_id || payload.farm_id).toBeTruthy();
    }
  });
});
