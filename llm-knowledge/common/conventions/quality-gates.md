# Quality Gate Conventions

FrontierScan Harness quality gates separate implementation from verification.

## Review Gate

Use `frontier-code-review-gate` after implementation and before build, publish, interface verification, merge, or delivery.

Core checks:

- Review task-owned diffs first.
- Separate unrelated dirty files from the current task.
- Report BLOCKER, WARNING, and NOTE findings with file, line, evidence, impact, and required action.
- Treat BLOCKER findings as delivery-stopping.
- Check frontend UI changes against local B2B admin UI guidelines when present.

Supporting helper:

```powershell
.\.harness\scripts\collect-diff-context.ps1
```

## Test Gate

Use `frontier-test-gate` after implementation or fixes.

Core checks:

- Backend or data changes require backend tests.
- Frontend changes require frontend build.
- Harness, Skill, Agent, schema, or state changes require Harness validation.
- Skipped or blocked gates require a reason and risk.

Supporting helper:

```powershell
.\.harness\scripts\select-tests.ps1
```

Default commands:

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

```powershell
.\.harness\scripts\validate-structure.ps1
```
