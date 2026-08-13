# FrontierScan Codex 跨会话完整交接文档

> 适用仓库：`D:\ProjectStudy\FrontierScan`
>
> 快照日期：2026-08-13
>
> 维护目的：让新的 Codex 会话在不依赖旧聊天记录的情况下，尽可能准确地恢复项目事实、工作阶段、安全边界、用户习惯和下一步方向。
>
> 重要限制：新会话无法保证恢复旧会话的全部隐含上下文、临时推理、尚未写入文件的口头判断或工具运行缓存。恢复同一已保存线程最接近原会话；如果必须新建线程，应先读取本文件、`AGENTS.md`、Harness 状态和 Git 事实，再开始工作。

---

## 0. 新会话直接复制的启动提示词

在新的 Codex 会话窗口中，将工作目录设为 `D:\ProjectStudy\FrontierScan`，然后发送：

```text
请先恢复 FrontierScan 项目上下文，不要立即修改文件。

必须按以下顺序执行：
1. 完整读取仓库根目录 AGENTS.md。
2. 完整读取仓库根目录 CODEX-CROSS-SESSION-HANDOFF.md。
3. 检查 git status、当前分支、HEAD、origin/dev 与最近提交。
4. 读取 .harness/states/active-run.json，并校验其指向的状态文件。
5. 运行知识新鲜度检查，并针对当前任务使用最窄范围的 kb-query。
6. 检查当前运行时是否能发现 13 个 frontier-* 项目 Skill；如果实际运行时未发现，则按 AGENTS.md 手动读取匹配 Skill。
7. 先向我汇报：
   - 当前事实是否与交接文档一致；
   - 工作区是否有未提交或无关修改；
   - 当前 Harness 阶段；
   - 已完成能力、明确未完成能力；
   - 推荐的下一步以及为什么。

恢复规则：
- Git、Harness 状态、当前源码和新鲜知识优先于本文档中的历史快照。
- 发现不一致时不要静默选择，列出具体差异并以当前仓库事实为准。
- 非简单业务先设计和保存方案，再按 TDD 串行实施。
- 修改范围保持最小，不顺带重构无关代码。
- Review 必须只读；用户明确要求修复后才能修改。
- 未经我对本次具体操作的明确批准，不执行 git add、commit、push、PR、发布、部署、分支删除、Worktree 创建或回收。
- 对低风险实现细节优先采用你的推荐方案，不要反复让我选择；但影响业务语义、安全边界、外部状态或不可逆操作的不确定项必须与我确认。
```

如果新会话的目标已经明确，可以在上述提示词后追加：

```text
本次目标：<填写具体目标>
```

---

## 1. 恢复上下文时的事实优先级

发生冲突时，按以下顺序判断：

1. 当前 Git 工作区、当前文件内容和可重复命令输出。
2. `.harness/states/active-run.json`、目标 E2E 状态、事件日志和 `.harness/runs/<runId>/` 证据。
3. 根目录 `AGENTS.md` 及当前路径下更近的 `AGENTS.md` 或 `AGENTS.override.md`。
4. 当前 Story 的 `DESIGN.md`、`PLAN.md`、`REPORT.md`。
5. 通过新鲜度检查的 `llm-knowledge/`。
6. `docs/AI-handover.md`、架构文档和结构清单。
7. 本文件中的日期快照。
8. Codex Memories、旧聊天摘要或人的口头回忆。

原因：

- Harness 明确规定状态文件是长任务事实来源，对话历史不是。
- `llm-knowledge/` 只有在内容指纹匹配时才能作为可靠索引。
- 本文件用于恢复，不应覆盖比它更新的 Git 或运行状态。

---

## 2. 当前环境与 Git 快照

### 2.1 环境

| 项目 | 当前事实 |
| --- | --- |
| 操作系统 | Windows |
| Shell | PowerShell |
| 时区 | Asia/Shanghai |
| 仓库根目录 | `D:\ProjectStudy\FrontierScan` |
| 主要开发分支 | `dev` |
| 远程仓库 | `origin` → `https://github.com/123blank/FrontierScan.git` |
| 当前可执行 Codex | VS Code 扩展内 `codex.exe` |
| 本次检测版本 | `codex-cli 0.146.0-alpha.9.2` |
| 项目级 `.codex/config.toml` | 当前不存在 |

当前 PowerShell 中 `codex.cmd` 不在 `PATH`。本次实际检测命令使用：

```powershell
& 'C:\Users\czd\.vscode\extensions\openai.chatgpt-26.5727.51351-win32-x64\bin\windows-x86_64\codex.exe' --version
```

