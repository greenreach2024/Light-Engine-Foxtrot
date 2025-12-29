# Sign-In Readiness Report: Complete New User Experience
**Date:** December 29, 2025  
**System:** Light Engine Foxtrot Production  
**Objective:** Enable seamless flow from cloud option selection → payment → credentials → login → first-time setup

---

## Executive Summary

**Current Status:** 🔴 **PARTIALLY IMPLEMENTED - CRITICAL GAPS IDENTIFIED**

The production system (server-foxtrot.js - 21,753 lines) has been restored after an accidental replacement. While many components exist, **critical integration gaps prevent a complete new user experience**. The system currently has:

✅ **Working Components:**
- Purchase page with Square payment integration (sandbox $1 CAD) - **Updated to `purchase.html`**
- Landing pages with clean naming: `landing.html`, `landing-cloud.html`, `landing-edge.html`
- Setup wizard HTML interface
- JWT authentication framework
- Demo mode isolation (prevents mock data for production users)
- **AI Agent** (OpenAI-powered) at `/api/farm-sales/ai-agent` - replaces old app assistant

❌ **Missing/Broken Components:**
- Purchase flow not integrated into server-foxtrot.js
- No database schema deployed
- No email service configured
- No login page
- No first-time setup backend handlers
- No connection between payment → account creation → credentials

---

## 1. User Journey Map: Current vs Required

### Required Complete Flow

```
[1] User visits purchase page
    → Sees Cloud & Edge options
    
[2] User selects "Cloud" option
    → Enters: farm_name, contact_name, email
    
[3] User pays $1 CAD via Square (sandbox)
    → Square processes payment
    → Webhook fires (or frontend verifies)
    
[4] System creates account automatically
    → Generate: farm_id, api_key, temp_password
    → Create database records (farms, users)
    → Send welcome email with credentials
    
[5] User receives email
    → Farm ID: FARM-ABC123
    → Email: user@example.com
    → Temporary Password: xyz789
    → Login URL: https://prod.example.com/login
    
[6] User clicks login URL
    → Lands on branded login page
    → Enters: farm_id, email, password
    
[7] System authenticates
    → Validates credentials against database
    → Returns JWT token
    → Redirects to dashboard or setup wizard
    
[8] First-time user sees setup wizard
    → Farm profile completion
    → Room/zone structure
    → Equipment configuration
    → No mock data - clean slate
    
[9] User begins farm operations
    → Access to inventory, sales, lighting controls
    → All features based on subscription tier
```

### Current Implementation Status

| Step | Component | Status | Issues |
|------|-----------|--------|---------|
| 1-2 | Purchase page | ✅ EXISTS | `/public/purchase.html` (updated naming) |
| 3 | Square checkout | ✅ WORKS | In `routes/purchase.js` (CommonJS) but NOT integrated |
| 4 | Account creation | ⚠️ CODED | Exists in `routes/purchase.js` but NOT mounted in server-foxtrot.js |
| 4 | Database schema | ❌ MISSING | No `farms` or `users` tables deployed |
| 4 | Email service | ❌ NOT CONFIGURED | Mock only, no SendGrid/SES |
| 5 | Credential delivery | ❌ BLOCKED | Depends on email service |
| 6 | Login page | ❌ MISSING | No `/LE-login.html` or equivalent |
| 7 | Authentication | ⚠️ PARTIAL | JWT framework exists but no DB integration |
| 8 | Setup wizard backend | ❌ MISSING | HTML exists, no API endpoints |
| 9 | Dashboard access | ⚠️ DEMO ONLY | Works in DEMO_MODE, not for real users |

---

## 2. Critical File Inventory

### ✅ Working Files (Restored)

**server-foxtrot.js** (757KB, 21,753 lines)
- Location: `/Users/petergilbert/Light-Engine-Foxtrot/server-foxtrot.js`
- Status: ✅ Restored and running
- Contains:
  - Demo mode isolation (`isDemoMode()`, `ALLOW_MOCKS=false`)
  - JWT secret management (`getJwtSecret()`)
  - Farm authentication framework (`/api/farm/auth/login`)
  - Existing wholesale/buyer routes
  - WebSocket support
  - Rate limiting and security
- Missing:
  - Purchase route integration
  - Database connection for user auth
  - Setup wizard API endpoints

**package.json**
- Main: `server-foxtrot.js` ✅
- Start: `node server-foxtrot.js` ✅
- Status: Correctly restored

### ✅ Recent Updates (Dec 28, 2025)

