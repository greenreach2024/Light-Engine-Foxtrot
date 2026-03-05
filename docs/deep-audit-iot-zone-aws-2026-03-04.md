# Deep Audit Report — IoT Devices, Zone Assignment, and AWS Update Path

**Date:** 2026-03-04
**Scope requested:** Deep audit of chat-history outcomes, communication documentation, actual updated files, and why recent updates appear not to be taking effect.
**Important constraint:** Report-first, no additional corrective deployment in this audit.

---

## 1) Executive Summary

The update attempts were real and substantial, but there is **architecture drift** between documentation and current runtime:

1. Most IoT/zone fixes were correctly made in `public/app.foxtrot.js` and deployed.
2. The communication doc is now partially outdated: it states `public/js/iot-manager.js` is not loaded, but `LE-dashboard.html` currently includes it.
3. The reported `401 /devices` likely comes from page-specific code paths outside the main `app.foxtrot.js` flow (notably `LE-switchbot.html`) and/or authenticated calls returning unauthorized.
4. The reported `cheo-mascot.svg` 404 conflicts with current AWS endpoint checks (returns HTTP 200), indicating either stale client runtime, different page origin/path, or service worker/browser cache effects.
5. There are uncommitted local edits (`public/LE-switchbot.html`, `docs/iot-device-communication-paths.md`) not yet part of a deployed commit.

---

## 2) Evidence Reviewed

### A. Recent commit chronology

Recent commits show repeated IoT/zone work in `public/app.foxtrot.js` and server/persistence hooks:
- `397fcb7` — persistence across deploys (`server-foxtrot.js`, EB hooks)
- `3228624` — zone dropdown resilience (`public/app.foxtrot.js`)
- `92946e8` — localStorage/cache-busting + communication report
- `8bf3650` — zone fallback + hosted-ui console error suppression

### B. Current local working tree

`git status --short` shows:
- `M docs/iot-device-communication-paths.md`
- `M public/LE-switchbot.html`

This confirms local changes exist that are not yet baseline-clean.

### C. Runtime script-loading audit

#### `public/LE-farm-admin.html`
Loads `farm-admin.js`; does **not** load `app.foxtrot.js`.

#### `public/LE-dashboard.html`
Loads:
- `/app.foxtrot.js?v=20260302-prodroot-fix`
- `/groups-v2.js?v=20260302-prodroot-fix`
- `/js/iot-manager.js?v={{BUILD_TIME}}`

This is a critical finding because the existing communication doc currently says `iot-manager.js` is not loaded.

#### `public/LE-switchbot.html`
Contains page-local device metadata logic that calls `/devices` directly (see section 3).

### D. Documentation drift audit

`docs/iot-device-communication-paths.md` currently says:
- "Files NOT currently loaded: `public/js/iot-manager.js`"

This is no longer accurate with current `LE-dashboard.html`.

### E. EB packaging rules audit (`.ebignore`)

Notable exclusions:
- `docs/` excluded from deploy (documentation updates do not affect runtime)
- `greenreach-central/` excluded from deploy (changes there do not reach this app)
- selective image exclusions (`public/images/*.jpeg`, etc.)

---

## 3) Root-Cause Findings for Reported Errors

### Error 1: Zone dropdown still showing hardcoded Zone 1–9

**Findings:**
- Main fix logic exists in `public/app.foxtrot.js` (room/zone merge fallbacks and lazy refresh).
- However, runtime can still fall back to 1–9 if room objects available at render-time have no zones and no successful merge source is found.
- Documentation and runtime architecture changed over time, increasing uncertainty about which renderer is actively controlling specific card instances.

**Most probable causes:**
1. User is in a page/flow not controlled solely by the patched card renderer.
2. Cached frontend bundle still in use (`app.foxtrot.js` query version string remained fixed).
3. Room data shape/availability timing mismatch still occurs in specific flows.

### Error 2: `401 /devices`

**Findings:**
- `public/LE-switchbot.html` contains direct `fetch('/devices')` call in `fetchDeviceMetadata()`.
- `public/app.foxtrot.js` also has `/devices` call in `loadAllData()` when token is present.

**Interpretation:**
- Even with partial suppression in one path, other page-specific paths can still trigger `401`.
- This explains why user still sees `/devices` unauthorized despite prior fixes in `app.foxtrot.js`.

### Error 3: `404 cheo-mascot.svg`

**Findings:**
- References exist in:
  - `public/js/farm-assistant.js`
  - `public/firebase-messaging-sw.js`
- AWS direct check for `/images/cheo-mascot.svg` currently returns 200.

**Interpretation:**
- 404 may be from stale browser runtime, different host/path context, or an older worker/page artifact, not necessarily current file absence on AWS.

---

## 4) Why “many updates” can appear to have no effect

1. **Entry-point mismatch:** fixes applied in one script while user triggers another page/script path.
2. **Runtime drift vs documentation:** communication doc assumptions no longer match current script inclusion.
3. **Multiple API paths:** `/devices`, `/iot/devices`, `/data/iot-devices.json`, `/discovery/devices` coexist, causing inconsistent behavior by page.
4. **Caching/versioning:** `app.foxtrot.js` URL version parameter is static (`v=20260302-prodroot-fix`), enabling stale client execution windows.
5. **Excluded folders in deployment:** updates in excluded paths (like `docs/`, `greenreach-central/`) do not change AWS runtime.

---

## 5) Files Most Relevant to Current Runtime (High Priority)

1. `public/LE-dashboard.html` (actual script inclusion source)
2. `public/app.foxtrot.js` (main IoT + zone logic)
3. `public/LE-switchbot.html` (separate `/devices` metadata path)
4. `public/js/farm-assistant.js` (mascot image usage)
5. `public/firebase-messaging-sw.js` (mascot icon path in notifications)
6. `server-foxtrot.js` (`/data/:name`, static routes, redirects)
7. `.ebignore` (what deploys and what doesn’t)

---

## 6) Pre-Correction Action Plan (for approval)

No corrective code changes are applied in this report step. Recommended next changes after approval:

1. **Unify device metadata endpoint usage** across `LE-switchbot.html` and `app.foxtrot.js` (single auth-aware strategy).
2. **Update communication documentation** to reflect actual loaded scripts and conflict-risk paths.
3. **Bump frontend cache version keys** in HTML script URLs to force client pickup of deployed changes.
4. **Add runtime diagnostics banner/logging** showing active script versions and selected API paths.
5. **Run end-to-end path test matrix** per page (`LE-farm-admin` iframe dashboard, `LE-dashboard`, `LE-switchbot`).

---

## 7) Audit Conclusion

The issue is not “no updates were made.” Updates were made and deployed, but behavior remains inconsistent because runtime paths are split across multiple pages/scripts and documentation no longer matches active script loading. A coordinated endpoint + entrypoint alignment pass is required.
