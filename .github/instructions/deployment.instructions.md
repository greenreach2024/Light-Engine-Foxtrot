---
description: "Use when deploying, running eb deploy, discussing deployment, pushing to production, or preparing releases. Covers the dual-environment Elastic Beanstalk architecture and mandatory pre-deploy checklist."
---
# Deployment Rules (TWO Separate EB Environments)

## STOP. Read before deploying.

This project has TWO independent Elastic Beanstalk applications in one monorepo.
Deploying to one does NOT deploy the other. You must explicitly deploy BOTH when
changes span both applications.

## Environment Map

| App | EB Environment | Entry Point | Serves | Deploy Command |
|-----|---------------|-------------|--------|---------------|
| Light Engine (LE) | `light-engine-foxtrot-prod-v3` | `server-foxtrot.js` | Root `public/`, sensors, device APIs, SwitchBot | `cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot && eb deploy light-engine-foxtrot-prod-v3 --staged` |
| GreenReach Central | `greenreach-central-prod-v4` | `greenreach-central/server.js` | `greenreach-central/public/`, ALL assistant routes, farm admin pages, PostgreSQL | `cd greenreach-central && eb deploy greenreach-central-prod-v4 --staged` |

## Mandatory Pre-Deploy Checklist

Before ANY `eb deploy` command:

1. Read `.github/CLOUD_ARCHITECTURE.md` to confirm architecture
2. Identify which files changed and which environment(s) they belong to:
   - `greenreach-central/` changes -> Central deploy required
   - Root-level changes (`server-foxtrot.js`, root `public/`) -> LE deploy required
   - Changes in BOTH directories -> BOTH deploys required
3. Present deployment plan to user showing WHICH environments and WHY
4. Wait for explicit user approval before executing

## What Lives Where

### Central (`greenreach-central-prod-v4` at greenreachgreens.com)
- `greenreach-central/server.js` (all Express routes)
- `greenreach-central/routes/` (assistant-chat.js, admin-assistant.js, farm-ops-agent.js, etc.)
- `greenreach-central/public/` (LE-farm-admin.html, GR-central-admin.html, evie-core.html, faye-core.html)
- `greenreach-central/public/js/` (evie-presence.js, faye-presence.js, farm-assistant.js)
- `greenreach-central/public/styles/` (evie-core.css, faye-core.css, farm-assistant.css)
- PostgreSQL database connections
- `/api/assistant/*` (E.V.I.E.) and `/api/admin/assistant/*` (F.A.Y.E.) routes

### LE (`light-engine-foxtrot-prod-v3`)
- `server-foxtrot.js` (~30,000 lines — sensor polling, device APIs, automation)
- Root `public/` (static files for LE dashboard)
- `config/edge-config.json`
- `automation/` (env-store, rules, plugins)
- `lib/sync-service.js` (pushes telemetry to Central)
- SwitchBot sensor integration

## Common Mistake
Deploying only to LE when changes were made in `greenreach-central/`. The LE server
(`server-foxtrot.js`) does NOT serve Central's routes or pages. Central has its own
`server.js` with its own `express.static()` serving `greenreach-central/public/`.

## CNAME Swap Warning
`light-engine-foxtrot-prod-v3` answers on the v2 CNAME. This is correct. Do not "fix" it.

## Dead Environment
`light-engine-foxtrot-prod-v2` is terminated (CloudFormation DELETE_FAILED). NEVER deploy to it.
