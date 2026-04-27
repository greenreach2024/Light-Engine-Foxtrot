---
name: gwen-agent-development
description: Use this skill when implementing, debugging, or extending G.W.E.N. (Grants, Workplans, Evidence & Navigation), especially research-bubble tools, governance, sharing agreements, and research workspace agent behavior.
---

# G.W.E.N. Agent Development Skill

## Use this skill when
- A change touches `greenreach-central/routes/gwen-research-agent.js`.
- You are adding/modifying research assistant tools (grants, studies, ELN, recipe analysis).
- You are changing research governance, sharing, or role-gated workflows.
- You are enabling or modifying `execute_code` behavior.

## Core identity and constraints
- G.W.E.N. is the research-bubble agent (not a production operations agent).
- G.W.E.N. must refuse actions outside research scope.
- Cross-scope requests escalate to F.A.Y.E.
- Research sharing requires explicit agreements; production data mutation is out of scope.

Read first:
1. `docs/playbooks/06-research.md`
2. `docs/playbooks/02-ai-agent-platform.md`
3. `.github/AGENT_GUARDRAILS.md`
4. `greenreach-central/routes/gwen-research-agent.js`

## File map (edit targets)
- Agent backend: `greenreach-central/routes/gwen-research-agent.js`
- Research tenancy enforcement: `greenreach-central/middleware/research-tenant.js`
- Shared tool execution path: `greenreach-central/routes/farm-ops-agent.js` (`executeTool` integration)
- Research APIs: `greenreach-central/routes/research-*.js`
- Research UI surface: `greenreach-central/public/gwen-core.html`, `greenreach-central/public/views/research-workspace.html`

## Standard change workflow
1. **Confirm research scope**
   - Reject any task that alters production business state.
2. **Validate governance path**
   - Check role requirements (PI/Co-PI/signoff gates) and artifact mutability.
3. **Enforce tenancy + ownership**
   - Parent-resource ownership must be verified for nested resources.
4. **Apply sharing controls**
   - Exports and cross-institution access require valid agreement rows.
5. **Gate advanced execution**
   - `execute_code` remains feature-flagged and explicitly opt-in.

## Tooling rules for G.W.E.N. changes
- Keep tool-loop limits bounded; do not increase to mask prompt defects.
- Preserve low-confidence behavior: uncertainty must be surfaced, not guessed.
- Maintain auditability of tool usage and governance actions.

## Minimum validation checklist
- Endpoint health still works:
  - `GET /api/gwen/status`
  - `GET /api/gwen/workspace`
- Scope behavior still works:
  - Out-of-bubble requests are refused/escalated.
- Governance behavior still works:
  - Role-gated actions enforce PI/Co-PI/signoff constraints.
- Sharing behavior still works:
  - Cross-institution export paths enforce `research_sharing_agreements`.

## Done criteria
- Research-bubble lock remains intact.
- Tenancy and ownership checks preserved for all touched endpoints.
- `execute_code` remains safe and intentionally gated.
- Documentation/playbooks updated when agent capability boundaries change.
