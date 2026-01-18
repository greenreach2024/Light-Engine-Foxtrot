# GreenReach Central Admin - Production Readiness Report

**Report Date:** December 30, 2025  
**System:** GreenReach Central Operations (Business Admin Portal)  
**Purpose:** Base of operations for managing all farms, subscriptions, and wholesale sales  
**Access Level:** Internal business admin only (NOT publicly accessible)  
**URL:** `/GR-central-admin.html`

---

## Executive Summary

### 🟡 CURRENT STATUS: NOT PRODUCTION READY

**Critical Blockers:** 4  
**High Priority Issues:** 6  
**Medium Priority Issues:** 8  
**Total Estimated Fix Time:** 32-40 hours

### Key Findings:

✅ **Strengths:**
- Comprehensive farm monitoring dashboard exists
- Farm management API endpoints functional
- Delete farm capability implemented
- Wholesale integration architecture in place
- QuickBooks sync service already built

❌ **Critical Gaps:**
- **AUTH GATING REQUIRED** - Demo login must be explicitly enabled for non-prod
- Admin login exists, but demo auth must be gated by runtime flag
- Farm management view required auth headers (now addressed)
- No IP whitelist or VPN requirement
- QuickBooks OAuth not wired to admin UI

---

## Part 1: Security Assessment

### 🔴 CRITICAL: Authentication & Authorization

#### Issue 1.1: Admin Authentication Requires Gating

**Current State:**
- Admin login exists (server-side JWT) in GR-central-admin-login.html.
- Admin API routes require JWT via `requireAdmin` in admin-farm-management.js.
- Demo login must be explicitly enabled to avoid client-side auth bypass.

**Risk Level:** 🔴 CRITICAL  
**Impact:** Unauthorized access possible if demo auth is enabled in production.

**Required Implementation:**
```javascript
// 1. Gate demo auth behind a runtime flag
// File: public/GR-central-admin-login.html
<form id="admin-login-form">
  <input type="email" name="email" required />
  <input type="password" name="password" required />
  <input type="text" name="mfa_code" placeholder="2FA Code" required />
  <button type="submit">Login to Admin Portal</button>
</form>

// 2. Create admin authentication endpoint
// server-foxtrot.js
app.post('/api/admin/auth/login', asyncHandler(async (req, res) => {
  const { email, password, mfa_code } = req.body;
  
  // Validate against admin users table
  const result = await dbPool.query(
    'SELECT * FROM admin_users WHERE email = $1 AND active = true',
    [email]
  );
  
  if (result.rows.length === 0) {
    // Log failed attempt
    await logAuditEvent('ADMIN_LOGIN_FAILURE', { email, reason: 'user_not_found' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  const admin = result.rows[0];
  
  // Verify password
  const validPassword = await bcrypt.compare(password, admin.password_hash);
  if (!validPassword) {
    await logAuditEvent('ADMIN_LOGIN_FAILURE', { email, reason: 'invalid_password' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Verify 2FA
  const valid2FA = verifyTOTP(admin.mfa_secret, mfa_code);
  if (!valid2FA) {
    await logAuditEvent('ADMIN_LOGIN_FAILURE', { email, reason: 'invalid_2fa' });
    return res.status(401).json({ error: 'Invalid 2FA code' });
  }
  
  // Generate admin JWT with short expiry
  const token = jwt.sign(
    { 
      admin_id: admin.id, 
      email: admin.email, 
      role: 'admin',
      permissions: admin.permissions 
    },
    getJwtSecret(),
    { expiresIn: '4h' } // Shorter expiry for admin
  );
  
  await logAuditEvent('ADMIN_LOGIN_SUCCESS', { admin_id: admin.id, email });
  
  res.json({ 
    success: true, 
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      permissions: admin.permissions
    }
  });
}));

// 3. Create admin authentication middleware
function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Admin authentication required' });
  }
  
  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, getJwtSecret());
    
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    
    req.admin = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid or expired admin token' });
  }
}

// 4. Protect ALL admin routes
app.get('/api/admin/farms', requireAdmin, asyncHandler(async (req, res) => { /* ... */ }));
app.get('/api/admin/farms/db', requireAdmin, asyncHandler(async (req, res) => { /* ... */ }));
app.delete('/api/admin/farms/:email', requireAdmin, asyncHandler(async (req, res) => { /* ... */ }));
app.get('/api/admin/analytics/aggregate', requireAdmin, asyncHandler(async (req, res) => { /* ... */ }));

// 5. Add authentication check to admin HTML
// GR-central-admin.html
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('admin_token');
  
  if (!token) {
    window.location.href = '/GR-central-admin-login.html';
    return;
  }
  
  // Verify token is still valid
  fetch('/api/admin/auth/verify', {
    headers: { 'Authorization': `Bearer ${token}` }
  })
  .then(res => {
    if (!res.ok) {
      localStorage.removeItem('admin_token');
      window.location.href = '/GR-central-admin-login.html';
    }
  });
  
  // Initialize admin dashboard
  initAdminDashboard();
});
```

