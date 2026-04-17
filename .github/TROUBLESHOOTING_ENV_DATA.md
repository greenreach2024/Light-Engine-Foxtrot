# Troubleshooting: Environmental Data Issues

**Version**: 1.1.0
**Date**: April 17, 2026
**Purpose**: Step-by-step diagnostic guide for when sensor data appears stale, missing, or incorrect. Follow these steps IN ORDER before making any code changes.

---

## Rule #1: Trace From Source to Sink

ALWAYS start at the data source (SwitchBot Cloud API) and trace forward through each pipeline stage. Do NOT start at the dashboard and work backward. Do NOT make "fix" commits at intermediate stages until the root cause is found.

Pipeline order:
```
SwitchBot Cloud -> LE Polling -> EnvStore -> LE /env -> sync-service -> Central DB -> Central /env -> Dashboard
```

---

## Step 1: Verify SwitchBot Credentials Exist

This is the #1 cause of stale data. Check first, always.

```bash
# Check Cloud Run env/secret wiring on LE
gcloud run services describe light-engine --region=us-east1 \
  --format="yaml(spec.template.spec.containers[0].env)" | grep -E "SWITCHBOT_(TOKEN|SECRET)"
```

Expected output should show both `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET`.

If missing, set/update the referenced secrets and roll a new revision:
```bash
echo -n "<token>" | gcloud secrets versions add SWITCHBOT_TOKEN --data-file=-
echo -n "<secret>" | gcloud secrets versions add SWITCHBOT_SECRET --data-file=-
gcloud run services update light-engine --region=us-east1 \
  --update-secrets="SWITCHBOT_TOKEN=SWITCHBOT_TOKEN:latest,SWITCHBOT_SECRET=SWITCHBOT_SECRET:latest"
```

Also verify `public/data/farm.json` has `integrations.switchbot` with both token and secret.

---

## Step 2: Verify LE Is Serving Fresh Data

```bash
curl -s "https://light-engine-1029387937866.us-east1.run.app/env" | python3 -m json.tool
```

**Check:**
- `lastUpdate` timestamp should be within the last 2 minutes
- Temperature values should be realistic (15-30C for a grow room)
- If `lastUpdate` is hours/days old, the problem is at Stage 2 (SwitchBot polling)

---

## Step 3: Verify Sync Service Is Pushing to Central

Check Cloud Run logs for sync activity:
```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="light-engine" AND (textPayload:"sync" OR textPayload:"telemetry")' \
  --limit=100 --freshness=2h
```

Look for:
- POST requests to Central's `/api/sync/telemetry`
- Success (200) or failure (401, 403, 500) responses
- Any authentication errors

---

## Step 4: Verify Central Is Receiving Data

```bash
curl -s "https://greenreachgreens.com/env" \
  -H "Authorization: Bearer <jwt-token>" | python3 -m json.tool
```

Or test the sync endpoint directly:
```bash
curl -s "https://greenreachgreens.com/api/sync/telemetry" \
  -H "X-Farm-ID: FARM-MLTP9LVH-B0B85039" \
  -H "X-API-Key: <farm-api-key>"
```

**Check the response for:**
- `envSource`: Should be `"sync-service"` (means DB data is being served)
- If `envSource` is `"le-proxy"`, Central is falling back to proxying to LE (DB may be empty)
- `updatedAt`: Should be recent

---

## Step 5: Verify Dashboard Is Fetching

Open browser dev tools (Network tab) and check:
- `GET /env?hours=24` calls every 60 seconds
- Response contains fresh data
- No 401/403 errors (JWT expired = login again)

---

## Common Root Causes

### 1. Missing SwitchBot Credentials (Most Common)

**Symptom**: Data frozen at a specific timestamp (usually the last deploy date)
**Cause**: `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET` not set on LE Cloud Run service
**Diagnostic**: `gcloud run services describe light-engine ...` shows no SWITCHBOT entries
**Fix**: add latest secret versions and update service secret references (Step 1)
**Why it's sneaky**: No error is logged. `ensureSwitchBotConfigured()` returns false silently. The sync loop still runs but just recycles stale env.json values with fresh-looking timestamps.

### 2. Hub Mini Offline

**Symptom**: ALL sensors report stale data simultaneously
**Cause**: Hub Mini lost WiFi or power
**Diagnostic**: All 4 sensor timestamps frozen at same time
**Fix**: Physical fix (power cycle Hub Mini, check WiFi)

### 3. Individual Sensor Battery Dead

