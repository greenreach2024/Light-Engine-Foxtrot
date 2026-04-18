# Vertical Farm Production Calculator - Detailed Specification

**Last Updated**: 2026-02-07  
**Purpose**: Generate detailed business plans for vertical farming grant applications  
**Integration**: Phase 4 of Grant Wizard Intelligence Roadmap

---

## 🎯 Business Context

Vertical farm founders applying for grants (AAFC AgriInnovate, Bioenterprise, provincial programs) need:
1. **Detailed financial projections**: 5-year revenue/expense forecasts
2. **Technical feasibility**: HVAC sizing, electrical load calculations
3. **Labour planning**: FTE requirements as production scales
4. **Risk analysis**: Sensitivity to energy costs, yield variations, pricing

**Current Problem**: Founders spend 20-40 hours building financial models from scratch, often with errors. Grant reviewers question assumptions without documentation.

**Solution**: Automated calculator that outputs investor-grade business plan sections, pre-populated into grant wizard.

---

## 📐 Production Model Assumptions

### Container-Scale System (Not Shipping Container)
**Clarification**: "Container-scale" refers to modular production units (~320 sq ft footprint), not repurposed shipping containers.

### Physical Layout
- **Rack Configuration**: 3 vertical levels per rack
- **Tray Size**: 24" × 28" (4.67 sq ft)
- **Trays per Level**: Variable (depends on room size), typically 10-20
- **Aisle Width**: 3-4 feet between racks for access
- **Room Height**: 12-14 feet (allows 3 levels + clearance)

### Crop Specifications

| Crop Type | Plants/Tray | Days to Harvest | Wholesale $/kg | Retail Markup |
|-----------|-------------|-----------------|----------------|---------------|
| Butter Lettuce | 30 | 28 | $8-12 | 2.0x |
| Pak Choi | 24 | 32 | $10-14 | 1.8x |
| Microgreens (Sunflower) | 200+ | 10 | $40-60 | 2.5x |
| Basil | 15 | 35 | $18-25 | 2.2x |
| Kale (Baby) | 28 | 30 | $12-16 | 1.9x |

**Yield per Tray** (approximate):
- Lettuce: 2.5 kg
- Pak Choi: 3.0 kg
- Microgreens: 0.8 kg (but 3x harvests/month)
- Basil: 1.2 kg
- Kale: 2.8 kg

---

## 💡 Lighting System

### Equipment
- **Type**: Full-spectrum LED grow lights
- **Configuration**: 2 × 100W fixtures per tray level
- **Cost**: $119 per pair (Alibaba/Spider Farmer equivalent)
- **Efficiency**: 2.7 μmol/J (modern LEDs)
- **PPFD Target**: 300-400 μmol/m²/s (leafy greens), 600+ (fruiting crops)

### Electrical Calculations
```
Lights per Tray Pair: 2 fixtures × 100W = 200W
Daily Energy (per tray): 200W × 16 hours = 3.2 kWh/day
Monthly Energy: 3.2 kWh × 30 days = 96 kWh/month/tray
```

**Photoperiod Assumptions**:
- Leafy greens: 16 hours light / 8 hours dark
- Microgreens: 18 hours (accelerated growth)
- Fruiting crops (tomatoes, peppers): 14-16 hours

### Lighting Costs by Scale
- **100 trays**: 100 × 96 kWh = 9,600 kWh/month
- **500 trays**: 48,000 kWh/month
- **1,000 trays**: 96,000 kWh/month

**Provincial Rates** (commercial, 2026):
- ON: $0.12/kWh
- BC: $0.09/kWh
- AB: $0.11/kWh
- QC: $0.07/kWh (cheapest in Canada)

---

## 💧 Hydroponic System

### Pump Configuration
- **Supply Pump**: $800 per 10,000 plants
  - Delivers nutrient solution from reservoir to trays
  - Typically 1/2 HP, 3,000 GPH flow rate
- **Return Pump**: $400 per 10,000 plants
  - Returns excess solution to reservoir
  - Lower flow rate, 1/4 HP sufficient

### Electrical Load (Pumps)
- **Continuous Operation**: 300W supply + 150W return = 450W per 10k plants
- **Duty Cycle**: Typically 15 min on / 15 min off (50% uptime)
- **Effective Load**: 225W avg, or 162 kWh/month per 10k plants

### Scale Example
- **40,000 plants** (e.g., 1,600 lettuce trays):
  - 4 supply pumps: $3,200
  - 4 return pumps: $1,600
  - **Total pump cost**: $4,800
  - **Electrical**: 648 kWh/month

