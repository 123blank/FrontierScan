# Harness KB Integrity Fixes Plan

> Date: 2026-07-13
> Branch: `fix/harness-kb-review-followup`
> Status: Completed

## Goal

修复知识生成链路中已确认的三项完整性问题：局部 L2 不能误标全局完成、删除模块可以生成可执行刷新任务、`-WithEmbeddings` 能生成可消费的本地 JSONL 向量索引。

## Scope And Boundaries

- 仅修改 `.harness/scripts/**`、对应测试和本目录文档。
- 不修改 `backend/src/**`、`frontend/src/**` 或业务运行时链路。
- OpenAI 仅用于显式 `-WithEmbeddings` 的知识索引；不得读取、打印或写入 API Key。
- Embedding 调用失败或 Key 缺失时不阻断 L1/L2 生成，manifest 必须准确反映未生成状态。

## Implementation Tasks

### 1. Global Semantic Manifest Status

- [x] 在 `generate-kb.test.mjs` 新增回归：仅增强 `backend/article` 后，全局 manifest 的 `semantic_status` 仍为 `pending`，但本次命令结果仍为 `fresh`。
- [x] 运行该测试，确认旧实现错误写入 `fresh`。
- [x] 在 `generate-kb.mjs` 基于全部已发现模块的持久化 semantic 文档汇总 manifest 状态；不改变单次调用的 `result.semantic.status` 语义。
- [x] 重跑该测试和完整 `generate-kb.test.mjs`。

### 2. Deleted Module Refresh Fallback

- [x] 在 `kb-freshness.test.ps1` 新增回归：删除 `backend/article` 后，refresh task 必须使用 `-Area backend -Mode baseline`，且不得携带 `-Module article`。
- [x] 运行该测试，确认旧实现生成不可执行的模块级命令。
- [x] 在 `check-kb-freshness.ps1` 仅当候选模块目录仍存在时使用模块级刷新；否则回退为 Area 全量刷新。
- [x] 重跑删除回归和完整 `kb-freshness.test.ps1`。

### 3. Optional Embedding Generation

- [x] 在 `generate-kb.test.mjs` 新增成功、Key 缺失和 HTTP 失败三类回归。
- [x] 运行成功回归，确认旧实现返回 `disabled` 且未写入 JSONL。
- [x] 在 `generate-kb.mjs` 增加受控的 OpenAI Embeddings 批量调用和 JSONL 写入；manifest 仅在完整成功时声明 `fresh` 并指向该文件。
- [x] 重跑新增回归和完整 `generate-kb.test.mjs`。

### 4. Final Verification And Documentation

- [x] 执行所有 Harness 回归测试、结构校验、smoke flow、`git diff --check` 和工作区审计。
- [x] 写入 `REPORT.md`，记录 RED/GREEN 证据、实际接口契约和未触发真实 OpenAI 调用的说明。

### 5. Renamed Module Refresh Fallback

- [x] 在 `kb-freshness.test.ps1` 新增已暂存的跨目录模块重命名回归：refresh task 必须回退为 Area baseline，且不得携带新模块名。
- [x] 运行该测试，确认旧实现会生成 `-Module digest` 并保留旧模块索引块。
- [x] 在 `check-kb-freshness.ps1` 基于原始 Git status 行按 Area 识别重命名，重命名时禁用模块级刷新。
- [x] 重跑完整 freshness 回归，确认普通单模块变更仍保持模块级刷新。

### 6. Symbolic Link Exclusion

- [x] 在 `generate-kb.test.mjs` 新增回归：仓库外 Markdown 的 Common 文件链接不得进入 `chunks.json`。
- [x] 运行该测试，确认旧实现会索引链接目标的仓库外内容。
- [x] 在 `generate-kb.mjs` 的唯一递归文件遍历入口跳过符号链接。
- [x] 重跑完整生成器回归，确认静态提取、L2 和 Embedding 路径保持通过。

### 7. Root AGENTS.md Symbolic Link Boundary

- [x] Add generator and source-fingerprint regressions for a root `AGENTS.md` file link targeting repository-external content.
- [x] Run both regressions against the prior implementation and confirm the generator indexed the external marker while the Common fingerprint changed.
- [x] Reject symbolic-link roots in generator discovery, require a real non-link regular file for root `AGENTS.md`, and reject symbolic-link source entries during fingerprint collection.
- [x] Re-run the focused suites and retain all existing generator and fingerprint behavior.

### 8. Empty Area Cleanup

- [x] 新增回归：删除 Area 的最后一个模块后执行 Area baseline 刷新，旧 baseline/semantic chunk 必须全部清除。
- [x] 确认旧实现仍保留 backend chunk，完成 RED 验证。
- [x] 非模块级刷新按请求 Area 失效；仅为仍存在的模块保留 semantic chunk。
- [x] 空 Area 写入当前源指纹，并将 baseline/index 标记为 `fresh`。

### 9. Invalid Index Partial Refresh

- [x] 新增回归：`chunks.json` 损坏后执行 backend 局部刷新，缺失的 frontend 索引不得继续标记为 `complete`。
- [x] 确认旧实现产生 frontend chunk 为 0、指纹状态仍为 `complete` 的假阳性。
- [x] 基于全项目当前模块和实际 index chunk 重新计算各 Area 指纹状态，不再继承旧 manifest 完整性声明。
- [x] 重跑完整生成器测试，确认正常局部刷新仍保留未选 Area。

