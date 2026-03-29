-- Migration 028: Create research_invitations table for Light Engine Research Beta access codes

CREATE TABLE IF NOT EXISTS research_invitations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    email VARCHAR(160) NOT NULL,
    code VARCHAR(32) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT NOW(),
    used_at TIMESTAMP,
    invited_by INTEGER REFERENCES users(id),
    CONSTRAINT email_unique UNIQUE(email)
);

-- Index for quick lookup by code
CREATE INDEX IF NOT EXISTS idx_research_invitations_code ON research_invitations(code);
