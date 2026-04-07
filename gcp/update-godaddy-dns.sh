#!/bin/bash
# ============================================================
# GoDaddy DNS Update for greenreachgreens.com
# Points domain to GCP Load Balancer (35.244.184.206)
# ============================================================
#
# USAGE:
#   ./gcp/update-godaddy-dns.sh YOUR_API_KEY YOUR_API_SECRET
#
# Get API credentials at: https://developer.godaddy.com/keys
# Use "Production" environment (not OTE/Test).
# ============================================================

set -euo pipefail

DOMAIN="greenreachgreens.com"
GCP_IP="35.244.184.206"

API_KEY="${1:-}"
API_SECRET="${2:-}"

if [[ -z "$API_KEY" || -z "$API_SECRET" ]]; then
  echo "ERROR: Missing GoDaddy API credentials."
  echo "Usage: $0 <API_KEY> <API_SECRET>"
  echo ""
  echo "Get your Production API key at: https://developer.godaddy.com/keys"
  exit 1
fi

AUTH="sso-key ${API_KEY}:${API_SECRET}"
BASE="https://api.godaddy.com/v1/domains/${DOMAIN}/records"

echo "Updating DNS for ${DOMAIN}..."
echo "Target IP: ${GCP_IP}"
echo ""

# 1. Set A record for apex (@) to GCP load balancer IP
echo "[1/3] Setting A record @ -> ${GCP_IP}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "${BASE}/A/@" \
  -H "Authorization: ${AUTH}" \
  -H "Content-Type: application/json" \
  -d "[{\"data\":\"${GCP_IP}\",\"ttl\":600}]")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "  OK (A record updated)"
else
  echo "  FAILED (HTTP ${HTTP_CODE})"
  echo "  Response:"
  curl -s -X PUT "${BASE}/A/@" \
    -H "Authorization: ${AUTH}" \
    -H "Content-Type: application/json" \
    -d "[{\"data\":\"${GCP_IP}\",\"ttl\":600}]"
  echo ""
fi

# 2. Set CNAME for www -> apex domain
echo "[2/3] Setting CNAME www -> ${DOMAIN}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
  "${BASE}/CNAME/www" \
  -H "Authorization: ${AUTH}" \
  -H "Content-Type: application/json" \
  -d "[{\"data\":\"${DOMAIN}\",\"ttl\":600}]")

if [[ "$HTTP_CODE" == "200" ]]; then
  echo "  OK (CNAME updated)"
else
  echo "  FAILED (HTTP ${HTTP_CODE})"
  curl -s -X PUT "${BASE}/CNAME/www" \
    -H "Authorization: ${AUTH}" \
    -H "Content-Type: application/json" \
    -d "[{\"data\":\"${DOMAIN}\",\"ttl\":600}]"
  echo ""
fi

# 3. Verify the records
echo "[3/3] Verifying records..."
echo ""
echo "  A records:"
curl -s -X GET "${BASE}/A/@" \
  -H "Authorization: ${AUTH}" \
  -H "Content-Type: application/json" | python3 -m json.tool 2>/dev/null || echo "  (could not parse)"

echo ""
echo "  CNAME records:"
curl -s -X GET "${BASE}/CNAME/www" \
  -H "Authorization: ${AUTH}" \
  -H "Content-Type: application/json" | python3 -m json.tool 2>/dev/null || echo "  (could not parse)"

echo ""
echo "DNS updated. Propagation typically takes 5-15 minutes."
echo "SSL certificate will auto-provision once Google verifies the domain (15-60 min after DNS)."
echo ""
echo "Check progress with:"
echo "  dig greenreachgreens.com A +short    (should show ${GCP_IP})"
echo "  gcloud compute ssl-certificates describe greenreach-ssl --global --format='yaml(managed.domainStatus)'"
