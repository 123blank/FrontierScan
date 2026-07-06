---
name: frontier-task-dag-planner
description: Convert a FrontierScan story or technical design into implementation tasks, dependency edges, predicted touched files, parallel waves, global changes, and risk flags. Use before coding to produce a valid task DAG and worktree execution plan.
---

# Frontier Task DAG Planner

Use this Skill after requirement breakdown and technical design, before implementation.

## Quick Workflow

1. Load the story, acceptance criteria, and technical design.
2. Query relevant knowledge if affected modules are unclear:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<module or feature>" -Mode technical-design -Area all
```

3. Read `references/task-schema.md`.
4. Read `references/parallelization-policy.md`.
5. Read `references/conflict-policy.md`.
6. Produce a DAG JSON using `.harness/templates/task-dag.example.json` as the shape reference.
7. Validate the DAG:

```powershell
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile <task-dag-file>
```

## Outputs

- `.harness/outputs/task-dag.json`
- E2E state updates for `tasks` and `dag`

## Rules

- Do not implement while planning the DAG.
- DAG must be acyclic.
- Every task must include predicted touched files and acceptance criteria.
- Tasks predicted to touch the same file should not run in the same wave.
- Database, config, auth, publish, and shared-entry changes must be surfaced as global changes.
