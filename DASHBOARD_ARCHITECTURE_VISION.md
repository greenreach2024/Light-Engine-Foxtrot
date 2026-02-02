# Dashboard Architecture Vision
**Created**: February 2, 2026  
**Owner**: Architecture Agent + Implementation Team  
**Status**: Active Roadmap  
**Related**: ARCHITECTURE_AGENT_ASSESSMENT_DATA_FLOW_FIX.md

---

## 🎯 Executive Summary

**Vision**: Modern, maintainable, component-based dashboard by 2027

**Current State**: jQuery-style imperative updates with inconsistent data flow

**Target State**: Lightweight component framework (Vue/Svelte) with reactive state management

**Timeline**: 2-year phased modernization (Q1 2026 - Q4 2027)

**Key Principle**: Progressive enhancement - ship value continuously, don't wait for perfection

---

## 📅 MULTI-YEAR ROADMAP

### Phase 1: Event-Driven Stabilization (Q1 2026 - NOW)

**Duration**: 2-3 months (Feb - Apr 2026)

**Goal**: Make current architecture maintainable and reliable

**Status**: ⏳ In Progress

**Deliverables**:
- ✅ Multi-agent review complete (Implementation → Review → Architecture)
- ⏳ Event-driven pattern implemented across all dashboard cards
- ⏳ Helper library (lib/data-flow-helpers.js) deployed
- ⏳ Component audit complete (COMPONENT_AUDIT.md)
- ⏳ Testing infrastructure established
- ⏳ Rollback strategy documented

**Success Metrics**:
- Data flows reliably between all sections (0 user-reported flow bugs)
- Developer velocity stable (time to add features unchanged)
- Performance baseline established (page load <2s, interactions <100ms)

**Technical Approach**:
```javascript
// Before: Manual DOM updates
function saveRoom() {
  STATE.room = getFormData();
  saveJSON('/data/rooms.json', STATE);
  // BUG: Other components don't know about update
}

// After: Event-driven updates
function saveRoom() {
  STATE.room = getFormData();
  saveJSON('/data/rooms.json', STATE);
  document.dispatchEvent(new Event('rooms-updated')); // ✅ Notify all listeners
}

// Components listen for changes
document.addEventListener('rooms-updated', () => {
  populateRoomDropdowns();
});
```

**Why This Matters**: Establishes consistent data flow pattern, prevents bugs where one page updates but others show stale data.

---

### Phase 2: Framework Evaluation (Q2-Q3 2026)

**Duration**: 3-4 months (May - Aug 2026)

**Goal**: Choose component framework strategically (not hastily)

**Status**: 🔮 Planned

**Activities**:

#### 2.1 Proof-of-Concept Projects (May-Jun 2026)
Build same 2 dashboard cards in 3 frameworks to compare:

**POC Cards**:
- Groups V2 (complex state, form-heavy)
- Device Inventory (list-heavy, real-time updates)

**Frameworks to Evaluate**:
1. **React** (industry standard)
   - Pros: Huge ecosystem, widespread adoption, excellent tooling
   - Cons: Larger bundle (150KB), steeper learning curve, more boilerplate
   - Edge Fit: Acceptable (bundle manageable on edge device)

2. **Vue** (progressive framework)
   - Pros: Easy learning curve, smaller bundle (90KB), excellent docs
   - Cons: Smaller ecosystem than React
   - Edge Fit: Good (lightweight, efficient)

3. **Svelte** (compile-time framework)
   - Pros: Tiny bundle (30KB), excellent performance, minimal boilerplate
   - Cons: Smaller ecosystem, less widespread adoption
   - Edge Fit: Excellent (smallest bundle, best edge performance)

**Evaluation Criteria**:
| Criterion | Weight | React | Vue | Svelte | Winner |
|-----------|--------|-------|-----|--------|--------|
| Bundle Size | 25% | 150KB (6/10) | 90KB (8/10) | 30KB (10/10) | Svelte |
| Learning Curve | 20% | Medium (7/10) | Easy (9/10) | Medium (8/10) | Vue |
| Developer Experience | 20% | Good (8/10) | Excellent (9/10) | Great (8/10) | Vue |
| Edge Performance | 20% | Good (7/10) | Good (8/10) | Excellent (10/10) | Svelte |
| Ecosystem/Community | 15% | Excellent (10/10) | Good (7/10) | Growing (6/10) | React |

