/**
 * Delivery + Driver Workflow Tests
 * Verifies recently implemented delivery ledger, application review,
 * and delivery financial export flows.
 */

import { jest } from '@jest/globals';

const mockQuery = jest.fn();
const mockIsDatabaseAvailable = jest.fn(() => true);

const mockAllocateCartFromNetwork = jest.fn();
const mockCreateOrder = jest.fn();
const mockCreatePayment = jest.fn();
const mockSaveOrder = jest.fn();

jest.unstable_mockModule('../config/database.js', () => ({
  query: mockQuery,
  isDatabaseAvailable: mockIsDatabaseAvailable,
}));

jest.unstable_mockModule('../middleware/adminAuth.js', () => ({
  adminAuthMiddleware: (req, _res, next) => {
    req.admin = req.admin || { email: 'admin@test.local' };
    next();
  },
  requireAdminRole: () => (_req, _res, next) => next(),
}));

jest.unstable_mockModule('../services/wholesaleMemoryStore.js', () => ({
  authenticateBuyer: jest.fn(),
  createBuyer: jest.fn(),
  createOrder: mockCreateOrder,
  createPayment: mockCreatePayment,
  getBuyerById: jest.fn(),
  getBuyerByEmail: jest.fn(),
  getOrderById: jest.fn(),
  listAllOrders: jest.fn(async () => []),
  listOrdersForBuyer: jest.fn(),
  listPayments: jest.fn(() => []),
  listPaymentsForBuyer: jest.fn(() => []),
  listRefunds: jest.fn(() => []),
  listRefundsForOrder: jest.fn(() => []),
  createRefund: jest.fn(),
  saveOrder: mockSaveOrder,
  updateBuyer: jest.fn(),
  updateBuyerPassword: jest.fn(),
  updateFarmSubOrder: jest.fn(),
  deactivateBuyer: jest.fn(),
  listAllBuyers: jest.fn(() => []),
  loadBuyersFromDb: jest.fn(),
  blacklistToken: jest.fn(),
  isTokenBlacklisted: jest.fn(async () => false),
  recordLoginAttempt: jest.fn(),
  isAccountLocked: jest.fn(async () => false),
  resetLoginAttempts: jest.fn(),
  logOrderEvent: jest.fn(),
  getOrderAuditLog: jest.fn(() => []),
  createPasswordResetToken: jest.fn(() => 'reset-token'),
  consumePasswordResetToken: jest.fn(() => 'driver@test.local'),
}));

jest.unstable_mockModule('../services/wholesaleDemoCatalog.js', () => ({
  allocateCartFromDemo: jest.fn(),
  loadWholesaleDemoCatalog: jest.fn(),
}));

jest.unstable_mockModule('../services/wholesaleNetworkAggregator.js', () => ({
  addMarketEvent: jest.fn(),
  allocateCartFromNetwork: mockAllocateCartFromNetwork,
  buildAggregateCatalog: jest.fn(async () => ({ items: [] })),
  generateNetworkRecommendations: jest.fn(async () => ({ recommendations: [] })),
  getBuyerLocationFromBuyer: jest.fn(() => null),
  getNetworkTrends: jest.fn(async () => ({})),
  listMarketEvents: jest.fn(() => []),
  listNetworkSnapshots: jest.fn(() => []),
}));

jest.unstable_mockModule('../services/networkFarmsStore.js', () => ({
  listNetworkFarms: jest.fn(async () => []),
  removeNetworkFarm: jest.fn(),
  upsertNetworkFarm: jest.fn(),
}));

jest.unstable_mockModule('../services/squareCredentials.js', () => ({
  getBatchFarmSquareCredentials: jest.fn(async () => new Map()),
}));

jest.unstable_mockModule('../services/squarePaymentService.js', () => ({
  processSquarePayments: jest.fn(),
}));

jest.unstable_mockModule('../services/email-service.js', () => ({
  default: {
    sendOrderConfirmation: jest.fn(async () => ({})),
  },
}));

jest.unstable_mockModule('../middleware/farmApiKeyAuth.js', () => ({
  requireFarmApiKey: (_req, _res, next) => next(),
  loadFarmApiKeys: () => ({}),
}));

jest.unstable_mockModule('../services/orderStateMachine.js', () => ({
  transitionOrderStatus: jest.fn(),
}));

