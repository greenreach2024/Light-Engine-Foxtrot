-- Grant Wizard Database Schema
-- Supports: user registration, program registry, applications, progress tracking

-- ============================================================
-- Grant users (free accounts for future growers)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_users (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL UNIQUE,
  password_hash   VARCHAR(255) NOT NULL,
  contact_name    VARCHAR(255) NOT NULL,
  business_name   VARCHAR(255),
  phone           VARCHAR(50),
  province        VARCHAR(50),
  postal_code     VARCHAR(10),
  organization_type VARCHAR(100),        -- sole_proprietor, corporation, cooperative, partnership, non_profit
  cra_business_number VARCHAR(50),
  incorporation_status VARCHAR(50),
  employee_count  INTEGER,
  ownership_demographics JSONB DEFAULT '{}',  -- self-declared, optional
  farm_details    JSONB DEFAULT '{}',         -- acreage, crops, equipment, revenue
  
  -- Consent tracking (CASL + PIPEDA)
  consent_service_emails     BOOLEAN DEFAULT TRUE,
  consent_marketing_emails   BOOLEAN DEFAULT FALSE,
  consent_data_improvement   BOOLEAN DEFAULT FALSE,   -- de-identified use for template improvement
  consent_obtained_at        TIMESTAMPTZ,
  consent_method             VARCHAR(50),              -- 'registration_form'
  
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  last_login_at   TIMESTAMPTZ,                         -- tracked; retention = 6 months from last sign-in
  sign_in_count   INTEGER DEFAULT 0,                    -- total sign-in count for analytics
  deleted_at      TIMESTAMPTZ                           -- soft delete
);

