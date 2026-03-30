# EB v4 Deployment Root Mismatch Resolution

**Date:** February 3, 2026
**Environment:** `greenreach-central-prod-v4`
**Status:** In Progress - Debugging

## Problem Summary

v4 environment failing to start with 502 Bad Gateway due to deployment structure mismatch.

## Root Cause Analysis

### Issue #1: Deployment Root Mismatch (RESOLVED)
- **Problem:** Entire repo was deployed with `greenreach-central/` as subdirectory
- **Symptom:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'cors'`
- **Root Cause:** Procfile at repo root ran `node greenreach-central/server.js`, but node_modules installed at repo root, not in greenreach-central/
- **Solution:** Deploy only `greenreach-central/` directory contents
- **Status:** ✅ FIXED

### Issue #2: setup-wizard.js Path Error (RESOLVED)
- **Problem:** After fixing deployment structure, app crashed with `Cannot find module '/var/app/routes/setup-wizard.js'`
- **Root Cause:** `server.js` imported setup-wizard from `../routes/setup-wizard.js` (repo root), but now deploying only greenreach-central/
- **Solution:** Copied `routes/setup-wizard.js` → `greenreach-central/routes/setup-wizard.js` and updated import
- **Status:** ✅ FIXED

### Issue #3: Additional Module Dependency (INVESTIGATING)
- **Current Status:** Still getting 502 after setup-wizard fix
- **Next Steps:** Check latest logs for remaining import errors

## Directory Structure

### Before Fix (Incorrect):
```
/var/app/current/
├── greenreach-central/
│   ├── server.js
│   ├── routes/
│   └── (no node_modules here)
├── node_modules/  ← installed here
└── Procfile (runs greenreach-central/server.js)
```

### After Fix (Correct):
```
/var/app/current/
├── server.js
├── routes/
│   └── setup-wizard.js  ← moved here
├── node_modules/  ← installed here
└── Procfile (runs npm start → node server.js)
```

## Deployment History

| Version Label | Issue | Result |
|--------------|-------|--------|
| `cad-renderer-a35edd2-260203_075742` | Missing cors package | ❌ 502 |
| `root-dir-fix-d16b9ea-260203_122956` | Tried RootDirectory config | ❌ 502 (didn't work) |
| `procfile-fix-1189562-260203_123244` | Changed Procfile to cd greenreach-central | ❌ 502 (ebextensions not processed) |
| `greenreach-only-1189562-260203_123718` | Deploy greenreach-central/ only | ❌ 502 (setup-wizard path error) |
| `setup-wizard-fix-24477b3-260203_124230` | Moved setup-wizard into greenreach-central | ⏳ Testing |

## Key Learnings

1. **EB only processes `.ebextensions` from application root**, not subdirectories
2. **`git archive` with `--prefix=""` and `HEAD:subdirectory` deploys only that subdirectory**
3. **Dynamic ESM imports** with relative paths break when deployment structure changes
4. **Path resolution in ESM** requires careful handling when moving from monorepo to standalone deployment

## Next Actions

1. ✅ Check latest logs for remaining errors
2. ⏳ Fix any remaining import path issues
3. ⏳ Set DB environment variables once app boots successfully
4. ⏳ Verify `/health` endpoint returns 200 with `databaseReady: true`

## Target State

- **Environment:** Ready, Green, Ok
- **Health Endpoint:** `HTTP 200` with `{"databaseReady": true, ...}`
- **Architecture:** greenreach-central deployed standalone (not as subdirectory)
