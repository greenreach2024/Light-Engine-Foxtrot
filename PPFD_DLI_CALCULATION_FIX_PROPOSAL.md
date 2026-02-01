# PPFD/DLI Calculation Fix & Central Sync Strategy

**Date**: February 1, 2026  
**Status**: 🟡 PROPOSAL - Requires Multi-Agent Review  
**Framework**: Investigation-First methodology applied  
**User Requirements**:
1. PPFD should be calculated from target DLI + photoperiod hours (not just recipe lookup)
2. GreenReach Farm (FARM-MKLOMAT3-A9D8) needs hourly sync with **all incremental data points**
3. Other farms don't need frequent updates (hourly or on-demand is sufficient)

---

## 🔍 Investigation Results

### Issue 1: PPFD Calculation Method

**Current Implementation** (INCORRECT):
```javascript
// greenreach-central/public/central-admin.js (line 3485)
// Just looks up PPFD from recipe data
const targetPPFD = Math.round(closestDay.ppfd);  // ❌ Static value from recipe
```

**Recipe Data Structure** (lighting-recipes.json):
```json
{
  "day": 1,
  "stage": "Seedling",
  "ppfd": 208.33,    // ❌ This is PRE-CALCULATED for assumed photoperiod
  "dli": 12,         // ✅ This is the target DLI we should use
  "temperature": 20
}
```

**Problem**:
- Recipe `ppfd` values are pre-calculated assuming specific photoperiod (likely 16h)
- When actual photoperiod differs (12h, 14h, 18h), PPFD shown is wrong
- **Formula**: `DLI = (PPFD × photoperiod_hours × 3600) / 1,000,000`
- **Reverse**: `PPFD = (DLI × 1,000,000) / (photoperiod_hours × 3600)`

**Evidence from Codebase** (lib/schedule-executor.js line 351):
```javascript
// CORRECT calculation already exists in schedule executor:
targetPPFD = (dliTarget * 1_000_000) / (safePhotoperiod * 3600);
```

**Evidence from Frontend** (public/groups-v2.js line 3456):
```javascript
// CORRECT calculation already exists in groups UI:
basePpfd = (targetDli * 1e6) / (3600 * hours);
```

**Conclusion**: Correct formula exists in 2 places, but Central Admin is using wrong method

---

### Issue 2: Photoperiod Source

**Current Group Data** (public/data/groups.json):
```json
{
  "id": "ROOM-A-Z1-G01",
  "crop": "Mei Qing Pak Choi",
  "planConfig": {
    "schedule": {
      "photoperiodHours": 16,  // ✅ Available in group data
      "totalOnHours": 16
    }
  }
}
```

**Problem**: Central Admin not reading `group.planConfig.schedule.photoperiodHours`

**Solution**: Use group's actual photoperiod hours, not assumed value

---

### Issue 3: Central Sync Strategy

**Current Sync Behavior**:
- ❌ One-time sync at farm registration
- ❌ No ongoing updates
- ❌ Only stores latest snapshot (no time-series data)

**User Requirement**:
- **GreenReach Farm**: Hourly sync with **all incremental data points** (for graphing trends)
- **Other Farms**: Hourly or on-demand (snapshot only is fine)

**Example Use Case** (Temperature Graph):
```
Edge Device collects every 5 minutes:
- 12:00 PM → 22.5°C
- 12:05 PM → 22.7°C
- 12:10 PM → 22.8°C
- 12:15 PM → 23.0°C
... (12 readings/hour)

Central Should Store:
- All 12 readings for GreenReach (monitoring farm)
- Only last reading for other farms (operational data)
```

