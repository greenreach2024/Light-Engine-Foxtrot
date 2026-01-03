-- Create test farm account
INSERT INTO farms (
  farm_id,
  name,
  email,
  contact_name,
  plan_type,
  api_key,
  api_secret,
  jwt_secret,
  square_payment_id,
  square_amount,
  status,
  setup_completed,
  created_at
) VALUES (
  'FARM-TEST-2026',
  'Test Farm Production',
  'test-prod@greenreachfarms.com',
  'Production Tester',
  'cloud',
  'sk_test_api_key_123456789',
  'test_api_secret_123456789abcdef',
  'test_jwt_secret_987654321fedcba',
  'test_payment_intent_123',
  100,
  'active',
  false,
  NOW()
) ON CONFLICT (farm_id) DO UPDATE SET
  name = EXCLUDED.name,
  email = EXCLUDED.email,
  setup_completed = false;

-- Create test user with known password
INSERT INTO users (
  farm_id,
  email,
  password_hash,
  name,
  role,
  is_active,
  email_verified,
  setup_completed,
  created_at
) VALUES (
  'FARM-TEST-2026',
  'test-prod@greenreachfarms.com',
  '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
  'Production Tester',
  'admin',
  true,
  false,
  false,
  NOW()
) ON CONFLICT (email) DO UPDATE SET
  password_hash = EXCLUDED.password_hash,
  setup_completed = false;

SELECT 'Test account created successfully' as result;