### Reservoir Sizing
- **Rule of Thumb**: 1 gallon per plant (buffer for evapotranspiration)
- **100 trays** (3,000 plants): 3,000 gal = 11,300 L → 5-6 × 2,000L tanks
- **Reservoir Cost**: ~$200 per 2,000L food-grade tank

---

## 🌡️ HVAC & Dehumidification

### Transpiration Load
**Fundamental**: Plants transpire ~30g water/day (leafy greens, mature stage)

**Latent Heat Formula** (corrected):
```
BTU/hour = (plants × 30g/day × 2326 BTU/kg) / 24 hours
        = plants × 2.91 BTU/hour
```

> **Physics correction (2026-04).** Earlier revisions of this spec used
> `1055 BTU/kg` for water's latent heat of vaporization. That's actually the
> BTU-per-**pound** value (1055 BTU/lb ≈ 2326 BTU/kg). The correct BTU/kg
> constant at ~20°C is `2326` (2454 kJ/kg ÷ 1.05506 kJ/BTU). Using the right
> constant roughly **doubles** the cooling tonnage vs. the old worked
> examples below. The formula is enforced in `lib/farm-load-calculator.js`
> and cross-checked by `tests/farm-load-calculator.test.mjs`; any new
> grant-wizard / quote numbers should be re-derived from the corrected
> table.

**Example** (10,000 plants):
```
10,000 × 2.91 = 29,100 BTU/hour latent load
Add 30% sensible heat (lights, pumps) = 37,800 BTU/hour total
Convert to tons: 37,800 / 12,000 = 3.15 tons cooling
```

### HVAC Sizing by Scale

Cooling-tons column reflects the corrected latent-heat constant. Cost
estimates are left from the previous revision and should be re-quoted
against the larger unit sizing (and removed from this doc if they start
diverging from vendor quotes).

| Plants | Transpiration (kg/day) | Cooling (tons) | Dehumid (L/day) | Estimated Cost (re-quote) |
|--------|------------------------|----------------|-----------------|---------------------------|
| 5,000  | 150                    | 1.57           | 150             | TBD (re-quote)            |
| 10,000 | 300                    | 3.15           | 300             | TBD (re-quote)            |
| 20,000 | 600                    | 6.30           | 600             | TBD (re-quote)            |
| 50,000 | 1,500                  | 15.74          | 1,500           | TBD (re-quote)            |

**Dehumidification**:
- Standalone dehumidifiers: $1,500-3,000 for 150L/day capacity
- Integrated HVAC with dehumid: +30% cost vs. cooling-only

**Electrical Load** (corrected):
- 1 ton cooling ≈ 1,200W (EER 10)
- 10,000 plants: 3.15 tons × 1,200W = 3,780W continuous
- Monthly: 3,780W × 24h × 30d = 2,722 kWh

### Climate Control Costs (Operational)
```
10,000 plants, Ontario ($0.12/kWh):
HVAC: 2,722 kWh × $0.12 = $327/month
Dehumid: 300L/day requires ~400W avg = 288 kWh = $35/month
Total: $362/month
```

---

## 👥 Labour Requirements

### Staffing Model (User-Provided)
- **4,000 plants**: 2 FTE
- **10,000 plants**: 3 FTE
- **20,000+ plants**: +1 FTE per additional 10,000 plants

### Labour Activities
1. **Seeding**: Transplant plugs to trays (1-2 hours per 100 trays)
2. **Monitoring**: Daily pH/EC checks, pest scouting (1 hour/day base)
3. **Harvesting**: Cut, wash, package (3-5 hours per 100 trays)
4. **Packaging**: Bag/label for delivery (2-3 hours per 100 trays)
5. **Cleaning**: Sanitize trays, reservoirs (10% of total time)
6. **Delivery**: Local distribution (if applicable, 5-10 hours/week)

### Wage Assumptions (2026, Canada)
- **Base wage**: $18-22/hour (varies by province)
  - ON: $18.50
  - BC: $19.00
  - QC: $16.50
  - AB: $20.00
- **Benefits**: +15% (CPP, EI, workers comp)
- **Effective rate**: $21-25/hour fully loaded

### Labour Cost Example (10,000 plants)
```
3 FTE × 40 hours/week × 52 weeks = 6,240 hours/year
6,240 hours × $22/hour × 1.15 = $158,088/year
Monthly: ~$13,174
```

---

## 💰 Capital Expenditure (CAPEX) Model

