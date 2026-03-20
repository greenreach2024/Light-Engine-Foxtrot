-- User memory: persistent key-value facts the AI learns about each farm/user
CREATE TABLE IF NOT EXISTS user_memory (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  key VARCHAR(100) NOT NULL,
  value TEXT NOT NULL,
  source VARCHAR(50) DEFAULT 'assistant',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(farm_id, key)
);
CREATE INDEX IF NOT EXISTS idx_user_memory_farm ON user_memory (farm_id);

-- Persistent feedback (replaces in-memory ring buffer)
CREATE TABLE IF NOT EXISTS assistant_feedback (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  conversation_id VARCHAR(100),
  rating VARCHAR(10) NOT NULL CHECK (rating IN ('up', 'down')),
  snippet TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_farm ON assistant_feedback (farm_id);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON assistant_feedback (created_at);

-- Engagement metrics (rolling aggregates per farm per period)
CREATE TABLE IF NOT EXISTS engagement_metrics (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_sessions INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  total_tool_calls INTEGER DEFAULT 0,
  tools_used JSONB DEFAULT '{}',
  positive_feedback INTEGER DEFAULT 0,
  negative_feedback INTEGER DEFAULT 0,
  top_topics TEXT[],
  memory_facts_count INTEGER DEFAULT 0,
  report_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(farm_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_engagement_farm ON engagement_metrics (farm_id);
CREATE INDEX IF NOT EXISTS idx_engagement_period ON engagement_metrics (period_start);
