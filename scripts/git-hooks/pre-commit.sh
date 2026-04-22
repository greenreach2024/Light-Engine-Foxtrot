#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
source "$repo_root/scripts/git-hooks/common.sh"

branch="$(guardrail_current_branch)"

guardrail_print_header "🔒 GIT BRANCH GUARDRAIL (pre-commit)"

if guardrail_is_protected_branch "$branch" && guardrail_has_tracked_staged_changes && [[ "${ALLOW_MAIN_COMMIT:-0}" != "1" ]]; then
  echo "❌ Commit blocked on protected branch: $branch"
  echo ""
  echo "Reason: local commits on main/master are too easy to deploy accidentally or mix with unpublished work."
  echo ""
  guardrail_print_branch_instructions
  exit 1
fi

if ! guardrail_is_protected_branch "$branch" && ! guardrail_allowed_branch_name "$branch" && [[ "${ALLOW_NONSTANDARD_BRANCH:-0}" != "1" ]]; then
  echo "❌ Commit blocked on nonstandard branch name: $branch"
  echo ""
  echo "Allowed prefixes: fix/, hotfix/, feat/, feature/, docs/, refactor/, test/, chore/, framework/, copilot/, impl/, reconcile/, release/"
  echo ""
  echo "Rename or create a compliant branch from origin/main before committing."
  exit 1
fi

if ! guardrail_is_protected_branch "$branch" && ! guardrail_branch_is_based_on_origin_main && [[ "${ALLOW_NON_MAIN_BASE:-0}" != "1" ]]; then
  echo "❌ Commit blocked because $branch is not based on origin/main"
  echo ""
  echo "Reason: deployable branches must start clean from GitHub main to avoid dragging in local-only commits."
  echo ""
  guardrail_print_branch_instructions
  exit 1
fi

if [[ -x "$repo_root/.git/hooks/pre-commit" ]]; then
  "$repo_root/.git/hooks/pre-commit" "$@"
fi