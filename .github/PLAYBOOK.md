# GreenReach Platform Playbook
**Single source of truth for all development, deployment, and collaboration policy.**

**Last updated**: April 19, 2026
**Platform**: Google Cloud Run (us-east1) -- AWS Elastic Beanstalk is FULLY DEPRECATED.

---

## Governing Documents

| Document | Purpose | Path |
|----------|---------|------|
| **This Playbook** | Policy authority -- links all rules | `.github/PLAYBOOK.md` |
| Cloud Architecture | Infrastructure reference (VPC, AlloyDB, services) | `.github/CLOUD_ARCHITECTURE.md` |
| Deployment Checklist | Pre-deploy verification steps | `.github/DEPLOYMENT_CHECKLIST.md` |
| Deployment Instructions | Cloud Run deploy commands and service map | `.github/instructions/deployment.instructions.md` |
| Copilot Instructions | Agent behavior rules, recent fixes, banned commands | `.github/copilot-instructions.md` |
| Sensor Data Pipeline | SwitchBot-to-AlloyDB data flow | `.github/SENSOR_DATA_PIPELINE.md` |
| Agent Skills Framework | Multi-agent collaboration model | `.github/AGENT_SKILLS_FRAMEWORK.md` |
| Data Format Standards | Canonical data schemas and adapter rules | `.github/DATA_FORMAT_STANDARDS.md` |
| Payment Workflow | Square integration, checkout, accounting | `.github/PAYMENT_WORKFLOW.md` |
| Deploy Gate Hook | Pre-tool hook that blocks single-service deploys | `.github/hooks/deploy-gate.sh` |
| Pre-Commit Hook | Framework compliance enforcement | `.githooks/pre-commit` |
| Deployment Audit Log | Tracked revision-to-digest deploy history | `.github/DEPLOYMENT_LOG.md` |

---

## Services

| Service | Cloud Run Name | Entry Point | URL |
|---------|---------------|-------------|-----|
| Light Engine (LE) | `light-engine` | `server-foxtrot.js` | `https://light-engine-1029387937866.us-east1.run.app` |
| GreenReach Central | `greenreach-central` | `greenreach-central/server.js` | `https://greenreach-central-1029387937866.us-east1.run.app` |

Custom domain: `greenreachgreens.com` maps to Central.

---

## Deployment Policy

### Allowed Commands
```bash
# Build (ALWAYS --platform linux/amd64 on Apple Silicon)
docker buildx build --platform linux/amd64 \
  -t us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/SERVICE:TAG \
  --push CONTEXT

# Deploy by exact digest (preferred)
gcloud run services update SERVICE --region=us-east1 \
  --image=REGISTRY/IMAGE@sha256:DIGEST

# Verify digest in Artifact Registry before deploying
gcloud artifacts docker images list \
  us-east1-docker.pkg.dev/project-5d00790f-13a9-4637-a40/greenreach/SERVICE \
  --include-tags --filter='tags:TAG'
```

### Banned Commands
All `eb` CLI and `aws elasticbeanstalk` commands are FORBIDDEN. See `copilot-instructions.md` for full list.

### Dual-Service Rule
Changes in `greenreach-central/` require deploying Central. Root-level changes require deploying LE. Changes spanning both directories require deploying BOTH services. The deploy gate hook enforces this.

### Digest-Only Deploys
Always resolve the pushed image tag to its `@sha256:` digest via Artifact Registry before running `gcloud run services update`. Never deploy using `:latest` alone -- Cloud Run tag caching can serve stale images.

### Approval Gate
No production deployment without explicit user approval. Agents must present a deployment plan and wait for "APPROVED FOR DEPLOYMENT" before executing build/push/update commands.

---

## Commit Policy

### Message Format (REQUIRED for code changes)
```
Type: Description (Review notation)
```
Valid types: `Fix:`, `Feat:`, `Docs:`, `Refactor:`, `Test:`, `Framework:`, `CRITICAL:`

### Review Notation (REQUIRED for scoped code changes)
Commits touching `lib/`, `server-foxtrot`, `public/data`, `greenreach-central/routes/`, or `greenreach-central/server.js` must include one of:
- `(Review Agent approved)`
- `(Architecture Agent approved)`
- `(Multi-agent review completed)`

The pre-commit hook enforces this as a blocking check for code changes.

### Merge/WIP Exceptions
Merge commits and WIP prefixes are exempt from format and review rules.

---

## Branch Hygiene

- Rebase or merge from `origin/main` before opening deploy PRs.
- The pre-commit hook warns when the current branch is more than 20 commits behind `origin/main`.
- Feature branches should be merged and deleted promptly to avoid divergence.

---

## Pre-Commit Enforcement

The `.githooks/pre-commit` hook runs automatically on every commit and enforces:
1. **Canonical data file protection** -- blocks direct edits to `public/data/*.json`.
2. **Demo data detection** -- blocks hardcoded demo IDs.
3. **Schema validation** -- runs `npm run validate-schemas` on data file changes.
4. **Farm ID validation** -- blocks demo farm IDs in `farm.json`.
5. **Commit message format** -- blocks non-conventional format on code changes.
6. **Review notation** -- blocks missing review notation on scoped code changes.
7. **Branch freshness** -- warns when branch is significantly behind `origin/main`.
8. **Fail-closed design** -- missing tools (`grep`, `jq`, `npm`) cause the hook to fail, not silently pass.

---

## Deployment Audit Log

Every deployment appends a row to `.github/DEPLOYMENT_LOG.md` with:
- Date/time (UTC)
- Service name
- Revision name
- Image digest
- Deploying agent/user
- Commit SHA

This provides commit-to-deploy traceability for team handoffs.

---

## Architecture Rules

See `.github/CLOUD_ARCHITECTURE.md` for full infrastructure details.

Key invariants:
- The farm is 100% cloud. No physical device.
- AlloyDB at `10.87.0.2` via Direct VPC egress (no VPC connector).
- Two separate `public/` directories with different deploy targets.
- `greenreach-central/public/` is served by Central FIRST (static file priority in server-foxtrot.js).
- E.V.I.E. files must exist in BOTH public directories.
- No cross-origin redirects between LE and Central.
