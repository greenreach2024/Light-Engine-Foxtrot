#!/bin/bash
set -euo pipefail
BASE=http://127.0.0.1:3100
FOXTROT=http://127.0.0.1:8091
EMAIL="smoke+$(date +%s)@local.test"
PASS="test1234"

echo "=== SMOKE TEST: B6+B7 Fix Validation ==="
echo "EMAIL:$EMAIL"

echo ""
echo "1. CHECK NETWORK FARMS:"
curl -sS "$BASE/api/wholesale/network/farms" | python3 -c "import sys,json; farms=json.load(sys.stdin).get('data',{}).get('farms',[]); [print(f'  {f[\"farm_id\"]:30s} url={f.get(\"api_url\")}') for f in farms]"
echo ""

echo ""
echo "2. REGISTER:"
REG=$(curl -sS -X POST "$BASE/api/wholesale/buyers/register" -H "content-type: application/json" -d "{\"businessName\":\"Smoke Co\",\"contactName\":\"Smoke Buyer\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"buyerType\":\"restaurant\",\"location\":{\"zip\":\"12345\",\"state\":\"NY\",\"lat\":40.73,\"lng\":-73.93}}")
echo "$REG" | head -c 200
echo ""

TOKEN=$(node -p "JSON.parse(process.argv[1]).data.token" "$REG")
echo "TOKEN:${TOKEN:0:20}..."

echo ""
echo "3. GET SKU:"
INV=$(curl -sS "$FOXTROT/api/wholesale/inventory")
SKU_ID=$(echo "$INV" | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).lots.filter(l=>l.qty_available>0)[0]?.sku_id")
echo "SKU:$SKU_ID"

echo ""
echo "4. PREVIEW:"
PREVIEW=$(curl -sS -X POST "$BASE/api/wholesale/checkout/preview" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"cart\":[{\"sku_id\":\"$SKU_ID\",\"quantity\":1}],\"recurrence\":{\"cadence\":\"one_time\"},\"sourcing\":{\"mode\":\"auto_network\"}}")
echo "$PREVIEW" | head -c 300
echo ""

echo ""
echo "5. EXECUTE:"
EXEC=$(curl -sS -X POST "$BASE/api/wholesale/checkout/execute" -H "authorization: Bearer $TOKEN" -H "content-type: application/json" -d "{\"buyer_account\":{\"email\":\"$EMAIL\",\"name\":\"Smoke Buyer\"},\"delivery_date\":\"2026-03-01\",\"delivery_address\":{\"street\":\"1 Test St\",\"city\":\"Testville\",\"zip\":\"12345\"},\"cart\":[{\"sku_id\":\"$SKU_ID\",\"quantity\":1}],\"payment_provider\":\"demo\",\"sourcing\":{\"mode\":\"auto_network\"}}")
echo "$EXEC" | head -c 400
echo ""

sleep 3

echo ""
echo "6. ORDER EVENTS ON FOXTROT:"
curl -sS "$FOXTROT/api/wholesale/order-events" | head -c 600
echo ""

echo ""
echo "7. RESERVATIONS ON FOXTROT:"
curl -sS -H "X-Farm-ID: light-engine-demo" -H "X-API-Key: 8ad845e7efb313f81138be73034bc4a05c9343cbfc225814124dee373055ee72" "$FOXTROT/api/wholesale/inventory/reservations" | head -c 400
echo ""

echo ""
echo "8. GRC LOG (farm notification lines):"
grep -i "wholesale\|notify\|reserve\|confirm\|farm" /tmp/grc-test.log | tail -10
echo ""

echo "=== SMOKE TEST COMPLETE ==="
