# GreenReach / Light Engine -- Financial & Communication Readiness Audit

**Date:** June 2025 (Updated: July 2025)
**Benchmark:** QuickBooks Online (Canada) -- Cash Flow Planner + Expense Tracker
**Goal:** Ensure GreenReach can track, record, and export financial data correctly for QuickBooks integration

---

## Executive Summary

GreenReach has a **mature** double-entry accounting ledger with CRA-compliant tax receipt generation, automated revenue/COGS recording, structured CSV exports, and full QuickBooks-compatible export endpoints. The platform is now **~80% ready** for clean QuickBooks data export following the July 2025 improvements:

**Implemented (July 2025):**
- QB-native CSV exports: Chart of Accounts, Journal Entries, Customers, Products/Services, Invoices
- Manual expense entry API + admin dashboard UI (vendor, account, amount, date, memo)
- Financial reports: Income Statement (P&L), Balance Sheet, Cash Flow Statement with admin UI
- Bank reconciliation: CSV import, auto-matching, manual matching, clear/verify workflow
- Invoice emails sent to buyers on payment confirmation (with line items and tax)
- Payment failure email alerts to buyers (Stripe)
- Refund confirmation emails (Square + Stripe)
- RFC 8058 List-Unsubscribe header on all outbound emails (CASL compliance)

Remaining gaps: no bank feed API sync, no AR/AP aging, no credit notes/refunds workflow, no recurring invoice generation.

---

## SECTION 1: QuickBooks Feature Benchmark Comparison

### 1.1 Cash Flow & Banking

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Bank account sync (real-time feeds) | NOT AVAILABLE | No bank integration. All transactions are payment-processor sourced (Square). |
| Cash flow dashboard (money in/out) | COMPLETE | Cash Flow Statement report (`/api/accounting/reports/cash-flow`) with operating, investing, financing activities. Admin UI with date range. |
| Cash flow forecasting | NOT AVAILABLE | No predictive cash flow. |
| Bill management & scheduling | PARTIAL | Manual expense entry (`POST /api/accounting/expenses`) for rent, supplies, insurance. No bill scheduling. |
| Recurring payments tracking | PARTIAL | Subscription billing exists (`billing_invoices` table) but no recurring expense recording. |
| Bank reconciliation | COMPLETE | CSV import with auto-matching by amount+date, manual match, clear/verify workflow. |

**Readiness: 50%**

### 1.2 Revenue & Sales Tracking

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Sales recording | COMPLETE | Wholesale orders, D2C, POS, B2B, donations all tracked with line items. |
| Payment tracking | COMPLETE | `payment_records` table with provider, status, amount, currency. Square + Stripe. |
| Invoice generation | COMPLETE | Farm sales orders with IDs (`FS-XXXXXX`), billing invoices for subscriptions. |
| Receipt generation | COMPLETE | HTML receipt download (`/billing/receipts/:paymentId/download`). |
| Revenue by channel | COMPLETE | Order data includes channel (wholesale, D2C, POS, B2B, donation). |
| Multi-currency | PARTIAL | `currency` field exists (defaults CAD). No FX conversion. |
| Customer management | PARTIAL | Buyer accounts with email/ID. No customer notes, contact history, or CRM fields. |
| Estimates/quotes | NOT AVAILABLE | No quote or estimate system. |

**Readiness: 75%**

### 1.3 Expense Tracking

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Expense recording | COMPLETE | Automated for processing fees + cloud infra + dev tools. **Manual expense entry UI** in admin dashboard (`POST /api/accounting/expenses`). Vendor, account, amount, date, memo fields. |
| Receipt capture (photo/scan) | NOT AVAILABLE | No receipt upload or OCR. |
| Automatic categorization | COMPLETE | AI-assisted rule engine with confidence scoring, review queue, bulk approve/reject. |
| Expense reports by category | COMPLETE | `/api/accounting/expense-summary` with date filtering. |
| Mileage tracking | NOT AVAILABLE | N/A (cloud farm, no vehicles). |
| Vendor/supplier management | PARTIAL | Vendor field on manual expenses. No dedicated vendor records. |
| Purchase orders | NOT AVAILABLE | No PO system. |

