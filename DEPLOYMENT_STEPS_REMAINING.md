# Remaining Deployment Steps

## ✅ Completed
- [x] Install npm dependencies (bcryptjs)
- [x] Commit all changes to Git
- [x] Push to GitHub (triggers AWS CodePipeline deployment)

## 📋 Manual Steps Required (IN ORDER)

### 1. Run Database Migration ⚠️ CRITICAL

The purchase system needs new database tables and columns. Run this migration on your production database:

**Option A: Via AWS RDS Query Editor**
1. Go to AWS Console → RDS → Databases
2. Select your Light Engine database
3. Click "Query Editor" (or use RDS Data API)
4. Copy and paste contents of `migrations/010_purchase_onboarding.sql`
5. Execute the SQL

**Option B: Via Local psql Client**
```bash
# Get RDS endpoint from AWS Console → RDS → Databases → Connectivity
# Format: your-db.xxxxx.us-east-1.rds.amazonaws.com

psql -h your-rds-endpoint.us-east-1.rds.amazonaws.com \
     -U your_master_username \
     -d light_engine_db \
     -f migrations/010_purchase_onboarding.sql
```

**What this migration does:**
- Adds `api_key`, `api_secret`, `jwt_secret` columns to `farms` table
- Adds `square_customer_id`, `square_payment_id`, `square_order_id`, `square_amount` for payment tracking
- Adds `plan_type`, `email`, `phone`, `contact_name` for customer info
- Creates `users` table for login authentication
- Creates `user_sessions` table for session management
- Adds indexes for fast lookups

**Verify migration succeeded:**
```sql
-- Check farms table has new columns
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'farms' 
  AND column_name IN ('api_key', 'square_payment_id', 'plan_type');

-- Check users table exists
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'users';
```

---

### 2. Get Square Credentials 🟦

1. Go to https://developer.squareup.com/apps
2. Sign in with your Square account
3. Click on your application (or create new one)
4. Go to **"Credentials"** tab
5. Copy these values:

**For Testing (Sandbox):**
- ✅ Sandbox Access Token: `EAAAxxxxxxxxxxxxxxxxxx`
- ✅ Application ID: `sandbox-sq0idb-xxxxxxxxxxxxx`

**For Production (Live):**
- ✅ Production Access Token: `EAAAxxxxxxxxxxxxxxxxxx`
- ✅ Application ID: `sq0idp-xxxxxxxxxxxxx`

6. Go to **"Locations"** tab
7. Copy **Location ID**: `LXXXXxxxxxxxxxx`

**Save these credentials** - you'll need them for the next step!

---

### 3. Configure Square Environment Variables in AWS 🔧

Add Square credentials to AWS Elastic Beanstalk:

1. Go to AWS Console → Elastic Beanstalk
2. Select environment: **light-engine-foxtrot-prod**
3. Click **Configuration** (left sidebar)
4. Under **Software**, click **Edit**
5. Scroll to **Environment properties**
6. Add these variables:

**For Testing:**
```
SQUARE_ACCESS_TOKEN = EAAAxxxxxxxxxxxxxxxxxx (your sandbox token)
SQUARE_APPLICATION_ID = sandbox-sq0idb-xxxxxxxxxxxxx
SQUARE_LOCATION_ID = LXXXXxxxxxxxxxx
SQUARE_ENVIRONMENT = sandbox
```

**For Production (when ready for real payments):**
```
SQUARE_ACCESS_TOKEN = EAAAxxxxxxxxxxxxxxxxxx (your production token)
SQUARE_APPLICATION_ID = sq0idp-xxxxxxxxxxxxx
SQUARE_LOCATION_ID = LXXXXxxxxxxxxxx
SQUARE_ENVIRONMENT = production
```

7. Click **Apply** (this will restart the environment - takes ~2-3 minutes)
8. Wait for environment to return to **Green** health status

---

### 4. Configure HTTPS Listener 🔒 REQUIRED FOR PRODUCTION

Currently app.greenreachgreens.com only responds to HTTP. You need to add HTTPS:

1. Go to AWS Console → Elastic Beanstalk
2. Select environment: **light-engine-foxtrot-prod**
3. Click **Configuration** (left sidebar)
4. Under **Load balancer**, click **Edit**
5. Under **Listeners**, click **Add listener**
6. Configure:
   - **Port**: 443
   - **Protocol**: HTTPS
   - **SSL Certificate**: Select the one with `app.greenreachgreens.com` (ARN ending in `41ec9003`)
7. Click **Add**
8. Click **Apply** (environment will update - takes ~2-3 minutes)
9. Wait for **Green** health status

