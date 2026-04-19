# 08 — DevOps & Deployment Playbook

**Owner:** Platform engineers
**Canonical reference:** `.github/CLOUD_ARCHITECTURE.md` (read this in full before any deploy)
**Related docs:** `.github/DEPLOYMENT_CHECKLIST.md`, `.github/GCP_MIGRATION_REMAINING.md`, `CONTRIBUTING.md`

---

## 1. Purpose & scope

Foxtrot is **100% cloud-based** on Google Cloud, deployed as **two independent Cloud Run services** from a single monorepo. AWS Elastic Beanstalk was deprecated April 2026. This playbook covers deployment, secrets, networking, the dual-deploy file registry rule, and the hard "never" list. Read this before running any `gcloud`, any `docker build`, any push to main, or any env-var change.

## 2. High-level topology

```
                  ┌─────────────────────────────────────────────┐
                  │  Google Cloud (project-5d00790f-13a9-...)   │
                  │  Region: us-east1                            │
                  │                                              │
   light-engine-*.run.app    ┌─────────────────────────┐          │
   (LE Cloud Run URL;        │ Cloud Run: light-engine │          │
    LE has no custom         │ 1029387937866.us-east1  │──┐       │
    domain today)            └─────────────────────────┘  │       │
                                                          ▼       │
   greenreachgreens.com      ┌─────────────────────────┐ ┌──────┐ │
   (Central's custom      ──▶│ Cloud Run: greenreach-  │─│AlloyDB│ │
    domain, pending DNS      │ central                 │ │greenreach-db│
    migration from CloudFront└─────────────────────────┘ │private IP  │
    to Central Cloud Run)                                │10.87.0.2   │
                                                         └──────┘
   *.greenreachgreens.com                                            │
   (per-farm subdomain                                               │
    routing — PLANNED,                                               │
    not live today)           Artifact Registry          Cloud Storage
                              Cloud Scheduler            Cloud Logging
                              Secret Manager
```

## 3. Service URLs

| Service | URL | Purpose |
|---|---|---|
| Light Engine | `https://light-engine-1029387937866.us-east1.run.app` | Farm runtime (LE) |
| GreenReach Central | `https://greenreach-central-1029387937866.us-east1.run.app` | Admin + wholesale + marketing + research |
| Central custom domain | `greenreachgreens.com` | Pending DNS migration from CloudFront → greenreach-central Cloud Run |
| Per-farm `<slug>.greenreachgreens.com` | **Planned**, not live | Wildcard DNS + wildcard TLS + Cloud Run domain mapping not configured today; see `docs/architecture/MULTI_TENANT_ARCHITECTURE.md` and Playbook 01 §7 |

## 4. Monorepo layout + dual-deploy rule

```
Light-Engine-Foxtrot/
├── server-foxtrot.js           ◀ LE entry point
├── package.json                ◀ LE deps
├── public/                     ◀ LE static assets
├── routes/                     ◀ LE routes (NO imports from greenreach-central/)
├── lib/, services/, automation/
│
└── greenreach-central/         ◀ Central service (independent deploy)
    ├── server.js               ◀ Central entry point
    ├── package.json            ◀ Central deps
    ├── public/                 ◀ Central static assets (distinct from LE public/)
    ├── routes/                 ◀ Central routes (NO imports from root routes/)
    ├── config/, middleware/, lib/, services/
    └── Dockerfile              ◀ Central's container
```

### 4.1 The no-cross-import rule
- `server-foxtrot.js` → must not import from `greenreach-central/routes/**`.
- `greenreach-central/server.js` → must not import from `<repo>/routes/**`.
- Known audited cross-boundary imports today (treat as the whitelist, do not add new ones without review):
  - `server-foxtrot.js` imports `./greenreach-central/services/notification-store.js` (LE → Central service module).
  - `services/alternative-farm-service.js` and `lib/wholesale/reservation-manager.js` dynamically import `greenreach-central/services/networkFarmsStore.js` (LE wholesale/network farm lookup).
  - See also `.github/CLOUD_ARCHITECTURE.md` for any additional whitelisted Central dependencies bundled into LE.
- There is **no** `shared-libs/` directory in this repo. If genuinely shared code is needed in the future, propose the extraction mechanism in a PR — do not assume a `shared-libs/` path exists.

