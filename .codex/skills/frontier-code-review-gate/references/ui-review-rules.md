# UI Review Rules

Use this reference only when frontend UI files changed.

## Source Of Truth

- If `docs/B2B_ADMIN_UI_GUIDELINES.md` exists, read and apply it.
- Otherwise, use existing local components, CSS, spacing, table, filter, dialog, and feedback patterns as the source of truth.

## Review Focus

- Create/new actions should use the existing page action pattern; if the local guideline requires a top-right primary dialog action, enforce that.
- Avoid inline create forms in list pages unless the existing page pattern already does that.
- Prefer table-driven workflows for operational admin screens.
- Keep filters, pagination, loading, empty, error, and success feedback consistent.
- Check that button text and table cell content do not overflow their containers.
- Avoid introducing a new visual system for a narrow task.

## Findings

Report UI issues as BLOCKER only when they break the workflow, hide critical data, or violate an explicit project guideline. Use WARNING for consistency or polish issues that still allow completion.
