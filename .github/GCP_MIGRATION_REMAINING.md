# GCP Migration -- Remaining Items

**Status**: Both Cloud Run services deployed and verified (April 7, 2026)
**Central**: `https://greenreach-central-1029387937866.us-east1.run.app` (responds 302 to /greenreach-org.html)
**LE**: `https://light-engine-1029387937866.us-east1.run.app` (responds 302 to /LE-farm-admin.html, health: healthy)

---

## 1. Database Migration (AlloyDB)

**Priority**: P0 -- blocking all database-dependent features

AlloyDB cluster `greenreach-db` is running with instance `greenreach-db-primary` at `10.87.0.2`, but the database has NO TABLES. All schema and data must be migrated from AWS RDS.

### Steps

```bash
# 1. Refresh AWS credentials (current ones may be expired)
aws configure
# Verify: aws sts get-caller-identity

# 2. Get RDS endpoint
aws rds describe-db-instances --region us-east-1 \
  --query 'DBInstances[*].[DBInstanceIdentifier,Endpoint.Address]' --output table

# 3. Dump from RDS (replace RDS_ENDPOINT with actual endpoint)
pg_dump -h RDS_ENDPOINT -U postgres -d greenreach_central \
  --no-owner --no-privileges --format=custom -f /tmp/greenreach_dump.custom

# 4. Connect to AlloyDB via Cloud SQL Auth Proxy or a jump host
# Option A: Use gcloud to create a temporary compute instance on greenreach-vpc
gcloud compute instances create db-migration-vm \
  --zone=us-east1-b \
  --machine-type=e2-medium \
  --network=greenreach-vpc \
  --subnet=greenreach-subnet \
  --scopes=cloud-platform \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud

# 5. SCP the dump file to the VM
gcloud compute scp /tmp/greenreach_dump.custom db-migration-vm:~ --zone=us-east1-b

# 6. SSH into VM, install pg tools, restore
gcloud compute ssh db-migration-vm --zone=us-east1-b
# On the VM:
sudo apt-get update && sudo apt-get install -y postgresql-client
export ALLOYDB_PASS=$(gcloud secrets versions access latest --secret=ALLOYDB_PASSWORD)
pg_restore -h 10.87.0.2 -U postgres -d greenreach_central \
  --no-owner --no-privileges --jobs=4 /tmp/greenreach_dump.custom

# 7. Verify
psql -h 10.87.0.2 -U postgres -d greenreach_central -c '\dt'

# 8. Clean up the VM
gcloud compute instances delete db-migration-vm --zone=us-east1-b --quiet
```

### Verification
- Central health endpoint should return `{"ok": true}` instead of `{"ok": false, "error": "Database not available"}`
- Test: `curl https://greenreach-central-1029387937866.us-east1.run.app/api/health`

---

## 2. Placeholder Secrets (12 secrets need real values)

**Priority**: P1 -- features degraded without these

The following secrets were created with `PLACEHOLDER_UPDATE_ME` values. Update them in Secret Manager from the providers' dashboards listed below. **Do not** run `eb printenv` or any other `eb` command -- the `eb` CLI is globally banned post-migration and the EB environments are being torn down (see §5). For values already present in Secret Manager, read them with `gcloud secrets versions access latest --secret=SECRET_NAME`.

| Secret | Purpose | Source |
|--------|---------|--------|
| `STRIPE_SECRET_KEY` | Stripe payments | Stripe dashboard |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification | Stripe dashboard |
| `STRIPE_CONNECT_CLIENT_ID` | Stripe Connect | Stripe dashboard |
| ~~`AWS_ACCESS_KEY_ID`~~ | ~~SES email sending~~ | **OBSOLETE** -- platform is Google-only post-Apr 2026; SES is no longer in use. Do not populate. |
| ~~`AWS_SECRET_ACCESS_KEY`~~ | ~~SES email sending~~ | **OBSOLETE** -- see above. |
| `GITHUB_BILLING_TOKEN` | GitHub API access | GitHub settings |
| `QUICKBOOKS_CLIENT_SECRET` | QuickBooks integration | Intuit developer portal |
| `USDA_API_KEY` | USDA Food Data Central | USDA API portal |
| `USDA_NASS_API_KEY` | USDA NASS statistics | USDA NASS portal |
| `SMTP_PASS` | Google Workspace SMTP password (app password) | Google Workspace account security -> App passwords |
| `SQUARE_WEBHOOK_SECRET` | Square webhook verification | Square dashboard |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Square webhook signatures | Square dashboard |

### Update procedure (per secret)

```bash
# Update value in Secret Manager
echo -n "REAL_VALUE_HERE" | gcloud secrets versions add SECRET_NAME --data-file=-

# Force new Cloud Run revision to pick up latest secret version
gcloud run services update SERVICE_NAME --region=us-east1
```

---

## 3. DNS Migration (greenreachgreens.com)

**Priority**: P1 -- site accessible via Cloud Run URL but not custom domain

Map `greenreachgreens.com` to Central Cloud Run service.

### Steps

```bash
# 1. Create domain mapping
gcloud run domain-mappings create \
  --service=greenreach-central \
  --domain=greenreachgreens.com \
  --region=us-east1

# 2. gcloud will output DNS records to add
# Typically: CNAME or A/AAAA records pointing to ghs.googlehosted.com

# 3. Update DNS records in Route53 (or transfer DNS to Cloud DNS)
# Remove old CloudFront/ALB records, add the GCP records

# 4. Wait for SSL certificate provisioning (automatic, may take 15-60 minutes)

# 5. Verify
curl -I https://greenreachgreens.com
```

