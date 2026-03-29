/**
 * Playwright configuration for Light Engine UI regression tests.
 * Targets the live Central instance at greenreachgreens.com.
 * Override with BASE_URL env var for local testing.
 */
import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: './tests/ui',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  retries: 1,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'test-results/html' }]],
  use: {
    baseURL: process.env.BASE_URL || 'https://greenreachgreens.com',
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