### 4.2 Dual-deploy files
Some files exist in both `public/` trees (e.g. `api-config.js`). There is **no dedicated `sync-manifest.json`-style workflow** today. The operational rule is the one stated in Playbook 00 §4 and `.github/copilot-instructions.md`: at runtime LE serves `greenreach-central/public/` FIRST and only falls back to root `public/` (`server-foxtrot.js` ~L25173), so the Central copy is the effective source of truth. Edit `greenreach-central/public/` first; if a file is also deployed from root `public/`, update it in the same PR and call out the duplicate in the description so reviewers can check both copies. Central's Dockerfile also produces a generated `shared-public-data` artifact; do not hand-edit generated outputs.

## 5. Deploy commands

Production deploys are **image-based**: build + push to Artifact Registry, then point the Cloud Run service at the new image. Do **not** use `gcloud run deploy --source ...` for production — it conflicts with the image-based rollout discipline documented in `.github/CLOUD_ARCHITECTURE.md` and `.github/copilot-instructions.md`, and those canonical docs are the source of truth for release path. Deploys also require the explicit `APPROVED FOR DEPLOYMENT` user confirmation (see `.github/copilot-instructions.md`).

Artifact Registry: `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach` (images: `light-engine`, `greenreach-central`).

### 5.1 Build and push images
```bash
# ALWAYS use --platform linux/amd64 (Apple Silicon default is ARM64; Cloud Run requires amd64)

# Central
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central/

# Light Engine
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .
```

### 5.2 Deploy the new image
```bash
gcloud run services update greenreach-central \
  --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest

gcloud run services update light-engine \
  --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest
```

### 5.3 Env / secrets updates
```bash
# Safe env var update (creates new revision)
gcloud run services update SERVICE_NAME --region=us-east1 --update-env-vars="KEY=value"

# After rotating a secret version, force a new revision so the service picks it up
gcloud run services update SERVICE_NAME --region=us-east1
```

### 5.4 Notes
- Never deploy without `--platform linux/amd64`.
- `gcloud run deploy --source ...` is **not** the production path; use the build → push → `services update` sequence above.
- See `.github/DEPLOYMENT_CHECKLIST.md` for the full pre-deploy checklist.

## 6. Secrets management

All secrets live in **Google Secret Manager** and are injected to Cloud Run via `--set-secrets`. There is no `.env` file in production. Local dev uses `.env.local` (gitignored).

| Secret | Consumer |
|---|---|
| `JWT_SECRET` | LE + Central |
| `DB_PASSWORD` (aka `ALLOYDB_PASSWORD`) | Central |
| `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`, `SQUARE_WEBHOOK_SIGNATURE_KEY` | Central |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Central |
| `SWITCHBOT_TOKEN`, `SWITCHBOT_SECRET` | LE |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Central (agents) |
| Vertex AI | ADC (Cloud Run service account) |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` | Central |
| `GREENREACH_API_KEY` | Central→LE proxy |
| `TOKEN_ENCRYPTION_KEY` | Central (Square token encryption) |

## 7. Database (AlloyDB)

- Cluster: `greenreach-db`
- Database: `greenreach_central`
- Private IP: `10.87.0.2`
- Access: both Cloud Run services reach AlloyDB over **Direct VPC egress (Gen2)** on `greenreach-vpc`; no public IP and **no VPC connector** (see §8 and `.github/CLOUD_ARCHITECTURE.md`)
- Migrations: run automatically on Central boot via `greenreach-central/config/database.js` → `runMigrations()` (LE's `config/database.js` does not own the schema)
- Migration failure is **non-fatal** at startup (warn + continue); hard failures in initial connection block startup

## 8. Networking

- Both Cloud Run services use **Direct VPC egress (Gen2)** on `greenreach-vpc` to reach AlloyDB at private IP `10.87.0.2` (see `.github/CLOUD_ARCHITECTURE.md` §Networking, `.github/copilot-instructions.md`).
- **No VPC connector is used.** The old connector has been deleted; do **not** create a new VPC connector or document one as part of the architecture. `.github/copilot-instructions.md` explicitly bans creating or using VPC connectors.
- LE uses HTTPS egress to Central (public URL)
- Cloud Run services are **public** (auth enforced in-app, not at ingress)
- CORS allowlist (live today): `greenreachgreens.com`, `urbanyeild.ca`, `localhost`
- `*.greenreachgreens.com` may be listed in the allowlist in anticipation of subdomain multi-tenancy, but **no wildcard DNS, no wildcard TLS cert, and no Cloud Run domain mapping for `*.greenreachgreens.com` exist in production today.** Do not assume any `<slug>.greenreachgreens.com` URL resolves.

## 9. Cloud Scheduler jobs

Cloud Scheduler drives periodic work (where in-process setInterval would not survive instance recycling):

- Wholesale notifications (new orders digests)
- Subscription renewal checks (before Stripe webhook)
- Admin session cleanup (every 30 min)
- Research audit archival (post-MVP)
- S.C.O.T.T. scheduled publishes

Configure jobs via `gcloud scheduler jobs create http ...` pointing at authenticated Central endpoints.

## 10. Logging, monitoring, alerting

- **Logs:** Cloud Logging (stdout from Cloud Run); structured via `greenreach-central/utils/logger.js` (Winston) on Central; LE logs via `console` + Cloud Run's default capture
- **Metrics:** Cloud Run built-in metrics; AI-spend custom metrics via `/api/ai-monitoring`
- **Error reporting:** Cloud Error Reporting auto-ingests stack traces
- **Uptime checks:** against LE + Central health endpoints
- **Alerts (recommended):** 5xx rate, CPU saturation, AlloyDB connection count, AI spend anomaly

## 11. CI / pre-commit

- `.github/` contains Copilot / agent guidance; there is no formal GitHub Actions pipeline described in the canonical docs today (verify before relying on CI gates)
- `CONTRIBUTING.md` defines branch naming and review gates
- If `.pre-commit-config.yaml` exists, run `pre-commit install` during setup

## 12. Local dev

```bash
# Root-level LE
npm install
node --watch server-foxtrot.js   # root package.json exposes only `npm start`; there is no `npm run dev` script today