**Symptom**: ONE sensor stale, others fine
**Cause**: WoIOSensor battery depleted
**Diagnostic**: That sensor's `battery` field shows 0 or very low
**Fix**: Replace CR2 battery in the sensor

### 4. Central /env Proxy Misconfigured

**Symptom**: Central shows stale data but LE /env returns fresh data
**Cause**: `FARM_EDGE_URL` on Central points to wrong/old URL, or auth headers wrong
**Diagnostic**: Central /env response has `envSource: "le-proxy"` with stale data
**Fix**: Verify `FARM_EDGE_URL` on `greenreach-central` Cloud Run service

### 5. Farm API Key Mismatch

**Symptom**: sync-service runs but Central rejects telemetry (401/403)
**Cause**: API key in `config/edge-config.json` doesn't match Central's `farm-api-keys.json` or DB
**Diagnostic**: `light-engine` Cloud Run logs show 401 responses from Central
**Fix**: Verify key matches in both locations

### 6. env.json Contains Stale Seed Data

**Symptom**: After deploy, data appears to be from a previous time period
**Cause**: `data/automation/env-state.json` deployed with stale values, SwitchBot polling not running
**Diagnostic**: Timestamps match deploy time rather than current time
**Fix**: Ensure SwitchBot credentials are set (see #1). Fresh polling will overwrite stale file data.

### 7. Devices Page False Offline (Status Field Missing)

**Symptom**: Central dashboard Devices table shows `offline`, but sensors are updating and
`/api/sync/:farmId/devices` contains fresh telemetry.

**Cause**: UI status mapping relied on `device.status` only. SwitchBot device payloads often
omit top-level `status` and provide `telemetry.online` + `lastSeen` instead.

**Diagnostic**:
```bash
curl -s "https://greenreachgreens.com/api/sync/FARM-MLTP9LVH-B0B85039/devices" \
  -H "X-Farm-ID: FARM-MLTP9LVH-B0B85039" \
  -H "X-API-Key: <farm-api-key>" | python3 -m json.tool
```

Check whether:
1. `devices[].telemetry.online` is `true`
2. `devices[].lastSeen` or `devices[].telemetry.lastUpdate` is recent (< 5 minutes)

**Fix**:
- Use derived status logic in `greenreach-central/public/central-admin.js`:
  1. explicit `status`
  2. `telemetry.online` / `deviceData.online`
  3. fallback to recency (`lastSeen < 5 minutes => online`)

This matches the field mapping contract and prevents false offline badges.

### 8. AI Insights Popup Errors (401 current/forecast, 500 metrics)

**Symptom**: Farm-facing dashboards show popup/toast errors while network logs include:
- `401` on `/api/inventory/current` and/or `/api/inventory/forecast`
- `500` or non-OK on `/api/sustainability/metrics`

**Cause**:
1. Frontend request helper only read token from one storage location (local vs session mismatch)
2. Missing `x-farm-id` context header on some standalone pages
3. Dashboard parsed JSON on failed responses without graceful fallback

**Diagnostic**:
1. In browser Network tab, inspect request headers for failing endpoints
2. Confirm `Authorization: Bearer ...` exists
3. Confirm `x-farm-id: FARM-...` exists (when available in storage)
4. Confirm UI does not crash on non-OK responses; it should render partial cards and log warnings

**Fix**:
- Standardize `fetchWithFarmAuth` to read from both `sessionStorage` and `localStorage`
- Add `x-farm-id` from `farm_id`/`farmId` storage keys
- Use safe JSON parsing and fail-soft rendering for sustainability widgets

Reference implementations:
- `greenreach-central/public/views/farm-inventory.html`
- `greenreach-central/public/LE-farm-admin.html`

---

## Diagnostic One-Liner

Test the entire pipeline in one sequence:

```bash
# 1. LE direct (Cloud Run)
echo "=== LE Direct ===" && \
curl -s "https://light-engine-1029387937866.us-east1.run.app/env" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'lastUpdate: {d.get(\"lastUpdate\",\"MISSING\")}')" && \
echo "" && \
# 2. Central
echo "=== Central ===" && \
curl -s "https://greenreachgreens.com/env" -H "X-Farm-ID: FARM-MLTP9LVH-B0B85039" -H "X-API-Key: <greenreach-api-key>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'envSource: {d.get(\"envSource\",\"MISSING\")}'); print(f'updatedAt: {d.get(\"updatedAt\",\"MISSING\")}')"
```

If LE shows fresh data but Central does not, the problem is in stages 5-7.
If LE shows stale data, the problem is in stages 1-3 (most likely missing credentials).
