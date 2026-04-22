# Git Guardrails

This repository now includes versioned git hook guardrails under `.githooks/`.

## Install

Run:

```bash
npm run guardrails:install
```

That command:

- marks the repo-tracked hook scripts executable
- sets `core.hooksPath` to `.githooks`
- activates the branch-safety hooks for this clone

## What It Blocks

### Pre-commit

- blocks commits on `main` or `master`
- blocks commits on nonstandard branch names
- blocks commits on branches that are not based on `origin/main`
- then runs the existing framework pre-commit checks from `.git/hooks/pre-commit`

### Pre-push

- blocks pushes from `main` or `master`
- blocks pushes from nonstandard branch names
- blocks pushes from branches not based on `origin/main`

## Allowed Branch Prefixes

- `fix/`
- `hotfix/`
- `feat/`
- `feature/`
- `docs/`
- `refactor/`
- `test/`
- `chore/`
- `framework/`
- `copilot/`
- `impl/`
- `reconcile/`
- `release/`

Example:

```bash
git switch -c fix/wholesale-password-reset origin/main
```

## Emergency Bypass

These are explicit and noisy on purpose:

```bash
ALLOW_MAIN_COMMIT=1 git commit ...
ALLOW_MAIN_PUSH=1 git push ...
ALLOW_NONSTANDARD_BRANCH=1 git commit ...
ALLOW_NON_MAIN_BASE=1 git push ...
```

Use them only for real recovery work.