新会话不能假设扩展路径和版本保持不变，应重新运行：

```powershell
where.exe codex
Get-Command codex -ErrorAction SilentlyContinue
codex --version
```

### 2.2 Git 状态

生成本文件前的事实：

| 项目 | 值 |
| --- | --- |
| 当前分支 | `dev` |
| `HEAD` | `2b7269d57ad3a7f286faef707e5cd8d69ef4c558` |
| `origin/dev` | `2b7269d57ad3a7f286faef707e5cd8d69ef4c558` |
| ahead/behind | `0/0` |
| 工作区 | 本文件未跟踪；另有本次文档同步修改 |

最近关键提交：

```text
2b7269d feat(harness): add approval-gated wave retirement
a1f72ee feat(harness): add wave integration and finalization
5ab0f1e feat(harness): add parallel wave worker execution
47ac6bf feat(harness): add approval-gated wave worktree creation
853e2c6 docs(harness): sync M5-D-A delivery status
b6b95d9 feat(harness): add multi-worktree wave planning
```

本次文档同步完成且尚未提交时，预期工作区为：

```text
 M docs/AI-handover.md
 M docs/harness-architecture-adaptation.md
 M docs/harness-structure-checklist.md
 M llm-knowledge/overview.md
?? CODEX-CROSS-SESSION-HANDOFF.md
```

新会话必须实际运行以下命令，不得直接沿用本节：

```powershell
Set-Location D:\ProjectStudy\FrontierScan
git status --short --branch
git branch --show-current
git rev-parse HEAD
git rev-parse origin/dev
git rev-list --left-right --count origin/dev...dev
git log -8 --oneline --decorate
```

---

## 3. 项目业务概览

FrontierScan 是一个前后端分离的企业级 Web Agent/信息聚合系统，用于：

1. 管理技术和 AI 信息源、分类、RSS 地址与采集频率。
2. 通过 RSS/Atom 优先、HTML 降级的方式采集文章。
3. 使用 DashScope/Qwen 兼容接口生成标题优化、摘要、关键要点和标签。
4. 在 Vue 管理端提供信息看板、详情抽屉、筛选、收藏和继续阅读。
5. 按 `userId` 隔离站点、文章、分类和收藏数据。

技术栈：

| 层级 | 技术 |
| --- | --- |
| 后端 | Spring Boot 3.3.5、Java 17、Maven |
| 数据 | PostgreSQL、Flyway、Redis |
| 采集 | Rome RSS、Jsoup HTML |
| 安全 | Spring Security、JWT |
| LLM | DashScope compatible API / Qwen |
| 前端 | Vue 3、TypeScript、Vite、Pinia、Vue Router、Axios |
| 部署 | Docker Compose |

业务现状的详细权威入口：

- [AI 交接文档](docs/AI-handover.md)
- [架构说明](docs/architecture.md)
- [本地开发说明](docs/local-development.md)
- [Harness 架构适配](docs/harness-architecture-adaptation.md)

数据库迁移当前已记录到 `V10__make_article_source_hash_global_unique.sql`。新增迁移前必须重新列出真实目录，后续版本从当前最大编号继续递增，不得仅凭本文档猜测。

---

## 4. 当前 Harness 总体架构

### 4.1 目录职责

| 路径 | 职责 |
| --- | --- |
| `.harness/` | 状态、Schema、工作流、报告、模板、确定性 Runtime 和测试 |
| `.harness/states/` | E2E/Product 状态与活动运行指针；不是业务源码 |
| `.harness/runs/` | 每个 Story 的阶段产物、任务、结果、checkpoint 和证据 |
| `.codex/agents/` | 12 个角色注册表和 Worker 策略；注册表本身不等于真实 Agent |
| `.codex/skills/` | 13 个 FrontierScan 项目 Skill |
| `llm-knowledge/` | 结构化项目知识和本地检索索引 |
| `docs/` | 面向人的设计、计划、报告、架构和交接文档 |
| `backend/` | Spring Boot 业务源码与测试 |
| `frontend/` | Vue 业务源码与构建资产 |

### 4.2 单 Story 工作流

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

多 Story 产品工作流：

```text
breakdown -> forking -> joining -> done
```

注意：产品级 Fork-Join 的 YAML 契约存在，但真正的自动多 Story 并行、自动合并与交付尚未实现。

---

## 5. 已完成的 Harness 能力

### 5.1 M0/M1：结构与知识工程

已具备：

- Harness 目录、Schema、工作流、模板、报告和结构清单。
- backend、frontend、common 的确定性知识生成、源文件内容指纹和本地索引。
- 知识查询、新鲜度检查、模块级或区域级刷新任务生成。
- `custom/` 人工知识保留机制。