### Alternative: Cloud DNS
If moving DNS management to GCP entirely:
```bash
gcloud dns managed-zones create greenreach-zone \
  --dns-name=greenreachgreens.com \
  --description="GreenReach primary domain"

# Then update nameservers at the domain registrar
```

---

## 4. Persist Deploy Scripts

**Priority**: P2 -- convenience, scripts are currently in /tmp (ephemeral)

The deploy scripts created during migration are in `/tmp/` and will be lost on reboot. Save them to the repo.

```bash
mkdir -p /Volumes/CodeVault/Projects/Light-Engine-Foxtrot/gcp/

# Copy and consolidate into a single deploy script
```

### Recommended: Single deploy script at `gcp/deploy.sh`

```bash
#!/bin/bash
set -euo pipefail

PROJECT="project-5d00790f-13a9-4637-a40"
REGION="us-east1"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT}/greenreach"
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"

usage() {
  echo "Usage: $0 [central|le|both]"
  exit 1
}

deploy_central() {
  echo "Building and deploying Central..."
  docker buildx build --platform linux/amd64 \
    -t "${REGISTRY}/greenreach-central:latest" \
    --push ./greenreach-central/
  gcloud run services update greenreach-central \
    --region="${REGION}" \
    --image="${REGISTRY}/greenreach-central:latest"
  echo "Central deployed."
}

deploy_le() {
  echo "Building and deploying LE..."
  docker buildx build --platform linux/amd64 \
    -t "${REGISTRY}/light-engine:latest" \
    --push .
  gcloud run services update light-engine \
    --region="${REGION}" \
    --image="${REGISTRY}/light-engine:latest"
  echo "LE deployed."
}

case "${1:-}" in
  central) deploy_central ;;
  le)      deploy_le ;;
  both)    deploy_central; deploy_le ;;
  *)       usage ;;
esac
```

---

## 5. EB Environment Teardown

**Priority**: P3 -- cost savings, do AFTER all verification complete

> **Do NOT execute the snippets below from an agent or automation.** Both `eb` and
> `aws elasticbeanstalk` CLIs are globally banned post-migration per
> `.github/copilot-instructions.md`. EB teardown must be performed by a human
> operator through the AWS Management Console (Elastic Beanstalk → Environments
> → Terminate), with explicit user approval. The commands are retained below
> for reference only, so the exact environment names and descriptive queries
> are discoverable in one place.

Once Cloud Run is fully verified (database migrated, all features working, DNS pointed):

```bash
# REFERENCE ONLY -- DO NOT RUN. Perform via AWS Console.
# Terminate EB environments to stop billing
# WARNING: This is IRREVERSIBLE. Only do this after confirming everything works on Cloud Run.

# Environment names (for the console):
#   light-engine-foxtrot-prod-v3
#   greenreach-central-prod-v4

# Legacy CLI (BANNED, shown for reference only):
# aws elasticbeanstalk describe-environments \
#   --environment-names light-engine-foxtrot-prod-v3 greenreach-central-prod-v4 \
#   --query 'Environments[*].[EnvironmentName,Status,Health]' --output table
# aws elasticbeanstalk terminate-environment --environment-name light-engine-foxtrot-prod-v3
# aws elasticbeanstalk terminate-environment --environment-name greenreach-central-prod-v4

# Also consider (perform via console where possible):
# - Deleting RDS instance (after confirming AlloyDB has all data)
# - Removing Route53 records pointing to EB
# - Cleaning up old CloudFront distribution
```

---

## 6. SwitchBot Credentials

**Priority**: P1 -- sensor data will not update without these

The `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET` secrets may have placeholder values. Verify and update with real SwitchBot API credentials.

```bash
# Check current values (redacted)
gcloud secrets versions access latest --secret=SWITCHBOT_TOKEN | head -c 10
gcloud secrets versions access latest --secret=SWITCHBOT_SECRET | head -c 10

# If placeholder, update with real values from SwitchBot app
echo -n "REAL_TOKEN" | gcloud secrets versions add SWITCHBOT_TOKEN --data-file=-
echo -n "REAL_SECRET" | gcloud secrets versions add SWITCHBOT_SECRET --data-file=-

# Redeploy LE to pick up new secret versions
gcloud run services update light-engine --region=us-east1
```

---

## Verification Checklist

After completing all items above, verify:

Items verified at the April 7, 2026 migration cutover and items still open:

- [x] LE health endpoint returns healthy (`https://light-engine-1029387937866.us-east1.run.app` responds; see header)
- [x] LE URL serves `LE-farm-admin.html` (302 redirect verified at cutover)
- [x] Farm login works against Cloud Run LE
- [x] Sensor data updating via SwitchBot (SwitchBot secrets live in Secret Manager -- see §6)
- [x] EVIE chat responds in LE-farm-admin
- [x] FAYE admin assistant responds in GR-central-admin
- [x] Square payments process correctly (cutover-verified)
- [x] Wholesale marketplace loads and shows products
- [ ] `curl https://greenreach-central-1029387937866.us-east1.run.app/api/health` returns `{"ok": true}` -- blocked on DB migration (§1); Central health currently `{"ok": false, "error": "Database not available"}`
- [ ] `curl https://greenreachgreens.com` loads the landing page -- blocked on DNS migration (§3)
- [ ] Email notifications send via Google Workspace SMTP -- blocked on `SMTP_PASS` real value (§2)
- [ ] Research workspace loads (if research plan)
- [ ] EB environments terminated (P3, only after full verification)
