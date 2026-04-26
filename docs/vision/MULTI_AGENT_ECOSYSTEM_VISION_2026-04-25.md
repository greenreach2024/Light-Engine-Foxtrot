# Multi-Agent Ecosystem & Future Vision — Light-Engine Foxtrot

**Status:** Vision / forward-looking knowledge doc
**Date:** 2026-04-25
**Audience:** Architecture, F.A.Y.E. operators, agent owners (E.V.I.E., G.W.E.N., S.C.O.T.T., Farm-Ops, Setup, Admin-Ops)
**Relationship to other docs:** This is a vision overlay. It does **not** replace the authoritative playbooks in `docs/playbooks/` or the canonical references in `.github/`. It cross-references vertical-farming research with the existing agent platform and identifies forward goals, skill expansions, and project-wide guardrails.

---

## 1. Context from vertical-farming research

Academic literature and recent industry reports show that indoor vertical farms are maturing but still face resource-intensive challenges. Findings most relevant to Foxtrot:

- **Resource efficiency & sustainability.** Vertical farms can use up to 98% less water than traditional farms and can be located near urban centres, reducing food-miles and spoilage. AI-driven precision agriculture systems can increase yields 15–20% while reducing overall investments 25–30% and decreasing fertilizer use by adapting to field conditions. Energy demand for lighting, HVAC and pumps remains a major barrier; sustainability depends heavily on the energy mix.
- **Automation & infrastructure.** Physical infrastructure must be stable, modular, and precise. Unstable racks and sensors cause "ghost data". High-density mobile racks with consistent sensor positioning improve canopy visibility and enable repeatable recipes. Modular infrastructure supports continuous upgrades without disruptive retrofits.
- **Energy & cost trade-offs.** Vertical farms require significant electricity for lights, climate control, and water circulation. Carbon-intensive grids erode environmental benefits. Upfront costs and data-privacy concerns hinder adoption by smaller farms.
- **AI/robotic integration.** Combining robotics and AI optimizes climate control, irrigation, lighting, and harvesting. Dyson's hybrid vertical farm integrates robotics and AI to produce strawberries year-round with minimal pesticide use.

These findings underline that **stable physical infrastructure, energy efficiency, precision control, and data governance** are central to successful vertical farms — and they should inform the design of Foxtrot's agents and future features.

---

## 2. Current agent ecosystem

The repository's playbooks (`docs/playbooks/02-ai-agent-platform.md`) and vision documents define a multi-agent platform where each agent occupies a distinct scope, audience, and authority. Summary of current agents and their design principles:

### F.A.Y.E. — Farm Autonomy & Yield Engine
- **Scope:** cross-farm operations & business decisions; network-level intelligence layer overseeing farm autonomy.
- **Skills/tools:** intelligence loop with learning + policy engines; trust tiers (`AUTO`, `QUICK_CONFIRM`, `CONFIRM`, `ADMIN`); decision logging; alert-accuracy tracking; shadow mode for simulation.
- **Governance:** never issues refunds or pricing changes without human approval, never sends external comms without review, never exposes credentials. Promotion/demotion based on success rates and false positives. Autonomy levels L0 (reactive) through L4 (autonomous), with future L5 (strategic) goal.

### E.V.I.E. — Environmental Vision & Intelligence Engine
- **Scope:** farm-facing assistant; ambient presence, grower support, public demos, tours, escalations.
- **Skills/tools:** guides growers through planting, environment monitoring, harvest workflows; surfaces approaching harvests, quality trends, traceability gaps. Interacts via UI components (orb animation, presence panel) and the Farm-Ops tool gateway.
- **Governance:** escalates cross-farm or business decisions to F.A.Y.E.; never crosses farm boundaries. Maintains nightly checklists (user workflows, sensor health, environment, recommendations) and KPIs (sensor uptime, recipe compliance, recommendation adoption, satisfaction).

### G.W.E.N. — Grants, Workplans, Evidence & Navigation (research)
- **Scope:** research bubble; assists PIs in designing and analysing experiments. Accessible only within the research platform.
- **Skills/tools:** recipe comparison, study design, grant proposals, literature summarisation, statistical analyses; uses tool loops; access to research endpoints.
- **Governance:** locked to research scope; refuses cross-bubble actions; escalates cross-scope tasks to F.A.Y.E.; enforces role gating (PI / Co-PI) and cross-institution sharing rules.

### S.C.O.T.T. — Social Content Optimization, Trends & Targeting
- **Scope:** marketing assistant; produces and schedules content across platforms; runs campaigns; will power per-farm storefront pages.
- **Skills/tools:** social post generation, multi-platform campaigns, compliance checks, skills registry (e.g., copy-to-video). Runs on Gemini 2.5 Flash.
- **Governance:** junior to F.A.Y.E.; marketing rules engine governs auto-approval vs escalation; prohibits cross-farm marketing without explicit permission.