**File Naming Standardized:**
- Old: `LEMarketing-*.html` → New: `landing-*.html`, `purchase.html`
- Clean, category-based naming convention implemented

**AI Agent Implemented:**
- Location: `services/ai-agent.js` (729 lines)
- Routes: `routes/farm-sales/ai-agent.js`
- OpenAI GPT-4o-mini integration
- Natural language command parsing
- Mounted at: `/api/farm-sales/ai-agent`
- Replaces old "app assistant" with full AI capabilities
- Can manage inventory, orders, sales, reports, checklists, monitoring
- Read-only environmental monitoring (no hardware control)

### ⚠️ Orphaned Files (Not Integrated)

**routes/purchase.js** (462 lines, CommonJS)
- Location: `/Users/petergilbert/Light-Engine-Foxtrot/routes/purchase.js`
- Status: ⚠️ EXISTS but NOT MOUNTED in server-foxtrot.js
- Contains:
  - `POST /api/farms/purchase` - Complete purchase flow
  - `POST /api/farms/create-checkout-session` - Square checkout
  - `GET /api/farms/verify-session/:session_id` - Payment verification
  - Account creation logic (farm_id, api_key, temp_password)
  - Database insertion (farms, users tables)
  - Welcome email generation
- Issues:
  - Uses `require()` (CommonJS) - server-foxtrot.js uses ES modules
  - Expects PostgreSQL connection at `req.app.locals.db`
  - Not imported/mounted in server-foxtrot.js
  - References database tables that don't exist

**routes/auth.js** (106 lines, ES module)
- Location: `/Users/petergilbert/Light-Engine-Foxtrot/routes/auth.js`
- Status: ⚠️ EXISTS but for DEVICE PAIRING only
- Contains:
  - `/api/auth/generate-device-token` - Activity Hub pairing
  - `/api/auth/validate-device-token` - Token validation
- NOT for user login - different purpose

**db.js** (PostgreSQL connection)
- Location: `/Users/petergilbert/Light-Engine-Foxtrot/db.js`
- Status: ⚠️ EXISTS but NOT USED
- Contains: PostgreSQL pool configuration
- Issue: Not imported in server-foxtrot.js

**email.js** (Email service)
- Location: `/Users/petergilbert/Light-Engine-Foxtrot/email.js`
- Status: ⚠️ EXISTS but NOT CONFIGURED
- Contains: nodemailer setup (mock mode)
- Issue: No SMTP credentials configured

### ❌ Missing Critical Files

**Login Page** ❌
- Expected: `/public/LE-login.html` or similar
- Status: DOES NOT EXIST
- Need: Branded login page with:
  - Farm ID input
  - Email input
  - Password input
  - "Forgot password?" link
  - Responsive design
  - Error handling

**Setup Wizard Backend** ❌
- Expected: `/routes/setup-wizard.js` or endpoints in server-foxtrot.js
- Status: HTML EXISTS (`setup-wizard.html`) but NO BACKEND
- Need:
  - `POST /api/setup/farm-profile` - Save farm details
  - `POST /api/setup/rooms` - Create room structure
  - `POST /api/setup/zones` - Create zones
  - `POST /api/setup/equipment` - Register devices
  - `GET /api/setup/status` - Check completion

**Database Migration** ❌
- Expected: SQL schema files or Alembic migrations
- Status: NO SCHEMA DEPLOYED
- Need:
  ```sql
  CREATE TABLE farms (
    farm_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    contact_name VARCHAR(255),
    plan_type VARCHAR(50),
    api_key VARCHAR(255),
    api_secret VARCHAR(255),
    jwt_secret VARCHAR(255),
    square_payment_id VARCHAR(255),
    square_amount INTEGER,
    status VARCHAR(50),
    created_at TIMESTAMP
  );

  CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    farm_id VARCHAR(50) REFERENCES farms(farm_id),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(255),
    role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP
  );
  ```

---

## 3. Technical Architecture Analysis

### Current Authentication System (server-foxtrot.js)

**Demo Mode Authentication** (Line 13326-13435)
```javascript
// POST /api/farm/auth/login
// Current: Bypasses auth when DEMO_MODE=true
// Issue: Production users can't log in (no real auth)

if (isDemoMode()) {
  // Grant full access without credentials
  // Creates demo token
  // Works for demo only
}

// PRODUCTION MODE: (Line 13367)
// Loads farm from registry file (farms-registry.json)
// Hardcoded credentials: admin@demo-farm.com / demo123
// No database lookup
```

