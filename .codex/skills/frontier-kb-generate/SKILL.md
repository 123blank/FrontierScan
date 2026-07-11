---
name: frontier-kb-generate
description: Use when generating, refreshing, semantically enriching, indexing, or checking FrontierScan llm-knowledge from source code, docs, APIs, storage, frontend routes, OpenAI enrichment, or local chunks.
---

# Frontier KB Generate

Use this Skill when building or refreshing `llm-knowledge/` before planning, design, review, or verification.

Core model:

```text
L0 source truth -> L1 deterministic baseline -> L2 OpenAI semantic enrichment -> L3 local keyword/metadata index -> L4 dynamic consumption
```

## Quick Workflow

1. Read `references/kb-document-types.md`.
2. Read `references/manual-note-preservation.md`.
3. Read `references/module-detection.md`.
4. Generate or dry-run the layered knowledge artifacts:

```powershell
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all -DryRun
.\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all
.\.harness\scripts\generate-kb.ps1 -Area backend -Module article -Mode baseline
```

5. Use `OPENAI_API_KEY` and `OPENAI_MODEL` only for L2 semantic enrichment. The response must pass the generator's strict semantic schema.
6. Preserve all `custom/` notes and append generation notes to `log.md`.
7. Run freshness and query checks:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
.\.harness\scripts\kb-query.ps1 -Query "ArticleController" -Mode api-search -Area backend
```

## Outputs

- `llm-knowledge/backend/meta.yaml`
- `llm-knowledge/frontend/meta.yaml`
- Module-level knowledge documents
- Module-level `facts.json`
- Area-level `source-coverage.json`
- `llm-knowledge/index/chunks.json`
- `llm-knowledge/index/manifest.json`
- Append-only `log.md`
- Optional `.harness/reports/knowledge-input-scan.md`

## Layer Rules

| Layer | Source | Output | Failure behavior |
| --- | --- | --- | --- |
| L1 baseline | Source code, config, migrations, routes | Markdown + `facts.json` | Must be deterministic |
| L2 semantic | OpenAI Responses API with strict JSON Schema over bounded facts | `semantic.md` | Missing key, HTTP failure, timeout, malformed JSON, or invalid schema marks `semantic_status: pending/failed` |
| L3 index | Generated, Common, Harness, Skill, and manual Custom knowledge | `chunks.json`, `manifest.json` | Keyword/metadata index remains available without external services |

`-WithEmbeddings` is intentionally reported as `disabled` until a tested query-vector and cosine retrieval consumer exists. Do not generate write-only vectors.

## Safety Rules

- Do not overwrite manual `custom/` notes.
- Do not copy secrets.
- Do not read `.env`, shell history, private local config, or untracked secret files.
- Do not regenerate broad knowledge when the current task needs only one module unless asked.
- Mark generated docs as stale, partial, pending, or failed when source files changed or OpenAI enrichment is incomplete.
- OpenAI semantic enrichment is for knowledge generation only; it must not modify business code or perform delivery actions.
