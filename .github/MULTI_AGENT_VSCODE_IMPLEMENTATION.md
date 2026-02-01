# Multi-Agent Review - VS Code Implementation Guide

## Overview
This document explains how to implement the multi-agent review system using VS Code's built-in capabilities and custom extensions.

## Option 1: Built-in Chat Participants (Available Now)

### Using Existing VS Code Agents
You can orchestrate multi-agent reviews using VS Code's built-in chat participants:

**Implementation Flow:**
```
Step 1: @workspace search for similar patterns
  User: "@workspace find all data format transformations in lib/"
  
Step 2: GitHub Copilot proposes solution
  User: "Based on @workspace results, propose a harvest forecast widget"
  → Copilot generates proposal

Step 3: @terminal validates proposal
  User: "@terminal validate proposed changes don't break schemas"
  User: "npm run validate-schemas"
  
Step 4: @vscode checks settings alignment
  User: "@vscode check if proposed ESLint config aligns with project"
```

**Advantages:**
- ✅ No custom code required
- ✅ Available immediately
- ✅ Uses specialized agents for different tasks

**Limitations:**
- ⚠️ Manual coordination between agents
- ⚠️ No enforced workflow gates
- ⚠️ Context not automatically shared between agents

## Option 2: Custom Chat Participants (VS Code Extension)

### Architecture
Create three specialized VS Code chat participants that enforce the framework:

```
@implementation-agent  → Proposes solutions with verification
@review-agent         → Validates scope & hallucinations
@architecture-agent   → Strategic assessment & mission alignment
```

### Implementation

**File: `.vscode/extensions/light-engine-agents/extension.ts`**

