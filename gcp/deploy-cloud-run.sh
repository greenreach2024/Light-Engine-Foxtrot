#!/bin/bash
# GreenReach Cloud Run Migration - Phase 2: Build and Deploy
# Run this in Cloud Shell after setup-infrastructure.sh completes.
#
# This script:
#   1. Builds Docker images via Cloud Build
#   2. Pushes to Artifact Registry
#   3. Deploys both Cloud Run services
#   4. Maps custom domain for Central
#
# Prerequisites:
#   - setup-infrastructure.sh has been run
#   - Secrets have been populated in Secret Manager
#   - AlloyDB has been seeded with data (pg_dump/pg_restore)

set -euo pipefail

# ============================================================
# CONFIGURATION - Must match setup-infrastructure.sh
# ============================================================
PROJECT_ID="project-5d00790f-13a9-4637-a40"
REGION="us-east1"
REPO_NAME="greenreach"
CENTRAL_SERVICE="greenreach-central"
LE_SERVICE="light-engine"
VPC_NAME="greenreach-vpc"
CONNECTOR_NAME="greenreach-connector"
ALLOYDB_CLUSTER="greenreach-db"
ALLOYDB_INSTANCE="greenreach-db-primary"
BUCKET_NAME="${PROJECT_ID}-le-data"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
SA_CENTRAL="${CENTRAL_SERVICE}-sa@${PROJECT_ID}.iam.gserviceaccount.com"
SA_LE="${LE_SERVICE}-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Get AlloyDB IP
ALLOYDB_IP=$(gcloud alloydb instances describe "${ALLOYDB_INSTANCE}" \
  --cluster="${ALLOYDB_CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(ipAddress)")

echo "============================================"
echo "GreenReach Cloud Run Deploy"
echo "Registry: ${REGISTRY}"
echo "AlloyDB IP: ${ALLOYDB_IP}"
echo "============================================"

# ============================================================
# Step 1: Build and push Central image
# ============================================================
echo ""
echo ">>> Step 1: Building Central image..."

# Cloud Build builds from the greenreach-central/ subdirectory
gcloud builds submit ./greenreach-central/ \
  --project="${PROJECT_ID}" \
  --tag="${REGISTRY}/${CENTRAL_SERVICE}:latest" \
  --timeout=600s

echo "Central image pushed: ${REGISTRY}/${CENTRAL_SERVICE}:latest"

# ============================================================
# Step 2: Build and push LE image
# ============================================================
echo ""
echo ">>> Step 2: Building LE image..."

# Cloud Build builds from the repo root
gcloud builds submit . \
  --project="${PROJECT_ID}" \
  --tag="${REGISTRY}/${LE_SERVICE}:latest" \
  --timeout=900s \
  --ignore-file=.dockerignore

echo "LE image pushed: ${REGISTRY}/${LE_SERVICE}:latest"

# ============================================================
# Step 3: Deploy Central to Cloud Run
# ============================================================
echo ""
echo ">>> Step 3: Deploying Central..."

# Helper to build --set-secrets flag for a list of secret names
# Format: ENV_VAR=SECRET_NAME:latest
build_secrets_flag() {
  local secrets=("$@")
  local flag=""
  for s in "${secrets[@]}"; do
    if [ -n "$flag" ]; then flag="${flag},"; fi
    flag="${flag}${s}=${s}:latest"
  done
  echo "$flag"
}

CENTRAL_SECRET_LIST=(
  "JWT_SECRET"
  "WHOLESALE_JWT_SECRET"
  "WHOLESALE_FARM_API_KEY"
  "GREENREACH_API_KEY"
  "SQUARE_ACCESS_TOKEN"
  "SQUARE_APP_ID"
  "SQUARE_APP_SECRET"
  "SQUARE_WEBHOOK_SECRET"
  "SQUARE_LOCATION_ID"
  "SQUARE_WEBHOOK_SIGNATURE_KEY"
  "FARM_SQUARE_REDIRECT_URI"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "STRIPE_CONNECT_CLIENT_ID"
  "SESSION_SECRET"
  "PAYMENT_OAUTH_STATE_SECRET"
  "ADMIN_PASSWORD"
  "ADMIN_FALLBACK_PASSWORD"
  "AWS_ACCESS_KEY_ID"
  "AWS_SECRET_ACCESS_KEY"
  "GITHUB_BILLING_TOKEN"
  "QUICKBOOKS_CLIENT_SECRET"
  "USDA_API_KEY"
  "USDA_NASS_API_KEY"
  "SMTP_PASS"
  "SYNC_API_KEY"
  "CENTRAL_API_KEY"
  "PRODUCER_JWT_SECRET"
  "WEBHOOK_SECRET"
)

CENTRAL_SECRETS_FLAG=$(build_secrets_flag "${CENTRAL_SECRET_LIST[@]}")
# Map ALLOYDB_PASSWORD secret to DB_PASSWORD env var
CENTRAL_SECRETS_FLAG="${CENTRAL_SECRETS_FLAG},DB_PASSWORD=ALLOYDB_PASSWORD:latest"

