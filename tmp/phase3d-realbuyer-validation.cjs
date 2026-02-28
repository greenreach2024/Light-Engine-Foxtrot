const { spawn } = require('child_process');
const Datastore = require('../node_modules/nedb-promises');

const ROOT = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot';
const ORDER_DB = `${ROOT}/data/wholesale-orders.db`;
const SUB_DB = `${ROOT}/data/wholesale-sub-orders.db`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

(async () => {
  const ordersDB = Datastore.create({ filename: ORDER_DB, autoload: true });
  const subOrdersDB = Datastore.create({ filename: SUB_DB, autoload: true });

  const server = spawn('node', ['server-foxtrot.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '8091', CTRL: 'DISABLED' },
    stdio: ['ignore', 'ignore', 'ignore']
  });

  let orderId = null;

  try {
    await sleep(4500);

    const email = `phase3d.${Date.now()}@local.test`;
    const register = await fetchJson('http://127.0.0.1:8091/api/wholesale/buyers/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        businessName: 'Phase3D Test Buyer',
        contactName: 'Phase3D Buyer',
        email,
        password: 'test1234',
        buyerType: 'restaurant',
        location: { zip: '12345', state: 'NY', lat: 40.73, lng: -73.93 }
      })
    });

    const token = register.json?.data?.token || null;
    const tokenPayload = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) : {};
    const buyerId = String(tokenPayload?.buyerId || tokenPayload?.sub || register.json?.data?.buyer?.id || '');

    orderId = `MO-PHASE3D-${Date.now()}`;
    await ordersDB.insert({
      master_order_id: orderId,
      id: orderId,
      buyer_id: buyerId,
      status: 'confirmed',
      totals: { subtotal: 12.5, tax: 0, total: 12.5 },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    await subOrdersDB.insert({
      sub_order_id: `SO-${orderId}-light-engine-demo`,
      master_order_id: orderId,
      farm_id: 'light-engine-demo',
      farm_name: 'Light Engine Demo Farm',
      status: 'pending_verification',
      line_items: [{ sku_id: 'SKU-AUDIT-GENOVESE-BASIL-5LB', quantity: 1, unit: 'case' }],
      total: 12.5,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });

    const orders = await fetchJson('http://127.0.0.1:8091/api/wholesale/orders', {
      headers: { authorization: `Bearer ${token}` }
    });
    const invoice = await fetchJson(`http://127.0.0.1:8091/api/wholesale/orders/${orderId}/invoice`, {
      headers: { authorization: `Bearer ${token}` }
    });
    const checkout = await fetchJson(`http://127.0.0.1:8091/api/wholesale/checkout/${orderId}`);

    console.log(`REGISTER_CODE:${register.status}`);
    console.log(`BUYER_ID:${buyerId}`);
    console.log(`SEEDED_ORDER:${orderId}`);
    console.log(`ORDERS_CODE:${orders.status}`);
    console.log(`ORDERS_BODY:${orders.text}`);
    console.log(`INVOICE_CODE:${invoice.status}`);
    console.log(`INVOICE_BODY:${invoice.text}`);
    console.log(`CHECKOUT_CODE:${checkout.status}`);
    console.log(`CHECKOUT_BODY:${checkout.text}`);
  } finally {
    server.kill('SIGTERM');
    await sleep(1200);
    if (orderId) {
      await ordersDB.remove({ master_order_id: orderId }, { multi: true });
      await subOrdersDB.remove({ master_order_id: orderId }, { multi: true });
    }
    console.log('CLEANUP_DONE');
  }
})().catch((error) => {
  console.error('PHASE3D_REALBUYER_ERR', error.message);
  process.exit(1);
});
