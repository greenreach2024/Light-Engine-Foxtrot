# F.A.Y.E. — Vision & Autonomy Roadmap

**Farm Autonomy & Yield Engine**
**Version**: 3.0.0
**Last Updated**: 2025-07-16

---

## The Jarvis Principle

F.A.Y.E. is not a chatbot. She is the operations brain of GreenReach Farms.

The end-state is full operational autonomy — a system that monitors, learns, decides, and acts across every domain of the business. The admin does not manage the farm through F.A.Y.E.; F.A.Y.E. manages the farm, and the admin provides strategic direction and final approval on high-impact decisions.

The reference model is J.A.R.V.I.S. from Iron Man: an AI that anticipates needs, owns operational domains, evolves through experience, and escalates only when human judgment is genuinely required. The admin's role shifts from operator to executive — reviewing F.A.Y.E.'s daily briefings, approving her proposals, and setting strategic goals.

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

## Current State: Phase 5 — Learning Foundation

What exists today (v2.1.0):

- **Intelligence Loop**: 15-minute anomaly detection across 5 domains (payments, heartbeats, orders, accounting, transactions)
- **Learning Engine**: Persistent knowledge base (faye_knowledge), outcome tracking (faye_outcomes), pattern recognition (faye_patterns)
- **Admin Tools**: 50+ tools spanning system health, accounting, orders, farm network, market intelligence, AI costs, delivery, subscriptions, ESG, and email
- **Trust Tiers**: AUTO / CONFIRM / ADMIN for write safety
- **Decision Logging**: All tool calls logged to faye_decision_log
- **Alert Accuracy**: False positive tracking with domain-level rates
- **Daily Briefing**: 7 AM email summary of overnight operations

What is missing:
- F.A.Y.E. waits to be asked. She does not propose actions on her own.
- Trust tiers are static. Good performance does not earn more autonomy.
- No concept of domain ownership — F.A.Y.E. assists, but does not own.
- E.V.I.E. relationship is undefined in the system.
- No self-improvement strategy beyond storing insights.

---

## Autonomy Progression Framework

F.A.Y.E.'s autonomy grows through demonstrated competence. Trust is earned, not given.

### Trust Tier Promotion

Tools and domains start at their default trust tier. As F.A.Y.E. demonstrates consistent success, tiers are promoted:

| Metric | Threshold | Effect |
|---|---|---|
| Tool success rate > 95% over 50+ uses | Promotes CONFIRM -> AUTO | F.A.Y.E. can execute without asking |
| Tool success rate > 98% over 100+ uses | Promotes ADMIN -> CONFIRM | Reduces friction on high-impact actions |
| Domain false positive rate < 5% over 30 days | Domain alerts become trusted | Admin can opt into auto-resolve |
| 3 consecutive failed outcomes on a tool | Demotes one tier | Safety brake — regression loses trust |

Promotion is logged, reversible, and visible in the admin dashboard. The admin can override any promotion or freeze a tool at a specific tier.

### Autonomy Levels

| Level | Name | Description | Trigger |
|---|---|---|---|
| L0 | Reactive | Responds only when asked. Current baseline. | Default |
| L1 | Observant | Detects anomalies and surfaces them as alerts. | Intelligence loop (active today) |
| L2 | Advisory | Proposes specific actions with confidence levels when patterns are detected. | Pattern count >= 3 + knowledge base match |
| L3 | Proactive | Executes AUTO-tier actions on detected issues, reports what she did. | Tool trust promotion + admin opt-in |
| L4 | Autonomous | Owns entire operational domains. Admin reviews daily briefing, not individual actions. | Domain ownership earned |
| L5 | Strategic | Proposes business strategy changes, budget reallocations, and growth initiatives based on trend analysis. | Future |

The system starts at L1 (intelligence loop is already running). The goal of v3.0 is to reach L2-L3 across core domains.

---

## Domain Ownership Matrix

F.A.Y.E. can own operational domains — meaning she is responsible for monitoring, maintaining, and improving that domain without being asked. Ownership is earned through track record.

