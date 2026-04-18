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
   *.greenreachgreens.com   ┌─────────────────────────┐          │
           │                │ Cloud Run: light-engine │          │
           │──► Cloud Run ─▶│ 1029387937866.us-east1  │──┐       │
           │   (LE)         └─────────────────────────┘  │       │
           │                                             ▼       │
           │                ┌─────────────────────────┐ ┌──────┐ │
           └───────────────▶│ Cloud Run: greenreach-  │─│AlloyDB│ │
                            │ central                 │ │greenreach-db│
                            └─────────────────────────┘ │private IP  │
                                                        │10.87.0.2   │
                              Artifact Registry         └──────┘
                              Cloud Scheduler          Cloud Storage
                              Secret Manager           Cloud Logging
```

## 3. Service URLs

| Service | URL | Purpose |
|---|---|---|
| Light Engine | `https://light-engine-1029387937866.us-east1.run.app` | Farm runtime (LE) |
| GreenReach Central | `https://greenreach-central-1029387937866.us-east1.run.app` | Admin + wholesale + marketing + research |
| Public | `*.greenreachgreens.com` | Per-farm subdomain routing (→ Cloud Run) |

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
- `server-foxtrot.js` → must not import from `greenreach-central/routes/**`
- `greenreach-central/server.js` → must not import from `<repo>/routes/**`
- Shared helpers go in `shared-libs/` (small and intentional)

### 4.2 Dual-deploy file registry
When the same file exists in both `public/` trees (e.g., `api-config.js`), it is listed in a **sync manifest** and PR review must confirm both copies are updated. Files not in the manifest must only exist in one tree.

## 5. Deploy commands

### 5.1 Light Engine
```bash
gcloud run deploy light-engine \
  --source . \
  --region us-east1 \
  --project project-5d00790f-13a9-4637-a40 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

### 5.2 GreenReach Central
```bash
gcloud run deploy greenreach-central \
  --source greenreach-central \
  --region us-east1 \
  --project project-5d00790f-13a9-4637-a40 \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production
```

### 5.3 Artifact Registry
- Registry: `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach`
- Cloud Run `--source` builds push here automatically

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
- Access: Central service via VPC connector, no public IP
- Migrations: run automatically on boot via `config/database.js` → `runMigrations()`
- Migration failure is **non-fatal** at startup (warn + continue); hard failures in initial connection block startup

## 8. Networking

- VPC connector connects Central's Cloud Run to AlloyDB private IP
- LE uses HTTPS egress to Central (public URL)
- Cloud Run services are **public** (auth enforced in-app, not at ingress)
- CORS allowlist: `greenreachgreens.com`, `*.greenreachgreens.com`, `urbanyeild.ca`, `localhost`
- Wildcard TLS cert for `*.greenreachgreens.com`

## 9. Cloud Scheduler jobs

Cloud Scheduler drives periodic work (where in-process setInterval would not survive instance recycling):

- Wholesale notifications (new orders digests)
- Subscription renewal checks (before Stripe webhook)
- Admin session cleanup (every 30 min)
- Research audit archival (post-MVP)
- S.C.O.T.T. scheduled publishes

Configure jobs via `gcloud scheduler jobs create http ...` pointing at authenticated Central endpoints.

## 10. Logging, monitoring, alerting

- **Logs:** Cloud Logging (stdout from Cloud Run); structured via `utils/logger.js` (Winston)
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
npm run dev   # node --watch server-foxtrot.js

# Central
cd greenreach-central
npm install
npm run dev   # node --watch server.js
```

Local dev connects to AlloyDB through the Cloud SQL Auth Proxy or a dev PostgreSQL; see `.env.example`.

## 13. Deployment checklist (before pushing)

- [ ] `npm run lint` passes on both services
- [ ] No cross-service imports introduced
- [ ] Dual-deploy manifest updated if `public/` files changed in both trees
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
- Change per-farm subdomain slugs once live (breaks bookmarks, SEO, Square OAuth redirects)

## 15. Known gaps / open items

- Legacy AWS artifacts still present in repo (`.ebextensions/`, `.platform/`, `aws-*/`) even though banned in prod
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
