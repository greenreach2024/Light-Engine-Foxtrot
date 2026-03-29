# Test Generation Regression Skill

## Objective
Convert discovered failures into repeatable regression tests.

## Workflow
1. Encode the minimal repro path as a test.
2. Assert current failing behavior first.
3. Apply fix and assert test now passes.
4. Run related test subset for collateral coverage.

## Output
- New/updated test path
- Failing assertion before fix
- Passing assertion after fix
