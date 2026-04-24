/**
 * Browser-interactive validation: drive the Grow Management zone stepper
 * via real DOM clicks (mimic exactly what the user does) and verify the
 * 3D viewer's data bus and server-side state converge.
 */
import { test, expect } from 'playwright/test';

const BASE = process.env.BASE_URL || 'https://light-engine-1029387937866.us-east1.run.app';
const GM = '/views/grow-management.html';
const ROOM_ID = 'room-3xxjln';

test.describe('Grow Management stepper -- live browser click path', () => {
  test.describe.configure({ mode: 'serial' });

  test('clicking +, Apply grows zones and persists across reload', async ({ page, request }) => {
    // Start from a known state: 2 zones.
    await request.post(BASE + '/api/setup/save-rooms', {
      data: { rooms: [{ id: ROOM_ID, name: 'Main Grow Room', zones: [
        { id: 'zone-1', name: 'Zone 1' },
        { id: 'zone-2', name: 'Zone 2' },
      ] }] },
    });
    await new Promise(r => setTimeout(r, 500));

    await page.goto(BASE + GM, { waitUntil: 'networkidle', timeout: 30000 });
    // Wait for the stepper input to hydrate.
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesCountInput');
      return el && Number(el.value) === 2;
    }, { timeout: 15000 });

    // Click + once to go to 3.
    await page.click('#ffZonesCountPlus');
    await expect(page.locator('#ffZonesCountInput')).toHaveValue('3');

    // Click Apply and wait for the Saved status.
    await page.click('#ffZonesCountApply');
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesCountStatus');
      return el && /Saved/i.test(el.textContent || '');
    }, { timeout: 15000 });

    // Reload the page and confirm the value survived.
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesCountInput');
      return el && Number(el.value) === 3;
    }, { timeout: 15000 });
    const finalVal = await page.locator('#ffZonesCountInput').inputValue();
    expect(Number(finalVal)).toBe(3);

    // Confirm server-side cascade landed on room-map-*.json too.
    const mapRes = await request.get(BASE + `/data/room-map-${ROOM_ID}.json`);
    const map = await mapRes.json();
    expect(map.zones.map(z => z.name)).toEqual(['Zone 1', 'Zone 2', 'Zone 3']);
  });

  test('clicking - then Apply shrinks zones, value does NOT revert', async ({ page, request }) => {
    await page.goto(BASE + GM, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesCountInput');
      return el && Number(el.value) >= 2;
    }, { timeout: 15000 });

    const startVal = Number(await page.locator('#ffZonesCountInput').inputValue());
    await page.click('#ffZonesCountMinus');
    const nextVal = Number(await page.locator('#ffZonesCountInput').inputValue());
    expect(nextVal).toBe(startVal - 1);

    await page.click('#ffZonesCountApply');
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesCountStatus');
      return el && /Saved/i.test(el.textContent || '');
    }, { timeout: 15000 });

    // Wait a beat then read the value -- it MUST NOT snap back (the exact
    // user-reported regression: "dropdown returns to 4 zones").
    await page.waitForTimeout(1500);
    const afterSave = Number(await page.locator('#ffZonesCountInput').inputValue());
    expect(afterSave).toBe(nextVal);

    // Reload and verify persistence.
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction((expected) => {
      const el = document.getElementById('ffZonesCountInput');
      return el && Number(el.value) === expected;
    }, nextVal, { timeout: 15000 });

    // Confirm room-map reflects the shrink.
    const mapRes = await request.get(BASE + `/data/room-map-${ROOM_ID}.json`);
    const map = await mapRes.json();
    expect(map.zones.length).toBe(nextVal);
  });

  test('renderZones shows the saved-count hint (source-of-truth label)', async ({ page }) => {
    await page.goto(BASE + GM, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('ffZonesSource');
      return el && el.textContent && el.textContent.length > 0;
    }, { timeout: 15000 });
    const txt = await page.locator('#ffZonesSource').textContent();
    expect(txt).toMatch(/zone/i);
  });

  test('no uncaught JS errors during stepper interaction', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE + GM, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForFunction(() => !!document.getElementById('ffZonesCountInput'), { timeout: 15000 });
    await page.click('#ffZonesCountPlus');
    await page.click('#ffZonesCountMinus');
    const critical = errors.filter(e =>
      !e.includes('Failed to fetch') && !e.includes('NetworkError') && !e.includes('net::ERR'));
    expect(critical).toEqual([]);
  });

  test.afterAll(async () => {
    // Leave state at 3 zones for next session.
    const pw = await import('playwright/test');
    const ctx = await pw.request.newContext({ baseURL: BASE });
    await ctx.post('/api/setup/save-rooms', {
      data: { rooms: [{ id: ROOM_ID, name: 'Main Grow Room', zones: [
        { id: 'zone-1', name: 'Zone 1' },
        { id: 'zone-2', name: 'Zone 2' },
        { id: 'zone-3', name: 'Zone 3' },
      ] }] },
    }).catch(() => {});
    await ctx.dispose();
  });
});
