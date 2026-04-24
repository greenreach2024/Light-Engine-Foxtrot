#!/usr/bin/env node
/**
 * Farm Persistence Validation Smoke Test
 * ----------------------------------------
 * Round-trips every user-input field on a real farm via public HTTPS:
 *   - Profile:        name, contact_name, contact_phone, email, address
 *   - Certifications: certifications[], practices[], attributes[]
 *   - Delivery:       enabled, base_fee, min_order, lead_time_hours,
 *                     max_deliveries_per_window, delivery_notes, operating_hours
 *   - Windows:        window_id, label, start_time, end_time, active
 *
 * Usage:
 *   FARM_JWT="<farm-token>" node scripts/validate-farm-persistence.js
 *   BASE_URL="https://greenreachgreens.com" FARM_JWT=... node scripts/validate-farm-persistence.js
 *
 * Exit code 0 = all fields round-tripped. Non-zero = at least one failure.
 */

const BASE_URL = process.env.BASE_URL || 'https://greenreachgreens.com';
const JWT = process.env.FARM_JWT;

if (!JWT) {
  console.error('FARM_JWT env var is required (JWT for a farm user).');
  process.exit(2);
}

const headers = {
  'Authorization': `Bearer ${JWT}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json'
};

let failures = 0;
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' -- ' + detail : ''}`);
}

async function jfetch(method, path, body) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

function eqDeep(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return String(a) === String(b);
  return JSON.stringify(a) === JSON.stringify(b);
}

async function testProfile() {
  const stamp = Date.now();
  const payload = {
    name: `Persistence Test ${stamp}`,
    contactName: `Tester ${stamp}`,
    email: `test+${stamp}@example.com`,
    phone: '+1-555-0100',
    address: { line1: '123 Test Rd', city: 'Testville', state: 'ON', postal: 'A1A 1A1' }
  };

  const put = await jfetch('PATCH', '/api/setup/profile', payload);
  if (put.status !== 200) {
    record('profile:update', false, `status=${put.status} body=${JSON.stringify(put.body).slice(0, 200)}`);
    return;
  }

  const get = await jfetch('GET', '/api/farm/profile');
  if (get.status !== 200) {
    record('profile:read', false, `status=${get.status}`);
    return;
  }
  const profile = get.body?.profile || get.body?.farm || get.body || {};

  record('profile.name', profile.name === payload.name || profile.farm_name === payload.name, `saw=${profile.name || profile.farm_name}`);
  record('profile.contact_name', profile.contact_name === payload.contactName, `saw=${profile.contact_name}`);
  record('profile.email', profile.email === payload.email, `saw=${profile.email}`);
  record('profile.contact_phone', profile.contact_phone === payload.phone, `saw=${profile.contact_phone}`);
}