**Readiness: 60%**

### 1.4 Accounting & Ledger

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Double-entry bookkeeping | COMPLETE | Full debit/credit journal entries with balanced validation. |
| Chart of Accounts | COMPLETE | QB-compatible numbering (1xxxxx Assets through 7xxxxx R&D). 16 seeded accounts. |
| General Ledger view | COMPLETE | `ledger_entries` SQL view joins entries + transactions + accounts. |
| Journal entries | COMPLETE | `POST /api/accounting/transactions/ingest` with balance enforcement. |
| Account reconciliation | NOT AVAILABLE | No bank statement import or reconciliation workflow. |
| Period closing/locking | COMPLETE | `accounting_period_closes` table with YYYY-MM lock, snapshot, audit trail. |
| Audit trail | COMPLETE | `audit_log` table, idempotency keys (SHA-256), webhook dedup. |

**Readiness: 80%**

### 1.5 Tax Compliance (Canada)

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| HST/GST tracking on sales | COMPLETE | Per-order `tax_rate`, `tax_label`, `tax_amount` fields. Account 310000 (Sales Tax Payable). |
| Tax summary reports | COMPLETE | `/api/wholesale/exports/tax-summary` -- monthly CSV by year. |
| Sales tax codes per item | PARTIAL | `is_taxable` flag on inventory. No per-province tax code matrix. |
| Tax remittance tracking | NOT AVAILABLE | No tracking of when HST/GST is remitted to CRA. |
| CRA donation tax receipts | COMPLETE | Full CRA-compliant receipts with FMV, donor BN, recipient charity registration. |
| T4/T5 preparation | NOT AVAILABLE | No payroll or investment income tracking. |

**Readiness: 65%**

### 1.6 Inventory & COGS

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Inventory tracking | COMPLETE | `farm_inventory` table with real-time sensor sync + manual entry. |
| Cost basis per item | COMPLETE | `price`, `wholesale_price`, `retail_price` per SKU. |
| COGS recording | COMPLETE | Automated to account 500000 on order completion. |
| Lot tracking | COMPLETE | `lot_code` field for FIFO by production batch. |
| Inventory valuation report | PARTIAL | Data exists but no dedicated valuation report endpoint. |
| Purchase orders | NOT AVAILABLE | No PO system for farm inputs (seeds, supplies). |
| Reorder points | NOT AVAILABLE | No min-stock alerts. |

**Readiness: 70%**

### 1.7 Financial Reports & Export

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Profit & Loss statement | COMPLETE | `GET /api/accounting/reports/income-statement` -- Revenue, COGS, Expenses with net income. Admin UI with formatted output. |
| Balance Sheet | COMPLETE | `GET /api/accounting/reports/balance-sheet` -- Assets, Liabilities, Equity with balance validation. Admin UI. |
| Cash Flow Statement | COMPLETE | `GET /api/accounting/reports/cash-flow` -- Operating, Investing, Financing activities. Admin UI. |
| Custom report builder | NOT AVAILABLE | Fixed report endpoints only. |
| CSV export | COMPLETE | Orders, payments, tax summary, journal entries, CoA, customers, products, invoices all export to CSV. |
| Excel export | NOT AVAILABLE | CSV only, no native .xlsx. |
| QuickBooks CSV format | COMPLETE | 5 QB-compatible CSV exports: Chart of Accounts, Journal Entries, Customers, Products/Services, Invoices. |
| Accounts Receivable aging | NOT AVAILABLE | Outstanding amount tracked but no aging buckets. |
| Accounts Payable aging | NOT AVAILABLE | Farm payouts tracked but no aging report. |

**Readiness: 75%**

### 1.8 Invoicing & Payments

