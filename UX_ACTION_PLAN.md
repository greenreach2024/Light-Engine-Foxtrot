# UX Action Plan — Surface AI Intelligence to Users

**Date:** February 23, 2026  
**Context:** AI backend is 96% complete (48/52 tasks). ~60% of backend capability has zero frontend consumer.  
**Goal:** Wire existing API endpoints into the grower, admin, and buyer UX across 4 sprints.  
**Estimated Total:** 8–11 working days

---

## Current State

| Layer | Status |
|-------|--------|
| Backend APIs | 16 AI endpoints confirmed in server-foxtrot.js, all routable |
| Central APIs | Network intelligence, experiments, supply/demand, benchmarks — all operational |
| 30-min AI Push | Delivers GPT-4 recs + crop benchmarks + demand signals + recipe modifiers + risk alerts |
| Frontend | 5 AI feature cards (static), voice assistant (limited), AI crop suggestion (working), harvest predictions (working) |
| **Gap** | **10 recipe modifier endpoints, loss prediction, learning correlations, harvest readiness, experiment viewer — all have zero visual UI** |

---

## Sprint A — Grower Dashboard Intelligence

**Goal:** Give the grower immediate visibility into AI activity on the main screens they already use.  
**Files:** `public/LE-dashboard.html`, `public/views/tray-inventory.html`  
**Estimated:** 2–3 days

### A.1 — Harvest Readiness Cards

| Detail | Value |
|--------|-------|
| **What** | Show "Group X ready to harvest — 87% confidence" as a card on the dashboard and Activity Hub |
| **API** | `GET /api/harvest/readiness` (returns array of groups with readiness scores) |
| **Where (dashboard)** | New `<section id="harvestReadinessPanel">` after `environmentalAiCard` (~L405 in `LE-dashboard.html`) |
| **Where (Activity Hub)** | Inside `#harvest-section` (~L1311 in `tray-inventory.html`) — prepend readiness cards above the harvest list |
| **Design** | Card per group: crop icon, group name, readiness % bar, "Harvest Now" link. Green ≥85%, yellow 60–84%, hidden <60% |
| **Fetch** | On page load + refresh every 5 min |
| **Effort** | 4h |

### A.2 — Loss Prediction Alerts

| Detail | Value |
|--------|-------|
| **What** | Show "Group Y: 40% loss risk in 48h — high temp variance" as an alert card |
| **API** | `GET /api/losses/predict` (returns per-group loss probability + contributing factors) |
| **Where (dashboard)** | New `<section id="lossAlertPanel">` after harvest readiness panel in `LE-dashboard.html` |
| **Where (Activity Hub)** | Inside `#priorities-section` (~L1214 in `tray-inventory.html`) — add "Risk Alert" priority card when loss >25% |
| **Design** | Red/orange alert card: group name, risk %, top contributing factor, "View Details" expand. Sortable by risk level |
| **Fetch** | On page load + refresh every 15 min (aligns with anomaly detection cycle) |
| **Effort** | 4h |

### A.3 — AI Status Badge on Activity Hub

| Detail | Value |
|--------|-------|
| **What** | Restore AI status badge in Activity Hub header showing active recommendation count |
| **API** | `GET /api/ai/insights/count` (already fetched by farm-admin.js) |
| **Where** | Inside `<div class="status-indicators">` (~L1173 in `tray-inventory.html`), after the EDGE/CLOUD badge |
| **Design** | `.status-badge` with brain icon: "AI: 3 insights" (green when active, gray when no data). Tap to expand list of recommendations |
| **Fetch** | On page load + refresh every 30 min (aligns with AI push cycle) |
| **Effort** | 2h |

### A.4 — Dashboard AI Cards → Live Data

| Detail | Value |
|--------|-------|
| **What** | Wire the 5 AI feature cards (SpectraSync, EVIE, IA Training, AI Assist, EII) to show real metrics instead of static ON/OFF |
| **Where** | Inside `<div class="ai-features-horizontal">` (~L317 in `LE-dashboard.html`) |
| **Cards to wire** | |

