-- Migration: 018_marketing_ai_agent.sql
-- Description: AI-powered marketing agent — social media content generation, approval workflow, platform publishing
-- Reference: Adapted from Real-Estate-Ready-MVP social media agent architecture
-- Date: 2026-03-12

-- ============================================================
-- Site Settings (key-value store for API keys + config)
-- Used by marketing agent for social platform credentials
-- DB-first with env var fallback
-- ============================================================
CREATE TABLE IF NOT EXISTS site_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Marketing Posts
-- Core table for AI-generated social media content
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_posts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform        TEXT NOT NULL CHECK (platform IN ('twitter','linkedin','instagram','facebook')),
    content         TEXT NOT NULL,
    image_url       TEXT,
    hashtags        TEXT[] DEFAULT '{}',
    status          TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','approved','scheduled','published','failed','rejected')),
    rejection_reason TEXT,

    -- Source tracking
    source_type     TEXT CHECK (source_type IN ('harvest','market','wholesale','sustainability','product','milestone','manual')),
    source_id       TEXT,
    source_context  JSONB DEFAULT '{}',

    -- Scheduling
    scheduled_for   TIMESTAMPTZ,
    published_at    TIMESTAMPTZ,
    platform_post_id TEXT,

    -- Engagement metrics
    metrics         JSONB DEFAULT '{"impressions":0,"clicks":0,"likes":0,"shares":0,"comments":0}',

    -- AI generation metadata
    model_used      TEXT,
    prompt_tokens   INTEGER DEFAULT 0,
    output_tokens   INTEGER DEFAULT 0,
    generation_cost_usd NUMERIC(8,6) DEFAULT 0,
    skill_used      TEXT,

    -- Audit
    created_by      TEXT,
    approved_by     TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Marketing Post History (immutable audit trail)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_post_history (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id     UUID NOT NULL REFERENCES marketing_posts(id) ON DELETE CASCADE,
    action      TEXT NOT NULL CHECK (action IN ('created','approved','rejected','published','failed','edited','auto_approved','scheduled')),
    actor_id    TEXT,
    details     JSONB DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Marketing Rules (admin-togglable guardrails)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_name   TEXT UNIQUE NOT NULL,
    rule_type   TEXT NOT NULL CHECK (rule_type IN ('auto_approve','always_block','rate_limit','content_filter','skill_gate')),
    conditions  JSONB DEFAULT '{}',
    enabled     BOOLEAN DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Marketing Skills (agent capabilities with risk tiers)
-- ============================================================
CREATE TABLE IF NOT EXISTS marketing_skills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    skill_name      TEXT UNIQUE NOT NULL,
    description     TEXT,
    category        TEXT CHECK (category IN ('content','analytics','engagement','scheduling','compliance')),
    risk_tier       INTEGER DEFAULT 1 CHECK (risk_tier BETWEEN 0 AND 4),
    approval_mode   TEXT DEFAULT 'required' CHECK (approval_mode IN ('none','spot-check','required','prohibited')),
    allowed_actions TEXT[] DEFAULT '{}',
    blocked_actions TEXT[] DEFAULT '{}',
    system_prompt   TEXT,
    enabled         BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_marketing_posts_status ON marketing_posts(status);
CREATE INDEX IF NOT EXISTS idx_marketing_posts_platform ON marketing_posts(platform);
CREATE INDEX IF NOT EXISTS idx_marketing_posts_scheduled ON marketing_posts(scheduled_for) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_marketing_posts_created ON marketing_posts(created_at);
CREATE INDEX IF NOT EXISTS idx_marketing_post_history_post ON marketing_post_history(post_id);
CREATE INDEX IF NOT EXISTS idx_marketing_rules_enabled ON marketing_rules(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_marketing_skills_enabled ON marketing_skills(enabled) WHERE enabled = true;

-- ============================================================
-- Seed: Default Rules
-- ============================================================
INSERT INTO marketing_rules (rule_name, rule_type, conditions, enabled) VALUES
    ('require_approval_all', 'always_block', '{"description":"Stage 1: all posts require human approval before publishing"}', true),
    ('rate_limit_daily', 'rate_limit', '{"max_per_day":10,"description":"Maximum 10 posts per day per platform"}', true),
    ('block_health_claims', 'content_filter', '{"blocked_phrases":["cures","treats","prevents disease","medical grade","doctor recommended","clinically proven"],"description":"Block unsubstantiated health or medical claims (CFIA compliance)"}', true),
    ('block_organic_misuse', 'content_filter', '{"blocked_phrases":["certified organic","all natural","chemical free","chemical-free","zero pesticides"],"description":"Block uncertified organic/natural claims"}', true),
    ('block_competitor_names', 'content_filter', '{"description":"Block posts mentioning competitor names by review"}', true),
    ('auto_approve_low_risk', 'auto_approve', '{"allowed_source_types":["market","milestone"],"min_published":50,"max_rejection_rate":0.05,"description":"Stage 2: auto-approve low-risk content types after trust threshold"}', false)
ON CONFLICT (rule_name) DO NOTHING;

-- ============================================================
-- Seed: Default Skills
-- ============================================================
INSERT INTO marketing_skills (skill_name, description, category, risk_tier, approval_mode, allowed_actions, blocked_actions) VALUES
    ('content-drafter', 'Draft social media content from farm data, market intelligence, and seasonal context', 'content', 2, 'required',
     ARRAY['draft-caption','generate-calendar','repurpose-content','summarize-performance'],
     ARRAY['publish-post','send-direct-message','invent-testimonials']),
    ('compliance-screener', 'Check content against CFIA food marketing regulations and brand policy', 'compliance', 3, 'required',
     ARRAY['flag-risky-claims','block-draft','route-to-human-review'],
     ARRAY['override-human-decision','rewrite-policy']),
    ('analytics-summarizer', 'Summarize post performance metrics and engagement data', 'analytics', 0, 'none',
     ARRAY['summarize-metrics','compare-periods','surface-anomalies'],
     ARRAY['change-tracking','publish-external-report']),
    ('engagement-responder', 'Draft responses to social media interactions', 'engagement', 2, 'required',
     ARRAY['draft-reply','suggest-escalation','classify-sentiment'],
     ARRAY['send-external-message','change-account-status']),
    ('schedule-optimizer', 'Recommend optimal posting times from engagement data', 'scheduling', 1, 'spot-check',
     ARRAY['recommend-time','analyze-engagement-patterns','suggest-frequency'],
     ARRAY['auto-schedule-without-review','delete-scheduled-posts'])
ON CONFLICT (skill_name) DO NOTHING;
