# Email Notification Setup Guide
## Production Email Configuration for Light Engine Foxtrot

**Last Updated:** December 31, 2025  
**Status:** Ready for Production Configuration

---

## Overview

Light Engine Foxtrot uses email notifications for:
- **Wholesale orders** - Buyer confirmations, farm notifications, shipping updates
- **Farm sales** - Order confirmations, receipts, subscription reminders
- **Admin alerts** - Security events, system notifications
- **Traceability** - Recall notifications (FDA compliance)

**Supported Providers:**
1. **AWS SES** (Simple Email Service) - Recommended for production
2. **SendGrid** - Alternative, easier setup
3. **SMTP** (Generic) - Any SMTP server including Gmail

---

## Option 1: AWS SES (Recommended)

### Why AWS SES?
- ✅ **Cost-effective** - $0.10 per 1,000 emails
- ✅ **High deliverability** - 99.9% delivery rate
- ✅ **Scalable** - Send millions of emails
- ✅ **Integrated** - Works seamlessly with AWS Elastic Beanstalk
- ✅ **No monthly fee** - Pay only for what you send

### Setup Steps

#### 1. Verify Domain (Recommended) or Email
```bash
# Option A: Verify entire domain (best for production)
# Go to AWS SES Console → Verified Identities → Verify a Domain
# Add these DNS records to your domain:
# - TXT record for domain verification
# - CNAME records for DKIM signing
# - MX record (optional, for receiving)

# Option B: Verify single email (quick start)
# Go to AWS SES Console → Verified Identities → Verify an Email Address
# Check inbox and click verification link
```

**Recommended Domain:** `greenreach.ca` or `lightengine.io`  
**Sender Email:** `noreply@greenreach.ca` or `orders@greenreach.ca`

#### 2. Move Out of Sandbox Mode
AWS SES starts in sandbox mode (limited to verified recipients).

**Request Production Access:**
1. Go to AWS SES Console → Account Dashboard
2. Click "Request Production Access"
3. Fill form:
   - **Use Case:** Transactional emails (order confirmations, notifications)
   - **Website URL:** http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
   - **Estimated Volume:** 1,000 emails/day
   - **Bounce/Complaint Handling:** Automated bounce processing enabled
4. Submit (approval usually within 24 hours)

#### 3. Configure IAM Permissions
Your Elastic Beanstalk instance needs SES permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:GetSendQuota",
        "ses:GetSendStatistics"
      ],
      "Resource": "*"
    }
  ]
}
```

**Apply to EB Instance Role:**
```bash
# Get current instance profile
eb printenv | grep AWS

# Attach SES policy to instance role
aws iam attach-role-policy \
  --role-name aws-elasticbeanstalk-ec2-role \
  --policy-arn arn:aws:iam::aws:policy/AmazonSESFullAccess
```

#### 4. Set Environment Variables
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

# Configure SES
eb setenv \
  EMAIL_PROVIDER=ses \
  EMAIL_ENABLED=true \
  EMAIL_FROM=noreply@greenreach.ca \
  EMAIL_FROM_NAME="GreenReach Farms" \
  AWS_REGION=us-east-1
```

#### 5. Test SES Connection
```bash
# Run test script
node scripts/test-email-service.js
```

**Expected Output:**
```
✅ AWS SES email service initialized (region: us-east-1)
✅ Test email sent to test@example.com
✅ Email ID: 0100018d1a2b3c4d-5e6f7890-1234-5678-9abc-def012345678-000000
```

### SES Cost Estimation

**Monthly Volume:**
- Wholesale orders: 1,500 emails/month
- Farm sales: 2,000 emails/month  
- System notifications: 500 emails/month
- **Total:** 4,000 emails/month

**Cost:** $0.40/month + $0.10/GB data transfer = **~$0.50/month**

---

## Option 2: SendGrid

### Why SendGrid?
- ✅ **Easy setup** - No DNS configuration required
- ✅ **Free tier** - 100 emails/day free forever
- ✅ **Dashboard** - Email analytics and tracking
- ✅ **Templates** - Visual email template builder
- ⚠️ **Cost** - $15/month for 40,000 emails (vs $4 with SES)

### Setup Steps

#### 1. Create SendGrid Account
```bash
# Sign up at https://sendgrid.com/free/
# Select "Free" plan (100 emails/day)
# Or "Essentials" plan ($15/month, 40,000 emails)
```