**Issue:** Production authentication doesn't query database, uses hardcoded credentials.

**Required:** Database-backed authentication:
```javascript
// 1. Query users table
const user = await db.query(
  'SELECT * FROM users WHERE email = $1 AND farm_id = $2',
  [email, farmId]
);

// 2. Verify password hash (bcrypt)
const validPassword = await bcrypt.compare(password, user.password_hash);

// 3. Generate JWT token
const token = jwt.sign({
  farm_id: user.farm_id,
  user_id: user.user_id,
  role: user.role,
  email: user.email
}, JWT_SECRET, { expiresIn: '24h' });

// 4. Return token + user data
```

### Database Integration Points

**Available in codebase:**
- PostgreSQL connection: `db.js` (pg pool)
- Credentials: Secrets Manager (already retrieved)
  - `DB_HOST`: light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com
  - `DB_PORT`: 5432
  - `DB_NAME`: lightengine
  - `DB_USER`: lightengine
  - `DB_PASSWORD`: [stored in Secrets Manager]
  - `DB_SSL`: true

**Not available:**
- Schema not deployed to RDS
- No connection in server-foxtrot.js
- SQLite (lightengine.db) exists but is local-only

### Demo Mode Isolation ✅ Working

**Purpose:** Prevent mock data bleeding into production users

**Implementation:**
- `DEMO_MODE` env var (boolean flag)
- `ALLOW_MOCKS` env var (default: false)
- `isDemoMode()` function checks both
- Mock data only served when explicitly enabled

**Result:** New users will get clean database state (once DB is configured)

---

## 4. Gap Analysis: What's Missing

### 🔴 Critical Blockers (Must Fix Before Launch)

#### 4.1 Database Schema Not Deployed
**Impact:** BLOCKS ALL account creation and authentication

**Current State:**
- RDS instance exists: `light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com`
- No tables created
- No schema deployed

**Required Actions:**
1. Create migration script (SQL or Alembic)
2. Deploy schema to RDS:
   - `farms` table
   - `users` table
   - Indexes on email, farm_id
3. Test connection from Elastic Beanstalk

**Estimated Effort:** 2-3 hours

---

#### 4.2 Purchase Flow Not Integrated
**Impact:** Payments work but don't create accounts

**Current State:**
- `routes/purchase.js` exists with complete logic
- NOT mounted in server-foxtrot.js
- Uses CommonJS (incompatible with ES modules)

**Required Actions:**
1. Convert `routes/purchase.js` to ES module syntax:
   ```javascript
   // Change from:
   const express = require('express');
   module.exports = router;
   
   // To:
   import express from 'express';
   export default router;
   ```

2. Import in server-foxtrot.js:
   ```javascript
   import purchaseRouter from './routes/purchase.js';
   ```

3. Mount routes:
   ```javascript
   app.use('/api/farms', purchaseRouter);
   ```

4. Initialize database connection:
   ```javascript
   import dbPool from './db.js';
   app.locals.db = dbPool;
   ```

**Estimated Effort:** 1-2 hours

---

#### 4.3 No Login Page
**Impact:** Users can't access system after purchase

**Current State:**
- No login page exists
- Farm admin pages exist (`farm-admin.html`) but for different auth system

**Required Actions:**
1. Create `/public/LE-login.html`:
   - GreenReach branding
   - 3 inputs: Farm ID, Email, Password
   - Error messaging
   - "Forgot password?" link
   - Responsive design

2. JavaScript login handler:
   ```javascript
   async function handleLogin(farmId, email, password) {
     const response = await fetch('/api/farm/auth/login', {
       method: 'POST',
       headers: { 'Content-Type': 'application/json' },
       body: JSON.stringify({ farmId, email, password })
     });
     
     const data = await response.json();
     
     if (data.status === 'success') {
       localStorage.setItem('auth_token', data.token);
       localStorage.setItem('farm_id', data.farmId);
       window.location.href = '/LE-dashboard.html';
     } else {
       showError(data.message);
     }
   }
   ```

**Estimated Effort:** 3-4 hours

---

#### 4.4 Authentication Not Database-Backed
**Impact:** Login always fails for real users

**Current State:**
- `/api/farm/auth/login` uses hardcoded credentials
- Demo mode bypass works
- No database lookup for production

