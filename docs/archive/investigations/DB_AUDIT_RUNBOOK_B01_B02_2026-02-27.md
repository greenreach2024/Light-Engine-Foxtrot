# DB Audit Runbook — B-01/B-02

**Date:** 2026-02-27  
**System:** GreenReach Central (prod)  
**Purpose:** Verify and (if needed) backfill `farms.api_url` for active network farms  
**Scope:** Review Agent blockers B-01/B-02 operational closure

---

## 1) Preconditions

- Execute from a **VPC-capable environment** with network path to RDS (CloudShell with VPC access, bastion, or EB host).
- AWS CLI authenticated to prod account.
- PostgreSQL client (`psql`) available.
- No application downtime required.

---

## 2) Safety Rules

- Run **read-only audit first**.
- Backfill only rows where `api_url` is null/empty.
- Use transaction for update step.
- Do not modify non-target columns.

---

## 3) Copy/Paste Command Block

```bash
set -euo pipefail

REGION="us-east-1"
APP_NAME="greenreach-central-prod"
ENV_NAME="greenreach-central-prod-v4"
FOXTROT_URL="https://foxtrot.greenreachgreens.com"
TARGET_FARM_ID="FARM-MLTP9LVH-B0B85039"

echo "== Fetch DB env vars from EB =="
read -r RDS_HOSTNAME RDS_PORT RDS_DB_NAME RDS_USERNAME RDS_PASSWORD < <(
  aws elasticbeanstalk describe-configuration-settings \
    --region "$REGION" \
    --application-name "$APP_NAME" \
    --environment-name "$ENV_NAME" \
    --query "ConfigurationSettings[0].OptionSettings[?Namespace=='aws:elasticbeanstalk:application:environment' && (OptionName=='RDS_HOSTNAME' || OptionName=='RDS_PORT' || OptionName=='RDS_DB_NAME' || OptionName=='RDS_USERNAME' || OptionName=='RDS_PASSWORD')].[OptionName,Value]" \
    --output text \
  | awk '
      $1=="RDS_HOSTNAME"{h=$2}
      $1=="RDS_PORT"{p=$2}
      $1=="RDS_DB_NAME"{d=$2}
      $1=="RDS_USERNAME"{u=$2}
      $1=="RDS_PASSWORD"{pw=$2}
      END{print h,p,d,u,pw}'
)

export PGHOST="$RDS_HOSTNAME" PGPORT="$RDS_PORT" PGDATABASE="$RDS_DB_NAME" PGUSER="$RDS_USERNAME" PGPASSWORD="$RDS_PASSWORD" PGSSLMODE=require

echo "== READ-ONLY AUDIT: rows missing api_url =="
psql -v ON_ERROR_STOP=1 -c "
SELECT farm_id, name, status, api_url
FROM farms
WHERE status IN ('active','online','pending')
  AND (api_url IS NULL OR TRIM(api_url) = '')
ORDER BY farm_id;
"

echo "== READ-ONLY AUDIT COUNT =="
psql -At -v ON_ERROR_STOP=1 -c "
SELECT COUNT(*) AS missing_api_url_count
FROM farms
WHERE status IN ('active','online','pending')
  AND (api_url IS NULL OR TRIM(api_url) = '');
"

echo "== TARGETED BACKFILL (only if target row is missing api_url) =="
psql -v ON_ERROR_STOP=1 -c "
BEGIN;
UPDATE farms
SET api_url = '${FOXTROT_URL}', updated_at = NOW()
WHERE farm_id = '${TARGET_FARM_ID}'
  AND status IN ('active','online','pending')
  AND (api_url IS NULL OR TRIM(api_url) = '')
RETURNING farm_id, name, status, api_url, updated_at;
COMMIT;
"

echo "== VERIFY TARGET ROW =="
psql -v ON_ERROR_STOP=1 -c "
SELECT farm_id, name, status, api_url, updated_at
FROM farms
WHERE farm_id = '${TARGET_FARM_ID}';
"

echo "== VERIFY REMAINING MISSING COUNT =="
psql -At -v ON_ERROR_STOP=1 -c "
SELECT COUNT(*) AS remaining_missing_api_url_count
FROM farms
WHERE status IN ('active','online','pending')
  AND (api_url IS NULL OR TRIM(api_url) = '');
"
```

---

## 4) Expected Results

- `missing_api_url_count` should be `0` (or reduced after backfill).
- Target farm should show:
  - `farm_id = FARM-MLTP9LVH-B0B85039`
  - `api_url = https://foxtrot.greenreachgreens.com`
- `remaining_missing_api_url_count` should be `0` for full closure.

---

## 5) Post-DB App Smoke Checks

Run from any environment with internet access:

```bash
echo 'SMOKE 1: network aggregate'
curl -sS https://app.greenreachgreens.com/api/wholesale/network/aggregate | jq '{status,sku_count:(.data.catalog.skus|length),diagnostics:(.data.diagnostics // .data.catalog.diagnostics // {})}'

echo 'SMOKE 2: network farms'
curl -sS https://app.greenreachgreens.com/api/wholesale/network/farms | jq '{status,total:(.data.farms|length),missing_api_url:(.data.farms|map(select(((.api_url // .url // "")|length)==0))|length)}'

echo 'SMOKE 3: checkout preview'
BASE=https://app.greenreachgreens.com
EMAIL="ops.$(date +%s)@local.test"
PASS='test1234'
REG=$(curl -sS -X POST "$BASE/api/wholesale/buyers/register" -H 'content-type: application/json' -d "{\"businessName\":\"Ops Smoke\",\"contactName\":\"Verifier\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"buyerType\":\"restaurant\",\"location\":{\"zip\":\"12345\",\"state\":\"NY\",\"lat\":40.73,\"lng\":-73.93}}")
TOKEN=$(node -p "JSON.parse(process.argv[1]).data.token" "$REG")
curl -sS -X POST "$BASE/api/wholesale/checkout/preview" -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"cart":[{"sku_id":"SKU-AUDIT-GENOVESE-BASIL-5LB","quantity":1}],"recurrence":{"cadence":"one_time"},"sourcing":{"mode":"auto_network"}}' | jq '{status,subtotal:(.data.subtotal // null),farm_sub_orders_count:(.data.farm_sub_orders|length // 0)}'
```

Pass criteria:
- Aggregate: `status=ok`, `diagnostics={}`
- Network farms: `missing_api_url=0`
- Checkout preview: `status=ok`, `subtotal` non-null

---

## 6) Rollback (if wrong URL was set)

```sql
BEGIN;
UPDATE farms
SET api_url = NULL, updated_at = NOW()
WHERE farm_id = 'FARM-MLTP9LVH-B0B85039';
COMMIT;
```

Then rerun Section 5 smoke checks.

---

## 7) Ops Signoff

- Executor: ____________________
- Date/Time (UTC): ____________________
- Environment used (CloudShell/Bastion/EB host): ____________________
- Audit count before: ____________________
- Rows updated: ____________________
- Remaining missing count after: ____________________
- Smoke checks pass (Y/N): ____________________
- Notes: ____________________
