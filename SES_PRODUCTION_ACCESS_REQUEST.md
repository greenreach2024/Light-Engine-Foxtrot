# AWS SES Production Access Request

## Current Issue

AWS SES is in **SANDBOX MODE**, which means:
- ✅ Can send emails FROM verified addresses (info@greenreachfarms.com)
- ❌ Can ONLY send emails TO verified addresses
- Any unverified recipient emails are silently dropped by SES

## Solution: Request Production Access

### Steps to Request Production Access

1. **Go to AWS Console**
   - Navigate to: https://console.aws.amazon.com/ses/
   - Region: US East (N. Virginia) - us-east-1

2. **Request Production Access**
   - Click "Account dashboard" in the left sidebar
   - Click the "Request production access" button
   - Fill out the form with the following information:

3. **Form Details**
   ```
   Mail Type: Transactional
   
   Website URL: https://greenreachgreens.com
   
   Use Case Description:
   "We operate an agricultural network platform connecting farms with wholesale 
   buyers. We send transactional emails including:
   - Welcome emails to new team members with login credentials
   - Order confirmations to wholesale buyers
   - Notifications to farm operators about orders and inventory
   - System alerts and account updates
   All recipients have explicitly requested to receive these emails as part of 
   using our platform."
   
   Bounce/Complaint Handling:
   "We monitor SES bounce and complaint notifications through SNS. Bounced 
   addresses are automatically flagged and removed from active recipient lists. 
   Complaint addresses are immediately unsubscribed and investigated."
   
   Compliance:
   ✓ Confirm you will only send to recipients who opted in
   ✓ Confirm you have a process to handle bounces and complaints
   ```

4. **Submit Request**
   - AWS typically reviews and approves within 24 hours
   - You may receive follow-up questions via support ticket
   - Check AWS Support Center for updates

## Temporary Workaround (Until Approved)

To send emails to specific recipients before production access:

### Verify Each Recipient Email

```bash
# Verify a single email
./verify-recipient-email.sh recipient@example.com

# Or use AWS CLI directly
aws ses verify-email-identity \
  --email-address recipient@example.com \
  --region us-east-1
```

### Check Verification Status

```bash
aws ses get-identity-verification-attributes \
  --identities recipient@example.com \
  --region us-east-1
```

The recipient will receive an email from AWS with a verification link. They must click it before you can send them emails.

## Current SES Status

```bash
# Check current status
aws sesv2 get-account --region us-east-1

# Current limits:
# - ProductionAccessEnabled: false (SANDBOX MODE)
# - Max24HourSend: 200 emails/day
# - MaxSendRate: 1 email/second
# - SentLast24Hours: 2 emails
```

## After Production Access Approved

Once approved, you can:
- ✅ Send to ANY email address (not just verified ones)
- ✅ Higher sending limits (typically 50,000 emails/day)
- ✅ Higher send rate (typically 14 emails/second)
- ✅ No more manual recipient verification needed

## Verified Addresses (Currently Working)

These addresses are already verified and can receive emails:
- ✅ info@greenreachfarms.com

## Test Email Sent

I successfully sent a test email through SES:
```
MessageId: 0100019bd2d09f64-e1d12c73-f218-4193-8e23-af3a8828b283-000000
From: info@greenreachfarms.com
To: info@greenreachfarms.com
Status: Delivered successfully
```

This confirms SES is working - the issue is only the sandbox restriction on recipient addresses.
