# AI Market Intelligence & Crop Pricing — Implementation Strategy

> **Status:** Draft for review  
> **Date:** March 19, 2026  
> **Scope:** Wire AI into crop pricing recommendations and market demand forecasting

---

## Current State

| Component | Status | Data Source |
|-----------|--------|-------------|
| Market trends (6 crops) | Hardcoded in `MARKET_DATA_SOURCES` | Static Jan 2026 prices & trends |
| Crop pricing (60+ crops) | Manual entry via UI | `farmStore` per-farm storage |
| Demand forecast | Arithmetic on hardcoded trends | No real data |
| Wholesale demand signals | **Implemented** — `analyzeDemandPatterns()` | `wholesale_orders` table (60-day window) |
| Price observation tables | **Created** — Migration 019 | Empty, no ingestion pipeline |
| AI cost tracking | **Running** — `trackAiUsage()` | `ai_usage` table |
| OpenAI client | **Running** — TTS + AI Pusher | `gpt-4o-mini`, `tts-1-hd` |

### What's already wired and working
- `recordPriceObservation(pool, { product, retailer, price_cad, unit, source })` — ready to accept data
- `refreshPriceTrends(pool)` — computes 7d/30d trends from observations
- `POST /api/market-intelligence/observations` — endpoint accepts price data
- `POST /api/market-intelligence/refresh-trends` — triggers trend recomputation
- `analyzeDemandPatterns()` — aggregates wholesale order trends by crop (30/60-day windows)
- `trackAiUsage()` — logs all AI calls with token counts and cost
- Background scheduler pattern — `setInterval` in `server.js` (30-min AI pusher, weekly planner, etc.)
- `crop-registry.json` — 60+ crops with pricing, growth data, and `market.resolveAs` field for name mapping

### What's broken
- `farm-admin.html` demand forecast chart used `data.ok` / `data.forecasts` — backend returns `data.success` / `data.data.forecast` (fixed in latest deploy but chart data is now trend-% not quantities)
- `MARKET_DATA_SOURCES` hardcoded articles are fabricated, not real news
- No data refresh — the 6 crops and their trend percentages never change

---

## Implementation Phases

### Phase 1: Live Price Ingestion (no AI required)

**Goal:** Replace hardcoded prices with real observations flowing into `market_price_observations`.

#### 1A. USDA Market News API Integration
Create a background job that fetches USDA Agricultural Marketing Service (AMS) data daily.

- **API:** `https://marketnews.usda.gov/mnp/api/` (free, no key required for basic terminal market reports)
- **Data available:** Daily terminal market prices for fresh produce (Boston, New York, Toronto crossings)
- **Crops mapped:** Tomatoes, lettuce (iceberg, romaine, butterhead), spinach, kale, arugula, basil, herbs
- **Frequency:** Once daily at 6 AM ET (after USDA publishes overnight)

**New file:** `services/market-data-fetcher.js`
```
fetchUSDATerminalPrices()
  → parse JSON response
  → for each product: recordPriceObservation(pool, { product, retailer: 'USDA Terminal', price_cad, unit, source: 'api' })
  → refreshPriceTrends(pool)
```

**Wire into server.js:** Add to background services block alongside existing schedulers.

**CAD conversion:** Use Bank of Canada daily rate or hardcode 1.36 (review quarterly).

**Estimated effort:** 1 day  
**Cost:** Free (USDA API is public)

#### 1B. Expand Crop Coverage
The current `MARKET_DATA_SOURCES` tracks 6 crops. `crop-registry.json` has 60+. Map the registry's `market.resolveAs` field to USDA commodity codes so all growing crops get price tracking.

**New file:** `data/usda-crop-mapping.json`
```json
{
  "Basil": { "usda_commodity": "BASIL", "usda_group": "HERBS" },
  "Bibb Butterhead": { "usda_commodity": "LETTUCE, BIBB TYPE", "usda_group": "LETTUCE" },
  ...
}
```

**Estimated effort:** Half day (data mapping exercise)

#### 1C. Retire Hardcoded Fallback
Once observations accumulate (7+ days), `getMarketDataAsync(pool)` already prefers DB data. After confirming live data flows:
- Change `getMarketData()` to log a deprecation warning
- All callers should migrate to `getMarketDataAsync(pool)`
- Keep `MARKET_DATA_SOURCES` as seed/fallback for new deployments only

**Estimated effort:** Half day

---

### Phase 2: AI Market Analysis

**Goal:** Use GPT-4o-mini to interpret price trends and generate actionable market intelligence.

#### 2A. Market Analysis Agent
New background job (runs daily after price ingestion completes).

**New file:** `services/market-analysis-agent.js`

