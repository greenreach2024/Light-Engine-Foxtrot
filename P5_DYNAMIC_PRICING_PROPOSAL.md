# P5: Dynamic Pricing - Implementation Proposal

**Agent**: Implementation Agent  
**Date**: January 31, 2026  
**Framework Version**: 1.2.0 (Investigation-First)  
**Risk Level**: 🔴 HIGH (Production Planning + Revenue Impact)  

**Status**: ⏳ AWAITING REVIEW AGENT VALIDATION

---

## Executive Summary

Enhance existing AI Pricing Assistant (currently simulated) with real-time market data integration and wholesale demand-based pricing recommendations.

**Business Impact**: 3-5% margin improvement = $1,500-2,500/year per farm

**Framework Compliance**: Investigation-First ✅, Multi-Agent Review Required 🔴

---

## Investigation Findings

### Existing Implementation Discovered

**Files Analyzed**:
- `farm-admin.js` (lines 1176-1235): `runAIPricingAnalysis()` function
- `public/farm-admin.html` (line 2042): AI Pricing Assistant modal
- `public/LE-farm-admin.html` (line 2403): Same implementation
- `greenreach-central/public/js/wholesale.js` (line 1554): Demand trends display

**Current Features** ✅:
1. **Simulated Market Analysis**:
   ```javascript
   const marketData = {
     'Butterhead Lettuce': {
       retailers: ['Whole Foods', 'Sobeys', 'Metro', 'Loblaws', 'Farm Boy'],
       avgPriceUSD: 4.99,
       avgWeightOz: 8,
       priceRange: [3.49, 6.49],
       trend: 'up',
       country: 'USA'
     }
   };
   ```

2. **USD to CAD Conversion**: `fetchExchangeRate()` function

3. **Trend Detection**: "up", "down", "stable" classifications

4. **UI Components**:
   - Modal with market analysis simulation
   - Price history view capability
   - North American retailer coverage narrative

