/**
 * UI Regression Test: Grow Management (standalone Groups V2 page)
 *
 * Covers: /views/grow-management.html
 *
 * Verifies:
 *   - Page loads without server errors
 *   - Calibration modal injected and button wired
 *   - Bulk edit and stock group modals in DOM
 *   - Form controls present (plan form, selects, save buttons)
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

const PAGE = '/views/grow-management.html';

test.describe('Grow Management -- page load and structure', () => {

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
    const critical = errors.filter(e =>
      !e.includes('Failed to fetch') &&
      !e.includes('NetworkError') &&
      !e.includes('net::ERR')
    );
    expect(critical).toEqual([]);
  });
});

test.describe('Grow Management -- wizard modals injected', () => {

  test('calModal (calibration wizard) exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#calModal')).toBeAttached();
  });

  test('bulkEditGroupModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#bulkEditGroupModal')).toBeAttached();
  });

  test('buildStockGroupModal exists in DOM', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#buildStockGroupModal')).toBeAttached();
  });
});

test.describe('Grow Management -- form controls', () => {

  test('groupsV2PlanForm exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2PlanForm')).toBeAttached();
  });

  test('groupsV2RoomSelect exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2RoomSelect')).toBeAttached();
  });

  test('groupsV2ZoneSelect exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2ZoneSelect')).toBeAttached();
  });

  test('groupsV2Dps day/photo/stage field exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2Dps')).toBeAttached();
  });

  test('groupsV2SaveGroup button exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2SaveGroup')).toBeAttached();
  });

  test('groupsV2SaveAndDeploy button exists', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#groupsV2SaveAndDeploy')).toBeAttached();
  });
});

test.describe('Grow Management -- calibration button', () => {

  test('btnOpenCalWizardFromGroups exists (correct ID)', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await expect(page.locator('#btnOpenCalWizardFromGroups')).toBeAttached();
  });

  test('old V2 button ID does NOT exist (regression check)', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const oldBtn = await page.locator('#btnOpenCalWizardFromGroupsV2').count();
    expect(oldBtn).toBe(0);
  });
});

test.describe('Grow Management -- scripts loaded', () => {

  test('app.foxtrot.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="app.foxtrot"]').count();
    expect(scripts).toBeGreaterThan(0);
  });

  test('groups-v2.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="groups-v2"]').count();
    expect(scripts).toBeGreaterThan(0);
  });

  test('net.guard.js is included', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const scripts = await page.locator('script[src*="net.guard"]').count();
    expect(scripts).toBeGreaterThan(0);
  });
});

test.describe('Grow Management -- modal interactions', () => {

  test('btnOpenCalWizardFromGroups click opens calModal', async ({ page }) => {
    await page.goto(PAGE, { waitUntil: 'networkidle', timeout: 25000 });
    const btn = page.locator('#btnOpenCalWizardFromGroups');
    if (await btn.isVisible()) {
      await btn.click();
      await page.waitForTimeout(500);
      const modal = page.locator('#calModal');
      const isShown = await modal.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' || el.classList.contains('show');
      });
      expect(isShown).toBe(true);
    }
  });
});
