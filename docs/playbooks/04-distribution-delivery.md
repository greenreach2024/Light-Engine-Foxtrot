# 04 — Distribution & Delivery Playbook

**Owner:** Central admin
**Canonical references:** `docs/delivery/DELIVERY_SERVICE_ARCHITECTURE_PLAN.md`, `docs/delivery/DELIVERY_READINESS_REPORT_2026-03-06.md`

---

## 1. Purpose & scope

Foxtrot's distribution layer covers everything between "order placed" and "product handed to the buyer." It includes per-farm delivery configuration, buyer-facing pickup/delivery selection at checkout, Central-admin network visibility, and (post-MVP) driver assignment, routing, and live tracking. Read this before touching any delivery route, driver enrollment, delivery settings UI, or wholesale fulfillment handoff.

## 2. Scope (what IS and ISN'T in MVP)

### 2.1 MVP (live today)
1. **Delivery banner** on selected pages using existing design tokens
2. **Delivery settings persistence** per farm: fees, windows, service flags
3. **Wholesale checkout read-path** for fulfillment selection (`pickup` / `delivery`) with fee display
4. **Central admin read-only network visibility** (counts / status, no PII)
5. **Delivery orders** basic record (`delivery_orders` table)
6. **Driver enrollment form** (intake only)

### 2.2 Explicitly **OUT of MVP**
- Driver assignment
- Route optimization
- Live tracking
- Polygon geofencing / geospatial containment queries (invalid `JSONB::geometry` pattern was rejected in architecture review)
- Multi-farm delivery balancing
- Cross-border delivery

Anything in this list requires a new architecture review before implementation.

## 3. Data model

### 3.1 Farm-side delivery configuration
| Table | Purpose |
|---|---|
| `farm_delivery_settings` | Per-farm flags: delivery_enabled, pickup_enabled, default_fee, minimum_order, prep_time_hours |
| `farm_delivery_windows` | Weekly delivery time windows (day_of_week, start_time, end_time, capacity) |
| `farm_delivery_zones` | Delivery zones (name, fee, postal_code_prefixes[], max_distance_km) — **no polygons in MVP** |

All three are **tenant tables** with RLS `gr_tenant_isolation`.

### 3.2 Order-side
| Table | Purpose |
|---|---|
| `delivery_orders` | Links `wholesale_orders` or DTC orders to a delivery window + zone + fee |
| `driver_applications` | Intake records for prospective drivers |
| `driver_accounts` (post-MVP) | Active driver profiles |

### 3.3 Geo strategy (MVP)
- Zones are **postal-code-prefix driven**, not polygons
- Distance check (when needed) uses a simple haversine on farm origin + buyer geocoded point
- No PostGIS dependency in MVP

## 4. Key files

### 4.1 Central
- `greenreach-central/routes/admin-delivery.js` — admin CRUD for zones, windows, fees, driver applications
- `greenreach-central/routes/wholesale.js` — reads delivery settings at checkout
- `greenreach-central/public/views/admin-delivery.html` — admin UI
- `greenreach-central/public/driver-application.html` — driver intake
- `greenreach-central/public/driver-enrollment.html` — enrollment details

### 4.2 LE
- `routes/farm-sales/delivery.js` — farm-side delivery settings endpoints
- Delivery settings surface inside `LE-farm-admin.html`

## 5. API surface

### 5.1 Farm-scoped
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/farm/delivery/settings` | Read current farm delivery settings |
| PUT | `/api/farm/delivery/settings` | Update fees, windows, service flags |
| GET | `/api/farm/delivery/zones` | List farm's zones |
| POST | `/api/farm/delivery/zones` | Create zone |
| PUT | `/api/farm/delivery/zones/:id` | Update zone |
| DELETE | `/api/farm/delivery/zones/:id` | Remove zone |
| GET | `/api/farm/delivery/windows` | List windows |
| POST | `/api/farm/delivery/windows` | Create window |

### 5.2 Buyer-scoped (read at checkout)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/wholesale/delivery/options?cart=...` | Which farms offer delivery to this buyer's postal code, with fees |
| POST | `/api/wholesale/checkout/preview` | Includes `fulfillment: { mode: 'pickup' \| 'delivery', window_id, zone_id, fee }` |

### 5.3 Admin-scoped
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/delivery/network` | Network readiness counts (farms offering delivery, coverage, open windows) |
| GET | `/api/admin/delivery/drivers` | Driver applications list |
| POST | `/api/admin/delivery/drivers/:id/approve` | Approve driver (post-MVP) |

## 6. Data flow

```
Farm admin → /api/farm/delivery/settings (PUT)
   ↓
farm_delivery_settings + zones + windows updated (RLS-scoped)
   ↓
Buyer browses catalog → checkout preview
   ↓
/api/wholesale/checkout/preview reads settings per allocated farm
   ↓
Preview shows pickup vs. delivery + fee per farm
   ↓
Buyer confirms fulfillment per farm
   ↓
/api/wholesale/checkout/execute
   ↓
delivery_orders INSERT (links wholesale_order_id + zone + window + fee)
   ↓
Farm sees delivery on LE-wholesale-orders.html
   ↓
Farm acknowledges / prepares / (post-MVP: driver pickup)
```

## 7. Security & tenancy rules

- Every delivery endpoint resolves `req.farmId` from auth context before reading/writing
- Cross-farm admin views require admin JWT (RLS admin bypass)
- Driver PII is stored only in `driver_applications` / `driver_accounts`; no leakage to buyer-facing endpoints
- Fees returned to buyers are computed server-side; client cannot override
- Never accept `farm_id` in the body of a delivery mutation — derive from auth

## 8. Configuration

| Env var / setting | Purpose |
|---|---|
| `DELIVERY_DEFAULT_PREP_HOURS` | Default prep time when farm hasn't set one |
| `DELIVERY_MIN_ORDER_FALLBACK` | Minimum order fallback |
| Feature flag `delivery_service` | Gates delivery UI elements per farm tier |

## 9. Never do

- Introduce polygon geofencing without an architecture review and a clean geo model (the "JSONB::geometry" pattern was explicitly rejected)
- Let buyers pick a delivery window whose `capacity` is already exhausted
- Show driver PII on any buyer- or cross-farm admin view
- Couple wholesale commission to delivery fees — they are independent line items
- Copy delivery zones across farms implicitly; each farm owns its zones

## 10. Known gaps / open items

- **Driver assignment** — manual only; algorithm TBD post-MVP
- **Route optimization** — not implemented
- **Live tracking** — not implemented
- **Buyer geocoding** — uses postal-code prefix; no street-level precision yet
- **Multi-farm balancing** — no logic for splitting deliveries when a buyer orders from many nearby farms
- **Delivery capacity alerts** — windows can silently over-subscribe if UI allows

## 11. References

- `docs/delivery/DELIVERY_SERVICE_ARCHITECTURE_PLAN.md` (v1.1.0 — approved with constraints)
- `docs/delivery/DELIVERY_SERVICE_IMPLEMENTATION_PLAN.md`
- `docs/delivery/DELIVERY_SERVICE_IMPLEMENTATION_PLAN_REVIEW.md`
- `docs/delivery/DELIVERY_SERVICE_AUDIT_REPORT_2026-02-22.md`
- `docs/delivery/DELIVERY_READINESS_REPORT_2026-03-06.md`
- `docs/delivery/DELIVERY_SERVICE_IMPLEMENTATION_TASK_LIST.md`
- `greenreach-central/routes/admin-delivery.js`
- `routes/farm-sales/delivery.js`
