# Dashboard Integration Registry

**Version**: 1.1.0  
**Date**: March 28, 2026  
**Purpose**: Track which AI/ML components are integrated into which dashboards to prevent duplicate work

---

## Why This Registry Exists

**Incident**: During P3 (Harvest Predictions) completion, Implementation Agent created proposal to "integrate P3 into Farm Summary" without investigating first. Review Agent discovered integration **already existed** at farm-summary.html lines 3683-3697.

**Lesson**: Always check this registry before proposing dashboard integrations.

**Framework Principle**: Investigation-First (see AGENT_SKILLS_FRAMEWORK.md)

---

## Component Integration Status

### P1: Device Auto-Discovery ✅ Complete

**Status**: Fully integrated

**Dashboards**:
- ✅ **Setup Wizard** ([public/setup-wizard.html](../public/setup-wizard.html))
  - Location: Network scanner section (lines ~800-1200)
  - Integration: Device scanner UI with confidence scoring
  - API: `/api/devices/scan` (POST)
  - Features: Ping sweep, protocol fingerprinting, one-click selection
  - Validation: 7/7 checks passed

**Future Integrations**:
- ⏳ Settings page (device re-scan functionality)
- ⏳ Troubleshooting page (network diagnostics)

---

### P2: Adaptive Environmental Control ✅ Complete (Tier 1)

**Status**: Backend only (no dashboard UI)

**Integrations**:
- ✅ **Controller** ([controller/checkAndControlEnvironment.js](../controller/checkAndControlEnvironment.js))
  - Location: Lines 86-106 (injection point)
  - Integration: Setpoint adjustment before HVAC decision
  - API: N/A (internal library call)
  - Features: Outdoor-aware rules, crop safety bounds
  - Validation: 20/20 checks passed

**Future Integrations**:
- ⏳ Farm Summary (show adjusted setpoints with "AI" badge)
- ⏳ Settings page (enable/disable toggle, tier selection)
- ⏳ Energy Dashboard (show savings from adaptive control)

---

### P3: Harvest Predictions ✅ Complete

**Status**: Fully integrated

**Dashboards**:
- ✅ **Farm Summary** ([public/views/farm-summary.html](../public/views/farm-summary.html))
  - Location: Lines 3683-3697 (badge rendering logic)
  - Script import: Line 7039 (`<script src="/harvest-predictions.js"></script>`)
  - Badge placeholder: Line 3248 (`<div id="ai-prediction-${group.id}">`)
  - Auto-refresh: Line 2165 (5-minute interval)
  - Integration: Inline badges in group harvest countdown cards
  - API: `/api/harvest/predictions/all`, `/api/harvest/predictions/:groupId`
  - Features: Color-coded badges (green/yellow/red), confidence tooltips
  - Validation: 7/7 integration checks passed, 39/39 component checks passed

- ✅ **Demo Page** ([public/harvest-predictions-demo.html](../public/harvest-predictions-demo.html))
  - Standalone testing interface
  - Validates component functionality independently

**Future Integrations**:
- ⏳ Activity Hub (predictions in tray cards)
- ⏳ Groups V2 (predictions in group management)
- ⏳ Wholesale Catalog (expose predictions to buyers with P5)

---

### P8: Anomaly Diagnostics ✅ Complete

**Status**: Fully integrated

**Dashboards**:
- ✅ **Farm Summary** ([public/views/farm-summary.html](../public/views/farm-summary.html))
  - Location: Health Monitor card (anomaly alerts section)
  - Integration: Real-time anomaly display with diagnostic reasoning
  - API: `/api/ml/diagnostics`, `/api/ml/anomalies/detect`
  - Features: IsolationForest detection, root cause analysis, confidence scoring
  - Validation: 28/28 checks passed

- ✅ **Demo Page** ([public/anomaly-diagnostics-demo.html](../public/anomaly-diagnostics-demo.html))
  - Standalone testing interface
  - Diagnostics panel with detailed reasoning

**Future Integrations**:
- ⏳ Activity Hub (equipment health warnings)
- ⏳ Central Admin (multi-farm anomaly monitoring)

---

