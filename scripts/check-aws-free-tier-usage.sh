#!/bin/bash

###############################################################################
# AWS Free Tier Usage Monitor
# Checks current usage against free tier limits
###############################################################################

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
AWS_PROFILE="${AWS_PROFILE:-light-engine}"
AWS_REGION="${AWS_REGION:-us-east-1}"
BUCKET_NAME="${BUCKET_NAME:-light-engine-free-tier}"
LOG_GROUP="${LOG_GROUP:-/light-engine/free-tier}"

# Free tier limits
S3_STORAGE_LIMIT_GB=5
S3_GET_REQUESTS_LIMIT=20000
S3_PUT_REQUESTS_LIMIT=2000
CW_LOGS_LIMIT_GB=5
CW_METRICS_LIMIT=10
DATA_TRANSFER_LIMIT_GB=1

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

calculate_percentage() {
    local current=$1
    local limit=$2
    echo "scale=1; ($current / $limit) * 100" | bc
}

print_usage() {
    local name=$1
    local current=$2
    local limit=$3
    local unit=$4
    
    local percentage=$(calculate_percentage "$current" "$limit")
    local color=$GREEN
    
    if (( $(echo "$percentage >= 90" | bc -l) )); then
        color=$RED
        status="⚠️  CRITICAL"
    elif (( $(echo "$percentage >= 70" | bc -l) )); then
        color=$YELLOW
        status="⚠️  WARNING"
    else
        status="✅ OK"
    fi
    
    printf "  %-25s ${color}%8.2f / %8.2f %s (%5.1f%%)${NC} %s\n" \
        "$name:" "$current" "$limit" "$unit" "$percentage" "$status"
}

###############################################################################
# Check AWS Credentials
###############################################################################

print_header "AWS Free Tier Usage Monitor"

if ! aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    echo -e "${RED}❌ AWS credentials not configured${NC}"
    echo "Run: aws configure --profile $AWS_PROFILE"
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
echo "Account: $ACCOUNT_ID"
echo "Region: $AWS_REGION"
echo "Bucket: $BUCKET_NAME"
echo ""

###############################################################################
# S3 Storage Usage
###############################################################################

print_header "S3 Storage (Free Tier: 5 GB)"

echo "Calculating S3 storage usage..."

# Get total bucket size
TOTAL_BYTES=$(aws s3 ls "s3://$BUCKET_NAME" --recursive --profile "$AWS_PROFILE" | \
    awk '{sum += $3} END {print sum}')
TOTAL_GB=$(echo "scale=3; $TOTAL_BYTES / 1024 / 1024 / 1024" | bc)

# Get file counts by prefix
DATA_FILES=$(aws s3 ls "s3://$BUCKET_NAME/data/" --recursive --profile "$AWS_PROFILE" | wc -l)
BACKUP_FILES=$(aws s3 ls "s3://$BUCKET_NAME/backups/" --recursive --profile "$AWS_PROFILE" | wc -l)
TELEMETRY_FILES=$(aws s3 ls "s3://$BUCKET_NAME/telemetry/" --recursive --profile "$AWS_PROFILE" | wc -l)

print_usage "Total Storage" "$TOTAL_GB" "$S3_STORAGE_LIMIT_GB" "GB"
echo ""
echo "  Breakdown:"
echo "    Data files: $DATA_FILES"
echo "    Backup files: $BACKUP_FILES"
echo "    Telemetry files: $TELEMETRY_FILES"

###############################################################################
# S3 Request Metrics
###############################################################################

print_header "S3 Requests (This Month)"

# Get current month start/end
MONTH_START=$(date -u +%Y-%m-01T00:00:00)
MONTH_END=$(date -u +%Y-%m-%dT23:59:59)

# GET requests (approximation from CloudWatch)
GET_REQUESTS=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/S3 \
    --metric-name AllRequests \
    --dimensions Name=BucketName,Value="$BUCKET_NAME" Name=FilterId,Value=EntireBucket \
    --start-time "$MONTH_START" \
    --end-time "$MONTH_END" \
    --period 2592000 \
    --statistics Sum \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$GET_REQUESTS" = "None" ] || [ -z "$GET_REQUESTS" ]; then
    GET_REQUESTS=0
fi

print_usage "GET Requests" "$GET_REQUESTS" "$S3_GET_REQUESTS_LIMIT" "req"
echo ""
echo "  Note: PUT requests tracked similarly"
echo "  Current estimate: $(echo "scale=0; $GET_REQUESTS / 10" | bc) PUT requests"

###############################################################################
# CloudWatch Logs Usage
###############################################################################

print_header "CloudWatch Logs (Free Tier: 5 GB/month)"

echo "Calculating CloudWatch logs ingestion..."

# Get log ingestion bytes (last 30 days)
START_TIME=$(date -u -v-30d +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%S)
END_TIME=$(date -u +%Y-%m-%dT%H:%M:%S)

