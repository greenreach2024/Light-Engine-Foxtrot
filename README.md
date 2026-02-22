# Light-Engine-Foxtrot

**B2B farm-to-wholesale last-mile delivery platform** — routing, dispatch, pricing & settlement.

---

## Overview

Light-Engine-Foxtrot orchestrates the last mile for perishable-goods producers (farms, co-ops, food hubs) delivering to wholesale buyers. The platform handles:

### Operating Authority

**GreenReach Central** is the control unit ("mothership") for delivery operations across the wholesale network. All delivery workflows in Light-Engine-Foxtrot run under GreenReach Central governance for:

- Network-wide operating policy and compliance enforcement
- Driver onboarding standards and payout governance
- Cross-party communication to farms, buyers/receivers, and drivers
- Incident escalation, exception management, and service accountability

| Domain | Capability |
| --- | --- |
| **Ordering** | Multi-line orders per location with temp-class detection |
| **Wave Planning** | AM/PM wave splits, temp-class sub-grouping |
| **Routing (VRPTW)** | Vehicle Routing with Time Windows — nearest-neighbor + 2-opt solver |
| **Cost Allocation** | Proportional route-cost allocation across shared-route orders |
| **Driver Pay** | Base + mileage + time + stops + wait, with minimum-hourly guarantee |
| **POD** | Signature, photos, temp readings, exception capture |
| **Billing** | Invoice generation with configurable payment terms |
| **Telemetry** | GPS pings, ETA estimation, route-adherence metrics |
| **Notifications** | Multi-channel stubs (push / SMS / email) |
| **Driver Onboarding** | Application, documents, background checks, agreements |
| **Shipments** | Per-route shipment tracking with pickup/delivery lifecycle |
| **Live Tracking** | SSE-based driver state & event streaming |
| **Settlement** | Fee quotes, pay statements, hold/release for exceptions |
| **Payouts** | Batched driver payouts with Stripe integration (stub) |
| **Customer Members** | Multi-user customer accounts with role-based access |

### Actors

| Role | Description |
| --- | --- |
| `customer_admin` | Farm/producer account owner — manages catalog, locations, orders |
| `customer_user` | Farm staff — places and views orders |
| `driver` | Independent driver — accepts routes, records POD |
| `ops` | Platform operations — manages waves, dispatch, drivers |
| `admin` | Full system access |

---

## Tech Stack

- **Runtime**: Node.js 20+ / TypeScript 5
- **Framework**: Express 4
- **Database**: PostgreSQL 16 (via Knex query builder)
- **Validation**: Zod
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Logging**: Pino
- **Testing**: Vitest

---

## Project Structure

```
light-engine-foxtrot/
├── scripts/
│   ├── migrate.ts          # Run SQL migrations
│   └── seed.ts             # Load dev seed data
├── src/
│   ├── config/             # Env loader, DB config, payout policy
│   ├── db/
│   │   ├── migrations/     # Numbered SQL migrations
│   │   └── seeds/          # Dev seed SQL
│   ├── middleware/          # Auth, RBAC, validation, error handler
│   ├── modules/
│   │   ├── auth/
│   │   ├── billing/
│   │   ├── customer/
│   │   ├── customer-members/   # Phase 2
│   │   ├── dispatch/
│   │   ├── driver/
│   │   ├── driver-onboarding/  # Phase 2
│   │   ├── notification/
│   │   ├── order/
│   │   ├── payout/             # Phase 2
│   │   ├── pod/
│   │   ├── pricing/
│   │   ├── routing/
│   │   ├── settlement/         # Phase 2
│   │   ├── shipment/           # Phase 2
│   │   ├── telemetry/
│   │   └── tracking/           # Phase 2
│   ├── shared/
│   │   ├── constants/
│   │   ├── types/
│   │   └── utils/
│   │       ├── delivery-events.ts  # Phase 2 — SSE event definitions
│   │       ├── driver-states.ts    # Phase 2 — driver state machine
│   │       └── event-bus.ts        # Phase 2 — in-process event emitter
│   ├── app.ts              # Express app factory
│   └── index.ts            # Server entrypoint
├── tests/
│   ├── modules/            # Domain unit tests
│   └── setup.ts            # Test env stubs
├── docker-compose.yml      # PostgreSQL dev database
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

Each module follows the pattern: **validation → service → controller → routes**.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- Docker (for PostgreSQL) or a running PostgreSQL 16 instance

### 1. Install dependencies

```bash
npm install
```

### 2. Start the database

```bash
docker compose up -d
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env if you changed DB credentials
```

### 4. Run migrations

```bash
npm run migrate
```

### 5. Seed dev data

```bash
npm run seed
```

### 6. Start the server

```bash
npm run dev
```

The API will be available at `http://localhost:3000/api/v1`.

---

