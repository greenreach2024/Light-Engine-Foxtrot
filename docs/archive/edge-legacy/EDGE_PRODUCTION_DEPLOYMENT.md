# Edge Device Production Deployment Guide

**Phase 3: Single Config Source & Production Build**

## Configuration Management

### ✅ Single Source of Truth: `config/edge-config.json`

**Authoritative Configuration File:**
```json
{
  "mode": "edge",
  "farmId": "FARM-XXXX-XXXX",
  "farmName": "Your Farm Name",
  "apiKey": "your-64-char-api-key",
  "centralApiUrl": "https://greenreachgreens.com",
  "syncInterval": 300000,
  "heartbeatInterval": 30000,
  "syncEnabled": true,
  "registrationComplete": true
}
```

### ⚠️ Deprecated: .env FARM_ID

**DO NOT use `FARM_ID` in .env** - This creates dual config sources and can cause conflicts.

**Migration:**
```bash
# ❌ OLD (deprecated)
FARM_ID=FARM-MKLOMAT3-A9D8

# ✅ NEW (use edge-config.json instead)
# Remove FARM_ID from .env
```

**Still Required in .env:**
- `PRODUCTION_MODE=true` - Enables production validation
- `DEMO_MODE=false` - Disables demo data
- API keys and credentials (GREENREACH_API_KEY, etc.)

## Production Build Process

### Step 1: Run Production Build Script

```bash
cd ~/Light-Engine-Foxtrot
./scripts/production-build.sh
```

**This script:**
- ✅ Removes demo data files (demo-farm-data.json, wholesale-demo-catalog.json)
- ✅ Validates edge-config.json exists and has valid farmId
- ✅ Checks for demo farm IDs (GR-00001, LOCAL-FARM, DEMO-FARM)
- ✅ Warns about .env conflicts
- ✅ Verifies PRODUCTION_MODE=true

**Expected Output:**
```
=========================================
Production Build - Phase 3
=========================================

Removing demo data files...
  ✓ Removed public/data/demo-farm-data.json
  ✓ Removed docs/data/demo-farm-data.json
  ✓ Removed public/data/wholesale-demo-catalog.json

Removed 3 demo files

Validating config sources...
  ✓ edge-config.json farmId: FARM-MKLOMAT3-A9D8
  ✓ No demo farm IDs detected
  ✓ PRODUCTION_MODE=true in .env

=========================================
Production Build Complete
=========================================
Farm ID: FARM-MKLOMAT3-A9D8
Demo files removed: 3
Ready for deployment
```

### Step 2: Deploy to Edge Device

**Option A: Direct Deployment**
```bash
# Copy production build to Edge device
rsync -avz --exclude node_modules --exclude .git ~/Light-Engine-Foxtrot/ greenreach@100.65.187.59:~/Light-Engine-Foxtrot/

# Restart Edge server
ssh greenreach@100.65.187.59 "pm2 restart lightengine-node"
```

**Option B: Git Pull (if git configured)**
```bash
ssh greenreach@100.65.187.59
cd ~/Light-Engine-Foxtrot
git pull origin main
pm2 restart lightengine-node
```

### Step 3: Verify Production Deployment

**Check startup validation:**
```bash
ssh greenreach@100.65.187.59 'pm2 logs lightengine-node --lines 50 --nostream' | grep Startup
```

**Expected logs:**
```
[Startup] ✅ Production mode validated - Farm ID: FARM-MKLOMAT3-A9D8
```

**If dual config warning appears:**
```
[Startup] ⚠️  WARNING: .env FARM_ID (XXXXX) differs from edge-config.json (YYYYY)
[Startup] ⚠️  Using edge-config.json as authoritative source
```
**Action:** Remove `FARM_ID=` line from .env file

**Verify demo files are gone:**
```bash
ssh greenreach@100.65.187.59 "ls ~/Light-Engine-Foxtrot/public/data/demo*.json 2>/dev/null"
# Should return: No such file or directory
```

**Verify production data:**
```bash
curl -s http://100.65.187.59:8091/data/groups.json | jq '{groupCount: (.groups | length), firstGroup: .groups[0].name}'
```

## Backup & Recovery System

### Automated Daily Backups

**Cron job (runs at 2 AM daily):**
```bash
crontab -l | grep backup
# 0 2 * * * /home/greenreach/Light-Engine-Foxtrot/scripts/backup-edge-data.sh >> ~/Light-Engine-Foxtrot/logs/edge-backup.log 2>&1
```

**Check backup logs:**
```bash
tail -50 ~/Light-Engine-Foxtrot/logs/edge-backup.log
```

### Manual Backup

```bash
cd ~/Light-Engine-Foxtrot
./scripts/backup-edge-data.sh
```

### Recovery from Central Backup

