#!/bin/bash
# Verify email addresses in AWS SES for sending

set -e

REGION="us-east-1"
FROM_EMAIL="noreply@lightengine.farm"
CC_EMAIL="info@greenreachfarms.com"

echo "=== Verifying Email Addresses in AWS SES ==="
echo ""
echo "Region: $REGION"
echo "From Email: $FROM_EMAIL"
echo "CC Email: $CC_EMAIL"
echo ""

# Verify sender email
echo "1. Verifying sender address: $FROM_EMAIL"
aws sesv2 create-email-identity --email-identity "$FROM_EMAIL" --region "$REGION" 2>/dev/null || \
  echo "   (Already exists or verification pending)"

# Verify CC email
echo "2. Verifying CC address: $CC_EMAIL"
aws sesv2 create-email-identity --email-identity "$CC_EMAIL" --region "$REGION" 2>/dev/null || \
  echo "   (Already exists or verification pending)"

echo ""
echo "=== Verification Status ==="
echo ""

# Check verification status
aws sesv2 get-email-identity --email-identity "$FROM_EMAIL" --region "$REGION" 2>/dev/null | \
  jq -r '"FROM: " + .VerifiedForSendingStatus' || echo "FROM: Not found"

aws sesv2 get-email-identity --email-identity "$CC_EMAIL" --region "$REGION" 2>/dev/null | \
  jq -r '"CC: " + .VerifiedForSendingStatus' || echo "CC: Not found"

echo ""
echo "=== Action Required ==="
echo ""
echo "Check the inbox for $FROM_EMAIL and $CC_EMAIL"
echo "Click the verification links in the emails from AWS"
echo ""
echo "After verification, test with:"
echo "  node scripts/test-send-email.js"
