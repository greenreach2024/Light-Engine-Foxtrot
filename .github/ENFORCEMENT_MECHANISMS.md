# Agent Skills Framework - Enforcement Mechanisms

## Problem
Framework exists but is routinely violated. Need hard stops, not soft guidelines.

## Enforcement Layers

### Layer 1: Pre-Commit Hooks (MANDATORY)

**File: `.git/hooks/pre-commit`**

```bash
#!/bin/bash
# AGENT SKILLS FRAMEWORK ENFORCER

echo "🔒 Agent Skills Framework Check..."

# Block direct commits to critical files without approval tag
CRITICAL_FILES=(
  "data/groups.json"
  "data/farm.json"
  "data/rooms.json"
  "lib/data-adapters.js"
  "greenreach-central/routes/sync.js"
  "greenreach-central/config/database.js"
)

STAGED=$(git diff --cached --name-only)

for file in "${CRITICAL_FILES[@]}"; do
  if echo "$STAGED" | grep -q "$file"; then
    # Check if commit message has approval tags
    COMMIT_MSG=$(cat .git/COMMIT_EDITMSG 2>/dev/null || echo "")
    
    if ! echo "$COMMIT_MSG" | grep -qE "\[APPROVED:REVIEW\].*\[APPROVED:ARCH\]"; then
      echo "❌ BLOCKED: $file is a critical file"
      echo ""
      echo "Critical files require multi-agent approval:"
      echo "  1. Get Review Agent validation"
      echo "  2. Get Architecture Agent approval"
      echo "  3. Add tags to commit message:"
      echo "     [APPROVED:REVIEW] [APPROVED:ARCH] Your commit message"
      echo ""
      echo "Or use: git commit --no-verify (emergency only, tracked in logs)"
      exit 1
    fi
  fi
done

# Check schema validation before commit
if echo "$STAGED" | grep -qE "data/.*\.json"; then
  echo "📊 Running schema validation..."
  npm run validate-schemas --silent
  if [ $? -ne 0 ]; then
    echo "❌ BLOCKED: Schema validation failed"
    echo "Fix schema errors or get Architecture Agent approval to bypass"
    exit 1
  fi
  echo "✅ Schemas valid"
fi

# Check for scope creep phrases in commit message
if echo "$COMMIT_MSG" | grep -qiE "while we're at it|also add|bonus|might as well"; then
  echo "⚠️  WARNING: Scope creep detected in commit message"
  echo "Review Agent should have caught this. Proceed? [y/N]"
  read -r response
  if [[ ! "$response" =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

echo "✅ Framework checks passed"
```

**Installation:**
```bash
# Make mandatory for all developers
chmod +x .git/hooks/pre-commit
git config core.hooksPath .git/hooks
```

---

### Layer 2: GitHub Actions - PR Gating (BLOCKING)

**File: `.github/workflows/agent-framework-enforcer.yml`**

