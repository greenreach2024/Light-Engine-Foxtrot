import test from 'node:test';
import assert from 'node:assert/strict';

import {
  findScopedOrderIndex,
  getProcurementFarmContext,
  normalizeProcurementPaymentMethod,
} from '../routes/procurement.js';

test('normalizeProcurementPaymentMethod only accepts invoice', () => {
  assert.equal(normalizeProcurementPaymentMethod(), 'invoice');
  assert.equal(normalizeProcurementPaymentMethod('invoice'), 'invoice');
  assert.equal(normalizeProcurementPaymentMethod(' Invoice '), 'invoice');
  assert.equal(normalizeProcurementPaymentMethod('square'), null);
  assert.equal(normalizeProcurementPaymentMethod('stripe'), null);
});

test('findScopedOrderIndex enforces farm ownership', () => {
  const orders = [
    { orderId: 'PO-1', farmId: 'farm-alpha' },
    { orderId: 'PO-2', farmId: 'farm-beta' },
  ];

  assert.equal(findScopedOrderIndex(orders, 'PO-1', 'farm-alpha'), 0);
  assert.equal(findScopedOrderIndex(orders, 'PO-1', 'farm-beta'), -1);
  assert.equal(findScopedOrderIndex(orders, 'PO-2', 'farm-alpha'), -1);
});

test('getProcurementFarmContext prefers authenticated farm id', () => {
  const fallbackFarm = { farmId: 'file-farm', name: 'Fallback Farm' };
  const context = getProcurementFarmContext({ farm_id: 'token-farm' }, fallbackFarm);

  assert.equal(context.farmId, 'token-farm');
  assert.equal(context.farmInfo.farmId, 'token-farm');
  assert.equal(context.farmInfo.name, 'Fallback Farm');
});