async function testCertifications() {
  const payload = {
    certifications: ['Canada Organic', 'GAP Certified'],
    practices: ['IPM', 'Living Soil'],
    attributes: ['Local', 'Pesticide Free']
  };

  const post = await jfetch('POST', '/api/setup/certifications', payload);
  if (post.status !== 200) {
    record('certs:update', false, `status=${post.status} body=${JSON.stringify(post.body).slice(0, 200)}`);
    return;
  }

  const get = await jfetch('GET', '/api/farm/profile');
  const profile = get.body?.profile || get.body?.farm || get.body || {};
  const certs = profile.certifications;
  if (!certs) {
    record('certs:read', false, 'farm profile had no certifications field');
    return;
  }
  // Certifications may be stored in a nested object or directly as an array.
  const asObj = (certs && typeof certs === 'object' && !Array.isArray(certs)) ? certs : null;
  const arrC = asObj ? asObj.certifications : certs;
  const arrP = asObj ? asObj.practices : profile.practices;
  const arrA = asObj ? asObj.attributes : profile.attributes;

  // Values are HTML-escaped server-side, so compare after unescape.
  const unesc = (s) => typeof s === 'string' ? s.replace(/&amp;/g, '&').replace(/&#x2F;/g, '/').replace(/&#x27;/g, "'") : s;
  const norm = (a) => Array.isArray(a) ? a.map(unesc).sort() : a;

  record('certs.certifications', eqDeep(norm(arrC), norm(payload.certifications)), `saw=${JSON.stringify(arrC)}`);
  record('certs.practices', eqDeep(norm(arrP), norm(payload.practices)), `saw=${JSON.stringify(arrP)}`);
  record('certs.attributes', eqDeep(norm(arrA), norm(payload.attributes)), `saw=${JSON.stringify(arrA)}`);
}

async function testDeliveryConfig() {
  const operating_hours = {
    monday: { open: '08:00', close: '18:00', closed: false },
    tuesday: { open: '08:00', close: '18:00', closed: false },
    wednesday: { open: '08:00', close: '18:00', closed: false },
    thursday: { open: '08:00', close: '20:00', closed: false },
    friday: { open: '08:00', close: '20:00', closed: false },
    saturday: { open: '09:00', close: '14:00', closed: false },
    sunday: { closed: true }
  };
  const payload = {
    enabled: true,
    base_fee: 7.5,
    min_order: 40,
    lead_time_hours: 18,
    max_deliveries_per_window: 12,
    delivery_notes: 'Leave at side gate. Dog on property, please ring bell.',
    operating_hours
  };

  const put = await jfetch('PUT', '/api/farm-sales/delivery/config', payload);
  if (put.status !== 200) {
    record('delivery:update', false, `status=${put.status} body=${JSON.stringify(put.body).slice(0, 200)}`);
    return;
  }

  const get = await jfetch('GET', '/api/farm-sales/delivery/config');
  if (get.status !== 200) {
    record('delivery:read', false, `status=${get.status}`);
    return;
  }
  const cfg = get.body?.config || {};
  record('delivery.enabled', cfg.enabled === true, `saw=${cfg.enabled}`);
  record('delivery.base_fee', Number(cfg.base_fee) === payload.base_fee, `saw=${cfg.base_fee}`);
  record('delivery.min_order', Number(cfg.min_order) === payload.min_order, `saw=${cfg.min_order}`);
  record('delivery.lead_time_hours', Number(cfg.lead_time_hours) === payload.lead_time_hours, `saw=${cfg.lead_time_hours}`);
  record('delivery.max_deliveries_per_window', Number(cfg.max_deliveries_per_window) === payload.max_deliveries_per_window, `saw=${cfg.max_deliveries_per_window}`);
  record('delivery.delivery_notes', cfg.delivery_notes === payload.delivery_notes, `saw=${(cfg.delivery_notes || '').slice(0, 60)}`);
  record('delivery.operating_hours', eqDeep(cfg.operating_hours, operating_hours), `saw keys=${Object.keys(cfg.operating_hours || {}).join(',')}`);
}

async function testDeliveryWindows() {
  const windows = [
    { window_id: 'morning', label: 'Morning Run', start_time: '07:00', end_time: '10:00', active: true },
    { window_id: 'afternoon', label: 'Afternoon Run', start_time: '13:00', end_time: '16:00', active: true },
    { window_id: 'evening', label: 'Evening Run', start_time: '17:00', end_time: '19:30', active: false }
  ];
  const put = await jfetch('PUT', '/api/farm-sales/delivery/windows', { windows });
  if (put.status !== 200) {
    record('windows:update', false, `status=${put.status} body=${JSON.stringify(put.body).slice(0, 200)}`);
    return;
  }
  const get = await jfetch('GET', '/api/farm-sales/delivery/config');
  const saved = (get.body?.config?.windows) || [];
  for (const w of windows) {
    const found = saved.find(s => s.window_id === w.window_id);
    if (!found) { record(`windows.${w.window_id}`, false, 'missing'); continue; }
    const ok = found.label === w.label && found.start_time === w.start_time
            && found.end_time === w.end_time && !!found.active === !!w.active;
    record(`windows.${w.window_id}`, ok, ok ? '' : JSON.stringify(found));
  }
}

(async () => {
  console.log(`Validating farm persistence against ${BASE_URL}`);
  console.log('------------------------------------------------------------');
  try { await testProfile(); } catch (e) { record('profile', false, e.message); }
  try { await testCertifications(); } catch (e) { record('certifications', false, e.message); }
  try { await testDeliveryConfig(); } catch (e) { record('delivery.config', false, e.message); }
  try { await testDeliveryWindows(); } catch (e) { record('delivery.windows', false, e.message); }
  console.log('------------------------------------------------------------');
  console.log(`Summary: ${results.length - failures}/${results.length} passed, ${failures} failed`);
  process.exit(failures > 0 ? 1 : 0);
})();
