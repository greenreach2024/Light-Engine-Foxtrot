# Production Deployment Testing TODO
**Created:** December 29, 2025  
**Target:** Light Engine Foxtrot Production Deployment  
**Environment:** Elastic Beanstalk `light-engine-foxtrot-prod`

---

## 🎯 Objective
Complete end-to-end production deployment testing to verify system readiness for real users purchasing cloud subscriptions.

---

## Phase 1: Environment Health & Verification

### ☐ 1.1 Verify Server Restoration
**Status:** 🟢 IN PROGRESS  
**Priority:** CRITICAL

- [ ] Confirm EB environment status: `Ready` with `Green` or `Ok` health
- [ ] Verify server-foxtrot.js (21,753 lines) is running, not minimal server.js
- [ ] Check package.json points to server-foxtrot.js
- [ ] Test health endpoint: `http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health`
- [ ] Verify Node.js 20 platform running
- [ ] Check application logs for startup errors

**Commands:**
```bash
aws elasticbeanstalk describe-environments \
  --environment-names light-engine-foxtrot-prod \
  --region us-east-1

curl -I http://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/health
```

---

### ☐ 1.2 File Cleanup Verification
**Status:** ✅ COMPLETED (Commit 28201f7)  
**Priority:** HIGH

- [x] Confirm deprecated `LEMarketing-*.html` files deleted
- [x] Verify new naming convention in use: `landing-*.html`, `purchase.html`
- [x] Check all internal links updated in `/public/docs/*.html`
- [x] Test landing pages accessible at new URLs
- [x] Verify no 404 errors from old links

**Verification:**
```bash
# Should return 0 results
grep -r "LEMarketing-" public/*.html

# Should return clean results
ls public/landing*.html public/purchase.html
```

---

### ☐ 1.3 Environment Variables Check
**Status:** 🟡 PARTIAL  
**Priority:** CRITICAL

**Already Configured:**
- [x] SQUARE_ENVIRONMENT: sandbox
- [x] SQUARE_APPLICATION_ID: configured
- [x] SQUARE_LOCATION_ID: LJKZRNNRPAQ99
- [x] SQUARE_ACCESS_TOKEN: configured
- [x] JWT_SECRET: stored in Secrets Manager
- [x] DB_HOST: light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com
- [x] DB_PORT: 5432
- [x] DB_NAME: lightengine
- [x] DB_USER: lightengine
- [x] DB_PASSWORD: stored in Secrets Manager
- [x] DB_SSL: true

**Need to Add:**
- [ ] SENDGRID_API_KEY: (obtain from SendGrid)
- [ ] EMAIL_FROM: support@greenreach.ca
- [ ] FRONTEND_URL: https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
- [ ] NODE_ENV: production
- [ ] DEMO_MODE: false
- [ ] ALLOW_MOCKS: false

**Command:**
```bash
eb setenv SENDGRID_API_KEY="SG.xxx" \
  EMAIL_FROM="support@greenreach.ca" \
  FRONTEND_URL="https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com" \
  NODE_ENV="production" \
  DEMO_MODE="false" \
  ALLOW_MOCKS="false"
```

---

## Phase 2: Database Setup

### ☐ 2.1 Deploy Database Schema
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL (BLOCKING)

- [ ] Create SQL migration file: `/migrations/001_create_farms_users.sql`
- [ ] Test migration locally with PostgreSQL
- [ ] Connect to RDS instance from local machine (test connection)
- [ ] Run migration on production RDS
- [ ] Verify tables created: `farms`, `users`
- [ ] Verify indexes created on `farm_id`, `email`
- [ ] Test INSERT/SELECT operations

**Migration SQL:**
```sql
-- See SIGN_IN_READINESS_REPORT.md Appendix B for full schema
CREATE TABLE farms (...);
CREATE TABLE users (...);
CREATE INDEX idx_farms_email ON farms(email);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_farm_id ON users(farm_id);
```

**Connect to RDS:**
```bash
psql -h light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com \
  -p 5432 -U lightengine -d lightengine
```

---

### ☐ 2.2 Verify Database Connection from EB
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL

- [ ] SSH into EB instance (setup SSH key if needed)
- [ ] Test database connection from application server
- [ ] Verify SSL connection working
- [ ] Check connection pooling settings
- [ ] Monitor connection count and performance

**Commands:**
```bash
eb ssh light-engine-foxtrot-prod --setup  # First time only
eb ssh light-engine-foxtrot-prod
# Inside instance:
node -e "const pg = require('pg'); console.log('pg version:', pg.version);"
```

