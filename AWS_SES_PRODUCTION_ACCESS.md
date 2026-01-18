# AWS SES Production Access Request Guide

## Current Status: SANDBOX MODE ❌

Your AWS SES account is currently in **Sandbox Mode**, which means:
- ✅ You CAN send emails FROM verified addresses (noreply@lightengine.farm, info@greenreachfarms.com)
- ❌ You can ONLY send emails TO verified/pre-verified email addresses
- ❌ New users must be pre-verified before receiving welcome emails
- ❌ Sending limit: 200 emails/day, 1 email/second

## Solution: Request Production Access

### Benefits of Production Access:
- ✅ Send emails to ANY email address (no pre-verification needed)
- ✅ Higher sending limits (50,000 emails/day initially)
- ✅ Better user experience (no AWS verification emails for new users)
- ✅ Can verify domains instead of individual emails

### How to Request Production Access:

#### Step 1: Prepare Your Request

AWS requires this information:
1. **Use Case Description**: "Internal employee onboarding and communication"
2. **Expected Send Volume**: "500 emails/month for employee onboarding and notifications"
3. **Bounce/Complaint Handling**: "We have implemented bounce and complaint handling"
4. **Opt-out Process**: "All emails include unsubscribe links (for marketing) or are transactional"

#### Step 2: Submit Request via AWS Console

1. Go to [AWS SES Console](https://console.aws.amazon.com/ses/home?region=us-east-1)
2. Click **"Account dashboard"** in left menu
3. Click **"Request production access"** button
4. Fill out the form:
   - **Email address**: info@greenreachfarms.com
   - **Use case**: Employee onboarding and internal communication
   - **Website URL** (optional): https://greenreachgreens.com
   - **Estimated emails per day**: 50
   - **Bounce handling**: Yes (implemented)
   - **Complaint handling**: Yes (implemented)

#### Step 3: Via AWS CLI (Alternative)

```bash
aws sesv2 put-account-details \
  --region us-east-1 \
  --production-access-enabled \
  --mail-type TRANSACTIONAL \
  --website-url "https://greenreachgreens.com" \
  --use-case-description "Employee onboarding system - sending welcome emails with temporary passwords to new GreenReach team members. Transactional emails only (no marketing)." \
  --additional-contact-email-addresses "info@greenreachfarms.com"
```

#### Step 4: Wait for Approval

- **Timeline**: Usually 24-48 hours
- **Notification**: Email to your AWS root account email
- **Follow-up**: Check AWS Support Center for case updates

### After Production Access is Granted:

1. **Remove individual email verifications** - No longer needed
2. **Verify your domain** (optional but recommended):
   ```bash
   # Verify greenreachgreens.com domain
   aws sesv2 create-email-identity \
     --region us-east-1 \
     --email-identity greenreachgreens.com
   
   # Get DNS records to add
   aws sesv2 get-email-identity \
     --region us-east-1 \
     --email-identity greenreachgreens.com
   ```
3. **Update DNS records** with DKIM and verification records
4. **Test sending** to unverified emails

## Current Workaround (Until Production Access)

Since you're in sandbox mode, here are your options:

### Option 1: Pre-verify Employee Emails
If you know the email addresses of new employees:
```bash
./scripts/verify-ses-email.sh employee@email.com
```

### Option 2: Manual Password Sharing
The system now returns the `temp_password` in the API response. You can:
1. Copy the password from the response
2. Manually send it to the new user via Slack/text/call
3. They can log in immediately

### Option 3: Use Alternative Email Provider
Switch to SendGrid or SMTP (no sandbox restrictions):
```bash
# Set environment variable
EMAIL_PROVIDER=sendgrid
SENDGRID_API_KEY=your_key_here
```

## Check Current Status

```bash
# Check if production access is enabled
aws sesv2 get-account --region us-east-1 --query 'ProductionAccessEnabled'

# Check sending limits
aws ses get-send-quota --region us-east-1

# List verified identities
aws ses list-identities --region us-east-1
```

## FAQ

**Q: How long does production access take?**
A: Usually 24-48 hours. AWS may ask follow-up questions.

**Q: Will I lose verified emails if I get production access?**
A: No, all current verifications remain. You just won't need to verify new recipients.

**Q: Can I verify a domain instead of individual emails?**
A: Yes, after production access. Verifying `greenreachgreens.com` allows sending to any `*@greenreachgreens.com` address.

**Q: What's the difference between sandbox and production?**
A: Sandbox requires pre-verified recipients. Production allows sending to anyone.

## Current Configuration

- **Region**: us-east-1
- **Provider**: AWS SES
- **Production Access**: ❌ False (Sandbox Mode)
- **Verified Identities**: 5 email addresses (see `aws ses list-identities`)
- **Daily Limit**: 200 emails/day (sandbox)
- **Rate Limit**: 1 email/second (sandbox)

## Recommended Next Steps

1. ✅ **Request production access** (highest priority)
2. ✅ **Verify greenreachgreens.com domain** (after production access)
3. ✅ **Set up SNS topics** for bounce/complaint handling
4. ✅ **Monitor sending statistics** in AWS console

## Support

If you need help with the production access request, AWS Support can assist:
- [AWS Support Center](https://console.aws.amazon.com/support/home)
- Case Type: "Service Limit Increase"
- Service: "SES Sending Limits"
