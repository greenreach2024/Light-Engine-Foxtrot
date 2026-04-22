#!/usr/bin/env bash

set -euo pipefail

guardrail_current_branch() {
  git rev-parse --abbrev-ref HEAD
}

guardrail_is_protected_branch() {
  local branch
  branch="${1:-}"
  [[ "$branch" == "main" || "$branch" == "master" ]]
}

guardrail_allowed_branch_name() {
  local branch
  branch="${1:-}"

  [[ "$branch" =~ ^(fix|hotfix|feat|feature|docs|refactor|test|chore|framework|copilot|impl|reconcile|release)/[A-Za-z0-9._-]+$ ]]
}

guardrail_has_tracked_staged_changes() {
  [[ -n "$(git diff --cached --name-only --diff-filter=ACMR 2>/dev/null || true)" ]]
}

guardrail_branch_is_based_on_origin_main() {
  git fetch origin main --quiet >/dev/null 2>&1 || true
  git merge-base --is-ancestor origin/main HEAD
}

guardrail_print_header() {
  local title
  title="${1:-Git Guardrail Check}"
  echo ""
  echo "$title"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

guardrail_print_branch_instructions() {
  echo "Use a clean branch created from origin/main:"
  echo "  git switch -c fix/<short-name> origin/main"
  echo ""
  echo "If this really is an emergency, bypass explicitly with:"
  echo "  ALLOW_MAIN_COMMIT=1 git commit ..."
  echo "  ALLOW_MAIN_PUSH=1 git push ..."
}