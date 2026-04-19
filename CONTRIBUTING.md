# Contributing to Light Engine Foxtrot

This guide is for developers joining the GreenReach Farms platform team.

---

## Before You Start

Read these documents in order:

1. [README.md](README.md) -- Platform overview and repo structure
2. [.github/CLOUD_ARCHITECTURE.md](.github/CLOUD_ARCHITECTURE.md) -- Two-environment architecture, deploy targets, CNAME swap details
3. [.github/COMPLETE_SYSTEM_MAP.md](.github/COMPLETE_SYSTEM_MAP.md) -- Every page, route, table, and data flow
4. [.github/CRITICAL_CONFIGURATION.md](.github/CRITICAL_CONFIGURATION.md) -- Environment variables, credentials, API keys
5. [.github/copilot-instructions.md](.github/copilot-instructions.md) -- AI agent rules (also useful as a platform knowledge base)

---

## Architecture Rules

### Two Separate Deployments

This monorepo contains two independently deployed Node.js applications:

- **Light Engine (LE)**: `server-foxtrot.js` at repo root, deploys to Cloud Run service `light-engine`
- **GreenReach Central**: `greenreach-central/server.js`, deploys to Cloud Run service `greenreach-central`

They share NO runtime imports across boundaries. Do NOT import from `greenreach-central/routes/` into `server-foxtrot.js` (it will crash LE due to dependency chains).

### The Farm Is 100% Cloud

There is no physical device, no Raspberry Pi, no edge hardware. The LE Cloud Run service IS the farm. References to "edge," "Pi," or "hardware" in old code are legacy artifacts.

### Two public/ Directories

| Directory | Served By | Deploy Target |
|-----------|-----------|---------------|
| `public/` (root) | LE only | `light-engine` |
| `greenreach-central/public/` | Central only | `greenreach-central` |

Both servers serve the same UI files (e.g., `LE-farm-admin.html`) to avoid cross-origin issues. When editing shared UI files, edit in `greenreach-central/public/` first, then copy to root `public/`.

---

## Development Workflow

### Local Development

```bash
# Install LE dependencies
npm install

# Install Central dependencies
cd greenreach-central && npm install && cd ..

# Start LE locally
node server-foxtrot.js

# Start Central locally (separate terminal)
cd greenreach-central && node server.js
```

Central requires PostgreSQL and the environment variables listed in [.github/CRITICAL_CONFIGURATION.md](.github/CRITICAL_CONFIGURATION.md).

### Making Changes

1. Create a feature branch from `main`
2. Make your changes
3. Test locally
4. Reconcile Git history before deploy:
	- Ensure required production fixes are not stranded on local branches or local `main`
	- Check GitHub for side branches that may hold part of the production fix
	- Merge or cherry-pick side-branch fixes into one deploy branch
	- Confirm GitHub contains the exact code you will deploy before any image build
5. Stage all changes: `git add -A`
6. Commit with descriptive message
7. Push to GitHub
8. If direct push to `main` is blocked by branch protection, push the deploy branch and open a PR to `main`
9. Build and deploy from the pushed branch or PR head commit
10. Merge the PR after validation so `main` stays aligned with production

### Branch Management Rules

- Do not leave production fixes split across multiple GitHub branches after an incident or hotfix.
- Do not deploy from local-only commits.
- If the fix came from salvage, recovery, or reconcile branches, combine those commits first and deploy only after the combined branch is on GitHub.
- Treat the GitHub PR head SHA as the deployable source when `main` is protected and not yet merged.
- After deployment, merge the PR so production and GitHub `main` do not drift again.

### Protected Main Workflow

This repository protects `main` with required checks.

- If `git push origin main` is rejected, that is expected behavior.
- Push a deploy branch instead.
- Open a PR to `main`.
- Let required checks run.
- Deploy from the pushed branch or PR head only if operationally necessary.
- Merge the PR afterward so the deployed SHA is represented in `main`.

