---
name: frontier-requirement-breakdown
description: Break FrontierScan product or engineering requests into clarified stories, affected modules, reusable APIs, backend/frontend/data work, open questions, risks, and acceptance criteria. Use at the start of Harness-style development before technical design, task DAG planning, or implementation.
---

# Frontier Requirement Breakdown

Use this Skill at the beginning of non-trivial FrontierScan work.

## Quick Workflow

1. Read `frontier-common` project conventions if not already loaded.
2. Query knowledge before decomposing:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<request keywords>" -Mode requirement-breakdown -Area all
```

3. Read `references/clarification-policy.md` before asking questions.
4. Write the breakdown using `.harness/templates/requirement-breakdown.md`.
5. Shape stories with `references/story-template.md`.
6. Check acceptance criteria with `references/acceptance-criteria.md`.
7. Use `references/state-initialization.md` to map breakdown output to state initialization fields.

## Outputs

- `.harness/outputs/requirement-breakdown.md`
- Suggested product/e2e state initialization values

## Rules

- Do not implement during breakdown.
- Ask only blocking clarification questions.
- Every story must include acceptance criteria or an explicit discovery task.
- Surface stale or missing knowledge instead of hiding uncertainty.
- Call out likely backend, frontend, data, config, and test impact.
