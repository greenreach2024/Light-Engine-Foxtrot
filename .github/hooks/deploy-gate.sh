#!/bin/bash
# deploy-gate.sh -- PreToolUse hook for run_in_terminal
# Intercepts terminal commands containing Cloud Run deploy commands and forces
# the agent to confirm BOTH services are addressed.
#
# Also blocks any deprecated EB commands outright.
#
# Reads JSON from stdin (Copilot hook contract).
# Returns JSON to stdout with permission decision.

set -euo pipefail

INPUT=$(cat)

# Extract the command from the tool input
COMMAND=$(echo "$INPUT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    cmd = data.get('toolInput', {}).get('command', '')
    print(cmd)
except:
    print('')
" 2>/dev/null)

# ============================================================
# HARD BLOCK: Deprecated EB commands
# ============================================================
if echo "$COMMAND" | grep -qE "(eb deploy|eb setenv|eb printenv|eb scale|aws elasticbeanstalk)"; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "DEPLOYMENT BLOCKED: Elastic Beanstalk is FULLY DEPRECATED. The platform migrated to Google Cloud Run in April 2026. Use 'docker buildx build --push' + 'gcloud run services update' instead. Read .github/PLAYBOOK.md and .github/instructions/deployment.instructions.md."
  }
}
EOF
  exit 0
fi

# ============================================================
# GATE: Cloud Run service updates (gcloud run services update / gcloud run deploy)
# ============================================================
if echo "$COMMAND" | grep -qE "gcloud run (services update|deploy)"; then
  HAS_LE=$(echo "$COMMAND" | grep -c "light-engine" || true)
  HAS_CENTRAL=$(echo "$COMMAND" | grep -c "greenreach-central" || true)

  if [ "$HAS_LE" -gt 0 ] && [ "$HAS_CENTRAL" -eq 0 ]; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "ask",
    "permissionDecisionReason": "DEPLOYMENT GATE: You are deploying ONLY to LE (light-engine). GreenReach Central (greenreach-central) is a SEPARATE Cloud Run service that may also need deployment. Did you already deploy Central, or does this change not affect Central? Review .github/CLOUD_ARCHITECTURE.md before proceeding."
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
    "permissionDecisionReason": "DEPLOYMENT GATE: You are deploying ONLY to Central (greenreach-central). Light Engine (light-engine) is a SEPARATE Cloud Run service that may also need deployment. Did you already deploy LE, or does this change not affect LE? Review .github/CLOUD_ARCHITECTURE.md before proceeding."
  }
}
EOF
    exit 0
  fi

  # Deploying to an unknown/unrecognized service name
  if [ "$HAS_LE" -eq 0 ] && [ "$HAS_CENTRAL" -eq 0 ]; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "DEPLOYMENT BLOCKED: Cloud Run service name not recognized. Valid services: light-engine (LE) or greenreach-central (Central). Read .github/PLAYBOOK.md."
  }
}
EOF
    exit 0
  fi
fi

# ============================================================
# GATE: Docker image pushes to Artifact Registry
# ============================================================
if echo "$COMMAND" | grep -qE "docker buildx build.*--push"; then
  # Warn if building without --platform linux/amd64
  if ! echo "$COMMAND" | grep -q "linux/amd64"; then
    cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "DEPLOYMENT BLOCKED: Docker build is missing '--platform linux/amd64'. Cloud Run requires amd64 images. Apple Silicon builds default to ARM64. Add '--platform linux/amd64' to the build command."
  }
}
EOF
    exit 0
  fi
fi

# Not a deploy command -- allow
cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow"
  }
}
EOF
