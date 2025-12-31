#!/bin/bash
# Fix database schema references in admin auth files

# server/middleware/admin-auth.js
sed -i.bak '
  # Replace in generateAdminToken
  s/adminId: admin\.admin_user_id/adminId: admin.id/g
  s/role: admin\.role/role: admin.role/g
  s/name: admin\.full_name/name: admin.name/g
  
  # Replace in SQL queries
  s/SELECT admin_user_id,/SELECT id as admin_user_id,/g
  s/WHERE admin_user_id = /WHERE id = /g
  s/admin_sessions\.admin_user_id/admin_sessions.admin_id/g
  s/admin_users\.admin_user_id/admin_users.id/g
  s/admin_users\.full_name/admin_users.name/g
  s/admin_users\.is_active/admin_users.active/g
  s/admin_users\.two_factor_enabled/admin_users.mfa_enabled/g
  s/session_id,/id as session_id,/g
  s/WHERE s\.session_id/WHERE s.id/g
' server/middleware/admin-auth.js

# server/routes/admin-auth.js  
sed -i.bak '
  # Replace column names in SELECT queries
  s/admin_user_id,/id as admin_user_id,/g
  s/full_name,/name as full_name,/g
  s/is_active,/active as is_active,/g
  s/failed_login_attempts,/failed_attempts as failed_login_attempts,/g
  s/two_factor_enabled,/mfa_enabled as two_factor_enabled,/g
  s/two_factor_secret,/mfa_secret as two_factor_secret,/g
  
  # Replace in WHERE clauses
  s/WHERE admin_user_id = /WHERE id = /g
  s/admin_sessions\.admin_user_id/admin_sessions.admin_id/g
  s/audit_id,/id as audit_id,/g
  
  # Replace in INSERT statements
  s/INSERT INTO admin_sessions (admin_user_id,/INSERT INTO admin_sessions (admin_id,/g
  s/INSERT INTO admin_audit_log (admin_user_id,/INSERT INTO admin_audit_log (admin_id,/g
  
  # Replace in JavaScript variable assignments
  s/user\.admin_user_id/user.id/g
  s/user\.full_name/user.name/g
  s/admin\.admin_user_id/admin.id/g
  s/req\.admin\.admin_user_id/req.admin.id/g
' server/routes/admin-auth.js

echo "Schema references updated successfully"
