const { spawn } = require('child_process');
const Datastore = require('../node_modules/nedb-promises');
const jwt = require('../node_modules/jsonwebtoken');

const ROOT = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot';
const ORDER_DB = `${ROOT}/data/wholesale-orders.db`;
const SUB_DB = `${ROOT}/data/wholesale-sub-orders.db`;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  return { status: res.status, text };
}

(async () => {
  const ordersDB = Datastore.create({ filename: ORDER_DB, autoload: true });
  const subOrdersDB = Datastore.create({ filename: SUB_DB, autoload: true });

  const buyerId = 'buyer-phase3d-smoke';
  const orderId = `MO-PHASE3D-${Date.now()}`;

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

  const token = jwt.sign({ buyerId }, process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret', { expiresIn: '30m' });

  const server = spawn('node', ['server-foxtrot.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '8091', CTRL: 'DISABLED' },
    stdio: ['ignore', 'ignore', 'ignore']
  });

  try {
    await sleep(4000);

    const orders = await fetchText('http://127.0.0.1:8091/api/wholesale/orders', {
      authorization: `Bearer ${token}`
    });
    const ordersNoAuth = await fetchText('http://127.0.0.1:8091/api/wholesale/orders');
    const invoice = await fetchText(`http://127.0.0.1:8091/api/wholesale/orders/${orderId}/invoice`, {
      authorization: `Bearer ${token}`
    });
    const checkout = await fetchText(`http://127.0.0.1:8091/api/wholesale/checkout/${orderId}`);

    console.log(`SEEDED_ORDER:${orderId}`);
    console.log(`ORDERS_CODE:${orders.status}`);
    console.log(`ORDERS_LEN:${orders.text.length}`);
    console.log(`ORDERS_BODY:${orders.text}`);
    console.log(`ORDERS_NOAUTH_CODE:${ordersNoAuth.status}`);
    console.log(`ORDERS_NOAUTH_BODY:${ordersNoAuth.text}`);
    console.log(`INVOICE_CODE:${invoice.status}`);
    console.log(`INVOICE_LEN:${invoice.text.length}`);
    console.log(`INVOICE_BODY:${invoice.text}`);
    console.log(`CHECKOUT_CODE:${checkout.status}`);
    console.log(`CHECKOUT_LEN:${checkout.text.length}`);
    console.log(`CHECKOUT_BODY:${checkout.text}`);
  } finally {
    server.kill('SIGTERM');
    await sleep(1200);
    await ordersDB.remove({ master_order_id: orderId }, { multi: true });
    await subOrdersDB.remove({ master_order_id: orderId }, { multi: true });
    console.log('CLEANUP_DONE');
  }
})().catch((error) => {
  console.error('PHASE3D_VALIDATION_ERR', error.message);
  process.exit(1);
});
