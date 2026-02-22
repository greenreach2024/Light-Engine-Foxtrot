# Tomorrow TODOs

## Priority
- Explore **Developer Mode** in Farm Assistant.
- Define user-facing flow: Light Engine users submit update requests in plain language.
- Define agent workflow: triage request → impact analysis → proposed change plan → safety checks → approval gate → implementation.
- Design cross-update execution model so agents can apply coordinated changes across UI, API, automation rules, and docs.

## Required Guardrails
- Human approval required before any production-impacting code/config changes.
- Tenant/farm isolation and permission checks for all agent actions.
- Full audit trail: request, analysis, files changed, tests run, approval, deployment status.
- Rollback strategy and automatic failure recovery for bad updates.

## MVP Deliverables
- Developer Mode spec (roles, permissions, workflow states).
- Request schema + API endpoint draft for update submissions.
- Agent evaluation checklist (risk, blast radius, dependencies, tests).
- Pilot implementation plan for one low-risk update category.
