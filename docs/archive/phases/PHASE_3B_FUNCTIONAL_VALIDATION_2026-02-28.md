# Phase 3B Functional Validation Report

Date: 2026-02-28
Scope: Refund persistence + webhook replay idempotency (Foxtrot local runtime)
Status: Partial pass (persistence/idempotency verified; provider-auth create path blocked)

## Runtime Setup

- Server: `PORT=8091 SQUARE_WEBHOOK_SECRET=phase3b-testsecret node server-foxtrot.js`
- Workspace path: `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot`

## Refund Route Validation

### Deterministic precondition seed

- Sub-order seeded in `data/wholesale-sub-orders.db`:
  - `sub_order_id`: `SO-PHASE3B-REFUND-001`
  - `status`: `confirmed`
  - `total`: `12.5`
  - `broker_fee_amount`: `1.25`

- Refund record seeded in `data/wholesale-refunds.db`:
  - `id`: `REF-PHASE3B-SEED-001`
  - `sub_order_id`: `SO-PHASE3B-REFUND-001`
  - `status`: `completed`
  - `refund_amount`: `100` (cents)

### Endpoint results

1. `GET /api/wholesale/refunds/REF-PHASE3B-SEED-001`
- Result: `ok: true`
- Record returned with expected seeded fields.

2. `GET /api/wholesale/refunds?sub_order_id=SO-PHASE3B-REFUND-001`
- Result: `ok: true`
- Summary:
  - `total_refunds: 1`
  - `total_refunded: 1`
  - `total_broker_fees_reversed: 0.1`

3. `POST /api/wholesale/refunds` (partial refund for seeded sub-order)
- Result: `ok: false`
- Error: `Refund processing failed`
- Message: `This request could not be authorized.`

Interpretation:
- Route/store persistence wiring for refund read/list paths is working.
- Create path reaches provider call and fails due missing/invalid local Square auth credential, not due persistence wiring.

## Webhook Replay Idempotency Validation

### Signed replay test

Payload:
- `id`: `evt_phase3b_004`
- `type`: `payment.updated`
- `payment.id`: `PAY-PHASE3B-004`

Signature:
- HMAC-SHA256 base64 using `phase3b-testsecret`.

Results:
1. First `POST /api/wholesale/webhooks/square`
- Processed action: `updated`
- Status transition: `created -> completed`

2. Second `POST /api/wholesale/webhooks/square` (same payload/signature)
- Processed action: `duplicate_ignored`
- Event key: `square:evt_phase3b_004`

3. `GET /api/wholesale/webhooks/payments`
- Payment `PAY-PHASE3B-004` present
- `event_count: 1`

Interpretation:
- Durable replay idempotency behavior is functioning as intended.

## Final Verdict

- PASS: Persistent refund read/list behavior
- PASS: Webhook replay idempotency + durable payment record behavior
- BLOCKED (environment): Refund create-path provider authorization without valid local Square credentials

## Commit-Ready Note

This validation report is suitable to include with Phase 3B persistence/idempotency changes. If full create-path proof is required, rerun the refund `POST` case with valid sandbox Square credentials configured in local environment.
