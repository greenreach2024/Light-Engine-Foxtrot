# P5: Wholesale Pricing Authority - Implementation Proposal (REVISED)

**Agent**: Implementation Agent  
**Date**: January 31, 2026  
**Framework Version**: 1.2.0 (Investigation-First)  
**Risk Level**: 🔴 HIGH (Revenue Model + Farm Autonomy)  

**Status**: ⏳ MAJOR ARCHITECTURE REVISION - AWAITING REVIEW AGENT RE-VALIDATION

---

## 🚨 CRITICAL REVISION

**Previous Assumption** (INCORRECT): Farms set their own wholesale prices with AI recommendations  
**Actual Business Model** (CORRECT): **GreenReach Central sets wholesale prices, farms accept/reject**

This changes:
- **Who owns pricing**: Central (not farms)
- **Farm role**: Price takers (not price setters)
- **Decision flow**: Central analyzes → sets prices → farms decide participation
- **Implementation location**: Primarily Central (not edge)
- **Value proposition**: Simplified farm experience + network-wide optimization

---

## Executive Summary

Build **Central Wholesale Pricing Authority** where GreenReach Central sets optimal wholesale prices for all crops across the network. Farms receive price "offers" and decide whether to participate in wholesale marketplace at those prices.

**Business Impact**: 
- **For Network**: 5-8% margin improvement through centralized optimization
- **For Farms**: Zero pricing workload (accept/reject decision only)
- **For Buyers**: Consistent pricing experience across farms

**Framework Compliance**: Investigation-First ✅, Simplicity Over Features ✅, Multi-Agent Review Required 🔴

---

## Architecture Shift

### Before (Incorrect Model)
```
┌─────────────┐                    ┌─────────────┐
│   Farm A    │  Sets own prices   │   Farm B    │
│  $5.50/lb   │◄───────────────────│  $4.99/lb   │
└─────────────┘   AI recommends    └─────────────┘
       │                                    │
       └────────────Compete──────────────┘
```

### After (Marketplace Model)
```
┌──────────────────────────────────────────┐
│      GreenReach Central Authority        │
│   Analyzes: Supply, Demand, Seasonality  │
│   Sets: Wholesale price = $5.15/lb       │
└────────────────┬─────────────────────────┘
                 │ Offer: $5.15/lb
        ┌────────┴────────┐
        │                 │
   ┌────▼────┐      ┌────▼────┐
   │ Farm A  │      │ Farm B  │
   │ ACCEPT  │      │ REJECT  │
   └─────────┘      └─────────┘
      (sells)      (opts out)
```

---

## Investigation Findings

### Existing Systems to Leverage (Same as before)

**✅ Available Now**:
1. **Wholesale Order History**: `greenreach-central/routes/wholesale.js`
2. **Cross-Farm Inventory**: `greenreach-central/routes/network.js`
3. **OpenAI Integration**: `greenreach-central/services/ai-recommendations-pusher.js`
4. **Admin Dashboard**: `greenreach-central/public/central-admin.html`

### New Central Components Required

**❌ Missing (Need to Build)**:
1. **Central Pricing Dashboard** (Admin UI)
   - View current wholesale prices by crop
   - See farm acceptance rates
   - Override AI recommendations manually
   - Historical pricing performance

2. **Pricing Offer Notification System**
   - Push price changes to farms
   - Track acceptance/rejection
   - Alert Central when rejection rate > 30%

3. **Farm Acceptance UI** (Edge)
   - Simple "Current Wholesale Prices" view
   - Accept/Reject buttons
   - "Why this price?" explanation
   - Opt-out history tracking

---

## Proposed Architecture

### 3-Tier Central Pricing Authority

#### Tier 1: Rule-Based Central Pricing (Week 1)

**Location**: `greenreach-central/services/pricing-authority.js`

**Algorithm**:
```javascript
class WholesalePricingAuthority {
  /**
   * Calculate network-wide optimal wholesale price
   * Farms do NOT set prices - they accept/reject this offer
   */
  calculateWholesalePrice(crop) {
    // 1. Network supply (all farms)
    const totalSupply = this.getNetworkSupply(crop);
    
    // 2. Historical demand (last 30 days)
    const avgDemand = this.getAverageDemand(crop, 30);
    
    // 3. Supply/demand ratio
    const ratio = avgDemand / totalSupply;
    
    // 4. Base wholesale price (market research)
    const basePrice = this.getBaseWholesalePrice(crop);
    
    // 5. Dynamic adjustment (+/- 25% cap)
    if (ratio > 1.8) return basePrice * 1.25;      // High demand
    if (ratio > 1.3) return basePrice * 1.15;      // Moderate demand
    if (ratio < 0.5) return basePrice * 0.80;      // Oversupply
    if (ratio < 0.7) return basePrice * 0.90;      // Low demand
    
    return basePrice; // Market equilibrium
  }
  
  /**
   * Send pricing offer to all farms growing this crop
   */
  async offerPriceToFarms(crop, price, reasoning) {
    const farms = await this.getActiveFarms(crop);
    
    for (const farm of farms) {
      await this.sendPriceOffer({
        farmId: farm.id,
        crop: crop,
        wholesalePrice: price,
        reasoning: reasoning,
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        requiresResponse: true
      });
    }
    
    // Track in database
    await db.pricing_offers.create({
      crop, price, reasoning,
      offerDate: new Date(),
      status: 'pending'
    });
  }
}
```

