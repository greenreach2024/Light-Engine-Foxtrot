---
description: "Use when deploying, running gcloud run, discussing deployment, pushing to production, or preparing releases. Covers the dual-service Google Cloud Run architecture and mandatory pre-deploy checklist. Authoritative playbook: .github/PLAYBOOK.md"
---
# Deployment Rules (TWO Separate Cloud Run Services)

## STOP. Read before deploying.

**AWS Elastic Beanstalk is FULLY DEPRECATED.** All deployments target Google Cloud Run.

This project has TWO independent Cloud Run services in one monorepo.
Deploying to one does NOT deploy the other. You must explicitly deploy BOTH when
changes span both applications.

## Service Map

| Service | Cloud Run Name | Entry Point | Serves | Build Context |
|---------|---------------|-------------|--------|---------------|
| Light Engine (LE) | `light-engine` | `server-foxtrot.js` | Root `public/`, sensors, device APIs, SwitchBot | `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot` (repo root) |
| GreenReach Central | `greenreach-central` | `greenreach-central/server.js` | `greenreach-central/public/`, ALL assistant routes, farm admin pages, AlloyDB | `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central` |

**Service URLs:**
- LE: `https://light-engine-1029387937866.us-east1.run.app`
- Central: `https://greenreach-central-1029387937866.us-east1.run.app`
- Custom domain: `greenreachgreens.com` -> Central

**GCP Project:** `project-5d00790f-13a9-4637-a40` | **Region:** `us-east1`
**Artifact Registry:** `us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach`

## Deploy Commands

```bash
# 1. Build and push LE image (ALWAYS --platform linux/amd64 on Apple Silicon)
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:TAG \
  --push /Volumes/CodeVault/Projects/Light-Engine-Foxtrot

# 2. Build and push Central image
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:TAG \
  --push /Volumes/CodeVault/Projects/Light-Engine-Foxtrot/greenreach-central

# 3. Resolve pushed digest from Artifact Registry (do NOT trust buildx output digest)
gcloud artifacts docker images list \
  us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/SERVICE \
  --include-tags --filter='tags:TAG' --format='value(DIGEST)'

# 4. Deploy by exact digest
gcloud run services update light-engine --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine@sha256:DIGEST

gcloud run services update greenreach-central --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central@sha256:DIGEST
```

## Mandatory Pre-Deploy Checklist

Before ANY deployment:

1. Read `.github/CLOUD_ARCHITECTURE.md` to confirm architecture
2. Identify which files changed and which service(s) they belong to:
   - `greenreach-central/` changes -> Central deploy required
   - Root-level changes (`server-foxtrot.js`, root `public/`) -> LE deploy required
   - Changes in BOTH directories -> BOTH deploys required
3. Present deployment plan to user showing WHICH services and WHY
4. Wait for explicit user approval before executing
5. After deploy, append entry to `.github/DEPLOYMENT_LOG.md`

## What Lives Where

### Central (`greenreach-central` at greenreachgreens.com)
- `greenreach-central/server.js` (all Express routes)
- `greenreach-central/routes/` (assistant-chat.js, admin-assistant.js, farm-ops-agent.js, etc.)
- `greenreach-central/public/` (LE-farm-admin.html, GR-central-admin.html, evie-core.html, faye-core.html)
- `greenreach-central/public/js/` (evie-presence.js, faye-presence.js, farm-assistant.js)
- `greenreach-central/public/styles/` (evie-core.css, faye-core.css, farm-assistant.css)
- AlloyDB (PostgreSQL-compatible) connections via Direct VPC egress
- `/api/assistant/*` (E.V.I.E.) and `/api/admin/assistant/*` (F.A.Y.E.) routes

### LE (`light-engine`)
- `server-foxtrot.js` (~30,000 lines -- sensor polling, device APIs, automation)
- Root `public/` (static files for LE dashboard)
- `config/edge-config.json`
- `automation/` (env-store, rules, plugins)
- `lib/sync-service.js` (pushes telemetry to Central)
- SwitchBot sensor integration

## Common Mistake
Deploying only to LE when changes were made in `greenreach-central/`. The LE server
(`server-foxtrot.js`) does NOT serve Central's routes or pages. Central has its own
`server.js` with its own `express.static()` serving `greenreach-central/public/`.

## Static File Priority
`server-foxtrot.js` serves `greenreach-central/public/` FIRST, then root `public/`.
For any file that exists in BOTH locations, the `greenreach-central/public/` copy wins.
Always edit `greenreach-central/public/` first, then copy to root `public/`.

## BANNED Commands
All `eb` CLI and `aws elasticbeanstalk` commands are FORBIDDEN. The platform migrated
to Google Cloud Run in April 2026. See `.github/copilot-instructions.md` for the full
banned commands list.
