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
- Module-scoped refresh is emitted only when every changed source path in the Area belongs to that supported module; shared or root-level source changes fall back to an Area refresh.
- `.harness/scripts/lib/source-fingerprint.mjs` is the shared SHA-256 freshness engine for Generator, Query, and Refresh Check. Source fingerprints are authoritative; `git_hash` is audit-only.
- Generator ingestion failures are fail-closed: source and shared-resource read failures keep source coverage diagnostics while marking affected documents and index fingerprints `partial`.
- Missing legacy fingerprints require one baseline refresh. Common source changes are repaired through `generate-kb.ps1 -Area all -Mode baseline`.
- `generate-kb.ps1 -WithEmbeddings` is opt-in and uses `OPENAI_API_KEY` plus optional `OPENAI_EMBEDDING_MODEL` to write `llm-knowledge/index/embeddings.jsonl`. Missing keys or API failures report `pending` or `failed` without blocking baseline/index generation; cosine/vector retrieval remains a separate future consumer.
- Regression coverage lives in `tests/source-fingerprint.test.mjs`, `tests/harness-status.test.mjs`, `tests/generate-kb.test.mjs`, `tests/kb-query.test.ps1`, and `tests/kb-freshness.test.ps1`.
- Do not place business logic here.
- Scripts should read from the repository and write only `.harness/` artifacts when explicitly documented.
