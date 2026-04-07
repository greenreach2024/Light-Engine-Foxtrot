# GCP Cloud-Native Migration Status

Last updated: April 7, 2026

## COMPLETED

### 1. Google Cloud Storage (GCS) -- DONE
- Bucket created: gs://greenreach-storage (us-east1, uniform access, public access prevented)
- Both service accounts granted roles/storage.objectAdmin
- @google-cloud/storage SDK installed in both packages
- GCS helper modules created:
  - greenreach-central/services/gcs-storage.js (central/ prefix)
  - services/gcs-storage.js (le/ prefix)
- Auto-detects Cloud Run via K_SERVICE env var; falls back to local filesystem in dev

### 2. Files Migrated Off Local Filesystem -- DONE
- custom-products.js: Image uploads now go to GCS via uploadFile() instead of fs.writeFileSync
- admin-pricing.js: crop-pricing.json and crop-registry.json reads/writes use gcsReadJSON/gcsWriteJSON
- farm-ops-agent.js: writeJSON() now dual-writes (local + GCS async); audit log persisted to GCS
- syncMonitor.js: Snapshot persistence uses GCS on Cloud Run, local filesystem in dev
- assistant-chat.js: System alerts now use AlloyDB as primary (removed local file writes)

### 3. GCS FUSE Volume Mount -- DONE
- Both Cloud Run services mount gs://greenreach-storage at /app/data via Cloud Storage FUSE
- NeDB datastores (21 total in server-foxtrot.js) write to /app/data/ which persists via GCS
- Env vars set: USE_GCS=true, GCS_BUCKET=greenreach-storage

### 4. Cloud Scheduler -- DONE
- Enabled Cloud Scheduler API
- Created scheduler-invoker service account with roles/run.invoker on both services
- 3 jobs created:
  - sensor-sync-keepalive: GET /api/health on LE every 5 min (keep warm)
  - central-keepalive: GET /api/health on Central every 5 min (keep warm)
  - sensor-sync-cron: POST /api/cron/sensor-sync on LE every 2 min (explicit sensor pull)
- Added /api/cron/sensor-sync endpoint to server-foxtrot.js (validates Cloud Scheduler User-Agent)

## REMAINING

### 5. AlloyDB Data Migration (from AWS RDS)
The AlloyDB cluster (greenreach-db at 10.87.0.2) is running but the database is empty.
- Need to pg_dump from AWS RDS production database
- Import schema and data into AlloyDB
- Verify all migrations run cleanly (029+ migration files)

### 6. DNS Migration
- greenreachgreens.com custom domain needs DNS records pointed to Cloud Run
- Currently pending DNS migration from Route 53 to Cloud DNS (or direct CNAME)

### 7. Secret Manager Placeholders
Several secrets are still placeholder values (need real production credentials):
- SWITCHBOT_TOKEN, SWITCHBOT_SECRET (sensor data)
- SMTP_PASS (email notifications)
- STRIPE_* keys (payment processing)
- AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (SES email -- may migrate to SendGrid/Mailgun)
