#!/bin/bash
# Verify a recipient email address in AWS SES (required in sandbox mode)

if [ -z "$1" ]; then
  echo "Usage: ./verify-recipient-email.sh <email@example.com>"
  echo ""
  echo "SES is currently in SANDBOX MODE - can only send to verified addresses."
  echo "This script sends a verification email to the recipient."
  echo "They must click the link in that email before you can send them welcome emails."
  exit 1
fi

EMAIL="$1"

echo "🔐 Verifying recipient email in AWS SES..."
echo "Email: $EMAIL"
echo ""

aws ses verify-email-identity --email-address "$EMAIL" --region us-east-1

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Verification email sent to: $EMAIL"
  echo ""
  echo "📧 Next steps:"
  echo "1. Check the inbox for $EMAIL"
  echo "2. Click the verification link in the email from AWS"
  echo "3. Once verified, you can send welcome emails to this address"
  echo ""
  echo "To check verification status:"
  echo "  aws ses get-identity-verification-attributes --identities $EMAIL --region us-east-1"
else
  echo ""
  echo "❌ Failed to send verification email"
fi
