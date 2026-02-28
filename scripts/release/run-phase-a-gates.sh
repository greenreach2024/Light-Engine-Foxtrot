#!/usr/bin/env bash
set -euo pipefail

CANONICAL_ROOT="/Volumes/CodeVault/Projects/Light-Engine-Foxtrot"
cd "$CANONICAL_ROOT"

RESTORE_FILES=(
  "public/data/env.json"
  "public/data/farm-api-keys.json"
)

restore_runtime_mutations() {
  git restore --worktree --source=HEAD -- "${RESTORE_FILES[@]}" >/dev/null 2>&1 || true
}

trap restore_runtime_mutations EXIT

PASS_COUNT=0

run_gate() {
  local gate_name="$1"
  shift

  echo "GATE_START:$gate_name"
  "$@"
  echo "GATE_PASS:$gate_name"
  PASS_COUNT=$((PASS_COUNT + 1))
}

run_vscode_task_command() {
  local label="$1"
  local command

  command="$(TASK_LABEL="$label" node -e "
    const fs = require('fs');
    const tasks = JSON.parse(fs.readFileSync('.vscode/tasks.json', 'utf8')).tasks || [];
    const target = tasks.find(t => t.label === process.env.TASK_LABEL);
    if (!target || !target.command) {
      process.exit(3);
    }
    process.stdout.write(target.command);
  ")"

  if [[ -z "$command" ]]; then
    echo "Unable to resolve task command: $label"
    exit 1
  fi

  bash -lc "$command"
}

run_gate "schema-validation" npm run validate-schemas
run_gate "smoke-hyperlocal-endpoints" run_vscode_task_command "Smoke test hyperlocal endpoints"
run_gate "smoke-delivery-quote" run_vscode_task_command "Smoke test delivery quote endpoint"
run_gate "auth-regression-buyer-order-notification" run_vscode_task_command "Smoke test buyer auth + order notification"
run_gate "inventory-reservation-regression" run_vscode_task_command "Test inventory reservation system"

echo "GATE_SUMMARY:PASS"
echo "GATE_COUNT:$PASS_COUNT"