**Estimated Time:** 8 hours

---

#### Issue 1.2: No Multi-Factor Authentication (2FA)

**Current State:**  
- No 2FA implementation  
- Single-factor password authentication would be insufficient for admin access

**Required Implementation:**
```javascript
// Use TOTP (Time-based One-Time Password) like Google Authenticator
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

// Generate 2FA secret for new admin user
app.post('/api/admin/setup-2fa', requireAdmin, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: 'GreenReach Central Admin',
    issuer: 'GreenReach'
  });
  
  // Generate QR code
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);
  
  // Store secret in database (encrypted)
  await dbPool.query(
    'UPDATE admin_users SET mfa_secret = $1 WHERE id = $2',
    [secret.base32, req.admin.admin_id]
  );
  
  res.json({
    secret: secret.base32,
    qrCode: qrCodeUrl
  });
});

// Verify 2FA code
function verifyTOTP(secret, token) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token,
    window: 2 // Allow 60 second time drift
  });
}
```

**Estimated Time:** 4 hours

---

#### Issue 1.3: No Admin Users Database Table

**Current State:**  
- No `admin_users` table exists
- No way to manage who has admin access

**Required Implementation:**
```sql
-- Database migration: create admin_users table
CREATE TABLE admin_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  mfa_secret VARCHAR(255), -- TOTP secret
  permissions JSONB DEFAULT '["read", "write", "delete"]',
  active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_users_email ON admin_users(email);
CREATE INDEX idx_admin_users_active ON admin_users(active);

-- Insert first admin user (use bcrypt hash)
-- Password: ChangeMe123! (MUST change on first login)
INSERT INTO admin_users (email, password_hash, name, active)
VALUES (
  'admin@greenreach.com',
  '$2a$10$YOUR_BCRYPT_HASH_HERE',
  'System Administrator',
  true
);

-- Create admin sessions table for tracking
CREATE TABLE admin_sessions (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id),
  token_hash VARCHAR(255) NOT NULL,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_sessions_admin_id ON admin_sessions(admin_id);
CREATE INDEX idx_admin_sessions_expires ON admin_sessions(expires_at);
```

**Estimated Time:** 2 hours

---

### 🔴 CRITICAL: Access Control

#### Issue 1.4: No IP Whitelisting or VPN Requirement

**Current State:**  
- Admin portal accessible from any IP address worldwide

**Recommended Implementation:**
```javascript
// Option 1: IP Whitelist Middleware
const ADMIN_IP_WHITELIST = (process.env.ADMIN_IP_WHITELIST || '').split(',');

function requireWhitelistedIP(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress;
  
  if (!ADMIN_IP_WHITELIST.includes(clientIP)) {
    await logAuditEvent('ADMIN_ACCESS_DENIED', { 
      ip: clientIP, 
      reason: 'not_whitelisted' 
    });
    return res.status(403).json({ error: 'Access denied: IP not whitelisted' });
  }
  
  next();
}

// Option 2: Cloudflare Access (Recommended)
// Set up Cloudflare Access rules:
// 1. Only allow specific email domains (@greenreach.com)
// 2. Require Google Workspace authentication
// 3. Apply to /GR-central-admin* paths

// Option 3: VPN Requirement
// - Set up Tailscale or AWS VPN
// - Admin portal only accessible via VPN
// - Configure security groups in AWS
```

**Recommended Solution:** Cloudflare Access (easiest, most secure)  
**Estimated Time:** 2 hours (Cloudflare setup)

---

### 🔴 CRITICAL: Audit Logging

#### Issue 1.5: No Admin Action Logging

**Current State:**  
- Admin actions (delete farm, view data) are not logged
- No accountability or forensic trail

**Required Implementation:**
```sql
-- Create admin audit log table
CREATE TABLE admin_audit_log (
  id SERIAL PRIMARY KEY,
  admin_id INTEGER REFERENCES admin_users(id),
  admin_email VARCHAR(255),
  action VARCHAR(100) NOT NULL, -- 'DELETE_FARM', 'VIEW_FARM', 'EXPORT_DATA', etc.
  resource_type VARCHAR(50), -- 'farm', 'user', 'order', 'payment'
  resource_id VARCHAR(255),
  details JSONB,
  ip_address INET,
  user_agent TEXT,
  success BOOLEAN DEFAULT true,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_admin_audit_admin_id ON admin_audit_log(admin_id);
CREATE INDEX idx_admin_audit_action ON admin_audit_log(action);
CREATE INDEX idx_admin_audit_created_at ON admin_audit_log(created_at);
```

