# Edge Device Recovery - February 1, 2026

## Incident Summary

**Issue**: Edge device dashboard completely broken after fs/promises import change
**Impact**: Room setup, groups, plans, and all file-based data not loading
**Root Cause**: Two critical issues
1. Changed `import fs from "fs"` to `import fs from "fs/promises"` breaking all synchronous file operations
2. Missing 7 lib files on edge device after code updates

## Timeline

### Initial Problem (Commit af4fc6e)
- Changed `import fs from "fs"` to `import fs from "fs/promises"` in server-foxtrot.js
- This removed access to synchronous methods: `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync`
- Affected 20+ critical file operations throughout the codebase
- Dashboard failed to load rooms, groups, plans, schedules, recipes

### First Fix Attempt (Commit 75e16ef)
- Changed to import both: `import fs from "fs"` and `import fsPromises from "fs/promises"`
- Deployed via SCP (git pull failed - no GitHub credentials on edge device)
- Server failed to start due to missing module errors

### Missing Files Discovered
The edge device was missing these lib files:
1. `device-discovery.js` (8.4KB)
2. `harvest-predictor.js` (11KB)
3. `adaptive-control.js` (8.6KB)
4. `adaptive-vpd.js` (14KB)
5. `anomaly-diagnostics.js` (17KB)
6. `schema-validator.js` (8.9KB)
7. `succession-planner.js` (24KB)

### Resolution
1. Copied all missing lib files to edge device via SCP
2. Restarted lightengine-node process (PM2 ID 1)
3. Verified all endpoints working correctly

## Verification Tests

✅ Health endpoint: `http://100.65.187.59:8091/health` returns "healthy"
✅ Rooms data: `http://100.65.187.59:8091/data/rooms.json` returns room configuration
✅ Groups data: `http://100.65.187.59:8091/data/groups.json` returns 1 group
✅ Groups API: `http://100.65.187.59:8091/api/groups` returns group details
✅ Server status: PM2 shows lightengine-node online (PID 616966)

## Key Learnings

1. **File System Module Imports**: Never change `import fs from "fs"` to `import fs from "fs/promises"` when code uses synchronous operations
2. **Edge Device Deployment**: Git pull doesn't work on edge device (no GitHub credentials). Use SCP for file transfers
3. **Module Dependencies**: Always check for missing lib files when deploying to edge device
4. **Dashboard Endpoints**: Dashboard uses `/data/rooms.json`, not `/api/rooms`

## Code Changes

### server-foxtrot.js Line 44-45
```javascript
// CORRECT (maintains backward compatibility)
import fs from "fs";                    // For synchronous operations
import fsPromises from "fs/promises";   // For async operations

// WRONG (breaks synchronous operations)
import fs from "fs/promises";
```

### Synchronous File Operations (20+ locations)
- `fs.existsSync()` - Check if file exists before reading
- `fs.readFileSync()` - Load configuration files synchronously
- `fs.writeFileSync()` - Save configuration files synchronously

### Async File Operations (1 location)
- `fsPromises.readFile()` - Line 18705: Read farm.json in PATCH /api/config/farm-metadata
- `fsPromises.writeFile()` - Line 18724: Write farm.json in PATCH /api/config/farm-metadata

## Network Configuration

**Edge Device (Big Green Farm)**
- Tailscale IP: 100.65.187.59
- Port: 8091
- SSH: greenreach@100.65.187.59 (password: Farms2024)
- PM2 Process: lightengine-node (ID 1)

**Central Server**
- Tailscale IP: 100.86.76.16
- Production: greenreach-central-prod-lb.us-east-1.elasticbeanstalk.com
- Database: farm api_url updated to Tailscale IP

## Prevention Measures

1. **Before Deploying to Edge Device**
   - Run: `diff <(ssh greenreach@100.65.187.59 "ls -1 ~/Light-Engine-Foxtrot/lib/") <(ls -1 lib/)`
   - Copy any missing files: `scp lib/missing-file.js greenreach@100.65.187.59:~/Light-Engine-Foxtrot/lib/`

2. **Testing File Operations**
   - Always test endpoints that read from data files after deployment
   - Check PM2 logs for module errors: `pm2 logs lightengine-node --lines 50`

3. **Code Review Checklist**
   - Never change `fs` import to `fs/promises` without checking all usage
   - Search for `fs.readFileSync`, `fs.writeFileSync`, `fs.existsSync` before modifying imports
   - Use `fsPromises` for new async operations only

## Status: ✅ RESOLVED

All dashboard functionality restored:
- Room setup loading zones and groups ✅
- Room mapper loading saved rooms ✅
- Groups v2 loading saved groups ✅
- Plans and schedules accessible ✅

Edge device is now fully operational and serving data correctly to local dashboard and GreenReach Central.
