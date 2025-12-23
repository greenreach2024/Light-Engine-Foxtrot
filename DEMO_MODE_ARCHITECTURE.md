# Demo Mode Architecture Review

## Current Status

Demo mode is **ACTIVE** across the application. Demo data is initialized automatically in 7 backend modules.

## Demo Data Sources (Single Source of Truth)

### Backend: `backend/demo_config.py` ✓ NEW
- **Master control**: `ENABLE_DEMO_DATA` and `DEMO_MODE` environment variables
- **Purpose**: Centralized configuration for all demo data
- **Production**: Set `ENABLE_DEMO_DATA=false` to disable ALL demo data

### Backend Modules with Demo Data

| Module | Demo Data | Line | Control |
|--------|-----------|------|---------|
| `inventory_management.py` | Seeds, nutrients, packaging, equipment, supplies | 354 | ✓ Now uses demo_config |
| `batch_traceability.py` | Traceability batches and events | 87 | Needs update |
| `production_planning.py` | Production plans and forecasts | 133 | Needs update |
| `quality_control.py` | QA checkpoints | 153 | Needs update |
| `network_dashboard.py` | Farm network data | 45 | Needs update |
| `sustainability_esg.py` | Carbon footprint, energy, water | 203, 295 | Needs update |
| `grower_management.py` | Grower network | 375 | Needs update |

### Frontend Demo Detection

Different pages use different demo detection methods (NOT unified):

1. **URL Parameter Method**:
   - `farm-sales.html` (line 914): `?demo=1` or default true
   - `farm-store.html` (line 805): `?demo=1` or default true
   - `wholesale.js` (line 34-36): `?demo=1` explicit

2. **window.DEMO_MODE Method**:
   - `app.foxtrot.js` (line 6202): Checks `window.DEMO_MODE`
   - Some pages expect this to be set by server

3. **No Demo Detection**:
   - `admin.html` - Uses hardcoded values in HTML
   - `farm-admin.html` - Makes API calls, expects backend to return data

---

## Pages Not Populating in Demo Mode

### Problem Analysis

#### 1. **farm-admin.html** - May not populate properly
**Issue**: Makes many API calls but doesn't check demo mode:
- `/api/traceability/*` - Calls Python backend
- `/api/inventory/*` - Calls Python backend  
- `/api/planning/*` - Calls Python backend

**Root Cause**: 
- Python backend requires running: `python3 -m backend`
- If backend not running, all API calls fail → empty pages
- No fallback demo data in frontend

**Solution**:
```html
<!-- farm-admin.html needs to detect if backend is down -->
<script>
const BACKEND_AVAILABLE = await checkBackendHealth();
if (!BACKEND_AVAILABLE && isDemoMode()) {
    loadFrontendDemoData(); // Fallback to client-side demo data
}
</script>
```

#### 2. **admin.html** - Uses hardcoded demo data
**Status**: ✓ Working (all data is hardcoded in HTML, no API calls)

#### 3. **wholesale.html** - Mixed approach
**Issue**: Calls `/api/wholesale/*` endpoints
- Some endpoints exist in Node server (server-foxtrot.js)
- Others expect Python backend
- Inconsistent availability

#### 4. **Tray Inventory** (views/tray-inventory.html)
**Issue**: Calls `/api/inventory/trays/*` endpoints
- Requires Python backend
- No demo mode detection or fallback

---

## Recommended Architecture

### Single Source of Truth Approach

```
┌─────────────────────────────────────┐
│   Environment Variable              │
│   ENABLE_DEMO_DATA=true/false       │
└──────────────┬──────────────────────┘
               │
       ┌───────┴───────┐
       │               │
   ┌───▼────┐     ┌────▼────┐
   │ Node   │     │ Python  │
   │ Server │     │ Backend │
   └───┬────┘     └────┬────┘
       │               │
       │    ┌──────────┴─────────────┐
       │    │ backend/demo_config.py │
       │    │ - Master control       │
       │    │ - All modules check    │
       │    │   should_use_demo_data()│
       │    └────────────────────────┘
       │
   ┌───▼────────────────────────────┐
   │ All frontend pages check:     │
   │ 1. /api/config/demo-mode      │
   │ 2. window.DEMO_MODE           │
   │ 3. Fallback to client data    │
   └────────────────────────────────┘
```

