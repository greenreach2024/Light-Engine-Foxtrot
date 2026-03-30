# AWS SES Email Verification Guide

## Current Configuration

The system is configured to send emails via **AWS SES** with:
- **FROM address**: `noreply@lightengine.farm`
- **CC address**: `info@greenreachfarms.com` (on new employee welcome emails)
- **Region**: `us-east-1`
- **Provider**: `ses`

## Required Email Verifications

For emails to be sent successfully, these addresses must be **verified in AWS SES**:

### 1. Verify Sender Address (Required)
**noreply@lightengine.farm** - Must be verified to send emails

### 2. Verify CC Address (Required for Production)
**info@greenreachfarms.com** - Must be verified to receive CC copies

## How to Verify Email Addresses in AWS SES

### Via AWS Console:
1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/home?region=us-east-1#/verified-identities)
2. Click "Create identity"
3. Select "Email address"
4. Enter the email address (e.g., `noreply@lightengine.farm`)
5. Click "Create identity"
6. Check the inbox for verification email
7. Click the verification link in the email

### Via AWS CLI:
```bash
# Verify sender address
aws ses verify-email-identity --email-address noreply@lightengine.farm --region us-east-1

# Verify CC address
aws ses verify-email-identity --email-address info@greenreachfarms.com --region us-east-1
```

### Check Verification Status:
```bash
# List all verified email addresses
aws ses list-verified-email-addresses --region us-east-1

# Check specific identity
aws ses get-identity-verification-attributes \
  --identities noreply@lightengine.farm info@greenreachfarms.com \
  --region us-east-1
```

## Production Mode (Domain Verification)

For production use with ANY email address, verify the entire domain instead:

```bash
# Verify domain (allows sending from any @lightengine.farm address)
aws ses verify-domain-identity --domain lightengine.farm --region us-east-1
```

This will provide TXT records to add to your DNS:
1. Copy the verification token
2. Add TXT record to DNS: `_amazonses.lightengine.farm` with the token value
3. Wait for DNS propagation (up to 48 hours)
4. SES will automatically detect and verify the domain

## Testing Email Configuration

Run the configuration checker:
```bash
node scripts/check-email-config.js
```

Test sending an email:
```bash
node scripts/test-email-service.js your-test-email@example.com
```

## Troubleshooting

### Email Not Sending
1. Check AWS SES verification status in console
2. Check environment variables: `eb printenv light-engine-foxtrot-prod-v2`
3. Check application logs: `eb logs light-engine-foxtrot-prod-v2`
4. Look for email error messages in logs after creating a user

### "Email address not verified" Error
- Both FROM and CC addresses must be verified in SES
- Or move SES out of sandbox mode and verify the domain

### Sandbox Mode Limitations
AWS SES starts in sandbox mode with restrictions:
- Can only send TO verified email addresses
- Maximum 200 emails per 24 hours
- Maximum 1 email per second

**Request Production Access:**
1. Go to [SES Account Dashboard](https://console.aws.amazon.com/ses/home?region=us-east-1#/account)
2. Click "Request production access"
3. Fill out the form with your use case
4. Wait for approval (usually within 24 hours)

## Current Status Check

After deployment, create a test user and check the logs:
```bash
eb logs light-engine-foxtrot-prod-v2 --all | grep -A 10 "SENDING WELCOME EMAIL"
```

You should see:
```
[Admin] ===== SENDING WELCOME EMAIL =====
[Admin] To: newuser@example.com
[Admin] CC: info@greenreachfarms.com
[Admin] From: noreply@lightengine.farm
[Admin] Provider: ses
[Admin] AWS Region: us-east-1
[email] ===== SENDING EMAIL =====
[email] Provider: ses
[email] From: Light Engine Foxtrot <noreply@lightengine.farm>
[email] To: newuser@example.com
[email] CC: info@greenreachfarms.com
[email] SES send success: { messageId: '...', to: 'newuser@example.com' }
[Admin] ✅ Welcome email sent successfully
```

If you see errors about verification, follow the steps above to verify the required email addresses.
