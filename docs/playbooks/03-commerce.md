# 03 — Commerce Playbook (Wholesale, Farm Sales, Payments)

**Owner:** Central admin + farm operators (per tenant)
**Canonical reference:** `.github/PAYMENT_WORKFLOW.md` (read this **before** modifying any payment code)
**Related docs:** `docs/wholesale/`, `docs/billing/`, `FINANCIAL_AUDIT_REPORT.md`

---

## 1. Purpose & scope

Foxtrot operates a **multi-tenant wholesale marketplace** where buyers purchase from multiple farms in a single checkout, plus per-farm **direct-to-consumer (DTC) farm sales**, plus platform **subscriptions**. All payments flow through Square (primary) or Stripe (subscriptions). A **12% broker commission** on wholesale is the platform's primary revenue model. This playbook is mandatory reading before touching any wholesale, farm-sales, payment, checkout, accounting, or webhook code.

**Currency:** All amounts are CAD.

## 2. Revenue streams

| Stream | Server | Payment rail | Commission |
|---|---|---|---|
| Wholesale marketplace | Central aggregates, LE fulfills | Square (per-farm OAuth or direct-charge fallback) | 12% via `app_fee_money` |
| Farm DTC sales (online shop) | LE Cloud Run (per-farm subdomain branding planned, not live) | Per-farm Square OAuth | Varies (farm keeps net) |
| Farm in-person POS | LE (`farm-sales-pos.html`) | Per-farm Square OAuth | Varies |
| Platform subscriptions | Central | Stripe | Flat subscription fees |
| Delivery fees | Central | Same rail as wholesale | Delivery fee line item |

## 3. Square integration architecture

### 3.1 Per-farm OAuth
- Farms connect their own Square merchant account via OAuth
- UI: `public/payment-setup.html` (standalone, not an iframe inside farm admin to avoid CSP complications)
- Route file: `greenreach-central/routes/square-oauth-proxy.js`
- Mount: `/api/farm/square` (canonical), `/api/square-proxy` (compat alias)
- Scopes: `ITEMS_READ, ITEMS_WRITE, ORDERS_READ, ORDERS_WRITE, PAYMENTS_READ, PAYMENTS_WRITE, MERCHANT_PROFILE_READ, CUSTOMERS_READ, CUSTOMERS_WRITE, INVOICES_READ, INVOICES_WRITE, REFUNDS_WRITE`
- OAuth state: HMAC-SHA256 signed, 15-minute TTL, nonce-based
- Credentials stored in farmStore under `square_oauth` key; encrypted at rest with `TOKEN_ENCRYPTION_KEY`

### 3.2 GreenReach master Square account
Used for:
- **Direct-charge fallback** when a farm has no Square OAuth connection
- **Card-on-file** management under GreenReach's Square customer records
- **Refunds** on direct-charge payments

Env vars: `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`.

### 3.3 OAuth endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/farm/square/` | Farm | Health/status |
| GET | `/api/farm/square/status` | Farm | Connection status |
| POST | `/api/farm/square/authorize` | Farm | Initiate OAuth |
| GET | `/api/farm/square/callback` | Public | Exchange code |
| POST | `/api/farm/square/refresh` | Farm | Refresh token |
| POST | `/api/farm/square/settings` | Farm | Fee policy, settlement mode |
| POST | `/api/farm/square/disconnect` | Farm | Revoke + remove |
| POST | `/api/farm/square/test-payment` | Farm | Validate by calling Square `/v2/locations` |

## 4. Wholesale pricing model

**File:** `greenreach-central/routes/wholesale.js`

### 4.1 SKU factor
`wholesale_base = retail_price * sku_factor`
- Production value: `WHOLESALE_DEFAULT_SKU_FACTOR=0.65` (set in `gcp/deploy-cloud-run.sh` ~L171)
- Code fallback when env var is unset: `0.75` (`getDefaultSkuFactor()` in `greenreach-central/routes/wholesale.js` ~L397)
- Allowed range: 0.50–0.75 (clamped by `getDefaultSkuFactor()`)

### 4.2 Buyer discount ladder (90-day rolling average order value)
| Rolling avg | Discount |
|---|---|
| $0–$749 | 0% |
| $750–$1,499 | 2% |
| $1,500–$2,999 | 4% |
| $3,000–$4,999 | 6% |
| $5,000+ | 8% |

