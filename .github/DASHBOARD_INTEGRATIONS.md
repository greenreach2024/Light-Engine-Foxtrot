# Dashboard Integration Registry

**Version**: 1.0.0  
**Date**: February 1, 2026  
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

### P4: Succession Planting Automation 🔜 Planned

**Status**: Not implemented yet

**Proposed Dashboards**:
- 🔜 **Farm Summary** (suggestion cards near harvest countdown)
- 🔜 **Groups V2** (auto-schedule next planting button)
- 🔜 **Activity Hub** (alerts for ready-to-seed batches)

**Proposed API**:
- `GET /api/succession/suggestions/:groupId` (get planting suggestion)
- `POST /api/succession/schedule` (schedule next batch)

**Implementation Priority**: Next (Architecture Agent recommended)

---

### P5: Dynamic Pricing 🔜 Planned

**Status**: Not implemented yet

**Proposed Dashboards**:
- 🔜 **Wholesale Catalog** (dynamic pricing display)
- 🔜 **Central Admin** (pricing analytics dashboard)
- 🔜 **Farm Summary** (price optimization suggestions)

**Proposed API**:
- `GET /api/pricing/dynamic/:skuId` (get dynamic price)
- `POST /api/pricing/optimize` (calculate optimal price)

**Implementation Priority**: After P4

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

### P7: Voice Interface 🔜 Planned

**Status**: Not implemented yet

**Proposed Dashboards**:
- 🔜 **Farm Summary** (voice commands for navigation)
- 🔜 **Activity Hub** (hands-free task logging)
- 🔜 **Harvest Dashboard** (voice-driven harvest entry)

**Proposed API**:
- Web Speech API (browser-native, no backend)

**Implementation Priority**: After core features (P4, P5, P6)

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
