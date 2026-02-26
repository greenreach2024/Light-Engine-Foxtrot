/**
 * Database Configuration and Connection Management
 */

import pg from 'pg';
import logger from '../utils/logger.js';

const { Pool } = pg;

let pool = null;
let db = null;

/**
 * Initialize PostgreSQL connection pool
 * Supports DATABASE_URL (connection string) OR individual RDS_*/DB_* env vars.
 * Retries up to 3 times with exponential backoff on initial connection failure.
 */
export async function initDatabase() {
  if (pool) {
    logger.info('Database already initialized');
    return;
  }

  let poolConfig;

  // Support DATABASE_URL connection string (common in Heroku, Railway, manual configs)
  if (process.env.DATABASE_URL) {
    logger.info('Using DATABASE_URL connection string');
    poolConfig = {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000,
    };
  } else {
    // Individual env vars (EB RDS auto-inject pattern)
    poolConfig = {
      host: process.env.RDS_HOSTNAME || process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.RDS_PORT || process.env.DB_PORT) || 5432,
      database: process.env.RDS_DB_NAME || process.env.DB_NAME || 'greenreach_central',
      user: process.env.RDS_USERNAME || process.env.DB_USER || 'postgres',
      password: process.env.RDS_PASSWORD || process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || 30000,
      connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 10000,
    };
    logger.info(`Connecting to PostgreSQL at ${poolConfig.host}:${poolConfig.port}/${poolConfig.database}`);
  }

  // Retry logic: 3 attempts with exponential backoff (2s, 4s, 8s)
  const MAX_RETRIES = 3;
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      pool = new Pool(poolConfig);

      const client = await pool.connect();
      logger.info(`Database connection established (attempt ${attempt}/${MAX_RETRIES})`);

      // Run migrations
      await runMigrations(client);
      client.release();

      // Handle pool errors (reconnect-safe logging)
      pool.on('error', (err) => {
        logger.error('Unexpected database pool error:', err);
      });

      return; // Success — exit
    } catch (error) {
      lastError = error;
      logger.warn(`Database connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);
      if (pool) { try { await pool.end(); } catch (_) { /* ignore */ } }
      pool = null;

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s
        logger.info(`Retrying in ${delay / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries exhausted
  logger.error('Database connection failed after all retries:', lastError);
  pool = null;
  throw lastError;
}

/**
 * Run database migrations
 */
async function runMigrations(client) {
  logger.info('Running database migrations...');

  // Create farms table
  await client.query(`
    CREATE TABLE IF NOT EXISTS farms (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      api_url VARCHAR(500),
      status VARCHAR(50) DEFAULT 'offline',
      last_heartbeat TIMESTAMP,
      metadata JSONB DEFAULT '{}',
      settings JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    
    CREATE INDEX IF NOT EXISTS idx_farms_farm_id ON farms(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farms_status ON farms(status);
  `);
  
  // Add missing columns to existing farms table (migration for old schemas)
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP;
    `);
    logger.info('Added last_heartbeat column to farms table');
  } catch (err) {
    logger.warn('Could not add last_heartbeat column (may already exist):', err.message);
  }
  
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
    `);
    logger.info('Added metadata column to farms table');
  } catch (err) {
    logger.warn('Could not add metadata column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS email VARCHAR(255);
    `);
    logger.info('Added email column to farms table');
  } catch (err) {
    logger.warn('Could not add email column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS api_url VARCHAR(500);
    `);
    logger.info('Added api_url column to farms table');
  } catch (err) {
    logger.warn('Could not add api_url column (may already exist):', err.message);
  }

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255);
    `);
    logger.info('Added contact_name column to farms table');
  } catch (err) {
    logger.warn('Could not add contact_name column (may already exist):', err.message);
  }

  // Phase 4: Add slug column for subdomain routing (cloud SaaS)
  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS slug VARCHAR(100);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_farms_slug ON farms(slug) WHERE slug IS NOT NULL;
    `);
    logger.info('Added slug column to farms table (subdomain routing)');
  } catch (err) {
    logger.warn('Could not add slug column (may already exist):', err.message);
  }

  // Auto-generate slugs for farms that lack one (name → lowercase-dashed)
  try {
    await client.query(`
      UPDATE farms
         SET slug = LOWER(REGEXP_REPLACE(REGEXP_REPLACE(TRIM(name), '[^a-zA-Z0-9]+', '-', 'g'), '(^-|-$)', '', 'g'))
       WHERE slug IS NULL AND name IS NOT NULL AND TRIM(name) <> '';
    `);
    logger.info('Auto-generated slugs for existing farms');
  } catch (err) {
    logger.warn('Could not auto-generate slugs:', err.message);
  }

  // Create farm_backups table for farm server recovery (Phase 2)
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_backups (
      farm_id VARCHAR(255) PRIMARY KEY,
      groups JSONB NOT NULL DEFAULT '[]',
      rooms JSONB NOT NULL DEFAULT '[]',
      schedules JSONB NOT NULL DEFAULT '[]',
      config JSONB,
      last_synced TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_farm_backups_synced ON farm_backups(last_synced);
    CREATE INDEX IF NOT EXISTS idx_farm_backups_farm_id ON farm_backups(farm_id);
  `);
  logger.info('farm_backups table ready for farm server recovery');

  try {
    await client.query(`
      ALTER TABLE farms ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{}';
    `);
    logger.info('Added settings column to farms table');
  } catch (err) {
    logger.warn('Could not add settings column (may already exist):', err.message);
  }
  
  // Make existing columns nullable (migration from old schema)
  try {
    await client.query(`
      ALTER TABLE farms ALTER COLUMN email DROP NOT NULL;
      ALTER TABLE farms ALTER COLUMN name DROP NOT NULL;
    `);
    logger.info('Made email and name columns nullable in farms table');
  } catch (err) {
    logger.warn('Could not alter column constraints:', err.message);
  }
  // Create farm_heartbeats table
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_heartbeats (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      cpu_usage FLOAT,
      memory_usage FLOAT,
      disk_usage FLOAT,
      metadata JSONB DEFAULT '{}',
      timestamp TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_heartbeats_farm_id ON farm_heartbeats(farm_id);
    CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON farm_heartbeats(timestamp);
  `);

  // Create farm_data table for synced farm data (rooms, groups, schedules)
  await client.query(`
    CREATE TABLE IF NOT EXISTS farm_data (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      data_type VARCHAR(50) NOT NULL,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(farm_id, data_type)
    );
    
    CREATE INDEX IF NOT EXISTS idx_farm_data_farm_id ON farm_data(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farm_data_type ON farm_data(data_type);
    CREATE INDEX IF NOT EXISTS idx_farm_data_updated ON farm_data(updated_at);
  `);

  // Create planting_assignments table for crop selection persistence
  await client.query(`
    CREATE TABLE IF NOT EXISTS planting_assignments (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      group_id VARCHAR(255) NOT NULL,
      tray_id VARCHAR(255),
      crop_id VARCHAR(255) NOT NULL,
      crop_name VARCHAR(255) NOT NULL,
      seed_date DATE NOT NULL,
      harvest_date DATE,
      status VARCHAR(50) DEFAULT 'planned',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(farm_id, group_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_planting_farm_id ON planting_assignments(farm_id);
    CREATE INDEX IF NOT EXISTS idx_planting_group_id ON planting_assignments(group_id);
    CREATE INDEX IF NOT EXISTS idx_planting_seed_date ON planting_assignments(seed_date);
    CREATE INDEX IF NOT EXISTS idx_planting_status ON planting_assignments(status);
  `);

  // ─── AI Vision Phase 1: Experiment Records & Crop Benchmarks ───────
  // Stores per-harvest experiment records from all farms (Rule 3.1, Task 1.7)
  await client.query(`
    CREATE TABLE IF NOT EXISTS experiment_records (
      id SERIAL PRIMARY KEY,
      farm_id VARCHAR(255) NOT NULL,
      crop VARCHAR(255) NOT NULL,
      recipe_id VARCHAR(255),
      grow_days INTEGER,
      planned_grow_days INTEGER,
      recipe_params_avg JSONB,
      environment_achieved_avg JSONB,
      outcomes JSONB NOT NULL,
      farm_context JSONB,
      recorded_at TIMESTAMP NOT NULL,
      ingested_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_experiment_farm_id ON experiment_records(farm_id);
    CREATE INDEX IF NOT EXISTS idx_experiment_crop ON experiment_records(crop);
    CREATE INDEX IF NOT EXISTS idx_experiment_recorded_at ON experiment_records(recorded_at);
  `);

  // Nightly crop benchmark aggregations (Task 1.8)
  await client.query(`
    CREATE TABLE IF NOT EXISTS crop_benchmarks (
      id SERIAL PRIMARY KEY,
      crop VARCHAR(255) NOT NULL UNIQUE,
      farm_count INTEGER DEFAULT 0,
      harvest_count INTEGER DEFAULT 0,
      avg_weight_per_plant_oz DECIMAL(8,3),
      min_weight_per_plant_oz DECIMAL(8,3),
      max_weight_per_plant_oz DECIMAL(8,3),
      avg_grow_days DECIMAL(5,1),
      avg_loss_rate DECIMAL(5,3),
      avg_temp_c DECIMAL(5,1),
      avg_humidity_pct DECIMAL(5,1),
      avg_ppfd DECIMAL(6,1),
      computed_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_benchmark_crop ON crop_benchmarks(crop);
  `);

  // AI Vision Phase 3: Network recipe modifiers table (T31/T32)
  await client.query(`
    CREATE TABLE IF NOT EXISTS network_recipe_modifiers (
      id SERIAL PRIMARY KEY,
      modifiers JSONB NOT NULL,
      computed_at TIMESTAMP DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_network_recipe_modifiers_computed
      ON network_recipe_modifiers(computed_at DESC);
  `);

  // Device integration learning records (Integration Assistant, Ticket I-1.9)
  await client.query(`
    CREATE TABLE IF NOT EXISTS device_integrations (
      id SERIAL PRIMARY KEY,
      farm_id_hash VARCHAR(128) NOT NULL,
      record_id VARCHAR(255) NOT NULL,
      device_type VARCHAR(255),
      device_make_model VARCHAR(255),
      driver_id VARCHAR(255),
      driver_version VARCHAR(64),
      protocol VARCHAR(128),
      capabilities JSONB DEFAULT '{}',
      install_context JSONB DEFAULT '{}',
      validation_passed BOOLEAN,
      validation_signal_quality DECIMAL(8,2),
      validation_dropout_rate DECIMAL(8,4),
      validation_latency_ms INTEGER,
      grower_feedback_rating DECIMAL(4,2),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (farm_id_hash, record_id)
    );

    CREATE INDEX IF NOT EXISTS idx_device_integrations_farm_hash ON device_integrations(farm_id_hash);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_protocol ON device_integrations(protocol);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_driver ON device_integrations(driver_id);
    CREATE INDEX IF NOT EXISTS idx_device_integrations_created_at ON device_integrations(created_at);
  `);

  // Create products table for inventory sync
  await client.query(`
    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      sku_id VARCHAR(255) NOT NULL,
      farm_id VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      quantity INTEGER DEFAULT 0,
      unit VARCHAR(50),
      price DECIMAL(10,2),
      organic BOOLEAN DEFAULT false,
      certifications JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE,
      UNIQUE(sku_id, farm_id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_products_farm_id ON products(farm_id);
    CREATE INDEX IF NOT EXISTS idx_products_sku_id ON products(sku_id);
    CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
  `);

  // Create wholesale_buyers table for wholesale admin + buyer auth
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_buyers (
      id SERIAL PRIMARY KEY,
      business_name VARCHAR(255) NOT NULL,
      contact_name VARCHAR(255),
      email VARCHAR(255) UNIQUE NOT NULL,
      buyer_type VARCHAR(50),
      location JSONB DEFAULT '{}',
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_email ON wholesale_buyers(email);
    CREATE INDEX IF NOT EXISTS idx_wholesale_buyers_created ON wholesale_buyers(created_at);
  `);

  // Create wholesale_orders table for persisted wholesale orders
  await client.query(`
    CREATE TABLE IF NOT EXISTS wholesale_orders (
      id SERIAL PRIMARY KEY,
      master_order_id VARCHAR(64) UNIQUE NOT NULL,
      buyer_id VARCHAR(128) NOT NULL,
      buyer_email VARCHAR(255),
      status VARCHAR(50) DEFAULT 'confirmed',
      order_data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_master ON wholesale_orders(master_order_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_buyer ON wholesale_orders(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_wholesale_orders_created ON wholesale_orders(created_at);
  `);

  // Create payment_records table for persistent payment storage
  await client.query(`
    CREATE TABLE IF NOT EXISTS payment_records (
      id SERIAL PRIMARY KEY,
      payment_id VARCHAR(64) UNIQUE NOT NULL,
      order_id VARCHAR(64) NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      currency VARCHAR(3) DEFAULT 'CAD',
      provider VARCHAR(50),
      status VARCHAR(30) DEFAULT 'pending',
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_payment_records_payment ON payment_records(payment_id);
    CREATE INDEX IF NOT EXISTS idx_payment_records_order ON payment_records(order_id);
    CREATE INDEX IF NOT EXISTS idx_payment_records_created ON payment_records(created_at);
  `);

  // Create audit_log table for persistent audit trail
  await client.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id VARCHAR(100),
      actor VARCHAR(255),
      details JSONB DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event_type);
  `);

  // Grant wizard tables (migration 011)
  if (process.env.ENABLE_GRANT_WIZARD !== 'false') {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS grant_users (
          id              SERIAL PRIMARY KEY,
          email           VARCHAR(255) NOT NULL UNIQUE,
          password_hash   VARCHAR(255) NOT NULL,
          contact_name    VARCHAR(255) NOT NULL,
          business_name   VARCHAR(255),
          phone           VARCHAR(50),
          province        VARCHAR(50),
          postal_code     VARCHAR(10),
          organization_type VARCHAR(100),
          cra_business_number VARCHAR(50),
          incorporation_status VARCHAR(50),
          employee_count  INTEGER,
          ownership_demographics JSONB DEFAULT '{}',
          farm_details    JSONB DEFAULT '{}',
          consent_service_emails     BOOLEAN DEFAULT TRUE,
          consent_marketing_emails   BOOLEAN DEFAULT FALSE,
          consent_data_improvement   BOOLEAN DEFAULT FALSE,
          consent_obtained_at        TIMESTAMPTZ,
          consent_method             VARCHAR(50),
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          updated_at      TIMESTAMPTZ DEFAULT NOW(),
          last_login_at   TIMESTAMPTZ,
          sign_in_count   INTEGER DEFAULT 0,
          deleted_at      TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS grant_programs (
          id                  SERIAL PRIMARY KEY,
          program_code        VARCHAR(100) UNIQUE NOT NULL,
          program_name        VARCHAR(500) NOT NULL,
          administering_agency VARCHAR(255),
          source_url          TEXT,
          agpal_url           TEXT,
          intake_status       VARCHAR(50) DEFAULT 'unknown',
          intake_deadline     DATE,
          intake_opens        DATE,
          description         TEXT,
          objectives          TEXT,
          priority_areas      TEXT[],
          eligibility_summary TEXT,
          eligibility_rules   JSONB DEFAULT '{}',
          funding_type        VARCHAR(50),
          min_funding         NUMERIC(12,2),
          max_funding         NUMERIC(12,2),
          cost_share_ratio    VARCHAR(50),
          stacking_rules      TEXT,
          reimbursement_model VARCHAR(50),
          application_method  VARCHAR(50),
          application_url     TEXT,
          has_fillable_pdf    BOOLEAN DEFAULT FALSE,
          pdf_template_url    TEXT,
          required_documents  TEXT[],
          budget_template_url TEXT,
          question_map        JSONB DEFAULT '[]',
          priority_lexicon    TEXT[],
          evidence_snippets   JSONB DEFAULT '[]',
          success_stories_url TEXT,
          equity_enhanced     BOOLEAN DEFAULT FALSE,
          equity_details      JSONB DEFAULT '{}',
          last_checked_at     TIMESTAMPTZ,
          last_changed_at     TIMESTAMPTZ,
          change_log          JSONB DEFAULT '[]',
          source_type         VARCHAR(50) DEFAULT 'manual',
          active              BOOLEAN DEFAULT TRUE,
          created_at          TIMESTAMPTZ DEFAULT NOW(),
          updated_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_applications (
          id                  SERIAL PRIMARY KEY,
          user_id             INTEGER NOT NULL REFERENCES grant_users(id),
          program_id          INTEGER REFERENCES grant_programs(id),
          status              VARCHAR(50) DEFAULT 'draft',
          wizard_step         INTEGER DEFAULT 1,
          percent_complete    INTEGER DEFAULT 0,
          organization_profile JSONB DEFAULT '{}',
          project_profile      JSONB DEFAULT '{}',
          budget               JSONB DEFAULT '{}',
          contacts             JSONB DEFAULT '[]',
          attachments_checklist JSONB DEFAULT '[]',
          prior_funding        JSONB DEFAULT '[]',
          answers              JSONB DEFAULT '{}',
          facts_ledger         JSONB DEFAULT '{}',
          answers_document     TEXT,
          budget_workbook      JSONB,
          disclosure_notes     TEXT,
          procurement_items    JSONB DEFAULT '[]',
          started_at           TIMESTAMPTZ DEFAULT NOW(),
          last_saved_at        TIMESTAMPTZ DEFAULT NOW(),
          submitted_at         TIMESTAMPTZ,
          expires_at           TIMESTAMPTZ,
          outcome              VARCHAR(50),
          outcome_date         DATE,
          outcome_amount       NUMERIC(12,2),
          outcome_notes        TEXT,
          created_at           TIMESTAMPTZ DEFAULT NOW(),
          updated_at           TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_export_packs (
          id                  SERIAL PRIMARY KEY,
          application_id      INTEGER NOT NULL REFERENCES grant_applications(id),
          user_id             INTEGER NOT NULL REFERENCES grant_users(id),
          pack_type           VARCHAR(50) DEFAULT 'daily',
          contents            JSONB DEFAULT '{}',
          emailed_at          TIMESTAMPTZ,
          email_status        VARCHAR(50),
          created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_program_snapshots (
          id                  SERIAL PRIMARY KEY,
          program_id          INTEGER NOT NULL REFERENCES grant_programs(id),
          snapshot_date       DATE DEFAULT CURRENT_DATE,
          intake_status       VARCHAR(50),
          intake_deadline     DATE,
          eligibility_hash    VARCHAR(64),
          content_hash        VARCHAR(64),
          changes_detected    JSONB DEFAULT '[]',
          created_at          TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS grant_outcome_analytics (
          id                  SERIAL PRIMARY KEY,
          program_id          INTEGER REFERENCES grant_programs(id),
          program_type        VARCHAR(100),
          project_type        VARCHAR(100),
          budget_band         VARCHAR(50),
          had_quotes          BOOLEAN,
          had_budget_template BOOLEAN,
          submission_timing   VARCHAR(50),
          outcome             VARCHAR(50),
          disclosure_recipient VARCHAR(255),
          disclosure_amount    NUMERIC(12,2),
          disclosure_description TEXT,
          disclosure_source_url TEXT,
          created_at           TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_users_email ON grant_users(email);
        CREATE INDEX IF NOT EXISTS idx_grant_programs_status ON grant_programs(intake_status);
        CREATE INDEX IF NOT EXISTS idx_grant_programs_active ON grant_programs(active);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_user ON grant_applications(user_id);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_status ON grant_applications(status);
        CREATE INDEX IF NOT EXISTS idx_grant_applications_expires ON grant_applications(expires_at);
        CREATE INDEX IF NOT EXISTS idx_grant_export_packs_app ON grant_export_packs(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_snapshots_program ON grant_program_snapshots(program_id);
      `);
      logger.info('Grant wizard tables ready (migration 011)');
    } catch (err) {
      logger.warn('Grant wizard migration warning:', err.message);
    }

    // Migration 012: Project Discovery columns + research jobs table
    try {
      await client.query(`
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS project_characterization JSONB DEFAULT '{}';
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS website_intelligence JSONB DEFAULT '{}';
        ALTER TABLE grant_users ADD COLUMN IF NOT EXISTS website_url TEXT;

        CREATE TABLE IF NOT EXISTS grant_research_jobs (
          id              SERIAL PRIMARY KEY,
          application_id  INTEGER REFERENCES grant_applications(id),
          user_id         INTEGER NOT NULL REFERENCES grant_users(id),
          job_type        VARCHAR(50) NOT NULL,
          status          VARCHAR(50) DEFAULT 'pending',
          input_data      JSONB DEFAULT '{}',
          result_data     JSONB DEFAULT '{}',
          error_message   TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          completed_at    TIMESTAMPTZ
        );

        CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_app ON grant_research_jobs(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_research_jobs_user ON grant_research_jobs(user_id);
      `);
      logger.info('Project discovery tables ready (migration 012)');
    } catch (err) {
      logger.warn('Project discovery migration warning:', err.message);
    }

    // Migration 013: Grant wizard analytics + AI reference sites
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS grant_wizard_events (
          id              SERIAL PRIMARY KEY,
          user_id         INTEGER NOT NULL REFERENCES grant_users(id),
          application_id  INTEGER REFERENCES grant_applications(id),
          event_type      VARCHAR(50) NOT NULL,
          page_id         VARCHAR(100),
          duration_ms     INTEGER,
          created_at      TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_user ON grant_wizard_events(user_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_app ON grant_wizard_events(application_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_page ON grant_wizard_events(page_id);
        CREATE INDEX IF NOT EXISTS idx_grant_wizard_events_created ON grant_wizard_events(created_at);

        CREATE TABLE IF NOT EXISTS ai_reference_sites (
          id          SERIAL PRIMARY KEY,
          title       TEXT NOT NULL,
          url         TEXT NOT NULL,
          category    TEXT,
          created_at  TIMESTAMPTZ DEFAULT NOW(),
          updated_at  TIMESTAMPTZ DEFAULT NOW()
        );

        INSERT INTO ai_reference_sites (title, url, category)
        SELECT * FROM (VALUES
          ('OpenAI Usage Policies', 'https://openai.com/policies/usage-policies', 'Policy'),
          ('OpenAI Safety Best Practices', 'https://openai.com/safety', 'Safety'),
          ('Government of Canada: AI and data', 'https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai.html', 'Regulatory'),
          ('Treasury Board: Directive on Automated Decision-Making', 'https://www.tbs-sct.canada.ca/pol/doc-eng.aspx?id=32592', 'Regulatory'),
          ('OECD AI Principles', 'https://oecd.ai/en/ai-principles', 'Framework'),
          ('NIST AI Risk Management Framework', 'https://www.nist.gov/itl/ai-risk-management-framework', 'Framework')
        ) AS seed(title, url, category)
        WHERE NOT EXISTS (SELECT 1 FROM ai_reference_sites);
      `);
      logger.info('Grant analytics + AI reference tables ready (migration 013)');
    } catch (err) {
      logger.warn('Grant analytics migration warning:', err.message);
    }

    // Migration 014: Milestones + support letters JSONB columns
    try {
      await client.query(`
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS milestones JSONB DEFAULT '[]';
        ALTER TABLE grant_applications ADD COLUMN IF NOT EXISTS support_letters JSONB DEFAULT '[]';
      `);
      logger.info('Milestones & support letters columns ready (migration 014)');
    } catch (err) {
      logger.warn('Milestones migration warning:', err.message);
    }

    // Migration 015: Program budget guidance categories
    try {
      await client.query(`
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS budget_categories JSONB DEFAULT '[]';
      `);
      logger.info('Grant program budget categories ready (migration 015)');
    } catch (err) {
      logger.warn('Grant budget category migration warning:', err.message);
    }

    // Migration 016: Program verification + change alerts + snapshot confidence
    try {
      await client.query(`
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255);
        ALTER TABLE grant_programs ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT FALSE;

        ALTER TABLE grant_program_snapshots ADD COLUMN IF NOT EXISTS scraping_confidence VARCHAR(20) DEFAULT 'medium';

        CREATE TABLE IF NOT EXISTS grant_program_change_alerts (
          id SERIAL PRIMARY KEY,
          program_id INTEGER REFERENCES grant_programs(id),
          change_type VARCHAR(50),
          details JSONB DEFAULT '{}',
          acknowledged BOOLEAN DEFAULT FALSE,
          acknowledged_by VARCHAR(255),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_program ON grant_program_change_alerts(program_id);
        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_ack ON grant_program_change_alerts(acknowledged);
        CREATE INDEX IF NOT EXISTS idx_grant_program_change_alerts_created ON grant_program_change_alerts(created_at);
      `);
      logger.info('Grant verification + alerting ready (migration 016)');
    } catch (err) {
      logger.warn('Grant verification migration warning:', err.message);
    }

    // Migration 017: Farm users table for multi-tenant authentication
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS farm_users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          farm_id VARCHAR(255) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
          email VARCHAR(255) NOT NULL,
          first_name VARCHAR(255),
          last_name VARCHAR(255),
          role VARCHAR(50) DEFAULT 'operator',
          password_hash VARCHAR(255) NOT NULL,
          status VARCHAR(50) DEFAULT 'active',
          last_login TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, email)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_users_farm_id ON farm_users(farm_id);
        CREATE INDEX IF NOT EXISTS idx_farm_users_email ON farm_users(email);
        CREATE INDEX IF NOT EXISTS idx_farm_users_status ON farm_users(status);
      `);
      logger.info('Farm users table ready (migration 017)');
    } catch (err) {
      logger.warn('Farm users migration warning:', err.message);
    }

    // Migration 018: Delivery service tables (farm-scoped, no FK constraints — app-level enforcement)
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS farm_delivery_settings (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          enabled BOOLEAN DEFAULT FALSE,
          base_fee NUMERIC(10,2) DEFAULT 0,
          min_order NUMERIC(10,2) DEFAULT 25,
          lead_time_hours INTEGER DEFAULT 24,
          max_deliveries_per_window INTEGER DEFAULT 20,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_settings_farm ON farm_delivery_settings(farm_id);

        CREATE TABLE IF NOT EXISTS farm_delivery_windows (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          window_id VARCHAR(50) NOT NULL,
          label VARCHAR(255),
          start_time VARCHAR(10),
          end_time VARCHAR(10),
          active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, window_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_windows_farm ON farm_delivery_windows(farm_id);

        CREATE TABLE IF NOT EXISTS farm_delivery_zones (
          id SERIAL PRIMARY KEY,
          farm_id VARCHAR(255) NOT NULL,
          zone_id VARCHAR(50) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT DEFAULT '',
          fee NUMERIC(10,2) DEFAULT 0,
          min_order NUMERIC(10,2) DEFAULT 25,
          postal_prefix VARCHAR(10),
          status VARCHAR(50) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE(farm_id, zone_id)
        );

        CREATE INDEX IF NOT EXISTS idx_farm_delivery_zones_farm ON farm_delivery_zones(farm_id);
        CREATE INDEX IF NOT EXISTS idx_farm_delivery_zones_status ON farm_delivery_zones(status);
      `);
      logger.info('Delivery service tables ready (migration 018)');
    } catch (err) {
      logger.warn('Delivery tables migration warning:', err.message);
    }
  }

  logger.info('Database migrations completed');
}

/**
 * Get database pool instance
 */
export function getDatabase() {
  if (!pool) {
    throw new Error('Database not initialized');
  }
  return pool;
}

/**
 * Check if database is available
 */
export function isDatabaseAvailable() {
  return pool !== null;
}

/**
 * Execute a query with automatic connection management
 */
export async function query(text, params) {
  if (!pool) {
    throw new Error('Database not available');
  }
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

/**
 * Close database connection
 */
export async function closeDatabase() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection closed');
  }
}
