# Claude Project Briefing: Light-Engine-Foxtrot

Last updated: 2026-04-26

## 0) HARD RULE — Always Use Production Data

**Never reference local data files (`/public/data/rooms.json`, `/public/data/groups.json`,
`/public/data/grow-systems.json`, etc.) to determine current state. Local files are stale.**

Always `curl` from production first:
```bash
curl -s "https://greenreachgreens.com/data/rooms.json"
curl -s "https://greenreachgreens.com/data/groups.json"
curl -s "https://light-engine-1029387937866.us-east1.run.app/api/rooms"
```

This applies to: room dimensions, group counts, grow system templates, sensor data,
inventory, any runtime state. Use local `.js`/`.html`/`.css` source files for
code reading and editing — never local JSON data files for current state.


## 1) Project Scope (Current Reality)

This is a Cloud Run production system with two independent Node services from one monorepo.

- Light Engine (LE)
  - Entry: `server-foxtrot.js`
  - Cloud Run service: `light-engine`
  - URL: `https://light-engine-1029387937866.us-east1.run.app`
  - Role: Farm UI, room/group persistence, sensor and automation flows.

- GreenReach Central
  - Entry: `greenreach-central/server.js`
  - Cloud Run service: `greenreach-central`
  - Public domain: `https://greenreachgreens.com`
  - Role: Hub APIs, auth, admin, notifications, multi-farm operations.

Production is Google Cloud Run in `us-east1` for project `project-5d00790f-13a9-4637-a40`.

Important: AWS deployment docs exist in repo but are not the current production path for this project.

**GitHub Pages is NOT production.** `deploy-pages.yml` creates a static read-only demo at
`https://greenreach2024.github.io/Light-Engine-Foxtrot/` and is `workflow_dispatch` only.
Never treat a GitHub Pages deployment as evidence that code is live in production.
Production evidence = a successful `deploy-cloud-run.yml` run for the commit in question.

## 2) Access Setup Claude Must Have

Claude operator requirements:

1. CLI auth
- `gcloud auth login`
- `gcloud config set project project-5d00790f-13a9-4637-a40`
- `gcloud auth application-default login` (if needed for SDK calls)

2. Cloud Run + Logs permissions
- Read/describe/deploy access for:
  - `light-engine`
  - `greenreach-central`
- Logging Viewer for `gcloud logging read`

3. Repo + git access
- Local repo path: `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot`
- Push rights to `origin`

4. VS Code and Claude extension
- Extension id: `anthropic.claude-code`
- Claude CLI must be logged in (`claude auth status` should show `loggedIn: true`).

## 3) Authoritative Docs (Read In This Order)

1. `README.md`
- Canonical architecture, service mapping, deploy model, and branch drift warning.

2. `.github/CLOUD_ARCHITECTURE.md`
- Full architecture source of truth.

3. `.github/CRITICAL_CONFIGURATION.md`
- Env vars, secrets, critical runtime config.

4. `.github/COMPLETE_SYSTEM_MAP.md`
- Endpoints/pages/data flow map.

5. `docs/audits/GROW_MANAGEMENT_FULL_AUDIT_2026-04-24.md`
- Detailed Grow Management audit findings and gap list.

6. `docs/audits/FARM_SETUP_GROW_MGMT_INVENTORY_2026-04-24.md`
- Inventory of setup/grow management pages, APIs, data, and tech debt.

7. `docs/wholesale/WHOLESALE_NOTIFICATION_FLOW.md`
- Notification behavior and intended order logistics flow.

## 4) Recent History (Most Relevant)

Recent commits on `main`:

- `a28c5549` Fix: apply production readiness corrections from 2026-04-25 audit
- `0d9bc4bb` docs: add Claude project access and operations briefing
- `e38d1b5b` fix(sync): preserve installed systems on sparse save-rooms payloads
- `115b1016` fix(ui): restore zone-recommendations API route and remove stale 3D CSS links

Operational context:

- Production readiness audit completed 2026-04-25. rooms.json/groups.json restored,
  zone geometry serializer fixed, migration 062 deployed, EB artifacts archived.
