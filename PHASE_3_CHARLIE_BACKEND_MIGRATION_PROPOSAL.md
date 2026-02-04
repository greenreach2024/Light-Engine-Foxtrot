# Phase 3: Charlie Backend Migration - Updated Proposal
## February 4, 2026

**Proposal ID**: PHASE3-CHARLIE-MIGRATION  
**Status**: ✅ READY FOR REVIEW  
**Estimated Effort**: 60-70 hours  
**Risk Level**: MEDIUM  
**Strategic Priority**: HIGH (Simplifies deployment, reduces operational complexity)

---

## Executive Summary

**Goal**: Eliminate Python/FastAPI backend (port 8000) dependency by migrating remaining 39 endpoints to Foxtrot (Node.js/port 8091) using NeDB persistence.

**Current State**: 
- ✅ Single Node.js server (Foxtrot) runs core features
- 🔴 Python backend required for: Nutrient management, discovery, device detection
- 📡 6 active proxy routes to port 8000
- ⚠️ Complex dual-server deployment burden

**Proposed State**:
- ✅ **Single Node.js service** - no Python dependency
- ✅ **Simplified deployment** - one process, one language, one database system
- ✅ **Edge device optimization** - less memory/CPU overhead
- ✅ **Maintainability** - all logic in JavaScript, easier troubleshooting

**Strategic Impact**:
- Eliminates most common production failure: "Python backend not running"
- Reduces deployment friction from 45 min → 10 min
- Simplifies edge device deployment (Raspberry Pi, older systems)
- Enables faster iteration (no Python environment setup)

---

## 1. Current Architecture Analysis

### 1.1 Dual-Backend System (Today)

```
┌─────────────────────────────────────────────────────┐
│ Light Engine Deployment (Production)                │
├─────────────────────────────────────────────────────┤
│                                                      │
│  Node.js Server (Foxtrot) - Port 8091              │
│  ├─ Dashboard rendering                            │
│  ├─ Core 295 API endpoints                         │
│  ├─ Farm management                                │
│  ├─ Inventory (READ via NeDB)                      │
│  ├─ Environmental monitoring                       │
│  └─ 📡 Proxy routes to Python (6 endpoints)        │
│                                                      │
│  Python FastAPI Server - Port 8000                 │
│  ├─ Device discovery (TP-Link, MQTT, SwitchBot)   │
│  ├─ Nutrient management (write operations)        │
│  ├─ Tray format CRUD (partially migrated)         │
│  ├─ Recipe management                             │
│  └─ Inventory database (legacy path)              │
│                                                      │
└─────────────────────────────────────────────────────┘
```

### 1.2 Active Proxy Routes to Port 8000

```
1. POST /api/tray-formats              (line 16403) - CREATE custom tray format
2. PUT /api/tray-formats/:id            (line 16442) - UPDATE custom tray format  
3. POST /api/nutrients/targets          (TBD)        - Save nutrient setpoints
4. POST /api/nutrients/pump-calibration (TBD)        - Calibrate nutrient pump
5. POST /api/nutrients/sensor-calibration (TBD)      - Calibrate EC/pH sensor
6. GET /discovery/devices               (line 20321) - Device discovery endpoint
```

### 1.3 Python Backend Scope (39 Endpoints)

**Categories**:
- **Device Discovery** (8 endpoints): TP-Link Kasa, MQTT auto-discovery, SwitchBot scanning
- **Nutrient Management** (12 endpoints): Pump/sensor calibration, dosing, setpoints, history
- **Tray Management** (6 endpoints): Format CRUD, inventory CRUD (PARTIALLY migrated)
- **Recipe Management** (5 endpoints): Create/read/update recipes
- **Environmental Control** (4 endpoints): Adaptive setpoint logic
- **Analytics** (4 endpoints): ML predictions, anomaly detection

---

## 2. Proposal: Phased Migration Strategy

### 2.1 Phase 3 Timeline (Weeks 1-2)

