#!/bin/bash
##############################################################################
# Elastic Beanstalk Environment Configuration Script
#
# This script configures all environment variables needed for production
# security features.
#
# Usage:
#   chmod +x scripts/configure-eb-environment.sh
#   ./scripts/configure-eb-environment.sh
#
# Requirements:
# - EB CLI installed: pip install awsebcli
# - AWS credentials configured
# - JWT secret created in AWS Secrets Manager
##############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
EB_ENV="light-engine-foxtrot-prod"
REGION="us-east-1"
SECRET_NAME="foxtrot/jwt-secret"

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Elastic Beanstalk Environment Configuration${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check if EB CLI is installed
if ! command -v eb &> /dev/null; then
    echo -e "${RED}❌ EB CLI not found. Install with: pip install awsebcli${NC}"
    exit 1
fi
echo -e "${GREEN}✅ EB CLI found${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Install with: brew install awscli${NC}"
    exit 1
fi
echo -e "${GREEN}✅ AWS CLI found${NC}"

# Get JWT Secret ARN
echo ""
echo -e "${YELLOW}🔍 Looking up JWT Secret ARN...${NC}"
SECRET_ARN=$(aws secretsmanager describe-secret \
    --secret-id "$SECRET_NAME" \
    --region "$REGION" \
    --query 'ARN' \
    --output text 2>/dev/null)

if [ -z "$SECRET_ARN" ]; then
    echo -e "${RED}❌ JWT Secret not found in AWS Secrets Manager${NC}"
    echo -e "${YELLOW}Run this first: node scripts/setup-jwt-secret.js${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Found JWT Secret: $SECRET_ARN${NC}"

# Prompt for feature flags
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Security Feature Configuration${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

read -p "Enable Rate Limiting? (y/n, default: n): " enable_rate_limiting
RATE_LIMITING_ENABLED=${enable_rate_limiting:-n}
if [[ "$RATE_LIMITING_ENABLED" =~ ^[Yy]$ ]]; then
    RATE_LIMITING_ENABLED="true"
else
    RATE_LIMITING_ENABLED="false"
fi

read -p "Enable Authentication? (y/n, default: n - enable after HTTPS): " enable_auth
AUTH_ENABLED=${enable_auth:-n}
if [[ "$AUTH_ENABLED" =~ ^[Yy]$ ]]; then
    AUTH_ENABLED="true"
else
    AUTH_ENABLED="false"
fi

read -p "Enable Audit Logging? (y/n, default: y): " enable_audit
AUDIT_LOG_ENABLED=${enable_audit:-y}
if [[ "$AUDIT_LOG_ENABLED" =~ ^[Nn]$ ]]; then
    AUDIT_LOG_ENABLED="false"
else
    AUDIT_LOG_ENABLED="true"
fi

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  Configuration Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "Environment: $EB_ENV"
echo "JWT Secret ARN: $SECRET_ARN"
echo "Rate Limiting: $RATE_LIMITING_ENABLED"
echo "Authentication: $AUTH_ENABLED"
echo "Audit Logging: $AUDIT_LOG_ENABLED"
echo ""

read -p "Apply this configuration? (y/n): " confirm
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}Configuration cancelled${NC}"
    exit 0
fi

# Apply configuration
echo ""
echo -e "${YELLOW}📝 Applying configuration to Elastic Beanstalk...${NC}"

eb setenv \
    JWT_SECRET_ARN="$SECRET_ARN" \
    RATE_LIMITING_ENABLED="$RATE_LIMITING_ENABLED" \
    AUTH_ENABLED="$AUTH_ENABLED" \
    AUDIT_LOG_ENABLED="$AUDIT_LOG_ENABLED" \
    AWS_REGION="$REGION" \
    --environment "$EB_ENV"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Configuration applied successfully${NC}"
    echo ""
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  Next Steps${NC}"
    echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
    echo ""
    echo "1. Deploy the changes:"
    echo "   eb deploy $EB_ENV"
    echo ""
    echo "2. Monitor deployment:"
    echo "   eb logs --stream"
    echo ""
    echo "3. Verify configuration:"
    echo "   eb printenv"
    echo ""
    echo "4. Test the application:"
    echo "   curl https://YOUR_DOMAIN/health"
    echo ""
else
    echo -e "${RED}❌ Configuration failed${NC}"
    exit 1
fi
