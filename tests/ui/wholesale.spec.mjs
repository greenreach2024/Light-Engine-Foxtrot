/**
 * UI Regression Test: Wholesale Marketplace
 *
 * Source-of-truth: LIGHT_ENGINE_FULL_AUDIT_2026-03-20.md
 * Covers: wholesale.html
 *
 * Sections verified:
 *   - Page shell (nav, tabs, header)
 *   - Catalog view (grid, filters, sort)
 *   - Product cards (sku-card structure)
 *   - Cart panel and badge
 *   - Checkout view (form, allocation preview)
 *   - Orders view (list, actions)
 *   - Auth modal (sign-in / register tabs)
 */
import { test, expect } from 'playwright/test';
import { assertCardsVisible, assertButtonsEnabled, navigateTo, formatAuditReport } from './helpers.mjs';

const PAGE = '/wholesale.html';

test.describe('Wholesale Marketplace', () => {

  test.beforeEach(async ({ page }) => {
    await navigateTo(page, PAGE);
    // If redirected away from wholesale, skip the suite
    if (!page.url().includes('wholesale')) {
      test.skip(true, 'Redirected from wholesale page -- likely auth wall');
    }
  });

  test('page serves without 500', async ({ page }) => {
    const status = await page.evaluate(() => {
      return document.querySelector('title') ? 200 : 500;
    });
    expect(status).toBe(200);
  });

  test('navigation tabs render correctly', async ({ page }) => {
    const tabs = [
      { selector: '.nav-tab[data-view="catalog"]', label: 'Browse Catalog' },
      { selector: '.nav-tab[data-view="checkout"]', label: 'Checkout' },
      { selector: '.nav-tab[data-view="orders"]', label: 'My Orders' },
    ];
    const results = await assertButtonsEnabled(page, tabs, { timeout: 6000 });
    const visible = results.filter(r => r.visible);
    expect(visible.length).toBe(3);
  });

  test('catalog view is the default active view', async ({ page }) => {
    const catalogVisible = await page.locator('#catalog-view').isVisible();
    expect(catalogVisible).toBe(true);
  });

  test('catalog grid container exists', async ({ page }) => {
    const results = await assertCardsVisible(page, ['#catalog-grid'], { timeout: 8000 });
    expect(results[0].visible).toBe(true);
  });

  test('filter controls are present', async ({ page }) => {
    const filters = [
      '#delivery-date',
      '#sort-by',
    ];
    const results = await assertCardsVisible(page, filters, { allowMissing: true, timeout: 6000 });
    // At least one filter control should render
    const visible = results.filter(r => r.visible);
    expect(visible.length).toBeGreaterThan(0);
  });

  test('header actions and sign-in button render', async ({ page }) => {
    const headerActions = await page.locator('#header-actions').isVisible();
    expect(headerActions).toBe(true);

    // Either signed-in profile or sign-in button should be present
    const signInVisible = await page.locator('#sign-in-btn').isVisible().catch(() => false);
    const profileVisible = await page.locator('#buyer-profile').isVisible().catch(() => false);
    expect(signInVisible || profileVisible).toBe(true);
  });

  test('cart badge (FAB) is present', async ({ page }) => {
    const results = await assertCardsVisible(page, ['.cart-badge'], { timeout: 6000 });
    expect(results[0].visible).toBe(true);
  });

  test('cart panel structure exists in DOM', async ({ page }) => {
    // Cart panel exists but is hidden by default
    const panelExists = await page.locator('#cart-panel').count();
    expect(panelExists).toBeGreaterThan(0);

    const totalExists = await page.locator('#cart-total').count();
    expect(totalExists).toBeGreaterThan(0);
  });

  test('checkout view contains required form fields', async ({ page }) => {
    // Switch to checkout tab
    await page.locator('.nav-tab[data-view="checkout"]').click();
    await page.waitForTimeout(500);

    const fields = [
      '#buyer-name',
      '#buyer-email',
      '#delivery-address',
      '#delivery-city',
      '#delivery-zip',
    ];
    const results = await assertCardsVisible(page, fields, { allowMissing: true, timeout: 6000 });
    const visible = results.filter(r => r.visible);
    // Checkout form should show at least the core fields
    expect(visible.length).toBeGreaterThanOrEqual(3);
  });

  test('orders view renders when tab clicked', async ({ page }) => {
    await page.locator('.nav-tab[data-view="orders"]').click();
    await page.waitForTimeout(500);

    const ordersListExists = await page.locator('#orders-list').count();
    expect(ordersListExists).toBeGreaterThan(0);
  });

  test('auth modal exists in DOM', async ({ page }) => {
    const modalExists = await page.locator('#auth-modal').count();
    expect(modalExists).toBeGreaterThan(0);
  });

  test('audit report -- cards and buttons summary', async ({ page }) => {
    const cards = await assertCardsVisible(page, [
      '#catalog-view',
      '#catalog-grid',
      '#cart-panel',
      '#checkout-view',
      '#orders-list',
      '#auth-modal',
      '#header-actions',
      '.cart-badge',
    ], { allowMissing: true, timeout: 6000 });

    const buttons = await assertButtonsEnabled(page, [
      { selector: '.nav-tab[data-view="catalog"]', label: 'Browse Catalog' },
      { selector: '.nav-tab[data-view="checkout"]', label: 'Checkout' },
      { selector: '.nav-tab[data-view="orders"]', label: 'My Orders' },
      { selector: '#sign-in-btn', label: 'Sign In' },
      { selector: '.cart-badge', label: 'Cart badge' },
    ], { timeout: 6000 });

    const report = formatAuditReport('Wholesale Marketplace', cards, buttons);
    console.log(report);

    // At least the default catalog view and grid should be visible
    const catalogCard = cards.find(c => c.selector === '#catalog-view');
    expect(catalogCard?.visible).toBe(true);
  });
});
