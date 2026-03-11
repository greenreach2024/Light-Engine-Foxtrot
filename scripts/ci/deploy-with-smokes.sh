#!/usr/bin/env bash
# Deploy gate: run wholesale smoke tests before deploying to Elastic Beanstalk.
# Usage:
#   ./scripts/ci/deploy-with-smokes.sh [gc|le|both]
#
# Defaults to deploying GreenReach Central (gc).
# Exits non-zero if smoke tests fail, preventing the deploy.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

TARGET="${1:-gc}"

log() { printf '[deploy-gate] %s\n' "$1"; }
fail() { printf '[deploy-gate] FAIL: %s\n' "$1" >&2; exit 1; }

# ── Step 1: Run smoke tests ──────────────────────────────────────────
log "Running wholesale smoke tests..."
if ! bash scripts/ci/run-wholesale-smokes.sh; then
  fail "Smoke tests failed — aborting deploy"
fi

log "Smoke tests passed"

# ── Step 2: Stage changes ────────────────────────────────────────────
log "Staging git changes..."
git add -A

# ── Step 3: Deploy ───────────────────────────────────────────────────
deploy_gc() {
  log "Deploying GreenReach Central (greenreach-central-prod-v4)..."
  (cd greenreach-central && eb deploy greenreach-central-prod-v4 --staged --region us-east-1)
  log "GC deployed successfully"
}

deploy_le() {
  log "Deploying Light Engine Foxtrot (light-engine-foxtrot-prod-v3)..."
  eb deploy light-engine-foxtrot-prod-v3 --staged --region us-east-1
  log "LE deployed successfully"
}

case "$TARGET" in
  gc)   deploy_gc ;;
  le)   deploy_le ;;
  both) deploy_gc; deploy_le ;;
  *)    fail "Unknown target: $TARGET (use gc, le, or both)" ;;
esac

log "Deploy complete"
