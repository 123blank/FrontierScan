---
name: frontier-code-review-gate
description: Use when reviewing FrontierScan task-owned diffs for correctness, regressions, architecture drift, security risks, missing tests, or UI guideline violations before merge, build, publish, or delivery.
---

# Frontier Code Review Gate

Use this Skill after an implementation task has produced a diff and before build, publish, interface verification, merge, or delivery.

## Quick Workflow

1. Load `frontier-common` first for project boundaries.
2. Collect current diff context:

```powershell
.\.harness\scripts\collect-diff-context.ps1
```

3. Read `references/review-checklist.md`.
4. Read `references/severity-policy.md`.
5. Read `references/ui-review-rules.md` only when frontend UI files changed.
6. Inspect task-owned diffs and the minimum surrounding source needed to verify behavior.
7. Produce `.harness/reports/code-review-report.md` using `.harness/templates/code-review-report.md`.

## Output

- `.harness/reports/code-review-report.md`

## Rules

- Do not modify files while performing review.
- Findings must lead with risks and bugs.
- Every finding needs severity, file, line, evidence, impact, and required action.
- BLOCKER findings prevent build, publish, interface verification, and delivery.
- If no findings are found, state that explicitly and list residual test gaps.
- Call out unrelated dirty files without reviewing or reverting them.
- UI changes must be checked against local UI guidelines when present.