```javascript
// Admin audit logging middleware
async function logAdminAction(adminId, action, details, req) {
  await dbPool.query(`
    INSERT INTO admin_audit_log 
    (admin_id, admin_email, action, resource_type, resource_id, details, ip_address, user_agent)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `, [
    adminId,
    req.admin.email,
    action,
    details.resource_type,
    details.resource_id,
    details,
    req.ip,
    req.get('user-agent')
  ]);
}

// Use in admin endpoints
app.delete('/api/admin/farms/:email', requireAdmin, asyncHandler(async (req, res) => {
  const { email } = req.params;
  
  // Log the action BEFORE doing it
  await logAdminAction(req.admin.admin_id, 'DELETE_FARM_REQUEST', {
    resource_type: 'farm',
    resource_id: email
  }, req);
  
  // Perform deletion
  const result = await deleteFarmsAndUsers(email);
  
  // Log success
  await logAdminAction(req.admin.admin_id, 'DELETE_FARM_SUCCESS', {
    resource_type: 'farm',
    resource_id: email,
    deleted_farms: result.farmIds,
    deleted_users: result.userIds
  }, req);
  
  res.json(result);
}));
```

**Estimated Time:** 4 hours

---

## Part 2: Farm Management Features

### ✅ Implemented Features:

1. **View All Farms** (`GET /api/admin/farms`)
   - Lists all farms with metrics (rooms, zones, devices, trays)
   - Supports pagination, filtering by status/region
   - Shows real-time health data

2. **View Farm Details** (`GET /api/admin/farms/:farmId`)
   - Detailed farm information
   - Environmental data
   - Device inventory
   - Current status

3. **Delete Farms** (`DELETE /api/admin/farms/:email`)
   - Delete all farms and users for an email address
   - Proper foreign key handling
   - Returns list of deleted resources

4. **Database Farm List** (`GET /api/admin/farms/db`)
   - Direct database query of farms
   - Shows email, plan type, status, timestamps

5. **Analytics Dashboard** (`GET /api/admin/analytics/aggregate`)
   - Platform-wide metrics
   - Farm health aggregation

### 🟡 Missing Features:

#### Feature 2.1: Subscription Management

**Current State:** No subscription management in admin UI

**Required:**
```javascript
// 1. View all subscriptions
app.get('/api/admin/subscriptions', requireAdmin, async (req, res) => {
  const result = await dbPool.query(`
    SELECT 
      s.*,
      f.name as farm_name,
      f.email as farm_email,
      f.status as farm_status
    FROM subscriptions s
    JOIN farms f ON s.farm_id = f.farm_id
    ORDER BY s.created_at DESC
  `);
  
  res.json({ subscriptions: result.rows });
});

// 2. Update subscription status
app.patch('/api/admin/subscriptions/:subscriptionId', requireAdmin, async (req, res) => {
  const { subscriptionId } = req.params;
  const { status, notes } = req.body;
  
  await logAdminAction(req.admin.admin_id, 'UPDATE_SUBSCRIPTION', {
    subscription_id: subscriptionId,
    old_status: '...',
    new_status: status
  }, req);
  
  await dbPool.query(
    'UPDATE subscriptions SET status = $1, admin_notes = $2, updated_at = NOW() WHERE id = $3',
    [status, notes, subscriptionId]
  );
  
  res.json({ success: true });
});

// 3. Cancel subscription
app.post('/api/admin/subscriptions/:subscriptionId/cancel', requireAdmin, async (req, res) => {
  const { subscriptionId } = req.params;
  const { reason } = req.body;
  
  // Cancel in Square
  // Cancel subscription record
  // Notify farm owner
  // Log action
});

// 4. Extend/upgrade subscription
app.post('/api/admin/subscriptions/:subscriptionId/extend', requireAdmin, async (req, res) => {
  // Manual extension for customer service
});
```

**UI Components Needed:**
- Subscriptions table in admin dashboard
- Subscription detail modal
- Cancel/extend/upgrade actions
- Billing history view

**Estimated Time:** 6 hours

---

#### Feature 2.2: User Management

**Required:**
```javascript
// 1. View all users across all farms
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  const result = await dbPool.query(`
    SELECT 
      u.user_id,
      u.email,
      u.role,
      u.created_at,
      f.farm_id,
      f.name as farm_name
    FROM users u
    JOIN farms f ON u.farm_id = f.farm_id
    ORDER BY u.created_at DESC
  `);
  
  res.json({ users: result.rows });
});

// 2. Reset user password
app.post('/api/admin/users/:userId/reset-password', requireAdmin, async (req, res) => {
  // Generate temporary password
  // Send email to user
  // Log action
});

// 3. Disable/enable user
app.patch('/api/admin/users/:userId/status', requireAdmin, async (req, res) => {
  // Update user status
  // Log action
});
```

**Estimated Time:** 4 hours

---

#### Feature 2.3: Farm Support Tools

**Required:**
```javascript
// 1. Impersonate farm (for support)
app.post('/api/admin/impersonate/:farmId', requireAdmin, async (req, res) => {
  await logAdminAction(req.admin.admin_id, 'IMPERSONATE_FARM', {
    farm_id: req.params.farmId
  }, req);
  
  // Generate temporary farm token
  const token = jwt.sign({ 
    farm_id: req.params.farmId,
    impersonated_by: req.admin.admin_id 
  }, getJwtSecret(), { expiresIn: '1h' });
  
  res.json({ token, expires_in: '1h' });
});

// 2. Reset farm data
app.post('/api/admin/farms/:farmId/reset', requireAdmin, async (req, res) => {
  // Clear rooms, zones, devices, but keep farm record
});

// 3. Export farm data
app.get('/api/admin/farms/:farmId/export', requireAdmin, async (req, res) => {
  // Export all farm data as JSON
});
```

