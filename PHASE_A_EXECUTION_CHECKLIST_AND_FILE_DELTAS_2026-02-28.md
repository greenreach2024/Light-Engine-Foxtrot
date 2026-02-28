# Phase A Execution Checklist + Scoped File Delta Proposal

Date: 2026-02-28  
Scope: Phase A — Release Hygiene + Baseline Control (P0)  
Source Plan: ARCHITECTURE_AGENT_IMPLEMENTATION_PLAN_2026-02-28.md  
Status: Ready for implementation PR

---

## 1) Objective

Execute Phase A with a deterministic release-candidate workflow that:
- blocks dirty-worktree deployments,
- separates runtime/generated artifacts from deployable source,
- enforces pre-deploy validation gates,
- and locks deployment to clean commit/tag inputs only.

---

## 2) Phase A Concrete Task Checklist

## A. Baseline and Preconditions
- [ ] Confirm canonical workspace path is mounted: `/Volumes/CodeVault/Projects/Light-Engine-Foxtrot`
- [ ] Confirm active branch and HEAD SHA are recorded for the run
- [ ] Record current dirty state (`git status --short`) as evidence
- [ ] Confirm no production deployment commands will run in this phase

## B. Clean-Tree Gate Implementation
- [ ] Add a preflight script that fails if any staged/unstaged/untracked changes exist
- [ ] Require `git rev-parse --show-toplevel` to match canonical workspace path
- [ ] Require release input to be an explicit commit SHA (not working tree)
- [ ] Add optional `ALLOW_UNTRACKED_DOCS=false` switch defaulting to strict mode

## C. Deterministic Release Candidate Packaging
- [ ] Replace copy-based source bundle behavior with `git archive` packaging from a specific commit
- [ ] Include a `MANIFEST.txt` containing SHA, branch, UTC timestamp, and tool version
- [ ] Save artifact under local temp output and print deterministic checksum (`shasum -a 256`)
- [ ] Keep existing script behavior available only as legacy fallback (non-default)

## D. Mandatory Validation Gates
- [ ] Add a gate runner script that executes in order:
  1) schema validation (`npm run validate-schemas`)
  2) endpoint smoke tests (existing task set)
  3) auth regression checks (existing smoke task)
- [ ] Fail fast on any gate failure with non-zero exit code
- [ ] Emit concise pass/fail summary suitable for release evidence

## E. Deployment Runbook Lock
- [ ] Add a release runbook requiring:
  - clean tree
  - explicit commit SHA
  - successful gate outputs attached
  - explicit user approval phrase before deployment actions
- [ ] Add rollback section describing immediate fallback to prior release artifact
- [ ] Add evidence checklist template for each release candidate

## F. Exit Criteria Verification
- [ ] Candidate package created from clean tree and explicit commit
- [ ] All gates pass in one run
- [ ] Runbook completed with evidence and ready for Review validation

---

## 3) Scoped File Delta Proposal (Implementation PR)

This section defines exact, minimal deltas for Phase A implementation.

### 3.1 Files to Add

1. `scripts/release/preflight-clean-tree.sh`  
   Purpose: enforce clean-worktree + canonical-path + commit-SHA preconditions.

2. `scripts/release/create-release-candidate.sh`  
   Purpose: build deterministic source artifact using `git archive <sha>` and emit checksum/manifest.

3. `scripts/release/run-phase-a-gates.sh`  
   Purpose: run schema + smoke + auth regression gates and return aggregated status.

4. `RUNBOOK_PHASE_A_RELEASE_HYGIENE.md`  
   Purpose: lock deployment process to clean commit/tag path with required evidence and rollback steps.

### 3.2 Files to Update

1. `build-and-verify.sh`  
   Delta:
   - switch absolute path from symlink path to canonical CodeVault path,
   - call `scripts/release/preflight-clean-tree.sh` before packaging,
   - default packaging path to new `create-release-candidate.sh`,
   - preserve legacy copy/zip mode behind explicit `LEGACY_BUNDLE=true` flag.

2. `package.json`  
   Delta:
   - add script aliases:
     - `release:preflight`
     - `release:candidate`
     - `release:gates`
     - `release:phase-a`
   - `release:phase-a` executes preflight -> gates -> candidate in order.

3. `.vscode/tasks.json`  
   Delta:
   - add one orchestrator task: `Phase A release gate` that invokes `npm run release:phase-a`.
   - keep existing smoke tasks unchanged and referenced by gate script.

4. `.gitignore`  
   Delta:
   - add narrowly scoped ignores for release-generated artifacts only:
     - `tmp/release-candidate-*`
     - `tmp/release-evidence-*`
   - do not broaden ignore rules for source scripts or markdown artifacts.

### 3.3 Explicit Non-Goals (Phase A)

- No route/business-logic/security behavior changes.
- No data-format modifications (`public/data/*.json` schemas untouched).
- No production deployment actions.
- No infra/AWS changes.

---

## 4) Validation Commands (to run in Phase A PR)

From canonical workspace:

```bash
cd /Volumes/CodeVault/Projects/Light-Engine-Foxtrot

npm run release:preflight
npm run release:gates
npm run release:candidate -- --sha "$(git rev-parse HEAD)"
```

Expected:
- preflight exits `0` only on clean tree,
- gates exit `0` only when schema + smoke + auth checks pass,
- candidate output includes artifact path + SHA256 + manifest metadata.

---

## 5) Rollback Plan (Phase A implementation only)

If the Phase A PR introduces issues:
- Revert added release scripts and runbook in a single rollback commit.
- Restore prior `build-and-verify.sh` behavior.
- Remove new package/task aliases referencing Phase A scripts.

Rollback validation:
- `npm run validate-schemas`
- run existing smoke tasks from `.vscode/tasks.json`
- confirm `build-and-verify.sh` executes prior baseline behavior.

---

## 6) Review/Gate Flow for this Artifact

1. Implementation Agent submits Phase A PR using this file delta scope.  
2. Review Agent validates scripts, failure semantics, and evidence outputs.  
3. Architecture checkpoint confirms Phase A exit criteria satisfied.  
4. User deployment approval gate remains mandatory for any later production rollout.

---

## 7) Ready-to-Execute Next Step

Implement the deltas in Section 3 as a single scoped PR titled:

`phase-a: release hygiene preflight + deterministic candidate + gate runner`
