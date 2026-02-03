const { Pool } = require('pg');

const pool = new Pool({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name ILIKE '%farm%' ORDER BY table_name"
  );
  console.log('Tables:', tables.rows.map(r => r.table_name));

  const constraints = await pool.query(
    "SELECT conname, conrelid::regclass AS table, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid::regclass::text = 'farms' ORDER BY conname"
  );
  console.log('Constraints:', constraints.rows);

  const fks = await pool.query(
    "SELECT conname, conrelid::regclass AS table, confrelid::regclass AS ref_table, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid::regclass::text = 'farms' AND contype='f'"
  );
  console.log('FKs:', fks.rows);

  await pool.end();
})();
