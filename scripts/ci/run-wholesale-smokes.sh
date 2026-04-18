#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

FOXTROT_PORT="${FOXTROT_PORT:-18091}"
CENTRAL_PORT="${CENTRAL_PORT:-13100}"
CENTRAL_WS_PORT="${CENTRAL_WS_PORT:-13101}"

FOXTROT_BASE="http://127.0.0.1:${FOXTROT_PORT}"
CENTRAL_BASE="http://127.0.0.1:${CENTRAL_PORT}"
CHECKOUT_SKU="${CHECKOUT_SKU:-SKU-AUDIT-GENOVESE-BASIL-5LB}"
NETWORK_BOOTSTRAP_KEY="${GREENREACH_API_KEY:-ci-smoke-network-key}"

FOXTROT_PID=""
CENTRAL_PID=""
TEMP_FARM_JSON_CREATED="false"
FARM_JSON_PATH="public/data/farm.json"

log() {
  printf '[smoke] %s\n' "$1"
}

fail() {
  printf '[smoke] FAIL: %s\n' "$1" >&2
  exit 1
}

cleanup() {
  if [[ -n "$FOXTROT_PID" ]] && kill -0 "$FOXTROT_PID" >/dev/null 2>&1; then
    kill "$FOXTROT_PID" >/dev/null 2>&1 || true
    wait "$FOXTROT_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CENTRAL_PID" ]] && kill -0 "$CENTRAL_PID" >/dev/null 2>&1; then
    kill "$CENTRAL_PID" >/dev/null 2>&1 || true
    wait "$CENTRAL_PID" >/dev/null 2>&1 || true
  fi
  if [[ "$TEMP_FARM_JSON_CREATED" == "true" ]]; then
    rm -f "$FARM_JSON_PATH"
  fi
}
trap cleanup EXIT

ensure_smoke_prereqs() {
  if [[ ! -f "$FARM_JSON_PATH" ]]; then
    log "Seeding temporary farm.json for smoke startup"
    mkdir -p "$(dirname "$FARM_JSON_PATH")"
    cat > "$FARM_JSON_PATH" <<'EOF'
{
  "farmId": "CI-SMOKE-FARM",
  "name": "CI Smoke Farm"
}
EOF
    TEMP_FARM_JSON_CREATED="true"
  fi

  if [[ ! -d "greenreach-central/node_modules" ]]; then
    log "Installing Central dependencies for smoke startup"
    npm ci --prefix greenreach-central >/dev/null
  fi
}

wait_for_url() {
  local url="$1"
  local retries="${2:-50}"
  local sleep_secs="${3:-1}"
  local attempt=1

  while (( attempt <= retries )); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_secs"
    attempt=$((attempt + 1))
  done
  return 1
}

assert_json_field() {
  local json_payload="$1"
  local expression="$2"
  local failure_message="$3"

  if ! node -e "const payload = JSON.parse(process.argv[1]); const ok = (() => { return (${expression}); })(); if (!ok) process.exit(1);" "$json_payload"; then
    fail "$failure_message"
  fi
}

log "Starting Foxtrot on port ${FOXTROT_PORT}"
ensure_smoke_prereqs
PORT="$FOXTROT_PORT" node server-foxtrot.js > /tmp/foxtrot-ci-smoke.log 2>&1 &
FOXTROT_PID=$!

log "Starting Central on ports ${CENTRAL_PORT}/${CENTRAL_WS_PORT}"
(
  cd greenreach-central
  NODE_ENV=development \
  GREENREACH_API_KEY="$NETWORK_BOOTSTRAP_KEY" \
  WHOLESALE_REQUIRE_DB_FOR_CRITICAL=false \
  WHOLESALE_ALLOW_DEMO_PATHS=true \
  WHOLESALE_USE_NETWORK_ALLOCATION=false \
  PORT="$CENTRAL_PORT" \
  WS_PORT="$CENTRAL_WS_PORT" \
  node server.js > /tmp/central-ci-smoke.log 2>&1
) &
CENTRAL_PID=$!

