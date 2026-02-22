# Light-Engine-Foxtrot — Build Summary Report

**Date**: February 21, 2026
**Status**: All systems green — 0 TypeScript errors, 66/66 tests passing

---

## Platform Overview

**Light-Engine-Foxtrot** is a B2B farm-to-wholesale last-mile delivery platform that orchestrates perishable-goods logistics from producers (farms, co-ops, food hubs) to wholesale buyers. The system covers ordering, wave planning, VRPTW route optimization, cost allocation, driver management, proof of delivery, billing, settlement, payouts, and real-time tracking.

---

## Build Metrics

| Metric | Count |
| --- | --- |
| TypeScript source files | 95 |
| TypeScript lines of code | 6,547 |
| Test files | 6 |
| Test lines of code | 669 |
| Tests passing | 66 / 66 |
| SQL migration lines | 900 |
| HTML/CSS lines | 2,349 |
| **Total lines of code** | **~10,465** |

---

## Architecture

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20+ / TypeScript 5 |
| Framework | Express 4 |
| Database | PostgreSQL 16 (Knex query builder) |
| Validation | Zod |
| Auth | JWT (jsonwebtoken) + bcryptjs |
| Logging | Pino |
| Testing | Vitest |
| Production deps | 15 packages |
| Dev deps | 14 packages |

---

## Modules (17)

Most modules follow a 4-file pattern: `validation.ts` → `service.ts` → `controller.ts` → `routes.ts`. Exceptions: routing and pricing include extra algorithm files; tracking has 3 files (no validation layer — events are driver-state transitions, not user input).

### Phase 1 — Core Platform (11 modules)

| Module | Files | Responsibility |
| --- | --- | --- |
| auth | 4 | Registration, login, JWT issuance |
| customer | 4 | Customer accounts, locations, product catalogs |
| order | 4 | Multi-line orders with temp-class detection |
| dispatch | 5 | Wave management, driver offers, scoring |
| routing | 6 | VRPTW solver (nearest-neighbor + 2-opt), route planning |
| pricing | 6 | Cost allocation, delivery fee calculation, surcharges |
| driver | 4 | Driver profiles, availability, vehicle management |
| pod | 4 | Proof of delivery — signature, photos, temp, exceptions |
| billing | 4 | Invoice generation, payment tracking, driver payouts |
| telemetry | 4 | GPS pings, ETA estimation, route adherence |
| notification | 4 | Multi-channel notification stubs (push/SMS/email) |

### Phase 2 — Delivery Platform (6 modules)

| Module | Files | Responsibility |
| --- | --- | --- |
| driver-onboarding | 4 | Application lifecycle, documents, background checks, agreements |
| shipment | 4 | Per-route shipment tracking with pickup/delivery lifecycle |
| tracking | 3 | SSE-based driver state machine & delivery event streaming |
| settlement | 4 | Fee quotes, pay statements, hold/release for POD exceptions |
| payout | 4 | Batched driver payouts with Stripe integration (stub) |
| customer-members | 4 | Multi-user customer accounts with role-based access |

---

## API Surface

**101 API endpoints across 17 route files** + **1 health endpoint** (`/health`) = **102 total endpoints**.

| Module | Endpoints |
| --- | --- |
| driver-onboarding | 13 |
| dispatch | 8 |
| customer | 8 |
| billing | 7 |
| customer-members | 7 |
| payout | 7 |
| settlement | 7 |
| shipment | 6 |
| tracking | 6 |
| telemetry | 6 |
| order | 5 |
| driver | 5 |
| routing | 4 |
| notification | 4 |
| auth | 3 |
| pod | 3 |
| pricing | 2 |

---

## Database Schema

**39 tables** across 2 migrations with **23 PostgreSQL enum types** for type safety.

### Migration 001 — Core Schema (24 tables, 11 enums)

| Group | Tables |
| --- | --- |
| Users & Auth | `users`, `audit_logs` |
| Customers | `customers`, `customer_users`, `customer_locations` |
| Products | `products`, `customer_catalog` |
| Orders | `orders`, `order_lines`, `recurring_schedules` |
| Drivers | `drivers` |
| Waves & Routes | `waves`, `routes`, `route_stops` |
| Dispatch | `driver_offers` |
| POD | `proof_of_delivery` |
| Billing | `invoices`, `invoice_lines`, `driver_payouts` |
| Telemetry | `gps_pings` |
| Notifications | `notifications` |
| Pricing | `pricing_config` |

