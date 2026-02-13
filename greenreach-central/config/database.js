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
 */
export async function initDatabase() {
  if (pool) {
    logger.info('Database already initialized');
    return;
  }

  const dbConfig = {
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

  logger.info(`Connecting to PostgreSQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
  
  pool = new Pool(dbConfig);

  // Test connection
  try {
    const client = await pool.connect();
    logger.info('Database connection established');
    
    // Run migrations
    await runMigrations(client);
    
    client.release();
  } catch (error) {
    logger.error('Database connection failed:', error);
    pool = null; // Mark pool as unavailable so isDatabaseAvailable() returns false
    throw error;
  }

  // Handle pool errors
  pool.on('error', (err) => {
    logger.error('Unexpected database pool error:', err);
  });
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