wait_for_url "${FOXTROT_BASE}/healthz" 60 1 || fail "Foxtrot failed to start (see /tmp/foxtrot-ci-smoke.log)"
wait_for_url "${CENTRAL_BASE}/health" 60 1 || fail "Central failed to start (see /tmp/central-ci-smoke.log)"

EMAIL="ci.smoke.$(date +%s)@local.test"
PASS="test1234"

log "Smoke 1/3: buyer auth + checkout preview"
REG_CODE=$(curl -sS -o /tmp/ci-smoke-register.json -w "%{http_code}" \
  -X POST "${CENTRAL_BASE}/api/wholesale/buyers/register" \
  -H 'content-type: application/json' \
  -d "{\"businessName\":\"CI Smoke\",\"contactName\":\"CI Buyer\",\"email\":\"${EMAIL}\",\"password\":\"${PASS}\",\"buyerType\":\"restaurant\",\"location\":{\"zip\":\"12345\",\"state\":\"NY\",\"lat\":40.73,\"lng\":-73.93}}")
[[ "$REG_CODE" == "200" ]] || fail "Buyer register failed with HTTP ${REG_CODE}: $(cat /tmp/ci-smoke-register.json 2>/dev/null || true)"

REG_JSON="$(cat /tmp/ci-smoke-register.json)"
TOKEN="$(node -e "const payload = JSON.parse(process.argv[1]); const token = payload?.data?.token; if (!token) process.exit(2); process.stdout.write(token);" "$REG_JSON")"

PREVIEW_CODE=$(curl -sS -o /tmp/ci-smoke-preview.json -w "%{http_code}" \
  -X POST "${CENTRAL_BASE}/api/wholesale/checkout/preview" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"cart\":[{\"sku_id\":\"${CHECKOUT_SKU}\",\"quantity\":1}],\"recurrence\":{\"cadence\":\"one_time\"},\"sourcing\":{\"mode\":\"auto_network\"}}")
PREVIEW_JSON="$(cat /tmp/ci-smoke-preview.json)"
if [[ "$PREVIEW_CODE" == "200" ]]; then
  assert_json_field "$PREVIEW_JSON" "payload?.status === 'ok'" "Checkout preview response missing status=ok"
  assert_json_field "$PREVIEW_JSON" "Number.isFinite(Number(payload?.data?.subtotal))" "Checkout preview missing numeric subtotal"
  SUBTOTAL="$(node -e "const payload = JSON.parse(process.argv[1]); process.stdout.write(String(Number(payload?.data?.subtotal || 0)));" "$PREVIEW_JSON")"
elif [[ "$PREVIEW_CODE" == "400" ]]; then
  assert_json_field "$PREVIEW_JSON" "payload?.status === 'error' && String(payload?.message || '').includes('Unable to allocate items with current inventory')" "Checkout preview 400 did not match expected inventory-unavailable contract"
  SUBTOTAL="30"
else
  fail "Checkout preview failed with HTTP ${PREVIEW_CODE}"
fi

log "Smoke 2/3: inventory reservation"
FARM_AUTH="$(node -e "const fs = require('fs'); const map = JSON.parse(fs.readFileSync('public/data/farm-api-keys.json','utf8')); const entry = Object.entries(map).find(([,v]) => v && v.status === 'active' && v.api_key); if (!entry) process.exit(2); process.stdout.write(entry[0] + ' ' + entry[1].api_key);")"
FARM_ID="$(printf '%s' "$FARM_AUTH" | awk '{print $1}')"
API_KEY="$(printf '%s' "$FARM_AUTH" | awk '{print $2}')"
ORDER_ID="ci-smoke-$(date +%s)"