| Card ID | API | Display |
|---------|-----|---------|
| `spectraSyncFeature` | `GET /api/schedule-status` | "Active on X groups, Y fixtures compensated for aging" |
| `evieFeature` | `GET /api/health/environment-summary` | "3 zones nominal, 1 alert" or zone health scores |
| `iaTrainingFeature` | `GET /api/harvest/experiment-stats` | "X experiment records, Y crops tracked, last trained: date" |
| `iaAssistFeature` | `GET /api/ai/insights/count` | "X active recommendations, last push: time" |
| `eiiFeature` | `GET /api/sustainability/energy/usage` | "kWh today: X, efficiency: Y kWh/kg" |

| Detail | Value |
|--------|-------|
| **Design** | Replace `.ai-feature-description` paragraph with live mini-stats. Show `.ai-feature-status` as "Last updated: 2m ago" instead of "ON" |
| **Fetch** | Single batch fetch on page load; refresh every 5 min |
| **Effort** | 4h |

### A.5 — Auto-Print on Harvest

| Detail | Value |
|--------|-------|
| **What** | After harvest scan succeeds, auto-trigger `POST /api/printer/print-harvest` if server returns `auto_print: true` |
| **Where** | In `showHarvestSuccess()` (~L4930 in `tray-inventory.html`) or `triggerAutoHarvestLabelPrint()` (~L5130) |
| **Logic** | After `performHarvest()` succeeds → check `response.data.auto_print === true` → call `printHarvestLabel()` automatically → show "Label printed" toast. If printer not configured, show "Auto-print skipped — no printer configured" |
| **Effort** | 2h |

**Sprint A Total: ~16h (2 days)**

---

## Sprint B — Recipe Modifier UX

**Goal:** Let the grower see, accept, dismiss, and configure AI recipe suggestions. This is the single biggest intelligence gap — 10 backend endpoints with zero frontend.  
**Files:** `public/farm-admin.html`, `public/views/tray-inventory.html`  
**Estimated:** 2–3 days

### B.1 — Recipe Modifier Panel (Farm Admin)

| Detail | Value |
|--------|-------|
| **What** | New "AI Recipe Intelligence" section in farm-admin showing pending modifiers per crop |
| **API** | `GET /api/recipe-modifiers` (list all computed modifiers with status, confidence, sample size) |
| **Where** | New nav item after "Planning" in sidebar (~L978 in `farm-admin.html`). New `<div id="section-recipe-intelligence">` |
| **Design** | Per-crop card showing: |

```
┌─────────────────────────────────────────────────────┐
│  🌿 Genovese Basil          Confidence: 78%  ████░  │
│                                                      │
│  Network Suggests          Your Farm Data            │
│  Blue: +2%                 Blue: +3%                 │
│  Red: +4%                  Red: +2%                  │
│  Temp: -0.5°C              Temp: -0.3°C              │
│  PPFD: +15                 PPFD: +12                 │
│                                                      │
│  Sample: 312 harvests (network) / 14 harvests (farm) │
│                                                      │
│  [ Accept Network ]  [ Accept Farm ]  [ Dismiss ]    │
└─────────────────────────────────────────────────────┘
```

| Detail | Value |
|--------|-------|
| **Accept** | `POST /api/recipe-modifiers/network/:crop/accept` |
| **Dismiss** | `POST /api/recipe-modifiers/network/:crop/dismiss` |
| **Compute** | Button: `POST /api/recipe-modifiers/compute` → refresh panel |
| **Effort** | 6h |

### B.2 — Champion vs. Challenger View