### Farm-Ops Agent
- **Scope:** operational agent invoked through E.V.I.E.; handles daily to-do lists, environment alerts, VPD & irrigation control, tray lifecycle, schedule execution.
- **Skills/tools:** executes schedules, moves trays, prints labels, updates crop states. Implements crop-scheduling contract: when assigning a crop, fields `group.crop`, `group.recipe`, `group.plan` and `group.planId` must be stamped to enable scheduling.
- **Governance:** never modifies core schedule without anchor stamping; follows safety & tenancy rules; escalates unusual conditions to F.A.Y.E. or E.V.I.E.

### Setup-Agent & Admin-Ops-Agent
- **Scope:** assist in system setup and admin operations; invoked through E.V.I.E. (or admin UIs). Setup-Agent currently implements a 12-phase setup orchestrator; Admin-Ops handles platform-level runbooks, system health, revenue analysis, feature flags.
- **Governance:** subject to strict gating; all high-impact changes require admin confirmation.

These agents operate under the **AI-Agent Platform Playbook**, which defines interface contracts (`POST /chat`, `GET /status`, `GET /state`), trust tiers, tool gateways, memory models, cost tracking, and escalation paths. The **Agent Skills Framework** emphasises investigation-first development, multi-agent collaboration (Implementation / Review / Architecture roles), strong domain knowledge, and explicit checklists for safe deployment. Violations of this framework (e.g., skipping investigation or ignoring domain models) are considered serious incidents.

---

## 3. Cross-referencing research with project docs

### 3.1 Infrastructure & sensor stability
Industry research stresses stable, modular infrastructure: mechanical instability creates "ghost data" and undermines AI decision-making. F.A.Y.E. and Farm-Ops already emphasise sensor uptime; further hardware standards should be defined.

- Adopt standardized rack designs with minimal vibration; mount sensors on adjustable rails to maintain alignment.
- Integrate regular sensor calibration routines into E.V.I.E.'s nightly checklist.
- Extend F.A.Y.E.'s self-improvement loop with hardware diagnostics and anomaly detection (sensor drift, mechanical noise).
- Use G.W.E.N. to investigate optimal sensor placements and sample rates in the research bubble before scaling to farms.

### 3.2 Energy efficiency & sustainability
Environmental benefits are constrained by high energy consumption; sustainability depends on the electricity mix. F.A.Y.E.'s autonomy roadmap should incorporate energy optimisation.

- Integrate a **power-aware scheduler** that schedules lighting, HVAC and pumps based on real-time electricity prices, carbon intensity and weather forecasts. Indoor farms can act as demand-response aggregators, generating new revenue.
- Add F.A.Y.E. business KPIs for **energy per kilogram yield** and **carbon intensity per harvest**.
- G.W.E.N. tasks: explore on-site solar, battery storage; evaluate trade-offs between LED spectra, crop quality, and energy use.

### 3.3 Water & nutrient efficiency
Vertical farms use significantly less water, but nutrient cycling and water quality remain critical. E.V.I.E. and Farm-Ops should support real-time nutrient monitoring and dynamic fertigation. Research can evaluate aeroponics or mist-based systems for further reductions.

### 3.4 Data security & privacy
As farms become data-rich, privacy and cybersecurity become first-class concerns. The playbooks already specify role-based access, multi-tenant isolation, policy boundaries, and rule-based guardrails. Additional measures:

- End-to-end encryption for sensor streams.
- Zero-trust network architecture.
- Continuous monitoring for anomalies / intrusion attempts.
- Formal privacy risk assessments when adding new sensors or data pipelines.

---

## 4. Forward-looking goals for agents

### 4.1 F.A.Y.E. (network-level autonomy)
- **Evolve to L5 strategic autonomy.** Currently capped at L4. Progress to L5 by learning from aggregated farm data to propose strategic actions (facility expansion, energy procurement, optimized crop portfolios). Requires SOTA RL/MA algorithms and integration of external data (energy markets, weather, labour rates).
- **Energy-aware scheduling.** Modules that monitor real-time electricity prices and carbon intensity, aligning high-energy tasks with low-cost / low-carbon periods. Demand-response participation where permitted.
- **Continuous self-improvement.** Nightly checklist should include hardware diagnostics, model-drift analysis, and cross-agent feedback loops.
- **Policy enforcement.** Maintain non-negotiable boundaries (no refunds or price changes without approval). Add rules for energy-consumption thresholds and data-privacy requirements.
- **Cross-farm learning.** Use anonymised data across farms to derive best practices while respecting data isolation. G.W.E.N. coordinates cross-farm experiments with explicit owner consent.

### 4.2 E.V.I.E. (farm-facing assistant)
- **Contextual coaching & gamification.** Suggest lighting adjustments when E.V.I.E. detects low PPFD or high VPD; encourage data entry and best-practice adoption via micro-credentialing.
- **Real-time sensor calibration.** Prompt growers to calibrate or replace sensors when anomalies are detected.
- **Enhanced visualisations.** Dynamic charts of VPD, DLI, energy use, and yield in the E.V.I.E. UI.
- **Voice & multilingual support.** Improve accessibility.
- **Escalation refinements.** Differentiate local (farm) from network (business) decisions; integrate F.A.Y.E. decisions and G.W.E.N. research updates into daily recommendations.

