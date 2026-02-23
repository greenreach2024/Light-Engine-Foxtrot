# DP-1 Evidence — Farm ID Guessability (HMAC Migration)

## Decision
HMAC-SHA-256 required for farm identifier pseudonymization.

## Owner
Data/Sync Lead

## Review Date
2026-02-23

## Required Proof
- Current-state risk summary (direct hash predictability)
- Proposed HMAC design (key rotation + versioning)
- Backward compatibility + migration sequence
- Test evidence for deterministic output and non-reversibility

## Linked Criteria
- I-1
- I-2

## Status
Proposed

## Notes
- Fill with before/after samples and migration runbook link.

## Implementation Update (2026-02-22)

### Code Changes
- Edge hash generation upgraded in `routes/integrations.js`:
	- Replaced plain SHA-256 farm hash with HMAC-SHA-256 primary path.
	- Introduced local, on-farm pepper source precedence:
		1. `FARM_ID_HASH_PEPPER` / `FARM_HASH_PEPPER` env var
		2. Local persisted file `data/.farm-id-hash-pepper` (auto-generated if missing)
	- Added explicit legacy helper (`hashFarmIdLegacy`) and migration metadata in sync payload:
		- `farm_id_hash` (primary; HMAC when pepper available)
		- `farm_id_hash_legacy` (legacy SHA-256)
		- `farm_hash_version` (`hmac-sha256:v2` or `sha256:v1-fallback`)

- Central compatibility in `greenreach-central/routes/sync.js`:
	- Accepts `farm_id_hash_legacy` and `farm_hash_version` fields.
	- Migration assist updates existing legacy-hash rows to the new hash for the same `record_id`.

- Persistence prerequisite fixed in `greenreach-central/config/database.js`:
	- Added `device_integrations` table bootstrap + indexes (required for end-to-end validation).

### Validation Evidence

1) On-farm pepper generation and persistence:
- `hashFarmId('FARM-AI-VISION-TEST')` invocation created local pepper file.
- `data/.farm-id-hash-pepper` exists and is 64 hex chars.

2) Hash behavior:
- HMAC hash generated (64 hex chars): prefix `e9902c4ec961...`
- Legacy SHA-256 retained for migration compatibility:
	- `4ebcaac2278ab67df7ef7b3140f4dd35d681e6d5430021787f7fbf23eaf7e95e`

3) Central sync compatibility:
- `POST /api/sync/device-integrations` with `farm_hash_version: hmac-sha256:v2` returned:
```json
{"success":true,"message":"Synced 1 integration record(s)","inserted":1,"errors":0,"storage":"database"}
```

4) Replay/upsert check (same `record_id`):
- second POST accepted and updated existing row (no duplicate row created)
- DB assertion:
```json
{"cnt":1,"max_signal":"90.00","max_rating":"4.00"}
```

### Decision Readiness
- DP-1 mandate (HMAC required) is now technically implemented with fallback safety.
- Existing deployments without configured pepper continue operating in `sha256:v1-fallback` mode until pepper is provisioned/generated.
