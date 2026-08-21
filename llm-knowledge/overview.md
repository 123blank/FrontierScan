# FrontierScan Knowledge Overview

FrontierScan is a Spring Boot 3 + Vue 3 B2B admin system for collecting, organizing, and presenting technology and AI frontier website information.

Top-level areas:

| Area | Path | Notes |
| --- | --- | --- |
| Backend service | `backend/` | Spring Boot 3, Java 17, Maven, PostgreSQL, Redis, Flyway, Spring Security, JPA/MyBatis-Plus |
| Frontend admin | `frontend/` | Vue 3, TypeScript, Vite, Pinia, Vue Router, Axios |
| Operations docs | `docs/` | Architecture, local development, AI handover, Harness planning |
| Harness runtime | `.harness/` | State/DAG schemas, workflow contracts, templates, deterministic helpers, and tests |
| Project Skills | `.codex/skills/` | 13 project-local Skill definitions with mixed runtime readiness |

Progressive query entry points:

1. Backend work: start with `backend/meta.yaml`, then load the relevant backend module docs.
2. Frontend work: start with `frontend/meta.yaml`, then load route, component, API usage, and UI convention docs.
3. Cross-cutting work: start with `common/conventions/` and `common/tech/`.
4. Quality gate work: load `common/conventions/quality-gates.md`, then the relevant Skill references.
5. Execution and verification work: load `common/conventions/execution-verification.md`, then the relevant Skill references.
6. Build/publish/git delivery work: load `common/conventions/delivery.md`, then the relevant Skill references.

Current knowledge status:

| Layer | Status | Evidence |
| --- | --- | --- |
| L1 deterministic baseline | `fresh` | 2026-08-19 已重验 backend、frontend、common source fingerprint，均与当前工作区匹配 |
| L2 OpenAI semantic enrichment | `pending` | Mock success/failure/timeout/malformed/schema-invalid paths pass; no live API call has completed controlled acceptance |
| L3 local index | `fresh` | backend 与 frontend 基线刷新后已重建本地关键词和元数据索引；未来源码发生变化时仍须重新执行 freshness 检查 |
| Optional embeddings | `on-demand` | `-WithEmbeddings` writes source-fingerprinted JSONL vectors after successful OpenAI API calls; keyword/metadata retrieval remains the active consumer |

Current limitations:

以下条目按里程碑记录能力与阶段边界；较早条目中的“未实现”描述是该里程碑当时的范围，当前能力应以后续条目和最后的当前状态为准。