| QuickBooks Feature | GreenReach Status | Gap |
|---|---|---|
| Invoice creation | COMPLETE | Farm sales orders + billing invoices. |
| Payment acceptance (online) | COMPLETE | Square integration with webhook confirmation. |
| Recurring invoices | PARTIAL | Subscription system exists but no recurring invoice generation. |
| Payment reminders | NOT AVAILABLE | No automated dunning. |
| Partial payments | NOT AVAILABLE | Orders are pay-in-full only. |
| Credit notes / refunds | NOT AVAILABLE | No credit memo or refund workflow. |
| Late fees | NOT AVAILABLE | No late fee calculation. |

**Readiness: 45%**

---

## SECTION 2: Communication Tools Assessment

### 2.1 Active Communication Channels

| Channel | Technology | Status | Notes |
|---|---|---|---|
| **Email (transactional)** | Google Workspace SMTP (`smtp.gmail.com:587`) | ACTIVE | Order confirmations, admin alerts, donation notifications. From: `admin@greenreachgreens.com`. |
| **Email (scheduled)** | `send-daily-summary.js` + Cloud Scheduler | ACTIVE | Daily admin briefing (7 AM), nightly audit (3 AM), lot expiry warnings. |
| **SMS** | Email-to-SMS carrier gateway | SEVERELY LIMITED | Only 1 hardcoded recipient (Bell Canada). Not scalable. |
| **In-app notifications** | PostgreSQL `farm_notifications` table + polling | ACTIVE | Mirrors critical alerts. Admin and farm dashboards. |
| **WebSocket** | Real-time sensor/environment data | ACTIVE | Sensor updates, climate alerts, presence. No message queuing. |
| **AI Chat (E.V.I.E.)** | SSE streaming, persistent memory | ACTIVE | Farm operations assistant. |
| **AI Chat (F.A.Y.E.)** | SSE streaming, 100+ admin tools | ACTIVE | Central admin assistant with anomaly detection and scheduled briefings. |
| **Square Webhooks** | HMAC-SHA256 verified | ACTIVE | Payment completion triggers order confirmation flow. |

### 2.2 Communication Gaps for Financial Operations

| Missing Feature | Impact | Priority |
|---|---|---|
| ~~No payment failure email to buyer~~ | **FIXED** -- `sendPaymentFailureEmail()` on Stripe `payment_intent.payment_failed` events | DONE |
| ~~No invoice email delivery~~ | **FIXED** -- `sendInvoiceEmail()` with line items, tax, totals sent on Square payment confirmation | DONE |
| **No subscription renewal notification** | Buyers not informed before auto-charge | HIGH |
| **No AP payout notification to farms** | Farms don't know when they'll be paid | MEDIUM |
| **No expense approval workflow notifications** | Admin must manually check classification queue | MEDIUM |
| **No period-close reminders** | No automated month-end close prompts | LOW |
| ~~No unsubscribe mechanism~~ | **FIXED** -- RFC 8058 `List-Unsubscribe` header + unsubscribe link in all email footers | DONE |
| ~~No refund confirmation email~~ | **FIXED** -- `sendRefundConfirmationEmail()` on Square + Stripe refund events | DONE |

---

## SECTION 3: QuickBooks Export Readiness

### 3.1 What Can Be Exported Today

| Data Set | Format | QB Import Method | Ready? |
|---|---|---|---|
| Wholesale orders (line items) | CSV | QB "Import Sales Data" | YES -- needs column mapping |
| Payment history | CSV | QB "Import Bank Transactions" | YES -- needs column mapping |
| Tax summary (monthly) | CSV | Manual entry or custom import | YES |
| Chart of Accounts | CSV | QB "Import Chart of Accounts" | YES -- `/api/accounting/export/chart-of-accounts.csv` |
| Journal entries (ledger) | CSV | QB "Import General Journal Entries" | YES -- `/api/accounting/export/journal-entries.csv` |
| Donation receipts | JSON | Manual attachment | YES (PDF recommended) |
| Inventory / Products | CSV | QB "Import Products/Services" | YES -- `/api/accounting/export/products.csv` |
| Customer/Buyer list | CSV | QB "Import Customers" | YES -- `/api/accounting/export/customers.csv` |
| Invoices | CSV | QB "Import Invoices" | YES -- `/api/accounting/export/invoices.csv` |

