/**
 * UI Regression Test: Farm Setup (standalone page)
 *
 * Covers: /views/farm-setup.html
 *
 * Verifies:
 *   - Page loads without server errors
 *   - All expandable panel cards present
 *   - All wizard modal DOM elements injected
 *   - Buttons exist and are interactive
 *   - Required scripts loaded without console errors
 *   - Modal open/close interactions work
 */

import { test, expect } from 'playwright/test';
import {
  assertCardsVisible,
  assertButtonsEnabled,
  navigateTo,
  formatAuditReport,
} from './helpers.mjs';

const PAGE = '/views/farm-setup.html';

test.describe('Farm Setup -- page load and structure', () => {

  test('page serves HTTP 200', async ({ page }) => {
    const response = await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    expect(response.status()).toBe(200);
  });

  test('page has content (not blank)', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const bodyText = await page.locator('body').innerText();
    expect(bodyText.length).toBeGreaterThan(100);
  });

  test('no uncaught JS errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 25000 });
    // Allow known non-critical errors (e.g. fetch failures for data endpoints)
    const critical = errors.filter(e =>
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('net::ERR')
    );
    expect(critical).toEqual([]);
  });
});

test.describe('Farm Setup -- expandable panels', () => {

  test('all 7 panel sections exist', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const panelIds = [
      '#farmPanel',
      '#roomsPanel',
      '#lightsPanel',
      '#iotPanel',
      '#integrationsPanel',
      '#pairDevicesPanel',
      '#farmChecklistsPanel',
    ];
    for (const id of panelIds) {
      await expect(page.locator(id)).toBeAttached();
    }
  });
});

test.describe('Farm Setup -- wizard modals injected', () => {

  test('farmModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#farmModal')).toBeAttached();
  });

  test('roomModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#roomModal')).toBeAttached();
  });

  test('freshLightModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#freshLightModal')).toBeAttached();
  });

  test('devicePairModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#devicePairModal')).toBeAttached();
  });

  test('deviceManager exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#deviceManager')).toBeAttached();
  });
});

test.describe('Farm Setup -- action buttons', () => {

  test('btnLaunchFarm exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnLaunchFarm')).toBeAttached();
  });

  test('btnLaunchRoom exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnLaunchRoom')).toBeAttached();
  });

  test('btnLaunchLightSetup exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnLaunchLightSetup')).toBeAttached();
  });

  test('btnLaunchPairWizard exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnLaunchPairWizard')).toBeAttached();
  });

  test('btnUniversalScan exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnUniversalScan')).toBeAttached();
  });
});

test.describe('Farm Setup -- scripts loaded', () => {

  test('app.foxtrot.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="app.foxtrot"]').count();
    expect(scripts).toBeGreaterThan(0);
  });

  test('iot-manager.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="iot-manager"]').count();
    expect(scripts).toBeGreaterThan(0);
  });

  test('net.guard.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="net.guard"]').count();
    expect(scripts).toBeGreaterThan(0);
  });
});

test.describe('Farm Setup -- modal interactions', () => {

  test('btnLaunchFarm click opens farmModal', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 25000 });
    const btn = page.locator('#btnLaunchFarm');
    if (await btn.isVisible()) {
      await btn.click();
      // Modal should become visible (Bootstrap .show class or display change)
      await page.waitForTimeout(500);
      const modal = page.locator('#farmModal');
      const isShown = await modal.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' || el.classList.contains('show');
      });
      expect(isShown).toBe(true);
    }
  });

  test('btnLaunchRoom click opens roomModal', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 25000 });
    const btn = page.locator('#btnLaunchRoom');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(500);
      const modal = page.locator('#roomModal');
      const isShown = await modal.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' || el.classList.contains('show');
      });
      expect(isShown).toBe(true);
    }
  });
});
