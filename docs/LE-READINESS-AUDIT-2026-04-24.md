# Light Engine Readiness Audit — 2026-04-24

Read-only audit of the Light Engine (LE) + Central + Wholesale platform. No runtime behaviour was changed by this report; fixes that follow this audit are tracked as individual commits referencing the P0/P1/P2/P3 items below.

## Scope

- LE service: `server-foxtrot.js` + `routes/` (root) — Cloud Run `light-engine` (us-east1)
- Central service: `greenreach-central/` — Cloud Run `greenreach-central` (us-east1)
- Wholesale portal (buyer UI served by Central, inventory reserved on LE)
- Sensor pipeline (SwitchBot → LE → Central)
- AI agents: E.V.I.E. (Gemini 2.5 Flash), F.A.Y.E. + G.W.E.N. (Gemini 2.5 Pro) via Vertex AI
- Notifications (farm_notifications + Google Workspace SMTP + email-to-SMS)
- Cross-service communication (`writeToLE`, `farmCallWithTimeout`, sync-service)
- Postgres (AlloyDB private IP) schema drift

## Executive summary

- Platform is stable on Cloud Run but has several **silent-failure paths** that can mask outages for hours.
- **Biggest availability risk:** sensor pipeline goes dark with no alert when SwitchBot creds fall off a revision. `env-cache.json` masks it.
- **Biggest correctness risk:** wholesale inventory reserve/confirm split across LE (NeDB) and Central (AlloyDB) with fire-and-forget deduction sync. Overselling is possible under concurrency.
- **Biggest resiliency gap:** all three AI agents depend on a single Gemini client with no cross-provider fallback.
- **Biggest cross-service gap:** `writeToLE` has a 10 s timeout, no caching, no circuit breaker, and never retries 409. Zone-name / group-id conflicts fail permanently and invisibly.
- Schema drift is still live (`zone_id` missing in alerts path, `farm_id` uuid/varchar, `farms.location` absent); patched via try/catch fallbacks but not fully healed.
- Security posture is yellow: no SSRF guard on `farmCallWithTimeout`; user-controlled farm/room names are interpolated into AI system prompts without escaping.
- Test coverage is shallow: smokes exercise only the happy path of catalog + reserve + preview + delivery.

Correction to earlier draft: `apiRateLimiter` **is** mounted on `/api` in `server-foxtrot.js` (~L2656); `authRateLimiter` is applied on `/api/farm/auth/login`. That item has been removed from the P0 list.

## Prioritized todo list

### P0 — ship this sprint

1. **Sensor credential startup guard.** When `NODE_ENV=production` and SwitchBot creds are missing, log ERROR level and push an admin notification at boot. (`server-foxtrot.js`, near `setupLiveSensorSync` call ~L1073)
2. **AI provider fallback.** Wire Claude Haiku (via `ANTHROPIC_API_KEY`) as a fallback in `greenreach-central/lib/gemini-client.js` on 401/429/503.
3. **Oversell prevention.** Move the `farm_inventory` decrement from the confirm path to the reserve path and wrap in a Postgres transaction with `SELECT ... FOR UPDATE`. Make the Central write blocking.
4. **Reservation TTL validation on confirm.** `lib/wholesale/reservation-store.js` — block `confirmReservation` / `confirmOrderReservations` from confirming rows whose `expires_at <= NOW()`. (Reads already enforce this; writes do not.)
5. **Notification category contract.** Define category enum + severity enum, validate on push, warn on unknown values. (`greenreach-central/services/notification-store.js`)
6. **Startup validation for `FARM_EDGE_URL`** on Central, and Square credentials + `ADMIN_ALERT_EMAIL` in production (warn-level for non-critical, error-level for payment path).

### P1 — two sprints

7. Prompt-safe user inputs: JSON-stringify farm/room/zone names before interpolating into AI system prompts; validate against `[A-Za-z0-9 _.-]{1,64}` on write.
8. `writeToLE` resilience: drop default timeout to 3 s, add 2 min response cache, simple circuit breaker (5 failures → 60 s open), retry 409 once with normalized identifiers.
9. AI rate limits: sliding-window limiter on `/api/assistant/chat`, `/api/admin/faye/chat`, `/api/gwen/chat`.
10. AI tool audit log: persist `tool_name, user_id, farm_id, input_hash, result_status` per invocation.
11. Trust-tier sweep: audit every tool in `TOOL_CATALOG`; reject tools with no explicit tier.
12. Data-file write mutex: extend `withGroupsLock()` coverage to `rooms.json`, `farm.json`, `device-meta.json`, `zone-*.json`.
13. Wholesale order state → buyer notification on every buyer-relevant transition.
14. SMTP delivery retry: `notification_delivery_queue` table; background worker with exponential backoff; dead-letter after 5 attempts.

### P2 — next quarter

15. G.W.E.N. code execution sandbox (isolated container, network egress whitelist).
16. Conversation memory LRU cap per user and per process.
17. Lazy sensor refresh before AI calls when `env-cache.json` age > 5 min.
18. Notification preferences table + UI.
19. WebSocket notification fan-out (replace 30–60 s poll).
20. Schema: compound index `farm_inventory(farm_id, product_id)`; FK `trays.group_id`; normalize `iot_devices.zone_id` type.
21. Delete `LOT-AUDIT-FALLBACK-001` and all `ENABLE_DETERMINISTIC_WHOLESALE_LOT` paths.
22. Shared LE URL resolver module consumed by every Central → LE caller.
23. Square webhook signature verification on every webhook route.

### P3 — hygiene

24. `.env.example` cleanup (remove AWS / Twilio / Firebase).
25. Smoke test expansion: payment authorize, multi-farm split, confirm + deduction, AI happy path, notification email (mocked SMTP), schema-drift guards.
26. Perf baseline + SLO dashboard in Cloud Monitoring.
27. Secrets rotation schedule (quarterly for Square, GREENREACH_API_KEY, Gemini SA).
28. Append observed schema drifts + mitigations to `.github/CLOUD_ARCHITECTURE.md`.

## Risk matrix

| Component          | Availability | Correctness    | Security | Observability |
|--------------------|--------------|----------------|----------|---------------|
| Sensor pipeline    | CRITICAL     | HIGH           | OK       | HIGH          |
| Wholesale inventory| HIGH         | CRITICAL       | OK       | MEDIUM        |
| AI agents          | HIGH         | HIGH           | MEDIUM   | CRITICAL      |
| Notifications      | HIGH         | HIGH           | OK       | MEDIUM        |
| Cross-service comm | HIGH         | HIGH           | MEDIUM   | MEDIUM        |
| Database           | OK           | HIGH (drift)   | OK       | OK            |
| Auth / secrets     | OK           | OK             | MEDIUM   | MEDIUM        |

## Change log

- 2026-04-24: Initial audit committed. Corresponding P0 fixes tracked in follow-up commits on branch `fix/room-zones-group-consolidation`.
