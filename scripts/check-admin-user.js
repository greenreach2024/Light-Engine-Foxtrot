import bcrypt from 'bcrypt';
import { initDatabase } from './lib/database.js';

const email = 'admin@greenreach.com';
const password = 'Admin2025!';

(async () => {
  try {
    const db = await initDatabase();
    
    // Check if user exists
    const existing = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    
    if (existing) {
      console.log('✅ Admin user exists:');
      console.log('   Email:', existing.email);
      console.log('   Role:', existing.role);
      console.log('   Active:', existing.is_active);
      
      // Verify password
      const valid = await bcrypt.compare(password, existing.password_hash);
      console.log('   Password valid:', valid);
      
      if (existing.role !== 'admin') {
        await db.run('UPDATE users SET role = ? WHERE user_id = ?', ['admin', existing.user_id]);
        console.log('   ✅ Role updated to admin');
      }
      
      if (!valid) {
        console.log('   🔄 Updating password...');
        const hash = await bcrypt.hash(password, 10);
        await db.run('UPDATE users SET password_hash = ? WHERE user_id = ?', [hash, existing.user_id]);
        console.log('   ✅ Password updated');
      }
    } else {
      console.log('❌ Admin user does NOT exist - creating...');
      
      // Get or create default farm
      let farm = await db.get('SELECT farm_id FROM farms LIMIT 1');
      if (!farm) {
        const farmId = 'greenreach-hq';
        await db.run(
          `INSERT INTO farms (farm_id, name, email, contact_name, plan_type, api_key, api_secret, jwt_secret, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [farmId, 'GreenReach HQ', email, 'Admin', 'cloud', 'grk_demo', 'grs_demo', 'jwt_demo', 'active']
        );
        farm = { farm_id: farmId };
        console.log('✅ Created default farm:', farmId);
      }
      
      // Hash password and create user
      const hash = await bcrypt.hash(password, 10);
      const result = await db.run(
        `INSERT INTO users (farm_id, email, password_hash, name, role, is_active, email_verified)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [farm.farm_id, email, hash, 'System Administrator', 'admin', 1, 1]
      );
      console.log('✅ Admin user created! User ID:', result.lastID);
      console.log('\n📧 Email:', email);
      console.log('🔑 Password:', password);
    }
    
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
})();