| Detail | Value |
|--------|-------|
| **What** | Side-by-side comparison of current recipe vs. modified recipe with performance data |
| **API** | `GET /api/recipe-modifiers/champion-challenger/:crop` |
| **Where** | Expandable panel below each crop modifier card in B.1 |
| **Design** | Two-column comparison: "Champion (current)" vs. "Challenger (modified)" showing avg yield, loss rate, grow days, energy per kg. Highlight which is winning. Show "N more cycles needed for statistical significance" |
| **Effort** | 4h |

### B.3 — Autonomous Mode Configuration

| Detail | Value |
|--------|-------|
| **What** | Toggle for autonomous recipe adjustment with guardrail settings |
| **APIs** | `GET /api/recipe-modifiers/autonomous/status`, `POST /api/recipe-modifiers/autonomous/apply` |
| **Where** | Settings card inside the recipe intelligence section (B.1), or in Settings → Farm Operations Defaults (~L2656 in `farm-admin.html`) |
| **Design** | Toggle: "Enable autonomous recipe adjustment". When enabled, show: max spectrum change (±X%), max temp change (±X°C), revert-on-regression toggle, minimum harvests before applying. Show current auto-revert count and any reverted modifiers with `POST /api/recipe-modifiers/autonomous/clear-revert/:crop` |
| **Effort** | 3h |

### B.4 — Recipe Modifier Notification on Activity Hub

| Detail | Value |
|--------|-------|
| **What** | When new recipe modifiers are available, show a notification card on Activity Hub |
| **API** | `GET /api/recipe-modifiers` (filter status === 'pending') |
| **Where** | Inside `#priorities-section` (~L1214 in `tray-inventory.html`) — add "Recipe Update Available" priority card |
| **Design** | Blue info card: "AI suggests recipe changes for Genovese Basil (78% confidence). [Review in Farm Admin]" linking to B.1 panel |
| **Fetch** | On page load |
| **Effort** | 2h |

### B.5 — Recipe Version History

| Detail | Value |
|--------|-------|
| **What** | Timeline view of recipe changes: when modifiers were applied, reverted, or dismissed |
| **API** | `GET /api/recipe-modifiers/versions` |
| **Where** | Expandable section at the bottom of recipe intelligence panel (B.1) |
| **Design** | Timeline: date, action (Applied / Reverted / Dismissed), modifier values, outcome delta if available |
| **Effort** | 3h |

**Sprint B Total: ~18h (2–3 days)**

---

## Sprint C — Learning & Experiment Visibility

**Goal:** Show the grower the scientific results the system is accumulating — correlations, experiment records, and network benchmarks.  
**Files:** `public/LE-dashboard.html`, `public/farm-admin.html`, `public/views/tray-inventory.html`  
**Estimated:** 2 days

### C.1 — Learning Correlations Widget

| Detail | Value |
|--------|-------|
| **What** | Display discovered correlations: "Your basil: +12% yield with 5% more blue. Confidence: 78%" |
| **API** | `GET /api/ai/learning-correlations` |
| **Where** | New insight card below the AI feature cards in `LE-dashboard.html` (after `environmentalAiCard` ~L405) |
| **Design** | Compact insight cards per crop showing discovered correlation, direction (↑↓), magnitude, confidence bar, and sample size. Sort by confidence descending |
| **Effort** | 4h |

### C.2 — Experiment History Table

| Detail | Value |
|--------|-------|
| **What** | Searchable/filterable table of experiment records with crop, recipe, outcomes, and benchmarks |
| **APIs** | `GET /api/harvest/experiment-records`, `GET /api/harvest/experiment-stats` |
| **Where** | New tab or section in "AI Recipe Intelligence" panel from B.1 in `farm-admin.html`, or a standalone section in Planning |
| **Design** | Stats summary (total records, crops tracked, avg yield by crop) at top. Table below with columns: Date, Crop, Recipe, Weight/Plant, Quality Score, Loss Rate, Grow Days, vs. Network Avg (% difference). Filter by crop, date range. Export CSV button |
| **Effort** | 4h |

### C.3 — Network Comparison Badges on Group Cards

