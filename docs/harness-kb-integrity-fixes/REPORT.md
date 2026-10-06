# Harness KB Integrity Fixes Report

> 历史记录说明：本报告描述的是当时的实现阶段，不作为现行 Embedding 配置指南。当前配置使用 `EMBEDDING_API_KEY`（未配置时回退到 `DASHSCOPE_API_KEY`）、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 和默认模型 `text-embedding-v4`；现行操作以 `.codex/skills/frontier-kb-generate/SKILL.md` 与 `.harness/scripts/README.md` 为准。

> Date: 2026-07-13
> Updated: 2026-07-14
> Branch: `fix/harness-kb-review-followup`
> Result: Completed

## Scope

This change fixes seventeen integrity defects in the Harness knowledge generation flow without modifying backend or frontend business code.

1. A partial L2 run could mark the global index manifest as semantic `fresh`.
2. A deleted module could produce a module-scoped refresh command that the generator could not execute.
3. A renamed module could preserve old index chunks while the refreshed index was marked `fresh`.
4. 历史问题：`-WithEmbeddings` 曾无法生成文档约定的可选 JSONL 向量索引。
5. Symbolic links could expose repository-external content to the local knowledge index and optional OpenAI calls.
6. A root-level `AGENTS.md` symbolic link could bypass the directory-entry link filter and expose repository-external content to the local knowledge index and optional OpenAI calls.
7. Deleting the last module in an Area left obsolete baseline and semantic chunks while retaining a complete fingerprint.
8. A partial refresh after a missing or malformed `chunks.json` could lose an unselected Area's chunks while inheriting its old `complete` fingerprint.
9. Empty backend/frontend source directories were discovered as valid zero-file modules and indexed as fresh knowledge.
10. Removed modules retained generated Markdown and facts that `kb-query.ps1` could consume through its fallback path.
11. Mode-specific rank bonuses could return index chunks even when no query term matched.
12. An unselected Area could remain `complete` even when a module was missing required baseline document types.
13. Markdown fallback could bypass index freshness diagnostics and hide an incomplete index from the consumer.
14. Text-mode DryRun output omitted planned deletion counts, preventing operators from auditing cleanup before execution.
15. A module source change combined with a shared Area source change could produce a module refresh command that never converged.
16. The freshness checker treated SCSS-only directories as modules even though the generator could not discover them, while omitting supported JavaScript-only modules.
17. Ingestion read failures were recorded in source coverage but affected documents and index fingerprints could still be published as `fresh/complete`.

## Delivered Changes

### Global L2 Status

`generate-kb.mjs` now derives `manifest.semantic_status` from the persisted semantic documents of every discovered backend and frontend module. `result.semantic.status` remains the outcome of the current invocation, so a successful `backend/article` or full-backend L2 request can be `fresh` while the global manifest remains `pending` until all modules are enriched.

### Deleted Module Refresh

`check-kb-freshness.ps1` now emits a module-scoped refresh only when the module still contains generator-supported source files. A deleted backend or frontend module falls back to its Area baseline refresh, allowing obsolete generated documents and index chunks to be removed.

### Renamed Module Refresh

`check-kb-freshness.ps1` now retains the raw Git status lines long enough to detect rename records for the affected Area. A rename uses the same Area baseline fallback as a deletion, so the old module's chunks are removed instead of being preserved by a refresh of the new module alone. Unrelated Areas and ordinary single-module edits still use the narrower module refresh.

### Optional Embeddings

该阶段首次实现了 `-WithEmbeddings` 的有界顺序请求，后续已完成百炼适配和配置隔离。当前行为如下：

