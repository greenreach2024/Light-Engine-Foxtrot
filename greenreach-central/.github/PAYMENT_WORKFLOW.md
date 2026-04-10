# Payment Workflow Reference

**Version**: 1.0.0
**Date**: April 8, 2026
**Authority**: Canonical reference for all payment processing, wholesale checkout, accounting, and Square integration. Agents MUST read this before modifying any payment, checkout, accounting, or webhook code.

---

## Overview

GreenReach operates a wholesale marketplace where buyers purchase produce from multiple farms in a single checkout. Payments are processed through Square with a multi-tenant architecture:

- Each farm can connect their own Square account via OAuth
- When farms lack Square, GreenReach processes payment on their behalf (direct-charge fallback)
- A 12% broker commission (app_fee_money) is collected on every farm-split payment
- Double-entry accounting tracks all revenue, payables, payouts, and refunds
- Square and Stripe webhooks provide real-time payment status updates

**Currency**: All amounts are in **CAD** (Canadian Dollars).

---

## Square Integration Architecture

### Multi-Tenant OAuth (Per-Farm)

Each farm connects their own Square merchant account through an OAuth flow. This allows GreenReach to charge buyers on behalf of individual farms while collecting a broker commission.

**Route File**: `greenreach-central/routes/square-oauth-proxy.js`
**Mount Points**: `/api/farm/square` (canonical), `/api/square-proxy` (compat alias)

**Environment Variables**:

| Variable | Purpose |
|----------|---------|
| `SQUARE_APP_ID` | GreenReach's Square application ID |
| `SQUARE_APP_SECRET` | GreenReach's Square application secret |
| `SQUARE_ENVIRONMENT` | `production` or `sandbox` |
| `SQUARE_ACCESS_TOKEN` | GreenReach's own Square access token (for direct-charge fallback) |
| `SQUARE_LOCATION_ID` | GreenReach's own Square location ID (for direct-charge fallback) |

### OAuth Flow

```
Farm Admin UI (payment-setup.html)
       |
       | POST /api/farm/square/authorize
       v
Square OAuth Authorization Page
       |
       | User approves scopes
       v
GET /api/farm/square/callback?code=xxx&state=xxx
       |
       | Exchange code for access_token + refresh_token
       | Fetch merchant locations
       | Store credentials in farmStore (square_oauth key)
       v
Farm Square Account Connected
```

**OAuth scopes requested**: `ITEMS_READ, ITEMS_WRITE, ORDERS_READ, ORDERS_WRITE, PAYMENTS_READ, PAYMENTS_WRITE, MERCHANT_PROFILE_READ, CUSTOMERS_READ, CUSTOMERS_WRITE, INVOICES_READ, INVOICES_WRITE, REFUNDS_WRITE`

**OAuth state security**: HMAC-SHA256 signed, 15-minute TTL, nonce-based, in-memory Map store

**Stored credentials** (in farmStore as `square_oauth`):
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "merchant_id": "...",
  "location_id": "...",
  "expires_at": "...",
  "scopes": ["..."]
}
```

### Square OAuth Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/farm/square/` | Farm auth | Health/status check, reports configuration state |
| GET | `/api/farm/square/status` | Farm auth | Connection status (connected, merchantId, locationId, scopes) |
| POST/GET | `/api/farm/square/authorize` | Farm auth | Initiates OAuth flow, returns authorizationUrl |
| GET | `/api/farm/square/callback` | Public | OAuth redirect handler, exchanges code for token |
| POST | `/api/farm/square/refresh` | Farm auth | Refreshes OAuth token using refresh_token |
| POST | `/api/farm/square/settings` | Farm auth | Update payment settings (fee_policy, settlement_mode) |
| POST | `/api/farm/square/disconnect` | Farm auth | Revokes token and removes credentials |
| POST | `/api/farm/square/disconnect/:farmId` | Farm auth | Same, with explicit farmId |
| POST | `/api/farm/square/test-payment` | Farm auth | Tests connection by calling Square /v2/locations |

### GreenReach Master Square Account

