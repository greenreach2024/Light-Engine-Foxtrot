# GCP Cloud-Native Status (Current)

Last updated: 2026-04-17

Canonical references: `.github/CLOUD_ARCHITECTURE.md`, `.github/GCP_MIGRATION_REMAINING.md`, `.github/SECRET_STATUS.md`

## Completed Foundations

- Cloud Run dual-service architecture is active (`light-engine`, `greenreach-central`).
- AlloyDB is the relational database backend.
- `gs://greenreach-storage` is mounted at `/app/data` for persisted file-backed stores.
- Cloud Scheduler keepalive and sensor sync jobs are active.
- LE proxy boundary is in place for Central-backed admin and assistant APIs.
- Branch protection on `main` is enabled with required check `validate-and-test`.
- E.V.I.E. room/zone LE writeback now uses a durable retry queue with DLQ handling.
- Secret readiness tracking is centralized in `.github/SECRET_STATUS.md`.

## Next Steps

### 1. CI Gate Reliability

- Keep `validate-and-test` green on merge commits.
- Investigate and eliminate flaky checks that create bypass pressure.
- Periodically verify branch-protection policy drift has not occurred.

### 2. Secrets and Integration Health

- Clear remaining placeholder/missing entries tracked in `.github/SECRET_STATUS.md`.
- Validate production values for SwitchBot, SMTP, Square, Stripe, and QuickBooks.
- Keep SMS routing configuration explicit (`ADMIN_ALERT_PHONE`, `SMS_APPROVED_RECIPIENTS`, optional `SMS_GATEWAY_OVERRIDES`).

### 3. Domain and SSL Validation

- Confirm `greenreachgreens.com` resolves to Central.
- Confirm SSL status is valid and stable.

### 4. Observability Hardening

- Ensure alert policies exist for 5xx, latency, and instance pressure.
- Verify scheduler jobs and sensor sync freshness.

### 5. Data Contract Consistency

- Keep `schemaVersion` in shared JSON data contracts across both public data trees.
- Keep duplicated static assets synchronized between service bundles when required.

## Notes

- This file supersedes older migration-stage notes that referenced AWS-era procedures.
- For architecture details, use `.github/CLOUD_ARCHITECTURE.md` as source of truth.
