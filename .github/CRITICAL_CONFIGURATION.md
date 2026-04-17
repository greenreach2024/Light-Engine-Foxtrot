# Critical Configuration Reference

**Version**: 2.1.0
**Date**: April 17, 2026
**Authority**: Canonical reference for all credentials, API keys, environment variables, and configuration files. Agents MUST NOT modify any value listed here without explicit user approval.

---

## PLATFORM MIGRATED TO GOOGLE CLOUD RUN (April 2026)

**AWS Elastic Beanstalk is DEPRECATED. All environment variables are now managed via Cloud Run env vars and Google Secret Manager.**

See `.github/CLOUD_ARCHITECTURE.md` for the full infrastructure reference.
See `.github/SECRET_STATUS.md` for canonical active/placeholder/missing secret status tracking.

---

## Cloud Run Environment Variables

### Light Engine (`light-engine` service)

| Variable | Purpose | Source | Notes |
|----------|---------|--------|-------|
| `SWITCHBOT_TOKEN` | SwitchBot Cloud API authentication | Secret Manager | Required for sensor data. If missing, sensors silently stop updating. |
| `SWITCHBOT_SECRET` | SwitchBot Cloud API HMAC signing | Secret Manager | Required for sensor data. Paired with token. |
| `JWT_SECRET` | JWT signing key | Secret Manager | Required for LE startup validation |
| `TOKEN_ENCRYPTION_KEY` | Token encryption | Secret Manager | Required for LE startup validation |
| `GREENREACH_API_KEY` | Server-to-server auth | Secret Manager | Used for Central proxy requests |
| `DB_HOST` | AlloyDB private IP | Env var | `10.87.0.2` |
| `DB_PASSWORD` | AlloyDB password | Secret Manager (`ALLOYDB_PASSWORD`) | |
| `DB_USER` | Database user | Env var | `postgres` |
| `DB_NAME` | Database name | Env var | `greenreach_central` |
| `USE_GCS` | Enable GCS storage | Env var | `true` |
| `GCS_BUCKET` | GCS bucket name | Env var | `greenreach-storage` |
| `NODE_ENV` | Node environment | Env var | `production` |
| `SQUARE_ACCESS_TOKEN` | Square API token | Secret Manager | For payment processing |
| `SQUARE_ENVIRONMENT` | Square API environment | Env var | `production` |

**To view current env vars:**
```bash
gcloud run services describe light-engine --region=us-east1 --format="yaml(spec.template.spec.containers[0].env)"
```

**To update env vars:**
```bash
gcloud run services update light-engine --region=us-east1 --update-env-vars="KEY=value"
```

**To update secrets:**
```bash
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
gcloud run services update light-engine --region=us-east1  # Force new revision
```

### GreenReach Central (`greenreach-central` service)

| Variable | Purpose | Source | Notes |
|----------|---------|--------|-------|
| `GREENREACH_API_KEY` | authMiddleware for server-to-server calls | Secret Manager | Used when Central proxies to LE |
| `FARM_ID` | Identifies the farm | Env var | `FARM-MLTP9LVH-B0B85039` |
| `FARM_EDGE_URL` | LE Cloud Run URL for proxy fallback | Env var | `https://light-engine-1029387937866.us-east1.run.app` |
| `DB_HOST` | AlloyDB private IP | Env var | `10.87.0.2` |
| `DB_PASSWORD` | AlloyDB password | Secret Manager (`ALLOYDB_PASSWORD`) | |
| `DB_USER` | Database user | Env var | `postgres` |
| `DB_NAME` | Database name | Env var | `greenreach_central` |
| `JWT_SECRET` | JWT signing key | Secret Manager | |
| `USE_GCS` | Enable GCS storage | Env var | `true` |
| `GCS_BUCKET` | GCS bucket name | Env var | `greenreach-storage` |
| `NODE_ENV` | Node environment | Env var | `production` |
| `SQUARE_ACCESS_TOKEN` | GreenReach master Square token | Secret Manager | For direct-charge fallback |
| `SQUARE_APP_ID` | Square OAuth application ID | Env var | For per-farm OAuth flow |
| `SQUARE_APP_SECRET` | Square OAuth application secret | Secret Manager | |
| `SQUARE_ENVIRONMENT` | Square API environment | Env var | `production` |
| `SQUARE_LOCATION_ID` | GreenReach Square location | Env var | For direct-charge fallback |
| `SQUARE_WEBHOOK_SIGNATURE_KEY` | Webhook HMAC verification | Secret Manager | |
| `WHOLESALE_COMMISSION_RATE` | Broker commission rate | Env var | `0.12` (12%) |
| `WHOLESALE_DEFAULT_SKU_FACTOR` | Wholesale pricing factor | Env var | `0.65` (range 0.50-0.75) |
| `SMTP_HOST` | Email SMTP server | Env var | `smtp.gmail.com` |
| `SMTP_PORT` | Email SMTP port | Env var | `587` |
| `SMTP_USER` | Email sender address | Env var | `info@greenreachgreens.com` |
| `SMTP_PASS` | Email app password | Secret Manager | Google App Password |
| `FROM_EMAIL` | Email from address | Env var | `info@greenreachgreens.com` |
| `ADMIN_ALERT_EMAIL` | Admin alert recipient | Env var | `info@greenreachgreens.com` |
| `ADMIN_ALERT_PHONE` | Admin alert SMS | Env var | (not set) |
| `GCP_PROJECT` / `GOOGLE_CLOUD_PROJECT` | Vertex AI project routing | Env var | Required for Gemini in Cloud Run |
| `GCP_REGION` | Vertex AI region | Env var | `us-east1` |
| `GEMINI_API_KEY` | Gemini Developer API fallback | Secret Manager / env var | Optional for non-Cloud-Run local dev |
| `OPENAI_API_KEY` | Legacy/compat AI integrations | Secret Manager | Optional for non-core AI paths |

