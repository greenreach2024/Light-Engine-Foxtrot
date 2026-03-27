# Wholesale Workflow Remediation Log

Date: 2026-03-27
Scope: Purchase flow, payment processing, inventory reservation, admin operations, labeling/invoice, delivery workflow.

## Constraints

- Ignore overselling warning findings for now (farmer verification policy in place).
- Implement corrections in phases.
- Pause after each phase to update this document and re-read mandatory architecture docs.

## Phase Plan

### Phase 1: Security and Data Integrity

- Protect operational payment/refund endpoints.
- Fix pickup checkout validation (do not require delivery address for pickup).
- Fix invoice delivery mapping to use checkout delivery fields.
- Fix tracking timestamp whitelist mismatch.

Status: completed

### Phase 2: Checkout + Webhook Workflow Integrity

- Improve webhook dedup handling for provider scoping and atomic insert behavior.
- Correct checkout side-effect ordering and reservation/payment handling.
- Avoid reservation leakage for non-success payment outcomes.

Status: completed

### Phase 3: Validation

- Syntax checks on all touched files.
- Targeted diff review.
- Final implementation summary.

Status: completed

## Change Log

- Phase 1 started.
- Phase 1 completed.
	- Added admin auth to operational payment/refund list endpoints in wholesale routes.
	- Updated checkout validation to allow pickup orders without delivery address requirement.
	- Added `tracking_updated_at` to allowed farm sub-order update fields.
	- Updated invoice assembly to derive delivery details from `delivery_address` + `delivery_date` when legacy delivery payload is absent.
- Phase 2 completed.
	- Added draft/deferred persistence mode to `createOrder` and `createPayment`.
	- Updated checkout flow to use deferred persistence and persist finalized records after reservation checks.
	- Added reservation release for non-success payment outcomes to prevent lingering holds.
	- Changed accounting ingestion to completed-payment-only path.
	- Added critical alert email for payment-captured + reservation-failure mismatch cases.
	- Hardened webhook dedup with provider-scoped IDs and atomic insert-first dedup behavior.
- Phase 3 completed.
	- Ran syntax checks for edited files (`node -c`) and IDE error checks.
	- Reviewed final diffs for scoped remediation changes.

## Pause Checkpoint

- Remediation implementation complete for scoped phases.
