# FrontierScan Harness Architecture Adaptation

This document records the current FrontierScan adaptation toward a Harness Engineering workflow.

仓库已经具备结构契约、确定性辅助脚本、13 个项目 Skill、12 角色 Agent 注册表和分层知识生成器。M2 确定性状态运行时、M3 文件式 Dispatcher、M4-B 受约束 Mock Worker、M5-A 单 Worktree 创建、M5-B1 Worktree 内 Worker 分级回收和 M5-B2 单任务业务候选集成均已实现。真实 Agent、多任务/多 Worktree 波次、Fork-Join、合并/删除和 DevOps 闭环仍未实现。

## Added Structure

```text
.harness/
  schemas/
  states/
  outputs/
  workflows/
  templates/
  reports/
  scripts/
.codex/
  agents/
  skills/
llm-knowledge/
  backend/
  frontend/
  common/
docs/
  harness-m0-m1/
    PLAN.md
    REPORT.md
  harness-m4-runtime-compatibility/
    DESIGN.md
    PLAN.md
    REPORT.md
  harness-architecture-adaptation.md
```

## Responsibility Split

| Area | Purpose |
| --- | --- |
| `.harness/` | Runtime state, schemas, and generated workflow outputs |
| `.harness/workflows/` | Phase definitions for single-story E2E and product-level Fork-Join workflows |
| `.harness/templates/` | Standard output templates for requirements, design, review, testing, verification, and delivery |
| `.harness/scripts/` | Deterministic validators, planners, knowledge generator/query, freshness checks, smoke flow, and tests |
| `.codex/agents/` | Expert Agent role and responsibility registry; not an active runtime |
| `.codex/skills/` | 13 project-local Skill definitions with mixed implementation readiness |
| `llm-knowledge/` | Generated and curated structured knowledge consumed by current Codex work and future runtime workers |
| `docs/` | Human-facing architecture and planning docs |

## Current FrontierScan Adaptation

The Tencent article describes a Go/tRPC/internal-platform environment. FrontierScan is adapted as:

| Article concept | FrontierScan equivalent |
| --- | --- |
| Service knowledge documents | `llm-knowledge/backend/modules/<module>/*.md` for 7 backend modules |
| Frontend/admin knowledge | `llm-knowledge/frontend/modules/<module>/*.md` for 7 frontend modules |
| `meta.yaml` registry | `llm-knowledge/backend/meta.yaml`, `llm-knowledge/frontend/meta.yaml` |
| E2E state file | `.harness/states/e2e-state.template.json` |
| Product state file | `.harness/states/product-state.template.json` |
| DAG task planning | `.harness/schemas/task-dag.schema.json` |
| Workflow phase config | `.harness/workflows/e2e-development.yaml`, `.harness/workflows/product-fork-join.yaml` |
| Expert Agent registry | `.codex/agents/agents.yaml` |
| Project Skills | `.codex/skills/`, starting with `.codex/skills/frontier-common/` |

## Current Workflow Contracts

The single-story E2E workflow is defined in `.harness/workflows/e2e-development.yaml`:

```text
requirement
  -> technical-design
  -> task-dag
  -> implementation
  -> unit-test
  -> code-review
  -> build-publish
  -> interface-verification
  -> git-delivery
  -> done
```

The product-level workflow is defined in `.harness/workflows/product-fork-join.yaml`:

```text
breakdown -> forking -> joining -> done
```

These workflow files are structural contracts only. They do not execute automation yet.

## Current Agent Registry

`.codex/agents/agents.yaml` defines planned expert roles:

```text
product-analyst
requirement-analyst
task-planner
backend-developer
frontend-developer
code-fixer
unit-tester
test-case-designer
interface-verifier
code-reviewer
publisher
git-committer
```

The registry records responsibilities and file-modification boundaries. M3 uses these owners in structured task files, but the registry still does not launch Agent workers.

## Current Skill System

`.codex/skills/frontier-common/` is the shared project-local Skill definition. It centralizes:

- repository map
- Harness runtime conventions
- backend conventions
- frontend conventions
- review and test gates

The project-local Skill registry covers the planned MVP and extended workflow Skills:

