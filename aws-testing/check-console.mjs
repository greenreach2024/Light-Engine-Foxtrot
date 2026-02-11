import { chromium } from 'playwright';

const base = process.env.LE_BASE_URL || 'http://44.199.244.132:8091';
const url = `${base}/LE-dashboard.html`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const counts = { log: 0, debug: 0, warn: 0, error: 0, info: 0 };
  const samples = [];

  page.on('console', msg => {
    const type = msg.type();
    const text = msg.text();
    counts[type] = (counts[type] || 0) + 1;
    if (samples.length < 50) samples.push({ type, text });
  });

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Click around a bit to trigger component loads
    const nav = await page.$$('.nav-item');
    for (let i = 0; i < Math.min(nav.length, 6); i++) {
      try { await nav[i].click(); await page.waitForTimeout(250); } catch (e) {}
    }
    // let components warm up
    await page.waitForTimeout(2000);

    console.log('Console counts:', counts);
    console.log('Samples:');
    samples.forEach(s => console.log(`[${s.type}] ${s.text}`));

    await browser.close();
  } catch (err) {
    console.error('Error during check:', err.message);
    await browser.close();
    process.exit(2);
  }
})();