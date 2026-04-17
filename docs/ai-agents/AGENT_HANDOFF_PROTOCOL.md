# Agent Handoff Protocol

This document defines the minimum contract required when one GreenReach agent hands a task, recommendation, or pending action to another agent or to a human operator.

## Purpose

The handoff protocol exists to stop silent context loss between EVIE, FAYE, GWEN, operational automations, and human review queues. A valid handoff must preserve objective, evidence, limits, and rollback expectations.

## Required Envelope

Every handoff payload must include the following fields:

- `handoff_id`: stable unique identifier for the handoff event
- `created_at`: ISO-8601 timestamp for when the handoff was created
- `source_agent`: originating agent or service name
- `target_agent`: intended receiving agent, service, or human queue
- `farm_id`: farm scope when applicable; use `network` only for cross-farm intelligence
- `objective`: concise statement of what the receiver is expected to accomplish
- `requested_outcome`: human-readable description of the desired end state
- `outcome_type`: value from the outcome taxonomy in `OUTCOME_TAXONOMY.md`
- `decision_tier`: `observe`, `recommend`, `require-approval`, or `blocked`
- `inputs`: structured list of source datasets, routes, files, or events used to form the handoff
- `assumptions`: explicit assumptions that may invalidate the handoff if wrong
- `constraints`: guardrails, policy limits, farm rules, or deployment limits that still apply
- `risk_flags`: known failure modes, missing data, or safety concerns
- `rollback_plan`: how to reverse or neutralize the action if it degrades outcomes
- `success_checks`: concrete validation steps the receiver must satisfy before closing the handoff
- `artifacts`: links or identifiers for logs, reports, plans, patches, or dashboards created so far
- `open_questions`: unanswered questions blocking confident completion
- `expires_at`: optional timestamp after which the handoff should be treated as stale

## Handoff States

- `draft`: still being assembled; not safe to execute
- `ready`: context complete; safe for receiver review
- `accepted`: receiver has taken responsibility
- `superseded`: replaced by a newer handoff
- `closed`: outcome delivered and verified
- `abandoned`: intentionally dropped with reason recorded

## Minimum Rules

- No side-effecting handoff may omit `decision_tier`, `risk_flags`, or `rollback_plan`.
- No recommendation may be promoted to execution unless `success_checks` are defined.
- Cross-agent handoffs must preserve raw evidence references, not just summaries.
- If farm scope is unclear, the handoff must remain `draft` or `blocked`.
- If the receiver changes the requested outcome, it must emit a new handoff rather than mutating the original intent silently.
- A receiver may reject a handoff if required fields are missing or if the outcome type conflicts with the declared decision tier.

## Human Review Requirements

The following cases require explicit human acceptance before the handoff may move to execution:

- any change that modifies recipes, pricing, inventory, or customer-facing commitments
- any recommendation based on degraded, stale, or incomplete telemetry
- any action with no documented rollback path
- any network-level recommendation that will be applied to a single farm automatically

## Example Handoff

```json
{
  "handoff_id": "evie-2026-04-17-001",
  "created_at": "2026-04-17T19:32:00Z",
  "source_agent": "evie",
  "target_agent": "farm-ops-review",
  "farm_id": "light-engine-demo",
  "objective": "Review humidity correction recommendation for Room A before operator approval.",
  "requested_outcome": "Decide whether to adopt the recommended humidity reduction action.",
  "outcome_type": "recommendation",
  "decision_tier": "require-approval",
  "inputs": [
    "/api/ai-insights/light-engine-demo",
    "/api/losses/predict",
    "/api/harvest/readiness"
  ],
  "assumptions": [
    "Room A telemetry is current within the last 15 minutes."
  ],
  "constraints": [
    "Do not change recipe targets automatically.",
    "Respect farm-specific humidity safety bounds."
  ],
  "risk_flags": [
    "Loss prediction is heuristic, not model-backed."
  ],
  "rollback_plan": "Restore the previous humidity setpoint if conditions worsen over two monitoring cycles.",
  "success_checks": [
    "Humidity trend moves back inside target range.",
    "No new high-risk loss alerts appear."
  ],
  "artifacts": [
    "dashboard-ai-signals",
    "evie-insight-2026-04-17T19:31:55Z"
  ],
  "open_questions": [],
  "expires_at": "2026-04-17T23:32:00Z",
  "state": "ready"
}
```