#### 2. Create API Key
1. Go to SendGrid Dashboard → Settings → API Keys
2. Click "Create API Key"
3. Name: `light-engine-foxtrot-production`
4. Permissions: **Full Access** (or "Mail Send" only)
5. Copy API key (starts with `SG.`)

**⚠️ IMPORTANT:** Save the API key immediately - you can't view it again!

#### 3. Verify Sender Email
1. Go to Settings → Sender Authentication
2. Click "Verify a Single Sender"
3. Fill form:
   - **From Email:** noreply@greenreach.ca
   - **From Name:** GreenReach Farms
   - **Reply To:** support@greenreach.ca
   - **Company:** GreenReach Farms Network
4. Check inbox and verify

#### 4. Set Environment Variables
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

# Configure SendGrid
eb setenv \
  EMAIL_PROVIDER=sendgrid \
  EMAIL_ENABLED=true \
  SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxx \
  EMAIL_FROM=noreply@greenreach.ca \
  EMAIL_FROM_NAME="GreenReach Farms"
```

#### 5. Test SendGrid Connection
```bash
node scripts/test-email-service.js
```

**Expected Output:**
```
✅ SendGrid email service initialized
✅ Test email sent to test@example.com
✅ Message ID: <abc123.456789@sendgrid.com>
```

### SendGrid Cost Comparison

**Free Tier:**
- 100 emails/day = 3,000 emails/month
- Sufficient for testing and pilot launch

**Essentials ($15/month):**
- 40,000 emails/month
- Sufficient for 10+ farms

**Pro ($60/month):**
- 100,000 emails/month
- Advanced analytics

---

## Option 3: Generic SMTP (Gmail, Outlook, etc.)

### Why SMTP?
- ✅ **Quick start** - Use existing email account
- ✅ **No signup** - If you have Gmail/Outlook
- ⚠️ **Limited** - Gmail: 500 emails/day
- ⚠️ **Deliverability** - May be flagged as spam

### Setup with Gmail

#### 1. Enable App Password
1. Go to Google Account → Security
2. Enable 2-Step Verification
3. Go to Security → App Passwords
4. Generate password for "Mail"
5. Copy 16-character password

#### 2. Set Environment Variables
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

eb setenv \
  EMAIL_PROVIDER=smtp \
  EMAIL_ENABLED=true \
  SMTP_HOST=smtp.gmail.com \
  SMTP_PORT=587 \
  SMTP_USER=your-email@gmail.com \
  SMTP_PASS=your-16-char-app-password \
  EMAIL_FROM=your-email@gmail.com \
  EMAIL_FROM_NAME="GreenReach Farms"
```

#### 3. Test SMTP Connection
```bash
node scripts/test-email-service.js
```

### Gmail Limitations
- ⚠️ **500 emails/day limit**
- ⚠️ **May be flagged as spam** (personal account)
- ⚠️ **Not recommended for production**
- ✅ **Good for testing and development**

---

## Email Templates

All email templates are pre-built and ready to use:

### Wholesale System
- ✅ **Order Confirmation** - Buyer receives after placing order
- ✅ **New Order Alert** - Farm receives when order assigned
- ✅ **Deadline Reminder** - Farm receives 6 hours before deadline
- ✅ **Order Modified** - Buyer receives if farm changes quantities
- ✅ **Shipping Notification** - Buyer receives with tracking number
- ✅ **Pickup Ready** - Buyer receives when order ready

### Farm Sales
- ✅ **Order Confirmation** - Customer receives after purchase
- ✅ **Payment Receipt** - Customer receives after payment
- ✅ **Delivery Notification** - Customer receives when shipped
- ✅ **Subscription Reminder** - CSA box delivery reminders

### Traceability
- ✅ **Recall Notification** - Customers receive during FDA recall
- ✅ **Lot Expiration** - Internal alerts for expiring lots

### Admin
- ✅ **Login Alert** - Security notification for admin login
- ✅ **System Error** - Critical error notifications

**Template Locations:**
- Node.js: `/services/wholesale-notification-service.js`
- Python: `/backend/email/templates/`

---

## Testing Email Service

### Test Script
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot

# Test all email functionality
npm run test:email

# Or manually:
node scripts/test-email-service.js
```

### Test Cases
1. ✅ **Connection Test** - Verify provider is reachable
2. ✅ **Single Email** - Send test email to yourself
3. ✅ **Wholesale Order** - Test order confirmation template
4. ✅ **Farm Notification** - Test farm alert template
5. ✅ **Recall Alert** - Test FDA recall notification

### Example Test
```javascript
// scripts/test-email-service.js
import EmailService from './services/email-service.js';