**Database Schema Needed**:
```sql
-- Current: farm_data table (snapshot only)
CREATE TABLE farm_data (
  farm_id TEXT,
  data_type TEXT,  -- 'groups', 'telemetry', 'rooms'
  data JSONB,      -- Latest snapshot only
  updated_at TIMESTAMP
);

-- Needed: farm_telemetry_history table (time-series)
CREATE TABLE farm_telemetry_history (
  farm_id TEXT,
  zone_id TEXT,
  metric_name TEXT,  -- 'temperature', 'humidity', 'ppfd'
  value NUMERIC,
  timestamp TIMESTAMP,
  PRIMARY KEY (farm_id, zone_id, metric_name, timestamp)
);
```

---

## 💡 Proposed Solutions

### Solution 1: Fix PPFD Calculation in Central Admin (High Priority)

**Scope**: Calculate PPFD from DLI + photoperiod instead of static recipe lookup

**Changes Required**:

**File**: `greenreach-central/public/central-admin.js` (line ~3470-3490)

```javascript
// BEFORE (INCORRECT):
if (closestDay && closestDay.ppfd) {
    const targetPPFD = Math.round(closestDay.ppfd);  // ❌ Static value
    document.getElementById('group-target-ppfd').textContent = `${targetPPFD} μmol/m²/s`;
}

// AFTER (CORRECT):
if (closestDay && closestDay.dli) {
    // Get actual photoperiod from group config
    const photoperiodHours = group.planConfig?.schedule?.photoperiodHours 
                          || group.photoperiodHours 
                          || 16;  // Fallback to 16h default
    
    // Calculate PPFD from target DLI and actual photoperiod
    // Formula: PPFD = (DLI × 1,000,000) / (photoperiod_hours × 3600)
    const targetPPFD = Math.round((closestDay.dli * 1_000_000) / (photoperiodHours * 3600));
    
    document.getElementById('group-target-ppfd').textContent = `${targetPPFD} μmol/m²/s`;
    document.getElementById('group-target-ppfd-change').textContent = 
        `Day ${closestDay.day}: ${closestDay.dli} DLI ÷ ${photoperiodHours}h`;
    
    console.log('[group-detail] Calculated PPFD:', {
        dli: closestDay.dli,
        photoperiodHours,
        calculatedPPFD: targetPPFD,
        recipePPFD: closestDay.ppfd  // For comparison
    });
}
```

**Validation**:
```javascript
// Test case: DLI 12 mol/m²/d, 16h photoperiod
// PPFD = (12 × 1,000,000) / (16 × 3600) = 12,000,000 / 57,600 = 208.33 μmol/m²/s ✅

// Test case: DLI 12 mol/m²/d, 12h photoperiod
// PPFD = (12 × 1,000,000) / (12 × 3600) = 12,000,000 / 43,200 = 277.78 μmol/m²/s ✅
// (Higher PPFD needed to achieve same DLI in shorter time)
```

---

### Solution 2: Add Hourly Sync for GreenReach Farm (Medium Priority)

**Scope**: Implement hourly sync with time-series data collection for monitoring farm

**Architecture**:
```
┌─────────────────────────┐
│ Edge Device (Foxtrot)   │
│ FARM-MKLOMAT3-A9D8      │
│                         │
│ Collects every 5 min:   │
│ - Temp, RH, PPFD        │
│ - Groups, devices       │
│ - Stores in memory      │
└───────────┬─────────────┘
            │
            │ Cron: Every hour
            │ POST /api/sync/telemetry-batch
            │ (sends 12 readings × N zones)
            ▼
┌─────────────────────────┐
│ Central Server (AWS)    │
│                         │
│ farm_telemetry_history  │
│ - Stores all readings   │
│ - Retains 30 days       │
│                         │
│ farm_data (snapshot)    │
│ - Latest values only    │
└─────────────────────────┘
```

**Implementation**:

