# Outcome Taxonomy

This taxonomy standardizes how GreenReach agents describe what kind of result they are producing. The goal is to keep EVIE, FAYE, GWEN, and automation services aligned on what is being observed, recommended, proposed, or executed.

## Outcome Types

| Outcome Type | Meaning | Side Effects Allowed | Human Approval | Audit Required |
|---|---|---|---|---|
| `observation` | reports current state or telemetry without judgment | no | no | recommended |
| `diagnosis` | explains likely causes or correlations behind observed conditions | no | no | recommended |
| `recommendation` | proposes an operator action or next step | no direct side effect | no for display, yes for acceptance-to-action | yes |
| `comparison` | contrasts options, recipes, benchmarks, or strategies | no | no | recommended |
| `plan` | sequences multiple steps toward an outcome | no | no | yes if operational |
| `proposal` | defines a specific change package intended for approval | no direct side effect | yes | yes |
| `simulation` | predicts likely outcomes under hypothetical conditions | no | no | recommended |
| `execution_safe` | performs a reversible, pre-approved action within guardrails | yes, bounded | only if farm policy requires it | yes |
| `execution_approval_required` | action is technically possible but must wait for human approval | no until approved | yes | yes |
| `blocked` | cannot proceed because context, evidence, or authorization is insufficient | no | no | yes |

## Decision Tier Mapping

| Decision Tier | Allowed Outcome Types |
|---|---|
| `observe` | `observation`, `diagnosis`, `comparison`, `simulation` |
| `recommend` | `recommendation`, `plan` |
| `require-approval` | `proposal`, `execution_approval_required` |
| `blocked` | `blocked` |

## Classification Rules

- If an agent is only surfacing data, use `observation`.
- If the agent explains why something is happening, use `diagnosis`.
- If the agent tells an operator what should be done next, use `recommendation`.
- If the agent assembles a sequenced response across systems or teams, use `plan`.
- If the agent packages a concrete change for approval, use `proposal`.
- If code, settings, recipes, or operational state would change immediately, use either `execution_safe` or `execution_approval_required`.
- If the agent lacks enough confidence, authority, or data freshness to proceed, use `blocked`.

## Required Metadata By Outcome Type

- `observation`: source, timestamp, scope
- `diagnosis`: source, timestamp, assumptions, confidence
- `recommendation`: source, confidence, expected impact, rollback plan
- `comparison`: alternatives, comparison basis, confidence
- `plan`: dependencies, order of operations, validation steps
- `proposal`: target surface, change summary, risks, rollback plan
- `simulation`: model or heuristic basis, assumptions, forecast horizon
- `execution_safe`: guardrails, rollback plan, post-checks, audit event id
- `execution_approval_required`: approval owner, pending action, audit event id
- `blocked`: blocker reason, missing evidence, next unblock step

## Examples

- EVIE showing current loss risk by zone: `observation`
- EVIE explaining that humidity drift likely caused a higher loss score: `diagnosis`
- EVIE telling the operator to lower humidity in Room A: `recommendation`
- GWEN outlining a staged experiment program: `plan`
- FAYE packaging a network-derived recipe update for farm approval: `proposal`
- An autonomous modifier applying a pre-approved bounded adjustment: `execution_safe`
- Any recipe or pricing change awaiting operator consent: `execution_approval_required`
- A suggestion produced while telemetry freshness is unknown: `blocked`