GreenReach maintains its own Square account used for:
1. **Direct-charge fallback** -- when a farm lacks their own Square OAuth credentials
2. **Card-on-file management** -- buyer cards are stored under GreenReach's Square customer records
3. **Refunds** on direct-charge payments

Credentials: `SQUARE_ACCESS_TOKEN` + `SQUARE_LOCATION_ID` env vars (Secret Manager).

---

## Wholesale Checkout Flow

### Pricing Model

**File**: `greenreach-central/routes/wholesale.js`

#### SKU Factor

Wholesale base price = `retail_price * sku_factor`

- Default SKU factor: **0.65** (`WHOLESALE_DEFAULT_SKU_FACTOR` env var)
- Allowed range: 0.50 -- 0.75
- Applied per-product to derive the wholesale base from retail price

#### Buyer Discount Ladder

Discounts are tiered based on a buyer's 90-day rolling average order value. Computed by `getBuyerDiscountRateFromRollingAverage()`.

| 90-Day Rolling Avg Order Value | Discount Rate |
|-------------------------------|---------------|
| $0 -- $749 | 0% |
| $750 -- $1,499 | 2% |
| $1,500 -- $2,999 | 4% |
| $3,000 -- $4,999 | 6% |
| $5,000+ | 8% |

Rolling average excludes cancelled, failed, and refunded orders.

#### Final Pricing Formula

```
step 1: base = max(floor, retail * sku_factor)
step 2: final = max(floor, base * (1 - discount_rate))
```

Where:
- `floor` = max(cost floor, 20th percentile of wholesale prices)
- `retail` = aggregate retail price (mean, outliers removed)
- `sku_factor` = 0.65 default (configurable 0.50--0.75)
- `discount_rate` = from the buyer discount ladder

### Checkout Endpoints

**Rate limit**: 10 requests per buyer per minute (`checkoutLimiter`)

#### Preview: `POST /api/wholesale/checkout/preview`

Requires buyer auth. Returns allocation preview without processing payment.

**Request body**: `{ cart, recurrence, sourcing }`
**Response**: `{ farm_sub_orders, payment_split }`

Uses `shouldUseNetworkAllocation()` to decide live vs demo allocation path. Calls `allocateCartFromNetwork()` or `allocateCartFromDemo()`.

#### Execute: `POST /api/wholesale/checkout/execute`

Requires buyer auth. Full checkout with payment processing.

**Request body**:
```json
{
  "buyer_account": { "email": "..." },
  "delivery_date": "2026-04-15",
  "delivery_address": { ... },
  "recurrence": "one-time",
  "cart": [{ "product_id": "...", "quantity": 10 }],
  "payment_provider": "square",
  "source_id": "nonce-from-square-web-sdk",
  "sourcing": "network",
  "po_number": "PO-123",
  "fulfillment_method": "delivery",
  "delivery_fee": 25.00
}
```

**Validation**:
- Email required
- Delivery date required and valid
- Cart non-empty
- Delivery address required (unless pickup)
- Square `source_id` required when payment_provider is `square`

**Flow**:
1. Validate request body
2. Allocate cart from network catalog (`allocateCartFromNetwork()`)
3. Safety check: if allocation failed, block checkout + send critical alert email
4. Split cart into per-farm sub-orders
5. Process payment (farm-split or GreenReach direct)
6. Create order records
7. Ingest revenue into accounting ledger
8. Send buyer confirmation email

### Commission Rate

**Broker commission**: **12%** (`WHOLESALE_COMMISSION_RATE` env var, default 0.12)

Collected via Square `app_fee_money` on farm-split payments. On GreenReach direct-charge payments, the commission is tracked via accounting ledger only (GreenReach receives the full amount).

---

## Payment Processing

**File**: `greenreach-central/services/squarePaymentService.js`

### Payment Decision Tree

```
Checkout Execute
       |
       | For each farm sub-order:
       |   Does farm have Square OAuth?
       |
       +-- YES --> processSquarePayments()
       |           Charge buyer on FARM's Square account
       |           app_fee_money = 12% broker commission
       |           GreenReach collects commission via Square
       |
       +-- NO  --> processGreenReachDirectPayment()
                   Charge buyer on GREENREACH's Square account
                   Full amount to GreenReach
                   greenreach_held: true
                   Commission tracked via accounting only
```

