# Purchase Flow Deployment Guide

## Overview
This guide covers deploying the automated Light Engine purchase and account creation system.

## Architecture

### Components
1. **Frontend**: LEMarketing-purchase.html with Square Payment Link
2. **Backend**: routes/purchase.js with payment verification
3. **Database**: farms and users tables with purchase fields
4. **Email**: Welcome email with login credentials
5. **Square**: Payment processing via Square Checkout

### Flow
```
User visits LEMarketing-purchase.html
→ Selects plan (Cloud $299/mo or Edge $999 one-time)
→ Fills form (farm name, contact, email, phone)
→ Click "Continue to Payment"
→ Redirects to Square Checkout
→ User enters payment
→ Square processes payment
→ Redirects to purchase-success.html?session_id=XXX
→ Verifies payment with Square API
→ Creates farm record with unique farm_id
→ Generates API keys and JWT secret
→ Creates admin user account with temp password
→ Sends welcome email with credentials
→ Redirects to LE-login.html
→ User logs in and completes setup wizard
```

## Prerequisites

### 1. Square Account
- Sign up at https://squareup.com
- Get API credentials from Dashboard → Developer → Applications
- Use sandbox keys for development
- Use production keys for live payments

### 2. Database Migration
Run the database migration to add required fields:

```bash
psql -U your_db_user -d light_engine_db -f migrations/010_purchase_onboarding.sql
```

Or use your migration tool:
```bash
npm run migrate:up
```

### 3. Install Dependencies
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
npm install bcryptjs
# Square is already installed
```

## Configuration

### 1. AWS Elastic Beanstalk Environment Variables

Add these environment variables in AWS Console:

**Elastic Beanstalk → Environments → light-engine-foxtrot-prod → Configuration → Software → Environment properties**

```
# Square Keys (SANDBOX for testing)
SQUARE_ACCESS_TOKEN=EAAAxxxxxxxxxxxxxxxxxx  # Sandbox access token
SQUARE_APPLICATION_ID=sandbox-sq0idb-xxxxx  # Application ID
SQUARE_LOCATION_ID=LXXXXXXXXXXXXXX  # Your location ID
SQUARE_ENVIRONMENT=sandbox  # or 'production'

# Email Service (optional - defaults to mock mode)
EMAIL_SERVICE=mock  # or 'sendgrid', 'ses', 'smtp'
SENDGRID_API_KEY=SG.xxxxx  # if using SendGrid
AWS_SES_REGION=us-east-1   # if using AWS SES

# System URLs
APP_URL=https://app.greenreachgreens.com
```

**For Production:**
```
SQUARE_ACCESS_TOKEN=EAAAxxxxxxxxxxxxxxxxxx  # Production token
SQUARE_ENVIRONMENT=production
```

### 2. Get Square Credentials

1. Go to https://developer.squareup.com/apps
2. Create or select your application
3. Go to "Credentials" tab
4. Copy:
   - **Sandbox Access Token** (for testing)
   - **Production Access Token** (for live)
   - **Application ID**
5. Go to "Locations" tab and copy **Location ID**

## Testing

### 1. Test with Square Sandbox Mode

Use Square test card numbers:
- **Visa Success**: 4111 1111 1111 1111
- **Mastercard Success**: 5105 1051 0510 5100
- **Declined**: 4000 0000 0000 0002
- **CVV Failure**: Use CVV 999

Test flow:
```bash
1. Visit http://localhost:3000/LEMarketing-purchase.html
2. Click "Start Cloud Plan" or "Purchase Edge Device"
3. Fill form:
   - Farm Name: Test Farm
   - Contact: John Doe
   - Email: test@example.com
4. Click "Continue to Payment"
5. Enter test card: 4111 1111 1111 1111
6. Expiry: Any future date (e.g., 12/25)
7. CVV: Any 3 digits (e.g., 123)
8. Zip: Any 5 digits (e.g., 12345)
9. Complete payment
10. Should redirect to purchase-success.html
11. Check email (console logs if mock mode)
12. Login at /LE-login.html with provided credentials
```

### 2. Verify Database Records

Check farm was created:
```sql
SELECT farm_id, name, email, plan_type, status, created_at 
FROM farms 
ORDER BY created_at DESC 
LIMIT 5;
```

Check user was created:
```sql
SELECT u.email, u.name, u.role, f.farm_id, f.name as farm_name
FROM users u
JOIN farms f ON u.farm_id = f.farm_id
ORDER BY u.created_at DESC
LIMIT 5;
```

### 3. Test Login

1. Go to /LE-login.html
2. Enter email and temp password from welcome email
3. Should redirect to dashboard
4. Change password immediately

## Email Configuration

### Mock Mode (Default - Development)
Emails are logged to console only:
```
EMAIL_SERVICE=mock
```

### SendGrid (Recommended - Production)
1. Sign up at https://sendgrid.com
2. Create API key with Mail Send permissions
3. Verify sender email
4. Add environment variables:
```
EMAIL_SERVICE=sendgrid
SENDGRID_API_KEY=SG.xxxxxxxxxxxxxxxxxxxxx
SENDGRID_FROM_EMAIL=noreply@greenreachgreens.com
SENDGRID_FROM_NAME=Light Engine
```

### AWS SES (Alternative - Production)
1. Verify domain in AWS SES
2. Request production access (remove sandbox)
3. Add environment variables:
```
EMAIL_SERVICE=ses
AWS_SES_REGION=us-east-1
AWS_SES_FROM_EMAIL=noreply@greenreachgreens.com
AWS_SES_FROM_NAME=Light Engine
```

### Custom SMTP (Alternative)
```
EMAIL_SERVICE=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=your_username
SMTP_PASS=your_password
SMTP_FROM_EMAIL=noreply@greenreachgreens.com
SMTP_FROM_NAME=Light Engine
```

## Deployment Steps

### 1. Install Dependencies
```bash
npm install
```

### 2. Run Database Migration
```bash
psql -U your_db_user -d light_engine_db -f migrations/010_purchase_onboarding.sql
```

### 3. Set Environment Variables
Add Square keys and email config to AWS Elastic Beanstalk (see Configuration section above)

### 4. Deploy to AWS
```bash
# Commit changes
git add .
git commit -m "Add automated purchase and account creation flow"