2026-08-04 新鲜度检查结果：

| 区域 | baseline | semantic | index | 当前判断 |
| --- | --- | --- | --- | --- |
| backend | fresh | pending | fresh | L1/L3 可用，语义增强未完成真实验收 |
| frontend | fresh | pending | fresh | L1/L3 可用，语义增强未完成真实验收 |
| common | fresh | pending | fresh | L1/L3 可用，语义增强未完成真实验收 |

知识是检索入口，不是对安全和业务语义的最终替代；关键结论仍需核验源码或状态证据。

### 5.2 M2：确定性状态运行时

入口：

```text
.harness/scripts/run-state.ps1
.harness/scripts/lib/state-runtime.mjs
```

能力：

- `init/status/validate/record/next/block/resume/complete`
- 单 Story 状态推进
- 证据和 SHA-256 绑定
- 独占锁
- 原子 JSON 写入
- JSONL 审计事件
- 临时文件、备份和中断恢复
- 失败质量门禁阻止阶段推进

M2 是状态推进的唯一权威层之一。不得手工修改 phase 或 revision。

### 5.3 M3：单 Story 文件式 Dispatcher

入口：

```text
.harness/scripts/run-story.ps1
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/lib/dispatch-contract.mjs
```

能力：

- v1.0 单任务 `prepare/status/run-adapter/apply`
- `task.json/result.json/checkpoint.json`
- 固定本地 Adapter
- 有界 stdout/stderr
- 证据哈希校验
- 幂等 apply 与状态推进恢复
- v1.1 task-scoped batch dispatch 兼容入口

边界：

- M3 不启动真实 Agent。
- M3 `apply` 仍是正式 phase 推进的唯一入口。
- Worker、Worktree Runtime 不能直接修改 M2/M3 状态。

### 5.4 M4-A：Codex Skill 运行时兼容性

历史实测：

- Windows `codex-cli 0.144.1`
- 仓库内连续 3 次发现一致的 13 个 `frontier-*` Skill
- 仓库外负向对照发现 0 个
- 当时全部 locator 指向 `.codex/skills/<name>/SKILL.md`

当时决策：保留 `.codex/skills`，不复制、不迁移、不引入 Plugin。

当前注意：

- OpenAI 现行公开文档推荐 repo Skill 放在 `.agents/skills`。
- 本项目旧 CLI 兼容性证据只覆盖 `0.144.1`。
- 当前检测到的 Codex 是 `0.146.0-alpha.9.2`。
- 当前会话确实发现了 13 个项目 Skill，但还没有为新版本重新执行完整的三次正向和仓库外负向兼容性测试。

因此，新会话可继续使用当前可见 Skill，但如果要修改 Skill 安装布局或升级正式目标 Runtime，必须先重新做 M4-A 式兼容性验证，不能直接迁移。

### 5.5 M4-B：受约束 Mock Worker

入口：

```text
.harness/scripts/lib/worker-runtime.mjs
.codex/agents/worker-policies.json
```

能力：

- 消费 M3 task
- 12 个角色策略一一对应
- 显式 context 文件
- 角色级读写路径与 capability 门禁
- 单文件 2 MiB、总量 8 MiB
- Provider 最长 30 秒
- 全量预检后写候选
- `result.json` 最后写入
- 非法输出不污染状态
- 中断后显式重试恢复

边界：同进程 mock provider 是测试依赖注入边界，不是针对恶意代码的操作系统沙箱，也不等于真实 Codex Agent。

### 5.6 M5-A：单 Worktree 计划、状态、创建

入口：

```text
.harness/scripts/run-worktree.ps1
.harness/scripts/lib/worktree-runtime.mjs
```

能力：

- 单任务 `Plan/Status/Create`
- Task DAG 共享安全契约
- 固定 `dev` commit SHA
- 确定性分支和路径
- Git 事实对账
- 脏主树、基准漂移、分支冲突和路径逃逸拒绝
- 幂等创建和受限恢复
- 用户批准 + `-ConfirmCreate`

正式仓库创建 Worktree 仍需每次单独批准。

### 5.7 M5-B1：Worktree 内 Worker

能力：

- 将 M5-A Worktree、M3 checkpoint 与 M4-B Worker 组合。
- 固化输入 manifest 和继承快照。
- 校验 `predictedFiles` 和 Git 事实。
- 仅 phase output 时返回 `ready-for-apply`。
- 存在业务源码候选时返回 `ready-for-integration`。
- Provider 失败后可复用输入快照重试。

边界：不创建、合并或删除 Worktree，不执行 M3 `apply`，不提供真实 Worker CLI。