Rolling average excludes cancelled, failed, and refunded orders.

### 4.3 Commission
- `WHOLESALE_COMMISSION_RATE=0.12` (hard-coded default; **do not change without business signoff**)
- Applied via Square `app_fee_money` on farm-split payments
- On direct-charge fallback, commission retained in GreenReach's Square account; farm payout accrues as payable in `accounting_*` tables

### 4.4 Taxes
- `loadFarmTaxConfig()` returns `{ rate, label }` per farm
- Taxes computed on the allocated subtotal, excluded from commission base

## 5. Wholesale checkout flow

**Route files:**
- `routes/wholesale/checkout.js` (LE-side aggregator)
- `greenreach-central/routes/wholesale.js` (Central-side marketplace)
- `greenreach-central/routes/wholesale-fulfillment.js`
- `greenreach-central/routes/payment-webhooks.js`

### 5.1 Stages

```
Buyer → GR-wholesale.html (browse)
  ↓ POST /api/wholesale/checkout/preview
    - validateCart() against catalog
    - allocateOrder() across farms (strategy: 'closest' | 'cheapest' | 'balanced')
    - compute SKU factor, buyer discount, commission (12%), tax per farm
  ↓ POST /api/wholesale/checkout/execute
    - Square Payment per farm (OAuth path) OR direct charge (fallback)
    - app_fee_money = commission * subtotal
    - wholesale_orders INSERT (per farm)
    - Inventory reservation (farm_inventory reserved_qty)
    - Notifications queued (email/SMS via wholesale-notification-service.js)
  → Farm: LE-wholesale-orders.html
    - Accept / Reject / Fulfill (POST /api/wholesale/orders/:id/fulfill)
  → Webhooks (Square): payment.updated, refund.updated → payment-webhooks.js
```

### 5.2 Catalog aggregation
Primary: `buildAggregateCatalog()` polls each farm's `/api/wholesale/catalog`.
Fallback (v1.3.0): Direct DB query on `farm_inventory WHERE available_for_wholesale = true`.

### 5.3 Order routing
`POST /api/wholesale/orders/route` re-routes an order's allocations when a farm rejects or runs short.

## 6. Farm DTC sales

### 6.1 Shop (per-farm branding planned)
- Page: `public/farm-sales-shop.html`
- URL today: served by LE Cloud Run at its default URL (`https://light-engine-*.run.app/farm-sales-shop.html`). Per-farm `<slug>.greenreachgreens.com/farm-sales-shop.html` is the **target** URL once subdomain multi-tenancy is live (see Playbook 01 §7); do not assume it resolves today.
- Uses the farm's own Square OAuth (no GreenReach commission by default)
- Inventory: `farm_inventory WHERE available_for_farm_sales = true`
- Square OAuth redirect URIs must track whichever host actually serves the shop — update them when the domain migration happens.

### 6.2 In-person POS
- Page: `public/farm-sales-pos.html`
- Embedded inside LE farm admin; auto-login from admin session (no separate login)
- Transactions post to farm's Square terminal

### 6.3 Custom products
- Route: `greenreach-central/routes/custom-products.js`
- Endpoint: `/api/farm/products` — CRUD + image upload
- Stored in `products` table (farm_id-scoped)

## 7. Inventory ↔ sales coupling

There are **two** inventory domains (see `.github/COMPLETE_SYSTEM_MAP.md` §15):

| Domain | Storage | Purpose |
|---|---|---|
| Supplies | `farm_data` JSONB keys (seeds, nutrients, packaging, equipment) | Inputs farm consumes |
| Crop/Product | `farm_inventory` table | Outputs farm sells |

Crop inventory has **two quantity columns**:
```
quantity_available = auto_quantity_lbs + manual_quantity_lbs
```
- `auto_quantity_lbs` — from tray harvest pipeline (`recalculateAutoInventoryFromGroups()`)
- `manual_quantity_lbs` — from manual entry (`POST /api/inventory/manual`)

**Critical gap (tracked in `.github/COMPLETE_SYSTEM_MAP.md` §15):** some sale paths do not deduct from inventory. When adding a new sale path, explicitly decrement `auto_quantity_lbs`/`manual_quantity_lbs` or add a reservation row.

## 8. Stripe subscriptions