### 3.2 Required Export Format Changes

**Priority 1 -- QuickBooks CSV Export Endpoints:**

1. **Chart of Accounts CSV** -- Map account_code/name/class/type to QB's Name/Type/Detail Type/Description format
2. **General Journal CSV** -- Map accounting_entries to QB's Date/Journal No/Account/Debits/Credits/Description/Name
3. **Customer List CSV** -- Extract unique buyers with name, email, billing address
4. **Products/Services CSV** -- Map farm_inventory to QB's Name/SKU/Type/Description/Sales Price/Cost/Qty On Hand
5. **Invoice CSV** -- Map wholesale_orders to QB's Invoice No/Customer/Invoice Date/Due Date/Item/Qty/Rate/Amount/Tax

**Priority 2 -- IIF Format (QuickBooks Desktop):**
- Only needed if using QB Desktop instead of QB Online
- More complex tab-delimited format with header rows

### 3.3 Data Integrity Issues to Resolve Before Export

| Issue | Description | Fix Required |
|---|---|---|
| **Expense derivation vs. actual** | Frontend derives COGS from revenue (revenue - broker fees). Actual accounting_entries may have duplicates from earlier bugs. | Run deduplication cleanup, verify entries match calculated values. |
| **Missing manual expenses** | No UI to record rent, utilities, insurance, supplies. Only automated cloud/processor fees. | Build manual expense entry form or plan to enter these directly in QB. |
| **No AR aging** | Outstanding orders tracked but not aged into 30/60/90 buckets. | Add aging calculation or handle in QB post-import. |
| **Donation FMV as revenue** | Donations create $0 orders with FMV metadata. QB needs these as separate non-cash charitable donation entries. | Create dedicated donation journal entry export (Debit: Charitable Donation Expense, Credit: Inventory). |

---

## SECTION 4: Overall Readiness Scorecard

| Category | Score | Verdict |
|---|---|---|
| Revenue & Sales Tracking | 75% | STRONG -- minor gaps (estimates, multi-currency) |
| Accounting & Ledger | 85% | STRONG -- double-entry, CoA, period locks, audit trail, bank reconciliation |
| Tax Compliance (Canada) | 65% | GOOD -- HST/GST tracked, CRA receipts. Missing remittance tracking. |
| Inventory & COGS | 70% | GOOD -- real-time sync, cost basis, lot tracking. Missing valuation report. |
| Expense Tracking | 60% | IMPROVED -- automated + manual entry UI. Missing receipt capture, PO system. |
| Financial Reports | 75% | IMPROVED -- P&L, Balance Sheet, Cash Flow Statement. Missing AR/AP aging, custom reports. |
| Invoicing & Payments | 55% | MODERATE -- invoice emails on payment, refund emails. No credit notes, dunning, partial payments. |
| Cash Flow & Banking | 50% | IMPROVED -- cash flow report, bank reconciliation with auto-match. No live bank feed. |
| Communication (Financial) | 70% | IMPROVED -- invoice emails, payment failure alerts, refund confirmations, List-Unsubscribe (CASL). |
| **QuickBooks Export Readiness** | **90%** | **STRONG -- 5 QB-compatible CSV exports: CoA, Journal Entries, Customers, Products, Invoices.** |

**Overall Platform Readiness: ~80%**

---

## SECTION 5: Recommendations (Prioritized)

