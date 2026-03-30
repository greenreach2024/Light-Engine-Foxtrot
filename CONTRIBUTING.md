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

- **Light Engine (LE)**: `server-foxtrot.js` at repo root, deploys to `light-engine-foxtrot-prod-v3`
- **GreenReach Central**: `greenreach-central/server.js`, deploys to `greenreach-central-prod-v4`

They share NO runtime imports across boundaries. Do NOT import from `greenreach-central/routes/` into `server-foxtrot.js` (it will crash EB due to dependency chains).

### The Farm Is 100% Cloud

There is no physical device, no Raspberry Pi, no edge hardware. The LE Elastic Beanstalk instance IS the farm. References to "edge," "Pi," or "hardware" in old code are legacy artifacts.

### Two public/ Directories

| Directory | Served By | Deploy Target |
|-----------|-----------|---------------|
| `public/` (root) | LE only | `light-engine-foxtrot-prod-v3` |
| `greenreach-central/public/` | Central only | `greenreach-central-prod-v4` |

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
4. Stage all changes: `git add -A`
5. Commit with descriptive message
6. Deploy to the correct environment(s)

### Deploying

**Critical**: Determine which environment(s) your changes affect.

| Changed Files | Deploy To |
|---------------|-----------|
| Root-level code (server-foxtrot.js, routes/, lib/, etc.) | LE |
| `greenreach-central/` code | Central |
| Shared UI files (exist in both public/ dirs) | BOTH |

```bash
# Deploy Central
cd greenreach-central
eb deploy greenreach-central-prod-v4 --staged

# Deploy LE (from repo root)
eb deploy light-engine-foxtrot-prod-v3 --staged
```

**Never deploy during business hours without coordination.** Deployments cause brief downtime (~30-60 seconds).

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
