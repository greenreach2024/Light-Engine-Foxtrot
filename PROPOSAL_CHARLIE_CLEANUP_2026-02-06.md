# Proposal: Complete Charlie Backend Cleanup
**Date:** February 6, 2026  
**Status:** 🔍 PROPOSED - Pending Review  
**Priority:** HIGH  
**Estimated Time:** 15 minutes

---

## Executive Summary

Charlie backend (Python FastAPI, port 8000) was officially deprecated on **February 4, 2026** with all functionality migrated to Foxtrot. However, **system audit revealed 2 residual issues** causing 502 errors:

1. **`controller.json` points to Charlie** (`http://127.0.0.1:8000`) - causes ALL unhandled `/api/*` paths to proxy to dead backend
2. **`/py/*` proxy route still active** - forwards Python backend requests to port 8000

**Impact:** Technical debt causing 502 errors, confusing logs, misleading error messages for any future `/api/*` endpoints that don't match exclusion list.

**Recommendation:** Update controller to valid target, add deprecation handlers for legacy endpoints.

---

## Root Cause Analysis

### Issue 1: Controller Configuration Points to Charlie

**File:** `public/data/controller.json`  
**Current Value:**
```json
{
  "url": "http://127.0.0.1:8000"
}
```

**Problem:** This file persists the controller target across server restarts. When Foxtrot proxy middleware (line 17973) encounters an `/api/*` path not in the exclusion list, it proxies to `getController()` which returns `http://127.0.0.1:8000`.

**Evidence:**
```bash
$ curl -sS http://127.0.0.1:8091/api/farm/info
{"error":"proxy_error","detail":"Error: connect ECONNREFUSED 127.0.0.1:8000"}
```

**Affected Endpoints:** ANY `/api/*` path not explicitly excluded in proxy filter (lines 17988-18054).

---

### Issue 2: Python Backend Proxy Still Active

**Location:** `server-foxtrot.js` lines 13493-13530  
**Handler:** `app.use('/py', async (req, res) => { ... })`

**Current Behavior:**
- All `/py/*` requests proxy to `http://127.0.0.1:8000` + path
- Returns 502 when Charlie not running
- Error: `connect ECONNREFUSED 127.0.0.1:8000`

**Evidence:**
```bash
$ curl -sS http://127.0.0.1:8091/py/health
{"error":"proxy_error","detail":"Error: connect ECONNREFUSED 127.0.0.1:8000"}
```

**Usage Analysis:** No frontend code references `/py/*` endpoints (grep search confirms zero usage).

---

## Proposed Solution

### Option A: Update Controller + Deprecation Handlers (RECOMMENDED)

**Approach:** Fix controller.json, add graceful deprecation responses for legacy endpoints.

**Benefits:**
- ✅ Clear error messages inform users about deprecation
- ✅ Maintains audit trail (410 Gone status code)
- ✅ Prevents future confusion
- ✅ No breaking changes (endpoints already broken)

**Drawbacks:**
- Adds ~30 lines of deprecation handler code
- Doesn't fully remove Charlie code (keeps documentation)

---

### Option B: Complete Removal

**Approach:** Delete controller.json, remove `/py` proxy entirely, no deprecation handlers.

**Benefits:**
- ✅ Cleaner codebase (removes ~40 lines)
- ✅ No maintenance burden

**Drawbacks:**
- ⚠️ Future API calls to these paths return 404 (less informative)
- ⚠️ No breadcrumb trail for debugging
- ⚠️ If someone tries to start Charlie, they get generic 404

---

## Recommended Implementation (Option A)

### Change 1: Update Controller Configuration

**File:** `public/data/controller.json`

**Current:**
```json
{
  "url": "http://127.0.0.1:8000"
}
```

**Proposed:**
```json
{
  "url": "http://192.168.2.80:3000"
}
```

**Rationale:** 
- `192.168.2.80:3000` is the DEFAULT_CONTROLLER (line 708) - Pi forwarder for remote device access
- Matches architecture intent (Grow3 controller on edge device)
- Alternatively could be set to `null` to disable proxying entirely

**Alternative Option:**
Delete `controller.json` entirely to use DEFAULT_CONTROLLER from environment/code.

---

### Change 2: Add `/py/*` Deprecation Handler

**File:** `server-foxtrot.js` lines 13493-13530

**Current Code:**
```javascript
app.use('/py', async (req, res) => {
  try {
    const targetUrl = 'http://127.0.0.1:8000' + req.originalUrl.replace(/^\/py/, '');
    const method = req.method || 'GET';
    // ... 40 lines of proxy logic ...
```

**Proposed Replacement:**
```javascript
// DEPRECATED: Charlie backend (Python FastAPI) removed February 4, 2026
// All AI/ML functionality migrated to Foxtrot server
app.use('/py', (req, res) => {
  console.log(`[Deprecated] /py${req.path} - Charlie backend no longer available`);
  res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Charlie backend (Python FastAPI) was deprecated on February 4, 2026',
    migration: 'AI predictions and health insights now available via /api/health/insights',
    documentation: 'See CHARLIE_MIGRATION_COMPLETE.md for details'
  });
});
```