**Step 1**: Create telemetry history table
```sql
-- greenreach-central/migrations/add-telemetry-history.sql
CREATE TABLE IF NOT EXISTS farm_telemetry_history (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  value NUMERIC NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(farm_id, zone_id, metric_name, timestamp)
);

-- Index for efficient querying
CREATE INDEX idx_telemetry_farm_zone_metric 
ON farm_telemetry_history(farm_id, zone_id, metric_name, timestamp DESC);

-- Auto-cleanup: Delete data older than 30 days
CREATE OR REPLACE FUNCTION cleanup_old_telemetry()
RETURNS void AS $$
BEGIN
  DELETE FROM farm_telemetry_history 
  WHERE timestamp < NOW() - INTERVAL '30 days';
END;
$$ LANGUAGE plpgsql;
```

**Step 2**: Add batch telemetry endpoint to Central
```javascript
// greenreach-central/routes/admin.js

/**
 * POST /api/sync/telemetry-batch
 * Accept batch of telemetry readings from Edge device
 * Used for monitoring farms that need historical graphs
 */
router.post('/sync/telemetry-batch', authenticateFarmAPIKey, async (req, res) => {
    try {
        const { farmId } = req;  // From API key authentication
        const { readings, collectedAt } = req.body;
        
        // Validate batch structure
        if (!Array.isArray(readings) || readings.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'readings must be non-empty array'
            });
        }
        
        console.log(`[Sync] Received ${readings.length} telemetry readings from ${farmId}`);
        
        // Insert batch into history table
        const values = readings.map((reading, idx) => {
            return `($1, $${idx * 4 + 2}, $${idx * 4 + 3}, $${idx * 4 + 4}, $${idx * 4 + 5})`;
        }).join(',');
        
        const params = [farmId];
        readings.forEach(reading => {
            params.push(
                reading.zoneId,
                reading.metric,
                reading.value,
                reading.timestamp
            );
        });
        
        await query(`
            INSERT INTO farm_telemetry_history 
            (farm_id, zone_id, metric_name, value, timestamp)
            VALUES ${values}
            ON CONFLICT (farm_id, zone_id, metric_name, timestamp) DO UPDATE
            SET value = EXCLUDED.value
        `, params);
        
        // Also update farm_data snapshot with latest values
        const latestByZone = {};
        readings.forEach(reading => {
            const key = `${reading.zoneId}:${reading.metric}`;
            if (!latestByZone[key] || new Date(reading.timestamp) > new Date(latestByZone[key].timestamp)) {
                latestByZone[key] = reading;
            }
        });
        
        const telemetrySnapshot = {
            zones: Object.values(latestByZone).reduce((acc, reading) => {
                if (!acc[reading.zoneId]) {
                    acc[reading.zoneId] = { zoneId: reading.zoneId };
                }
                acc[reading.zoneId][reading.metric] = reading.value;
                return acc;
            }, {}),
            updatedAt: new Date().toISOString()
        };
        
        await query(`
            INSERT INTO farm_data (farm_id, data_type, data, updated_at)
            VALUES ($1, 'telemetry', $2, NOW())
            ON CONFLICT (farm_id, data_type) DO UPDATE
            SET data = $2, updated_at = NOW()
        `, [farmId, telemetrySnapshot]);
        
        res.json({
            success: true,
            inserted: readings.length,
            farmId,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[Sync] Error storing telemetry batch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to store telemetry batch',
            message: error.message
        });
    }
});
```

