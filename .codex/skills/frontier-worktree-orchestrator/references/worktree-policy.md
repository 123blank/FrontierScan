# Worktree Policy

Use worktrees only when isolation or parallelism materially helps.

## Allowed

- Plan worktree assignments from a validated task DAG.
- Create one worktree per task or per serial wave when explicitly approved.
- Keep global/shared changes in a serial worktree.
- Record branch, path, task, wave, owner, and predicted files in state.

## Not Allowed Without Explicit Approval

- Delete worktrees.
- Force merge, reset, clean, or discard changes.
- Stage, commit, push, publish, or deploy.
- Create worktrees for tasks predicted to touch the same files in the same wave.

## Required Checks

- Run `git status --short --untracked-files=all` before creating or merging.
- Validate the task DAG before planning.
- Call out unrelated dirty files.
- Stop on conflicts and report them.