| Detail | Value |
|--------|-------|
| **What** | Show "Your basil: 2.34 oz/plant (35th percentile)" badge on group cards in Activity Hub |
| **API** | Network benchmarks already received via AI push and stored locally. Read from local store: `GET /api/ai/network-intelligence` |
| **Where** | Inside group/tray cards in `tray-inventory.html` — append badge after crop name |
| **Design** | Small colored badge: 🟢 Above avg (≥60th), 🟡 On par (40th–59th), 🔴 Below avg (<40th). Tooltip shows "Network avg: 2.51 oz, Your avg: 2.34 oz" |
| **Effort** | 3h |

### C.4 — Growth Analysis Chart

| Detail | Value |
|--------|-------|
| **What** | Growth curve visualization: expected vs. actual grow trajectory per crop |
| **API** | `GET /api/harvest/growth-analysis/:crop` |
| **Where** | Modal or expandable panel accessible from experiment history (C.2) or from crop cards |
| **Design** | Line chart: X = grow day, Y = expected weight (from ML model) vs. actual weights (from experiment records). Shade confidence interval. Show "optimal harvest window" as highlighted zone |
| **Effort** | 4h |

**Sprint C Total: ~15h (2 days)**

---

## Sprint D — Central Admin & Wholesale

**Goal:** Complete the network coordination UI for Central admins and surface AI-driven information for wholesale buyers.  
**Files:** `greenreach-central/public/GR-central-admin.html`, `greenreach-central/public/views/network-dashboard.html`, `greenreach-central/public/GR-wholesale.html`, `greenreach-central/public/js/wholesale.js`  
**Estimated:** 2–3 days

### D.1 — Experiment Orchestrator CRUD

| Detail | Value |
|--------|-------|
| **What** | Full experiment management: create, activate, assign farms, record observations, analyze results |
| **APIs** | `POST /api/experiments` (create), `POST /api/experiments/:id/activate`, `POST /api/experiments/:id/observation`, `GET /api/experiments/:id/analysis` |
| **Where** | Expand the "A/B Experiments" tab in `network-dashboard.html` (~L185). Add "Create Experiment" button + form modal. Add per-experiment detail expand with observation table + analysis results |
| **Design** | Create form: crop, hypothesis, variant params (spectrum offsets), farm assignment dropdown. Status badges (draft → active → completed). Results panel: control vs. variant yield comparison, statistical significance indicator |
| **Effort** | 6h |

### D.2 — Predictive Inventory for Buyers

| Detail | Value |
|--------|-------|
| **What** | Show predicted future availability with confidence in the wholesale catalog |
| **API** | `GET /api/harvest-schedule/projections` or `GET /api/harvest/predictions/all` |
| **Where** | Inside `.sku-meta` section of each catalog card in `wholesale.js` `renderCatalog()` (~L733) |
| **Design** | Below current "Available: X cases" line, add: "🔮 +12 cases expected Feb 28 (85% confidence)" in muted text. Only show when current stock is low or zero. Color confidence: green ≥80%, yellow 60–79%, gray <60% |
| **Effort** | 4h |

### D.3 — Dynamic Pricing Indicators

| Detail | Value |
|--------|-------|
| **What** | Show AI pricing recommendations alongside catalog entries |
| **API** | `GET /api/wholesale/pricing-recommendations` |
| **Where** | Inside `.sku-meta-row` price display in `wholesale.js` (~L774). Also in the insight cards area (~L1713 in `GR-wholesale.html`) |
| **Design** | Next to static price, show small indicator: "↑ Suggested: $X.XX" (green if recommendation is higher = potential revenue, orange if lower = competitive pressure). Tooltip explains: "Based on network supply (X cases), demand velocity (Y orders/week), and quality tier" |
| **Note** | Read-only for buyers. Sellers/admins see the recommendation with "Apply" option in pricing management |
| **Effort** | 4h |

### D.4 — Harvest Conflict Timeline (Central Admin)

