# Activity Hub Architecture (Edge-Only)
**Date**: February 3, 2026

> Update notice (2026-04-24): Default landing view changes from a tray grid to **group cards**. Tray grid becomes a drill-down from the group detail. Edge-only rule still holds: Activity Hub is served from LE (now LE Cloud Run), not Central. See `docs/features/GROUP_LEVEL_MANAGEMENT_UPDATES.md` section 4.6.

## Decision
Activity Hub is **edge-only**. The Activity Hub UI and its APIs are served from the farm’s edge device (server-foxtrot.js), not GreenReach Central (cloud).

## Rationale
- Activity Hub depends on farm-local, real-time operational APIs (inventory, trays, QA, printing).
- Cloud is a multi-farm coordinator (admin, marketplace, analytics), not a farm floor runtime.
- Proxying or duplicating edge APIs in cloud adds latency and violates architecture boundaries.

## Access Pattern
- **Tablets/iPads connect directly to the edge device** on the farm network.
- QR codes for Activity Hub must point to the edge device IP/host.

## Cloud Behavior
- Cloud deployment **does not serve** Activity Hub pages.
- Cloud UI removes Activity Hub links and pairing prompts.

## Edge Behavior
- Edge deployment continues to serve Activity Hub UI and APIs.
- No changes to Activity Hub data formats or APIs were required for this decision.

## Guardrails
- Do **not** add Activity Hub routes to greenreach-central.
- Do **not** proxy Activity Hub requests through the cloud.
- Keep Activity Hub dependencies aligned with edge-only operations.