### 5.8 M5-B2：单 Worktree 候选受控集成

入口：

```text
.harness/scripts/run-worktree-integration.ps1
.harness/scripts/lib/worktree-integration-runtime.mjs
```

能力：

- `Plan/Status/Apply`
- SHA-256 内容寻址 bundle
- 主工作树、base、candidate 哈希对账
- 用户批准 + `-ConfirmApply`
- 逐文件原子写入与恢复
- 业务文件、phase output、正式 `result.json`、receipt 固定顺序

边界：不调用 M3 `apply`，不执行 Git merge/remove，不自动提交。

### 5.9 M5-C：单 Worktree 生命周期回收

能力：

- `Retire`
- 重新验证 M5-A/M5-B1/M5-B2 完整证据链
- 校验主树、任务分支、Worktree HEAD、已知变更与生命周期锁
- 用户批准 + `-ConfirmRetire`
- 固定 argv 执行 `git worktree remove --force`
- Git 成功但回执未写入时受限恢复

边界：

- 保留任务分支。
- 不执行 `git worktree prune`。
- 不调用 M3 `apply`。
- 不自动合并、提交或推送。

### 5.10 M5-B3-A/M5-B3-B：单 Worktree 严格串行多任务

M5-B3-A 先确认 v1.0 phase 级 dispatch 不能安全地直接循环多任务。

M5-B3-B 已实现：

- v1.1 task-scoped dispatch
- serial batch ledger
- 确定性任务顺序
- 每次只 claim 一个任务
- 前序已集成候选继承快照
- 每任务独立 Worker、集成回执和 checkpoint
- 所有任务集成后才能 `finalize-batch`
- 正式工件 `finalizationArtifacts` 证据链
- M3 `apply` 只推进一次
- batch Retire
- 锁、并发拒绝和中断恢复

核心提交：

```text
e3d77a4 feat(harness): add serial multi-task batch runtime
```

边界：仍是一个 Worktree 内的严格串行批次，不是同 wave 多 Worktree 并行。

### 5.11 M5-D：单 Wave 多 Worktree 完整生命周期

M5-D-A 至 M5-D-D 已完成并推送到 `origin/dev`。

能力：

- M5-D-A：`WavePlan/WaveStatus` 固定统一 `baseCommit`，稳定派生任务分支和 Worktree 路径，并从 Git 事实聚合状态。
- M5-D-B：审批门控 `WaveCreate`，计划哈希批准、共享创建/恢复双锁、`lockId` fencing、部分失败保留和受控恢复。
- M5-D-C1：`prepare-wave`、v1.2 task/checkpoint、统一 implementation owner、不可变 attempt 和并行 Mock Worker 执行。
- M5-D-C2：integration manifest 原子冻结、主树稳定顺序串行集成、partial 前缀恢复、wave receipt、`finalize-wave` 和 M3 `apply` 单次推进。
- M5-D-D：仅对完整 `done/completed` 证据链开放的审批门控 `WaveRetire`，按稳定顺序回收 Worktree，并支持精确回执前缀恢复。
- 全链路对 DAG、计划、基准、主树、任务分支、Worktree、候选、锁、回执、M3 checkpoint 和正式产物执行哈希绑定与漂移拒绝。

核心提交按阶段为：

```text
b6b95d9 feat(harness): add multi-worktree wave planning
853e2c6 docs(harness): sync M5-D-A delivery status
47ac6bf feat(harness): add approval-gated wave worktree creation
5ab0f1e feat(harness): add parallel wave worker execution
a1f72ee feat(harness): add wave integration and finalization
2b7269d feat(harness): add approval-gated wave retirement
```

边界：

- 正式 FrontierScan 仓库未执行真实 `WaveCreate`、Worker、候选集成或 `WaveRetire`；真实 Git 副作用只在临时 fixture 验证。
- Worker 仍是受约束 Mock provider，不是真实 Codex Agent，也不是恶意代码的操作系统安全沙箱。
- 首版回收保留任务分支，不执行 `git worktree prune`。
- 不自动暂存、提交、推送、创建 PR、发布或部署。

---

## 6. 当前 Harness 状态

活动指针：

```text
.harness/states/active-run.json
```

当前指向：

| 字段 | 值 |
| --- | --- |
| runId | `M5-D-D-001` |
| stateFile | `.harness/states/e2e-M5-D-D-001.json` |
| status | `completed` |
| revision | `18` |

目标状态：

| 字段 | 值 |
| --- | --- |
| storyId | `M5-D-D-001` |
| phase | `done` |
| runtime.status | `completed` |
| runtime.revision | `18` |
| previousPhase | `git-delivery` |
| review.status | `passed` |