**Estimated Time:** 4 hours

---

## Part 3: Wholesale & Sales Integration

### ✅ Existing Wholesale Features:

1. **Wholesale Routes** (`routes/wholesale-*.js`)
   - Catalog management
   - Order processing
   - Payment handling
   - Fulfillment tracking

2. **Wholesale Admin Portal** (`/GR-admin.html`)
   - Separate admin interface exists
   - Manages wholesale network
   - Order oversight

### 🟡 Integration Gaps:

#### Issue 3.1: Wholesale Data Not in Central Admin

**Current State:**  
- Wholesale orders, payments, and inventory are in separate portal
- Central admin has no visibility into wholesale operations

**Required:**
```javascript
// Add wholesale section to central admin dashboard

// 1. Wholesale orders widget
app.get('/api/admin/wholesale/orders/summary', requireAdmin, async (req, res) => {
  const result = await dbPool.query(`
    SELECT 
      COUNT(*) as total_orders,
      SUM(total_amount) as total_revenue,
      COUNT(*) FILTER (WHERE status = 'pending') as pending_orders,
      COUNT(*) FILTER (WHERE status = 'fulfilled') as fulfilled_orders
    FROM wholesale_orders
    WHERE created_at > NOW() - INTERVAL '30 days'
  `);
  
  res.json(result.rows[0]);
});

// 2. Top selling products
app.get('/api/admin/wholesale/products/top', requireAdmin, async (req, res) => {
  // Query top products by revenue
});

// 3. Farm performance leaderboard
app.get('/api/admin/wholesale/farms/performance', requireAdmin, async (req, res) => {
  // Rank farms by wholesale sales
});
```

**Estimated Time:** 4 hours

---

## Part 4: QuickBooks Integration

### ✅ Existing Infrastructure:

1. **QuickBooks OAuth Service** (`services/quickbooks-oauth.js`)
   - Authorization flow implemented
   - Token management
   - Token refresh logic

2. **QuickBooks Sync Service** (`services/quickbooks-sync.js`)
   - Customer sync
   - Product/item sync
   - Invoice sync
   - Payment sync

3. **QuickBooks Export Reports** (`greenreach-central/routes/reports.js`)
   - Daily summary export
   - CSV format for QuickBooks import

### 🔴 CRITICAL: Not Wired to Admin UI

**Current State:**  
- All QuickBooks code exists but not accessible from admin interface
- No UI to connect QuickBooks account
- No UI to trigger syncs
- No sync status visibility

**Required Implementation:**