### Migration 002 — Delivery Platform (15 tables, 12 enums)

| Group | Tables |
| --- | --- |
| Driver Onboarding | `driver_documents`, `driver_background_checks`, `driver_agreements`, `driver_payout_accounts` |
| Shipments | `shipments` |
| Settlement | `fee_quotes`, `pay_statements`, `pay_statement_lines` |
| Payouts | `payout_batches`, `payouts` |
| Customer Members | `customer_members` |
| + ALTER TABLE | `drivers` (`status`, `preferred_zone`, `capacity_totes_applied`, `stripe_connect_id`, `onboarding_completed_at`) |

---

## Shared Infrastructure

| Component | File | Purpose |
| --- | --- | --- |
| Type definitions | `src/shared/types/index.ts` | 50+ interfaces & enums for all domain entities |
| Event bus | `src/shared/events/index.ts` | In-process typed event emitter |
| Driver states | `src/shared/types/driver-states.ts` | Finite state machine for driver lifecycle |
| Delivery events | `src/shared/types/delivery-events.ts` | SSE event type definitions |
| Error classes | `src/shared/utils/errors.ts` | `NotFoundError`, `BadRequestError`, `UnauthorizedError`, `ForbiddenError` |
| Helpers | `src/shared/utils/helpers.ts` | Number formatting, ID generators, date utilities |
| Logger | `src/shared/utils/logger.ts` | Pino logger factory |
| Payout policy | `src/config/payout-policy.ts` | Driver pay rates, minimum guarantee, exception rules, CRA config |

---

## Middleware

| Middleware | Purpose |
| --- | --- |
| `auth.ts` | JWT verification, `req.user` injection |
| `rbac.ts` | Role-based access control (`requireRole(...)`) |
| `validation.ts` | Zod schema validation for body/params/query |
| `errorHandler.ts` | Centralized error handling with structured JSON responses |
| `sse.ts` | Server-Sent Events connection management |

---

## Frontend Assets

| File | Lines | Purpose |
| --- | --- | --- |
| `delivery-platform.html` | 1,013 | Marketing landing page for the delivery platform |
| `driver-apply.html` | 270 | Driver application form |
| `driver-portal.html` | 572 | Driver dashboard with route & earnings views |
| `css/gr-delivery.css` | 494 | Shared stylesheet for all marketing pages |

### GreenReach Central Governance Messaging (Updated)

Delivery-facing UX and docs now explicitly state that **GreenReach Central** is the operating authority ("mothership") for the wholesale delivery service and cross-party communication:

- `public/delivery-platform.html` — Central authority notice in hero section
- `public/driver-portal.html` — Central operations/governance banner in driver home view
- `public/driver-apply.html` — Central governance notice on public onboarding page
- `README.md` — operating authority section documenting Central control model

### GreenReach Central IA & Communication Paths (Expanded)

Delivery UX now includes explicit GreenReach Central navigation and contact pathways so all stakeholders can route updates and escalation through Central:

- `public/delivery-platform.html` — dedicated `GreenReach Central` nav anchor + stakeholder communication section and footer contacts
- `public/driver-apply.html` — dedicated `GreenReach Central` nav anchor + stakeholder communication section and footer contacts
- `public/driver-portal.html` — dedicated `GreenReach Central` nav anchor + sidebar help links for farms/buyers/drivers/ops escalation

---

## Configuration

| File | Key Settings |
| --- | --- |
| `env.ts` | 35 Zod-validated environment variables (server, DB, JWT, routing, pricing, driver pay, depot, tax, Stripe, S3) |
| `payout-policy.ts` | Per-route rates ($15 base, $0.55/km, $0.18/min, $1.25/stop, $0.20/wait-min), $22/hr minimum guarantee, POD exception hold rules, CRA T4A compliance |
| `.env.example` | Full template with all env vars documented |
| `docker-compose.yml` | PostgreSQL 16 dev database |

---

## Testing

| Test File | Tests | Coverage Area |
| --- | --- | --- |
| `routing.test.ts` | 3 | VRPTW solver, nearest-neighbor construction, 2-opt improvement |
| `pricing.test.ts` | 9 | Cost allocation, delivery fees, surcharges, margin calculation |
| `helpers.test.ts` | 7 | Number rounding, ID generation, date utilities |
| `payout-policy.test.ts` | 17 | Route pay calculation, minimum guarantee, exception handling |
| `driver-states.test.ts` | 20 | Driver state machine transitions, guard conditions |
| `delivery-events.test.ts` | 10 | SSE event type validation, event bus integration |
| **Total** | **66** | All algorithmic/pure-function code — no DB required |

