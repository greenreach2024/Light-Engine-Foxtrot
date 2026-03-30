# ⚡ Quick Fix - Update API Key on reTerminal
**Issue:** Current API key is invalid format (not 64 hex characters)  
**Fix Time:** 2 minutes

---

## Via VNC on reTerminal:

### 1. Edit .env file:
```bash
cd ~/Light-Engine-Foxtrot
nano .env
```

### 2. Find this line (around line 5):
```bash
GREENREACH_API_KEY=b0bc5dbb5cc038533141651efc52df3f5de5c4570b14c7e13abf124f17b3>
```

### 3. Replace with:
```bash
GREENREACH_API_KEY=ae61e0c94acc6c2f6611f2864902dfe8085d18c6aa4b975b33a10b3d6a0e9b3b
```

### 4. Save and exit:
- Press `Ctrl+O` (save)
- Press `Enter` (confirm)
- Press `Ctrl+X` (exit)

### 5. Restart services:
```bash
pm2 restart all
```

### 6. Verify sync is working:
```bash
# Check sync status (wait 10 seconds after restart)
sleep 10
curl http://localhost:8091/api/edge/status | jq '.syncEnabled'
```

**Expected:** `true`

### 7. Watch sync logs:
```bash
pm2 logs lightengine-node --lines 20
```

**Look for:**
- `[Sync] Successfully synced rooms`
- `[Sync] Successfully synced groups`
- `[Sync] Successfully synced telemetry`

---

## Verification:

After 1-2 minutes, check GreenReach Central:
1. Visit: https://greenreachgreens.com/GR-central-admin.html
2. Navigate to Farms
3. You should see "Big Green Farm (FARM-MKLOMAT3-A9D8)" appear
4. Status should be "online"
5. KPIs should show non-zero values

---

## Current Configuration Status:

✅ **Already Correct:**
- DEMO_MODE=false
- EDGE_MODE=true
- FARM_ID=FARM-MKLOMAT3-A9D8
- GREENREACH_CENTRAL_URL=https://greenreachgreens.com

❌ **Needs Update:**
- GREENREACH_API_KEY (wrong format, needs 64 hex chars)

---

**That's it!** Just update the one API key line and restart. The farm will auto-register on first heartbeat.