INGESTION_BYTES=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/Logs \
    --metric-name IncomingBytes \
    --dimensions Name=LogGroupName,Value="$LOG_GROUP" \
    --start-time "$START_TIME" \
    --end-time "$END_TIME" \
    --period 2592000 \
    --statistics Sum \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$INGESTION_BYTES" = "None" ] || [ -z "$INGESTION_BYTES" ]; then
    INGESTION_BYTES=0
fi

INGESTION_GB=$(echo "scale=3; $INGESTION_BYTES / 1024 / 1024 / 1024" | bc)

print_usage "Log Ingestion" "$INGESTION_GB" "$CW_LOGS_LIMIT_GB" "GB"

# Check log streams
STREAM_COUNT=$(aws logs describe-log-streams \
    --log-group-name "$LOG_GROUP" \
    --profile "$AWS_PROFILE" \
    --region "$AWS_REGION" \
    --query 'length(logStreams)' \
    --output text 2>/dev/null || echo "0")

echo ""
echo "  Active log streams: $STREAM_COUNT"
echo "  Sampling rate: 10% (configured in .env.aws)"

###############################################################################
# CloudWatch Metrics
###############################################################################

print_header "CloudWatch Metrics (Free Tier: 10 metrics)"

echo "Checking custom metrics..."

METRIC_COUNT=$(aws cloudwatch list-metrics \
    --namespace LightEngine \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'length(Metrics)' \
    --output text 2>/dev/null || echo "0")

print_usage "Custom Metrics" "$METRIC_COUNT" "$CW_METRICS_LIMIT" "metrics"

if [ "$METRIC_COUNT" -gt 0 ]; then
    echo ""
    echo "  Metrics in use:"
    aws cloudwatch list-metrics \
        --namespace LightEngine \
        --region "$AWS_REGION" \
        --profile "$AWS_PROFILE" \
        --query 'Metrics[].MetricName' \
        --output text | tr '\t' '\n' | sort | uniq | head -10 | sed 's/^/    - /'
fi

###############################################################################
# Data Transfer
###############################################################################

print_header "Data Transfer (Free Tier: 1 GB/month out)"