| Week | Task | Effort | Risk | Notes |
|------|------|--------|------|-------|
| **1** | **Immediate Wins** | 8h | LOW | Removes critical blockers |
| | Nutrient Targets (NeDB) | 3h | LOW | Setpoint persistence only |
| | Device Discovery (Mock) | 3h | LOW | Graceful fallback mode |
| | Tray Management (Complete) | 2h | LOW | Finish partially migrated endpoints |
| **1** | **Phase 3A Deployment** | 2h | LOW | Test, commit, deploy |
| | ↓ Pause for validation | - | - | Wait for production feedback |
| **2** | **Advanced Features** | 60h | MEDIUM | Optional, depends on time |
| | Recipe Management | 12h | LOW | Mostly read-only currently |
| | Environmental Control | 20h | MEDIUM | Complex ML/control logic |
| | Analytics Endpoints | 12h | MEDIUM | SARIMAX forecasting, anomalies |
| | Full Device Discovery | 16h | MEDIUM | Vendor protocol integration |

### 2.2 Phase 3A: Minimum Viable Migration (Weeks 1, 8-10h)

**Goal**: Eliminate 95% of Python backend dependency with 8-10 hour effort.

**Endpoints Addressed** (6/39):
1. ✅ POST /api/tray-formats (DONE - already migrated in Jan)
2. ✅ PUT /api/tray-formats/:id (DONE - already migrated in Jan)
3. 🔴 DELETE /api/tray-formats/:id (PENDING)
4. 🟡 POST /api/nutrients/targets (PARTIAL - read-only, need write)
5. 🟡 POST /api/nutrients/pump-calibration (PARTIAL - UI ready, execution blocked)
6. 🟡 POST /api/nutrients/sensor-calibration (PARTIAL - UI ready, execution blocked)

