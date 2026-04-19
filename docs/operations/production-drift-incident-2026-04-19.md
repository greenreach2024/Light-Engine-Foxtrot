# Production Drift Incident - April 19, 2026

## Summary

Production was not serving an old Cloud Run revision. Cloud Run was current, but the deployable branch was incomplete.

The visible rollback came from two sources:

1. The legacy `/farm-admin.html` entry point still existed and was being served directly instead of redirecting to `/LE-farm-admin.html`.
2. Several UI fixes existed only on side branches or local-only `main`, not on `origin/main`.

## Root Cause

### 1. GitHub and deploy code diverged

Production-relevant fixes existed in three places instead of one deployable branch:

- `origin/devin/1776551546-le-theme-refactor`
- `origin/reconcile/github-salvage`
- local `main` only

This meant GitHub `origin/main` was missing part of the setup/admin dark-theme work and the grow-management styling fix, even though those fixes existed elsewhere.

### 2. Local-only main commit was never pushed

Local `main` contained an extra commit not present on `origin/main`:

- `b9e34d0a` - `Fix LE dashboard device panel dark theme`

That commit updated:

- `greenreach-central/public/styles.foxtrot.css`
- `public/styles.foxtrot.css`

### 3. Theme branch fixes were never merged to origin/main

Missing off `origin/main` from `origin/devin/1776551546-le-theme-refactor`:

- `918e39bc` - add `le-foundation.css` tokens and fix IoT/SwitchBot whitewash
- `192a5494` - route farm-setup overrides through foundation tokens
- `0496b238` - switch IoT/SwitchBot manager fallbacks
- `7b7a4a3d` - follow-up theme review fixes
- `4693c61f` - `body.le-theme` gradient fix
- `3986d471` - primary button font-size fallback
- `d9a5c42e` - tokenize inline device entry styles
- `13c0ef43` - dark telemetry/info grid snapshot cells

Files pulled from that branch into the reconciled main line:

- `greenreach-central/public/views/farm-setup.html`
- `public/views/farm-setup.html`
- `greenreach-central/public/styles/le-foundation.css`
- `public/styles/le-foundation.css`
- `greenreach-central/public/styles/iot-manager.css`
- `public/styles/iot-manager.css`
- `greenreach-central/public/styles/switchbot-manager.css`
- `public/styles/switchbot-manager.css`
- `greenreach-central/public/app.foxtrot.js`
- `public/app.foxtrot.js`
- `greenreach-central/public/LE-dashboard.html`
- `public/LE-dashboard.html`
- `public/LE-switchbot.html`

### 4. Grow-management styling fix was only on salvage branch

Missing off `origin/main` from `origin/reconcile/github-salvage`:

- `76105080` - dark-theme cards, remove emojis, button styling, nutrient audit fixes

Files pulled from that branch into the reconciled main line:

- `greenreach-central/public/views/grow-management.html`
- `public/views/grow-management.html`

## Remediation Completed

### Code

- Added `/farm-admin.html` redirect to `/LE-farm-admin.html` in both servers.
- Merged the missing setup/admin UI files from the theme branch into the clean `main` line.
- Merged the missing grow-management button styling from the salvage branch into the clean `main` line.
- Kept the local-only `main` dark-surface CSS commit as part of the reconciled main line.

### Documentation / Rules

Updated:

- `.github/copilot-instructions.md`
- `.github/DEPLOYMENT_CHECKLIST.md`
- `CONTRIBUTING.md`
- `README.md`

New rule:

- GitHub is the deployable source of truth.
- Production-relevant fixes must not remain local-only.
- If fixes are split across branches, reconcile Git history first, push to GitHub, then deploy.

## Deployment Notes

Cloud Run deploys must use the digest reported by Artifact Registry, not the truncated digest shown in local Docker output.

Correct flow:

1. Commit reconciled code.
2. Push to GitHub.
3. Build and push images.
4. Resolve exact digest with `gcloud artifacts docker images list ... --include-tags`.
5. Deploy with `gcloud run services update ... --image=...@sha256:...`.

## Prevention Checklist

Before future production deploys:

1. Verify `git status` is clean.
2. Verify the deploy branch has been pushed.
3. Verify `main` and `origin/main` do not differ unexpectedly.
4. Check whether expected fixes live only on side branches.
5. Add a report under `docs/operations/` if production drift or branch reconciliation was required.
