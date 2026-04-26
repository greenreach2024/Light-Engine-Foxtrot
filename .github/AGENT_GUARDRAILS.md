# Project-Wide Agent Guardrails

**Status:** Authoritative policy
**Last updated:** 2026-04-25
**Applies to:** F.A.Y.E., E.V.I.E., G.W.E.N., S.C.O.T.T., Farm-Ops-Agent, Setup-Agent, Admin-Ops-Agent, and any future agent introduced into Foxtrot.

This document defines the **layered guardrail policy** that all agents in Foxtrot must implement. Existing playbooks (`docs/playbooks/02-ai-agent-platform.md`) define per-agent boundaries; this file defines the cross-cutting safeguards every agent inherits. Treat any deviation as a serious incident and escalate to F.A.Y.E. or a platform admin.

---

## 1. Layered guardrails (defense in depth)

To ensure safe and trustworthy multi-agent deployment, combine **LLM-based classifiers, rules-based filters, and human oversight**. Each layer is required — a single missing layer is treated as a regression.

### 1.1 Relevance & safety classifiers
- Filter inputs and outputs for prompt injection, harmful content, or off-scope tasks.
- Use fine-tuned classifiers in combination with heuristic checks. Do **not** rely on a single model.

### 1.2 Rules-based filters
- Apply regex / pattern matching to block sensitive data (PII, credentials, API keys).
- Prohibit disallowed actions (refunds, cross-farm modifications, external comms without review).

### 1.3 Tool safeguards
- Every tool declares a **trust tier**: `no_confirm`, `quick_confirm`, `explicit_confirm`, or `admin_only` (see `docs/playbooks/02-ai-agent-platform.md` §4.2).
- Risky tools (transactions, external comms, credential access) require **higher trust tiers** and admin JWT.
- Tool catalog (`GET /tool-catalog`) is the single source of truth for what an agent can do; runtime tool calls outside the catalog are rejected.

### 1.4 Moderation & PII filters
- Use moderation APIs and PII detection on all outputs before the user (or downstream system) sees them.
- Sanitize logs before persistence.

### 1.5 Output validation
- Validate every output with deterministic checks:
  - Schedule assignments must include the **anchor stamps** `group.crop`, `group.recipe`, `group.plan`, `group.planId`.
  - Marketing copy must pass brand-guideline + compliance checks.
  - JSON tool responses must match declared schemas.
- Validation failures **never** silently degrade — they raise to the next trust tier or escalate.

### 1.6 Human-in-the-loop
The following decisions **always** require human approval, regardless of trust tier:

- Price changes
- Refunds
- Cross-farm changes
- Major schedule modifications
- External communications (email, SMS, social posts beyond pre-approved templates)

### 1.7 Privacy & security
- Multi-tenant isolation enforced at the database (RLS) and application layer.
- Least-privilege access for every agent role.
- End-to-end encryption for sensor streams.
- Continuous anomaly / intrusion monitoring.
- Periodic privacy risk assessments when adding new sensors or data pipelines.

### 1.8 Monitoring & feedback loops
- Track per-agent metrics: accuracy, false-positive rate, energy-per-yield (where applicable), user satisfaction, guardrail trigger counts.
- Feed metrics back into trust-tier promotion / demotion. F.A.Y.E. can demote any agent whose metrics regress.

### 1.9 Transparency & explainability
- Every agent **records the rationale** for consequential decisions.
- Provide explainer summaries to operators and researchers to build trust.
- Audit trail (`GET /audit-log`) is non-negotiable.

### 1.10 Graceful degradation
- When uncertain or when a guardrail triggers, agents **defer to humans** rather than produce risky actions.
- New features run in **shadow mode** before being promoted to production authority. Shadow mode logs decisions without executing them.

---

## 2. Non-negotiable boundaries (per agent)

These are the hard rules. They cannot be relaxed by configuration, prompt, or trust-tier promotion.

| Agent | Non-negotiables |
|---|---|
| **F.A.Y.E.** | No refunds or pricing changes automatically. No external communications without review. No credential exposure. Must follow trust-tier thresholds. Must maintain shadow mode for new behaviors. Must abide by legal / regulatory requirements. Must ensure data privacy across farms. |
| **E.V.I.E.** | Farm-scoped only — cannot access other farms. Escalates cross-farm actions to F.A.Y.E. Cannot execute financial transactions. Must adhere to local regulatory and safety rules. |
| **G.W.E.N.** | Locked to research bubble. Cannot modify production data. Refuses actions outside research scope. Role gating (PI / Co-PI). Cross-institution sharing requires explicit agreements. Escalates cross-scope tasks to F.A.Y.E. |
| **S.C.O.T.T.** | Marketing scope only; junior to F.A.Y.E. Cross-farm marketing requires explicit permission. Must comply with brand guidelines and legal advertising standards. Uses safety filters to avoid harmful content. |
| **Farm-Ops-Agent** | Cannot override anchor stamping. Cannot assign new crops without correct metadata (`group.crop`, `group.recipe`, `group.plan`, `group.planId`). Must follow safety & tenant rules. Escalates unusual conditions to E.V.I.E. or F.A.Y.E. Prohibits cross-farm modifications. |
| **Setup-Agent / Admin-Ops** | High-impact actions require explicit admin confirmation. Cannot bypass F.A.Y.E.'s policies. Must ensure strong authentication & authorisation. Must abide by data-privacy laws. |

---

## 3. Process guardrails (development lifecycle)

The Agent Skills Framework (`.github/AGENT_SKILLS_FRAMEWORK.md`) defines the lifecycle. Process-level guardrails:

1. **Investigation-first** before coding. Skipping investigation = serious incident.
2. **Proposal & review.** Implementation agent writes a proposal; Review agent checks for safety, alignment, DB-model correctness, and cross-agent impact.
3. **Architecture review** for any change touching service boundaries, contracts, or data flows.
4. **Guardrails ship with features.** A feature without its guardrails is incomplete and must not merge.
5. **Shadow mode then production.** New agent behavior runs in shadow mode until metrics meet promotion thresholds.
6. **Continuous monitoring** post-deploy; metric regressions trigger automatic demotion.

---

## 4. Incident handling

If a guardrail triggers a severe event (e.g., agent attempts a non-negotiable action, leakage of PII, cross-farm boundary violation):

1. **Halt** the agent action immediately.
2. **Log** the full request, response, tool call, and rationale.
3. **Notify** F.A.Y.E. (if scoped) or platform admin.
4. **Demote** the agent's trust tier until root cause is understood.
5. **Document** in `.github/bypass-log.md` or a dedicated incident audit doc.
6. **Patch** the guardrail (rule, classifier, or schema) before re-promotion.

---

## 5. References

- `docs/playbooks/02-ai-agent-platform.md` — agent contracts, trust tiers, tool gateway.
- `.github/AGENT_SKILLS_FRAMEWORK.md` — investigation-first development lifecycle.
- `.github/ENFORCEMENT_MECHANISMS.md` — runtime enforcement details.
- `docs/playbooks/01-security-multi-tenant.md` — RLS, tenancy, feature gates.
- `docs/vision/MULTI_AGENT_ECOSYSTEM_VISION_2026-04-25.md` — forward-looking vision and rationale.
- `docs/ai-agents/AGENT_SKILLS_INDEX_2026-04-25.md` — per-agent skills and tools index.