gcloud run deploy "${CENTRAL_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${REGISTRY}/${CENTRAL_SERVICE}:latest" \
  --update-traffic=LATEST=100 \
  --service-account="${SA_CENTRAL}" \
  --vpc-connector="${CONNECTOR_NAME}" \
  --vpc-egress=private-ranges-only \
  --port=8080 \
  --cpu=1 \
  --memory=512Mi \
  --min-instances=1 \
  --max-instances=5 \
  --timeout=300 \
  --concurrency=80 \
  --set-env-vars="\
NODE_ENV=production,\
PORT=8080,\
DEPLOYMENT_MODE=cloud,\
DB_HOST=${ALLOYDB_IP},\
DB_PORT=5432,\
DB_NAME=greenreach_central,\
DB_USER=postgres,\
DB_SSL=false,\
DB_POOL_MAX=5,\
WS_PORT=8081,\
ADMIN_EMAIL=peter@greenreachgreens.com,\
ADMIN_ALERT_EMAIL=peter@greenreachgreens.com,\
ADMIN_ALERT_PHONE=+16138881031,\
FARM_ID=FARM-MLTP9LVH-B0B85039,\
GCP_PROJECT=${PROJECT_ID},\
GCP_REGION=${REGION},\
SQUARE_ENVIRONMENT=production,\
SQUARE_LOCATION_ID=L0FWKJRQMQZKW,\
SES_ENABLED=false,\
SMTP_HOST=smtp.mail.us-east-1.awsapps.com,\
SMTP_PORT=465,\
SMTP_USER=noreply@greenreachgreens.com,\
FROM_EMAIL=noreply@greenreachgreens.com,\
WHOLESALE_COMMISSION_RATE=0.12,\
WHOLESALE_DEFAULT_SKU_FACTOR=0.75,\
WHOLESALE_DELIVERY_ENABLED=true" \
  --set-secrets="${CENTRAL_SECRETS_FLAG}" \
  --allow-unauthenticated

echo "Central deployed."

# ============================================================
# Step 4: Deploy LE to Cloud Run
# ============================================================
echo ""
echo ">>> Step 4: Deploying LE..."

LE_SECRET_LIST=(
  "JWT_SECRET"
  "WHOLESALE_JWT_SECRET"
  "WHOLESALE_FARM_API_KEY"
  "GREENREACH_API_KEY"
  "SWITCHBOT_TOKEN"
  "SWITCHBOT_SECRET"
  "KASA_EMAIL"
  "KASA_PASSWORD"
  "ADMIN_PASSWORD"
  "FARM_PIN"
  "CTRL_PIN"
  "EDGE_API_KEY"
  "IFTTT_KEY"
  "IFTTT_WEBHOOK_KEY"
  "IFTTT_INBOUND_TOKEN"
)

LE_SECRETS_FLAG=$(build_secrets_flag "${LE_SECRET_LIST[@]}")

# LE Cloud Run URL for CENTRAL_URL will be set after initial deploy
# First deploy without CENTRAL_URL, then update
gcloud run deploy "${LE_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --image="${REGISTRY}/${LE_SERVICE}:latest" \
  --update-traffic=LATEST=100 \
  --service-account="${SA_LE}" \
  --vpc-connector="${CONNECTOR_NAME}" \
  --vpc-egress=private-ranges-only \
  --port=8080 \
  --cpu=1 \
  --memory=1Gi \
  --min-instances=1 \
  --max-instances=3 \
  --timeout=300 \
  --concurrency=50 \
  --execution-environment=gen2 \
  --add-volume=name=le-data,type=cloud-storage,bucket="${BUCKET_NAME}" \
  --add-volume-mount=volume=le-data,mount-path=/app/data \
  --set-env-vars="\
NODE_ENV=production,\
PORT=8080,\
DEPLOYMENT_MODE=cloud,\
FARM_ID=FARM-MLTP9LVH-B0B85039,\
FARM_NAME=The Notable Sprout,\
DEMO_MODE=false,\
RATE_LIMITING_ENABLED=true,\
GCP_PROJECT=${PROJECT_ID},\
GCP_REGION=${REGION}" \
  --set-secrets="${LE_SECRETS_FLAG}" \
  --allow-unauthenticated

echo "LE deployed."

# ============================================================
# Step 5: Cross-link the services
# ============================================================
echo ""
echo ">>> Step 5: Cross-linking services..."

CENTRAL_URL=$(gcloud run services describe "${CENTRAL_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

LE_URL=$(gcloud run services describe "${LE_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --format="value(status.url)")

echo "Central URL: ${CENTRAL_URL}"
echo "LE URL: ${LE_URL}"

# Update LE with Central URL
gcloud run services update "${LE_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="\
CENTRAL_URL=${CENTRAL_URL},\
GREENREACH_CENTRAL_URL=${CENTRAL_URL}"

# Update Central with LE URL
gcloud run services update "${CENTRAL_SERVICE}" \
  --project="${PROJECT_ID}" \
  --region="${REGION}" \
  --update-env-vars="\
FOXTROT_URL=${LE_URL},\
LE_API_URL=${LE_URL},\
LIGHT_ENGINE_URL=${LE_URL},\
EDGE_FARM_URL=${LE_URL},\
FARM_EDGE_URL=${LE_URL}"

echo ""
echo "============================================"
echo "Deployment Complete"
echo "============================================"
echo ""
echo "Central: ${CENTRAL_URL}"
echo "LE:      ${LE_URL}"
echo ""
echo "REMAINING STEPS:"
echo "  1. Map custom domain: gcloud run domain-mappings create --service=${CENTRAL_SERVICE} --domain=greenreachgreens.com --region=${REGION}"
echo "  2. Update DNS in your registrar to point to Cloud Run"
echo "  3. Test all endpoints on Cloud Run URLs before switching DNS"
echo "  4. Migrate LE data files to GCS bucket: gs://${BUCKET_NAME}"
echo "  5. Set up GCS FUSE volume mount for LE persistent data"
echo ""
echo "ROLLBACK: If issues, DNS still points to AWS EB. No downtime."
