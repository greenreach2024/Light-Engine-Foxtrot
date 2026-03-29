# Code Navigation Ownership Skill

## Objective
Find ownership quickly: which file/function/component controls the observed behavior.

## Search Strategy
1. Start from user-visible text, button id/class, or API path.
2. Locate frontend event handlers and shared helpers.
3. Trace route mounts to concrete handlers.
4. Use symbol/function search for utility ownership.
5. Confirm final owning module for each layer.

## Deliverable
- Frontend owner
- API owner
- Service owner
- Data owner
- Closest tests covering each owner
