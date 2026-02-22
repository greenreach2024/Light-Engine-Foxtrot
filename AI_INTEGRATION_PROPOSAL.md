> **SUPERSEDED** — This proposal has been consolidated into [IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md](IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md). Retained for reference only.

# AI Integration Proposal - Light Engine Foxtrot

**Date**: January 31, 2026  
**Target System**: Light Engine Edge Device + GreenReach Central  
**Focus Areas**: Device/IoT, Grow Workflows, Environmental Management

---

## 1. Device & IoT Setup AI

### 1.1 Smart Device Discovery & Configuration

**Problem**: Manual device setup is time-consuming and error-prone
- Light controllers require IP addresses, protocols (GROW3/DMX), port configuration
- Sensors need pairing, calibration, placement validation
- WiFi/network configuration requires technical knowledge
- BLE device discovery and pairing can be unreliable

**AI Solution**: Intelligent Device Assistant

```javascript
// AI-powered device discovery and setup
class DeviceSetupAI {
  // Scan network and identify devices by protocol signature
  async discoverDevices() {
    // Use ML to identify device types from network traffic patterns
    // Match MAC addresses to known manufacturers
    // Suggest optimal device configurations based on farm layout
  }
  
  // Natural language device configuration
  async configureWithNL(userIntent) {
    // "Add the lights in room 2" → scan, find GROW3 controllers, configure
    // "Connect temperature sensor" → scan BLE, pair, calibrate, assign zone
    // "Setup new grow room" → orchestrate full device setup workflow
  }
  
  // Predictive troubleshooting
  async diagnoseConnectivity(device) {
    // Analyze connection patterns, signal strength, error logs
    // Suggest fixes: "Move router 10ft closer" or "Update firmware to v2.3"
  }
}
```

**Implementation Points**:
- **Setup Wizard Enhancement**: Add AI device discovery in Step 2 (Grow Rooms)
- **API Endpoint**: `POST /api/ai/discover-devices` → scans network, returns device list with confidence scores
- **UI**: Natural language input: "Find all lights in this building"
- **Backend**: Use nmap for network scan, ML model to classify device types from response signatures

### 1.2 WiFi & Network Optimization

**AI Solution**: Network Performance AI

```javascript
class NetworkAI {
  // Monitor and optimize network performance
  async optimizeNetwork() {
    // Track device connectivity patterns
    // Identify weak signal zones
    // Suggest AP placement or mesh network configuration
    // Auto-switch devices to best WiFi channel
  }
  
  // Predict connectivity issues before they happen
  async predictOutages() {
    // Analyze historical connectivity data
    // Weather correlation (outdoor influences)
    // Alert: "WiFi may drop in 2 hours due to storm"
  }
}
```

**Implementation Points**:
- Monitor WiFi signal strength per device (already have data from health checks)
- Add `/api/ai/network/optimize` endpoint
- Display network health map in health dashboard

### 1.3 BLE Sensor Pairing & Calibration

**AI Solution**: Smart Sensor Assistant

```javascript
class SensorSetupAI {
  // Guide user through sensor placement
  async suggestPlacement(sensorType, roomLayout) {
    // Analyze room dimensions, airflow patterns
    // Suggest optimal sensor placement for accurate readings
    // "Place temperature sensor 5ft high, center of room, away from lights"
  }
  
  // Auto-calibrate sensors using known conditions
  async calibrate(sensor) {
    // Compare readings to known good sensors
    // Detect drift or calibration issues
    // Suggest recalibration when needed
  }
  
  // Validate sensor data quality
  async validateReadings(sensorData) {
    // Detect anomalies: "Temp reading 120°F is impossible"
    // Cross-validate multiple sensors
    // Flag faulty sensors before they cause problems
  }
}
```

**Implementation Points**:
- Add sensor placement wizard with AI suggestions
- Real-time calibration feedback during setup
- Sensor health scoring based on reading consistency

---

## 2. Grow Workflow AI

### 2.1 Seeding & Transplanting Assistant

**Problem**: Growers must manually track seeding dates, transplant schedules, optimal timing
- Complex calculations: days to germination, transplant windows, harvest dates
- Each crop has different requirements
- Weather/season affects timing

**AI Solution**: Intelligent Planting Scheduler