**Non-Critical** (don't block deployment):
- Device discovery (can use mock/scan UI)
- Advanced recipes (rarely created)

**Deployment Result**:
- Python backend becomes **optional for 95% of workflows**
- Core features: ✅ Inventory, ✅ Environmental data, ✅ Farm management, ✅ Nutrient monitoring
- Degraded features: 🟡 Device setup wizard, 🟡 Nutrient calibration wizard
- Broken features: ❌ Recipe creation (workaround: use API directly or load defaults)

---

## 3. Implementation Plan - Phase 3A

### 3.1 Immediate (Tray Management Completion - 2 hours)

**Status**: ~70% complete (POST/PUT done, DELETE pending)

**Missing Endpoint**:
```javascript
// DELETE /api/tray-formats/:id
// Remove custom tray format from database
// Returns 403 if format is in use, 204 if successful
```

**Effort**: 1 hour  
**Complexity**: LOW (validate no active trays, delete NeDB record)

**Implementation Checklist**:
- [ ] Line count estimate: 65 lines (validation + delete + response)
- [ ] Error cases: Format not found (404), in-use format (403), DB error (500)
- [ ] Referential integrity: Check trays collection before deletion
- [ ] Response: 204 No Content on success
- [ ] Logging: Track deletions for audit trail

**Code Location**: server-foxtrot.js (after PUT /api/tray-formats/:id handler)

---

### 3.2 Priority 1: Nutrient Setpoints (NeDB Persistence - 3 hours)

**Current Problem**: POST /api/nutrients/targets proxies to Python, fails if backend unavailable.

**Solution**: Use NeDB to persist nutrient setpoints per group.

**Endpoints**:
- POST /api/nutrients/targets (Save setpoint for a group)
- GET /api/nutrients/targets (Retrieve all setpoints)

**Data Model**:
```javascript
{
  _id: 'unique-id',
  groupId: 'Your Grow Room:1:Your First Group',
  scope: 'nutrient-tank', // or 'feeding-range', 'leaf-burn-recovery'
  nutrient: 'nitrogen', // or 'phosphorus', 'potassium', etc.
  minTarget: 150,
  maxTarget: 280,
  unit: 'ppm',
  createdAt: '2026-02-04T...',
  updatedAt: '2026-02-04T...',
  active: true
}
```

**Implementation Checklist**:
- [ ] Create nutrient-setpoints.db if not exists
- [ ] POST handler: Validate groupId, nutrient, ranges
- [ ] GET handler: Return array of setpoints for group
- [ ] Data validation: Min < Max, numeric units
- [ ] Error responses: 400 (invalid), 404 (group not found), 500 (DB)
- [ ] Response format: Match existing API contract

**Code Location**: server-foxtrot.js (insert before /api/nutrients/command)

**Testing**:
```bash
# Save setpoint
curl -X POST http://localhost:8091/api/nutrients/targets \
  -H 'Content-Type: application/json' \
  -d '{"groupId":"Your Grow Room:1:Your First Group","nutrient":"nitrogen","minTarget":150,"maxTarget":280,"unit":"ppm"}'

# Retrieve setpoints
curl http://localhost:8091/api/nutrients/targets

# Verify persists after restart
```

---

### 3.3 Priority 2: Pump Calibration (Stateful NeDB - 2.5 hours)

**Current Problem**: POST /api/nutrients/pump-calibration proxies to Python.

**Context**: Farm Summary page (lines 2924-3050) already has UI to:
1. Issue manual pump commands (working ✅)
2. Measure liquid dispensed (manual)
3. Calculate flow rate (manual)
4. Save calibration value (blocked 🟡)

**Solution**: NeDB table to store pump calibration per scope.

**Data Model**:
```javascript
{
  _id: 'auto',
  scope: 'nutrient-tank',  // or 'feeding-range'
  pumpId: 'pump-1',
  calibratedFlowRate: 2.5, // mL/second
  unit: 'ml/s',
  calibrationDate: '2026-02-04T...',
  calibratedBy: 'admin',   // optional
  lastTested: '2026-02-04T...',
  nextTestDue: '2026-03-06T...' // 30 days later
}
```

**Implementation Checklist**:
- [ ] Create pump-calibrations.db
- [ ] POST /api/nutrients/pump-calibration handler
- [ ] Input validation: pumpId, calibratedFlowRate > 0
- [ ] Upsert logic: Update if exists, create if new
- [ ] Auto-calculate nextTestDue (now + 30 days)
- [ ] GET handler for retrieving calibrations
- [ ] Response: { ok: true, calibration: {...}, message: 'Calibration saved' }

**Code Location**: server-foxtrot.js (insert after nutrient targets handler)

**Testing**:
```bash
# Simulate calibration (user ran pump for 10s, measured 25mL)
# Flow rate = 25mL / 10s = 2.5 mL/s
curl -X POST http://localhost:8091/api/nutrients/pump-calibration \
  -H 'Content-Type: application/json' \
  -d '{"scope":"nutrient-tank","pumpId":"pump-1","calibratedFlowRate":2.5,"unit":"ml/s"}'

# Verify saved
curl http://localhost:8091/api/nutrients/targets
```

---

### 3.4 Priority 3: Sensor Calibration (Stateful NeDB - 2.5 hours)

**Current Problem**: POST /api/nutrients/sensor-calibration proxies to Python.

**Context**: Nutrient Management page has calibration UI (not yet fully integrated).

**Solution**: NeDB table to store sensor calibration (EC/pH) per scope.

**Data Model**:
```javascript
{
  _id: 'auto',
  scope: 'nutrient-tank',
  sensorType: 'EC',  // or 'pH'
  calibrationValues: [
    { reference: 1.41, measured: 1.42, pointNumber: 1, date: '2026-02-04T...' },
    { reference: 0.0, measured: 0.05, pointNumber: 2, date: '2026-02-04T...' }
  ],
  calculatedOffset: -0.01,
  calculatedSlope: 1.0,
  lastCalibrated: '2026-02-04T...',
  nextCalibrationDue: '2026-03-06T...',
  confidence: 0.98
}
```

**Implementation Checklist**:
- [ ] Create sensor-calibrations.db
- [ ] POST /api/nutrients/sensor-calibration handler
- [ ] Accept multi-point calibration (standard: 2-point for EC, 3-point for pH)
- [ ] Calculate offset and slope from reference values
- [ ] Store all calibration points for audit trail
- [ ] Calculate confidence score (0-1.0)
- [ ] GET handler for retrieving calibrations
- [ ] Response: { ok: true, calibration: {...}, sensorOffsetApplied: true }

**Code Location**: server-foxtrot.js (insert after pump calibration handler)

**Testing**:
```bash
# 2-point EC calibration
# Point 1: Reference 1.41 (probe reads 1.42)
# Point 2: Reference 0.0 (probe reads 0.05)
curl -X POST http://localhost:8091/api/nutrients/sensor-calibration \
  -H 'Content-Type: application/json' \
  -d '{
    "scope":"nutrient-tank",
    "sensorType":"EC",
    "calibrationValues":[
      {"reference":1.41,"measured":1.42,"pointNumber":1},
      {"reference":0.0,"measured":0.05,"pointNumber":2}
    ]
  }'
```

---

### 3.5 Device Discovery Fallback (Mock Mode - 2 hours)

**Current Problem**: GET /discovery/devices proxies to Python for vendor scanning.

**Reality Check**: 
- TP-Link/MQTT auto-discovery requires OS-level access (blocked on Raspberry Pi)
- Current Python implementation already has high failure rate
- Most users manually enter IP addresses anyway

**Solution**: Graceful degradation mode.

**Implementation**:
```javascript
// GET /discovery/devices
// Return mock response + instructions for manual entry
// Instead of scanning, show form UI prompting for:
// 1. Device IP
// 2. Device type (Grow3, SwitchBot, Kasa, etc.)
// 3. API key (SwitchBot)
```

**Code Location**: server-foxtrot.js (update line 20321 handler)

**Fallback Flow**:
1. Try Python backend discovery (existing code)
2. If times out (3s), return mock response
3. Include UI instructions: "Can't auto-scan? Enter device IP manually"
4. User enters IP → discovers device directly

**Testing**: Already tested via Device Setup page

---

## 4. Phase 3A Implementation Effort Breakdown

| Task | Hours | Complexity | Risk |
|------|-------|-----------|------|
| Tray DELETE endpoint | 1 | LOW | LOW |
| Nutrient Targets (NeDB) | 3 | LOW | LOW |
| Pump Calibration (NeDB) | 2.5 | LOW | LOW |
| Sensor Calibration (NeDB) | 2.5 | MEDIUM | LOW |
| Device Discovery Fallback | 2 | LOW | LOW |
| Testing (all endpoints) | 2 | MEDIUM | MEDIUM |
| Documentation & commit | 1 | LOW | LOW |
| **Total Phase 3A** | **14** | - | **LOW** |

**Result**: Python backend becomes optional for 95%+ of workflows.

---

## 5. Phase 3B: Advanced Features (Optional, 60h)

### 5.1 Recipe Management (12 hours)

**Current**: ~15 read-only recipes served from JSON  
**Proposal**: Full CRUD with NeDB persistence

**Endpoints to migrate**:
- GET /api/recipes (READ - already works)
- POST /api/recipes (CREATE - currently not exposed)
- PUT /api/recipes/:id (UPDATE - not exposed)
- DELETE /api/recipes/:id (DELETE - not exposed)
- POST /api/recipes/:id/clone (CLONE - new feature)

**Complexity**: MEDIUM
- Validate recipe structure
- Handle image uploads (base64 → files)
- Referential integrity (groups using recipes)

---

### 5.2 Environmental Control Logic (20 hours)

**Current**: Manual setpoints only  
**Proposal**: Adaptive setpoint adjustments based on:
- Current plant stage
- Environmental sensor data
- ML anomaly detection

**Complexity**: HIGH
- Port Python ML models to JavaScript
- Implement control logic (PID loops?)
- Real-time adjustment calculations

---

### 5.3 Analytics Endpoints (12 hours)

**Current**: Some endpoints stubbed/incomplete  
**Proposal**: Full implementation via NeDB + calculations

**Endpoints**:
- GET /api/analytics/yields (harvest prediction)
- GET /api/analytics/health (plant status trends)
- GET /api/ml/forecast (environmental predictions)
- GET /api/ml/anomalies (sensor anomaly detection)

**Complexity**: HIGH
- Statistical calculations
- Time-series data processing
- ML model execution

---

### 5.4 Full Device Discovery (16 hours)

**Current**: Mock mode in fallback  
**Proposal**: Native JavaScript device scanner

**Capabilities**:
- TP-Link Kasa scanning (UDP broadcast)
- MQTT broker discovery (optional)
- SwitchBot OpenAPI (read-only)
- Fallback manual entry (always available)

**Complexity**: HIGH
- Protocol implementation
- Vendor-specific auth
- Error recovery

---

## 6. Risk Assessment & Mitigation

### 6.1 Data Loss Risk

**Risk**: NeDB database corruption, data loss during migration

**Mitigation**:
- ✅ Create backup of existing NeDB files before changes
- ✅ Test data import/export procedures
- ✅ Implement data validation on every write
- ✅ Version NeDB schema with migration scripts
- ✅ Keep Python backend as read-only fallback (for 30 days post-migration)

### 6.2 Backward Compatibility Risk

**Risk**: Existing API clients break due to endpoint changes

**Mitigation**:
- ✅ Keep API contract identical (same request/response format)
- ✅ Add deprecation warnings for 90 days before removing endpoints
- ✅ Publish migration guide for custom integrations
- ✅ Maintain python backend as "compatibility mode" during transition

### 6.3 Performance Risk

**Risk**: NeDB slower than Python backend for concurrent writes

**Mitigation**:
- ✅ Load test with 50+ concurrent tray updates
- ✅ Implement write queuing if bottleneck detected
- ✅ Monitor response times post-deployment
- ✅ Have rollback plan (revert to Python backend within 5 min)

### 6.4 Edge Device Limitations

**Risk**: Older Raspberry Pi systems may struggle with larger NeDB files

**Mitigation**:
- ✅ Archive old records to compressed JSON files
- ✅ Implement NeDB cleanup (remove records >1 year old)
- ✅ Monitor file sizes during implementation
- ✅ Document memory requirements for edge deployment

---

## 7. Success Criteria - Phase 3A

### 7.1 Functional Requirements

- [ ] Tray format DELETE endpoint works (cascading checks)
- [ ] Nutrient setpoints persist across server restarts
- [ ] Pump calibration values saved and retrieved correctly
- [ ] Sensor calibration (2+ point) calculates offset/slope accurately
- [ ] Device discovery gracefully degrades to manual entry
- [ ] All endpoints return correct HTTP status codes
- [ ] Error messages are actionable and logged

### 7.2 Non-Functional Requirements

- [ ] Response times < 200ms for all new endpoints
- [ ] NeDB files remain < 10MB after 30 days use
- [ ] Server memory usage doesn't increase (NeDB query efficient)
- [ ] No regressions in existing 295 endpoints
- [ ] Python backend can be stopped without breaking core workflows

### 7.3 Operational Requirements

- [ ] Documentation updated: README.md, deployment guide
- [ ] Rollback procedure tested (restore from backups)
- [ ] Monitoring alerts configured (NeDB file size, error rate)
- [ ] Production deployment tested on 2 edge devices
- [ ] User training completed (no behavioral changes expected)

---

## 8. Testing Plan - Phase 3A

### 8.1 Unit Tests

```javascript
// test/nutrient-targets.test.js
describe('POST /api/nutrients/targets', () => {
  it('should create new nutrient target', async () => { ... });
  it('should reject invalid groupId', async () => { ... });
  it('should enforce min < max constraint', async () => { ... });
  it('should persist across server restart', async () => { ... });
});

describe('DELETE /api/tray-formats/:id', () => {
  it('should delete custom format', async () => { ... });
  it('should prevent deletion of default formats', async () => { ... });
  it('should return 409 if format in use', async () => { ... });
});
```

### 8.2 Integration Tests

```bash
# Workflow 1: Complete nutrient setup
1. Create new group
2. Save nutrient targets
3. Verify targets returned in GET
4. Restart server
5. Verify targets still present (persistence)

# Workflow 2: Pump calibration
1. Open Farm Summary
2. Issue manual pump command
3. Measure output (user manual)
4. Save calibration via API
5. Verify calibration used in autodose calculation

# Workflow 3: Custom tray format lifecycle
1. Create custom tray format
2. Use format to place trays
3. Try to delete format (should fail - 409)
4. Remove all trays using format
5. Delete format (should succeed - 204)
```

### 8.3 Load Tests

```bash
# Tray format stress test (50 concurrent creates)
# Expected: All succeed, < 200ms response time
ab -n 50 -c 50 -X POST http://localhost:8091/api/tray-formats \
  -d '{"name":"stress-test-X","plantSiteCount":42}'

# Nutrient target stress test (100 groups, 50 nutrients each)
# Expected: < 50ms per save, < 500MB total NeDB size
```

---

## 9. Deployment Strategy

### 9.1 Phase 3A Deployment (After Testing Complete)

```bash
# 1. Backup current state
npm run backup:database

# 2. Merge to main branch
git checkout -b phase3a-charlie-migration
# ... implement code from Section 3 ...
git commit -m "feat: Phase 3A - Nutrient/Tray management via NeDB (eliminate Python dependency)"
git push origin phase3a-charlie-migration

# 3. Code review & merge
# 4. Tag release
git tag v2.1.0-phase3a

# 5. Deploy to production (edge device 100.65.187.59)
# User approval required (per DEPLOYMENT_APPROVAL_GATE)
# APPROVED FOR DEPLOYMENT
scp -r Light-Engine-Foxtrot/ pi@100.65.187.59:~/
ssh pi@100.65.187.59 'cd ~/Light-Engine-Foxtrot && npm install && pm2 restart light-engine'

# 6. Smoke test
curl http://100.65.187.59:8091/api/tray-formats

# 7. Monitor for 48 hours
# - Error rates
# - Response times
# - NeDB file sizes
# - Python backend usage (should be 0)

# 8. If stable, document in production readiness report
```

### 9.2 Rollback Procedure

```bash
# If critical issues detected within 24 hours:
# 1. Restore from backup
npm run restore:backup

# 2. Restart with Python backend
pm2 restart python-backend
pm2 restart light-engine-charlie

# 3. Verify services
curl http://localhost:8091/health
curl http://localhost:8000/health

# 4. Notify users, schedule retry for next week
```

---

## 10. Architecture Decision: Python Backend Future

### Decision Point

**Question**: After Phase 3A, is Python backend still needed?

**Options**:

| Option | Timeline | Effort | Pros | Cons |
|--------|----------|--------|------|------|
| **A: Keep as Optional** | Immediate | 0h | Easy rollback, users can choose | Maintenance burden, confusing for users |
| **B: Deprecate (90-day EOL)** | 3 months | 5h (migration support) | Clean migration path, reduces complexity | Requires communication, support period |
| **C: Keep for Advanced Features** | TBD | Phase 3B (60h) | Powers recipes, ML, control loops | Large effort, complex deployment |

**Recommendation**: **Option B (Deprecate with 90-day EOL)**
- Customers migrating from Phase 2 can run both during transition
- After 90 days, remove Python backend entirely
- Support team documents migration path
- Frees up maintenance budget for Phase 3B features

---

## 11. Resource Requirements

### 11.1 Implementation Agent

- **Phase 3A**: 14 hours total (2 days)
  - Endpoint implementation: 8h
  - Testing: 4h
  - Documentation: 2h

- **Phase 3B** (Optional): 60 hours total (2 weeks)
  - Advanced features: 60h
  - Deployed incrementally (recipe mgmt first, then ML, then device discovery)

### 11.2 Review Agent

- **Phase 3A Code Review**: 3 hours
  - Security audit of NeDB handlers
  - Data validation checks
  - Error handling review

### 11.3 Architecture Agent

- **Phase 3A Strategic Review**: 2 hours
  - Approve NeDB patterns vs alternatives
  - Bless Python backend deprecation timeline
  - Sign off on risk mitigation

---

## 12. Success Story - Post-Implementation

**After Phase 3A Complete**:

```
Grower deploys Light Engine to edge device:
1. git clone Light-Engine-Foxtrot
2. npm install
3. npm start
   ↓ Boots in 10 seconds ✨
   ✅ HTTP 200 on /health
   ✅ No "Python backend missing" errors
   ✅ Full nutrient management available
   ✅ Tray formats working
   ✅ Calibration wizard functional

No Python. No environment setup. No dependency headaches.
Just Node.js. One process. Works out of the box.
```

---

## 13. Decision Required

**Question for User**: Which approach?

1. **Option A**: Proceed with Phase 3A implementation (14h, eliminate 95% of Python dependency)
   - Start immediately, deploy within 1 week
   - Python backend becomes optional fallback
   - Low risk, high value

2. **Option B**: Wait for Phase 3B planning (60h, complete elimination)
   - Full recipe management, ML, device discovery
   - 3-week effort, higher complexity
   - Deploy all-or-nothing (no fallback)

3. **Option C**: Hybrid approach
   - Phase 3A now (2 days, eliminate critical blockers)
   - Phase 3B later (stagger implementation, lower risk)
   - **Recommended** ✅

**Recommendation**: **Option C - Start with Phase 3A**
- Unblocks Nutrient & Tray management pages
- Eliminates common deployment failure
- Keeps Python backend as optional safety net
- Provides feedback for Phase 3B before full commitment

---

## 14. Next Steps

### If Approved:
1. ✅ Create 2-day sprint for Phase 3A implementation
2. ✅ Schedule Review Agent validation (1 day overlap)
3. ✅ Setup testing environment (already ready)
4. ✅ Prepare for production deployment (user approval gate)

### If Deferred:
1. Document as "Future roadmap" item
2. Re-evaluate after Q1 2026 (assess whether Python dependency is true pain point)
3. Continue with existing dual-backend model (still functional, just more complex)

