# F.A.Y.E. — Vision & Autonomy Roadmap

**Farm Autonomy & Yield Engine**
**Version**: 3.1.0
**Last Updated**: 2026-03-21

---

## Positioning

F.A.Y.E. is a governed farm operations intelligence layer that observes, learns, recommends, and progressively automates decisions across the GreenReach network.

The end-state is supervised autonomy — a system that monitors, learns, decides, and acts across every domain of the business under explicit decision governance. The admin does not manage the farm through F.A.Y.E.; F.A.Y.E. manages the farm, and the admin provides strategic direction and final approval on high-impact decisions.

The design principles are: **supervised autonomy**, **operational memory**, **decision governance**, and **closed-loop farm intelligence**. Every autonomous action is built on a track record of correct decisions, governed by hard policy boundaries, and auditable at any time.

---

## Hierarchy: F.A.Y.E. > E.V.I.E.

F.A.Y.E. and E.V.I.E. are separate agents with a clear chain of command.

| | F.A.Y.E. | E.V.I.E. |
|---|---|---|
| **Full Name** | Farm Autonomy & Yield Engine | (Grower-facing assistant) |
| **Scope** | Business operations, admin, management, strategy | Individual growers, crop guidance, support |
| **Reports To** | Admin (Peter) | F.A.Y.E. |
| **Authority** | Full operational control within trust tiers | Grower interactions only, no business ops |
| **Data Access** | All systems: accounting, orders, farms, network, alerts | Grower-scoped data only |

**Chain of Command**:
- F.A.Y.E. is the senior agent. She has visibility into E.V.I.E.'s engagement metrics, costs, and performance.
- E.V.I.E. does not make business decisions. If a grower request has business implications (pricing, order changes, refunds), E.V.I.E. escalates to F.A.Y.E.
- F.A.Y.E. can adjust E.V.I.E.'s behavior parameters, update her knowledge base, and review her interaction quality.
- If E.V.I.E. detects a pattern across multiple growers (common complaints, recurring questions), she surfaces it to F.A.Y.E. as an operational insight.

---

## Current State: Phase 6 — Governed Autonomy

What exists today (v3.1.0):

- **Intelligence Loop**: 15-minute anomaly detection across 5 domains (payments, heartbeats, orders, accounting, transactions)
- **Learning Engine**: Persistent knowledge base (faye_knowledge), outcome tracking (faye_outcomes), pattern recognition (faye_patterns) with metadata history
- **Policy Engine**: Hard boundary enforcement, action-class trust model, shadow mode validation
- **Admin Tools**: 50+ tools spanning system health, accounting, orders, farm network, market intelligence, AI costs, delivery, subscriptions, ESG, email, and autonomy management
- **Trust Tiers**: AUTO / QUICK_CONFIRM / CONFIRM / ADMIN for write safety, governed by action classes
- **Decision Logging**: All tool calls logged to faye_decision_log
- **Alert Accuracy**: Per-domain false positive tracking
- **Confidence Calibration**: Insight confidence rises and falls based on outcomes; low-confidence insights auto-archive
- **Domain Ownership**: Level and confidence tracked independently per operational domain
- **Shadow Mode**: Proposed-vs-actual decision logging for promotion validation
- **Daily Briefing**: 7 AM email summary of overnight operations

---

## Autonomy Progression Framework

F.A.Y.E.'s autonomy grows through demonstrated competence. Trust is earned, not given.

### Action Classes

Trust attaches to **action types**, not just tools. A single tool can perform actions with very different risk profiles. The six action classes, in ascending risk order:

| Class | Description | Default Tier | Examples |
|---|---|---|---|
| recommend | Propose a course of action | auto | suggest classification, propose diagnosis |
| classify | Assign a category or label | quick_confirm | classify transaction, tag alert |
| notify | Internal alerts and summaries | auto | create alert, daily briefing |
| modify | Change system state | confirm | update farm notes, resolve alert |
| transact | Financial operations | admin | process refund, adjust pricing |
| override | Safety control overrides | admin | force-resolve, bypass confirmation |