```javascript
class PlantingAI {
  // Predict optimal seeding dates
  async suggestSeedingDate(crop, targetHarvestDate, currentConditions) {
    // Factor in: crop growth rate, current season, facility capacity
    // Outdoor influences: weather forecast, day length
    // Suggest: "Seed Buttercrunch Lettuce on Feb 5 for March 15 harvest"
  }
  
  // Optimize succession planting
  async planSuccessionPlanting(crop, weeklyDemand) {
    // Calculate staggered seeding schedule
    // Ensure continuous harvest to meet buyer demand
    // "Seed 50 trays every Monday and Thursday"
  }
  
  // Predict harvest readiness
  async predictHarvestDate(groupId) {
    // Analyze growth rate from sensor data
    // Compare to historical groups
    // Adjust estimate: "Harvest ready in 4 days (was 7 days)"
  }
}
```

**Implementation Points**:
- Add AI suggestions to Groups V2 wizard (Step 3: Set Anchor)
- Display confidence scores: "85% confidence harvest on March 15"
- API: `POST /api/ai/suggest-seeding` with crop, target date, conditions
- **Database Extension**: Store AI predictions in `groups.json`:
```json
{
  "ai_predictions": {
    "suggested_seed_date": "2026-02-05",
    "predicted_harvest_date": "2026-03-15",
    "confidence": 0.85,
    "factors": ["growth_rate", "day_length", "temperature"]
  }
}
```

### 2.2 Harvest Optimization & Quality Prediction

**AI Solution**: Harvest Intelligence System

```javascript
class HarvestAI {
  // Predict optimal harvest window
  async optimizeHarvestTiming(groupId) {
    // Analyze: leaf size, color, growth rate, market demand
    // Suggest: "Harvest between Wed-Fri for peak quality and price"
  }
  
  // Predict yield and quality
  async predictYield(groupId) {
    // Use historical data, current growth patterns
    // Estimate: "Expected yield: 42 lbs ± 3 lbs, Grade A quality"
  }
  
  // Quality grading assistance
  async gradeHarvest(imageData) {
    // Computer vision: analyze leaf color, size, defects
    // Auto-grade: A, B, C based on buyer standards
    // Reduce manual grading time by 80%
  }
}
```

**Implementation Points**:
- Add AI harvest suggestions to tray-inventory.html (Activity Hub)
- Camera integration for quality grading (iPad camera)
- API: `POST /api/ai/grade-harvest` with image upload
- Display in Activity Hub: "🎯 Optimal harvest: Tomorrow 8am-11am"

### 2.3 Traceability & Sales Workflow AI

**Problem**: Manual data entry for traceability, pricing decisions, buyer matching
- USDA GAP, food safety compliance requires detailed records
- Pricing is guesswork without market data
- Finding right buyers for specific products is time-consuming

**AI Solution**: Intelligent Sales & Compliance Assistant

```javascript
class SalesAI {
  // Auto-generate compliance records
  async generateTraceabilityReport(groupId) {
    // Collect: seed date, inputs, harvest date, handler info
    // Auto-fill USDA forms, GS1 labels
    // "Compliance report generated in 30 seconds"
  }
  
  // Dynamic pricing recommendations
  async suggestPrice(crop, quality, season, demand) {
    // Analyze: local market data, competitor pricing, buyer history
    // Suggest: "$4.50/lb for Grade A Buttercrunch (↑15% vs last week)"
  }
  
  // Buyer matching
  async matchBuyers(inventory) {
    // Analyze buyer preferences, order history, location
    // Suggest: "Blue Smoke Restaurant wants 10 lbs lettuce, 2 miles away"
    // Auto-send availability notification
  }
  
  // Demand forecasting
  async forecastDemand(crop, weeks) {
    // Analyze historical sales, seasonal trends, local events
    // Predict: "Basil demand will spike in 3 weeks (farmer's market season)"
  }
}
```

**Implementation Points**:
- Add "AI Pricing" button to inventory cards
- Auto-generate traceability labels with QR codes
- Buyer notification system: "Send availability to 5 matched buyers"
- API endpoints:
  - `POST /api/ai/price-suggest` → dynamic pricing
  - `POST /api/ai/match-buyers` → buyer recommendations
  - `GET /api/ai/demand-forecast/{crop}` → weekly forecast
- **Integration**: Connect to wholesale catalog API (already exists at `/api/wholesale/catalog`)

---

## 3. Environmental Target Management AI

### 3.1 Adaptive Climate Control

