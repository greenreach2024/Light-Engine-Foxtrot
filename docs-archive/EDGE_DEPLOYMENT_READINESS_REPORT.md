# Edge Deployment Readiness Report

**Report Date:** January 19, 2026  
**System:** Light Engine Foxtrot  
**Scope:** Edge Device Deployment Audit  
**Status:** ⚠️ **CONDITIONAL PASS** - Critical Issues Identified

---

## Executive Summary

After deploying to reTerminal edge device (Raspberry Pi CM4), multiple runtime errors revealed **fundamental architectural issues** in the edge deployment code. While core functionality works, several critical bugs undermine production readiness:

### Severity Breakdown
- 🔴 **CRITICAL:** 4 issues (PostgreSQL pool on edge, undefined variable, wrong endpoint, status column)
- 🟡 **HIGH:** 3 issues (missing conditionals, hardcoded assumptions, inconsistent patterns)
- 🟢 **MEDIUM:** 5 issues (documentation gaps, missing error handling)

### Recommendation
**DO NOT deploy additional edge devices** until all CRITICAL and HIGH issues are resolved. Current deployment requires manual fixes after installation.

---

## 🔴 CRITICAL Issues (Production Blockers)

### 1. PostgreSQL Pool Initialized on Edge Devices Without Credentials
**File:** `server-foxtrot.js` lines 10278-10296  
**Impact:** ECONNREFUSED errors, attempted localhost:5432 connections  
**Status:** ✅ FIXED (commit c2cc9df)

**Original Code:**
```javascript
// WRONG: Always creates pool even without credentials
dbPool = new pg.Pool({
  host: process.env.DB_HOST,  // undefined → defaults to localhost
  port: parseInt(process.env.DB_PORT) || 5432,
  // ...
});
```

**What Happened:**
- Edge devices have NO database environment variables
- Pool created with `host: undefined` → defaults to 'localhost'
- Every database query attempts to connect to localhost:5432
- Setup wizard throws ECONNREFUSED errors
- Authentication endpoints fail

**Fix Applied:**
```javascript
let dbPool = null;
if (process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER) {
  console.log('[Database] Initializing PostgreSQL pool for Cloud deployment');
  dbPool = new pg.Pool({...});
} else {
  console.log('[Database] No PostgreSQL credentials found - using NeDB for Edge device');
}
app.locals.db = dbPool; // null on edge
```

---

### 2. Setup Wizard References Undefined `db` Variable
**File:** `server-foxtrot.js` line 6672  
**Impact:** ReferenceError crashes setup wizard  
**Status:** ✅ FIXED (commit abd9743)

**Original Code:**
```javascript
} else if (db) {  // ❌ Variable 'db' does not exist in this scope
  await db.update(...);
}
```

**What Happened:**
- Variable should be `wizardStatesDB` (defined line 20842)
- Copy-paste error from cloud code path
- Setup wizard crashes with "db is not defined"
- Farm configuration cannot be saved

**Fix Applied:**
```javascript
} else {
  console.log('[setup-wizard] Saving setup config to NeDB for edge device');
  await wizardStatesDB.updateAsync(
    { key: 'setup_config' },
    { ...setupConfig, key: 'setup_config' },
    { upsert: true }
  );
}
```

---

### 3. Login Pages Call Wrong Authentication Endpoint
**Files:** `public/login.html` (line 343), `public/LE-login.html` (line 330), `public/LE-login-legacy.html` (line 291)  
**Impact:** Authentication fails, users cannot log in  
**Status:** ✅ FIXED (commit 290d60a)

**Original Code:**
```javascript
// ❌ WRONG: Tries to authenticate with localhost PostgreSQL
const response = await fetch('/api/farm/auth/login', {
  body: JSON.stringify({ farmId, email, password })
});
```

**What Happened:**
- `/api/farm/auth/login` endpoint tries to query local PostgreSQL
- Edge devices don't have PostgreSQL running
- Should use `/api/auth/login` which connects to AWS RDS
- Parameter naming inconsistent (`farmId` vs `farm_id`)

**Fix Applied:**
```javascript
// ✅ CORRECT: Authenticates with AWS RDS
const response = await fetch('/api/auth/login', {
  body: JSON.stringify({ farm_id, email, password })
});
```

**Remaining Issue:**
Still found in `docs/farm-admin-login.html` (line 458) - NOT deployed to device but should be fixed.

---

### 4. Authentication Query Used Wrong Column Name
**File:** `routes/auth.js` line ~180  
**Impact:** Authentication always failed even with correct credentials  
**Status:** ✅ FIXED (commit 4b9d8fa)

