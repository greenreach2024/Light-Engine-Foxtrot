const { Client } = require('pg');

const client = new Client({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  port: 5432,
  user: 'lightengine',
  password: 'GreenReach2024!Database',
  database: 'lightengine'
});

async function checkGroupsData() {
  try {
    await client.connect();
    console.log('✅ Connected to database\n');
    
    // Check if groups data exists
    const result = await client.query(`
      SELECT farm_id, data_type, 
             CASE 
               WHEN jsonb_typeof(data) = 'array' THEN jsonb_array_length(data)
               ELSE 0
             END as count,
             updated_at
      FROM farm_data 
      WHERE data_type = 'groups'
    `);
    
    console.log('Groups data in farm_data table:');
    console.log(result.rows);
    
    if (result.rows.length === 0) {
      console.log('\n⚠️  No groups data found in farm_data table!');
      console.log('This is why groups are not loading.');
    } else {
      console.log(`\n✅ Found ${result.rows.length} farm(s) with groups data`);
      result.rows.forEach(row => {
        console.log(`  - ${row.farm_id}: ${row.count} groups (updated: ${row.updated_at})`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkGroupsData();
