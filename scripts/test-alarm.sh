#!/bin/bash

# Test CloudWatch Alarm Notification System
# This script triggers a test alarm to verify SNS notifications are working

set -e

REGION="us-east-1"
ALARM_NAME="foxtrot-prod-high-cpu"

echo "════════════════════════════════════════════════════════════════"
echo "  CloudWatch Alarm Test - Light Engine Foxtrot"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Check if alarm exists
echo "🔍 Checking alarm status..."
CURRENT_STATE=$(aws cloudwatch describe-alarms \
  --alarm-names "$ALARM_NAME" \
  --region "$REGION" \
  --query 'MetricAlarms[0].StateValue' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$CURRENT_STATE" = "NOT_FOUND" ]; then
  echo "❌ Alarm '$ALARM_NAME' not found!"
  exit 1
fi

echo "✅ Alarm found - Current state: $CURRENT_STATE"
echo ""

# Check SNS subscription status
echo "📧 Checking SNS subscription..."
SNS_ARN="arn:aws:sns:us-east-1:634419072974:foxtrot-production-alerts"
SUBSCRIPTION_STATUS=$(aws sns list-subscriptions-by-topic \
  --topic-arn "$SNS_ARN" \
  --region "$REGION" \
  --query 'Subscriptions[0].SubscriptionArn' \
  --output text 2>/dev/null || echo "NONE")

if [ "$SUBSCRIPTION_STATUS" = "NONE" ] || [ -z "$SUBSCRIPTION_STATUS" ]; then
  echo "⚠️  WARNING: No confirmed subscriptions found!"
  echo "   You must confirm your SNS subscription first."
  echo "   Check email: info@greenreachfarms.com"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
elif [[ "$SUBSCRIPTION_STATUS" == *"PendingConfirmation"* ]]; then
  echo "⚠️  WARNING: Subscription pending confirmation!"
  echo "   Check your email and confirm before testing."
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
else
  echo "✅ Subscription confirmed: ${SUBSCRIPTION_STATUS:0:50}..."
fi

echo ""
echo "🚨 Triggering test alarm..."
echo "   This will set '$ALARM_NAME' to ALARM state"
echo "   You should receive an email notification within 1-2 minutes"
echo ""

# Trigger the alarm
aws cloudwatch set-alarm-state \
  --alarm-name "$ALARM_NAME" \
  --state-value ALARM \
  --state-reason "Manual test of alarm notification system - triggered via test-alarm.sh" \
  --region "$REGION"

echo "✅ Alarm triggered successfully!"
echo ""
echo "📧 Check your email: info@greenreachfarms.com"
echo "   Subject: ALARM: \"$ALARM_NAME\" in US East (N. Virginia)"
echo ""
echo "⏱️  Waiting 10 seconds before resetting..."
sleep 10

echo ""
echo "🔄 Resetting alarm to OK state..."
aws cloudwatch set-alarm-state \
  --alarm-name "$ALARM_NAME" \
  --state-value OK \
  --state-reason "Test complete - alarm reset to OK" \
  --region "$REGION"

echo "✅ Alarm reset to OK"
echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Test Complete!"
echo "════════════════════════════════════════════════════════════════"
echo ""
echo "If you received the email notification, your monitoring is working! ✅"
echo "If not, check:"
echo "  1. Email address is correct in SNS subscription"
echo "  2. SNS subscription is confirmed (not pending)"
echo "  3. Check spam/junk folder"
echo ""
echo "To view alarm history:"
echo "  aws cloudwatch describe-alarm-history --alarm-name $ALARM_NAME --region $REGION"
echo ""
