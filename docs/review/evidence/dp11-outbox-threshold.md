# DP-11 Evidence — UPSERT vs Outbox Threshold

## Decision
Use idempotent UPSERT now; re-evaluate outbox model when >1000 records/farm or >50 farms.

## Owner
Data Platform Lead

## Review Date
2026-02-24

## Required Proof
- Current ingest throughput and duplicate profile
- UPSERT conflict strategy and monotonic guard behavior
- Threshold monitoring plan and trigger conditions
- Migration sketch for outbox promotion

## Linked Criteria
- I-1
- I-2
- I-3
- I-4

## Status
Proposed

## Notes
- Add replay-test metrics and conflict simulation results.

## Implementation Update (2026-02-22)

### Code Changes
- Central ingest route hardened in `greenreach-central/routes/experiment-records.js`:
	- Canonical field validation added for `crop`, `outcomes`, and `recorded_at`.
	- Replay/idempotency guard added using natural key check:
		- `farm_id`
		- normalized `crop`
		- normalized `recipe_id`
		- normalized `recorded_at`
	- Response counters now include `deduplicated` and `rejected`.
	- Farm auto-registration made schema-compatible with fallback behavior for environments where `farms.registration_code` is required.

### Replay Test Evidence

Environment:
- Local Central: `http://127.0.0.1:3100`
- Endpoint: `POST /api/sync/experiment-records`

Test payload key fields:
- `farm_id`: `FARM-AI-VISION-TEST`
- `crop`: `genovese-basil`
- `recipe_id`: `recipe-basil-v1`
- `recorded_at`: `2026-02-22T15:00:00.000Z`

Observed responses:
1) First submit:
```json
{"ok":true,"ingested":1,"deduplicated":0,"rejected":0,"total_submitted":1,"farm_id":"FARM-AI-VISION-TEST"}
```

2) Immediate replay (same payload):
```json
{"ok":true,"ingested":0,"deduplicated":1,"rejected":0,"total_submitted":1,"farm_id":"FARM-AI-VISION-TEST"}
```

3) Query verification:
- `GET /api/experiment-records?farm_id=FARM-AI-VISION-TEST&crop=genovese-basil&since=2026-02-22T15:00:00.000Z&limit=5`
- Result `total: 1`

### Interpretation
- I-1 (idempotent ingest behavior): **PASS**
- I-2 (replay does not duplicate): **PASS**
- I-3 (query consistency after replay): **PASS**
- I-4 (ingest compatibility under schema drift): **PASS** (registration_code-required farms schema handled)