-- ============================================================
-- Funding program registry (government + aggregator sources)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_programs (
  id                  SERIAL PRIMARY KEY,
  program_code        VARCHAR(100) UNIQUE NOT NULL,     -- e.g. 'AAFC-ACT-ADOPTION'
  program_name        VARCHAR(500) NOT NULL,
  administering_agency VARCHAR(255),                     -- e.g. 'AAFC', 'OMAFRA'
  source_url          TEXT,                              -- official program page
  agpal_url           TEXT,                              -- AgPal link if available
  
  -- Intake status
  intake_status       VARCHAR(50) DEFAULT 'unknown',    -- open, closed, upcoming, continuous, unknown
  intake_deadline     DATE,
  intake_opens        DATE,
  
  -- Program details
  description         TEXT,
  objectives          TEXT,
  priority_areas      TEXT[],                            -- indexed keywords from program
  eligibility_summary TEXT,
  eligibility_rules   JSONB DEFAULT '{}',               -- structured rules for wizard matching
  
  -- Funding details
  funding_type        VARCHAR(50),                       -- grant, contribution, loan, tax_credit
  min_funding         NUMERIC(12,2),
  max_funding         NUMERIC(12,2),
  cost_share_ratio    VARCHAR(50),                       -- e.g. '50:50', '75:25'
  stacking_rules      TEXT,
  reimbursement_model VARCHAR(50),                       -- upfront, reimbursement, milestone
  
  -- Application details  
  application_method  VARCHAR(50),                       -- portal, pdf, email, mail
  application_url     TEXT,
  has_fillable_pdf    BOOLEAN DEFAULT FALSE,
  pdf_template_url    TEXT,
  required_documents  TEXT[],
  budget_template_url TEXT,
  
  -- Question map (maps official questions to wizard canonical fields)
  question_map        JSONB DEFAULT '[]',
  
  -- Evidence & keywords
  priority_lexicon    TEXT[],                             -- funder-authored priority phrases
  evidence_snippets   JSONB DEFAULT '[]',                -- citeable references for common justifications
  success_stories_url TEXT,
  
  -- Enhanced cost-share for underrepresented groups
  equity_enhanced     BOOLEAN DEFAULT FALSE,
  equity_details      JSONB DEFAULT '{}',
  
  -- Metadata
  last_checked_at     TIMESTAMPTZ,
  last_changed_at     TIMESTAMPTZ,
  change_log          JSONB DEFAULT '[]',
  source_type         VARCHAR(50) DEFAULT 'manual',      -- manual, aafc_catalogue, agpal, pocketed
  active              BOOLEAN DEFAULT TRUE,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Grant applications (user progress through wizard)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_applications (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES grant_users(id),
  program_id          INTEGER REFERENCES grant_programs(id),
  
  -- Status tracking
  status              VARCHAR(50) DEFAULT 'draft',      -- draft, in_progress, review, submitted, awarded, rejected, expired
  wizard_step         INTEGER DEFAULT 1,
  percent_complete    INTEGER DEFAULT 0,
  
  -- Canonical data model (reusable across programs)
  organization_profile JSONB DEFAULT '{}',
  project_profile      JSONB DEFAULT '{}',
  budget               JSONB DEFAULT '{}',
  contacts             JSONB DEFAULT '[]',
  attachments_checklist JSONB DEFAULT '[]',
  prior_funding        JSONB DEFAULT '[]',
  
  -- Answers (program-specific, maps to question_map)
  answers              JSONB DEFAULT '{}',
  
  -- Facts ledger (verified facts for consistency checking)
  facts_ledger         JSONB DEFAULT '{}',
  
  -- Generated outputs
  answers_document     TEXT,                             -- formatted Q&A in program order
  budget_workbook      JSONB,
  disclosure_notes     TEXT,
  
  -- Procurement catalogue items linked to budget
  procurement_items    JSONB DEFAULT '[]',
  
  -- Lifecycle
  started_at           TIMESTAMPTZ DEFAULT NOW(),
  last_saved_at        TIMESTAMPTZ DEFAULT NOW(),
  submitted_at         TIMESTAMPTZ,
  expires_at           TIMESTAMPTZ,                      -- 60 days from creation
  
  -- Outcome tracking
  outcome              VARCHAR(50),                      -- awarded, rejected, withdrawn, no_response
  outcome_date         DATE,
  outcome_amount       NUMERIC(12,2),
  outcome_notes        TEXT,
  
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Application export packs (daily snapshots emailed to user)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_export_packs (
  id                  SERIAL PRIMARY KEY,
  application_id      INTEGER NOT NULL REFERENCES grant_applications(id),
  user_id             INTEGER NOT NULL REFERENCES grant_users(id),
  
  pack_type           VARCHAR(50) DEFAULT 'daily',       -- daily, final, manual
  contents            JSONB DEFAULT '{}',                -- { answers_doc, budget, checklist, citations }
  emailed_at          TIMESTAMPTZ,
  email_status        VARCHAR(50),                       -- sent, failed, pending
  
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Program monitoring log (weekly change detection)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_program_snapshots (
  id                  SERIAL PRIMARY KEY,
  program_id          INTEGER NOT NULL REFERENCES grant_programs(id),
  snapshot_date       DATE DEFAULT CURRENT_DATE,
  
  intake_status       VARCHAR(50),
  intake_deadline     DATE,
  eligibility_hash    VARCHAR(64),                        -- SHA-256 of eligibility text
  content_hash        VARCHAR(64),                        -- SHA-256 of full page content
  changes_detected    JSONB DEFAULT '[]',                 -- list of field changes
  
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Outcome intelligence (de-identified, aggregated)
-- ============================================================
CREATE TABLE IF NOT EXISTS grant_outcome_analytics (
  id                  SERIAL PRIMARY KEY,
  program_id          INTEGER REFERENCES grant_programs(id),
  
  -- Aggregated (no PII)
  program_type        VARCHAR(100),
  project_type        VARCHAR(100),
  budget_band         VARCHAR(50),                        -- e.g. '<10K', '10K-50K', '50K-100K'
  had_quotes          BOOLEAN,
  had_budget_template BOOLEAN,
  submission_timing   VARCHAR(50),                        -- early, mid, late (relative to deadline)
  outcome             VARCHAR(50),
  
  -- From public disclosure
  disclosure_recipient VARCHAR(255),
  disclosure_amount    NUMERIC(12,2),
  disclosure_description TEXT,
  disclosure_source_url TEXT,
  
  created_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_grant_users_email ON grant_users(email);
CREATE INDEX IF NOT EXISTS idx_grant_programs_status ON grant_programs(intake_status);
CREATE INDEX IF NOT EXISTS idx_grant_programs_active ON grant_programs(active);
CREATE INDEX IF NOT EXISTS idx_grant_applications_user ON grant_applications(user_id);
CREATE INDEX IF NOT EXISTS idx_grant_applications_status ON grant_applications(status);
CREATE INDEX IF NOT EXISTS idx_grant_applications_expires ON grant_applications(expires_at);
CREATE INDEX IF NOT EXISTS idx_grant_export_packs_app ON grant_export_packs(application_id);
CREATE INDEX IF NOT EXISTS idx_grant_snapshots_program ON grant_program_snapshots(program_id);
