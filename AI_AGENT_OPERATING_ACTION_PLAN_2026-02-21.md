> **SUPERSEDED** — This action plan has been consolidated into [IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md](IMPLEMENTATION_PLAN_AI_GROWTH_2026-02-21.md). Retained for reference only.

# AI Agent Operating Action Plan (Seed-to-Table)

Date: 2026-02-21  
Branch context: recovery/feb11-clean  
Mission: food security through efficient seed-to-table management, with growers in control and automation reducing manual burden.

## 1) What the current system already has

### Platform strengths observed
- Central control-plane pattern is present and documented: GreenReach Central aggregates farm data and runs multi-farm operations.
- Strong edge data capture already exists: environmental readings, harvest logs, tray lifecycle, quality/traceability, inventory, and sync channels.
- AI foundations exist: AI agent, anomaly detection, forecasting, recommendation pathways, and sync/push infrastructure.
- Wholesale and logistics components already exist: farm selection optimizer, market-intelligence routes, wholesale notification workflows.

### Structural gaps observed
- Learning loops are incomplete in many places: lots of data captured, but limited closed-loop model improvement.
- Revenue-critical areas are partially stubbed or in-memory in key places (e.g., lead CRM route, some market data/static sources, partial comparative analytics).
- Duplicate UI/code structures and deployment drift still create execution risk and slower iteration.
- Marketing conversion infrastructure is not yet fully systematized despite strong technical backend.

## 2) What is required for the business to sell, learn, and improve

### A. Required operating layers
1. Data Trust Layer (must be first)
- Canonical event schema across edge + central for: grow cycle, harvest, loss, order, delivery, payout, customer interaction.
- Immutable event ledger for decisions and outcomes (agent actions included).
- Data quality score per farm/site (completeness, latency, consistency).

2. Learning Layer
- Outcome-linked model training loops (weekly retrain cadence minimum).
- Baseline and champion/challenger models for forecasting, recommendations, and logistics.
- Feature store per domain: crop, environment, fulfillment, customer demand, operations.

3. Decision Layer
- Human-in-the-loop for high-risk decisions (finance, compliance, customer commitments, farm closure/acquisition).
- Policy engine for constraints (DPWRA/payroll rules, food safety, traceability, customer SLA).
- Explainability summaries attached to each recommendation/action.

4. Execution Layer
- Agent orchestration with role-scoped permissions and approval workflows.
- Automatic action routing to existing APIs/routes and service modules.
- Real-time monitoring and rollback controls.

### B. Core business outcome metrics
- Fill rate by customer segment.
- On-time in-full (OTIF) for delivery.
- Contribution margin by crop/SKU/farm/channel.
- Loss rate (pre-harvest and post-harvest).
- Forecast error (demand and harvest windows).
- Labor minutes per kg harvested and fulfilled.
- User-input reduction (manual fields removed per workflow).

## 3) AI agent management model (Admin, Payroll, Marketing)

### Agent classes
1. Admin Ops Agent
- Scope: cross-farm alerts triage, SLA risk, route exceptions, policy checks.
- Actions: summarize incidents, recommend interventions, draft ops directives.
- Guardrails: no autonomous high-impact action without human approval.

2. Payroll & Settlement Agent
- Scope: payout reconciliation, exception holds, policy compliance.
- Actions: prepare payout statements, detect anomalies, flag policy violations.
- Guardrails: no direct disbursement or reversal without dual approval.

3. Marketing Growth Agent (zero-funding mode)
- Scope: lead intake, outreach sequencing, website SEO/content, conversion analytics.
- Actions: create campaigns, score leads, generate outreach copy, schedule follow-ups.
- Guardrails: brand and claims policy checks, opt-in/consent enforcement.

4. Product Deployment Agent
- Scope: new Light Engine rollout, install readiness, release notes, adoption telemetry.
- Actions: preflight checks, deployment plans, post-install health analysis.
- Guardrails: staged rollout gates and rollback policies.

5. Strategy & Viability Agent
- Scope: closure risk, acquisition opportunity scoring, capex/opex scenarios.
- Actions: produce scenario models, synergy estimates, risk-adjusted recommendations.
- Guardrails: board-level review required before execution.

## 4) No-funding startup marketing operating system

### Objectives (first 90 days)
- Build trust and distribution with near-zero paid spend.
- Turn product telemetry + customer outcomes into content and lead magnets.
- Build a repeatable founder-led outbound + referral engine.

### Required stack (low cost)
- CRM: use existing lead capture + persistent DB backing (remove in-memory bottleneck).
- Content engine: weekly case studies from real farm outcomes and fulfillment metrics.
- Channel mix:
  - Email newsletter (weekly)
  - LinkedIn founder posts (3/week)
  - SEO pages for high-intent queries (2/week)
  - Direct outreach to anchor buyers and farm partners
- Automation:
  - Triggered sequences by lead behavior.
  - Agent-generated first drafts for pages, emails, and playbooks.

### Minimum growth KPIs
- Visitor-to-lead conversion.
- Lead-to-demo conversion.
- Demo-to-pilot conversion.
- Pilot-to-paid conversion.
- CAC (target near-zero paid CAC initially).

## 5) AI agents for new Light Engine deployment and feature evolution

### Deployment lifecycle automation
1. Site qualification
- Agent scores site readiness: network, power, staffing, crop plan, compliance baseline.