BOOTSTRAP_CODE=$(curl -sS -o /tmp/ci-smoke-bootstrap.json -w "%{http_code}" \
  -X POST "${CENTRAL_BASE}/api/wholesale/network/bootstrap" \
  -H "X-API-Key: ${NETWORK_BOOTSTRAP_KEY}" \
  -H 'content-type: application/json' \
  -d "{\"farm_id\":\"${FARM_ID}\",\"farm_name\":\"CI Smoke Farm\",\"api_url\":\"${FOXTROT_BASE}\",\"location\":{\"latitude\":40.73,\"longitude\":-73.93}}")
[[ "$BOOTSTRAP_CODE" == "200" ]] || fail "Network bootstrap failed with HTTP ${BOOTSTRAP_CODE}"

# Cleanup any stale active reservations from prior runs so reserve checks stay deterministic.
RES_CLEAN_CODE=$(curl -sS -o /tmp/ci-smoke-reservations-preclean.json -w "%{http_code}" \
  -H "X-Farm-ID: ${FARM_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  "${FOXTROT_BASE}/api/wholesale/inventory/reservations")
if [[ "$RES_CLEAN_CODE" == "200" ]]; then
  node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('/tmp/ci-smoke-reservations-preclean.json','utf8')); const ids=[...new Set((p?.reservations||[]).map((r)=>String(r?.order_id||'').trim()).filter(Boolean))]; fs.writeFileSync('/tmp/ci-smoke-active-orders.txt', ids.join('\\n'));"
  while IFS= read -r existing_order_id; do
    [[ -n "${existing_order_id}" ]] || continue
    curl -sS -o /tmp/ci-smoke-release.json -w "%{http_code}" \
      -X POST "${FOXTROT_BASE}/api/wholesale/inventory/release" \
      -H 'content-type: application/json' \
      -H "X-Farm-ID: ${FARM_ID}" \
      -H "X-API-Key: ${API_KEY}" \
      -d "{\"order_id\":\"${existing_order_id}\",\"reason\":\"ci_smoke_preclean\"}" >/dev/null || true
  done < /tmp/ci-smoke-active-orders.txt
fi

INV_CODE=$(curl -sS -o /tmp/ci-smoke-inventory.json -w "%{http_code}" "${FOXTROT_BASE}/api/wholesale/inventory")
[[ "$INV_CODE" == "200" ]] || fail "Foxtrot inventory fetch failed with HTTP ${INV_CODE}"
RESERVE_SKU="$(node -e "const payload = JSON.parse(require('fs').readFileSync('/tmp/ci-smoke-inventory.json','utf8')); const lot = (payload?.lots || []).find((item) => Number(item?.qty_available || 0) > 0); if (!lot?.sku_id) process.exit(3); process.stdout.write(String(lot.sku_id));")" || fail "No reservable SKU found in wholesale inventory after pre-clean; see /tmp/ci-smoke-inventory.json"

