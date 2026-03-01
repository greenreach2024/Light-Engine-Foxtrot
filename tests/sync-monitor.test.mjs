import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createSyncMonitor } from '../greenreach-central/services/syncMonitor.js';

test('sync monitor tracks operation totals and per-farm metrics', () => {
  const monitor = createSyncMonitor({ sampleIntervalMs: 1000, persistenceEnabled: false });
  monitor.start();

  monitor.recordOperation({ farmId: 'FARM-1', type: 'sync-groups', success: true, records: 3, lagMs: 120 });
  monitor.recordOperation({ farmId: 'FARM-1', type: 'sync-groups', success: false, error: 'timeout', lagMs: 450 });
  monitor.recordPullRun({ success: true, updated: 5, errors: 0, farmId: 'FARM-1', durationMs: 900 });

  const snapshot = monitor.snapshot();
  assert.equal(snapshot.totals.operations, 3);
  assert.equal(snapshot.totals.success, 2);
  assert.equal(snapshot.totals.failure, 1);
  assert.equal(snapshot.totals.pull_runs, 1);
  assert.equal(snapshot.totals.records_updated, 8);

  assert.equal(snapshot.farms_count, 1);
  const farm = snapshot.farms[0];
  assert.equal(farm.farm_id, 'FARM-1');
  assert.equal(farm.operations, 3);
  assert.equal(farm.success, 2);
  assert.equal(farm.failure, 1);
  assert.equal(farm.last_error, null);

  assert.equal(snapshot.operations_by_type['sync-groups'].total, 2);
  assert.equal(snapshot.operations_by_type['pull-farm-data'].total, 1);
  assert.ok(['healthy', 'degraded', 'stale'].includes(snapshot.health.status));

  monitor.stop();
});

test('sync monitor reports stale health when no recent success exists', async () => {
  const monitor = createSyncMonitor({ staleAfterMs: 1, sampleIntervalMs: 1000, persistenceEnabled: false });
  monitor.start();

  await new Promise((resolve) => setTimeout(resolve, 5));
  const snapshot = monitor.snapshot();

  assert.equal(snapshot.health.stale, true);
  assert.equal(snapshot.health.status, 'stale');

  monitor.stop();
});

test('sync monitor emits transition events for degraded and recovery states', () => {
  const monitor = createSyncMonitor({ sampleIntervalMs: 1000, staleAfterMs: 60000, persistenceEnabled: false });
  monitor.start();

  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: false, error: 'timeout-1' });
  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: false, error: 'timeout-2' });
  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: false, error: 'timeout-3' });

  const degradedSnapshot = monitor.snapshot();
  const degradedEvent = degradedSnapshot.alerts.recent.find(
    (event) => event.farm_id === 'FARM-ALERT' && event.to === 'degraded' && event.action === 'raised'
  );

  assert.equal(degradedSnapshot.alerts.raised >= 1, true);
  assert.ok(degradedEvent);

  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: true, records: 1 });
  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: true, records: 1 });
  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: true, records: 1 });
  monitor.recordOperation({ farmId: 'FARM-ALERT', type: 'sync-groups', success: true, records: 1 });

  const recoveredSnapshot = monitor.snapshot();
  const recoveryEvent = recoveredSnapshot.alerts.recent.find(
    (event) => event.farm_id === 'FARM-ALERT' && event.to === 'healthy' && event.action === 'resolved'
  );

  assert.equal(recoveredSnapshot.alerts.resolved >= 1, true);
  assert.ok(recoveryEvent);

  monitor.stop();
});

test('sync monitor restores persisted snapshot state on restart', () => {
  const snapshotFilePath = path.join(os.tmpdir(), `sync-monitor-test-${Date.now()}.json`);

  const first = createSyncMonitor({
    sampleIntervalMs: 1000,
    staleAfterMs: 60000,
    snapshotFilePath,
    persistenceEnabled: true
  });
  first.start();
  first.recordOperation({ farmId: 'FARM-PERSIST', type: 'sync-groups', success: true, records: 2 });
  first.recordOperation({ farmId: 'FARM-PERSIST', type: 'sync-rooms', success: false, error: 'persist-test' });
  first.stop();

  assert.equal(fs.existsSync(snapshotFilePath), true);

  const second = createSyncMonitor({
    sampleIntervalMs: 1000,
    staleAfterMs: 60000,
    snapshotFilePath,
    persistenceEnabled: true
  });
  second.start();

  const snapshot = second.snapshot();
  assert.equal(snapshot.totals.operations >= 2, true);
  assert.equal(snapshot.totals.success >= 1, true);
  assert.equal(snapshot.totals.failure >= 1, true);
  assert.equal(snapshot.farms.some((farm) => farm.farm_id === 'FARM-PERSIST'), true);
  assert.ok(snapshot.last_persisted_at);

  second.stop();
  fs.rmSync(snapshotFilePath, { force: true });
});
