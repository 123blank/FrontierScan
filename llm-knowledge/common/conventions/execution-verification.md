# Execution And Verification Conventions

FrontierScan Harness execution separates task planning, isolated implementation, quality gates, and interface verification.

## Worktree Planning

Use `frontier-worktree-orchestrator` after a valid task DAG exists.

Supporting helper:

```powershell
.\.harness\scripts\plan-worktrees.ps1 -TaskDagFile .\.harness\outputs\task-dag.json
```

The helper emits suggested branches, worktree paths, waves, owner agents, and create commands. It does not create worktrees.

Safety rules:

- Do not create, merge, delete, or clean worktrees without explicit approval.
- Do not parallelize tasks that touch the same predicted files.
- Stop and report merge conflicts.
- Do not discard unrelated dirty files.

## Interface Verification

Use `frontier-interface-verifier` after build/publish or local startup when an environment is available.

Supporting helper:

```powershell
.\.harness\scripts\derive-interface-cases.ps1 -TaskDagFile .\.harness\outputs\task-dag.json
```

The helper turns task acceptance criteria into verification case drafts. Before execution, fill in concrete URLs, request bodies, UI action steps, auth context, seed data, and expected observable results.

Safety rules:

- Do not fabricate verification when the environment is unavailable.
- Record request/action, expected result, actual result, evidence, and diagnosis.
- Failed verification blocks delivery unless fixed or explicitly accepted.