---

## Phase 3: Purchase Flow Integration

### ☐ 3.1 Convert Purchase Routes to ES Module
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Convert `/routes/purchase.js` from CommonJS to ES module
  - Change `require()` to `import`
  - Change `module.exports` to `export default`
- [ ] Test locally that module loads without errors
- [ ] Verify Square SDK compatibility with ES modules
- [ ] Update any other CommonJS dependencies

**File:** `/routes/purchase.js` (462 lines)

---

### ☐ 3.2 Integrate Purchase Routes into server-foxtrot.js
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Import purchase router in server-foxtrot.js
- [ ] Mount routes at `/api/farms`
- [ ] Initialize database connection: `app.locals.db`
- [ ] Test routes accessible
- [ ] Verify no conflicts with existing routes

**Code Changes:**
```javascript
// Add to server-foxtrot.js
import purchaseRouter from './routes/purchase.js';
import dbPool from './db.js';

app.locals.db = dbPool;
app.use('/api/farms', purchaseRouter);
```

---

### ☐ 3.3 Test Purchase Flow End-to-End
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Visit `/purchase.html`
- [ ] Click "Start Cloud Plan"
- [ ] Fill form: test farm name, email, contact
- [ ] Complete Square sandbox payment ($1 CAD)
- [ ] Verify account created in database
- [ ] Verify API keys generated
- [ ] Check server logs for errors
- [ ] Confirm no crash/restart during purchase

**Test Data:**
```
Farm Name: Test Farm Deploy 2025
Contact: John Tester
Email: test@example.com
Plan: cloud
Amount: $1 CAD
```

---

## Phase 4: Authentication System

### ☐ 4.1 Create Login Page
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Create `/public/login.html` with GreenReach branding
- [ ] Add 3 input fields: Farm ID, Email, Password
- [ ] Add "Forgot password?" link (placeholder)
- [ ] Add error message display
- [ ] Add loading spinner during login
- [ ] Make responsive for mobile
- [ ] Test on multiple browsers

**Reference:** See SIGN_IN_READINESS_REPORT.md Section 4.3

---

### ☐ 4.2 Update Authentication to Use Database
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL

- [ ] Update `/api/farm/auth/login` endpoint in server-foxtrot.js
- [ ] Add database query to fetch user by email + farm_id
- [ ] Add bcrypt password verification
- [ ] Generate JWT token for authenticated users
- [ ] Keep demo mode bypass functional
- [ ] Add proper error handling
- [ ] Log authentication attempts

**Code Location:** `server-foxtrot.js` line ~13326

---

### ☐ 4.3 Test Login Flow
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Create test user in database manually
- [ ] Visit `/login.html`
- [ ] Enter credentials
- [ ] Verify JWT token returned
- [ ] Verify redirect to dashboard
- [ ] Test invalid credentials (proper error)
- [ ] Test wrong farm_id (proper error)
- [ ] Test SQL injection attempts (security)

---

## Phase 5: Email Service

### ☐ 5.1 Configure SendGrid
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Create SendGrid account (if not exists)
- [ ] Verify sender email: support@greenreach.ca
- [ ] Generate API key
- [ ] Add API key to EB environment variables
- [ ] Test API key with simple email
- [ ] Set up email templates (optional)

**SendGrid Setup:**
```bash
# After obtaining API key
eb setenv SENDGRID_API_KEY="SG.xxxxxxxxxx"
```

---

### ☐ 5.2 Update Email Service
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Update `/email.js` to use SendGrid (not mock)
- [ ] Test welcome email sending locally
- [ ] Add HTML email template
- [ ] Include all credentials in email
- [ ] Add unsubscribe link
- [ ] Test email delivery
- [ ] Check spam score

**Reference:** See SIGN_IN_READINESS_REPORT.md Appendix C for template

---

### ☐ 5.3 Test Welcome Email Flow
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Complete test purchase
- [ ] Verify welcome email received
- [ ] Check email formatting (HTML renders correctly)
- [ ] Verify credentials are correct
- [ ] Test login link in email
- [ ] Check "from" address and subject line
- [ ] Verify email arrives within 1 minute

---

## Phase 6: First-Time Setup

### ☐ 6.1 Create Setup Wizard Backend
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Create `/routes/setup-wizard.js`
- [ ] Add endpoint: `POST /api/setup/farm-profile`
- [ ] Add endpoint: `POST /api/setup/rooms`
- [ ] Add endpoint: `POST /api/setup/zones`
- [ ] Add endpoint: `GET /api/setup/status`
- [ ] Mount routes in server-foxtrot.js
- [ ] Add JWT authentication middleware
- [ ] Test all endpoints

