# Outdated Files Audit - February 4, 2026

## 🚨 CRITICAL ISSUE: Farm ID Conflicts

**Problem**: Multiple conflicting farm IDs across config files causing system instability.

### Current State Analysis

**Your Active Test Farm**:
- Farm ID: `FARM-TEST-WIZARD-001`
- Password: `Grow123`
- Name: "This is Your Farm"

**Configuration Conflicts Found**:

| Location | Farm ID | Status |
|----------|---------|--------|
| `config/edge-config.json` | `GR-00001` | ❌ **DEMO/OUTDATED** |
| `public/data/farm.json` | `FARM-TEST-WIZARD-001` | ✅ **CORRECT** |
| `config/edge-config.production.json` | `FARM-MKLOMAT3-A9D8` | ⚠️ **OLD PROD** |
| `data/lightengine.db` | `FARM-MKLOMAT3-A9D8` | ⚠️ **OLD PROD** |
| `light-engine/public/data/farm.json` | (empty/missing) | ❌ **LEGACY DIR** |

---

## 📁 Duplicate Directory Structure

### Problem: Multiple Data Directories

**Active Directory** (server-foxtrot.js uses):
```
/Users/petergilbert/Light-Engine-Foxtrot/public/data/
  - farm.json (FARM-TEST-WIZARD-001) ✅
  - groups.json (6.2KB - Feb 3)
  - rooms.json (25.5KB - Feb 3)
  - Total: 21 JSON files
```

**Legacy Directory** (OBSOLETE):
```
/Users/petergilbert/Light-Engine-Foxtrot/light-engine/public/data/
  - farm.json (FARM-MKLOMAT3-A9D8) ❌
  - groups.json (14.7KB - Feb 4)
  - rooms.json (2.3KB - Feb 4)
  - Total: 37 JSON files (more complete but outdated)
```

**Backup Directories** (Should be preserved):
```
/Users/petergilbert/Light-Engine-Foxtrot/docs/data/
/Users/petergilbert/Light-Engine-Foxtrot/docs/data.aws-backup/
/Users/petergilbert/Light-Engine-Foxtrot/public/data.aws-backup/
```

---

## 🔍 Outdated Configuration Files

### 1. Edge Config (CRITICAL)

**File**: `config/edge-config.json`
```json
{
  "farmId": "GR-00001",  // ❌ WRONG - Demo farm ID
  "farmName": "Demo Farm - Light Engine Showcase",  // ❌ WRONG
  "apiKey": "demo-api-key-...",  // ❌ WRONG - Demo key
  "offlineMode": false
}
```

**Should be**:
```json
{
  "farmId": "FARM-TEST-WIZARD-001",
  "farmName": "This is Your Farm",
  "apiKey": "<real-api-key-for-FARM-TEST-WIZARD-001>",
  "offlineMode": false
}
```

### 2. Database (WARNING)

**File**: `data/lightengine.db`

Current: Contains old farm `FARM-MKLOMAT3-A9D8` (Big Green Farm)

**Action Required**: 
- Either update existing record to FARM-TEST-WIZARD-001
- Or clear and recreate with correct farm

### 3. Production Config (STALE)

**File**: `config/edge-config.production.json`

Contains `FARM-MKLOMAT3-A9D8` - this was your old production farm on the reTerminal.

**Decision needed**: 
- Are you still using Big Green Farm (`FARM-MKLOMAT3-A9D8`)?
- Or has it been replaced by `FARM-TEST-WIZARD-001`?

---

## 📄 Duplicate HTML Files (81 vs 30)

**Active Directory**: `public/` (81 HTML files)
- ✅ login.html (recently fixed)
- ✅ views/farm-summary.html (recently fixed)
- ✅ views/nutrient-management.html (recently fixed)

**Legacy Directory**: `light-engine/public/` (30 HTML files)
- ❌ Outdated versions
- ❌ Missing recent fixes

**Documentation Copies**: `docs/` (old reference copies)
- admin.html
- farm-admin.html
- farm-admin-login.html
- views/farm-summary.html
- views/farm-inventory.html

---

## 🎯 IMMEDIATE ACTION REQUIRED

### Priority 1: Fix Edge Config (CRITICAL)

The `config/edge-config.json` file is pulling in demo farm settings, causing auth failures and data inconsistencies.

**Fix**:
```bash
cd /Users/petergilbert/Light-Engine-Foxtrot
cat > config/edge-config.json <<'EOF'
{
  "mode": "edge",
  "farmId": "FARM-TEST-WIZARD-001",
  "farmName": "This is Your Farm",
  "apiKey": "demo-api-key-12345678901234567890123456789012",
  "centralApiUrl": "http://localhost:3000",
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "hardwareModel": "Development Laptop",
  "version": "1.0.0",
  "offlineMode": true,
  "syncEnabled": false,
  "registrationComplete": true
}
EOF
```

### Priority 2: Update Database

```bash
sqlite3 data/lightengine.db <<'EOF'
DELETE FROM farms WHERE farmId = 'FARM-MKLOMAT3-A9D8';
INSERT OR REPLACE INTO farms (farmId, name, email, created_at) 
VALUES ('FARM-TEST-WIZARD-001', 'This is Your Farm', 'Johndoe@thisisyourfarm.com', datetime('now'));
EOF
```

