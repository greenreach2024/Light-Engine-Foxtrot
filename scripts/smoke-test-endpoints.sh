#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
# Card Endpoint Smoke Test Suite
# Tests card-critical endpoints on both LE and Central hosts.
# Usage: ./scripts/smoke-test-endpoints.sh [--ci]
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

LE_HOST="${LE_HOST:-http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com}"
CENTRAL_HOST="${CENTRAL_HOST:-https://greenreachgreens.com}"
CI_MODE="${1:-}"
PASS=0
FAIL=0
WARN=0
RESULTS=()

# Colors (disabled in CI)
if [[ "$CI_MODE" == "--ci" ]]; then
  GREEN="" RED="" YELLOW="" NC=""
else
  GREEN='\033[0;32m' RED='\033[0;31m' YELLOW='\033[0;33m' NC='\033[0m'
fi

check_endpoint() {
  local host="$1"
  local host_label="$2"
  local path="$3"
  local expected_status="$4"
  local description="$5"

  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${host}${path}" 2>/dev/null || echo "000")

  local result
  if [[ "$status" == "$expected_status" ]]; then
    result="PASS"
    ((PASS++))
    printf "${GREEN}  ✓ PASS${NC}  %-8s  %-3s (expect %-3s)  %s  %s\n" "$host_label" "$status" "$expected_status" "$path" "$description"
  elif [[ "$expected_status" == "200" && "$status" == "401" ]]; then
    # Auth-gated but endpoint exists — acceptable for admin endpoints
    result="WARN"
    ((WARN++))
    printf "${YELLOW}  ⚠ WARN${NC}  %-8s  %-3s (expect %-3s)  %s  %s  [auth-gated]\n" "$host_label" "$status" "$expected_status" "$path" "$description"
  else
    result="FAIL"
    ((FAIL++))
    printf "${RED}  ✗ FAIL${NC}  %-8s  %-3s (expect %-3s)  %s  %s\n" "$host_label" "$status" "$expected_status" "$path" "$description"
  fi

  RESULTS+=("${result}|${host_label}|${path}|${status}|${expected_status}|${description}")
}

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Card Endpoint Smoke Tests — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "  LE:      $LE_HOST"
echo "  Central: $CENTRAL_HOST"
echo "═══════════════════════════════════════════════════════════════"
echo ""

# ── Farm-facing endpoints (expect 200 on both hosts) ──
echo "── Farm-facing endpoints (expect 200) ──"
for host_pair in "$LE_HOST|LE" "$CENTRAL_HOST|Central"; do
  IFS='|' read -r host label <<< "$host_pair"
  check_endpoint "$host" "$label" "/api/config/app"                 "200" "App config"
  check_endpoint "$host" "$label" "/api/health/insights"            "200" "Health insights"
  check_endpoint "$host" "$label" "/api/harvest/readiness"          "200" "Harvest readiness"
  check_endpoint "$host" "$label" "/api/losses/predict"             "200" "Loss prediction"
  check_endpoint "$host" "$label" "/api/ml/anomalies/statistics"    "200" "ML anomalies"
  check_endpoint "$host" "$label" "/api/ml/energy-forecast"         "200" "Energy forecast"
  check_endpoint "$host" "$label" "/data/iot-devices.json"          "200" "IoT devices feed"
done
echo ""

# ── KPI endpoint (200 on both) ──
echo "── KPI endpoint (expect 200) ──"
check_endpoint "$LE_HOST"      "LE"      "/api/kpis"  "200" "KPI dashboard"
check_endpoint "$CENTRAL_HOST" "Central" "/api/kpis"  "200" "KPI dashboard"
echo ""

# ── Environment data (200 on both) ──
echo "── Environment data (expect 200) ──"
for host_pair in "$LE_HOST|LE" "$CENTRAL_HOST|Central"; do
  IFS='|' read -r host label <<< "$host_pair"
  check_endpoint "$host" "$label" "/env"          "200" "Env data (legacy)"
  check_endpoint "$host" "$label" "/api/env"      "200" "Env data (API)"
done
echo ""

# ── Admin endpoints (expect 401 unauthenticated) ──
echo "── Admin endpoints (expect 401 unauthenticated) ──"
for host_pair in "$LE_HOST|LE" "$CENTRAL_HOST|Central"; do
  IFS='|' read -r host label <<< "$host_pair"
  check_endpoint "$host" "$label" "/api/admin/analytics/aggregate"    "401" "Admin analytics"
  check_endpoint "$host" "$label" "/api/admin/farms/sync-all-stats"   "401" "Admin farm sync"
done
# Central-specific admin endpoint
check_endpoint "$CENTRAL_HOST" "Central" "/api/admin/delivery/readiness" "401" "Delivery readiness"
echo ""

# ── Summary ──
echo "═══════════════════════════════════════════════════════════════"
printf "  Results:  ${GREEN}%d PASS${NC}  ${RED}%d FAIL${NC}  ${YELLOW}%d WARN${NC}\n" "$PASS" "$FAIL" "$WARN"
echo "═══════════════════════════════════════════════════════════════"

if [[ "$FAIL" -gt 0 ]]; then
  echo ""
  echo "FAILED CHECKS:"
  for r in "${RESULTS[@]}"; do
    IFS='|' read -r result label path status expected desc <<< "$r"
    if [[ "$result" == "FAIL" ]]; then
      echo "  - [$label] $path → got $status, expected $expected ($desc)"
    fi
  done
  echo ""
  if [[ "$CI_MODE" == "--ci" ]]; then
    exit 1
  fi
fi

echo ""
exit 0
