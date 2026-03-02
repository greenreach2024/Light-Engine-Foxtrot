# Prioritized Build Checklist — March 1, 2026

Scope: Remaining work from Feb 27/28/Mar 1 plans, normalized into implementation order.

## P0 — Revenue/Security Blockers (Do First)

### P0-1) De-stub Central farm-sales critical surfaces

**Current gap**
- Farm-sales route still contains stubbed subsystems (QuickBooks + AI status/chat placeholders).

**Primary files**
- `greenreach-central/routes/farm-sales.js`
- `greenreach-central/server.js` (route wiring only if needed)

**Build tasks**
- Replace QuickBooks placeholder responses with real integration status sourced from persistent store.
- Replace farm-sales AI placeholder responses to proxy/live status from active AI services.
- Keep existing response keys backward-compatible for current UI consumers.

**Acceptance checks**
- `GET /api/farm-sales/quickbooks/status` returns real state (not hardcoded not_configured unless truly unconfigured).
- `POST /api/farm-sales/quickbooks/sync-invoices` attempts real sync path and records outcome.
- `GET /api/farm-sales/ai-agent/status` reflects runtime state and config, not static placeholder.

---

### P0-2) Remove/retire misc stub router from active API path

**Current gap**
- Misc stubs router is still mounted at app root and can shadow operational behavior.

**Primary files**
- `greenreach-central/server.js`
- `greenreach-central/routes/misc-stubs.js`

**Build tasks**
- Unmount root-level stub router from production-serving path.
- If compatibility aliases are required, move only required aliases into explicit non-stub routes.
- Keep deprecation map for any removed endpoints.

**Acceptance checks**
- No critical `/api/*` route is served by misc stubs in production mode.
- Startup route map confirms canonical handlers are mounted for AI, orders, billing, reports, sync.

---

### P0-3) Replace Square payment STUB path in Central

**Current gap**
- Square payment service in Central is still explicitly stubbed.

**Primary files**
- `greenreach-central/services/squarePaymentService.js`
- `greenreach-central/routes/wholesale.js` (or consumers of payment service)

**Build tasks**
- Implement real provider-backed payment processing path (or hard-disable with explicit non-success response if provider unavailable).
- Remove fake-success behavior in stub mode to avoid false financial success signals.
- Preserve audit logging and idempotency semantics.

**Acceptance checks**
- Payment attempt without valid provider config fails with explicit configuration error (not success).
- Payment attempt with valid provider config records provider IDs and status transitions.
- No test/demo pseudo-payment IDs returned in production mode.

---

### P0-4) Complete transport security infra proof (CloudFront/HTTPS evidence)

**Current gap**
- Code-side HTTPS hardening exists, but infra completion evidence is missing in repo audit.

**Primary artifacts**
- Ops runbook/evidence docs under repo root (new evidence doc recommended).

**Build tasks**
- Record deployed CloudFront distribution ID, ACM cert ARN, and FOXTROT_API_URL value.
- Verify Central→Foxtrot calls resolve to HTTPS endpoint.
- Capture evidence for no plaintext production traffic on Foxtrot paths.

**Acceptance checks**
- Evidence package includes successful HTTPS endpoint checks and cert chain validation.
- FOXTROT_API_URL in production points to HTTPS domain.
- Webhook signature verification active in production paths.

---

## P1 — Finance Automation Completion

### P1-1) Finish accounting schema coverage + migration safety checks

**Current gap**
- Accounting routes/connectors exist, but schema lifecycle evidence is incomplete in this audit.

**Primary files**
- `greenreach-central/config/database.js`
- `greenreach-central/routes/accounting.js`

**Build tasks**
- Ensure all accounting tables referenced by routes/services are created in bootstrap/migration path.
- Add startup verification log block for accounting table readiness.

**Acceptance checks**
- Cold start on empty DB creates required accounting tables.
- `GET /api/accounting/health` reports ready.
- `POST /api/accounting/transactions/ingest` succeeds with balanced entries and idempotency.

---

### P1-2) Add GitHub billing connector (planned, not yet implemented)

**Current gap**
- AWS connector exists; GitHub billing connector from finance plan is missing.

**Primary files (new)**
- `greenreach-central/services/githubBillingSync.js`
- `greenreach-central/routes/accounting.js` (connector endpoint)
- `greenreach-central/server.js` (optional scheduler startup)

**Build tasks**
- Implement ingestion for GitHub org billing usage.
- Map costs into canonical accounting transactions with idempotency keys.
- Add manual trigger endpoint + optional scheduler.

**Acceptance checks**
- Connector dry-run returns parsed usage rows and totals.
- Live sync inserts/upserts accounting transactions with source `github_billing`.
- Duplicate sync window does not duplicate ledger entries.

---

### P1-3) Add valuation snapshots workflow

**Current gap**
- Finance plan calls for baseline and periodic valuation snapshots; no clear runtime endpoint flow found.

**Primary files (new/updated)**
- `greenreach-central/routes/accounting.js` or dedicated `greenreach-central/routes/valuation.js`
- `greenreach-central/config/database.js` (if `valuation_snapshots` table not present)

**Build tasks**
- Add endpoint to save valuation snapshot with method, assumptions, low/base/high band, confidence.
- Add listing endpoint with date filters.

**Acceptance checks**
- Can create and retrieve valuation snapshots.
- Snapshots include assumptions payload and confidence metadata.
- Quarterly rerun process is scriptable/documented.

---

### P1-4) QuickBooks as downstream accounting export/sync

**Current gap**
- Farm-sales QuickBooks route still indicates not configured.

**Primary files**
- `greenreach-central/routes/farm-sales.js`
- `greenreach-central/routes/accounting.js` (if export adapter belongs here)

**Build tasks**
- Implement export adapter from canonical ledger to QuickBooks-compatible payload/CSV.
- Add sync run result object with counts and failures.

**Acceptance checks**
- Export endpoint emits deterministic QuickBooks-compatible data.
- Sync result includes idempotent run metadata.
- Failure paths return actionable diagnostics.

---

## P1 — Operational Hardening Follow-through

### P1-5) Finalize test gate closure and keep CI green

**Current state**
- CI modernization landed; keep it green as stub replacement proceeds.

**Primary files**
- `.github/workflows/ci.yml`
- `tests/*.mjs`

**Acceptance checks**
- `npm run validate-schemas` passes.
- `npm test` passes or only has documented, accepted exceptions.
- Deterministic wholesale smoke suite passes in CI.

---

## Execution Order

1. P0-1 farm-sales de-stub
2. P0-2 remove misc stubs from active path
3. P0-3 Square payment stub replacement
4. P0-4 transport security infra evidence
5. P1-1 accounting schema verification
6. P1-2 GitHub billing connector
7. P1-3 valuation snapshots
8. P1-4 QuickBooks downstream sync
9. P1-5 regression + CI stabilization sweep

---

## Definition of Done (Program Level)

- No critical Central revenue/security endpoint returns placeholder/stub payloads.
- Payment and accounting paths are deterministic, auditable, and idempotent.
- AI metrics/feedback and sync monitoring remain operational after de-stubbing.
- CI gates (schema + tests + smokes) pass on mainline.
- Revenue-readiness evidence package is complete and reproducible.