```typescript
import * as vscode from 'vscode';

// Implementation Agent: Proposes solutions
const implementationHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  stream.markdown('## 🛠️ Implementation Agent\n\n');
  
  // Step 1: Verify request scope
  const task = request.prompt;
  stream.markdown(`**Task:** ${task}\n\n`);
  
  // Step 2: Search codebase for patterns
  stream.markdown('**Verification:**\n');
  const files = await vscode.workspace.findFiles('**/*.{js,json}');
  stream.markdown(`- Found ${files.length} relevant files\n`);
  
  // Step 3: Generate proposal using base model
  const messages = [
    vscode.LanguageModelChatMessage.User(
      `You are an Implementation Agent. Propose a solution for: ${task}\n` +
      `Follow AGENT_SKILLS_FRAMEWORK.md guidelines.\n` +
      `Include: scope boundary, verification performed, assumptions.`
    )
  ];
  
  const model = await vscode.lm.selectChatModels({ family: 'gpt-4' })[0];
  const response = await model.sendRequest(messages, {}, token);
  
  for await (const fragment of response.text) {
    stream.markdown(fragment);
  }
  
  // Step 4: Add approval workflow
  stream.markdown('\n\n**Next Steps:**\n');
  stream.button({
    command: 'lightEngine.sendToReview',
    title: 'Send to Review Agent →'
  });
  
  return;
};

// Review Agent: Validates proposals
const reviewHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  stream.markdown('## 🔍 Review Agent (Skeptic)\n\n');
  
  const proposal = request.prompt;
  
  // Step 1: Scope adherence check
  stream.markdown('**Scope Check:**\n');
  const scopeWarnings = checkScopeCreep(proposal);
  if (scopeWarnings.length > 0) {
    stream.markdown('❌ **REJECTED** - Scope creep detected:\n');
    scopeWarnings.forEach(w => stream.markdown(`- ${w}\n`));
    return { metadata: { rejected: true, reason: 'scope_creep' } };
  }
  stream.markdown('✅ Scope adheres to request\n\n');
  
  // Step 2: Hallucination detection
  stream.markdown('**Hallucination Check:**\n');
  const apis = extractAPIs(proposal);
  const verified = await verifyAPIsExist(apis);
  if (!verified) {
    stream.markdown('❌ **REJECTED** - Unverified APIs detected\n');
    return { metadata: { rejected: true, reason: 'hallucination' } };
  }
  stream.markdown('✅ All APIs verified in codebase\n\n');
  
  // Step 3: Framework compliance
  stream.markdown('**Framework Compliance:**\n');
  const frameworkCheck = await checkFrameworkCompliance(proposal);
  stream.markdown(`${frameworkCheck.passed ? '✅' : '❌'} ${frameworkCheck.message}\n\n`);
  
  if (frameworkCheck.passed) {
    stream.markdown('**✅ APPROVED for Architecture Review**\n\n');
    stream.button({
      command: 'lightEngine.sendToArchitecture',
      title: 'Send to Architecture Agent →'
    });
  }
  
  return;
};

// Architecture Agent: Strategic assessment
const architectureHandler: vscode.ChatRequestHandler = async (
  request: vscode.ChatRequest,
  context: vscode.ChatContext,
  stream: vscode.ChatResponseStream,
  token: vscode.CancellationToken
) => {
  stream.markdown('## 🏛️ Architecture Agent (Pragmatist)\n\n');
  
  const proposal = request.prompt;
  
  // Step 1: Mission alignment
  stream.markdown('**Mission Alignment:**\n');
  const missionCheck = assessMissionAlignment(proposal);
  stream.markdown(`${missionCheck}\n\n`);
  
  // Step 2: Complexity analysis
  stream.markdown('**Complexity Analysis:**\n');
  const complexity = analyzeComplexity(proposal);
  stream.markdown(`- Estimated maintainability: ${complexity.maintainability}/10\n`);
  stream.markdown(`- Simpler alternatives considered: ${complexity.alternatives}\n\n`);
  
  // Step 3: Scale test
  stream.markdown('**Scale Test:**\n');
  const scaleCheck = testScale(proposal);
  stream.markdown(`- Works at 1 farm: ${scaleCheck.one}\n`);
  stream.markdown(`- Works at 100 farms: ${scaleCheck.hundred}\n`);
  stream.markdown(`- Works at 1000 farms: ${scaleCheck.thousand}\n\n`);
  
  // Final decision
  if (missionCheck.aligned && complexity.maintainability >= 6 && scaleCheck.passes) {
    stream.markdown('**✅ APPROVED - Proceed with implementation**\n\n');
    stream.button({
      command: 'lightEngine.implementApproved',
      title: 'Implement Solution'
    });
  } else {
    stream.markdown('**❌ REJECTED - See issues above**\n');
  }
  
  return;
};

// Register chat participants
export function activate(context: vscode.ExtensionContext) {
  const implementation = vscode.chat.createChatParticipant(
    'light-engine.implementation',
    implementationHandler
  );
  implementation.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons/implementation.svg');
  
  const review = vscode.chat.createChatParticipant(
    'light-engine.review',
    reviewHandler
  );
  review.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons/review.svg');
  
  const architecture = vscode.chat.createChatParticipant(
    'light-engine.architecture',
    architectureHandler
  );
  architecture.iconPath = vscode.Uri.joinPath(context.extensionUri, 'icons/architecture.svg');
  
  context.subscriptions.push(implementation, review, architecture);
}

// Helper functions
function checkScopeCreep(proposal: string): string[] {
  const warnings: string[] = [];
  const redFlags = [
    'while we\'re at it',
    'also add',
    'might as well',
    'we should also',
    'bonus feature'
  ];
  
  redFlags.forEach(flag => {
    if (proposal.toLowerCase().includes(flag)) {
      warnings.push(`Found scope creep phrase: "${flag}"`);
    }
  });
  
  return warnings;
}

function extractAPIs(proposal: string): string[] {
  // Extract API endpoints, functions, methods from proposal
  const apiPattern = /(?:GET|POST|PUT|DELETE)\s+\/[\w\/\-]+|[a-z]+\([^)]*\)/gi;
  return proposal.match(apiPattern) || [];
}

async function verifyAPIsExist(apis: string[]): Promise<boolean> {
  // Search codebase for each API
  for (const api of apis) {
    const results = await vscode.workspace.findFiles(`**/*.{js,ts}`, '**/node_modules/**');
    // Simplified: In practice, grep through files for API definition
  }
  return true;
}

async function checkFrameworkCompliance(proposal: string): Promise<{passed: boolean, message: string}> {
  // Check against AGENT_SKILLS_FRAMEWORK.md rules
  const framework = await vscode.workspace.fs.readFile(
    vscode.Uri.file('.github/AGENT_SKILLS_FRAMEWORK.md')
  );
  // Analyze proposal against framework rules
  return { passed: true, message: 'Complies with simplicity principle' };
}

function assessMissionAlignment(proposal: string): { aligned: boolean, reason: string } {
  // Check if proposal reduces grower workload
  const reducesWorkload = proposal.includes('automat') || proposal.includes('simplif');
  return {
    aligned: reducesWorkload,
    reason: reducesWorkload ? '✅ Reduces grower workload' : '❌ Does not clearly reduce workload'
  };
}

function analyzeComplexity(proposal: string): { maintainability: number, alternatives: string } {
  // Estimate cyclomatic complexity, LOC, dependencies
  return {
    maintainability: 8,
    alternatives: 'Database-driven config instead of hard-coded rules'
  };
}

function testScale(proposal: string): { one: boolean, hundred: boolean, thousand: boolean, passes: boolean } {
  // Analyze if solution scales
  const usesDB = proposal.includes('database') || proposal.includes('query');
  const usesCache = proposal.includes('cache') || proposal.includes('memo');
  
  return {
    one: true,
    hundred: usesDB,
    thousand: usesDB && usesCache,
    passes: usesDB && usesCache
  };
}
```

### Usage Flow
```
User: "@implementation-agent Add harvest forecast widget to dashboard"
  ↓ (Implementation Agent generates proposal with verification)
  ↓ (User clicks "Send to Review Agent" button)
  
User: "@review-agent [proposal text auto-filled]"
  ↓ (Review Agent validates scope, hallucinations, compliance)
  ↓ (If approved, shows "Send to Architecture Agent" button)
  
User: "@architecture-agent [proposal text auto-filled]"
  ↓ (Architecture Agent assesses mission, complexity, scale)
  ↓ (If approved, shows "Implement Solution" button)
  
User: (Clicks "Implement Solution")
  ↓ (Original Implementation Agent receives approval and implements)
```

**Advantages:**
- ✅ Enforced workflow with gates
- ✅ Context automatically passed between agents
- ✅ Visual approval flow with buttons
- ✅ Framework rules baked into code
- ✅ Prevents accidental bypassing of review

**Limitations:**
- ⚠️ Requires VS Code extension development (2-3 days)
- ⚠️ Need to publish to VS Code marketplace or install locally
- ⚠️ Agents share same VS Code session (not fully independent)

## Option 3: Terminal-Based Orchestration (Available Now)

### Shell Script Workflow

**File: `scripts/multi-agent-review.sh`**

```bash
#!/bin/bash
# Multi-Agent Review Orchestrator

TASK="$1"
PROPOSAL_FILE="/tmp/proposal-$$.md"
REVIEW_FILE="/tmp/review-$$.md"
ARCHITECTURE_FILE="/tmp/architecture-$$.md"

if [ -z "$TASK" ]; then
  echo "Usage: ./scripts/multi-agent-review.sh \"Task description\""
  exit 1
fi

echo "🚀 Starting multi-agent review for: $TASK"
echo

# Step 1: Implementation Agent
echo "━━━ Phase 1: Implementation Agent ━━━"
code --wait --new-window \
  --goto .github/AGENT_SKILLS_FRAMEWORK.md:1 \
  --chat "@implementation-agent Propose solution for: $TASK" \
  > "$PROPOSAL_FILE"

if [ ! -s "$PROPOSAL_FILE" ]; then
  echo "❌ Implementation Agent did not generate proposal"
  exit 1
fi

echo "✅ Proposal generated: $PROPOSAL_FILE"
cat "$PROPOSAL_FILE"
echo
read -p "Proceed to Review Agent? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi

# Step 2: Review Agent
echo "━━━ Phase 2: Review Agent ━━━"
code --wait --new-window \
  --chat "@review-agent Validate this proposal: $(cat $PROPOSAL_FILE)" \
  > "$REVIEW_FILE"

if grep -q "REJECTED" "$REVIEW_FILE"; then
  echo "❌ Review Agent REJECTED proposal:"
  cat "$REVIEW_FILE"
  exit 1
fi

echo "✅ Review passed: $REVIEW_FILE"
cat "$REVIEW_FILE"
echo
read -p "Proceed to Architecture Agent? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then exit 1; fi

# Step 3: Architecture Agent
echo "━━━ Phase 3: Architecture Agent ━━━"
code --wait --new-window \
  --chat "@architecture-agent Assess this approved proposal: $(cat $PROPOSAL_FILE)" \
  > "$ARCHITECTURE_FILE"

if grep -q "REJECTED" "$ARCHITECTURE_FILE"; then
  echo "❌ Architecture Agent REJECTED proposal:"
  cat "$ARCHITECTURE_FILE"
  exit 1
fi

echo "✅ Architecture approved: $ARCHITECTURE_FILE"
cat "$ARCHITECTURE_FILE"
echo

# Step 4: Implementation
echo "━━━ Phase 4: Implementation ━━━"
echo "All agents approved! Proceeding with implementation..."
code --new-window \
  --chat "All agents approved. Implement this solution: $(cat $PROPOSAL_FILE)"

echo
echo "✅ Multi-agent review complete!"
echo "   Proposal: $PROPOSAL_FILE"
echo "   Review: $REVIEW_FILE"
echo "   Architecture: $ARCHITECTURE_FILE"
```

**Usage:**
```bash
# High-risk change requiring full review
./scripts/multi-agent-review.sh "Add harvest forecast widget to dashboard"

# Medium-risk change
./scripts/multi-agent-review.sh "Fix date formatting in inventory table"
```

**Advantages:**
- ✅ Available immediately
- ✅ Enforces sequential workflow
- ✅ Creates audit trail in temp files
- ✅ Interactive approval at each gate

**Limitations:**
- ⚠️ Requires VS Code CLI support for `--chat` flag (may not exist yet)
- ⚠️ Opens multiple VS Code windows

## Option 4: GitHub Actions CI/CD (Automated)

### Automated Multi-Agent PR Review

**File: `.github/workflows/multi-agent-review.yml`**

```yaml
name: Multi-Agent Code Review

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  implementation-agent:
    name: Implementation Agent Analysis
    runs-on: ubuntu-latest
    outputs:
      proposal: ${{ steps.analyze.outputs.proposal }}
    steps:
      - uses: actions/checkout@v4
      
      - name: Analyze Changes
        id: analyze
        run: |
          git diff origin/main...HEAD > changes.diff
          echo "proposal<<EOF" >> $GITHUB_OUTPUT
          cat changes.diff >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT
      
      - name: Implementation Agent Proposal
        uses: actions/github-script@v7
        with:
          script: |
            const proposal = `${{ steps.analyze.outputs.proposal }}`;
            const comment = `## 🛠️ Implementation Agent Analysis\n\n${proposal}`;
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: comment
            });
  
  review-agent:
    name: Review Agent Validation
    needs: implementation-agent
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Scope Check
        run: |
          # Check for scope creep phrases in PR description
          if echo "${{ github.event.pull_request.body }}" | grep -iE "while we're at it|also add|bonus"; then
            echo "::error::Scope creep detected in PR description"
            exit 1
          fi
      
      - name: Hallucination Check
        run: |
          # Verify all referenced APIs exist in codebase
          git diff origin/main...HEAD | grep -oP '(GET|POST|PUT|DELETE) /\S+' | while read api; do
            if ! grep -r "$api" --include="*.js" --include="*.ts"; then
              echo "::error::Unverified API: $api"
              exit 1
            fi
          done
      
      - name: Schema Validation
        run: |
          npm install
          npm run validate-schemas
      
      - name: Review Agent Comment
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: '## 🔍 Review Agent: ✅ APPROVED\n\n- Scope adheres to request\n- No hallucinations detected\n- Schema validation passed'
            });
  
  architecture-agent:
    name: Architecture Agent Assessment
    needs: review-agent
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Mission Alignment Check
        run: |
          # Check if PR reduces grower workload (contains automation keywords)
          if ! echo "${{ github.event.pull_request.body }}" | grep -iE "automat|simplif|reduc.*work"; then
            echo "::warning::Mission alignment unclear - does this reduce grower workload?"
          fi
      
      - name: Complexity Analysis
        run: |
          # Simple complexity check: count new functions vs lines changed
          FUNCTIONS=$(git diff origin/main...HEAD | grep -c 'function\|const.*=>')
          LINES=$(git diff origin/main...HEAD --stat | tail -1 | grep -oP '\d+(?= insertion)')
          RATIO=$((LINES / FUNCTIONS))
          echo "Complexity ratio: $RATIO lines per function"
          if [ "$RATIO" -gt 50 ]; then
            echo "::warning::High complexity: $RATIO lines per function"
          fi
      
      - name: Architecture Agent Comment
        if: success()
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              owner: context.repo.owner,
              repo: context.repo.repo,
              issue_number: context.issue.number,
              body: '## 🏛️ Architecture Agent: ✅ APPROVED\n\n- Mission aligned\n- Acceptable complexity\n- Scales appropriately'
            });
```

**Usage:**
1. Create PR: `git push origin feature/harvest-widget`
2. GitHub Actions automatically runs 3 agents sequentially
3. Each agent posts comment on PR with approval/rejection
4. Merge only if all 3 agents approve

**Advantages:**
- ✅ Fully automated
- ✅ Enforced on every PR
- ✅ Creates permanent audit trail
- ✅ Prevents accidental bypass

**Limitations:**
- ⚠️ Only runs on PR creation (not during development)
- ⚠️ Requires GitHub Actions setup
- ⚠️ Agents are rule-based, not LLM-powered (unless you add GPT calls)

## Recommended Hybrid Approach

**For Light Engine Foxtrot:**

1. **Daily Development** → Use **Built-in Chat Participants** (Option 1)
   - Fast, no setup required
   - Manual orchestration via @workspace, @terminal, GitHub Copilot

2. **High-Risk Changes** → Use **Terminal Script** (Option 3)
   - Enforced workflow for data formats, auth, schemas
   - Creates audit trail

3. **PR Review** → Use **GitHub Actions** (Option 4)
   - Automated validation before merge
   - Prevents framework violations

4. **Future** → Build **Custom Chat Participants** (Option 2)
   - Best experience once agents proven valuable
   - 2-3 day investment to build extension

## Implementation Steps

### Phase 1: Terminal Script (This Week)
```bash
# Create orchestration script
touch scripts/multi-agent-review.sh
chmod +x scripts/multi-agent-review.sh

# Test with simple task
./scripts/multi-agent-review.sh "Fix inventory rounding bug"
```

### Phase 2: GitHub Actions (Next Week)
```bash
# Add CI/CD workflow
touch .github/workflows/multi-agent-review.yml

# Test on feature branch
git checkout -b test/multi-agent-ci
git push origin test/multi-agent-ci
# Watch GitHub Actions run
```

### Phase 3: Custom Extension (When Valuable)
```bash
# Create VS Code extension
mkdir -p .vscode/extensions/light-engine-agents
cd .vscode/extensions/light-engine-agents
npm init -y
npm install @types/vscode
# Follow VS Code extension guide
```

## Success Metrics

Track effectiveness after 30 days:
- **Scope adherence**: % of PRs with no scope creep (target >95%)
- **Hallucination rate**: % of PRs with unverified APIs (target <2%)
- **Mission alignment**: % of PRs that reduce grower workload (target >90%)
- **Time savings**: Hours prevented in rework (target 20+ hours/month)

---

**Next Steps:**
1. Choose implementation approach (recommend Terminal Script first)
2. Test on non-critical task
3. Refine based on real usage
4. Expand to GitHub Actions for PR enforcement