**To view/set Central env vars:**
```bash
gcloud run services describe greenreach-central --region=us-east1 --format="yaml(spec.template.spec.containers[0].env)"
gcloud run services update greenreach-central --region=us-east1 --update-env-vars="KEY=value"
```

---

## Notification Configuration (Email / SMS / Alerts)

### Email (Google Workspace SMTP)

Primary email address: `info@greenreachgreens.com` (Google Workspace account).

| Variable | Value | Where Set |
|----------|-------|-----------|
| `SMTP_HOST` | `smtp.gmail.com` | Cloud Run env var |
| `SMTP_PORT` | `587` | Cloud Run env var |
| `SMTP_USER` | `info@greenreachgreens.com` | Cloud Run env var |
| `SMTP_PASS` | Google App Password | Secret Manager |
| `FROM_EMAIL` | `info@greenreachgreens.com` | Cloud Run env var |
| `ADMIN_ALERT_EMAIL` | `info@greenreachgreens.com` | Cloud Run env var |

**To generate the Google App Password:**
1. Log in to `info@greenreachgreens.com` at https://myaccount.google.com
2. Go to Security > 2-Step Verification > App Passwords
3. Generate a new app password for "Mail" on "Other (Cloud Run)"
4. Store in Secret Manager as `SMTP_PASS`

**To set email env vars on Cloud Run:**
```bash
gcloud run services update greenreach-central --region=us-east1 \
  --update-env-vars="SMTP_HOST=smtp.gmail.com,SMTP_PORT=587,SMTP_USER=info@greenreachgreens.com,FROM_EMAIL=info@greenreachgreens.com,ADMIN_ALERT_EMAIL=info@greenreachgreens.com"
```

**To update SMTP_PASS secret:**
```bash
echo -n "APP_PASSWORD_HERE" | gcloud secrets versions add SMTP_PASS --data-file=-
gcloud run services update greenreach-central --region=us-east1
```

### SMS (Twilio Primary + SMTP Gateway Fallback)

SMS is used for critical/high alert notifications only. Delivery is Twilio-first when configured, with carrier email-to-SMS via Google Workspace SMTP as fallback. Approved recipients and gateway mappings are configuration-driven via env vars.

| Variable | Value | Notes |
|----------|-------|-------|
| `ADMIN_ALERT_PHONE` | (not set) | Admin phone for alert SMS |
| `SMS_APPROVED_RECIPIENTS` | (not set) | JSON object: phone -> gateway destination |
| `SMS_GATEWAY_OVERRIDES` | (optional) | JSON object for domain overrides |
| `TWILIO_ACCOUNT_SID` | (optional) | Enables Twilio primary transport |
| `TWILIO_AUTH_TOKEN` | (optional) | Twilio auth secret |
| `TWILIO_PHONE_NUMBER` | (optional) | Twilio sending number |

**To add a new SMS recipient:** update `SMS_APPROVED_RECIPIENTS` and redeploy Cloud Run revision.

### Alert Notifier

Rate-limited (1 per alert_type per 15 min). Dispatches email + SMS for `critical` and `high` severity alerts. Uses `ADMIN_ALERT_EMAIL` and `ADMIN_ALERT_PHONE` env vars.

---

## Configuration Files

### `config/edge-config.json` (LE-side)