**Required Actions:**
1. Update login endpoint in server-foxtrot.js (around line 13326):
   ```javascript
   app.post('/api/farm/auth/login', async (req, res) => {
     const { farmId, email, password } = req.body;
     
     // Demo mode bypass (keep existing)
     if (isDemoMode()) {
       // ... existing demo code ...
     }
     
     // PRODUCTION: Database lookup
     try {
       const userResult = await req.app.locals.db.query(
         'SELECT * FROM users WHERE email = $1 AND farm_id = $2 AND is_active = true',
         [email, farmId]
       );
       
       if (userResult.rows.length === 0) {
         return res.status(401).json({
           status: 'error',
           message: 'Invalid credentials'
         });
       }
       
       const user = userResult.rows[0];
       
       // Verify password
       const bcrypt = await import('bcryptjs');
       const validPassword = await bcrypt.compare(password, user.password_hash);
       
       if (!validPassword) {
         return res.status(401).json({
           status: 'error',
           message: 'Invalid credentials'
         });
       }
       
       // Generate JWT token
       const token = jwt.sign({
         farm_id: user.farm_id,
         user_id: user.user_id,
         role: user.role,
         email: user.email,
         name: user.name
       }, await getJwtSecret(), { expiresIn: '24h' });
       
       return res.json({
         status: 'success',
         token,
         farmId: user.farm_id,
         email: user.email,
         role: user.role,
         name: user.name
       });
       
     } catch (error) {
       console.error('[farm-auth] Database error:', error);
       return res.status(500).json({
         status: 'error',
         message: 'Authentication failed'
       });
     }
   });
   ```

**Estimated Effort:** 2-3 hours

---

#### 4.5 No Email Service Configured
**Impact:** Users don't receive credentials after purchase

**Current State:**
- `email.js` exists with nodemailer setup
- Mock mode only (console.log)
- No SMTP credentials

**Required Actions:**

**Option A: Use SendGrid (Recommended)**
```javascript
// email.js
import sgMail from '@sendgrid/mail';

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

export async function sendWelcomeEmail({ email, farm_name, farm_id, temp_password, login_url }) {
  const msg = {
    to: email,
    from: 'support@greenreach.ca',
    subject: 'Welcome to Light Engine - Your Account is Ready',
    html: `
      <h1>Welcome to Light Engine, ${farm_name}!</h1>
      <p>Your farm management system is ready to use.</p>
      
      <h2>Login Credentials</h2>
      <ul>
        <li><strong>Farm ID:</strong> ${farm_id}</li>
        <li><strong>Email:</strong> ${email}</li>
        <li><strong>Temporary Password:</strong> ${temp_password}</li>
      </ul>
      
      <p><a href="${login_url}">Click here to log in</a></p>
      
      <p>Please change your password after logging in.</p>
    `
  };
  
  await sgMail.send(msg);
}
```

**Environment variables needed:**
```bash
SENDGRID_API_KEY=SG.xxxxx
EMAIL_FROM=support@greenreach.ca
```

**Estimated Effort:** 1 hour (after SendGrid setup)

---

### 🟡 Important Enhancements (Should Add)

#### 4.6 Setup Wizard Backend
**Impact:** Users can't complete initial farm setup

**Current State:**
- `setup-wizard.html` exists (916 lines)
- Beautiful UI for room/zone setup
- No backend API endpoints

**Required Actions:**
1. Create `/routes/setup-wizard.js`:
   ```javascript
   import express from 'express';
   const router = express.Router();
   
   // POST /api/setup/farm-profile
   router.post('/farm-profile', async (req, res) => {
     const { farm_id } = req.user; // from JWT middleware
     const { timezone, business_hours, certifications } = req.body;
     
     await req.app.locals.db.query(
       'UPDATE farms SET timezone = $1, business_hours = $2, certifications = $3 WHERE farm_id = $4',
       [timezone, business_hours, certifications, farm_id]
     );
     
     res.json({ success: true });
   });
   
   // POST /api/setup/rooms
   router.post('/rooms', async (req, res) => {
     const { farm_id } = req.user;
     const { rooms } = req.body; // Array of room definitions
     
     for (const room of rooms) {
       await req.app.locals.db.query(
         'INSERT INTO rooms (farm_id, name, type, capacity) VALUES ($1, $2, $3, $4)',
         [farm_id, room.name, room.type, room.capacity]
       );
     }
     
     res.json({ success: true });
   });
   
   // GET /api/setup/status
   router.get('/status', async (req, res) => {
     const { farm_id } = req.user;
     
     const farmResult = await req.app.locals.db.query(
       'SELECT timezone, business_hours FROM farms WHERE farm_id = $1',
       [farm_id]
     );
     
     const roomsResult = await req.app.locals.db.query(
       'SELECT COUNT(*) FROM rooms WHERE farm_id = $1',
       [farm_id]
     );
     
     res.json({
       completed: {
         farm_profile: !!farmResult.rows[0].timezone,
         rooms: roomsResult.rows[0].count > 0
       }
     });
   });
   
   export default router;
   ```