# Deploy (if using EB CLI)
eb deploy

# Or push to trigger CodePipeline
git push origin main
```

### 5. Verify Deployment
```bash
# Check purchase page loads
curl -I https://app.greenreachgreens.com/LEMarketing-purchase.html

# Check API endpoint exists
curl https://app.greenreachgreens.com/api/farms/create-checkout-session \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"plan":"cloud","email":"test@test.com","farm_name":"Test","contact_name":"Test"}' \
  | jq
```

### 6. Test End-to-End
Follow testing steps above with test Stripe cards

## Stripe Webhook Configuration (Optional but Recommended)

For production, set up webhooks to handle payment events:

### 1. Create Webhook Endpoint
Add to routes/purchase.js:
```javascript
router.post('/stripe-webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed':
      // Payment succeeded - create account
      const session = event.data.object;
      // Call account creation logic
      break;
    case 'customer.subscription.deleted':
      // Subscription cancelled - deactivate account
      break;
    default:
      console.log(`Unhandled event type ${event.type}`);
  }

  res.json({received: true});
});
```

### 2. Register Webhook in Stripe Dashboard
1. Go to Stripe Dashboard → Developers → Webhooks
2. Click "Add endpoint"
3. URL: `https://app.greenreachgreens.com/api/farms/stripe-webhook`
4. Select events:
   - `checkout.session.completed`
   - `customer.subscription.deleted`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copy webhook signing secret
6. Add to environment variables:
```
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxx
```

## Security Considerations

### 1. API Keys
- Never commit Stripe keys to Git
- Use environment variables only
- Rotate keys regularly
- Use test keys in development
- Use live keys only in production

### 2. Password Security
- Temporary passwords are generated with crypto.randomBytes
- Passwords are hashed with bcryptjs before storage
- Force password change on first login

### 3. Database Security
- API keys stored in database (consider hashing api_secret)
- JWT secrets are unique per farm
- Use prepared statements (parameterized queries)
- Enable SSL for database connections

### 4. Rate Limiting
Add rate limiting to purchase endpoint:

```javascript
const rateLimit = require('express-rate-limit');

const purchaseLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 purchase attempts per IP
  message: 'Too many purchase attempts, please try again later'
});

router.post('/create-checkout-session', purchaseLimit, async (req, res) => {
  // ...
});
```

## Monitoring

### 1. Application Logs
Check CloudWatch logs for purchase events:
- `[Purchase] New purchase request`
- `[Purchase] Payment verified`
- `[Purchase] Generated farm ID`
- `[Purchase] Creating farm record`
- `[Purchase] Purchase completed successfully`

### 2. Stripe Dashboard
Monitor payments in Stripe Dashboard:
- Payments → View all payments
- Customers → View all customers
- Subscriptions (for Cloud plans)

### 3. Database Monitoring
Query recent purchases:
```sql
SELECT 
  f.farm_id,
  f.name,
  f.email,
  f.plan_type,
  f.stripe_amount / 100.0 as amount_usd,
  f.created_at,
  u.email as user_email
FROM farms f
LEFT JOIN users u ON u.farm_id = f.farm_id
WHERE f.created_at > NOW() - INTERVAL '7 days'
ORDER BY f.created_at DESC;
```

### 4. Error Tracking
Set up error tracking (Sentry, Rollbar, etc.):
```javascript
// In routes/purchase.js
try {
  // ... purchase logic
} catch (error) {
  console.error('[Purchase] Error:', error);
  Sentry.captureException(error); // If using Sentry
  res.status(500).json({ error: 'Purchase failed' });
}
```

## Troubleshooting

### Issue: "Invalid publishable key"
**Solution**: Ensure STRIPE_PUBLISHABLE_KEY is set and rendered in HTML

### Issue: "Payment verification failed"
**Solution**: Check STRIPE_SECRET_KEY is correct and Stripe API is accessible

### Issue: "Database connection failed"
**Solution**: Verify database credentials and run migrations

### Issue: "Email not sent"
**Solution**: 
- Check EMAIL_SERVICE environment variable
- Verify SendGrid/SES credentials
- Check spam folder
- Review server logs for email errors

### Issue: "Duplicate farm_id"
**Solution**: farm_id generation collision (very rare), retry purchase

### Issue: "Can't login with temp password"
**Solution**: 
- Verify password was saved correctly in database
- Check email for correct password
- Try password reset flow

## Next Steps

1. **Test thoroughly** with Stripe test cards
2. **Configure email service** (SendGrid recommended)
3. **Set up webhooks** for production
4. **Add rate limiting** to prevent abuse
5. **Monitor logs** and database for errors
6. **Get Stripe live keys** when ready for production
7. **Update to STRIPE_PUBLISHABLE_KEY=pk_live_...**
8. **Test with real payment** (small amount)
9. **Document support process** for failed payments

## Support Resources

- Stripe Documentation: https://stripe.com/docs
- Stripe Test Cards: https://stripe.com/docs/testing
- Stripe Webhooks: https://stripe.com/docs/webhooks
- Light Engine Docs: /docs/index.html
- Support Email: support@greenreach.io