**API Endpoints** (Central):
```javascript
// CENTRAL ADMIN API
POST /api/admin/pricing/set-wholesale
Body: {
  crop: "Butterhead Lettuce",
  wholesalePrice: 5.15,
  reasoning: "High demand (1.8x supply), winter season premium",
  effectiveDate: "2026-02-01"
}

Response: {
  success: true,
  offerId: "OFFER-20260131-BHL",
  farmsSent: 8,
  message: "Price offer sent to 8 farms growing Butterhead Lettuce"
}

// FARM RESPONSE API (Edge calls this)
POST /api/wholesale/pricing/respond
Body: {
  offerId: "OFFER-20260131-BHL",
  farmId: "FARM-MKLOMAT3-A9D8",
  response: "accept",  // or "reject"
  notes: "Price acceptable for our quality tier"
}

Response: {
  success: true,
  message: "Acceptance recorded. Your farm will appear in wholesale catalog at $5.15/lb"
}

// CENTRAL MONITORING API
GET /api/admin/pricing/offers/OFFER-20260131-BHL/responses

Response: {
  offerId: "OFFER-20260131-BHL",
  crop: "Butterhead Lettuce",
  wholesalePrice: 5.15,
  totalFarms: 8,
  responses: {
    accepted: 6,
    rejected: 1,
    pending: 1
  },
  acceptanceRate: 0.75,
  farms: [
    { farmId: "FARM-ABC", response: "accept", respondedAt: "..." },
    { farmId: "FARM-XYZ", response: "reject", notes: "Below cost" }
  ]
}
```

#### Tier 2: Competitive Intelligence (Week 2)

**Algorithm** (Central side):
```javascript
class CompetitivePricingAnalyzer {
  /**
   * Analyze external market prices (competitors outside GreenReach)
   */
  async analyzeMarketPosition(crop, ourPrice) {
    // 1. Check USDA wholesale prices (free API)
    const usdaPrice = await this.fetchUSDAPrice(crop);
    
    // 2. Compare with historical acceptance rates
    const historicalData = await db.pricing_history
      .where('crop', crop)
      .select('price', 'acceptanceRate')
      .orderBy('offerDate', 'desc')
      .limit(20);
    
    // 3. Find optimal price point
    const optimalPrice = this.findOptimalPrice(historicalData);
    
    return {
      currentOffer: ourPrice,
      usdaWholesale: usdaPrice,
      optimalPrice: optimalPrice,
      recommendation: ourPrice < optimalPrice ? "increase" : "competitive"
    };
  }
  
  /**
   * Predict farm acceptance rate before sending offer
   */
  predictAcceptanceRate(crop, proposedPrice) {
    const historicalPrices = this.getHistoricalPrices(crop);
    
    // Logistic regression: acceptance rate vs price
    // Higher price = lower acceptance
    const model = this.trainLogisticModel(historicalPrices);
    const predicted = model.predict(proposedPrice);
    
    return {
      predictedAcceptance: predicted,
      confidence: 0.78,
      warning: predicted < 0.50 ? "More than half of farms may reject" : null
    };
  }
}
```

**UI Integration** (Central Admin Dashboard):
```
┌─────────────────────────────────────────────────────────┐
│  Wholesale Pricing Dashboard                            │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Butterhead Lettuce                                     │
│  Current Offer: $5.15/lb          [Change Price]        │
│                                                          │
│  Acceptance Rate: 75% (6/8 farms)                       │
│  ├─ Accepted: Farm A, Farm B, Farm C, Farm D, E, F      │
│  ├─ Rejected: Farm G (reason: "Below cost")            │
│  └─ Pending: Farm H (expires in 5 days)                │
│                                                          │
│  Market Intelligence:                                    │
│  ├─ USDA Wholesale Avg: $4.85/lb                       │
│  ├─ Our Premium: +6.2% (justified by freshness)        │
│  └─ Predicted Acceptance: 78% (if price stays)         │
│                                                          │
│  Performance:                                            │
│  ├─ Last Month Revenue: $12,450 (6 farms)              │
│  ├─ Projected This Month: $13,200 (+6%)                │
│  └─ Avg Acceptance Rate: 72% (industry: 65%)           │
│                                                          │
│  AI Recommendation: [View Details]                      │
│  "Consider $5.25 (+1.9%) - projected 70% acceptance"   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Tier 3: AI-Optimized Authority (Week 3-4)

**Process** (Central only):
1. **Central AI Analysis**: GPT-4 analyzes all network data
2. **Price Recommendation**: Optimal price for network health
3. **Admin Review**: Human approves/overrides
4. **Farm Notification**: Price offer sent to all farms
5. **Response Collection**: Track accepts/rejects
6. **Feedback Loop**: AI learns from acceptance patterns

**AI Prompt Pattern**:
```
You are the GreenReach Central Pricing Authority. Set wholesale prices that:
1. Maximize network revenue (accepted offers × price)
2. Maintain 65%+ farm acceptance rate (trust threshold)
3. Balance supply/demand across the network
4. Protect farm profitability (price > cost + 20% margin)

Current Situation:
- Crop: Butterhead Lettuce
- Network Supply: 480 lbs/week (8 farms)
- Network Demand: 720 lbs/week (12 buyers)
- Supply/Demand Ratio: 1.5x (high demand)
- Current Wholesale Price: $5.15/lb
- Current Acceptance Rate: 75% (6/8 farms)
- Rejected Farm Reason: "Price below $5.50 cost basis"

Historical Data:
- $4.99: 88% acceptance, $2,395 revenue
- $5.15: 75% acceptance, $2,355 revenue (current)
- $5.49: 50% acceptance, $1,650 revenue (tested last month)

Farm Cost Analysis:
- 6 farms profitable at $5.15 (cost: $3.80-4.50)
- 2 farms break-even at $5.15 (cost: $5.10-5.30)
- 0 farms losing money

