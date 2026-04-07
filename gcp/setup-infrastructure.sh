#!/bin/bash
# GreenReach Cloud Run Migration - Phase 1: GCP Infrastructure Setup
# Run this in Cloud Shell (authenticated as g1681south)
#
# Prerequisites:
#   - gcloud auth is active
#   - Project ID is set
#
# This script creates:
#   1. Enables required APIs
#   2. Artifact Registry repo for Docker images
#   3. AlloyDB cluster + primary instance
#   4. VPC + Serverless VPC connector (Cloud Run -> AlloyDB)
#   5. GCS bucket for LE persistent data
#   6. Secret Manager secrets (empty - you populate them)
#   7. Cloud Run service accounts with least-privilege IAM
#
# IMPORTANT: AlloyDB requires a VPC -- it has no public IP.
# Cloud Run connects via Serverless VPC Access connector.

set -euo pipefail

# ============================================================
# CONFIGURATION - Edit these before running
# ============================================================
PROJECT_ID="project-5d00790f-13a9-4637-a40"
REGION="us-east1"  # Closest to current us-east-1
ZONE="${REGION}-b"

# Naming
REPO_NAME="greenreach"
CENTRAL_SERVICE="greenreach-central"
LE_SERVICE="light-engine"
VPC_NAME="greenreach-vpc"
SUBNET_NAME="greenreach-subnet"
CONNECTOR_NAME="greenreach-connector"
ALLOYDB_CLUSTER="greenreach-db"
ALLOYDB_INSTANCE="greenreach-db-primary"
ALLOYDB_PASSWORD=""  # SET THIS before running
BUCKET_NAME="${PROJECT_ID}-le-data"

echo "============================================"
echo "GreenReach GCP Setup - Project: ${PROJECT_ID}"
echo "Region: ${REGION}"
echo "============================================"

# ============================================================
# Step 1: Set project and enable APIs
# ============================================================
echo ""
echo ">>> Step 1: Enabling APIs..."
gcloud config set project "${PROJECT_ID}"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  alloydb.googleapis.com \
  vpcaccess.googleapis.com \
  secretmanager.googleapis.com \
  compute.googleapis.com \
  storage.googleapis.com \
  cloudbuild.googleapis.com \
  servicenetworking.googleapis.com \
  aiplatform.googleapis.com

echo "APIs enabled."

# ============================================================
# Step 2: Create VPC and subnet
# ============================================================
echo ""
echo ">>> Step 2: Creating VPC network..."

# Check if VPC already exists
if ! gcloud compute networks describe "${VPC_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud compute networks create "${VPC_NAME}" \
    --project="${PROJECT_ID}" \
    --subnet-mode=custom
  echo "VPC created: ${VPC_NAME}"
else
  echo "VPC already exists: ${VPC_NAME}"
fi

# Create subnet
if ! gcloud compute networks subnets describe "${SUBNET_NAME}" --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud compute networks subnets create "${SUBNET_NAME}" \
    --project="${PROJECT_ID}" \
    --network="${VPC_NAME}" \
    --region="${REGION}" \
    --range="10.0.0.0/24"
  echo "Subnet created: ${SUBNET_NAME}"
else
  echo "Subnet already exists: ${SUBNET_NAME}"
fi

# Allocate IP range for Private Services Access (AlloyDB uses this)
if ! gcloud compute addresses describe google-managed-services-${VPC_NAME} --global --project="${PROJECT_ID}" &>/dev/null; then
  gcloud compute addresses create google-managed-services-${VPC_NAME} \
    --global \
    --purpose=VPC_PEERING \
    --prefix-length=16 \
    --network="${VPC_NAME}" \
    --project="${PROJECT_ID}"
  echo "IP range allocated for Private Services Access"
else
  echo "Private Services Access IP range already exists"
fi

