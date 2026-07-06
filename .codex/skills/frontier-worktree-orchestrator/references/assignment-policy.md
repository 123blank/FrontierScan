# Assignment Policy

Convert DAG waves into implementation assignments.

## Rules

- Preserve DAG wave order.
- Assign dependent tasks to later waves.
- Do not put tasks with overlapping predicted files in parallel.
- Put database, config, auth, router, global CSS, API client base, and build config tasks in serial waves.
- Prefer one worktree per task for risky or broad changes.
- Prefer one worktree per wave for tiny independent docs/test tasks.

## Helper

Run:

```powershell
.\.harness\scripts\plan-worktrees.ps1 -TaskDagFile .\.harness\outputs\task-dag.json
```

The helper is read-only and emits suggested branch/path/create commands.