```javascript
// 1. Add QuickBooks section to admin dashboard
// GR-central-admin.html
<div class="nav-section">
  <div class="nav-section-title">Accounting</div>
  <div class="nav-item" onclick="navigate('quickbooks', this)">
    QuickBooks Integration
  </div>
</div>

// 2. QuickBooks connection page
<div id="quickbooks-view" class="view" style="display: none;">
  <h1>QuickBooks Online Integration</h1>
  
  <div class="card">
    <h3>Connection Status</h3>
    <div id="qb-status">
      <span class="badge badge-danger">Not Connected</span>
    </div>
    <button onclick="connectQuickBooks()">Connect to QuickBooks</button>
  </div>
  
  <div class="card" id="qb-sync-section" style="display: none;">
    <h3>Sync Controls</h3>
    <button onclick="syncCustomers()">Sync Customers</button>
    <button onclick="syncProducts()">Sync Products</button>
    <button onclick="syncInvoices()">Sync Invoices</button>
    <button onclick="syncAll()">Sync All</button>
  </div>
  
  <div class="card">
    <h3>Sync History</h3>
    <table id="qb-sync-history">
      <!-- Show last syncs, status, errors -->
    </table>
  </div>
  
  <div class="card">
    <h3>Export Reports</h3>
    <button onclick="exportDailySummary()">Export Daily Summary (CSV)</button>
    <button onclick="exportMonthlyReport()">Export Monthly Report</button>
  </div>
</div>

// 3. Admin API endpoints for QuickBooks
app.get('/api/admin/quickbooks/status', requireAdmin, async (req, res) => {
  // Check if QuickBooks is connected
  const result = await dbPool.query(
    'SELECT * FROM quickbooks_connections WHERE active = true LIMIT 1'
  );
  
  res.json({
    connected: result.rows.length > 0,
    company_name: result.rows[0]?.company_name,
    last_sync: result.rows[0]?.last_sync_at
  });
});

app.get('/api/admin/quickbooks/connect', requireAdmin, (req, res) => {
  const authUrl = generateQuickBooksAuthUrl();
  res.json({ authUrl });
});

app.get('/api/admin/quickbooks/callback', requireAdmin, async (req, res) => {
  const { code } = req.query;
  
  // Exchange code for tokens
  const tokens = await exchangeCodeForTokens(code);
  
  // Store in database
  await dbPool.query(`
    INSERT INTO quickbooks_connections (access_token, refresh_token, realm_id, active)
    VALUES ($1, $2, $3, true)
  `, [tokens.access_token, tokens.refresh_token, tokens.realm_id]);
  
  res.redirect('/GR-central-admin.html?view=quickbooks&connected=true');
});

app.post('/api/admin/quickbooks/sync/:type', requireAdmin, async (req, res) => {
  const { type } = req.params; // 'customers', 'products', 'invoices', 'payments', 'all'
  
  await logAdminAction(req.admin.admin_id, 'QUICKBOOKS_SYNC', {
    sync_type: type
  }, req);
  
  // Trigger sync
  const result = await runQuickBooksSync(type);
  
  res.json(result);
});

app.get('/api/admin/quickbooks/sync-history', requireAdmin, async (req, res) => {
  const result = await dbPool.query(`
    SELECT * FROM quickbooks_sync_log
    ORDER BY started_at DESC
    LIMIT 50
  `);
  
  res.json({ history: result.rows });
});

app.get('/api/admin/quickbooks/export/daily', requireAdmin, async (req, res) => {
  const { date } = req.query;
  
  // Generate CSV export
  const csv = await generateDailySummaryCSV(date);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="greenreach-daily-${date}.csv"`);
  res.send(csv);
});
```

**Database Tables Needed:**
```sql
CREATE TABLE quickbooks_connections (
  id SERIAL PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  realm_id VARCHAR(255) NOT NULL,
  company_name VARCHAR(255),
  active BOOLEAN DEFAULT true,
  expires_at TIMESTAMP,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE quickbooks_sync_log (
  id SERIAL PRIMARY KEY,
  sync_type VARCHAR(50) NOT NULL, -- 'customers', 'products', 'invoices', 'all'
  status VARCHAR(50) NOT NULL, -- 'running', 'success', 'failed'
  records_synced INTEGER DEFAULT 0,
  errors JSONB,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  initiated_by INTEGER REFERENCES admin_users(id)
);
```

**Estimated Time:** 8 hours

---

## Part 5: Inter-Farm Communication Security

### Current Architecture:

**Farm-to-Central Communication:**
```
Light Engine Farm (Edge Device)
    ↓ HTTPS
    ↓ API Key: X-API-Key header
    ↓ Farm ID: X-Farm-ID header
GreenReach Central Server
```

### ✅ Security Measures in Place:

1. **API Key Authentication** (`lib/wholesale-auth.js`)
   - 64-character hex API keys
   - Stored in `farm_api_keys` table
   - Validated on each request

2. **Farm ID Scoping**
   - Each request includes farm ID
   - Server validates API key belongs to farm
   - Prevents cross-farm access

3. **HTTPS/TLS**
   - All communication over HTTPS
   - Certificate validation

### 🟡 Gaps & Recommendations:

#### Issue 5.1: API Keys Not Rotatable

**Current State:**  
- API keys generated once, never rotated
- No expiration dates
- No UI to regenerate keys

**Recommended:**
```javascript
// 1. Add key rotation endpoint
app.post('/api/admin/farms/:farmId/rotate-api-key', requireAdmin, async (req, res) => {
  const { farmId } = req.params;
  
  // Generate new key
  const newKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(newKey).digest('hex');
  
  // Mark old key as deprecated (keep for 30 days)
  await dbPool.query(
    'UPDATE farm_api_keys SET deprecated = true, deprecated_at = NOW() WHERE farm_id = $1 AND active = true',
    [farmId]
  );
  
  // Insert new key
  await dbPool.query(
    'INSERT INTO farm_api_keys (farm_id, key_hash, active) VALUES ($1, $2, true)',
    [farmId, keyHash]
  );
  
  await logAdminAction(req.admin.admin_id, 'ROTATE_API_KEY', { farm_id: farmId }, req);
  
  // Return new key (only time it's shown in plaintext)
  res.json({ 
    success: true, 
    new_key: newKey,
    warning: 'Save this key securely. It will not be shown again.'
  });
});

// 2. Auto-cleanup deprecated keys after 30 days
// Run daily cron job:
async function cleanupDeprecatedKeys() {
  await dbPool.query(`
    DELETE FROM farm_api_keys 
    WHERE deprecated = true 
    AND deprecated_at < NOW() - INTERVAL '30 days'
  `);
}
```

**Estimated Time:** 3 hours

---

#### Issue 5.2: No Rate Limiting on API Keys

**Current State:**  
- API keys can be used unlimited times
- No protection against key leakage or abuse

**Recommended:**
```javascript
import rateLimit from 'express-rate-limit';

// API key rate limiter
const apiKeyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 min per API key
  keyGenerator: (req) => req.headers['x-api-key'],
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many requests',
      message: 'API key rate limit exceeded'
    });
  }
});

