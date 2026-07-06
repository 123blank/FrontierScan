---
name: frontier-git-delivery
description: Use when preparing FrontierScan git delivery at the end of a Harness workflow, including owned-change summaries, validation evidence, approval-gated staging, commits, pushes, and PR/MR descriptions.
---

# Frontier Git Delivery

Use this Skill only after tests, review, build, and required interface verification are complete or explicitly accepted.

## Quick Workflow

1. Read `references/git-delivery-policy.md`.
2. Read `references/owned-changes-policy.md`.
3. Produce a read-only delivery summary:

```powershell
.\.harness\scripts\summarize-delivery.ps1
```

4. Read `references/pr-summary-template.md` before drafting commit or PR text.
5. Ask for explicit approval before staging, committing, pushing, or creating a PR/MR.

## Outputs

- `.harness/reports/delivery-report.md`
- Commit and PR plan records in E2E state files

## Safety Rules

- Do not stage, commit, push, or create PRs without explicit user approval.
- Stage only task-owned files.
- Report unrelated dirty files.
- Do not rewrite history.
- Do not use delivery to hide failed, skipped, or blocked gates.
