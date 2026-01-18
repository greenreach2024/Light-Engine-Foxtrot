#!/bin/bash
# Verify info@greenreachfarms.com in AWS SES for CC functionality

set -e

echo "=========================================="
echo "Verifying info@greenreachfarms.com in AWS SES"
echo "=========================================="
echo ""

# Verify the email address
echo "Sending verification request to AWS SES..."
aws ses verify-email-identity \
  --email-address info@greenreachfarms.com \
  --region us-east-1

echo ""
echo "✅ Verification email sent to info@greenreachfarms.com"
echo ""
echo "⚠️  IMPORTANT: Check the inbox for info@greenreachfarms.com"
echo "   You must click the verification link in the email from AWS."
echo ""
echo "Checking current verification status..."
echo ""

# Check verification status
aws ses get-identity-verification-attributes \
  --identities info@greenreachfarms.com \
  --region us-east-1

echo ""
echo "=========================================="
echo "After clicking the verification link, run this to confirm:"
echo "  aws ses get-identity-verification-attributes --identities info@greenreachfarms.com --region us-east-1"
echo "=========================================="