- Static extraction is intentionally bounded and reports unsupported root-level files in `source-coverage.json` instead of claiming full parser coverage.
- Semantic content remains `pending` until explicitly generated with an approved `OPENAI_API_KEY`.
- M2 deterministic phase advancement, evidence gates, block/resume, locks, and interrupted-write recovery are implemented for a single Story.
- M3 provides a file-based single-Story Dispatcher with structured task/result/checkpoint artifacts and fixed local command adapters. It does not launch real Agent workers or provide multi-Agent concurrency.
- M4-B provides a constrained Mock Worker that consumes M3 tasks, validates explicit context and role-scoped candidate files, and writes `result.json` last. It does not launch a real Agent or grant runtime tools.
- M5-A provides a single-Worktree `plan/status/create` Harness runtime with strict DAG wave/conflict validation, pinned `dev` commits, Git-fact reconciliation, explicit create confirmation, and temporary-repository recovery tests. It does not run Workers, merge, remove, or parallelize Worktrees.
- M5-B1 provides an internal single-task Worktree Worker orchestrator with explicit input snapshots, M3 checkpoint binding, Git-fact output reconciliation, and `ready-for-apply`/`ready-for-integration` collection. It does not integrate business code, call M3 `apply`, expose a mock CLI, or support multiple tasks or Worktrees.
- M5-B2 provides approval-gated `plan/status/apply` for one `ready-for-integration` result, using content-addressed bundles, base/candidate hash reconciliation, result-last writes, and per-file recovery. It does not call M3 `apply`, merge or remove Worktrees, execute Git writes, or support multiple tasks or Worktrees.
- M5-C provides approval-gated `retire` for one completed M5-B2 Worktree. It revalidates M5-A/M5-B1/M5-B2 evidence, main-tree and Worktree Git facts, and lifecycle locks before `git worktree remove --force`; it preserves the task branch and does not advance M2/M3 state. Multi-Worktree retirement, branch deletion, `prune`, and cleanup remain deferred.
- M5-B3-B 已实现同一 Story 的 `implementation` phase 单 Worktree 严格串行多任务批次：v1.1 task-scoped dispatch、serial batch ledger、继承快照、逐项 Worker/集成、批次收尾和 batch Retire 均受证据、哈希、锁与逐次审批约束。M3 `apply` 仍是唯一 phase 推进入口；同 wave 并行、多 Worktree、Fork-Join、分支清理、真实 Agent 和正式仓库 Worktree 操作仍未实现。
- M5-D-A 已实现同一合法 wave 的多 Worktree 只读 `WavePlan/WaveStatus`：统一固定 `baseCommit`，确定性派生每任务分支/路径，并从 Git 事实聚合 `absent/partial/ready`。它不提供 Worktree 创建、并行 Worker、合并、回收或状态推进；真实双 Worktree 只在临时 fixture 中验证。
- M5-D-B 在同一 Runtime 中增加审批门控 `WaveCreate`：每个明确 wave 的批准绑定当前 `plan.json` SHA-256；同一 run/Story 的所有 wave 共享创建/恢复锁，恢复在替换前重验完整锁集合、替换后匹配本次生成的随机 `lockId`，所有 Git、状态、回执和释放动作前重新执行计划与 owner fencing。恢复异常保留锁，部分失败保留已创建 Worktree并只补齐缺失项；动态锁事实只出现在 `WaveStatus` 命令结果顶层。首次 WavePlan 后，复用 WavePlan/WaveStatus 不再持久化动态观察，稳定状态只由持锁 WaveCreate 更新；完整 Git 事实为 `ready` 后才写绑定计划、DAG、稳定状态和任务 HEAD 的完成回执。正式仓库未执行 WaveCreate；并行 Worker、跨 Worktree 集成、合并、回收、Fork-Join 和状态推进仍未实现。
- M5-D-C1/C2 已实现单个完整 implementation wave 的执行与集成闭环：`prepare-wave` 生成 v1.2 dispatch、checkpoint、统一 owner 和 execution ledger；并行 Mock Worker 通过不可变 attempt 与 fencing 收敛到 ready。C2 原子冻结 integration manifest，按稳定任务顺序串行集成主树，保留 partial 前缀并显式恢复；`finalize-wave` 生成正式 phase 产物、wave receipt 和 checkpoint 绑定，既有 M3 `apply` 只推进一次并支持中断恢复。正式仓库未执行 Worker、Worktree 或候选写入；回收、真实 Agent、自动提交、推送和发布仍未实现。
- M5-D-D 已实现审批门控 `WaveRetire`：仅对 `done/completed`、ledger `finalized`、M3 apply 与正式产物完整的单个 wave 生效。它在首次删除前全局重验所有任务、主树、Worktree、保留分支和冲突锁，使用普通/recovery 双锁与 `lockId` fencing，按 WavePlan 顺序删除 Worktree，并在 Git 注册、目录和分支后验通过后写 task receipt。稳定 receipt 前缀支持中断恢复，最终回执绑定完成态、M3、Wave 与全部任务证据。首版保留分支，不执行 `prune`、自动提交、推送、发布或部署；真实删除仅在临时 fixture。
- M5-D-D 已以提交 `2b7269d57ad3a7f286faef707e5cd8d69ef4c558` 推送到 `origin/dev`，`M5-D-D-001` 为 `done/completed` revision `18`。当时规划的下一步是 M6-A 单业务开发闭环验收；该历史里程碑已经完成，其发现的问题已由 M7 继续加固。M6-A 不包含自动 Git 提交/推送、通用 M6 Engine、真实 Agent 自动派发、Fork-Join 或生产部署。
- M7-C 已实现 `technical-design` attempt 内的 relevant area freshness 检查、最小刷新、当前 source fingerprint 门禁、已有 result 的单 area recheck、可组合不可变 refresh receipt 和逐区域 `accepted-stale`。common 刷新显式保护 backend、frontend、common 三域；知识路径和生成器写入根目录拒绝 junction、symlink、仓库外 realpath 与 `..` 前缀绕过。
- M7-D 已通过异常 fixture 和 `M7-D-001` Dashboard 阅读状态筛选真实 Story。最终 State 为 `done/completed` revision `19`，真实 API/Chrome UI 覆盖五项 required criterion，交付准备认领 9 个业务文件并显式记录 2 个预测外返工文件。`verify-story-closure.ps1` 可仅读取 State 与绑定证据输出完整闭环摘要。
- M8-A 已接入首个真实只读 `code-reviewer` Provider。Runtime 通过 `role -> profile -> adapter/model` 配置冻结 Provider request、最小 context manifest、权限策略和模型来源，本机 `codex exec` 使用固定 argv、`read-only` sandbox 与结构化输出执行。最终真实 execution receipt 为 `completed/exitCode=0`，仓库与隔离根完整性检查通过；Agent 不返回 candidate files，正式 evidence、报告和 result 由 Runtime 生成。`M8-A-001` 最终为 `done/completed` revision `51`，五项 required criterion 均为 `verified`。其他角色、写入型 Provider、跨供应商 HTTP Adapter、并行和自动 Git 仍未实现；下一步是经用户批准后设计 M8-B。

Trust rule:

- Always inspect `baseline_status`, `semantic_status`, `index_status`, `source_fingerprint`, and source references.
- Treat L1 as traceable static facts and L2 as optional interpretation; verify security and business semantics against cited source files.
