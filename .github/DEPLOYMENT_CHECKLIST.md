# DEPLOYMENT CHECKLIST - MANDATORY BEFORE EVERY PUSH
**Status**: BLOCKING - Deployment will fail if these checks are not completed  
**Date Effective**: February 1, 2026  
**Reason**: Prevent framework violations that caused $INCIDENT_DATE incidents  
**Authoritative playbook**: `.github/PLAYBOOK.md`  
**Platform**: Google Cloud Run (AWS Elastic Beanstalk is FULLY DEPRECATED)

---

## PRE-DEPLOYMENT VERIFICATION (YOU MUST DO THESE)

### 1. Framework Knowledge Check ✅
- [ ] **I have read** `.github/AGENT_SKILLS_FRAMEWORK.md` section "Investigation-First Methodology"
- [ ] **I understand** why demo data violations happened and what prevents them
- [ ] **I can explain**: Why this commit doesn't violate any rules (be specific)

### 2. Code Review Requirements ✅
- [ ] **For code changes** (lib/, server-*, routes/, public/data/):
  - [ ] Proposal submitted with: Problem → Investigation → Solution
  - [ ] Review Agent validated the approach
  - [ ] Architecture Agent approved if large scope
  - [ ] Commit message includes "(Review Agent approved)" or equivalent
- [ ] **For documentation** (*.md files): No review needed, proceed
- [ ] **For scripts** (scripts/ only): No review needed, proceed

### 3. Schema & Data Validation ✅
- [ ] **Run schema validation** (REQUIRED):
  ```bash
  npm run validate-schemas
  ```
- [ ] **Result**: ALL schemas must PASS
- [ ] **If failed**: Fix violations and re-run until passing
- [ ] **Proof**: Screenshot or terminal output showing ✅ PASSED

### 4. Canonical Data File Check ✅
- [ ] **No direct modifications** to:
  - `public/data/farm.json`
  - `public/data/groups.json`
  - `public/data/rooms.json`
  - `public/data/equipment.json`
- [ ] **If you modified these files**:
  - [ ] STOP - This violates framework rules
  - [ ] Use `lib/data-adapters.js` instead
  - [ ] Create adapter function if one doesn't exist
  - [ ] Update consumer code to use adapter

### 5. Demo Data Check ✅
- [ ] **No hardcoded demo data** in this commit:
  - [ ] No "light-engine-demo" farm ID
  - [ ] No "GR-00001", "DEMO-FARM-001" constants
  - [ ] No mock initialization at module level
  - [ ] No demo token generation
- [ ] **farm.json validation**:
  - [ ] Contains production farm ID
  - [ ] NOT "light-engine-demo"
  - [ ] NOT "DEMO-FARM-001"
  - [ ] NOT empty/null

### 6. Local Testing (REQUIRED) ✅
**Before pushing, test locally:**

```bash
# Kill any existing server on port 8091
lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true

# Start server
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot
node server-foxtrot.js &

# Wait for startup
sleep 5

# TEST 1: Framework validation runs successfully
curl -s http://localhost:8091/health | jq '.uptime' && echo "✅ Server started"

# TEST 2: Farm ID is NOT demo
curl -s http://localhost:8091/health | jq '.farmId' | grep -v "light-engine-demo" && echo "✅ Farm ID correct"

# TEST 3: No demo data warnings
curl -s http://localhost:8091/health | jq '.warnings[]?' | grep -i demo && echo "❌ Demo warnings found" || echo "✅ No demo warnings"

# TEST 4: Authentication works
curl -s -X POST http://localhost:8091/api/farm/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@test.com","password":"test"}' | jq '.error' && echo "✅ Auth endpoint accessible"
```

- [ ] **Result**: All tests pass
- [ ] **If failed**: Fix issues before committing

### 7. Commit Message Format ✅
- [ ] **Format**: `[Type]: [Description] (Review approval)`
- [ ] **Examples**:
  - `Fix: Remove demo farm initialization (Review Agent approved)`
  - `Feat: Add farm data adapter (Architecture Agent approved)`
  - `Docs: Update framework rules`
  - `CRITICAL: Block demo data at startup (Review Agent approved)`
- [ ] **Review notation**: Include if code/config changed
  - `(Review Agent approved)` - For logic/feature changes
  - `(Architecture Agent approved)` - For large-scope changes
  - `(Multi-agent review completed)` - For coordinated changes

### 8. Final Verification ✅
Before you `git push`:
- [ ] All tests pass locally
- [ ] Pre-commit hook ran successfully (no blocks)
- [ ] Commit message is clear and includes review notation
- [ ] You can explain what changed and why

---

## WHAT HAPPENS IF YOU SKIP THESE STEPS

### Pre-Commit Hook Will Block:
```
❌ BLOCKED: Direct modification of canonical data file
   File: public/data/farm.json
   Cannot proceed - fix and try again
```

### Server Will Fail to Start:
```
🚨 FRAMEWORK VIOLATIONS DETECTED - APPLICATION WILL NOT START
1. ❌ CRITICAL: farm.json contains DEMO farm ID: "light-engine-demo"
   Update to production farm ID
```

### Deployment Will Fail:
```
❌ Schema validation failed
❌ farm.json contains demo farm ID
Cannot deploy until violations fixed
```

**Result**: Your changes don't reach production. You must follow the process.

---

## WHY THIS MATTERS

The incidents on **February 1, 2026** happened because:
1. ❌ Agent modified farm.json without investigation
2. ❌ Agent removed demo logic but left demo data functions
3. ❌ Agent changed groups.json instead of using adapters
4. ❌ Agent never tested the actual fixes
5. ❌ Agent skipped multi-agent review completely

**This checklist makes #1-5 impossible to ignore.**

---

## QUESTIONS?

If you don't understand any of these checks:
- 📖 Read `.github/AGENT_SKILLS_FRAMEWORK.md` - explains the WHY
- 📖 Read `.github/DATA_FORMAT_STANDARDS.md` - explains data rules
- 📖 Read `.github/FRAMEWORK_ENFORCEMENT_SYSTEM.md` - explains automation

**Do NOT skip the process because "it's simple" or "you're sure it works".**

The framework exists because we learned the hard way that shortcuts cause disasters.
