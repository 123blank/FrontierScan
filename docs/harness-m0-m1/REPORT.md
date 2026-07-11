# FrontierScan Harness M0 + M1 Implementation Report

> Date: 2026-07-11
> Scope: Harness, project Skills, generated knowledge, tests, and documentation
> Result: M0 baseline consolidation and M1 Knowledge Reliability V2 completed

## 1. Scope

This batch completed the M0 and M1 milestones in `docs/harness-m0-m1/PLAN.md`:

- Reconciled status documents, registries, and the structure manifest.
- Removed obsolete generated `application` and `web-admin` scaffolds after confirming that they contained no manual notes.
- Made knowledge query Mode/Area/Common-aware and freshness-visible.
- Deepened backend/frontend static facts and added module-scoped refresh.
- Added strict, mock-tested OpenAI semantic enrichment.
- Indexed generated, Common, Harness, Skill, and manual Custom knowledge.
- Disabled write-only Embeddings until a tested vector retriever exists.
- Added source coverage and explicit stale-module refresh-task JSON.

No backend or frontend business source behavior was changed.

## 2. TDD Evidence

| Capability | Observed red state | Green result |
| --- | --- | --- |
| M0 truth alignment | Status test found stale scaffold-era descriptions | Registry, overview, architecture, checklist, manifest, and handover agree |
| Nested TypeScript API generic | `method` was `undefined` for `ApiResponse<Page<Article>>` | Balanced scanner extracts method, URL, and response type |
| Controller facts | `handler` and signature fields were absent | Handler, return type, binding annotations, and security are structured |
| Transactions/resources | `transactional_methods` and resources were absent | Transactions, config, Flyway, and referenced `.stg` prompts are recorded |
| Module refresh | Refresh returned `article` and `auth` | `-Module article` rewrites only article while preserving other artifacts |
| PowerShell module entry | `-Module` silently refreshed both backend modules | Wrapper contract test proves argument forwarding |
| Semantic success | Injected fetch was ignored and status was `failed` | Structured Responses request and `generated_by: openai` document pass |
| Semantic aggregation | Later success overwrote an earlier failure | Overall status uses `failed > pending > fresh`, with per-module details |
| L1/L2 refresh isolation | Baseline refresh rewrote fresh Semantic content to pending and removed its chunk | Baseline and Semantic modes replace only their own documents/chunks |
| Embeddings | Explicit flag returned `pending` for a write-only path | Flag returns `disabled`; no JSONL or API call is produced |
| Real prompt templates | `.stg` resource was missing from facts | `prompt_template/*.stg` references are associated with the LLM module |
| Deep dependencies | Service/API/guard/page relations were undefined | Constructor dependencies, request/response types, guards, and page-to-API links pass |
| Source coverage | Unsupported files disappeared silently | `parsed_files`, `resource_files`, `skipped_files`, and `failed_files` are emitted |
| Refresh task | Freshness check did not write a task | Explicit switch writes a pending, module-aware JSON task without executing it |
| Query default root | Standalone command failed because `$PSScriptRoot` was empty during binding | Root resolution occurs after parameter binding and standalone invocation passes |
| Scoped baseline freshness | Refreshing one module made every module appear current | Refreshed modules use current hash; untouched changed modules retain their old hash and become stale |
| Dirty-source query freshness | Matching manifest hash made a dirty source tree appear fresh | Area-aware working-tree source changes make query freshness stale with an explicit reason |
| Semantic refresh repair | Failed L2 generated a baseline-only task that could not repair it | Semantic-only failures use `semantic`; mixed L1/L2 failures use `all` |
| Coverage read failures | A source read error aborted generation and `failed_files` stayed empty | Per-file failures are sanitized, recorded, excluded from parsed/skipped lists, and unaffected files continue |

## 3. Architecture Decisions

- L1 remains deterministic and traceable; unsupported files are reported rather than guessed.
- L2 uses injected fetch, an abort timeout, strict JSON Schema, local validation, and local Markdown rendering.
- Source files in semantic documents always come from L1 facts, not model claims.
- L3 remains a local keyword/metadata index. Curated knowledge is chunked by section and deduplicated by stable ID.
- Module refresh separates discovery scope from write scope so meta, coverage, logs, manual notes, and unrelated chunks remain intact.
- Refresh tasks are explicit artifacts. Freshness checking never edits source or automatically runs generation.
- Embeddings remain disabled until query-vector generation, similarity retrieval, fallback, and regression tests exist.

## 4. Before And After