**Problem**: Static environmental setpoints don't adapt to:
- Outdoor weather conditions (heat waves, cold snaps)
- Plant growth stages (seedling vs mature)
- Device limitations (HVAC capacity, sensor accuracy)
- Energy costs (peak demand hours)

**AI Solution**: Dynamic Environmental Optimizer

```javascript
class EnvironmentAI {
  // Adjust targets based on outdoor conditions
  async adaptToWeather(outdoorData, indoorTargets) {
    // Outdoor heat wave → increase cooling, adjust humidity
    // Cold snap → reduce ventilation, increase heating
    // High outdoor humidity → run dehumidifier proactively
    // Return adjusted targets: temp, humidity, VPD, CO2
  }
  
  // Optimize for plant growth stage
  async optimizeForGrowthStage(groupId, currentStage) {
    // Seedling: higher humidity, lower light intensity
    // Vegetative: balanced conditions
    // Pre-harvest: lower humidity, increase light for color
  }
  
  // Energy-efficient control
  async minimizeEnergyCost(targets, utilityRates) {
    // Pre-cool during off-peak hours
    // Reduce lighting during peak demand
    // Maintain plant health while cutting energy 15-30%
  }
  
  // Predictive alerts
  async predictEnvironmentalIssues(sensorData, forecast) {
    // "VPD will exceed target in 2 hours, increase humidity now"
    // "Temperature drop predicted tonight, check heater"
  }
}
```

**Implementation Points**:
- **Sensor Integration**: Use existing env.json data (temp, humidity, VPD, pressure, CO2, air quality)
- **Weather API**: Integrate OpenWeather or NOAA for outdoor conditions
- **Control Logic**: Modify `lib/environmental-control.js` to use AI recommendations
- **API Endpoints**:
  - `POST /api/ai/environment/optimize` → get adjusted targets
  - `GET /api/ai/environment/forecast` → predict issues 24-48 hours ahead
- **Dashboard Display**: Show AI recommendations in LE-dashboard.html:
  - "🤖 AI Suggestion: Lower temp 2°F due to outdoor heat"
  - "⚡ Energy Savings: $12 today by following AI schedule"

### 3.2 Multi-Zone Optimization

**AI Solution**: Cross-Zone Environmental Intelligence

```javascript
class MultiZoneAI {
  // Balance resources across zones
  async optimizeAcrossZones(zones, sharedResources) {
    // HVAC capacity is shared → prioritize seedlings over mature plants
    // CO2 injection → schedule when most beneficial
    // Lighting → stagger schedules to reduce peak demand
  }
  
  // Detect zone interactions
  async analyzeZoneEffects(zoneId, neighborZones) {
    // Zone 1 cooling affects Zone 2 temperature
    // Dehumidifier in Zone A helps Zone B
    // Suggest: "Close door between zones to improve efficiency"
  }
}
```

**Implementation Points**:
- Analyze relationships between rooms/zones
- Coordinate environmental control across facility
- Add "Zone Efficiency Score" to farm summary

### 3.3 Sensor Anomaly Detection & Auto-Correction

**AI Solution**: Intelligent Sensor Validation

```javascript
class SensorAnomalyAI {
  // Detect sensor failures before they impact crops
  async detectAnomalies(sensorData, historicalData) {
    // Sudden spike: sensor fault vs real event?
    // Gradual drift: calibration issue
    // Stuck readings: sensor failure
    // Cross-validate with other sensors
  }
  
  // Auto-correct bad data
  async correctReadings(sensorId, badData) {
    // Use redundant sensors to estimate true value
    // Interpolate from historical patterns
    // Flag for manual review
  }
  
  // Proactive maintenance
  async predictSensorMaintenance(sensor) {
    // Analyze accuracy degradation over time
    // Predict: "Sensor will fail in 14 days, order replacement"
  }
}
```

**Implementation Points**:
- Enhance `/api/health/sensors` endpoint with anomaly detection
- Display sensor confidence scores in health dashboard
- Auto-flag suspicious readings in Activity Hub
- **Alert System**: Send notifications when sensors need attention

---

## 4. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-2)
- ✅ Health check system (COMPLETED)
- Set up AI inference infrastructure (TensorFlow.js or cloud API)
- Create AI service abstraction layer
- Add AI logging and monitoring

### Phase 2: Device & IoT AI (Weeks 3-4)
- Implement device discovery AI
- Add network optimization
- Sensor placement assistant
- BLE pairing improvements