**Reference:** See SIGN_IN_READINESS_REPORT.md Section 4.6

---

### ☐ 6.2 Connect Setup Wizard UI to Backend
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Update `/setup-wizard.html` JavaScript
- [ ] Call API endpoints on form submission
- [ ] Show success/error messages
- [ ] Persist wizard state across steps
- [ ] Redirect to dashboard on completion
- [ ] Handle errors gracefully

---

### ☐ 6.3 Test Complete Onboarding Flow
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Purchase → Email → Login → Setup Wizard
- [ ] Complete all wizard steps
- [ ] Verify data saved to database
- [ ] Verify redirect to dashboard
- [ ] Check new user sees clean system (no mock data)
- [ ] Verify demo mode isolation works

---

## Phase 7: Production Testing

### ☐ 7.1 End-to-End User Journey Test
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL

**Test Scenario:**
```
1. User visits /purchase.html
2. Selects "Cloud" plan
3. Completes Square payment ($1 CAD)
4. Receives welcome email with credentials
5. Clicks login link in email
6. Enters credentials on login page
7. Sees setup wizard (first-time user)
8. Completes farm profile setup
9. Adds rooms/zones
10. Redirected to dashboard
11. Sees clean system (no mock data)
12. Can access AI agent, inventory, orders
```

**Verification Points:**
- [ ] Payment processes successfully
- [ ] Account created in database
- [ ] Email delivered within 1 minute
- [ ] Login successful
- [ ] JWT token valid
- [ ] Setup wizard functional
- [ ] Dashboard loads correctly
- [ ] No mock data visible
- [ ] All features accessible

---