2. Mount in server-foxtrot.js:
   ```javascript
   import setupWizardRouter from './routes/setup-wizard.js';
   app.use('/api/setup', farmAuthMiddleware, setupWizardRouter);
   ```

**Estimated Effort:** 4-6 hours

---

#### 4.7 Password Reset Flow
**Impact:** Users locked out can't recover access

**Current State:**
- No forgot password functionality
- No password reset endpoints

**Required Actions:**
1. Add password reset endpoints
2. Email password reset links
3. Token-based reset verification

**Estimated Effort:** 4-5 hours

---

#### 4.8 Email Verification
**Impact:** Prevents spam/fake accounts

**Current State:**
- Accounts created without email verification

**Required Actions:**
1. Send verification email after purchase
2. Require verification before full access
3. Add `/api/auth/verify-email/:token` endpoint

**Estimated Effort:** 3-4 hours

---

### 🟢 Nice-to-Have Features (Future)

- Multi-user management (invite team members)
- Role-based access control (admin, manager, operator)
- Farm dashboard onboarding tour
- In-app help system
- Account settings page
- Subscription management (upgrade/downgrade)
- Billing history

---

## 5. Implementation Roadmap

### Phase 1: Core Infrastructure (Days 1-2)
**Goal:** Make database and purchase flow operational

**Tasks:**
1. ✅ Restore server-foxtrot.js (COMPLETED)
2. 🔴 Deploy database schema to RDS
   - Write migration SQL
   - Test connection from EB
   - Create tables: farms, users
   - Add indexes
3. 🔴 Convert purchase.js to ES module
4. 🔴 Integrate purchase routes into server-foxtrot.js
5. 🔴 Configure database connection in server-foxtrot.js
6. 🔴 Test end-to-end purchase → account creation

**Deliverable:** Payment creates real database account

---

### Phase 2: Authentication & Login (Day 3)
**Goal:** Users can log in with credentials

**Tasks:**
1. 🔴 Create login page (`LE-login.html`)
2. 🔴 Update `/api/farm/auth/login` to use database
3. 🔴 Add bcrypt password verification
4. 🔴 Add JWT token generation for real users
5. 🔴 Test login flow with test account
6. 🔴 Add error handling and validation

**Deliverable:** Functional login page with database auth

---

### Phase 3: Email & Credentials (Day 4)
**Goal:** Users receive credentials after purchase

**Tasks:**
1. 🔴 Configure SendGrid API key
2. 🔴 Update email.js with real SMTP
3. 🔴 Test welcome email sending
4. 🔴 Add email templates (HTML formatting)
5. 🔴 Add email logging/tracking

**Deliverable:** Welcome emails sent automatically after purchase

---

### Phase 4: First-Time Setup (Days 5-6)
**Goal:** New users complete farm configuration

**Tasks:**
1. 🟡 Create setup wizard backend API
2. 🟡 Add database tables for rooms/zones
3. 🟡 Connect setup-wizard.html to API
4. 🟡 Add setup completion tracking
5. 🟡 Redirect new users to setup wizard
6. 🟡 Show dashboard after setup complete

**Deliverable:** Complete onboarding experience

---

### Phase 5: Polish & Testing (Day 7)
**Goal:** Production-ready system

**Tasks:**
1. 🟡 Add password reset flow
2. 🟡 Add email verification
3. 🟡 End-to-end testing (purchase → login → setup → dashboard)
4. 🟡 Error handling and edge cases
5. 🟡 Performance testing
6. 🟡 Security audit
7. 🟡 Documentation

**Deliverable:** Launch-ready new user experience

---

## 6. Environment Configuration Checklist

### Elastic Beanstalk Environment Variables

**Already Configured:**
- ✅ `SQUARE_ENVIRONMENT`: sandbox
- ✅ `SQUARE_APPLICATION_ID`: sandbox-sq0idb-ByoyD4t2Zy96QhAUZd9_SA
- ✅ `SQUARE_LOCATION_ID`: LJKZRNNRPAQ99
- ✅ `SQUARE_ACCESS_TOKEN`: [configured]
- ✅ `JWT_SECRET`: [stored in Secrets Manager]
- ✅ `DB_HOST`: light-engine-db.c8rq44ew6swb.us-east-1.rds.amazonaws.com
- ✅ `DB_PORT`: 5432
- ✅ `DB_NAME`: lightengine
- ✅ `DB_USER`: lightengine
- ✅ `DB_PASSWORD`: [stored in Secrets Manager]
- ✅ `DB_SSL`: true

