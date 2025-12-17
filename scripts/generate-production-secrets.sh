#!/bin/bash
#
# Light Engine - Production Secrets Generator
# Version: 1.0
# Date: 2025-12-07
#
# Generates secure production secrets for JWT, database, and other services

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if .env.production exists
check_env_file() {
    if [ -f .env.production ]; then
        log_warn ".env.production already exists"
        read -p "Overwrite? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "Keeping existing .env.production"
            exit 0
        fi
        mv .env.production .env.production.backup.$(date +%Y%m%d-%H%M%S)
        log_info "Backed up existing .env.production"
    fi
}

# Generate random secret
generate_secret() {
    openssl rand -hex 32
}

# Generate PostgreSQL password
generate_password() {
    openssl rand -base64 32 | tr -d "=+/" | cut -c1-25
}

# Generate Redis password
generate_redis_password() {
    openssl rand -base64 16 | tr -d "=+/" | cut -c1-16
}

# Main generation
generate_production_env() {
    log_info "Generating production secrets..."
    
    local jwt_secret=$(generate_secret)
    local db_password=$(generate_password)
    local redis_password=$(generate_redis_password)
    local session_secret=$(generate_secret)
    
    cat > .env.production << EOF
# ============================================================
# Light Engine - Production Environment Configuration
# Generated: $(date)
# ============================================================
# IMPORTANT: Keep this file secure and never commit to git!
# ============================================================

# Environment
NODE_ENV=production
ENVIRONMENT=production

# Application URLs
APP_URL=https://YOUR_DOMAIN.com
FRONTEND_URL=https://YOUR_DOMAIN.com
API_URL=https://YOUR_DOMAIN.com/api

# ============================================================
# AUTHENTICATION
# ============================================================
AUTH_ENABLED=true
JWT_SECRET=${jwt_secret}
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24
SESSION_SECRET=${session_secret}

# ============================================================
# DATABASE - PostgreSQL
# ============================================================
# Production PostgreSQL connection
DATABASE_URL=postgresql://lightengine:${db_password}@localhost:5432/lightengine

# Individual components (for reference)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=lightengine
DB_USER=lightengine
DB_PASSWORD=${db_password}

# SQLite (for local testing only - DO NOT USE IN PRODUCTION)
# DATABASE_URL=sqlite:///./data/lightengine.db

# ============================================================
# REDIS - Session Store & Rate Limiting
# ============================================================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=${redis_password}
REDIS_DB=0
REDIS_URL=redis://:${redis_password}@localhost:6379/0

# ============================================================
# EMAIL SERVICE
# ============================================================
EMAIL_ENABLED=true
EMAIL_PROVIDER=ses  # Options: ses, sendgrid

# AWS SES Configuration (if EMAIL_PROVIDER=ses)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_KEY
EMAIL_FROM=noreply@YOUR_DOMAIN.com
EMAIL_FROM_NAME=Light Engine

# SendGrid Configuration (if EMAIL_PROVIDER=sendgrid)
# SENDGRID_API_KEY=YOUR_SENDGRID_API_KEY

# ============================================================
# CORS & SECURITY
# ============================================================
ALLOWED_ORIGINS=https://YOUR_DOMAIN.com,https://www.YOUR_DOMAIN.com
CORS_ORIGINS=https://YOUR_DOMAIN.com
USE_FORWARDED_HEADERS=true
FORWARDED_ALLOW_IPS=*

# ============================================================
# RATE LIMITING
# ============================================================
RATE_LIMIT_ENABLED=true
RATE_LIMIT_WINDOW=900  # 15 minutes
RATE_LIMIT_MAX=100     # Max requests per window

# Authentication rate limits
AUTH_RATE_LIMIT_WINDOW=3600  # 1 hour
AUTH_RATE_LIMIT_MAX=5         # Max failed attempts

# ============================================================
# LOGGING
# ============================================================
LOG_LEVEL=info  # Options: debug, info, warn, error
LOG_FILE=/var/log/lightengine/app.log

# ============================================================
# SQUARE PAYMENT (if using Square)
# ============================================================
SQUARE_APPLICATION_ID=YOUR_SQUARE_APP_ID
SQUARE_ACCESS_TOKEN=YOUR_SQUARE_ACCESS_TOKEN
SQUARE_LOCATION_ID=YOUR_SQUARE_LOCATION_ID
SQUARE_ENVIRONMENT=production  # Options: sandbox, production

# ============================================================
# AWS INTEGRATION (Optional)
# ============================================================
AWS_ENDPOINT_URL=https://YOUR_AWS_API_GATEWAY_URL
CLOUD_ENDPOINT_URL=https://YOUR_AWS_API_GATEWAY_URL

# ============================================================
# MONITORING & ANALYTICS (Optional)
# ============================================================
# SENTRY_DSN=https://YOUR_SENTRY_DSN
# ANALYTICS_ID=YOUR_ANALYTICS_ID

# ============================================================
# SWITCHBOT INTEGRATION (if using SwitchBot)
# ============================================================
SWITCHBOT_TOKEN=YOUR_SWITCHBOT_TOKEN
SWITCHBOT_SECRET=YOUR_SWITCHBOT_SECRET

# ============================================================
# MQTT (if using MQTT broker)
# ============================================================
MQTT_HOST=YOUR_MQTT_HOST
MQTT_PORT=1883
MQTT_USERNAME=YOUR_MQTT_USERNAME
MQTT_PASSWORD=YOUR_MQTT_PASSWORD
MQTT_TOPICS=sensors/#

# ============================================================
# BACKUP & STORAGE
# ============================================================
BACKUP_ENABLED=true
S3_BUCKET=YOUR_S3_BUCKET_NAME
S3_REGION=us-east-1

# ============================================================
# END OF CONFIGURATION
# ============================================================
EOF

    log_info "Production environment file created: .env.production"
    echo ""
    echo "=========================================="
    echo "Generated Secrets (SAVE THESE SECURELY!):"
    echo "=========================================="
    echo ""
    echo "JWT_SECRET=$jwt_secret"
    echo "DB_PASSWORD=$db_password"
    echo "REDIS_PASSWORD=$redis_password"
    echo "SESSION_SECRET=$session_secret"
    echo ""
    log_warn "IMPORTANT: Update placeholders (YOUR_DOMAIN, YOUR_AWS_*, etc.)"
    echo ""
    log_info "Next steps:"
    echo "  1. Edit .env.production and replace all YOUR_* placeholders"
    echo "  2. Copy .env.production to your server"
    echo "  3. Rename to .env: mv .env.production .env"
    echo "  4. Set secure permissions: chmod 600 .env"
    echo "  5. Never commit .env.production to git!"
    echo ""
}