```yaml
name: Agent Skills Framework Enforcer

on:
  pull_request:
    types: [opened, synchronize, reopened, edited]

jobs:
  framework-compliance:
    name: Framework Compliance Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      
      # RULE 1: Critical files require approval tags in PR description
      - name: Check for Approval Tags
        run: |
          CRITICAL_FILES="data/groups.json data/farm.json data/rooms.json lib/data-adapters.js greenreach-central/routes/sync.js greenreach-central/config/database.js"
          
          CHANGED=$(git diff --name-only origin/${{ github.base_ref }}...HEAD)
          
          for file in $CRITICAL_FILES; do
            if echo "$CHANGED" | grep -q "$file"; then
              echo "🔍 Critical file changed: $file"
              
              # Check PR description for approval tags
              if ! echo "${{ github.event.pull_request.body }}" | grep -qE "\[APPROVED:REVIEW\].*\[APPROVED:ARCH\]"; then
                echo "❌ FAIL: Critical file modified without approval tags"
                echo ""
                echo "Required in PR description:"
                echo "[APPROVED:REVIEW] by @reviewer-name"
                echo "[APPROVED:ARCH] by @architect-name"
                echo ""
                exit 1
              fi
            fi
          done
      
      # RULE 2: Schema validation must pass
      - name: Schema Validation
        run: |
          npm ci
          npm run validate-schemas
      
      # RULE 3: Check consumer impact analysis
      - name: Consumer Impact Check
        run: |
          if git diff origin/${{ github.base_ref }}...HEAD --name-only | grep -qE "data/.*\.json"; then
            if ! echo "${{ github.event.pull_request.body }}" | grep -qi "consumer impact"; then
              echo "❌ FAIL: Data format change without consumer impact analysis"
              echo ""
              echo "Required: Add section to PR description:"
              echo "## Consumer Impact Analysis"
              echo "- Consumers affected: X files"
              echo "- Breaking changes: Yes/No"
              echo "- Migration plan: [if breaking]"
              exit 1
            fi
          fi
      
      # RULE 4: Scope creep detection
      - name: Scope Creep Check
        run: |
          if echo "${{ github.event.pull_request.body }}" | grep -qiE "while we're at it|also add|bonus|might as well|we should also"; then
            echo "⚠️  WARNING: Scope creep phrases detected in PR description"
            echo "Review Agent should reject this. Flagging for manual review."
            gh pr comment ${{ github.event.pull_request.number }} \
              --body "⚠️ **Scope Creep Detected** - Review Agent validation required"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      
      # RULE 5: Mission alignment check
      - name: Mission Alignment Check
        run: |
          TITLE="${{ github.event.pull_request.title }}"
          BODY="${{ github.event.pull_request.body }}"
          
          # Check if PR reduces grower workload (mission-critical)
          if ! echo "$TITLE $BODY" | grep -qiE "automat|simplif|reduc.*work|save.*time|eliminate.*step"; then
            echo "⚠️  WARNING: Mission alignment unclear"
            echo "Does this reduce grower workload?"
            gh pr comment ${{ github.event.pull_request.number }} \
              --body "⚠️ **Mission Alignment Check** - Does this reduce grower workload?"
          fi
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  block-merge:
    name: Block Merge Without Approvals
    runs-on: ubuntu-latest
    needs: framework-compliance
    if: failure()
    steps:
      - name: Add Block Label
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.addLabels({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              labels: ['⛔ framework-violation']
            });
      
      - name: Request Changes
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.pulls.createReview({
              owner: context.repo.owner,
              repo: context.repo.repo,
              pull_request_number: context.issue.number,
              event: 'REQUEST_CHANGES',
              body: '❌ **Agent Skills Framework Violation**\n\nThis PR violates framework rules. See CI logs for details.\n\nRequired:\n1. Get Review Agent validation\n2. Get Architecture Agent approval\n3. Add approval tags to PR description'
            });
```

---

### Layer 3: VS Code Workspace Settings (REMINDERS)

**File: `.vscode/settings.json`**

```json
{
  "files.watcherExclude": {
    "**/.git/objects/**": true,
    "**/.git/subtree-cache/**": true,
    "**/node_modules/*/**": true
  },
  
  "files.associations": {
    "data/*.json": "jsonc"
  },
  
  // AGENT FRAMEWORK ENFORCEMENT
  "editor.rulers": [80, 120],
  "editor.snippets.codeActions.enabled": true,
  
  // Show warning when opening critical files
  "workbench.editorAssociations": {
    "data/groups.json": "default",
    "data/farm.json": "default",
    "data/rooms.json": "default"
  },
  
  // Require validation before save
  "editor.codeActionsOnSave": {
    "source.fixAll": true
  },
  
  // Add framework reminder to status bar
  "files.autoSave": "onFocusChange",
  
  "git.inputValidation": "always",
  "git.requireGitUserConfig": true,
  
  // Block editing critical files without framework tag
  "files.readonlyInclude": {
    "data/groups.json": true,
    "data/farm.json": true,
    "data/rooms.json": true
  },
  
  "files.readonlyExclude": {},
  
  // Custom task for multi-agent review
  "tasks.version": "2.0.0",
  "tasks.tasks": [
    {
      "label": "🚦 Multi-Agent Review Required",
      "type": "shell",
      "command": "echo",
      "args": [
        "⚠️  STOP: This file requires multi-agent review\n\n1. Propose change to Review Agent\n2. Get Architecture Agent approval\n3. Add [APPROVED] tags before commit\n\nSee: .github/AGENT_SKILLS_FRAMEWORK.md"
      ],
      "problemMatcher": [],
      "presentation": {
        "echo": true,
        "reveal": "always",
        "focus": true,
        "panel": "dedicated"
      }
    }
  ]
}
```

---

### Layer 4: Required PR Template (STRUCTURED)

**File: `.github/PULL_REQUEST_TEMPLATE.md`**

