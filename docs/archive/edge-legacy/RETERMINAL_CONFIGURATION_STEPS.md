# reTerminal Edge Device Configuration Guide
**Date:** January 31, 2026  
**Device:** reTerminal at 192.168.2.222  
**Access:** VNC  
**Goal:** Enable sync with GreenReach Central

---

## Pre-Configuration: Generate API Key on Central

**Before configuring the edge device, generate an API key on GreenReach Central:**

### Option A: Via PostgreSQL (If you have database access)

```bash
# Connect to GreenReach Central database
# Run this on the server hosting greenreachgreens.com

psql -U postgres -d greenreach_central

# Generate API key
INSERT INTO farm_api_keys (farm_id, api_key, created_at)
VALUES (
  'FARM-MKLOMAT3-A9D8', 
  'grc_farm_mklomat3_' || encode(gen_random_bytes(16), 'hex'), 
  NOW()
)
RETURNING api_key;

# Copy the generated API key (looks like: grc_farm_mklomat3_a1b2c3d4e5f6...)
```

### Option B: Via Central Admin UI (If API key management exists)

1. Log into https://greenreachgreens.com/GR-central-admin.html
2. Navigate to Farm Management
3. Find "Big Green Farm (FARM-MKLOMAT3-A9D8)"
4. Click "Generate API Key"
5. Copy the key

### Option C: Manual Database Insert (If needed)

If database access is unavailable, use this temporary key for testing:
```
TEMP_KEY=grc_farm_mklomat3_temp_test_key_12345
```
⚠️ Replace with real key before production!

---

## Configuration Steps on reTerminal (Via VNC)

### Step 1: Open Terminal on reTerminal

1. Connect via VNC to 192.168.2.222
2. Open terminal application
3. Navigate to project directory:

```bash
cd ~/Light-Engine-Foxtrot
```

### Step 2: Check Current Configuration

```bash
# Check what's currently set
cat .env | grep -E "DEMO_MODE|EDGE_MODE|GREENREACH|FARM_ID"

# Check if services are running
pm2 list
```

**Expected Output:**
- DEMO_MODE=true (this is the problem!)
- No EDGE_MODE or GREENREACH variables

### Step 3: Backup Current .env

```bash
# Create backup
cp .env .env.backup.$(date +%Y%m%d_%H%M%S)

# Verify backup created
ls -lh .env*
```

### Step 4: Disable DEMO_MODE

```bash
# Edit .env file
nano .env

# Find this line:
DEMO_MODE=true

# Change to:
DEMO_MODE=false

# Or comment it out:
# DEMO_MODE=true

# Save: Ctrl+O, Enter
# Exit: Ctrl+X
```

### Step 5: Add Edge Sync Configuration

```bash
# Continue editing .env (or reopen if you closed it)
nano .env

# Add these lines at the end of the file:
EDGE_MODE=true
FARM_ID=FARM-MKLOMAT3-A9D8
GREENREACH_CENTRAL_URL=https://greenreachgreens.com
GREENREACH_API_KEY=<paste-your-api-key-here>

# Save: Ctrl+O, Enter
# Exit: Ctrl+X
```

**Example final configuration:**
```bash
# Demo Mode - DISABLED for production
DEMO_MODE=false

# Edge Device Configuration
EDGE_MODE=true
FARM_ID=FARM-MKLOMAT3-A9D8
GREENREACH_CENTRAL_URL=https://greenreachgreens.com
GREENREACH_API_KEY=grc_farm_mklomat3_a1b2c3d4e5f6789012345678901234567890abcd

# ... other existing variables ...
```

### Step 6: Verify Configuration

```bash
# Check that all variables are set correctly
cat .env | grep -E "DEMO_MODE|EDGE_MODE|GREENREACH|FARM_ID"

# Should show:
# DEMO_MODE=false
# EDGE_MODE=true
# FARM_ID=FARM-MKLOMAT3-A9D8
# GREENREACH_CENTRAL_URL=https://greenreachgreens.com
# GREENREACH_API_KEY=grc_farm_...
```

