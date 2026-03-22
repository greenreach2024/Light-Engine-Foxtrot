#!/bin/bash
# deploy-gate.sh — PreToolUse hook for run_in_terminal
# Intercepts terminal commands containing "eb deploy" and forces
# the agent to confirm BOTH environments are addressed.
#
# Reads JSON from stdin (Copilot hook contract).
# Returns JSON to stdout with permission decision.

set -euo pipefail

INPUT=$(cat)

# Extract the command from the tool input
# The hook receives the full tool call — command is in toolInput.command
COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    cmd = data.get('toolInput', {}).get('command', '')
    print(cmd)
except:
    print('')
" 2>/dev/null)

# Only gate on eb deploy commands
if echo "$COMMAND" | grep -q "eb deploy"; then
  # Check which target is being deployed to
  HAS_LE=$(echo "$COMMAND" | grep -c "light-engine-foxtrot-prod-v3" || true)
  HAS_CENTRAL=$(echo "$COMMAND" | grep -c "greenreach-central-prod-v4" || true)

  if [ "$HAS_LE" -gt 0 ] && [ "$HAS_CENTRAL" -eq 0 ]; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "DEPLOYMENT GATE: You are deploying ONLY to LE (light-engine-foxtrot-prod-v3). GreenReach Central (greenreach-central-prod-v4) is a SEPARATE EB application that also needs deployment. Did you already deploy Central, or does this change not affect Central? Review .github/CLOUD_ARCHITECTURE.md before proceeding."
  }
}
EOF
    exit 0
  fi

  if [ "$HAS_CENTRAL" -gt 0 ] && [ "$HAS_LE" -eq 0 ]; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "DEPLOYMENT GATE: You are deploying ONLY to Central (greenreach-central-prod-v4). Light Engine (light-engine-foxtrot-prod-v3) is a SEPARATE EB application that also needs deployment. Did you already deploy LE, or does this change not affect LE? Review .github/CLOUD_ARCHITECTURE.md before proceeding."
  }
}
EOF
    exit 0
  fi

  # Deploying to an unknown target
  if [ "$HAS_LE" -eq 0 ] && [ "$HAS_CENTRAL" -eq 0 ]; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "DEPLOYMENT BLOCKED: eb deploy target not recognized. Valid targets: light-engine-foxtrot-prod-v3 (LE) or greenreach-central-prod-v4 (Central). Read .github/CLOUD_ARCHITECTURE.md."
  }
}
EOF
    exit 0
  fi
fi

# Not a deploy command — allow
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
EOF