### Farm-Split Payment: `processSquarePayments(params)`

**Parameters**: `{ masterOrderId, farmSubOrders[], paymentSource: { source_id, customer_id }, commissionRate }`

**Flow**:
1. Fetch each farm's Square OAuth credentials via `getBatchFarmSquareCredentials(farmIds)`
2. Loop per farm sub-order:
   - Calculate `brokerFeeCents = Math.round(amountCents * commissionRate)`
   - Create payment on the farm's Square account
   - Pass `app_fee_money: { amount: brokerFeeCents, currency: 'CAD' }` -- Square collects this for GreenReach
3. Return per-farm results: `{ paymentId, amountMoney, brokerFeeMoney, status }`

**Idempotency**: SHA-256 of `masterOrderId:farmId:amountCents`

### GreenReach Direct-Charge: `processGreenReachDirectPayment(params)`

**Used when**: Farm(s) in the order do not have Square OAuth credentials connected.

**Flow**:
1. Aggregate total amount across all sub-orders missing Square
2. Charge the full amount to GreenReach's own Square account (`SQUARE_ACCESS_TOKEN`, `SQUARE_LOCATION_ID`)
3. **No `app_fee_money`** -- GreenReach receives everything
4. Return with `greenreach_held: true` flag
5. Commission and farm payouts tracked in accounting ledger

### Refund: `refundPayment(params)`

**Parameters**: `{ paymentId, farmId, amountCents, reason, orderId }`

**Flow**:
1. Look up farm Square credentials
2. Call `provider.refundPayment()` on the farm's Square account
3. Idempotency key: `sha256("refund:{orderId}:{farmId}:{amountCents}")`
4. Return `{ success, refundId, status }`

### Card-on-File Management

Buyer payment cards are stored under GreenReach's Square customer records.

| Function | Purpose |
|----------|---------|
| `saveCardOnFile({ buyerId, email, displayName, phone, cardNonce })` | Creates Square customer + saves card. Returns `{ squareCustomerId, squareCardId, brand, last4, expMonth, expYear }` |
| `getCardOnFile(squareCustomerId)` | Retrieves saved card details |
| `removeCardOnFile(squareCustomerId)` | Removes card from Square |

### Demo/Manual Payment

`createDemoPaymentRecord(orderId, amount)` -- returns a `pending_manual` stub record for testing or manual payment scenarios.

---

## Order State Machine

**File**: `greenreach-central/services/orderStateMachine.js`

### Order Status Transitions

```
new             -> pending, confirmed, cancelled, rejected
pending         -> confirmed, processing, cancelled, rejected
confirmed       -> processing, shipped, cancelled
processing      -> shipped, cancelled
shipped         -> delivered, returned
delivered       -> (terminal)
cancelled       -> (terminal)
returned        -> (terminal)
payment_failed  -> confirmed, cancelled
pending_payment -> confirmed, cancelled
```

### Fulfillment Status Transitions

```
pending    -> processing, fulfilled, cancelled, shipped
processing -> fulfilled, cancelled, shipped
fulfilled  -> shipped, delivered
shipped    -> delivered
cancelled  -> (terminal)
delivered  -> (terminal)
```

**Functions**: `transitionOrderStatus(order, newStatus)`, `transitionFulfillmentStatus(order, newStatus)`, `promoteOrderStatus(order)` (syncs order status when fulfillment advances).

### Order Lifecycle

```
Cart -> Checkout Execute -> confirmed
                              |
                    Payment webhook (payment.completed)
                              |
                           confirmed -> processing -> shipped -> delivered
                              |
                    (if payment failed)
                              |
                        payment_failed -> confirmed (retry) or cancelled
```

**Auto-expiry**: Unconfirmed orders expire after 48 hours.
**Archive**: Orders older than 90 days archived to CSV (`data/wholesale-orders-archive.csv`).

---

## Wholesale Order Store