### Tier 1 -- Critical (Do Before QB Export)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| ~~1~~ | ~~**Build QB-format CSV export endpoints**~~ | ~~Medium~~ | DONE -- 5 CSV exports: CoA, Journal Entries, Customers, Products, Invoices |
| 2 | **Run accounting_entries deduplication audit** -- verify all entries are clean and balanced | Low | Prevents importing corrupt data into QB |
| ~~3~~ | ~~**Add manual expense entry**~~ | ~~Medium~~ | DONE -- `POST /api/accounting/expenses` + admin UI form |
| 4 | **Map donation FMV to proper journal entries** for QB (non-cash charitable donations) | Low | CRA compliance + correct QB categorization |

### Tier 2 -- High Priority (Improve Financial Operations)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| ~~5~~ | ~~**Build P&L report**~~ | ~~Medium~~ | DONE -- `GET /api/accounting/reports/income-statement` |
| ~~6~~ | ~~**Build balance sheet report**~~ | ~~Medium~~ | DONE -- `GET /api/accounting/reports/balance-sheet` |
| ~~7~~ | ~~**Add invoice email delivery**~~ | ~~Low~~ | DONE -- `sendInvoiceEmail()` with line items on payment confirmation |
| ~~8~~ | ~~**Add payment failure notifications**~~ | ~~Low~~ | DONE -- `sendPaymentFailureEmail()` on Stripe failures |
| ~~9~~ | ~~**Add email unsubscribe mechanism**~~ | ~~Low~~ | DONE -- RFC 8058 List-Unsubscribe header on all emails |
| 10 | **Move SMTP credentials to Secret Manager** | Low | Security -- credentials currently in source file |

### Tier 3 -- Nice to Have (QuickBooks Parity)

| # | Recommendation | Effort | Impact |
|---|---|---|---|
| 11 | Add AR/AP aging reports (30/60/90 day buckets) | Medium | Better receivables management |
| 12 | Add credit note / refund workflow | Medium | Handle returns and adjustments |
| 13 | Add inventory valuation report endpoint | Low | Snapshot of inventory value at any date |
| ~~14~~ | ~~**Add cash flow statement report**~~ | ~~High~~ | DONE -- `GET /api/accounting/reports/cash-flow` |
| ~~15~~ | ~~**Add bank reconciliation workflow**~~ | ~~High~~ | DONE -- CSV import, auto-match, manual match, clear/verify |
| 16 | Add tax remittance tracking (when HST/GST paid to CRA) | Low | Complete tax lifecycle |
| 17 | Build email template engine (Handlebars/Mustache) | Medium | Maintainable, branded email communications |
| 18 | Add per-province sales tax code matrix | Medium | Multi-jurisdiction tax compliance |

### Tier 4 -- Future / Handle in QuickBooks

| # | Recommendation | Notes |
|---|---|---|
| 19 | Bank account sync / feeds | Better handled by QB directly (bank partnerships) |
| 20 | Cash flow forecasting | QB has built-in forecasting tools |
| 21 | Receipt capture / OCR | QB mobile app handles this natively |
| 22 | Payroll (T4) | Out of scope -- use QB Payroll or dedicated payroll service |
| 23 | Mileage tracking | N/A for cloud farm operations |
| 24 | Custom report builder | Use QB's custom reporting engine post-import |

---

## SECTION 6: Recommended Export Strategy

### Phase 1: Initial QuickBooks Setup
1. Export **Chart of Accounts** CSV and import into QB (one-time)
2. Export **Customer List** CSV and import into QB (one-time)
3. Export **Products/Services** CSV and import into QB (one-time)

### Phase 2: Historical Data Migration
4. Export **General Journal Entries** for all periods and import into QB
5. Export **Wholesale Orders as Invoices** and import into QB
6. Export **Payment History as Bank Transactions** and reconcile in QB
7. Manually enter any expenses not captured in GreenReach (rent, insurance, etc.)

### Phase 3: Ongoing Sync
8. Set up **monthly export routine** -- run CSV exports at month-end after period close
9. Import into QB before closing the QB period
10. Reconcile QB balances against GreenReach dashboard
11. Enter manual expenses directly in QB going forward (or build manual expense UI in GR)

