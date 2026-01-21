import pg from 'pg';

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

await client.connect();
const res = await client.query(
  'SELECT farm_id, name, status FROM farms WHERE farm_id = $1',
  [FARM_ID]
);
console.log(res.rows);
await client.end();
