# Safe Patch and Verify Skill

## Objective
Apply minimal, documented fixes safely and prove they work. Every code change must be traceable, justified, and reversible.

## Core Rule: Document All Code Work
Every patch MUST include documentation before it is considered complete:
- **Inline comments** at the change site explaining WHY the change was made (not just what changed)
- **Commit message** with structured format: `[safe-patch] <area>: <summary>` followed by root-cause explanation
- **Changelog entry** in the relevant module or service README if the change affects behavior visible to other agents or users
- **FAYE learning log** entry via `learnFromConversation` so the fix is indexed for future reference

## Workflow
1. **Diagnose** -- Reproduce the issue. Capture before-state evidence (logs, screenshots, error output).
2. **Scope** -- Identify root-cause files. Limit patch to those files only. If more than 3 files need changes, escalate for architecture review.
3. **Propose** -- Describe the smallest viable patch. Document the rationale: what is broken, why this fix is correct, what alternatives were considered.
4. **Implement** -- Apply the patch with inline comments at every modified block. Use the format: `// [safe-patch] <date> -- <reason>`
5. **Test** -- Re-run reproduction steps and relevant tests. Capture after-state evidence.
6. **Regression check** -- Confirm no regression in adjacent flows. Check dependent routes, shared services, and downstream consumers.
7. **Document** -- Write the commit message, changelog entry, and FAYE learning log entry. This step is NOT optional.
8. **Rollback plan** -- Document exact rollback steps (revert commit hash, env var restore, etc.).

## Acceptance Criteria
- Original issue reproduced and resolved
- No new errors introduced in touched paths
- Verification evidence recorded (before/after)
- All code changes have inline documentation
- Commit message follows `[safe-patch]` format
- FAYE learning log entry created
- Rollback path documented and tested if high-risk

## Risk Classification
- **Low**: Single file, no DB changes, no auth changes -- auto-approve
- **Medium**: 2-3 files, config changes, non-breaking API changes -- FAYE reviews within 1 tool loop
- **High**: DB schema changes, auth changes, multi-service impact -- FAYE must approve before execution, admin notified

## Anti-Patterns (NEVER Do)
- Apply a fix without explaining why in a comment
- Skip the learning log entry
- Change more files than the root cause requires
- Deploy without regression check
- Use `--no-verify` or skip pre-commit hooks