2. Provisioning
- Agent orchestrates config templates, tenant setup, role/user setup, and baseline recipes.

3. Installation and validation
- Preflight checks, device discovery, sensor validation, sync verification.

4. Hypercare (first 30 days)
- Daily anomaly triage, recipe adaptation recommendations, onboarding nudges.

5. Continuous improvement
- Weekly optimization cycles from outcomes (yield, losses, reliability, labor).

### Feature introduction framework
- Champion/challenger rollout by farm cohort.
- Feature flags with auto rollback on KPI degradation.
- Release acceptance gates:
  - data quality threshold
  - reliability threshold
  - user-friction threshold

## 6) Farm closure viability and acquisition evaluation

### Closure viability model (agent-assisted)
Required dimensions:
- Unit economics: gross margin, labor efficiency, energy intensity, logistics cost.
- Reliability: downtime, quality incidents, fulfillment miss rates.
- Market strength: local demand depth, buyer concentration risk, churn risk.
- Capital reality: runway, debt pressure, equipment age, maintenance burden.
- People factors: operator capability, workflow adherence, training gaps.

Output:
- Traffic-light risk score (green/yellow/red).
- 3 scenario options: stabilize, consolidate, or close.
- 30/60/90-day intervention plan with expected KPI impact.

### Acquisition evaluation model
Required dimensions:
- Strategic fit with seed-to-table network coverage.
- Data compatibility and integration effort.
- Supply/demand adjacency and logistics synergies.
- Operational uplift potential from automation layer.
- Compliance and traceability maturity.

Output:
- Synergy scorecard (revenue + cost + risk).
- Integration playbook and timeline.
- Deal/no-deal recommendation with confidence and assumptions.

## 7) Behavior science requirements (prevent stagnation, promote evolution)

### Principles to embed
- Reduce cognitive load: default choices, progressive disclosure, one-click workflows.
- Make desired behavior easier than non-compliance.
- Use immediate feedback loops and visible progress cues.
- Reward completion and consistency (streaks, reliability score, team KPIs).
- Escalate only meaningful alerts (alert-fatigue controls).

### Product patterns
- “Ask once, infer thereafter” data collection.
- QR-first operations to remove manual typing.
- Intent-aware forms with auto-fill and anomaly prompts.
- Role-specific copilots (operator, manager, finance, growth).

## 8) Current-structure action plan (execution)

### Phase 0 (0–14 days): Foundation lock-in
- Establish canonical event taxonomy and data contracts.
- Convert critical in-memory stores to durable stores where needed (leads/ops signals).
- Define agent permission matrix and human-approval tiers.
- Stand up KPI dashboards for the seven core business outcomes.

### Phase 1 (15–45 days): Agent MVPs in production support
- Launch Admin Ops Agent and Payroll Agent in recommendation mode.
- Launch Marketing Agent for content + outreach automation.
- Instrument all agent actions in audit logs.
- Deploy weekly model retrain and evaluation pipelines.

### Phase 2 (46–90 days): Closed-loop optimization
- Enable constrained autonomous actions for low-risk workflows.
- Deploy deployment agent for new-site onboarding and preflight automation.
- Add viability/acquisition scorecards for strategic planning.
- Run A/B tests on workflow simplification and user-input reduction.

### Phase 3 (91–180 days): Scale and governance
- Multi-farm benchmarking and dynamic policy tuning.
- Champion/challenger model governance.
- Formal AI risk and compliance review cadence.
- Expand to country-level food security operating templates.

## 9) Governance requirements (non-negotiable)
- Human-in-the-loop for high-impact financial/compliance/contract decisions.
- Per-agent action scopes and revocation controls.
- Full auditability (who/what/why/when/data snapshot).
- Data retention and privacy policy by jurisdiction.
- Incident response playbook for model drift or harmful recommendations.

## 10) “Tested until ready” proposal validation

This proposal is considered review-ready when all checks below are true:

1. Coverage check
- Admin, payroll, marketing, deployment, feature rollout, closure viability, acquisition viability all explicitly mapped.

2. Architecture fit check
- Plan aligns with current Central/edge split and existing route/service patterns.

3. Data feasibility check
- Every required model has identified data inputs from current collection pathways.

4. Execution realism check
- Phased timeline with owner-ready work packages (0–14, 15–45, 46–90, 91–180 days).

5. Safety check
- Human approval and audit controls included for high-risk actions.

Status: PASS (review-ready, strategy level).  
Next step: convert this plan into implementation tickets and assign owners.

---

## Appendix: Immediate backlog (first 20 tickets)
1. Event taxonomy v1 (seed-to-table).
2. Agent permission matrix + approval tiers.
3. Lead capture persistence (replace volatile path).
4. Marketing funnel event instrumentation.
5. Weekly KPI dashboard scaffold.
6. Admin Ops Agent prompt + tool routing.
7. Payroll reconciliation agent prompt + rulebook.
8. Marketing content generation workflow.
9. Outreach sequencing workflow.
10. Deployment preflight checklist automation.
11. Site-readiness scoring model v1.
12. Feature flag + rollback policy templates.
13. Model registry and retraining job skeleton.
14. Champion/challenger evaluation pipeline.
15. Alert prioritization model (reduce noise).
16. Closure viability scorecard template.
17. Acquisition synergy scorecard template.
18. Data quality scoring per farm.
19. Compliance evidence export for audits.
20. Monthly governance review cadence and report template.