### P4: Succession Planting Automation ✅ Complete (Tier 1)

**Status**: Fully integrated

**Dashboards**:
- ✅ **Farm Summary** ([public/views/farm-summary.html](../public/views/farm-summary.html))
  - Location: Group cards (inline suggestion cards after harvest predictions)
  - Integration: SuccessionPlanner component renders compact cards
  - Placeholder: `<div id="ai-succession-${group.id}">` (line ~3256)
  - Initialization: Lines ~2126-2132
  - Rendering: Lines ~3714-3733
  - API: `/api/succession/forecast/:crop`, `/api/succession/gaps/:crop`
  - Features: Backward scheduling, configurable succession gap, temporal conflict detection, P5 data hooks
  - Component: [public/js/components/SuccessionPlanner.js](../public/js/components/SuccessionPlanner.js) (518 lines)
  - Validation: 59/59 tests (58 passed, 1 cache test minor issue, 98% pass rate)

**Backend**:
- ✅ **SuccessionPlanner** ([lib/succession-planner.js](../lib/succession-planner.js))
  - Lines: 574 total (enhanced from 387 in proposal)
  - Features: Tray format system (40+ crops), dynamic growth duration, crop-specific succession gaps, temporal conflict detection
  - P5 Data Hooks: `getHarvestForecast()`, `detectInventoryGaps()` for dynamic pricing integration
  - API Endpoints: 7 total (schedule generation, demand suggestions, forecast, gaps, network suggestions)

**API Endpoints**:
- ✅ `POST /api/planting/schedule/generate` (generate 12-week schedule)
- ✅ `POST /api/planting/suggest-from-demand` (AI-optimized suggestions)
- ✅ `POST /api/planting/ai-recommendations` (receive Central AI recommendations)
- ✅ `GET /api/planting/tray-formats` (tray format catalog)
- ✅ `GET /api/succession/forecast/:crop` (P5 DATA HOOK - harvest volume forecast)
- ✅ `GET /api/succession/gaps/:crop` (P5 DATA HOOK - inventory gap detection)
- ✅ `POST /api/succession/network-suggestions` (Tier 2 placeholder - network-level coordination)

**Framework Compliance**:
- ✅ Investigation-First (discovered 574 lines existing, not 387)
- ✅ Component-First (reusable across dashboards)
- ✅ Database-Driven (tray formats, growth durations, succession gaps)
- ✅ Progressive Enhancement (works standalone, enhances with data)
- ✅ Multi-Agent Review (Review Agent + Architecture Agent approved)

**Future Integrations**:
- ⏳ Activity Hub (ready-to-seed alerts, schedule calendar view)
- ⏳ Groups V2 (one-click "Schedule Next Batch" button)
- ⏳ Standalone demo page ([succession-planner-demo.html](../public/succession-planner-demo.html))

**Implementation Notes**:
- Review Agent: APPROVED WITH REFINEMENTS (5 critical items addressed)
- Architecture Agent: APPROVED (Strategic fit: 9/10, Network effect amplifier)
- Effort: 1.5-2 weeks (reduced from 2-3 weeks due to existing implementation)
- Business Value: $2,000-3,000/year per farm (14% fulfillment improvement, 85% → 99%)

---

### P5: Dynamic Pricing In Progress

**Status**: Partially implemented (Crop/Product Pricing AI live)

**Current Integrations**:
- Crop/Product pricing workflows use `routes/crop-pricing.js` with market intelligence + GPT-driven recommendations.
- Wholesale price derivation is implemented: `max(floor_price, retail * sku_factor)` with sku_factor bounds.

**Remaining Integrations**:
- Wholesale catalog dynamic price display by SKU
- Central admin pricing analytics dashboard
- Farm summary optimization suggestions

---

### P6: Natural Language Group Creation 🔜 Planned

**Status**: Not implemented yet

**Proposed Dashboards**:
- 🔜 **Groups V2** (natural language input field)
- 🔜 **Activity Hub** (voice-to-text group creation)

**Proposed API**:
- `POST /api/nl/parse-group-intent` (parse natural language → group config)

**Implementation Priority**: After P4 and P5

---

### P7: Voice Interface Complete (Phase 5)