阶段产物完整存在：

```text
.harness/runs/M5-D-D-001/phases/00-requirement/requirement-breakdown.md
.harness/runs/M5-D-D-001/phases/01-technical-design/technical-design.md
.harness/runs/M5-D-D-001/phases/02-task-dag/task-dag.json
.harness/runs/M5-D-D-001/phases/03-implementation/implementation-notes.md
.harness/runs/M5-D-D-001/phases/04-unit-test/test-report.md
.harness/runs/M5-D-D-001/phases/05-code-review/code-review-report.md
.harness/runs/M5-D-D-001/phases/06-build-publish/build-report.md
.harness/runs/M5-D-D-001/phases/07-interface-verification/interface-verification-report.md
.harness/runs/M5-D-D-001/phases/08-git-delivery/delivery-report.md
```

当前没有尚未完成的活动 Story。不要继续修改 `M5-D-D-001` 的完成态。

新会话校验命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command status `
  -Json

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command validate `
  -StateFile .\.harness\states\e2e-M5-D-D-001.json
```

---

## 7. 明确尚未实现的能力

新会话不得把以下内容描述为“已完成”：

- 自动冲突解决
- Fork-Join 真实运行时
- 自动删除任务分支
- 自动 `git worktree prune`
- Worktree 自动复用或遗留资产自动清扫
- 真实 Codex Agent provider
- 恶意 Worker 的操作系统级隔离
- 真实模型驱动的自动业务开发闭环
- 正式仓库中的真实 WaveCreate、Worker、候选集成和 WaveRetire 执行
- 真实发布、部署和环境交付
- 无审批 Git add/commit/push/PR

低概率边界仍包括断电级 fsync、多文件全局事务、进程崩溃遗留锁自动回收和非 Windows 平台差异。当前阶段通常只记录，不应为它们过度设计。

---

## 8. 推荐下一步

下一项独立业务应是：

```text
M6-A：单业务开发闭环验收
```

目标是选择一个范围较小、验收标准明确的真实业务任务，使用现有 Harness 完成一次从需求到验收的完整闭环，而不是继续扩展通用 Worktree Runtime。

推荐首版范围：

1. 选择一个真实业务任务，实际修改 `backend/`、`frontend/` 或二者关联代码。
2. 使用现有 E2E 工作流推进到 `done/completed`，不得手工编辑 State。
3. 执行与修改范围匹配的真实测试、构建和 API/UI 验证，并保存可复核证据。
4. 验证中断后能从 State 与阶段产物继续，不依赖旧聊天记录。
5. 发现缺口时只补该业务闭环所需的最小 Adapter，不预先实现通用 M6 Engine。
6. Git 暂存、提交、推送和 PR 继续逐次由用户明确批准，不纳入自动闭环。
7. 暂不引入真实 Agent 自动派发、多 Story Fork-Join、生产发布部署或自动分支清理。

M6-A 通过后，再根据真实业务闭环暴露出的缺口决定 M7 稳定性加固或真实 Agent 接入范围。

---

## 9. 用户长期工作偏好

### 9.1 方案与实现

- 非简单业务先梳理需求、现状、影响范围和其它业务流程。
- 优先检查本地已有实现，保持现有业务和 Harness 风格。
- 先保存 `DESIGN.md` 与 `PLAN.md`，实施完成后保存 `REPORT.md`。
- 一个业务完整开发、测试、优化和 Review 后，再进入下一个业务。
- 默认使用 TDD：先 RED，再最小 GREEN，再重构和范围审核。
- 只做当前需求所需的最小修改，不顺带重构无关代码。
- 需要优化稳定性，避免上线后崩溃和状态污染。
- 极小概率、当前阶段不值得处理的边界写入报告，不阻塞主流程。

### 9.2 决策方式

- 对低风险、可逆、实现层面的选择，优先给出推荐并按推荐方案推进。
- 用户已经多次表达“接下来按推荐方案选择”，因此不要为细枝末节反复询问。
- 对以下事项不能自行决定：
  - 改变业务语义或验收标准
  - 扩大写入范围
  - 引入新依赖或新运行时
  - 安全或权限边界
  - 外部系统和真实环境变更
  - 发布、部署和 Git 交付
  - 破坏性操作或不可逆操作

### 9.3 Review 与修复

- 用户经常先要求 Review，再要求修复发现的问题。
- Review 阶段只读，不应顺手修改。
- Findings 应少而准确，聚焦可复现的稳定性、正确性、安全和近期扩展问题。
- 修复后重新运行受影响测试并再次 Review。
- 目标是没有影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING`。
- 不因理论极端情况、风格偏好或推测性需求阻塞交付。

