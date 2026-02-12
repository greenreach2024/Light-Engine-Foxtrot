-- ============================================================
-- Migration 012: Project Discovery & Website Intelligence
-- Adds project characterization, website scraping, smart matching
-- ============================================================

-- Add project characterization & scraped data to applications
ALTER TABLE grant_applications
ADD COLUMN IF NOT EXISTS project_characterization JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS website_intelligence    JSONB DEFAULT '{}';

-- Add website URL to user profile
ALTER TABLE grant_users
ADD COLUMN IF NOT EXISTS website_url TEXT;

-- Research jobs table for tracking async tasks (website scraping, etc.)
CREATE TABLE IF NOT EXISTS grant_research_jobs (
  id                  SERIAL PRIMARY KEY,
  application_id      INTEGER REFERENCES grant_applications(id),
  user_id             INTEGER NOT NULL REFERENCES grant_users(id),
  
  job_type            VARCHAR(50) NOT NULL,    -- 'website_scrape', 'competitor_analysis', 'market_research'
  status              VARCHAR(50) DEFAULT 'queued',  -- 'queued', 'processing', 'completed', 'failed'
  input_data          JSONB DEFAULT '{}',
  result_data         JSONB DEFAULT '{}',
  error_message       TEXT,
  
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_app ON grant_research_jobs(application_id);
CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_user ON grant_research_jobs(user_id);