Buyer Sensitivity:
- Restaurants: Accept up to $6.50/lb (quality premium)
- Grocers: Sensitive above $5.00/lb (volume buyers)
- Retail: Will pay $8.00+ (end consumer markup)

Recommend:
1. Optimal wholesale price (balance acceptance + revenue)
2. Reasoning for this price point
3. Expected acceptance rate
4. Projected network revenue impact
5. Risk analysis (if too high/low)

Format: JSON with price, reasoning, confidence, projectedAcceptance, projectedRevenue
```

**GPT-4 Response Example**:
```json
{
  "recommendedWholesalePrice": 5.35,
  "reasoning": [
    "High demand (1.5x supply) justifies +3.9% increase from $5.15",
    "2 farms at cost $5.10-5.30 would become profitable at $5.35",
    "Predicted acceptance: 78% (from 75% at $5.15)",
    "Sweet spot: Higher margin + more profitable farms = better retention",
    "Restaurants accept up to $6.50, so $5.35 has headroom",
    "Risk: Grocer pushback, but supply shortage gives us pricing power"
  ],
  "confidence": 0.84,
  "projectedAcceptanceRate": 0.78,
  "projectedNetworkRevenue": 2640,
  "revenueIncrease": "+12% vs current $5.15",
  "riskAnalysis": {
    "ifHigher_6.00": "Acceptance drops to 50%, revenue -$600/week",
    "ifLower_4.99": "Acceptance rises to 88%, but margin -$750/week",
    "optimal": "Current recommendation $5.35 maximizes revenue × acceptance"
  },
  "farmImpact": {
    "newlyProfitable": 2,
    "remainProfitable": 6,
    "atRisk": 0
  }
}
```

---

## Implementation Plan

### Week 1: Central Pricing Authority Core (Rule-Based)

**Files to Create**:

1. **`greenreach-central/services/pricing-authority.js`** (400 lines)
   ```javascript
   class WholesalePricingAuthority {
     calculateWholesalePrice(crop)
     offerPriceToFarms(crop, price, reasoning)
     trackFarmResponse(offerId, farmId, response)
     getAcceptanceRate(offerId)
     getActivePriceOffers()
   }
   ```

2. **`greenreach-central/routes/admin-pricing.js`** (250 lines)
   ```javascript
   POST   /api/admin/pricing/set-wholesale
   GET    /api/admin/pricing/offers
   GET    /api/admin/pricing/offers/:offerId/responses
   PUT    /api/admin/pricing/offers/:offerId/cancel
   GET    /api/admin/pricing/history
   ```

3. **`greenreach-central/public/pricing-admin.html`** (500 lines)
   - Pricing dashboard UI (see mockup above)
   - Set wholesale prices form
   - View acceptance rates table
   - Historical pricing chart

4. **Database Migration**:
   ```sql
   CREATE TABLE pricing_offers (
     offer_id VARCHAR(50) PRIMARY KEY,
     crop VARCHAR(100) NOT NULL,
     wholesale_price DECIMAL(10,2) NOT NULL,
     reasoning TEXT,
     offer_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     effective_date DATE,
     expires_at TIMESTAMP,
     status VARCHAR(20) -- 'pending', 'active', 'expired', 'cancelled'
   );
   
   CREATE TABLE pricing_responses (
     response_id INT AUTO_INCREMENT PRIMARY KEY,
     offer_id VARCHAR(50) REFERENCES pricing_offers(offer_id),
     farm_id VARCHAR(50) NOT NULL,
     response VARCHAR(10) NOT NULL, -- 'accept', 'reject'
     notes TEXT,
     responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );
   
   CREATE INDEX idx_offer_farm ON pricing_responses(offer_id, farm_id);
   CREATE INDEX idx_offer_date ON pricing_offers(offer_date);
   ```

**Files to Modify**:

5. **`server-foxtrot.js`** (Edge farm server)
   ```javascript
   // Add endpoint to receive price offers from Central
   app.get('/api/wholesale/pricing/current', async (req, res) => {
     // Fetch active price offers from Central
     const offers = await fetch(`${CENTRAL_URL}/api/wholesale/pricing/offers/farm/${FARM_ID}`);
     res.json(offers);
   });
   
   app.post('/api/wholesale/pricing/respond', async (req, res) => {
     const { offerId, response, notes } = req.body;
     
     // Send acceptance/rejection to Central
     await fetch(`${CENTRAL_URL}/api/wholesale/pricing/respond`, {
       method: 'POST',
       body: JSON.stringify({ offerId, farmId: FARM_ID, response, notes })
     });
     
     res.json({ success: true });
   });
   ```

6. **`public/farm-admin.html`** (New section: Wholesale Pricing)
   ```html
   <!-- Replace "AI Pricing Assistant" button with "Wholesale Prices" -->
   <div class="card">
     <h3>Wholesale Pricing (GreenReach Network)</h3>
     <p>GreenReach Central sets wholesale prices. Accept or reject offers below.</p>
     
     <div id="pricing-offers">
       <!-- Dynamically loaded -->
       <div class="offer-card">
         <h4>Butterhead Lettuce</h4>
         <p class="price">$5.15/lb (wholesale)</p>
         <p class="reasoning">High demand (1.8x supply), winter premium</p>
         <p class="expires">Expires: Feb 7, 2026</p>
         
         <button onclick="respondToPricing('OFFER-123', 'accept')" class="btn-accept">
           ✓ Accept ($5.15)
         </button>
         <button onclick="respondToPricing('OFFER-123', 'reject')" class="btn-reject">
           ✗ Reject
         </button>
         
         <a href="#" onclick="showPriceDetails('OFFER-123')">Why this price?</a>
       </div>
     </div>
   </div>
   ```

**Validation** (Week 1):
- ✅ Central can set wholesale prices
- ✅ Farms receive price offers
- ✅ Farms can accept/reject
- ✅ Central tracks acceptance rates
- ✅ Admin dashboard displays pricing status
- **Tests**: 12 automated (API endpoints + database)
- **Manual**: 3 scenarios (accept, reject, expired offer)

---

### Week 2: Competitive Intelligence & Historical Analysis

**Files to Create**:

7. **`greenreach-central/services/pricing-analyzer.js`** (350 lines)
   ```javascript
   class PricingAnalyzer {
     async fetchUSDAPrice(crop)
     predictAcceptanceRate(crop, price)
     analyzeMarketPosition(crop, ourPrice)
     calculateOptimalPrice(crop)
     generatePricingInsights(crop)
   }
   ```

**Files to Modify**:

8. **`greenreach-central/public/pricing-admin.html`**
   - Add "Market Intelligence" section
   - Display USDA comparison
   - Show predicted acceptance rate
   - Historical pricing chart (Chart.js)

**External API Integration**:
```javascript
// USDA AMS API (free)
async function fetchUSDAPrice(crop) {
  const endpoint = 'https://www.ams.usda.gov/mnreports/fvwtrk.pdf'; // Parse PDF
  // Alternative: Manual input if no API (Admin enters market research)
  
  return {
    source: 'USDA AMS',
    price: 4.85,
    date: '2026-01-28',
    grade: 'US No. 1',
    market: 'Boston Terminal'
  };
}
```

**Validation** (Week 2):
- ✅ USDA price fetching (or manual input)
- ✅ Acceptance rate prediction model
- ✅ Historical pricing charts
- ✅ Optimal price calculation
- **Tests**: 23 total (12 + 11 new)
- **Manual**: 4 scenarios (market comparison, price optimization)

---

### Week 3-4: AI-Optimized Pricing Authority (GPT-4)

**Files to Create**:

9. **`greenreach-central/services/pricing-ai.js`** (300 lines)
   ```javascript
   class PricingAI {
     async generatePriceRecommendation(crop)
     async analyzeNetworkHealth()
     async simulatePriceChange(crop, newPrice)
     async explainPricing(crop, price)
   }
   ```

**Files to Modify**:

10. **`greenreach-central/services/ai-recommendations-pusher.js`**
    - Add pricing analysis to existing OpenAI integration
    - Reuse GPT-4 client and prompt pattern

11. **`greenreach-central/public/pricing-admin.html`**
    - Add "AI Recommendation" card
    - "Explain this price" button (GPT-4 reasoning)
    - "Simulate price change" tool
    - Auto-apply toggle (with admin approval required)

**OpenAI Integration**:
```javascript
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generatePriceRecommendation(crop) {
  const networkData = await getNetworkPricingData(crop);
  
  const completion = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      {
        role: "system",
        content: "You are the GreenReach Central Pricing Authority..."
      },
      {
        role: "user",
        content: `Analyze pricing for ${crop}:\n${JSON.stringify(networkData)}`
      }
    ],
    temperature: 0.7,
    max_tokens: 500
  });
  
  return JSON.parse(completion.choices[0].message.content);
}
```

**Validation** (Week 3-4):
- ✅ GPT-4 price recommendations
- ✅ Acceptance rate simulation
- ✅ Network health analysis
- ✅ AI reasoning explanations
- ✅ Admin approval workflow
- **Tests**: 33 total (23 + 10 new)
- **Manual**: 6 scenarios (AI recommendation, approval, rejection override)

**Timeline**: 8-10 days (allows for prompt iteration)

---

## Benefits of Central Pricing Authority

### ✅ Advantages Over Farm-Set Pricing

**1. Simplicity for Farms** (Core Principle):
- **Before**: Farm must research market, analyze demand, set prices (30 min/week)
- **After**: Farm sees offer, clicks Accept/Reject (30 seconds/week)
- **Impact**: 60x time reduction

**2. Network-Wide Optimization**:
- Central sees full supply/demand across all farms
- Can balance inventory (direct orders to farms with surplus)
- Prevents race-to-bottom pricing (farms competing destructively)

**3. Buyer Consistency**:
- Buyers see uniform pricing across network
- Eliminates "shop around for cheapest farm" behavior
- Professional marketplace perception

**4. Eliminates Price Coordination Risk**:
- Single pricing authority (not 10 farms making similar decisions)
- No appearance of collusion
- Legal compliance simplified

**5. Data-Driven Authority**:
- Central has full order history (farms only see their own)
- Can analyze buyer acceptance patterns across all farms
- Optimize for network health, not individual farm maximization

**6. Farm Trust & Transparency**:
- "Why this price?" button explains reasoning
- Historical acceptance rates visible
- Farms can reject if unprofitable (exit option)

### ⚠️ Potential Concerns

**1. Farm Autonomy**:
- **Concern**: Farms lose pricing control
- **Mitigation**: 
  - Always have reject option (not forced participation)
  - Transparent reasoning for every price
  - Admin overrides if farm cost data shows price is below cost

**2. Central Becomes Bottleneck**:
- **Concern**: Slow pricing decisions
- **Mitigation**:
  - AI recommends prices (fast)
  - Admin approves (1 min review)
  - Prices valid for 7-14 days (not daily changes)

**3. Trust in Central**:
- **Concern**: Farms perceive Central profits at their expense
- **Mitigation**:
  - Publish network revenue stats (transparent)
  - Show farm profitability analysis
  - Advisory board (farm representatives vote on pricing model changes)

**4. One-Size-Fits-All Pricing**:
- **Concern**: Organic farm has higher costs than conventional
- **Mitigation**:
  - Tiered pricing (organic vs conventional)
  - Quality premium adjustments
  - Cost surveys (Central knows farm cost basis)

---

## Risk Assessment

### 🔴 High Risk: Farm Rejection Rate

**Scenario**: Central sets price too low → 70% farms reject → wholesale marketplace collapses

**Mitigation**:
1. **Target Acceptance Rate**: 65% minimum (industry standard)
2. **Early Warning**: Alert if acceptance < 50% after 48 hours
3. **Auto-Adjustment**: If < 50%, AI recommends price increase
4. **Manual Override**: Admin can emergency adjust prices
5. **Farm Cost Surveys**: Central knows cost basis (won't set below cost + 20%)

**Monitoring**:
```javascript
// CloudWatch alert
if (acceptanceRate < 0.50 && hoursElapsed > 48) {
  sendAlert('CRITICAL: Wholesale price rejection rate 50%+ for ' + crop);
  recommendPriceAdjustment(crop, 'increase by 10-15%');
}
```

### 🟡 Medium Risk: Central Admin Overload

**Scenario**: 50 crops × weekly price reviews = full-time job

**Mitigation**:
1. **AI Recommendations**: 90% auto-generated
2. **Approval Queue**: Admin reviews only AI-flagged issues
3. **Auto-Apply** (with safeguards): If confidence > 0.85 and predicted acceptance > 70%
4. **Batch Pricing**: Review similar crops together (all lettuces)

### 🟢 Low Risk: Technical Failure

**Scenario**: Central goes offline → farms can't respond to offers

**Mitigation**:
1. **Offer Expiration**: 7-14 days (not daily)
2. **Edge Caching**: Farm stores last accepted prices locally
3. **Fallback**: If Central unreachable, use last accepted price

---

## Framework Compliance

### ✅ 1. Simplicity Over Features (CORE MISSION)

**Farm Workload**:
- **Before**: Research market, analyze demand, set prices, monitor competition (30 min/week)
- **After**: Click "Accept" or "Reject" (30 seconds/week)
- **Impact**: **60x simpler** ✅

**Admin Workload**:
- AI generates recommendations (automated)
- Admin approves/overrides (1-2 min per crop)
- Total: 30 min/week for 50 crops

**Buyer Experience**:
- Uniform pricing across network (no shopping around)
- Professional marketplace (not individual farm negotiations)

### ✅ 2. Database-Driven (Configuration = Data)

**Pricing as Data**:
- `pricing_offers` table (not hardcoded)
- `pricing_responses` table (historical tracking)
- AI learns from historical acceptance patterns
- Admin dashboard queries data (no manual reports)

### ✅ 3. Workflow-Centric UI

**Farm Workflow**: "Wholesale Participation Decision"
1. View current offers
2. Read "Why this price?" reasoning
3. Click Accept/Reject
4. Done (30 seconds)

**Admin Workflow**: "Weekly Pricing Review"
1. View AI recommendations
2. Check acceptance rate predictions
3. Approve or override
4. Done (30 minutes for all crops)

### ✅ 4. Zero Configuration

**Farm Setup**:
- No pricing configuration needed
- Central auto-detects farm inventory (what crops grown)
- Sends offers only for relevant crops
- Accept/reject stored automatically

**Central Setup**:
- Reads existing wholesale order history (already exists)
- Uses existing farm inventory data (already exists)
- Reuses OpenAI integration (already exists)

### ✅ 5. Progressive Enhancement

**Tier 1** (Week 1): Rule-based pricing (supply/demand ratio)
**Tier 2** (Week 2): Competitive intelligence (USDA comparison)
**Tier 3** (Week 3-4): AI-optimized (GPT-4 network analysis)

Each tier builds on previous (not replacement).

### ✅ 6. Leverage Existing Systems

**Reused**:
- Wholesale order history (`greenreach-central/routes/wholesale.js`)
- Farm inventory data (`greenreach-central/routes/network.js`)
- OpenAI integration (`ai-recommendations-pusher.js`)
- Admin dashboard (`central-admin.html`)

**New** (Required):
- Pricing authority service (central logic)
- Pricing offers database tables
- Farm acceptance UI (simple)

### ✅ 7. Visibility & Trust

**Transparency**:
- "Why this price?" button (GPT-4 explanation)
- Historical acceptance rates visible
- Network revenue stats published
- Cost-basis analysis (Central knows if price is fair)

**Auditability**:
- All pricing decisions logged
- AI reasoning stored in database
- Admin overrides tracked
- Farm responses timestamped

### ✅ 8. Multi-Agent Review (This Proposal)

**Process**:
1. ✅ Investigation complete (14 codebase searches)
2. ✅ Proposal created (this document)
3. ⏳ Review Agent validation (PENDING - needs re-review due to architecture change)
4. ⏳ Architecture Agent strategic approval (PENDING)
5. ⏳ Implementation (after approval)

---

## Open Questions for Review Agent

### 1. Farm Autonomy Concerns

**Question**: Is "dictated pricing" acceptable, or should farms have override ability?

**Options**:
- **A**: Pure accept/reject (current proposal)
- **B**: Accept with counter-offer (farm can propose alternative price)
- **C**: Opt-out entirely from wholesale (farm does direct sales only)

**Recommendation**: Start with A (simplest), add B if rejection rate > 40%

### 2. Pricing Change Frequency

**Question**: How often should Central update wholesale prices?

**Options**:
- **Weekly**: Responsive to demand shifts (higher admin load)
- **Bi-weekly**: Balanced (recommended)
- **Monthly**: Stable but slow to react

**Recommendation**: Bi-weekly (7-14 day offers)

### 3. Tiered Pricing (Quality Premiums)

**Question**: Should organic farms get higher wholesale prices?

**Implementation**:
- Organic: +20% premium
- Hydroponic: +10% premium
- Conventional: Base price
- Quality certification (GAP, USDA Organic): +15%

**Data Required**: Farm cost surveys (does organic actually cost 20% more?)

### 4. Admin Approval Workflow

**Question**: Should AI auto-apply prices, or require manual approval?

**Safety Levels**:
- **Level 1** (Manual): Admin approves every price (safest, slow)
- **Level 2** (Semi-Auto): Auto-apply if confidence > 0.85 AND acceptance > 70%
- **Level 3** (Full Auto): AI sets prices, admin reviews weekly

**Recommendation**: Start Level 1, graduate to Level 2 after 3 months

### 5. Cost-Basis Protection

**Question**: Should Central refuse to set prices below farm cost + 20% margin?

**Implementation**:
- Quarterly farm cost surveys (electricity, labor, seeds)
- AI algorithm constraint: `price >= max(farmCosts) * 1.20`
- Override: Admin can force lower price if farm opts out

**Recommendation**: YES - protects farm profitability

### 6. Buyer Transparency

**Question**: Should buyers see "why this price?" reasoning?

**Considerations**:
- **Pro**: Buyer trust (understands seasonal premium)
- **Con**: Reveals supply/demand (buyer may wait for oversupply)

**Recommendation**: YES - but simplified ("Winter premium" not "1.8x demand ratio")

### 7. OpenAI Cost at Scale

**Question**: $0.60/farm/month acceptable?

**Calculation** (Revised for Central Model):
- 50 crops × 1 price analysis/crop/week = 50 API calls/week
- GPT-4 cost: ~$0.03 per analysis
- Monthly: $6.00 **total** (not per farm)
- **Impact**: Negligible for network ($0.12 per farm if 50 farms)

**Recommendation**: APPROVED (cost is trivial)

---

## Validation Strategy

### Automated Tests (33 total)

**Tier 1** (12 tests):
1. Calculate wholesale price (supply/demand ratio)
2. Send price offer to farms (notification)
3. Farm accepts offer (update database)
4. Farm rejects offer (track rejection)
5. Get acceptance rate (6/8 = 75%)
6. Offer expiration (auto-expire after 7 days)
7. Admin view pricing dashboard (UI data)
8. Farm view current offers (filtered by inventory)
9. Historical pricing query (last 30 days)
10. Price below cost detection (alert admin)
11. Multiple offers per crop (versioning)
12. Database constraints (foreign keys, indexes)

**Tier 2** (11 tests):
13. Fetch USDA price (API or manual input)
14. Predict acceptance rate (logistic model)
15. Compare with market position (premium/discount)
16. Calculate optimal price (max revenue × acceptance)
17. Historical price chart (Chart.js data)
18. Acceptance rate trend (improving/declining)
19. Revenue projection (price change simulation)
20. Farm cost survey integration (below-cost alert)
21. Quality tier pricing (organic +20%)
22. Seasonal adjustment (winter premium)
23. Buyer sensitivity analysis (restaurant vs grocer)

**Tier 3** (10 tests):
24. GPT-4 price recommendation (API call)
25. AI reasoning explanation (natural language)
26. Confidence score > 0.70 (quality threshold)
27. Acceptance rate prediction (AI vs actual)
28. Network health analysis (supply/demand balance)
29. Price simulation (what-if analysis)
30. Admin approval workflow (approve/reject AI)
31. Auto-apply safeguards (confidence + acceptance gates)
32. OpenAI error handling (fallback to rule-based)
33. Cost vs budget tracking (OpenAI spend)

### Manual Testing (6 scenarios)

1. **Scenario: Central sets price too low**
   - Expected: 70% farms reject
   - Action: Admin increases price by 15%
   - Outcome: Acceptance rate rises to 80%

2. **Scenario: AI recommends price increase**
   - Expected: Admin reviews reasoning, approves
   - Action: New price offer sent to farms
   - Outcome: 75% acceptance rate (within target)

3. **Scenario: Farm rejects with notes**
   - Expected: "Price below cost" note visible to admin
   - Action: Admin reviews farm cost data, adjusts offer
   - Outcome: Farm accepts revised offer

4. **Scenario: Offer expires without response**
   - Expected: Farm marked as "opted out" for this crop
   - Action: No wholesale listings for this farm/crop
   - Outcome: Buyer sees "out of stock" for this farm

5. **Scenario: USDA price significantly lower**
   - Expected: AI flags "GreenReach premium 25% above market"
   - Action: Admin reviews quality justification (organic, local)
   - Outcome: Keep price if justified, reduce if not

6. **Scenario: Multiple crops batch pricing**
   - Expected: Admin reviews 5 lettuce varieties together
   - Action: Approve all at once (batch action)
   - Outcome: Offers sent to 15 farms, 70%+ acceptance

---

## Rollback Plan

**If acceptance rate < 40% for 2 consecutive weeks**:

1. **Immediate**: Admin manually sets prices (bypass AI)
2. **Week 1**: Survey farms (why rejecting?)
3. **Week 2**: Adjust pricing model (increase margins)
4. **Week 3**: Re-enable AI with new constraints
5. **Nuclear Option**: Revert to farm-set pricing (old model)

**Database Rollback**:
```sql
-- Disable all active offers
UPDATE pricing_offers SET status = 'cancelled' WHERE status = 'active';