## NPM Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Start with hot-reload (tsx watch) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled JS from `dist/` |
| `npm run migrate` | Apply pending SQL migrations |
| `npm run seed` | Load dev seed data |
| `npm test` | Run Vitest test suite |
| `npm run lint` | ESLint check |
| `npm run typecheck` | TypeScript type check (no emit) |

---

## API Reference

All endpoints are prefixed with `/api/v1`. Auth is via `Authorization: Bearer <jwt>`.

### Auth

| Method | Path | Description |
| --- | --- | --- |
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | Login → JWT |
| GET | `/auth/me` | Current user profile |

### Customers

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/customers` | ops, admin |
| GET | `/customers` | ops, admin |
| GET | `/customers/:id` | ops, admin, own customer |
| PUT | `/customers/:id` | ops, admin |
| POST | `/customers/:id/locations` | ops, admin |
| GET | `/customers/:id/locations` | ops, admin, own customer |
| POST | `/customers/:id/catalog` | ops, admin |
| GET | `/customers/:id/catalog` | ops, admin, own customer |

### Orders

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/orders` | customer_admin, customer_user, ops, admin |
| GET | `/orders` | any authenticated (filtered by role) |
| GET | `/orders/:id` | any authenticated (own) |
| PATCH | `/orders/:id/status` | ops, admin |

### Drivers

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/drivers` | ops, admin |
| GET | `/drivers` | ops, admin |
| GET | `/drivers/:id` | ops, admin, own driver |
| PUT | `/drivers/:id` | ops, admin |
| PATCH | `/drivers/:id/availability` | driver (own), ops, admin |

### Dispatch (Waves)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/dispatch/waves` | ops, admin |
| GET | `/dispatch/waves` | ops, admin |
| GET | `/dispatch/waves/:id` | ops, admin |
| POST | `/dispatch/waves/:id/plan` | ops, admin |
| POST | `/dispatch/waves/:waveId/routes/:routeId/offer` | ops, admin |
| POST | `/dispatch/offers/:offerId/respond` | driver |

### Routing

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/routing/waves/:waveId/solve` | ops, admin |
| GET | `/routing/routes/:id` | ops, admin, assigned driver |

### Pricing

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/pricing/routes/:routeId/quote` | ops, admin |
| POST | `/pricing/simple-quote` | ops, admin |

### Proof of Delivery

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/pod` | driver |
| GET | `/pod/:stopId` | any authenticated |

### Billing

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/billing/invoices/generate` | ops, admin |
| GET | `/billing/invoices` | ops, admin, own customer |
| GET | `/billing/invoices/:id` | ops, admin, own customer |
| PATCH | `/billing/invoices/:id/pay` | ops, admin |
| POST | `/billing/payouts/generate` | ops, admin |
| GET | `/billing/payouts` | ops, admin, own driver |
| PATCH | `/billing/payouts/:id/pay` | ops, admin |

### Telemetry

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/telemetry/ping` | driver |
| POST | `/telemetry/ping/batch` | driver |
| GET | `/telemetry/drivers/:driverId/latest` | ops, admin |
| GET | `/telemetry/routes/:routeId/track` | ops, admin, assigned driver |
| GET | `/telemetry/routes/:routeId/eta` | any authenticated |
| GET | `/telemetry/routes/:routeId/adherence` | ops, admin |

### Notifications

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/notifications/send` | ops, admin |
| GET | `/notifications` | any authenticated |
| PATCH | `/notifications/:id/read` | any authenticated |

### Driver Onboarding (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/driver-onboarding/apply` | driver |
| GET | `/driver-onboarding/applications` | ops, admin |
| GET | `/driver-onboarding/applications/:id` | ops, admin, own driver |
| PATCH | `/driver-onboarding/applications/:id/status` | ops, admin |
| POST | `/driver-onboarding/documents` | driver |
| GET | `/driver-onboarding/documents/:driverId` | ops, admin, own driver |
| PATCH | `/driver-onboarding/documents/:id/review` | ops, admin |
| POST | `/driver-onboarding/background-checks` | ops, admin |
| PATCH | `/driver-onboarding/background-checks/:id` | ops, admin |
| POST | `/driver-onboarding/agreements` | driver |
| PATCH | `/driver-onboarding/agreements/:id/sign` | driver |

### Shipments (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/shipments` | ops, admin |
| GET | `/shipments` | ops, admin, own driver |
| GET | `/shipments/:id` | ops, admin, own driver |
| PATCH | `/shipments/:id/status` | driver, ops, admin |

### Tracking (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/tracking/state` | driver |
| GET | `/tracking/state/:driverId` | ops, admin |
| POST | `/tracking/events` | driver, ops, admin |
| GET | `/tracking/events/:shipmentId` | ops, admin, own driver |
| GET | `/tracking/stream/:driverId` | ops, admin (SSE) |