**File**: `greenreach-central/services/wholesaleMemoryStore.js`

### In-Memory + DB Hybrid

The wholesale store uses an in-memory Map backed by PostgreSQL persistence:

**In-memory stores**: `buyersByEmail`, `buyersById`, `ordersById`, `ordersByBuyerId`, `paymentsById`, `refundsById`, `tokenBlacklist`, `loginAttempts`, `passwordResetTokens`, `orderAuditLog`

**Buyer authentication**: Always re-reads password hash from DB (`authenticateBuyer()`) for multi-instance safety on Cloud Run.

**Login security**: Max 10 login attempts, 5-minute lockout (`MAX_LOGIN_ATTEMPTS = 10`, `LOCKOUT_DURATION_MS = 300000`).

**Token blacklist**: In-memory + `token_blacklist` DB table, 7-day expiry, max 10k entries in memory.

---

## Double-Entry Accounting

**File**: `greenreach-central/services/revenue-accounting-connector.js`

### Chart of Accounts

| Code | Name | Class |
|------|------|-------|
| 100000 | Cash | Asset |
| 110000 | Accounts Receivable - Buyer | Asset |
| 200000 | Accounts Payable | Liability |
| 210000 | Revenue - Subscriptions | Income |
| 250000 | Accounts Payable - Farm Payouts | Liability |
| 310000 | Sales Tax Payable | Liability |
| 400100 | Revenue - Wholesale | Income |
| 500000 | Cost of Goods Sold | Expense |
| 630000 | Payment Processing Fees | Expense |
| 640000 | Broker Fee Revenue | Income |

### Processing Fee Rates

| Provider | Rate |
|----------|------|
| Square | 2.6% |
| Stripe | 2.9% |

### Journal Entry Functions

#### `ingestPaymentRevenue(params)`

Records revenue when a payment completes.

**Parameters**: `{ payment_id, order_id, amount, currency, provider, broker_fee, tax_amount, source_type, description }`

**Journal entries**:
- Debit `100000` (Cash) or `110000` (AR-Buyer for manual payments) -- full payment amount
- Credit `400100` (Revenue - Wholesale) or `210000` (Revenue - Subscriptions) -- net revenue
- Credit `310000` (Sales Tax Payable) -- tax amount
- Credit `640000` (Broker Fee Revenue) -- broker commission
- Debit `630000` (Processing Fees) -- provider fee (2.6% or 2.9%)
- Credit Cash/AR -- processing fee offset

**Idempotency**: `sha256("revenue|{provider}|{payment_id}|{order_id}|{amount}")`
**Balance check**: Validates total debits == total credits within $0.01.

#### `ingestFarmPayables(params)`

Records what GreenReach owes each farm after a successful payment.

**Parameters**: `{ order_id, payment_id, farm_sub_orders[], currency, provider }`

**Journal entries** (per farm sub-order):
- Debit `500000` (COGS) -- farm's portion
- Credit `250000` (AP - Farm Payouts) -- obligation to farm

#### `ingestFarmPayout(params)`

Records when GreenReach settles a farm payout.

**Parameters**: `{ payout_id, order_id, farm_id, farm_name, amount, currency, provider }`

**Journal entries**:
- Debit `250000` (AP - Farm Payouts) -- clears the obligation
- Credit `100000` (Cash) -- money leaves GreenReach

#### `ingestRefundReversal(params)`

Reverses revenue when a refund is processed.

**Parameters**: `{ refund_id, order_id, amount, currency, provider }`

**Journal entries**:
- Debit `400100` (Revenue - Wholesale) -- reduce revenue
- Credit `100000` (Cash) -- money returned

All functions use idempotency keys to prevent double-posting.

---

## Webhook Processing

**File**: `greenreach-central/routes/payment-webhooks.js`
**Mount**: `/api/webhooks/square` and `/api/webhooks/stripe`

### Deduplication

All webhooks are deduplicated via the `webhook_events_processed` table:
- `event_id` TEXT PRIMARY KEY
- `provider` TEXT
- `received_at` TIMESTAMPTZ

