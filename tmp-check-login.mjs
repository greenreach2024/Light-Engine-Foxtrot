import pg from 'pg';
import bcrypt from 'bcrypt';

const { Client } = pg;
const client = new Client({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  ssl: { rejectUnauthorized: false }
});

const FARM_ID = 'FARM-MKLOMAT3-A9D8';
const EMAIL = 'shelbygilbert@rogers.com';
const PASSWORD = 'ReTerminal2026!';

await client.connect();
const res = await client.query(
  'SELECT user_id, email, farm_id, password_hash FROM users WHERE email = $1 AND farm_id = $2',
  [EMAIL, FARM_ID]
);
console.log(res.rows);
if (res.rows[0]?.password_hash) {
  const ok = await bcrypt.compare(PASSWORD, res.rows[0].password_hash);
  console.log('bcrypt.compare:', ok);
}
await client.end();