```json
{
  "mode": "edge",
  "farmId": "FARM-MLTP9LVH-B0B85039",
  "farmName": "The Notable Sprout",
  "apiKey": "<farm-api-key>",
  "centralApiUrl": "https://greenreachgreens.com",
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "hardwareModel": "AWS Cloud",
  "offlineMode": false,
  "syncEnabled": true,
  "registrationComplete": true
}
```

**Key fields:**
- `hardwareModel`: "AWS Cloud" -- NOT a physical device
- `apiKey`: Farm-to-Central sync authentication key
- `centralApiUrl`: Where sync-service sends telemetry
- `mode`: "edge" is a legacy label; the LE Cloud Run runs as the farm in the cloud

### `public/data/farm.json` (LE-side)

Contains farm profile and integrations. Git-ignored and bundled in the LE container image.

**Critical section:**
```json
{
  "integrations": {
    "switchbot": {
      "token": "<switchbot-token>",
      "secret": "<switchbot-secret>"
    }
  }
}
```

This is the secondary credential source for SwitchBot (Cloud Run secret-backed env vars are primary).

### `public/data/iot-devices.json` (LE-side, git-tracked)

IoT device registry. Contains SwitchBot device IDs and sensor metadata. Also contains credentials in Sen 3's `credentials` field, but **the code does NOT read credentials from this file** -- it reads from farm.json / env vars instead.

### `greenreach-central/config/farm-api-keys.json` (Central-side)

Fallback farm API key validation. Used by `authenticateFarm` middleware when DB lookup fails.

### `greenreach-central/public/data/farm.json` (Central-side)

Separate copy of farm profile for Central. NOT automatically synced with `public/data/farm.json`.

---

## Authentication Keys Summary

| Key | Location | Used By | Validates Against |
|-----|----------|---------|-------------------|
| Farm API Key | `config/edge-config.json` apiKey | sync-service.js (LE -> Central) | Central DB `farms` table + `farm-api-keys.json` |
| GREENREACH_API_KEY | Cloud Run Secret Manager | Central authMiddleware | Compared directly in middleware |
| SWITCHBOT_TOKEN | Cloud Run Secret Manager + farm.json | `switchBotApiRequest()` | SwitchBot Cloud API |
| SWITCHBOT_SECRET | Cloud Run Secret Manager + farm.json | `switchBotApiRequest()` | SwitchBot Cloud API |
| JWT Bearer Token | Browser localStorage | Dashboard fetch calls | Central JWT verification |
| SQUARE_ACCESS_TOKEN | Cloud Run Secret Manager | squarePaymentService.js | Square Payments API |
| SQUARE_APP_SECRET | Cloud Run Secret Manager | square-oauth-proxy.js | Square OAuth API |
| SQUARE_WEBHOOK_SIGNATURE_KEY | Cloud Run Secret Manager | payment-webhooks.js | Square webhook verification |

### Browser Storage Contract (Farm UI)

Protected farm UI API calls must treat browser storage as dual-source:

1. Token lookup order:
  - `sessionStorage.getItem('token')`
  - `localStorage.getItem('token')`
2. Farm ID lookup order:
  - `sessionStorage.getItem('farm_id')`
  - `sessionStorage.getItem('farmId')`
  - `localStorage.getItem('farm_id')`
  - `localStorage.getItem('farmId')`
3. Request headers:
  - `Authorization: Bearer <token>` when token exists
  - `x-farm-id: <farm-id>` when farm ID exists

This prevents auth/context drift between login flows and standalone pages.
Reference implementations:
- `greenreach-central/public/views/farm-inventory.html`
- `greenreach-central/public/LE-farm-admin.html`

### Multi-Tenant Storage Cleanup

On login and token expiry, all farm-scoped keys are purged from both localStorage and sessionStorage to prevent cross-farm data leakage.

**Cleanup functions**:
- `clearStaleFarmData()` in `greenreach-central/public/farm-admin.js` -- runs on login success, before new credentials are written
- `clearFarmStorage()` in `greenreach-central/public/auth-guard.js` (and root `public/auth-guard.js`) -- runs on all token/session expiry paths

**Cleared keys**: farm_id, farmId, farm_name, farmName, email, token, auth_token, farm_admin_session, gr.farm, farmSettings, qualityStandards, setup_completed, ai_pricing_recommendations, ai_pricing_last_check, ai_pricing_history, pricing_version, usd_to_cad_rate, impersonation_token, impersonation_farm, impersonation_expires, adminFarmId, plus dynamic `pricing_<crop>` keys.