### Phase 3: Environmental AI (Weeks 5-6)
- Integrate weather API
- Implement dynamic target adjustment
- Add energy optimization
- Predictive environmental alerts

### Phase 4: Grow Workflow AI (Weeks 7-8)
- Seeding scheduler
- Harvest optimizer
- Quality grading (computer vision)
- Traceability automation

### Phase 5: Sales & Traceability AI (Weeks 9-10)
- Pricing recommendations
- Buyer matching
- Demand forecasting
- Auto-generate compliance reports

---

## 5. Technical Architecture

### 5.1 AI Service Layer

```javascript
// /lib/ai-service.js
class AIService {
  constructor() {
    this.mode = process.env.AI_MODE || 'cloud'; // 'cloud' | 'edge' | 'hybrid'
    this.provider = process.env.AI_PROVIDER || 'openai'; // 'openai' | 'anthropic' | 'local'
  }
  
  // Generic AI inference
  async infer(model, input, options = {}) {
    if (this.mode === 'edge') {
      return this.inferLocal(model, input);
    } else {
      return this.inferCloud(model, input, options);
    }
  }
  
  // Cloud API (OpenAI, Anthropic, etc.)
  async inferCloud(model, input, options) {
    // Rate limiting, caching, error handling
  }
  
  // Local inference (TensorFlow.js, ONNX)
  async inferLocal(model, input) {
    // Run on edge device (reTerminal has ARM CPU, 4GB RAM)
  }
  
  // Hybrid: local for fast, cloud for complex
  async inferHybrid(model, input) {
    if (model.complexity < THRESHOLD) {
      return this.inferLocal(model, input);
    } else {
      return this.inferCloud(model, input);
    }
  }
}
```

### 5.2 Data Collection for AI Training

**Current Data Sources**:
- `groups.json`: 100+ crop recipes, growth schedules
- `env.json`: Temperature, humidity, VPD, pressure, CO2, air quality (continuous)
- `farm.json`, `rooms.json`: Facility layout, equipment
- `tray-events.json`: Seeding, transplanting, harvesting events
- Activity Hub logs: User actions, timing, efficiency

**Additional Data Needed**:
- Harvest yields (actual vs predicted)
- Quality grades (A/B/C)
- Sales data (price, buyer, quantity)
- Weather data (outdoor temp, humidity, solar radiation)
- Energy consumption (lights, HVAC, total)
- Photos (for computer vision training)

**Privacy & Security**:
- All AI training data anonymized
- Farm-specific models stay on edge device
- Cloud models use aggregated data only
- User control: opt-in/opt-out per AI feature

### 5.3 API Design

```javascript
// AI endpoints structure
app.post('/api/ai/device/discover', requireAuth, aiController.discoverDevices);
app.post('/api/ai/environment/optimize', requireAuth, aiController.optimizeEnvironment);
app.post('/api/ai/planting/suggest', requireAuth, aiController.suggestSeeding);
app.post('/api/ai/harvest/predict', requireAuth, aiController.predictHarvest);
app.post('/api/ai/harvest/grade', upload.single('image'), aiController.gradeHarvest);
app.post('/api/ai/sales/price', requireAuth, aiController.suggestPrice);
app.post('/api/ai/sales/match-buyers', requireAuth, aiController.matchBuyers);
app.get('/api/ai/forecast/:type/:days', requireAuth, aiController.forecast);

// AI admin/config
app.get('/api/ai/config', requireAdmin, aiController.getConfig);
app.post('/api/ai/config', requireAdmin, aiController.updateConfig);
app.get('/api/ai/models', requireAdmin, aiController.listModels);
app.post('/api/ai/train/:model', requireAdmin, aiController.trainModel);
```

### 5.4 UI Integration Points

**Existing Pages to Enhance**:
1. **setup-wizard.html**: Add AI device discovery in Step 2
2. **groups-v2.js**: AI seeding suggestions in Step 3
3. **tray-inventory.html** (Activity Hub): Harvest predictions, quality grading
4. **LE-dashboard.html**: Environmental AI recommendations, alerts
5. **health-dashboard.html**: Sensor anomaly detection, network optimization
6. **LE-farm-admin.html**: AI configuration, model training

**New AI Components**:
- `/public/ai-assistant.js`: Chat interface for natural language queries
- `/public/ai-recommendations.js`: Reusable recommendation cards
- `/public/ai-insights.js`: Data visualization for AI predictions

---

## 6. Success Metrics

