# FRAMEWORK ENFORCEMENT SYSTEM
**Objective**: Make violations impossible, not just documented  
**Date**: February 1, 2026  
**Scope**: Prevent Real Incidents #1-6 from recurring

---

## LAYER 1: PRE-COMMIT HOOKS (Git-Level Protection)

### File: `.husky/pre-commit`
Block commits that violate framework rules BEFORE they reach the repository.

```bash
#!/bin/bash
set -e

echo "🔍 FRAMEWORK COMPLIANCE CHECK..."

# 1. Block direct modifications to canonical data files
PROTECTED_FILES=(
  "public/data/farm.json"
  "public/data/groups.json"
  "public/data/rooms.json"
  "public/data/equipment.json"
  "public/data/ctrl-map.json"
)

echo "  Checking canonical data file protection..."
for file in "${PROTECTED_FILES[@]}"; do
  if git diff --cached --name-only | grep -q "^$file$"; then
    echo "❌ BLOCKED: Direct modification of canonical data file: $file"
    echo "   RULE VIOLATION: Use lib/data-adapters.js instead"
    echo "   FRAMEWORK: DATA_FORMAT_STANDARDS.md section 'Update consumers, not source data'"
    exit 1
  fi
done

# 2. Block commits without multi-agent review notation
COMMIT_MSG=$(git diff --cached --diff-filter=A HEAD -- | grep -oP '(?<=\[message\])[^}]+' || echo "")
if ! echo "$COMMIT_MSG" | grep -iE "(Review Agent approved|Architecture Agent approved|Multi-agent review completed)"; then
  # Allow specific cases: documentation, minor fixes, auto-generated
  if ! git diff --cached --name-only | grep -qE "(\.md$|\.github/|scripts/validate)"; then
    echo "⚠️  WARNING: Commit message should reference review approval"
    echo "   Format: 'Fix: ... (Review Agent approved)'"
  fi
fi

# 3. Require validate-schemas before modifying data files
DATA_FILES_CHANGED=$(git diff --cached --name-only | grep "public/data/" | head -1)
if [ -n "$DATA_FILES_CHANGED" ]; then
  echo "  Running schema validation..."
  if ! npm run validate-schemas > /dev/null 2>&1; then
    echo "❌ Schema validation failed"
    echo "   RULE VIOLATION: Must run 'npm run validate-schemas' before committing data changes"
    exit 1
  fi
fi

# 4. Block commits with demo data hardcoding
echo "  Checking for hardcoded demo data..."
if git diff --cached -U0 | grep -E "light-engine-demo|GR-00001|DEMO-FARM|demo.*data|mockData"; then
  echo "⚠️  WARNING: Found potential demo data in commit"
  echo "   Review: Are you intentionally adding demo data?"
  read -p "Continue anyway? (y/N): " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# 5. Enforce commit message format for framework rules
COMMIT_MSG_FILE=$(git rev-parse --git-dir)/COMMIT_EDITMSG
if [ -f "$COMMIT_MSG_FILE" ]; then
  FIRST_LINE=$(head -1 "$COMMIT_MSG_FILE")
  if ! echo "$FIRST_LINE" | grep -qE "^(Fix|Feat|Docs|Refactor|Test):|Framework:"; then
    if ! echo "$FIRST_LINE" | grep -q "Merge branch"; then
      echo "⚠️  Commit message should start with conventional format"
      echo "   Format: Fix: | Feat: | Docs: | Refactor: | Test: | Framework:"
    fi
  fi
fi

echo "✅ Framework compliance check passed"
exit 0
```

---

## LAYER 2: CODE-LEVEL VALIDATION (Runtime Protection)

### File: `lib/framework-validator.js`
Validate framework rules at server startup and runtime.

