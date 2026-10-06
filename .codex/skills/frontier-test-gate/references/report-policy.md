# Report Policy

Use `.harness/templates/test-report.md` when writing a test report.

## Required Sections

- Scope: changed areas and why each gate was selected.
- Acceptance mapping: each `caseId`, its `required` flag, and referenced `criterionIds`.
- Commands: exact command, result, and important output.
- Failures: failing test, build error, or validation error with next action.
- Skipped tests: skipped gate, reason, and risk.

## Result Labels

- PASS: command completed successfully in the current worktree.
- FAIL: command ran and returned a failing result.
- SKIPPED: command was intentionally not run with a recorded reason.
- BLOCKED: command could not run due to missing dependency, environment, permission, or unresolved earlier failure.

## Completion Rule

The gate passes only when all required commands and required cases are PASS, every required criterion has relevant required-case coverage, and referenced evidence still matches its recorded SHA-256. M7-A3 does not support accepting skipped or blocked required tests as a completion substitute.
