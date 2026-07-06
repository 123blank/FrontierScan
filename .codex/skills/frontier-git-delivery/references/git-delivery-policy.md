# Git Delivery Policy

Git delivery is approval-gated.

## Never Without Explicit Approval

- `git add`
- `git commit`
- `git push`
- PR/MR creation
- history rewrite
- reset, clean, checkout, or destructive cleanup

## Before Approval

- Summarize owned changes.
- Call out unrelated dirty files.
- Summarize validation gates and evidence.
- Propose commit message and PR summary.
- State exactly which files would be staged.

## After Approval

- Stage only owned files.
- Re-check `git status`.
- Commit only if validation gates are accepted.
- Do not include unrelated dirty worktree files.
