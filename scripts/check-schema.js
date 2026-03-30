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

async function checkSchema() {
  await client.connect();
  
  const result = await client.query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'users' 
    ORDER BY ordinal_position
  `);
  
  console.log('Users table columns:');
  result.rows.forEach(r => console.log(`  ${r.column_name} (${r.data_type})`));
  
  const userResult = await client.query(`SELECT * FROM users WHERE email = 'shelbygilbert@rogers.com' LIMIT 1`);
  console.log('\nUser record:', userResult.rows[0]);
  
  await client.end();
}

checkSchema().catch(console.error);