### 9.4 沟通风格

- 使用中文。
- 先给结果，再解释关键原因。
- 工具执行期间提供简短进度更新，不要长时间沉默。
- 明确区分事实、推断、建议和待确认事项。
- 不声称未运行的测试通过，不声称注册表角色已经自动调度。
- 如果出现错误，先说明真实原因和影响，再继续处理。

---

## 10. 强制安全与批准边界

即使旧会话中曾批准过类似动作，也不能把批准自动沿用到新的操作。

每次执行前必须重新获得明确用户批准：

- `git add`
- `git commit`
- `git push`
- 创建 PR/MR
- 打标签
- 发布或部署
- 创建、回收或删除正式仓库 Worktree
- 删除分支
- `git reset`、`git clean`、历史改写
- 修改外部服务或生产数据

用户直接说“提交本次修改”“先推送”“允许回收这个 Worktree”等，才构成本次具体操作的批准。

不得：

- 使用 `git add .` 混入无关文件。
- 覆盖或还原用户已有的无关修改。
- 为了让工作区干净而删除不明文件。
- 将测试 fixture 中的 Git 操作理解为正式仓库授权。

---

## 11. 任务分类与默认处理方式

| 类型 | 默认处理 |
| --- | --- |
| `question` | 只读查询本地文档、知识、Harness 和源码，不修改 |
| `harness-structure` | 只改 Harness、Skill、Agent、状态、文档或知识资产 |
| `business-implementation` | 先查知识和状态，再按 TDD 修改 backend/frontend |
| `review` | 只读检查差异并报告，不修复 |
| `test-or-verification` | 运行范围最小且有效的验证命令 |
| `delivery` | 总结 owned changes；Git 外部状态动作逐次审批 |

非简单修改前，先用三行左右说明：

```text
1. <步骤> -> 验证：<命令或证据>
2. <步骤> -> 验证：<命令或证据>
3. <步骤> -> 验证：<命令或证据>
```

---

## 12. Skill 与 Agent 恢复规则

### 12.1 13 个项目 Skill

```text
frontier-build-publish
frontier-code-review-gate
frontier-common
frontier-git-delivery
frontier-interface-verifier
frontier-kb-generate
frontier-kb-query
frontier-kb-refresh-check
frontier-requirement-breakdown
frontier-state-runner
frontier-task-dag-planner
frontier-test-gate
frontier-worktree-orchestrator
```

任务开始应先使用 `frontier-common`，再按任务类型选择最小必要 Skill。

如果新会话的 Available skills 中没有对应 `frontier-*`：

1. 不得声称 Skill 已自动触发。
2. 手动完整读取 `.codex/skills/<skill>/SKILL.md`。
3. 只读取该 Skill 直接要求的相关 reference。
4. 继续按同样规则执行。

### 12.2 12 个 Agent 角色

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

`.codex/agents/agents.yaml` 是职责注册表，不是自动运行证据。

当前 M4-B Worker 策略与 12 个角色一一对应，但真实 Codex Agent provider 尚未接入。新会话不得说“已自动派发给 backend-developer”等，除非当前运行时确实执行了可验证的 Agent 调度。

---

## 13. 新会话标准恢复检查

### 13.1 仓库与 Git

```powershell
Set-Location D:\ProjectStudy\FrontierScan
git status --short --branch
git log -8 --oneline --decorate
git rev-list --left-right --count origin/dev...dev
```

### 13.2 Harness 状态

```powershell
Get-Content .\.harness\states\active-run.json -Encoding UTF8

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command status `
  -Json
```

如果活动指针改变，必须读取新的目标状态和最新 Story 文档，本文件的 M5-D-D 状态只作为历史快照。

### 13.3 知识新鲜度

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\check-kb-freshness.ps1
```

按当前任务查询：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\kb-query.ps1 `
  -Query "<关键词>" `
  -Mode knowledge-qa `
  -Area all
```

需要时使用更窄的 Mode：

- 需求拆解：`requirement-breakdown`
- 技术设计：`technical-design`
- API：`api-search`
- 前端 UI：`frontend-ui-search`
- 数据流：`data-flow-trace`

### 13.4 结构和变更范围

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-structure.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\select-tests.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\summarize-delivery.ps1
```

---

## 14. 常用测试与验证命令

### 14.1 Harness

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\tests\task-dag.test.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-structure.ps1

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\smoke-harness-flow.ps1

git diff --check
```

### 14.2 后端

