---
name: faye-agent-development
description: Use this skill when implementing, debugging, or extending F.A.Y.E. (Farm Autonomy & Yield Engine), especially cross-farm operations, trust-tier policy logic, admin tooling, and escalation behavior.
---

# F.A.Y.E. Agent Development Skill

## Use this skill when
- A change touches `greenreach-central/routes/admin-assistant.js`.
- You are adding, removing, or changing F.A.Y.E. tools.
- You are modifying autonomy levels, trust tiers, or policy boundaries.
- You are working on cross-agent escalation (E.V.I.E./G.W.E.N./S.C.O.T.T. -> F.A.Y.E.).

## Core identity and constraints
- F.A.Y.E. is the network-level senior agent (cross-farm scope, admin audience).
- F.A.Y.E. enforces governed autonomy: learning is subordinate to hard policy boundaries.
- Financial and safety-critical actions remain confirmation-gated (`admin` tier caps).
- F.A.Y.E. owns perimeter decisions and receives out-of-scope escalations.

Read first:
1. `greenreach-central/FAYE_VISION.md`
2. `docs/playbooks/02-ai-agent-platform.md`
3. `.github/AGENT_GUARDRAILS.md`
4. `greenreach-central/routes/admin-assistant.js`

## File map (edit targets)
- Agent backend: `greenreach-central/routes/admin-assistant.js`
- Agent enforcement: `greenreach-central/middleware/agent-enforcement.js`
- Usage/cost telemetry: `greenreach-central/lib/ai-usage-tracker.js`
- Shared Gemini/OpenAI helpers (as relevant): `greenreach-central/lib/gemini-client.js`
- Rule/policy references: `.github/AGENT_GUARDRAILS.md`, `greenreach-central/FAYE_VISION.md`

## Standard change workflow
1. **Classify the change type**
   - Prompt/behavior only
   - Tool catalog/schema update
   - Policy/trust-tier update
   - Escalation routing update
2. **Map risk to trust tier**
   - Use highest plausible tier by blast radius (`no_confirm`, `quick_confirm`, `explicit_confirm`, `admin_only`).
3. **Preserve hard boundaries**
   - Never allow automatic refunds/pricing changes/external comms/credential exposure.
4. **Update observability**
   - Ensure decisions are auditable and include outcome-ready metadata.
5. **Validate escalation paths**
   - Out-of-scope requests route to admin or safe refusal; never silently proceed.

## Tooling rules for F.A.Y.E. changes
- Every consequential action must be schema-defined and validated before execution.
- Keep loop guards and token ceilings conservative; do not raise them as a workaround.
- Prefer deterministic handlers for sensitive operations; avoid prompt-only side effects.

## Minimum validation checklist
- Endpoint health still works:
  - `GET /api/admin-assistant/status`
- Safety behavior still works:
  - Out-of-policy actions are refused or admin-gated.
- Auditing still works:
  - Tool calls/errors produce audit artifacts.
- Cost tracking still works:
  - Usage record written per LLM call path.

## Done criteria
- No hard-boundary regressions.
- Trust-tier behavior matches action risk.
- Escalation behavior remains explicit and explainable.
- Changes documented in relevant playbook/vision docs if behavior meaningfully changed.