```markdown
## Change Description
<!-- What does this PR do? Keep scope narrow. -->


## Agent Framework Compliance

### Implementation Agent
- [ ] Scope is narrow and well-defined
- [ ] No hallucinated APIs or functions
- [ ] Verified all referenced code exists in codebase
- [ ] Ran `npm run validate-schemas` (if data changes)

### Review Agent Validation
- [ ] **[APPROVED:REVIEW]** by @username
- [ ] No scope creep detected
- [ ] All APIs verified in codebase
- [ ] Schema validation passed
- [ ] No data format changes without adapter

**Review Agent Notes:**
<!-- Reviewer: Add validation notes here -->


### Architecture Agent Approval
- [ ] **[APPROVED:ARCH]** by @username
- [ ] Mission aligned (reduces grower workload)
- [ ] Complexity acceptable (maintainability >= 6/10)
- [ ] Scales appropriately (tested at 1, 100, 1000 farms)
- [ ] Simpler alternatives considered

**Architecture Agent Notes:**
<!-- Architect: Add strategic assessment here -->


## Consumer Impact Analysis
<!-- Required for data format changes -->

**Consumers Affected:** 
- [ ] N/A (no data changes)
- [ ] X files (list them)

**Breaking Changes:** 
- [ ] No
- [ ] Yes (migration plan below)

**Migration Plan:**
<!-- If breaking changes, how to migrate existing consumers? -->


## Testing
- [ ] Manual testing completed
- [ ] Smoke tests pass
- [ ] Schema validation passes
- [ ] No regressions in existing features


## Rollback Plan
<!-- If this breaks production, how to rollback? -->


---

**⚠️ Framework Violation?** If you bypassed review, explain why:
<!-- Emergency fix? Production down? Approved by Peter? -->
```

---

### Layer 5: Commit Message Template (STRUCTURED)

**File: `.gitmessage`**

```
# [TYPE] Brief description (50 chars max)

# TYPE: feat|fix|refactor|data|schema|auth|BREAKING

# Detailed explanation (wrap at 72 chars)


# Agent Framework Compliance:
# [APPROVED:REVIEW] by @username (or N/A for trivial changes)
# [APPROVED:ARCH] by @username (or N/A for trivial changes)

# Consumer Impact (for data/schema changes):
# Consumers affected: X files
# Breaking: Yes/No

# Testing:
# - Manual: (describe)
# - Automated: npm run validate-schemas

# Rollback plan:
# (how to revert if this breaks production)
```

**Enable:**
```bash
git config commit.template .gitmessage
```

---

## Enforcement Metrics

Track violations weekly:

```bash
# Count bypasses (--no-verify usage)
git log --all --grep="--no-verify" --oneline | wc -l

# Count critical file changes without approval tags
git log --all --oneline -- data/*.json greenreach-central/routes/*.js | \
  grep -v "\[APPROVED:REVIEW\].*\[APPROVED:ARCH\]" | wc -l

# Count scope creep in commits
git log --all --grep="while we're at it\|also add\|bonus" --oneline | wc -l
```

**Target:** <5% bypass rate

---

## Escalation Path

When agent is about to violate framework:

```
1. STOP
2. State: "This requires multi-agent review per framework"
3. Ask: "Should I:
   a) Propose solution for Review Agent validation
   b) Skip review (emergency - will be logged)
   c) Defer this change to separate PR"
4. Wait for user decision
5. Log bypass reason if approved
```

---

## Emergency Bypass

For production-down scenarios:

```bash
# Bypass with audit trail
git commit --no-verify -m "[EMERGENCY] Fix prod-down issue

Reason: Production database offline
Approved by: Peter Gilbert
Framework bypass: Logged in .github/bypass-log.md
Will retroactively review: Yes, within 24h
"

# Log bypass
echo "- $(date): Emergency bypass for prod fix" >> .github/bypass-log.md
```

---

## Success Criteria

Framework is working when:
- ✅ 95%+ of critical file changes have approval tags
- ✅ <5% bypass rate
- ✅ Zero schema breaks reach production
- ✅ Zero scope creep PRs merged
- ✅ Mission alignment questioned on every PR

---

**Status:** PROPOSED  
**Next Step:** Implement Layer 1 (pre-commit hook) today  
**Timeline:**
- Day 1: Pre-commit hook
- Day 2: PR template + GitHub Actions
- Day 3: VS Code settings
- Day 4: Test & refine
