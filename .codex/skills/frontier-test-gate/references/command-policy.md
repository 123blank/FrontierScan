# Command Policy

Run commands from the current worktree and record exact results.

## Default Commands

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

```powershell
& D:\ProjectStudy\FrontierScan\.harness\scripts\validate-structure.ps1 -Root D:\ProjectStudy\FrontierScan
```

## Rules

- Do not treat stale terminal output as current verification.
- Prefer targeted tests first when available, then broaden if shared code changed.
- Do not publish, commit, push, or deploy as part of this gate.
- Stop on a required command failure and report the failure before moving to later gates.
- If the user asked for no file edits, do not write reports; summarize results in the response instead.
