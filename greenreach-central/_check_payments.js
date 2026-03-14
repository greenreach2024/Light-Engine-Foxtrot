const { Pool } = require("pg");
const pool = new Pool({ connectionString: "postgresql://postgres:Fk7B2mN9dR4xQ1pL@light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com:5432/lightengine" });
(async () => {
  try {
    const r = await pool.query("SELECT * FROM payment_records WHERE payment_id = 'purchase_a2e67df8eb1a4857'");
    console.log("PAYMENT_RECORD:", JSON.stringify(r.rows, null, 2));
    if (r.rows.length && r.rows[0].order_id) {
      const s = await pool.query("SELECT * FROM checkout_sessions WHERE session_id = '" + r.rows[0].order_id + "'");
      console.log("CHECKOUT_SESSION:", JSON.stringify(s.rows, null, 2));
    }
    const all = await pool.query("SELECT payment_id, order_id, amount, currency, provider, status, created_at FROM payment_records ORDER BY created_at");
    console.log("ALL_PAYMENTS:", JSON.stringify(all.rows, null, 2));
  } catch(e) { console.error(e.message); }
  pool.end();
})();