### Policy Boundaries (Non-Negotiable)

These hard boundaries are enforced regardless of trust level, learning outcomes, or promotion status:

1. Never issue refunds automatically. All refunds require explicit admin confirmation.
2. Never change product pricing without explicit admin approval.
3. Never send external customer-facing communications without a human-reviewed template.
4. Never deactivate a farm or remove a buyer without admin confirmation.
5. Never expose API keys, tokens, or credentials in any response or log.

Hard boundaries set a ceiling that promotion cannot breach. `process_refund` is permanently capped at `admin` tier.

### Trust Tier Promotion

Promotion follows a rigorous validation process:

| Metric | Threshold | Effect |
|---|---|---|
| Action success rate > 95% over 50+ uses | Promotes CONFIRM -> AUTO | Execute without asking |
| Action success rate > 98% over 100+ uses | Promotes ADMIN -> CONFIRM | Reduces friction on high-impact actions |
| Domain false positive rate < 5% over 30 days | Domain alerts become trusted | Admin can opt into auto-resolve |
| 3 consecutive failed outcomes | Demotes one tier | Safety brake — regression loses trust |
| Hard boundary applies | Cannot promote past cap | Policy firewall |

**Promotion requirements:**
- Minimum sample size met (50 or 100 uses depending on tier)
- Rolling success rate over most recent 60 days (recency weighting)
- Shadow mode validation passes (proposed-vs-actual accuracy > 90%)
- 14-day probation window before promotion becomes permanent
- Admin can override any promotion or freeze a tool at a specific tier

### Shadow Mode

Before F.A.Y.E. executes actions automatically at a newly promoted tier, she runs in **shadow mode**: she logs what she WOULD have done without actually executing. The admin's actual decision is recorded alongside.

Shadow mode progression:
1. **Shadow**: Log proposed decisions, compare against admin choices
2. **Canary**: Execute on one farm or a small percentage of actions
3. **Full**: Execute across the domain with audit logging

Promotion becomes permanent only after shadow mode accuracy exceeds 90% over 14+ days.

### Autonomy Levels

| Level | Name | Description | Trigger |
|---|---|---|---|
| L0 | Reactive | Responds only when asked. | Default |
| L1 | Observant | Detects anomalies and surfaces them as alerts. | Intelligence loop (active) |
| L2 | Advisory | Proposes specific actions with confidence levels. | Pattern count >= 3 + knowledge base match |
| L2.5 | Shadow | Simulates decisions, logs proposed-vs-actual, does not execute. | Shadow mode enabled |
| L3 | Proactive | Executes AUTO-tier actions on detected issues, reports what was done. | Shadow accuracy > 90% + admin opt-in |
| L4 | Autonomous | Owns entire operational domains. Admin reviews daily briefing, not individual actions. | Domain exit criteria met |

L5 (Strategic) is defined as a future state: proposes business strategy changes, budget reallocations, and growth initiatives. The current engine is capped at L4 until strategy features are introduced in v3.3.

---

## Domain Ownership Matrix

F.A.Y.E. can own operational domains — she is responsible for monitoring, maintaining, and improving that domain without being asked. Ownership is earned through track record.

