# Farm Not Loading - Root Cause Analysis
**Date**: February 3, 2026  
**Issue**: "Farm not loading despite signing in with correct credentials"  
**Status**: 🔴 CRITICAL - Server cannot start

---

## Executive Summary

**The farm is not loading because the server is not running.** The server fails startup due to a schema validation error in `groups.json`. User authentication is irrelevant until the server successfully starts.

---

## Root Cause Analysis

### Primary Issue: Schema Format Violation

**File**: `/public/data/groups.json`  
**Current Format**: Object with wrapper
```json
{
  "schemaVersion": "1.0.0",
  "groups": [
    { "id": "ROOM-A-Z1-G01", ... },
    ...8 groups total
  ]
}
```

**Expected Format**: Direct array (per framework validator)
```json
[
  { "id": "ROOM-A-Z1-G01", ... },
  ...8 groups total
]
```

**Framework Validation Error**:
```
❌ FRAMEWORK VIOLATIONS DETECTED - APPLICATION WILL NOT START

1. ❌ groups.json must be an array, got: object

📖 Framework Documentation:
   - .github/AGENT_SKILLS_FRAMEWORK.md
   - .github/DATA_FORMAT_STANDARDS.md
   - .github/copilot-instructions-schema.md
```

**Impact**: Server crashes on startup before accepting any HTTP requests (including login).

---

## Symptom Timeline

1. **User Action**: "Signed in with correct credentials"
2. **User Expectation**: Farm data loads in dashboard
3. **Actual Result**: Nothing happens
4. **Root Cause**: Server not running (crashed at startup)
5. **Validation**: `lsof -i :8091` → ❌ No server listening

---

## Secondary Issues (Discovered During Investigation)

### Authentication Configuration

**Current State**: No authentication method configured for local development

**Available Authentication Modes**:

1. **Edge Mode** (Local Development)
   - Requires: `EDGE_MODE=true` environment variable
   - Accepts: Any email/password combination
   - Returns: JWT token with farm_id from `FARM_ID` env var
   - Status: ❌ NOT CONFIGURED

2. **Demo Mode** (Testing)
   - Farm ID: `demo-farm-001`
   - Email: `admin@demo.farm`
   - Password: `demo123`
   - Returns: JWT token for demo farm
   - Status: ✅ Available but not documented to user

3. **Cloud Mode** (Production)
   - Requires: PostgreSQL database connection
   - Validates: Against `users` table
   - Returns: JWT token for authenticated user
   - Status: ❌ Not applicable for local dev

**User's Login Attempt**:
- Farm ID: `FARM-MKLOMAT3-A9D8`
- Email: `shelbygilbert@rogers.com`
- Password: (unknown)
- Result: Server not running to accept request

---

## Data Inventory

### Farm Data (Confirmed Present)

**`/public/data/farm.json`** ✅ Valid
```json
{
  "farmId": "FARM-MKLOMAT3-A9D8",
  "name": "Big Green Farm",
  "status": "online",
  "contact": {
    "name": "Shelby Gilbert",
    "email": "shelbygilbert@rogers.com"
  }
}
```

**`/public/data/rooms.json`** ✅ Valid
- 1 room: "Big Green Farm - Room 1"

**`/public/data/room-map.json`** ✅ Valid
- 1 zone: "room-knukf2:1" (Zone 1)
- 1 device: ESP32 Sensor (serial-0001)

**`/public/data/groups.json`** ❌ INVALID FORMAT
- Contains: 8 active grow groups
- Problem: Wrapped in object instead of direct array
- Consequence: Server startup blocked

**ESP32 Sensor** ✅ Active
- Bridge script running (PID 21859)
- Last update: 2026-02-03T22:52:21.811Z
- Data: 18.67°C, 65% humidity

---

## Proposed Solutions

### Solution 1: Fix Schema Format (REQUIRED)

**Action**: Convert groups.json from object wrapper to direct array

**Before**:
```json
{
  "schemaVersion": "1.0.0",
  "groups": [...]
}
```

