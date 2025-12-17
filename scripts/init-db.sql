-- Light Engine PostgreSQL Initialization Script
-- Creates extensions and sets up database schema

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create schema comment
COMMENT ON DATABASE lightengine IS 'Light Engine - Indoor Farming Automation Platform';

-- Set default permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lightengine;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO lightengine;

-- Log successful initialization
DO $$
BEGIN
    RAISE NOTICE 'Light Engine database initialized successfully';
END $$;