### Tier 1: Infrastructure (Room Build-Out)
| Item | Spec | Cost/Unit | Scale Factor |
|------|------|-----------|--------------|
| Racks (3-level) | Steel, powder-coated | $400/rack | 10 trays/rack |
| Trays | Food-grade plastic, 24"×28" | $15/tray | 1:1 with capacity |
| Reservoirs | 2,000L food-grade tanks | $200/tank | 1 per 10 trays |
| Room Insulation | R-20 foam board | $3/sq ft | Fixed (room size) |
| Flooring | Epoxy coating | $5/sq ft | Fixed |
| Electrical Panel | 200A service upgrade | $3,000 | Fixed (scales at 500+ trays) |

**Example** (100 trays):
- 10 racks × $400 = $4,000
- 100 trays × $15 = $1,500
- 10 reservoirs × $200 = $2,000
- 320 sq ft room × $8 (insulation + floor) = $2,560
- Electrical: $3,000
- **Subtotal**: $13,060

### Tier 2: Environmental Systems
| Item | Spec | Cost | Scale Factor |
|------|------|------|--------------|
| HVAC (cooling) | Split AC or packaged unit | $1,500/ton | See HVAC table |
| Dehumidifier | 150L/day capacity | $2,500/unit | 1 per 10k plants |
| Circulation Fans | 20" industrial | $150/fan | 1 per 5 racks |
| CO2 Generator | Propane or bottled | $800 | 1 per room |

**Example** (10,000 plants):
- HVAC: 1.4 tons × $1,500 = $2,100
- Dehumid: 1 × $2,500 = $2,500
- Fans: 2 × $150 = $300
- CO2: $800
- **Subtotal**: $5,700

### Tier 3: Lighting & Hydroponics
- **Lighting**: 100 trays × $119 = $11,900
- **Pumps**: $4,800 (from earlier)
- **Plumbing**: PVC, fittings (~$500 per 10k plants)
- **Nutrient System**: Dosing pumps, sensors ($2,000 base)
- **Subtotal**: $19,200

### Tier 4: Automation & Controls
| Item | Cost | Notes |
|------|------|-------|
| Environmental Controller | $3,000-8,000 | Grolab, GrowDirector, custom |
| pH/EC Sensors | $1,200 | 2 per reservoir |
| Water Level Sensors | $300 | 1 per reservoir |
| Camera System (optional) | $1,500 | Growth monitoring |
| Software Subscription | $100-500/month | Cloud logging, alerts |

**Example**: $5,000 for basic automation

### Total CAPEX Estimate (10,000 plant system)
```
Infrastructure: $13,060 (scaled to ~50 trays)
Wait, let me recalculate for 10,000 plants (~330 trays):

Infrastructure: 33 racks ($13,200) + 330 trays ($4,950) + 33 reservoirs ($6,600) + room ($10,000) + electrical ($5,000) = $39,750
Environmental: $5,700
Lighting: 330 × $119 = $39,270
Hydroponics: $4,800 + $1,500 + $2,000 = $8,300
Automation: $5,000

TOTAL CAPEX: ~$98,000 for 10,000 plants
```

**Per-Plant CAPEX**: $9.80/plant (economies of scale reduce this at 50k+ plants)

---

## 📊 Operating Expenditure (OPEX) Model

### Fixed Monthly Costs
| Category | Calculation | Example (10k plants) |
|----------|-------------|----------------------|
| Labour | FTE × hours × wage | $13,174 |
| Electricity (lights) | kWh × rate | $3,110 (ON) |
| Electricity (HVAC) | kWh × rate | $180 |
| Electricity (pumps) | kWh × rate | $78 |
| **Subtotal (power)** | | **$3,368** |
| Nutrients | $0.15/plant/cycle | $450 (30-day cycle) |
| Seeds/Plugs | $0.05/plant | $167 |
| Packaging | 15% of revenue | ~$900 (varies) |
| Water/Sewer | ~5% of power | $168 |
| Insurance | $500-1,500/month | $750 |
| Rent (if applicable) | $1-3/sq ft/month | $800 (800 sq ft) |
| Maintenance | 3% of CAPEX/year | $245 |

**Total OPEX** (10k plants, owned space): **~$19,250/month**  
**With rent**: **~$20,050/month**

---

## 💵 Revenue Model

### Harvest Assumptions
- **Lettuce** (28-day cycle): 330 trays → 825 kg/month
- **Wholesale price**: $10/kg
- **Gross revenue**: $8,250/month

### Multi-Crop Scenario (Diversified)
| Crop | Trays | Kg/Month | Price | Revenue |
|------|-------|----------|-------|---------|
| Lettuce | 150 | 375 | $10 | $3,750 |
| Pak Choi | 100 | 300 | $12 | $3,600 |
| Microgreens | 50 | 120 | $50 | $6,000 |
| Basil | 30 | 36 | $22 | $792 |
| **Total** | **330** | **831 kg** | | **$14,142** |