**Current Limitations** ❌:
- **Hardcoded market data** (not live API)
- **No wholesale demand integration** (doesn't use actual order data)
- **Static trends** (not time-series analysis)
- **No competitor pricing** (fictional retailer data)
- **No seasonal adjustments**

### Existing Systems to Leverage

**✅ Available Now**:
1. **Wholesale Order History**:
   - Location: `greenreach-central/routes/wholesale.js`
   - Data: Buyer orders, SKU demand, pricing accepted/rejected
   - Endpoint: `GET /api/wholesale/orders/history`

2. **Cross-Farm Inventory**:
   - Location: `greenreach-central/routes/network.js`
   - Data: Supply levels, fulfillment rates across network
   - Endpoint: `GET /api/wholesale/network/farms`

3. **GreenReach Central OpenAI Access**:
   - Location: `greenreach-central/services/ai-recommendations-pusher.js`
   - Capability: GPT-4 for intelligent analysis
   - Pattern: Central → Edge bidirectional communication

4. **SARIMAX Forecasting**:
   - Location: `server-foxtrot.js` (line 11509)
   - Capability: Time-series forecasting already implemented
   - Use: Predict demand trends

5. **IsolationForest Anomaly Detection**:
   - Location: `backend/ml_insights.py`
   - Capability: Detect price anomalies
   - Use: Alert on market shifts

### External Data Sources Investigated

**Option 1: USDA Agricultural Marketing Service (AMS)**:
- API: https://www.ams.usda.gov/mnreports
- Coverage: Wholesale produce prices (US markets)
- Cost: **FREE**
- Update Frequency: Daily
- Data: Prices by commodity, variety, grade, origin
- **Limitation**: US-focused, not Canadian retail

**Option 2: Statistics Canada (StatCan)**:
- API: https://www.statcan.gc.ca/en/developers
- Coverage: Canadian food prices (CPI data)
- Cost: **FREE**
- Update Frequency: Monthly
- Data: Average retail prices by province
- **Limitation**: Aggregated (not specific retailers)

**Option 3: Retailer APIs** (Investigated):
- Whole Foods: ❌ No public API
- Sobeys/Metro/Loblaws: ❌ No public API
- Farm Boy: ❌ No public API
- **Reality**: Must rely on wholesale market data or manual scraping (not viable)

**Option 4: Wholesale Market Data**:
- GreenReach Central has actual transaction data ✅
- Real buyer acceptance/rejection of prices ✅
- Multi-farm competitive pricing ✅
- **Best option**: Use our own data

---

## Proposed Architecture

### 3-Tier Enhancement Model (Progressive)

#### Tier 1: Demand-Based Pricing (Minimal - Week 1)

**Data Source**: GreenReach Central wholesale order history

**Algorithm**:
```javascript
// Calculate optimal price based on supply/demand
function calculateDemandBasedPrice(crop, currentSupply, historicalDemand) {
  const demandRatio = historicalDemand / currentSupply;
  const basePrice = getBasePrice(crop);
  
  if (demandRatio > 1.5) {
    // High demand, low supply → increase price 10-20%
    return basePrice * 1.15;
  } else if (demandRatio < 0.5) {
    // Low demand, high supply → decrease price 10-15%
    return basePrice * 0.90;
  }
  
  return basePrice; // Stable market
}
```

**API Endpoint**:
```javascript
GET /api/pricing/suggestions?crop=Butterhead+Lettuce

Response:
{
  "crop": "Butterhead Lettuce",
  "currentPrice": 4.99,
  "suggestedPrice": 5.49,
  "adjustment": "+10%",
  "reason": "High demand (1.8x supply), 23 orders last week vs 12 avg",
  "confidence": 0.82
}
```

**UI Integration**: Display in existing AI Pricing Assistant modal

#### Tier 2: Competitive Pricing (Enhanced - Week 2)

**Data Source**: Cross-farm pricing from GreenReach Central network

**Algorithm**:
```javascript
// Compare against network average
function getCompetitivePricing(crop, myPrice, networkPrices) {
  const avgNetworkPrice = average(networkPrices);
  const percentile = calculatePercentile(myPrice, networkPrices);
  
  if (percentile > 75) {
    return {
      position: "premium",
      recommendation: `Your price is ${percentile}th percentile. Consider ${avgNetworkPrice * 0.95} to increase competitiveness.`
    };
  } else if (percentile < 25) {
    return {
      position: "discount",
      recommendation: `Your price is below market average. Could increase to ${avgNetworkPrice} (+${diff}%).`
    };
  }
  
  return { position: "market", recommendation: "Pricing is competitive" };
}
```

**New Endpoint**:
```javascript
GET /api/pricing/competitive?crop=Butterhead+Lettuce

Response:
{
  "crop": "Butterhead Lettuce",
  "yourPrice": 4.99,
  "networkAverage": 5.25,
  "networkRange": [4.49, 6.49],
  "yourPercentile": 35,
  "position": "below_average",
  "recommendation": "Could increase to $5.25 (+5.2%) to match network average",
  "priceAcceptanceRate": 0.89  // 89% of orders at $5.25 are accepted
}
```

#### Tier 3: AI-Optimized Pricing (Full - Week 3)

**Data Source**: GreenReach Central + OpenAI analysis

**Process**:
1. **Edge → Central**: Farm requests pricing optimization
2. **Central Analysis** (GPT-4):
   - Historical order acceptance/rejection rates
   - Seasonal patterns (spring greens vs winter demand)
   - Buyer type preferences (restaurants vs grocers)
   - Quality tier positioning (organic premium)
   - Regional competition
3. **Central → Edge**: Push AI recommendations

**AI Prompt Pattern**:
```
Analyze pricing for Butterhead Lettuce at GreenReach Farm #12:

Current Data:
- Farm price: $4.99/head
- Network average: $5.25/head
- Last 30 days: 18 orders (12 accepted, 6 rejected)
- Rejection reasons: "Too expensive" (5), "Out of stock" (1)
- Buyer segments: Restaurants (60%), Grocers (40%)
- Season: Winter (Jan-Mar demand typically 1.3x summer)
- Quality: Organic, hydroponic, 0-mile delivery

Competitive Context:
- 3 other farms in 50-mile radius
- Their prices: $4.49, $5.49, $5.99
- Their acceptance rates: 78%, 91%, 65%

Recommend:
1. Optimal price point (balance acceptance rate + margin)
2. Price elasticity analysis (how much can we increase?)
3. Segmented pricing (restaurant vs grocer discount tiers)
4. Seasonal adjustments (next 3 months)

Format: JSON with price, reasoning, confidence
```

**New Endpoint**:
```javascript
POST /api/pricing/ai-optimize
Body: { crop: "Butterhead Lettuce", requestDetail: true }

Response:
{
  "crop": "Butterhead Lettuce",
  "currentPrice": 4.99,
  "optimizedPrice": 5.15,
  "adjustment": "+3.2%",
  "reasoning": [
    "Winter demand is 1.3x baseline, justifies +$0.20",
    "Your rejection rate (33%) suggests price resistance above $5.00",
    "Sweet spot: $5.15 (projected 85% acceptance, +8% margin)",
    "Restaurant segment accepts up to $5.49, grocer segment caps at $4.99"
  ],
  "segmentedPricing": {
    "restaurants": 5.49,
    "grocers": 4.99,
    "retail": 6.49
  },
  "confidence": 0.87,
  "projectedImpact": {
    "monthlyRevenue": "+$340",
    "acceptanceRate": "67% → 85%",
    "marginImprovement": "+4.2%"
  },
  "modelUsed": "gpt-4",
  "generatedAt": "2026-01-31T18:45:00Z"
}
```

---

## Implementation Plan

### Week 1: Demand-Based Pricing (Tier 1)

**Files to Create**:
1. `lib/pricing-optimizer.js` (300 lines)
   - Class: `PricingOptimizer`
   - Methods:
     - `calculateDemandBasedPrice(crop, supply, demand)`
     - `getHistoricalDemand(crop, weeks)` - from Central API
     - `getCurrentSupply(crop)` - from inventory
     - `getBasePrice(crop)` - from farm pricing table

**Files to Modify**:
1. `server-foxtrot.js`
   - Add endpoint: `GET /api/pricing/suggestions`
   - Integrate with wholesale order history

2. `farm-admin.js`
   - Modify `runAIPricingAnalysis()` to call real API (not simulation)
   - Display demand-based recommendations

**Validation**:
- Script: `scripts/validate-pricing-optimizer.js`
- Tests: 15 checks (demand calculation, API integration, error handling)

### Week 2: Competitive Pricing (Tier 2)

**Files to Modify**:
1. `lib/pricing-optimizer.js`
   - Add method: `getCompetitivePricing(crop)`
   - Fetch network prices from Central

2. `server-foxtrot.js`
   - Add endpoint: `GET /api/pricing/competitive`

3. `farm-admin.js`
   - Display competitive analysis (percentile, network average)

**Validation**:
- Add 8 tests for competitive analysis
- Total: 23 checks

### Week 3: AI-Optimized Pricing (Tier 3)

**Files to Create**:
1. `greenreach-central/services/pricing-ai.js` (200 lines)
   - OpenAI integration for pricing analysis
   - Historical pattern recognition
   - Segmented pricing recommendations

**Files to Modify**:
1. `server-foxtrot.js`
   - Add endpoint: `POST /api/pricing/ai-optimize`
   - Receive AI recommendations from Central

2. `greenreach-central/routes/ai-insights.js`
   - Add pricing analysis endpoint

3. `farm-admin.js`
   - Display AI recommendations with reasoning

**Validation**:
- Add 10 tests for AI integration
- Total: 33 checks

---

## Risk Assessment

### 🔴 HIGH RISK FACTORS

1. **Revenue Impact**: Incorrect pricing could reduce margin or lose orders
   - **Mitigation**: Start with suggestions only (grower approval required)
   - **Safeguards**: +/- 20% cap on adjustments

2. **Market Data Accuracy**: Wholesale orders may not reflect true market
   - **Mitigation**: Use 30-day rolling average (smooth out outliers)
   - **Safeguards**: Confidence scoring (don't suggest if confidence < 0.70)

3. **Cross-Farm Competition**: Could trigger price war if all farms use same algo
   - **Mitigation**: Add randomization (+/- 5% jitter)
   - **Safeguards**: Monitor acceptance rates, revert if drops

### 🟡 MEDIUM RISK FACTORS

1. **API Dependencies**: Central must be available for pricing data
   - **Mitigation**: Cache last 7 days of pricing locally
   - **Fallback**: Use local historical data if Central unavailable

2. **OpenAI Costs**: GPT-4 API calls add cost
   - **Mitigation**: Cache AI recommendations for 24 hours
   - **Cost**: ~$0.02 per optimization = $0.60/farm/month (30 crops)

### 🟢 LOW RISK FACTORS

1. **UI Changes**: Modifying existing modal (low impact)
2. **Validation**: Comprehensive test coverage planned

---

## Data Schema Impact

### ❌ NO SCHEMA CHANGES REQUIRED

**Read-Only Access**:
- `public/data/farm-pricing.json` (existing)
- Wholesale order history (Central API)
- Network farm pricing (Central API)

**New Data Files** (Optional):
- `public/data/pricing-cache.json` (local cache for offline mode)
  - Structure: `{ crop: string, price: number, timestamp: number }`
  - Not canonical (can be regenerated)

**Schema Compliance**: ✅ No violations

---

## Framework Compliance Verification

### ✅ Investigation-First
- [x] Reviewed existing AI Pricing Assistant implementation
- [x] Analyzed wholesale order data availability
- [x] Researched external pricing data sources (USDA, StatCan)
- [x] Confirmed GreenReach Central OpenAI integration exists
- [x] Documented what EXISTS vs what's MISSING

### ✅ Leverage Existing
- [x] Use existing wholesale order history (not rebuild)
- [x] Use GreenReach Central OpenAI access (not add local LLM)
- [x] Use existing UI modal (not create new page)
- [x] Use SARIMAX forecasting if needed (already implemented)

### ✅ Progressive Enhancement
- [x] Tier 1: Works with just demand data (minimal)
- [x] Tier 2: Enhances with network pricing (competitive)
- [x] Tier 3: Optimizes with AI analysis (full)

### ✅ Zero Configuration
- [x] Auto-fetches wholesale data (no manual input)
- [x] Auto-calculates from existing farm pricing
- [x] Grower just clicks "Run Market Analysis"

### ✅ Simplicity
- [x] Clear output: "Suggested price: $5.15 (+3.2%)"
- [x] Reasoning provided: "Winter demand is 1.3x baseline"
- [x] One-click application (grower approves/rejects)

### ✅ Visibility
- [x] All pricing decisions logged
- [x] Confidence scoring displayed
- [x] Network comparison shown (percentile, range)

### ✅ Database-Driven
- [x] Pricing history stored in farm-pricing.json
- [x] Recommendations cached (24-hour TTL)
- [x] Network data from Central database

### ✅ Workflow-Centric
- [x] Integrated into existing Farm Admin workflow
- [x] Fits monthly pricing review task
- [x] Quick decision (suggestion → approve → save)

---

## Validation Strategy

### Automated Testing (33 checks planned)

**Tier 1 - Demand-Based** (15 tests):
- ✅ Calculate price from high demand scenario
- ✅ Calculate price from low demand scenario
- ✅ Fetch historical demand from Central
- ✅ Handle missing wholesale data gracefully
- ✅ Respect +/- 20% adjustment cap
- ✅ Confidence scoring (0.0 - 1.0 range)
- ✅ API endpoint returns valid JSON
- ✅ Error handling for invalid crop
- ✅ Cache functionality (5-min TTL)
- ✅ Base price lookup from farm pricing
- ✅ Supply calculation from inventory
- ✅ Demand ratio calculation accuracy
- ✅ Seasonal adjustment (winter vs summer)
- ✅ Quality tier recognition (organic premium)
- ✅ Integration with existing modal UI

**Tier 2 - Competitive** (8 tests):
- ✅ Fetch network pricing from Central
- ✅ Calculate percentile ranking
- ✅ Identify price position (premium/market/discount)
- ✅ Generate competitive recommendations
- ✅ Price acceptance rate correlation
- ✅ Network average calculation
- ✅ API endpoint integration
- ✅ UI display of competitive analysis

**Tier 3 - AI-Optimized** (10 tests):
- ✅ OpenAI API integration (Central)
- ✅ Prompt construction with full context
- ✅ JSON response parsing
- ✅ Segmented pricing output (restaurant vs grocer)
- ✅ Confidence threshold enforcement
- ✅ Reasoning extraction and display
- ✅ Projected impact calculations
- ✅ 24-hour caching
- ✅ Bidirectional communication (Edge ↔ Central)
- ✅ Fallback to Tier 2 if AI unavailable

### Manual Testing

**Scenario 1: High Demand**:
- Given: 30 wholesale orders in 2 weeks, inventory low
- Expected: Suggestion to increase price 10-15%

**Scenario 2: Oversupply**:
- Given: Harvest of 200 heads, only 50 orders
- Expected: Suggestion to decrease price 5-10% to move inventory

**Scenario 3: Competitive Positioning**:
- Given: Farm price $4.99, network average $5.49
- Expected: "Your pricing is below market, could increase to $5.25"

**Scenario 4: AI Optimization**:
- Given: 6 rejected orders with "too expensive" reason
- Expected: AI suggests $5.15 (sweet spot between acceptance and margin)

---

## Rollback Plan

### If Issues Arise

1. **Revert Changes**:
   ```bash
   git checkout HEAD~1 server-foxtrot.js
   git checkout HEAD~1 lib/pricing-optimizer.js
   git checkout HEAD~1 farm-admin.js
   ```

2. **Disable Feature**:
   - Hide "AI Pricing Assistant" button in farm-admin.html
   - Keep existing simulated data (fallback)

3. **Investigate**:
   - Check logs: `tail -f logs/pricing-optimizer.log`
   - Verify Central API: `curl http://localhost:3100/api/wholesale/orders/history`

4. **No Data Loss**: No canonical schemas modified (read-only access)

---

## Success Metrics

### Business KPIs (Measure After 30 Days)

1. **Margin Improvement**: Target 3-5%
   - Baseline: Current average margin per crop
   - Measure: New margin after pricing adjustments

2. **Order Acceptance Rate**: Target 85%+
   - Baseline: Current acceptance rate (estimated 67%)
   - Measure: Accepted orders / total orders

3. **Revenue Growth**: Target +$1,500-2,500/year per farm
   - Baseline: Current monthly revenue
   - Measure: Revenue increase attributed to pricing changes

4. **Pricing Confidence**: Target 80%+ grower satisfaction
   - Survey: "Do pricing suggestions help your decision-making?"

### Technical KPIs

1. **API Response Time**: < 500ms for Tier 1, < 2s for Tier 3
2. **Cache Hit Rate**: > 60% (reduce Central API load)
3. **Validation Pass Rate**: 100% (33/33 checks)
4. **Error Rate**: < 1% (pricing suggestions fail gracefully)

---

## Timeline

**Week 1**: Demand-Based Pricing (Tier 1)
- Days 1-2: Implement `lib/pricing-optimizer.js` + API endpoint
- Day 3: Integrate with farm-admin.js UI
- Day 4: Validation script (15 tests)
- Day 5: Manual testing + documentation

**Week 2**: Competitive Pricing (Tier 2)
- Days 1-2: Add network pricing integration
- Day 3: Competitive analysis endpoint
- Day 4: UI enhancements + validation (23 tests total)
- Day 5: Cross-farm testing

**Week 3**: AI-Optimized Pricing (Tier 3)
- Days 1-2: Central OpenAI integration
- Day 3: Bidirectional communication
- Day 4: Validation (33 tests total)
- Day 5: Production testing + documentation

**Total**: 3 weeks to full implementation

---

## Open Questions for Review Agent

1. **Pricing Adjustment Caps**: Is +/- 20% appropriate, or too conservative?

2. **Confidence Threshold**: Should we only show suggestions with confidence > 0.70?

3. **Grower Approval**: Should system auto-apply pricing or require manual approval?
   - Proposal: Manual approval in Tier 1, optional auto-apply in Tier 3

4. **Cache Duration**: 5-minute cache for pricing decisions - too short/long?
   - Pricing changes slowly, could extend to 30 minutes

5. **OpenAI Cost**: $0.60/farm/month acceptable? Alternative: weekly batch analysis?

6. **Network Competition**: Should we add jitter to prevent price synchronization?
   - Proposal: +/- 5% randomization

---

## Request for Review

**@Review-Agent**: Please validate this proposal for:

1. ✅ **Technical Feasibility**: Can we integrate with Central wholesale API?
2. ✅ **Risk Mitigation**: Are safeguards sufficient for revenue impact?
3. ✅ **Framework Compliance**: Investigation-First, Progressive Enhancement verified?
4. ✅ **Data Schema**: Confirm no violations to canonical formats
5. ✅ **Validation Coverage**: 33 checks adequate for production readiness?

**@Architecture-Agent** (after Review approval): Strategic review of:

1. 🎯 **Business Alignment**: Does this serve "Simplicity Over Features" mission?
2. 🎯 **Integration Impact**: How does this affect GreenReach Central load?
3. 🎯 **Competitive Dynamics**: Risk of price wars across network?
4. 🎯 **Long-Term Vision**: Does this scale to 100+ farms?

---

**Proposal Status**: ⏳ AWAITING MULTI-AGENT REVIEW

**Next Action**: Review Agent validation → Architecture Agent strategic approval → Implementation
