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
- `generate-kb.ps1 -Area backend -Module article -Mode baseline` refreshes one module while preserving unrelated documents, metadata, logs, and index chunks.
- `check-kb-freshness.ps1 -WriteRefreshTask` explicitly writes `.harness/outputs/kb-refresh-task.json` for stale areas/modules; it never executes the task.
- `.harness/scripts/lib/source-fingerprint.mjs` is the shared SHA-256 freshness engine for Generator, Query, and Refresh Check. Source fingerprints are authoritative; `git_hash` is audit-only.
- Missing legacy fingerprints require one baseline refresh. Common source changes are repaired through `generate-kb.ps1 -Area all -Mode baseline`.
- `-WithEmbeddings` is accepted but returns `disabled` until vector retrieval is implemented and tested.
- Regression coverage lives in `tests/source-fingerprint.test.mjs`, `tests/harness-status.test.mjs`, `tests/generate-kb.test.mjs`, `tests/kb-query.test.ps1`, and `tests/kb-freshness.test.ps1`.
- Do not place business logic here.
- Scripts should read from the repository and write only `.harness/` artifacts when explicitly documented.
