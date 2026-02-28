# GreenReach Central — Finance Automation & Valuation Review Plan

Date: 2026-02-27  
Scope: GreenReach Central (pre-revenue), accounting data collection automation, expense categorization, and software valuation framework.

## 1) Executive Summary

You are at the right stage to implement a **finance data foundation** before material revenue starts. Current code already captures some payment/order artifacts, but accounting routes are partially stubbed. The fastest path is:

1. Build a **canonical accounting ledger** in Postgres.
2. Automate ingestion from APIs with immediate impact (AWS first, then payments, then GitHub and SaaS).
3. Add deterministic categorization rules + human approval queue.
4. Establish a **pre-revenue valuation baseline now**, then revalue quarterly using automation maturity + traction metrics.

---

## 2) Current-State Review (from codebase)

### Working financial building blocks
- `payment_records` persistence exists in DB schema (`greenreach-central/config/database.js`).
- Wholesale order/payment/tax CSV exports exist (`greenreach-central/routes/wholesale-exports.js`).
- Procurement revenue/commission summary endpoints exist (`greenreach-central/routes/procurement-admin.js`).

### Gaps and stubs (critical for accounting automation)
- Farm sales + QuickBooks endpoints are currently stubs/not configured (`greenreach-central/routes/farm-sales.js`).
- Billing receipts/usage endpoint is stub/unavailable (`greenreach-central/routes/billing.js`).
- Reports route is not implemented (`greenreach-central/routes/reports.js`).
- Square payment service is explicitly stubbed (`greenreach-central/services/squarePaymentService.js`).

### Architecture implication
Financial events exist in multiple stores/routes, but there is **no canonical accounting transaction model** (GL-ready journal/ledger) across all sources.

---

## 3) What Must Exist to Automate Accounting Collection

## A. Canonical accounting data model (required first)
Create DB tables (or equivalent) for:
- `accounting_sources` (aws, github, stripe, square, quickbooks, manual, bank)
- `accounting_transactions` (source_txn_id, txn_date, amount, currency, vendor, description, raw_payload)
- `accounting_categories` (COA mapping: cloud_infra, dev_tools, payroll, contractor, etc.)
- `accounting_classifications` (rule_applied, confidence, reviewer, approved_at)
- `accounting_period_snapshots` (monthly close stats)
- `valuation_snapshots` (method, assumptions, result, confidence band)

Design rule: keep source payload immutable (`raw_payload`) and classify via adapters/rules.

## B. Ingestion connectors (API-first priority)
1. **AWS Cost Explorer / CUR**
   - Pull daily cost by service/tag/account.
   - Minimum dimensions: service, usage type, linked account, environment tag.
   - Category mapping: COGS-hosting vs R&D infra vs G&A.

2. **GitHub billing/cost events**
   - Pull org billing usage (seats, Actions minutes, storage, Copilot where available).
   - Map to Dev Tooling expense category.

3. **Payment processors (Stripe/Square)**
   - Pull fees, chargebacks, refunds, payout timing.
   - Separate gross sales, processor fees, and net cash movement.

4. **QuickBooks (optional sink, not source of truth initially)**
   - In phase 1, export from canonical ledger to QB-compatible format.
   - In phase 2, API sync with idempotent outbound pushes.

5. **Manual upload fallback**
   - CSV/PDF statement import for any non-API vendor.

## C. Categorization engine
- Rule hierarchy:
  1. Exact vendor/source rules (deterministic)
  2. Regex rules on description
  3. Account/tag-based rules
  4. ML-assisted suggestion (optional)
- Any rule confidence < threshold goes to approval queue.

## D. Close and reconciliation workflow
- Monthly close checklist:
  - source sync completeness,
  - duplicate detection,
  - uncategorized items,
  - variance checks (month-over-month spikes),
  - finalized snapshot lock.

---

## 4) Valuation Framework (Pre-Revenue and Post-Review)

Use a **dual-method approach** with confidence ranges.

## Method 1 — Cost-to-Recreate (baseline, objective)
Estimate replacement value of software asset:
- Historical engineering effort replacement cost
- Platform/infrastructure setup value
- Data assets + domain model value
- Integration complexity premium

Formula:
- Baseline Software Asset Value = (Rebuild engineering cost + infra setup cost + data/integration premium) × risk adjustment factor

