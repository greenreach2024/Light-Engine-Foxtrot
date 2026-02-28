#!/bin/bash
set +e

cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot || exit 1

lsof -ti tcp:8091 -sTCP:LISTEN | xargs kill -TERM 2>/dev/null || true
sleep 1
PORT=8091 SQUARE_WEBHOOK_SECRET=phase3b-testsecret node server-foxtrot.js > /tmp/foxtrot-phase3b-functional.log 2>&1 &
PID=$!
echo "PID:$PID"
sleep 5

SUB_ORDER_ID=$(node -e 'const Datastore=require("nedb-promises"); (async()=>{const db=Datastore.create({filename:"data/wholesale-sub-orders.db",autoload:true}); const preferred=["confirmed","verified","completed","fulfilled","delivered"]; let doc=await db.findOne({status:{$in:preferred}}); if(!doc) doc=await db.findOne({}); process.stdout.write((doc&&doc.sub_order_id)||"");})().catch(()=>process.stdout.write(""));')
echo "SUB_ORDER_ID:$SUB_ORDER_ID"

if [ -n "$SUB_ORDER_ID" ]; then
  REFUND_RESP=$(curl -sS -X POST http://127.0.0.1:8091/api/wholesale/refunds \
    -H 'content-type: application/json' \
    -d "{\"sub_order_id\":\"$SUB_ORDER_ID\",\"refund_type\":\"partial\",\"refund_amount\":1,\"reason\":\"Phase3B functional smoke\",\"broker_fee_policy\":\"proportional\"}")
  echo "REFUND_CREATE:$REFUND_RESP"

  REFUND_ID=$(node -e 'try{const r=JSON.parse(process.argv[1]);process.stdout.write(r.refund_id||"");}catch{process.stdout.write("");}' "$REFUND_RESP")
  echo "REFUND_ID:$REFUND_ID"

  if [ -n "$REFUND_ID" ]; then
    REFUND_GET=$(curl -sS "http://127.0.0.1:8091/api/wholesale/refunds/$REFUND_ID")
    echo "REFUND_GET:$REFUND_GET"
  fi

  REFUND_LIST=$(curl -sS "http://127.0.0.1:8091/api/wholesale/refunds?sub_order_id=$SUB_ORDER_ID")
  echo "REFUND_LIST:$REFUND_LIST"
else
  echo "REFUND_TEST_SKIPPED:no_sub_orders_found"
fi

PAYLOAD='{"id":"evt_phase3b_001","type":"payment.updated","data":{"object":{"payment":{"id":"PAY-PHASE3B-001","status":"COMPLETED","amountMoney":{"amount":500,"currency":"USD"},"createdAt":"2026-02-28T17:00:00.000Z"}}}}'
SIG=$(node -e 'const crypto=require("crypto");const payload=process.argv[1];const secret=process.argv[2];process.stdout.write(crypto.createHmac("sha256",secret).update(payload).digest("base64"));' "$PAYLOAD" "phase3b-testsecret")

FIRST=$(curl -sS -X POST http://127.0.0.1:8091/api/wholesale/webhooks/square \
  -H 'content-type: application/json' \
  -H "x-square-signature: $SIG" \
  -d "$PAYLOAD")
SECOND=$(curl -sS -X POST http://127.0.0.1:8091/api/wholesale/webhooks/square \
  -H 'content-type: application/json' \
  -H "x-square-signature: $SIG" \
  -d "$PAYLOAD")

echo "WEBHOOK_FIRST:$FIRST"
echo "WEBHOOK_SECOND:$SECOND"

PAYMENTS_LIST=$(curl -sS 'http://127.0.0.1:8091/api/wholesale/webhooks/payments')
echo "PAYMENTS_LIST:$PAYMENTS_LIST"

kill -TERM "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true
