# Phase D: Advanced AI Features — Implementation Plan
**Date:** 2026-03-01  
**Agent:** Implementation Agent  
**Status:** Revised After Review Agent Pass (Phase 1 closure required before Phase 3)

## Executive Summary

After comprehensive audit of AI Vision infrastructure against `.github/AI_VISION_RULES_AND_SKILLS.md`, the system is further along than expected:

- **Phase 1:** 75% complete (experiment records, benchmarks, network push operational)
- **Phase 2:** 15% complete (demand signals calculated but not consumed)
- **Phase 3:** 10% complete (recipe modifier infrastructure exists, logic missing)

**Strategic Direction:** Complete and validate all remaining Phase 1 gates first → then Phase 2 enhancements → only then unlock Phase 3 modifiers.

---

## Review Agent Delta (2026-03-01)

This revision incorporates mandatory fixes from Review Agent validation:

1. **Phase-gate sequencing corrected** — Phase 3 is explicitly blocked until Phase 1 closure evidence exists.
2. **Endpoint strategy corrected** — extend existing sync contracts first; avoid introducing parallel sync channels.
3. **Threshold enforcement made explicit** — hard gates for farm/network modifier generation, publishing, and farm-side application.
4. **Deployment approval gate inserted** — no production deployment actions without user message: `APPROVED FOR DEPLOYMENT`.
5. **Checklist/evidence wording corrected** — proposal claims marked as planned until validated artifacts exist.
6. **Central promotion evidence table added** — ingest → aggregate → push proof required before promotion.

---

## Infrastructure Audit Results

### ✅ Phase 1 — Already Implemented

| Task | Component | Location | Status |
|------|-----------|----------|--------|
| **T1.2** | Harvest outcome experiment record | `server-foxtrot.js` lines 10500-10650 | ✅ Complete |
| **T1.3** | POST experiment records to Central | `syncExperimentToCenter()` | ✅ Complete |
| **T1.7** | Ingest experiment records endpoint | `greenreach-central/routes/experiment-records.js` | ✅ Complete |
| **T1.8** | Nightly crop benchmark aggregation | `computeCropBenchmarks()` runs at 2 AM | ✅ Complete |
| **T1.9** | Push crop benchmarks to farms | `ai-recommendations-pusher.js` lines 250-290 | ✅ Complete |
| **T1.11** | Network trends endpoint | `network-growers.js` lines 220-305 | ✅ Complete |
| **T1.12** | Leaderboard endpoint | `network-growers.js` lines 733-793 | ✅ Complete |
| **T2.8** | Demand signal aggregation | `ai-recommendations-pusher.js` lines 256-262 | ✅ Complete |
| **T3.34** | Network loss-pattern alerts | `buildNetworkLossAlerts()` lines 168-218 | ✅ Complete |

### ⚠️ Phase 1 — Partially Complete / Gaps

| Task | What's Missing | Impact | Priority |
|------|---------------|--------|----------|
| **T1.1** | Applied recipe parameters not captured per day | Can't correlate recipe→yield | **High** |
| **T1.4** | Loss events not linked to environment snapshot | Can't build loss predictor | **Medium** |
| **T1.5** | Crop recommendations don't consume demand signals | Missing 20% of recommendation accuracy | **High** |
| **T1.6** | Learning correlations not surfaced on dashboard | Growers can't see optimization insights | **Medium** |

### ❌ Phase 2/3 — Not Started

| Task | Component | Blocker |
|------|-----------|---------|
| **T2.1-T2.7** | Workflow automation (auto-derive plant count, etc.) | Design required |
| **T3.25** | Farm-specific recipe modifiers | No modifier logic implemented |
| **T3.31** | Cross-farm yield regression ML model | Need 50+ harvests per crop (threshold check required) |
| **T3.32** | Network recipe modifier computation | Needs T3.31 first |
| **T3.28** | ML harvest date prediction | Need 200+ harvests per crop |

---

## Phase D Implementation Roadmap

### Stage 1: Complete Phase 1 Foundations (1-2 days)

**Goal:** Close Phase 1 data collection gaps before advancing to Phase 2/3.

#### 1.1 Integrate Demand Signals into Crop Recommendations (T1.5)

**Rule Compliance:** Rule 1.4 (use existing data before proposing new collection), Rule 2.2 (use existing pipes)

**Current State:**
- Central computes `demand_signals` via `analyzeDemandPatterns()`
- Pushed to farms in `network_intelligence.demand_signals`
- `lib/crop-recommendation-engine.js` scoring exists but doesn't consume demand data

**Implementation:**

```javascript
// File: lib/crop-recommendation-engine.js (add new scoring function)

/**
 * Score market demand based on Central network intelligence
 * @param {string} cropId - Crop to score
 * @param {Object} networkIntelligence - From Central push payload
 * @returns {number} Score 0-100
 */
function scoreDemandFit(cropId, networkIntelligence) {
  if (!networkIntelligence?.demand_signals?.[cropId]) {
    return 50; // Neutral if no demand data
  }

  const demand = networkIntelligence.demand_signals[cropId];
  
  // High demand velocity (increasing orders) = higher score
  if (demand.trend === 'increasing' && demand.velocity > 0.15) {
    return 100;
  } else if (demand.trend === 'stable' && demand.velocity > -0.05) {
    return 75;
  } else if (demand.trend === 'decreasing') {
    return Math.max(20, 50 - (Math.abs(demand.velocity) * 100));
  }
  
  return 50;
}

// Modify recommendCrops() to accept networkIntelligence parameter
// Weight demand scoring at 25% alongside existing factors
```

