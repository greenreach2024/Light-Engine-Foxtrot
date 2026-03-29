# Runtime Tracing Correlation Skill

## Objective
Correlate one user action with downstream service behavior using trace or correlation identifiers.

## Method
1. Capture request boundary metadata (request id, correlation id, timestamp).
2. Follow logs/events through each service boundary.
3. Align timing and ids to reconstruct causal order.
4. Detect dropped, retried, timed out, or misrouted requests.

## Output
- Trace/correlation id used
- Ordered call timeline
- Failing boundary and reason
