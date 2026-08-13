---
name: frontier-test-gate
description: Use when selecting or running FrontierScan backend, frontend, Harness, or data verification commands after implementation or fixes before review, publish, interface verification, or delivery.
---

# Frontier Test Gate

Use this Skill after a task changes files or fixes a defect, before code review, build/publish, interface verification, or git delivery.

## Quick Workflow

1. Collect diff context:

```powershell
.\.harness\scripts\collect-diff-context.ps1
```

2. Ask the deterministic selector for recommended gates:

```powershell
.\.harness\scripts\select-tests.ps1
```

3. Read `references/test-selection-policy.md`.
4. Read `references/command-policy.md` before running commands.
5. Run the recommended commands that apply to the change.
6. Define stable test cases with `criterionIds`, then record commands, results, current evidence path and SHA-256 in the phase `result.json`.
7. Write the human report using `.harness/templates/test-report.md`.

## Default Commands

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

## Rules

- Do not claim a gate passed without command output from the current worktree.
- Backend/data changes require backend tests.
- Frontend changes require frontend build.
- Harness/Skill/state changes require Harness structure validation.
- Every required criterion must be covered by at least one required test case.
- Unrelated passed tests and optional cases do not satisfy required criterion coverage.
- Required test results must be `passed` and their evidence hash must still match at apply time.
- Failed required commands, skipped/blocked required cases, missing results, or evidence drift block progression.
