#!/bin/bash
set -euo pipefail

BASE="${BASE:-http://127.0.0.1:3100}"
FARM_ID="${FARM_ID:-FARM-TEST-WIZARD-001}"
PASS="${PASS:-Grow123}"

check_http() {
  local label="$1"
  local url="$2"
  local expected="${3:-200}"
  local method="${4:-GET}"
  local auth="${5:-}"
  local data="${6:-}"

  local body_file code
  body_file=$(mktemp)

  if [[ "$method" == "POST" ]]; then
    if [[ -n "$auth" ]]; then
      code=$(curl -sS -o "$body_file" -w "%{http_code}" -X POST "$url" -H "Content-Type: application/json" -H "Authorization: Bearer $auth" -d "$data")
    else
      code=$(curl -sS -o "$body_file" -w "%{http_code}" -X POST "$url" -H "Content-Type: application/json" -d "$data")
    fi
  else
    if [[ -n "$auth" ]]; then
      code=$(curl -sS -o "$body_file" -w "%{http_code}" "$url" -H "Authorization: Bearer $auth")
    else
      code=$(curl -sS -o "$body_file" -w "%{http_code}" "$url")
    fi
  fi

  if [[ "$code" != "$expected" ]]; then
    echo "❌ $label ($url) expected HTTP:$expected got HTTP:$code"
    head -c 400 "$body_file"; echo
    rm -f "$body_file"
    return 1
  fi

  echo "✅ $label HTTP:$code"
  rm -f "$body_file"
}

echo "BASE=$BASE"

check_http "Health" "$BASE/health" 200
check_http "Login redirect" "$BASE/login.html" 302

LOGIN_JSON=$(curl -sS -X POST "$BASE/api/farm/auth/login" -H "Content-Type: application/json" -d "{\"farmId\":\"$FARM_ID\",\"password\":\"$PASS\"}")
TOKEN=$(node -e "const x=JSON.parse(process.argv[1]); process.stdout.write(x.token||'')" "$LOGIN_JSON")

if [[ -z "$TOKEN" ]]; then
  echo "❌ Login token missing"
  echo "$LOGIN_JSON" | head -c 400; echo
  exit 1
fi

echo "✅ Login token acquired (${TOKEN:0:20}...)"

check_http "Farm profile" "$BASE/api/farm/profile" 200 GET "$TOKEN"
check_http "Inventory current" "$BASE/api/inventory/current" 200
check_http "Legacy env" "$BASE/env?hours=1" 200
check_http "Legacy plans" "$BASE/plans" 200
check_http "Plans static" "$BASE/data/plans.json" 200
check_http "AI status" "$BASE/api/ai/status" 200
check_http "Farm-sales inventory" "$BASE/api/farm-sales/inventory" 200
check_http "Devices list" "$BASE/devices" 200

echo "✅ Farm contract smoke test passed"
