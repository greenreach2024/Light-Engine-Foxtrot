#!/bin/bash
# ==========================================
# Check AWS Configuration & Services Status
# ==========================================

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

PROFILE="${AWS_PROFILE:-light-engine}"

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  AWS Configuration Check              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Check AWS CLI
echo -e "${BLUE}🔧 AWS CLI Version:${NC}"
if command -v aws &> /dev/null; then
    aws --version
    echo -e "${GREEN}✅ AWS CLI installed${NC}"
else
    echo -e "${RED}❌ AWS CLI not installed${NC}"
    echo -e "${YELLOW}Install with: brew install awscli${NC}"
    exit 1
fi
echo ""

# Check AWS Profile
echo -e "${BLUE}👤 AWS Profile: $PROFILE${NC}"
if aws configure list --profile $PROFILE &> /dev/null; then
    echo -e "${GREEN}✅ Profile configured${NC}"
    aws configure list --profile $PROFILE
else
    echo -e "${RED}❌ Profile not found${NC}"
    echo -e "${YELLOW}Configure with: aws configure --profile $PROFILE${NC}"
    exit 1
fi
echo ""

# Get Account Info
echo -e "${BLUE}📋 AWS Account Info:${NC}"
ACCOUNT_ID=$(aws sts get-caller-identity --profile $PROFILE --query Account --output text 2>/dev/null || echo "N/A")
REGION=$(aws configure get region --profile $PROFILE)
echo "  Account ID: $ACCOUNT_ID"
echo "  Region:     $REGION"
echo ""

# Check S3 Buckets
echo -e "${BLUE}🪣 S3 Buckets:${NC}"
BUCKETS=$(aws s3 ls --profile $PROFILE 2>/dev/null | grep "light-engine" || echo "")
if [ -n "$BUCKETS" ]; then
    echo "$BUCKETS"
    BUCKET_COUNT=$(echo "$BUCKETS" | wc -l | tr -d ' ')
    echo -e "${GREEN}✅ Found $BUCKET_COUNT Light Engine bucket(s)${NC}"
else
    echo -e "${YELLOW}⚠️  No Light Engine buckets found${NC}"
    echo -e "${YELLOW}Create with: aws s3 mb s3://light-engine-data-production${NC}"
fi
echo ""

# Check CloudFront Distributions
echo -e "${BLUE}🌐 CloudFront Distributions:${NC}"
DISTRIBUTIONS=$(aws cloudfront list-distributions \
  --profile $PROFILE \
  --query 'DistributionList.Items[?Comment==`Light Engine CDN` || contains(Comment, `light-engine`)].{ID:Id,Domain:DomainName,Status:Status,Enabled:Enabled}' \
  --output table 2>/dev/null || echo "")

if [ -n "$DISTRIBUTIONS" ] && [ "$DISTRIBUTIONS" != "None" ]; then
    echo "$DISTRIBUTIONS"
    echo -e "${GREEN}✅ CloudFront distribution(s) found${NC}"
else
    echo -e "${YELLOW}⚠️  No Light Engine CloudFront distributions found${NC}"
fi
echo ""

# Check Lambda Functions
echo -e "${BLUE}⚡ Lambda Functions:${NC}"
FUNCTIONS=$(aws lambda list-functions \
  --profile $PROFILE \
  --query 'Functions[?starts_with(FunctionName, `light-engine`)].{Name:FunctionName,Runtime:Runtime,Memory:MemorySize}' \
  --output table 2>/dev/null || echo "")

if [ -n "$FUNCTIONS" ] && [ "$FUNCTIONS" != "None" ]; then
    echo "$FUNCTIONS"
    echo -e "${GREEN}✅ Lambda function(s) found${NC}"
else
    echo -e "${YELLOW}⚠️  No Light Engine Lambda functions found${NC}"
fi
echo ""

# Check DynamoDB Tables
echo -e "${BLUE}🗄️  DynamoDB Tables:${NC}"
TABLES=$(aws dynamodb list-tables \
  --profile $PROFILE \
  --query 'TableNames[?starts_with(@, `light-engine`)]' \
  --output table 2>/dev/null || echo "")

if [ -n "$TABLES" ] && [ "$TABLES" != "None" ]; then
    echo "$TABLES"
    echo -e "${GREEN}✅ DynamoDB table(s) found${NC}"
else
    echo -e "${YELLOW}⚠️  No Light Engine DynamoDB tables found${NC}"
fi
echo ""

# Check CloudWatch Log Groups
echo -e "${BLUE}📊 CloudWatch Log Groups:${NC}"
LOGS=$(aws logs describe-log-groups \
  --profile $PROFILE \
  --log-group-name-prefix "/light-engine" \
  --query 'logGroups[].logGroupName' \
  --output table 2>/dev/null || echo "")

if [ -n "$LOGS" ] && [ "$LOGS" != "None" ]; then
    echo "$LOGS"
    echo -e "${GREEN}✅ Log group(s) found${NC}"
else
    echo -e "${YELLOW}⚠️  No Light Engine log groups found${NC}"
fi
echo ""

# Check Billing/Budgets
echo -e "${BLUE}💰 Cost & Billing:${NC}"
BUDGET=$(aws budgets describe-budgets \
  --account-id $ACCOUNT_ID \
  --profile $PROFILE \
  --query 'Budgets[?starts_with(BudgetName, `LightEngine`)].{Name:BudgetName,Limit:BudgetLimit.Amount,Unit:BudgetLimit.Unit}' \
  --output table 2>/dev/null || echo "")

if [ -n "$BUDGET" ] && [ "$BUDGET" != "None" ]; then
    echo "$BUDGET"
    echo -e "${GREEN}✅ Budget configured${NC}"
else
    echo -e "${YELLOW}⚠️  No budgets configured${NC}"
    echo -e "${YELLOW}Recommended: Set up billing alerts${NC}"
fi
echo ""

# Summary
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Configuration Check Complete         ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "  • Review AWS_SETUP_GUIDE.md for detailed setup"
echo "  • Deploy frontend: ./scripts/deploy-frontend.sh"
echo "  • Create backup: ./scripts/backup-to-s3.sh"
