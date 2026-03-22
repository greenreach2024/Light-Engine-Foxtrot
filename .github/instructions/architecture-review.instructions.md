---
description: "Use when starting work on the GreenReach/Light Engine project, making infrastructure changes, modifying server code, editing routes, or touching any file in greenreach-central/. Covers mandatory document review before code changes."
applyTo: ["greenreach-central/**", "server-foxtrot.js", ".elasticbeanstalk/**", ".ebextensions/**"]
---
# Mandatory Architecture Review

Before modifying ANY file in this project, you MUST:

1. Read `.github/CLOUD_ARCHITECTURE.md` — confirms two separate EB apps, deployment targets, DNS
2. Review which environment serves the file you are changing (LE vs Central)
3. Confirm deployment targets BEFORE committing

## Quick Reference
- `greenreach-central/` files -> served by `greenreach-central-prod-v4` (Central)
- Root files -> served by `light-engine-foxtrot-prod-v3` (LE)
- They are SEPARATE EB applications. One deploy does NOT update the other.

## The Rule That Cannot Be Skipped
If your changes touch `greenreach-central/`, Central MUST be deployed.
If your changes touch root server/public files, LE MUST be deployed.
If BOTH are touched, BOTH must be deployed.
