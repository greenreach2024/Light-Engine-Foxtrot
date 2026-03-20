# Server-Foxtrot Monolith Decomposition — Action Plan

**Date**: 2026-03-20  
**File**: `server-foxtrot.js`  
**Size**: 30,495 lines · 413 inline routes  
**Risk Level**: HIGH — single failure point, untestable, merge conflicts constant  

---

## 1. Current State Assessment

### The Monolith
`server-foxtrot.js` is the edge/farm server that runs on each physical farm device. It contains **all** farm-side logic — device control, environment monitoring, automation, AI, inventory, recipes, discovery, setup wizards, telemetry, and more — in a single file.

### What's Already Extracted (greenreach-central)
The cloud server (`greenreach-central/server.js`, ~4,750 lines) has **57 route files** already extracted into `routes/`. This is a healthy architecture. The problem is exclusively on the farm/edge side.

### Route Domain Breakdown (Top 15 by count)

| Routes | Domain               | Lines (approx)  | Complexity |
|--------|----------------------|------------------|------------|
| 28     | `/api/inventory`     | ~1,200           | Medium     |
| 27     | `/api/ml`            | ~2,500           | High       |
| 20     | `/api/automation`    | ~1,800           | High       |
| 17     | `/api/wholesale`     | ~800             | Medium     |
| 12     | `/setup`             | ~1,500           | High       |
| 12     | `/data`              | ~600             | Low        |
| 10     | `/api/farm`          | ~500             | Medium     |
| 10     | `/api/device-wizard` | ~800             | Medium     |
| 10     | `/api/admin`         | ~400             | Low        |
| 8      | `/api/recipe-mods`   | ~500             | Medium     |
| 8      | `/api/nutrients`     | ~1,200           | High       |
| 8      | `/api/harvest`       | ~600             | Medium     |
| 7      | `/plugs`             | ~300             | Low        |
| 7      | `/api/devices`       | ~400             | Low        |
| 7      | `/api/ai`            | ~800             | High       |

### Non-Route Bulk (Estimated)
| Section                     | Lines (approx) | Notes                                    |
|-----------------------------|----------------|------------------------------------------|
| Imports / config / startup  | ~400           | Can stay in server entry                  |
| Middleware (CORS, helmet…)  | ~700           | Can stay or move to `middleware/`         |
| ENV store helpers + cache   | ~2,000         | Shared state — extract to `services/`     |
| Automation rules engine     | ~2,500         | Heavy logic — extract to `services/`      |
| DB stores (NeDB + PG)      | ~1,500         | Extract to `models/` or `services/`       |
| Device protocols (Kasa, Shelly, SwitchBot, Grow3) | ~3,000 | Extract to `lib/device-drivers/` |
| AI / ML model logic         | ~2,000         | Extract to `services/ai/`                |
| Credential store            | ~500           | Extract to `services/` or `lib/`          |
| VPD automation engine       | ~800           | Extract to `services/`                    |
| Schedule executor           | ~1,200         | Extract to `services/`                    |
| Telemetry / cloud sync      | ~1,000         | Extract to `services/`                    |

---

## 2. Extraction Strategy

### Guiding Principles
1. **No behavior changes** — each extraction is a pure refactor. Route paths, middleware order, and response shapes must not change.
2. **One domain per PR** — small, reviewable, testable diffs.
3. **Test before and after** — write a smoke test hitting each route in the domain before extracting. Run it after. If green, merge.
4. **Shared state via injection** — many routes close over variables defined earlier in the file (e.g., `envStore`, `automationEngine`, `deviceDb`). Pass these via `req.app.locals` or a simple dependency container instead of closures.
5. **Extract services first, then routes** — services are utility functions with no Express dependency. They're easier to extract and test.

### Dependency Injection Pattern
```javascript
// server-foxtrot.js (after extraction)
import { createEnvStore } from './services/env-store.js';
import inventoryRoutes from './routes/inventory.js';

const envStore = createEnvStore(db);
app.locals.envStore = envStore;

app.use('/api/inventory', inventoryRoutes);
```