**After**:
```json
[
  { "id": "ROOM-A-Z1-G01", ... },
  { "id": "ROOM-A-Z1-G02", ... },
  ...
]
```

**Implementation**:
```bash
# Extract groups array to new file
jq '.groups' public/data/groups.json > public/data/groups-fixed.json

# Backup original
mv public/data/groups.json public/data/groups-backup.json

# Replace with fixed version
mv public/data/groups-fixed.json public/data/groups.json
```

**Validation**:
```bash
# Should return "array"
jq 'type' public/data/groups.json

# Should return 8
jq 'length' public/data/groups.json
```

---

### Solution 2: Configure Authentication (REQUIRED)

**Option A: Edge Mode (Recommended for Local Dev)**

Create `.env` file:
```bash
EDGE_MODE=true
FARM_ID=FARM-MKLOMAT3-A9D8
PORT=8091
```

**Benefits**:
- Any email/password works
- No database required
- Instant authentication
- Farm data loaded from local files

**Option B: Use Demo Credentials**

No configuration needed, use these credentials:
- Farm ID: `demo-farm-001`
- Email: `admin@demo.farm`
- Password: `demo123`

**Benefits**:
- Works immediately
- No environment setup

**Option C: Database Setup (Production-Like)**

Requires:
1. PostgreSQL database access
2. User record in `users` table
3. Password hash generation
4. Farm record in `farms` table

**Not recommended** for local development due to complexity.

---

### Solution 3: Server Restart Process (REQUIRED)

**After fixing schema format**:

```bash
# 1. Navigate to project directory
cd ~/Light-Engine-Foxtrot

# 2. Verify groups.json is now an array
jq 'type' public/data/groups.json
# Expected output: "array"

# 3. Start server with edge mode
EDGE_MODE=true FARM_ID=FARM-MKLOMAT3-A9D8 PORT=8091 node server-foxtrot.js

# 4. Verify server started
# Look for: "🚀 Light Engine Foxtrot listening on port 8091"

# 5. In another terminal, verify server listening
lsof -i :8091 -sTCP:LISTEN
```

---

## Login Process (After Server Fixed)

### Step 1: Navigate to Login Page
```
http://localhost:8091/login.html
```

### Step 2A: Edge Mode Login (Any Credentials)
```
Email: shelbygilbert@rogers.com
Password: [anything]
Farm ID: [leave blank or use FARM-MKLOMAT3-A9D8]
```

### Step 2B: Demo Mode Login
```
Email: admin@demo.farm
Password: demo123
Farm ID: demo-farm-001
```

### Step 3: Verify Authentication
After successful login:
- Token stored in `localStorage.getItem('token')`
- Redirected to `/LE-dashboard.html`
- Farm name appears in header: "Big Green Farm"

### Step 4: Navigate to Groups V2
1. Click "Groups V2" in sidebar
2. **Room dropdown** should show: "Big Green Farm - Room 1"
3. **Zone dropdown** should show: "Zone 1"
4. **Load group dropdown** should show: 8 groups

---

## Framework Compliance Notes

### Why This Happened

**Quote from copilot-instructions.md**:
> **Before modifying any data files** (groups.json, farm.json, rooms.json):
> 1. Read `DATA_FORMAT_STANDARDS.md` for canonical formats
> 2. Check `SCHEMA_CONSUMERS.md` for consumer count and impact
> 3. Run `npm run validate-schemas` to verify current state
> 4. **NEVER** modify source data format to fix a single page/card
> 5. **ALWAYS** fix consumers or use adapters

**Violation**: Someone added `schemaVersion` wrapper to groups.json without:
- Checking DATA_FORMAT_STANDARDS.md
- Running schema validation
- Considering impact on 56+ consumers

### Framework Documents Referenced
- `.github/AGENT_SKILLS_FRAMEWORK.md` - Core principles
- `.github/DATA_FORMAT_STANDARDS.md` - Canonical formats
- `.github/copilot-instructions-schema.md` - Modification rules
- `.github/SCHEMA_CONSUMERS.md` - Impact analysis