**Original Code:**
```javascript
if (!user.status || user.status !== 'active') {  // ❌ Column doesn't exist
  return res.status(403).json({ error: 'Account disabled' });
}
```

**Database Schema:**
```sql
users (
  user_id, farm_id, email, password_hash, role, 
  is_active BOOLEAN,  -- ✅ Actual column name
  email_verified, created_at, last_login
)
```

**Fix Applied:**
```javascript
if (!user.is_active) {
  return res.status(403).json({ error: 'Account disabled' });
}
```

---

## 🟡 HIGH Issues (Architecture Concerns)

### 5. Multiple Database Access Patterns Without Null Checks
**Impact:** Potential runtime errors when `app.locals.db` is null on edge

**Locations with proper checks (✅):**
```javascript
const pool = req.app.locals?.db;
if (pool) {
  // Cloud: Use PostgreSQL
} else {
  // Edge: Use NeDB or skip
}
```

**Locations WITHOUT checks (❌):**

**Line 6378-6430** - Recipe listing endpoint:
```javascript
const countResult = await dbPool.query(...);  // ❌ Direct use of dbPool
const result = await dbPool.query(...);
```
**Risk:** If endpoint called on edge device, crashes with "dbPool.query is not a function"

**Line 6740-6760** - Setup status check:
```javascript
const farmResult = await dbPool.query(...);  // ❌ No null check
const roomResult = await dbPool.query(...);
```
**Risk:** Edge devices cannot check setup status via database

**Line 13950-14030** - Admin farm listing:
```javascript
const result = await dbPool.query(...);  // ❌ Assumes dbPool exists
```
**Risk:** Admin endpoints fail on edge devices

**Line 6770** - Setup status edge path:
```javascript
const setupConfig = await db.findOne(...);  // ❌ 'db' undefined, should be wizardStatesDB
```
**Risk:** Still references wrong variable name

---

### 6. Inconsistent Variable Naming for Database Access
**Impact:** Confusion, harder to maintain, potential bugs

Three different patterns found:
```javascript
// Pattern 1: dbPool (global reference)
const result = await dbPool.query(...);

// Pattern 2: pool from app.locals
const pool = req.app.locals?.db;
if (pool) await pool.query(...);

// Pattern 3: db from app.locals  
const db = req.app.locals?.db;
if (db) await db.query(...);
```

**Recommendation:** Standardize on Pattern 2 or 3 throughout codebase.

---

### 7. Farm Authentication Endpoint Still Exists
**File:** `server-foxtrot.js` lines 14510-14700  
**Impact:** Duplicate authentication logic, maintenance burden

Two authentication endpoints exist:
- `/api/farm/auth/login` (line 14510) - OLD, tries local PostgreSQL
- `/api/auth/login` (routes/auth.js) - NEW, connects to AWS RDS

**Issue:** 
- Old endpoint still active and referenced in 6 JavaScript files
- Creates confusion about which endpoint to use
- Maintenance nightmare keeping both in sync

**Files still referencing old endpoint:**
- `public/farm-admin.js` line 162
- `admin.js` line 40
- `farm-admin.js` line 119
- `public/admin.js` line 57
- `docs/farm-admin.js` line 177

**Recommendation:** 
1. Deprecate `/api/farm/auth/login` endpoint
2. Update all JavaScript files to use `/api/auth/login`
3. Add console warning to old endpoint for 2 weeks, then remove

---

## 🟢 MEDIUM Issues (Quality Concerns)

### 8. Mixed Database Access Without Edge Mode Detection
**Lines:** Various throughout `server-foxtrot.js`

Multiple endpoints use database directly without checking deployment mode:
- Recipe endpoints (6370-6430)
- Admin endpoints (13945-14030)
- Profile endpoints (15469-15490)

**Recommendation:** Create helper function:
```javascript
function getDatabase(req) {
  const pool = req.app.locals?.db;
  if (!pool) {
    throw new Error('Database not available in edge mode. Use NeDB.');
  }
  return pool;
}
```

---

### 9. No Edge Mode Indicator in UI
**Impact:** Users don't know which mode they're running in

Neither login page nor dashboard indicates:
- Running in edge mode (local device)
- Running in cloud mode (AWS hosted)
- Which database backend is active

**Recommendation:** Add mode indicator to UI:
```html
<div class="mode-badge">
  <span class="badge badge-primary">Edge Mode</span>
  <span class="status-text">Local Device</span>
</div>
```