```javascript
// routes/inventory.js
const router = express.Router();
router.get('/', (req, res) => {
  const envStore = req.app.locals.envStore;
  // ...
});
export default router;
```

---

## 3. Phased Extraction Plan

### Phase 1: Low-Risk Leaf Domains (No shared state dependencies)
**Effort**: ~2 days · **Risk**: Low  
These domains are self-contained and don't close over shared state.

| Priority | Domain                | Lines | Target File                        |
|----------|-----------------------|-------|------------------------------------|
| 1.1      | `/setup` wizards      | ~1,500| `routes/edge-setup-wizards.js`     |
| 1.2      | `/discovery`          | ~600  | `routes/edge-discovery.js`         |
| 1.3      | `/api/credentials`    | ~500  | `routes/edge-credentials.js`       |
| 1.4      | `/integrations/ifttt` | ~300  | `routes/edge-ifttt.js`             |
| 1.5      | `/api/billing` (edge) | ~300  | `routes/edge-billing.js`           |
| 1.6      | `/brand`, `/ui`       | ~400  | `routes/edge-branding.js`          |

### Phase 2: Device Protocol Drivers
**Effort**: ~2 days · **Risk**: Medium (hardware interaction)  
Extract device-specific protocol code into driver modules.

| Priority | Domain                    | Lines | Target File                  |
|----------|---------------------------|-------|------------------------------|
| 2.1      | Kasa smart plug control   | ~400  | `lib/drivers/kasa.js`        |
| 2.2      | Shelly relay control      | ~300  | `lib/drivers/shelly.js`      |
| 2.3      | SwitchBot integration     | ~400  | `lib/drivers/switchbot.js`   |
| 2.4      | Grow3/Code3 controller    | ~600  | `lib/drivers/grow3.js`       |
| 2.5      | `/plugs` routes           | ~300  | `routes/edge-plugs.js`       |
| 2.6      | `/api/devices` routes     | ~400  | `routes/edge-devices.js`     |

### Phase 3: Service Extraction (Shared State)
**Effort**: ~3 days · **Risk**: Medium-High (shared mutable state)  
These are the core services that many routes depend on. Extract them into service modules with clean interfaces.

| Priority | Service                    | Lines | Target File                       |
|----------|----------------------------|-------|------------------------------------|
| 3.1      | ENV store + hot-path cache | ~2,000| `services/edge-env-store.js`       |
| 3.2      | Automation rules engine    | ~2,500| `services/edge-automation.js`      |
| 3.3      | VPD automation engine      | ~800  | `services/edge-vpd.js`            |
| 3.4      | Schedule executor          | ~1,200| `services/edge-scheduler.js`       |
| 3.5      | Device database (NeDB)     | ~500  | `services/edge-device-db.js`       |
| 3.6      | Credential store           | ~500  | `services/edge-credentials.js`     |

### Phase 4: Heavy Route Domains
**Effort**: ~3 days · **Risk**: Medium (depends on Phase 3 services)  
After services are extracted, these routes can be moved cleanly.

| Priority | Domain               | Lines | Target File                       |
|----------|----------------------|-------|------------------------------------|
| 4.1      | `/api/inventory`     | ~1,200| `routes/edge-inventory.js`         |
| 4.2      | `/api/ml` + `/api/ai`| ~3,300| `routes/edge-ml.js`                |
| 4.3      | `/api/automation`    | ~1,800| `routes/edge-automation.js`        |
| 4.4      | `/api/nutrients`     | ~1,200| `routes/edge-nutrients.js`         |
| 4.5      | `/api/harvest`       | ~600  | `routes/edge-harvest.js`           |
| 4.6      | `/api/wholesale`     | ~800  | `routes/edge-wholesale.js`         |
| 4.7      | `/api/recipe-mods`   | ~500  | `routes/edge-recipe-modifiers.js`  |

### Phase 5: Remaining Routes + Cleanup
**Effort**: ~2 days · **Risk**: Low  
Everything left — small endpoints, health checks, static file serving, admin pages.