### Priority 3: Archive Legacy Directories

```bash
# Archive old light-engine directory
mv light-engine light-engine.ARCHIVE-$(date +%Y%m%d)

# Archive old docs/data copies
mv docs/data docs/data.ARCHIVE-$(date +%Y%m%d)
```

---

## 📊 Documentation File Proliferation

**Found**: 100+ markdown documentation files in root directory

**Problem**: Many reference old farm IDs or configs, causing confusion:
- `FARM-MKLOMAT3-A9D8` referenced in 67+ files
- `FARM-TEST-WIZARD-001` referenced in 9 files only

**Categories**:
1. **Active/Current**: PROPOSAL_FARM_WIZARD_TESTING_2026-02-04.md, REVIEW_REQUEST_2026-02-04.md
2. **Outdated/Obsolete**: FARM_SUMMARY_PAGE_INVESTIGATION_2026-02-03.md (references old farm)
3. **Legacy Reference**: RETERMINAL_CONFIGURATION_STEPS.md (old deployment guide)

**Recommendation**: Create `docs/archive/` and move files referencing old farm IDs

---

## 🔧 Server Behavior Analysis

**Current Server Start**: `server-foxtrot.js`

**Environment Variables** (from testing sessions):
```bash
EDGE_MODE=true
FARM_ID=FARM-TEST-WIZARD-001
ADMIN_PASSWORD=Grow123
FARM_NAME="This is Your Farm"
PORT=8091
```

**Config Load Priority** (suspected):
1. Environment variables (FARM_ID) - ✅ CORRECT
2. `public/data/farm.json` - ✅ CORRECT
3. `config/edge-config.json` - ❌ WRONG (has demo ID)
4. Database `data/lightengine.db` - ⚠️ HAS OLD ID

**Problem**: When env vars not set, server falls back to wrong configs.

---

## 🎯 Recommended Cleanup Actions

### Immediate (Before Next Test)

1. ✅ **Fix `config/edge-config.json`** to use FARM-TEST-WIZARD-001
2. ✅ **Update database** to remove FARM-MKLOMAT3-A9D8
3. ✅ **Archive `light-engine/` directory** (legacy code)

### Short-Term (This Week)

4. ⏳ **Consolidate documentation** - move old farm references to archive
5. ⏳ **Remove duplicate HTML files** in docs/
6. ⏳ **Verify all config files** use consistent farm ID

### Long-Term (Next Sprint)

7. ⏳ **Create single source of truth** for farm config
8. ⏳ **Add validation** to detect farm ID mismatches on startup
9. ⏳ **Document** which directories are active vs. archive

---

## 🚨 Critical Files to Keep Synchronized

When you update farm configuration, ensure these files match:

| File | Farm ID Field | Current Value | Should Be |
|------|---------------|---------------|-----------|
| `config/edge-config.json` | `.farmId` | GR-00001 | FARM-TEST-WIZARD-001 |
| `public/data/farm.json` | `.farmId` | FARM-TEST-WIZARD-001 | ✅ CORRECT |
| `data/lightengine.db` | `farms.farmId` | FARM-MKLOMAT3-A9D8 | FARM-TEST-WIZARD-001 |
| ENV: `FARM_ID` | - | FARM-TEST-WIZARD-001 | ✅ CORRECT |

---

## 📋 Files Safe to Delete

**Legacy Directories**:
- `light-engine/` (entire directory - outdated codebase)
- `docs/data/` (old reference copies)
- `greenreach-central/public/` (old admin copies)

**Duplicate Admin Files** (keep only one version):
- `admin.js` (root)
- `central-admin.js` (root)
- `docs/admin.html`
- `docs/farm-admin.html`
- `docs/farm-admin-login.html`

**Old Testing/Debug Files**:
- `100.65.187.59.har` (old network capture)
- `check-admin-user.js` (one-time script)
- `check-schema.js` (one-time script)
- `create-green-farm.js` (old farm setup)
- `create-user-biggreen.cjs` (old user setup)

---

## ✅ Verification Checklist

After cleanup, verify:

- [ ] `config/edge-config.json` shows `FARM-TEST-WIZARD-001`
- [ ] `public/data/farm.json` shows `FARM-TEST-WIZARD-001`
- [ ] Database query returns `FARM-TEST-WIZARD-001`
- [ ] Login with FARM-TEST-WIZARD-001 / Grow123 succeeds
- [ ] Farm summary page shows "This is Your Farm"
- [ ] Health monitor shows correct data (no duplicates)
- [ ] No console errors about missing configs
- [ ] Server logs show "Farm ID: FARM-TEST-WIZARD-001" on startup

---

## 🎯 Next Steps

**Your approval needed for**:

1. Update `config/edge-config.json` to FARM-TEST-WIZARD-001?
2. Clear database and update to FARM-TEST-WIZARD-001?
3. Archive `light-engine/` directory?
4. Archive old documentation files referencing FARM-MKLOMAT3-A9D8?

**Once approved, I will execute all changes and verify system stability.**
