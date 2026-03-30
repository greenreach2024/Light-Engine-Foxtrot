#!/bin/bash
if [ -z "$1" ]; then
  echo "Usage: ./verify-recipient.sh <email@example.com>"
  echo ""
  echo "SES is in SANDBOX MODE - can only send to verified addresses."
  exit 1
fi

EMAIL="$1"
echo "🔐 Sending verification email to: $EMAIL"
aws ses verify-email-identity --email-address "$EMAIL" --region us-east-1

if [ $? -eq 0 ]; then
  echo "✅ Verification email sent!"
  echo "📧 Check inbox and click the verification link"
else
  echo "❌ Failed to send verification"
fi
