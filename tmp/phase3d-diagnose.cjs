const Datastore = require('../node_modules/nedb-promises');
const jwt = require('../node_modules/jsonwebtoken');

(async () => {
  const ordersPath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/data/wholesale-orders.db';
  const subOrdersPath = '/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/data/wholesale-sub-orders.db';
  const ordersDB = Datastore.create({ filename: ordersPath, autoload: true });
  const subOrdersDB = Datastore.create({ filename: subOrdersPath, autoload: true });
  const buyerId = 'buyer-phase3d-smoke';
  const orderId = `MO-PHASE3D-${Date.now()}`;

  await ordersDB.insert({ master_order_id: orderId, id: orderId, buyer_id: buyerId, status: 'confirmed', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  await subOrdersDB.insert({ sub_order_id: `SO-${orderId}`, master_order_id: orderId, farm_id: 'light-engine-demo', status: 'pending_verification', created_at: new Date().toISOString(), updated_at: new Date().toISOString() });

  const allBuyer = await ordersDB.find({ buyer_id: buyerId });
  const oneOrder = await ordersDB.findOne({ master_order_id: orderId });
  console.log('DB_FILE:' + ordersPath);
  console.log('DB_FIND_BUYER_COUNT:' + allBuyer.length);
  console.log('DB_FIND_ORDER:' + Boolean(oneOrder));

  const token = jwt.sign({ buyerId }, process.env.WHOLESALE_JWT_SECRET || process.env.JWT_SECRET || 'dev-greenreach-wholesale-secret', { expiresIn: '30m' });

  async function call(label, url, auth = true) {
    const res = await fetch(url, { headers: auth ? { authorization: `Bearer ${token}` } : {} });
    const text = await res.text();
    console.log(`${label}_CODE:${res.status}`);
    console.log(`${label}_BODY:${text.slice(0, 300)}`);
  }

  await call('ORDERS', 'http://127.0.0.1:8091/api/wholesale/orders', true);
  await call('ORDER_DETAIL', `http://127.0.0.1:8091/api/wholesale/orders/${orderId}`, false);
  await call('INVOICE', `http://127.0.0.1:8091/api/wholesale/orders/${orderId}/invoice`, true);
  await call('CHECKOUT', `http://127.0.0.1:8091/api/wholesale/checkout/${orderId}`, false);

  await ordersDB.remove({ master_order_id: orderId }, { multi: true });
  await subOrdersDB.remove({ master_order_id: orderId }, { multi: true });
})();
