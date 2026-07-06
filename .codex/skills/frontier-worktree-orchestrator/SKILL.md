---
name: frontier-worktree-orchestrator
description: Use when planning or operating isolated git worktrees for FrontierScan Harness tasks, including DAG wave assignment, task branch planning, merge collection, conflict detection, and cleanup.
---

# Frontier Worktree Orchestrator

Use this Skill after task DAG planning and before isolated or parallel implementation.

## Quick Workflow

1. Validate the task DAG:

```powershell
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile <task-dag-file>
```

2. Read `references/worktree-policy.md`.
3. Read `references/assignment-policy.md`.
4. Produce a read-only worktree plan:

```powershell
.\.harness\scripts\plan-worktrees.ps1 -TaskDagFile <task-dag-file>
```

5. Ask for explicit approval before creating, merging, deleting, or cleaning worktrees.
6. Read `references/merge-conflict-policy.md` before any merge collection.

## Outputs

- Worktree assignment records in `.harness/states/`
- Merge and conflict reports in `.harness/reports/`

## Safety Rules

- Never discard user changes.
- Never run destructive git commands automatically.
- Do not create, merge, delete, or clean worktrees without explicit approval.
- Do not parallelize tasks predicted to touch the same file unless explicitly approved.
- Stop and report merge conflicts instead of hiding them.