### Step 7: Restart Services

```bash
# Restart all PM2 services to load new .env
pm2 restart all

# Wait 5 seconds for services to start
sleep 5

# Check service status
pm2 list
```

**Expected Output:**
```
┌─────┬────────────────────┬─────────┬─────────┐
│ id  │ name               │ status  │ restart │
├─────┼────────────────────┼─────────┼─────────┤
│ 0   │ lightengine-node   │ online  │ 24      │
│ 1   │ lightengine-fastapi│ online  │ 2       │
└─────┴────────────────────┴─────────┴─────────┘
```

### Step 8: Verify Edge Mode Enabled

```bash
# Check edge status via API
curl -sS http://localhost:8091/api/edge/status | jq '.'

# Or if jq not installed:
curl -sS http://localhost:8091/api/edge/status | python3 -m json.tool
```

**Expected Output:**
```json
{
  "mode": "edge",
  "registered": true,
  "farmId": "FARM-MKLOMAT3-A9D8",
  "farmName": "Big Green Farm",
  "centralApiUrl": "https://greenreachgreens.com",
  "syncEnabled": true,          // ✅ MUST BE TRUE
  "offlineMode": false,
  "lastSync": "2026-01-31T...",
  "queueSize": 0
}
```

🚨 **CRITICAL CHECK:** `syncEnabled` MUST be `true`

### Step 9: Verify Demo Mode Disabled

```bash
# Check health endpoint
curl -sS http://localhost:8091/health | jq '.demo_mode'

# Should return: false or null (not true)
```

### Step 10: Test Sync to Central

```bash
# Trigger manual sync
curl -sS -X POST http://localhost:8091/api/edge/sync/manual | jq '.'

# Expected output:
# {
#   "success": true,
#   "synced": {
#     "rooms": true,
#     "groups": true,
#     "schedules": true,
#     "inventory": true,
#     "telemetry": true
#   }
# }
```

### Step 11: Check Sync Logs

```bash
# View recent logs
pm2 logs lightengine-node --lines 50 --nostream

# Look for sync success messages:
# [EdgeMode] ✓ Sync service started
# [Sync] Syncing rooms to central...
# [Sync] Successfully synced 2 rooms
# [Sync] Syncing groups to central...
# [Sync] Successfully synced 8 groups
```

### Step 12: Verify Data Reached Central

**On your Mac (or any browser):**

1. Open https://greenreachgreens.com/GR-central-admin.html
2. Log in with admin credentials
3. Navigate to Farms list
4. Find "Big Green Farm (FARM-MKLOMAT3-A9D8)"
5. **Verify KPIs show data:**
   - Rooms: Should show > 0
   - Zones: Should show > 0
   - Devices: Should show > 0
   - Trays: Should show > 0

**Or test via API:**
```bash
# From your Mac
curl -sS https://greenreachgreens.com/api/admin/farms/FARM-MKLOMAT3-A9D8 \
  -H "Authorization: Bearer <your-admin-token>" | jq '.'
```

---

## Troubleshooting

### Issue: `syncEnabled: false`

**Cause:** Missing or invalid configuration

**Fix:**
```bash
# Check each variable individually
echo "EDGE_MODE: $(grep EDGE_MODE .env)"
echo "FARM_ID: $(grep FARM_ID .env)"
echo "CENTRAL_URL: $(grep GREENREACH_CENTRAL_URL .env)"
echo "API_KEY: $(grep GREENREACH_API_KEY .env | cut -c1-50)..."

# Ensure no extra spaces or quotes
# Variables should be: KEY=value (no spaces, no quotes)
```

### Issue: Sync fails with "Invalid API key"

**Cause:** API key not in Central database or wrong format

**Fix:**
```bash
# Verify API key format (should start with grc_farm_)
echo $GREENREACH_API_KEY | grep "^grc_farm_"

# If wrong format, regenerate in Central database
```

### Issue: Sync fails with "Connection refused"

**Cause:** Central server unreachable or wrong URL

