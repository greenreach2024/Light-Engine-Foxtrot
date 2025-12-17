#!/bin/bash

###############################################################################
# AWS Integration Test Suite
# Tests S3 storage, CloudWatch logging, and backend API endpoints
###############################################################################

set -e  # Exit on error

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:8000}"
AWS_PROFILE="${AWS_PROFILE:-light-engine}"
S3_BUCKET="${S3_BUCKET:-light-engine-data-production}"
LOG_GROUP="${LOG_GROUP:-/light-engine/production}"
TENANT_ID="test-tenant-$(date +%s)"

# Counters
TESTS_PASSED=0
TESTS_FAILED=0

###############################################################################
# Helper Functions
###############################################################################

print_header() {
    echo ""
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_test() {
    echo -e "${YELLOW}➜ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
    ((TESTS_PASSED++))
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
    ((TESTS_FAILED++))
}

check_dependency() {
    if ! command -v "$1" &> /dev/null; then
        print_error "Required command not found: $1"
        echo "Install with: $2"
        exit 1
    fi
}

wait_for_backend() {
    echo -e "${YELLOW}⏳ Waiting for backend to start...${NC}"
    for i in {1..30}; do
        if curl -s "${BACKEND_URL}/" > /dev/null 2>&1; then
            print_success "Backend is ready"
            return 0
        fi
        sleep 1
    done
    print_error "Backend failed to start"
    return 1
}

###############################################################################
# Pre-flight Checks
###############################################################################

print_header "Pre-flight Checks"

print_test "Checking dependencies"
check_dependency "curl" "apt-get install curl (Linux) or brew install curl (macOS)"
check_dependency "python3" "apt-get install python3 (Linux) or brew install python3 (macOS)"
check_dependency "aws" "brew install awscli (macOS) or pip install awscli"
check_dependency "jq" "brew install jq (macOS) or apt-get install jq (Linux)"
print_success "All dependencies installed"

print_test "Checking AWS credentials"
if aws sts get-caller-identity --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    AWS_ACCOUNT=$(aws sts get-caller-identity --profile "$AWS_PROFILE" --query Account --output text)
    print_success "AWS credentials valid (Account: $AWS_ACCOUNT)"
else
    print_error "AWS credentials not configured"
    echo "Run: aws configure --profile $AWS_PROFILE"
    exit 1
fi

print_test "Checking S3 bucket"
if aws s3 ls "s3://$S3_BUCKET" --profile "$AWS_PROFILE" > /dev/null 2>&1; then
    print_success "S3 bucket accessible: $S3_BUCKET"
else
    print_error "S3 bucket not accessible: $S3_BUCKET"
    echo "Create with: aws s3 mb s3://$S3_BUCKET --profile $AWS_PROFILE"
    exit 1
fi

print_test "Checking CloudWatch log group"
if aws logs describe-log-groups \
    --log-group-name-prefix "$LOG_GROUP" \
    --profile "$AWS_PROFILE" \
    --region us-east-1 | grep -q "$LOG_GROUP"; then
    print_success "CloudWatch log group exists: $LOG_GROUP"
else
    print_error "CloudWatch log group not found: $LOG_GROUP"
    echo "Create with: aws logs create-log-group --log-group-name $LOG_GROUP --profile $AWS_PROFILE"
    exit 1
fi

print_test "Checking backend server"
if wait_for_backend; then
    print_success "Backend server is running"
else
    print_error "Backend server is not running"
    echo "Start with: python3 -m backend &"
    exit 1
fi

###############################################################################
# Backend Health Checks
###############################################################################

print_header "Backend Health Checks"

print_test "Testing root endpoint"
RESPONSE=$(curl -s "${BACKEND_URL}/")
if echo "$RESPONSE" | jq -e '.status == "ok"' > /dev/null 2>&1; then
    print_success "Root endpoint responding"
    
    AWS_ENABLED=$(echo "$RESPONSE" | jq -r '.aws_enabled')
    S3_ENABLED=$(echo "$RESPONSE" | jq -r '.features.s3_storage')
    CW_ENABLED=$(echo "$RESPONSE" | jq -r '.features.cloudwatch_logging')
    
    echo "  AWS Enabled: $AWS_ENABLED"
    echo "  S3 Storage: $S3_ENABLED"
    echo "  CloudWatch: $CW_ENABLED"
else
    print_error "Root endpoint failed"
fi

print_test "Testing health endpoint"
RESPONSE=$(curl -s "${BACKEND_URL}/api/health")
if echo "$RESPONSE" | jq -e '.status == "healthy"' > /dev/null 2>&1; then
    print_success "Health endpoint healthy"
    
    S3_STATUS=$(echo "$RESPONSE" | jq -r '.aws.s3')
    CW_STATUS=$(echo "$RESPONSE" | jq -r '.aws.cloudwatch')
    
    echo "  S3 Status: $S3_STATUS"
    echo "  CloudWatch Status: $CW_STATUS"
else
    print_error "Health endpoint failed"
fi

###############################################################################
# S3 Integration Tests
###############################################################################

print_header "S3 Integration Tests"

print_test "Testing tenant backup endpoint"
BACKUP_DATA='{
    "devices": [
        {"id": "grow3-001", "name": "Veg Room Light 1", "status": "online"},
        {"id": "grow3-002", "name": "Veg Room Light 2", "status": "online"}
    ],
    "groups": [
        {"id": "group-001", "name": "Veg Room", "device_count": 2}
    ],
    "automation_rules": [
        {"id": "rule-001", "name": "Morning Lights On", "enabled": true}
    ]
}'

RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/tenants/${TENANT_ID}/backup" \
    -H "Content-Type: application/json" \
    -d "$BACKUP_DATA")

if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
    print_success "Tenant backup created"
    BACKUP_TIME=$(echo "$RESPONSE" | jq -r '.backup_timestamp')
    echo "  Backup timestamp: $BACKUP_TIME"
else
    print_error "Tenant backup failed"
    echo "  Response: $RESPONSE"
fi

print_test "Verifying backup in S3"
sleep 2  # Wait for S3 eventual consistency
BACKUP_PREFIX="tenants/${TENANT_ID}/backups/"
BACKUP_COUNT=$(aws s3 ls "s3://${S3_BUCKET}/${BACKUP_PREFIX}" \
    --profile "$AWS_PROFILE" \
    --recursive | wc -l)

if [ "$BACKUP_COUNT" -gt 0 ]; then
    print_success "Backup found in S3 ($BACKUP_COUNT files)"
    aws s3 ls "s3://${S3_BUCKET}/${BACKUP_PREFIX}" --profile "$AWS_PROFILE" --recursive
else
    print_error "Backup not found in S3"
fi

print_test "Testing telemetry save endpoint"
TELEMETRY_DATA='{
    "timestamp": "'$(date -u +%Y-%m-%dT%H:%M:%SZ)'",
    "metrics": {
        "temperature": 22.5,
        "humidity": 65.0,
        "co2": 1200,
        "ppfd": 850,
        "vpd": 1.2
    }
}'

RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/tenants/${TENANT_ID}/telemetry?scope=zone-alpha" \
    -H "Content-Type: application/json" \
    -d "$TELEMETRY_DATA")

if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
    print_success "Telemetry saved"
else
    print_error "Telemetry save failed"
    echo "  Response: $RESPONSE"
fi

print_test "Listing telemetry files"
RESPONSE=$(curl -s "${BACKEND_URL}/api/tenants/${TENANT_ID}/telemetry")
if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
    FILE_COUNT=$(echo "$RESPONSE" | jq -r '.count')
    print_success "Telemetry listing successful ($FILE_COUNT files)"
else
    print_error "Telemetry listing failed"
fi

###############################################################################
# CloudWatch Integration Tests
###############################################################################

print_header "CloudWatch Integration Tests"

print_test "Testing device event logging"
EVENT_DATA='{
    "tenant_id": "'${TENANT_ID}'",
    "event_type": "connected",
    "details": {
        "ip": "192.168.2.100",
        "firmware": "2.1.0",
        "type": "Grow3"
    }
}'

RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/devices/grow3-test-001/events" \
    -H "Content-Type: application/json" \
    -d "$EVENT_DATA")

if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
    print_success "Device event logged"
else
    print_error "Device event logging failed"
    echo "  Response: $RESPONSE"
fi

print_test "Testing automation execution logging"
AUTO_DATA='{
    "tenant_id": "'${TENANT_ID}'",
    "action": "Set lights to 80%",
    "success": true,
    "details": {
        "devices_affected": 5,
        "duration_ms": 1200
    }
}'

RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/automation/rule-test-001/log" \
    -H "Content-Type: application/json" \
    -d "$AUTO_DATA")

if echo "$RESPONSE" | jq -e '.status == "logged"' > /dev/null 2>&1; then
    print_success "Automation execution logged"
else
    print_error "Automation logging failed"
    echo "  Response: $RESPONSE"
fi

print_test "Testing usage metrics"
METRICS_DATA='{
    "api_calls": 1234,
    "storage_bytes": 5500000000,
    "device_count": 10
}'

