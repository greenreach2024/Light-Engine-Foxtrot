#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
source "$repo_root/scripts/git-hooks/common.sh"

branch="$(guardrail_current_branch)"

guardrail_print_header "🚫 GIT BRANCH GUARDRAIL (pre-push)"

if guardrail_is_protected_branch "$branch" && [[ "${ALLOW_MAIN_PUSH:-0}" != "1" ]]; then
  echo "❌ Push blocked from protected branch: $branch"
  echo ""
  echo "Use a review branch and PR instead of pushing local main/master."
  echo ""
  guardrail_print_branch_instructions
  exit 1
fi

if ! guardrail_allowed_branch_name "$branch" && ! guardrail_is_protected_branch "$branch" && [[ "${ALLOW_NONSTANDARD_BRANCH:-0}" != "1" ]]; then
  echo "❌ Push blocked from nonstandard branch name: $branch"
  echo ""
  echo "Rename or recreate the branch with an allowed prefix before pushing."
  exit 1
fi

if ! guardrail_is_protected_branch "$branch" && ! guardrail_branch_is_based_on_origin_main && [[ "${ALLOW_NON_MAIN_BASE:-0}" != "1" ]]; then
  echo "❌ Push blocked because $branch is not based on origin/main"
  echo ""
  echo "Recreate the branch from origin/main so GitHub is the deployable source of truth."
  exit 1
fi

echo "✅ Push guardrails passed for $branch"