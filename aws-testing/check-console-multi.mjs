import { chromium } from 'playwright';

const base = process.env.LE_BASE_URL || 'http://127.0.0.1:8091';
const pages = process.env.LE_PAGES ? process.env.LE_PAGES.split(',') : ['/LE-dashboard.html','/LE-farm-admin.html','/views/farm-summary.html','/views/farm-inventory.html','/views/room-heatmap.html'];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  for (const p of pages) {
    const page = await browser.newPage();
    const counts = { log: 0, debug: 0, warn: 0, error: 0, info: 0 };
    const samples = [];

    page.on('console', msg => {
      const type = msg.type();
      counts[type] = (counts[type] || 0) + 1;
      if (samples.length < 25) samples.push({ type, text: msg.text() });
    });

    try {
      await page.goto(base + p, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      results[p] = { counts, samples };
    } catch (err) {
      results[p] = { error: err.message };
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(JSON.stringify({ base, results }, null, 2));
})();