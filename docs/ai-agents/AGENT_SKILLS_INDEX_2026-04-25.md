# Agent Skills Index — Current & Proposed

**Status:** Reference index (skills surface area)
**Date:** 2026-04-25
**Companion docs:** [`docs/vision/MULTI_AGENT_ECOSYSTEM_VISION_2026-04-25.md`](../vision/MULTI_AGENT_ECOSYSTEM_VISION_2026-04-25.md), [`.github/AGENT_GUARDRAILS.md`](../../.github/AGENT_GUARDRAILS.md), [`docs/playbooks/02-ai-agent-platform.md`](../playbooks/02-ai-agent-platform.md)

This index summarises each agent's **current** and **proposed** skills/tools alongside their **rules and guardrails**. It is the discoverability surface for the agent skill set — not a replacement for the per-agent playbooks or the guardrails policy.

---

## F.A.Y.E. — Farm Autonomy & Yield Engine

**Current skills & tools**
- Learning engine, policy engine, trust tiers (`AUTO`, `QUICK_CONFIRM`, `CONFIRM`, `ADMIN`).
- Decision logs, alert-accuracy tracking, shadow-mode simulation.
- Connectors to finance / inventory; network-level scheduling; admin tools.

**Proposed skills & tools**
- RL & demand-response algorithms.
- Energy-aware scheduler (real-time prices, carbon intensity, weather).
- Digital-twin simulation.
- Anomaly detection (sensor drift, mechanical noise, model drift).
- Cross-farm analytics with strict isolation.
- External integrations: energy markets, weather APIs, labour-rate sources.

**Rules & guardrails**
- No refunds or pricing changes automatically.
- No external communications without review.
- No credential exposure.
- Follow trust-tier thresholds; maintain shadow mode for new behaviors.
- Abide by legal/regulatory requirements; ensure data privacy across farms.

---

## E.V.I.E. — Environmental Vision & Intelligence Engine

**Current skills & tools**
- Chat interface; environment monitoring; harvest & lot workflow support; recommendation engine.
- UI components: orb animation, presence panel.
- Daily checklists and KPIs (sensor uptime, recipe compliance, recommendation adoption, satisfaction).

**Proposed skills & tools**
- Voice & multilingual support.
- Sensor calibration prompts triggered by anomaly detection.
- Gamified user tasks and micro-credentialing.
- Dynamic charts (VPD, DLI, energy use, yield).
- Integration with F.A.Y.E.'s energy scheduler.
- Digital-twin visualisations.

**Rules & guardrails**
- Farm-scoped only; cannot access other farms.
- Escalates cross-farm actions to F.A.Y.E.
- Cannot make financial transactions.
- Must adhere to local regulatory and safety rules.

---

## G.W.E.N. — Grants, Workplans, Evidence & Navigation

**Current skills & tools**
- Research assistant: experiment design, recipe comparison, literature summarisation, grant proposals.
- Looped tools and research endpoints; bubble-scoped.

**Proposed skills & tools**
- Digital-twin simulation using historical farm data.
- Cross-institution data sharing (with explicit agreements).
- Semantic knowledge base with embeddings + summarisation.
- Statistical & AI toolkit (tests, A/B testing, RL simulation).
- External funding-database access for grant writing.

**Rules & guardrails**
- Locked to research bubble; cannot modify production data.
- Refuses actions outside research scope.
- Role gating (PI / Co-PI).
- Cross-institution sharing requires explicit agreements.
- Escalates cross-scope tasks to F.A.Y.E.

---

## S.C.O.T.T. — Social Content Optimization, Trends & Targeting

**Current skills & tools**
- Social-post generation; compliance checks; multi-platform publishing.
- Marketing rules engine; skills registry; runs on Gemini 2.5 Flash.

**Proposed skills & tools**
- Personalised content using farm data (harvest times, varieties).
- Per-farm storefront integration.
- A/B testing (multivariate post variations).
- Dynamic pricing with F.A.Y.E. approval.
- Analytics dashboard.
- Voiceover generation and video editing.

**Rules & guardrails**
- Marketing scope only; junior to F.A.Y.E.
- Cross-farm marketing requires explicit permission.
- Must comply with brand guidelines and legal advertising standards.
- Uses safety filters to avoid harmful content.

---

## Farm-Ops & Crop Scheduling Agent

**Current skills & tools**
- Executes crop schedules; moves trays; prints labels; monitors environment.
- Ensures `group.crop`, `group.recipe`, `group.plan`, `group.planId` are stamped on crop assignment.

**Proposed skills & tools**
- Integration with energy-aware scheduling (F.A.Y.E.).
- Dynamic planting densities driven by demand forecasts.
- Robotics coordination (conveyors, pick-and-place).
- Scenario planning tools and Gantt-chart UI.
- Real-time alerts and anomaly detection.
- REST API for third-party robotics.
- Digital-twin integration.

**Rules & guardrails**
- Cannot override anchor stamping.
- Cannot assign new crops without correct metadata.
- Must follow safety & tenant rules.
- Escalates unusual conditions to E.V.I.E. or F.A.Y.E.
- Prohibits cross-farm modifications.

---

## Setup-Agent & Admin-Ops-Agent

**Current skills & tools**
- 12-phase setup orchestrator (Setup-Agent); template-aware room design; build-plan computation.
- Platform-level runbooks, system health, revenue analysis, feature flags (Admin-Ops).

**Proposed skills & tools**
- Wizard-style onboarding for devices, sensors, energy sources, security policies.
- Policy & security dashboard.
- Integrated auditing and compliance tracking.
- Cost and energy usage reporting.

**Rules & guardrails**
- High-impact actions require explicit admin confirmation.
- Cannot bypass F.A.Y.E.'s policies.
- Must ensure strong authentication & authorisation.
- Must abide by data-privacy laws.

---

## Cross-cutting requirements

Every agent in this index must comply with the layered guardrails defined in [`.github/AGENT_GUARDRAILS.md`](../../.github/AGENT_GUARDRAILS.md):

1. Relevance & safety classifiers
2. Rules-based filters
3. Tool safeguards (trust tiers)
4. Moderation & PII filters
5. Output validation (anchor stamps, schemas, brand checks)
6. Human-in-the-loop for non-negotiable actions
7. Privacy & security (multi-tenant isolation, encryption)
8. Monitoring & feedback loops
9. Transparency & explainability (decision rationale + audit trail)
10. Graceful degradation (defer to humans on uncertainty; shadow mode for new behaviors)