### Implementation Plan

1. **Backend** (Python):
   - ✓ Created `backend/demo_config.py`
   - ✓ Updated `inventory_management.py` to use it
   - TODO: Update 6 other modules to use `demo_config.py`

2. **Backend** (Node):
   - TODO: Create `/api/config/demo-mode` endpoint
   - Returns: `{ demoMode: true/false, backend: "running/stopped" }`

3. **Frontend**:
   - TODO: Create shared `demo-detector.js` utility
   - All pages import and use same detection method
   - Provides fallback demo data if backend unavailable

---

## Quick Fixes for Empty Pages

### For farm-admin.html (Most Critical)

```javascript
// Add at top of page
async function initializeDemoMode() {
    try {
        const response = await fetch('/api/config/demo-mode');
        const config = await response.json();
        window.DEMO_MODE = config.demoMode;
        window.BACKEND_AVAILABLE = config.backend === 'running';
    } catch (error) {
        // Backend not responding - use demo mode
        window.DEMO_MODE = true;
        window.BACKEND_AVAILABLE = false;
        console.warn('[Demo] Backend unavailable, using client-side demo data');
    }
    
    if (!window.BACKEND_AVAILABLE) {
        // Load demo data from static JSON files
        await loadDemoDataFromJSON();
    }
}
```

### For views/tray-inventory.html

```javascript
// Fallback demo data
const DEMO_TRAYS = [
    { tray_id: 'T001', crop: 'Buttercrunch Lettuce', days_old: 12, status: 'growing' },
    { tray_id: 'T002', crop: 'Genovese Basil', days_old: 18, status: 'ready' },
    // ... more demo trays
];

async function loadTrays() {
    try {
        const response = await fetch('/api/inventory/trays/list');
        if (!response.ok) throw new Error('Backend unavailable');
        return await response.json();
    } catch (error) {
        console.warn('[Demo] Using fallback demo data');
        return { ok: true, trays: DEMO_TRAYS };
    }
}
```

---

## Production Deployment Checklist

To completely remove demo data:

### Environment Variables
```bash
# .env or AWS Elastic Beanstalk config
ENABLE_DEMO_DATA=false
DEMO_MODE=false
```

### Backend Modules (Python)
```bash
# Comment out or remove these lines:
backend/inventory_management.py:354     # initialize_demo_data()
backend/batch_traceability.py:87       # self._init_demo_data()
backend/production_planning.py:133     # self._init_demo_data()
backend/quality_control.py:153         # self._init_demo_data()
backend/network_dashboard.py:45        # self._init_demo_data()
backend/sustainability_esg.py:203,295  # generate_demo_data()
backend/grower_management.py:375       # initialize_demo_data()
```

### Frontend Pages
```javascript
// Remove demo mode flags or force to false:
farm-sales.html:914   → const isDemoMode = false;
farm-store.html:805   → const isDemoMode = false;
app.foxtrot.js:6202   → const isDemoMode = false;
wholesale.js:34-36    → this.demoMode = false;
```

### Test Production Mode
```bash
# Start with demo disabled
ENABLE_DEMO_DATA=false python3 -m backend
DEMO_MODE=false node server-foxtrot.js

# Verify no demo data appears:
curl http://localhost:8000/api/inventory/seeds/list
# Should return empty [] or real production data only
```

---

## Summary

**Current Issue**: Pages not populating because:
1. Multiple demo detection methods (inconsistent)
2. Python backend must be running for most pages
3. No fallback demo data when backend unavailable
4. No unified demo mode configuration

**Solution**: 
1. ✓ Created `backend/demo_config.py` as single source of truth
2. TODO: Update all 7 backend modules to use it
3. TODO: Create frontend demo detector utility
4. TODO: Add fallback demo data for critical pages
5. TODO: Test with Python backend stopped to verify fallback

**Priority**: Update `farm-admin.html` first - it's the main operational page and likely the most impacted by missing demo data.
