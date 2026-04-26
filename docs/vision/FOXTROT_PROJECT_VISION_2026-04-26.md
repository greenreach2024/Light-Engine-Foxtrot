# Foxtrot Project Vision (Independent): AI Agents, Automation, and ML

_Date: April 26, 2026_

## 0) Foxtrot Review Snapshot

Based on current repository architecture and documentation, Foxtrot already has strong building blocks:

- Dual-service architecture separating farm runtime and central operations.
- Existing assistant surfaces (E.V.I.E., F.A.Y.E., G.W.E.N.) to anchor agent UX.
- Broad domain coverage across farm ops, billing, wholesale, research, and monitoring.

Primary gaps to address for the next generation:

- Agent responsibility boundaries are not yet formalized as a multi-agent operating model.
- Automation maturity is uneven and needs explicit autonomy staging.
- ML needs a clearer path from prediction to policy-safe execution impact.
- Unified reasoning/audit trails must become mandatory for trust and governance.

---

## 1) Executive Vision

Foxtrot should evolve from a software platform that **monitors and assists operations** into an **autonomous farm intelligence operating system** that can plan, recommend, simulate, and execute closed-loop actions with transparent guardrails.

The north star is:

> **Every farm decision is data-informed, policy-safe, economically aware, and incrementally automatable.**

This vision is intentionally independent from existing implementation constraints and proposes a strategic direction for the next 24 months.

---

## 2) Strategic Outcome

By the end of the vision horizon, Foxtrot should be able to:

1. Operate a multi-agent system where specialized agents collaborate across cultivation, inventory, energy, labor, and sales.
2. Automate repeatable operational workflows end-to-end with deterministic policy enforcement and human approval checkpoints.
3. Use ML models to forecast outcomes (yield, disease risk, demand, utility costs), optimize recipes, and prioritize interventions.
4. Learn continuously from execution outcomes, reducing variance and improving gross margin per square foot.

---

## 3) Product Principles

### P1. Human-in-the-loop by default, human-out-of-loop by confidence
Automation should graduate through explicit autonomy levels. No critical operation becomes fully autonomous without measurable reliability and rollback plans.

### P2. Explainability is a product feature
Every recommendation and action must include reason traces: source signals, model confidence, constraints, and expected impact.

### P3. Safety and policy constraints are first-class
Agent behavior must be bounded by farm-specific safety, regulatory, operational, and financial policies.

### P4. Economic optimization over technical novelty
The primary KPI is business performance (waste reduction, labor efficiency, cycle time, margin), not model complexity.

### P5. Modular intelligence
Prefer composable domain agents and narrow models over one monolithic “general farm AI.”

---

## 4) Independent Vision Architecture

## 4.1 Multi-Agent Layer (Decision Intelligence)

Define a coordinated set of agents with clear responsibilities:

- **Cultivation Agent**: crop-stage decisions, recipe adjustments, anomaly triage.
- **Climate Agent**: temperature/humidity/VPD balancing with energy-aware constraints.
- **Supply Agent**: seed, nutrient, consumables planning and replenishment.
- **Operations Agent**: labor routing, checklist orchestration, task scheduling.
- **Revenue Agent**: demand forecast, harvest timing, wholesale commitment planning.
- **Compliance Agent**: policy checks, audit trace generation, exception escalation.

A shared planner and policy engine should arbitrate cross-agent conflicts.

## 4.2 Automation Layer (Execution System)

Introduce an automation runtime with:

- Event-driven triggers (sensor threshold, schedule, forecast shifts, order spikes).
- Reusable workflow templates (diagnose, verify, approve, execute, validate).
- Idempotent action design and outbox-style delivery guarantees.
- Simulation mode (dry-run) before live execution for high-impact workflows.

## 4.3 ML Layer (Prediction and Optimization)

Prioritize practical model families:

- Time-series forecasting for environmental drift, demand, and utility costs.
- Classification models for anomaly severity and intervention urgency.
- Optimization models for recipe tuning and harvest scheduling.
- Recommendation models for crop mix and channel allocation.

All models should publish confidence, expected error bounds, and retraining metadata.

## 4.4 Data Layer (Ground Truth)

Build toward a canonical feature and event model:

