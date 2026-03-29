# Change Isolation Impact Analysis Skill

## Objective
Identify what changed, when, and what related behavior might be affected.

## Workflow
1. Compare current behavior against known-good baseline.
2. Inspect recent commits touching relevant routes/components/services.
3. Map changed symbols to dependent call sites.
4. Rank likely regression-causing commits.

## Deliverable
- Suspect commit list with rationale
- Directly impacted files/functions
- Secondary risk areas to re-test