### Device & IoT
- **Setup Time**: Reduce device setup from 30min → 5min (83% reduction)
- **Device Discovery**: 95%+ accuracy identifying device types
- **Network Uptime**: 99.5%+ (predict and prevent outages)

### Grow Workflow
- **Harvest Accuracy**: Predict harvest dates ±2 days (vs current ±7 days)
- **Yield Prediction**: Within ±10% of actual yield
- **Quality Grading**: 90%+ agreement with human graders
- **Traceability Time**: Generate compliance reports in <1 min (vs 30 min manual)

### Environmental Management
- **Energy Savings**: 15-30% reduction in HVAC/lighting costs
- **Crop Loss**: Reduce losses from environmental issues by 50%
- **Sensor Uptime**: 99%+ (detect failures before crop impact)

### Sales & Business
- **Pricing Accuracy**: Within 5% of optimal market price
- **Buyer Matching**: 3x increase in successful sales
- **Time Savings**: 10 hours/week saved on manual tasks

---

## 7. Risk Mitigation

### Technical Risks
- **AI Model Accuracy**: Start with high-confidence use cases, expand gradually
- **Edge Device Performance**: Hybrid approach (cloud for complex, edge for fast)
- **Internet Dependency**: Cache AI models locally, fall back to rule-based logic
- **Data Privacy**: Opt-in system, anonymization, edge-first processing

### Operational Risks
- **User Trust**: Show confidence scores, allow overrides, explain decisions
- **False Positives**: Alert fatigue → tune thresholds based on farm feedback
- **Training Data**: Start with Big Green Farm data, expand to network farms
- **Cost**: Use open-source models (LLaMA, Mistral) to reduce API costs

### Compliance Risks
- **Food Safety**: AI-generated traceability must meet USDA GAP standards
- **Liability**: Human-in-the-loop for critical decisions (harvest, sales)
- **Auditability**: Log all AI decisions for compliance review

---

## 8. Next Steps

### Immediate Actions (This Week)
1. Set up AI service infrastructure (AIService class)
2. Integrate OpenWeather API for outdoor conditions
3. Add basic device discovery (network scan)
4. Create AI recommendations UI component

### Short-Term (Month 1)
1. Implement environmental optimization AI
2. Add seeding schedule suggestions
3. Sensor anomaly detection
4. Network optimization

### Medium-Term (Months 2-3)
1. Computer vision for quality grading
2. Pricing and buyer matching
3. Demand forecasting
4. Traceability automation

### Long-Term (Months 4-6)
1. Custom AI models trained on farm network data
2. Voice interface for Activity Hub
3. Predictive maintenance for all equipment
4. Full autonomous environmental control

---

## 9. Cost Analysis

### Development Costs
- AI infrastructure setup: 40 hours
- Feature implementation: 200 hours (10 hours per feature × 20 features)
- Testing and refinement: 60 hours
- **Total**: 300 hours @ $150/hr = **$45,000**

### Ongoing Costs
- Cloud API (OpenAI/Anthropic): $100-500/month per farm (depends on usage)
- Weather API: $50/month
- Computer vision API: $200/month
- **Total**: $350-750/month per farm

### Cost Savings (Per Farm)
- Labor savings: 10 hours/week × $25/hr × 52 weeks = **$13,000/year**
- Energy savings: 20% × $500/month × 12 = **$1,200/year**
- Reduced crop loss: 5% × $50,000 revenue = **$2,500/year**
- Better pricing: 3% margin improvement × $50,000 = **$1,500/year**
- **Total Savings**: **$18,200/year per farm**

**ROI**: Payback in 2.5 months per farm, 146% annual return

---

## 10. Conclusion

AI integration across device setup, grow workflows, and environmental management can:
- **Simplify operations** by automating tedious tasks
- **Reduce risk** through predictive alerts and anomaly detection
- **Increase revenue** via better pricing, buyer matching, and quality
- **Cut costs** through energy optimization and reduced crop loss

The system is designed to be:
- **Farm-specific**: Each farm gets custom AI models tuned to their equipment and crops
- **Privacy-first**: Edge processing when possible, opt-in for cloud features
- **Transparent**: Show confidence scores, allow overrides, explain decisions
- **Incremental**: Start with high-value, low-risk features, expand gradually

**Recommendation**: Begin with Phase 1-2 (health checks + device AI) to establish foundation, then expand based on Big Green Farm feedback.
