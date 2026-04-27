---
name: evie-agent-development
description: Use this skill when implementing, debugging, or extending E.V.I.E. (Environmental Vision & Intelligence Engine), including farm-scoped guidance, chat/tool behavior, presence UX, and escalation to F.A.Y.E.
---

# E.V.I.E. Agent Development Skill

## Use this skill when
- A change touches E.V.I.E. chat, presence, or farm guidance UX.
- You are adding/changing E.V.I.E. tools or recommendation flows.
- You are modifying escalation conditions from E.V.I.E. to F.A.Y.E.
- You are changing farm-scoped AI behavior, confidence handling, or nightly notes.

## Core identity and constraints
- E.V.I.E. is farm-scoped (single-farm context only).
- E.V.I.E. is grower-facing: calm, explanatory, useful, uncertainty-aware.
- E.V.I.E. cannot make business-wide or financial decisions.
- Cross-farm or business-impact requests must escalate to F.A.Y.E.

Read first:
1. `greenreach-central/EVIE_VISION.md`
2. `docs/playbooks/02-ai-agent-platform.md`
3. `.github/AGENT_GUARDRAILS.md`
4. `greenreach-central/routes/assistant-chat.js`

## File map (edit targets)
- Agent backend: `greenreach-central/routes/assistant-chat.js`
- Tool gateway and execution: `greenreach-central/routes/farm-ops-agent.js`
- Presence/client scripts: `greenreach-central/public/js/evie-presence.js`, `greenreach-central/public/js/farm-assistant.js`
- Presence styles/pages: `greenreach-central/public/styles/evie-core.css`, `greenreach-central/public/evie-core.html`
- Enforcement middleware: `greenreach-central/middleware/agent-enforcement.js`

## Standard change workflow
1. **Confirm scope**
   - Ensure request is single-farm and farm-authenticated.
2. **Select execution path**
   - Advice-only response vs tool call via Farm-Ops gateway.
3. **Apply authority boundaries**
   - Financial/pricing/network actions must escalate.
4. **Handle uncertainty explicitly**
   - Low confidence => clarify, ask follow-up, or escalate; never fabricate.
5. **Preserve UX identity**
   - Keep tone calm/explanatory; avoid F.A.Y.E.-style strategic voice.

## Tooling rules for E.V.I.E. changes
- All consequential actions route through registered tools with schemas.
- Respect confirmation tiers and avoid bypassing tool safeguards.
- Preserve tenant isolation (`farm_id`) through auth + data access paths.

## Minimum validation checklist
- Endpoint health still works:
  - `GET /api/assistant-chat/status`
  - `GET /api/assistant-chat/state`
- Safety behavior still works:
  - Cross-farm or pricing/refund requests escalate/refuse.
- Tool behavior still works:
  - Tool calls are logged and scoped to authenticated farm.
- UX behavior still works:
  - Presence states render and chat interaction remains functional.

## Done criteria
- Farm-only scope preserved.
- Escalation triggers remain reliable and explicit.
- No regressions in guardrails, tool auditing, or presence UX.
- Any material behavior changes reflected in playbook/vision docs.