# Central
cd greenreach-central
npm install
npm run dev   # greenreach-central/package.json defines `dev` as `NODE_ENV=development nodemon server.js`
```

Local dev connects to AlloyDB through the Cloud SQL Auth Proxy or a dev PostgreSQL; see `.env.example`.

## 13. Deployment checklist (before pushing)

- [ ] `npm run lint` passes on both services
- [ ] No cross-service imports introduced
- [ ] If a file under `public/` also exists under `greenreach-central/public/`, both copies updated in the same PR and the duplicate called out in the PR description (there is no dedicated sync-manifest; the rule is §4.2: edit Central's copy first, mirror in root, Central wins at runtime)
- [ ] Migrations are idempotent and Phase-A-safe (no FORCE RLS)
- [ ] New secrets added to Secret Manager + `--set-secrets`
- [ ] CORS / CSP allowlist still covers all origins
- [ ] E2E smoke: login, one wholesale checkout preview, one E.V.I.E. chat, one admin action
- [ ] Roll-forward plan documented; no schema change without a reversal path

## 14. Never do

- Deploy from a feature branch to `light-engine` or `greenreach-central` production (PR + main merge only)
- Hard-code secrets or check them into git (`.env`, `config/*.json`, Docker images)
- Commit `node_modules`, `.ebextensions/`, `.platform/`, or AWS artifacts as "new" files
- Import across services (`server-foxtrot.js` ↔ `greenreach-central/routes/`)
- Bypass the DB `query()` wrapper (Playbook 01 §5.3)
- Run destructive `gcloud` commands (`run services delete`, `sql instances delete`) on production
- Change `WHOLESALE_COMMISSION_RATE` without business + accounting signoff (Playbook 03)
- Change a `farm_slug` once the subdomain rollout goes live (it will break bookmarks, SEO, Square OAuth redirects). Today, changing a slug only affects internal identifiers, but treat it as immutable from day one.

## 15. Known gaps / open items

- Legacy AWS artifacts still present in repo (`.ebextensions/`, `.platform/`, `aws-*/`) even though banned in prod
- Per-farm subdomain multi-tenancy (`<slug>.greenreachgreens.com`) remains an unshipped plan — DNS wildcard, wildcard TLS, Cloud Run domain mapping, and CORS activation still to do
- `greenreachgreens.com` DNS is still on CloudFront; migration to Central Cloud Run pending (see `.github/CLOUD_ARCHITECTURE.md` §DNS/Custom Domains)
- No formal GitHub Actions release pipeline described; deploys are `gcloud run deploy` today
- Migration retention / baseline strategy should be formalized (large `runMigrations` block on boot)
- Secrets rotation cadence not codified (JWT_SECRET, DB_PASSWORD, OAuth app secret)
- Phase-B RLS (FORCE) migration plan pending

## 16. References

- `.github/CLOUD_ARCHITECTURE.md` (canonical)
- `.github/DEPLOYMENT_CHECKLIST.md`
- `.github/GCP_MIGRATION_REMAINING.md`
- `.github/CRITICAL_CONFIGURATION.md`
- `CONTRIBUTING.md`
- `greenreach-central/config/database.js`
- `server-foxtrot.js`, `greenreach-central/server.js`