**Measurement Plan**:
- Bundle size (KB): Measure production builds
- Page load time (ms): Test on edge device with slow internet simulation
- Developer time (hours): Track POC implementation time
- Team feedback: Survey developers on experience (1-10 scale)
- Memory usage (MB): Measure on edge device (512MB RAM constraint)

#### 2.2 Edge Device Testing (Jul 2026)
Test POCs on actual production edge device:
- Device: 100.65.187.59 (512MB RAM, ARM CPU)
- Network: Simulate rural internet (slow, high latency)
- Load: Run alongside farm automation (ensure no resource contention)

**Pass Criteria**:
- Bundle size < 200KB (slow rural internet constraint)
- Memory usage < 50MB per card (512MB shared with automation)
- CPU usage < 10% sustained (ARM processor, automation priority)
- Page load < 2s on slow connection
- No impact on farm automation (temperature control, lighting, etc.)

#### 2.3 Decision Gate (Aug 2026)
**Inputs**:
- POC technical results (bundle size, performance, dev time)
- Team feedback (developer experience, learning curve)
- Edge device validation (resource usage, farm automation impact)

**Decision Options**:
1. **Proceed with framework** (if clear winner emerges)
2. **Stay event-driven** (if no framework meets edge constraints)
3. **Hybrid approach** (new cards in framework, legacy cards event-driven)

**Decision Maker**: Architecture Agent + Development Team + User (Peter)

---

### Phase 3: Pilot Migration (Q4 2026)

**Duration**: 2-3 months (Sep - Nov 2026)

**Goal**: Validate framework choice in production with real users

**Status**: 🔮 Planned (conditional on Phase 2 approval)

**Pilot Cards** (3-5 cards to migrate):
1. **Groups V2** (already well-structured, complex state)
2. **Farm Registration** (form-heavy, good test case)
3. **Device Inventory** (list-heavy, real-time updates)
4. **Environmental Controls** (high-traffic, critical functionality)
5. **Schedule Builder** (complex UI, good stress test)

**Migration Strategy**:
- One card at a time (reduce risk)
- Feature flag per card (enable/disable without deploy)
- A/B testing (50% users see new, 50% see old)
- Monitoring (performance, errors, user feedback)

**Rollback Plan**:
- Feature flag instant rollback (no deploy required)
- Git branch per card (easy revert)
- Automated tests (catch regressions before production)

**Success Metrics**:
- Performance: New cards ≥ old cards (no regressions)
- User satisfaction: ≥90% positive feedback
- Developer velocity: ≥20% faster to add features
- Bug rate: ≤ old bug rate (no new instability)

**Validation Criteria** (proceed to Phase 4 if met):
- ✅ All pilot cards meet performance targets
- ✅ User feedback positive (≥90%)
- ✅ Developer velocity improved (≥20%)
- ✅ No critical bugs introduced
- ✅ Edge device resource usage acceptable

**Decision Gate** (Nov 2026):
- **Go**: Proceed with full migration (Phase 4)
- **No-Go**: Revert to event-driven, revisit framework choice
- **Pivot**: Try different framework, repeat pilot

---

### Phase 4: Gradual Migration (2027)

**Duration**: 6-12 months (Jan - Dec 2027)

**Goal**: Complete dashboard modernization (all cards migrated)

**Status**: 🔮 Planned (conditional on Phase 3 success)

**Migration Priority**:
Migrate high-traffic, high-value cards first:

**Priority 1 (Q1 2027)**: Critical functionality
- Groups V2 (already piloted)
- Environmental Controls (already piloted)
- Room Management
- Device Status

**Priority 2 (Q2 2027)**: High-traffic
- Schedule Builder (already piloted)
- Farm Registration (already piloted)
- Device Inventory (already piloted)
- Harvest Predictions

**Priority 3 (Q3 2027)**: Standard features
- Succession Planner
- VPD Dashboard
- Network Configuration
- User Management

**Priority 4 (Q4 2027)**: Low-traffic/admin
- System Logs
- Debug Tools
- Admin Settings
- Backup Management

**Migration Cadence**:
- 1-2 cards per sprint (2 weeks)
- 8-12 cards per quarter
- Parallel work (2-3 cards in progress simultaneously)
- Testing gate (cards must pass before production)

**Hybrid Phase Strategy**:
During migration, old and new code coexist:
```javascript
// Feature flag determines rendering
if (featureFlags.useNewGroups) {
  renderGroupsComponent(); // New component-based
} else {
  renderGroupsLegacy(); // Old event-driven
}
```

