# Build Publish And Git Delivery Conventions

FrontierScan Harness delivery is approval-gated.

## Build Plan

Use `frontier-build-publish` after tests and review pass.

Supporting helper:

```powershell
.\.harness\scripts\plan-build.ps1
```

The helper recommends backend, frontend, Docker, or no-build gates from changed paths. It does not publish or deploy.

Rules:

- Failed builds block interface verification and delivery.
- Docker build or publish/deploy commands require explicit approval unless already requested.
- Record exact command output before claiming a build passed.

## Git Delivery

Use `frontier-git-delivery` only at the end of a Harness workflow.

Supporting helper:

```powershell
.\.harness\scripts\summarize-delivery.ps1
```

The helper separates default Harness-owned changes from unrelated dirty files. It does not stage, commit, push, create PRs, or rewrite history.

Rules:

- Stage only task-owned files after approval.
- Report unrelated dirty files.
- Do not hide failed, skipped, or blocked gates.
- Commit, push, and PR/MR creation require explicit approval.