| Detail | Value |
|--------|-------|
| **What** | Visual timeline showing overlapping farm harvests per crop — market flooding risk |
| **API** | `GET /api/network/harvest-conflicts` |
| **Where** | New sub-tab inside `network-view` (~L2908 in `GR-central-admin.html`) or expand the Risk Alerts tab in `network-dashboard.html` |
| **Design** | Horizontal timeline per crop: each farm as a colored bar across weeks. Overlapping bars highlighted red. Click conflict to see: affected farms, projected volume, recommendation ("suggest Farm B delay 1 week") |
| **Effort** | 4h |

### D.5 — Recipe Version Sharing UI (Central Admin)

| Detail | Value |
|--------|-------|
| **What** | View and push recipe versions across the network from Central admin |
| **APIs** | `GET /api/network/recipe-versions`, `POST /api/network/recipe-versions/push` |
| **Where** | New tab in `recipes-view` (~L3610 in `GR-central-admin.html`) or new section in `ai-monitoring-view` (~L4162) |
| **Design** | Table of recipe versions: crop, version, modifier values, source farm/network, performance delta, date. "Push to Network" button per recipe with confirmation modal. Show push history: which farms received, acceptance rate |
| **Effort** | 4h |

### D.6 — Planting Suggestions Display

| Detail | Value |
|--------|-------|
| **What** | Show Central's planting suggestions for each farm |
| **API** | `GET /api/network/planting-suggestions` |
| **Where** | Inside farm detail view (`#farm-detail-view` ~L1190 in `GR-central-admin.html`) — new "Planting Suggestions" sub-tab |
| **Design** | Card per suggestion: crop, recommended trays, reasoning (demand gap, succession need, capacity available). Admin can "Forward to Farm" which triggers notification on farm's Activity Hub priorities section |
| **Effort** | 3h |

**Sprint D Total: ~25h (3 days)**

---

## Sprint Summary

| Sprint | Focus | Files | Tasks | Effort | Priority |
|--------|-------|-------|:-----:|:------:|:--------:|
| **A** | Grower Dashboard Intelligence | LE-dashboard.html, tray-inventory.html | 5 | 16h (2d) | **Highest** |
| **B** | Recipe Modifier UX | farm-admin.html, tray-inventory.html | 5 | 18h (2–3d) | **High** |
| **C** | Learning & Experiment Visibility | LE-dashboard.html, farm-admin.html, tray-inventory.html | 4 | 15h (2d) | **Medium** |
| **D** | Central Admin & Wholesale | GR-central-admin.html, network-dashboard.html, GR-wholesale.html | 6 | 25h (3d) | **Medium** |
| | | **Total** | **20** | **74h (~9d)** | |

---

## Dependency Map

```
Sprint A (no dependencies — can start immediately)
  ├── A.1 Harvest Readiness Cards
  ├── A.2 Loss Prediction Alerts
  ├── A.3 AI Status Badge
  ├── A.4 Dashboard AI Cards Live Data
  └── A.5 Auto-Print on Harvest

Sprint B (no dependency on A — can run in parallel)
  ├── B.1 Recipe Modifier Panel ← foundation
  ├── B.2 Champion/Challenger View ← depends on B.1
  ├── B.3 Autonomous Mode Config ← depends on B.1
  ├── B.4 Recipe Notification on Activity Hub ← depends on B.1
  └── B.5 Recipe Version History ← depends on B.1

Sprint C (reading from same APIs — can parallel with B)
  ├── C.1 Learning Correlations Widget
  ├── C.2 Experiment History Table
  ├── C.3 Network Comparison Badges ← depends on AI push being received
  └── C.4 Growth Analysis Chart ← can depend on C.2 for navigation

Sprint D (independent — Central admin / wholesale)
  ├── D.1 Experiment Orchestrator CRUD
  ├── D.2 Predictive Inventory
  ├── D.3 Dynamic Pricing Indicators
  ├── D.4 Harvest Conflict Timeline
  ├── D.5 Recipe Version Sharing
  └── D.6 Planting Suggestions
```

