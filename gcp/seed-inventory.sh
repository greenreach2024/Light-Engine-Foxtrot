#!/bin/bash
# ============================================================
# Seed farm inventory for The Notable Sprout
# Uses POST /api/inventory/manual endpoint on Central
# ============================================================
set -euo pipefail

CENTRAL_URL="https://greenreach-central-yqxv5iubsq-ue.a.run.app"
FARM_ID="FARM-MLTP9LVH-B0B85039"
API_KEY="3af913fb5fb02060c25bfdbe624ca75ee9075848e554417432d5382ccd3c7fda"

seed_product() {
  local name="$1"
  local sku="$2"
  local qty="$3"
  local unit="$4"
  local retail="$5"
  local wholesale="$6"
  local category="$7"
  local variety="$8"

  echo -n "  Seeding: ${name} (${qty} ${unit})..."
  HTTP_CODE=$(curl -s -o /tmp/seed-response.json -w "%{http_code}" \
    -X POST "${CENTRAL_URL}/api/inventory/manual" \
    -H "Content-Type: application/json" \
    -H "X-Farm-ID: ${FARM_ID}" \
    -H "X-API-Key: ${API_KEY}" \
    -d "{
      \"product_name\": \"${name}\",
      \"sku\": \"${sku}\",
      \"quantity_lbs\": ${qty},
      \"unit\": \"${unit}\",
      \"price\": ${retail},
      \"wholesale_price\": ${wholesale},
      \"category\": \"${category}\",
      \"variety\": \"${variety}\",
      \"available_for_wholesale\": true
    }")

  if [[ "$HTTP_CODE" == "200" || "$HTTP_CODE" == "201" ]]; then
    echo " OK"
  else
    echo " FAILED (HTTP ${HTTP_CODE})"
    cat /tmp/seed-response.json 2>/dev/null
    echo ""
  fi
}

echo "Seeding inventory for The Notable Sprout..."
echo "Target: ${CENTRAL_URL}"
echo ""

# Leafy Greens
seed_product "Butterhead Lettuce"    "butterhead-lettuce"    120 "lb"  5.50  3.58  "leafy-greens"  "Butterhead"
seed_product "Red Leaf Lettuce"      "red-leaf-lettuce"       85 "lb"  5.00  3.25  "leafy-greens"  "Red Leaf"
seed_product "Baby Arugula"          "baby-arugula"           60 "lb"  7.00  4.55  "leafy-greens"  "Arugula"
seed_product "Baby Spinach"          "baby-spinach"           75 "lb"  6.50  4.23  "leafy-greens"  "Bloomsdale"
seed_product "Spring Mix"            "spring-mix"             90 "lb"  6.00  3.90  "leafy-greens"  "Mixed Greens"
seed_product "Lacinato Kale"         "lacinato-kale"          50 "lb"  5.50  3.58  "leafy-greens"  "Lacinato"

# Herbs
seed_product "Genovese Basil"        "genovese-basil"         40 "lb"  12.00 7.80  "herbs"          "Genovese"
seed_product "Fresh Cilantro"        "fresh-cilantro"         35 "lb"  10.00 6.50  "herbs"          "Santo"
seed_product "Spearmint"             "spearmint"              25 "lb"  11.00 7.15  "herbs"          "Spearmint"
seed_product "Italian Parsley"       "italian-parsley"        30 "lb"  10.00 6.50  "herbs"          "Flat Leaf"
seed_product "Fresh Dill"            "fresh-dill"             20 "lb"  11.00 7.15  "herbs"          "Bouquet"
seed_product "Chives"                "chives"                 15 "lb"  14.00 9.10  "herbs"          "Common"

# Microgreens
seed_product "Microgreens Mix"       "microgreens-mix"        30 "lb"  18.00 11.70 "microgreens"    "Mixed"
seed_product "Sunflower Microgreens" "sunflower-microgreens"  20 "lb"  16.00 10.40 "microgreens"    "Black Oil"
seed_product "Pea Shoot Microgreens" "pea-shoot-microgreens"  25 "lb"  15.00 9.75  "microgreens"    "Speckled"
seed_product "Radish Microgreens"    "radish-microgreens"     15 "lb"  17.00 11.05 "microgreens"    "Daikon"

echo ""
echo "Done. Verifying catalog..."
echo ""
curl -s "${CENTRAL_URL}/api/wholesale/catalog" | python3 -c "
import sys, json
d = json.load(sys.stdin)
skus = d.get('data', {}).get('skus', [])
farms = d.get('data', {}).get('farms', [])
print(f'Catalog: {len(skus)} products from {len(farms)} farm(s)')
for s in skus[:5]:
    print(f'  - {s.get(\"product_name\", \"?\")} ({s.get(\"qty_available\", 0)} {s.get(\"unit\", \"\")} @ \${s.get(\"price_per_unit\", 0):.2f})')
if len(skus) > 5:
    print(f'  ... and {len(skus) - 5} more')
"