### ☐ 7.2 Demo Mode Isolation Test
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Set DEMO_MODE=true
- [ ] Verify demo users can login without database
- [ ] Set DEMO_MODE=false
- [ ] Verify production users don't see demo data
- [ ] Verify ALLOW_MOCKS=false prevents mock data
- [ ] Test farm ID isolation (user A can't see user B data)

---

### ☐ 7.3 Security Testing
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

- [ ] Test SQL injection on login form
- [ ] Test XSS in farm name field
- [ ] Test JWT token expiration
- [ ] Test invalid JWT tokens rejected
- [ ] Test API rate limiting works
- [ ] Test password hashing (bcrypt)
- [ ] Test HTTPS enforced
- [ ] Test CORS configuration

---

### ☐ 7.4 Performance Testing
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Test purchase flow with 10 concurrent users
- [ ] Monitor database connection pool usage
- [ ] Check API response times (<1 second)
- [ ] Monitor memory usage during operations
- [ ] Test server under sustained load
- [ ] Verify no memory leaks
- [ ] Check CloudWatch metrics

---

### ☐ 7.5 Error Handling & Recovery
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Test payment failure scenarios
- [ ] Test database connection failure
- [ ] Test email service unavailable
- [ ] Test invalid input data
- [ ] Verify user-friendly error messages
- [ ] Test application restart recovery
- [ ] Verify data consistency after errors

---

## Phase 8: Monitoring & Logging

### ☐ 8.1 Set Up Application Monitoring
**Status:** ❌ NOT STARTED  
**Priority:** MEDIUM

- [ ] Configure CloudWatch alarms
  - High CPU usage (>80%)
  - High memory usage (>90%)
  - Application errors (>5 per minute)
  - Database connection failures
- [ ] Set up SNS notifications
- [ ] Configure log retention (30 days)
- [ ] Set up metric dashboards

---

### ☐ 8.2 Test Logging
**Status:** ❌ NOT STARTED  
**Priority:** LOW

- [ ] Verify purchase events logged
- [ ] Verify authentication attempts logged
- [ ] Check error logs capture stack traces
- [ ] Verify sensitive data not logged (passwords, tokens)
- [ ] Test log aggregation in CloudWatch
- [ ] Set up log search queries

---

## Phase 9: Documentation & Rollback Plan

### ☐ 9.1 Update Deployment Documentation
**Status:** ❌ NOT STARTED  
**Priority:** LOW

- [ ] Document environment variables
- [ ] Document database schema
- [ ] Document API endpoints
- [ ] Create troubleshooting guide
- [ ] Document rollback procedure

---

### ☐ 9.2 Create Rollback Plan
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

**Rollback Steps:**
```bash
# If deployment fails:
1. eb deploy --version <previous-version-label>
2. Restore database snapshot if schema changed
3. Revert environment variables if needed
4. Verify health endpoint returns 200
5. Test critical flows (purchase, login)
```

- [ ] Document last known good version
- [ ] Test rollback procedure
- [ ] Create database backup before changes
- [ ] Document data migration rollback

---

## Phase 10: Production Cutover

### ☐ 10.1 Pre-Launch Checklist
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL

- [ ] All previous phases completed
- [ ] Database schema deployed and tested
- [ ] Purchase flow working end-to-end
- [ ] Email service configured and tested
- [ ] Login page functional
- [ ] Demo mode isolated correctly
- [ ] No deprecated files in codebase
- [ ] All environment variables configured
- [ ] Monitoring and alarms active
- [ ] Rollback plan documented and tested

---

### ☐ 10.2 Launch Activities
**Status:** ❌ NOT STARTED  
**Priority:** CRITICAL

- [ ] Deploy final code to production
- [ ] Verify deployment successful (green health)
- [ ] Test complete user journey (purchase → login → setup)
- [ ] Monitor logs for errors (first 30 minutes)
- [ ] Monitor CloudWatch metrics
- [ ] Test from multiple devices/browsers
- [ ] Verify email delivery working
- [ ] Check database for successful writes

---

### ☐ 10.3 Post-Launch Monitoring
**Status:** ❌ NOT STARTED  
**Priority:** HIGH

**First 24 Hours:**
- [ ] Monitor every 2 hours
- [ ] Check error rates in CloudWatch
- [ ] Verify all purchases completing
- [ ] Verify emails delivering
- [ ] Monitor database performance
- [ ] Check for memory leaks
- [ ] Review user feedback (if any)

**First Week:**
- [ ] Daily health checks
- [ ] Review all error logs
- [ ] Monitor purchase success rate
- [ ] Track email delivery rate
- [ ] Analyze user onboarding completion rate
- [ ] Identify and fix any issues

---

## Success Criteria

### Minimum Viable Product (MVP)
- [ ] User can purchase Cloud plan ($1 CAD sandbox)
- [ ] Account created in database automatically
- [ ] User receives welcome email with credentials
- [ ] User can log in with provided credentials
- [ ] New user sees clean system (no mock data)
- [ ] User can access basic dashboard features
- [ ] Demo mode isolation works correctly
- [ ] All payments processed securely via Square
- [ ] No application crashes during normal operation
- [ ] Response times < 2 seconds for all operations

### Production Ready
- [ ] All MVP criteria met ✅
- [ ] Setup wizard functional (farm profile, rooms, zones)
- [ ] Email verification implemented
- [ ] Password reset flow working
- [ ] Comprehensive error handling
- [ ] Security audit completed
- [ ] Performance testing passed
- [ ] Monitoring and alerting active
- [ ] Documentation complete
- [ ] Rollback plan tested

---

## Risk Matrix

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| Database migration fails | HIGH | MEDIUM | Test locally first, backup before changes |
| Purchase flow creates duplicate accounts | MEDIUM | LOW | Add unique constraint on email, check before creation |
| Email delivery fails | HIGH | MEDIUM | Log all credentials, add admin panel to resend |
| Authentication bugs lock users out | HIGH | LOW | Keep demo mode bypass, add admin override |
| Server crashes under load | MEDIUM | LOW | Load testing, auto-scaling enabled |
| Payment processing errors | HIGH | LOW | Square sandbox tested, comprehensive error handling |

---

## Timeline Estimate

**Phase 1-2 (Environment & Database):** 1-2 days  
**Phase 3 (Purchase Integration):** 1 day  
**Phase 4 (Authentication):** 1 day  
**Phase 5 (Email):** 1 day  
**Phase 6 (Setup Wizard):** 1-2 days  
**Phase 7 (Testing):** 2-3 days  
**Phase 8-9 (Monitoring & Docs):** 1 day  
**Phase 10 (Launch):** 1 day  

**Total Estimate:** 10-14 days

---

## Notes

- **Current Blockers:**
  - Database schema not deployed (CRITICAL)
  - Purchase flow not integrated (HIGH)
  - No email service configured (HIGH)
  - No login page (HIGH)

- **Quick Wins:**
  - File cleanup already done ✅
  - Environment variables mostly configured ✅
  - AI Agent already implemented ✅

- **Decision Points:**
  - Email provider: SendGrid vs AWS SES
  - MVP scope: Full features vs minimal working flow
  - Launch date: Based on testing completion

---

**Last Updated:** December 29, 2025  
**Status:** Ready for Phase 1 execution
