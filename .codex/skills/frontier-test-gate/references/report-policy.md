# Report Policy

Use `.harness/templates/test-report.md` when writing a test report.

## Required Sections

- Scope: changed areas and why each gate was selected.
- Commands: exact command, result, and important output.
- Failures: failing test, build error, or validation error with next action.
- Skipped tests: skipped gate, reason, and risk.

## Result Labels

- PASS: command completed successfully in the current worktree.
- FAIL: command ran and returned a failing result.
- SKIPPED: command was intentionally not run with a recorded reason.
- BLOCKED: command could not run due to missing dependency, environment, permission, or unresolved earlier failure.

## Completion Rule

The gate passes only when all required commands are PASS, or when the user explicitly accepts the risk for every SKIPPED or BLOCKED required command.
