# AI-Powered Crop Recommendation System - Architecture Proposal

**Status**: 🔴 **REQUIRES ARCHITECTURE AGENT REVIEW**  
**Priority**: High - Core farm planning feature  
**Complexity**: High - Multi-objective optimization with ML  
**Current State**: Simple fallback (replant same crop)  

---

## Problem Statement

The planting scheduler currently recommends replanting the same crop in each tray location. This naive approach fails to optimize for:

1. **Revenue** - doesn't consider which crops are selling
2. **Operations** - causes harvest clustering and labor bottlenecks
3. **Resource utilization** - ignores nutrient compatibility and lighting capacity
4. **Scale** - won't work for farms with 100-500+ trays

**Real-world scenario**: A farm with 200 trays of buttercrunch lettuce harvests everything in week 5, overwhelming staff and causing fulfillment delays, while buyers are waiting for arugula that's out of stock.

---

## Requirements

### 1. Demand-Driven Planning (Revenue Optimization)

**Data Sources**:
- `GET /api/wholesale/orders` - Historical order patterns
- `GET /api/wholesale/buyers` - Active buyers and preferences
- Sales velocity by SKU (units/week)
- Buyer type segmentation (restaurant vs retailer)

**Intelligence Needed**:
- Forecast demand 2-6 weeks ahead
- Identify trending crops (rising/falling demand)
- Account for seasonal patterns (salads in summer, kale in winter)
- Match production to buyer commitments (recurring orders)

**Output**: Demand score per crop (0-100)

### 2. Harvest Staggering (Operations Optimization)

**Data Sources**:
- Current tray inventory (`/api/inventory/current`)
- Expected harvest dates by crop
- Labor capacity (staffing schedule)
- Fulfillment throughput (cases/day)

**Intelligence Needed**:
- Identify harvest clustering (>30% of trays harvesting same week)
- Calculate labor load curve (hours/day over next 6 weeks)
- Recommend seeding offsets to smooth workload
- Prevent same-crop monoculture across all zones

**Output**: Stagger score per crop per tray (0-100)

### 3. Nutrient Compatibility (Resource Constraints)

**Data Sources**:
- Zone/group configuration (`/data/groups.json`)
- Crop nutrient profiles (`/data/lighting-recipes.json` + nutrient specs)
- Current reservoir settings (EC, pH)

**Constraints**:
| Crop Category | EC Range | pH Range | Compatible |
|--------------|----------|----------|------------|
| Leafy Greens | 1.2-1.8  | 5.5-6.0  | ✅ Lettuce, Kale, Chard |
| Herbs        | 1.0-1.6  | 5.5-6.5  | ✅ Basil, Cilantro |
| Fruiting     | 2.0-3.5  | 5.8-6.3  | ✅ Tomatoes, Peppers |

**Rule**: Cannot recommend tomatoes (EC 2.5) in a zone currently growing lettuce (EC 1.5) unless reservoir can be isolated.

**Output**: Compatibility boolean per crop per zone

### 4. Lighting Optimization (Capacity Utilization)

**Data Sources**:
- Zone DLI capacity (LED fixture specs)
- Current DLI target by group
- Crop light requirements (`/data/lighting-recipes.json`)

**Intelligence Needed**:
- Avoid high-light crops (DLI 25) in low-capacity zones (DLI 18 max)
- Maximize photon utilization - don't waste high-DLI zones on shade crops
- Balance spectrum needs (R/B ratio) across co-located groups

**Output**: Light efficiency score per crop per zone (0-100)

### 5. Crop Rotation & Variety

**Data Sources**:
- Historical crop assignments per tray (past 6 months)
- Crop family taxonomy (Brassicas, Solanaceae, etc.)

**Best Practices**:
- Rotate crop families every 2-3 cycles (pest/disease management)
- Vary varieties within types (5 lettuce varieties, not all buttercrunch)
- Avoid continuous monoculture (nutrient depletion)