**If Edge device fails or loses data:**
```bash
cd ~/Light-Engine-Foxtrot
./scripts/restore-from-central.sh FARM-MKLOMAT3-A9D8
```

**Recovery creates automatic backup before restore:**
- Original data saved to: `~/Light-Engine-Foxtrot/backups/YYYYMMDD-HHMMSS/`

## Security Validation

### Phase 1: Demo Data Protection ✅

**9 vulnerable endpoints secured:**
- `/data/farm.json` - Returns `next()` if DEMO_MODE=false
- `/data/rooms.json` - Uses actual Edge data, not demo
- `/data/iot-devices.json` - Uses actual Edge data
- `/data/groups.json` - Uses actual Edge data
- `/data/ctrl-map.json` - Returns `next()` if DEMO_MODE=false
- `/data/equipment.json` - Returns `next()` if DEMO_MODE=false
- `/data/equipment-metadata.json` - Returns `next()` if DEMO_MODE=false
- `/data/room-map.json` - Uses actual Edge data
- `/data/devices.cache.json` - Returns `next()` if DEMO_MODE=false

**Startup validation:**
- Rejects demo farm IDs: GR-00001, LOCAL-FARM, DEMO-FARM
- Exits with error if demo farm detected in PRODUCTION_MODE

### Phase 2: Durable Backup System ✅

**Central persistent storage:**
- PostgreSQL `farm_backups` table
- Daily automated backups to Central
- Recovery endpoint: POST /api/sync/restore/:farmId

### Phase 3: Build Cleanup ✅

**Production build validation:**
- Demo files removed from builds
- Config source consolidated to edge-config.json
- Startup warnings for config conflicts

## Troubleshooting

### Issue: "Demo farm ID not allowed in PRODUCTION_MODE"

**Cause:** edge-config.json has demo farm ID (GR-00001, LOCAL-FARM, or DEMO-FARM)

**Fix:**
```bash
# Edit edge-config.json
nano ~/Light-Engine-Foxtrot/config/edge-config.json

# Change farmId to production ID:
"farmId": "FARM-MKLOMAT3-A9D8"

# Restart
pm2 restart lightengine-node
```

### Issue: "WARNING: .env FARM_ID differs from edge-config.json"

**Cause:** Dual config sources (deprecated .env FARM_ID)

**Fix:**
```bash
# Edit .env and remove FARM_ID line
nano ~/Light-Engine-Foxtrot/.env

# Remove or comment out:
# FARM_ID=XXXX

# Restart
pm2 restart lightengine-node
```

### Issue: Demo data appearing in production

**Cause:** Demo files not removed from build

**Fix:**
```bash
cd ~/Light-Engine-Foxtrot
./scripts/production-build.sh
pm2 restart lightengine-node
```

### Issue: Backup script failing

**Check logs:**
```bash
tail -100 ~/Light-Engine-Foxtrot/logs/edge-backup.log
```

**Common fixes:**
- Verify Central API URL: Check `GREENREACH_CENTRAL_URL` in .env
- Verify API key: Check `GREENREACH_API_KEY` in .env
- Test Central connectivity: `curl https://greenreachgreens.com/health`

## Configuration Checklist

**Before production deployment:**
- [ ] edge-config.json has production farm ID (not GR-00001)
- [ ] .env has PRODUCTION_MODE=true
- [ ] .env has DEMO_MODE=false
- [ ] .env does NOT have FARM_ID= line
- [ ] Run `./scripts/production-build.sh` successfully
- [ ] Demo files removed (no demo-farm-data.json)
- [ ] Backup cron job configured
- [ ] Central backup tested with `./scripts/restore-from-central.sh`

**After deployment:**
- [ ] Server starts without errors
- [ ] Startup log shows: "✅ Production mode validated"
- [ ] No demo farm warnings in logs
- [ ] Production data served (not demo groups)
- [ ] Backup script runs successfully
- [ ] Recovery script tested successfully

## Support

**Edge Device Status:**
```bash
ssh greenreach@100.65.187.59 "pm2 status"
```

**View Logs:**
```bash
ssh greenreach@100.65.187.59 "pm2 logs lightengine-node --lines 100"
```

**Farm Data:**
- Groups: `http://100.65.187.59:8091/data/groups.json`
- Farm: `http://100.65.187.59:8091/data/farm.json`
- Rooms: `http://100.65.187.59:8091/data/rooms.json`

**Central Backup Status:**
```bash
# Check latest backup
curl -sS -X POST "https://greenreachgreens.com/api/sync/restore/FARM-MKLOMAT3-A9D8" \
  -H "X-API-Key: YOUR_API_KEY" \
  -H "X-Farm-ID: FARM-MKLOMAT3-A9D8" | jq '.backup_info'
```