```javascript
/**
 * Framework Validator - Enforce AGENT_SKILLS_FRAMEWORK rules at runtime
 * This prevents demo data, malformed configurations, and other violations from being served
 */

import fs from 'fs';
import path from 'path';

export class FrameworkValidator {
  constructor() {
    this.violations = [];
    this.warnings = [];
  }

  /**
   * RULE 1: Canonical Data Integrity Check
   * Ensure canonical data files match expected schemas
   */
  validateCanonicalDataFiles() {
    const requiredFiles = [
      'public/data/farm.json',
      'public/data/groups.json',
    ];

    for (const file of requiredFiles) {
      try {
        const content = JSON.parse(fs.readFileSync(file, 'utf8'));
        
        // farm.json must have valid production farmId
        if (file.includes('farm.json')) {
          const farmId = content.farmId;
          if (!farmId || farmId === 'light-engine-demo' || farmId === 'DEMO-FARM-001') {
            this.violations.push(
              `❌ CRITICAL: farm.json contains demo farm ID: "${farmId}"`
            );
          }
          if (!farmId) {
            this.violations.push(
              `❌ CRITICAL: farm.json missing farmId field`
            );
          }
        }

        // groups.json must have valid status/active fields
        if (file.includes('groups.json')) {
          if (!Array.isArray(content)) {
            this.violations.push(
              `❌ groups.json must be an array, got: ${typeof content}`
            );
          } else {
            content.forEach((group, idx) => {
              if (group.status === null || group.status === undefined) {
                this.violations.push(
                  `❌ groups.json[${idx}] has null status (canonical data violation)`
                );
              }
              if (group.active === null || group.active === undefined) {
                this.violations.push(
                  `❌ groups.json[${idx}] has null active (canonical data violation)`
                );
              }
            });
          }
        }
      } catch (error) {
        this.violations.push(
          `❌ Failed to read/parse ${file}: ${error.message}`
        );
      }
    }
  }

  /**
   * RULE 2: No Demo Mode Logic Should Execute
   * Check that demo data is not being loaded at runtime
   */
  validateNoDemoDataLoaded() {
    // This will be checked by monitoring initialization logs
    // See: LAYER 3 - Startup Validation
  }

  /**
   * RULE 3: Farm Store Should Not Initialize Multiple Farms
   * Lazy initialization only - no eager loading
   */
  validateFarmInitializationPattern() {
    const farmStoreFile = 'lib/farm-store.js';
    const content = fs.readFileSync(farmStoreFile, 'utf8');

    // Should NOT have DEMO_FARMS array
    if (content.includes('const DEMO_FARMS')) {
      this.violations.push(
        `❌ lib/farm-store.js contains DEMO_FARMS array (should use lazy initialization)`
      );
    }

    // Should have ensureFarmInitialized() for lazy loading
    if (!content.includes('export function ensureFarmInitialized')) {
      this.violations.push(
        `❌ lib/farm-store.js missing ensureFarmInitialized() (required for lazy loading)`
      );
    }
  }

  /**
   * RULE 4: Authentication Must Not Serve Demo Tokens
   * Login endpoint must validate against production credentials only
   */
  validateAuthenticationLogic() {
    const serverFile = 'server-foxtrot.js';
    const content = fs.readFileSync(serverFile, 'utf8');

    // Check that isDemoMode check doesn't come BEFORE real auth
    const loginEndpointMatch = content.match(
      /POST.*\/api\/farm\/auth\/login[\s\S]{0,2000}?res\.json/
    );
    
    if (loginEndpointMatch) {
      const loginCode = loginEndpointMatch[0];
      const demoCheckPos = loginCode.indexOf('isDemoMode()');
      const edgeCheckPos = loginCode.indexOf('edgeConfig.isEdgeMode()');
      
      if (demoCheckPos !== -1 && edgeCheckPos !== -1 && demoCheckPos < edgeCheckPos) {
        this.warnings.push(
          `⚠️  Authentication: isDemoMode() checked before Edge mode (may serve demo token first)`
        );
      }
    }
  }

  /**
   * Run all validations and report violations
   */
  validate() {
    console.log('\n🔍 FRAMEWORK VALIDATOR: Running compliance checks...\n');

    this.validateCanonicalDataFiles();
    this.validateFarmInitializationPattern();
    this.validateAuthenticationLogic();

    // Report violations (blocking)
    if (this.violations.length > 0) {
      console.error('❌ FRAMEWORK VIOLATIONS DETECTED:\n');
      this.violations.forEach(v => console.error(`  ${v}`));
      console.error('\n📖 See .github/AGENT_SKILLS_FRAMEWORK.md for rules\n');
      process.exit(1);
    }

    // Report warnings (non-blocking)
    if (this.warnings.length > 0) {
      console.warn('⚠️  FRAMEWORK WARNINGS:\n');
      this.warnings.forEach(w => console.warn(`  ${w}`));
      console.warn('');
    }

    console.log('✅ Framework validation passed\n');
    return true;
  }
}

// Export singleton
export const validator = new FrameworkValidator();
```

