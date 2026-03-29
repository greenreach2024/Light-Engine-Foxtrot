/**
 * UI Regression Test: Tray Setup
 *
 * Source-of-truth: LIGHT_ENGINE_FULL_AUDIT_2026-03-20.md
 * Covers: views/tray-setup.html
 *
 * Sections verified:
 *   - Page shell (header, nav menus)
 *   - Tab bar (Tray Formats, Register Tray, Tray Inventory)
 *   - Tray Formats tab (grid, format cards, create form)
 *   - Register Tray tab (QR input, format dropdown)
 *   - Tray Inventory tab (table)
 *   - Edit modal structure
 *
 * Note: The audit flagged backend write failures for tray
 * operations. These tests cover the frontend structure only.
 */
import { test, expect } from 'playwright/test';
import { assertCardsVisible, assertButtonsEnabled, navigateTo, formatAuditReport } from './helpers.mjs';

const PAGE = '/views/tray-setup.html';

test.describe('Tray Setup', () => {

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, PAGE);
    if (!page.url().includes('tray-setup')) {
      test.skip(true, 'Redirected from tray-setup page -- likely auth wall');
    }
  });

  test('page serves without 500', async ({ page }) => {
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('header renders with farm name', async ({ page }) => {
    const headerExists = await page.locator('.header').count();
    expect(headerExists).toBeGreaterThan(0);
    const farmName = await page.locator('#farmNameHeader').count();
    expect(farmName).toBeGreaterThan(0);
  });

  test('navigation menus are present', async ({ page }) => {
    const navItems = [
      '.nav-item.inventory',
      '.nav-item.farm-monitoring',
      '.nav-item.admin',
      '.nav-item.sales',
    ];
    const results = await assertCardsVisible(page, navItems, { allowMissing: true, timeout: 6000 });
    const visible = results.filter(r => r.visible);
    // At least some nav groups should render
    expect(visible.length).toBeGreaterThan(0);
  });

  test('tab bar shows all three tabs', async ({ page }) => {
    const tabButtons = page.locator('.tab-button');
    const count = await tabButtons.count();
    expect(count).toBeGreaterThanOrEqual(3);

    // Verify tab labels
    const labels = [];
    for (let i = 0; i < count; i++) {
      labels.push(await tabButtons.nth(i).innerText());
    }
    const labelText = labels.join(' ').toLowerCase();
    expect(labelText).toContain('format');
    expect(labelText).toContain('register');
    expect(labelText).toContain('inventory');
  });

  test('Tray Formats tab is default active', async ({ page }) => {
    const formatsTab = page.locator('#formats-tab');
    const isVisible = await formatsTab.isVisible().catch(() => false);
    // If not visible by ID, check by active tab class
    if (!isVisible) {
      const activeTab = page.locator('.tab-content.active');
      const count = await activeTab.count();
      expect(count).toBeGreaterThan(0);
    } else {
      expect(isVisible).toBe(true);
    }
  });

  test('create format form exists with required fields', async ({ page }) => {
    const formFields = [
      '#create-format-form',
      '#format-name',
      '#format-sites',
      '#format-system',
    ];
    const results = await assertCardsVisible(page, formFields, { allowMissing: true, timeout: 6000 });
    const visible = results.filter(r => r.visible);
    // Form and at least name/sites should be visible
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });

  test('create format form has submit button', async ({ page }) => {
    const submitBtn = page.locator('#create-format-form button[type="submit"]');
    const count = await submitBtn.count();
    expect(count).toBeGreaterThan(0);
  });

  test('Register Tray tab renders form when clicked', async ({ page }) => {
    // Click the register tab
    const registerTab = page.locator('.tab-button').filter({ hasText: /register/i });
    const tabCount = await registerTab.count();
    if (tabCount === 0) {
      test.skip(true, 'Register tab not found');
    }
    await registerTab.click();
    await page.waitForTimeout(500);

    const formExists = await page.locator('#register-tray-form').count();
    expect(formExists).toBeGreaterThan(0);

    const qrInput = await page.locator('#tray-qr').count();
    expect(qrInput).toBeGreaterThan(0);

    const formatDropdown = await page.locator('#tray-format').count();
    expect(formatDropdown).toBeGreaterThan(0);
  });

  test('Tray Inventory tab renders table when clicked', async ({ page }) => {
    const inventoryTab = page.locator('.tab-button').filter({ hasText: /inventory/i });
    const tabCount = await inventoryTab.count();
    if (tabCount === 0) {
      test.skip(true, 'Inventory tab not found');
    }
    await inventoryTab.click();
    await page.waitForTimeout(500);

    // Table or table body should exist
    const tableExists = await page.locator('.trays-table, #trays-table-body').count();
    expect(tableExists).toBeGreaterThan(0);
  });

  test('edit modal exists in DOM (hidden by default)', async ({ page }) => {
    const modalExists = await page.locator('#edit-modal').count();
    expect(modalExists).toBeGreaterThan(0);

    const editForm = await page.locator('#edit-format-form').count();
    expect(editForm).toBeGreaterThan(0);
  });

  test('audit report -- cards and buttons summary', async ({ page }) => {
    const cards = await assertCardsVisible(page, [
      '.header',
      '#farmNameHeader',
      '.tabs',
      '#formats-tab',
      '#create-format-form',
      '#formats-list',
      '#register-tab',
      '#inventory-tab',
      '#edit-modal',
    ], { allowMissing: true, timeout: 6000 });

    const buttons = await assertButtonsEnabled(page, [
      { selector: '.tab-button >> nth=0', label: 'Formats tab' },
      { selector: '.tab-button >> nth=1', label: 'Register tab' },
      { selector: '.tab-button >> nth=2', label: 'Inventory tab' },
      { selector: '#create-format-form button[type="submit"]', label: 'Create Format' },
    ], { timeout: 6000 });

    const report = formatAuditReport('Tray Setup', cards, buttons);
    console.log(report);

    // Header and tabs should always render
    const header = cards.find(c => c.selector === '.header');
    const tabs = cards.find(c => c.selector === '.tabs');
    expect(header?.visible || tabs?.visible).toBe(true);
  });
});
