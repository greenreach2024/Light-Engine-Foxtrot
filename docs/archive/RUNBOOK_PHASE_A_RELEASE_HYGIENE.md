# Runbook: Phase A Release Hygiene

Date: 2026-02-28  
Scope: Deterministic release candidate generation from clean commit state

---

## 1) Preconditions

1. Repository root resolves to `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot`.
2. Working tree is clean (no staged, unstaged, or untracked files).
3. Candidate is generated from an explicit commit SHA.
4. Validation gates pass before any deployment discussion.

---

## 2) Required Command Sequence

```bash
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot

npm run release:preflight
npm run release:gates
npm run release:candidate -- --sha "$(git rev-parse HEAD)"
```

Expected outputs:
- preflight: `Preflight passed`
- gates: `GATE_SUMMARY:PASS`
- candidate: `artifact=...` and `sha256=...`

---

## 3) Evidence Checklist

- [ ] Current commit SHA and short SHA captured
- [ ] `git status --short` is empty at release generation time
- [ ] Schema validation gate pass output captured
- [ ] Smoke/auth regression gate pass output captured
- [ ] Artifact path and SHA256 checksum captured
- [ ] Manifest file attached

---

## 4) Deployment Approval Gate

No production deployment actions are allowed until the user provides explicit approval phrase:

`APPROVED FOR DEPLOYMENT`

Until that approval appears, stop after evidence capture.

---

## 5) Rollback

If a generated candidate is invalid:
1. Discard the candidate artifact under `tmp/release-candidate-*`.
2. Regenerate candidate from the prior known-good commit SHA.
3. Re-run preflight and gates.

If the Phase A tooling changes themselves must be reverted:
1. Revert the Phase A scripts and wiring files.
2. Confirm baseline scripts still execute.
3. Re-run `npm run validate-schemas` and smoke tasks.
