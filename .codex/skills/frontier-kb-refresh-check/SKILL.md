---
name: frontier-kb-refresh-check
description: Use when checking FrontierScan llm-knowledge freshness before relying on generated knowledge for planning, implementation, review, testing, interface verification, or delivery.
---

# Frontier KB Refresh Check

Use this Skill before relying on `llm-knowledge/` for any non-trivial decision.

## Quick Workflow

1. Read `references/freshness-policy.md`.
2. Run:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
```

3. If stale knowledge affects the current task, read source files directly.
4. Read `references/refresh-task-policy.md` when creating refresh work.
5. Report stale/missing knowledge in the current state, plan, or `.harness/reports/`.

For an active State v2 `technical-design` attempt, use Story Runtime instead of manually copying terminal output:

```powershell
.\.harness\scripts\run-story.ps1 -Command check-knowledge -Area backend -Json
.\.harness\scripts\run-story.ps1 -Command refresh-knowledge -Area backend -Json
```

Only use `approve-stale` after the user explicitly accepts the named area and supplies a reason.

When an existing technical-design result is rejected because the current source fingerprint changed, run `check-knowledge` again for that area. The Runtime replaces only that area atomically; do not delete or hand-edit `result.json`.

Refresh receipts bind attempt-local content-addressed evidence copies. A common refresh protects backend, frontend, and common because the generator executes the existing all-area path.

## Outputs

- Freshness findings in `.harness/reports/`
- Refresh task records for `frontier-kb-generate`

## Safety Rules

- Do not silently trust stale knowledge.
- Prefer explicit stale/missing reports over broad regeneration.
- Preserve manual `custom/` notes.
- Freshness failures do not block work if source files are verified directly and the risk is recorded.
- Relevant stale/missing areas block State v2 technical-design until refreshed or formally accepted by the user.
