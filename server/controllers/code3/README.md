# Code3 Dynamic Light Manager

This manager owns the protocol definition, operational runbook, and helper code needed to command Code3 dynamic fixtures through the GreenReach Light Engine.

- `protocol.json` captures the canonical HTTP endpoints, device ID mapping, and HEX payload structures the controller expects.
- Future helpers should translate UI intents (e.g., "set channel A to 60%") into one of these frames before dispatching to the physical controller.
- Operators can lean on the verification checklist in the manifest to ensure connectivity before involving the UI.

By centralizing the protocol here we keep the IoT Devices card and other UI components free from vendor-specific byte strings while still giving engineers a single source of truth for troubleshooting (`server-charlie.js` → Code3 appliance).
