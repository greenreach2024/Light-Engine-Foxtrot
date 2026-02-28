# UX Audit Report — Ease of Use, CSS Consistency, Task Improvements

Date: 2026-02-27
Scope: `greenreach-central/public` primary buyer/admin experiences with focus on:
- Buyer wholesale flow (`GR-wholesale.html`, `js/wholesale.js`)
- Central admin flow (`GR-central-admin.html`)
- Onboarding/setup entry (`setup-wizard.html`)

## Executive Summary

The product has strong functional coverage, but UX consistency and maintainability are constrained by heavy page-level styling and duplicated markup. Two high-impact issues should be prioritized:

1. **Duplicate modal/form IDs in buyer wholesale page** can cause selector collisions, unstable behavior, and accessibility violations.
2. **Extensive inline styling in central admin** creates visual drift risk and slows UX iteration.

Immediate wins are available in 1–2 sprints without changing product scope.

## Method

- Inspected representative HTML/CSS/JS surfaces for buyer and admin workflows.
- Searched for style duplication patterns (`<style>`, inline `style="..."`, duplicate IDs).
- Reviewed task flow interaction patterns in buyer/admin scripts (toasts, confirms, blocked actions).

## Key Findings (Prioritized)

### Critical

#### C1. Duplicate IDs and duplicated modal markup in wholesale page
- File: `greenreach-central/public/GR-wholesale.html`
- Evidence:
  - `id="product-request-modal"` appears twice (around lines 2315 and 2412).
  - `id="product-request-form"` appears twice (around lines 2325 and 2422).
  - Repeated input IDs (e.g., `request-product-name`) appear twice.
- UX impact:
  - Event handlers may bind unpredictably to first/last matching element.
  - Modal open/close/submit interactions can become brittle.
  - Violates unique-id expectations for assistive technology and automated tests.
- Recommendation:
  - Keep a **single** product request modal/form instance.
  - Remove duplicate block and verify all selectors target one canonical element.
- Regression risk note:
  - Removing duplicated markup can break implicit selector assumptions if any script depends on node order or duplicate matches.
  - Validate modal open/close, submit success, validation errors, and cancel actions after deduplication.

### High

#### H1. Inline style sprawl in central admin causes consistency drift
- File: `greenreach-central/public/GR-central-admin.html`
- Measured:
  - ~456 inline `style="..."` attributes in this single file.
- UX impact:
  - Inconsistent spacing, typography, and control behavior across views.
  - High cost to apply global visual improvements.
  - Increased risk of accidental regressions and dark/light mode mismatches.
- Recommendation:
  - Move repeated inline patterns to shared utility/component classes in `styles/light-engine.css`.
  - Prioritize shared tokens for labels, form controls, card spacing, and action bars.

#### H2. Mixed styling model across public pages
- Scope: multiple pages in `greenreach-central/public`
- Measured:
  - ~68 HTML files contain embedded `<style>` blocks.
- UX impact:
  - Parallel theme definitions increase visual inconsistency and maintenance overhead.
- Recommendation:
  - Establish one primary shared stylesheet strategy:
    - global tokens + component classes
    - page files should mostly compose existing classes

### Medium

#### M1. “Coming soon” dead-end in buyer action path
- File: `greenreach-central/public/js/wholesale.js` (around line 239)
- Evidence:
  - `showToast('Contact feature coming soon', 'info')` is triggered by a contact action.
- UX impact:
  - Users hit non-productive action paths during active workflows.
- Recommendation:
  - Replace with one of:
    - disabled control + clear helper text before click,
    - fallback action (mailto, message form, or support link),
    - hide action until supported.

#### M2. Native confirm dialogs for destructive admin actions
- File: `greenreach-central/public/js/wholesale-admin.js`
- Evidence:
  - Several native `confirm(...)` prompts for disconnect/deactivate/mark-paid actions.
- UX impact:
  - Inconsistent interaction quality and accidental-confirm risk.
  - No rich context (impacts, affected records, undo guidance).
- Recommendation:
  - Standardize with existing modal system for destructive actions.
  - Include explicit consequence text + entity name + optional second-step confirmation for irreversible operations.

#### M3. Setup wizard page redirects immediately while carrying full UI payload
- File: `greenreach-central/public/setup-wizard.html`
- Evidence:
  - Early `window.location.replace('/farm-admin.html');` plus extensive embedded wizard CSS/markup.
- UX impact:
  - Confusing ownership and maintenance overhead.
  - Potential stale UX debt if page is expected to be inactive.
- Recommendation:
  - Either deprecate this file to a minimal redirect shell or reactivate as a maintained flow.

## Task-Flow Improvement Opportunities

### Buyer wholesale ordering
- Improve first-run orientation:
  - keep auth gate concise,
  - show one clear “start ordering” path after sign-in.
- Reduce flow friction:
  - avoid dead-end buttons,
  - ensure cart/checkout states are explicit when actions are blocked.
- Product request path:
  - fix duplicate modal issue,
  - keep one consistent request form and success state.

### Central admin operations
- Destructive actions:
  - replace native confirms with a standardized confirmation modal pattern.
- Dense views:
  - create consistent action bars, table controls, and form sections to improve scanability.
- Inline edit patterns:
  - align button states (`Edit`, `Save`, `Cancel`) and placement across modules.

## CSS Unification Plan

### Phase 1 (1 sprint): Stabilize and remove immediate risk
1. Remove duplicate modal/form block in `GR-wholesale.html`.
2. Introduce shared classes for most repeated inline patterns (labels, small inputs, card header actions).
3. Apply classes to highest-traffic admin and wholesale sections first.

### Phase 2 (1–2 sprints): Standardize component-level styling
1. Define a compact component style kit in `styles/light-engine.css`:
   - form rows/groups
   - section headers
   - button variants and destructive states
   - modal headers/footers
2. Migrate major views away from inline styles incrementally.

### Phase 3 (ongoing): Enforce consistency
1. Add lint/check script for duplicate IDs and excessive inline-style usage in key pages.
2. Add lightweight UI checklist for PRs:
   - no duplicate IDs
   - no new dead-end actions
   - use shared classes before inline styles

## Suggested Success Metrics

- Duplicate IDs in key pages: **0**
- Inline style count in `GR-central-admin.html`: reduce by **50%+** in first pass
- Buyer flow dead-end actions in production paths: **0**
- Destructive admin actions using standardized modal: **100%**

## Phase 1 Acceptance Criteria

1. Duplicate IDs in `GR-wholesale.html` for product request modal/form/input fields = **0**.
2. Product request modal lifecycle passes manual smoke check:
  - open,
  - close (X and Cancel),
  - submit success,
  - submit validation/error handling.
3. New central-admin style refactor introduces shared classes without visual regressions in prioritized views.
4. Destructive admin actions no longer use native `confirm(...)` for targeted paths in initial rollout scope.
5. Post-change grep checks are archived in evidence bundle for review signoff.

## Immediate Next Actions

1. Fix duplicate product request modal/form IDs in `GR-wholesale.html`.
2. Create first shared class bundle in `styles/light-engine.css` and migrate top 20 repeated inline blocks in `GR-central-admin.html`.
3. Replace native `confirm(...)` usage in `wholesale-admin.js` with one reusable confirmation modal.