-- Restore farm pricing autonomy (if needed)
-- (farms can use old AI Pricing Assistant in farm-admin.js)
```

---

## Next Steps (Awaiting Review Agent Validation)

1. **Review Agent**: Re-validate this revised proposal
   - Technical feasibility (Central-focused architecture)
   - Risk assessment (farm autonomy concerns)
   - Framework compliance (Simplicity Over Features)
   - Data schema impact (new pricing tables)
   - Validation coverage (33 tests adequate?)

2. **Architecture Agent**: Strategic business review
   - Marketplace model vs cooperative model
   - Farm trust & autonomy balance
   - Long-term scalability (100+ farms)
   - Competitive positioning (Central as pricing authority)

3. **Implementation**: After dual approval
   - Week 1: Central Pricing Authority core
   - Week 2: Competitive intelligence
   - Week 3-4: AI-optimized pricing
   - Production: Gradual rollout (5 farms pilot)

---

## Appendix A: Comparison Table

| Aspect | Old Model (Incorrect) | New Model (Marketplace) |
|--------|----------------------|------------------------|
| **Who sets price?** | Individual farms | GreenReach Central |
| **Farm role** | Price setter | Price taker (accept/reject) |
| **Decision location** | Edge (farm-admin.js) | Central (pricing-authority.js) |
| **Farm workload** | 30 min/week (research) | 30 sec/week (click button) |
| **Buyer experience** | Shop around for best price | Uniform pricing across network |
| **Price coordination risk** | HIGH (10 farms, similar AI) | ELIMINATED (single authority) |
| **Network optimization** | Sub-optimal (local view) | Optimal (Central sees all data) |
| **Implementation complexity** | Edge AI + sync | Central AI only (simpler) |
| **Farm autonomy** | Full (set own prices) | Limited (accept/reject only) |
| **Trust requirement** | Low (farm controls) | HIGH (trust Central authority) |

---

## Appendix B: Farm UI Mockup (Simplified)

```
┌─────────────────────────────────────────────────────────┐
│  Wholesale Participation (GreenReach Network)           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Current Offers from GreenReach Central:                │
│                                                          │
│  ╔═══════════════════════════════════════════════════╗  │
│  ║ Butterhead Lettuce                               ║  │
│  ║ Wholesale Price: $5.15/lb                        ║  │
│  ║                                                   ║  │
│  ║ Reasoning: High demand (1.8x supply), winter     ║  │
│  ║ premium. 75% of network farms accepted.          ║  │
│  ║                                                   ║  │
│  ║ Your Cost: $4.20/lb (estimated)                  ║  │
│  ║ Your Margin: +22.6% ✓ Profitable                 ║  │
│  ║                                                   ║  │
│  ║ Expires: Feb 7, 2026 (6 days remaining)          ║  │
│  ║                                                   ║  │
│  ║ [✓ Accept $5.15]  [✗ Reject]  [? Why this price?]║  │
│  ╚═══════════════════════════════════════════════════╝  │
│                                                          │
│  ╔═══════════════════════════════════════════════════╗  │
│  ║ Baby Arugula                                     ║  │
│  ║ Wholesale Price: $8.50/lb                        ║  │
│  ║                                                   ║  │
│  ║ Your Cost: $8.20/lb (estimated)                  ║  │
│  ║ Your Margin: +3.7% ⚠️  Marginal                   ║  │
│  ║                                                   ║  │
│  ║ [✓ Accept $8.50]  [✗ Reject]  [💬 Add note]      ║  │
│  ╚═══════════════════════════════════════════════════╝  │
│                                                          │
│  Your Historical Acceptance Rate: 78% (above network)   │
│                                                          │
│  📊 View Pricing History    ℹ️ About Pricing Authority   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Key Features**:
- One-click accept/reject (simplicity)
- Margin calculation (farm sees profitability)
- Expiration countdown (urgency)
- "Why this price?" explanation (transparency)
- Historical acceptance rate (trust building)

