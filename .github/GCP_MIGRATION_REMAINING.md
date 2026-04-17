# GCP Migration -- Remaining Items (Current)

Last reviewed: 2026-04-17
Scope: Google Cloud Run production operations only
Canonical references: `.github/CLOUD_ARCHITECTURE.md`, `.github/SENSOR_DATA_PIPELINE.md`, `.github/SECRET_STATUS.md`

## Current Baseline

- Elastic Beanstalk migration is complete; production runtime is Google Cloud Run.
- The platform is split across two services in `us-east1`:
  - `light-engine` (LE): sensor and device layer, root `public/`
  - `greenreach-central` (Central): admin and assistant APIs, `greenreach-central/public/`
- Both services use Direct VPC egress on `greenreach-vpc` / `greenreach-subnet`.
- AlloyDB and `gs://greenreach-storage` are the active persistence layers.

## Recently Closed

- Branch protection is enabled on `main` with required check `validate-and-test`.
- `main` branch protection is strict and admin-enforced.
- E.V.I.E. LE writeback now includes durable queue + DLQ handling for `rooms.json` sync failures.
- Canonical secret status tracking is consolidated in `.github/SECRET_STATUS.md`.

## Remaining Work

### P1 -- Runtime Configuration

1. Remove placeholder/missing values listed in `.github/SECRET_STATUS.md` for enabled integrations.
2. Ensure SMS configuration is explicit in production:
   - `ADMIN_ALERT_PHONE`
   - `SMS_APPROVED_RECIPIENTS` (JSON map)
   - `SMS_GATEWAY_OVERRIDES` (optional JSON map)
3. Verify SwitchBot, Square, Stripe, and SMTP credentials align with active production services.

### P1 -- Access and Routing Validation

1. Confirm `greenreachgreens.com` resolves to Central with valid SSL.
2. Confirm LE-hosted pages reach Central-backed APIs through LE proxy paths (`/api/...`) with no cross-origin redirects.

### P2 -- Observability and Resilience

1. Verify Cloud Monitoring alert policies for 5xx, latency, and instance saturation.
2. Verify Cloud Scheduler jobs (`sensor-sync-cron`, keepalives) and recent successful executions.
3. Validate backup and recovery posture for AlloyDB and `gs://greenreach-storage`.

### P2 -- Data Contract Hygiene

1. Keep `schemaVersion` in shared JSON contracts under both public data directories.
2. Keep duplicated static assets synchronized where both service bundles require copies.

## Deployment Rules (Cloud Run Only)

- Build with `--platform linux/amd64`.
- Deploy both services when a change spans both boundaries.
- Prefer immutable digest deploys (`@sha256:`) after push verification.
- Use only `docker buildx build --push` and `gcloud run services update` for production deploys.

## Prohibited Workflows

- `eb` CLI usage
- `aws elasticbeanstalk` deployment or teardown commands

## Verification Checklist

- [x] Branch protection requires `validate-and-test` on `main`.
- [x] Branch protection strict mode is enabled.
- [ ] `validate-and-test` is consistently green on merge commits.
- [ ] Central and LE health checks are healthy.
- [ ] LE proxy-backed admin and assistant routes are reachable from LE-hosted UI.
- [ ] Secret Manager has no placeholder values for enabled integrations.