Scoped key format: `{provider}:{eventId}`. Duplicate events are acknowledged (200) but not reprocessed.

### Square Webhooks (`POST /api/webhooks/square`)

**Verification**: HMAC-SHA256 using `SQUARE_WEBHOOK_SIGNATURE_KEY`
```
signature = base64(HMAC-SHA256(signatureKey, notificationUrl + rawBody))
```
Compared against `x-square-hmacsha256-signature` header.

**Handled events**:

| Event | Action |
|-------|--------|
| `payment.created` | Update payment_records status |
| `payment.updated` (COMPLETED) | Update status, ingest revenue into accounting, advance order to confirmed, send buyer email |
| `refund.created` | Update payment metadata |
| `refund.updated` (COMPLETED) | Update metadata, ingest refund reversal into accounting, cancel order if valid transition |

**Status mapping** (`mapSquareStatus()`): APPROVED -> authorized, COMPLETED -> completed, PENDING -> created, CANCELED/FAILED -> failed

### Stripe Webhooks (`POST /api/webhooks/stripe`)

**Verification**: Custom `verifyStripeSignature()` (no Stripe SDK dependency)
```
Parse stripe-signature header: t=<timestamp>,v1=<sig>
signature = hex(HMAC-SHA256(secret, timestamp + "." + payload))
```
**Replay protection**: Rejects timestamps older than 5 minutes.

**Handled events**:

| Event | Action |
|-------|--------|
| `payment_intent.succeeded` | Mark completed, ingest revenue |
| `payment_intent.payment_failed` | Mark failed |
| `charge.refunded` | Update metadata, ingest refund reversal |
| `charge.refund.updated` | Update metadata, ingest refund reversal |

---

## Admin Tools for Payment Management

### Stuck Order Processing

**File**: `greenreach-central/routes/wholesale.js`

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /api/wholesale/admin/orders/:orderId/charge-greenreach` | Admin auth | Manually charge a stuck order via GreenReach direct-charge |
| `POST /api/wholesale/admin/orders/process-pending` | Admin auth | Batch-process all pending payment orders |

### Payment Configuration

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /api/wholesale/payment-config` | Buyer auth | Returns Square app ID, location, environment for frontend SDK |
| `GET /api/wholesale/delivery-quote` | Buyer auth | Returns delivery fee estimate |

---

## Database Schema

### payment_records

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | Auto-increment |
| payment_id | VARCHAR UNIQUE | Square/Stripe payment ID |
| order_id | VARCHAR | Links to wholesale_orders.master_order_id |
| amount | NUMERIC(10,2) | Payment amount |
| currency | VARCHAR | Default: CAD |
| provider | VARCHAR | `square` or `stripe` |
| status | VARCHAR | Default: `pending`. Values: pending, created, authorized, completed, failed |
| metadata | JSONB | Provider-specific data (broker_fee, farm_id, greenreach_held, etc.) |
| created_at | TIMESTAMPTZ | |

### wholesale_orders

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | Auto-increment |
| master_order_id | VARCHAR UNIQUE | e.g., `WO-20260408-ABC123` |
| buyer_id | VARCHAR | Links to wholesale_buyers.id |
| buyer_email | VARCHAR | |
| status | VARCHAR | See Order State Machine above |
| total_amount | NUMERIC(12,2) | |
| order_data | JSONB | Full order details (items, sub-orders, delivery, payment info) |
| farm_id | VARCHAR | Per-farm sub-order farm ID |
| delivery_date | DATE | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### wholesale_buyers

| Column | Type | Notes |
|--------|------|-------|
| id | VARCHAR PK | Generated buyer ID |
| business_name | VARCHAR | |
| contact_name | VARCHAR | |
| email | VARCHAR UNIQUE | |
| buyer_type | VARCHAR | |
| location | JSONB | Address/coordinates |
| password_hash | VARCHAR | bcrypt |
| status | VARCHAR | active/deactivated |
| phone | VARCHAR | |
| square_customer_id | VARCHAR | Square customer record ID |
| square_card_id | VARCHAR | Stored card-on-file ID |
| key_contact | VARCHAR | |
| backup_contact | VARCHAR | |
| backup_phone | VARCHAR | |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