---

**END OF REVISED PROPOSAL**

---

## Review Agent: Please Re-Validate

**Changes from Original**:
1. **Architecture**: Edge pricing → Central pricing authority
2. **Farm Role**: Price setter → Price taker (accept/reject)
3. **Implementation**: farm-admin.js changes → greenreach-central services
4. **Complexity**: Reduced (Central-only AI, not distributed)
5. **Risk Profile**: Price coordination eliminated, farm autonomy concerns added

**Key Questions**:
1. Does Central pricing authority align with GreenReach business model?
2. Is 65% acceptance rate threshold realistic?
3. Are farm autonomy mitigations sufficient (reject option, transparency)?
4. Should farms have counter-offer capability, or just accept/reject?
5. Is validation coverage (33 tests) adequate for marketplace model?

**Awaiting Review Agent & Architecture Agent feedback before proceeding.**

---

## 📝 Summary Notes

### @ReviewAgent - Critical Architecture Revision Required

**MAJOR CHANGE**: Original P5 proposal assumed **farm-set pricing** (farms control their own wholesale prices with AI recommendations). User clarified actual business model is **marketplace pricing** (GreenReach Central dictates wholesale prices, farms accept/reject offers).

**What Changed**:
1. **Implementation Location**: Edge (farm-admin.js) → Central (pricing-authority.js)
2. **Farm Workflow**: Research market + set prices (30 min) → Click accept/reject (30 sec) = **60x simpler** ✅
3. **Price Coordination Risk**: ELIMINATED (single authority vs 10 farms with similar AI)
4. **Data Flow**: Distributed (each farm analyzes) → Centralized (Central analyzes network-wide data)
5. **Farm Autonomy**: Full control → Limited (accept/reject only) ⚠️