### 4.3 G.W.E.N. (research agent)
- **Experimental simulation & digital twins.** Run digital-twin simulations using historical farm data; evaluate lighting spectra, nutrient regimens, and energy strategies; compare yield, energy, cost outcomes.
- **Cross-institution collaboration.** Secure sharing of anonymised data; strong access controls; cross-institution boundaries.
- **Knowledge base with semantic search.** Papers, datasets, prior experiments; embeddings for semantic search and summarisation.
- **Grant-writing enhancements.** Integrate external funding databases; incorporate vertical-farming market trends.
- **Statistical & AI toolkit.** Built-in statistical tests, A/B-testing modules, RL simulation frameworks.

### 4.4 S.C.O.T.T. (marketing agent)
- **Personalised content** driven by farm data (harvest times, varieties); highlight sustainability metrics (water savings, local production) to consumers.
- **Compliance & brand safety.** AI content filters aligned with F.A.Y.E.'s policy engine; avoid greenwashing by using accurate sustainability data.
- **E-commerce integration.** When per-farm storefronts launch, S.C.O.T.T. handles inventory, dynamic pricing (with F.A.Y.E. approval), and targeted promotions.
- **A/B testing.** Multivariate testing for posts; auto-generate variations and measure engagement.

### 4.5 Farm-Ops & crop scheduling
- **Dynamic scheduling.** Extend the crop-scheduling contract to incorporate F.A.Y.E. and G.W.E.N. predictions: schedule high-lighting crops when energy is cheap; adapt to predicted pest outbreaks; adjust planting densities to expected market demand.
- **Robotics integration.** As conveyors / pick-and-place robots are added, Farm-Ops coordinates tasks and notifies E.V.I.E. when human intervention is required.
- **Scheduling tools.** Gantt-chart interface, scenario planning.
- **Alert rationalisation.** ML-based reduction of false alerts; track alert accuracy as a F.A.Y.E. metric.

### 4.6 Setup & Admin-Ops
- **Guided onboarding.** Step-by-step flows for adding devices, sensors, energy sources, security policies via E.V.I.E. as front-end.
- **Audit & compliance.** Periodic audits, role management, cost/usage metrics tracking.

---

## 5. Skills, tools & rules summary

See [`docs/ai-agents/AGENT_SKILLS_INDEX_2026-04-25.md`](../ai-agents/AGENT_SKILLS_INDEX_2026-04-25.md) for the full per-agent table of current and proposed skills, tools, and guardrails.

---

## 6. Project-wide guardrails

See [`.github/AGENT_GUARDRAILS.md`](../../.github/AGENT_GUARDRAILS.md) for the layered guardrail policy combining LLM classifiers, rules-based filters, tool safeguards, moderation, output validation, human-in-the-loop, privacy/security, monitoring, transparency, and graceful degradation.

---

## 7. Development & deployment process

The Agent Skills Framework (`.github/AGENT_SKILLS_FRAMEWORK.md`) emphasises a rigorous development lifecycle. To deploy new multi-agent features:

1. **Investigation-first.** Before coding, the Implementation Agent thoroughly explores the codebase, database schema, and domain model; builds a plan referencing relevant docs.
2. **Proposal & review.** Detailed proposal with reasoning and specific changes. The Review Agent checks for safety, alignment, correct DB-model use, cross-agent considerations.
3. **Implementation & tests.** Modular, well-documented code with unit/integration tests. Stubs for new tools.
4. **Architecture review.** Architecture Agent ensures consistency, separation of concerns, scalability.
5. **Guardrail integration.** Build or update guardrails alongside new features (layered defense).
6. **Simulation & shadow mode.** Run new agents/tools in a shadow environment using F.A.Y.E. / E.V.I.E. simulation modes — no production effect.
7. **Monitoring & feedback.** After deployment, continuously monitor metrics, user feedback, and guardrail triggers. Use G.W.E.N. to analyse experimental data and propose improvements.

---

## 8. Conclusion & recommendations

Vertical-farming research underscores that Foxtrot's success hinges on **precision infrastructure, energy & water efficiency, stable data streams, and responsible AI integration.** The existing multi-agent architecture provides a strong foundation — clear separation of scope, trust models, and guardrails. To achieve the future vision:

- **Extend F.A.Y.E.** to a strategic, energy-aware orchestrator integrating demand-response and digital-twin simulations.
- **Enhance E.V.I.E.** with richer coaching, sensor calibration, and interactive visualisations while keeping a farm-scoped boundary.
- **Empower G.W.E.N.** to conduct advanced research via digital twins, cross-institution collaboration, and semantic knowledge bases.
- **Upgrade S.C.O.T.T.** to deliver personalised, data-driven marketing that highlights sustainability metrics and ties into e-commerce.
- **Modernise Farm-Ops scheduling** to leverage predictive models, robotics, and energy optimisation.
- **Embed robust guardrails** and follow the Agent Skills Framework to ensure safety, reliability, and compliance.

By aligning multi-agent development with the latest research and best practices, Light-Engine Foxtrot can deliver a pioneering, sustainable platform that scales across farms while respecting data privacy, resource constraints, and human oversight.
