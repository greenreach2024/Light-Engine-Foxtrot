-- Migration 032: Add missing FK indexes for research platform tables
-- Addresses R3 from READINESS_REPORT_APR2026.md
-- Adds indexes on foreign key columns to improve JOIN and cascade delete performance

-- research_invitations (028)
CREATE INDEX IF NOT EXISTS idx_research_invitations_invited_by ON research_invitations(invited_by);

-- instrument_sessions (029)
CREATE INDEX IF NOT EXISTS idx_instrument_sessions_instrument_id ON instrument_sessions(instrument_id);
CREATE INDEX IF NOT EXISTS idx_instrument_sessions_study_id ON instrument_sessions(study_id);
CREATE INDEX IF NOT EXISTS idx_instrument_sessions_started_by ON instrument_sessions(started_by);

-- instrument_telemetry (029)
CREATE INDEX IF NOT EXISTS idx_instrument_telemetry_session_id ON instrument_telemetry(session_id);

-- workflow_runs (029)
CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_study_id ON workflow_runs(study_id);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_submitted_by ON workflow_runs(submitted_by);

-- mlflow_runs (029)
CREATE INDEX IF NOT EXISTS idx_mlflow_runs_experiment_id ON mlflow_runs(experiment_id);

-- mlflow_experiments (029)
CREATE INDEX IF NOT EXISTS idx_mlflow_experiments_study_id ON mlflow_experiments(study_id);

-- research_protocol_versions (029)
CREATE INDEX IF NOT EXISTS idx_protocol_versions_study_id ON research_protocol_versions(study_id);

-- osf_projects (029)
CREATE INDEX IF NOT EXISTS idx_osf_projects_study_id ON osf_projects(study_id);

-- research_roles (029)
CREATE INDEX IF NOT EXISTS idx_research_roles_user_id ON research_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_research_roles_study_id ON research_roles(study_id);

-- approval_gates (029)
CREATE INDEX IF NOT EXISTS idx_approval_gates_requested_by ON approval_gates(requested_by);
CREATE INDEX IF NOT EXISTS idx_approval_gates_entity_id ON approval_gates(entity_id);

-- cfd_pipeline_jobs (029)
CREATE INDEX IF NOT EXISTS idx_cfd_pipeline_jobs_study_id ON cfd_pipeline_jobs(study_id);
CREATE INDEX IF NOT EXISTS idx_cfd_pipeline_jobs_submitted_by ON cfd_pipeline_jobs(submitted_by);

-- jupyter_sessions (029)
CREATE INDEX IF NOT EXISTS idx_jupyter_sessions_user_id ON jupyter_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_jupyter_sessions_study_id ON jupyter_sessions(study_id);

-- globus_transfers (029)
CREATE INDEX IF NOT EXISTS idx_globus_transfers_initiated_by ON globus_transfers(initiated_by);
