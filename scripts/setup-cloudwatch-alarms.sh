#!/bin/bash
##############################################################################
# CloudWatch Alarms Setup Script
#
# This script creates CloudWatch alarms for monitoring security events
# and application health.
#
# Usage:
#   chmod +x scripts/setup-cloudwatch-alarms.sh
#   ./scripts/setup-cloudwatch-alarms.sh <SNS_TOPIC_ARN>
#
# Example:
#   ./scripts/setup-cloudwatch-alarms.sh arn:aws:sns:us-east-1:123456789012:alerts
##############################################################################

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

# Configuration
REGION="us-east-1"
SNS_TOPIC_ARN="${1:-}"

echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  CloudWatch Alarms Setup${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    exit 1
fi

# Prompt for SNS topic if not provided
if [ -z "$SNS_TOPIC_ARN" ]; then
    echo -e "${YELLOW}⚠️  No SNS topic provided${NC}"
    echo ""
    echo "Create SNS topic first:"
    echo "  aws sns create-topic --name foxtrot-alerts --region $REGION"
    echo ""
    read -p "Enter SNS Topic ARN (or press Enter to skip notifications): " SNS_TOPIC_ARN
fi

# Prepare alarm actions
if [ -n "$SNS_TOPIC_ARN" ]; then
    ALARM_ACTIONS="--alarm-actions $SNS_TOPIC_ARN"
    echo -e "${GREEN}✅ Notifications will be sent to: $SNS_TOPIC_ARN${NC}"
else
    ALARM_ACTIONS=""
    echo -e "${YELLOW}⚠️  No notifications configured${NC}"
fi

# Get Load Balancer name for metrics
echo ""
echo -e "${YELLOW}🔍 Finding load balancer for metrics...${NC}"
LB_NAME=$(aws elbv2 describe-load-balancers \
    --region "$REGION" \
    --query "LoadBalancers[?contains(LoadBalancerName, 'awseb')].LoadBalancerName" \
    --output text | head -n 1)

if [ -z "$LB_NAME" ]; then
    echo -e "${RED}❌ Load balancer not found${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Found load balancer: $LB_NAME${NC}"

echo ""
echo -e "${YELLOW}📊 Creating CloudWatch alarms...${NC}"

# Alarm 1: High Error Rate (5xx errors)
echo -e "${BLUE}Creating alarm: High 5xx Error Rate${NC}"
aws cloudwatch put-metric-alarm \
    --alarm-name "foxtrot-high-5xx-errors" \
    --alarm-description "Alert when application returns many 5xx errors" \
    --metric-name HTTPCode_Target_5XX_Count \
    --namespace AWS/ApplicationELB \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 50 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="$LB_NAME" \
    --region "$REGION" \
    $ALARM_ACTIONS

echo -e "${GREEN}  ✅ High 5xx Error Rate alarm created${NC}"

# Alarm 2: High CPU Usage
echo -e "${BLUE}Creating alarm: High CPU Usage${NC}"
aws cloudwatch put-metric-alarm \
    --alarm-name "foxtrot-high-cpu" \
    --alarm-description "Alert when instance CPU is high" \
    --metric-name CPUUtilization \
    --namespace AWS/EC2 \
    --statistic Average \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 80 \
    --comparison-operator GreaterThanThreshold \
    --region "$REGION" \
    $ALARM_ACTIONS

echo -e "${GREEN}  ✅ High CPU Usage alarm created${NC}"

# Alarm 3: WAF Blocked Requests
echo -e "${BLUE}Creating alarm: High WAF Blocks${NC}"
aws cloudwatch put-metric-alarm \
    --alarm-name "foxtrot-waf-high-blocks" \
    --alarm-description "Alert when WAF blocks many requests" \
    --metric-name BlockedRequests \
    --namespace AWS/WAFV2 \
    --statistic Sum \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 1000 \
    --comparison-operator GreaterThanThreshold \
    --region "$REGION" \
    $ALARM_ACTIONS

echo -e "${GREEN}  ✅ High WAF Blocks alarm created${NC}"

# Alarm 4: Request Latency
echo -e "${BLUE}Creating alarm: High Request Latency${NC}"
aws cloudwatch put-metric-alarm \
    --alarm-name "foxtrot-high-latency" \
    --alarm-description "Alert when response time is slow" \
    --metric-name TargetResponseTime \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 300 \
    --evaluation-periods 2 \
    --threshold 2.0 \
    --comparison-operator GreaterThanThreshold \
    --dimensions Name=LoadBalancer,Value="$LB_NAME" \
    --region "$REGION" \
    $ALARM_ACTIONS

echo -e "${GREEN}  ✅ High Request Latency alarm created${NC}"

# Alarm 5: Unhealthy Target Count
echo -e "${BLUE}Creating alarm: Unhealthy Targets${NC}"
aws cloudwatch put-metric-alarm \
    --alarm-name "foxtrot-unhealthy-targets" \
    --alarm-description "Alert when targets become unhealthy" \
    --metric-name UnHealthyHostCount \
    --namespace AWS/ApplicationELB \
    --statistic Average \
    --period 60 \
    --evaluation-periods 2 \
    --threshold 1 \
    --comparison-operator GreaterThanOrEqualToThreshold \
    --dimensions Name=LoadBalancer,Value="$LB_NAME" \
    --region "$REGION" \
    $ALARM_ACTIONS

echo -e "${GREEN}  ✅ Unhealthy Targets alarm created${NC}"

# Summary
echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  CloudWatch Alarms Created${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════════${NC}"
echo ""
echo "✅ High 5xx Error Rate (>50 errors in 10 min)"
echo "✅ High CPU Usage (>80% for 10 min)"
echo "✅ High WAF Blocks (>1000 blocks in 10 min)"
echo "✅ High Request Latency (>2s average for 10 min)"
echo "✅ Unhealthy Targets (any unhealthy for 2 min)"
echo ""

if [ -n "$SNS_TOPIC_ARN" ]; then
    echo "📧 Notifications: $SNS_TOPIC_ARN"
    echo ""
    echo "Test notifications:"
    echo "  aws sns publish \\"
    echo "    --topic-arn $SNS_TOPIC_ARN \\"
    echo "    --subject 'Test Alert' \\"
    echo "    --message 'This is a test notification'"
else
    echo "⚠️  No notifications configured"
    echo "Add notifications:"
    echo "  1. Create SNS topic"
    echo "  2. Subscribe email/SMS to topic"
    echo "  3. Re-run this script with topic ARN"
fi

echo ""
echo "View alarms:"
echo "  https://console.aws.amazon.com/cloudwatch/home?region=$REGION#alarmsV2:"
echo ""