### Usage in server-foxtrot.js startup:
```javascript
import { validator } from './lib/framework-validator.js';

// At server startup (BEFORE app.listen())
try {
  validator.validate();
} catch (error) {
  console.error('❌ Framework validation failed:', error);
  process.exit(1);
}
```

---

## LAYER 3: STARTUP VALIDATION (Demo Data Detection)

### File: `lib/startup-validator.js`
Detect if demo data is actually being loaded at runtime.

```javascript
/**
 * Startup Validator - Detects demo data initialization at runtime
 * Runs AFTER all modules loaded but BEFORE app.listen()
 */

import farmStore from './farm-store.js';

export function validateNoSimultaneousMultipleFarmInitialization(databaseMode) {
  // Count how many farms were initialized at startup
  const farmCount = farmStore.inventory.listFarms().length;
  
  console.log(`[startup-validator] Farm count at initialization: ${farmCount}`);
  
  if (databaseMode === 'nedb' && farmCount > 1) {
    console.error(
      `❌ FRAMEWORK VIOLATION: NeDB mode initialized ${farmCount} farms (expected 1)`
    );
    console.error('   This indicates demo farm auto-initialization is still active');
    console.error('   Check: lib/farm-store.js initializeCurrentFarm() function');
    process.exit(1);
  }
}

export function validateFarmIDNotDemo() {
  // Get the actual farm ID that was loaded
  const farms = farmStore.inventory.listFarms();
  
  if (farms.length > 0) {
    const farmId = farms[0];
    const DEMO_IDS = ['light-engine-demo', 'DEMO-FARM-001', 'GR-00001', 'LOCAL-FARM'];
    
    if (DEMO_IDS.includes(farmId)) {
      console.error(
        `❌ FRAMEWORK VIOLATION: Loaded demo farm ID: "${farmId}"`
      );
      console.error('   Update public/data/farm.json with production farm ID');
      process.exit(1);
    }
  }
}
```

### Usage in server-foxtrot.js:
```javascript
import { validateNoSimultaneousMultipleFarmInitialization, validateFarmIDNotDemo } 
  from './lib/startup-validator.js';

// After all modules loaded, before app.listen()
validateNoSimultaneousMultipleFarmInitialization(getDatabaseMode());
validateFarmIDNotDemo();

app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT}`);
});
```

---

## LAYER 4: CI/CD PIPELINE ENFORCEMENT

### File: `.github/workflows/framework-validation.yml`
Automated checks that run on every push.

```yaml
name: Framework Validation

on: [push, pull_request]

jobs:
  framework-compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Check canonical data files unchanged
        run: |
          if git diff HEAD~1 HEAD --name-only | grep -E "public/data/(farm|groups|rooms).json"; then
            echo "❌ Canonical data file modification detected"
            echo "Framework Rule: Do not modify public/data files directly"
            echo "Solution: Use lib/data-adapters.js"
            exit 1
          fi
      
      - name: Validate schemas
        run: npm run validate-schemas
      
      - name: Check for demo data hardcoding
        run: |
          if git diff HEAD~1 HEAD | grep -E "light-engine-demo|GR-00001|DEMO-FARM"; then
            echo "⚠️ WARNING: Demo data found in code changes"
            # Non-blocking for now, but alerts developer
          fi
      
      - name: Check commit messages for review notation
        run: |
          COMMIT_MSG=$(git log --format=%B -n 1)
          if ! echo "$COMMIT_MSG" | grep -iE "(Review Agent approved|Architecture Agent approved)"; then
            if ! echo "$COMMIT_MSG" | grep -E "Merge|docs:|script"; then
              echo "⚠️ WARNING: Commit should include review approval"
              echo "Format: 'Fix: ... (Review Agent approved)'"
            fi
          fi

  farm-id-validation:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Validate farm.json has production farm ID
        run: |
          FARM_ID=$(jq -r '.farmId' public/data/farm.json)
          if [ "$FARM_ID" = "light-engine-demo" ] || [ "$FARM_ID" = "DEMO-FARM-001" ]; then
            echo "❌ farm.json contains demo farm ID: $FARM_ID"
            echo "Update to production farm ID (e.g., FARM-MKLOMAT3-A9D8)"
            exit 1
          fi
          if [ -z "$FARM_ID" ] || [ "$FARM_ID" = "null" ]; then
            echo "❌ farm.json missing farmId"
            exit 1
          fi
          echo "✅ farm.json has production farm ID: $FARM_ID"