**New Risks Introduced**:
- **Farm Trust**: Will farms trust Central to set fair prices? (Mitigated: transparent reasoning, reject option, cost-basis protection)
- **Admin Bottleneck**: Central becomes single point of failure (Mitigated: AI auto-generates recommendations, admin approves in 1-2 min)
- **Acceptance Rate**: If <50% farms reject, marketplace collapses (Mitigated: 65% target, early warning alerts, auto-adjustment)

**Framework Compliance Impact**:
- ✅ **Simplicity**: IMPROVED (60x simpler for farms - core mission alignment)
- ✅ **Zero Config**: IMPROVED (farms receive offers automatically, no pricing research)
- ✅ **Workflow-Centric**: IMPROVED (single decision: accept/reject vs complex pricing analysis)
- ⚠️ **Farm Autonomy**: REDUCED (trade-off: simplicity vs control)

**Validation Requirements**:
- 33 automated tests (same count, different focus: Central APIs + farm response tracking)
- 6 manual scenarios (marketplace-specific: rejection handling, batch pricing, cost-basis protection)
- **New Test Category**: Acceptance rate monitoring (alert if <50% within 48 hours)

**Questions for Review Agent**:
1. Is marketplace model architecturally sound given farm trust concerns?
2. Should farms have counter-offer capability (Option B) or pure accept/reject (Option A)?
3. Is 65% acceptance rate threshold realistic for network health?
4. Are transparency mitigations sufficient ("Why this price?" explanations, cost surveys)?
5. Should AI auto-apply prices (Level 2/3) or require manual approval forever (Level 1)?

