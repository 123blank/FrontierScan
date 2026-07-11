---
name: frontier-kb-query
description: Progressively query FrontierScan structured knowledge without dumping broad context. Use for requirement analysis, technical design, API discovery, business rule lookup, storage/config lookup, frontend route/component lookup, data-flow tracing, and implementation planning.
---

# Frontier KB Query

Use this Skill when a task needs FrontierScan project knowledge.

## Quick Workflow

1. Read `llm-knowledge/overview.md`.
2. Choose the narrowest `Mode` and `Area`.
3. Run the read-only query script:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode knowledge-qa -Area all
```

4. Load only the matched files that are relevant to the task.
5. Prefer `custom/` notes if present.
6. Verify the printed `Index freshness` line before relying on results.
7. Report stale, missing, or scaffold-only knowledge before relying on it.

## Query Modes

Read `references/query-modes.md` for mode selection.

## Loading Rules

Read `references/progressive-loading.md` before loading broad context.

The query ranker applies Mode-specific document weights, exact/all-term bonuses, Area filtering, and Common knowledge priority. `api-search` should favor `interfaces`; `frontend-ui-search` should favor frontend UI facts.

## Safety Rules

- Do not treat scaffold knowledge as complete implementation evidence.
- Do not load the whole repository when a knowledge file is enough.
- Do not silently ignore missing or stale knowledge.
- Do not copy secrets from configuration files into outputs.
