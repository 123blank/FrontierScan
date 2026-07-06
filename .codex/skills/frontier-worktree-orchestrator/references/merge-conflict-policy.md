# Merge Conflict Policy

Merging is intentionally conservative.

## Before Merge

- Verify task tests and review gate passed.
- Confirm the task owns all files it changed.
- Show current git status.
- Identify unrelated dirty files.

## On Conflict

- Stop immediately.
- Do not choose sides automatically.
- Report files in conflict, involved task branches, and likely ownership cause.
- Ask for direction if the conflict crosses task boundaries.

## After Merge

- Run the relevant test gates again.
- Update state with merged branch, commit if one exists, and residual risks.