**Sprints A and B can run in parallel. C and D can run in parallel. Minimum critical path: ~5 days.**

---

## Implementation Notes

### API Readiness — All Confirmed

Every endpoint referenced in this plan exists and is deployed to production. No backend work is needed.

| Endpoint | Verified |
|----------|:--------:|
| `GET /api/harvest/readiness` | ✅ L11645 |
| `GET /api/losses/predict` | ✅ L21876 |
| `GET /api/ai/insights/count` | ✅ (farm-admin.js already fetches) |
| `GET /api/recipe-modifiers` | ✅ L10648 |
| `GET /api/recipe-modifiers/champion-challenger/:crop` | ✅ L11156 |
| `GET /api/recipe-modifiers/autonomous/status` | ✅ L11176 |
| `POST /api/recipe-modifiers/network/:crop/accept` | ✅ L10696 |
| `POST /api/recipe-modifiers/network/:crop/dismiss` | ✅ L10736 |
| `GET /api/recipe-modifiers/versions` | ✅ L11830 |
| `GET /api/ai/learning-correlations` | ✅ L11455 |
| `GET /api/harvest/experiment-records` | ✅ L10548 |
| `GET /api/harvest/experiment-stats` | ✅ L10606 |
| `GET /api/harvest/growth-analysis/:crop` | ✅ L11689 |
| `GET /api/harvest-schedule/projections` | ✅ L11101 |
| `GET /api/wholesale/pricing-recommendations` | ✅ (Central) |
| `GET /api/network/harvest-conflicts` | ✅ (Central) |
| `GET /api/network/planting-suggestions` | ✅ (Central) |
| `GET /api/network/recipe-versions` | ✅ (Central) |
| `POST /api/experiments` | ✅ (Central) |

### Design Principles

1. **Progressive disclosure** — Show summary first (badge/card), expand for detail
2. **Consistent patterns** — Use existing `.card`, `.status-badge`, and `.priority-card` CSS classes
3. **Confidence visibility** — Always show confidence %, sample size, and data freshness
4. **Non-blocking** — AI widgets load async; page remains usable if API is slow/down
5. **Refresh alignment** — Match fetch intervals to backend update cycles (15 min for anomaly, 30 min for AI push)
6. **Mobile-first** — All new widgets must work on iPad (primary grower device)

### Risk & Considerations

| Risk | Mitigation |
|------|------------|
| API returns empty data on fresh farm (no experiment records yet) | Show "Collecting data — X more harvests needed" placeholder state |
| AI push hasn't arrived yet (no network intelligence) | Graceful fallback: hide network comparison badges, show "Connecting to network..." |
| Large number of recipe modifiers per crop | Paginate or collapse to show top 3, expand for all |
| Grower overwhelm — too many AI notifications | Priority scoring: only show loss predictions >25%, only show recipe modifiers with confidence >60% |
| iPad Safari compatibility | Test Web Speech API, CSS grid, fetch AbortController on Safari/WebKit |

---

## Success Criteria

After all 4 sprints:

| Metric | Target |
|--------|--------|
| Backend APIs with frontend consumer | 100% (currently ~40%) |
| Grower can see AI recommendations visually | ✅ (dashboard cards + Activity Hub badge) |
| Grower can accept/dismiss recipe modifiers | ✅ (farm-admin panel + Activity Hub notification) |
| Grower sees harvest readiness + loss risk | ✅ (dashboard cards + priority alerts) |
| Grower sees experiment history + correlations | ✅ (farm-admin table + dashboard widget) |
| Admin can manage network experiments | ✅ (CRUD in network-dashboard) |
| Buyer sees predicted availability + pricing | ✅ (catalog cards with confidence) |
| All new widgets work on iPad Safari | ✅ (tested) |

---

*Ready for review. No backend changes required — this is purely frontend wiring to existing APIs.*