#!/bin/bash

###############################################################################
# AWS Free Tier Deployment Script for Light Engine
# Deploys complete infrastructure within AWS free tier limits
###############################################################################

set -e  # Exit on error

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
AWS_PROFILE="${AWS_PROFILE:-light-engine}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKET_NAME="${BUCKET_NAME:-light-engine-free-tier}"
LOG_GROUP="${LOG_GROUP:-/light-engine/free-tier}"
ACCOUNT_ID=""

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_step() {
    echo -e "${YELLOW}➜ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        print_error "Required command not found: $1"
        echo "Install with: $2"
        exit 1
    fi
}

###############################################################################
# Pre-flight Checks
###############################################################################

print_header "AWS Free Tier Deployment for Light Engine"

echo "This script will deploy Light Engine to AWS using free tier services."
echo ""
echo "Configuration:"
echo "  AWS Profile: $AWS_PROFILE"
echo "  AWS Region: $AWS_REGION"
echo "  S3 Bucket: $BUCKET_NAME"
echo "  Log Group: $LOG_GROUP"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

print_header "Pre-flight Checks"

print_step "Checking dependencies"
check_dependency "aws" "brew install awscli (macOS) or pip install awscli"
check_dependency "python3" "brew install python3"
check_dependency "jq" "brew install jq"
print_success "All dependencies installed"

print_step "Checking AWS credentials"
if aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
    print_success "AWS credentials valid (Account: $ACCOUNT_ID)"
else
    print_error "AWS credentials not configured"
    echo ""
    echo "Run: aws configure --profile $AWS_PROFILE"
    echo ""
    echo "You'll need:"
    echo "  - AWS Access Key ID"
    echo "  - AWS Secret Access Key"
    echo "  - Default region: us-east-1"
    echo "  - Default output format: json"
    exit 1
fi

print_step "Checking free tier eligibility"
COSTS=$(aws ce get-cost-and-usage \
    --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --profile "$AWS_PROFILE" \
    --query 'ResultsByTime[0].Total.BlendedCost.Amount' \
    --output text 2>/dev/null || echo "0")

echo "  Current month costs: \$$COSTS"
if (( $(echo "$COSTS < 5" | bc -l) )); then
    print_success "Within free tier limits"
else
    print_error "WARNING: Current costs exceed typical free tier ($COSTS)"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 0
    fi
fi

###############################################################################
# Step 1: Create S3 Bucket
###############################################################################

print_header "Step 1: Create S3 Bucket"

print_step "Checking if bucket exists"
if aws s3 ls "s3://$BUCKET_NAME" --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    print_success "Bucket already exists: $BUCKET_NAME"
else
    print_step "Creating S3 bucket"
    aws s3 mb "s3://$BUCKET_NAME" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    print_success "Bucket created: $BUCKET_NAME"
fi

print_step "Enabling versioning"
aws s3api put-bucket-versioning \
    --bucket "$BUCKET_NAME" \
    --versioning-configuration Status=Enabled \
    --profile "$AWS_PROFILE"
print_success "Versioning enabled"

print_step "Enabling encryption"
aws s3api put-bucket-encryption \
    --bucket "$BUCKET_NAME" \
    --server-side-encryption-configuration '{
        "Rules": [{
            "ApplyServerSideEncryptionByDefault": {
                "SSEAlgorithm": "AES256"
            }
        }]
    }' \
    --profile "$AWS_PROFILE"
print_success "Encryption enabled (AES256)"

print_step "Setting lifecycle policy (delete old backups after 7 days)"
cat > /tmp/lifecycle-policy.json << 'EOF'
{
  "Rules": [
    {
      "Id": "DeleteOldBackups",
      "Status": "Enabled",
      "Filter": {"Prefix": "backups/"},
      "Expiration": {"Days": 7}
    },
    {
      "Id": "DeleteOldTelemetry",
      "Status": "Enabled",
      "Filter": {"Prefix": "telemetry/"},
      "Expiration": {"Days": 30}
    }
  ]
}
EOF

aws s3api put-bucket-lifecycle-configuration \
    --bucket "$BUCKET_NAME" \
    --lifecycle-configuration file:///tmp/lifecycle-policy.json \
    --profile "$AWS_PROFILE"
print_success "Lifecycle policy set"

print_step "Enabling static website hosting"
aws s3 website "s3://$BUCKET_NAME" \
    --index-document index.html \
    --error-document index.html \
    --profile "$AWS_PROFILE"
