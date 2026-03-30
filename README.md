# Light Engine Foxtrot

Cloud-native indoor farming platform by GreenReach Farms. Production system running on AWS Elastic Beanstalk (us-east-1).

**Live at**: [greenreachgreens.com](https://greenreachgreens.com)

---

## Architecture

Two independent Node.js applications deployed to separate AWS Elastic Beanstalk environments from a single monorepo:

### Light Engine (LE) -- The Farm

| Property | Value |
|----------|-------|
| Entry point | `server-foxtrot.js` |
| EB environment | `light-engine-foxtrot-prod-v3` |
| Serves | Farm admin UI, sensor polling, device APIs, E.V.I.E. frontend |
| Deploys from | Repository root |

LE polls SwitchBot Cloud API every 30 seconds for environmental sensor data (temperature, humidity across 4 zones), stores snapshots in memory and on disk (`public/data/env.json`), and syncs telemetry to Central.

### GreenReach Central -- The Hub

| Property | Value |
|----------|-------|
| Entry point | `greenreach-central/server.js` |
| EB environment | `greenreach-central-prod-v4` |
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

**There is no physical farm device.** The LE Elastic Beanstalk instance IS the farm. All references to "edge," "Pi," or "hardware" in the codebase are legacy artifacts.

---

## Repository Structure

```
/
  server-foxtrot.js          # LE entry point (~30K lines)
  package.json               # LE dependencies
  Procfile                   # EB process definition
  .ebignore                  # LE deploy exclusions

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
    .ebignore                # Central deploy exclusions

  docs/                      # Organized documentation
    architecture/            # System architecture docs
    onboarding/              # Farm and buyer onboarding guides
    wholesale/               # Wholesale marketplace docs
    delivery/                # Delivery service docs
    security/                # Security audit and hardening docs
    ai-agents/               # E.V.I.E., F.A.Y.E., G.W.E.N. docs
    billing/                 # Payment and billing docs
    deployment/              # AWS, EB, domain setup docs
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

- **Runtime**: Node.js 20 on Amazon Linux 2023
- **Database**: PostgreSQL (via Central)
- **Sensors**: SwitchBot WoIOSensor (4x) via SwitchBot Cloud API v1.1
- **Payments**: Square (POS + wholesale), Stripe (subscriptions)
- **AI**: OpenAI GPT-4o + Anthropic Claude Sonnet 4 (fallback)
- **Infrastructure**: AWS Elastic Beanstalk, Route53, CloudFront, SES

---

## AI Assistants

| Assistant | Role | Location |
|-----------|------|----------|
| **E.V.I.E.** | Farm operator assistant -- answers questions, manages inventory, runs diagnostics | Frontend on LE, API on Central |
| **F.A.Y.E.** | Admin operations agent -- system health, revenue analysis, feature management | Central only (GR-central-admin) |
| **G.W.E.N.** | Research workspace assistant -- experiment design, data analysis, protocol management | Frontend on LE, API on Central |

---

## Deployment

Both environments deploy independently via `eb deploy` with `--staged` flag (deploys from git staging area).

**Central:**
```bash
cd greenreach-central
eb deploy greenreach-central-prod-v4 --staged
```

**Light Engine:**
```bash
# From repo root
eb deploy light-engine-foxtrot-prod-v3 --staged
```

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