| Domain | Current Level | Target (v3.1) | Entry Criteria | Exit / Rollback |
|---|---|---|---|---|
| **Alert Triage** | L1 | L3 | FP rate < 5% over 30 days, 30+ resolved | FP rate > 10% over 7 days demotes to L1 |
| **Accounting Classification** | L0 | L2 | 95%+ accuracy over 50 classifications | 3 misclassifications in 7 days demotes to L0 |
| **Farm Health Monitoring** | L1 | L2 | 90%+ diagnosis accuracy over 20 incidents | Missed critical incident demotes to L1 |
| **Order Oversight** | L0 | L2 | Pattern library covers 80% of anomaly types | Undetected anomaly with revenue impact demotes to L0 |
| **Payment Processing** | L1 | L2 | 10+ successful root cause identifications | Incorrect root cause on critical payment demotes to L1 |
| **Network Management** | L0 | L1 | Baseline — first correlation analysis shipped | N/A at L1 |
| **E.V.I.E. Oversight** | L0 | L2 | Cost-per-interaction trending, quality scoring active | Future |
| **Market Intelligence** | L0 | L2 | Proactive trend alerts with confirmed accuracy | Future |

**Rollback rules:** Any domain demotion triggers a 30-day probation window. During probation, the domain cannot be re-promoted — F.A.Y.E. must rebuild the track record from scratch at the demoted level. Probation resets if another failure occurs during the window.

Ownership is tracked in `faye_knowledge` with domain = 'autonomy' and topic = 'domain_ownership:{domain}'.

---

## Self-Improvement Strategy

F.A.Y.E. does not just store data — she refines her own operations through structured feedback loops.

### Outcome Taxonomy

Every F.A.Y.E. recommendation or action receives a labeled outcome. The taxonomy is:

| Outcome | Who Labels | When | Meaning |
|---|---|---|---|
| positive | Admin or auto | Immediately after action | Correct action, desired result |
| negative | Admin | Immediately after action | Wrong action, wrong diagnosis, or harmful result |
| neutral | Auto | 48h timeout with no admin response | Admin did not engage — no signal either way |
| shadow | Auto | On every shadow-mode decision | Proposed-vs-actual comparison logged |
| fp_confirmed | Admin | On alert review | Alert was a false positive |
| fp_rejected | Admin | On alert review | Alert was a true positive |

**Labeling rules:**
- Admin-provided labels take priority over auto-labels.
- Neutral outcomes do NOT count toward promotion metrics (they are no-signal, not positive-signal).
- Shadow outcomes drive shadow-mode accuracy but do not affect trust tiers directly.
- Only positive and negative outcomes count toward trust tier promotion/demotion.

### Feedback Loops

1. **Outcome Loop**: Every recommendation or action gets a recorded outcome. Success rates (positive / (positive + negative)) drive trust promotion. 3 consecutive negative outcomes trigger demotion and insight review.

2. **Pattern Loop**: Recurring patterns (3+ occurrences) become knowledge base entries with timestamped history. Knowledge base entries with high confidence (>0.8) influence F.A.Y.E.'s recommendations directly through system prompt injection.

3. **Alert Accuracy Loop**: False positive tracking per domain feeds back into anomaly detection thresholds. If F.A.Y.E. learns that a certain alert type is noise, she adjusts her response (suppress, downgrade severity, or archive the pattern).

4. **Admin Correction Loop**: When an admin overrides F.A.Y.E.'s recommendation, that is a learning signal. The override is stored as a negative outcome with the admin's reasoning, updating future behavior.

5. **Shadow Accuracy Loop**: Shadow mode decisions are compared against actual admin choices. Match rate > 90% over 14+ days is the gate to promotion. Low match rate means F.A.Y.E.'s model of the domain is still miscalibrated.

### Confidence Calibration

- New insights start at confidence 0.5 (not higher — earned, not assumed)
- Confirmed by positive outcome: confidence can increase (exact amount depends on context, set by storeInsight)
- Contradicted by negative outcome: confidence decreases (the new value REPLACES the old — confidence can go down)
- Insights below 0.3 confidence are auto-archived
- Insights above 0.9 confidence are treated as operational rules
- Confidence and domain level are independent axes — a domain can be at L3 with confidence 0.6 (high autonomy, moderate certainty)

---

## Implementation Roadmap

### v3.0 — Proactive Operations (Shipped)

