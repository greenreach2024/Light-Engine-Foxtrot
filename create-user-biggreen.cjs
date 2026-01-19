const pg = require('pg');
const bcrypt = require('bcrypt');

const pool = new pg.Pool({
  host: 'light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com',
  database: 'lightengine',
  user: 'lightengine',
  password: 'LePphcacxDs35ciLLhnkhaXr7',
  port: 5432,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const farmId = 'FARM-BC134E8B-F371';
    const email = '1681south@gmail.com';
    const password = 'BigGreen020f9e42';
    const contactName = 'Peter Gilbert';
    
    console.log('Creating user record for Big Green Farm...');
    console.log('Farm ID:', farmId);
    console.log('Email:', email);
    
    // Hash the password
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('Password hashed successfully');
    
    // Check if user already exists
    const existing = await pool.query(
      'SELECT user_id FROM users WHERE farm_id = $1 AND email = $2',
      [farmId, email]
    );
    
    if (existing.rows.length > 0) {
      console.log('✅ User already exists:', existing.rows[0].user_id);
      await pool.end();
      return;
    }
    
    // Create user record (user_id will auto-increment)
    const result = await pool.query(
      `INSERT INTO users (farm_id, email, password_hash, name, role, is_active, email_verified, created_at)
       VALUES ($1, $2, $3, $4, 'admin', true, true, NOW())
       RETURNING user_id, email, name, role`,
      [farmId, email, passwordHash, contactName]
    );
    
    console.log('\n✅ User created successfully:');
    console.log(JSON.stringify(result.rows[0], null, 2));
    console.log('\n🎉 You can now login at: https://greenreachgreens.com/login.html');
    console.log('Farm ID:', farmId);
    console.log('Email:', email);
    console.log('Password: BigGreen020f9e42');
    
    await pool.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
})();