```

---

## LAYER 5: DATA GOVERNANCE LAYER (Adapter Requirement)

### File: `lib/data-governance.js`
Prevent direct data file access. Force all access through adapters.

```javascript
/**
 * Data Governance Layer
 * Enforces that canonical data is ONLY modified through adapters
 * Direct file modifications are detected and logged
 */

import fs from 'fs';
import path from 'path';

const CANONICAL_FILES = [
  'public/data/farm.json',
  'public/data/groups.json',
  'public/data/rooms.json',
];

// Wrap fs.writeFileSync to detect unauthorized writes
const originalWrite = fs.writeFileSync;
fs.writeFileSync = function(file, data, encoding) {
  const resolved = path.resolve(file);
  const isCanonical = CANONICAL_FILES.some(
    canonical => path.resolve(canonical) === resolved
  );

  if (isCanonical) {
    const stack = new Error().stack;
    const caller = stack.split('\n')[2]; // Get calling function
    
    console.error(
      `❌ FRAMEWORK VIOLATION: Direct modification of canonical file`
    );
    console.error(`   File: ${file}`);
    console.error(`   Called from: ${caller}`);
    console.error(`   Solution: Use lib/data-adapters.js instead`);
    
    // Allow specific cases: migrations, initialization
    if (!caller.includes('initializeCurrentFarm') && !caller.includes('migration')) {
      throw new Error(
        `Data governance violation: Cannot write to ${file} directly. Use adapters.`
      );
    }
  }

  return originalWrite.call(fs, file, data, encoding);
};
```

---

## LAYER 6: MONITORING & ALERTING

### File: `lib/runtime-monitor.js`
Monitor for rule violations during execution.

```javascript
/**
 * Runtime Monitor - Detects violations while server is running
 */

export class RuntimeMonitor {
  constructor() {
    this.violations = [];
    this.demoDataLoadedAt = null;
    this.multipleInitializations = [];
  }

  onDemoDataLoaded(farmId, reason) {
    this.demoDataLoadedAt = {
      timestamp: new Date().toISOString(),
      farmId,
      reason,
      stack: new Error().stack,
    };
    
    console.error(`⚠️ DEMO DATA LOADED: ${farmId}`);
    console.error(`   Reason: ${reason}`);
    console.error('   This violates AGENT_SKILLS_FRAMEWORK: NO FAKE OR MOCK DATA');
  }

  onFarmInitialized(farmId, isInitialization = false) {
    if (isInitialization && this.multipleInitializations.length > 0) {
      // Already initialized one farm, now initializing another
      this.violations.push({
        type: 'MultipleSimultaneousInitializations',
        farms: [...this.multipleInitializations, farmId],
        violation: 'Lazy initialization only - should not initialize multiple farms at startup',
      });
    }
    
    if (isInitialization) {
      this.multipleInitializations.push(farmId);
    }
  }

  getViolationReport() {
    const report = {
      demoDataLoaded: this.demoDataLoadedAt,
      multipleInitializations: this.multipleInitializations,
      violations: this.violations,
      hasViolations: this.demoDataLoadedAt !== null || this.violations.length > 0,
    };
    
    return report;
  }
}