**Input payload to GPT-4o-mini:**
```
You are a market analyst for a Canadian indoor vertical farm growing {crop_list}.

Current price observations (last 7 days):
{price_data_table}

Historical trends (30 days):
{trend_data_table}

Wholesale network demand signals:
{demand_patterns from analyzeDemandPatterns()}

Provide for each crop:
1. Market outlook (1 sentence)
2. Confidence: high/medium/low
3. Recommended action: increase_production / maintain / reduce_production
4. Price direction: rising / stable / falling
```

**Output stored to:** New `market_ai_analysis` table
```sql
CREATE TABLE market_ai_analysis (
  id SERIAL PRIMARY KEY,
  product VARCHAR(100) NOT NULL,
  outlook TEXT,
  confidence VARCHAR(20),
  recommended_action VARCHAR(50),
  price_direction VARCHAR(20),
  reasoning TEXT,
  model VARCHAR(50),
  token_cost NUMERIC(8,4),
  analyzed_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Cost tracking:** Via existing `trackAiUsage()` — endpoint `'market-analysis'`.

**Schedule:** Daily at 7 AM ET (after USDA fetch at 6 AM).

**Estimated cost:** ~$0.01/day (6 crops × ~500 tokens each × gpt-4o-mini pricing).  
At 60 crops: ~$0.08/day ($2.40/month).

**Estimated effort:** 1 day

#### 2B. Wire AI Analysis into Demand Forecast Endpoint
Update `/api/planning/demand-forecast` to:
1. Query `market_ai_analysis` for latest analysis per crop
2. Merge with `market_price_trends` for quantitative data
3. Include `analyzeDemandPatterns()` for wholesale demand signals
4. Return combined intelligence:

```json
{
  "forecast": [{
    "product": "Basil",
    "trendPercent": 12.5,
    "trend": "increasing",
    "priceCAD": 5.82,
    "price7dChange": "+8.3%",
    "aiOutlook": "Strong demand expected — California frost reducing supply",
    "aiAction": "increase_production",
    "confidence": "high",
    "wholesaleDemand": { "network_total_qty": 45, "network_trend": "increasing" },
    "pricePerUnit": 35.00
  }],
  "averageTrend": 3.2,
  "dataFreshness": "2026-03-19T11:00:00Z",
  "source": "usda+ai"
}
```

**Estimated effort:** Half day

---

### Phase 3: AI Pricing Recommendations

**Goal:** Suggest pricing adjustments based on market conditions, cost data, and network demand.

#### 3A. Pricing Recommendation Engine
Extend the market analysis agent to generate pricing suggestions.

**Additional GPT prompt context:**
```
Current farm pricing (from crop-pricing store):
{crop: "Basil", retailPrice: 45.00, wholesalePrice: 35.00}

Farm cost survey data (from farm_cost_surveys table):
{crop: "Basil", cost_per_unit: 18.50}

Market terminal price: $5.82/lb (trending +8.3%)
Wholesale network demand: 45 units/month, increasing
Network supply: 3 farms growing, 120 units/month capacity

Suggest:
1. Optimal retail price (with reasoning)
2. Optimal wholesale price
3. Whether to adjust wholesale tier discounts
```

**Output delivered via:**
- Existing AI Pusher (`ai-recommendations-pusher.js`) — already pushes to all farms every 30 min
- Add pricing recommendations to the push payload alongside existing crop optimization tips
- Display in farm-admin.html pricing section

**Estimated effort:** 1 day  
**Estimated cost:** Additional ~$0.02/day on top of Phase 2

#### 3B. Pricing Authority Integration
The `pricing_offers` / `pricing_responses` tables from Migration 010 are designed for centralized pricing. Wire AI analysis as the source for pricing proposals:

```
AI analysis runs daily
  → generates pricing_offers rows (status: 'proposed')
  → farms review in UI (accept / reject / counter)
  → responses feed back into pricing_history
  → next day's AI analysis sees acceptance patterns
