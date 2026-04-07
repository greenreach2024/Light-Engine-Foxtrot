#!/bin/bash
# GreenReach Cloud Run Migration - Populate Secret Manager
# Run this in Cloud Shell after setup-infrastructure.sh.
#
# This script reads values from your local .env files and populates
# the corresponding Secret Manager secrets. Only secrets with
# non-empty values are updated.
#
# Usage:
#   # From repo root on your local machine:
#   bash gcp/populate-secrets.sh
#
# Or copy-paste the generated gcloud commands into Cloud Shell.

set -euo pipefail

PROJECT_ID="project-5d00790f-13a9-4637-a40"

echo "============================================"
echo "Populate Secret Manager - Project: ${PROJECT_ID}"
echo "============================================"
echo ""

# Helper: set a secret version if value is non-empty
set_secret() {
  local name="$1"
  local value="$2"
  if [ -z "$value" ]; then
    echo "  SKIP: ${name} (empty)"
    return
  fi
  echo -n "$value" | gcloud secrets versions add "$name" \
    --project="${PROJECT_ID}" \
    --data-file=- 2>/dev/null && echo "  SET:  ${name}" \
    || echo "  FAIL: ${name} (secret may not exist yet -- run setup-infrastructure.sh first)"
}

# ============================================================
# Secrets from greenreach-central/.env
# ============================================================
echo "--- Central secrets ---"
set_secret "JWT_SECRET"           "$(grep '^JWT_SECRET=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "WHOLESALE_JWT_SECRET" "$(grep '^WHOLESALE_JWT_SECRET=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "GREENREACH_API_KEY"   "$(grep '^GREENREACH_API_KEY=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "SQUARE_ACCESS_TOKEN"  "$(grep '^SQUARE_ACCESS_TOKEN=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "SQUARE_APP_ID"        "$(grep '^SQUARE_APP_ID=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "SQUARE_APP_SECRET"    "$(grep '^SQUARE_APP_SECRET=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "SQUARE_LOCATION_ID"   "$(grep '^SQUARE_LOCATION_ID=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"
set_secret "FARM_SQUARE_REDIRECT_URI" "$(grep '^FARM_SQUARE_REDIRECT_URI=' greenreach-central/.env 2>/dev/null | cut -d= -f2-)"

# ============================================================
# Secrets from root .env (LE)
# ============================================================
echo ""
echo "--- LE secrets ---"
set_secret "ADMIN_PASSWORD"       "$(grep '^ADMIN_PASSWORD=' .env 2>/dev/null | cut -d= -f2-)"

# ============================================================
# Secrets that need manual population
# ============================================================
echo ""
echo "============================================"
echo "Secrets requiring manual population:"
echo "============================================"
echo "  These are not in local .env files. Set them with:"
echo "  echo -n 'value' | gcloud secrets versions add SECRET_NAME --project=${PROJECT_ID} --data-file=-"
echo ""
echo "  Central:"
echo "    - ALLOYDB_PASSWORD (set during AlloyDB creation)"
echo "    - SESSION_SECRET"
echo "    - PAYMENT_OAUTH_STATE_SECRET"
echo "    - ADMIN_FALLBACK_PASSWORD"
echo "    - STRIPE_SECRET_KEY"
echo "    - STRIPE_WEBHOOK_SECRET"
echo "    - STRIPE_CONNECT_CLIENT_ID"
echo "    - SQUARE_WEBHOOK_SECRET"
echo "    - SQUARE_WEBHOOK_SIGNATURE_KEY"
echo "    - SMTP_PASS"
echo "    - SYNC_API_KEY"
echo "    - CENTRAL_API_KEY"
echo "    - PRODUCER_JWT_SECRET"
echo "    - WEBHOOK_SECRET"
echo "    - WHOLESALE_FARM_API_KEY"
echo "    - USDA_API_KEY"
echo "    - USDA_NASS_API_KEY"
echo "    - QUICKBOOKS_CLIENT_SECRET"
echo "    - GITHUB_BILLING_TOKEN"
echo "    - AWS_ACCESS_KEY_ID (for SES email if still using)"
echo "    - AWS_SECRET_ACCESS_KEY"
echo ""
echo "  LE:"
echo "    - SWITCHBOT_TOKEN"
echo "    - SWITCHBOT_SECRET"
echo "    - KASA_EMAIL"
echo "    - KASA_PASSWORD"
echo "    - FARM_PIN"
echo "    - CTRL_PIN"
echo "    - EDGE_API_KEY"
echo "    - IFTTT_KEY"
echo "    - IFTTT_WEBHOOK_KEY"
echo "    - IFTTT_INBOUND_TOKEN"
echo ""
echo "NOTE: OPENAI_API_KEY is still needed if TTS is used."
echo "      Set it separately if needed:"
echo "      echo -n 'sk-...' | gcloud secrets versions add OPENAI_API_KEY --project=${PROJECT_ID} --data-file=-"