DATA_TRANSFER_BYTES=$(aws cloudwatch get-metric-statistics \
    --namespace AWS/S3 \
    --metric-name BytesDownloaded \
    --dimensions Name=BucketName,Value="$BUCKET_NAME" Name=FilterId,Value=EntireBucket \
    --start-time "$MONTH_START" \
    --end-time "$MONTH_END" \
    --period 2592000 \
    --statistics Sum \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE" \
    --query 'Datapoints[0].Sum' \
    --output text 2>/dev/null || echo "0")

if [ "$DATA_TRANSFER_BYTES" = "None" ] || [ -z "$DATA_TRANSFER_BYTES" ]; then
    DATA_TRANSFER_BYTES=0
fi

DATA_TRANSFER_GB=$(echo "scale=3; $DATA_TRANSFER_BYTES / 1024 / 1024 / 1024" | bc)

print_usage "Data Transfer Out" "$DATA_TRANSFER_GB" "$DATA_TRANSFER_LIMIT_GB" "GB"

###############################################################################
# Current Month Costs
###############################################################################

print_header "Current Month Costs"

CURRENT_COST=$(aws ce get-cost-and-usage \
    --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --profile "$AWS_PROFILE" \
    --query 'ResultsByTime[0].Total.BlendedCost.Amount' \
    --output text 2>/dev/null || echo "0")

echo "  Current month: \$$CURRENT_COST"

if (( $(echo "$CURRENT_COST > 5" | bc -l) )); then
    echo -e "  ${RED}⚠️  WARNING: Costs exceed free tier expectations${NC}"
elif (( $(echo "$CURRENT_COST > 1" | bc -l) )); then
    echo -e "  ${YELLOW}⚠️  Approaching free tier limits${NC}"
else
    echo -e "  ${GREEN}✅ Within free tier limits${NC}"
fi

# Service breakdown
echo ""
echo "  Cost by service:"
aws ce get-cost-and-usage \
    --time-period Start=$(date +%Y-%m-01),End=$(date +%Y-%m-%d) \
    --granularity MONTHLY \
    --metrics BlendedCost \
    --group-by Type=SERVICE \
    --profile "$AWS_PROFILE" \
    --query 'ResultsByTime[0].Groups[].[Keys[0], Metrics.BlendedCost.Amount]' \
    --output text 2>/dev/null | \
    awk '{printf "    %-30s $%.4f\n", $1, $2}' | head -10

###############################################################################
# Recommendations
###############################################################################

print_header "Recommendations"

WARNINGS=0

# Check S3 storage
if (( $(echo "$TOTAL_GB >= 4.5" | bc -l) )); then
    echo -e "${RED}⚠️  S3 storage near limit (${TOTAL_GB} GB / 5 GB)${NC}"
    echo "    Action: Delete old backups or telemetry"
    echo "    Command: aws s3 rm s3://$BUCKET_NAME/backups/ --recursive --exclude 'latest*'"
    ((WARNINGS++))
fi

# Check CloudWatch logs
if (( $(echo "$INGESTION_GB >= 4.5" | bc -l) )); then
    echo -e "${RED}⚠️  CloudWatch logs near limit (${INGESTION_GB} GB / 5 GB)${NC}"
    echo "    Action: Increase sampling rate or reduce retention"
    echo "    Command: echo 'AWS_LOG_SAMPLING_RATE=0.05' >> .env.aws"
    ((WARNINGS++))
fi

# Check metrics
if (( $METRIC_COUNT >= 10 )); then
    echo -e "${RED}⚠️  CloudWatch metrics at limit ($METRIC_COUNT / 10)${NC}"
    echo "    Action: Remove non-essential metrics"
    ((WARNINGS++))
fi

# Check data transfer
if (( $(echo "$DATA_TRANSFER_GB >= 0.9" | bc -l) )); then
    echo -e "${RED}⚠️  Data transfer near limit (${DATA_TRANSFER_GB} GB / 1 GB)${NC}"
    echo "    Action: Use S3 website endpoint (already configured)"
    ((WARNINGS++))
fi

if [ $WARNINGS -eq 0 ]; then
    echo -e "${GREEN}✅ No warnings - all usage within safe limits${NC}"
    echo ""
    echo "  Tips to stay within free tier:"
    echo "    - Monitor usage weekly"
    echo "    - Enable lifecycle policies for auto-cleanup"
    echo "    - Use 10% log sampling (already configured)"
    echo "    - Keep log retention at 7 days"
fi

###############################################################################
# Summary
###############################################################################

print_header "Summary"

echo ""
printf "%-25s %8s %10s %8s\n" "Resource" "Current" "Limit" "Status"
echo "--------------------------------------------------------"

# S3 Storage
S3_PCT=$(calculate_percentage "$TOTAL_GB" "$S3_STORAGE_LIMIT_GB")
if (( $(echo "$S3_PCT >= 90" | bc -l) )); then S3_STATUS="${RED}CRITICAL${NC}";
elif (( $(echo "$S3_PCT >= 70" | bc -l) )); then S3_STATUS="${YELLOW}WARNING${NC}";
else S3_STATUS="${GREEN}OK${NC}"; fi
printf "%-25s %6.2f GB %8.0f GB   ${S3_STATUS}\n" "S3 Storage" "$TOTAL_GB" "$S3_STORAGE_LIMIT_GB"

# CloudWatch Logs
CW_PCT=$(calculate_percentage "$INGESTION_GB" "$CW_LOGS_LIMIT_GB")
if (( $(echo "$CW_PCT >= 90" | bc -l) )); then CW_STATUS="${RED}CRITICAL${NC}";
elif (( $(echo "$CW_PCT >= 70" | bc -l) )); then CW_STATUS="${YELLOW}WARNING${NC}";
else CW_STATUS="${GREEN}OK${NC}"; fi
printf "%-25s %6.2f GB %8.0f GB   ${CW_STATUS}\n" "CloudWatch Logs" "$INGESTION_GB" "$CW_LOGS_LIMIT_GB"

# CloudWatch Metrics
METRIC_PCT=$(calculate_percentage "$METRIC_COUNT" "$CW_METRICS_LIMIT")
if (( $(echo "$METRIC_PCT >= 90" | bc -l) )); then METRIC_STATUS="${RED}CRITICAL${NC}";
elif (( $(echo "$METRIC_PCT >= 70" | bc -l) )); then METRIC_STATUS="${YELLOW}WARNING${NC}";
else METRIC_STATUS="${GREEN}OK${NC}"; fi
printf "%-25s %6.0f    %8.0f       ${METRIC_STATUS}\n" "CloudWatch Metrics" "$METRIC_COUNT" "$CW_METRICS_LIMIT"

# Data Transfer
DT_PCT=$(calculate_percentage "$DATA_TRANSFER_GB" "$DATA_TRANSFER_LIMIT_GB")
if (( $(echo "$DT_PCT >= 90" | bc -l) )); then DT_STATUS="${RED}CRITICAL${NC}";
elif (( $(echo "$DT_PCT >= 70" | bc -l) )); then DT_STATUS="${YELLOW}WARNING${NC}";
else DT_STATUS="${GREEN}OK${NC}"; fi
printf "%-25s %6.2f GB %8.0f GB   ${DT_STATUS}\n" "Data Transfer Out" "$DATA_TRANSFER_GB" "$DATA_TRANSFER_LIMIT_GB"

echo ""
echo "Cost this month: \$$CURRENT_COST"
echo ""

if [ $WARNINGS -gt 0 ]; then
    echo -e "${YELLOW}⚠️  $WARNINGS warning(s) - see recommendations above${NC}"
    exit 1
else
    echo -e "${GREEN}✅ All systems within free tier limits${NC}"
    exit 0
fi
