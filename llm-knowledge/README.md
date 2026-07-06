# FrontierScan LLM Knowledge

This directory is the project knowledge base for Harness-style AI workflows.

It is intentionally structured for progressive loading:

1. Load `overview.md` first.
2. Use `backend/meta.yaml` or `frontend/meta.yaml` to narrow the target module.
3. Load only the specific document types required for the current task.
4. Prefer `custom/` notes for manual business context and historical decisions.
5. Treat stale or missing knowledge as a planning risk.

Directory layout:

```text
llm-knowledge/
  README.md
  overview.md
  backend/
    meta.yaml
    modules/
      application/
  frontend/
    meta.yaml
    modules/
      web-admin/
  common/
    conventions/
      delivery.md
      execution-verification.md
      quality-gates.md
    tech/
```

Generated knowledge should preserve manual notes and append to `log.md` instead of overwriting history.
