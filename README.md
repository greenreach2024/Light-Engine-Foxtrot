# Light Engine Foxtrot

Cloud-native indoor farming platform by GreenReach Farms. Production system running on Google Cloud Run (us-east1).

**Live URLs**:
- Light Engine: [https://light-engine-1029387937866.us-east1.run.app](https://light-engine-1029387937866.us-east1.run.app)
- GreenReach Central: [https://greenreach-central-1029387937866.us-east1.run.app](https://greenreach-central-1029387937866.us-east1.run.app)
- Central domain: [https://greenreachgreens.com](https://greenreachgreens.com)

---

## Architecture

Two independent Node.js applications deployed to separate Google Cloud Run services from a single monorepo:

### Light Engine (LE) -- The Farm

| Property | Value |
|----------|-------|
| Entry point | `server-foxtrot.js` |
| Cloud Run service | `light-engine` |
| URL | `https://light-engine-1029387937866.us-east1.run.app` |
| Serves | Farm admin UI, sensor polling, device APIs, E.V.I.E. frontend |
| Deploys from | Repository root |

LE polls SwitchBot Cloud API every 30 seconds for environmental sensor data (temperature, humidity across 4 zones), stores snapshots in memory and on disk (`public/data/env.json`), and syncs telemetry to Central. LE also surfaces nutrient-controller telemetry through MQTT discovery for monitor-only views in the device manager.

### GreenReach Central -- The Hub

| Property | Value |
|----------|-------|
| Entry point | `greenreach-central/server.js` |
| Cloud Run service | `greenreach-central` |
| URL | `https://greenreach-central-1029387937866.us-east1.run.app` |
| Custom domain | `greenreachgreens.com` |
| Serves | Multi-farm data hub, PostgreSQL backend, admin dashboards, AI assistants (E.V.I.E. + F.A.Y.E.), wholesale marketplace, research platform |
| Deploys from | `greenreach-central/` subdirectory |

Central manages farm registration, authentication, billing, inventory, wholesale orders, research data, and all API routes. AlloyDB (PostgreSQL-compatible) is the primary data store.

### Data Flow

```
SwitchBot Cloud API + MQTT Nutrient Telemetry  -->  LE (sensor polling + nutrient snapshot)  -->  Central (telemetry sync + hub APIs)
                          |                                              |
                        Farm Admin UI                                  AlloyDB
                        E.V.I.E. frontend                              Multi-farm data
                                         Wholesale marketplace
                                         Research platform
```

**There is no physical farm edge appliance in production.** The LE Cloud Run service IS the farm runtime. References to "edge," "Pi," or similar hardware terms are legacy artifacts.

---

## Repository Structure

```
/
  server-foxtrot.js          # LE entry point (~30K lines)
  package.json               # LE dependencies
  Dockerfile                 # LE Cloud Run image build

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
    Dockerfile               # Central Cloud Run image build

  docs/                      # Organized documentation
    architecture/            # System architecture docs
    onboarding/              # Farm and buyer onboarding guides
    wholesale/               # Wholesale marketplace docs
    delivery/                # Delivery service docs
    security/                # Security audit and hardening docs
    ai-agents/               # E.V.I.E., F.A.Y.E., G.W.E.N. docs
    billing/                 # Payment and billing docs
    deployment/              # Cloud Run and release process docs
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

- **Runtime**: Node.js 20 (Cloud Run, Gen2)
- **Database**: AlloyDB (PostgreSQL-compatible) via Central
- **Sensors**: SwitchBot WoIOSensor (4x) via SwitchBot Cloud API v1.1
- **Nutrient Telemetry**: ESP32 controller via MQTT topic `sensors/nutrient/reading`
- **Payments**: Square (POS + wholesale), Stripe (subscriptions)
- **AI**: OpenAI GPT-4o + Anthropic Claude Sonnet 4 (fallback)
- **Infrastructure**: Google Cloud Run, Artifact Registry, AlloyDB, Cloud Scheduler, Secret Manager, GCS

---

## AI Assistants

| Assistant | Role | Location |
|-----------|------|----------|
| **E.V.I.E.** | Farm operator assistant -- answers questions, manages inventory, runs diagnostics | Frontend on LE, API on Central |
| **F.A.Y.E.** | Admin operations agent -- system health, revenue analysis, feature management | Central only (GR-central-admin) |
| **G.W.E.N.** | Research workspace assistant -- experiment design, data analysis, protocol management | Frontend on LE, API on Central |

---

## Deployment

Both services deploy independently to Cloud Run using Artifact Registry images.

**Central build + deploy:**
```bash
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central:latest \
  --push ./greenreach-central

gcloud run services update greenreach-central \
  --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/greenreach-central@sha256:<digest>
```

**Light Engine build + deploy:**
```bash
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine:latest \
  --push .

gcloud run services update light-engine \
  --region=us-east1 \
  --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/light-engine@sha256:<digest>
```

Changes under `greenreach-central/` require Central deployment. Changes to root-level code require LE deployment. Changes to shared UI files (for example `app.foxtrot.js`, `LE-farm-admin.html`) require deploying both services.

See [.github/CLOUD_ARCHITECTURE.md](.github/CLOUD_ARCHITECTURE.md) for the complete architecture reference.

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