# Create .env.example for reference
create_env_example() {
    log_info "Creating .env.example for reference..."
    
    cat > .env.example << 'EOF'
# Light Engine - Environment Configuration Template
# Copy this file to .env and fill in your values

# Environment
NODE_ENV=development
ENVIRONMENT=development

# Authentication
AUTH_ENABLED=true
JWT_SECRET=your-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# Database
DATABASE_URL=sqlite:///./data/lightengine.db

# Redis
REDIS_URL=redis://localhost:6379/0

# Email
EMAIL_ENABLED=false
EMAIL_PROVIDER=ses
EMAIL_FROM=noreply@example.com

# AWS (optional)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret

# Application URLs
APP_URL=http://localhost:3000
EOF

    log_info "Created .env.example"
}

# Add to .gitignore
update_gitignore() {
    if [ -f .gitignore ]; then
        if ! grep -q ".env.production" .gitignore; then
            echo "" >> .gitignore
            echo "# Production secrets" >> .gitignore
            echo ".env.production" >> .gitignore
            echo ".env.production.backup.*" >> .gitignore
            log_info "Updated .gitignore"
        fi
    fi
}

# Main execution
main() {
    echo "=========================================="
    echo "Light Engine - Production Secrets Generator"
    echo "=========================================="
    echo ""
    
    check_env_file
    generate_production_env
    create_env_example
    update_gitignore
    
    log_info "Setup complete!"
}

main "$@"