---

### 10. Missing Error Handling for NeDB Operations
**File:** `server-foxtrot.js` line 6675

```javascript
await wizardStatesDB.updateAsync(...);  // No try-catch
```

If NeDB file is locked, corrupted, or permissions issue occurs, error propagates uncaught.

**Recommendation:**
```javascript
try {
  await wizardStatesDB.updateAsync(...);
} catch (error) {
  console.error('[setup-wizard] NeDB save failed:', error);
  // Fallback: save to temp file or return error to user
}
```

---

### 11. Parameter Naming Inconsistency
**Impact:** Confusion during debugging

Three variations found:
- `farmId` (camelCase) - Used in old endpoints
- `farm_id` (snake_case) - Used in new endpoints and database
- `FARM_ID` (upper snake) - Used in some environment variables

**Recommendation:** Standardize on `farm_id` (matches database schema).

---

### 12. Documentation Doesn't Mention Database Conditionals
**Files:** `EDGE_DEPLOYMENT_ARCHITECTURE.md`, `docs/EDGE_DEPLOYMENT_GUIDE.md`

Neither document explains:
- How database mode detection works
- When PostgreSQL vs NeDB is used
- How to verify correct mode at runtime
- Troubleshooting steps for database issues

---

## Architectural Review: Edge vs Cloud

### Current Implementation
```
┌─────────────────────────────────────────┐
│         Authentication Layer            │
│  /api/auth/login → AWS RDS (always)     │  ✅ CORRECT
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│         Application Layer               │
│  server-foxtrot.js                      │
│  - Checks app.locals.db                 │
│  - If null → Edge mode (NeDB)           │  ⚠️ PARTIAL
│  - If set → Cloud mode (PostgreSQL)     │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌─────────────┐         ┌─────────────┐
│ Edge Device │         │   Cloud     │
│   (NeDB)    │         │ (PostgreSQL)│
└─────────────┘         └─────────────┘
  - Setup config          - Users
  - Local state          - Farms  
                         - Orders
```

### Problems with Current Architecture

1. **Authentication always cloud-dependent**
   - Edge devices MUST have internet to authenticate
   - Cannot work offline after initial setup
   - Should cache credentials locally

2. **No explicit mode setting**
   - Mode inferred from presence/absence of env vars
   - No `EDGE_MODE=true` flag
   - Harder to debug which mode is active

3. **Dual database paths not comprehensive**
   - Some endpoints check for db, others don't
   - No centralized database abstraction layer
   - Each developer must remember to add checks

---

## Testing Coverage Gaps

### What We Tested (Manual)
- ✅ Authentication API with curl
- ✅ Setup wizard save to NeDB
- ✅ PM2 service restart
- ✅ Health check endpoint
- ⏳ Login via browser UI (user testing)
- ⏳ Setup wizard via browser UI (user testing)

### What We Did NOT Test
- ❌ Recipe endpoints on edge device
- ❌ Admin endpoints on edge device
- ❌ Profile endpoints on edge device
- ❌ Edge mode with database queries
- ❌ Offline operation after authentication
- ❌ NeDB data persistence after reboot
- ❌ Migration from cloud to edge
- ❌ Concurrent NeDB access (race conditions)

### Test File Status
**File:** `tests/edge-deployment.test.js`
- ✅ File exists
- ❌ Tests not run
- ❌ No CI/CD integration
- ❌ No test results documented

---

## Deployment Checklist

### Pre-Deployment (NOT Done Last Time)
- [ ] Run `tests/edge-deployment.test.js` locally
- [ ] Verify all database queries have null checks
- [ ] Check all authentication endpoints use correct path
- [ ] Grep for `dbPool.query` without conditionals
- [ ] Validate NeDB file permissions
- [ ] Test setup wizard in both modes

### During Deployment (Done Partially)
- [x] Transfer files via HTTP server
- [x] Restart PM2 services
- [x] Check health endpoint
- [ ] Verify correct database mode in logs
- [ ] Test login through browser
- [ ] Test setup wizard through browser
- [ ] Check NeDB file exists and has data

### Post-Deployment (NOT Done)
- [ ] Monitor PM2 logs for 24 hours
- [ ] Test offline operation
- [ ] Verify data persists after reboot
- [ ] Load test with typical usage
- [ ] Document any additional issues

---

## Critical Code Locations

### Must Review Before Next Deployment