```

This creates a feedback loop: AI proposes → farmers respond → AI learns.

**Estimated effort:** 2 days (UI + backend)

---

### Phase 4: Demand-Aware Planting Scheduler

**Goal:** The planting scheduler uses real demand signals to recommend what to plant.

#### 4A. Connect Demand Signals to Scheduler
The planting scheduler currently shows a static Market Demand card. Replace with:

1. **Real wholesale demand** — from `analyzeDemandPatterns()` (already implemented)
2. **Market price trends** — from `market_price_trends` (live after Phase 1)
3. **AI outlook** — from `market_ai_analysis` (live after Phase 2)
4. **Farm capacity** — from existing `/api/planning/capacity` endpoint

Display in scheduler:
```
MARKET DEMAND: +3.2% avg trend
├── Basil: +12.5% ↗ (AI: increase production)
├── Romaine: -8.0% ↘ (AI: maintain — seasonal)
├── Tomatoes: +18% ↗ (AI: increase — supply shortage)
└── 3 crops stable
```

**Estimated effort:** 1 day

#### 4B. Smart Planting Recommendations
When a tray becomes available, suggest what to plant based on:
- Highest demand signal (wholesale orders + market trend)
- Best margin (market price - farm cost)
- Farm diversity (avoid overconcentration)
- Grow cycle timing (harvest before demand peak)

This is the `recommendations` endpoint in `planning.js` — currently only fires on Tomatoes (the sole "increasing" crop). After Phase 1-2, it would use live signals.

**Estimated effort:** Half day (endpoint logic already exists, just needs live data)

---

## Dependency Chain

```
Phase 1A ─── USDA price fetch ───────────────────┐
Phase 1B ─── Crop mapping ──────────────────────┐ │
Phase 1C ─── Retire hardcoded ──────────────────┤ │
                                                 ▼ ▼
Phase 2A ─── AI market analysis ────────────────────┐
Phase 2B ─── Wire into demand endpoint ─────────────┤
                                                     ▼
Phase 3A ─── AI pricing recommendations ────────────────┐
Phase 3B ─── Pricing authority feedback loop ───────────┤
                                                         ▼
Phase 4A ─── Demand-aware scheduler display ────────────────┐
Phase 4B ─── Smart planting recommendations ────────────────┘
```

**Phase 1 has no dependencies** — can start immediately.  
**Phase 2 depends on Phase 1** — needs live price data to analyze.  
**Phase 3 depends on Phase 2** — needs AI analysis to propose prices.  
**Phase 4 depends on Phase 2** — needs AI outlook for scheduler UI.

---

## Cost Summary

| Item | Monthly Cost | Notes |
|------|-------------|-------|
| USDA API | $0 | Free public API |
| GPT-4o-mini (market analysis) | ~$2.50 | 60 crops daily, ~500 tokens each |
| GPT-4o-mini (pricing recs) | ~$1.00 | Builds on same analysis call |
| Bank of Canada FX rate | $0 | Free public API |
| **Total incremental** | **~$3.50/month** | On top of existing AI Pusher + TTS costs |

---

## Files Modified / Created

| File | Action | Phase |
|------|--------|-------|
| `services/market-data-fetcher.js` | **Create** — USDA price ingestion job | 1A |
| `data/usda-crop-mapping.json` | **Create** — Crop name → USDA commodity map | 1B |
| `routes/market-intelligence.js` | **Edit** — Deprecate hardcoded fallback | 1C |
| `services/market-analysis-agent.js` | **Create** — GPT market analyst | 2A |
| `migrations/0XX_market_ai_analysis.sql` | **Create** — AI analysis table | 2A |
| `routes/planning.js` | **Edit** — Merge live data into demand-forecast | 2B |
| `services/ai-recommendations-pusher.js` | **Edit** — Add pricing recs to push payload | 3A |
| `routes/crop-pricing.js` | **Edit** — Surface AI pricing suggestions | 3A |
| `views/planting-scheduler.html` | **Edit** — Real demand display | 4A |
| `server.js` | **Edit** — Register new background jobs | 1A, 2A |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| USDA API downtime | No fresh prices for a day | Keep last-known-good in `market_price_trends`; alert via health check |
| GPT hallucinated market outlook | Bad recommendation to farmer | Always show source data alongside AI text; confidence rating; never auto-execute pricing changes |
| Low wholesale order volume | Demand signals unreliable | Weight demand signals by order count; show confidence based on sample size |
| Crop name mismatches | Missing price data | Use `crop-registry.json` `market.resolveAs` + manual USDA mapping; log unmapped crops |
| Cost creep from token usage | Budget overrun | Existing `ai_usage` table tracks every call; set monthly alert threshold |

---

## Recommended Execution Order

1. **Phase 1A** — Get real prices flowing (1 day). This unblocks everything.
2. **Phase 2A** — AI analysis (1 day). Highest user-visible impact.
3. **Phase 2B** — Wire into existing endpoints (half day). Immediate frontend improvement.
4. **Phase 4A** — Scheduler display (1 day). Completes the planting scheduler story.
5. **Phase 1B+1C** — Expand crops, retire hardcoded (1 day). Cleanup.
6. **Phase 3A** — Pricing recommendations (1 day). New capability.
7. **Phase 3B** — Pricing authority loop (2 days). Network-wide coordination.
8. **Phase 4B** — Smart planting (half day). Capstone — ties everything together.

**Total estimated effort:** ~8 working days across all phases.