export const monitor = new RuntimeMonitor();
```

---

## LAYER 7: ENFORCEMENT IN AGENT PROMPTS

### Add to System Prompt for Agents
```
🚨 MANDATORY CHECKS BEFORE ANY CODE CHANGE:

1. Have you read AGENT_SKILLS_FRAMEWORK.md?
   ❌ If no: STOP. Read it now.
   ✅ If yes: Continue.

2. Is this a code change to lib/ or server-foxtrot.js or public/data/?
   ❌ If yes: You MUST follow multi-agent review (propose → validate → approve)
   ✅ If no: Continue.

3. Are you modifying public/data/(farm|groups|rooms).json?
   ❌ If yes: STOP. This violates canonical data rule.
       Instead: Modify lib/data-adapters.js to handle format variations
   ✅ If no: Continue.

4. Have you run: npm run validate-schemas?
   ❌ If no: STOP. Run it now. If it fails, fix it before proceeding.
   ✅ If yes: Continue.

5. Will this change be deployed to production/Edge?
   ❌ If yes: You MUST get Review Agent validation. Write proposal in format:
       "Problem: [description]
        Root Cause: [investigation findings]
        Proposed Solution: [technical approach]
        @ReviewAgent: Please validate"
   ✅ If no: Continue.

6. Do you know why past violations happened?
   ❌ If no: Read AGENT_FAILURE_FORENSIC_ANALYSIS_2026-02-01.md
   ✅ If yes: You understand what NOT to do.

COMMIT MESSAGE REQUIREMENTS:
- Must reference review approval: "(Review Agent approved)" OR "(Architecture Agent approved)"
- Example: "Fix: Remove demo data initialization (Review Agent approved)"
- If no approval: Commit is blocked by pre-commit hook

VIOLATION CONSEQUENCES:
- If you skip review: Pre-commit hook catches it
- If you modify canonical data: Pre-commit hook catches it
- If demo data loads: Runtime validator catches it at startup
- If schema invalid: CI/CD pipeline fails
- Result: Your change does NOT ship. You must follow the process.
```

---

## DEPLOYMENT CHECKLIST (Make It Impossible To Forget)

### File: `.github/DEPLOYMENT_CHECKLIST.md`

**BEFORE ANY DEPLOYMENT:**

- [ ] Read AGENT_SKILLS_FRAMEWORK.md section "Investigation-First Methodology"
- [ ] Run `npm run validate-schemas` - MUST PASS
- [ ] Commit message includes "(Review Agent approved)" or skip if documentation-only
- [ ] Did not directly modify public/data/(farm|groups|rooms).json
- [ ] Did not add DEMO_FARMS, isDemoMode(), or demo data hardcoding
- [ ] Tested locally: `curl http://localhost:8091/health | jq .farmId` does NOT return demo farm ID
- [ ] Tested locally: `curl http://localhost:8091/api/farm/auth/login` uses production credentials
- [ ] No hardcoded credentials in code (use .env)
- [ ] farm.json contains production farm ID (FARM-MKLOMAT3-A9D8), not demo farm ID
- [ ] If modified authentication: Tested login endpoint returns production tokens
- [ ] If modified farm initialization: Verified only ONE farm loaded at startup in production mode

**DEPLOYMENT FAILURE:**
If any check fails, deployment is blocked. Fix the issue and try again.

---

## SUMMARY: Prevention Through Automation

| Layer | Mechanism | Catches |
|-------|-----------|---------|
| **Pre-Commit** | Git hooks | Direct data file mods, missing review notation, schema errors |
| **Code-Level** | Framework validator | Demo farm IDs, null fields, multiple farm initialization |
| **Runtime** | Startup validator | Demo data loading, farm ID validation |
| **CI/CD** | GitHub Actions | Schema validation, demo data, commit format, farm ID |
| **Data Layer** | Governance layer | Unauthorized writes to canonical files |
| **Monitoring** | Runtime monitor | Demo data loaded during execution |
| **Agent Prompt** | Mandatory checks | Ensures agents ask right questions before coding |
| **Deployment** | Checklist | Forces manual verification before shipping |

**Result**: Violations are caught at **7 different stages** before they reach users. Skipping the framework becomes **harder than following it**.