const emailService = new EmailService();

// Test 1: Simple email
await emailService.sendEmail({
  to: 'your-email@example.com',
  subject: 'Test Email from Light Engine',
  html: '<h1>Success!</h1><p>Email service is working.</p>',
  text: 'Success! Email service is working.'
});

console.log('✅ Test email sent!');
```

---

## Production Checklist

### Before Going Live
- [ ] Choose email provider (SES recommended)
- [ ] Verify sender domain or email
- [ ] Move SES out of sandbox mode (if using SES)
- [ ] Set environment variables in EB
- [ ] Test email delivery
- [ ] Check spam score (mail-tester.com)
- [ ] Configure bounce/complaint handling
- [ ] Set up email monitoring

### Recommended Configuration
```bash
# Production-ready settings
EMAIL_PROVIDER=ses
EMAIL_ENABLED=true
EMAIL_FROM=noreply@greenreach.ca
EMAIL_FROM_NAME="GreenReach Farms"
AWS_REGION=us-east-1

# Wholesale notifications
NOTIFICATIONS_FROM_EMAIL=orders@greenreach.ca
APP_URL=http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
```

### Monitoring
```bash
# AWS SES - View send statistics
aws ses get-send-statistics --region us-east-1

# Check bounce/complaint rates (keep below 5%)
aws ses get-account-sending-enabled --region us-east-1
```

---

## Troubleshooting

### Emails Not Sending

**Check 1: Environment Variables**
```bash
eb printenv | grep EMAIL
eb printenv | grep SMTP
eb printenv | grep SENDGRID
```

**Check 2: SES Sandbox Mode**
```bash
# If in sandbox, can only send to verified emails
aws ses get-account-sending-enabled --region us-east-1
# Should return: {"Enabled": true}
```

**Check 3: Application Logs**
```bash
eb logs | grep -i email
```

### Emails Going to Spam

**Solutions:**
1. **Verify domain with SPF/DKIM** (SES/SendGrid handles this)
2. **Use verified sender address**
3. **Avoid spam trigger words** (FREE, URGENT, CLICK HERE)
4. **Include unsubscribe link**
5. **Test with mail-tester.com** (aim for 9+/10 score)

### Rate Limiting

**Gmail:** 500 emails/day  
**SES Sandbox:** 200 emails/day, 1 email/second  
**SES Production:** 50,000 emails/day (increases automatically)  
**SendGrid Free:** 100 emails/day  
**SendGrid Essentials:** 40,000 emails/month

---

## Cost Comparison

| Provider | Setup Time | Monthly Cost | Emails/Month | Best For |
|----------|------------|--------------|--------------|----------|
| **AWS SES** | 30 min | $0.50 | 5,000 | Production (recommended) |
| **SendGrid Free** | 10 min | $0 | 3,000 | Testing & Pilot |
| **SendGrid Essentials** | 10 min | $15 | 40,000 | Small-medium farms |
| **Gmail SMTP** | 5 min | $0 | 500/day | Development only |

**Recommendation:** Start with **SendGrid Free** for testing, then migrate to **AWS SES** for production.

---

## Next Steps

### Immediate (Testing Phase)
1. Sign up for SendGrid Free account
2. Verify sender email
3. Set `SENDGRID_API_KEY` environment variable
4. Run `npm run test:email`
5. Test wholesale order flow

### Before Production Launch
1. Move to AWS SES
2. Verify domain (greenreach.ca)
3. Request production access
4. Configure bounce handling
5. Set up monitoring

### Post-Launch
1. Monitor delivery rates (keep >95%)
2. Check bounce rates (keep <5%)
3. Review spam complaints (keep <0.1%)
4. Scale sending limits as needed

---

## Support

**AWS SES Documentation:** https://docs.aws.amazon.com/ses/  
**SendGrid Documentation:** https://docs.sendgrid.com/  
**Nodemailer Documentation:** https://nodemailer.com/  

**Internal Support:**
- Email service code: `/services/wholesale-notification-service.js`
- Python email service: `/backend/email/email_service.py`
- Test scripts: `/scripts/test-email-service.js`

**Questions?** Refer to AWS SES FAQ or SendGrid support.

---

**Status:** Ready for configuration. Choose provider and follow setup steps above.