# Create private connection
gcloud services vpc-peerings connect \
  --service=servicenetworking.googleapis.com \
  --ranges=google-managed-services-${VPC_NAME} \
  --network="${VPC_NAME}" \
  --project="${PROJECT_ID}" || echo "VPC peering already exists or in progress"

# ============================================================
# Step 3: Create Serverless VPC Access connector
# ============================================================
echo ""
echo ">>> Step 3: Creating VPC connector for Cloud Run..."

if ! gcloud compute networks vpc-access connectors describe "${CONNECTOR_NAME}" --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud compute networks vpc-access connectors create "${CONNECTOR_NAME}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network="${VPC_NAME}" \
    --range="10.8.0.0/28" \
    --min-instances=2 \
    --max-instances=3
  echo "VPC connector created: ${CONNECTOR_NAME}"
else
  echo "VPC connector already exists: ${CONNECTOR_NAME}"
fi

# ============================================================
# Step 4: Create AlloyDB cluster + primary instance
# ============================================================
echo ""
echo ">>> Step 4: Creating AlloyDB cluster..."

if [ -z "${ALLOYDB_PASSWORD}" ]; then
  echo "ERROR: Set ALLOYDB_PASSWORD before running this script."
  echo "Example: export ALLOYDB_PASSWORD='your-secure-password'"
  exit 1
fi

if ! gcloud alloydb clusters describe "${ALLOYDB_CLUSTER}" --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud alloydb clusters create "${ALLOYDB_CLUSTER}" \
    --project="${PROJECT_ID}" \
    --region="${REGION}" \
    --network="${VPC_NAME}" \
    --password="${ALLOYDB_PASSWORD}"
  echo "AlloyDB cluster created: ${ALLOYDB_CLUSTER}"
else
  echo "AlloyDB cluster already exists: ${ALLOYDB_CLUSTER}"
fi

echo "Creating AlloyDB primary instance (this takes 5-10 minutes)..."
if ! gcloud alloydb instances describe "${ALLOYDB_INSTANCE}" --cluster="${ALLOYDB_CLUSTER}" --region="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud alloydb instances create "${ALLOYDB_INSTANCE}" \
    --project="${PROJECT_ID}" \
    --cluster="${ALLOYDB_CLUSTER}" \
    --region="${REGION}" \
    --instance-type=PRIMARY \
    --cpu-count=2 \
    --database-flags=max_connections=200
  echo "AlloyDB instance created: ${ALLOYDB_INSTANCE}"
else
  echo "AlloyDB instance already exists: ${ALLOYDB_INSTANCE}"
fi

# Get the AlloyDB IP for later config
ALLOYDB_IP=$(gcloud alloydb instances describe "${ALLOYDB_INSTANCE}" \
  --cluster="${ALLOYDB_CLUSTER}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(ipAddress)" 2>/dev/null || echo "PENDING")
echo "AlloyDB IP: ${ALLOYDB_IP}"

# ============================================================
# Step 5: Create Artifact Registry repo
# ============================================================
echo ""
echo ">>> Step 5: Creating Artifact Registry..."

if ! gcloud artifacts repositories describe "${REPO_NAME}" --location="${REGION}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud artifacts repositories create "${REPO_NAME}" \
    --project="${PROJECT_ID}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="GreenReach Docker images"
  echo "Artifact Registry repo created: ${REPO_NAME}"
else
  echo "Artifact Registry repo already exists: ${REPO_NAME}"
fi

# ============================================================
# Step 6: Create GCS bucket for LE persistent data
# ============================================================
echo ""
echo ">>> Step 6: Creating GCS bucket for LE data..."

if ! gcloud storage buckets describe "gs://${BUCKET_NAME}" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud storage buckets create "gs://${BUCKET_NAME}" \
    --project="${PROJECT_ID}" \
    --location="${REGION}" \
    --uniform-bucket-level-access
  echo "GCS bucket created: ${BUCKET_NAME}"
else
  echo "GCS bucket already exists: ${BUCKET_NAME}"
fi

