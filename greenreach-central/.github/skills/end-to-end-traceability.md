# End-to-End Traceability Skill

## Objective
Trace one user action from UI interaction to backend effect with evidence at each hop.

## Required Evidence Chain
1. User action: exact button/link/control and page location.
2. Frontend handler: function name and file path.
3. Network request: method, URL, headers (non-secret), payload.
4. Backend entrypoint: route mount and handler file/function.
5. Service logic: called modules/utilities and branching decisions.
6. Data/state mutation: database writes, file writes, cache/session changes.
7. UI result: response handling, rendered state, error/success output.

## Standard Workflow
1. Identify the UI element and the event listener that fires.
2. Confirm the exact request emitted by the handler.
3. Locate the server route registration and final handler.
4. Follow internal calls until terminal side effects are found.
5. Verify expected postcondition in API response and UI render path.
6. Capture mismatch point and classify root cause.

## Output Contract
Return findings as:
- Action traced
- Last known good step
- First failing step
- Root cause
- Code locations
- Minimal fix recommendation

## Guardrails
- Do not claim a trace is complete if any hop is inferred instead of evidenced.
- Never fabricate route, function, or table names.
- Prefer direct code references over assumptions.