**Deprecation Timeline**:
- Q1 2027: Event-driven + components coexist
- Q2 2027: New cards default to components
- Q3 2027: Legacy cards migrated
- Q4 2027: Event-driven deprecated, removed from codebase

---

## 🏗️ ARCHITECTURAL PRINCIPLES

### Principle 1: Progressive Enhancement

**Philosophy**: Ship value continuously, don't wait for perfection

**Application**:
- ❌ Big-bang rewrite (6-12 months, no value until complete)
- ✅ Phased approach (ship every 2-3 months)

**Real Examples**:
- Phase 1: Event-driven (ships Q1, provides immediate value)
- Phase 2: POCs (ships Q2, validates approach)
- Phase 3: Pilots (ships Q4, validates at scale)
- Phase 4: Migration (ships throughout 2027)

**Benefit**: Continuous value delivery, reduced risk, faster feedback

### Principle 2: Edge-First Architecture

**Context**: Dashboard runs on edge device (512MB RAM, ARM CPU, rural internet)

**Constraints Drive Design**:
- Bundle size: <200KB (slow internet)
- Memory: <50MB per card (512MB shared)
- CPU: <10% sustained (automation priority)

**Framework Implications**:
- React (150KB) = Acceptable
- Vue (90KB) = Good
- Svelte (30KB) = Excellent
- Angular (300KB+) = Rejected

**Competitive Advantage**: Lightweight frameworks = faster loads = better UX on slow internet

### Principle 3: Farm Operations > Dashboard Prettiness

**Priority**: Never sacrifice farm control for UI improvements

**Risk Scenario**:
```
Dashboard migration breaks environmental controls
→ Temperature control fails
→ Plants die
→ Crop loss ($10K+)
→ User churn
```

**Mitigation**:
- Separate concerns (UI code ≠ automation code)
- Feature flags (enable new UI per-farm)
- Rollback plan (one-click revert)
- Testing gates (automation tests MUST pass)
- Monitoring (alert on automation failures)

**Implementation**:
```javascript
// WRONG: UI and automation coupled
function saveEnvironmentalSettings(temp, humidity) {
  updateUI(); // If this fails...
  sendToController(temp, humidity); // ...this doesn't run
}

// RIGHT: Automation independent
function saveEnvironmentalSettings(temp, humidity) {
  sendToController(temp, humidity); // Always runs first
  updateUI().catch(err => console.error('UI update failed', err)); // UI failure doesn't affect automation
}
```

### Principle 4: Component Reusability

**Philosophy**: Build once, use everywhere

**Pattern**:
1. Build component standalone (isolated development)
2. Test component thoroughly (unit + integration tests)
3. Integrate into dashboard (add to registry)
4. Track usage (know what depends on component)

**Example - Room Selector Component**:
```javascript
// Build standalone
class RoomSelector {
  constructor(options) {
    this.rooms = options.rooms || [];
    this.onChange = options.onChange || (() => {});
  }
  
  render() {
    return `<select>${this.rooms.map(r => `<option value="${r.id}">${r.name}</option>`)}</select>`;
  }
}

// Use in multiple places
// Groups V2 card
new RoomSelector({ rooms: STATE.rooms, onChange: handleGroupRoomChange });

// Farm Registration card
new RoomSelector({ rooms: STATE.rooms, onChange: handleFarmRoomChange });

// Device Inventory card
new RoomSelector({ rooms: STATE.rooms, onChange: handleDeviceRoomChange });
```

**Benefit**: Change once (update RoomSelector), fix everywhere (all 3 cards updated)

---

## 📊 SUCCESS METRICS

### Phase 1 Metrics (Event-Driven)

**Data Flow Reliability**:
- Target: 0 user-reported data flow bugs
- Measurement: User feedback, bug reports
- Current: 5-10 bugs/month (data not flowing between pages)
- Success: <1 bug/month

