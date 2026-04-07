-- Migration: Create 28 tables documented in COMPLETE_SYSTEM_MAP.md (Section 8)
-- that existed on AWS RDS but are missing from AlloyDB.
-- Schema derived from COMPLETE_SYSTEM_MAP.md + actual INSERT column lists in route code.
-- No data invented -- columns match what the code actually uses.

-- ============================================================
-- 8.12 Research Platform (Phase 1) -- Audit
-- Source: research-audit.js
-- ============================================================

CREATE TABLE IF NOT EXISTS coi_declarations (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  user_id UUID,
  declaration_type VARCHAR(100),
  related_entity VARCHAR(255),
  description TEXT,
  disclosed_at TIMESTAMPTZ DEFAULT NOW(),
  status VARCHAR(50) DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS role_signoffs (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  user_id UUID,
  role_title VARCHAR(255),
  responsibilities JSONB,
  signed_at TIMESTAMPTZ,
  witnessed_by UUID,
  witnessed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS approval_chains (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  entity_type VARCHAR(100),
  entity_id VARCHAR(255),
  step_order INTEGER,
  approver_user_id UUID,
  status VARCHAR(50) DEFAULT 'pending',
  decision_at TIMESTAMPTZ,
  comments TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS authorship_contributions (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  user_id UUID,
  contributor_name VARCHAR(255),
  role VARCHAR(100),
  contribution_description TEXT,
  credit_order INTEGER,
  orcid VARCHAR(50),
  institution VARCHAR(255),
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.12 Research Platform (Phase 1) -- Workspace
-- Source: research-workspace-ops.js
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_notes (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  user_id UUID,
  note_type VARCHAR(50) DEFAULT 'general',
  title VARCHAR(500),
  content TEXT,
  action_items JSONB DEFAULT '[]',
  pinned BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS change_requests (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  request_type VARCHAR(100),
  title VARCHAR(500),
  description TEXT,
  justification TEXT,
  current_state JSONB,
  proposed_state JSONB,
  submitted_by UUID,
  status VARCHAR(50) DEFAULT 'pending',
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS milestone_evidence (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  milestone_id INTEGER,
  evidence_type VARCHAR(100),
  title VARCHAR(500),
  file_key VARCHAR(500),
  file_checksum VARCHAR(128),
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.12 Research Platform (Phase 1) -- Data
-- Source: research-data.js
-- ============================================================

CREATE TABLE IF NOT EXISTS event_markers (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  dataset_id INTEGER,
  marker_type VARCHAR(50),
  timestamp TIMESTAMPTZ,
  title VARCHAR(500),
  description TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS batch_traceability (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  batch_id VARCHAR(255),
  event_type VARCHAR(50),
  timestamp TIMESTAMPTZ,
  location VARCHAR(255),
  details JSONB,
  previous_batch_id VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_quality_alerts (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  dataset_id INTEGER,
  variable_name VARCHAR(255),
  alert_type VARCHAR(50),
  severity VARCHAR(20) DEFAULT 'medium',
  message TEXT,
  resolved BOOLEAN DEFAULT false,
  resolved_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.12 Research Platform (Phase 1) -- Compliance
-- Source: research-compliance.js
-- ============================================================

CREATE TABLE IF NOT EXISTS dmp_templates (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  template_name VARCHAR(255),
  grant_type VARCHAR(100),
  sections JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dmp_change_log (
  id SERIAL PRIMARY KEY,
  dmp_id INTEGER,
  farm_id VARCHAR(255),
  changed_by UUID,
  field_changed VARCHAR(255),
  old_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_dictionary_entries (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  variable_name VARCHAR(255),
  description TEXT,
  data_type VARCHAR(50),
  unit VARCHAR(50),
  allowed_values JSONB,
  source VARCHAR(255),
  collection_method VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS metadata_registry (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  schema_name VARCHAR(255),
  schema_version VARCHAR(50),
  schema_definition JSONB,
  standard VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS budget_contributions (
  id SERIAL PRIMARY KEY,
  budget_id INTEGER,
  farm_id VARCHAR(255),
  contributor_type VARCHAR(50),
  contributor_name VARCHAR(255),
  institution VARCHAR(255),
  amount NUMERIC(12,2),
  description TEXT,
  confirmed BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.12 Research Platform (Phase 1) -- Studies
-- Source: research-studies.js
-- ============================================================

CREATE TABLE IF NOT EXISTS protocol_design_elements (
  id SERIAL PRIMARY KEY,
  protocol_id INTEGER,
  study_id INTEGER,
  element_type VARCHAR(100),
  title VARCHAR(500),
  definition JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.13 Research Platform (Phase 2) -- Grants
-- Source: research-grants.js
-- ============================================================

CREATE TABLE IF NOT EXISTS grant_publications (
  id SERIAL PRIMARY KEY,
  grant_id INTEGER,
  farm_id VARCHAR(255),
  title VARCHAR(500),
  authors JSONB,
  journal VARCHAR(255),
  doi VARCHAR(255),
  publication_type VARCHAR(50),
  published_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  open_access BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grant_extensions (
  id SERIAL PRIMARY KEY,
  grant_id INTEGER,
  farm_id VARCHAR(255),
  extension_type VARCHAR(100),
  new_end_date DATE,
  justification TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.13 Research Platform (Phase 2) -- HQP
-- Source: research-hqp.js
-- ============================================================

CREATE TABLE IF NOT EXISTS supervision_meetings (
  id SERIAL PRIMARY KEY,
  trainee_id INTEGER,
  farm_id VARCHAR(255),
  meeting_date TIMESTAMPTZ,
  attendees JSONB,
  agenda TEXT,
  notes TEXT,
  action_items JSONB,
  next_meeting_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS professional_development (
  id SERIAL PRIMARY KEY,
  trainee_id INTEGER,
  farm_id VARCHAR(255),
  activity_type VARCHAR(100),
  title VARCHAR(500),
  description TEXT,
  activity_date DATE,
  hours NUMERIC(6,1),
  provider VARCHAR(255),
  certificate_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edi_self_identification (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  category VARCHAR(100),
  response VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.13 / 8.14 Research Platform (Phase 2/3) -- Reporting
-- Source: COMPLETE_SYSTEM_MAP.md doc (no INSERT code found -- these are
-- doc-defined tables that existed on AWS but have no active write paths yet)
-- ============================================================

CREATE TABLE IF NOT EXISTS research_deadlines (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  study_id INTEGER,
  grant_id INTEGER,
  title VARCHAR(500),
  description TEXT,
  deadline_type VARCHAR(50),
  due_date DATE,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(50) DEFAULT 'upcoming',
  assigned_to UUID,
  reminder_days_before INTEGER,
  auto_generated BOOLEAN DEFAULT false,
  source_entity_type VARCHAR(50),
  source_entity_id INTEGER,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS deadline_tasks (
  id SERIAL PRIMARY KEY,
  deadline_id INTEGER,
  farm_id VARCHAR(255),
  title VARCHAR(500),
  description TEXT,
  assigned_to UUID,
  due_date DATE,
  status VARCHAR(50) DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS report_templates (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  name VARCHAR(255),
  description TEXT,
  report_type VARCHAR(50),
  template_config JSONB,
  schedule_cron VARCHAR(100),
  last_generated_at TIMESTAMPTZ,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS generated_reports (
  id SERIAL PRIMARY KEY,
  template_id INTEGER,
  farm_id VARCHAR(255),
  title VARCHAR(500),
  report_data JSONB,
  format VARCHAR(20) DEFAULT 'json',
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  generated_by VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.14 Research Platform (Phase 3) -- Publications
-- ============================================================

CREATE TABLE IF NOT EXISTS publication_grants (
  id SERIAL PRIMARY KEY,
  publication_id INTEGER,
  grant_id INTEGER,
  farm_id VARCHAR(255),
  acknowledgment_text TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.5 Wholesale -- Network Farms
-- Source: COMPLETE_SYSTEM_MAP.md (network_farms was documented
-- but the actual table used for this is managed by networkFarmsStore.js
-- which may use a different storage mechanism)
-- ============================================================

CREATE TABLE IF NOT EXISTS network_farms (
  farm_id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255),
  api_url VARCHAR(500),
  status VARCHAR(50) DEFAULT 'active',
  contact JSONB,
  location JSONB,
  certifications TEXT,
  practices TEXT,
  attributes TEXT,
  fulfillment_standards JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 8.14 Research Equipment (documented in doc, maps to lab_equipment)
-- ============================================================

CREATE TABLE IF NOT EXISTS research_equipment (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255),
  name VARCHAR(255),
  description TEXT,
  category VARCHAR(100),
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255),
  location VARCHAR(255),
  purchase_date DATE,
  purchase_cost NUMERIC(10,2),
  warranty_expiry DATE,
  maintenance_interval_days INTEGER,
  status VARCHAR(50) DEFAULT 'available',
  specifications JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
