-- Migration: Add role column to admin_users
-- Date: 2026-01-18
-- Description: Add role column for role-based access control (admin, operations, staff, viewer)

-- Add role column with default value of 'admin'
ALTER TABLE admin_users 
ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'admin';

-- Add index for role lookups
CREATE INDEX IF NOT EXISTS idx_admin_users_role ON admin_users(role);

-- Add check constraint for valid roles
ALTER TABLE admin_users 
ADD CONSTRAINT check_admin_role 
CHECK (role IN ('admin', 'operations', 'staff', 'viewer', 'read-only', 'readonly'));

-- Update existing users to have 'admin' role if NULL
UPDATE admin_users SET role = 'admin' WHERE role IS NULL;

-- Add comment
COMMENT ON COLUMN admin_users.role IS 'User role for access control: admin (full access), operations (farm management), staff (limited access), viewer (read-only)';
