const Datastore = require('../node_modules/nedb-promises');
const jwt = require('../node_modules/jsonwebtoken');

(async () => {
  const ordersDB = Datastore.create({ filename: '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/data/wholesale-orders.db', autoload: true });
  const subOrdersDB = Datastore.create({ filename: '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/data/wholesale-sub-orders.db', autoload: true });
  const buyerId = 'buyer-phase3d-smoke';
  const orderId = `MO-PHASE3D-${Date.now()}`;
  const subOrderId = `SO-${orderId}-light-engine-demo`;

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
    sub_order_id: subOrderId,
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

  async function call(label, url, auth = true) {
    const res = await fetch(url, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    console.log(`${label}_CODE:${res.status}`);
    console.log(`${label}_BODY:${text.slice(0, 280)}`);
  }

  console.log(`SEEDED_ORDER:${orderId}`);
  await call('ORDERS', 'http://127.0.0.1:8091/api/wholesale/orders', true);
  await call('INVOICE', `http://127.0.0.1:8091/api/wholesale/orders/${orderId}/invoice`, true);
  await call('CHECKOUT', `http://127.0.0.1:8091/api/wholesale/checkout/${orderId}`, false);

  await ordersDB.remove({ master_order_id: orderId }, { multi: true });
  await subOrdersDB.remove({ master_order_id: orderId }, { multi: true });
  console.log('CLEANUP_DONE');
})().catch((error) => {
  console.error('SMOKE_ERR', error.message);
  process.exit(1);
});