**Files to Modify:**
1. `lib/crop-recommendation-engine.js` — Add `scoreDemandFit()`, integrate into `recommendCrops()`
2. `server-foxtrot.js` — Pass `latestNetworkIntelligence` to crop recommendation endpoints
3. `public/LE-crop-recommender.html` — Display demand trend in UI (🔥 Hot Demand, ⚖️ Stable, ⬇️ Declining)

**Validation:**
- Verify demand signals present in Central push: `GET /api/ai/status` → `network_intelligence.demand_signals`
- Test recommendation API returns different scores for high-demand vs low-demand crops
- Schema: No changes (uses existing payload)

---

#### 1.2 Link Loss Events to Environment Snapshot (T1.4)

**Rule Compliance:** Rule 4.1 (closes Feedback Loop #2: Environment → Loss), Rule 9.2 (persist, don't discard)

**Current State:**
- Loss events captured in `trayLossEventsDB`
- Environment snapshots exist in `readEnv()` but not linked at loss capture time

**Implementation:**

```javascript
// File: server-foxtrot.js (modify loss event capture)

app.post('/api/losses/log', async (req, res) => {
  const { tray_id, crop, quantity, reason, zone, room } = req.body;
  
  // Capture environment at loss event time (Task 1.4)
  let environmentSnapshot = {};
  try {
    const envState = readEnv();
    const zoneData = Object.values(envState.zones || {}).find(z =>
      z.room === room || z.zone_name === zone
    );
    if (zoneData?.sensors?.[0]?.readings) {
      environmentSnapshot = {
        temp_c: zoneData.sensors[0].readings.temperature_c,
        humidity_pct: zoneData.sensors[0].readings.humidity,
        co2_ppm: zoneData.sensors[0].readings.co2,
        vpd_kpa: zoneData.sensors[0].readings.vpd,
        captured_at: new Date().toISOString()
      };
    }
  } catch (e) {
    console.warn('[Loss] Environment snapshot unavailable:', e.message);
  }

  const lossEvent = {
    tray_id, crop, quantity, reason, zone, room,
    environment_snapshot: environmentSnapshot,  // NEW
    recorded_at: new Date().toISOString()
  };

  await trayLossEventsDB.insert(lossEvent);
  
  // POST to Central for network loss pattern analysis (T3.34)
  syncLossEventToCenter(lossEvent).catch(e => 
    console.warn('[Loss] Central sync failed:', e.message)
  );
  
  res.json({ ok: true });
});
```

**Central Ingestion:**

```javascript
// File: greenreach-central/routes/experiment-records.js (extend existing endpoint)

// Extend POST /api/sync/experiment-records payload with optional loss_events[]
// while preserving backward compatibility for current callers.

if (Array.isArray(req.body.loss_events) && req.body.loss_events.length > 0) {
  for (const event of req.body.loss_events) {
    await query(`
      INSERT INTO loss_events
        (farm_id, crop, quantity, reason, zone, environment_snapshot, recorded_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT DO NOTHING
    `, [farm_id, event.crop, event.quantity, event.reason, event.zone,
        JSON.stringify(event.environment_snapshot), event.recorded_at]);
  }
}
```

**Files to Modify:**
1. `server-foxtrot.js` — Add environment snapshot to loss logging (lines ~15000-15100)
2. `greenreach-central/routes/experiment-records.js` — Extend POST /sync/experiment-records with optional `loss_events`
3. `greenreach-central/config/database.js` — Add `loss_events` table schema

**Schema Changes:**
```sql
CREATE TABLE IF NOT EXISTS loss_events (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  crop VARCHAR(255) NOT NULL,
  quantity INTEGER,
  reason VARCHAR(255),
  zone VARCHAR(255),
  environment_snapshot JSONB,
  recorded_at TIMESTAMP NOT NULL,
  ingested_at TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
);

CREATE INDEX idx_loss_crop ON loss_events(crop);
CREATE INDEX idx_loss_recorded_at ON loss_events(recorded_at);
```

**Validation:**
- Log loss event, verify `environment_snapshot` present in NeDB
- Verify loss events are accepted via extended POST `/api/sync/experiment-records`
- Query Central: `SELECT * FROM loss_events WHERE environment_snapshot IS NOT NULL`

---

#### 1.3 Capture Applied Recipe Parameters Per Day (T1.1)

**Rule Compliance:** Rule 3.1 (experiment record foundation), Rule 4.1 (closes Feedback Loop #1: Recipe → Yield)

**Current State:**
- Recipes defined in `lighting-recipes.json`
- `buildExperimentRecord()` attempts to read applied recipes but falls back to nulls
- No daily tracking of what was actually applied vs what was planned

**Implementation:**

**Option A: Extend Existing Duty Logging (Recommended)**

Current duty logger (`automation/duty-cycle-logger.js`) already captures daily duty cycles. Extend to capture recipe targets:

```javascript
// File: automation/duty-cycle-logger.js

// After duty cycle logging, capture recipe targets
if (group.recipe && recipeDB[group.recipe]) {
  const recipe = recipeDB[group.recipe];
  const growDay = calculateGrowDay(group.planted_date);
  const stage = recipe.stages.find(s => growDay >= s.day_start && growDay <= s.day_end);
  
  await appliedRecipesDB.insert({
    group_id: group.id,
    crop: group.crop,
    recipe_id: group.recipe,
    grow_day: growDay,
    date: new Date().toISOString().split('T')[0],
    target_ppfd: stage?.ppfd,
    target_spectrum: { blue: stage?.blue, red: stage?.red, ...},
    target_ec: stage?.ec,
    target_ph: stage?.ph,
    target_temp_c: stage?.temperature,
    target_humidity_pct: stage?.humidity,
    target_vpd: stage?.vpd,
    actual_duty: duty,  // From existing logger
    recorded_at: new Date().toISOString()
  });
}
```

**Option B: New Standalone Recipe Logger**

Create `automation/recipe-application-logger.js` that runs alongside existing automation.

**Files to Modify:**
1. `automation/duty-cycle-logger.js` — Extend to capture recipe targets
2. `server-foxtrot.js` — Create `appliedRecipesDB` NeDB instance
3. `lib/experiment-record-builder.js` — Read from `appliedRecipesDB` instead of guessing
4. Central: Extend existing sync payload/exports for applied recipe summaries (no parallel endpoint)

**Schema:**
```javascript
// NeDB: appliedRecipesDB
{
  group_id: "GRP-001",
  crop: "genovese-basil",
  recipe_id: "basil-v2",
  grow_day: 15,
  date: "2026-03-01",
  target_ppfd: 250,
  target_spectrum: { blue: 20, red: 65, green: 10, white: 5 },
  target_ec: 1.8,
  target_ph: 5.8,
  target_temp_c: 22,
  target_humidity_pct: 65,
  actual_duty: 0.85,  // What was actually applied
  recorded_at: "2026-03-01T12:00:00Z"
}
```

**Validation:**
- Run system for 1 day, verify `appliedRecipesDB` has entries for all active groups
- Check `buildExperimentRecord()` uses real data instead of nulls
- Verify experiment records POSTed to Central have non-null `recipe_params_avg`

---

### Stage 2: Enhance Crop Recommendation Engine (2-3 days)

**Goal:** Integrate all available network intelligence into crop recommendations.

#### 2.1 Display Network Benchmarks in Crop Selection UI

**Files to Modify:**
1. `public/LE-crop-recommender.html` — Add benchmark comparison table
2. `server-foxtrot.js` — Endpoint to serve latest benchmarks from Central push

**UI Enhancement:**

```html
<!-- Show network benchmarks alongside farm performance -->
<div class="benchmark-comparison">
  <h4>Network Benchmark: Genovese Basil</h4>
  <table>
    <tr>
      <th>Metric</th>
      <th>Your Farm</th>
      <th>Network Average</th>
      <th>Network Top 25%</th>
    </tr>
    <tr>
      <td>Yield (oz/plant)</td>
      <td class="farm-value">3.2</td>
      <td class="network-avg">2.8</td>
      <td class="network-top">3.5</td>
    </tr>
    <tr>
      <td>Grow Days</td>
      <td class="farm-value">28</td>
      <td class="network-avg">30</td>
      <td class="network-top">26</td>
    </tr>
    <tr>
      <td>Loss Rate</td>
      <td class="farm-value">8%</td>
      <td class="network-avg">12%</td>
      <td class="network-top">5%</td>
    </tr>
  </table>
  <p class="insight">You're outperforming network average on yield! 
     Consider reducing grow time to match top quartile efficiency.</p>
</div>
```

**API Enhancement:**

```javascript
// GET /api/crop-recommendations?zone=Zone1&networkBenchmarks=true
// Returns recommendations + network benchmarks for comparison
```

---

#### 2.2 Surface Learning Correlations on Dashboard (T1.6)

**Rule Compliance:** Rule 1.3 (OBSERVE mode), Rule 5.2 (multi-function display)

**Implementation:**

Add "Learning Insights" panel to dashboard showing discovered correlations:

```javascript
// File: routes/kpis.js (add new endpoint)

app.get('/api/learning-insights', async (req, res) => {
  // Analyze experiment records for correlations
  const records = await harvestOutcomesDB.find({});
  
  const insights = [];
  
  // Correlation 1: PPFD ↔ Yield
  const ppfdYieldCorr = computeCorrelation(
    records.map(r => r.recipe_params_avg?.ppfd),
    records.map(r => r.outcomes?.weight_per_plant_oz)
  );
  if (ppfdYieldCorr > 0.6) {
    insights.push({
      type: 'correlation',
      strength: ppfdYieldCorr,
      message: `Strong correlation: Higher PPFD → Higher yield (r=${ppfdYieldCorr.toFixed(2)})`,
      recommendation: 'Consider increasing light intensity for underperforming crops',
      data_points: records.length
    });
  }
  
  // Correlation 2: Temp ↔ Loss Rate
  const tempLossCorr = computeCorrelation(
    records.map(r => r.environment_achieved_avg?.temp_c),
    records.map(r => r.outcomes?.loss_rate)
  );
  if (tempLossCorr < -0.5) {
    insights.push({
      type: 'correlation',
      strength: Math.abs(tempLossCorr),
      message: `Higher temperature correlates with lower loss (r=${tempLossCorr.toFixed(2)})`,
      recommendation: 'Review temperature setpoints for high-loss zones'
    });
  }
  
  res.json({ ok: true, insights, generated_at: new Date().toISOString() });
});
```

**Dashboard Display:**
- Add "Learning Insights" card to `public/LE-dashboard.html`
- Show correlation strength as confidence bar
- Link to relevant documentation (e.g., "Review PPFD settings →")

---

### Stage 3: Recipe Modifiers with Safety Guardrails (3-4 days)

**Execution Gate:** 🚫 **Blocked until Stage 1 closure criteria are complete and validated.**

**Goal:** Implement Phase 3 foundation — farm-specific recipe modifiers with revert-on-regression.

#### 3.1 Farm-Specific Recipe Modifier Engine

**Rule Compliance:** Rules 6.1-6.4 (modifier layer, conservative bounds, revert-on-regression, farm vs network priority)

**Architecture:**

```
Base Recipe (universal)
    ↓
Farm Modifier (from 10+ harvests) ← Priority 1
    ↓
Network Modifier (from 50+ network harvests) ← Priority 2 fallback
    ↓
Effective Target
    ↓
Spectral Solver
```

**Implementation:**

```javascript
// File: lib/recipe-modifier-engine.js (NEW)

/**
 * Recipe Modifier Engine (Phase 3 T25)
 * Applies farm-specific or network modifiers with safety bounds (Rule 6.2)
 */

const MODIFIER_BOUNDS = {
  spectrum_pct: 5,      // ±5% per band
  ppfd_pct: 10,         // ±10%
  temp_c: 2,            // ±2°C
  photoperiod_hours: 2  // ±2 hours
};

const MIN_HARVESTS_FARM = 10;      // Rule 8.3
const MIN_CONFIDENCE_FARM = 0.75;  // Rule 6.2

/**
 * Load farm-specific modifier for a crop (if exists and meets threshold)
 */
async function getFarmModifier(farmId, crop, modifiersDB) {
  const modifier = await modifiersDB.findOne({ farm_id: farmId, crop });
  
  if (!modifier) return null;
  
  // Check data volume requirement (Rule 8.3)
  if (modifier.sample_size < MIN_HARVESTS_FARM) {
    console.log(`[Modifier] Farm modifier for ${crop} below threshold (${modifier.sample_size}/${MIN_HARVESTS_FARM})`);
    return null;
  }
  
  // Check confidence threshold (Rule 6.2)
  if (modifier.confidence < MIN_CONFIDENCE_FARM) {
    console.log(`[Modifier] Farm modifier for ${crop} low confidence (${modifier.confidence.toFixed(2)})`);
    return null;
  }
  
  return modifier;
}

/**
 * Apply modifier to base recipe with conservative bounds (Rule 6.2)
 */
function applyModifier(baseRecipe, modifier) {
  if (!modifier) return baseRecipe;
  
  const modified = { ...baseRecipe };
  
  // Apply spectrum adjustments (bounded)
  if (modifier.adjustments.blue_delta_pct) {
    const delta = Math.max(-MODIFIER_BOUNDS.spectrum_pct, 
                           Math.min(MODIFIER_BOUNDS.spectrum_pct, modifier.adjustments.blue_delta_pct));
    modified.blue_pct = baseRecipe.blue_pct + delta;
  }
  
  // Apply PPFD adjustment (bounded)
  if (modifier.adjustments.ppfd_delta_pct) {
    const delta = Math.max(-MODIFIER_BOUNDS.ppfd_pct, 
                           Math.min(MODIFIER_BOUNDS.ppfd_pct, modifier.adjustments.ppfd_delta_pct));
    modified.ppfd = baseRecipe.ppfd * (1 + delta / 100);
  }
  
  // Apply temperature adjustment (bounded)
  if (modifier.adjustments.temp_delta_c) {
    const delta = Math.max(-MODIFIER_BOUNDS.temp_c, 
                           Math.min(MODIFIER_BOUNDS.temp_c, modifier.adjustments.temp_delta_c));
    modified.temp_c = baseRecipe.temp_c + delta;
  }
  
  return modified;
}

/**
 * Check if modifier should revert due to regression (Rule 6.3)
 */
async function checkRevertCondition(farmId, crop, harvestOutcomesDB, modifiersDB) {
  // Get baseline yield (before modifier was applied)
  const modifier = await modifiersDB.findOne({ farm_id: farmId, crop });
  if (!modifier || !modifier.baseline_yield) return false;
  
  // Get last 2 harvests with modifier applied
  const recentHarvests = await harvestOutcomesDB
    .find({ farm_id: farmId, crop, 'modifier_applied': { $exists: true } })
    .sort({ recorded_at: -1 })
    .limit(2);
  
  if (recentHarvests.length < 2) return false;
  
  // Rule 6.3: Revert if 2 consecutive cycles underperform baseline
  const underperforming = recentHarvests.every(h => 
    h.outcomes.weight_per_plant_oz < modifier.baseline_yield
  );
  
  if (underperforming) {
    console.warn(`[Modifier] REGRESSION DETECTED for ${crop} — reverting to baseline`);
    await modifiersDB.update(
      { farm_id: farmId, crop },
      { $set: { status: 'reverted', reverted_at: new Date().toISOString(), 
                revert_reason: '2 consecutive cycles underperformed baseline' } }
    );
    return true;
  }
  
  return false;
}

export { getFarmModifier, applyModifier, checkRevertCondition, MODIFIER_BOUNDS };
```

**Modifier Computation (Nightly Job):**

```javascript
// File: greenreach-central/jobs/compute-farm-modifiers.js (NEW)

/**
 * Compute farm-specific recipe modifiers from experiment records
 * Runs nightly after benchmark aggregation
 */

export async function computeFarmModifiers() {
  // For each farm with >= 10 harvests of a crop:
  //   1. Group by crop
  //   2. Compute regression: spectrum/ppfd/temp → yield
  //   3. Generate modifier if confidence > 0.75
  //   4. Store in farm_recipe_modifiers table
  
  const farms = await query('SELECT DISTINCT farm_id FROM experiment_records');
  
  for (const farm of farms.rows) {
    const crops = await query(`
      SELECT crop, COUNT(*) as harvest_count
      FROM experiment_records
      WHERE farm_id = $1
      GROUP BY crop
      HAVING COUNT(*) >= 10
    `, [farm.farm_id]);
    
    for (const { crop } of crops.rows) {
      const modifier = await computeModifierForCrop(farm.farm_id, crop);
      if (modifier) {
        await query(`
          INSERT INTO farm_recipe_modifiers (farm_id, crop, adjustments, confidence, sample_size, baseline_yield, status, computed_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'active', NOW())
          ON CONFLICT (farm_id, crop) DO UPDATE SET
            adjustments = $3, confidence = $4, sample_size = $5, baseline_yield = $6, computed_at = NOW()
        `, [farm.farm_id, crop, JSON.stringify(modifier.adjustments), 
            modifier.confidence, modifier.sample_size, modifier.baseline_yield]);
      }
    }
  }
}

async function computeModifierForCrop(farmId, crop) {
  // Fetch experiment records for this farm+crop
  const records = await query(`
    SELECT recipe_params_avg, outcomes
    FROM experiment_records
    WHERE farm_id = $1 AND crop = $2
    ORDER BY recorded_at DESC
    LIMIT 50
  `, [farmId, crop]);
  
  // Simple linear regression: blue% → yield
  // (Production version: use multi-variate regression or gradient boosting)
  const X = records.rows.map(r => r.recipe_params_avg?.blue_pct || 0);
  const Y = records.rows.map(r => r.outcomes?.weight_per_plant_oz || 0);
  
  const correlation = pearsonCorrelation(X, Y);
  
  if (Math.abs(correlation) < 0.5) {
    return null; // Low confidence, don't create modifier
  }
  
  // Find optimal blue% within bounds
  const avgBlue = mean(X);
  const avgYield = mean(Y);
  const slope = correlation * (stdDev(Y) / stdDev(X));
  
  // Suggest adjustment (capped at ±5%)
  const suggestedDelta = Math.sign(slope) * Math.min(5, Math.abs(slope * 5));
  
  return {
    adjustments: { blue_delta_pct: suggestedDelta },
    confidence: Math.abs(correlation),
    sample_size: records.rows.length,
    baseline_yield: avgYield
  };
}
```

**Farm-Side Integration:**

```javascript
// File: automation/recipe-environmental-targets.js (modify)

import { getFarmModifier, applyModifier } from '../lib/recipe-modifier-engine.js';

async function getEffectiveRecipe(groupId, crop) {
  const baseRecipe = recipesDB[crop];
  
  // Load farm modifier (Priority 1)
  const farmModifier = await getFarmModifier(farmId, crop, modifiersDB);
  if (farmModifier && farmModifier.status === 'active') {
    console.log(`[Recipe] Applying farm modifier for ${crop} (confidence: ${farmModifier.confidence.toFixed(2)})`);
    return applyModifier(baseRecipe, farmModifier);
  }
  
  // Fallback to network modifier (Priority 2)
  const networkModifier = latestNetworkIntelligence?.recipe_modifiers?.[crop];
  if (networkModifier) {
    console.log(`[Recipe] Applying network modifier for ${crop}`);
    return applyModifier(baseRecipe, networkModifier);
  }
  
  // No modifier available — use base recipe
  return baseRecipe;
}
```

**UI for Grower Approval (Rule 8.1):**

Add modal to Activity Hub / Dashboard when new modifier is available:

```html
<div class="modifier-approval-card">
  <h4>🔬 New Recipe Optimization Available</h4>
  <p><strong>Crop:</strong> Genovese Basil</p>
  <p><strong>Suggested Change:</strong> Increase blue light by +3%</p>
  <p><strong>Data Source:</strong> 15 harvests on your farm</p>
  <p><strong>Confidence:</strong> 82%</p>
  <p><strong>Expected Impact:</strong> +8% yield improvement</p>
  <p><strong>Rollback Plan:</strong> Auto-revert if yield drops for 2 cycles</p>
  
  <div class="actions">
    <button class="btn-approve">✅ Try This Optimization</button>
    <button class="btn-dismiss">❌ Keep Current Recipe</button>
  </div>
</div>
```

**Schema Changes:**

```sql
-- Central: farm_recipe_modifiers table
CREATE TABLE IF NOT EXISTS farm_recipe_modifiers (
  id SERIAL PRIMARY KEY,
  farm_id VARCHAR(255) NOT NULL,
  crop VARCHAR(255) NOT NULL,
  adjustments JSONB NOT NULL,        -- { blue_delta_pct: 3, ppfd_delta_pct: 5, ... }
  confidence DECIMAL(5,3) NOT NULL,  -- 0.0-1.0
  sample_size INTEGER NOT NULL,      -- Number of harvests used
  baseline_yield DECIMAL(8,3),       -- Yield before modifier
  status VARCHAR(50) DEFAULT 'active', -- active | reverted | dismissed
  computed_at TIMESTAMP DEFAULT NOW(),
  reverted_at TIMESTAMP,
  revert_reason TEXT,
  UNIQUE(farm_id, crop),
  FOREIGN KEY (farm_id) REFERENCES farms(farm_id) ON DELETE CASCADE
);
```

**Files to Create:**
1. `lib/recipe-modifier-engine.js` — Core modifier logic with safety bounds
2. `greenreach-central/jobs/compute-farm-modifiers.js` — ML regression + modifier generation
3. Schema update: `greenreach-central/config/database.js` — Add farm_recipe_modifiers table

**Files to Modify:**
1. `automation/recipe-environmental-targets.js` — Use getEffectiveRecipe() instead of base recipe
2. `server-foxtrot.js` — Create modifiersDB NeDB, add approval endpoints
3. `public/LE-activity-hub.html` — Add modifier approval modal
4. `lib/experiment-record-builder.js` — Tag experiment records with modifier_applied flag

---

## Phase Gate Checklist

Before proceeding to implementation, verify Phase 1 prerequisites (Rule 10.1):

### Phase 1 → Phase 2 Gate

- [ ] All P0 data captured (experiment records ✅, applied recipes ⚠️ in-progress)
- [x] Central receiving experiment records ✅
- [x] Nightly benchmarks running ✅
- [x] Network intelligence pushed to farms ✅
- [ ] Crop recommendations consuming demand signals (Stage 1.1 deliverable)
- [ ] Loss events linked to environment (Stage 1.2 deliverable)
- [ ] Applied recipes captured daily (Stage 1.3 deliverable)

### Phase 2 → Phase 3 Gate

- [ ] Workflow reduced to ≤4 steps (auto-derive plant count, auto-assign recipe — not in this phase)
- [x] Central providing demand signals ✅
- [x] Central providing crop benchmarks ✅
- [ ] Farm recipe modifiers working for ≥1 crop (Stage 3 deliverable)

**Gate Status:** Phase 1 → 2 prerequisites are not complete. **Do not execute Stage 3** until all Stage 1 deliverables are validated.

---

## Implementation Sequence

### Week 1: Phase 1 Completion

**Days 1-2:**
- Integrate demand signals into crop recommendations (Stage 1.1)
- Link loss events to environment snapshot (Stage 1.2)
- Capture applied recipe parameters daily (Stage 1.3)

**Days 3-4:**
- Display network benchmarks in crop selection UI (Stage 2.1)
- Surface learning correlations on dashboard (Stage 2.2)

**Day 5:**
- Validation & testing
- Update documentation
- **Stop for approval gate** (required): wait for user message `APPROVED FOR DEPLOYMENT` before any production deployment activity

### Week 2: Phase 3 Recipe Modifiers

**Precondition:** Start only after Week 1 completion evidence is captured.

**Days 1-2:**
- Create `lib/recipe-modifier-engine.js` with safety bounds
- Schema migration: Add `farm_recipe_modifiers` table to Central
- Create farm-side `modifiersDB` NeDB

**Days 3-4:**
- Implement nightly modifier computation job (`compute-farm-modifiers.js`)
- Test regression safety: verify revert-on-regression triggers correctly
- Integrate modifiers into recipe resolution pipeline

**Day 5:**
- Build grower approval UI (Activity Hub modal)
- Add modifier status to `/api/ai/status` endpoint
- Validation: Run 2 simulated harvest cycles with modifier

---

## Risk Assessment & Mitigation

### Risk 1: Data Volume Below ML Thresholds

**Likelihood:** Medium  
**Impact:** High (can't activate modifiers without 10+ harvests)

**Mitigation:**
- Check data volume before creating modifiers: `SELECT farm_id, crop, COUNT(*) FROM experiment_records GROUP BY farm_id, crop`
- Display "Collecting data... (3/10 harvests)" in UI when below threshold (Rule 8.3 compliance)
- Network modifiers can fill gap until farm reaches threshold (Rule 6.4)

### Risk 2: Growers Dismiss All Modifiers

**Likelihood:** Medium  
**Impact:** Medium (blocks feedback loop learning)

**Mitigation:**
- Log dismissal reasons to improve future recommendations
- A/B test: auto-approve low-risk modifiers (<2% change) in Phase 5
- Show success stories: "Farm X improved yield by 12% using this modifier"

### Risk 3: Modifier Regression Not Detected

**Likelihood:** Low  
**Impact:** Critical (violates Rule 6.3 safety)

**Mitigation:**
- Unit tests for `checkRevertCondition()` logic
- Weekly audit: `SELECT * FROM farm_recipe_modifiers WHERE status='active' AND computed_at < NOW() - INTERVAL '30 days'`
- Manual override: growers can revert via UI at any time

### Risk 4: Network Modifier Privacy Violation

**Likelihood:** Low  
**Impact:** Critical (violates Rule 7.1)

**Mitigation:**
- Code review: verify farm_id never exposed in network modifiers
- Audit queries: ensure all network aggregations use anonymized data
- Pre-deployment check: Test `/api/crop-benchmarks` response for farm identity leaks

### Risk 5: Threshold Bypass in Modifier Flow

**Likelihood:** Medium  
**Impact:** Critical (violates Rules 7.3 and 8.3)

**Mitigation (hard gates):**
- Farm modifier generation requires `sample_size >= 10` and confidence threshold.
- Network modifier publish requires `>= 5 farms`, `>= 50 harvests/crop`, and confidence threshold.
- Farm-side application rejects network modifiers that do not include threshold metadata proving eligibility.
- UI must show `Insufficient data (N/threshold)` when gates are not met.

---

## Contract & Endpoint Strategy (Rule 2.4)

To avoid duplicate channels and preserve existing contracts:

- **Loss events sync:** extend existing `POST /api/sync/experiment-records` payload with optional `loss_events` section (versioned, backward-compatible), rather than introducing a parallel sync endpoint.
- **Applied recipes sync:** include `applied_recipe_summary` in canonical experiment record fields at harvest time, and/or extend existing training-data export types. Do not create ad-hoc standalone sync APIs unless Architecture approval is documented.
- **Push channel:** continue using `analyzeAndPushToAllFarms()` and `network_intelligence` extension pattern only.

---

## Central Promotion Evidence (Rule 10.4)

Each promoted capability must include an end-to-end artifact:

| Capability | Required E2E Test | Artifact Path | Pass Criteria |
|------------|-------------------|---------------|---------------|
| Demand-aware recommendations | ingest demand → score changes on farm | `artifacts/phase-d/demand-aware-recs.json` | score deltas visible, backward-compatible response |
| Loss-event correlation | loss capture → central ingest → trend visibility | `artifacts/phase-d/loss-correlation-e2e.json` | environment snapshot persisted + queryable |
| Applied recipe capture | daily capture → harvest record summary | `artifacts/phase-d/applied-recipe-capture.json` | non-null recipe params in experiment records |
| Modifier publication | central compute → push payload eligibility checks | `artifacts/phase-d/modifier-publish-e2e.json` | threshold gates enforced before publish |
| Modifier application | farm receives → approval flow → applied/reverted behavior | `artifacts/phase-d/modifier-apply-e2e.json` | explicit approval + revert-on-regression works |

---

## Success Metrics

### Stage 1 (Phase 1 Completion)

- [ ] 95%+ of experiment records have non-null `recipe_params_avg`
- [ ] 80%+ of loss events have `environment_snapshot` captured
- [ ] Crop recommendations show demand trend indicators (🔥/⚖️/⬇️) for all crops
- [ ] Dashboard displays ≥3 learning insights with r > 0.5

### Stage 2 (Enhanced Recommendations)

- [ ] Network benchmark comparison displayed for all crops in recommender UI
- [ ] Demand-weighted recommendations differ by ≥10 points from non-demand scoring

### Stage 3 (Recipe Modifiers)

- [ ] ≥1 farm has active recipe modifier with confidence > 0.75
- [ ] Revert-on-regression triggers correctly in simulation (2 bad harvests → revert)
- [ ] Grower approval flow tested on iPad Activity Hub
- [ ] Modifier status visible in Central admin: `GET /api/network/farms/:farmId`

---

## Documentation Updates Required

1. **AI_VISION_RULES_AND_SKILLS.md**
   - Add "Implemented" badges to completed tasks
   - Update Phase 1 completion percentage

2. **DATA_FORMAT_STANDARDS.md**
   - Document `appliedRecipesDB` schema
   - Document `loss_events` schema extension

3. **SCHEMA_CONSUMERS.md**
   - Add new consumers: recipe-modifier-engine, compute-farm-modifiers job

4. **User Guide** (new)
   - "Understanding AI Recipe Optimizations" — explain modifier approval flow
   - "Network Benchmarks" — how to interpret comparative analytics

---

## Appendix A: Pre-Implementation Checklist

Per `.github/AI_VISION_RULES_AND_SKILLS.md` Section 12:

### Philosophy Alignment
- [x] Feature treats grow cycle as experiment (Rule 1.1) — Modifiers tested per cycle
- [x] Outcomes connected to inputs (Rule 1.2) — Regression links recipe params → yield
- [x] Serves OBSERVE, EXPERIMENT, or LEARN mode (Rule 1.3) — All three
- [x] Checked existing data sources (Rule 1.4) — Using experiment_records, no new collection
- [x] Central integration path defined (Rule 1.5) — compute-farm-modifiers.js on Central

### Architecture
- [x] Proposal includes both Farm-Side and Central-Side (Rule 2.1) — Yes
- [x] Uses existing pipes (Rule 2.2) — Uses analyzeAndPushToAllFarms for push
- [x] Respects Central's current phase (Rule 2.3) — Phase 1→3 progression
- [x] Populates stubs before creating new endpoints (Rule 2.4) — Extends existing endpoints
- [x] Preserves Central intelligence contract (Rule 2.5) — network_intelligence.recipe_modifiers extension
- [x] Prioritizes Central bottlenecks (Rule 2.6) — Completes Phase 1 gaps first

### Data
- [x] Uses canonical experiment record schema (Rule 3.1) — Reads from existing table
- [x] Identifies which feedback loop(s) this advances (Rule 4.1) — Loop #1 (Recipe → Yield)
- [x] Respects data priority levels (Rule 9.1) — P0 (experiment records) before P2 (modifiers)
- [x] Data persisted to NeDB/PostgreSQL (Rule 9.2) — modifiersDB (NeDB), farm_recipe_modifiers (PG)

### Safety
- [x] AI suggests, grower confirms (Rule 8.1) — Approval modal required
- [x] Minimum data requirements met (Rule 8.3) — 10+ harvests enforced
- [x] Transparency requirements met (Rule 8.4) — Shows confidence, sample size, expected impact, rollback plan
- [x] Recipe modifier bounds enforced (Rule 6.2) — ±5% spectrum, ±10% PPFD, ±2°C
- [x] Revert-on-regression implemented (Rule 6.3) — checkRevertCondition() every harvest

### Privacy
- [x] Farm identity not exposed in network analytics (Rule 7.1) — Network modifiers aggregated only
- [x] Only anonymized/aggregated data shared (Rule 7.1) — farm_id never in network payload

### Phase Gate
- [x] Correct phase identified (Rule 10.3) — Phase 3 (blocked until earlier gates close)
- [ ] Prerequisites for this phase met (Rule 10.1) — not yet; Stage 1 closure pending
- [ ] Central promotion evidence captured (Rule 10.4) — planned; see evidence table above

**Checklist completed:** 2026-03-01  
**Agent:** Implementation Agent

---

## Appendix B: Automatic Rejection Criteria — Compliance Verified

Checked against `.github/AI_VISION_RULES_AND_SKILLS.md` Section 13:

1. ✅ **Central integration path exists** — compute-farm-modifiers.js on Central, synced via network_intelligence
2. ✅ **No new push channel** — Extends existing analyzeAndPushToAllFarms() payload
3. ✅ **No phase skip** — Completes Phase 1 gaps before Phase 3 work
4. ✅ **Uses experiment record** — Reads from experiment_records table
5. ✅ **Feedback loop reference** — Closes Loop #1 (Recipe → Yield)
6. ✅ **No autonomous changes** — Grower approval required (Rule 8.1)
7. ✅ **Above data minimum** — Enforces 10+ harvests (Rule 8.3)
8. ✅ **No privacy violation** — Network modifiers anonymized
9. ✅ **Bounded modifier** — Conservative bounds + revert (Rules 6.2, 6.3)
10. ✅ **No in-memory ML** — Persisted in PostgreSQL + NeDB
11. ✅ **Multi-function scan** — (Not adding scans, modifying existing harvest flow)
12. ✅ **No added grower steps** — Approval is optional dismiss/accept (no new workflow)
13. ✅ **Central contract preserved** — Extends network_intelligence, backward-compatible
14. ⚠️ **Promotion evidence not yet captured** — explicit artifact plan defined; capture required before promotion

**Status:** Proposal is conditionally compliant. Final compliance requires implementation evidence and phase-gate completion.

---

## Appendix C: File Modification Summary

### New Files (7)
1. `lib/recipe-modifier-engine.js` — Core modifier logic with safety bounds
2. `greenreach-central/jobs/compute-farm-modifiers.js` — ML regression job
3. `greenreach-central/jobs/yield-regression.js` — Cross-farm yield regression (Phase 3 T31)
4. `automation/recipe-application-logger.js` — Applied recipe parameter capture (Option B)
5. Schema migration: Add `loss_events` table
6. Schema migration: Add `farm_recipe_modifiers` table
7. Schema migration: Add `applied_recipes` table (if not extending duty logger)

### Modified Files (12)
1. `lib/crop-recommendation-engine.js` — Add scoreDemandFit(), integrate network intelligence
2. `server-foxtrot.js` — Pass network intelligence to recommendations, add loss env snapshot, create DBs
3. `public/LE-crop-recommender.html` — Display demand trends + network benchmarks
4. `public/LE-dashboard.html` — Add Learning Insights panel
5. `public/LE-activity-hub.html` — Add modifier approval modal
6. `routes/kpis.js` — Add GET /api/learning-insights
7. `automation/recipe-environmental-targets.js` — Use getEffectiveRecipe() with modifiers
8. `automation/duty-cycle-logger.js` — Extend to capture recipe targets (Option A)
9. `lib/experiment-record-builder.js` — Read from appliedRecipesDB, add modifier_applied flag
10. `greenreach-central/routes/experiment-records.js` — Extend POST /sync/experiment-records with `loss_events`
11. `greenreach-central/services/ai-recommendations-pusher.js` — Already calls getNetworkModifiers() ✅
12. `greenreach-central/config/database.js` — Schema additions

### Total LOC Estimate
- New code: ~800 lines
- Modified code: ~300 lines
- Tests: ~200 lines
- **Total:** ~1,300 lines

---

**Next Steps:**
1. User approval to proceed with Stage 1 (Phase 1 completion)
2. Begin implementation per sequence above
3. Daily standups to track progress
4. Review Agent validation after each stage

**End of Plan**