**Packaging Costs**: 15% = $2,121  
**Net Revenue**: $12,021

### Break-Even Analysis (10k plant system)
```
Monthly OPEX: $19,250
Net Revenue: $12,021
Monthly Loss: -$7,229

To break even, need:
$19,250 / (1 - 0.15 packaging) = $22,647 gross revenue
$22,647 / $10 avg per kg = 2,265 kg/month
Current: 831 kg → need 2.73x production (i.e., ~900 trays = 27k plants)
```

**Break-Even Scale**: ~25,000-30,000 plants for this cost structure

---

## 📈 5-Year Financial Projection Template

### Key Assumptions
1. **Ramp-Up**:
   - Year 1: 50% capacity (learning curve)
   - Year 2: 75%
   - Year 3+: 90% (account for crop failures)
2. **Pricing**: Assume 3% annual inflation
3. **Costs**:
   - Labour: 4% COLA annually
   - Electricity: 5% annual increase (Canada trend)
   - Nutrients: 2% inflation
4. **Growth**: Expand capacity in Year 2 (add 10k plants = $80k CAPEX)

### Sample Output (Simplified)
| Year | Plants | Revenue | OPEX | EBITDA | CAPEX | Net Cash Flow |
|------|--------|---------|------|--------|-------|---------------|
| 0    | 0      | $0      | $0   | $0     | $98k  | -$98k         |
| 1    | 5k     | $72k    | $180k| -$108k | $10k  | -$118k        |
| 2    | 15k    | $240k   | $350k| -$110k | $80k  | -$190k        |
| 3    | 25k    | $420k   | $480k| -$60k  | $20k  | -$80k         |
| 4    | 30k    | $540k   | $540k| $0     | $30k  | -$30k         |
| 5    | 35k    | $650k   | $590k| $60k   | $20k  | $40k          |

**Cumulative 5-Year**: -$476k  
**Payback Period**: ~6-7 years at this scale

**Note**: These numbers are illustrative. Actual results vary by:
- Crop selection (microgreens = higher margin)
- Customer channel (direct-to-consumer = +40% vs. wholesale)
- Location (QC electricity = 40% cheaper than ON)
- Efficiency (yield optimization, waste reduction)

---

## 🔧 Calculator Implementation Plan

### Step 1: Input Collection
**Frontend** (`farm-calculator.html`):

```html
<div class="calc-section">
  <h2>Production Scale</h2>
  <label>Number of Trays: <input type="number" id="numTrays" value="100"></label>
  <p>Estimated plants: <span id="estPlants">3000</span></p>
</div>

<div class="calc-section">
  <h2>Crop Selection</h2>
  <select id="cropType">
    <option value="lettuce">Butter Lettuce</option>
    <option value="pakchoi">Pak Choi</option>
    <option value="microgreens">Microgreens (Sunflower)</option>
    <option value="basil">Basil</option>
    <option value="kale">Baby Kale</option>
  </select>
</div>

<div class="calc-section">
  <h2>Location</h2>
  <select id="province">
    <option value="ON">Ontario ($0.12/kWh)</option>
    <option value="QC">Quebec ($0.07/kWh)</option>
    <option value="BC">British Columbia ($0.09/kWh)</option>
    <option value="AB">Alberta ($0.11/kWh)</option>
  </select>
</div>

<button onclick="calculateModel()">Generate Business Plan</button>
```

### Step 2: Calculation Engine
**Backend** (`routes/farm-calculator.js`):