- Used for platform subscriptions (plan tiers: `full`, `inventory-only`, `research`)
- Route: `greenreach-central/routes/billing.js`, `greenreach-central/routes/stripe-connect-control.js`
- Webhook: `/api/webhooks/stripe`, signature validated via `STRIPE_WEBHOOK_SECRET`
- Events handled: `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`
- On payment failure: farm is downgraded to read-only until resolved

## 9. Accounting (double-entry ledger)

- Tables: `accounting_accounts`, `accounting_transactions`, `accounting_entries`, `accounting_payouts`, `accounting_refunds`
- Every Square/Stripe event posts a double-entry transaction
- QuickBooks integration via `node-quickbooks` (read-only sync)
- Admin endpoints: `/api/accounting/*`, `/api/reports/*` (financial exports)
- Financial audit reports: `FINANCIAL_AUDIT_REPORT.md`, `CORRECTION-REPORT.md`, `RE-AUDIT-REPORT.md` (repo root)

## 10. Webhooks

| Path | Source | Auth | Purpose |
|---|---|---|---|
| `/api/webhooks/square` | Square | `SQUARE_WEBHOOK_SIGNATURE_KEY` HMAC | Payment / refund status updates |
| `/api/webhooks/stripe` | Stripe | `STRIPE_WEBHOOK_SECRET` | Subscription events |

Webhooks are **idempotent**: every handler checks an event ID against a dedupe store before acting.

## 11. Security & tenancy rules

- Square OAuth tokens are farm-scoped and RLS-protected
- Refund and void endpoints require `admin` or `manager` farm role
- Direct-charge fallback must always record `accounting_entries` crediting the farm
- Commission rate must not be tweaked per-order without an audited migration
- Webhooks must never be accepted without signature validation

## 12. Configuration

| Env var | Purpose |
|---|---|
| `SQUARE_APP_ID`, `SQUARE_APP_SECRET`, `SQUARE_ENVIRONMENT` | Per-farm OAuth app |
| `SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID` | Direct-charge fallback |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Webhook verification |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Subscription billing |
| `WHOLESALE_COMMISSION_RATE` (0.12) | Platform commission |
| `WHOLESALE_DEFAULT_SKU_FACTOR` (prod: `0.65` via `gcp/deploy-cloud-run.sh`; code fallback `0.75`) | Default wholesale base factor (clamped 0.50–0.75) |
| `TOKEN_ENCRYPTION_KEY` | Encrypts OAuth tokens at rest |
| `QUICKBOOKS_*` | QuickBooks OAuth (optional) |

## 13. Never do

- Change the 12% commission without business approval + migration + accounting backfill plan
- Issue a refund that bypasses the webhook idempotency check
- Skip signature validation on webhooks
- Store Square/Stripe secrets in `config/*.json` or commit to git
- Hand-edit `accounting_entries` to "fix" a mismatch — always use a compensating transaction
- Sell inventory from a farm without `available_for_wholesale` / `available_for_farm_sales` checks
- Mix farm OAuth tokens across farms in the in-memory cache

## 14. Known gaps / open items

- Some sale paths do not deduct from `farm_inventory` (see `.github/COMPLETE_SYSTEM_MAP.md` §15)
- QuickBooks sync is read-only; push-back of corrections is not implemented
- Buyer discount ladder is global; no per-farm override yet
- Dispute/chargeback flow is manual through Square dashboard
- `app_fee_money` pathway requires farm Square account; direct-charge fallback accrues commission differently in accounting

## 15. References

- `.github/PAYMENT_WORKFLOW.md` (canonical — 780+ lines)
- `.github/COMPLETE_SYSTEM_MAP.md` §6.5 (Wholesale order flow), §15 (Inventory workflow)
- `docs/WHOLESALE_INTEGRATION_GUIDE.md`, `docs/wholesale/WHOLESALE_INTEGRATION.md` (two companion docs; the `docs/wholesale/WHOLESALE_INTEGRATION_GUIDE.md` path from earlier drafts does not exist)
- `docs/billing/`
- `routes/wholesale/checkout.js`, `routes/wholesale-orders.js`, `routes/wholesale/square-oauth.js`
- `greenreach-central/routes/wholesale.js`, `square-oauth-proxy.js`, `billing.js`, `accounting.js`, `payment-webhooks.js`, `stripe-connect-control.js`
- `FINANCIAL_AUDIT_REPORT.md`, `CORRECTION-REPORT.md`, `RE-AUDIT-REPORT.md`
