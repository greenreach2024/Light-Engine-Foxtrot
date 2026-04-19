# DEPLOYMENT CHECKLIST - MANDATORY BEFORE EVERY PUSH
**Status**: BLOCKING - Deployment will fail if these checks are not completed  
**Date Effective**: February 1, 2026  
**Reason**: Prevent framework violations that caused $INCIDENT_DATE incidents

---

## PRE-DEPLOYMENT VERIFICATION (YOU MUST DO THESE)

### 0. GitHub Parity Check ✅
- [ ] `git status` is clean for the branch being deployed
- [ ] The branch being deployed has been pushed to GitHub
- [ ] The exact production fixes exist on GitHub, not only in local branches or local `main`
- [ ] If fixes came from multiple branches, they were merged or cherry-picked before deploy
- [ ] If `main` is protected and direct push is blocked, the deploy branch has an open PR to `main`
- [ ] The deploy commit SHA matches the GitHub branch or PR head being shipped
- [ ] A report was added under `docs/operations/` for any production drift reconciliation
- [ ] For `main` deploys: `git rev-list --left-right --count origin/main...main` shows no local-only commits

### 0.1 Branch Reconciliation Check ✅
- [ ] Check whether required production fixes are split across multiple GitHub branches before deploy
- [ ] Compare `main` against any salvage, hotfix, reconcile, or recovery branches that contain production work
- [ ] Merge or cherry-pick every required production commit into one deploy branch before build
- [ ] Do not assume `main` contains the latest production behavior without verifying branch history
- [ ] Record source branches and commit SHAs in `docs/operations/` when reconciliation was required

### 0.2 Service and Folder Mapping Check ✅
- [ ] Root-level code (`server-foxtrot.js`, `routes/`, `lib/`, `services/`, root `public/`) maps to LE deploys
- [ ] `greenreach-central/` code maps to Central deploys
- [ ] Shared UI files duplicated in both `greenreach-central/public/` and root `public/` were updated in both locations
- [ ] If a file exists in both public folders, Central copy was edited first and then copied to root `public/`
- [ ] If shared UI changed, BOTH Cloud Run services were evaluated for deployment impact

### 1. Framework Knowledge Check ✅
- [ ] **I have read** `.github/AGENT_SKILLS_FRAMEWORK.md` section "Investigation-First Methodology"
- [ ] **I understand** why demo data violations happened and what prevents them
- [ ] **I know** LE bootstraps a missing `public/data/farm.json`, but existing `farm.json` must still contain the correct non-demo production farm ID
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
Before you deploy:
- [ ] All tests pass locally
- [ ] Pre-commit hook ran successfully (no blocks)
- [ ] Commit message is clear and includes review notation
- [ ] You can explain what changed and why
- [ ] GitHub contains the same commit(s) you are deploying
- [ ] Artifact Registry digest was resolved from `gcloud artifacts docker images list ... --include-tags`
- [ ] The service/file mapping below was checked so the correct Cloud Run services are redeployed

### 8.1 Correct Deployment Target ✅

| Change Type | Deploy LE | Deploy Central |
|-------------|-----------|----------------|
| `server-foxtrot.js`, root `routes/`, root `lib/`, root `services/`, root `public/` | Yes | No |
| `greenreach-central/server.js`, `greenreach-central/routes/`, `greenreach-central/services/`, `greenreach-central/public/` | No | Yes |
| Shared UI files duplicated in both public folders | Yes | Yes |
| Cross-service feature where LE serves UI and Central serves API | Usually Yes | Usually Yes |

Never infer deploy targets from the page where a bug appears. Check which service and folder actually serve the changed file.

### 8.2 Correct Release Sequence ✅

1. Reconcile required fixes into one deploy branch.
2. Push that branch to GitHub.
3. Open or update a PR if `main` branch protection blocks direct push.
4. Build from the exact pushed branch state.
5. Resolve the authoritative Artifact Registry digest.
6. Deploy the affected Cloud Run service(s) by digest.
7. Verify the new revision is healthy.
8. Merge the PR so GitHub `main` remains the long-term deployable source of truth.

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
