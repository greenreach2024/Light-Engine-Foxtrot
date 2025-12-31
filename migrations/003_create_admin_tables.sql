-- Migration: Create Admin Authentication and Audit Tables
-- Date: 2025-12-31
-- Purpose: Add admin user authentication, sessions, and audit logging

-- Admin Users Table
CREATE TABLE IF NOT EXISTS admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  mfa_secret VARCHAR(255), -- TOTP secret for 2FA
  mfa_enabled BOOLEAN DEFAULT false,
  permissions JSONB DEFAULT '["read", "write", "delete"]'::jsonb,
  active BOOLEAN DEFAULT true,
  failed_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  last_login TIMESTAMP,
  password_changed_at TIMESTAMP DEFAULT NOW(),
  must_change_password BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for admin_users
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON admin_users(email);
CREATE INDEX IF NOT EXISTS idx_admin_users_active ON admin_users(active);
CREATE INDEX IF NOT EXISTS idx_admin_users_locked ON admin_users(locked_until) WHERE locked_until IS NOT NULL;

-- Admin Sessions Table
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL,
  device_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  last_activity TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for admin_sessions
CREATE INDEX IF NOT EXISTS idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

-- Admin Audit Log Table
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_email VARCHAR(255),
  action VARCHAR(100) NOT NULL, -- 'LOGIN', 'LOGOUT', 'DELETE_FARM', 'VIEW_FARM', etc.
  resource_type VARCHAR(50), -- 'farm', 'user', 'subscription', 'order'
  resource_id VARCHAR(255),
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for admin_audit_log
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin_id ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_admin_audit_resource ON admin_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_admin_audit_created_at ON admin_audit_log(created_at DESC);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_admin_users_updated_at ON admin_users;
CREATE TRIGGER trigger_update_admin_users_updated_at
  BEFORE UPDATE ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION update_admin_users_updated_at();

-- Function to clean up expired sessions (run periodically)
CREATE OR REPLACE FUNCTION cleanup_expired_admin_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM admin_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE admin_users IS 'System administrators with access to GreenReach Central Admin portal';
COMMENT ON TABLE admin_sessions IS 'Active admin login sessions for session management and revocation';
COMMENT ON TABLE admin_audit_log IS 'Audit trail of all admin actions for security and compliance';
COMMENT ON COLUMN admin_users.mfa_secret IS 'Encrypted TOTP secret for two-factor authentication';
COMMENT ON COLUMN admin_users.failed_attempts IS 'Count of failed login attempts (resets on successful login)';
COMMENT ON COLUMN admin_users.locked_until IS 'Account locked until this timestamp after too many failed attempts';
COMMENT ON COLUMN admin_sessions.token_hash IS 'SHA-256 hash of JWT token for session tracking';