- [x] Vision document and roadmap
- [x] Autonomy progression rules in admin-ai-rules.json
- [x] Proactive system prompt (F.A.Y.E. proposes, not just responds)
- [x] Trust tier promotion logic in learning engine
- [x] Domain ownership tracking in knowledge base
- [x] E.V.I.E. hierarchy defined in rules and prompt

### v3.1 — Governed Autonomy (Current)

- [x] Policy engine above learning engine (faye-policy.js)
- [x] Action-class trust model (6 classes with default tiers and hard boundary caps)
- [x] Shadow mode framework (log proposed-vs-actual, track accuracy)
- [x] Hard boundaries (5 non-negotiable rules with max_tier caps)
- [x] Measurement layer bug fixes (confidence decay, domain FP rates, access_count, pattern history, level/confidence separation)
- [x] System prompt rewrite — governed operations intelligence language
- [x] Outcome taxonomy (positive, negative, neutral, shadow, fp_confirmed, fp_rejected)
- [x] Promotion validation against hard boundary caps
- [ ] Admin dashboard showing F.A.Y.E. autonomy levels per domain
- [ ] Weekly self-assessment report (what improved, what regressed)

### v3.2 — Domain Ownership

- [ ] Auto-resolve known alert patterns (L3 for Alert Triage via shadow mode validation)
- [ ] Batch classification proposals for unclassified transactions
- [ ] Cross-domain correlation (e.g., payment failures + farm health)
- [ ] Predictive alerts (anticipate issues before they happen)

### v3.3 — Strategic Intelligence

- [ ] L5 strategy features (budget optimization, growth initiative proposals)
- [ ] Market trend analysis driving pricing recommendations
- [ ] E.V.I.E. quality review and parameter adjustment
- [ ] Quarterly business review generation

---

## Lot System and Traceability Oversight

F.A.Y.E. owns the network-level view of the lot system. While E.V.I.E. handles individual farm harvest recording, F.A.Y.E. monitors traceability health, SFCR compliance readiness, quality trends across farms, and lot-to-order linkage for the wholesale pipeline.

### F.A.Y.E.'s Role in the Pipeline

| Responsibility | How F.A.Y.E. Handles It |
|----------------|------------------------|
| Traceability completeness | Monitors whether all active lots have seed_source, seed_lot, quality_score, and best_by_date populated. Surfaces gaps as medium-severity alerts. |
| Cross-farm quality analysis | Compares quality_score distributions across farms and crops. Detects if a specific crop is underperforming network-wide (pattern tracking via faye_patterns). |
| SFCR compliance readiness | Can run `GET /api/lots/:farmId/sfcr-export` across farms to verify export-ready data. Flags farms with incomplete traceability chains. |
| Expiring inventory | Queries lot_records + farm_inventory for lots approaching best_by_date with remaining stock. Creates alerts for lots within 3 days of expiry. |
| Lot recall coordination | When a lot needs recall, F.A.Y.E. identifies affected orders, generates the buyer notification list, and coordinates the recall (admin-tier action -- requires explicit approval). |
| Wholesale packing verification | `POST /api/lots/packing-slip` generates packing slips with lot traceability for each wholesale order. F.A.Y.E. can verify slips are generated before dispatch. |

### Network-Level Lot Workflow

```
Farm A harvests (E.V.I.E. records via POST /api/lots/harvest)
       |
       v
F.A.Y.E. intelligence loop (15-min cycle):
  -> checkAutoResolvePatterns(): auto-resolves known benign lot alerts
  -> Detects new lots, checks traceability completeness
  -> Flags expiring lots approaching best_by_date
  -> Tracks quality patterns across farms
       |
       v
F.A.Y.E. daily briefing:
  -> "3 new lots created yesterday. Farm A: 2 (Grade A, A). Farm B: 1 (Grade C -- below network avg)."
  -> "2 lots expire within 3 days: GREE-20260319-001 (4 lbs Buttercrunch), FARM-20260320-002 (2 lbs basil)."
  -> "SFCR export ready for Farm A. Farm B missing seed_source on 3 active lots."
```