---

## Validation Checklist

After implementing solutions:

- [ ] `jq 'type' public/data/groups.json` returns `"array"`
- [ ] `jq 'length' public/data/groups.json` returns `8`
- [ ] `.env` file exists with `EDGE_MODE=true`
- [ ] Server starts without errors
- [ ] `lsof -i :8091` shows node process listening
- [ ] `curl http://localhost:8091/data/farm.json` returns farm data
- [ ] `curl http://localhost:8091/data/groups.json` returns array of 8 groups
- [ ] Login page loads at `http://localhost:8091/login.html`
- [ ] Login succeeds with any email/password (edge mode)
- [ ] Dashboard loads at `http://localhost:8091/LE-dashboard.html`
- [ ] Farm name shows "Big Green Farm" in header
- [ ] Groups V2 panel shows 8 groups in dropdown

---

## Risk Assessment

### If Schema Not Fixed
- 🔴 **CRITICAL**: Server cannot start
- 🔴 **CRITICAL**: No access to any application features
- 🔴 **CRITICAL**: All farm data inaccessible
- 🟡 **MEDIUM**: May impact other agents/deployments using same schema

### If Authentication Not Configured
- 🔴 **CRITICAL**: Cannot test farm features locally
- 🟡 **MEDIUM**: User confusion about "signing in"
- 🟢 **LOW**: Workaround available (demo credentials)

---

## Implementation Priority

1. **CRITICAL (P0)**: Fix groups.json schema format
2. **CRITICAL (P0)**: Restart server successfully
3. **HIGH (P1)**: Configure edge mode authentication
4. **MEDIUM (P2)**: Document authentication options for user
5. **LOW (P3)**: Add schema validation to pre-commit hooks

---

## Alternative: Bypass Framework Validator (NOT RECOMMENDED)

**If immediate access needed**, could disable validator:

**File**: `server-foxtrot.js` (line ~23,900)
```javascript
// Comment out validation
// if (!validateFramework()) {
//   process.exit(1);
// }
```

**Risks**:
- ⚠️ Violates framework compliance
- ⚠️ May cause runtime errors in consumers
- ⚠️ Breaks multi-agent collaboration model
- ⚠️ Creates technical debt
- ⚠️ Defeats purpose of framework enforcement

**Only use if**:
- Emergency access required
- Schema fix planned within 24 hours
- User understands compliance violation

---

## Questions for User

1. **How did groups.json get wrapped in object?**
   - Was this an agent modification?
   - Was this a manual edit?
   - Was this from a data import?

2. **What authentication method do you want?**
   - Edge mode (any credentials work)?
   - Demo mode (fixed credentials)?
   - Database mode (real user accounts)?

3. **Is this a development or production environment?**
   - Local development → Use edge mode
   - Production → Use database auth

4. **Do you want to preserve schemaVersion metadata?**
   - If yes: Framework needs to be updated
   - If no: Remove wrapper and use direct array

---

## Next Steps

**Immediate (< 5 minutes)**:
1. User confirms: Extract groups array from wrapper?
2. User confirms: Enable edge mode authentication?
3. Execute schema fix (1 command)
4. Restart server with edge mode (1 command)
5. Verify login works

**Short-term (< 1 hour)**:
1. Document authentication modes in README
2. Create `.env.example` template
3. Add schema validation to npm scripts
4. Test full workflow: login → dashboard → groups

**Long-term (< 1 week)**:
1. Add pre-commit hook for schema validation
2. Document framework compliance in contributor guide
3. Create data migration guide for schema changes
4. Add automated tests for data format compliance

---

## Summary

**Problem**: Farm not loading  
**Root Cause**: Server not running due to schema validation failure  
**Fix**: Convert groups.json from object wrapper to direct array  
**Time to Fix**: < 2 minutes  
**Risk**: Low (backup exists, data preserved)  

**User was correct** that they signed in with correct credentials. However, the server wasn't running to receive the login request. Once server is fixed, login will work with edge mode configuration.