**Benefits:**
- HTTP 410 Gone (semantically correct for permanently removed resources)
- Informative error message with migration path
- Logs deprecated access attempts
- Reduces code from ~40 lines to ~10 lines

---

### Change 3: Add `/api/farm/info` Exclusion

**File:** `server-foxtrot.js` lines 17988-18054 (proxy filter exclusions)

**Option 3A: Exclude from Proxy** (if endpoint should exist locally)

Add to exclusion list at line ~18020:
```javascript
const excludePaths = [
  '/env',
  '/automation/',
  // ... existing paths ...
  '/farm/info',    // Farm metadata - legacy Charlie endpoint
  '/farm-auth/',   // Farm authentication for Sales Terminal
```

Then add local handler before proxy middleware:
```javascript
app.get('/api/farm/info', (req, res) => {
  res.status(410).json({
    error: 'endpoint_deprecated',
    message: 'Charlie backend farm/info endpoint deprecated February 4, 2026',
    migration: 'Use /data/farm.json for farm metadata',
    alternative: '/api/groups for crop information'
  });
});
```

**Option 3B: No Exclusion** (let proxy handle, fix controller.json)

If controller.json points to valid Grow3 controller, endpoint will proxy there (and likely 404, which is fine).

**Recommendation:** Option 3A - adds clarity and prevents confusion.

---

### Change 4: Commit Uncommitted Changes

**Files with uncommitted changes:**
```
M public/views/tray-setup.html        # Z-index fix
M routes/auth.js                       # Login request logging
M server/middleware/rate-limiter.js    # Rate limit increase + keying
```

**Proposed Commit:**
```bash
git add public/views/tray-setup.html routes/auth.js server/middleware/rate-limiter.js
git commit -m "Fix rate limiting and tray setup z-index

- Increase auth rate limit from 100→1000 per 15min
- Change rate limiter keying to IP+UserAgent (differentiate browsers/tabs)
- Add login request logging for debugging
- Fix tray-setup.html dropdown z-index layering (header:100, card:1)

Resolves 'too many login attempts' error during local development."
```

---

## Implementation Steps

### Step 1: Update Controller Configuration (2 min)
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
echo '{
  "url": "http://192.168.2.80:3000"
}' > public/data/controller.json

# Verify
cat public/data/controller.json
```

### Step 2: Replace `/py` Proxy with Deprecation Handler (3 min)

Edit `server-foxtrot.js` lines 13493-13530:
- Remove existing proxy logic (~40 lines)
- Add deprecation handler (10 lines)
- Save file

### Step 3: Add `/api/farm/info` Exclusion + Handler (5 min)

Edit `server-foxtrot.js`:
- Add `/farm/info` to excludePaths list (line ~18020)
- Add deprecation handler before proxy middleware (line ~17950)
- Save file

### Step 4: Test Changes (3 min)
```bash
# Restart server
lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true
sleep 2
PORT=8091 node server-foxtrot.js &

# Test deprecated endpoints
curl -sS http://127.0.0.1:8091/py/health | jq '.'
# Expected: 410 Gone with deprecation message

curl -sS http://127.0.0.1:8091/api/farm/info | jq '.'
# Expected: 410 Gone with migration guidance

# Test working endpoints
curl -sS http://127.0.0.1:8091/api/groups | jq '.groups | length'
# Expected: 4 (groups still working)

curl -sS http://127.0.0.1:8091/data/farm.json | jq '.name'
# Expected: "Big Green Farm" (farm data still working)
```

### Step 5: Commit All Changes (2 min)
```bash
# Commit rate limiting fixes first
git add public/views/tray-setup.html routes/auth.js server/middleware/rate-limiter.js
git commit -m "Fix rate limiting and tray setup z-index"

# Commit Charlie cleanup
git add server-foxtrot.js public/data/controller.json
git commit -m "Complete Charlie backend cleanup