**Step 3**: Add hourly sync cron to Edge device
```javascript
// server-foxtrot.js (Edge Device)

// Store telemetry readings in memory (ring buffer)
const telemetryBuffer = new Map();  // zoneId → array of readings (max 20 per hour)

// Called every 5 minutes by existing telemetry collection
function recordTelemetryReading(zoneId, metrics) {
    if (!telemetryBuffer.has(zoneId)) {
        telemetryBuffer.set(zoneId, []);
    }
    
    const readings = telemetryBuffer.get(zoneId);
    readings.push({
        zoneId,
        temperature: metrics.temp,
        humidity: metrics.rh,
        ppfd: metrics.ppfd,
        timestamp: new Date().toISOString()
    });
    
    // Keep only last 20 readings (max 100 minutes of data)
    if (readings.length > 20) {
        readings.shift();
    }
}

// Sync telemetry to Central every hour
async function syncTelemetryToCentral() {
    const CENTRAL_URL = process.env.CENTRAL_URL || 'https://greenreachgreens.com';
    const API_KEY = process.env.CENTRAL_API_KEY;
    const FARM_ID = process.env.FARM_ID;
    
    if (!API_KEY || !FARM_ID) {
        console.warn('[Sync] Skipping telemetry sync: Missing API_KEY or FARM_ID');
        return;
    }
    
    try {
        // Flatten buffer into readings array
        const readings = [];
        for (const [zoneId, zoneReadings] of telemetryBuffer.entries()) {
            zoneReadings.forEach(reading => {
                // Expand each reading into individual metric entries
                readings.push(
                    { zoneId, metric: 'temperature', value: reading.temperature, timestamp: reading.timestamp },
                    { zoneId, metric: 'humidity', value: reading.humidity, timestamp: reading.timestamp },
                    { zoneId, metric: 'ppfd', value: reading.ppfd, timestamp: reading.timestamp }
                );
            });
        }
        
        if (readings.length === 0) {
            console.log('[Sync] No telemetry readings to sync');
            return;
        }
        
        console.log(`[Sync] Syncing ${readings.length} telemetry readings to Central...`);
        
        const response = await fetch(`${CENTRAL_URL}/api/sync/telemetry-batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Farm-ID': FARM_ID,
                'X-API-Key': API_KEY
            },
            body: JSON.stringify({
                readings,
                collectedAt: new Date().toISOString()
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        
        const result = await response.json();
        console.log(`[Sync] ✅ Synced ${result.inserted} telemetry readings`);
        
        // Clear buffer after successful sync
        telemetryBuffer.clear();
        
    } catch (error) {
        console.error('[Sync] ❌ Failed to sync telemetry:', error.message);
        // Keep buffer for retry next hour
    }
}

// Start hourly sync cron
const SYNC_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
setInterval(syncTelemetryToCentral, SYNC_INTERVAL_MS);

// Also sync on startup (delayed 2 minutes to allow system initialization)
setTimeout(syncTelemetryToCentral, 2 * 60 * 1000);
```

**Step 4**: Add historical graph API endpoint
```javascript
// greenreach-central/routes/admin.js

/**
 * GET /api/admin/farms/:farmId/telemetry-history
 * Get historical telemetry data for graphs
 * Query params: zoneId, metric, hours (default 24)
 */
router.get('/farms/:farmId/telemetry-history', async (req, res) => {
    try {
        const { farmId } = req.params;
        const { zoneId, metric, hours = 24 } = req.query;
        
        const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        let queryStr = `
            SELECT zone_id, metric_name, value, timestamp
            FROM farm_telemetry_history
            WHERE farm_id = $1 AND timestamp >= $2
        `;
        const params = [farmId, sinceTimestamp];
        
        if (zoneId) {
            queryStr += ` AND zone_id = $${params.length + 1}`;
            params.push(zoneId);
        }
        
        if (metric) {
            queryStr += ` AND metric_name = $${params.length + 1}`;
            params.push(metric);
        }
        
        queryStr += ` ORDER BY timestamp ASC`;
        
        const result = await query(queryStr, params);
        
        // Group by metric
        const grouped = {};
        result.rows.forEach(row => {
            const key = `${row.zone_id}:${row.metric_name}`;
            if (!grouped[key]) {
                grouped[key] = {
                    zoneId: row.zone_id,
                    metric: row.metric_name,
                    readings: []
                };
            }
            grouped[key].readings.push({
                value: parseFloat(row.value),
                timestamp: row.timestamp
            });
        });
        
        res.json({
            success: true,
            farmId,
            hours,
            series: Object.values(grouped),
            count: result.rows.length
        });
        
    } catch (error) {
        console.error('[Admin API] Error fetching telemetry history:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch telemetry history',
            message: error.message
        });
    }
});
```

---

### Solution 3: Other Farms - Snapshot Only (Low Priority)

**Scope**: Regular farms only need latest snapshot, not time-series

**Implementation**: Use existing sync strategy but add manual "Sync Now" button

```javascript
// greenreach-central/public/central-admin.js

