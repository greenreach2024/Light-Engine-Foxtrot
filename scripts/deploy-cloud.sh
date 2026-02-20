#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# deploy-cloud.sh — Phase 5: Deploy Light Engine Cloud SaaS to AWS
# ═══════════════════════════════════════════════════════════════════
# Deploys the unified Central+Foxtrot app to Elastic Beanstalk with:
#   - Wildcard DNS: *.greenreachgreens.com → EB ALB
#   - Wildcard SSL: ACM cert for *.greenreachgreens.com
#   - Multi-tenant subdomain routing
#
# Prerequisites:
#   - AWS CLI configured (aws configure)
#   - EB CLI installed (pip install awsebcli)
#   - Route 53 hosted zone for greenreachgreens.com
#
# Usage:
#   ./scripts/deploy-cloud.sh setup    # One-time: cert + DNS + EB env
#   ./scripts/deploy-cloud.sh deploy   # Deploy latest code
#   ./scripts/deploy-cloud.sh status   # Check environment health
#   ./scripts/deploy-cloud.sh logs     # Tail EB logs
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration ────────────────────────────────────────────────
DOMAIN="greenreachgreens.com"
REGION="us-east-1"
EB_APP="greenreach-central"
EB_ENV="greenreach-central-prod-v4"
AWS_ACCOUNT="634419072974"
PLATFORM="Node.js 20 running on 64bit Amazon Linux 2023"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

step() { echo -e "\n${GREEN}▸${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
info() { echo -e "${CYAN}ℹ${NC} $1"; }
fail() { echo -e "${RED}✗${NC} $1"; exit 1; }
ok()   { echo -e "${GREEN}✓${NC} $1"; }

# ── Preflight checks ────────────────────────────────────────────
check_prereqs() {
  command -v aws &>/dev/null || fail "AWS CLI not installed. Install: brew install awscli"
  command -v eb  &>/dev/null || fail "EB CLI not installed. Install: pip install awsebcli"
  aws sts get-caller-identity &>/dev/null || fail "AWS credentials not configured. Run: aws configure"
  ok "Prerequisites OK (AWS CLI + EB CLI + credentials)"
}

# ── Step 1: Request wildcard ACM certificate ─────────────────────
setup_cert() {
  step "Checking for wildcard ACM certificate..."

  # Look for existing wildcard cert
  CERT_ARN=$(aws acm list-certificates \
    --region "$REGION" \
    --query "CertificateSummaryList[?DomainName=='*.${DOMAIN}'].CertificateArn" \
    --output text 2>/dev/null || echo "")

  if [[ -n "$CERT_ARN" && "$CERT_ARN" != "None" ]]; then
    ok "Wildcard cert already exists: $CERT_ARN"
  else
    step "Requesting wildcard certificate for *.${DOMAIN}..."
    CERT_ARN=$(aws acm request-certificate \
      --domain-name "*.${DOMAIN}" \
      --subject-alternative-names "${DOMAIN}" \
      --validation-method DNS \
      --region "$REGION" \
      --query 'CertificateArn' \
      --output text)
    ok "Certificate requested: $CERT_ARN"

    echo ""
    warn "DNS validation required. Add the CNAME records shown below to Route 53:"
    echo ""
    sleep 5  # Wait for ACM to populate validation records
    aws acm describe-certificate \
      --certificate-arn "$CERT_ARN" \
      --region "$REGION" \
      --query 'Certificate.DomainValidationOptions[].ResourceRecord' \
      --output table

    echo ""
    info "After adding DNS records, validation takes 5-30 minutes."
    info "Check status: aws acm describe-certificate --certificate-arn $CERT_ARN --query Certificate.Status"
    echo ""
    read -p "Press Enter after validation records are added to Route 53... "
  fi

  # Verify cert is issued
  CERT_STATUS=$(aws acm describe-certificate \
    --certificate-arn "$CERT_ARN" \
    --region "$REGION" \
    --query 'Certificate.Status' \
    --output text)

  if [[ "$CERT_STATUS" != "ISSUED" ]]; then
    warn "Certificate status: $CERT_STATUS (not yet ISSUED)"
    info "Continue with 'deploy-cloud.sh setup' after cert is validated."
    return 1
  fi

  ok "Certificate validated and issued: $CERT_ARN"

  # Update the https-listener.config with the wildcard cert ARN
  step "Updating .ebextensions/https-listener.config with wildcard cert..."
  HTTPS_CONFIG="greenreach-central/.ebextensions/https-listener.config"
  if grep -q "SSLCertificateArns" "$HTTPS_CONFIG"; then
    sed -i.bak "s|SSLCertificateArns:.*|SSLCertificateArns: ${CERT_ARN}|" "$HTTPS_CONFIG"
    rm -f "${HTTPS_CONFIG}.bak"
    ok "Updated SSL cert ARN in https-listener.config"
  fi
}

# ── Step 2: Configure wildcard DNS ───────────────────────────────
setup_dns() {
  step "Configuring wildcard DNS..."

  # Get hosted zone ID
  ZONE_ID=$(aws route53 list-hosted-zones-by-name \
    --dns-name "${DOMAIN}" \
    --query "HostedZones[?Name=='${DOMAIN}.'].Id" \
    --output text 2>/dev/null | sed 's|/hostedzone/||')

  if [[ -z "$ZONE_ID" ]]; then
    warn "No Route 53 hosted zone found for ${DOMAIN}"
    info "Create one: aws route53 create-hosted-zone --name ${DOMAIN} --caller-reference $(date +%s)"
    return 1
  fi
  ok "Found hosted zone: $ZONE_ID"

  # Get EB environment CNAME
  EB_CNAME=$(aws elasticbeanstalk describe-environments \
    --environment-names "$EB_ENV" \
    --region "$REGION" \
    --query 'Environments[0].CNAME' \
    --output text 2>/dev/null || echo "")

  if [[ -z "$EB_CNAME" || "$EB_CNAME" == "None" ]]; then
    warn "EB environment $EB_ENV not found. Deploy first, then re-run setup."
    return 1
  fi
  ok "EB environment CNAME: $EB_CNAME"

  # Get the ALB hosted zone ID for the ALIAS record
  EB_ALB_ZONE="Z35SXDOTRQ7X7K"  # us-east-1 ELB hosted zone ID

  step "Creating/updating wildcard DNS record: *.${DOMAIN} → ${EB_CNAME}"
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$ZONE_ID" \
    --change-batch "{
      \"Changes\": [{
        \"Action\": \"UPSERT\",
        \"ResourceRecordSet\": {
          \"Name\": \"*.${DOMAIN}\",
          \"Type\": \"CNAME\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"${EB_CNAME}\"}]
        }
      }]
    }" \
    --query 'ChangeInfo.Id' \
    --output text

  ok "Wildcard DNS configured: *.${DOMAIN} → ${EB_CNAME}"

  # Also ensure apex domain points to EB
  step "Creating/updating apex DNS: ${DOMAIN} → ${EB_CNAME}"
  aws route53 change-resource-record-sets \
    --hosted-zone-id "$ZONE_ID" \
    --change-batch "{
      \"Changes\": [{
        \"Action\": \"UPSERT\",
        \"ResourceRecordSet\": {
          \"Name\": \"${DOMAIN}\",
          \"Type\": \"CNAME\",
          \"TTL\": 300,
          \"ResourceRecords\": [{\"Value\": \"${EB_CNAME}\"}]
        }
      }]
    }" \
    --query 'ChangeInfo.Id' \
    --output text 2>/dev/null || warn "Apex CNAME may conflict with existing records (NS/SOA). Use ALIAS instead."

  ok "DNS setup complete"
}