- Unified event schema for sensors, actions, task outcomes, and commercial signals.
- Feature store for reusable online/offline model inputs.
- Evaluation datasets with clear labels and drift monitoring.
- Experiment tracking for model, prompt, and policy variants.

---

## 5) Autonomy Maturity Model

Foxtrot should track and label automation using five levels:

- **A0 – Observe:** dashboard-only insights.
- **A1 – Recommend:** prioritized suggestions with reasoning.
- **A2 – Assisted Execute:** one-click human approval.
- **A3 – Guardrailed Auto:** automatic execution within bounded policies.
- **A4 – Strategic Auto:** multi-step autonomous plans with periodic human review.

Each workflow must explicitly declare current and target autonomy level.

---

## 6) Core Use Cases to Win

1. **Closed-loop climate correction:** detect trend drift, propose correction, execute safe adjustments, verify recovery.
2. **Predictive yield risk management:** identify underperforming zones early and route corrective tasks.
3. **Demand-aware harvest planning:** align grow cycles with forecasted demand and order commitments.
4. **Inventory and procurement autonomy:** prevent stockouts and overbuy through dynamic replenishment.
5. **Quality incident response:** detect anomalies, contain risk, launch standardized response workflow.

---

## 7) Operating Metrics (North-Star Scorecard)

### Outcome KPIs
- Yield variance reduction
- Crop loss / waste reduction
- Labor hours per harvested pound
- Energy cost per production unit
- On-time order fulfillment
- Gross margin per square foot

### Intelligence KPIs
- Recommendation acceptance rate
- Automation completion success rate
- Mean time to detect and remediate anomalies
- False positive / false negative rates for alerts
- Forecast accuracy by horizon and crop class

### Trust KPIs
- Explainability coverage (% of actions with reason trace)
- Policy violation rate
- Safe rollback success rate
- Human override frequency (and reason taxonomy)

---

## 8) Governance, Risk, and Safety

1. **Policy engine first:** no execution path bypasses policy checks.
2. **Tiered approvals:** critical actions require role-based authorization.
3. **Auditability by design:** immutable decision/action ledger for every agent action.
4. **Shadow mode for launches:** all new autonomous flows start in recommendation-only mode.
5. **Drift and degradation controls:** auto-demote autonomy if model confidence or reliability deteriorates.

---

## 9) 3-Phase Delivery Roadmap

## Phase I (0–6 months): Foundation + Assisted Intelligence
- Standardize event schema and telemetry quality gates.
- Launch reason-trace format for all recommendations.
- Deploy A1 recommendations for climate, inventory, and scheduling.
- Implement workflow runtime with A2 approval steps.

## Phase II (6–12 months): Guardrailed Automation
- Promote qualified workflows to A3 with policy envelopes.
- Add model monitoring (drift, calibration, business impact).
- Release demand-aware harvest and procurement automation.
- Introduce simulator-based preflight checks for high-impact actions.

## Phase III (12–24 months): Coordinated Agentic Operations
- Enable shared planner for multi-agent coordination.
- Deploy strategic A4 plans for weekly farm operating cycles.
- Add economic optimization across yield, labor, and energy dimensions.
- Mature continuous learning loop from post-execution outcomes.

---

## 10) Build vs. Buy Guidance

- **Build in-house:** policy engine, farm domain workflows, reason trace format, audit ledger, farm ontology.
- **Buy/partner:** commodity model hosting, baseline forecasting infrastructure, observability tooling.
- **Hybrid:** planner stack and agent orchestration where internal policy hooks are mandatory.

---

## 11) Organizational Implications

To execute this vision, Foxtrot should operate with a cross-functional “autonomy pod” model:

- Product lead (outcomes + UX trust)
- Automation engineer (workflow runtime)
- ML engineer (model lifecycle)
- Applied AI engineer (agent behavior + prompt/tooling)
- Domain agronomy operator (ground-truth validation)
- Reliability/security engineer (guardrails + controls)

---

## 12) Definition of Success (24-month)

Foxtrot succeeds when farms can confidently run daily operations through a blended model of agent recommendations and guardrailed automation, where:

- most repeatable workflows are at A3+, 
- high-impact planning is AI-assisted with measurable forecast gains,
- and economic outcomes improve quarter over quarter with traceable causal links to intelligent automation.

In short: **Foxtrot becomes the operating intelligence layer for scalable, reliable, and profitable controlled-environment agriculture.**