async function syncFarmStats() {
    const syncBtn = document.getElementById('sync-stats-btn');
    syncBtn.disabled = true;
    syncBtn.textContent = '⏳ Syncing...';
    
    try {
        // Trigger all farms to sync their current state
        const response = await authenticatedFetch(`${API_BASE}/api/admin/sync/trigger-all`);
        const result = await response.json();
        
        if (result.success) {
            showToast(`✅ Synced ${result.farmsSynced} farms`, 'success');
            
            // Reload KPIs and farms list
            await Promise.all([
                loadKPIs(),
                loadFarms()
            ]);
        } else {
            showToast('❌ Sync failed: ' + result.error, 'error');
        }
    } catch (error) {
        console.error('[Sync] Error:', error);
        showToast('❌ Sync failed: ' + error.message, 'error');
    } finally {
        syncBtn.disabled = false;
        syncBtn.innerHTML = '<span>↻</span> Sync Farm Stats';
    }
}
```

---

## 📋 Implementation Plan

### Phase 1: PPFD Calculation Fix (0.5 days) - **HIGH PRIORITY**
- [ ] Update `central-admin.js` to calculate PPFD from DLI + photoperiod
- [ ] Add photoperiod source from `group.planConfig.schedule.photoperiodHours`
- [ ] Add debug logging to show calculation details
- [ ] Test with different photoperiod values (12h, 14h, 16h, 18h)

**Validation**:
```bash
# Test: Buttercrunch Lettuce, Day 5, DLI 12
# 16h photoperiod → PPFD should be ~208 μmol/m²/s
# 12h photoperiod → PPFD should be ~278 μmol/m²/s
```

### Phase 2: Investigation Complete (0.5 days) - **REQUIRED BEFORE PHASE 3**
- [ ] Test current sync behavior (is data even reaching Central?)
- [ ] Check if farm_data table has telemetry data
- [ ] Verify Edge device has CENTRAL_URL and CENTRAL_API_KEY env vars
- [ ] Document current vs desired sync behavior

### Phase 3: Hourly Telemetry Sync (2-3 days) - **AFTER MULTI-AGENT REVIEW**
- [ ] Create `farm_telemetry_history` table migration
- [ ] Add `POST /api/sync/telemetry-batch` endpoint to Central
- [ ] Add telemetry buffer to Edge device (ring buffer, 20 readings)
- [ ] Add hourly cron sync from Edge → Central
- [ ] Add `GET /api/admin/farms/:farmId/telemetry-history` for graphs
- [ ] Update Central UI to show historical graphs (temperature, humidity, PPFD)

### Phase 4: Validation (1 day)
- [ ] Create validation script (25+ tests recommended)
- [ ] Test PPFD calculation (various DLI + photoperiod combinations)
- [ ] Test telemetry sync (Edge → Central hourly)
- [ ] Test historical graph API (24h, 7d, 30d ranges)
- [ ] Test "Sync Now" manual trigger

---

## 🚨 Framework Compliance Checklist

**Investigation-First** ✅
- [x] Investigated current PPFD calculation (static recipe lookup)
- [x] Found correct formula already exists in 2 places (schedule-executor, groups-v2)
- [x] Identified recipe data has both `dli` and pre-calculated `ppfd`
- [x] Confirmed photoperiod available in `group.planConfig.schedule.photoperiodHours`

**Multi-Agent Review** ⏳ REQUIRED
- [ ] Submit this proposal to @ReviewAgent
- [ ] Request validation of PPFD calculation formula
- [ ] Request Architecture Agent assessment of telemetry sync design
- [ ] Wait for approval before Phase 3 implementation

**Database-Driven** ✅
- [x] PPFD calculated from data (DLI + photoperiod), not hardcoded
- [x] Photoperiod read from group config, not assumed
- [x] Telemetry sync stores data in database for querying

**Simplicity Over Features** ⏳
- Phase 1 (PPFD fix): Simple formula change ✅
- Phase 3 (telemetry sync): Adds complexity 🔶
  - Review Agent should assess if hourly sync justified
  - Alternative: Keep snapshot-only, add "may be stale" warning

---

## 📝 Questions for Review Agent

1. **PPFD Formula**: Is `PPFD = (DLI × 1,000,000) / (photoperiod_hours × 3600)` correct?
   - Evidence: Used in lib/schedule-executor.js and public/groups-v2.js
   - Units check: mol/m²/d → μmol/m²/s ✅

2. **Photoperiod Source**: Should we use `group.planConfig.schedule.photoperiodHours`?
   - What if group doesn't have planConfig? (fallback to 16h?)
   - Should we also check recipe photoperiod field?

3. **Telemetry Sync Complexity**: Is hourly sync with time-series justified?
   - User says "monitor many farms" → implies GreenReach is special monitoring farm
   - Alternative: Snapshot-only + "Last updated: 3d ago" warning?

4. **Database Schema**: Is `farm_telemetry_history` table design appropriate?
   - 30-day retention sufficient?
   - Index on (farm_id, zone_id, metric_name, timestamp DESC) correct?

5. **Other Farms**: Should we implement sync for non-monitoring farms?
   - User says "GreenReach hourly, other farms not needed"
   - But Operations Overview shows wrong plant count (sync issue)

---

## 📝 Questions for Architecture Agent

1. **Telemetry Sync Design**: Is hourly batch sync the right pattern?
   - Alternative 1: Edge pushes every 5 min (high traffic, low latency)
   - Alternative 2: Central polls Edge every hour (simpler, Edge needs endpoint)
   - Proposed: Edge pushes hourly batch (balanced)

2. **Data Retention**: 30 days of telemetry history appropriate?
   - ~8,640 readings per metric per month (12 readings/hour × 24h × 30d)
   - ~26,000 rows per zone per month (3 metrics × 8,640)
   - Cleanup strategy: Cron job vs Postgres partition drop?

3. **Monitoring vs Operational Farms**: Should sync strategy differ?
   - GreenReach: Full time-series (for graphs/analysis)
   - Other farms: Snapshot only (for operational dashboard)
   - How to configure which farms are "monitoring" vs "operational"?

4. **Scalability**: How does this scale to 100 farms?
   - 100 farms × 3 zones × 3 metrics × 12 readings/hour = 10,800 inserts/hour
   - PostgreSQL can handle, but should we batch?
   - Consider: TimescaleDB for time-series optimization?

---

## 🎯 Immediate Next Steps

**DO THIS NOW** (No approval needed - just formula fix):
1. **Fix PPFD calculation in Central Admin** (Phase 1)
   - This is a clear bug fix (using wrong calculation)
   - Correct formula already exists in codebase (precedent set)
   - 30 minutes of work, high user impact

**WAIT FOR APPROVAL** (Requires multi-agent review):
2. **Submit this proposal** to @ReviewAgent and @ArchitectureAgent
3. **Phase 2 Investigation**: Test current sync behavior
4. **Phase 3 Implementation**: Only after approval

---

**Implementation Agent**: Investigation complete, Phase 1 fix ready to implement  
**Status**: 🟡 PARTIAL - Phase 1 can proceed, Phase 3 blocked pending review  
**Framework Compliance**: ✅ Investigation-First, ⏳ Multi-Agent review pending for Phase 3