- 密钥：`EMBEDDING_API_KEY`，未配置时回退到 `DASHSCOPE_API_KEY`。
- 端点：`EMBEDDING_BASE_URL`，默认使用阿里百炼 OpenAI 兼容端点。
- 模型：`EMBEDDING_MODEL`，默认 `text-embedding-v4`；`OPENAI_EMBEDDING_MODEL` 仅作为旧配置兼容兜底。
- 批量：每批最多 10 条，每条输入最多 8,000 个字符。
- 校验：发布前检查响应数量、响应索引、数值向量和 API 状态。
- 输出：`llm-knowledge/index/embeddings.jsonl`，每条记录包含分块 ID、模型、provider、向量、路径、源指纹和生成时间。
- 降级：缺少密钥时返回 `pending`；API、响应或超时失败时返回 `failed`；L1/L2 和 `chunks.json` 仍保持可用。

当前关键词和元数据查询仍是唯一启用的检索路径，余弦或向量检索消费者尚未实现。

### Symbolic Link Exclusion

The shared recursive file discovery function now ignores symbolic links before it can recurse into or read them. This applies to source, resources, Common knowledge, custom notes, Harness workflows, and project Skills. Root `AGENTS.md` now additionally requires a real non-link regular file before indexing, while source fingerprint collection rejects symbolic-link roots before it enumerates or reads them. Together these guards prevent repository-external content from being written to `chunks.json`, hashed into Common freshness, or sent to OpenAI by an optional embedding run.

### Empty Area Cleanup

Area-scoped baseline refresh now invalidates the requested Area even when module discovery returns no modules. Semantic chunks are preserved only for modules that still exist. A successfully refreshed empty Area therefore contains no generated module chunks, records the current empty-source fingerprint, and reports baseline/index `fresh` instead of preserving obsolete knowledge.

### Partial Refresh Integrity

Index fingerprint status is now recomputed from all currently discovered backend/frontend modules and the actual post-refresh chunks. A partial refresh can preserve and validate healthy unselected chunks, but a missing or malformed prior index leaves the affected unselected Area `partial` with a null fingerprint until its baseline is regenerated. Old manifest claims are no longer treated as proof of index completeness.

### Empty Directory Exclusion

Backend and frontend discovery now ignores directories with no supported source files. This prevents an empty package left behind after deleting its last file from being regenerated as a zero-file module with fresh placeholder knowledge.

### Deleted Module Artifact Cleanup

Full Area baseline refreshes now plan and remove only deterministic generated artifacts for modules that no longer exist: baseline Markdown, `semantic.md`, and `facts.json`. `custom/`, `log.md`, and the module directory remain intact. DryRun reports the planned deletions without changing the filesystem, and query fallback can no longer return removed generated knowledge after the refresh.

### Query Match Gate

The index ranker now requires at least one query term match before applying exact phrase, all-term, mode, or frontend bonuses. Mode preferences influence ordering among relevant chunks instead of manufacturing unrelated matches and suppressing Markdown fallback.

### Complete Module Doc-Type Validation

Index completeness now requires every discovered module to contain the full backend or frontend baseline document-type set with matching source fingerprints. Missing module documents therefore mark the Area `partial` and clear its indexed fingerprint instead of preserving a false `complete` result.

### Fallback Freshness Reporting

`kb-query.ps1` now evaluates and prints index freshness before choosing indexed retrieval or Markdown fallback. Fallback results retain the stale or invalid reason and include an explicit warning to verify matches against source files.

### DryRun Deletion Visibility

Text-mode generator output now reports both `Planned deletes` and `Deleted files`. A cleanup DryRun exposes a non-zero plan while confirming zero executed deletions; JSON output and deletion behavior are unchanged.

### Shared Source Refresh Convergence

The refresh checker now emits a module-scoped command only when every changed source path in the stale Area belongs to that module. Shared resources and root-level source files force an Area refresh, preventing repeated module refreshes that leave other module fingerprints stale.

### Frontend Extension Contract

The freshness checker now uses the generator's supported frontend module extensions: `.ts`, `.tsx`, `.js`, `.vue`, and `.css`. SCSS-only directories fall back to Area refresh, while JavaScript-only modules retain the narrower executable command.

### Ingestion Failure Fail-Closed