1. **All direct `dbPool` usage:**
   ```bash
   grep -n "dbPool.query" server-foxtrot.js | grep -v "if.*pool"
   ```
   Expected: 0 matches  
   Actual: Multiple matches found (see Issue #5)

2. **All `app.locals.db` without null checks:**
   ```bash
   grep -n "app.locals.db" server-foxtrot.js | grep -v "?"
   ```
   Expected: Only initialization  
   Actual: Multiple unsafe accesses

3. **All authentication endpoint references:**
   ```bash
   grep -rn "/api/farm/auth/login" public/ --include="*.js"
   ```
   Expected: 0 matches  
   Actual: 5 matches (see Issue #7)

4. **All variable name variations:**
   ```bash
   grep -rn "const db = " server-foxtrot.js
   ```
   Check each assignment matches intended database

---

## Recommendations by Priority

### IMMEDIATE (Before Next Edge Deployment)

1. **Add database null checks to all endpoints**
   - Recipe endpoints (lines 6370-6430)
   - Admin endpoints (lines 13945-14030)
   - Profile endpoints (lines 15469-15490)
   - Setup status check (line 6740)

2. **Fix remaining undefined variable reference**
   - Line 6770: Change `db.findOne` to `wizardStatesDB.findOne`

3. **Update all JavaScript files to use `/api/auth/login`**
   - 5 files still reference old endpoint
   - Remove or deprecate `/api/farm/auth/login`

4. **Run edge deployment tests**
   - Execute `tests/edge-deployment.test.js`
   - Fix any failing tests
   - Document results

### SHORT-TERM (This Week)

5. **Create database abstraction layer**
   ```javascript
   function getDb(req, options = {}) {
     const pool = req.app.locals?.db;
     if (!pool && options.required) {
       throw new Error('Database not available');
     }
     return pool;
   }
   ```

6. **Add edge mode indicator to UI**
   - Dashboard shows "Edge Mode" or "Cloud Mode"
   - Display which database backend is active
   - Show sync status if applicable

7. **Standardize variable naming**
   - Global search/replace: `farmId` → `farm_id` in all endpoints
   - Update TypeScript types if applicable

### MEDIUM-TERM (This Month)

8. **Add offline authentication caching**
   - Cache valid credentials in NeDB
   - Allow login without internet after initial setup
   - Sync authentication state when online

9. **Comprehensive testing suite**
   - Unit tests for database conditionals
   - Integration tests for edge vs cloud
   - Automated deployment tests

10. **Update documentation**
    - Edge deployment guide with database mode explanation
    - Troubleshooting section for common errors
    - Architecture diagrams showing dual database paths

---

## Risk Assessment

### If Deployed "As-Is" to More Edge Devices

**Probability of Issues:**
- Authentication failures: **40%** (endpoint confusion, parameter mismatch)
- Setup wizard crashes: **60%** (undefined variables, db reference errors)
- Recipe/admin endpoint errors: **80%** (direct dbPool access without checks)
- Data loss: **20%** (NeDB file corruption, missing error handling)

**Mitigation:**
- All CRITICAL issues must be fixed before deploying to additional devices
- HIGH issues should be addressed within 1 week
- MEDIUM issues are acceptable for pilot but block production

---

## Conclusion

The current edge deployment works **only because we manually fixed 4 critical bugs** during reTerminal deployment. These issues would recur on every new edge device installation.

### System Is Production-Ready IF:
- ✅ All database accesses check for null (Issue #5)
- ✅ All JavaScript files use correct authentication endpoint (Issue #7)
- ✅ Setup status endpoint fixed (line 6770)
- ✅ Edge deployment tests pass
- ✅ At least 1 complete end-to-end test via browser UI

### System Is NOT Production-Ready Until:
- All CRITICAL issues resolved
- All HIGH issues addressed
- Test coverage improved
- Documentation updated
- Second edge device deployed successfully without manual fixes

**Current Status:** ⚠️ **CONDITIONAL PASS** - Works but fragile. Not safe for wide deployment.

---

## Action Items

**Assigned To: Development Team**

1. [ ] Fix all database access without null checks (2-3 hours)
2. [ ] Update JavaScript files to `/api/auth/login` (1 hour)
3. [ ] Fix line 6770 undefined variable (5 minutes)
4. [ ] Run and fix edge deployment tests (2 hours)
5. [ ] Deploy to second test device to verify fixes (1 hour)
6. [ ] Update edge deployment documentation (1 hour)

**Total Estimated Time:** 8-10 hours

**Blocking Next Deployment:** Items 1-4 must be complete

---

**Report Generated:** January 19, 2026  
**Next Review:** After completion of action items  
**Document Version:** 1.0