```javascript
export async function calculateFarmModel(req, res) {
  const { numTrays, cropType, province, } = req.body;
  
  // Lookup tables
  const cropData = {
    lettuce: { plantsPerTray: 30, daysToHarvest: 28, kgPerTray: 2.5, pricePerKg: 10 },
    // ... other crops
  };
  
  const electricityRates = {
    ON: 0.12, QC: 0.07, BC: 0.09, AB: 0.11
  };
  
  // Calculations
  const plants = numTrays * cropData[cropType].plantsPerTray;
  const lightingKwh = numTrays * 96; // per month
  const hvacKwh = (plants * 2.91 * 24 * 30) / 3412; // BTU → kWh (corrected: latent heat is 2326 BTU/kg, not 1055)
  const totalKwh = lightingKwh + hvacKwh;
  const electricityCost = totalKwh * electricityRates[province];
  
  // Labour
  let fte = plants <= 4000 ? 2 : plants <= 10000 ? 3 : 3 + Math.floor((plants - 10000) / 10000);
  const labourCost = fte * 40 * 4.33 * 22 * 1.15; // per month
  
  // Revenue
  const harvestsPerMonth = 30 / cropData[cropType].daysToHarvest;
  const kgPerMonth = numTrays * cropData[cropType].kgPerTray * harvestsPerMonth;
  const grossRevenue = kgPerMonth * cropData[cropType].pricePerKg;
  const packagingCost = grossRevenue * 0.15;
  const netRevenue = grossRevenue - packagingCost;
  
  // CAPEX
  const racks = Math.ceil(numTrays / 10);
  const capex = {
    racks: racks * 400,
    trays: numTrays * 15,
    lighting: numTrays * 119,
    pumps: Math.ceil(plants / 10000) * 1200,
    hvac: (plants * 1.32 / 12000) * 1500,
    automation: 5000,
    total: 0 // sum above
  };
  capex.total = Object.values(capex).reduce((a, b) => a + b, 0) - capex.total;
  
  // OPEX
  const opex = {
    labour: labourCost,
    electricity: electricityCost,
    nutrients: plants * 0.15,
    seeds: plants * 0.05,
    packaging: packagingCost,
    other: 1500
  };
  opex.total = Object.values(opex).reduce((a, b) => a + b, 0);
  
  const monthlyProfit = netRevenue - opex.total;
  const breakEvenMonths = capex.total / (netRevenue - opex.total);
  
  res.json({
    success: true,
    data: {
      inputs: { numTrays, cropType, province, plants },
      capex,
      opex,
      revenue: { gross: grossRevenue, net: netRevenue, kgPerMonth },
      profitability: { monthlyProfit, breakEvenMonths },
      projections: generate5YearProjection(capex, opex, netRevenue)
    }
  });
}
```

### Step 3: Output Formatting
Generate business plan sections:

1. **Executive Summary**: "This vertical farm will produce X kg/month of [crop], generating $Y revenue with a Z-month payback."
2. **Technical Overview**: Rack/tray/lighting specs, HVAC sizing
3. **Financial Summary**: CAPEX table, OPEX breakdown, 5-year projection
4. **Risk Analysis**: Sensitivity to electricity (+20%), yield (-15%), pricing (-10%)

### Step 4: Integration with Grant Wizard
- Store in `farm_production_models` table
- Auto-populate wizard fields:
  - Budget: `capex.total`
  - Project Description: Technical overview paragraph
  - Narrative: Financial summary + risk analysis

---

## 🧪 Testing & Validation

### Unit Tests
- [ ] CAPEX calculations match manual spreadsheet
- [ ] OPEX scales correctly with plant count
- [ ] Revenue assumptions match industry data (cross-check with Stats Canada AgriFood)
- [ ] Break-even analysis is mathematically correct

### Integration Tests
- [ ] Calculator → Grant Wizard data flow works
- [ ] PDF export includes all calculator sections
- [ ] 5-year projection table renders correctly

### User Acceptance
- [ ] Test with 3 real vertical farm founders
- [ ] Validate assumptions: "Are these labour hours realistic?"
- [ ] Compare output to existing business plans (if founder has one)

---

## 📝 Documentation for Grant Reviewers

**Include in PDF export**:

> **Assumptions & Methodology**
> 
> This financial projection is based on industry-standard vertical farming practices:
> - Lighting: 200W per tray (high-efficiency LEDs)
> - HVAC: Sized for 30g/day transpiration per plant
> - Labour: Based on [Company X]'s operational data (3 FTE per 10k plants)
> - Pricing: Conservative wholesale rates ($10/kg lettuce, below retail)
> 
> **Sensitivity Analysis**:
> - If electricity costs rise 20%: Monthly profit decreases 15%
> - If crop yield drops 15%: Break-even extends from 24 → 30 months
> - If wholesale pricing drops 10%: Monthly profit decreases 25%
> 
> For questions, see detailed methodology at [link to this spec doc].

---

## 🚀 Future Enhancements

1. **Multi-Room Modeling**: User has 3 rooms, each with different crops
2. **Equipment Vendor Integration**: API to get real-time prices from Spider Farmer, Grolab
3. **Benchmarking Database**: Compare user's projections to anonymized peer data
4. **Grant Fit Scoring**: "Your CAPEX of $98k qualifies for AAFC AgriInnovate ($100k-$10M range)"
5. **Interactive Charts**: ChartJS graphs for 5-year revenue/expense trends

---

**Status**: Specification complete, ready for implementation (Phase 4 of Grant Wizard Intelligence Roadmap).
