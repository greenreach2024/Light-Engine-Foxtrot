-- Migration: Create Admin User Authentication System
-- Date: 2025-12-30
-- Description: Tables for admin authentication, sessions, and audit logging

-- Admin users table
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
  must_change_password BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_active ON admin_users(active);

-- Admin sessions table for tracking active sessions
CREATE TABLE IF NOT EXISTS admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  device_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  last_activity TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_token_hash ON admin_sessions(token_hash);
CREATE INDEX idx_admin_sessions_expires_at ON admin_sessions(expires_at);

-- Admin audit log for accountability
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id) ON DELETE SET NULL,
  admin_email VARCHAR(255),
  action VARCHAR(100) NOT NULL, -- 'LOGIN_SUCCESS', 'LOGIN_FAILURE', 'DELETE_FARM', etc.
  resource_type VARCHAR(50), -- 'farm', 'user', 'order', 'subscription', etc.
  resource_id VARCHAR(255),
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_log_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_log_action ON admin_audit_log(action);
CREATE INDEX idx_admin_audit_log_created_at ON admin_audit_log(created_at DESC);
CREATE INDEX idx_admin_audit_log_resource ON admin_audit_log(resource_type, resource_id);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_admin_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER admin_users_updated_at
BEFORE UPDATE ON admin_users
FOR EACH ROW
EXECUTE FUNCTION update_admin_users_updated_at();

-- Insert first admin user (password: ChangeMe123!)
-- This is a temporary password that MUST be changed on first login
INSERT INTO admin_users (email, password_hash, name, active, must_change_password)
VALUES (
  'admin@greenreach.com',
  '$2a$10$YourBcryptHashHere', -- TODO: Generate real bcrypt hash
  'System Administrator',
  true,
  true
)
ON CONFLICT (email) DO NOTHING;

-- Comments for documentation
COMMENT ON TABLE admin_users IS 'Administrative users with access to GreenReach Central Admin portal';
COMMENT ON TABLE admin_sessions IS 'Active admin sessions for tracking and revocation';
COMMENT ON TABLE admin_audit_log IS 'Audit trail of all administrative actions for compliance and forensics';
COMMENT ON COLUMN admin_users.mfa_secret IS 'Encrypted TOTP secret for two-factor authentication';
COMMENT ON COLUMN admin_users.failed_attempts IS 'Count of consecutive failed login attempts (resets on success)';
COMMENT ON COLUMN admin_users.locked_until IS 'Timestamp until which account is locked due to failed attempts';
COMMENT ON COLUMN admin_sessions.token_hash IS 'SHA-256 hash of JWT token for revocation without storing token';
COMMENT ON COLUMN admin_audit_log.action IS 'Type of action: LOGIN_SUCCESS, LOGIN_FAILURE, DELETE_FARM, VIEW_FARM, UPDATE_SUBSCRIPTION, etc.';
