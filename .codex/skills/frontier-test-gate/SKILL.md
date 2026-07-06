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
6. Record command results in `.harness/reports/test-report.md` using `.harness/templates/test-report.md`.

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
- Skipped tests require a recorded reason and risk.
- A failed required command blocks review, publish, interface verification, and delivery until fixed or explicitly accepted by the user.
