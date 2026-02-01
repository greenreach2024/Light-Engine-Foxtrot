#!/bin/bash
# Multi-Agent Review Orchestrator for Light Engine Foxtrot
# Enforces AGENT_SKILLS_FRAMEWORK.md three-agent workflow

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRAMEWORK_PATH="$WORKSPACE_ROOT/.github/AGENT_SKILLS_FRAMEWORK.md"
TEMP_DIR="/tmp/light-engine-review-$$"
PROPOSAL_FILE="$TEMP_DIR/1-proposal.md"
REVIEW_FILE="$TEMP_DIR/2-review.md"
ARCHITECTURE_FILE="$TEMP_DIR/3-architecture.md"
AUDIT_LOG="$WORKSPACE_ROOT/.multi-agent-audit.log"

# Create temp directory
mkdir -p "$TEMP_DIR"

# Usage check
if [ $# -eq 0 ]; then
  echo -e "${RED}Usage:${NC} $0 \"Task description\""
  echo
  echo "Examples:"
  echo "  $0 \"Add harvest forecast widget to dashboard\""
  echo "  $0 \"Fix date formatting in inventory table\""
  echo "  $0 \"Update groups.json schema for new recipe field\""
  exit 1
fi

TASK="$1"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Logging function
log_audit() {
  echo "[$TIMESTAMP] $1" >> "$AUDIT_LOG"
}

# Header
echo
echo -e "${CYAN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║         Multi-Agent Review - Light Engine Foxtrot              ║${NC}"
echo -e "${CYAN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${BLUE}Task:${NC} $TASK"
echo -e "${BLUE}Date:${NC} $TIMESTAMP"
echo -e "${BLUE}Audit:${NC} $AUDIT_LOG"
echo

log_audit "START: $TASK"

# ============================================================================
# PHASE 1: IMPLEMENTATION AGENT
# ============================================================================

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Phase 1: Implementation Agent${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "The Implementation Agent will propose a solution with verification."
echo "Please open a NEW VS Code chat window and paste the following prompt:"
echo
echo -e "${CYAN}────────────── COPY THIS PROMPT ──────────────${NC}"
cat > "$TEMP_DIR/implementation-prompt.txt" << EOF
@ImplementationAgent

Task: $TASK

INSTRUCTIONS:
1. Read .github/AGENT_SKILLS_FRAMEWORK.md before proposing
2. Verify APIs/files exist using grep_search and file_search tools
3. Follow the Implementation Agent template in the framework
4. Include these sections in your proposal:
   - Task Understanding
   - Scope Boundary (what is IN scope, what is OUT)
   - Solution Approach
   - Files to Modify
   - Verification Performed (show grep results, file reads)
   - Assumptions
   - Testing Strategy
   - Blast Radius

DO NOT:
- Add unrequested features ("while I'm here" changes)
- Assume APIs exist without verifying
- Propose changes outside the stated task scope

Propose a solution following the framework guidelines.
EOF

cat "$TEMP_DIR/implementation-prompt.txt"
echo -e "${CYAN}──────────────────────────────────────────────${NC}"
echo

# Wait for user to complete implementation phase
echo -e "${GREEN}Action Required:${NC}"
echo "1. Open a NEW GitHub Copilot chat window in VS Code"
echo "2. Copy the prompt above and paste it"
echo "3. Wait for the Implementation Agent's proposal"
echo "4. Copy the ENTIRE proposal (including verification results)"
echo "5. Paste it into this file: $PROPOSAL_FILE"
echo
read -p "Press ENTER when you have saved the proposal to the file above... "

# Validate proposal file exists
if [ ! -f "$PROPOSAL_FILE" ]; then
  echo -e "${RED}❌ ERROR: Proposal file not found at $PROPOSAL_FILE${NC}"
  echo "Please create the file and paste the Implementation Agent's proposal into it."
  read -p "Press ENTER when ready... "
fi

if [ ! -s "$PROPOSAL_FILE" ]; then
  echo -e "${RED}❌ ERROR: Proposal file is empty${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Proposal received ($(wc -l < "$PROPOSAL_FILE") lines)${NC}"
log_audit "IMPLEMENTATION: Proposal generated"
echo

# Show proposal summary
echo -e "${BLUE}Proposal Summary:${NC}"
head -20 "$PROPOSAL_FILE"
echo "... (see $PROPOSAL_FILE for full proposal)"
echo

# Gate: Proceed to Review?
echo -e "${YELLOW}━━━ Proceed to Review Agent? ━━━${NC}"
read -p "Continue? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
  echo -e "${RED}Review cancelled by user${NC}"
  log_audit "CANCELLED: User stopped at Implementation phase"
  exit 1
fi

# ============================================================================
# PHASE 2: REVIEW AGENT
# ============================================================================

echo
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Phase 2: Review Agent (Skeptic)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "The Review Agent will validate scope, hallucinations, and compliance."
echo "Please open a NEW VS Code chat window and paste the following prompt:"
echo
echo -e "${CYAN}────────────── COPY THIS PROMPT ──────────────${NC}"
cat > "$TEMP_DIR/review-prompt.txt" << EOF
@ReviewAgent (Skeptic Role)

Original Task: $TASK

PROPOSAL TO REVIEW:
$(cat "$PROPOSAL_FILE")

INSTRUCTIONS:
You are the Review Agent with VETO POWER. Your job is to catch mistakes.

Perform these checks:

1. SCOPE ADHERENCE CHECK:
   - Does proposal address ONLY the requested task?
   - Are there "while I'm here" improvements?
   - Are there bonus features not requested?
   - Auto-reject phrases: "also add", "might as well", "we should also"

2. HALLUCINATION DETECTION:
   - Did Implementation Agent verify ALL APIs exist?
   - Are there grep/file_search results for every function/endpoint mentioned?
   - Auto-reject phrases: "probably exists", "assuming", "should have"

3. FRAMEWORK COMPLIANCE:
   - Does solution follow DATA_FORMAT_STANDARDS.md (if touching data files)?
   - Does solution align with "simplicity over features" principle?
   - Does solution use database-driven config (not hard-coded)?

4. VERIFICATION QUALITY:
   - Are there actual grep results (not just claims)?
   - Are there file_search results showing files exist?
   - Are there read_file excerpts proving code structure?

Output format:
## Review Agent Decision

**Scope Check:** [PASS/FAIL] - [explanation]
**Hallucination Check:** [PASS/FAIL] - [explanation]
**Framework Compliance:** [PASS/FAIL] - [explanation]
**Verification Quality:** [PASS/FAIL] - [explanation]

**DECISION:** [APPROVED/REJECTED]

If REJECTED, explain what Implementation Agent must fix.
If APPROVED, note any minor concerns for Architecture Agent.
EOF

cat "$TEMP_DIR/review-prompt.txt"
echo -e "${CYAN}──────────────────────────────────────────────${NC}"
echo

# Wait for user to complete review phase
echo -e "${GREEN}Action Required:${NC}"
echo "1. Open a NEW GitHub Copilot chat window in VS Code"
echo "2. Copy the prompt above and paste it"
echo "3. Wait for the Review Agent's validation"
echo "4. Copy the ENTIRE review decision"
echo "5. Paste it into this file: $REVIEW_FILE"
echo
read -p "Press ENTER when you have saved the review to the file above... "

# Validate review file exists
if [ ! -s "$REVIEW_FILE" ]; then
  echo -e "${RED}❌ ERROR: Review file not found or empty at $REVIEW_FILE${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Review received ($(wc -l < "$REVIEW_FILE") lines)${NC}"
log_audit "REVIEW: Validation completed"
echo

# Check for rejection
if grep -qi "REJECTED" "$REVIEW_FILE"; then
  echo -e "${RED}❌ REVIEW AGENT REJECTED THE PROPOSAL${NC}"
  echo
  cat "$REVIEW_FILE"
  echo
  echo -e "${YELLOW}Next steps:${NC}"
  echo "1. Address the Review Agent's concerns"
  echo "2. Return to Implementation Agent with feedback"
  echo "3. Generate revised proposal"
  echo "4. Re-run this script with revised proposal"
  log_audit "REJECTED: Review Agent found issues"
  exit 1
fi

# Show review summary
echo -e "${BLUE}Review Summary:${NC}"
cat "$REVIEW_FILE"
echo

# Gate: Proceed to Architecture?
echo -e "${YELLOW}━━━ Proceed to Architecture Agent? ━━━${NC}"
read -p "Continue? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
  echo -e "${RED}Review cancelled by user${NC}"
  log_audit "CANCELLED: User stopped at Review phase"
  exit 1
fi

# ============================================================================
# PHASE 3: ARCHITECTURE AGENT
# ============================================================================

echo
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Phase 3: Architecture Agent (Pragmatist)${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo "The Architecture Agent will assess mission alignment and strategic fit."
echo "Please open a NEW VS Code chat window and paste the following prompt:"
echo
echo -e "${CYAN}────────────── COPY THIS PROMPT ──────────────${NC}"
cat > "$TEMP_DIR/architecture-prompt.txt" << EOF
@ArchitectureAgent (Pragmatist Role)

Original Task: $TASK

APPROVED PROPOSAL:
$(cat "$PROPOSAL_FILE")

REVIEW AGENT FEEDBACK:
$(cat "$REVIEW_FILE")

INSTRUCTIONS:
You are the Architecture Agent with STRATEGIC VETO POWER. Protect the mission.

Perform these assessments:

1. MISSION ALIGNMENT:
   - Does this reduce grower workload? (core mission)
   - Is it simpler than the current approach?
   - Does it align with "database-driven, not code-driven" philosophy?
   
   Auto-reject: "useful later", "might need", "more flexible"

2. COMPLEXITY ANALYSIS:
   - Estimated maintainability score (0-10, need ≥6)
   - Are there simpler alternatives?
   - Is complexity justified by value?

3. SCALE TEST:
   - Works at 1 farm? (must pass)
   - Works at 10 farms? (must pass)
   - Works at 100 farms? (must pass)
   - Works at 1,000 farms? (must pass)

4. COST/BENEFIT:
   - Development time estimate
   - Maintenance burden (low/medium/high)
   - Value delivered to growers
   - Worth the effort?

Output format:
## Architecture Agent Assessment

**Mission Alignment:** [ALIGNED/MISALIGNED] - [explanation]
**Complexity Analysis:** Maintainability [X/10] - [simpler alternatives?]
**Scale Test:** 1/10/100/1000 farms [PASS/FAIL each]
**Cost/Benefit:** [POSITIVE/NEGATIVE] - [analysis]

**STRATEGIC DECISION:** [APPROVED/DEFERRED/REJECTED]

- APPROVED: Proceed with implementation
- DEFERRED: Good idea but wrong time, add to backlog
- REJECTED: Does not align with mission or too complex

If DEFERRED/REJECTED, explain reasoning and suggest alternatives.
EOF

cat "$TEMP_DIR/architecture-prompt.txt"
echo -e "${CYAN}──────────────────────────────────────────────${NC}"
echo

# Wait for user to complete architecture phase
echo -e "${GREEN}Action Required:${NC}"
echo "1. Open a NEW GitHub Copilot chat window in VS Code"
echo "2. Copy the prompt above and paste it"
echo "3. Wait for the Architecture Agent's assessment"
echo "4. Copy the ENTIRE assessment"
echo "5. Paste it into this file: $ARCHITECTURE_FILE"
echo
read -p "Press ENTER when you have saved the assessment to the file above... "

# Validate architecture file exists
if [ ! -s "$ARCHITECTURE_FILE" ]; then
  echo -e "${RED}❌ ERROR: Architecture file not found or empty at $ARCHITECTURE_FILE${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Assessment received ($(wc -l < "$ARCHITECTURE_FILE") lines)${NC}"
log_audit "ARCHITECTURE: Assessment completed"
echo

# Check for rejection/deferral
if grep -qi "REJECTED\|DEFERRED" "$ARCHITECTURE_FILE"; then
  echo -e "${RED}❌ ARCHITECTURE AGENT DID NOT APPROVE${NC}"
  echo
  cat "$ARCHITECTURE_FILE"
  echo
  echo -e "${YELLOW}Next steps:${NC}"
  if grep -qi "DEFERRED" "$ARCHITECTURE_FILE"; then
    echo "- This is a good idea but wrong timing"
    echo "- Add to backlog for future consideration"
    log_audit "DEFERRED: Architecture Agent deferred to backlog"
  else
    echo "- Solution does not align with mission or is too complex"
    echo "- Consider simpler alternatives"
    log_audit "REJECTED: Architecture Agent found strategic issues"
  fi
  exit 1
fi

# Show architecture summary
echo -e "${BLUE}Architecture Assessment:${NC}"
cat "$ARCHITECTURE_FILE"
echo

# ============================================================================
# PHASE 4: IMPLEMENTATION APPROVAL
# ============================================================================

echo
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ ALL THREE AGENTS APPROVED${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo
echo -e "${BLUE}Summary:${NC}"
echo "  • Task: $TASK"
echo "  • Implementation Agent: Proposal with verification"
echo "  • Review Agent: ✅ APPROVED (scope, no hallucinations, compliant)"
echo "  • Architecture Agent: ✅ APPROVED (mission-aligned, scales, justified)"
echo
echo -e "${BLUE}Audit Trail:${NC}"
echo "  • Proposal: $PROPOSAL_FILE"
echo "  • Review: $REVIEW_FILE"
echo "  • Architecture: $ARCHITECTURE_FILE"
echo "  • Audit Log: $AUDIT_LOG"
echo

log_audit "APPROVED: All three agents approved"

# Final confirmation
echo -e "${YELLOW}━━━ Proceed with Implementation? ━━━${NC}"
echo "This will instruct the Implementation Agent to proceed with coding."
echo
read -p "Continue? [Y/n] " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]] && [[ ! -z $REPLY ]]; then
  echo -e "${YELLOW}Implementation paused${NC}"
  echo "When ready, return to the Implementation Agent chat and say:"
  echo -e "${CYAN}All agents approved. Proceed with implementation.${NC}"
  log_audit "PAUSED: User will implement manually"
  exit 0
fi

# Implementation instruction
echo
echo -e "${GREEN}Implementation Approval Granted${NC}"
echo
echo "Return to your Implementation Agent chat (Phase 1) and send this message:"
echo
echo -e "${CYAN}────────────── COPY THIS MESSAGE ──────────────${NC}"
cat > "$TEMP_DIR/implementation-approval.txt" << EOF
## ✅ Multi-Agent Approval Granted

All three agents have approved your proposal:

**Review Agent:** ✅ APPROVED
- Scope adheres to request
- No hallucinations detected
- Framework compliance verified

**Architecture Agent:** ✅ APPROVED
- Mission aligned (reduces grower workload)
- Acceptable complexity
- Scales appropriately

**Decision:** Proceed with implementation

Implement the solution as proposed. Create a git branch for this work:
\`\`\`bash
git checkout -b feature/$(echo "$TASK" | tr '[:upper:] ' '[:lower:]-' | tr -cd '[:alnum:]-')
\`\`\`

After implementation:
1. Test thoroughly
2. Run \`npm run validate-schemas\` if data files changed
3. Create PR with audit trail attached
4. Reference this review: $TEMP_DIR

Begin implementation now.
EOF

cat "$TEMP_DIR/implementation-approval.txt"
echo -e "${CYAN}──────────────────────────────────────────────${NC}"
echo

log_audit "IMPLEMENTING: Approval message generated"

# Success banner
echo
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║              Multi-Agent Review Complete                       ║${NC}"
echo -e "${GREEN}║                    ✅ APPROVED                                  ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo
echo -e "${BLUE}Next Steps:${NC}"
echo "  1. Paste the approval message into Implementation Agent chat"
echo "  2. Wait for implementation to complete"
echo "  3. Test the changes"
echo "  4. Attach audit trail to PR: $TEMP_DIR"
echo
echo -e "${BLUE}Audit Trail Preserved:${NC}"
echo "  • Review files saved in: $TEMP_DIR"
echo "  • Permanent log: $AUDIT_LOG"
echo
echo "Happy coding! 🚀"
