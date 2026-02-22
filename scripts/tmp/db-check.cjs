const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5432, database: 'greenreach_central', user: 'postgres' });

(async () => {
  // Check farms
  const farms = await pool.query('SELECT farm_id, name, status FROM farms');
  console.log('=== FARMS ===');
  farms.rows.forEach(r => console.log(' ', r.farm_id, '|', r.name, '|', r.status));

  // Check farm_users
  const users = await pool.query('SELECT id, farm_id, email, role, status FROM farm_users');
  console.log('\n=== FARM_USERS ===');
  if (users.rows.length === 0) console.log('  (empty)');
  users.rows.forEach(r => console.log(' ', r.id, '|', r.farm_id, '|', r.email, '|', r.role, '|', r.status));

  // Check farm_data
  const data = await pool.query("SELECT farm_id, data_type, LENGTH(data::text) as data_size FROM farm_data ORDER BY farm_id, data_type");
  console.log('\n=== FARM_DATA ===');
  if (data.rows.length === 0) console.log('  (empty)');
  data.rows.forEach(r => console.log(' ', r.farm_id, '|', r.data_type, '|', r.data_size, 'bytes'));

  // Check what data exists for the farm in question
  const notable = await pool.query("SELECT data_type, jsonb_typeof(data) as dtype, CASE WHEN jsonb_typeof(data) = 'array' THEN jsonb_array_length(data) ELSE -1 END as arr_len FROM farm_data WHERE farm_id = 'FARM-MLTP9LVH-B0B85039'");
  console.log('\n=== NOTABLE SPROUT FARM DATA DETAIL ===');
  notable.rows.forEach(r => console.log(' ', r.data_type, '| type:', r.dtype, '| items:', r.arr_len));

  pool.end();
})().catch(e => { console.error('ERROR:', e.message); pool.end(); });
