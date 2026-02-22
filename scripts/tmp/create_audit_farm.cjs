const { Pool } = require('pg');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const fs = require('fs');

(async () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const allowInProduction = process.env.ALLOW_AUDIT_FARM_BOOTSTRAP === 'true';
  if (isProduction && !allowInProduction) {
    console.error('[create_audit_farm] Refusing to run in production. Set ALLOW_AUDIT_FARM_BOOTSTRAP=true only for emergency break-glass workflows.');
    process.exit(1);
  }

  const pool = new Pool({ host: 'localhost', port: 5432, database: 'greenreach_central', user: 'postgres' });
  const ts = Date.now();
  const farmId = 'FARM-AUDIT-' + ts.toString(36).toUpperCase();
  const email = 'audit+' + ts + '@local.test';
  const password = 'Audit123!';
  const registrationCode = 'REG-' + ts.toString(36).toUpperCase();
  const apiKey = crypto.randomBytes(32).toString('hex');
  const apiSecret = crypto.randomBytes(32).toString('hex');
  const jwtSecret = crypto.randomBytes(32).toString('hex');
  const hash = await bcrypt.hash(password, 10);

  await pool.query(
    "INSERT INTO farms (farm_id, registration_code, name, status, tier, plan_type, email, contact_name, api_key, api_secret, jwt_secret, metadata, created_at, updated_at) VALUES ($1,$2,$3,'active','starter','light-engine',$4,$5,$6,$7,$8,$9::jsonb,NOW(),NOW())",
    [farmId, registrationCode, 'Audit Isolation Farm', email, 'Audit User', apiKey, apiSecret, jwtSecret, JSON.stringify({ source: 'comprehensive-audit', isolation: true })]
  );

  await pool.query(
    "INSERT INTO farm_users (farm_id,email,password_hash,first_name,last_name,role,status,email_verified,created_at,updated_at) VALUES ($1,$2,$3,'Audit','User','admin','active',true,NOW(),NOW())",
    [farmId, email, hash]
  );

  const out = { farmId, email, password, apiKey, registrationCode };
  fs.writeFileSync('/tmp/audit-farm.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await pool.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