// Apply to wholesale endpoints
app.use('/api/wholesale', apiKeyLimiter);
```

**Estimated Time:** 1 hour

---

#### Issue 5.3: No IP Whitelisting for Farm API Keys

**Recommended Enhancement:**
```javascript
// Allow farms to whitelist their static IPs
app.post('/api/admin/farms/:farmId/whitelist-ip', requireAdmin, async (req, res) => {
  const { farmId } = req.params;
  const { ip_address } = req.body;
  
  await dbPool.query(
    'INSERT INTO farm_ip_whitelist (farm_id, ip_address) VALUES ($1, $2)',
    [farmId, ip_address]
  );
  
  res.json({ success: true });
});

// Validate IP on API key requests
function validateFarmIP(req, res, next) {
  const farmId = req.headers['x-farm-id'];
  const clientIP = req.ip;
  
  const result = await dbPool.query(
    'SELECT 1 FROM farm_ip_whitelist WHERE farm_id = $1 AND ip_address = $2',
    [farmId, clientIP]
  );
  
  if (result.rows.length === 0) {
    return res.status(403).json({ error: 'IP not whitelisted for this farm' });
  }
  
  next();
}
```

**Estimated Time:** 2 hours (optional enhancement)

---

## Part 6: Login Security Assessment

### Current Farm Login System:

**Endpoint:** `POST /api/farm/auth/login`  
**Location:** `server-foxtrot.js` lines 13521-13620

#### ✅ Security Measures in Place:

1. **Password Hashing:**
   ```javascript
   const validPassword = await bcrypt.compare(password, user.password_hash);
   ```

2. **JWT Tokens:**
   - 24-hour expiration
   - Signed with JWT_SECRET
   - Includes farm_id scoping

3. **Rate Limiting:**
   ```javascript
   authRateLimiter: {
     windowMs: 15 * 60 * 1000,
     max: 5 // 5 login attempts per 15 minutes
   }
   ```

4. **HTTPS Required**

5. **Account Status Check:**
   ```javascript
   if (farm.status !== 'active') {
     return res.status(403).json({ 
       message: 'Account is not active' 
     });
   }
   ```

#### 🟡 Security Gaps:

**Gap 6.1: No Account Lockout**
- After failed attempts, account should be locked

**Gap 6.2: No 2FA for Farm Users**
- Only password authentication

**Gap 6.3: No Login Notification**
- Users not notified of logins from new devices

**Gap 6.4: No Session Management**
- Can't revoke active sessions
- No "logout all devices"

**Recommended Fixes:**
```javascript
// 1. Account lockout after 5 failed attempts
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION = 30 * 60 * 1000; // 30 minutes

app.post('/api/farm/auth/login', async (req, res) => {
  // ... existing code ...
  
  // Check if account locked
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({
      error: 'Account temporarily locked due to too many failed attempts',
      unlock_at: user.locked_until
    });
  }
  
  // Verify password
  const validPassword = await bcrypt.compare(password, user.password_hash);
  
  if (!validPassword) {
    // Increment failed attempts
    const attempts = (user.failed_attempts || 0) + 1;
    
    if (attempts >= MAX_LOGIN_ATTEMPTS) {
      await dbPool.query(
        'UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE user_id = $3',
        [attempts, new Date(Date.now() + LOCKOUT_DURATION), user.user_id]
      );
      
      return res.status(423).json({
        error: 'Account locked due to too many failed attempts',
        locked_for: '30 minutes'
      });
    } else {
      await dbPool.query(
        'UPDATE users SET failed_attempts = $1 WHERE user_id = $2',
        [attempts, user.user_id]
      );
    }
    
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  
  // Reset failed attempts on successful login
  await dbPool.query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1',
    [user.user_id]
  );
  
  // ... rest of login logic ...
});

// 2. Add session tracking
CREATE TABLE user_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  farm_id VARCHAR(255) REFERENCES farms(farm_id),
  token_hash VARCHAR(255) NOT NULL,
  device_name VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  last_activity TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

// 3. Login notification email
import { sendEmail } from './lib/email-service.js';

async function sendLoginNotification(user, req) {
  await sendEmail({
    to: user.email,
    subject: 'New login to your Light Engine account',
    html: `
      <p>A new login was detected:</p>
      <ul>
        <li>Time: ${new Date().toLocaleString()}</li>
        <li>IP: ${req.ip}</li>
        <li>Device: ${req.get('user-agent')}</li>
      </ul>
      <p>If this wasn't you, please reset your password immediately.</p>
    `
  });
}

// 4. Revoke all sessions endpoint
app.post('/api/farm/auth/logout-all', requireAuth, async (req, res) => {
  await dbPool.query(
    'DELETE FROM user_sessions WHERE user_id = $1',
    [req.user_id]
  );
  
  res.json({ success: true, message: 'All sessions logged out' });
});
```

**Estimated Time:** 6 hours

---

## Part 7: Network Architecture & Security

### Current Setup:

```
┌─────────────────────────────────────────────────────────┐
│                    Public Internet                      │
└─────────────────────────────────────────────────────────┘
                        ↓ HTTPS
