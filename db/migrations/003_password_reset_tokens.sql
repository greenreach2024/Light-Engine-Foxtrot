-- Create password reset tokens table for wholesale buyers
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id SERIAL PRIMARY KEY,
  buyer_id INTEGER NOT NULL REFERENCES wholesale_buyers(id) ON DELETE CASCADE,
  token VARCHAR(64) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  used_at TIMESTAMP
);

-- Index for fast token lookup
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON password_reset_tokens(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_buyer_id ON password_reset_tokens(buyer_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON password_reset_tokens(expires_at);

-- Cleanup expired/used tokens older than 7 days
-- (Can be run periodically as a cron job)
-- DELETE FROM password_reset_tokens 
-- WHERE (expires_at < NOW() - INTERVAL '7 days') 
--    OR (used = TRUE AND used_at < NOW() - INTERVAL '7 days');
