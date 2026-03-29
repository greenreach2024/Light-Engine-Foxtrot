# State Inspection Debugging Skill

## Objective
Diagnose behavior controlled by hidden/derived state.

## Inspect
1. User role and authorization context.
2. Farm, room, device, and selection state.
3. Feature flags and environment toggles.
4. Form validity and disabled predicates.
5. Local/session storage keys used by the page.
6. Request payload composition and server-side validation errors.

## Output
- State snapshot at failure moment
- Which state value blocked expected behavior
- Where that state is set and consumed