**Developer Velocity**:
- Target: Maintain current velocity (don't slow down)
- Measurement: Time to add new feature/card
- Current: 4-8 hours per card
- Success: 4-8 hours per card (unchanged)

**Performance**:
- Target: Establish baseline (no regressions)
- Measurement: Page load, interaction lag
- Current: 1.5s page load, 50ms interactions
- Success: ≤2s page load, ≤100ms interactions

### Phase 2 Metrics (Framework Evaluation)

**Bundle Size**:
- Target: <200KB (edge device constraint)
- Measurement: Production build size
- Success: Chosen framework <200KB

**Edge Performance**:
- Target: No impact on farm automation
- Measurement: Memory usage, CPU usage
- Success: <50MB memory, <10% CPU

**Developer Experience**:
- Target: ≥8/10 satisfaction
- Measurement: Team survey
- Success: ≥80% team prefers chosen framework

### Phase 3 Metrics (Pilot)

**User Satisfaction**:
- Target: ≥90% positive feedback
- Measurement: User surveys, feedback forms
- Success: ≥90% users prefer new cards

**Bug Rate**:
- Target: ≤ old bug rate
- Measurement: Bug reports per card
- Success: New cards ≤ old cards (no increase)

**Performance**:
- Target: ≥ old performance
- Measurement: Page load, interaction lag
- Success: New cards ≥ old cards (no regressions)

### Phase 4 Metrics (Migration)

**Migration Progress**:
- Target: All cards migrated by Q4 2027
- Measurement: Cards migrated / total cards
- Success: 100% migrated by Dec 2027

**Developer Velocity**:
- Target: ≥20% improvement
- Measurement: Time to add features
- Success: New cards 20% faster to develop

**Technical Debt**:
- Target: Event-driven code removed
- Measurement: Lines of legacy code
- Success: 0 event-driven code remaining

---

## ⚠️ RISK MANAGEMENT

### Risk 1: Event-Driven Technical Debt

**Description**: Event listeners create maintenance burden as dashboard grows

**Probability**: HIGH (event-driven doesn't scale to 50+ components)

**Impact**: MEDIUM (slows development, increases bugs)

**Timeline**: 6-12 months before pain acute

**Mitigation**:
- Document event flow (COMPONENT_AUDIT.md)
- Helper library standardizes pattern (data-flow-helpers.js)
- Migrate to components before debt critical (Phase 4 by Q4 2027)
- Monitor bug rate (alert if event-driven bugs increase)

**Acceptance**: Short-term debt acceptable if time-boxed (12 months max)

### Risk 2: Framework Choice Regret

**Description**: Choose wrong framework, costly to migrate again

**Probability**: MEDIUM (frameworks evolve, needs change)

**Impact**: HIGH (months of rework if wrong choice)

**Timeline**: 2027-2028 (after full migration)

**Mitigation**:
- POC phase validates before commitment (Q2 2026)
- Pilot phase validates at scale (Q4 2026)
- Component abstraction layer (easier to swap frameworks)
- Gradual migration (limit blast radius)

**Decision Gates**: Two chances to pivot (after POCs, after pilot)

### Risk 3: Migration Disruption

**Description**: Dashboard migration introduces bugs affecting farm automation

**Probability**: MEDIUM (UI changes often have unforeseen consequences)

**Impact**: CRITICAL (crop loss, revenue loss)

**Timeline**: Any time during migration

**Mitigation**:
- Separation of concerns (UI ≠ automation code)
- Feature flags (per-farm enablement, instant rollback)
- Automated testing (UI + automation tests before deploy)
- Monitoring (alert on automation failures immediately)
- Rollback plan (one-command revert)

**Zero Tolerance**: Any automation failure = instant rollback

### Risk 4: Team Learning Curve

**Description**: Team unfamiliar with chosen framework, slows development

**Probability**: HIGH (any new framework requires learning)

**Impact**: MEDIUM (temporary velocity decrease)

**Timeline**: Q4 2026 - Q1 2027 (pilot + early migration)

**Mitigation**:
- Training budget (courses, workshops, conferences)
- Pilot projects (learn on low-risk cards)
- Documentation (internal patterns, best practices)
- Code review (senior devs guide junior devs)
- Gradual ramp (don't parallelize too many cards)

**Acceptance**: 20-30% velocity decrease acceptable during learning phase

### Risk 5: Edge Device Obsolescence

**Description**: Edge device hardware becomes bottleneck for modern frameworks

**Probability**: LOW (current hardware sufficient for 2-3 years)

**Impact**: HIGH (requires hardware upgrade or cloud migration)

**Timeline**: 2027-2028

**Mitigation**:
- Lightweight framework choice (Vue/Svelte, not React)
- Performance testing on edge device (Phase 2)
- Hardware refresh plan (upgrade edge devices if needed)
- Cloud fallback (migrate to cloud if edge untenable)

**Monitoring**: Track edge device resource usage quarterly

---

## 📚 DECISION RECORDS

### Decision 1: Event-Driven Pattern for Short-Term (Feb 2026)

**Context**: Dashboard data flow broken, need fix urgently

**Options Considered**:
1. Quick patch (fix broken pages ad-hoc) - Fast but incomplete
2. Event-driven pattern (systematic fix) - Medium speed, maintainable
3. Component framework migration (modernize now) - Slow, high risk
4. Redux state management (formal solution) - Overkill for current scale

**Decision**: Event-driven pattern (#2)

**Rationale**:
- Provides systematic fix (not band-aid)
- Ships in 2-3 months (fast enough)
- Buys time for strategic framework decision
- Low risk (proven pattern, Groups V2 working example)

**Approved By**: Implementation Agent + Review Agent + Architecture Agent

**Date**: February 2, 2026

---

### Decision 2: Reject Redux for Now (Feb 2026)

**Context**: Consider formal state management (Redux, MobX, etc.)

**Options Considered**:
1. Redux now (formal state management)
2. MobX now (reactive state management)
3. Event-driven now, Redux later (defer decision)
4. Simple store pattern (lightweight alternative)

**Decision**: Event-driven now, revisit with framework (#3)

**Rationale**:
- Redux without components = overkill (all cost, limited benefit)
- Current scale (15-20 cards) doesn't justify Redux complexity
- Redux shines with React/Vue (make one decision, not two)
- Event-driven + helper library = 90% of benefits, 10% of cost

**Approved By**: Architecture Agent

**Date**: February 2, 2026

---

### Decision 3: Multi-Phase Approach (Feb 2026)

**Context**: How to modernize dashboard without disrupting farm operations

**Options Considered**:
1. Big-bang rewrite (stop feature work, rewrite everything)
2. Parallel dashboard (build new, switch when ready)
3. Phased migration (incremental improvements)
4. Status quo (don't modernize)

**Decision**: Phased migration (#3)

**Rationale**:
- Ships value continuously (not 6-12 month wait)
- Reduces risk (small changes, easy rollback)
- Maintains farm operations (no disruption)
- Allows course correction (pivot if needed)

**Approved By**: Architecture Agent + User (Peter)

**Date**: February 2, 2026

---

## 🔄 REVIEW & ADAPTATION

### Quarterly Reviews

**Q2 2026** (After POCs):
- Review framework POC results
- Decide: Proceed to pilot or stay event-driven?
- Update roadmap based on learnings

**Q4 2026** (After Pilot):
- Review pilot results (3-5 cards)
- Decide: Proceed to full migration or pivot?
- Update roadmap based on user feedback

**Q2 2027** (Mid-Migration):
- Review migration progress (50% complete)
- Assess: On track for Q4 completion?
- Adjust timeline/resources if needed

**Q4 2027** (Migration Complete):
- Review final results (all cards migrated)
- Measure: Velocity improvement, bug reduction
- Document lessons learned

### Adaptation Triggers

**Trigger 1: Framework Doesn't Meet Edge Constraints**
- If POCs exceed 200KB or 50MB memory
- Action: Try different framework or stay event-driven

**Trigger 2: User Negative Feedback**
- If pilot feedback <70% positive
- Action: Revert to old cards, reassess approach

**Trigger 3: Migration Disrupts Farm Operations**
- If any automation failures during migration
- Action: Instant rollback, root cause analysis

**Trigger 4: Team Velocity Drops >30%**
- If learning curve steeper than expected
- Action: More training, slower migration pace

**Trigger 5: Better Framework Emerges**
- If new framework clearly superior
- Action: Re-evaluate, potentially pivot

---

## 📖 REFERENCES

- Multi-Agent Review: `IMPLEMENTATION_PROPOSAL_DATA_FLOW_FIX.md`, `REVIEW_AGENT_ASSESSMENT_DATA_FLOW_FIX.md`, `ARCHITECTURE_AGENT_ASSESSMENT_DATA_FLOW_FIX.md`
- Framework Guidance: `.github/AGENT_SKILLS_FRAMEWORK.md`
- Component Pattern: Validated in P3 + P4 (HarvestPredictions, SuccessionPlanner)
- Edge Device Specs: 100.65.187.59 (512MB RAM, ARM CPU)

---

**Status**: Active Roadmap  
**Next Review**: May 2026 (after POCs)  
**Owner**: Architecture Agent + Development Team  
**Approver**: Peter Gilbert (User)
