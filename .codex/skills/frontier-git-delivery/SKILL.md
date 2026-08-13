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
.\.harness\scripts\summarize-delivery.ps1 -StateFile .harness/states/e2e-<storyId>.json
```

4. 在 `delivery-preparation` 阶段生成受控 owned manifest：

```powershell
.\.harness\scripts\run-delivery.ps1 -Command PrepareManifest -StateFile .harness/states/e2e-<storyId>.json
```

5. Story 完成后可只读记录 Git 事实；该命令不执行 Git：

```powershell
.\.harness\scripts\run-delivery.ps1 -Command Record -StateFile .harness/states/e2e-<storyId>.json
```

6. Read `references/pr-summary-template.md` before drafting commit or PR text.
7. Ask for explicit approval before staging, committing, pushing, or creating a PR/MR.

## Outputs

- `.harness/runs/<runId>/delivery/owned-manifest.json`
- `.harness/runs/<runId>/delivery/receipts/<receiptId>.json`
- 阶段 delivery report

## Safety Rules

- Do not stage, commit, push, or create PRs without explicit user approval.
- Stage only task-owned files.
- Report unrelated dirty files.
- Do not rewrite history.
- Do not use delivery to hide failed, skipped, or blocked gates.
- `done/completed` 不表示已经提交或推送；Git 事实进入独立 receipt，不修改 completed State。