const wholesaleModule = await import('../routes/wholesale.js');
const adminDeliveryModule = await import('../routes/admin-delivery.js');
const wholesaleExportsModule = await import('../routes/wholesale-exports.js');

const wholesaleRouter = wholesaleModule.default;
const adminDeliveryRouter = adminDeliveryModule.default;
const wholesaleExportsRouter = wholesaleExportsModule.default;

function getRouteHandler(router, method, path) {
  const layer = router.stack.find((entry) =>
    entry?.route?.path === path && entry?.route?.methods?.[method]
  );
  if (!layer) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }
  const stack = layer.route.stack || [];
  return stack[stack.length - 1].handle;
}

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  res.setHeader = jest.fn();
  res.send = jest.fn().mockReturnValue(res);
  return res;
}

describe('Delivery and driver workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsDatabaseAvailable.mockReturnValue(true);
    mockSaveOrder.mockResolvedValue(undefined);
    process.env.WHOLESALE_CATALOG_MODE = 'network';
    process.env.WHOLESALE_REQUIRE_DB_FOR_CRITICAL = 'false';
  });

  test('checkout execute persists delivery ledger and payout records', async () => {
    const checkoutHandler = getRouteHandler(wholesaleRouter, 'post', '/checkout/execute');

    mockAllocateCartFromNetwork.mockResolvedValue({
      allocation: {
        subtotal: 100,
        broker_fee_total: 10,
        net_to_farms_total: 90,
        grand_total: 100,
        farm_sub_orders: [
          {
            farm_id: 'FARM-1',
            farm_name: 'Farm One',
            subtotal: 100,
            items: [{ sku_id: 'SKU-1', product_name: 'Basil', quantity: 2, unit: 'case' }],
          },
        ],
      },
      payment_split: [{ farm_id: 'FARM-1', gross_amount: 100, broker_fee: 10, net_amount: 90 }],
    });

    mockCreateOrder.mockImplementation(({ buyerId, buyerAccount, deliveryDate, deliveryAddress, farmSubOrders, totals }) => ({
      master_order_id: 'wo-test-1',
      buyer_id: buyerId,
      buyer_account: buyerAccount,
      delivery_date: deliveryDate,
      delivery_address: deliveryAddress,
      farm_sub_orders: farmSubOrders,
      grand_total: totals.grand_total,
      created_at: new Date().toISOString(),
    }));

    mockCreatePayment.mockReturnValue({
      payment_id: 'pay-1',
      status: 'pending',
      provider: 'manual',
    });

    mockQuery.mockImplementation(async (text) => {
      if (text.includes('FROM delivery_drivers')) {
        return {
          rows: [
            {
              driver_id: 'DRV-1',
              pay_per_delivery: 5.5,
              cold_chain_bonus: 2,
              cold_chain_certified: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const req = {
      wholesaleBuyer: { id: 'buyer-1' },
      body: {
        buyer_account: { email: 'buyer@test.local', name: 'Buyer A' },
        delivery_date: '2026-03-20',
        delivery_address: {
          street: '1 Test St',
          city: 'Kingston',
          postalCode: 'K7L1A1',
        },
        recurrence: { cadence: 'one_time' },
        cart: [{ sku_id: 'SKU-1', quantity: 2 }],
        payment_provider: 'manual',
        fulfillment_method: 'delivery',
        delivery_fee: 8,
        sourcing: { mode: 'auto_network' },
      },
      app: { locals: { databaseReady: true } },
    };
    const res = mockRes();
    const next = jest.fn();

    await checkoutHandler(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalled();

    const sqlCalls = mockQuery.mock.calls.map((call) => String(call[0] || ''));
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO delivery_orders'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO driver_payouts'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('UPDATE delivery_drivers'))).toBe(true);
  });

  test('admin can review application and onboard driver', async () => {
    const reviewHandler = getRouteHandler(adminDeliveryRouter, 'patch', '/applications/:applicationId');

    mockQuery.mockImplementation(async (text) => {
      if (text.includes('SELECT * FROM driver_applications')) {
        return {
          rows: [
            {
              application_id: 'APP-ABC123456789',
              name: 'Driver One',
              email: 'driver@test.local',
              phone: '6135550000',
              vehicle_type: 'car',
            },
          ],
        };
      }
      if (text.includes('UPDATE driver_applications')) {
        return {
          rows: [
            {
              application_id: 'APP-ABC123456789',
              status: 'approved',
              reviewer_notes: 'approved',
              reviewed_at: new Date().toISOString(),
              reviewed_by: 'admin@test.local',
            },
          ],
        };
      }
      if (text.includes('SELECT driver_id FROM delivery_drivers')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const req = {
      params: { applicationId: 'APP-ABC123456789' },
      body: {
        status: 'approved',
        reviewer_notes: 'approved',
        create_driver: true,
        farm_id: 'FARM-1',
        pay_per_delivery: 6,
      },
      admin: { email: 'admin@test.local' },
    };
    const res = mockRes();

    await reviewHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        application: expect.objectContaining({ status: 'approved' }),
      })
    );

    const sqlCalls = mockQuery.mock.calls.map((call) => String(call[0] || ''));
    expect(sqlCalls.some((sql) => sql.includes('UPDATE driver_applications'))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes('INSERT INTO delivery_drivers'))).toBe(true);
  });

  test('delivery fee export returns csv rows', async () => {
    const exportHandler = getRouteHandler(wholesaleExportsRouter, 'get', '/delivery-fees');

    mockQuery.mockResolvedValue({
      rows: [
        {
          farm_id: 'FARM-1',
          delivery_id: 'dlv-1',
          order_id: 'wo-1',
          delivery_date: '2026-03-20',
          status: 'scheduled',
          delivery_fee: 8,
          tip_amount: 0,
          driver_payout_amount: 6,
          platform_margin: 2,
          created_at: '2026-03-15T12:00:00.000Z',
          updated_at: '2026-03-15T12:00:00.000Z',
        },
      ],
    });

    const req = { query: {} };
    const res = mockRes();

    await exportHandler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.send).toHaveBeenCalled();
    const csv = String(res.send.mock.calls[0][0]);
    expect(csv).toContain('farm_id,delivery_id,order_id');
    expect(csv).toContain('FARM-1,dlv-1,wo-1');
  });

  test('reconciliation endpoint flags payout and margin anomalies', async () => {
    const reconciliationHandler = getRouteHandler(adminDeliveryRouter, 'get', '/reconciliation');

    mockQuery.mockResolvedValue({
      rows: [
        {
          farm_id: 'FARM-1',
          day: '2026-03-15',
          delivery_count: 3,
          payout_count: 2,
          delivery_fee_total: 24,
          driver_payout_total_orders: 18,
          payout_total_ledger: 16,
          platform_margin_total: 6,
          expected_margin: 8,
          payout_delta: 2,
          margin_delta: -2,
        },
      ],
    });

    const req = { query: { threshold: '0.5' } };
    const res = mockRes();

    await reconciliationHandler(req, res);

    expect(res.json).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    expect(payload.success).toBe(true);
    expect(payload.summary.anomalies).toBe(1);
    expect(payload.rows[0].anomaly).toBe(true);
    expect(payload.rows[0].flags).toEqual(
      expect.arrayContaining(['payout_mismatch', 'margin_mismatch', 'count_mismatch'])
    );
  });

  test('delivery reconciliation export returns csv with anomaly flags', async () => {
    const reconciliationExportHandler = getRouteHandler(wholesaleExportsRouter, 'get', '/delivery-reconciliation');

    mockQuery.mockResolvedValue({
      rows: [
        {
          farm_id: 'FARM-1',
          day: '2026-03-15',
          delivery_count: 3,
          payout_count: 2,
          delivery_fee_total: 24,
          driver_payout_total_orders: 18,
          payout_total_ledger: 16,
          platform_margin_total: 6,
          expected_margin: 8,
          payout_delta: 2,
          margin_delta: -2,
        },
      ],
    });

    const req = { query: { threshold: '0.5' } };
    const res = mockRes();

    await reconciliationExportHandler(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv; charset=utf-8');
    expect(res.send).toHaveBeenCalled();
    const csv = String(res.send.mock.calls[0][0]);
    expect(csv).toContain('farm_id,day,delivery_count,payout_count');
    expect(csv).toContain('payout_mismatch;margin_mismatch;count_mismatch');
  });
});