**Need to A
- ❌ `SENDGRID_API_KEY`: [obtain from SendGrid]
- ❌ `EMAIL_FROM`: support@greenreach.ca
- ❌ `FRONTEND_URL`: https://light-engine-foxtrot-prod.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com
- ❌ `NODE_ENV`: production
- ❌ `DEMO_MODE`: false (ensure production users don't get demo treatment)
- ❌ `ALLOW_MOCKS`: false (already default, but explicit is better)

---

## 7. Testing Checklist

### Manual Testing Sequence

**Test 1: Purchase Flow**
```
1. Visit: /LEMarketing-purchase.html
2. Click "Start Cloud Plan"
3. Fill form:
   - Farm Name: Test Farm 2025
   - Contact: John Doe
   - Email: test@example.com
4. Click "Purchase Now"
5. Complete Square sandbox payment
6. Verify: Account created in database
7. Verify: Welcome email sent
```

**Test 2: Login Flow**
```
1. Open email, copy credentials
2. Visit: /LE-login.html
3. Enter:
   - Farm ID: [from email]
   - Email: test@example.com
   - Password: [temp password]
4. Click "Sign In"
5. Verify: JWT token returned
6. Verify: Redirected to dashboard or setup wizard
```

**Test 3: First-Time Setup**
```
1. After login, verify setup wizard appears
2. Complete farm profile
3. Add rooms/zones
4. Verify: Data saved to database
5. Verify: Redirected to dashboard
6. Verify: No mock data visible
7. Verify: Clean inventory/sales state
```

**Test 4: Demo Mode Isolation**
```
1. Enable DEMO_MODE=true
2. Visit purchase page
3. Verify: Demo users can't see real user data
4. Disable DEMO_MODE=false
5. Login as real user
6. Verify: No demo mock data visible
```

### Automated Tests Needed

- Purchase API endpoints (unit tests)
- Authentication flow (integration tests)
- Database schema validation (migration tests)
- Email delivery (mock tests)
- JWT token generation/validation (unit tests)
- Setup wizard API (integration tests)

---

## 8. Security Considerations

### Password Security ✅
- Using bcrypt with salt rounds (10)
- Passwords never stored in plain text
- Temporary passwords generated securely (crypto.randomBytes)

### JWT Security ⚠️
- JWT secret stored in Secrets Manager ✅
- 24-hour token expiry ✅
- Need to add: Token refresh mechanism ❌
- Need to add: Token revocation on logout ❌

### Database Security ✅
- Parameterized queries (prevents SQL injection)
- SSL connection to RDS
- Credentials in Secrets Manager

### API Security ⚠️
- Rate limiting exists in server-foxtrot.js ✅
- CORS configured ✅
- Need to add: API key validation for programmatic access ❌
- Need to add: Request signing for sensitive endpoints ❌

### Email Security ⚠️
- Need to add: SPF/DKIM/DMARC records ❌
- Need to add: Email verification to prevent spoofing ❌

---

## 9. Cost Estimates (AWS)

**Current Infrastructure:**
- Elastic Beanstalk: ~$40/month (t3.small)
- RDS PostgreSQL: ~$25/month (db.t3.micro)
- S3 Storage: ~$5/month
- **Total: ~$70/month**

**Additional for New User Flow:**
- SendGrid: $0 (free tier up to 100 emails/day)
- Secrets Manager: $0.40/secret/month (~$1/month total)
- CloudWatch Logs: ~$5/month
- **New Total: ~$76/month**

**Per-User Costs:**
- Database storage: ~1MB per farm
- Email: $0 (free tier sufficient for initial launch)
- Compute: negligible (shared instance)

---

## 10. Recommendations

### Immediate Actions (This Week)

1. **Deploy Database Schema** (Highest Priority)
   - Write SQL migration
   - Test locally with PostgreSQL
   - Deploy to RDS
   - Verify connection from EB

2. **Integrate Purchase Flow**
   - Convert purchase.js to ES module
   - Mount routes in server-foxtrot.js
   - Test payment → account creation

3. **Create Login Page**
   - Design matching GreenReach branding
   - Add form validation
   - Connect to /api/farm/auth/login

4. **Configure Email Service**
   - Set up SendGrid account
   - Add API key to EB environment
   - Test welcome email sending

### Short-Term (Next 2 Weeks)

1. **Setup Wizard Backend**
   - Build API endpoints
   - Connect to database
   - Test onboarding flow

2. **Password Reset**
   - Add forgot password flow
   - Email reset links
   - Token-based verification

3. **Email Verification**
   - Send verification emails
   - Add verification endpoint
   - Require before full access

### Long-Term (Next Month)

1. **Multi-User Support**
   - Team member invitations
   - Role-based permissions
   - User management UI

2. **Subscription Management**
   - Billing portal
   - Plan upgrades/downgrades
   - Payment method updates

3. **Enhanced Security**
   - Two-factor authentication
   - IP whitelisting
   - Audit logging

---

## 11. Risk Assessment

### High Risks

**Risk:** Database schema errors break production
- **Mitigation:** Test migrations thoroughly, backup RDS before changes
- **Rollback Plan:** Revert to previous schema version

**Risk:** Email delivery fails, users don't get credentials
- **Mitigation:** Log all credential generation, add admin panel to resend
- **Fallback:** Display credentials on purchase success page (temporary)

**Risk:** Authentication bugs lock users out
- **Mitigation:** Keep demo mode bypass functional, add admin override
- **Fallback:** Manual password reset by support team

### Medium Risks

**Risk:** Setup wizard doesn't save data correctly
- **Mitigation:** Add transaction rollback, validate all inputs
- **Fallback:** Allow users to skip wizard, configure later

**Risk:** Purchase flow creates duplicate accounts
- **Mitigation:** Add unique constraint on email, check before creation
- **Fallback:** Admin panel to merge duplicate accounts

### Low Risks

**Risk:** Demo mode isolation fails, mock data leaks
- **Mitigation:** Extensive testing, clear separation of demo/prod logic
- **Fallback:** Manual data cleanup

---

## 12. Success Criteria

### MVP Launch Ready (Minimum Viable Product)

- [ ] User can purchase Cloud plan ($1 CAD sandbox)
- [ ] Account created in database automatically
- [ ] User receives welcome email with credentials
- [ ] User can log in with provided credentials
- [ ] New user sees clean system (no mock data)
- [ ] User can access basic dashboard features
- [ ] Demo mode isolation works correctly
- [ ] All payments processed securely via Square

### Full Production Ready

- [ ] All MVP criteria met
- [ ] Setup wizard functional (farm profile, rooms, zones)
- [ ] Email verification required
- [ ] Password reset flow working
- [ ] Multi-user support (invite team members)
- [ ] Role-based access control
- [ ] Comprehensive error handling
- [ ] Security audit completed
- [ ] Performance testing passed
- [ ] Documentation complete

---

## 13. Next Steps

### Developer Actions Required

**Today:**
1. Review this report with stakeholders
2. Prioritize features for MVP vs full production
3. Set up SendGrid account and obtain API key
4. Write database migration SQL for farms/users tables

**This Week:**
1. Deploy database schema to RDS
2. Integrate purchase flow into server-foxtrot.js
3. Create login page
4. Configure email service
5. Test end-to-end: purchase → email → login

**Next Week:**
1. Build setup wizard backend
2. Add password reset flow
3. Implement email verification
4. Complete end-to-end testing
5. Security review
6. Performance testing

### Stakeholder Decisions Needed

1. **Email Provider:** Confirm SendGrid or choose alternative (AWS SES, Mailgun)
2. **MVP Scope:** Approve minimal feature set for initial launch
3. **Timeline:** Set target launch date based on this roadmap
4. **Budget:** Approve additional AWS costs (~$6/month increase)
5. **Domain:** Decide on production domain (vs EB default URL)

---

## Appendix A: File Reference

**Key Files for Implementation:**

| File | Path | Purpose | Status |
|------|------|---------|--------|
| Main Server | `/server-foxtrot.js` | Production server (21,753 lines) | ✅ Restored |
| Purchase Routes | `/routes/purchase.js` | Payment & account creation | ⚠️ Not integrated |
| Database Config | `/db.js` | PostgreSQL connection pool | ⚠️ Not used |
| Email Service | `/email.js` | Welcome email sending | ⚠️ Mock only |
| Auth Routes | `/routes/auth.js` | Device pairing (not user login) | ✅ Working |
| Setup Wizard UI | `/setup-wizard.html` | Onboarding interface | ✅ Exists, no backend |
| Purchase Page | `/public/purchase.html` | Square checkout form | ✅ Working (new naming) |
| Landing Pages | `/public/landing-*.html` | Marketing pages | ✅ Updated naming |
| AI Agent Service | `/services/ai-agent.js` | OpenAI integration (729 lines) | ✅ Implemented |
| AI Agent Routes | `/routes/farm-sales/ai-agent.js` | API endpoints | ✅ Mounted |
| Package Config | `/package.json` | Node.js dependencies | ✅ Restored |
| Environment | `/.ebextensions/env.config` | EB env variables | ✅ Configured |

**Missing Files:**
- `/public/LE-login.html` - Need to create
- `/routes/setup-wizard.js` - Need to create
- `/migrations/001_create_farms_users.sql` - Need to create

---

## Appendix B: Database Schema

**Required Tables:**

```sql
-- Farms table
CREATE TABLE farms (
  farm_id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  contact_name VARCHAR(255) NOT NULL,
  plan_type VARCHAR(50) NOT NULL CHECK (plan_type IN ('cloud', 'edge')),
  
  -- API Credentials
  api_key VARCHAR(255) NOT NULL UNIQUE,
  api_secret VARCHAR(255) NOT NULL,
  jwt_secret VARCHAR(255) NOT NULL,
  
  -- Payment Info
  square_payment_id VARCHAR(255),
  square_amount INTEGER,
  
  -- Status
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'cancelled')),
  
  -- Metadata
  timezone VARCHAR(100),
  business_hours JSONB,
  certifications JSONB,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_farms_email ON farms(email);
CREATE INDEX idx_farms_status ON farms(status);

-- Users table
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  
  -- Authentication
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  
  -- Profile
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) DEFAULT 'admin' CHECK (role IN ('admin', 'manager', 'operator', 'viewer')),
  
  -- Status
  is_active BOOLEAN DEFAULT true,
  email_verified BOOLEAN DEFAULT false,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_farm_id ON users(farm_id);

-- Optional: Rooms table (for setup wizard)
CREATE TABLE rooms (
  room_id SERIAL PRIMARY KEY,
  farm_id VARCHAR(50) NOT NULL REFERENCES farms(farm_id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50),
  capacity INTEGER,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_rooms_farm_id ON rooms(farm_id);
```

---

## Appendix C: Welcome Email Template

**Subject:** Welcome to Light Engine - Your Account is Ready

```html
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #10b981; color: white; padding: 30px; text-align: center; }
    .content { padding: 30px; background: #f8f9fb; }
    .credentials { background: white; padding: 20px; border-left: 4px solid #10b981; margin: 20px 0; }
    .button { display: inline-block; padding: 12px 24px; background: #10b981; color: white; text-decoration: none; border-radius: 6px; }
    .footer { text-align: center; padding: 20px; color: #6e6e73; font-size: 12px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Welcome to Light Engine!</h1>
    </div>
    
    <div class="content">
      <h2>Hi {{contact_name}},</h2>
      
      <p>Thank you for choosing Light Engine to power {{farm_name}}. Your account is now active and ready to use!</p>
      
      <div class="credentials">
        <h3>Your Login Credentials</h3>
        <p><strong>Farm ID:</strong> {{farm_id}}</p>
        <p><strong>Email:</strong> {{email}}</p>
        <p><strong>Temporary Password:</strong> <code>{{temp_password}}</code></p>
      </div>
      
      <p>
        <a href="{{login_url}}" class="button">Log In to Your Dashboard</a>
      </p>
      
      <h3>What's Next?</h3>
      <ol>
        <li>Log in using the credentials above</li>
        <li>Complete your farm profile setup</li>
        <li>Configure your rooms and growing zones</li>
        <li>Start managing inventory and sales</li>
      </ol>
      
      <p><strong>Important:</strong> Please change your password after your first login for security.</p>
      
      <p>If you have any questions, our support team is here to help at <a href="mailto:support@greenreach.ca">support@greenreach.ca</a></p>
      
      <p>Happy growing! 🌱</p>
      <p>- The GreenReach Team</p>
    </div>
    
    <div class="footer">
      <p>This email was sent to {{email}}<br>
      GreenReach Farms | Light Engine Division<br>
      <a href="{{unsubscribe_url}}">Unsubscribe</a></p>
    </div>
  </div>
</body>
</html>
```

---

**End of Report**

*This report provides a comprehensive analysis of the current system state and a detailed roadmap for implementing a complete new user experience: from cloud option selection through secure payment, account creation, credential delivery, login, and first-time setup with no mock data.*