**Output**: Rotation score per crop (0-100)

---

## Proposed Architecture

### Backend Service: Intelligent Planner

**Endpoint**: `POST /api/planting/recommendations`

**Request**:
```json
{
  "farmId": "FARM-001",
  "targetDate": "2026-03-01",
  "zoneId": "Zone-A-1",  // Optional: filter by zone
  "constraints": {
    "maxHarvestPerWeek": 50,  // Cases
    "laborHoursAvailable": 40,
    "prioritizeCrops": ["crop-buttercrunch-lettuce"]
  }
}
```

**Response**:
```json
{
  "recommendations": [
    {
      "trayId": "T1",
      "currentCrop": "crop-bibb-butterhead",
      "recommendedCrop": "crop-astro-arugula",
      "confidence": 0.87,
      "reasoning": {
        "demandScore": 92,
        "staggerScore": 85,
        "compatibilityScore": 100,
        "lightScore": 78,
        "rotationScore": 95,
        "overallScore": 90
      },
      "alternativeCrops": [
        {
          "cropId": "crop-buttercrunch-lettuce",
          "score": 82,
          "reason": "Good demand, but 12 trays already seeded this week"
        }
      ],
      "seedingWindow": {
        "earliest": "2026-02-18",
        "target": "2026-02-20",
        "latest": "2026-02-22"
      },
      "expectedHarvest": "2026-03-22",
      "estimatedRevenue": 45.00  // USD
    }
  ],
  "summary": {
    "totalTrays": 48,
    "harvestForecast": {
      "week1": 8,
      "week2": 12,
      "week3": 15,
      "week4": 13
    },
    "revenueProjection": 2160.00
  }
}
```

### ML Model Architecture

**Model Type**: Multi-objective optimization with gradient boosting

**Training Data**:
- Historical features: Sales patterns, weather, crop performance
- Target labels: Actual revenue, labor hours, customer satisfaction

**Feature Engineering**:
- Time series: 12-week sales rolling average per crop
- Categorical: Crop family, growth stage, season, buyer type
- Numerical: DLI capacity, EC/pH deltas, tray count per crop

**Optimization Objectives**:
1. Maximize revenue (demand matching) - Weight: 40%
2. Minimize harvest clustering (labor smoothing) - Weight: 30%
3. Maximize resource utilization (light/nutrients) - Weight: 20%
4. Maintain diversity (rotation) - Weight: 10%

**Constraints (Hard)**:
- Nutrient compatibility within zones
- Lighting capacity per zone
- Physical tray availability

**Model Training Pipeline**:
1. Data collection: 6 months historical (orders, harvests, sensors)
2. Feature extraction: Weekly aggregations, zone groupings
3. Model training: XGBoost with custom loss function
4. Validation: Backtesting on historical data (precision@k)
5. Deployment: Docker container, GPU optional, 100ms inference

**Retraining Cadence**: Weekly with new sales data

---

## Implementation Phases

### Phase 1: Data Pipeline (2 weeks)
- [ ] Create unified sales data API
- [ ] Build historical harvest tracking
- [ ] Implement crop performance metrics
- [ ] Set up data warehouse (TimescaleDB or similar)

### Phase 2: Rule-Based Baseline (1 week)
- [ ] Implement constraint checking (nutrients, lighting)
- [ ] Add simple heuristics (avoid clustering, rotate families)
- [ ] A/B test against "same crop" baseline
- [ ] Measure: Revenue impact, harvest smoothness

### Phase 3: ML Model v1 (4 weeks)
- [ ] Train demand forecasting model
- [ ] Implement multi-objective scoring function
- [ ] Build recommendation engine with top-k selection
- [ ] Deploy as microservice with caching

### Phase 4: Refinement (Ongoing)
- [ ] Add user feedback loop (accept/reject recommendations)
- [ ] Incorporate real-time market data (pricing APIs)
- [ ] Optimize for inventory turns and waste reduction
- [ ] Expand to 12-week planning horizon

