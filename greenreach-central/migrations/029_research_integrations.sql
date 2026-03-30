-- Migration 029: Research Integration Foundation
-- OSF, ORCID, DataCite, protocols.io, Globus, instrument abstraction,
-- workflow engine, CFD pipeline, MLflow, governance, immutable records

-- ORCID Researcher Linkage
CREATE TABLE IF NOT EXISTS researcher_orcid_profiles (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  user_id INTEGER,
  orcid_id VARCHAR(19) NOT NULL,
  display_name VARCHAR(255),
  affiliation VARCHAR(512),
  verified BOOLEAN DEFAULT FALSE,
  orcid_data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, orcid_id)
);

-- DataCite DOI Records
CREATE TABLE IF NOT EXISTS dataset_dois (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  doi VARCHAR(255),
  doi_status VARCHAR(30) DEFAULT 'draft',
  datacite_metadata JSONB DEFAULT '{}',
  datacite_response JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- OSF Project Linkage
CREATE TABLE IF NOT EXISTS osf_projects (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  osf_project_id VARCHAR(10),
  study_id INTEGER,
  title VARCHAR(512),
  osf_url VARCHAR(512),
  sync_status VARCHAR(30) DEFAULT 'linked',
  last_sync_at TIMESTAMP,
  osf_metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- protocols.io Protocol Versions
CREATE TABLE IF NOT EXISTS research_protocol_versions (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  study_id INTEGER,
  protocol_name VARCHAR(512) NOT NULL,
  version_number INTEGER DEFAULT 1,
  protocols_io_id VARCHAR(64),
  protocols_io_doi VARCHAR(255),
  protocols_io_url VARCHAR(512),
  status VARCHAR(30) DEFAULT 'draft',
  content JSONB DEFAULT '{}',
  created_by INTEGER,
  approved_by INTEGER,
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Instrument Registry (abstraction layer)
CREATE TABLE IF NOT EXISTS instrument_registry (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  instrument_name VARCHAR(255) NOT NULL,
  instrument_type VARCHAR(100),
  manufacturer VARCHAR(255),
  model VARCHAR(255),
  serial_number VARCHAR(255),
  connection_protocol VARCHAR(50),
  connection_config JSONB DEFAULT '{}',
  capabilities JSONB DEFAULT '[]',
  calibration_due_date DATE,
  location VARCHAR(255),
  status VARCHAR(30) DEFAULT 'offline',
  last_seen_at TIMESTAMP,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Instrument Sessions
CREATE TABLE IF NOT EXISTS instrument_sessions (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  instrument_id INTEGER REFERENCES instrument_registry(id),
  study_id INTEGER,
  session_type VARCHAR(50),
  status VARCHAR(30) DEFAULT 'pending',
  parameters JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  started_by INTEGER,
  approved_by INTEGER,
  approved_at TIMESTAMP,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Instrument Telemetry
CREATE TABLE IF NOT EXISTS instrument_telemetry (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  instrument_id INTEGER REFERENCES instrument_registry(id),
  session_id INTEGER REFERENCES instrument_sessions(id),
  metric_name VARCHAR(100),
  metric_value NUMERIC,
  unit VARCHAR(50),
  recorded_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_instrument_telemetry_lookup ON instrument_telemetry(farm_id, instrument_id, recorded_at DESC);

-- Workflow Definitions (Nextflow templates)
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  workflow_name VARCHAR(255) NOT NULL,
  workflow_type VARCHAR(50),
  engine VARCHAR(30) DEFAULT 'nextflow',
  template_id VARCHAR(100),
  definition JSONB DEFAULT '{}',
  version INTEGER DEFAULT 1,
  status VARCHAR(30) DEFAULT 'draft',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Workflow Runs
CREATE TABLE IF NOT EXISTS workflow_runs (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  workflow_id INTEGER REFERENCES workflow_definitions(id),
  study_id INTEGER,
  run_status VARCHAR(30) DEFAULT 'submitted',
  execution_target VARCHAR(50) DEFAULT 'local',
  parameters JSONB DEFAULT '{}',
  inputs JSONB DEFAULT '{}',
  outputs JSONB DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  logs TEXT,
  submitted_by INTEGER,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Globus Transfer Records
CREATE TABLE IF NOT EXISTS globus_transfers (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  transfer_id VARCHAR(255),
  direction VARCHAR(10) NOT NULL,
  source_endpoint VARCHAR(255),
  destination_endpoint VARCHAR(255),
  files JSONB DEFAULT '[]',
  status VARCHAR(30) DEFAULT 'pending',
  bytes_transferred BIGINT DEFAULT 0,
  initiated_by INTEGER,
  partner_institution VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- MLflow Experiment Tracking
CREATE TABLE IF NOT EXISTS mlflow_experiments (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  study_id INTEGER,
  experiment_name VARCHAR(255),
  mlflow_experiment_id VARCHAR(100),
  mlflow_tracking_uri VARCHAR(512),
  description TEXT,
  tags JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mlflow_runs (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  experiment_id INTEGER REFERENCES mlflow_experiments(id),
  mlflow_run_id VARCHAR(100),
  run_name VARCHAR(255),
  status VARCHAR(30) DEFAULT 'running',
  parameters JSONB DEFAULT '{}',
  metrics JSONB DEFAULT '{}',
  artifacts JSONB DEFAULT '[]',
  code_version VARCHAR(100),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Governance Roles
CREATE TABLE IF NOT EXISTS research_roles (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  user_id INTEGER,
  orcid_id VARCHAR(19),
  researcher_name VARCHAR(255),
  role_name VARCHAR(50) NOT NULL,
  study_id INTEGER,
  permissions JSONB DEFAULT '{}',
  granted_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Approval Gates
CREATE TABLE IF NOT EXISTS approval_gates (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  gate_type VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  requested_by INTEGER,
  requester_name VARCHAR(255),
  approved_by INTEGER,
  status VARCHAR(30) DEFAULT 'pending',
  justification TEXT,
  review_notes TEXT,
  requested_at TIMESTAMP DEFAULT NOW(),
  resolved_at TIMESTAMP
);

-- Immutable Run Records
CREATE TABLE IF NOT EXISTS immutable_run_records (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  record_type VARCHAR(50) NOT NULL,
  source_table VARCHAR(100),
  source_id INTEGER,
  record_hash VARCHAR(128) NOT NULL,
  snapshot JSONB NOT NULL,
  sealed_by INTEGER,
  sealed_at TIMESTAMP DEFAULT NOW(),
  verification_status VARCHAR(30) DEFAULT 'valid'
);

-- CFD Pipeline Jobs
CREATE TABLE IF NOT EXISTS cfd_pipeline_jobs (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  study_id INTEGER,
  job_name VARCHAR(255),
  template_type VARCHAR(50),
  pipeline_stage VARCHAR(50) DEFAULT 'geometry',
  geometry_config JSONB DEFAULT '{}',
  mesh_config JSONB DEFAULT '{}',
  solver_config JSONB DEFAULT '{}',
  visualization_config JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  status VARCHAR(30) DEFAULT 'draft',
  execution_target VARCHAR(50) DEFAULT 'local',
  submitted_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- JupyterHub Session Tracking
CREATE TABLE IF NOT EXISTS jupyter_sessions (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(64) NOT NULL,
  user_id INTEGER,
  study_id INTEGER,
  jupyter_server_url VARCHAR(512),
  notebook_path VARCHAR(512),
  session_status VARCHAR(30) DEFAULT 'active',
  kernel_name VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  last_activity_at TIMESTAMP
);