```powershell
Set-Location D:\ProjectStudy\FrontierScan\backend
mvn test
```

### 14.3 前端

```powershell
Set-Location D:\ProjectStudy\FrontierScan\frontend
npm run build
```

不要无条件运行全部命令。先使用 `select-tests.ps1` 和 touched paths 选择最小有效门禁。

---

## 15. 本地运行资产处理规则

`.gitignore` 已忽略下列本地运行资产：

```text
.harness/states/active-run.json
.harness/states/e2e-*.json
.harness/states/*.bak
.harness/states/*.tmp
.harness/states/*.lock
.harness/states/*.events.jsonl
.harness/worktrees/
.harness/runs/**/task.json
.harness/runs/**/result.json
.harness/runs/**/checkpoint.json
.harness/runs/**/evidence/
```

规则：

- ignored 不等于可以随意删除。
- 状态和运行资产仍可能是恢复、审计和当前任务事实。
- 未经用户明确批准，不执行清理。
- 提交时只暂存本任务拥有且应版本化的文件。
- 如果计划、报告或固定阶段产物已经被仓库跟踪，应按 owned changes 正常处理。

---

## 16. 文档地图

### 16.1 当前入口

| 目的 | 文件 |
| --- | --- |
| 新会话恢复 | `CODEX-CROSS-SESSION-HANDOFF.md` |
| 项目强制规则 | `AGENTS.md` |
| 全量业务与历史交接 | `docs/AI-handover.md` |
| Harness 架构 | `docs/harness-architecture-adaptation.md` |
| Harness 结构 | `docs/harness-structure-checklist.md` |
| Harness Runtime 入口 | `.harness/README.md` |
| Harness 脚本说明 | `.harness/scripts/README.md` |
| 知识概览 | `llm-knowledge/overview.md` |

### 16.2 里程碑文档

```text
docs/harness-m0-m1/
docs/harness-m1-1-source-fingerprint/
docs/harness-m2-state-runtime/
docs/harness-m3-agent-dispatcher/
docs/harness-m4-runtime-compatibility/
docs/harness-m4-worker-runtime/
docs/harness-m5-worktree-orchestration/
docs/harness-m5b-worktree-worker/
docs/harness-m5b2-worktree-integration/
docs/harness-m5c-worktree-lifecycle/
docs/harness-m5b3-multi-task-protocol/
docs/harness-m5b3-batch-runtime/
docs/harness-m5d-multi-worktree-wave/
docs/harness-m5d-wave-create/
docs/harness-m5d-wave-execution/
docs/harness-m5d-wave-retire/
docs/harness-m7-m12-roadmap/
docs/harness-m7a1-state-v2/
docs/harness-m7a2-phase-result/
docs/harness-m7a3-acceptance-gates/
```

每个已实施 Story 通常包含：

```text
DESIGN.md
PLAN.md
REPORT.md
```

---

## 17. 新任务的标准开发模板

### 17.1 方案阶段

1. 分类任务。
2. 检查 Git 和活动状态。
3. 检查知识新鲜度并查询最窄知识。
4. 阅读目标源码和相关业务流程。
5. 描述现状、目标、影响范围、复用点、风险和不确定项。
6. 给出推荐方案和替代方案。
7. 用户确认后保存中文 `DESIGN.md`、`PLAN.md`。

### 17.2 实施阶段

1. 初始化单 Story 状态。
2. 创建并验证 Task DAG。
3. 按任务串行执行 RED。
4. 最小实现转 GREEN。
5. 重构但不扩大范围。
6. 运行针对性测试。
7. 审核 task-owned diff。
8. 一个任务稳定后再开始下一个。

### 17.3 收尾阶段

1. 运行推荐回归和结构校验。
2. 进行只读 Review。
3. 修复所有影响稳定性、基本可用性和近期扩展的问题。
4. 再次运行受影响门禁和 Review。
5. 生成中文 `REPORT.md`。
6. 更新交接、架构、结构清单和知识概览。
7. 只有在用户明确批准后，执行 Git 交付。

---

## 18. 不一致和故障处理

### 18.1 文档与 Git 不一致

以 Git 和当前状态为准，报告：

```text
交接快照：<值>
当前事实：<值>
影响：<影响>
处理建议：<建议>
```

不要静默改写历史文档来掩盖差异。

### 18.2 知识过期

- 明确报告 stale/missing。
- 直接核验相关源码。
- 只有确实需要时创建或执行刷新任务。
- 保留 `llm-knowledge/**/custom/`。

### 18.3 测试失败

- 先复现并定位根因。
- 不因为“可能是环境问题”就忽略失败。
- 环境确实不可用时记录命令、错误、影响和剩余风险。
- 修复前不进入交付。