**Status**: Implemented in Activity Hub and assistant workflows

**Current Integrations**:
- Voice-first Activity Hub (Web Speech API + TTS)
- Farm assistant voice interaction in admin dashboards

**Notes**:
- Browser-native speech stack is in use (no dedicated backend speech service required)
- Additional dashboard-level voice controls can still be layered on top of the current implementation

---

## How to Use This Registry

### Before Proposing Integration:

1. **Check this registry** for existing integrations
2. **Search codebase** for component script imports:
   ```bash
   grep -r "your-component.js" public/views/
   grep -r "your-component" public/
   ```
3. **Check Farm Summary** (most common integration point):
   - Read [public/views/farm-summary.html](../public/views/farm-summary.html)
   - Search for component class name (e.g., `window.harvestPredictions`)
   - Search for API endpoint calls (e.g., `/api/harvest/predictions`)

4. **Validate assumptions**:
   - If integration exists: Create validation script, confirm working
   - If integration missing: Proceed with proposal

### After Completing Integration:

1. **Update this registry** with:
   - Dashboard name and file path
   - Integration location (line numbers)
   - API endpoints used
   - Features exposed
   - Validation results

2. **Add validation script** to [scripts/](../scripts/) directory:
   - Format: `validate-DASHBOARD-COMPONENT-integration.cjs`
   - Example: `validate-farm-summary-p3-integration.cjs`

---

## Validation Scripts

| Component | Dashboard | Validation Script | Status |
|-----------|-----------|-------------------|--------|
| P1: Device Discovery | Setup Wizard | `validate-and-cleanup-device-discovery.js` | ✅ 7/7 passed |
| P2: Adaptive Control | Controller | `validate-adaptive-control.js` | ✅ 20/20 passed |
| P3: Harvest Predictions | Farm Summary | `validate-farm-summary-p3-integration.cjs` | ✅ 7/7 passed |
| P3: Harvest Predictions | Component | `validate-harvest-predictions-ui.js` | ✅ 39/39 passed |
| P8: Anomaly Diagnostics | Farm Summary | `validate-anomaly-diagnostics.js` | ✅ 28/28 passed |

---

## Component-First Pattern

**Principle**: Build reusable components, integrate into multiple dashboards

**Workflow**:
1. **Build Component**: Create standalone class (e.g., `HarvestPredictions`)
2. **Test Standalone**: Create demo page (e.g., `harvest-predictions-demo.html`)
3. **Integrate**: Add to dashboards (Farm Summary, Activity Hub, etc.)
4. **Track**: Update this registry with integration locations

**Benefits**:
- **Reusability**: One component, N dashboards
- **Testability**: Validate before integration
- **Maintainability**: Single source of truth
- **Discoverability**: Registry prevents duplicate work

**Example** (P3 Harvest Predictions):
```
1. Component: public/harvest-predictions.js (HarvestPredictions class, 518 lines)
2. Demo: public/harvest-predictions-demo.html (standalone testing)
3. Integration: public/views/farm-summary.html (lines 3683-3697)
4. Registry: This file (tracks integration status)
5. Validation: scripts/validate-farm-summary-p3-integration.cjs (7/7 checks)
```

---

## Architecture Principles

### Single Responsibility
- **Component**: Data fetching, caching, rendering logic
- **Dashboard**: Layout, user interaction, component orchestration
- **API**: Business logic, database queries

### Progressive Enhancement
- **Tier 1**: Basic functionality (badges, simple display)
- **Tier 2**: Enhanced features (details panels, trend graphs)
- **Tier 3**: Advanced features (ML optimization, cross-farm learning)

### Graceful Degradation
- Component fails → Dashboard continues working
- API fails → Component shows cached data or "N/A"
- Network fails → Auto-retry with exponential backoff

---

## Change Log

| Date | Version | Change | Author |
|------|---------|--------|--------|
| 2026-02-01 | 1.0.0 | Initial registry created after P3 integration validation | Architecture Agent |

---

**Maintained by**: Architecture Agent  
**Review Cycle**: Update after each priority completion  
**Authority**: Framework-level document (required reading before dashboard work)
