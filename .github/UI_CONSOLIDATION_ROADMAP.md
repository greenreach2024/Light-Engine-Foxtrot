# UI Consolidation Roadmap -- Infotainment Architecture

**Created**: April 2, 2026
**Design principle**: Tesla-style single-surface command center. Dark,
calm, card-based. EVIE is the copilot. No features removed -- pages
collapse into fewer surfaces.

---

## Current State

| Metric | Count |
|--------|-------|
| Total distinct pages / views | 56 |
| LE-farm-admin.html sidebar nav items | 30+ |
| LE-dashboard.html sidebar panels | 13 |
| Standalone /views/*.html pages | 16 |
| Root-level special pages | 6 |

Pain points:
- Setup/Update page (LE-dashboard.html) has 5 sidebar groups, 13 panels,
  and nested wizards. Visually inconsistent with the new Orchestrator.
- LE-farm-admin.html has 6 sidebar sections with 30+ items. Feels like
  enterprise ERP, not a farm tool.
- 3 pages show overlapping environmental data (Farm Summary, Heat Map,
  Farm Vitality).
- Low-frequency pages (QR Generator, Downloads, ESG, Traceability,
  Quality Control) take up prime nav real estate.

---

## Target State

| Layer | Contents | Access |
|-------|----------|--------|
| Always visible | Farm vitals, alerts, EVIE orb | Dashboard home |
| One tap (3-4 tabs) | Operations, Growing, Business, Settings | Top bar tabs |
| Deep / voice | Calibration, bus mapping, checklists, ESG, QR labels | EVIE handles it |

Target: ~18 navigation targets (down from 56).

---

## Phase 1 -- Setup Page Cleanup (LE-dashboard.html)

**Scope**: LE-dashboard.html sidebar + panels only. No cross-page changes.

### Sidebar Reduction

Before (5 groups, 13+ buttons):
```
Farm Setup:        Farm Registration, Grow Rooms, Light Setup, Bus Mapping, Integrations
Devices:           IoT Devices, Equipment Overview, Room Mapper (link)
Business Setup:    Payment Processing, Online Store, Procurement Portal (link)
Resources:         Desktop App Downloads (link)
Standalone:        Groups V2
```

After (2 groups, 6 buttons):
```
Farm Setup:        Grow Rooms, Light Setup, IoT Devices, Integrations
Grow Management:   Groups V2
Business:          (removed -- Payment/Store already redirect out)
```

### Panel Changes

| Panel | Action | Rationale |
|-------|--------|-----------|
| Farm Registration | Keep, hide behind Orchestrator | Orchestrator phase 1 covers this |
| Grow Rooms | Keep | Core panel |
| Light Setup | Keep | Core panel |
| Farm Checklists | Hide from sidebar, keep panel | EVIE can open it. "Show my checklist" |
| Pair Devices | Fold into IoT Devices | Same workflow, split unnecessarily |
| IoT Devices | Keep | Core panel |
| Calibration | Hide from sidebar, keep panel | EVIE-only. <1% usage. |
| Profile | Hide from sidebar, keep panel | Accessible from Orchestrator phase 1 |
| Groups V2 | Keep | Core panel |
| Integrations | Keep | Core panel |
| Equipment Overview | Fold into Grow Rooms tab | Equipment is per-room |
| Bus Mapping | Hide from sidebar, keep panel | EVIE-only. Niche. |
| Payment/Store wizards | Remove sidebar entries | Already redirect to standalone pages |
| Desktop Downloads | Remove sidebar entry | Move to Settings in Phase 2 |
| Procurement Portal | Remove sidebar entry | Already in LE-farm-admin nav |
| Room Mapper | Remove sidebar entry | Already in LE-farm-admin nav |

### Visual Update

- All remaining cards adopt Orchestrator dark glass-morphism:
  background #0f172a-to-#1e293b, 1px border rgba(148,163,184,0.12),
  indigo/violet active accents, green for complete/healthy.
- Hero card (topCard) and AI feature cards get same treatment.
- Sidebar gets dark background to match.

### EVIE Deep-Access Pattern

Panels hidden from sidebar remain in the DOM. EVIE and the Orchestrator
can navigate to them via `setActivePanel('calibration')` etc. The JS
controller `setup-orchestrator.js` already calls `setActivePanel()` on
phase card clicks.

---

## Phase 2 -- Main Nav Consolidation (LE-farm-admin.html) [COMPLETED]

Commit: 5fe3b169. Backup tag: pre-tesla-ui-v2. Deployed 2026-04-03.

**Scope**: LE-farm-admin.html navigation architecture.

Replace 6-section sidebar with 4 horizontal top-bar tabs:

| Tab | Contains |
|-----|----------|
| Operations | Farm Summary, Activity Hub, Nutrient Mgmt, Heat Map |
| Growing | Planting Scheduler, Groups V2, Tray Setup, Crop Weight |
| Business | POS, Wholesale, Pricing, Crop Value, Supplies, Exports |
| Settings | Setup/Update, Users, Profile, Subscription, Help |

EVIE absorbs: Sustainability/ESG, Traceability, Quality Control, Help/Docs.

---

## Phase 3 -- View Merging [COMPLETED]

Commit: a9649718. Backup tag: pre-tesla-ui-v3. Deployed 2026-04-03.

| New View | Merges |
|----------|--------|
| environment.html | farm-summary + room-heatmap + farm-vitality (3 tabs) |
| planning.html | planting-scheduler + tray-setup |
| inventory.html | farm-inventory + crop-weight-analytics |
| supplies.html | inventory-mgmt (inline) + procurement-portal |

---

## Phase 4 -- Global Visual Unification [COMPLETED]

Apply Orchestrator dark design system (--so-* CSS variables) as the
global theme across all views. Every card, every panel gets the dark
glass-morphism treatment.

---

## Implementation Notes

- Each phase is a single commit + deploy cycle.
- No features are removed. Panels stay in DOM. EVIE navigates to them.
- `setActivePanel()` in app.foxtrot.js is the universal navigation API.
- `setup-orchestrator.js` already bridges the Orchestrator to sidebar panels.
- File sync: edit in greenreach-central/public/ first, then copy to root public/.
- Deploy both LE and Central after each phase.