---

## Success Metrics

**Primary KPIs**:
1. **Revenue per square foot**: +15% improvement (better demand matching)
2. **Harvest labor efficiency**: -25% peak hour variance (smoothed workload)
3. **Crop fill rate**: >95% (fewer out-of-stock events)

**Secondary Metrics**:
- Recommendation acceptance rate: >70%
- Model confidence correlation with actual outcomes: R² > 0.75
- Inference time: <200ms for 500-tray farm

---

## Risk & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Insufficient training data | High | Start with rule-based system, collect data for 3 months |
| Model overfits to specific farm | Medium | Train on multi-farm dataset when available |
| Recommendations rejected by growers | High | Provide reasoning, allow overrides, learn from feedback |
| Computational cost at scale | Medium | Pre-compute recommendations, cache for 1 hour |

---

## Integration Points

**Existing Systems**:
- Planting Scheduler UI: Display recommendations with reasoning
- Wholesale API: Pull sales data, buyer preferences
- Farm Profile: Zone configurations, equipment specs
- Lighting Recipes: Crop requirements, growth schedules

**New Endpoints Needed**:
- `POST /api/planting/recommendations` - Main recommendation engine
- `POST /api/planting/feedback` - User accepts/rejects (training signal)
- `GET /api/analytics/demand-forecast` - Crop demand predictions
- `GET /api/analytics/harvest-forecast` - Expected harvest timeline

---

## Database Schema Changes

**New Tables**:

```sql
-- Track recommendation history
CREATE TABLE planting_recommendations (
  id SERIAL PRIMARY KEY,
  farm_id TEXT NOT NULL,
  tray_id TEXT NOT NULL,
  recommended_crop TEXT NOT NULL,
  recommended_date DATE NOT NULL,
  confidence FLOAT,
  demand_score FLOAT,
  stagger_score FLOAT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Track user decisions
CREATE TABLE planting_decisions (
  id SERIAL PRIMARY KEY,
  recommendation_id INTEGER REFERENCES planting_recommendations(id),
  action TEXT, -- 'accepted', 'rejected', 'modified'
  actual_crop TEXT, -- What was actually planted
  actual_date DATE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Crop demand forecasts
CREATE TABLE demand_forecasts (
  id SERIAL PRIMARY KEY,
  crop_id TEXT NOT NULL,
  forecast_date DATE NOT NULL,
  predicted_units FLOAT,
  confidence_interval FLOAT,
  model_version TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(crop_id, forecast_date, model_version)
);
```

---

## Questions for Architecture Agent

1. **ML Framework**: Use existing cloud ML (AWS SageMaker) or self-hosted (TensorFlow Serving)?
2. **Real-time vs Batch**: Compute recommendations on-demand or pre-generate daily?
3. **Multi-tenancy**: Single model for all farms or per-farm models?
4. **Explainability**: How much reasoning to show users? (Simple vs detailed)
5. **Feedback Loop**: Immediate model updates or weekly retraining?
6. **Scale**: Design for 10 farms or 1000 farms?

---

## Next Steps

**For Implementation Agent**:
1. Add comprehensive documentation to planting-scheduler.html (✅ DONE)
2. Create stub endpoint `/api/planting/recommendations` returning simple fallback
3. Implement constraint checking (nutrient compatibility, lighting capacity)

**For Review Agent**:
1. Validate requirements completeness
2. Identify missing data sources
3. Review technical feasibility of ML approach

**For Architecture Agent** (PRIMARY):
1. Design ML system architecture
2. Select frameworks and infrastructure
3. Define data pipeline and model training workflow
4. Estimate development timeline and resources
5. Approve implementation plan

---

**Document Status**: Draft - Awaiting Architecture Agent Review  
**Created**: 2026-02-04  
**Author**: Implementation Agent  
**Reviewers**: Architecture Agent (required), Review Agent (recommended)
