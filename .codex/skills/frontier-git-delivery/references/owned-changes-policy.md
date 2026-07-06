# Owned Changes Policy

Owned files are files intentionally changed for the current Harness task.

## Default Harness-Owned Paths

- `.harness/**`
- `.codex/**`
- `llm-knowledge/**`
- `docs/harness*.md`
- `AGENTS.md` when Harness instructions are updated

## Unrelated Dirty Files

Do not stage or revert unrelated dirty files. Report them separately.

## Helper

Run:

```powershell
.\.harness\scripts\summarize-delivery.ps1
```

The helper is read-only and separates default Harness-owned changes from other dirty files.