| Priority | Domain                 | Lines | Target File                       |
|----------|------------------------|-------|------------------------------------|
| 5.1      | `/data` endpoints      | ~600  | `routes/edge-data.js`              |
| 5.2      | `/api/farm` management | ~500  | `routes/edge-farm.js`              |
| 5.3      | `/api/admin` (edge)    | ~400  | `routes/edge-admin.js`             |
| 5.4      | Environment telemetry  | ~1,000| `routes/edge-telemetry.js`         |
| 5.5      | Health/status/version  | ~100  | Inline (keep in server-foxtrot.js) |
| 5.6      | Static file serving    | ~50   | Inline (keep in server-foxtrot.js) |

---

## 4. Target End State

After all phases, `server-foxtrot.js` should be **~500-800 lines**:
- Imports
- Express app creation
- Middleware setup (helmet, CORS, body-parser, rate limiters)
- Service initialization (create instances, attach to `app.locals`)
- Route mounting (~30 `app.use()` calls)
- Error handlers
- Server startup (port binding, MQTT, startup tasks)

### File Structure
```
server-foxtrot.js            (~600 lines — entry point only)
├── routes/
│   ├── edge-setup-wizards.js
│   ├── edge-discovery.js
│   ├── edge-credentials.js
│   ├── edge-ifttt.js
│   ├── edge-billing.js
│   ├── edge-branding.js
│   ├── edge-plugs.js
│   ├── edge-devices.js
│   ├── edge-inventory.js
│   ├── edge-ml.js
│   ├── edge-automation.js
│   ├── edge-nutrients.js
│   ├── edge-harvest.js
│   ├── edge-wholesale.js
│   ├── edge-recipe-modifiers.js
│   ├── edge-data.js
│   ├── edge-farm.js
│   ├── edge-admin.js
│   └── edge-telemetry.js
├── services/
│   ├── edge-env-store.js
│   ├── edge-automation.js
│   ├── edge-vpd.js
│   ├── edge-scheduler.js
│   ├── edge-device-db.js
│   └── edge-credentials.js
└── lib/drivers/
    ├── kasa.js
    ├── shelly.js
    ├── switchbot.js
    └── grow3.js
```

---

## 5. Risk Mitigations

| Risk                                  | Mitigation                                                   |
|---------------------------------------|--------------------------------------------------------------|
| Breaking shared state during extract  | Phase 3 first extracts services; routes follow in Phase 4    |
| Hardware-dependent routes untestable  | Mock device drivers in tests; real testing on staging farm    |
| Merge conflicts during long refactor  | One domain per PR, merge immediately, rebase remaining work  |
| Middleware order changes              | Keep same `app.use()` order in server-foxtrot.js             |
| ENV store race conditions             | Make env store a class with proper locking, not loose vars   |
| Import cycle between services         | Dependency graph review before each phase; no circular deps  |

---

## 6. Success Metrics

- [ ] `server-foxtrot.js` < 1,000 lines
- [ ] Zero inline route handlers in entry file
- [ ] All 413 routes covered by at least one integration test
- [ ] No shared mutable state accessed via closure (all via `app.locals` or DI)
- [ ] Each extracted module < 500 lines
- [ ] CI build time unchanged (±10%)
- [ ] Zero regressions in production after each phase deployment

---

## 7. Recommended Execution Order

1. **Write smoke tests** for all 413 routes (can be auto-generated from the route mapping above)
2. **Phase 1** — extract leaf domains (lowest risk, builds confidence)
3. **Phase 2** — extract device drivers (isolates hardware concerns)
4. **Phase 3** — extract shared services (hardest phase — schedule carefully)
5. **Phase 4** — extract heavy route domains (depends on Phase 3)
6. **Phase 5** — cleanup remaining routes
7. **Final** — remove old code, verify line count, run full test suite

**Estimated total effort**: ~12 working days across 5 phases  
**Recommended cadence**: 1 phase per sprint (2 weeks), deployed to staging after each phase