### 18.4 工作区已有无关修改

- 列出无关文件。
- 不修改、不暂存、不还原。
- 本任务需触碰同一文件且无法安全隔离时，再向用户说明具体冲突。

---

## 19. 官方 Codex 资料结论

本文件在 2026-08-04 查询了 OpenAI 官方 Codex 文档，采用以下结论：

1. `AGENTS.md` 是持久化仓库规范的正式入口；可以在嵌套目录使用更具体的 `AGENTS.md` 或 `AGENTS.override.md`。
2. Skill 适合可复用流程，采用 metadata → `SKILL.md` → references/scripts 的渐进加载。
3. OpenAI 当前公开文档推荐 repo Skill 位于 `.agents/skills`；FrontierScan 现有 `.codex/skills` 是旧目标 CLI 实测兼容路径，不应未经复验直接迁移。
4. `~/.codex/config.toml` 是用户级配置，可信项目可使用 `.codex/config.toml` 覆盖部分项目配置；本项目当前没有项目级配置。
5. `history.persistence` 可以控制本地会话历史保存；`features.memories` 是可选功能且默认关闭。不能假设新线程会自动拥有旧线程的全部内容。
6. 因此，跨会话可靠恢复必须依赖版本化项目指令、Git、Harness 状态和交接文档，Memories 只能辅助。

官方资料：

- [OpenAI Codex：Custom instructions with `AGENTS.md`](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [OpenAI Codex：Customization overview（AGENTS、Skills）](https://learn.chatgpt.com/docs/customization/overview)
- [OpenAI Codex：Configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

本次官方 Codex manual 聚合抓取工具因目标页面 HTTP 403 未成功，随后按 OpenAI Docs Skill 的规定，改用 OpenAI 官方 Developer Docs 连接器读取上述页面。没有使用第三方博客替代这些机制结论。

---

## 20. 本文档维护规则

在以下事件后更新本文件：

- 完成 M6-A 或更后里程碑。
- 当前分支或推荐下一步改变。
- 活动 Harness Story 改变。
- Skill 安装路径或 Codex Runtime 兼容性结论改变。
- 用户长期工作偏好发生变化。
- 新增会影响新会话恢复的重要安全边界。

每次更新至少同步：

1. 快照日期。
2. 当前分支和最新关键提交。
3. 活动 Harness 状态。
4. 最新完成能力。
5. 明确未完成能力。
6. 推荐下一步。
7. 新的批准边界或用户偏好。

更新后至少运行：

```powershell
git diff --check

powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\validate-structure.ps1
```

如果本文件尚未登记为 Harness 必需结构文件，`validate-structure.ps1` 只会验证现有清单，不代表本文件内容自动正确；仍需人工检查路径、提交号、状态、数量和命令是否与当前仓库一致。

---

## 21. 当前会话结束时的最终摘要

截至 2026-08-13：

- 当前分支为 `dev`，本轮实施基线为 `cea21a8 feat(harness): implement M7-A3 acceptance gates`。
- M6-A 已完成真实单业务闭环；M7-A1、M7-A2 和 M7-A3 已提交，M7-A4 当前工作区尚未提交。
- M7-A4 已完成 State v2 record 语义幂等、baseline 到当前工作树净变化、`implementation.actualFiles` 唯一 owned 来源、prediction 风险分类、控制资产排除、owned manifest 和 delivery apply 原子对账。
- `done/completed` 仍不表示 Git 已提交或推送；completed State 外可生成 append-only delivery receipt，只读核对 commit tree 和 remote ref，不执行 Git 写操作。
- 三轮独立审核发现的删除重建归并、跨控制资产 rename/copy、manifest 锁/阶段约束、POSIX mode、receipt 漂移、遗留锁恢复和 CLI 参数问题已全部关闭；最终结论为无 BLOCKER/WARNING。
- 核心 Runtime、结构、smoke 和兼容回归通过；大型 Worker/Wave 综合套件运行到 72 条均通过后触发 10 分钟超时，未产生失败证据。
- 知识 backend/frontend/common 的 stale 闭环仍属于 M7-C。
- 当前正式仓库没有执行 `git add`、`git commit`、`git push`、Worktree、Docker、发布或部署。
- M7-A4 当前仅待提交；提交后下一子里程碑为 `M7-B：最小确定性串行驱动器`，M7 整体真实 Story 验收仍由 M7-D 完成。
- 项目仍不具备确定性串行驱动器、knowledge stale 闭环、真实 Agent Provider、多 Story Fork-Join、本地 Compose 验收和自动 Git 交付。
