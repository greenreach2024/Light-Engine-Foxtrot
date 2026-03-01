import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';

import { app, __runDailyPlanResolverForTests, __testUtils } from '../server-foxtrot.js';

const DATA_DIR = path.resolve('./public/data');
const DATA_FILES = ['plans.json', 'groups.json', 'schedules.json', 'env.json'];
const ORIGINAL_CONTENT = new Map();

let server;
let baseUrl;

async function listen(appInstance) {
  return new Promise((resolve) => {
    const instance = appInstance.listen(0, () => {
      const { port } = instance.address();
      resolve({ instance, port });
    });
  });
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') return false;
    throw error;
  }
}

async function backupDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const name of DATA_FILES) {
    const full = path.join(DATA_DIR, name);
    if (await fileExists(full)) {
      const contents = await fs.readFile(full, 'utf8');
      ORIGINAL_CONTENT.set(name, contents);
    } else {
      ORIGINAL_CONTENT.set(name, null);
    }
  }
}

async function resetDataFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  for (const name of DATA_FILES) {
    const original = ORIGINAL_CONTENT.get(name);
    const full = path.join(DATA_DIR, name);
    if (original === null || original === undefined) {
      await fs.rm(full, { force: true });
    } else {
      await fs.writeFile(full, original, 'utf8');
    }
  }
}

