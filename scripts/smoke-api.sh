#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TOTAL=0
FAILED=0

json_get() {
  local file="$1"
  local expr="$2"
  python3 - "$file" "$expr" <<'PY'
import json, sys
path = sys.argv[2].split('.')
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    data = json.load(f)
cur = data
for p in path:
    if p.endswith(']'):
        k, idx = p[:-1].split('[')
        if k:
            cur = cur[k]
        cur = cur[int(idx)]
    else:
        cur = cur[p]
if isinstance(cur, (dict, list)):
    import json as _j
    print(_j.dumps(cur))
else:
    print(cur)
PY
}

call_api() {
  local method="$1"
  local path="$2"
  local token="$3"
  local body="${4:-}"
  local max_time="${5:-15}"

  local tmp
  tmp=$(mktemp)

  local code="000"
  for _ in {1..5}; do
    if [[ -n "$body" && -n "$token" ]]; then
      code=$(curl -sS -m "$max_time" -o "$tmp" -w "%{http_code}" -X "$method" "${BASE_URL}${path}" -H "Authorization: Bearer $token" -H "Content-Type: application/json" -d "$body" || true)
    elif [[ -n "$body" ]]; then
      code=$(curl -sS -m "$max_time" -o "$tmp" -w "%{http_code}" -X "$method" "${BASE_URL}${path}" -H "Content-Type: application/json" -d "$body" || true)
    elif [[ -n "$token" ]]; then
      code=$(curl -sS -m "$max_time" -o "$tmp" -w "%{http_code}" -X "$method" "${BASE_URL}${path}" -H "Authorization: Bearer $token" || true)
    else
      code=$(curl -sS -m "$max_time" -o "$tmp" -w "%{http_code}" -X "$method" "${BASE_URL}${path}" || true)
    fi

    if [[ "$code" != "429" ]]; then
      break
    fi
    sleep 2
  done

  LAST_CODE="$code"
  LAST_BODY_FILE="$tmp"
}

assert_code() {
  local name="$1"
  local allowed_csv="$2"
  TOTAL=$((TOTAL + 1))

  local ok=0
  IFS=',' read -ra allowed <<< "$allowed_csv"
  for code in "${allowed[@]}"; do
    if [[ "$LAST_CODE" == "$code" ]]; then
      ok=1
      break
    fi
  done

  if [[ "$ok" -eq 1 ]]; then
    echo "PASS [$LAST_CODE] $name"
  else
    FAILED=$((FAILED + 1))
    echo "FAIL [$LAST_CODE] $name (expected: $allowed_csv)"
    cat "$LAST_BODY_FILE" || true
  fi

}

ADMIN_TOKEN=""
ADMIN_USER_ID=""
DRIVER_TOKEN=""
DRIVER_USER_ID=""
DRIVER_ID=""
WAVE_ID=""
ROUTE_ID=""
STOP_ID=""
SHIPMENT_ID=""
OFFER_ID=""
DOC_ID=""
CHECK_ID=""
NOTIF_ID=""
MEMBER_ID=""
PAY_STATEMENT_ID=""
PAYOUT_BATCH_ID=""

SEED_CUSTOMER_ID="10000000-0000-4000-a000-000000000001"
SEED_LOCATION_ID="20000000-0000-4000-a000-000000000001"
SEED_PRODUCT_ID="30000000-0000-4000-a000-000000000001"
SEED_DRIVER_ID="40000000-0000-4000-a000-000000000001"
SEED_ORDER_1="60000000-0000-4000-a000-000000000001"
SEED_ORDER_2="60000000-0000-4000-a000-000000000002"
SEED_MEMBER_ID="83000000-0000-4000-a000-000000000001"
FAKE_UUID="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
YEAR="2026"

TS="$(date +%s)"
ADMIN_EMAIL="smoke-admin-${TS}@lef.dev"
DRIVER_EMAIL="smoke-driver-${TS}@lef.dev"
INVITE_EMAIL="smoke-member-${TS}@lef.dev"
PASS="Test1234!"

for _ in {1..30}; do
  if curl -sSf "${BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

call_api "GET" "/health" ""
assert_code "GET /health" "200"