### wholesale_order_logs

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| sub_order_id | VARCHAR | |
| farm_id | VARCHAR | |
| action | VARCHAR | Event type |
| details | JSONB | Event data |
| performed_by | VARCHAR | |
| created_at | TIMESTAMPTZ | |

### Accounting Tables

#### accounting_sources

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| source_key | VARCHAR UNIQUE | e.g., `square`, `stripe` |
| source_name | VARCHAR | |
| source_type | VARCHAR | |
| active | BOOLEAN | |
| config | JSONB | |
| created_at / updated_at | TIMESTAMPTZ | |

#### accounting_accounts

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| account_code | VARCHAR UNIQUE | e.g., `100000`, `400100` |
| account_name | VARCHAR | e.g., `Cash`, `Revenue - Wholesale` |
| account_class | VARCHAR | Asset, Liability, Income, Expense |
| account_type | VARCHAR | |
| parent_account_code | VARCHAR | For sub-accounts |
| is_active | BOOLEAN | |
| metadata | JSONB | |
| created_at / updated_at | TIMESTAMPTZ | |

#### accounting_transactions

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| source_id | FK -> accounting_sources | |
| source_txn_id | VARCHAR | Provider's transaction ID |
| idempotency_key | VARCHAR UNIQUE | Prevents double-posting |
| txn_date | DATE | |
| description | VARCHAR | |
| currency | VARCHAR | Default: CAD |
| total_amount | NUMERIC(12,2) | |
| status | VARCHAR | Default: `posted` |
| raw_payload | JSONB | Original event data |
| created_at / updated_at | TIMESTAMPTZ | |

#### accounting_entries

| Column | Type | Notes |
|--------|------|-------|
| id | BIGSERIAL PK | |
| transaction_id | FK -> accounting_transactions (CASCADE) | |
| line_number | INTEGER | UNIQUE with transaction_id |
| account_code | FK -> accounting_accounts | |
| debit | NUMERIC(12,2) | CHECK >= 0 |
| credit | NUMERIC(12,2) | CHECK >= 0 |
| memo | VARCHAR | |
| metadata | JSONB | |
| created_at | TIMESTAMPTZ | |

**Constraint**: `CHECK(NOT(debit > 0 AND credit > 0))` -- each line is either a debit or credit, never both.

#### accounting_classifications

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| transaction_id | FK | |
| entry_id | FK | |
| suggested_category | VARCHAR | |
| confidence | NUMERIC | |
| rule_applied | VARCHAR | |
| status | VARCHAR | |
| reviewer | VARCHAR | |
| review_note | TEXT | |
| approved_at | TIMESTAMPTZ | |
| created_at / updated_at | TIMESTAMPTZ | |

#### accounting_period_closes

| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| period_key | VARCHAR UNIQUE | e.g., `2026-04` |
| status | VARCHAR | |
| opened_at | TIMESTAMPTZ | |
| locked_at | TIMESTAMPTZ | |
| locked_by | VARCHAR | |
| snapshot | JSONB | |

#### webhook_events_processed

| Column | Type | Notes |
|--------|------|-------|
| event_id | TEXT PK | `{provider}:{eventId}` |
| provider | TEXT | `square` or `stripe` |
| received_at | TIMESTAMPTZ | |

---

## End-to-End Payment Data Flow

```
Buyer (Web) -> POST /api/wholesale/checkout/execute
       |
       | Allocate cart from network farms
       | Split into per-farm sub-orders
       v
squarePaymentService.js
       |
       +-- Farm has Square OAuth?
       |   YES: processSquarePayments()
       |         Charge on farm's Square account
       |         app_fee_money = 12% broker commission
       |   NO:  processGreenReachDirectPayment()
       |         Charge on GreenReach's Square account
       |         greenreach_held = true
       v
Square API -> Creates payment
       |
       | Async webhook callback
       v
POST /api/webhooks/square
       |
       | Verify HMAC-SHA256 signature
       | Deduplicate via webhook_events_processed
       v
payment.updated (COMPLETED)
       |
       | Update payment_records
       | ingestPaymentRevenue() -> accounting journal
       | ingestFarmPayables() -> per-farm AP entries
       | Advance order to confirmed
       | Send buyer confirmation email
       v
Accounting Ledger (Double-Entry)
       |
       | Debit Cash, Credit Revenue + Tax + Broker Fee
       | Per farm: Debit COGS, Credit AP-Farm Payouts
       v
Admin: Farm Payout (manual or scheduled)
       |
       | ingestFarmPayout()
       | Debit AP-Farm Payouts, Credit Cash
       v
Settlement Complete
```

