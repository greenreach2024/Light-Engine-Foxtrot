# Controller Management

This directory hosts backend controller managers that coordinate vendor-specific device protocols.

Each controller manager combines:
- A **metadata manifest** that the dashboard can read to describe capabilities.
- One or more **protocol definitions** (for example, the byte sequences a light expects).
- Optional **helper utilities** for translating generic intents into vendor commands.
- **Operational runbooks** that capture how the Charlie server proxies traffic to the physical controller.

Keeping the protocol definition beside the controller manager ensures that UI components such as the IoT Devices card can stay vendor-agnostic—they simply ask the backend manager for supported operations. As a concrete example, the Code3 manager documents that `server-charlie.js` listens on `:8091` and forwards to the Code3 appliance at `http://192.168.2.80:3000`, along with the required endpoints (`/healthz`, `/api/devicedatas`, `/api/devicedatas/device/:id`, `/controller/plans`, `/controller/sched`) and HEX payload format (`[CW][WW][BL][RD][00][00]`).