### API Contract Smoke Suite

- `scripts/smoke-api.sh` runs **118 endpoint contract checks** across all API modules.
- Covers auth bootstrap, seeded fixture setup, role-protected routes, write/read flows, and expected business-rule errors (e.g., `400`, `404`, `409`) while failing on unexpected statuses.
- Integrated into CI via `smoke-api` GitHub Actions job (PostgreSQL service + migrate + seed + app boot + smoke run).

---

## Core Algorithms

### VRPTW Solver
1. **Construction** — Nearest-neighbor heuristic respecting capacity (weight/volume), time windows, max-stops
2. **Improvement** — 2-opt local search to reduce total distance

### Cost Allocation Formula
$$share_i = w_1 \cdot \frac{km_i}{\sum km} + w_2 \cdot \frac{min_i}{\sum min} + w_3 \cdot \frac{vol_i}{\sum vol} + w_4 \cdot \frac{1}{STOPS}$$

### Driver Pay
$$Pay = P_{base} + (KM \cdot p_{km}) + (MIN_{active} \cdot p_{min}) + (STOPS \cdot p_{stop}) + (WAIT \cdot p_{wait}) + Incentives - Deductions$$

Two minimum-guarantee mechanisms:
- **Payout policy** (settlement): $Pay \geq \$22/hr \times engaged\ hours$ (per `payout-policy.ts`)
- **Per-route driver pay** (pricing): $Pay \geq \$0.35/min \times active\ minutes$ = $21/hr (per `env.MIN_EARNINGS_RATE_PER_MIN`)

### Driver Scoring
$$Score = 0.35 \cdot Reliability + 0.25 \cdot \frac{1}{ETA} + 0.25 \cdot VehicleFit + 0.10 \cdot AcceptRate - 0.05 \cdot RiskFlags$$

---

## Quality Audit (Completed)

All issues identified during codebase audit have been resolved:

| # | Issue | Severity | Resolution |
| --- | --- | --- | --- |
| 1 | Phase 2 type enums diverged from SQL enums | Critical | Rewrote all 10 enum types to match SQL exactly |
| 2 | Phase 2 interface fields didn't match SQL columns | Critical | Rewrote all 12 interfaces with correct field names |
| 3 | Settlement POD exception keys mismatched DB values | Critical | Aligned payout-policy keys to `pod_exception` enum |
| 4 | Seed file used wrong column names throughout | Critical | Complete rewrite with correct columns + Phase 2 data |
| 5 | Depot coordinates hardcoded to (0, 0) | Medium | Now reads from `env.DEPOT_LAT` / `env.DEPOT_LNG` |
| 6 | Tax rate hardcoded to 0% | Medium | Now reads from `env.TAX_RATE` (default 13% HST) |
| 7 | `.env.example` missing Phase 2 variables | Medium | Added depot, tax, Stripe, S3 sections |
| 8 | README missing Phase 2 documentation | Medium | Added 6 modules, 39 endpoints, Phase 2 tables |

---

## File Inventory

```
95  TypeScript source files (src/)
 6  Test files (tests/*.test.ts)
 1  Test setup (tests/setup.ts)
 3  SQL files (2 migrations + 1 seed)
 4  HTML/CSS marketing pages
 4  Scripts (scripts/migrate.ts, scripts/seed.ts, src/scripts/migrate.ts, src/scripts/seed.ts)
 1  docker-compose.yml
 1  package.json
 1  package-lock.json
 1  tsconfig.json
 1  vitest.config.ts
 1  .env.example
 1  .gitignore
 1  README.md
 1  BUILD_REPORT.md
───
124 total project files
```

---

## Status

| Check | Result |
| --- | --- |
| TypeScript compilation | **0 errors** |
| Test suite | **66/66 passing** (277ms) |
| API smoke contract | **118 checks / 0 failures** |
| Seed data schema alignment | **Verified** (UUID-compatible, no invalid table references) |
| Type ↔ SQL contract | **Aligned** |
| Environment config | **Complete** |
| Documentation | **Up to date** |