Sanitized discovery failures now participate in module completeness. Source-file failures affect their owning module, while backend shared-resource failures conservatively affect every backend module. Baseline frontmatter, index chunks, Area metadata, and manifest fingerprints remain `partial` until ingestion succeeds.

## TDD Evidence

| Capability | RED evidence | GREEN evidence |
| --- | --- | --- |
| Partial L2 manifest status | Expected `pending`, actual `fresh` for module and Area scopes | New module-scope and cross-Area regressions plus the full generator suite pass |
| Deleted module refresh | Generated `-Module article` after the source file was deleted | Refresh task falls back to `-Area backend -Mode baseline`; freshness suite passes |
| Renamed module refresh | Generated `-Module digest` after `article` was renamed | Refresh task falls back to `-Area backend -Mode baseline`; freshness suite passes |
| Embedding generation | 历史实现未生成向量文件 | Success, missing-key, and HTTP-429 regressions pass |
| Symbolic-link exclusion | Repository-external Markdown appeared in `chunks.json` | Linked content is absent from the generated index; generator suite passes |
| Root `AGENTS.md` link boundary | Root link indexed an external marker and changed the Common fingerprint | Generator and fingerprint suites reject the link and pass |
| Empty Area cleanup | Deleting the only Area source left 8 stale backend chunks and a `complete` fingerprint | Area refresh removes all obsolete chunks and records the current empty-source fingerprint |
| Invalid index partial refresh | A malformed index produced zero frontend chunks while retaining frontend `complete` | Missing frontend chunks produce `partial` and a null fingerprint; generator suite passes |
| Empty source directories | Empty backend/frontend folders appeared as modules and chunks | Empty folders are excluded; generator suite passes |
| Deleted module artifacts | Area refresh cleared index chunks but stale Markdown/facts remained queryable | Generated artifacts are removed, manual files remain, and the deleted symbol returns zero matches |
| Query match gate | An unmatched query returned four auth chunks solely from ranking bonuses | At least one term must match before ranking bonuses apply; query suite passes |
| Complete module doc types | A module with only overview and semantic chunks left its Area `complete` | Missing baseline doc types produce `partial` with a null fingerprint; generator suite passes |
| Fallback freshness | Empty `chunks.json` used Markdown fallback without any stale status or reason | Fallback output reports `stale`, the manifest mismatch, and a source-verification warning |
| DryRun deletion visibility | PowerShell DryRun output omitted `Planned deletes` entirely | Output reports a non-zero deletion plan and `Deleted files: 0`; generator suite passes |
| Shared source convergence | Article plus `application.yml` changes repeatedly produced the same module refresh and left backend `partial` | Shared source paths force `-Area backend -Mode baseline`; freshness suite passes |
| Frontend extension contract | SCSS-only modules produced unusable commands and JavaScript-only modules were widened to Area refresh | SCSS falls back to Area and JavaScript receives an executable module refresh |
| Ingestion fail-closed | A recorded `EACCES` still produced fresh documents and a complete backend manifest | Source and shared-resource failures produce partial documents, metadata, chunks, and fingerprints |

The deleted-module implementation was refined once after the initial GREEN attempt: an empty directory still existed after its last Java file was removed. The final guard checks for supported source files, matching the generator's module-discovery semantics.

## Knowledge Refresh

Ran a non-OpenAI module baseline refresh:

```powershell
.\.harness\scripts\generate-kb.ps1 -Area backend -Module article -Mode baseline
```

It wrote 13 affected knowledge artifacts, including the refreshed Common Skill chunk and index manifest. Final freshness reports backend, frontend, and Common as `fresh`; semantic enrichment remains `pending`, and embeddings remain `skipped` because no embedding generation was requested.

## Verification

All commands passed:

```powershell
node .\.harness\scripts\tests\source-fingerprint.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
git diff --check
```

No live OpenAI API request was sent during this change. Tests used injected mock responses, and the only real generator invocation used `-Mode baseline` without `-WithEmbeddings`.