**Fix:**
```bash
# Test Central reachability from reTerminal
curl -sS https://greenreachgreens.com/health

# Should return: {"status":"healthy",...}

# If fails, check network/firewall
ping -c 3 greenreachgreens.com
```

### Issue: Demo data still showing

**Cause:** DEMO_MODE not properly disabled or cache

**Fix:**
```bash
# Confirm DEMO_MODE is false
grep DEMO_MODE .env

# Clear any cached data
rm -rf ~/Light-Engine-Foxtrot/data/cache/* 2>/dev/null

# Force restart
pm2 kill
pm2 resurrect
```

### Issue: Services not starting

**Cause:** Syntax error in .env or missing dependencies

**Fix:**
```bash
# Check PM2 error logs
pm2 logs --err --lines 100

# Validate .env syntax (no trailing spaces)
cat -A .env | tail -20

# Restart with fresh state
pm2 delete all
pm2 start ecosystem.config.js
```

---

## Verification Checklist

After completing configuration, verify:

- [ ] DEMO_MODE=false in .env
- [ ] EDGE_MODE=true in .env
- [ ] FARM_ID set correctly
- [ ] GREENREACH_CENTRAL_URL set correctly
- [ ] GREENREACH_API_KEY generated and set
- [ ] PM2 services running (both online)
- [ ] /api/edge/status shows syncEnabled: true
- [ ] Manual sync succeeds
- [ ] Central dashboard shows farm data (rooms, zones, devices)
- [ ] No demo data visible in farm dashboard
- [ ] Telemetry syncing every 30 seconds (check logs)

---

## Post-Configuration Monitoring

### Watch Sync Activity (First 5 Minutes)

```bash
# Tail logs in real-time
pm2 logs lightengine-node | grep -i sync

# You should see every 30-60 seconds:
# [Sync] Starting periodic sync...
# [Sync] Successfully synced telemetry
# [Sync] Successfully synced rooms
```

### Check Sync Queue

```bash
# View sync queue status
curl -sS http://localhost:8091/api/edge/queue | jq '.'

# Healthy state:
# {
#   "pending": 0,
#   "failed": 0,
#   "lastSync": "2026-01-31T22:30:15.123Z"
# }
```

### If Sync Queue Backs Up

```bash
# Clear failed items and retry
curl -sS -X POST http://localhost:8091/api/edge/queue/clear | jq '.'

# Trigger manual sync
curl -sS -X POST http://localhost:8091/api/edge/sync/manual | jq '.'
```

---

## Success Criteria

✅ **Configuration is successful when:**

1. `curl http://localhost:8091/api/edge/status` shows `"syncEnabled": true`
2. PM2 logs show successful sync messages every 30-60 seconds
3. GreenReach Central dashboard displays farm data (not "0" or "No data")
4. Farm dashboard shows real data (not demo data)
5. Environmental sensor data updates in Central every 30 seconds

---

## Quick Reference Commands

```bash
# View current config
cat .env | grep -E "DEMO_MODE|EDGE_MODE|GREENREACH|FARM_ID"

# Restart services
pm2 restart all && sleep 5 && pm2 list

# Check edge status
curl -sS http://localhost:8091/api/edge/status | jq '.'

# Trigger manual sync
curl -sS -X POST http://localhost:8091/api/edge/sync/manual | jq '.'

# Watch logs
pm2 logs lightengine-node --lines 20

# Check queue
curl -sS http://localhost:8091/api/edge/queue | jq '.'
```

---

## Support

If issues persist after following this guide:

1. Capture logs: `pm2 logs lightengine-node --lines 200 > /tmp/edge-logs.txt`
2. Capture config: `cat .env | grep -v PASSWORD > /tmp/edge-config.txt`
3. Capture status: `curl -sS http://localhost:8091/api/edge/status > /tmp/edge-status.json`
4. Share these files for troubleshooting

---

**Configuration prepared by:** AI Agent  
**Based on:** GREENREACH_CENTRAL_LAUNCH_READINESS_2026-01-31.md  
**Target device:** reTerminal (192.168.2.222) via VNC  
**Estimated time:** 15-20 minutes