# ── Deploy ───────────────────────────────────────────────────────
deploy() {
  step "Deploying to Elastic Beanstalk..."
  check_prereqs

  cd "$(dirname "$0")/.."
  info "Working directory: $(pwd)"

  # Ensure we're in the right EB app/env
  if [[ ! -f "greenreach-central/.elasticbeanstalk/config.yml" ]]; then
    step "Initializing EB application..."
    cd greenreach-central
    eb init "$EB_APP" --platform "$PLATFORM" --region "$REGION"
    cd ..
    ok "EB application initialized"
  fi

  step "Deploying to ${EB_ENV}..."
  cd greenreach-central
  eb deploy "$EB_ENV" --staged --timeout 10
  cd ..

  ok "Deployment complete!"
  info "Check health: ./scripts/deploy-cloud.sh status"
  info "Tail logs:    ./scripts/deploy-cloud.sh logs"
}

# ── Status ───────────────────────────────────────────────────────
status() {
  step "Environment status:"
  cd "$(dirname "$0")/../greenreach-central"
  eb status "$EB_ENV" 2>/dev/null || \
    aws elasticbeanstalk describe-environments \
      --environment-names "$EB_ENV" \
      --region "$REGION" \
      --query 'Environments[0].{Status:Status,Health:Health,HealthStatus:HealthStatus,CNAME:CNAME}' \
      --output table

  echo ""
  step "Quick health check:"
  curl -sS "https://${DOMAIN}/health" 2>/dev/null | python3 -m json.tool || \
    warn "Health check failed (may not be deployed yet)"
}

# ── Logs ─────────────────────────────────────────────────────────
logs() {
  cd "$(dirname "$0")/../greenreach-central"
  eb logs "$EB_ENV" --all 2>/dev/null || \
    aws elasticbeanstalk request-environment-info \
      --environment-name "$EB_ENV" \
      --info-type tail \
      --region "$REGION"
}

# ── Main ─────────────────────────────────────────────────────────
case "${1:-help}" in
  setup)
    check_prereqs
    setup_cert
    setup_dns
    ok "One-time setup complete. Now run: ./scripts/deploy-cloud.sh deploy"
    ;;
  deploy)
    deploy
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  *)
    echo "Usage: $0 {setup|deploy|status|logs}"
    echo ""
    echo "  setup   — One-time: wildcard SSL cert + DNS configuration"
    echo "  deploy  — Deploy latest code to EB environment"
    echo "  status  — Check environment health"
    echo "  logs    — Tail EB logs"
    ;;
esac