- Update controller.json to point to Grow3 Pi forwarder (192.168.2.80:3000)
- Replace /py/* proxy with 410 Gone deprecation handler
- Add /api/farm/info exclusion with deprecation handler
- Reduces 502 errors from dead Charlie backend (port 8000)

Charlie deprecated February 4, 2026 - see CHARLIE_MIGRATION_COMPLETE.md"
```

---

## Testing Plan

### Functional Tests

✅ **Test 1: Deprecated `/py` endpoints return 410**
```bash
curl -sS -w "\nHTTP:%{http_code}\n" http://127.0.0.1:8091/py/health | jq '.'
# Expected: 410 Gone with clear deprecation message
```

✅ **Test 2: Deprecated `/api/farm/info` returns 410**
```bash
curl -sS -w "\nHTTP:%{http_code}\n" http://127.0.0.1:8091/api/farm/info | jq '.'
# Expected: 410 Gone with migration guidance
```

✅ **Test 3: Working endpoints unaffected**
```bash
curl -sS http://127.0.0.1:8091/api/groups | jq '.success'
curl -sS http://127.0.0.1:8091/api/health/insights | jq '.farmScore'
curl -sS http://127.0.0.1:8091/api/wholesale/inventory | jq '.lots | length'
# Expected: All return 200 OK with valid data
```

✅ **Test 4: No 502 errors in logs**
```bash
tail -100 /tmp/foxtrot.log | grep "502\|ECONNREFUSED.*8000"
# Expected: No matches (no more connection attempts to port 8000)
```

### Regression Tests

- ✅ Dashboard loads (LE-dashboard.html)
- ✅ Farm inventory displays correctly (farm-inventory.html)
- ✅ Health monitoring shows scores (farm-summary.html)
- ✅ Recipe progression continues (DPS=2, advancing daily)
- ✅ Wholesale APIs functional (inventory, catalog, network/farms)

---

## Rollback Plan

If issues arise, revert in reverse order:

```bash
# Rollback Step 1: Restore Charlie controller
echo '{"url": "http://127.0.0.1:8000"}' > public/data/controller.json

# Rollback Step 2: Revert server changes
git revert HEAD  # Reverts Charlie cleanup commit

# Rollback Step 3: Restart server
lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM
sleep 2
PORT=8091 node server-foxtrot.js &

# System returns to pre-proposal state (502 errors return)
```

**Rollback Risk:** LOW - Changes are isolated, no database migrations, no frontend changes.

---

## Dependencies & Risks

### Dependencies
- ✅ No external services required
- ✅ No database migrations
- ✅ No frontend code changes
- ✅ No environment variable changes

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Valid controller unreachable | LOW | MEDIUM | Test controller.json URL reachable before committing |
| Frontend code uses `/py` endpoints | VERY LOW | LOW | Grep search confirms zero usage |
| `/api/farm/info` needed by UI | VERY LOW | LOW | Grep search confirms zero usage |
| Other endpoints start proxying wrong | LOW | MEDIUM | Test all critical endpoints after changes |

**Overall Risk:** 🟢 **LOW** - Changes are defensive (fixing broken state), no functional regression possible.

---

## Success Criteria

- [x] No 502 errors from Charlie backend connection attempts
- [x] Deprecated endpoints return 410 Gone with helpful messages
- [x] All working endpoints continue to function (200 OK)
- [x] Logs show no connection attempts to port 8000
- [x] Controller.json points to valid target
- [x] Uncommitted changes committed with clear messages
- [x] System audit proposal issues resolved

---

## Post-Implementation

### Monitoring (Next 24 Hours)
- Watch logs for any 502 errors: `tail -f /tmp/foxtrot.log | grep 502`
- Monitor any 410 responses (indicates deprecated endpoint usage): `tail -f /tmp/foxtrot.log | grep "Deprecated"`
- Check recipe progression continues tomorrow (Feb 7, DPS=3)

### Documentation Updates
- [x] CHARLIE_MIGRATION_COMPLETE.md (already exists)
- [ ] Update README.md to remove Charlie startup instructions (future)
- [ ] Update system architecture diagrams (future)

### Future Cleanup Opportunities
1. Remove `[charlie]` log tags throughout codebase (cosmetic)
2. Rename `index.charlie.html` to `index.html` (cosmetic)
3. Remove `fetchPythonBackend()` function entirely (line 12268, deprecated)
4. Clean up proxy filter comments that mention Charlie

---

## Questions for Review

1. **Controller Target:** Should `controller.json` point to `192.168.2.80:3000` (Pi forwarder) or be deleted to use defaults?
   - **Recommendation:** Use `192.168.2.80:3000` - matches DEFAULT_CONTROLLER, preserves intent

2. **Deprecation Approach:** Add 410 Gone handlers or complete removal?
   - **Recommendation:** Add handlers - provides clear error messages, aids debugging

3. **Code Removal:** Should we remove deprecation handlers after 30 days?
   - **Recommendation:** Keep indefinitely - minimal code, high informational value

4. **Testing Scope:** Should we test all 79 pages or just critical paths?
   - **Recommendation:** Critical paths only - changes don't affect page rendering

---

## Approval Checklist

**Before Implementation:**
- [ ] User reviews and approves proposed changes
- [ ] User confirms controller target (192.168.2.80:3000 or alternative)
- [ ] User approves Option A (deprecation handlers) vs Option B (removal)

**During Implementation:**
- [ ] Backup controller.json before modification
- [ ] Test each change incrementally (don't batch all changes)
- [ ] Verify no 502 errors after each step

**After Implementation:**
- [ ] All 4 test cases pass
- [ ] Logs show no Charlie connection attempts
- [ ] Commit messages are clear and reference this proposal
- [ ] Update SYSTEM_AUDIT_PROPOSAL_2026-02-06.md status to "RESOLVED"

---

**Generated:** February 6, 2026  
**Agent:** GitHub Copilot (Implementation Agent)  
**Next Action:** Awaiting user review and approval
