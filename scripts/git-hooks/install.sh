#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"

chmod +x "$repo_root/.githooks/pre-commit"
chmod +x "$repo_root/.githooks/pre-push"
chmod +x "$repo_root/scripts/git-hooks/pre-commit.sh"
chmod +x "$repo_root/scripts/git-hooks/pre-push.sh"
chmod +x "$repo_root/scripts/git-hooks/install.sh"

git config core.hooksPath .githooks

echo "Installed repo-tracked git guardrails."
echo "core.hooksPath=$(git config --get core.hooksPath)"