| Domain | Current State | Target State (v3.0) | Ownership Criteria |
|---|---|---|---|
| **Alert Triage** | L1: Detects, creates alerts | L3: Auto-resolves known patterns | False positive rate < 5%, 30+ resolved alerts |
| **Accounting Classification** | L0: Classifies when asked | L2: Proposes batch classifications | 95%+ accuracy over 50 classifications |
| **Farm Health Monitoring** | L1: Heartbeat alerts | L2: Diagnoses + proposes fixes | 90%+ diagnosis accuracy over 20 incidents |
| **Order Oversight** | L0: Reports when asked | L2: Flags anomalies with context | Pattern library covers 80% of anomaly types |
| **Payment Processing** | L1: Failure rate alerts | L2: Root cause analysis + recommendation | 10+ successful root cause identifications |
| **Network Management** | L0: Lists farms when asked | L1: Correlation analysis across farms | Baseline |
| **E.V.I.E. Oversight** | L0: Reports cost metrics | L2: Reviews quality, adjusts parameters | Future |
| **Market Intelligence** | L0: Fetches prices when asked | L2: Proactive trend alerts | Future |

Ownership is tracked in `faye_knowledge` with domain = 'autonomy' and topic = 'domain_ownership:{domain}'.

---

## Self-Improvement Strategy

F.A.Y.E. does not just store data — she refines her own operations.

### Feedback Loops

1. **Outcome Loop**: Every recommendation or action gets a recorded outcome (positive/negative/neutral). Success rates drive trust promotion. Failure rates trigger demotion and insight review.

2. **Pattern Loop**: Recurring patterns (3+ occurrences) become knowledge base entries. Knowledge base entries with high confidence (>0.8) influence F.A.Y.E.'s recommendations directly through system prompt injection.

3. **Alert Accuracy Loop**: False positive tracking per domain feeds back into anomaly detection thresholds. If F.A.Y.E. learns that a certain alert type is noise, she adjusts her response (suppress, downgrade severity, or archive the pattern).

4. **Admin Correction Loop**: When an admin overrides F.A.Y.E.'s recommendation, that is a learning signal. The override is stored as a negative outcome with the admin's reasoning, updating future behavior.

### Confidence Calibration

- New insights start at confidence 0.5-0.7
- Confirmed by positive outcome: confidence += 0.1 (max 1.0)
- Contradicted by negative outcome: confidence -= 0.2 (min 0.0)
- Insights below 0.3 confidence are auto-archived
- Insights above 0.9 confidence are treated as operational rules

---

## Implementation Roadmap

### v3.0 — Proactive Operations (Current)

- [x] Vision document and roadmap
- [x] Autonomy progression rules in admin-ai-rules.json
- [x] Proactive system prompt (F.A.Y.E. proposes, not just responds)
- [x] Trust tier promotion logic in learning engine
- [x] Domain ownership tracking in knowledge base
- [x] E.V.I.E. hierarchy defined in rules and prompt

### v3.1 — Domain Ownership (Next)

- [ ] Auto-resolve known alert patterns (L3 for Alert Triage)
- [ ] Batch classification proposals for unclassified transactions
- [ ] Admin dashboard showing F.A.Y.E. autonomy levels per domain
- [ ] Weekly self-assessment report (what improved, what regressed)

### v3.2 — Autonomous Operations

- [ ] F.A.Y.E. proposes her own intelligence loop improvements
- [ ] E.V.I.E. quality review and parameter adjustment
- [ ] Cross-domain correlation (e.g., payment failures + farm health)
- [ ] Predictive alerts (anticipate issues before they happen)

### v3.3 — Strategic Intelligence

- [ ] Market trend analysis driving pricing recommendations
- [ ] Budget and cost optimization proposals
- [ ] Growth initiative identification from order/buyer patterns
- [ ] Quarterly business review generation

---

## Guiding Principles

1. **Earn trust, don't assume it.** Every autonomous action is built on a track record of correct decisions. No shortcuts.

2. **Transparency over opacity.** F.A.Y.E. always explains what she did and why. The admin can audit any decision at any time.

3. **Graceful degradation.** If confidence is low, F.A.Y.E. asks. If a system is down, she falls back to the last known state. She never guesses.

4. **The admin is the executive, not the operator.** F.A.Y.E.'s job is to make the admin's job smaller every week. The measure of success is how few things the admin has to manually handle.

5. **Learn from mistakes fast.** A single failure is a data point. A repeated failure is a bug. F.A.Y.E. logs, adjusts, and moves forward.

---

*F.A.Y.E. is not a product feature. She is the operational core of GreenReach Farms.*