```text
frontier-common
frontier-kb-generate
frontier-kb-query
frontier-kb-refresh-check
frontier-state-runner
frontier-requirement-breakdown
frontier-task-dag-planner
frontier-worktree-orchestrator
frontier-code-review-gate
frontier-test-gate
frontier-interface-verifier
frontier-build-publish
frontier-git-delivery
```

知识生成、查询、新鲜度检查、结构校验、M2 状态转换和 M3 单 Story 文件式派发均已有可执行 V1。需求、DAG、审核、验证、构建和交付 Skill 仍以确定性辅助脚本和流程指导为主。目标 Windows CLI 的项目 Skill 发现已通过 M4-A 验证，真实 Agent Worker 执行仍未实现。

`frontier-state-runner` now documents and exposes the implemented M2 workflow runtime for:

- phase model
- state update discipline
- state validation usage
- blocked-state rules

`frontier-kb-query` includes progressive query guidance and an index-first, Markdown-fallback query script:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode knowledge-qa -Area all
```

The query is index-first with Markdown fallback, mode/area-aware ranking, Common/Harness/Skill knowledge ingestion, and source/freshness metadata.

`frontier-kb-generate` now implements layered generation:

```powershell
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all -DryRun -Json
```

The generator produces L1 Markdown/facts, L2 OpenAI semantic documents with graceful degradation, and an L3 local index. Current output covers 7 backend and 7 frontend modules plus Common knowledge; the current chunk count is reported in `llm-knowledge/overview.md`. M1.1 records SHA-256 content fingerprints for area, module, document, chunk, metadata, and manifest isolation.

`frontier-kb-refresh-check` includes freshness guidance and a read-only metadata/source/index check:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
```

The check reports backend, frontend, and Common baseline/semantic/index status, missing manifests, and source-fingerprint mismatches so stale knowledge is not trusted silently. `git_hash` remains audit metadata; Git or working-tree state is not the freshness authority.

`frontier-requirement-breakdown` now includes basic decomposition guidance and references for:

- story shape
- clarification policy
- acceptance criteria quality
- mapping breakdown output into product/e2e state initialization fields

`frontier-task-dag-planner` now includes basic DAG planning guidance and references for:

- task node schema
- dependency edges
- parallel wave policy
- conflict/global-change policy
- a valid `.harness/templates/task-dag.example.json`

`frontier-worktree-orchestrator` now includes basic isolation planning guidance and a read-only DAG-to-worktree plan:

```powershell
.\.harness\scripts\plan-worktrees.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
```

The helper emits suggested branches, worktree paths, waves, and create commands, but does not create or modify worktrees.

`frontier-code-review-gate` now includes basic review guidance and references for:

- changed-file review scope
- backend/frontend/Harness review checklist
- BLOCKER/WARNING/NOTE severity policy
- conditional frontend UI review rules
- read-only diff context collection through `.harness/scripts/collect-diff-context.ps1`

`frontier-test-gate` now includes basic test selection guidance and references for:

- path-based test gate selection
- command execution rules
- test report result labels
- read-only gate recommendation through `.harness/scripts/select-tests.ps1`

`frontier-interface-verifier` now includes basic verification guidance and a read-only case derivation helper:

```powershell
.\.harness\scripts\derive-interface-cases.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
```

The helper turns task acceptance criteria into verification case drafts; concrete requests/actions still need environment-specific completion before execution.

`frontier-build-publish` now includes basic approval-gated build guidance and a read-only build plan:

```powershell
.\.harness\scripts\plan-build.ps1
```

The helper recommends backend/frontend/Docker build commands from changed paths, but does not publish or deploy.

`frontier-git-delivery` now includes basic approval-gated git delivery guidance and a read-only delivery summary:

```powershell
.\.harness\scripts\summarize-delivery.ps1
```

The helper separates default Harness-owned changes from unrelated dirty files, but does not stage, commit, push, or create PRs.

The Harness includes a non-destructive smoke flow that exercises the core helpers in sequence:

```powershell
.\.harness\scripts\smoke-harness-flow.ps1
```

