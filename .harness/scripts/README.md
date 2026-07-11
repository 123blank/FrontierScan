# Harness Scripts

This directory is reserved for deterministic workflow scripts.

Planned scripts:

```text
validate-state.ps1
validate-task-dag.ps1
select-tests.ps1
collect-diff-context.ps1
scan-knowledge-inputs.ps1
check-kb-freshness.ps1
generate-kb.ps1
plan-worktrees.ps1
derive-interface-cases.ps1
plan-build.ps1
summarize-delivery.ps1
smoke-harness-flow.ps1
```

Current status:

- `validate-state.ps1`, `validate-task-dag.ps1`, `validate-structure.ps1`, `kb-query.ps1`, `select-tests.ps1`, `collect-diff-context.ps1`, `scan-knowledge-inputs.ps1`, `check-kb-freshness.ps1`, `plan-worktrees.ps1`, `derive-interface-cases.ps1`, `plan-build.ps1`, `summarize-delivery.ps1`, and `smoke-harness-flow.ps1` are implemented as read-only helpers.
- `generate-kb.ps1` is a write-capable knowledge generator. It writes only under `llm-knowledge/`, supports dry-run, preserves `custom/` notes, and degrades OpenAI semantic enrichment when `OPENAI_API_KEY` is absent.
- Do not place business logic here.
- Scripts should read from the repository and write only `.harness/` artifacts when explicitly documented.
