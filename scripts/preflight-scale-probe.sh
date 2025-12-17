#!/usr/bin/env bash
# Combined preflight checklist and controller scale probe for Light Engine Charlie.
# Usage:
#   ./preflight-scale-probe.sh [base_url]
# Environment variables:
#   API_BASE   Override default base URL (http://127.0.0.1:8091).
#   DEVICE_ID  Device ID to probe (default: 2).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${REPO_ROOT}/config/channel-scale.json"

BASE_URL="${1:-${API_BASE:-http://127.0.0.1:8091}}"
DEVICE_ID="${DEVICE_ID:-2}"

PASS_ICON="✔"
FAIL_ICON="✖"
INFO_ICON="➜"

print_header() {
  echo "========================================"
  echo "$1"
  echo "========================================"
}

run_step() {
  local name="$1"
  shift
  echo "${INFO_ICON} ${name}"
  if "$@"; then
    echo "  ${PASS_ICON} ${name}" && echo
  else
    echo "  ${FAIL_ICON} ${name}" && echo
    return 1
  fi
}

curl_json() {
  local url="$1"
  curl -sS "$url"
}

check_healthz() {
  curl -fsS "$BASE_URL/healthz" >/dev/null
}

check_devicedata_count() {
  local response
  response=$(curl_json "$BASE_URL/api/devicedatas") || return 1
  printf '%s' "$response" | python3 - <<'PY'
import json
import sys

try:
    payload = json.load(sys.stdin)
except json.JSONDecodeError as exc:
    print(f"Failed to decode JSON: {exc}")
    sys.exit(1)

count = len(payload.get("data", []))
print(f"  Devices discovered: {count}")
sys.exit(0 if count > 0 else 1)
PY
}

check_options_preflight() {
  local tmp
  tmp=$(mktemp)
  local status
  status=$(curl -s -D "$tmp" -o /dev/null -w "%{http_code}" -X OPTIONS \
    "$BASE_URL/api/devicedatas" \
    -H 'Origin: http://localhost' \
    -H 'Access-Control-Request-Method: PATCH' \
    -H 'Access-Control-Request-Headers: content-type')
  echo "  HTTP status: ${status}"
  echo "  Response headers:"
  sed 's/^/    /' "$tmp"
  local allow_origin allow_headers
  allow_origin=$(grep -i 'Access-Control-Allow-Origin' "$tmp" || true)
  allow_headers=$(grep -i 'Access-Control-Allow-Headers' "$tmp" || true)
  rm -f "$tmp"
  [[ "${status}" =~ ^2 ]] && [[ -n "$allow_origin" ]] && [[ -n "$allow_headers" ]]
}

probe_scale() {
  local endpoint="$BASE_URL/api/devicedatas/device/$DEVICE_ID"
  local try_patch
  try_patch() {
    local payload="$1"
    local label="$2"
    local tmp status
    tmp=$(mktemp)
    status=$(curl -s -o "$tmp" -w "%{http_code}" -X PATCH "$endpoint" \
      -H 'Content-Type: application/json' \
      -d "${payload}")
    local body
    body=$(cat "$tmp")
    rm -f "$tmp"
    echo "  Attempt ${label}: status ${status}"
    if [[ -n "$body" ]]; then
      echo "    Body: ${body}"
    fi
    if [[ "$status" =~ ^2 ]]; then
      echo "  ✔ Controller accepted scale ${label}"
      echo "${label}"
      return 0
    fi
    return 1
  }

  echo "  Probing controller scale using device ${DEVICE_ID}"
  if result=$(try_patch '{"status":"on","value":"000000FF0000"}' '00-FF'); then
    SCALE_CHOICE="$result"
  elif result=$(try_patch '{"status":"on","value":"000000400000"}' '00-40'); then
    SCALE_CHOICE="$result"
  else
    echo "  ✖ Controller rejected both scales"
    return 1
  fi

  echo "  Selected scale: ${SCALE_CHOICE}"
  update_scale_config "$SCALE_CHOICE"
  echo "  Restoring device to OFF"
  curl -s -o /dev/null -w "%{http_code}" -X PATCH "$endpoint" \
    -H 'Content-Type: application/json' \
    -d '{"status":"off","value":null}' >/dev/null
  return 0
}

update_scale_config() {
  local scale="$1"
  local max_byte
  case "$scale" in
    '00-FF') max_byte=255 ;;
    '00-40') max_byte=64 ;;
    *) max_byte=255 ;;
  esac
  local timestamp
  timestamp="$(date -Iseconds)"
  mkdir -p "$(dirname "$CONFIG_PATH")"
  cat >"$CONFIG_PATH" <<JSON
{
  "scale": "${scale}",
  "maxByte": ${max_byte},
  "updatedAt": "${timestamp}",
  "source": "scripts/preflight-scale-probe.sh",
  "deviceId": "${DEVICE_ID}",
  "apiBase": "${BASE_URL}"
}
JSON
  echo "  Wrote scale selection to ${CONFIG_PATH}"
}

print_header "Light Engine Charlie – Preflight & Scale Probe"

overall=0

run_step "Server health" check_healthz || overall=1
run_step "Device inventory" check_devicedata_count || overall=1
run_step "CORS preflight" check_options_preflight || overall=1
run_step "Controller scale probe" probe_scale || overall=1

echo "Summary:"
if [[ $overall -eq 0 ]]; then
  echo "  ${PASS_ICON} All checks passed"
else
  echo "  ${FAIL_ICON} One or more checks failed"
fi

cat <<'NOTE'
Next steps:
  • Verify window.API_BASE in the browser console.
  • Ensure no console errors appear before using Groups.
NOTE

exit $overall
