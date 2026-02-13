#!/bin/bash
set -euo pipefail

ENV_NAME="${ENV_NAME:-greenreach-central-prod-v4}"
BASE="${BASE:-http://greenreach-central.us-east-1.elasticbeanstalk.com}"

echo "=== Pre-deploy contract smoke gate ==="
BASE="$BASE" bash "$(dirname "$0")/test-farm-contract-endpoints.sh"

echo "=== Contract gate passed; deploying to $ENV_NAME ==="
eb deploy "$ENV_NAME"

echo "=== Post-deploy contract smoke verification ==="
BASE="$BASE" bash "$(dirname "$0")/test-farm-contract-endpoints.sh"

echo "✅ Deploy completed with contract gate checks"
