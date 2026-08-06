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
| L1 deterministic baseline | `fresh` | 7 backend modules, 7 frontend modules, and Common knowledge with Markdown + `facts.json` |
| L2 OpenAI semantic enrichment | `pending` | Mock success/failure/timeout/malformed/schema-invalid paths pass; no live API call has completed controlled acceptance |
| L3 local index | `fresh` | 328 generated and curated keyword/metadata chunks in `index/chunks.json` |
| Optional embeddings | `on-demand` | `-WithEmbeddings` writes source-fingerprinted JSONL vectors after successful OpenAI API calls; keyword/metadata retrieval remains the active consumer |

Current limitations:

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

Trust rule:

- Always inspect `baseline_status`, `semantic_status`, `index_status`, `source_fingerprint`, and source references.
- Treat L1 as traceable static facts and L2 as optional interpretation; verify security and business semantics against cited source files.