**Technical Feasibility**: HIGH (reuses existing Central infrastructure: OpenAI, wholesale APIs, admin dashboard)

**Risk Level**: UNCHANGED (🔴 HIGH) but risk shifted from "price coordination" to "farm acceptance rate"

---

### @ImplementationAgent - Do Not Proceed Until Approval

**BLOCKING**: This proposal requires **dual approval** (Review Agent + Architecture Agent) due to fundamental business model change.

**If Approved, Implementation Order**:
1. **Week 1**: Central Pricing Authority (Tier 1 - Rule-based)
   - Create: `greenreach-central/services/pricing-authority.js` (400 lines)
   - Create: `greenreach-central/routes/admin-pricing.js` (250 lines)
   - Create: Database tables (pricing_offers, pricing_responses)
   - Modify: `server-foxtrot.js` (add farm response endpoints)
   - Modify: `farm-admin.html` (replace AI Pricing Assistant with "Wholesale Prices" section)
   - Tests: 12 automated + 3 manual scenarios

2. **Week 2**: Competitive Intelligence (Tier 2)
   - Create: `greenreach-central/services/pricing-analyzer.js` (350 lines)
   - Add: USDA API integration (or manual input fallback)
   - Enhance: Admin dashboard with market intelligence section
   - Tests: 11 additional (23 total)