The shared knowledge base now includes `llm-knowledge/common/conventions/quality-gates.md` so review/test gate questions can be found through progressive knowledge queries.

The shared knowledge base also includes `llm-knowledge/common/conventions/execution-verification.md` so worktree and interface verification questions can be found through progressive knowledge queries.

The shared knowledge base also includes `llm-knowledge/common/conventions/delivery.md` so build, publish, and git delivery questions can be found through progressive knowledge queries.

## Current Output Templates

`.harness/templates/` contains standard templates for:

- requirement breakdown
- technical design
- code review report
- test report
- interface verification report
- delivery report

These templates make future Skill and Agent outputs stable and parseable.

## M4-B 受约束 Mock Worker

M4-B 受约束 Mock Worker 已实现。`worker-runtime.mjs` 消费 M3 task Schema `1.0`，按 12 角色 JSON 策略加载显式 context，通过测试注入 provider 获取候选文件，并在身份、Schema、权限、路径和 2/8 MiB 限额全部通过后最后写入 `result.json`。provider 异常、最多 30 秒超时、越权或非法结果不会调用 M2/M3；只有显式 `apply` 才推进状态。

M4-B 不提供 mock CLI，不启动真实 Agent，也不把同进程 provider 声称为操作系统安全沙箱。M2/M3 继续独占固定 Adapter、证据门禁和状态推进。

## M5-B1 Worktree 内 Worker

M5-B1 通过内部 `runWorktreeWorker` 组合 M5-A 与 M4-B。它绑定当前 M3 prepared checkpoint、单任务 DAG 和 owner，按 manifest 把当前 run Harness 输入复制到已创建 Worktree，并直接使用固定 base 上的源码/文档上下文。Worker 完成后重新对账 Git 事实：只有 phase output 时写入主工作树正式 result 并返回 `ready-for-apply`；存在 backend/frontend 写入时不复制业务代码、不写正式 result，只返回 `ready-for-integration` 独立证据。

M5-B1 支持已授权 base context 的同路径候选更新、receipt 幂等复用、Provider 失败后的输入快照复用和 phase-output 回收恢复；`main-run` 与未声明候选的上下文保持不可变。没有 durable candidate list 的业务写入中断恢复失败关闭。Runtime 不提供 CLI，不创建/合并/删除 Worktree，也不调用 M3 `apply`。

## M5-B2 单 Worktree 业务候选受控集成

M5-B2 通过 `runWorktreeIntegration` 和 `run-worktree-integration.ps1` 消费 M5-B1 `ready-for-integration` 凭据。Plan 重新绑定 active state、M3 prepared task/checkpoint、单 pending DAG task、M5-A Git 事实和 M5-B1 receipt/manifest/result，并把业务候选、phase output 和正式 result 固化为 SHA-256 bundle。Status 不依赖 Worktree 长期存在，而是用主工作树 HEAD、Git 业务差异、Git 逻辑 base 和 candidate 哈希重建状态；Git 逻辑比较兼容 Windows checkout filter。

Apply 同时要求外部用户批准和 `ConfirmApply`，使用任务级独占锁及逐文件原子 rename，固定按业务文件、phase output、正式 `result.json`、integration receipt 写入。中断后已匹配 candidate 的文件跳过，未知内容失败关闭；Runtime 不自动回滚，也不调用 M3 `apply`。调用方只在 `ready-for-apply` 后显式执行一次 M3 apply。

M5-B2 仍只支持单 Worktree、单任务、单 dispatch；不执行 Git merge/remove、自动提交、真实 Agent、多任务聚合或并发 Apply。开发测试中的真实集成只发生在临时 Git 仓库。

## 下一步实施

下一阶段应先独立设计 M5-C 的单 Worktree 生命周期收尾或 M5-B3 的多任务协议，二者都不得默认引入并行执行。方案确认前不进入 Fork-Join、merge/remove、真实模型、发布、部署或 Git 自动交付。

## Safety Boundaries

- Do not let planning or review steps modify business code.
- Do not trust stale generated knowledge silently.
- Do not commit, push, or publish without explicit user confirmation.
- Do not overwrite unrelated dirty files.
- Keep B2B admin UI changes aligned with project UI guidelines.