| Area | Before | After |
| --- | --- | --- |
| Generated modules | 14 modules plus obsolete scaffold descriptions | 14 real modules; obsolete scaffolds removed |
| Frontend API extraction | Nested generics produced false negatives | 23 real API calls with template URLs and response types |
| Backend facts | Mapping/path-focused | Signatures, bindings, security, transactions, dependencies, config, migrations, prompts |
| Curated index | 105 generated-oriented chunks | 186 generated/Common/Harness/Skill chunks |
| Query | Flat ranking | Mode weights, exact/all-term bonuses, Common priority, freshness output |
| Semantic | Degradation only was verified | Success and all required failure modes are mock-tested |
| Embeddings | Could be generated but not consumed | Explicitly disabled |
| Freshness | Diagnostic report only | Diagnostic report plus optional module-aware refresh task |

## 5. Main Changed Files

- Generator and entry: `.harness/scripts/lib/generate-kb.mjs`, `.harness/scripts/generate-kb.ps1`
- Query/freshness: `.harness/scripts/kb-query.ps1`, `.harness/scripts/check-kb-freshness.ps1`
- Tests: `.harness/scripts/tests/*.mjs`, `.harness/scripts/tests/*.ps1`
- Skills: `.codex/skills/frontier-kb-generate/SKILL.md`, `.codex/skills/frontier-kb-query/SKILL.md`
- Contracts/docs: `.harness/structure-manifest.yaml`, `docs/harness-m0-m1/PLAN.md`, `docs/AI-handover.md`
- Generated artifacts: `llm-knowledge/backend`, `llm-knowledge/frontend`, `llm-knowledge/index`

## 6. Verification

The final verification set is:

```powershell
node .\.harness\scripts\tests\harness-status.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
git diff --check
```

Real-data checks also verify that `quality gate` ranks Common conventions first, actual frontend API facts are non-empty, backend resources include real configuration/migrations/prompts, and source coverage has no failed files.

Final fresh run result on 2026-07-11:

| Check | Result |
| --- | --- |
| Harness status regression | Pass |
| Generator regression | Pass |
| Query regression | Pass |
| Freshness/refresh-task regression | Pass |
| Actual freshness | Backend/frontend fresh; Semantic pending; Index fresh |
| Structure validation | Pass: 15 directories, 98 required files, 13 Skills |
| Harness smoke | Pass |
| Real API query | `interfaces` ranked first for `ArticleController` |
| Real frontend query | `views/components` ranked first for `dashboard` |
| Whitespace validation | `git diff --check` pass; line-ending notices only |
| Owned-file audit | Only `docs/prompt_template.md` remains unrelated |

## 7. Remaining Limitations

- Current generated semantic status is `pending`; a live OpenAI smoke requires an explicitly approved key/model.
- Static extraction is intentionally bounded and is not a full Java or TypeScript compiler frontend.
- Root-level source files that are outside module discovery are reported under `skipped_files`.
- Project Skills and Agent roles are still definitions/guidance, not an automatically dispatched runtime.
- Active state, atomic transitions, locks, resume, Agent dispatch, Worktree execution, deployment, and delivery automation remain M2+ work.

## 8. Business-Code Audit

This batch does not modify files under `backend/src` or `frontend/src`. The pre-existing unrelated `docs/prompt_template.md` remains untouched and untracked. No stage, commit, push, publish, deployment, branch deletion, or Worktree operation was performed.

## 9. Post-Review Remediation

Four code-review findings were resolved with isolated red-green regression tests:

1. Module-scoped and semantic-only runs no longer overwrite unrelated L1 freshness. Area metadata now aggregates module document hashes and reports `partial` when only part of an area matches the current revision.
2. `kb-query.ps1` checks area-relevant tracked and untracked working-tree source paths in addition to manifest/hash consistency. Generated backend/frontend/index artifacts are not treated as source changes.
3. Refresh-task mode is repairable by construction: L2-only failure produces `-Mode semantic`, L1/index/source failure produces `-Mode baseline`, and combined failure produces `-Mode all`.
4. Source scanning catches individual backend source, backend resource, and frontend source read failures. `source-coverage.json.failed_files` records `file`, `stage`, and a sanitized error code while generation continues for unaffected files.

Post-review real-project evidence:

| Check | Result |
| --- | --- |
| Generator/query/freshness/status regressions | Pass |
| Real baseline regeneration | Pass: 14 modules, 125 files written |
| Real backend coverage | 89 parsed source files, 14 resources, 2 skipped, 0 failed |
| Real frontend coverage | 18 parsed source files, 4 skipped, 0 failed |
| Backend/frontend freshness | Baseline fresh, Semantic pending, Index fresh |
| Structure validation | Pass: 15 directories, 98 required files, 13 Skills |
| Full Harness smoke | Pass |
| Business source audit | No changes under `backend/src` or `frontend/src` |

The Common query correctly reports stale while the current `.codex/skills` changes remain uncommitted. This is an explicit working-tree freshness signal, not a smoke-test failure.
