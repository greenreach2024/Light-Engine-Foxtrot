ALTER TABLE grant_programs
  ADD COLUMN IF NOT EXISTS budget_categories JSONB DEFAULT '[]';
