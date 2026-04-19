# Light Engine Foxtrot

Cloud-native indoor farming platform by GreenReach Farms. Production system running on Google Cloud Run (`us-east1`).

**Live at**: [greenreachgreens.com](https://greenreachgreens.com)

---

## Architecture

Two independent Node.js applications deployed to separate Google Cloud Run services from a single monorepo:

### Light Engine (LE) -- The Farm

| Property | Value |
|----------|-------|
| Entry point | `server-foxtrot.js` |
| Cloud Run service | `light-engine` |
| Serves | Farm admin UI, sensor polling, device APIs, E.V.I.E. frontend |
| Deploys from | Repository root |

LE polls SwitchBot Cloud API every 30 seconds for environmental sensor data (temperature, humidity across 4 zones), stores snapshots in memory and on disk (`public/data/env.json`), and syncs telemetry to Central.

### GreenReach Central -- The Hub

| Property | Value |
|----------|-------|
| Entry point | `greenreach-central/server.js` |
| Cloud Run service | `greenreach-central` |
| Custom domain | `greenreachgreens.com` |
| Serves | Multi-farm data hub, PostgreSQL backend, admin dashboards, AI assistants (E.V.I.E. + F.A.Y.E.), wholesale marketplace, research platform |
| Deploys from | `greenreach-central/` subdirectory |

Central manages farm registration, authentication, billing, inventory, wholesale orders, research data, and all API routes. PostgreSQL is the primary data store.

### Data Flow

```
SwitchBot Cloud API  -->  LE (sensor polling)  -->  Central (telemetry sync)
                              |                          |
                         Farm Admin UI              PostgreSQL
                         E.V.I.E. frontend          Multi-farm data
                                                    Wholesale marketplace
                                                    Research platform
```

**There is no physical farm device.** The LE Cloud Run service IS the farm. All references to "edge," "Pi," or "hardware" in the codebase are legacy artifacts.

---

## Repository Structure

```
/
  server-foxtrot.js          # LE entry point (~30K lines)
  package.json               # LE dependencies
  Procfile                   # Legacy artifact, not used by Cloud Run
  .ebignore                  # Legacy artifact, not used by Cloud Run

  routes/                    # LE API routes (wholesale, farm-sales, auth, etc.)
  lib/                       # LE libraries (automation, sync, database, etc.)
  services/                  # LE services (sync, AI agent, payments, etc.)
  middleware/                # LE middleware
  automation/                # Environmental automation engine
  config/                    # Runtime configuration
  public/                    # LE static assets (served by LE only)
  scripts/                   # Utility and maintenance scripts

  greenreach-central/        # Central application (independent deploy)
    server.js                # Central entry point
    routes/                  # 80+ API route files
    services/                # Business logic services
    middleware/              # Auth, feature gates, tenant isolation
    lib/                     # Shared libraries (payments, data store)
    migrations/              # PostgreSQL schema migrations
    public/                  # Central static assets (dashboards, admin UIs)
    .ebignore                # Legacy artifact, not used by Cloud Run

  docs/                      # Organized documentation
    architecture/            # System architecture docs
    onboarding/              # Farm and buyer onboarding guides
    wholesale/               # Wholesale marketplace docs
    delivery/                # Delivery service docs
    security/                # Security audit and hardening docs
    ai-agents/               # E.V.I.E., F.A.Y.E., G.W.E.N. docs
    billing/                 # Payment and billing docs
    deployment/              # Deployment and domain setup docs
    features/                # Feature-specific documentation
    operations/              # Monitoring, troubleshooting, runbooks
    research/                # Research platform docs
    archive/                 # Historical docs (phases, proposals, reports)

  .github/                   # Canonical operational documents
    CLOUD_ARCHITECTURE.md    # Architecture source of truth
    SENSOR_DATA_PIPELINE.md  # Sensor data flow reference
    CRITICAL_CONFIGURATION.md # All env vars and credentials
    COMPLETE_SYSTEM_MAP.md   # Full platform mapping
    TROUBLESHOOTING_ENV_DATA.md
    copilot-instructions.md  # AI agent rules

  archive/                   # Legacy code (not deployed, preserved for reference)
    legacy/                  # Old backends, firmware, desktop/mobile apps
```

---

## Key Technologies

- **Runtime**: Node.js 20 on Cloud Run
- **Database**: PostgreSQL (via Central)
- **Sensors**: SwitchBot WoIOSensor (4x) via SwitchBot Cloud API v1.1
- **Payments**: Square (POS + wholesale), Stripe (subscriptions)
- **AI**: OpenAI GPT-4o + Anthropic Claude Sonnet 4 (fallback)
- **Infrastructure**: Google Cloud Run, Artifact Registry, Secret Manager, AlloyDB

---

## AI Assistants

| Assistant | Role | Location |
|-----------|------|----------|
| **E.V.I.E.** | Farm operator assistant -- answers questions, manages inventory, runs diagnostics | Frontend on LE, API on Central |
| **F.A.Y.E.** | Admin operations agent -- system health, revenue analysis, feature management | Central only (GR-central-admin) |
| **G.W.E.N.** | Research workspace assistant -- experiment design, data analysis, protocol management | Frontend on LE, API on Central |

---

## Deployment

Both services deploy independently via Docker Buildx and Cloud Run.

**GitHub is the deployable source of truth.** Production-relevant code must be committed and pushed before building Cloud Run images.

### Correct Deployment Workflow

1. Reconcile all required production fixes into one GitHub branch.
2. Push that branch to GitHub before building any image.
3. If `main` is protected, open a PR and treat the PR head SHA as the deployable source until merge.
4. Build from that pushed branch state.
5. Resolve the authoritative Artifact Registry digest.
6. Deploy the affected Cloud Run service(s) by digest.
7. Merge the PR so GitHub `main` stays aligned with production.

### Branch Drift Warning

Production issues in April 2026 were caused by required fixes being split across multiple GitHub branches and local-only history.

- Do not assume `main` contains all required production fixes.
- Check side branches, salvage branches, reconcile branches, and local recovery branches before deploy.
- Merge or cherry-pick all required commits into one deploy branch first.
- Do not deploy from code that exists only on a laptop.

### Correct Service and Folder Mapping

| Change Location | Deploy LE | Deploy Central |
|----------------|-----------|----------------|
| Root app code and root `public/` | Yes | No |
| `greenreach-central/` code and `greenreach-central/public/` | No | Yes |
| Shared UI duplicated in both public folders | Yes | Yes |

If a UI file exists in both public folders, update the Central copy first, then copy it to root `public/`, and evaluate both services for deployment.

**Central:**
```bash
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central/
```

**Light Engine:**
```bash
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .
```

Resolve the authoritative digest from Artifact Registry, then deploy with `gcloud run services update ... --image=...@sha256:...`.

Changes to `greenreach-central/` require deploying Central. Changes to root-level code require deploying LE. Changes to shared UI files (e.g., `LE-farm-admin.html`) require deploying BOTH.

See [.github/CLOUD_ARCHITECTURE.md](.github/CLOUD_ARCHITECTURE.md) for the complete architecture reference and [.github/DEPLOYMENT_CHECKLIST.md](.github/DEPLOYMENT_CHECKLIST.md) for the deploy process.

---

## Documentation

Start here:

1. [.github/CLOUD_ARCHITECTURE.md](.github/CLOUD_ARCHITECTURE.md) -- Full architecture reference
2. [.github/COMPLETE_SYSTEM_MAP.md](.github/COMPLETE_SYSTEM_MAP.md) -- Every page, route, table, data flow
3. [.github/CRITICAL_CONFIGURATION.md](.github/CRITICAL_CONFIGURATION.md) -- All credentials and env vars
4. [.github/SENSOR_DATA_PIPELINE.md](.github/SENSOR_DATA_PIPELINE.md) -- Sensor data flow
5. [CONTRIBUTING.md](CONTRIBUTING.md) -- Developer onboarding and contribution guide

Domain-specific documentation is organized under `docs/` by topic.

---

## License

Proprietary. All rights reserved by GreenReach Farms.