## Method 2 — Pre-Revenue Venture Scorecard (forward-looking)
Score and weight:
- Product completeness
- Technical defensibility
- Automation maturity
- Go-to-market readiness
- Team execution
- Risk (security/compliance/dependency)

Output:
- low/base/high valuation band with explicit assumptions.

## Post-review revaluation (after automation implemented)
Recalculate every quarter using uplift drivers:
- % expense automation coverage
- Days-to-close reduction
- Data quality/reconciliation confidence
- Revenue readiness (live billing + real processor integration)
- Operational risk reduction (fewer stubs/manual steps)

---

## 5) Highest-Value API Opportunities (your callout: AWS + GitHub)

## AWS (highest immediate ROI)
- Source: Cost Explorer + optionally CUR/S3.
- Why: largest predictable pre-revenue spend bucket.
- Automation target: daily import + monthly categorized close.

## GitHub
- Source: org billing/usage endpoints (seats, Actions, storage, Copilot if available).
- Why: recurring tooling spend, often under-tracked.
- Automation target: daily/weekly import + tooling category.

## Next-tier APIs
- Stripe/Square for fees/refunds/payouts.
- QuickBooks as accounting output system once canonical ledger is stable.

---

## 6) Phased Implementation Plan

## Phase 0 (Week 1): Review & design lock
Deliverables:
- Data contract for canonical accounting transaction.
- Chart of Accounts v1 (pre-revenue optimized).
- Source priority matrix (AWS, GitHub, Stripe/Square, manual).

Exit criteria:
- Signed-off schema and categorization taxonomy.

## Phase 1 (Weeks 2–3): Foundation build
Deliverables:
- New accounting tables + migrations.
- Ingestion job framework (idempotent, source cursors, retry policy).
- Manual import endpoint + validation.

Exit criteria:
- Raw transactions from at least one API source land in canonical table.

## Phase 2 (Weeks 3–5): API automation core
Deliverables:
- AWS ingestion connector live.
- GitHub billing connector live.
- Categorization rules engine + approval queue UI/API.

Exit criteria:
- ≥70% monthly expenses auto-categorized with high confidence.

## Phase 3 (Weeks 5–6): Accounting output and close
Deliverables:
- Monthly close dashboard.
- Export adapters (QuickBooks-ready CSV/API payloads).
- Reconciliation report (source totals vs categorized totals).

Exit criteria:
- Monthly close package generated in <1 day.

## Phase 4 (Week 7+): Valuation instrumentation
Deliverables:
- Baseline valuation snapshot (pre-automation).
- Post-implementation valuation snapshot and delta report.
- Quarterly valuation runbook.

Exit criteria:
- Repeatable valuation report with assumptions and confidence band.

---

## 7) KPIs to Track (Success Metrics)

Automation KPIs:
- % expenses ingested automatically (target: >85%)
- % transactions auto-categorized (target: >80%)
- Uncategorized transaction count (target: <5%)
- Monthly close time (target: <1 business day)

Data quality KPIs:
- Duplicate transaction rate
- Reconciliation variance (%)
- Failed ingestion jobs / retry success

Valuation KPIs:
- Confidence score of valuation model
- Quarter-over-quarter valuation band movement
- Automation maturity score contribution

---

## 8) Risks and Controls

- **Stubbed payment/accounting routes** → treat as non-authoritative until replaced.
- **Source API changes** → adapter layer + schema versioning.
- **Classification drift** → approval queue + rule audit log.
- **Overstated valuation** → always publish low/base/high with assumptions.

---

## 9) Immediate Next Actions (Practical)

1. Approve canonical accounting schema and COA v1.
2. Implement AWS Cost Explorer connector first (highest value, lowest ambiguity).
3. Implement GitHub billing connector second.
4. Add categorization rules + review queue before QuickBooks API work.
5. Produce baseline pre-revenue valuation snapshot before Phase 1 build (for true pre/post comparison).

---

## 10) Decision Needed From You

Choose one accounting operating mode for initial rollout:
- **Mode A (Recommended):** GreenReach Central as source-of-truth ledger, QuickBooks as downstream export/sync target.
- **Mode B:** QuickBooks as source-of-truth, Central as operational mirror.

For your current architecture and pre-revenue stage, Mode A is cleaner and more automatable.
