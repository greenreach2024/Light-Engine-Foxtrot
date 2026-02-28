#!/usr/bin/env bash
set -euo pipefail

cd /Users/petergilbert/Light-Engine-Foxtrot
REPORT=/tmp/phase-e-matrix.txt
: > "$REPORT"

log(){ echo "$1" | tee -a "$REPORT"; }
check_code(){
  local name="$1"; local expected="$2"; local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    log "PASS $name (HTTP $actual)"
  else
    log "FAIL $name (expected $expected got $actual)"
  fi
}
check_code_any(){
  local name="$1"; local actual="$2"; shift 2
  local ok=0
  for expected in "$@"; do
    if [[ "$actual" == "$expected" ]]; then ok=1; fi
  done
  if [[ $ok -eq 1 ]]; then
    log "PASS $name (HTTP $actual)"
  else
    log "FAIL $name (got $actual, expected one of $*)"
  fi
}

log "=== Phase E Certification Matrix (Local Runtime) ==="
log "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true
lsof -ti tcp:3100 -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true
sleep 1
PORT=8091 node server-foxtrot.js > /tmp/phase-e-foxtrot.log 2>&1 &
FPID=$!
cd greenreach-central
PORT=3100 WS_PORT=3101 node server.js > /tmp/phase-e-central.log 2>&1 &
CPID=$!
cd ..
sleep 4

BASE=http://127.0.0.1:3100
FOX=http://127.0.0.1:8091

log ""
log "-- Auth boundaries --"
C1=$(curl -sS -o /tmp/c1.json -w "%{http_code}" -X POST "$BASE/api/wholesale/checkout/preview" -H 'content-type: application/json' -d '{"cart":[]}' || true)
check_code_any "Unauth preview blocked" "$C1" 401 403
C2=$(curl -sS -o /tmp/c2.json -w "%{http_code}" -X POST "$BASE/api/wholesale/checkout/execute" -H 'content-type: application/json' -d '{"cart":[]}' || true)
check_code_any "Unauth execute blocked" "$C2" 401 403
C3=$(curl -sS -o /tmp/c3.json -w "%{http_code}" -X POST "$BASE/api/wholesale/delivery/quote" -H 'content-type: application/json' -d '{"subtotal":10}' || true)
check_code_any "Unauth delivery quote blocked" "$C3" 401 403

log ""
log "-- Buyer auth + order flow --"
EMAIL="phasee.$(date +%s)@local.test"
PASSWD="test1234"
REG=$(curl -sS -X POST "$BASE/api/wholesale/buyers/register" -H 'content-type: application/json' -d "{\"businessName\":\"Phase E\",\"contactName\":\"Verifier\",\"email\":\"$EMAIL\",\"password\":\"$PASSWD\",\"buyerType\":\"restaurant\",\"location\":{\"zip\":\"12345\",\"state\":\"NY\",\"lat\":40.73,\"lng\":-73.93}}")
TOKEN=$(node -p "const o=JSON.parse(process.argv[1]); o?.data?.token || ''" "$REG")
if [[ -n "$TOKEN" ]]; then log "PASS Buyer register/login token issued"; else log "FAIL Buyer register/login token missing"; fi
SKU=$(curl -sS "$FOX/api/wholesale/inventory" | jq -r '.lots[] | select((.qty_available // 0) > 0) | .sku_id' | head -n 1)
PREV_CODE=$(curl -sS -o /tmp/prev.json -w "%{http_code}" -X POST "$BASE/api/wholesale/checkout/preview" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"cart\":[{\"sku_id\":\"$SKU\",\"quantity\":1}],\"recurrence\":{\"cadence\":\"one_time\"},\"sourcing\":{\"mode\":\"auto_network\"}}" || true)
check_code "Auth preview succeeds" 200 "$PREV_CODE"
EXEC_CODE=$(curl -sS -o /tmp/exec.json -w "%{http_code}" -X POST "$BASE/api/wholesale/checkout/execute" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d "{\"buyer_account\":{\"email\":\"$EMAIL\",\"name\":\"Verifier\"},\"delivery_date\":\"2026-03-05\",\"delivery_address\":{\"street\":\"1 Test St\",\"city\":\"Testville\",\"zip\":\"12345\"},\"cart\":[{\"sku_id\":\"$SKU\",\"quantity\":1}],\"payment_provider\":\"demo\",\"sourcing\":{\"mode\":\"auto_network\"}}" || true)
check_code "Auth execute succeeds" 200 "$EXEC_CODE"
MID=$(node -p "const fs=require('fs'); const o=JSON.parse(fs.readFileSync('/tmp/exec.json','utf8')); o?.data?.master_order_id || ''" 2>/dev/null || true)
if [[ -n "$MID" ]]; then log "PASS Execute returned master_order_id"; else log "FAIL Execute missing master_order_id"; fi

log ""
log "-- Reservation durability (restart persistence) --"
FARM_AUTH=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('public/data/farm-api-keys.json','utf8')); const e=Object.entries(m).find(([,v])=>v&&v.status==='active'&&v.api_key); if(!e){process.exit(2)}; process.stdout.write(e[0]+' '+e[1].api_key)")
FARM_ID=$(printf '%s' "$FARM_AUTH" | awk '{print $1}')
API_KEY=$(printf '%s' "$FARM_AUTH" | awk '{print $2}')
OID="phasee-res-$(date +%s)"
R1=$(curl -sS -o /tmp/r1.json -w "%{http_code}" -X POST "$FOX/api/wholesale/inventory/reserve" -H 'content-type: application/json' -H "X-Farm-ID: $FARM_ID" -H "X-API-Key: $API_KEY" -d "{\"order_id\":\"$OID\",\"items\":[{\"sku_id\":\"$SKU\",\"quantity\":1}]}" || true)
check_code "Reserve succeeds" 200 "$R1"
CNT1=$(curl -sS -H "X-Farm-ID: $FARM_ID" -H "X-API-Key: $API_KEY" "$FOX/api/wholesale/inventory/reservations" | jq -r '.reservations | length' 2>/dev/null || echo 0)
log "INFO Reservations before restart: $CNT1"
kill -TERM "$FPID" 2>/dev/null || true
sleep 2
PORT=8091 node server-foxtrot.js > /tmp/phase-e-foxtrot.log 2>&1 &
FPID=$!
sleep 4
CNT2=$(curl -sS -H "X-Farm-ID: $FARM_ID" -H "X-API-Key: $API_KEY" "$FOX/api/wholesale/inventory/reservations" | jq -r '.reservations | length' 2>/dev/null || echo 0)
if [[ "$CNT2" -ge "$CNT1" ]]; then
  log "PASS Reservation persistence after restart (before=$CNT1 after=$CNT2)"
else
  log "FAIL Reservation persistence after restart (before=$CNT1 after=$CNT2)"
fi

log ""
log "-- Health checks --"
HC=$(curl -sS -o /tmp/hc.json -w "%{http_code}" "$BASE/health" || true)
check_code "Central health" 200 "$HC"
HF=$(curl -sS -o /tmp/hf.json -w "%{http_code}" "$FOX/health" || true)
check_code "Foxtrot health" 200 "$HF"

log ""
log "-- Summary --"
P=$(grep -c '^PASS ' "$REPORT" || true)
F=$(grep -c '^FAIL ' "$REPORT" || true)
log "PASS=$P"
log "FAIL=$F"

kill -TERM "$FPID" 2>/dev/null || true
kill -TERM "$CPID" 2>/dev/null || true
log "Report: $REPORT"
