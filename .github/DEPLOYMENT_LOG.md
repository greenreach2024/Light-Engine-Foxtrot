# Deployment Audit Log
**Tracks every production deployment for commit-to-deploy traceability.**

Append a new row after each `gcloud run services update` deployment.

| Date (UTC) | Service | Revision | Image Digest | Tag | Commit SHA | Deployer |
|------------|---------|----------|--------------|-----|------------|----------|
| 2026-04-19 | light-engine | light-engine-00348-lfm | sha256:b88ba3ed1733...7505723 | deploy-20260420-grow-route-hotfix | a6fd47d1 | copilot-agent |
| 2026-04-19 | greenreach-central | greenreach-central-00406-khv | sha256:6c01fc59c265...8daf04 | deploy-20260420-grow-route-hotfix | a6fd47d1 | copilot-agent |
