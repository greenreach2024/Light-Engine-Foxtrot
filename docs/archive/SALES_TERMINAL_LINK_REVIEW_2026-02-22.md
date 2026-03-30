# Sales Terminal Farm Linking Review

**Date:** 2026-02-22  
**Revised:** 2026-02-22 (v2 - Security & Scope Refinements)  
**Issue:** POS terminal does not show as being linked to "Notable Sprout" when opened from Admin page  
**Scope:** ALL Farm Sales Pages (POS, Store, Shop, Landing), Inventory Integration, Edge Server Linkage

> **Audit Result:** All 4 farm-sales pages have the same linking issue:
> - `farm-sales-pos.html` — POS Terminal
> - `farm-sales-store.html` — Customer-facing Store  
> - `farm-sales-shop.html` — Shop Interface
> - `farm-sales-landing.html` — Landing Page

---

## Executive Summary

The Farm Sales Terminal (POS) is **not properly linked** to the specific Light Engine farm it serves. When opened from the Admin page for "Notable Sprout", the terminal displays "Loading..." or falls back to "GreenReach Demo Farm" instead of the actual farm identity.

**Root Causes Identified:**

1. **No farm context passed during navigation** — Links to POS don't include farm identifier
2. **Demo tokens hardcoded** — Only 7 preset farms included, "Notable Sprout" is missing
3. **Missing `farm.json` configuration** — Edge server lacks persistent farm identity file
4. **Weak farm detection** — POS relies on subdomain detection which doesn't work in direct URL access

---

## Current Architecture

### Navigation Flow (Current - Broken)
```
Admin Page (Notable Sprout)
    │
    ▼ Click "Sales > Farm Sales Terminal"
    │
Navigation: /farm-sales-pos.html  (NO PARAMS)
    │
    ▼
POS loads, calls /api/config/app
    │
    ▼
Endpoint tries:
  1. Subdomain lookup → fails (no subdomain)
  2. Database lookup → fails (no subdomain match)
  3. farm.json file → fails (file doesn't exist)
  4. Fallback → "GreenReach Demo Farm" ❌
```

### Key Files Analyzed

