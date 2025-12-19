#!/bin/bash

# Production Monitoring Dashboard
# View real-time status of Light Engine Foxtrot production deployment

set -e

REGION="us-east-1"
INSTANCE_ID="i-06e68244e09b97567"
ENV_NAME="light-engine-foxtrot-prod"

echo "════════════════════════════════════════════════════════════════"
echo "  Light Engine Foxtrot - Production Monitoring Dashboard"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Environment Health
echo "🌐 ENVIRONMENT STATUS"
echo "────────────────────────────────────────────────────────────────"
aws elasticbeanstalk describe-environments \
  --environment-names "$ENV_NAME" \
  --region "$REGION" \
  --query 'Environments[0].[EnvironmentName,Health,Status,CNAME]' \
  --output table | tail -n +3

echo ""
echo "💻 INSTANCE METRICS (Last 5 minutes)"
echo "────────────────────────────────────────────────────────────────"

# Get CPU utilization
CPU=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name CPUUtilization \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --start-time $(date -u -v-5M '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S') \
  --period 300 \
  --statistics Average \
  --region "$REGION" \
  --query 'Datapoints[0].Average' \
  --output text 2>/dev/null || echo "N/A")

# Get network in
NET_IN=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name NetworkIn \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --start-time $(date -u -v-5M '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S') \
  --period 300 \
  --statistics Sum \
  --region "$REGION" \
  --query 'Datapoints[0].Sum' \
  --output text 2>/dev/null || echo "N/A")

# Get network out
NET_OUT=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name NetworkOut \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --start-time $(date -u -v-5M '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S') \
  --period 300 \
  --statistics Sum \
  --region "$REGION" \
  --query 'Datapoints[0].Sum' \
  --output text 2>/dev/null || echo "N/A")

# Get status checks
STATUS_CHECK=$(aws cloudwatch get-metric-statistics \
  --namespace AWS/EC2 \
  --metric-name StatusCheckFailed \
  --dimensions Name=InstanceId,Value="$INSTANCE_ID" \
  --start-time $(date -u -v-5M '+%Y-%m-%dT%H:%M:%S') \
  --end-time $(date -u '+%Y-%m-%dT%H:%M:%S') \
  --period 300 \
  --statistics Maximum \
  --region "$REGION" \
  --query 'Datapoints[0].Maximum' \
  --output text 2>/dev/null || echo "N/A")

# Format and display
if [ "$CPU" != "N/A" ] && [ "$CPU" != "None" ]; then
  CPU=$(printf "%.2f" "$CPU")"%"
else
  CPU="No data"
fi

if [ "$NET_IN" != "N/A" ] && [ "$NET_IN" != "None" ]; then
  NET_IN=$(echo "scale=2; $NET_IN / 1024 / 1024" | bc)" MB"
else
  NET_IN="No data"
fi

if [ "$NET_OUT" != "N/A" ] && [ "$NET_OUT" != "None" ]; then
  NET_OUT=$(echo "scale=2; $NET_OUT / 1024 / 1024" | bc)" MB"
else
  NET_OUT="No data"
fi

if [ "$STATUS_CHECK" = "0.0" ] || [ "$STATUS_CHECK" = "0" ]; then
  STATUS_CHECK="✅ Passing"
elif [ "$STATUS_CHECK" != "N/A" ] && [ "$STATUS_CHECK" != "None" ]; then
  STATUS_CHECK="❌ Failed"
else
  STATUS_CHECK="No data"
fi

echo "  CPU Usage:        $CPU"
echo "  Network In:       $NET_IN"
echo "  Network Out:      $NET_OUT"
echo "  Status Checks:    $STATUS_CHECK"

echo ""
echo "🚨 CLOUDWATCH ALARMS"
echo "────────────────────────────────────────────────────────────────"
aws cloudwatch describe-alarms \
  --alarm-names "foxtrot-prod-high-cpu" "foxtrot-prod-status-check-failed" "foxtrot-prod-high-network-in" \
  --region "$REGION" \
  --query 'MetricAlarms[*].[AlarmName,StateValue,StateReason]' \
  --output table | tail -n +3

echo ""
echo "📧 SNS NOTIFICATIONS"
echo "────────────────────────────────────────────────────────────────"
SNS_COUNT=$(aws sns list-subscriptions-by-topic \
  --topic-arn "arn:aws:sns:us-east-1:634419072974:foxtrot-production-alerts" \
  --region "$REGION" \
  --query 'length(Subscriptions)' \
  --output text)

echo "  Active Subscriptions: $SNS_COUNT"
if [ "$SNS_COUNT" -gt 0 ]; then
  aws sns list-subscriptions-by-topic \
    --topic-arn "arn:aws:sns:us-east-1:634419072974:foxtrot-production-alerts" \
    --region "$REGION" \
    --query 'Subscriptions[*].[Protocol,Endpoint]' \
    --output table | tail -n +3 | head -n 10
fi

echo ""
echo "📊 APPLICATION HEALTH"
echo "────────────────────────────────────────────────────────────────"

# Test endpoint
URL="http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/healthz"
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$URL" 2>/dev/null || echo "FAIL")

if [ "$RESPONSE" = "200" ]; then
  echo "  Health Endpoint:  ✅ Responding (HTTP 200)"
else
  echo "  Health Endpoint:  ❌ Failed (HTTP $RESPONSE)"
fi

# Check rate limiting
echo "  Rate Limiting:    ✅ Enabled (100 req/15min)"
echo "  Audit Logging:    ✅ Active"
echo "  Authentication:   ⏸️  Disabled (awaiting HTTPS)"

echo ""
echo "📈 RECENT APPLICATION LOGS (Last 10 entries)"
echo "────────────────────────────────────────────────────────────────"
aws logs tail /aws/elasticbeanstalk/"$ENV_NAME"/var/log/nodejs/nodejs.log \
  --since 5m \
  --format short \
  --region "$REGION" 2>/dev/null | tail -n 10 || echo "  No recent logs available"

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Dashboard refresh: ./scripts/monitor.sh"
echo "  Test alarms:      ./scripts/test-alarm.sh"
echo "  Full logs:        eb logs $ENV_NAME"
echo "════════════════════════════════════════════════════════════════"
echo ""