- farm-api-keys.json removed from git — active farm API key must be rotated via DB.
- SMS_RECIPIENTS is now controlled by env var (not hardcoded in sms-service.js).

## 5) Known Active Issues (High Priority)

### Data drift risk

- Duplicated data trees and multi-surface writes still create drift risks.
- Always verify persisted LE endpoints after edits:
  - `/data/rooms.json`
  - `/data/groups.json`

### Resolved — 2026-04-25 (commit a28c5549)

The following issues were resolved in the production readiness audit:

- **Grow Management unit reversion**: rooms.json restored (1 room, 2 zones) and groups.json
  restored (78 ZipGrow Standard groups). Root cause was accidental wipe in commit `e9a2be89`.
- **Zone geometry not persisted**: `zoneRectsFromRoom()` now reads saved `length_m`/`width_m`
  per zone instead of always computing equal splits.
- **Missing DB tables**: Migration 062 adds `loss_events` + `accounting_ledger_entries`.
  Both auto-create on next deploy via `runMigrations()`.
- **farm-api-keys.json**: Removed from git tracking. **Rotate the active farm API key** via
  the `farms` table — the key was in git history and should be treated as compromised.
- **SMS allowlist**: Moved from hardcoded `Map` to `SMS_RECIPIENTS` env var. See Section 6.
- **AWS EB artifacts**: Archived to `archive/eb-deprecated/`.

## 6) Notification Status (As Implemented)

From code and docs:

1. Email notifications
- Implemented in `services/wholesale-notification-service.js` via nodemailer.
- Requires SMTP env vars (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).

2. SMS notifications
- Implemented in `greenreach-central/services/sms-service.js` via email-to-SMS gateway.
- Recipients controlled by `SMS_RECIPIENTS` env var (no redeploy needed to add numbers).
- Format: JSON `[{"+16138881031":"6138881031@txt.bell.ca"}]` or CSV `+1xxx:gateway@carrier.com`.
- Falls back to the seeded Bell number if `SMS_RECIPIENTS` is not set.

3. Push notifications
- Implemented in `services/push-notification-service.js` using Firebase Admin.
- Disabled unless `FIREBASE_SERVICE_ACCOUNT_PATH` is configured.

4. In-app EVIE notifications
- Central notification persistence in `greenreach-central/services/notification-store.js` (`farm_notifications` table).
- Wholesale service attempts EVIE push via Central API endpoint.

## 7) Cloud Run Operational Commands

Use these first during diagnosis:

```bash
# Service revision + traffic
gcloud run services describe light-engine \
  --project=project-5d00790f-13a9-4637-a40 --region=us-east1 \
  --format='value(status.latestReadyRevisionName,status.traffic[0].revisionName,status.traffic[0].percent)'

gcloud run services describe greenreach-central \
  --project=project-5d00790f-13a9-4637-a40 --region=us-east1 \
  --format='value(status.latestReadyRevisionName,status.traffic[0].revisionName,status.traffic[0].percent)'

# Logs (recent)
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=light-engine" \
  --project=project-5d00790f-13a9-4637-a40 --freshness=2h --limit=100

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=greenreach-central" \
  --project=project-5d00790f-13a9-4637-a40 --freshness=2h --limit=100
```

## 8) Guardrails For Claude Work In This Repo

1. Never assume old AWS docs reflect current production behavior.
2. Treat LE endpoints as canonical for room/group persistence checks.
3. After any change affecting runtime behavior, verify live payloads and logs.
4. If code changes are made, commit and push to origin (no local-only fixes).
5. Prefer minimal, targeted fixes over broad refactors during incident handling.

## 9) Quick Incident Checklist (Grow Mgmt)

```bash
# 1) Verify persisted state
curl -s https://greenreachgreens.com/data/rooms.json | jq '.rooms[0]'
curl -s https://greenreachgreens.com/data/groups.json | jq '.groups | length'

# 2) Verify save/reconcile logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=light-engine AND textPayload:(\"[setup/save-rooms]\" OR \"[reconcile-groups]\")" \
  --project=project-5d00790f-13a9-4637-a40 --freshness=2h --limit=100 \
  --format='value(timestamp,textPayload)'

# 3) If state and logs mismatch UI, clear cache and retest in iframe context.
```