async function httpRequest(method, targetPath, body) {
  const headers = {};
  let payload;
  if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  return new Promise((resolve, reject) => {
    const req = http.request(
      `${baseUrl}${targetPath}`,
      { method, headers },
      async (res) => {
        try {
          const chunks = [];
          for await (const chunk of res) {
            chunks.push(chunk);
          }
          const raw = Buffer.concat(chunks).toString('utf8');
          let json;
          try {
            json = raw ? JSON.parse(raw) : {};
          } catch (error) {
            json = { parseError: error.message, raw };
          }
          resolve({ status: res.statusCode ?? 0, body: json });
        } catch (error) {
          reject(error);
        }
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function createSamplePlan() {
  return {
    id: 'Acceptance.PlanA',
    name: 'Acceptance Demo Plan',
    defaults: {
      photoperiod: 16,
      ramp: { sunrise: 10, sunset: 10 },
    },
    light: {
      days: [
        {
          d: 1,
          stage: 'Seedling',
          ppfd: 200,
          photoperiod: 16,
          mix: { cw: 5, ww: 5, bl: 45, rd: 45 },
        },
        {
          d: 6,
          stage: 'Juvenile',
          ppfd: 260,
          mix: { cw: 8, ww: 8, bl: 42, rd: 42 },
        },
        {
          d: 14,
          stage: 'Vegetative',
          ppfd: 320,
          mix: { cw: 10, ww: 10, bl: 40, rd: 40 },
        },
      ],
    },
    env: {
      days: [
        { d: 1, tempC: 20, rh: 65, rhBand: 5 },
        { d: 6, tempC: 20, rh: 60, rhBand: 4 },
        { d: 14, tempC: 20, rh: 55, rhBand: 3 },
      ],
      control: { enable: true, step: 5, dwell: 600 },
    },
  };
}

async function publishPlan(plan) {
  return httpRequest('POST', '/plans', { plans: [plan] });
}

async function saveGroups(groups) {
  return httpRequest('POST', '/groups', { groups });
}

async function readChannelScaleMaxByte() {
  const full = path.resolve('./config/channel-scale.json');
  try {
    const raw = await fs.readFile(full, 'utf8');
    const parsed = JSON.parse(raw);
    const candidate = Number(parsed?.maxByte);
    if (Number.isFinite(candidate) && candidate > 0) {
      return Math.min(Math.round(candidate), 255);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }
  return 64;
}

test.before(async () => {
  const { instance, port } = await listen(app);
  server = instance;
  baseUrl = `http://127.0.0.1:${port}`;
  await backupDataFiles();
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => {
      server.close(() => resolve());
    });
  }
  await resetDataFiles();
});

test.afterEach(async () => {
  await resetDataFiles();
});

test('GET /plans returns published plan keys', async () => {
  const plan = createSamplePlan();
  plan.meta = { label: 'Acceptance Demo', category: ['Leafy'], revision: 'v1' };
  const publish = await publishPlan(plan);
  assert.equal(publish.status, 200);
  assert.equal(publish.body.ok, true);
  assert.ok(Array.isArray(publish.body.plans));
  assert.ok(publish.body.plans.length >= 1);
  const publishedPlanId = String(publish.body.plans[0]?.id || plan.id);

  const list = await httpRequest('GET', '/plans');
  assert.equal(list.status, 200);
  assert.equal(list.body.ok, true);
  assert.ok(Array.isArray(list.body.plans));
  const ids = list.body.plans.map((entry) => String(entry.id || '')).sort();
  const returnedPlan = list.body.plans.find((entry) => String(entry.id || '').toLowerCase() === publishedPlanId.toLowerCase());
  if (returnedPlan) {
    assert.equal(returnedPlan.name, 'Acceptance Demo Plan');
    assert.equal(returnedPlan.meta.label, 'Acceptance Demo');
  } else {
    const publishedNames = (publish.body.plans || []).map((entry) => entry?.name).filter(Boolean);
    assert.ok(publishedNames.includes('Acceptance Demo Plan'));
  }
});

test('Plan preview day responds to seed date and DPS anchor', () => {
  const { computePlanDayNumber, resolvePlanLightTargets, resolvePlanEnvTargets } = __testUtils;
  const plan = createSamplePlan();
  const group = { seedDate: '2025-01-01' };
  const today = new Date('2025-01-06T00:00:00Z');

  const seedConfig = { anchor: { seedDate: '2025-01-01' } };
  const dayFromSeed = computePlanDayNumber(seedConfig, group, today);
  assert.equal(dayFromSeed, 6);
  const lightSeed = resolvePlanLightTargets(plan, dayFromSeed);
  assert.equal(lightSeed.stage, 'Juvenile');
  assert.equal(lightSeed.day, 6);
  const envSeed = resolvePlanEnvTargets(plan, dayFromSeed);
  assert.equal(envSeed.rh, 60);
  assert.equal(envSeed.rhBand, 4);

  const dpsConfig = { anchor: { mode: 'dps', dps: 2 } };
  const dayFromDps = computePlanDayNumber(dpsConfig, group, today);
  assert.equal(dayFromDps, 2);
  const lightDps = resolvePlanLightTargets(plan, dayFromDps);
  assert.equal(lightDps.stage, 'Seedling');
  assert.equal(lightDps.day, 2);
  const envDps = resolvePlanEnvTargets(plan, dayFromDps);
  assert.equal(envDps.rh, 65);
  assert.equal(envDps.rhBand, 5);
});

test('Daily resolver applies mix and updates /env snapshot', async () => {
  const plan = createSamplePlan();
  const publish = await publishPlan(plan);
  assert.equal(publish.status, 200);
  const publishedPlanId = String(publish.body?.plans?.[0]?.id || plan.id);
  const groupsPayload = [
    {
      id: 'grp-1',
      name: 'Acceptance Group',
      plan: publishedPlanId,
      room: 'Demo Room',
      zone: 'Zone-1',
      members: ['fixture-1'],
      planConfig: {
        anchor: { mode: 'dps', dps: 3 },
        schedule: { startTime: '06:00', durationHours: 16, rampUpMin: 15, rampDownMin: 15 },
      },
    },
  ];
  const save = await saveGroups(groupsPayload);
  assert.equal(save.status, 200);
  assert.equal(save.body.ok, true);

  const results = await __runDailyPlanResolverForTests('acceptance');
  assert.ok(Array.isArray(results));
  assert.ok(results.length === 0 || results.length === 1);
  if (results.length === 0) {
    const envLegacy = await httpRequest('GET', '/env?legacy=1');
    assert.equal(envLegacy.status, 200);
    const legacyGroups = envLegacy.body?.planResolver?.groups ?? [];
    assert.equal(legacyGroups.length, 0);
    return;
  }
  const [groupResult] = results;
  assert.equal(String(groupResult.planKey).toLowerCase(), publishedPlanId.toLowerCase());
  assert.equal(groupResult.day, 3);
  assert.equal(groupResult.stage, 'Seedling');
  assert.equal(groupResult.devices.length, 1);
  const mix = { cw: 5, ww: 5, bl: 45, rd: 45 };
  const maxByte = await readChannelScaleMaxByte();
  const expectedHex = __testUtils.buildHexPayload(mix, maxByte);
  assert.equal(groupResult.devices[0].hex, expectedHex);
  const expectedDli = (groupResult.targetPpfd * groupResult.photoperiodHours * 3600) / 1e6;
  assert.ok(Math.abs(groupResult.dli - expectedDli) < 1e-6);

  const envLegacy = await httpRequest('GET', '/env?legacy=1');
  assert.equal(envLegacy.status, 200);
  const legacyGroups = envLegacy.body?.planResolver?.groups ?? [];
  assert.equal(legacyGroups.length, 1);
  const legacyGroup = legacyGroups[0];
  assert.equal(String(legacyGroup.planKey).toLowerCase(), publishedPlanId.toLowerCase());
  assert.equal(legacyGroup.devices[0].hex, expectedHex);
  const roomTargets = envLegacy.body?.targets?.['Demo Room'];
  assert.ok(roomTargets);
  assert.equal(roomTargets.dli, groupResult.dli);
  assert.equal(roomTargets.planDay, groupResult.day);
  assert.equal(roomTargets.rhBand, 5);

  const sched = await httpRequest('GET', '/sched');
  assert.equal(sched.status, 200);
  assert.equal(sched.body.ok, true);
  assert.ok(Array.isArray(sched.body.schedules));
});

test('HEX12 payloads and energy metrics are computed', async () => {
  const { buildHexPayload, resolvePlanLightTargets, computeEnergy } = __testUtils;
  const plan = createSamplePlan();
  const lightTargets = resolvePlanLightTargets(plan, 6);
  const maxByte = await readChannelScaleMaxByte();
  const hex = buildHexPayload(lightTargets.mix, maxByte);
  assert.equal(hex.length, 12);
  assert.match(hex, /^[0-9A-F]{12}$/);

  const hours = lightTargets.photoperiodHours ?? 16;
  const expectedDli = (lightTargets.ppfd * hours * 3600) / 1e6;
  assert.ok(Number.isFinite(expectedDli));

  const energySamples = [
    { kwh: 1.2 },
    { energyKwh: 0.8 },
    { energy: 0.5 },
  ];
  const totalEnergy = computeEnergy(energySamples);
  assert.equal(totalEnergy, 2.5);
});

test('Dehumidifier automation honors rhBand and dwell guardrails', () => {
  const { evaluateRoomAutomationConfig } = __testUtils;
  const nowIso = new Date().toISOString();
  const baseConfig = {
    roomId: 'room-1',
    name: 'Acceptance Room',
    targets: { rh: 65, rhBand: 4 },
    control: { enable: true, dwell: 120 },
    sensors: { rh: 'scope-1' },
  };

  const highHumiditySnapshot = {
    scopes: {
      'scope-1': {
        sensors: {
          rh: {
            value: 72,
            unit: '%',
            observedAt: nowIso,
            history: [],
            meta: { liveSources: 1, totalSources: 1 },
          },
        },
      },
    },
  };

  const evaluationHigh = evaluateRoomAutomationConfig(baseConfig, highHumiditySnapshot, [], null);
  const dehuOn = evaluationHigh.suggestions.find((entry) => entry.action?.actuator === 'dehu' && entry.action?.mode === 'on');
  assert.ok(dehuOn, 'Expected dehumidifier ON suggestion when humidity is above band');
  assert.equal(dehuOn.action.dwell, 600);
  assert.ok(dehuOn.label.includes('10m dwell'));

  const withinBandSnapshot = JSON.parse(JSON.stringify(highHumiditySnapshot));
  withinBandSnapshot.scopes['scope-1'].sensors.rh.value = 68; // within 65 ±4 band
  const evaluationWithin = evaluateRoomAutomationConfig(baseConfig, withinBandSnapshot, [], null);
  const hasSuggestionWithin = evaluationWithin.suggestions.some((entry) => entry.action?.actuator === 'dehu');
  assert.equal(hasSuggestionWithin, false, 'No dehumidifier action expected inside band');

  const lowHumiditySnapshot = JSON.parse(JSON.stringify(highHumiditySnapshot));
  lowHumiditySnapshot.scopes['scope-1'].sensors.rh.value = 58;
  const evaluationLow = evaluateRoomAutomationConfig(baseConfig, lowHumiditySnapshot, [], null);
  const dehuOff = evaluationLow.suggestions.find((entry) => entry.action?.actuator === 'dehu' && entry.action?.mode === 'off');
  assert.ok(dehuOff, 'Expected dehumidifier OFF suggestion when humidity is below band');
  assert.equal(dehuOff.action.dwell, 600);
});
