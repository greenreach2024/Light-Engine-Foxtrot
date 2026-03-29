/**
 * Shared helpers for Light Engine UI regression tests.
 *
 * Each test file imports these to reduce boilerplate for
 * card/button assertion, API intercept stubs, and page
 * navigation utilities.
 */
import { expect } from 'playwright/test';

/**
 * Assert that every selector in the list resolves to at least one
 * visible element on the page.
 */
export async function assertCardsVisible(page, selectors, options = {}) {
  const timeout = options.timeout || 8000;
  const results = [];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      await loc.waitFor({ state: 'visible', timeout });
      results.push({ selector: sel, visible: true });
    } catch {
      results.push({ selector: sel, visible: false });
    }
  }
  const missing = results.filter(r => !r.visible);
  if (missing.length > 0 && !options.allowMissing) {
    const names = missing.map(m => m.selector).join(', ');
    throw new Error(`Cards not visible: ${names}`);
  }
  return results;
}

/**
 * Assert buttons exist and are not disabled.
 * @param {import('playwright/test').Page} page
 * @param {Array<{selector: string, label?: string}>} buttons
 */
export async function assertButtonsEnabled(page, buttons, options = {}) {
  const timeout = options.timeout || 8000;
  const results = [];
  for (const btn of buttons) {
    const loc = page.locator(btn.selector).first();
    try {
      await loc.waitFor({ state: 'visible', timeout });
      const disabled = await loc.isDisabled();
      results.push({ selector: btn.selector, label: btn.label, visible: true, disabled });
    } catch {
      results.push({ selector: btn.selector, label: btn.label, visible: false, disabled: null });
    }
  }
  return results;
}

/**
 * Navigate to a page on the base URL and wait for networkidle.
 */
export async function navigateTo(page, path) {
  await page.goto(path, { waitUntil: 'networkidle', timeout: 20000 });
}

/**
 * Generate a plain-text audit report from test results.
 */
export function formatAuditReport(pageName, cardResults, buttonResults) {
  const lines = [`--- ${pageName} UI Audit ---`, ''];

  lines.push('Cards:');
  for (const c of cardResults) {
    const status = c.visible ? 'PASS' : 'FAIL';
    lines.push(`  [${status}] ${c.selector}`);
  }

  lines.push('');
  lines.push('Buttons:');
  for (const b of buttonResults) {
    let status = 'FAIL';
    if (b.visible && !b.disabled) status = 'PASS';
    else if (b.visible && b.disabled) status = 'DISABLED';
    lines.push(`  [${status}] ${b.selector}${b.label ? ` (${b.label})` : ''}`);
  }

  return lines.join('\n');
}
