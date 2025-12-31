# Database Schema Mapping

## Existing Production Schema (003_create_admin_users.sql)

### admin_users
- `id` (PRIMARY KEY, SERIAL)
- `email` (VARCHAR, UNIQUE)
- `password_hash` (VARCHAR)
- `name` (VARCHAR)
- `mfa_secret` (VARCHAR)
- `mfa_enabled` (BOOLEAN)
- `permissions` (JSONB)
- `active` (BOOLEAN)
- `failed_attempts` (INTEGER)
- `locked_until` (TIMESTAMP)
- `last_login` (TIMESTAMP)
- `must_change_password` (BOOLEAN)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### admin_sessions
- `id` (PRIMARY KEY, SERIAL)
- `admin_id` (FK → admin_users.id)
- `token_hash` (VARCHAR, UNIQUE)
- `device_name` (VARCHAR)
- `ip_address` (INET)
- `user_agent` (TEXT)
- `last_activity` (TIMESTAMP)
- `expires_at` (TIMESTAMP)
- `created_at` (TIMESTAMP)

### admin_audit_log
- `id` (PRIMARY KEY, SERIAL)
- `admin_id` (FK → admin_users.id)
- `admin_email` (VARCHAR)
- `action` (VARCHAR)
- `resource_type` (VARCHAR)
- `resource_id` (VARCHAR)
- `details` (JSONB)
- `ip_address` (INET)
- `user_agent` (TEXT)
- `success` (BOOLEAN)
- `created_at` (TIMESTAMP)

## Mappings Needed in Code

### Find/Replace Operations:
1. `admin_user_id` → `id` (in admin_users context)
2. `admin_user_id` → `admin_id` (in foreign key context)
3. `full_name` → `name`
4. `role` → Not in schema (use permissions JSONB instead)
5. `two_factor_enabled` → `mfa_enabled`
6. `two_factor_secret` → `mfa_secret`

### JWT Payload Mapping:
- `admin.admin_user_id` → `admin.id`
- `admin.full_name` → `admin.name`
- Keep: `email`, `role` (client-side only, derived from permissions)

### Key Differences from New Migration (003_create_admin_tables.sql):
- UUID → SERIAL INTEGER
- full_name → name
- admin_user_id → id
- is_active → active
- No role column (use permissions instead)
- failed_login_attempts → failed_attempts
- No two_factor fields (use mfa_secret/mfa_enabled)
- session_id → id
- admin_user_id (FK) → admin_id
- revoked_at → Not in schema (delete row instead)
- audit_id → id
- Different JSONB structure for details

## Action Items:
1. Update server/middleware/admin-auth.js column references
2. Update server/routes/admin-auth.js column references
3. Test authentication flow end-to-end
4. Remove unused migration file (003_create_admin_tables.sql)