### Deploying

**Critical**: Determine which environment(s) your changes affect.

| Changed Files | Deploy To |
|---------------|-----------|
| Root-level code (server-foxtrot.js, routes/, lib/, etc.) | LE |
| `greenreach-central/` code | Central |
| Shared UI files (exist in both public/ dirs) | BOTH |

### Correct Deployment Mapping

- Root `public/` is served by LE.
- `greenreach-central/public/` is served by Central.
- Many operator-facing pages exist in both locations. Those files must be kept in sync.
- Edit `greenreach-central/public/` first, then copy the final version into root `public/`.
- If you only deploy one service after changing a duplicated file, production will remain inconsistent.

### Correct Deployment Sequence

1. Push the deploy branch to GitHub.
2. If `main` is protected, open a PR and use the PR head SHA as the reviewable deploy source.
3. Build the affected service image from the exact pushed branch state.
4. Resolve the authoritative Artifact Registry digest.
5. Deploy the affected Cloud Run service by digest.
6. Verify the new Cloud Run revision is healthy.
7. Merge the PR so GitHub `main` matches the deployed code.

```bash
# Build and push Central
docker buildx build --platform linux/amd64 \
	-t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
	--push ./greenreach-central/

# Build and push LE
docker buildx build --platform linux/amd64 \
	-t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
	--push .

# Resolve the authoritative digest from Artifact Registry, then deploy by digest
gcloud run services update greenreach-central --region=us-east1 --image=REGISTRY_DIGEST
gcloud run services update light-engine --region=us-east1 --image=REGISTRY_DIGEST
```

**GitHub parity is mandatory before deploy.** Never deploy production-relevant local-only commits.
**Never deploy during business hours without coordination.**

---

## Code Conventions

- **No emojis** in code, comments, or documentation
- Route files are organized by domain (e.g., `wholesale.js`, `inventory.js`, `research-data.js`)
- PostgreSQL queries use parameterized queries (no string interpolation)
- Multi-tenant isolation: all data queries must be scoped to `farm_id`
- Feature gates: check `req.planType` or feature flags before exposing premium features
- API responses: use consistent `{ success: true/false, data/error }` format

---

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `routes/` | LE API routes |
| `lib/` | LE libraries (database, automation, sync) |
| `services/` | LE services (AI agent, payments, notifications) |
| `automation/` | Environmental automation engine |
| `config/` | Runtime configuration files |
| `greenreach-central/routes/` | Central API routes (84 files) |
| `greenreach-central/services/` | Central business logic |
| `greenreach-central/middleware/` | Auth, feature gates, tenant isolation |
| `greenreach-central/migrations/` | PostgreSQL migration scripts |
| `scripts/` | Utility scripts (deploy, seed, test, migrate) |
| `docs/` | Categorized documentation |
| `.github/` | Canonical operational documents |
| `archive/legacy/` | Dead code preserved for reference (not deployed) |

---

## Database

Central uses PostgreSQL. Schema migrations are in `greenreach-central/migrations/` and run automatically on EB deploy via `greenreach-central/server.js` initialization.

Database tables are auto-created on first boot. See the migration files for the full schema.

---

## AI Assistants

Three AI assistants operate on the platform:

- **E.V.I.E.** (farm operator): `greenreach-central/routes/assistant-chat.js`
- **F.A.Y.E.** (admin ops): `greenreach-central/routes/admin-assistant.js`
- **G.W.E.N.** (research): `greenreach-central/routes/gwen-research-agent.js`

All use OpenAI as primary with Anthropic Claude as fallback. Tool definitions are in each route file.

---

## Getting Help

- Check `docs/` for topic-specific guides
- Check `.github/TROUBLESHOOTING_ENV_DATA.md` for sensor data issues
- Check `.github/COMPLETE_SYSTEM_MAP.md` before making cross-system changes
- Ask in the team channel before modifying shared infrastructure
