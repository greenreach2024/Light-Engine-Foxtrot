# Session Replay Reconstruction Skill

## Objective
Reconstruct real user behavior from session evidence instead of idealized repro paths.

## Workflow
1. Capture chronological user actions and page states.
2. Map each action to frontend handler and network activity.
3. Note environment context: role, feature flags, farm selection, device state.
4. Build a minimal deterministic reproduction sequence.

## Deliverable
- Reconstructed timeline
- Deterministic reproduction script
- Divergence point from expected behavior