**Verify HTTPS works:**
```bash
curl -I https://app.greenreachgreens.com/LEMarketing-purchase.html
# Should return: HTTP/2 200
```

---

### 5. Test Purchase Flow 🧪

Once everything above is done, test the complete flow:

**Automated Test:**
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
./scripts/test-purchase-flow.sh
```

**Manual Test:**
1. Visit: https://app.greenreachgreens.com/LEMarketing-purchase.html
2. Click **"Start Cloud Plan"** or **"Purchase Edge Device"**
3. Fill out form:
   - Farm Name: Test Farm
   - Contact Name: Your Name
   - Email: your-test-email@example.com
   - Phone: 555-123-4567
4. Click **"Continue to Payment"**
5. Should redirect to Square Checkout
6. Use **test card**:
   - Card Number: **4111 1111 1111 1111**
   - Expiry: Any future date (12/26)
   - CVV: 123
   - Zip: 12345
7. Click **"Pay"**
8. Should redirect to success page
9. Check email for welcome message (currently logged to console)
10. Check database for new farm:

```sql
SELECT farm_id, name, email, plan_type, square_amount/100 as amount_usd, created_at
FROM farms 
WHERE email = 'your-test-email@example.com';
```

11. Try logging in:
    - Go to: https://app.greenreachgreens.com/LE-login.html
    - Email: your-test-email@example.com
    - Password: (from welcome email - check server logs if mock mode)

---

## 📊 Deployment Status Tracking

| Step | Status | Time Required | Critical |
|------|--------|---------------|----------|
| 1. Run database migration | ⏳ Pending | 5 min | ✅ YES |
| 2. Get Square credentials | ⏳ Pending | 10 min | ✅ YES |
| 3. Configure env variables | ⏳ Pending | 5 min | ✅ YES |
| 4. Configure HTTPS listener | ⏳ Pending | 5 min | ✅ YES |
| 5. Test purchase flow | ⏳ Pending | 15 min | ✅ YES |
| **Total** | | **~40 minutes** | |

---

## 🚨 Important Notes

1. **Database Migration First**: Must be done before testing purchase flow
2. **Square Sandbox Mode**: Start with sandbox credentials for testing
3. **HTTPS Required**: Purchase flow won't work without HTTPS (Square requirement)
4. **Email Service**: Currently in mock mode (logs to CloudWatch)
5. **Test Before Live**: Use Square sandbox + test cards before switching to production
6. **Customer Testing Tomorrow**: You need steps 1-5 done today!

---

## 🎯 Quick Checklist

Before letting real customers purchase:

- [ ] Database migration executed successfully
- [ ] Square sandbox credentials configured
- [ ] HTTPS listener working (curl test passes)
- [ ] Test purchase with sandbox card succeeds
- [ ] New farm created in database
- [ ] New user created in database
- [ ] Can login with test credentials
- [ ] Email service configured (SendGrid/SES) or staying with mock
- [ ] Switch to Square production credentials
- [ ] Final test with real (small) payment

---

## 🆘 Troubleshooting

**Issue: "Cannot connect to database"**
- Check RDS endpoint is correct
- Verify security group allows your IP
- Ensure master username/password correct

**Issue: "SQUARE_ACCESS_TOKEN not set"**
- Verify env variables in EB Configuration → Software
- Restart environment after adding variables
- Check CloudWatch logs for errors

**Issue: "SSL certificate not found"**
- Go to AWS Certificate Manager
- Verify cert for app.greenreachgreens.com shows ISSUED
- Use ARN ending in `41ec9003`

**Issue: "Payment failed" in Square Checkout**
- Verify using correct test card: 4111 1111 1111 1111
- Check Square Dashboard for error messages
- Ensure SQUARE_LOCATION_ID is correct

**Issue: "Farm not created after payment"**
- Check CloudWatch logs: /aws/elasticbeanstalk/light-engine-foxtrot-prod/var/log/eb-engine.log
- Search for: `[Purchase]` log messages
- Verify database migration ran successfully

---

## 📞 Support

- Square Support: https://squareup.com/help
- AWS Support: https://console.aws.amazon.com/support/
- Database Issues: Check RDS CloudWatch metrics
- Application Logs: CloudWatch Logs → /aws/elasticbeanstalk/...

---

## ✨ When Everything Works

Your customers will be able to:
1. Visit marketing site
2. Click purchase button
3. Enter payment details
4. Get instant account access
5. Login immediately
6. Start using Light Engine

**Zero manual intervention required!** 🎉