### 10. Empty Source Directory Exclusion

- [x] 新增 backend/frontend 空源目录回归，确认旧实现会生成空模块和无事实 chunk。
- [x] 模块发现器仅接纳至少包含一个受支持源文件的目录；读取失败文件仍保留在 coverage 诊断路径。
- [x] 重跑完整生成器测试，确认正常模块发现不退化。

### 11. Deleted Module Artifact Cleanup

- [x] 新增端到端回归：删除模块后 DryRun 必须列出删除计划，实际刷新必须清理自动生成文档和 facts。
- [x] 明确保留 `custom/`、`log.md` 和模块目录，不删除人工知识与历史日志。
- [x] 刷新完成后通过 `kb-query.ps1` 验证已删除模块不再从 Markdown fallback 返回。

### 12. Query Match Gate

- [x] 端到端删除回归暴露无关键词命中时仍按 doc type 加权并返回无关模块的问题。
- [x] 索引排序仅在至少一个查询词命中后应用全词、短语和模式权重。
- [x] 重跑生成器集成回归和独立查询测试。

### 13. Complete Module Doc-Type Validation

- [x] 新增局部刷新回归：未选 Area 的任一模块缺少基线 doc type 时，不得保留 `complete` 指纹状态。
- [x] 确认旧实现只校验模块存在和指纹一致，会将不完整模块误判为 `complete`。
- [x] 按 backend/frontend 各自完整基线 doc type 集合校验模块 chunk，并重跑生成器回归。

### 14. Fallback Freshness Reporting

- [x] 新增查询回归：空索引触发 Markdown fallback 时，仍必须报告 stale 原因和 freshness 警告。
- [x] 确认旧实现提前进入 fallback，绕过索引 freshness 诊断。
- [x] 将 freshness 计算和输出统一放到 index/fallback 分支之前，并重跑查询测试。

### 15. DryRun Deletion Visibility

- [x] 新增 PowerShell 入口回归：删除模块后的 DryRun 必须显示非零 `Planned deletes` 和零 `Deleted files`。
- [x] 确认旧 CLI 仅显示写入统计，无法审计删除计划。
- [x] 在文本输出中增加删除计划和实际删除计数，不改变 JSON 输出或删除执行逻辑。

### 16. Shared Source Refresh Convergence

- [x] 新增回归：单模块源码与 `application.yml` 同时变化时必须回退 Area baseline。
- [x] 确认旧实现执行模块刷新后仍保持 `partial`，并重复生成相同命令。
- [x] 仅当 Area 内全部变更源路径都属于同一受支持模块时允许模块级刷新。

### 17. Frontend Extension Contract

- [x] 新增 SCSS-only 目录回归，确认旧检查器生成了生成器无法执行的模块命令。
- [x] 新增 JavaScript-only 目录回归，确认 `.js` 模块仍应使用模块级刷新。
- [x] 将 freshness 支持集合统一为 `.ts/.tsx/.js/.vue/.css`。

### 18. Ingestion Failure Fail-Closed

- [x] 扩展源码读取失败回归，要求文档、Area meta 和 manifest 全部标记为 `partial`。
- [x] 新增后端共享资源读取失败回归，要求所有后端模块 fail-closed。
- [x] 将 sanitized ingestion failures 合并到模块完整性状态，并透传到文档与 index chunk。

## Acceptance Criteria

1. 部分模块 L2 成功时，manifest 不得声明全局 semantic `fresh`。
2. 已删除模块的 refresh task 始终可执行，并回退为对应 Area 的全量 baseline 刷新。
3. `-WithEmbeddings` 且存在 Key 时写入 `llm-knowledge/index/embeddings.jsonl`；无 Key 或 API 失败时不会引用该文件，且不影响基线生成。
4. 所有新增行为均先有失败回归测试，再有最小实现；现有 Harness 回归不得退化。
5. 删除 Area 最后一个模块后，不得残留该 Area 的 baseline 或 semantic chunk，freshness 必须能够收敛。
6. 索引缺失或损坏时，局部刷新不得把缺失 chunk 的未选 Area 标记为 `complete`。
7. 空源目录不得生成 backend/frontend 模块或 index chunk。
8. Area baseline 必须清理已删除模块的自动生成文件，同时保留 `custom/` 和 `log.md`。
9. 索引结果至少命中一个查询词，模式权重不得凭空制造无关结果。
10. 模块缺少任一预期基线 doc type 时，该 Area 的索引指纹状态必须为 `partial`。
11. Markdown fallback 不得绕过索引 freshness 状态、失败原因和风险警告。
12. 非 JSON DryRun 输出必须同时显示计划删除数和实际删除数，且不得执行删除。
13. Area 存在模块外共享源变更时不得生成模块级刷新，执行建议命令后 freshness 必须能够收敛。
14. freshness 与生成器必须使用一致的前端模块扩展名集合。
15. 任一源码或后端共享资源读取失败时，受影响文档和索引不得声明 `fresh/complete`。