| File | Purpose | Issue |
|------|---------|-------|
| [farm-sales-pos.html](public/farm-sales-pos.html) | POS Terminal UI | Lines 966-970: Gets farmId from `/api/config/app`, falls back to "Light Engine Farm" |
| [farm-summary.html](public/views/farm-summary.html#L1699-L1700) | Farm Admin | Links to POS with no `?farm=` parameter |
| [server-foxtrot.js](server-foxtrot.js#L20224-L20285) | `/api/config/app` endpoint | Falls back to hardcoded demo when `farm.json` missing |
| [lib/farm-auth.js](lib/farm-auth.js#L237-L250) | Demo token generation | Hardcoded list of 7 farms, doesn't include "Notable Sprout" |
| [routes/farm-sales/inventory.js](routes/farm-sales/inventory.js#L27) | Inventory endpoint | Correctly uses `req.farm_id` from auth, but auth fails |

---

## Identified Gaps

### Gap 1: No Farm Context in Navigation Links

**Location:** [farm-summary.html#L1699-L1700](public/views/farm-summary.html#L1699-L1700)

```html
<!-- Current (broken) -->
<a href="/farm-sales-pos.html" class="dropdown-item">Farm Sales Terminal</a>
<a href="/farm-sales-pos.html" class="dropdown-item">POS</a>
```

**Should be:**
```html
<a href="/farm-sales-pos.html?farm=${encodeURIComponent(farmSlug)}" ...>
```

### Gap 2: Demo Token List Doesn't Include Dynamic Farms

**Location:** [lib/farm-auth.js#L237-L247](lib/farm-auth.js#L237-L247)

```javascript
// Current: Hardcoded list
const farms = [
  { farm_id: 'GR-00001', name: 'GreenReach Demo Farm', ... },
  { farm_id: 'LOCAL-FARM', name: 'Local Demo Farm', ... },
  // ... 7 total farms
  // "Notable Sprout" NOT INCLUDED ❌
];
```

### Gap 3: Missing `farm.json` Configuration

**Location:** `data/farm.json` (does not exist)

Edge servers should have a `farm.json` that persists their identity:
```json
{
  "farmId": "notable-sprout-001",
  "name": "Notable Sprout",
  "slug": "notable-sprout",
  "region": "Pacific Northwest"
}
```

### Gap 4: POS Doesn't Read URL Parameters

**Location:** [farm-sales-pos.html#L919-L936](public/farm-sales-pos.html#L919-L936)

The POS initialization only checks:
1. localStorage (from previous session)
2. `/api/config/app` endpoint

It does NOT check URL parameters like `?farm=notable-sprout`.

---

## Integration Points Needed

### 1. POS ↔ Light Engine Identity
```
POS Terminal should:
- Read farm identity from URL param, sessionStorage, or localStorage
- Display farm name prominently in header
- Store farm_id in all API requests
```

### 2. POS ↔ Inventory Integration
```
Current: Inventory endpoint works correctly with req.farm_id
Missing: Auth token with correct farm_id never received
Result: Inventory shows nothing or generic demo data
```

### 3. POS ↔ Sales Reporting
```
Orders created via POS include farm_id in auth
Reports should aggregate by farm_id
Reports endpoint: /api/farm-sales/reports
```

### 4. Farm Identity Resolution Chain

How `farm-summary.html` knows the current farm (implementation detail for Fix 1):

```javascript
// farm-summary.html lines 2027-2076 show the resolution order:
// 1. Authenticated API: GET /api/farm/profile (if token exists)
// 2. Fallback: GET /data/farm.json (static file)
// 3. Default: "Light Engine Farm"

// To pass farm context to POS, add after loadFarmNameIntoHeader():
async function storeFarmContextForNavigation() {
  // Get from API response or farm.json
  const farmId = window.currentFarmId;      // Set during header load
  const farmName = window.currentFarmName;  // Set during header load
  const farmSlug = window.currentFarmSlug || farmId;
  
  // Store for same-tab navigation
  sessionStorage.setItem('farm_id', farmId);
  sessionStorage.setItem('farm_name', farmName);
  sessionStorage.setItem('farm_slug', farmSlug);
  
  // Update all farm-sales links with params
  document.querySelectorAll('a[href*="farm-sales"]').forEach(link => {
    const url = new URL(link.href, window.location.origin);
    url.searchParams.set('farm', farmSlug);
    url.searchParams.set('id', farmId);
    url.searchParams.set('name', farmName);
    link.href = url.toString();
  });
}
```

---

## Recommended Fixes

### Fix 1: Pass Farm Context in Navigation (Priority: HIGH)

**File:** `public/views/farm-summary.html`

Modify the navigation links to pass the current farm:

```javascript
// At page load, store farm context
const farmSlug = sessionStorage.getItem('farm_slug') || 'demo';
const farmId = sessionStorage.getItem('farm_id') || 'demo';
const farmName = window.currentFarmName; // Already loaded in header

// Update navigation links
document.querySelectorAll('a[href*="farm-sales-pos.html"]').forEach(link => {
  link.href = `/farm-sales-pos.html?farm=${encodeURIComponent(farmSlug)}&id=${encodeURIComponent(farmId)}`;
});
```

### Fix 2: POS Should Read URL Parameters First (Priority: HIGH)

**File:** `public/farm-sales-pos.html`

Update `DOMContentLoaded` handler:

```javascript
window.addEventListener('DOMContentLoaded', async () => {
  const urlParams = new URLSearchParams(window.location.search);
  
  // Priority 1: URL parameters (from navigation)
  const urlFarmSlug = urlParams.get('farm');
  const urlFarmId = urlParams.get('id');
  const urlFarmName = urlParams.get('name');
  
  if (urlFarmSlug || urlFarmId) {
    // Fetch farm details and authenticate
    const farmInfo = await fetchFarmInfo(urlFarmSlug || urlFarmId);
    if (farmInfo) {
      farmId = farmInfo.farmId;
      farmName = farmInfo.farmName;
      // Get auth token for this farm
      await authenticateForFarm(farmId);
      return showApp();
    }
  }
  
  // Priority 2: sessionStorage/localStorage (existing logic)
  // ... existing code ...
});
```

### Fix 3: Dynamic Demo Token Generation (Priority: MEDIUM)

**File:** `lib/farm-auth.js`

**⚠️ Security Consideration:** Arbitrary farm_id could allow token spoofing. Must validate farm exists in database before generating token.

Modify `generateDemoTokens()` to accept a target farm with validation:

```javascript
export async function generateDemoTokens(targetFarm = null, dbPool = null) {
  const baseFarms = [
    { farm_id: 'GR-00001', name: 'GreenReach Demo Farm', slug: 'greenreach-demo' },
    // ... existing farms
  ];
  
  // Add target farm if provided
  if (targetFarm && !baseFarms.find(f => f.farm_id === targetFarm.farm_id)) {
    baseFarms.push(targetFarm);
  }
  
  // ... rest of function
}
```

Update the endpoint to accept query params **with database validation**:
```javascript
router.get('/demo-tokens', async (req, res) => {
  const { farm_id, farm_name, farm_slug } = req.query;
  
  let targetFarm = null;
  
  // If a specific farm is requested, VALIDATE it exists in database
  if (farm_id && dbPool) {
    try {
      const result = await dbPool.query(
        'SELECT farm_id, name, farm_slug FROM farms WHERE farm_id = $1 OR farm_slug = $1',
        [farm_id]
      );
      if (result.rows.length > 0) {
        const farm = result.rows[0];
        targetFarm = { 
          farm_id: farm.farm_id, 
          name: farm.name, 
          slug: farm.farm_slug 
        };
      } else {
        return res.status(404).json({ 
          ok: false, 
          error: 'farm_not_found',
          message: `Farm "${farm_id}" not registered in system`
        });
      }
    } catch (err) {
      console.warn('[demo-tokens] DB validation failed:', err.message);
      // Fall through to base farms only
    }
  }
  
  const tokens = generateDemoTokens(targetFarm);
  res.json({ ok: true, tokens });
});
```

### Fix 4: Create `farm.json` During Setup (Priority: MEDIUM)

**Action:** Setup wizard should write `data/farm.json` with farm identity.

**File:** Setup wizard or first-run configuration

```javascript
// During farm setup, persist identity
const farmConfig = {
  farmId: generatedFarmId,
  name: userEnteredFarmName,
  slug: slugify(userEnteredFarmName),
  region: selectedRegion,
  created_at: new Date().toISOString()
};

fs.writeFileSync(
  path.join(DATA_DIR, 'farm.json'),
  JSON.stringify(farmConfig, null, 2)
);
```

---

## Implementation Plan

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| **P0** | Pass farm context in POS navigation links | `farm-summary.html` | 30 min |
| **P0** | Read URL params in POS initialization | `farm-sales-pos.html` | 1 hour |
| **P0** | Read URL params in Store initialization | `farm-sales-store.html` | 45 min |
| **P0** | Read URL params in Shop initialization | `farm-sales-shop.html` | 45 min |
| **P0** | Read URL params in Landing initialization | `farm-sales-landing.html` | 30 min |
| **P1** | Store farm identity in sessionStorage during admin login | `farm-admin.js` | 30 min |
| **P1** | Dynamic demo token generation with DB validation | `lib/farm-auth.js` | 1.5 hours |
| **P1** | Add fallback farm selector when no context | `farm-sales-pos.html` | 1 hour |
| **P2** | Create `farm.json` during setup wizard | `setup-wizard.html` | 1 hour |
| **P2** | Display farm name prominently in POS header | `farm-sales-pos.html` | 15 min |
| **P2** | Add CLI/endpoint to generate `farm.json` for existing deployments | `server-foxtrot.js` | 45 min |

**Total Estimated Effort:** 8 hours

### Storage Strategy

| Storage | Use Case | Lifetime |
|---------|----------|----------|
| **URL params** | Primary: passed from admin navigation | Single navigation |
| **sessionStorage** | Tab-specific farm context | Browser tab session |
| **localStorage** | Last-used farm fallback | Persistent |

### Error Handling

```javascript
// POS should show farm selector if no valid context
async function initializeFarmContext() {
  let farmId = await resolveFarmId(); // URL → sessionStorage → localStorage → api
  
  if (!farmId || farmId === 'demo' || farmId === 'light-engine-demo') {
    // Show farm selector dialog
    const farms = await fetchAvailableFarms();
    if (farms.length === 1) {
      farmId = farms[0].farm_id; // Auto-select single farm
    } else if (farms.length > 1) {
      farmId = await showFarmSelectorDialog(farms);
    } else {
      showError('No farms configured. Please complete setup wizard.');
      return null;
    }
  }
  
  return farmId;
}
```

---

## Testing Checklist

After implementation, verify:

### Navigation Tests
- [ ] Navigate from farm-summary (Notable Sprout) to POS → Shows "Notable Sprout" in header
- [ ] Navigate from farm-summary to Store → Shows correct farm
- [ ] Navigate from farm-summary to Shop → Shows correct farm
- [ ] Direct URL access without params → Shows farm selector or prompts

### Inventory & Sales Tests
- [ ] POS inventory shows Notable Sprout's available products
- [ ] Creating a sale stores correct `farm_id` in order record
- [ ] Refreshing POS page maintains farm context (sessionStorage)
- [ ] Sales reports filter correctly by farm_id

### Multi-Tab & Security Tests
- [ ] Multiple browser tabs can show different farms' POS
- [ ] Invalid `farm_id` in URL returns 404, not token
- [ ] Token generated for one farm cannot access another farm's data
- [ ] Bookmarked POS URL without farm context shows selector

### Edge Case Tests
- [ ] Existing deployment without `farm.json` → graceful degradation
- [ ] Network error during farm lookup → shows cached farm or selector
- [ ] Token expiry mid-session → auto-refresh works

---

## Appendix: API Endpoints

### Current Endpoints Used by POS

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /api/config/app` | Get current farm config | None |
| `GET /api/farm-auth/demo-tokens` | Get test tokens | None |
| `GET /api/farm-sales/inventory` | Get farm inventory | JWT (farm_id) |
| `GET /api/farm-sales/orders` | Get farm orders | JWT (farm_id) |
| `POST /api/farm-sales/pos/checkout` | Process sale | JWT (farm_id) |

### Required New Endpoints

| Endpoint | Purpose | Parameters | Security |
|----------|---------|------------|----------|
| `GET /api/farm/by-slug/:slug` | Look up farm by slug | `slug` | Public (returns limited info) |
| `GET /api/farms/available` | List farms for selector | None | Development only |

```javascript
// GET /api/farm/by-slug/:slug — Public lookup (limited fields)
app.get('/api/farm/by-slug/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const result = await pool.query(
      'SELECT farm_id, name, farm_slug, status FROM farms WHERE farm_slug = $1 AND status = $1',
      [slug, 'active']
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'farm_not_found' });
    }
    res.json({ ok: true, farm: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/farms/available — Development-only farm selector
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/farms/available', async (req, res) => {
    const result = await pool.query(
      'SELECT farm_id, name, farm_slug FROM farms WHERE status = $1 ORDER BY name',
      ['active']
    );
    res.json({ ok: true, farms: result.rows });
  });
}
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| v1 | 2026-02-22 | Initial review |
| v2 | 2026-02-22 | Security fix for dynamic tokens (DB validation), expanded scope to all 4 farm-sales pages, added storage strategy, enhanced testing checklist, added error handling examples |

---

*Report generated for GreenReach Light Engine project review.*
