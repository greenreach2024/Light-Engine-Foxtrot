# Implementation Proposal: AWS Cleanup + Edge Preflight (Phase 1–2)
**Date**: February 3, 2026  
**Agent**: Implementation Agent  
**Status**: 🔍 Proposal Draft — Review Agent Approved (Phase 1–2)  
**Scope**: Phase 1–2 only (Phase 3 requires Architecture Agent)

---

## 📌 Executive Summary
This proposal formalizes Phase 1–2 work approved by Review Agent with strict limits on cleanup targets and retention. The goal is to reduce local AWS Elastic Beanstalk artifact bloat while preparing edge deployment preflight checks. **No other artifacts will be removed or archived.**

---

## ✅ Approved Scope (Phase 1–2)

### Phase 1 — AWS Local Cleanup (STRICT)
**Cleanup targets are restricted to:**
1. `.elasticbeanstalk/app_versions/`
2. `.elasticbeanstalk/logs/`

**Retention policy (N):**
- Keep **N=20** most recent items in `.elasticbeanstalk/app_versions/` (by mtime).  
- Keep **N=10** most recent items in `.elasticbeanstalk/logs/` (by mtime).  

**Explicit exclusions:**
- Do **not** remove or archive any other files or directories.
- Do **not** remove `greenreach-central-fresh.zip` or any other artifacts without explicit approval.

**Rationale:** `.elasticbeanstalk` is ~27GB locally. These two paths are non-source, local EB artifacts safe to prune under controlled retention.

---

### Phase 2 — Edge Deployment Preflight (Proposal Only)
**No implementation in this phase.**

Planned preflight enhancement (for later approval):
- Add a preflight check in [scripts/deploy-edge.sh](scripts/deploy-edge.sh) to verify update-agent configuration variables are present (e.g., `UPDATE_SERVER`, `UPDATE_CHANNEL`) before deployment proceeds.

**Note:** This will not be implemented until a separate, formal implementation proposal is approved for Phase 2 changes.

---

## 🚫 Out of Scope
- Phase 3 update-agent integration (Architecture Agent required).
- Cleanup of any files outside `.elasticbeanstalk/app_versions/` and `.elasticbeanstalk/logs/`.
- Archiving or deleting `greenreach-central-fresh.zip` or any other large artifacts.
- Any production deployment actions.

---

## ✅ Acceptance Criteria (Phase 1)
- `.elasticbeanstalk/app_versions/` reduced to last **20** most recent items.
- `.elasticbeanstalk/logs/` reduced to last **10** most recent items.
- No deletions outside those two directories.
- Cleanup behavior documented and repeatable.

---

## 🔍 Verification Plan
- List contents and counts before/after cleanup for both directories.
- Confirm no changes outside `.elasticbeanstalk/app_versions/` and `.elasticbeanstalk/logs/`.

---

## Requested Review
- **Review Agent**: Validate retention numbers and cleanup scope.  
- **Architecture Agent**: Not required (Phase 3 only).

---

## Next Step (Pending Approval)
If approved, implement a safe cleanup script (local-only) limited to the two directories above with the retention counts specified.
