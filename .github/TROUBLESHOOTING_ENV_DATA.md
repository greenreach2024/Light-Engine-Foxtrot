# Troubleshooting: Environmental Data Issues

**Version**: 1.0.0
**Date**: March 19, 2026
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
# Check EB environment variables on LE
/Users/petergilbert/Library/Python/3.9/bin/eb printenv light-engine-foxtrot-prod-v3 | grep SWITCHBOT
```

Expected output should show both `SWITCHBOT_TOKEN` and `SWITCHBOT_SECRET`.

If missing, set them:
```bash
/Users/petergilbert/Library/Python/3.9/bin/eb setenv \
  SWITCHBOT_TOKEN="<token>" \
  SWITCHBOT_SECRET="<secret>" \
  -e light-engine-foxtrot-prod-v3
```

Also verify `public/data/farm.json` has `integrations.switchbot` with both token and secret.

---

## Step 2: Verify LE-EB Is Serving Fresh Data

```bash
curl -s "http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/env" | python3 -m json.tool
```

(Note: URL says "v2" but reaches the v3 environment due to CNAME swap. This is correct.)

**Check:**
- `lastUpdate` timestamp should be within the last 2 minutes
- Temperature values should be realistic (15-30C for a grow room)
- If `lastUpdate` is hours/days old, the problem is at Stage 2 (SwitchBot polling)

---

## Step 3: Verify Sync Service Is Pushing to Central

Check the LE-EB logs for sync activity:
```bash
/Users/petergilbert/Library/Python/3.9/bin/eb logs light-engine-foxtrot-prod-v3 --all | grep -i "sync\|telemetry"
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
- If `envSource` is `"le-proxy"`, Central is falling back to proxying to LE-EB (DB may be empty)
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
**Cause**: `SWITCHBOT_TOKEN` / `SWITCHBOT_SECRET` not set on LE-EB
**Diagnostic**: `eb printenv` shows no SWITCHBOT vars
**Fix**: `eb setenv SWITCHBOT_TOKEN=... SWITCHBOT_SECRET=... -e light-engine-foxtrot-prod-v3`
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

**Symptom**: Central shows stale data but LE-EB /env returns fresh data
**Cause**: `FARM_EDGE_URL` on Central points to wrong/old URL, or auth headers wrong
**Diagnostic**: Central /env response has `envSource: "le-proxy"` with stale data
**Fix**: Verify `FARM_EDGE_URL` env var on `greenreach-central-prod-v4`

### 5. Farm API Key Mismatch

**Symptom**: sync-service runs but Central rejects telemetry (401/403)
**Cause**: API key in `config/edge-config.json` doesn't match Central's `farm-api-keys.json` or DB
**Diagnostic**: LE-EB logs show 401 responses from Central
**Fix**: Verify key matches in both locations

### 6. env.json Contains Stale Seed Data

**Symptom**: After deploy, data appears to be from a previous time period
**Cause**: `data/automation/env-state.json` deployed with stale values, SwitchBot polling not running
**Diagnostic**: Timestamps match deploy time rather than current time
**Fix**: Ensure SwitchBot credentials are set (see #1). Fresh polling will overwrite stale file data.

---

## Diagnostic One-Liner

Test the entire pipeline in one sequence:

```bash
# 1. LE-EB direct
echo "=== LE-EB Direct ===" && \
curl -s "http://light-engine-foxtrot-prod-v2.eba-ukiyyqf9.us-east-1.elasticbeanstalk.com/env" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'lastUpdate: {d.get(\"lastUpdate\",\"MISSING\")}')" && \
echo "" && \
# 2. Central
echo "=== Central ===" && \
curl -s "https://greenreachgreens.com/env" -H "X-Farm-ID: FARM-MLTP9LVH-B0B85039" -H "X-API-Key: <greenreach-api-key>" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'envSource: {d.get(\"envSource\",\"MISSING\")}'); print(f'updatedAt: {d.get(\"updatedAt\",\"MISSING\")}')"
```

If LE-EB shows fresh data but Central does not, the problem is in stages 5-7.
If LE-EB shows stale data, the problem is in stages 1-3 (most likely missing credentials).