### PostgreSQL Row-Level Security (RLS)

**Status**: Phase A (ENABLE without FORCE) -- deployed March 23, 2026
**Migration**: 040 in `greenreach-central/config/database.js`
**Policy name**: `gr_tenant_isolation` on 19 tenant tables

The `query()` function in database.js accepts `options`:
```js
await query('SELECT * FROM farm_data WHERE farm_id = $1', [farmId], { farmId });
await query('SELECT * FROM farms', [], { isAdmin: true });
await query('SELECT 1', [], { skipTenantContext: true });
```

Phase A is safe: table owner bypasses RLS policies. Phase B will enable `FORCE` after all call sites migrate.

---

## Device Status Data Contract (Central UI)

For `GET /api/sync/:farmId/devices` and `/data/iot-devices.json`, do not assume
`device.status` is always present.

Expected online/offline derivation order:
1. `device.status` when provided (`online`, `offline`, `warning`, `critical`)
2. `device.telemetry.online` or `device.deviceData.online`
3. Timestamp recency from `lastSeen` / `last_seen` / `telemetry.lastUpdate`

Operational threshold: treat a device as online when last-seen is within 5 minutes.

This contract is implemented in:
- `greenreach-central/public/central-admin.js` (`deriveDeviceStatus`, `getDeviceSeenAt`)
- `greenreach-central/public/views/field-mapping.html` (`device.online` mapping)

---

## SwitchBot Device Registry

| Device Name | Type | Device ID (MAC) | Location |
|-------------|------|-----------------|----------|
| Sen 1 | WoIOSensor | CE2A81460E78 | Zone 1 |
| Sen 2 | WoIOSensor | CE2A8606558E | Zone 1 |
| Sen 3 | WoIOSensor | C3343035702D | Zone 2 |
| Sen 4 | WoIOSensor | D0C841064453 | Zone 2 |
| Hub Mini 7E | Hub Mini (W0702000) | D3F85167A57E | WiFi bridge |

Hub Mini is the WiFi bridge. Sensors communicate to Hub via BLE, Hub uploads to SwitchBot Cloud via WiFi. LE Cloud Run polls SwitchBot Cloud API -- there is no direct BLE connection from LE to sensors.

---

## Files That MUST NOT Be Modified Without Full Pipeline Understanding

| File | Why It's Critical |
|------|-------------------|
| `server-foxtrot.js` functions: `setupLiveSensorSync()`, `ensureSwitchBotConfigured()`, `getFarmIntegrations()`, `switchBotApiRequest()` | These are the sensor data SOURCE. Breaking them stops all environmental data. |
| `automation/env-store.js` | In-memory data store for all sensor readings. Corruption here means bad data everywhere downstream. |
| `lib/sync-service.js` | Pushes data from LE to Central. Breaking this disconnects the farm from Central. |
| `greenreach-central/routes/sync.js` | Receives telemetry at Central. Breaking auth here rejects all farm data. |
| `greenreach-central/server.js` `/env` route | Serves data to the dashboard. Breaking this makes the dashboard show stale/no data. |
| `config/edge-config.json` | Contains farm identity and sync credentials. Wrong values = auth failures. |
| `public/data/farm.json` | Contains SwitchBot credentials (backup). Removing integrations section breaks credential fallback. |
| `greenreach-central/services/squarePaymentService.js` | Handles all payment processing. Breaking this stops checkout and refunds. |
| `greenreach-central/services/revenue-accounting-connector.js` | Double-entry accounting ledger. Breaking this corrupts financial records. |
| `greenreach-central/routes/payment-webhooks.js` | Webhook handlers for payment status updates. Breaking verification = rejected webhooks. |

---

## Deployment Commands (Cloud Run)

```bash
# View env vars
gcloud run services describe SERVICE_NAME --region=us-east1 --format="yaml(spec.template.spec.containers[0].env)"

# Update env vars (safe -- creates new revision)
gcloud run services update SERVICE_NAME --region=us-east1 --update-env-vars="KEY=value"

# Update secrets
echo -n "new-value" | gcloud secrets versions add SECRET_NAME --data-file=-
gcloud run services update SERVICE_NAME --region=us-east1  # Force new revision

# Build and push (ALWAYS --platform linux/amd64 on Apple Silicon)
docker buildx build --platform linux/amd64 -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/SERVICE:latest --push CONTEXT

# Deploy
gcloud run services update SERVICE_NAME --region=us-east1 --image=us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/SERVICE:latest
```

**BANNED**: ALL `eb` CLI commands, all `aws elasticbeanstalk` commands. Platform migrated to Cloud Run (April 2026).