RESERVE_CODE=$(curl -sS -o /tmp/ci-smoke-reserve.json -w "%{http_code}" \
  -X POST "${FOXTROT_BASE}/api/wholesale/inventory/reserve" \
  -H 'content-type: application/json' \
  -H "X-Farm-ID: ${FARM_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  -d "{\"order_id\":\"${ORDER_ID}\",\"items\":[{\"sku_id\":\"${RESERVE_SKU}\",\"quantity\":1}]}")
[[ "$RESERVE_CODE" == "200" ]] || fail "Inventory reserve failed with HTTP ${RESERVE_CODE}"
RESERVE_JSON="$(cat /tmp/ci-smoke-reserve.json)"
assert_json_field "$RESERVE_JSON" "payload?.ok === true" "Reservation response missing ok=true"

RES_LIST_CODE=$(curl -sS -o /tmp/ci-smoke-reservations.json -w "%{http_code}" \
  -H "X-Farm-ID: ${FARM_ID}" \
  -H "X-API-Key: ${API_KEY}" \
  "${FOXTROT_BASE}/api/wholesale/inventory/reservations")
[[ "$RES_LIST_CODE" == "200" ]] || fail "Inventory reservations list failed with HTTP ${RES_LIST_CODE}"
assert_json_field "$(cat /tmp/ci-smoke-reservations.json)" "Array.isArray(payload?.reservations) && payload.reservations.length >= 1" "Reservations endpoint did not return active reservations"

log "Smoke 3/3: delivery quote"
QUOTE_DELIVERY_CODE=$(curl -sS -o /tmp/ci-smoke-quote-delivery.json -w "%{http_code}" \
  -X POST "${CENTRAL_BASE}/api/wholesale/delivery/quote" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"subtotal\":${SUBTOTAL},\"zone\":\"ZONE_A\",\"requested_window\":\"morning\",\"fulfillment_method\":\"delivery\"}")
[[ "$QUOTE_DELIVERY_CODE" == "200" ]] || fail "Delivery quote (delivery) failed with HTTP ${QUOTE_DELIVERY_CODE}"
assert_json_field "$(cat /tmp/ci-smoke-quote-delivery.json)" "payload?.status === 'ok' && typeof payload?.data?.eligible === 'boolean'" "Delivery quote response missing eligible flag"

QUOTE_PICKUP_CODE=$(curl -sS -o /tmp/ci-smoke-quote-pickup.json -w "%{http_code}" \
  -X POST "${CENTRAL_BASE}/api/wholesale/delivery/quote" \
  -H "authorization: Bearer ${TOKEN}" \
  -H 'content-type: application/json' \
  -d "{\"subtotal\":${SUBTOTAL},\"fulfillment_method\":\"pickup\"}")
[[ "$QUOTE_PICKUP_CODE" == "200" ]] || fail "Delivery quote (pickup) failed with HTTP ${QUOTE_PICKUP_CODE}"
assert_json_field "$(cat /tmp/ci-smoke-quote-pickup.json)" "payload?.status === 'ok' && payload?.data?.reason === 'pickup_selected'" "Pickup quote did not return pickup_selected reason"

log "Smoke 4/4: network catalog aggregate"
CATALOG_CODE=$(curl -sS -o /tmp/ci-smoke-catalog.json -w "%{http_code}" \
  "${CENTRAL_BASE}/api/wholesale/catalog")
[[ "$CATALOG_CODE" == "200" ]] || fail "Catalog fetch failed with HTTP ${CATALOG_CODE}"
CATALOG_JSON="$(cat /tmp/ci-smoke-catalog.json)"
assert_json_field "$CATALOG_JSON" \
  "(payload?.data?.skus?.length > 0 || payload?.items?.length > 0 || (payload?.data?.products && payload?.data?.products.length > 0) || payload?.data?.farms?.length > 0 || payload?.farms?.length > 0)" \
  "Catalog should include at least 1 SKU or reporting farm"

AGG_CODE=$(curl -sS -o /tmp/ci-smoke-aggregate.json -w "%{http_code}" \
  "${CENTRAL_BASE}/api/wholesale/network/aggregate")
if [[ "$AGG_CODE" == "200" ]]; then
  AGG_JSON="$(cat /tmp/ci-smoke-aggregate.json)"
  AGG_ERRORS="$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(String(p?.diagnostics?.error_count ?? p?.error_count ?? '?'));" "$AGG_JSON")"
  AGG_FARMS="$(node -e "const p=JSON.parse(process.argv[1]); process.stdout.write(String(p?.diagnostics?.farms_reporting ?? p?.farms_ok ?? '?'));" "$AGG_JSON")"
  log "Network aggregate: errors=${AGG_ERRORS} farms_reporting=${AGG_FARMS}"
else
  log "WARN: network aggregate returned HTTP ${AGG_CODE} (non-fatal in CI)"
fi

log "PASS: deterministic wholesale smoke suite"