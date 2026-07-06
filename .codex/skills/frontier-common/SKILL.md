---
name: frontier-common
description: Shared FrontierScan project conventions, repository map, Harness state schema, B2B admin UI rules, and backend/frontend guidance. Use before planning, implementing, reviewing, testing, or generating FrontierScan Harness workflow artifacts.
---

# Frontier Common

Use this project-local Skill as the first context layer for FrontierScan work.

## Load Order

1. Read `references/project-map.md`.
2. Read `references/harness-runtime.md` when state files, workflows, or Harness outputs are involved.
3. Read `references/backend-conventions.md` for backend changes.
4. Read `references/frontend-conventions.md` for frontend changes.
5. Read `references/review-and-test-gates.md` before final verification.

## Rules

- Treat `.harness/states/` as workflow state, not source code.
- Treat `llm-knowledge/` as AI-consumable project knowledge.
- Do not edit unrelated dirty files.
- Do not publish, push, commit, or stage files without explicit user approval.
- For frontend UI work, follow `docs/B2B_ADMIN_UI_GUIDELINES.md` if present.
