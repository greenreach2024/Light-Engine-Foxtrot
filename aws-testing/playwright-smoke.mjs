import { chromium } from 'playwright';

const baseUrl = process.env.LE_BASE_URL || 'http://52.90.57.85:8091';
const farmId = process.env.LE_FARM_ID || '';
const password = process.env.LE_PASSWORD || '';
const email = process.env.LE_EMAIL || '';

const pagesToCheck = [
  '/login.html',
  '/farm-admin-login.html',
  '/LE-farm-admin.html',
  '/LE-dashboard.html',
  '/views/farm-summary.html'
];

const startUrl = `${baseUrl}/farm-admin-login.html`;
const adminUrl = `${baseUrl}/LE-farm-admin.html`;

const results = [];
let hadFailure = false;

function logResult(type, message, meta = {}) {
  results.push({ type, message, ...meta });
  const extra = meta.details ? ` | ${meta.details}` : '';
  console.log(`[${type}] ${message}${extra}`);
}

function pagePath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

async function checkStatus(page, path) {
  const target = `${baseUrl}${path}`;
  const response = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const status = response ? response.status() : 0;
  const ok = status >= 200 && status < 400;
  if (!ok) {
    hadFailure = true;
    logResult('FAIL', `Page status ${status}`, { details: target });
  } else {
    logResult('OK', `Page status ${status}`, { details: target });
  }
}

async function tryLogin(page) {
  if (!farmId || !password) {
    logResult('WARN', 'Skipping login (missing LE_FARM_ID or LE_PASSWORD).');
    return false;
  }

  await page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

  await page.fill('#farmId', farmId);
  if (email) {
    const emailField = await page.$('#email');
    if (emailField) {
      await page.fill('#email', email);
    }
  }
  await page.fill('#password', password);

  await page.click('#loginBtn');

  const navigation = await Promise.race([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 })
      .then(() => 'navigated')
      .catch(() => 'closed'),
    page.waitForTimeout(10000).then(() => 'timeout')
  ]);

  const current = page.url();
  if (pagePath(current).includes('farm-admin-login')) {
    const alertText = await page.evaluate(() => {
      const alert = document.getElementById('alert');
      return alert && alert.style.display !== 'none' ? alert.textContent.trim() : '';
    });
    logResult('WARN', `Login stayed on login page (${navigation})`, {
      details: alertText || current
    });
    return false;
  }

  logResult('OK', 'Login redirect landed off login page', { details: current });
  return true;
}

async function apiLogin() {
  if (!farmId || !password) return null;

  try {
    const response = await fetch(`${baseUrl}/api/farm/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ farmId, email, password })
    });
    const data = await response.json();
    if (data && data.token) {
      return {
        token: data.token,
        farmId: data.farmId || farmId,
        farmName: data.farmName || 'Light Engine Farm',
        email: data.email || email
      };
    }
    logResult('WARN', 'API login failed', { details: JSON.stringify(data) });
  } catch (error) {
    logResult('WARN', 'API login error', { details: error.message });
  }

  return null;
}

async function seedSession(page, session) {
  await page.evaluate((payload) => {
    try {
      sessionStorage.setItem('token', payload.token);
      sessionStorage.setItem('farm_id', payload.farmId);
      if (payload.farmName) sessionStorage.setItem('farm_name', payload.farmName);
      if (payload.email) sessionStorage.setItem('email', payload.email);
    } catch (error) {
      console.warn('sessionStorage unavailable:', error);
    }
    try {
      localStorage.setItem('token', payload.token);
      localStorage.setItem('farm_id', payload.farmId);
      if (payload.farmName) localStorage.setItem('farm_name', payload.farmName);
      if (payload.email) localStorage.setItem('email', payload.email);
    } catch (error) {
      console.warn('localStorage unavailable:', error);
    }
  }, session);
}

async function clickNavButtons(page) {
  const navItems = await page.$$('.nav-item');
  if (!navItems.length) {
    logResult('WARN', 'No .nav-item elements found to click.');
    return;
  }

  const maxClicks = Math.min(navItems.length, 6);
  for (let i = 0; i < maxClicks; i += 1) {
    const item = navItems[i];
    try {
      const label = (await item.innerText()).trim() || `nav-item-${i + 1}`;
      await item.click();
      await page.waitForTimeout(300);
      const current = page.url();
      if (pagePath(current).includes('farm-admin-login')) {
        hadFailure = true;
        logResult('FAIL', `Nav click redirected to login: ${label}`);
        return;
      }
      logResult('OK', `Clicked nav item: ${label}`);
    } catch (error) {
      hadFailure = true;
      logResult('FAIL', `Nav click failed at index ${i + 1}`, { details: error.message });
    }
  }
}

async function checkSetupRedirect(page) {
  await page.goto(adminUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const finalUrl = page.url();
  if (pagePath(finalUrl).includes('farm-admin-login')) {
    hadFailure = true;
    logResult('FAIL', 'Admin page redirected to login', { details: finalUrl });
  } else {
    logResult('OK', 'Admin page stayed on admin UI', { details: finalUrl });
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('framenavigated', (frame) => {
  if (frame === page.mainFrame()) {
    const url = frame.url();
    if (pagePath(url).includes('farm-admin-login')) {
      logResult('INFO', 'Navigation hit login page', { details: url });
    }
  }
});

try {
  for (const path of pagesToCheck) {
    await checkStatus(page, path);
  }

  const loggedIn = await tryLogin(page);
  if (loggedIn) {
    await checkSetupRedirect(page);
    await clickNavButtons(page);
  } else {
    const session = await apiLogin();
    if (session) {
      await page.goto(`${baseUrl}/farm-admin-login.html`, { waitUntil: 'domcontentloaded' });
      await seedSession(page, session);
      await checkSetupRedirect(page);
      await clickNavButtons(page);
    } else {
      hadFailure = true;
      logResult('FAIL', 'Could not authenticate via UI or API.');
    }
  }
} catch (error) {
  hadFailure = true;
  logResult('FAIL', 'Unhandled error', { details: error.message });
} finally {
  await browser.close();
}

if (hadFailure) {
  process.exit(1);
}