RESPONSE=$(curl -s -X POST "${BACKEND_URL}/api/tenants/${TENANT_ID}/metrics" \
    -H "Content-Type: application/json" \
    -d "$METRICS_DATA")

if echo "$RESPONSE" | jq -e '.status == "success"' > /dev/null 2>&1; then
    print_success "Usage metrics sent"
    METRICS=$(echo "$RESPONSE" | jq -r '.metrics_sent | join(", ")')
    echo "  Metrics: $METRICS"
else
    print_error "Usage metrics failed"
    echo "  Response: $RESPONSE"
fi

print_test "Verifying logs in CloudWatch"
sleep 3  # Wait for CloudWatch ingestion
DATE=$(date +%Y-%m-%d)
STREAM_NAME="${DATE}/api-requests"

LOG_COUNT=$(aws logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name-prefix "$STREAM_NAME" \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --start-time $(($(date +%s) - 300)) \
    --query 'events | length(@)' \
    --output text 2>/dev/null || echo "0")

if [ "$LOG_COUNT" -gt 0 ]; then
    print_success "Logs found in CloudWatch ($LOG_COUNT events)"
else
    print_error "No logs found in CloudWatch"
fi

###############################################################################
# API Request Logging Tests
###############################################################################

print_header "API Request Logging Tests"

print_test "Making test API requests"
for i in {1..5}; do
    curl -s "${BACKEND_URL}/api/health" \
        -H "X-Tenant-ID: ${TENANT_ID}" > /dev/null
    echo -n "."
done
echo ""
print_success "Test requests completed"

print_test "Checking request logs"
sleep 3  # Wait for CloudWatch
LOG_COUNT=$(aws logs filter-log-events \
    --log-group-name "$LOG_GROUP" \
    --log-stream-name-prefix "${DATE}/api-requests" \
    --filter-pattern "{ $.metadata.tenant_id = \"${TENANT_ID}\" }" \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --start-time $(($(date +%s) - 300)) \
    --query 'events | length(@)' \
    --output text 2>/dev/null || echo "0")

if [ "$LOG_COUNT" -gt 0 ]; then
    print_success "Request logs captured ($LOG_COUNT events)"
else
    print_error "Request logs not found"
fi

###############################################################################
# CloudWatch Metrics Tests
###############################################################################

print_header "CloudWatch Metrics Tests"

print_test "Checking custom metrics in CloudWatch"
METRICS=$(aws cloudwatch list-metrics \
    --namespace LightEngine \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --query 'Metrics[].MetricName' \
    --output text 2>/dev/null || echo "")

if [ -n "$METRICS" ]; then
    METRIC_COUNT=$(echo "$METRICS" | wc -w)
    print_success "Custom metrics found ($METRIC_COUNT metrics)"
    echo "  Metrics: $METRICS"
else
    print_error "No custom metrics found"
fi

print_test "Checking API response time metric"
METRIC_DATA=$(aws cloudwatch get-metric-statistics \
    --namespace LightEngine \
    --metric-name APIResponseTime \
    --start-time $(date -u -v-5M +%Y-%m-%dT%H:%M:%S 2>/dev/null || date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%S) \
    --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
    --period 300 \
    --statistics Average \
    --profile "$AWS_PROFILE" \
    --region us-east-1 \
    --query 'Datapoints | length(@)' \
    --output text 2>/dev/null || echo "0")

if [ "$METRIC_DATA" -gt 0 ]; then
    print_success "Response time metrics recorded"
else
    print_error "No response time metrics found"
fi

###############################################################################
# Cleanup
###############################################################################

print_header "Cleanup"

print_test "Cleaning up test data from S3"
aws s3 rm "s3://${S3_BUCKET}/tenants/${TENANT_ID}/" \
    --recursive \
    --profile "$AWS_PROFILE" > /dev/null 2>&1
print_success "Test data cleaned up"

###############################################################################
# Summary
###############################################################################

print_header "Test Summary"

TOTAL_TESTS=$((TESTS_PASSED + TESTS_FAILED))
SUCCESS_RATE=$((TESTS_PASSED * 100 / TOTAL_TESTS))

echo ""
echo -e "${GREEN}✅ Passed: $TESTS_PASSED${NC}"
echo -e "${RED}❌ Failed: $TESTS_FAILED${NC}"
echo -e "${BLUE}📊 Total:  $TOTAL_TESTS${NC}"
echo -e "${BLUE}🎯 Success Rate: ${SUCCESS_RATE}%${NC}"
echo ""

if [ "$TESTS_FAILED" -eq 0 ]; then
    echo -e "${GREEN}🎉 All tests passed! AWS integration is working correctly.${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some tests failed. Check the output above for details.${NC}"
    exit 1
fi