### Admin Tools for Lot System

Tools available in ADMIN_TOOL_CATALOG for lot operations:

| Tool | Category | Trust Tier | Purpose |
|------|----------|-----------|---------|
| `run_security_audit` | read | recommend | Includes lot system auth and data integrity in security findings |
| `get_wholesale_overview` | read | auto | Shows order data that can be cross-referenced with lot records |

Future lot-specific tools (v3.2):
- `get_lot_traceability_report` -- Cross-farm lot health dashboard
- `initiate_lot_recall` -- Recall workflow with buyer notification (admin tier, hard boundary: requires explicit approval)
- `get_expiring_lots` -- Query lots within N days of best_by_date across all farms

### Lot System Database Schema

Migration 036 in `config/database.js` creates:
- `harvest_events` -- yield and quality data per harvest (links to planting_assignments via farm_id + group_id)
- `lot_records` -- unique lot_number per harvest with full seed-to-shelf chain (seed_source, seed_lot, seed_date, harvest_date, best_by_date, quality_score, weight_oz)
- Traceability columns on `planting_assignments` (seed_source, seed_lot) and `farm_inventory` (lot_number, quality_score, best_by_date, harvest_event_id)

### API Endpoints (routes/lot-system.js)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/lots/harvest` | authOrAdmin | Record harvest + create lot |
| GET | `/api/lots/:farmId` | authOrAdmin | List lots for a farm |
| GET | `/api/lots/:farmId/lot/:lotNumber` | authOrAdmin | Full lot traceability view |
| GET | `/api/lots/:farmId/harvest-events` | authOrAdmin | List harvest events |
| POST | `/api/lots/label` | authOrAdmin | Generate printable label |
| POST | `/api/lots/packing-slip` | authOrAdmin | Generate packing slip with lot data |
| GET | `/api/lots/:farmId/sfcr-export` | authOrAdmin | SFCR regulatory traceability export |

### Remaining Gaps (v3.2 Targets)

- **Lot-to-order forward linkage**: Wholesale orders store items in JSONB (`order_data`). Lot numbers should be attached to line items during order fulfillment, not just looked up in reverse at packing time.
- **QR code backend**: `LE-qr-generator.html` calls endpoints that do not exist. Server-side QR generation needed for lot labels.
- **Recall notification**: `emailService.sendRecallNotification()` is referenced but not implemented. Recall is a safety-critical path that needs implementation.
- **Auto-expire lots**: Lots past best_by_date should auto-transition from 'active' to 'expired' status. Currently requires manual intervention.

---

## Guiding Principles

1. **Earn trust, don't assume it.** Every autonomous action is built on a track record of correct decisions. No shortcuts.

2. **Policy above learning.** The learning engine suggests what F.A.Y.E. could do. The policy engine decides what she is allowed to do. Hard boundaries are non-negotiable.

3. **Transparency over opacity.** F.A.Y.E. always explains what she did and why. The admin can audit any decision at any time. Shadow mode logs everything.

4. **Measure before you automate.** No promotion without validated metrics. Neutral outcomes are not positive signal. Sample size minimums are enforced.

5. **Graceful degradation.** If confidence is low, F.A.Y.E. asks. If a system is down, she falls back to the last known state. She never guesses.

6. **The admin is the executive, not the operator.** F.A.Y.E.'s job is to make the admin's job smaller every week. The measure of success is how few things the admin has to manually handle.

7. **Learn from mistakes fast.** A single failure is a data point. A repeated failure is a bug. F.A.Y.E. logs, adjusts, and moves forward. But 3 consecutive failures trigger demotion — mistakes have consequences.

---

*F.A.Y.E. is the operational core of GreenReach Farms — a governed intelligence layer that earns autonomy through demonstrated competence.*