---

## Key Constants

| Constant | Value | Source |
|----------|-------|--------|
| `WHOLESALE_COMMISSION_RATE` | 0.12 (12%) | Env var, default 0.12 |
| `WHOLESALE_DEFAULT_SKU_FACTOR` | 0.65 | Env var, default 0.65, range 0.50-0.75 |
| Square processing fee | 2.6% | Hardcoded in revenue-accounting-connector.js |
| Stripe processing fee | 2.9% | Hardcoded in revenue-accounting-connector.js |
| Currency | CAD | Hardcoded throughout |
| Checkout rate limit | 10/buyer/minute | wholesale.js checkoutLimiter |
| Max login attempts | 10 | wholesaleMemoryStore.js |
| Lockout duration | 5 minutes | wholesaleMemoryStore.js |
| Order auto-expiry | 48 hours | Unconfirmed orders |
| Order archive threshold | 90 days | Moved to CSV archive |
| Webhook replay window (Stripe) | 5 minutes | payment-webhooks.js |
| Token blacklist expiry | 7 days | wholesaleMemoryStore.js |

---

## File Quick Reference

| File | Purpose |
|------|---------|
| `greenreach-central/services/squarePaymentService.js` | Square payment processing, refunds, card-on-file |
| `greenreach-central/routes/wholesale.js` | Wholesale marketplace, checkout, pricing, admin tools |
| `greenreach-central/routes/square-oauth-proxy.js` | Per-farm Square OAuth flow |
| `greenreach-central/routes/payment-webhooks.js` | Square + Stripe webhook handlers |
| `greenreach-central/services/revenue-accounting-connector.js` | Double-entry accounting ledger |
| `greenreach-central/services/wholesaleMemoryStore.js` | Order/buyer in-memory + DB persistence |
| `greenreach-central/services/orderStateMachine.js` | Order/fulfillment status transitions |
| `greenreach-central/public/payment-setup.html` | Farm Square connection wizard UI |
| `greenreach-central/lib/wholesale/invoice-generator.js` | Invoice generation |

---

## Common Failure Scenarios

### Payment Fails at Checkout

1. Check buyer's Square card-on-file is valid (`getCardOnFile`)
2. Check farm's Square OAuth credentials (`/api/farm/square/status`)
3. If farm missing Square, verify GreenReach direct-charge fallback activates
4. Check `payment_records` table for error metadata

### Webhook Not Received

1. Verify `SQUARE_WEBHOOK_SIGNATURE_KEY` is set correctly
2. Check `webhook_events_processed` table for duplicate event_id
3. Verify Cloud Run service URL is registered as webhook endpoint in Square dashboard
4. Check Cloud Run logs for HMAC verification failures

### Order Stuck in pending_payment

1. Check `payment_records` for the order's payment status
2. Use admin endpoint: `POST /api/wholesale/admin/orders/:orderId/charge-greenreach`
3. Or batch-process: `POST /api/wholesale/admin/orders/process-pending`

### Accounting Entries Missing

1. Verify webhook was received and processed (not deduplicated)
2. Check `accounting_transactions` for existing idempotency_key
3. Check `accounting_entries` balance (debits should equal credits)
4. Look for balance validation errors in logs

### Farm Payout Discrepancy

1. Query `accounting_entries` for account_code `250000` (AP-Farm Payouts)
2. Compare credits (payables created) vs debits (payouts settled)
3. Outstanding balance = sum(credit) - sum(debit) for that farm's entries