call_api "POST" "/api/v1/auth/register" "" "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${PASS}\",\"role\":\"admin\",\"first_name\":\"Smoke\",\"last_name\":\"Admin\"}"
assert_code "POST /api/v1/auth/register" "201"
ADMIN_TOKEN="$(json_get "$LAST_BODY_FILE" "data.token")"
ADMIN_USER_ID="$(json_get "$LAST_BODY_FILE" "data.user.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/auth/login" "" "{\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${PASS}\"}"
assert_code "POST /api/v1/auth/login" "200"
rm -f "$LAST_BODY_FILE"

call_api "GET" "/api/v1/auth/me" "$ADMIN_TOKEN"
assert_code "GET /api/v1/auth/me" "200"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/auth/register" "" "{\"email\":\"${DRIVER_EMAIL}\",\"password\":\"${PASS}\",\"role\":\"driver\",\"first_name\":\"Smoke\",\"last_name\":\"Driver\"}"
assert_code "POST /api/v1/auth/register (driver)" "201"
DRIVER_USER_ID="$(json_get "$LAST_BODY_FILE" "data.user.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/auth/login" "" "{\"email\":\"${DRIVER_EMAIL}\",\"password\":\"${PASS}\"}"
assert_code "POST /api/v1/auth/login (driver)" "200"
DRIVER_TOKEN="$(json_get "$LAST_BODY_FILE" "data.token")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/drivers/" "$ADMIN_TOKEN" "{\"user_id\":\"${DRIVER_USER_ID}\",\"vehicle_type\":\"van\",\"capacity_weight_kg\":800,\"capacity_volume_l\":500,\"capacity_totes\":30}"
assert_code "POST /api/v1/drivers/ (setup)" "201"
DRIVER_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/orders/" "$ADMIN_TOKEN" "{\"customer_id\":\"${SEED_CUSTOMER_ID}\",\"location_id\":\"${SEED_LOCATION_ID}\",\"requested_date\":\"2025-01-15\",\"window_open\":\"2025-01-15T08:00:00Z\",\"window_close\":\"2025-01-15T12:00:00Z\",\"lines\":[{\"product_id\":\"${SEED_PRODUCT_ID}\",\"qty\":1}]}"
assert_code "POST /api/v1/orders/ (setup route fixture)" "201"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/dispatch/waves" "$ADMIN_TOKEN" "{\"wave_date\":\"2025-01-15\",\"wave_label\":\"Smoke Wave ${TS}\",\"cutoff_at\":\"2025-01-15T05:00:00Z\"}"
assert_code "POST /api/v1/dispatch/waves (setup)" "201"
WAVE_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/routing/optimize" "$ADMIN_TOKEN" "{\"wave_id\":\"${WAVE_ID}\",\"depot_lat\":36.6777,\"depot_lng\":-121.6555}"
assert_code "POST /api/v1/routing/optimize (setup)" "201"
ROUTE_ID="$(python3 - "$LAST_BODY_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d=json.load(f)
arr=d.get('data',[])
print(arr[0]['id'] if arr else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
PY
)"
rm -f "$LAST_BODY_FILE"

STOP_ID="$FAKE_UUID"
if [[ "$ROUTE_ID" != "$FAKE_UUID" ]]; then
  call_api "GET" "/api/v1/routing/routes/${ROUTE_ID}" "$ADMIN_TOKEN"
  assert_code "GET /api/v1/routing/routes/:id (setup)" "200"
  STOP_ID="$(python3 - "$LAST_BODY_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d=json.load(f)
stops = d.get('data', {}).get('stops', [])
print(stops[0]['id'] if stops else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
PY
)"
  rm -f "$LAST_BODY_FILE"
fi

call_api "POST" "/api/v1/shipments/" "$ADMIN_TOKEN" "{\"order_ids\":[\"${SEED_ORDER_1}\",\"${SEED_ORDER_2}\"],\"driver_id\":\"${DRIVER_ID}\"}"
assert_code "POST /api/v1/shipments/ (setup)" "201"
SHIPMENT_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/dispatch/offers" "$ADMIN_TOKEN" "{\"route_id\":\"${ROUTE_ID}\",\"driver_ids\":[\"${DRIVER_ID}\"],\"expires_in_min\":15}"
assert_code "POST /api/v1/dispatch/offers (setup)" "201,400,404"
if [[ "$LAST_CODE" == "201" ]]; then
  OFFER_ID="$(python3 - "$LAST_BODY_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d=json.load(f)
arr=d.get('data',[])
print(arr[0]['id'] if arr else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
PY
)"
else
  OFFER_ID="$FAKE_UUID"
fi
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/documents" "$ADMIN_TOKEN" "{\"doc_type\":\"licence\",\"file_url\":\"https://example.com/licence.pdf\",\"file_name\":\"licence.pdf\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/documents (setup)" "201"
DOC_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/background-check" "$ADMIN_TOKEN" "{\"provider\":\"internal\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/background-check (setup)" "201"
CHECK_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/members/customers/${SEED_CUSTOMER_ID}/members" "$ADMIN_TOKEN" "{\"email\":\"${INVITE_EMAIL}\",\"role\":\"viewer\",\"first_name\":\"Invited\",\"last_name\":\"User\"}"
assert_code "POST /api/v1/members/customers/:customerId/members (setup)" "201"
MEMBER_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/notifications/" "$ADMIN_TOKEN" "{\"user_id\":\"${ADMIN_USER_ID}\",\"channel\":\"push\",\"title\":\"Smoke\",\"body\":\"Smoke notification\"}"
assert_code "POST /api/v1/notifications/ (setup)" "204"

call_api "GET" "/api/v1/notifications/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/notifications/ (setup)" "200"
NOTIF_ID="$(python3 - "$LAST_BODY_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d=json.load(f)
arr=d.get('data',[])
print(arr[0]['id'] if arr else 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
PY
)"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/settlement/fee-quotes" "$ADMIN_TOKEN" "{\"route_id\":\"${ROUTE_ID}\",\"driver_id\":\"${DRIVER_ID}\",\"estimated_km\":2.89,\"estimated_min\":179,\"estimated_stops\":2,\"estimated_wait_min\":10}"
assert_code "POST /api/v1/settlement/fee-quotes (setup)" "201,400,404"
rm -f "$LAST_BODY_FILE"

call_api "POST" "/api/v1/settlement/pay-statements" "$ADMIN_TOKEN" "{\"driver_id\":\"${DRIVER_ID}\",\"period_start\":\"2025-01-01\",\"period_end\":\"2025-01-31\"}"
assert_code "POST /api/v1/settlement/pay-statements (setup)" "201,400"
if [[ "$LAST_CODE" == "201" ]]; then
  PAY_STATEMENT_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
else
  PAY_STATEMENT_ID="$FAKE_UUID"
fi
rm -f "$LAST_BODY_FILE"

if [[ "$PAY_STATEMENT_ID" != "$FAKE_UUID" ]]; then
  call_api "POST" "/api/v1/payouts/batches" "$ADMIN_TOKEN" "{\"pay_date\":\"2025-02-01\",\"statement_ids\":[\"${PAY_STATEMENT_ID}\"]}"
else
  call_api "POST" "/api/v1/payouts/batches" "$ADMIN_TOKEN" "{\"pay_date\":\"2025-02-01\",\"statement_ids\":[\"${FAKE_UUID}\"]}"
fi
assert_code "POST /api/v1/payouts/batches (setup)" "201,400"
if [[ "$LAST_CODE" == "201" ]]; then
  PAYOUT_BATCH_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
else
  PAYOUT_BATCH_ID="$FAKE_UUID"
fi
rm -f "$LAST_BODY_FILE"

call_api "GET" "/api/v1/customers/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/customers/" "200"
call_api "POST" "/api/v1/customers/" "$ADMIN_TOKEN" "{\"name\":\"Smoke Customer ${TS}\",\"billing_email\":\"billing-${TS}@example.com\",\"payment_terms_days\":14}"
assert_code "POST /api/v1/customers/" "201"
call_api "GET" "/api/v1/customers/${SEED_CUSTOMER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/customers/:id" "200"
call_api "PATCH" "/api/v1/customers/${SEED_CUSTOMER_ID}" "$ADMIN_TOKEN" "{\"notes\":\"smoke-update\"}"
assert_code "PATCH /api/v1/customers/:id" "200"
call_api "GET" "/api/v1/customers/${SEED_CUSTOMER_ID}/locations" "$ADMIN_TOKEN"
assert_code "GET /api/v1/customers/:id/locations" "200"
call_api "POST" "/api/v1/customers/${SEED_CUSTOMER_ID}/locations" "$ADMIN_TOKEN" "{\"label\":\"Smoke Dock ${TS}\",\"address_line1\":\"1 Smoke Way\",\"city\":\"Salinas\",\"state\":\"CA\",\"postal_code\":\"93901\",\"lat\":36.67,\"lng\":-121.65,\"receiving_open\":\"06:00\",\"receiving_close\":\"14:00\"}"
assert_code "POST /api/v1/customers/:id/locations" "201"
NEW_LOCATION_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"
call_api "PATCH" "/api/v1/customers/${SEED_CUSTOMER_ID}/locations/${NEW_LOCATION_ID}" "$ADMIN_TOKEN" "{\"label\":\"Smoke Dock Updated ${TS}\"}"
assert_code "PATCH /api/v1/customers/:id/locations/:locationId" "200"
call_api "GET" "/api/v1/customers/${SEED_CUSTOMER_ID}/catalog" "$ADMIN_TOKEN"
assert_code "GET /api/v1/customers/:id/catalog" "200"

call_api "GET" "/api/v1/members/my-organizations" "$ADMIN_TOKEN"
assert_code "GET /api/v1/members/my-organizations" "200"
call_api "GET" "/api/v1/members/customers/${SEED_CUSTOMER_ID}/members" "$ADMIN_TOKEN"
assert_code "GET /api/v1/members/customers/:customerId/members" "200"
call_api "POST" "/api/v1/members/customers/${SEED_CUSTOMER_ID}/members" "$ADMIN_TOKEN" "{\"email\":\"second-${TS}@example.com\",\"role\":\"receiver\"}"
assert_code "POST /api/v1/members/customers/:customerId/members" "201"
call_api "GET" "/api/v1/members/members/${MEMBER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/members/members/:memberId" "200"
call_api "PATCH" "/api/v1/members/members/${MEMBER_ID}/accept" "$ADMIN_TOKEN" "{}"
assert_code "PATCH /api/v1/members/members/:memberId/accept" "200,404"
call_api "PATCH" "/api/v1/members/members/${MEMBER_ID}/role" "$ADMIN_TOKEN" "{\"role\":\"receiver\"}"
assert_code "PATCH /api/v1/members/members/:memberId/role" "200"
call_api "DELETE" "/api/v1/members/members/${MEMBER_ID}" "$ADMIN_TOKEN"
assert_code "DELETE /api/v1/members/members/:memberId" "200"

call_api "GET" "/api/v1/orders/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/orders/" "200"
call_api "GET" "/api/v1/orders/${SEED_ORDER_1}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/orders/:id" "200"
call_api "POST" "/api/v1/orders/" "$ADMIN_TOKEN" "{\"customer_id\":\"${SEED_CUSTOMER_ID}\",\"location_id\":\"${SEED_LOCATION_ID}\",\"requested_date\":\"2025-01-20\",\"window_open\":\"2025-01-20T08:00:00Z\",\"window_close\":\"2025-01-20T12:00:00Z\",\"lines\":[{\"product_id\":\"${SEED_PRODUCT_ID}\",\"qty\":1}]}"
assert_code "POST /api/v1/orders/" "201"
NEW_ORDER_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
rm -f "$LAST_BODY_FILE"
call_api "PATCH" "/api/v1/orders/${NEW_ORDER_ID}/status" "$ADMIN_TOKEN" "{\"status\":\"confirmed\"}"
assert_code "PATCH /api/v1/orders/:id/status" "200"
call_api "POST" "/api/v1/orders/${NEW_ORDER_ID}/cancel" "$ADMIN_TOKEN"
assert_code "POST /api/v1/orders/:id/cancel" "200"

call_api "GET" "/api/v1/drivers/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/drivers/" "200"
call_api "GET" "/api/v1/drivers/${DRIVER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/drivers/:id" "200"
call_api "PATCH" "/api/v1/drivers/${DRIVER_ID}" "$ADMIN_TOKEN" "{\"capacity_totes\":40}"
assert_code "PATCH /api/v1/drivers/:id" "200"
call_api "PATCH" "/api/v1/drivers/${DRIVER_ID}/availability" "$ADMIN_TOKEN" "{\"is_available\":true}"
assert_code "PATCH /api/v1/drivers/:id/availability" "200"

call_api "POST" "/api/v1/driver-onboarding/apply" "" "{\"email\":\"apply-${TS}@example.com\",\"phone\":\"+15559990000\",\"first_name\":\"Apply\",\"last_name\":\"Driver\",\"preferred_zone\":\"North\",\"vehicle_type\":\"van\",\"contractor_acknowledged\":true}"
assert_code "POST /api/v1/driver-onboarding/apply" "201"
call_api "GET" "/api/v1/driver-onboarding/${DRIVER_ID}/status" "$ADMIN_TOKEN"
assert_code "GET /api/v1/driver-onboarding/:driverId/status" "200"
call_api "GET" "/api/v1/driver-onboarding/${DRIVER_ID}/documents" "$ADMIN_TOKEN"
assert_code "GET /api/v1/driver-onboarding/:driverId/documents" "200"
call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/documents" "$ADMIN_TOKEN" "{\"doc_type\":\"insurance\",\"file_url\":\"https://example.com/insurance.pdf\",\"file_name\":\"insurance.pdf\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/documents" "201"
call_api "PATCH" "/api/v1/driver-onboarding/documents/${DOC_ID}/review" "$ADMIN_TOKEN" "{\"status\":\"accepted\"}"
assert_code "PATCH /api/v1/driver-onboarding/documents/:docId/review" "200"
call_api "GET" "/api/v1/driver-onboarding/${DRIVER_ID}/background-check" "$ADMIN_TOKEN"
assert_code "GET /api/v1/driver-onboarding/:driverId/background-check" "200"
call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/background-check" "$ADMIN_TOKEN" "{\"provider\":\"certn\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/background-check" "201"
call_api "PATCH" "/api/v1/driver-onboarding/background-check/${CHECK_ID}" "$ADMIN_TOKEN" "{\"status\":\"passed\"}"
assert_code "PATCH /api/v1/driver-onboarding/background-check/:checkId" "200,400"
call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/banking" "$ADMIN_TOKEN" "{\"stripe_account_id\":\"acct_smoke123\",\"bank_last4\":\"1234\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/banking" "200,201"
call_api "PATCH" "/api/v1/driver-onboarding/${DRIVER_ID}/banking/verify" "$ADMIN_TOKEN" "{}"
assert_code "PATCH /api/v1/driver-onboarding/:driverId/banking/verify" "200,400"
call_api "GET" "/api/v1/driver-onboarding/${DRIVER_ID}/agreements" "$ADMIN_TOKEN"
assert_code "GET /api/v1/driver-onboarding/:driverId/agreements" "200"
call_api "POST" "/api/v1/driver-onboarding/${DRIVER_ID}/agreements" "$ADMIN_TOKEN" "{\"agreement_type\":\"contractor_v1\",\"version\":\"v1.0\"}"
assert_code "POST /api/v1/driver-onboarding/:driverId/agreements" "201"
call_api "PATCH" "/api/v1/driver-onboarding/${DRIVER_ID}/force-status" "$ADMIN_TOKEN" "{\"status\":\"active\"}"
assert_code "PATCH /api/v1/driver-onboarding/:driverId/force-status" "200"

call_api "GET" "/api/v1/dispatch/waves" "$ADMIN_TOKEN"
assert_code "GET /api/v1/dispatch/waves" "200"
call_api "GET" "/api/v1/dispatch/waves/plan?date=2025-01-15" "$ADMIN_TOKEN"
assert_code "GET /api/v1/dispatch/waves/plan" "200"
call_api "GET" "/api/v1/dispatch/waves/${WAVE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/dispatch/waves/:id" "200"
call_api "POST" "/api/v1/dispatch/waves" "$ADMIN_TOKEN" "{\"wave_date\":\"2025-01-16\",\"wave_label\":\"Smoke Wave 2 ${TS}\",\"cutoff_at\":\"2025-01-16T05:00:00Z\"}"
assert_code "POST /api/v1/dispatch/waves" "201"
call_api "PATCH" "/api/v1/dispatch/waves/${WAVE_ID}/status" "$ADMIN_TOKEN" "{\"status\":\"planning\"}"
assert_code "PATCH /api/v1/dispatch/waves/:id/status" "200"
call_api "POST" "/api/v1/dispatch/offers" "$ADMIN_TOKEN" "{\"route_id\":\"${ROUTE_ID}\",\"driver_ids\":[\"${DRIVER_ID}\"],\"expires_in_min\":15}"
assert_code "POST /api/v1/dispatch/offers" "201,400,404"
call_api "GET" "/api/v1/dispatch/offers/mine" "$DRIVER_TOKEN"
assert_code "GET /api/v1/dispatch/offers/mine" "200"
call_api "PATCH" "/api/v1/dispatch/offers/${OFFER_ID}" "$DRIVER_TOKEN" "{\"status\":\"accepted\"}"
assert_code "PATCH /api/v1/dispatch/offers/:offerId" "200,400,404"

call_api "GET" "/api/v1/routing/routes" "$ADMIN_TOKEN"
assert_code "GET /api/v1/routing/routes" "200"
call_api "GET" "/api/v1/routing/routes/${ROUTE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/routing/routes/:id" "200,404"
call_api "POST" "/api/v1/routing/optimize" "$ADMIN_TOKEN" "{\"wave_id\":\"${WAVE_ID}\",\"depot_lat\":36.6777,\"depot_lng\":-121.6555}"
assert_code "POST /api/v1/routing/optimize" "201"
call_api "PATCH" "/api/v1/routing/routes/${ROUTE_ID}/status" "$ADMIN_TOKEN" "{\"status\":\"published\"}"
assert_code "PATCH /api/v1/routing/routes/:id/status" "200,404"

call_api "POST" "/api/v1/pricing/quote-route" "$ADMIN_TOKEN" "{\"route_id\":\"${ROUTE_ID}\"}"
assert_code "POST /api/v1/pricing/quote-route" "200,404"
call_api "POST" "/api/v1/pricing/simple-fee" "$ADMIN_TOKEN" "{\"km_from_farm\":25,\"tote_count\":5,\"window_tightness_hours\":4}"
assert_code "POST /api/v1/pricing/simple-fee" "200"

call_api "POST" "/api/v1/pod/" "$DRIVER_TOKEN" "{\"route_stop_id\":\"${STOP_ID}\",\"recipient_name\":\"Receiver\",\"photo_urls\":[] }"
assert_code "POST /api/v1/pod/" "201,404,409"
call_api "GET" "/api/v1/pod/stop/${STOP_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/pod/stop/:stopId" "200,404"
call_api "GET" "/api/v1/pod/route/${ROUTE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/pod/route/:routeId" "200,404"

call_api "POST" "/api/v1/billing/invoices" "$ADMIN_TOKEN" "{\"customer_id\":\"${SEED_CUSTOMER_ID}\",\"order_ids\":[\"${SEED_ORDER_1}\"]}"
assert_code "POST /api/v1/billing/invoices" "201,400"
if [[ "$LAST_CODE" == "201" ]]; then
  INVOICE_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
else
  INVOICE_ID="$FAKE_UUID"
fi
rm -f "$LAST_BODY_FILE"
call_api "GET" "/api/v1/billing/invoices" "$ADMIN_TOKEN"
assert_code "GET /api/v1/billing/invoices" "200"
call_api "GET" "/api/v1/billing/invoices/${INVOICE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/billing/invoices/:id" "200,404"
call_api "POST" "/api/v1/billing/invoices/${INVOICE_ID}/paid" "$ADMIN_TOKEN"
assert_code "POST /api/v1/billing/invoices/:id/paid" "200,404"
call_api "POST" "/api/v1/billing/payouts" "$ADMIN_TOKEN" "{\"driver_id\":\"${DRIVER_ID}\",\"period_start\":\"2025-01-01\",\"period_end\":\"2025-01-31\"}"
assert_code "POST /api/v1/billing/payouts" "201,400"
if [[ "$LAST_CODE" == "201" ]]; then
  DRIVER_PAYOUT_ID="$(json_get "$LAST_BODY_FILE" "data.id")"
else
  DRIVER_PAYOUT_ID="$FAKE_UUID"
fi
rm -f "$LAST_BODY_FILE"
call_api "GET" "/api/v1/billing/payouts" "$ADMIN_TOKEN"
assert_code "GET /api/v1/billing/payouts" "200"
call_api "POST" "/api/v1/billing/payouts/${DRIVER_PAYOUT_ID}/paid" "$ADMIN_TOKEN"
assert_code "POST /api/v1/billing/payouts/:id/paid" "200,404"

call_api "POST" "/api/v1/telemetry/ping" "$DRIVER_TOKEN" "{\"lat\":36.68,\"lng\":-121.66,\"speed_kmh\":40}"
assert_code "POST /api/v1/telemetry/ping" "204"
call_api "POST" "/api/v1/telemetry/ping/batch" "$DRIVER_TOKEN" "{\"pings\":[{\"lat\":36.681,\"lng\":-121.661}]}"
assert_code "POST /api/v1/telemetry/ping/batch" "204"
call_api "GET" "/api/v1/telemetry/position/${DRIVER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/telemetry/position/:driverId" "200"
call_api "GET" "/api/v1/telemetry/track/${ROUTE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/telemetry/track/:routeId" "200"
call_api "GET" "/api/v1/telemetry/eta?driver_id=${DRIVER_ID}&dest_lat=36.69&dest_lng=-121.67" "$ADMIN_TOKEN"
assert_code "GET /api/v1/telemetry/eta" "200"
call_api "GET" "/api/v1/telemetry/adherence/${ROUTE_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/telemetry/adherence/:routeId" "200"

call_api "POST" "/api/v1/notifications/" "$ADMIN_TOKEN" "{\"user_id\":\"${ADMIN_USER_ID}\",\"channel\":\"email\",\"title\":\"Smoke 2\",\"body\":\"Second notification\"}"
assert_code "POST /api/v1/notifications/" "204"
call_api "GET" "/api/v1/notifications/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/notifications/" "200"
call_api "PATCH" "/api/v1/notifications/${NOTIF_ID}/read" "$ADMIN_TOKEN"
assert_code "PATCH /api/v1/notifications/:id/read" "204,404"
call_api "POST" "/api/v1/notifications/read-all" "$ADMIN_TOKEN"
assert_code "POST /api/v1/notifications/read-all" "204"

call_api "GET" "/api/v1/shipments/" "$ADMIN_TOKEN"
assert_code "GET /api/v1/shipments/" "200"
call_api "GET" "/api/v1/shipments/${SHIPMENT_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/shipments/:id" "200"
call_api "POST" "/api/v1/shipments/" "$ADMIN_TOKEN" "{\"order_ids\":[\"${SEED_ORDER_1}\"]}"
assert_code "POST /api/v1/shipments/" "201"
call_api "PATCH" "/api/v1/shipments/${SHIPMENT_ID}/status" "$ADMIN_TOKEN" "{\"status\":\"in_transit\",\"lat\":36.68,\"lng\":-121.66}"
assert_code "PATCH /api/v1/shipments/:id/status" "200"
call_api "GET" "/api/v1/shipments/${SHIPMENT_ID}/events" "$ADMIN_TOKEN"
assert_code "GET /api/v1/shipments/:id/events" "200"
call_api "POST" "/api/v1/shipments/events" "$ADMIN_TOKEN" "{\"event_type\":\"shipment.arriving\",\"shipment_id\":\"${SHIPMENT_ID}\",\"driver_id\":\"${DRIVER_ID}\"}"
assert_code "POST /api/v1/shipments/events" "201"

call_api "GET" "/api/v1/tracking/stream" "$ADMIN_TOKEN" "" "2"
assert_code "GET /api/v1/tracking/stream" "200"
call_api "GET" "/api/v1/tracking/shipments/${SHIPMENT_ID}/timeline" "$ADMIN_TOKEN"
assert_code "GET /api/v1/tracking/shipments/:shipmentId/timeline" "200"
call_api "GET" "/api/v1/tracking/drivers/${DRIVER_ID}/location" "$ADMIN_TOKEN"
assert_code "GET /api/v1/tracking/drivers/:driverId/location" "200,404"
call_api "GET" "/api/v1/tracking/drivers/${DRIVER_ID}/routes" "$ADMIN_TOKEN"
assert_code "GET /api/v1/tracking/drivers/:driverId/routes" "200"
call_api "GET" "/api/v1/tracking/routes/${ROUTE_ID}/eta" "$ADMIN_TOKEN"
assert_code "GET /api/v1/tracking/routes/:routeId/eta" "200,404"
call_api "GET" "/api/v1/tracking/drivers/${DRIVER_ID}/geofence/${STOP_ID}?radius=100" "$ADMIN_TOKEN"
assert_code "GET /api/v1/tracking/drivers/:driverId/geofence/:stopId" "200,404"

call_api "POST" "/api/v1/settlement/fee-quotes" "$ADMIN_TOKEN" "{\"route_id\":\"${ROUTE_ID}\",\"driver_id\":\"${DRIVER_ID}\",\"estimated_km\":2.5,\"estimated_min\":120,\"estimated_stops\":2,\"estimated_wait_min\":5}"
assert_code "POST /api/v1/settlement/fee-quotes" "201,400,404"
call_api "GET" "/api/v1/settlement/fee-quotes/${ROUTE_ID}/${DRIVER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/settlement/fee-quotes/:routeId/:driverId" "200,404"
call_api "POST" "/api/v1/settlement/pay-statements" "$ADMIN_TOKEN" "{\"driver_id\":\"${DRIVER_ID}\",\"period_start\":\"2025-01-01\",\"period_end\":\"2025-01-31\"}"
assert_code "POST /api/v1/settlement/pay-statements" "201,400"
call_api "GET" "/api/v1/settlement/pay-statements/${PAY_STATEMENT_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/settlement/pay-statements/:id" "200,404"
call_api "GET" "/api/v1/settlement/drivers/${DRIVER_ID}/pay-statements" "$ADMIN_TOKEN"
assert_code "GET /api/v1/settlement/drivers/:driverId/pay-statements" "200"
call_api "PATCH" "/api/v1/settlement/pay-statements/${PAY_STATEMENT_ID}/finalize" "$ADMIN_TOKEN"
assert_code "PATCH /api/v1/settlement/pay-statements/:id/finalize" "200,400,404"
call_api "PATCH" "/api/v1/settlement/holds/${FAKE_UUID}/resolve" "$ADMIN_TOKEN" "{\"outcome\":\"release\"}"
assert_code "PATCH /api/v1/settlement/holds/:lineId/resolve" "200,404"

call_api "GET" "/api/v1/payouts/batches" "$ADMIN_TOKEN"
assert_code "GET /api/v1/payouts/batches" "200"
call_api "GET" "/api/v1/payouts/batches/${PAYOUT_BATCH_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/payouts/batches/:id" "200,404"
call_api "POST" "/api/v1/payouts/batches" "$ADMIN_TOKEN" "{\"pay_date\":\"2025-02-01\",\"statement_ids\":[\"${FAKE_UUID}\"]}"
assert_code "POST /api/v1/payouts/batches" "201,400"
call_api "PATCH" "/api/v1/payouts/batches/${PAYOUT_BATCH_ID}/approve" "$ADMIN_TOKEN" "{\"notes\":\"approve-smoke\"}"
assert_code "PATCH /api/v1/payouts/batches/:id/approve" "200,400,404"
call_api "POST" "/api/v1/payouts/batches/${PAYOUT_BATCH_ID}/process" "$ADMIN_TOKEN"
assert_code "POST /api/v1/payouts/batches/:id/process" "200,404"
call_api "GET" "/api/v1/payouts/drivers/${DRIVER_ID}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/payouts/drivers/:driverId" "200"
call_api "GET" "/api/v1/payouts/cra/t4a/${YEAR}" "$ADMIN_TOKEN"
assert_code "GET /api/v1/payouts/cra/t4a/:year" "200"

echo ""
echo "Checks run: $TOTAL"
echo "Checks failed: $FAILED"

if [[ "$FAILED" -gt 0 ]]; then
  exit 1
fi