### Data Flow Architecture
```
GreenReach Central                    QuickBooks Online (Canada)
-----------------                     -------------------------
wholesale_orders  --[CSV export]-->   Sales / Invoices
payment_records   --[CSV export]-->   Bank Transactions
accounting_entries --[CSV export]-->  General Journal Entries
accounting_accounts --[CSV export]--> Chart of Accounts
farm_inventory    --[CSV export]-->   Products & Services
buyer accounts    --[CSV export]-->   Customers
tax_summary       --[CSV export]-->   Tax Reports (verify)
donation_receipts --[PDF attach]-->   Attachments on entries
```

---

## Appendix A: Existing Export Endpoints

| Endpoint | Format | Purpose |
|---|---|---|
| `GET /api/wholesale/exports/orders?from=&to=` | CSV | Wholesale order line items |
| `GET /api/wholesale/exports/payments?from=&to=` | CSV | Payment records |
| `GET /api/wholesale/exports/tax-summary?year=` | CSV | Monthly tax breakdown |
| `GET /api/accounting/transactions?from=&to=` | JSON | Ledger journal entries |
| `GET /api/accounting/accounts` | JSON | Chart of accounts |
| `GET /api/accounting/expense-summary?from=&to=` | JSON | Expense breakdown |
| `GET /api/reports/revenue-summary?period=` | JSON | Revenue aggregates |
| `GET /api/wholesale/donations/summary` | JSON | Donation totals & FMV |
| `GET /api/wholesale/donations/receipt/:claimId` | JSON | CRA tax receipt |
| `GET /api/billing/receipts` | JSON | Billing receipts list |
| `GET /api/billing/receipts/:id/download` | HTML | Receipt download |

## Appendix B: Database Tables Relevant to QB Export

| Table | Records | QB Destination |
|---|---|---|
| `wholesale_orders` | All sales transactions | Invoices / Sales Receipts |
| `payment_records` | All payments received | Receive Payments / Bank Deposits |
| `accounting_entries` | All journal entry lines | General Journal |
| `accounting_transactions` | Journal entry headers | General Journal |
| `accounting_accounts` | Chart of accounts | Chart of Accounts |
| `farm_inventory` | Product catalog + quantities | Products & Services |
| `donation_offers` / `donation_claims` | Charitable donations | Journal Entries (non-cash) |
| `billing_invoices` | Platform subscription bills | Bills (if tracking GR as vendor) |
| `farm_subscriptions` | Active subscriptions | Recurring Transactions |

## Appendix C: Chart of Accounts Mapping (GreenReach to QuickBooks)

| GR Code | GR Name | QB Account Type | QB Detail Type |
|---|---|---|---|
| 100000 | Cash | Bank | Checking |
| 110000 | Accounts Receivable - Buyer | Accounts Receivable | Accounts Receivable |
| 120000 | Accounts Receivable | Accounts Receivable | Accounts Receivable |
| 200000 | Accounts Payable | Accounts Payable | Accounts Payable |
| 210000 | Revenue - Subscriptions | Income | Service/Fee Income |
| 250000 | Accounts Payable - Farm Payouts | Accounts Payable | Accounts Payable |
| 300000 | Owner Equity | Equity | Owner's Equity |
| 310000 | Sales Tax Payable | Other Current Liability | Sales Tax Payable |
| 400000 | Revenue | Income | Sales of Product Income |
| 400100 | Revenue - Wholesale | Income | Sales of Product Income |
| 500000 | COGS | Cost of Goods Sold | Supplies & Materials - COGS |
| 610000 | Cloud Infrastructure | Expense | IT/Internet Expense |
| 620000 | Developer Tools | Expense | IT/Internet Expense |
| 630000 | Payment Processing Fees | Expense | Bank Charges |
| 640000 | Broker Fee Revenue | Income | Service/Fee Income |
| 710000 | R&D Expense | Expense | Other Miscellaneous Expense |