# ============================================================
# Step 7: Create service accounts
# ============================================================
echo ""
echo ">>> Step 7: Creating service accounts..."

# Central service account
SA_CENTRAL="${CENTRAL_SERVICE}-sa"
if ! gcloud iam service-accounts describe "${SA_CENTRAL}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud iam service-accounts create "${SA_CENTRAL}" \
    --project="${PROJECT_ID}" \
    --display-name="GreenReach Central Cloud Run SA"
  echo "Service account created: ${SA_CENTRAL}"
else
  echo "Service account already exists: ${SA_CENTRAL}"
fi

# LE service account
SA_LE="${LE_SERVICE}-sa"
if ! gcloud iam service-accounts describe "${SA_LE}@${PROJECT_ID}.iam.gserviceaccount.com" --project="${PROJECT_ID}" &>/dev/null; then
  gcloud iam service-accounts create "${SA_LE}" \
    --project="${PROJECT_ID}" \
    --display-name="Light Engine Cloud Run SA"
  echo "Service account created: ${SA_LE}"
else
  echo "Service account already exists: ${SA_LE}"
fi

# Grant permissions
echo "Granting IAM roles..."

# Central: Secret Manager access + AlloyDB client
for ROLE in roles/secretmanager.secretAccessor roles/alloydb.client roles/logging.logWriter roles/monitoring.metricWriter roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_CENTRAL}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}" --quiet
done

# LE: Secret Manager access + GCS read/write + AlloyDB client (for future migration)
for ROLE in roles/secretmanager.secretAccessor roles/storage.objectAdmin roles/alloydb.client roles/logging.logWriter roles/monitoring.metricWriter roles/aiplatform.user; do
  gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
    --member="serviceAccount:${SA_LE}@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role="${ROLE}" --quiet
done

echo "IAM roles granted."

# ============================================================
# Step 8: Create Secret Manager secrets (empty - populate separately)
# ============================================================
echo ""
echo ">>> Step 8: Creating Secret Manager secrets..."

# Secrets shared by both services
SHARED_SECRETS=(
  "JWT_SECRET"
  "WHOLESALE_JWT_SECRET"
  "WHOLESALE_FARM_API_KEY"
  "GREENREACH_API_KEY"
)

# Central-only secrets
CENTRAL_SECRETS=(
  "ALLOYDB_PASSWORD"
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

# LE-only secrets
LE_SECRETS=(
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

ALL_SECRETS=("${SHARED_SECRETS[@]}" "${CENTRAL_SECRETS[@]}" "${LE_SECRETS[@]}")

for SECRET in "${ALL_SECRETS[@]}"; do
  if ! gcloud secrets describe "${SECRET}" --project="${PROJECT_ID}" &>/dev/null; then
    echo -n "placeholder" | gcloud secrets create "${SECRET}" \
      --project="${PROJECT_ID}" \
      --replication-policy="user-managed" \
      --locations="${REGION}" \
      --data-file=-
    echo "  Created secret: ${SECRET}"
  else
    echo "  Secret already exists: ${SECRET}"
  fi
done

echo ""
echo "============================================"
echo "GCP Infrastructure Setup Complete"
echo "============================================"
echo ""
echo "NEXT STEPS:"
echo "  1. Populate secrets with production values:"
echo "     echo -n 'your-value' | gcloud secrets versions add SECRET_NAME --data-file=-"
echo ""
echo "  2. Get AlloyDB IP for database connection:"
echo "     AlloyDB IP: ${ALLOYDB_IP}"
echo ""
echo "  3. Run the database migration (pg_dump from RDS, pg_restore to AlloyDB)"
echo ""
echo "  4. Build and push Docker images (see deploy-cloud-run.sh)"
echo ""
echo "  5. Deploy Cloud Run services (see deploy-cloud-run.sh)"
echo ""
echo "Registry URL: ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
echo "GCS Bucket:   gs://${BUCKET_NAME}"