### Settlement (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/settlement/fee-quotes` | ops, admin |
| GET | `/settlement/fee-quotes/:routeId` | ops, admin |
| POST | `/settlement/pay-statements/generate` | ops, admin |
| GET | `/settlement/pay-statements` | ops, admin, own driver |
| GET | `/settlement/pay-statements/:id` | ops, admin, own driver |
| PATCH | `/settlement/pay-statements/:id/finalize` | ops, admin |
| PATCH | `/settlement/pay-statements/:id/resolve-hold` | ops, admin |

### Payouts (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/payouts/batches` | ops, admin |
| GET | `/payouts/batches` | ops, admin |
| GET | `/payouts/batches/:id` | ops, admin |
| PATCH | `/payouts/batches/:id/approve` | admin |
| POST | `/payouts/batches/:id/process` | ops, admin |
| GET | `/payouts/drivers/:driverId` | ops, admin, own driver |

### Customer Members (Phase 2)

| Method | Path | Roles |
| --- | --- | --- |
| POST | `/customer-members` | customer_admin |
| GET | `/customer-members/:customerId` | customer_admin, ops, admin |
| PATCH | `/customer-members/:id/role` | customer_admin |
| DELETE | `/customer-members/:id` | customer_admin |

---

## Core Algorithms

### VRPTW Solver

The routing engine solves a **Vehicle Routing Problem with Time Windows**:

1. **Construction** — Nearest-neighbor heuristic: greedily inserts the closest feasible stop, respecting capacity (weight/volume), time windows, and max-stops constraints.
2. **Improvement** — 2-opt local search: iteratively reverses sub-sequences within each route to reduce total distance.

### Route Cost Formula

$$C_{route} = (KM \cdot c_{km}) + (MIN \cdot c_{min}) + (STOPS \cdot c_{stop}) + (WAIT \cdot c_{wait}) + C_{tolls} + C_{cold}$$

### Cost Allocation

Each order's share of the route cost:

$$share_i = w_1 \cdot \frac{km_i}{\sum km} + w_2 \cdot \frac{min_i}{\sum min} + w_3 \cdot \frac{vol_i}{\sum vol} + w_4 \cdot \frac{1}{STOPS}$$

Default weights: $w_1 = 0.45, w_2 = 0.35, w_3 = 0.15, w_4 = 0.05$

Final delivery fee per order:

$$fee_i = \max(Floor,\ share_i \cdot C_{route}) \cdot (1 + Margin) + Surcharges$$

### Driver Pay

$$Pay = P_{base} + (KM \cdot p_{km}) + (MIN_{active} \cdot p_{min}) + (STOPS \cdot p_{stop}) + (WAIT \cdot p_{wait}) + Incentives - Deductions$$

Minimum guarantee: $Pay \geq MinRate \times MIN_{active}$

### Driver Scoring

$$Score = a \cdot Reliability + b \cdot \frac{1}{ETA_{pickup}} + c \cdot VehicleFit + d \cdot AcceptanceRate - e \cdot RiskFlags$$

Weights: $a=0.35, b=0.25, c=0.25, d=0.10, e=0.05$

---

## Database

The schema uses 35 tables across two migrations with PostgreSQL enums for type safety.

### Phase 1 — Core Tables

- **users** — all actors with role-based access
- **customers / customer_locations** — producers and their delivery destinations
- **orders / order_lines** — delivery orders with line items
- **waves** — dispatch groupings (AM/PM)
- **routes / route_stops** — optimised delivery routes with per-stop marginal contributions
- **driver_offers** — route offer/accept/decline workflow
- **proof_of_delivery** — signature, photos, temp, exceptions
- **invoices / driver_payouts** — settlement records
- **gps_pings** — real-time telemetry
- **pricing_config** — rate cards

### Phase 2 — Delivery Platform Tables

- **driver_applications** — onboarding lifecycle tracking
- **driver_documents** — licence, insurance, vehicle photos with review workflow
- **driver_background_checks** — third-party background check records
- **driver_agreements** — contractor agreements with e-signature
- **driver_payout_accounts** — Stripe Connect payout accounts
- **shipments** — per-route shipment tracking
- **fee_quotes** — per-route driver fee quotes from payout policy
- **pay_statements / pay_statement_lines** — itemised pay with hold/release
- **payout_batches / payouts** — batched driver payouts via Stripe
- **customer_members** — multi-user customer accounts with roles

Run `npm run migrate` to apply the schema.

---

## Testing

```bash
npm test
```

Unit tests cover the VRPTW solver, cost allocation, driver pay calculations, payout policy, settlement logic, and shared utilities. Tests use Vitest and run without a database connection (pure algorithmic testing). 66 tests across 6 test files.

---

## License

Private — all rights reserved.