3. **Week 3-4**: AI-Optimized (Tier 3 - GPT-4)
   - Create: `greenreach-central/services/pricing-ai.js` (300 lines)
   - Integrate: OpenAI GPT-4 (reuse ai-recommendations-pusher.js pattern)
   - Add: Admin approval workflow with auto-apply safeguards
   - Tests: 10 additional (33 total)

**Critical Files to NOT Modify**:
- ❌ `public/data/crop-pricing.json` - Still used for farm-direct (retail) pricing, NOT wholesale
- ❌ `farm-admin.js` lines 1176-1235 - Old AI Pricing Assistant can stay (legacy, not harmful)

**Critical Files to Create**:
- ✅ `greenreach-central/services/pricing-authority.js` - Core pricing logic (NEW)
- ✅ `greenreach-central/routes/admin-pricing.js` - Admin API (NEW)
- ✅ `greenreach-central/public/pricing-admin.html` - Admin dashboard (NEW)
- ✅ Database migration SQL (pricing_offers + pricing_responses tables)

**Estimated Timeline**: 22-24 days (3.5 weeks) - UNCHANGED from original proposal

**Rollback Plan**: If acceptance rate <40% for 2 weeks → revert to farm-set pricing (old model in farm-admin.js still exists)

**OpenAI Cost**: $6.00/month total (not per farm) = negligible

**Monitoring Requirements**:
- CloudWatch alert: acceptance_rate < 0.50 after 48 hours
- CloudWatch alert: rejection_count > 5 for single crop
- Weekly report: acceptance trends, revenue impact, farm profitability

---

### @ArchitectureAgent - Strategic Business Model Decision Required

**STRATEGIC QUESTION**: Should GreenReach operate as **marketplace** (Central sets prices) or **cooperative** (farms set prices)?

**Marketplace Model** (This Proposal):
- **Pro**: Simpler for farms (60x workload reduction), network-wide optimization, professional buyer experience
- **Con**: Farms lose pricing autonomy, requires high trust in Central, single point of failure

**Cooperative Model** (Original P5):
- **Pro**: Farm autonomy preserved, distributed decision-making, no central bottleneck
- **Con**: Complex for farms (30 min/week research), price coordination risk (legal), buyer confusion (different prices)

**Recommendation**: Marketplace model aligns with **"Simplicity Over Features"** core mission (60x farm workload reduction)

**Long-Term Vision Questions**:
1. At 100+ farms, can Central admin scale pricing decisions? (AI auto-apply may be required)
2. Will farms trust Central enough to accept 65%+ of offers? (Transparent reasoning critical)
3. Should GreenReach take marketplace fee (5% of wholesale) to fund pricing infrastructure?
4. Does marketplace model conflict with farm independence values?

**Competitive Positioning**: Most farm networks are cooperatives (farms set prices). Marketplace model differentiates GreenReach as "premium managed network" (professional, consistent, optimized).

**Awaiting strategic approval before Review Agent proceeds with technical validation.**