┌─────────────────────────────────────────────────────────┐
│         AWS Elastic Beanstalk (Public Load Balancer)   │
│                                                         │
│  - light-engine-foxtrot-prod.elasticbeanstalk.com     │
│  - All endpoints publicly accessible                    │
│  - No WAF, no IP filtering                            │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│              Node.js Server (server-foxtrot.js)        │
│                                                         │
│  PUBLIC ENDPOINTS:                                      │
│  - /landing-*.html (marketing pages)                   │
│  - /LE-login.html (farm login)                         │
│  - /GR-wholesale.html (buyer portal)                   │
│  - /api/purchase/* (Square checkout)                   │
│  - /api/wholesale/catalog (read-only)                  │
│                                                         │
│  PROTECTED ENDPOINTS (JWT required):                   │
│  - /LE-dashboard.html                                  │
│  - /api/farm/* (farm management)                       │
│  - /api/wholesale/checkout (buyers)                    │
│                                                         │
│  UNPROTECTED ADMIN (❌ CRITICAL BUG):                  │
│  - /GR-central-admin.html                              │
│  - /api/admin/*                                        │
└─────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────┐
│              PostgreSQL RDS Database                    │
│                                                         │
│  - Security group: Port 5432                           │
│  - Only accessible from EB instance                    │
│  - SSL enforced                                        │
└─────────────────────────────────────────────────────────┘
```

### 🔴 CRITICAL: Admin Portal Publicly Accessible

**Problem:**  
The central admin dashboard (`/GR-central-admin.html`) is served by the same public-facing web server with NO authentication required.

**Attack Surface:**
- Anyone can discover the URL (e.g., via Google, Shodan, or directory scanning)
- No password protection
- No IP restrictions
- No Cloudflare protection
- No VPN requirement

### Recommended Security Architecture:

```
OPTION 1: Cloudflare Access (Recommended - Easiest)
══════════════════════════════════════════════════

┌─────────────────────────────────────────┐
│         Public Internet                 │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│         Cloudflare Proxy                │
│                                         │
│  Rules:                                 │
│  - /landing-* → Allow all               │
│  - /LE-login.html → Allow all           │
│  - /GR-wholesale.html → Allow all       │
│  - /GR-central-admin* → BLOCK           │
│                                         │
│  Cloudflare Access Rules:               │
│  - /GR-central-admin* →                 │
│    Require: @greenreach.com email       │
│    Require: Google Workspace auth       │
│    Require: 2FA                         │
└─────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────┐
│    Elastic Beanstalk (origin server)    │
└─────────────────────────────────────────┘

Setup:
1. Add site to Cloudflare
2. Create Access Application
3. Set path: /GR-central-admin*
4. Add policy: Email ends with @greenreach.com
5. Require Google Workspace login
6. Done!

Cost: ~$3/month per admin user
Time: 2 hours
Security: Excellent


OPTION 2: Separate Admin Server (Most Secure)
══════════════════════════════════════════════

┌──────────────────────────┐  ┌───────────────────────┐
│   Public Internet        │  │   Admin VPN Only      │
└──────────────────────────┘  └───────────────────────┘
       ↓                                 ↓
┌──────────────────────────┐  ┌───────────────────────┐
│  Main EB Instance        │  │  Admin EC2 Instance   │
│  (public endpoints)      │  │  (private subnet)     │
│                          │  │                       │
│  - Marketing pages       │  │  - Admin dashboard    │
│  - Farm login            │  │  - Admin API          │
│  - Wholesale buyer       │  │  - No public IP       │
│  - Purchase flow         │  │  - VPN access only    │
└──────────────────────────┘  └───────────────────────┘
       ↓                                 ↓
┌──────────────────────────────────────────┐
│         Shared RDS Database              │
└──────────────────────────────────────────┘

Setup:
1. Launch new EC2 in private subnet
2. Set up AWS Client VPN
3. Move admin portal to new instance
4. Configure security groups
5. Deploy admin code separately

Cost: ~$30/month (t3.small + VPN)
Time: 8 hours
Security: Excellent


OPTION 3: IP Whitelist (Quick Fix)
═══════════════════════════════════

// In server-foxtrot.js
const ADMIN_IP_WHITELIST = [
  '1.2.3.4',        // Office IP
  '5.6.7.8'         // Admin's home IP
];

app.use('/GR-central-admin*', (req, res, next) => {
  const clientIP = req.ip;
  
  if (!ADMIN_IP_WHITELIST.includes(clientIP)) {
    return res.status(404).send(); // Return 404 to hide existence
  }
  
  next();
});

app.use('/api/admin', (req, res, next) => {
  const clientIP = req.ip;
  
  if (!ADMIN_IP_WHITELIST.includes(clientIP)) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  next();
});

Cost: Free
Time: 30 minutes
Security: Moderate (IPs can change)
```

**Recommendation:** Start with Cloudflare Access (Option 1) for immediate protection, then plan migration to separate admin server (Option 2) for long-term.

---

## Part 8: Deployment Recommendations

### Production Deployment Checklist:

#### Phase 1: Emergency Lockdown (Do Immediately - 2 hours)

```bash
# 1. Add Cloudflare Access
# - Sign up for Cloudflare
# - Add greenreachgreens.com
# - Create Access application for /GR-central-admin*
# - Require @greenreach.com email authentication

# 2. Add basic admin authentication
# - Create admin login page
# - Add admin_users table
# - Require JWT for all /api/admin/* endpoints
# - Deploy to production

# 3. Rotate all API keys
# - Generate new admin API key
# - Update environment variables
# - Deploy
```

#### Phase 2: Core Security (1 week)

```bash
# 1. Implement 2FA for admin users (8 hours)
# 2. Add session management (4 hours)
# 3. Implement account lockout (4 hours)
# 4. Add comprehensive audit logging (6 hours)
# 5. Set up monitoring and alerts (4 hours)
# 6. Security penetration testing (4 hours)
```

#### Phase 3: Feature Completion (2 weeks)

```bash
# 1. Subscription management (6 hours)
# 2. User management tools (4 hours)
# 3. Farm support tools (4 hours)
# 4. QuickBooks UI integration (8 hours)
# 5. Wholesale data integration (4 hours)
# 6. Enhanced reporting (6 hours)
```

#### Phase 4: Polish & Launch (1 week)

```bash
# 1. API key rotation system (3 hours)
# 2. Advanced rate limiting (2 hours)
# 3. IP whitelisting for farms (2 hours)
# 4. Comprehensive documentation (8 hours)
# 5. Admin training (4 hours)
# 6. Go-live checklist completion (4 hours)
```

---

## Part 9: Risk Assessment Matrix

| Risk | Severity | Likelihood | Impact | Mitigation Priority |
|------|----------|------------|---------|-------------------|
| Admin portal accessible without auth | 🔴 CRITICAL | HIGH | Complete data breach | P0 - IMMEDIATE |
| No 2FA for admin | 🔴 CRITICAL | HIGH | Account takeover | P0 - IMMEDIATE |
| No audit logging | 🔴 CRITICAL | MEDIUM | No forensics, compliance fail | P1 - This Week |
| API keys not rotatable | 🟡 HIGH | MEDIUM | Key compromise = perm. access | P2 - This Month |
| No session revocation | 🟡 HIGH | LOW | Stolen tokens stay valid | P2 - This Month |
| QuickBooks not wired up | 🟡 HIGH | LOW | Manual accounting work | P3 - Next Sprint |
| No subscription management UI | 🟡 MEDIUM | LOW | CS inefficiency | P3 - Next Sprint |
| No IP whitelisting | 🟢 LOW | LOW | Minor security improvement | P4 - Nice to Have |

---

## Part 10: Production Go-Live Criteria

### MUST HAVE (Blockers):

- [ ] Admin authentication system deployed
- [ ] Admin 2FA enabled
- [ ] All /api/admin/* endpoints protected
- [ ] Cloudflare Access configured
- [ ] Admin audit logging functional
- [ ] At least one admin user created
- [ ] Admin login tested end-to-end
- [ ] Security penetration test passed

### SHOULD HAVE (Launch Week):

- [ ] Account lockout implemented
- [ ] Session management working
- [ ] Login notifications enabled
- [ ] API key rotation endpoint
- [ ] QuickBooks connection UI
- [ ] Basic subscription management

### NICE TO HAVE (Post-Launch):

- [ ] Separate admin server infrastructure
- [ ] Advanced analytics
- [ ] Farm support tools
- [ ] IP whitelisting for farms
- [ ] Advanced reporting

---

## Conclusion

The GreenReach Central Admin portal has a **solid foundation** with comprehensive farm monitoring and management APIs already built. However, it is **NOT production-ready** due to critical security gaps.

### Timeline to Production:

- **Emergency lockdown:** 2 hours  
- **Minimum viable security:** 1 week  
- **Full production-ready:** 4-6 weeks  

### Estimated Total Cost:

- Development time: 80-100 hours  
- Cloudflare Access: ~$3/user/month  
- Infrastructure: $0 (existing AWS)  
- **Total first month:** ~$3-15 depending on admin user count

### Immediate Next Steps:

1. **RIGHT NOW:** Add Cloudflare Access to block unauthorized admin access
2. **TODAY:** Build admin login page and authentication system
3. **THIS WEEK:** Deploy 2FA, audit logging, and session management
4. **NEXT WEEK:** Wire up QuickBooks integration UI
5. **NEXT SPRINT:** Build subscription and user management features

---

**Report prepared by:** AI Assistant  
**Review required by:** Technical Lead, Security Team  
**Approval required from:** CTO, Product Owner

