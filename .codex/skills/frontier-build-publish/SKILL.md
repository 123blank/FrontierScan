---
name: frontier-build-publish
description: Use when building, packaging, or planning approval-gated publishing for FrontierScan backend, frontend, Docker, or test-environment artifacts after tests and review pass.
---

# Frontier Build Publish

Use this Skill after test and review gates pass, before interface verification or delivery.

## Quick Workflow

1. Read `references/build-policy.md`.
2. Produce a read-only build plan:

```powershell
.\.harness\scripts\plan-build.ps1
```

3. Run only the non-publishing build commands that apply.
4. Read `references/artifact-policy.md` before recording artifacts.
5. Read `references/publish-policy.md` before any publish/deploy discussion.
6. Ask for explicit approval before publishing, deploying, pushing images, or modifying infrastructure.

## Outputs

- `.harness/reports/build-report.md`
- Build command records in E2E state files

## Safety Rules

- Do not publish without explicit user approval.
- Do not deploy to production from this scaffold.
- Failed builds block interface verification and delivery.
- Local Docker image creation is approval-required unless the user explicitly requested it.