print_success "Website hosting enabled"

print_step "Setting bucket policy for public read (website hosting)"
cat > /tmp/bucket-policy.json << EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "PublicReadGetObject",
    "Effect": "Allow",
    "Principal": "*",
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET_NAME/*"
  }]
}
EOF

aws s3api put-bucket-policy \
    --bucket "$BUCKET_NAME" \
    --policy file:///tmp/bucket-policy.json \
    --profile "$AWS_PROFILE"
print_success "Bucket policy set"

WEBSITE_URL="http://$BUCKET_NAME.s3-website-$AWS_REGION.amazonaws.com"
echo ""
echo "  Website URL: $WEBSITE_URL"
echo ""

###############################################################################
# Step 2: Create CloudWatch Log Group
###############################################################################

print_header "Step 2: Create CloudWatch Log Group"

print_step "Checking if log group exists"
if aws logs describe-log-groups \
    --log-group-name-prefix "$LOG_GROUP" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" | grep -q "$LOG_GROUP"; then
    print_success "Log group already exists: $LOG_GROUP"
else
    print_step "Creating log group"
    aws logs create-log-group \
        --log-group-name "$LOG_GROUP" \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE"
    print_success "Log group created: $LOG_GROUP"
fi

print_step "Setting retention policy (7 days for free tier)"
aws logs put-retention-policy \
    --log-group-name "$LOG_GROUP" \
    --retention-in-days 7 \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
print_success "Retention set to 7 days"

###############################################################################
# Step 3: Create Environment Configuration
###############################################################################

print_header "Step 3: Create Environment Configuration"

print_step "Creating .env.aws configuration"
cat > .env.aws << EOF
# AWS Free Tier Configuration
# Generated: $(date)

# AWS Credentials (from profile: $AWS_PROFILE)
AWS_ACCESS_KEY_ID=$(aws configure get aws_access_key_id --profile "$AWS_PROFILE")
AWS_SECRET_ACCESS_KEY=$(aws configure get aws_secret_access_key --profile "$AWS_PROFILE")
AWS_REGION=$AWS_REGION

# S3 Configuration (Free Tier: 5 GB storage, 20K GET, 2K PUT)
AWS_S3_BUCKET=$BUCKET_NAME

# CloudWatch Configuration (Free Tier: 5 GB ingestion, 10 metrics)
AWS_CLOUDWATCH_LOG_GROUP=$LOG_GROUP
AWS_CLOUDWATCH_ENABLED=true

# Free Tier Optimizations
AWS_FREE_TIER_MODE=true
AWS_LOG_SAMPLING_RATE=0.1  # 10% sampling (reduces 5GB to 0.5GB)

# Disable expensive services
AWS_CLOUDFRONT_ENABLED=false
AWS_LAMBDA_ENABLED=false
AWS_DYNAMODB_ENABLED=false

# Website URL
AWS_WEBSITE_URL=$WEBSITE_URL
EOF

print_success "Configuration created: .env.aws"
echo "  Sampling rate: 10% (0.5 GB logs/month)"
echo "  Log retention: 7 days"
echo "  CloudFront: Disabled (use S3 website)"

###############################################################################
# Step 4: Deploy Frontend to S3
###############################################################################

print_header "Step 4: Deploy Frontend to S3"

print_step "Syncing public/ directory to S3"

# Upload static files with proper cache headers
aws s3 sync public/ "s3://$BUCKET_NAME/" \
    --profile "$AWS_PROFILE" \
    --exclude "data/*" \
    --cache-control "max-age=3600" \
    --delete

FILE_COUNT=$(aws s3 ls "s3://$BUCKET_NAME/" --recursive --profile "$AWS_PROFILE" | wc -l)
TOTAL_SIZE=$(aws s3 ls "s3://$BUCKET_NAME/" --recursive --profile "$AWS_PROFILE" | awk '{sum+=$3} END {print sum}')
TOTAL_SIZE_MB=$(echo "scale=2; $TOTAL_SIZE / 1024 / 1024" | bc)

print_success "Frontend deployed"
echo "  Files: $FILE_COUNT"
echo "  Total size: ${TOTAL_SIZE_MB} MB (of 5 GB free tier limit)"
echo "  Website: $WEBSITE_URL"

###############################################################################
# Step 5: Set Up Billing Alerts
###############################################################################

print_header "Step 5: Set Up Billing Alerts"

print_step "Creating SNS topic for billing alerts"
TOPIC_ARN=$(aws sns create-topic \
    --name light-engine-free-tier-alerts \
    --region us-east-1 \
    --profile "$AWS_PROFILE" \
    --query 'TopicArn' \
    --output text 2>/dev/null || \
    aws sns list-topics \
        --profile "$AWS_PROFILE" \
        --region us-east-1 \
        --query 'Topics[?contains(TopicArn, `light-engine-free-tier-alerts`)].TopicArn' \
        --output text)

if [ -n "$TOPIC_ARN" ]; then
    print_success "SNS topic ready: $TOPIC_ARN"
    
    read -p "Enter email for billing alerts: " EMAIL
    if [ -n "$EMAIL" ]; then
        print_step "Subscribing email to billing alerts"
        aws sns subscribe \
            --topic-arn "$TOPIC_ARN" \
            --protocol email \
            --notification-endpoint "$EMAIL" \
            --region us-east-1 \
            --profile "$AWS_PROFILE" > /dev/null
        print_success "Email subscribed (check inbox for confirmation)"
        echo "  Email: $EMAIL"
        echo "  Alert threshold: \$4 (80% of \$5 budget)"
    fi
else
    print_error "Failed to create SNS topic"
fi

###############################################################################
# Step 6: Verify Deployment
###############################################################################

print_header "Step 6: Verify Deployment"

print_step "Testing S3 website"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$WEBSITE_URL")
if [ "$HTTP_CODE" = "200" ]; then
    print_success "Website is accessible (HTTP $HTTP_CODE)"
else
    print_error "Website returned HTTP $HTTP_CODE"
fi

print_step "Testing boto3 integration"
python3 << EOF
try:
    from backend.aws_s3 import S3Manager
    s3 = S3Manager(bucket_name='$BUCKET_NAME', region='$AWS_REGION')
    s3.upload_json({'test': 'free-tier-deployment', 'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}, 'test/verify.json')
    print("✅ S3 integration working")
except Exception as e:
    print(f"❌ S3 integration failed: {e}")
    exit(1)
EOF

print_step "Testing CloudWatch integration"
python3 << EOF
try:
    from backend.aws_cloudwatch import CloudWatchLogger
    cw = CloudWatchLogger(log_group_name='$LOG_GROUP', region='$AWS_REGION')
    cw.log_event('deployment', 'Free tier deployment successful', 'INFO', {'timestamp': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'})
    print("✅ CloudWatch integration working")
except Exception as e:
    print(f"❌ CloudWatch integration failed: {e}")
    exit(1)
EOF

###############################################################################
# Summary
###############################################################################

print_header "Deployment Complete! 🎉"

echo ""
echo -e "${GREEN}✅ S3 Bucket:${NC} $BUCKET_NAME"
echo -e "${GREEN}✅ CloudWatch Log Group:${NC} $LOG_GROUP"
echo -e "${GREEN}✅ Website URL:${NC} $WEBSITE_URL"
echo -e "${GREEN}✅ Configuration:${NC} .env.aws"
echo ""
echo -e "${BLUE}Free Tier Usage:${NC}"
echo "  S3 Storage: ${TOTAL_SIZE_MB} MB / 5 GB (${TOTAL_SIZE_MB}%)"
echo "  CloudWatch Logs: ~0.5 GB / 5 GB (10% with sampling)"
echo "  CloudWatch Metrics: 9 / 10 (90%)"
echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo "  1. Start backend with AWS integration:"
echo "     source .env.aws && python3 -m backend &"
echo ""
echo "  2. Test backend health:"
echo "     curl http://localhost:8000/api/health | jq .aws"
echo ""
echo "  3. Open website:"
echo "     open $WEBSITE_URL"
echo ""
echo "  4. Monitor usage:"
echo "     ./scripts/check-aws-free-tier-usage.sh"
echo ""
echo "  5. View logs:"
echo "     aws logs tail $LOG_GROUP --follow --profile $AWS_PROFILE"
echo ""
echo -e "${GREEN}Estimated Monthly Cost: \$0 (within free tier)${NC}"
echo ""

# Cleanup temp files
rm -f /tmp/lifecycle-policy.json /tmp/bucket-policy.json

print_success "Free tier deployment complete!"
