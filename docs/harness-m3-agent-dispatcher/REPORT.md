# FrontierScan Harness M3 单 Story Dispatcher 实施报告

> 日期：2026-07-17
> 分支：`feat/harness-m3-agent-dispatcher`
> 范围：单 Story 文件式派发、固定命令适配、结构化结果应用和纵向恢复

## 1. 目标结论

M3 按 `docs/harness-m0-m1/PLAN.md` 的 Single-Story Vertical Slice 实现。当前 Harness 可以从 M2 状态读取当前 phase，生成结构化任务，由当前 Codex 会话或人工执行者写入结构化结果和产物，再由 Dispatcher 校验并调用 M2 推进、保留或阻塞。

“Dispatcher”在本阶段是文件协议和确定性编排，不是已启动的真实 Agent Runtime。

## 2. 已实现能力

- `run-story.ps1 prepare`：按当前 phase 生成或复用 `task.json` 和 `checkpoint.json`。
- `run-story.ps1 status`：只读返回 M2 状态和当前派发检查点。
- `run-story.ps1 run-adapter`：运行固定 Harness/backend/frontend 本地命令，并保存结构化证据。
- `run-story.ps1 apply`：校验 `result.json`、必需产物和 records 后，通过 M2 `record/next/block/complete` 更新状态。
- 工作流必需产物支持 `{runId}`，所有新 M3 阶段产物位于 `.harness/runs/<storyId>/phases/`。
- task、result 和 checkpoint 有公开 JSON Schema；运行时补充身份、phase、普通文件、路径边界和状态语义校验。
- failed 结果保留当前 phase，blocked 结果进入 M2 blocked，completed 结果必须通过 M2 原有质量门禁。
- adapter 使用稳定证据路径；同 adapter 失败后重跑通过时，M2 使用同路径最新结果恢复门禁。
- checkpoint 保存 adapter evidence 的 SHA-256；`apply` 推进前重新校验证据文件、哈希、Story、phase、dispatch、adapter 和退出状态。
- record 后、next 前中断可按结果身份和证据 SHA-256 去重续跑；M2 已推进、checkpoint 未落盘时可对账并补齐旧 checkpoint。

## 3. 固定命令适配器

| Adapter | Phase | 命令类型 |
| --- | --- | --- |
| `harness-state-tests` | `unit-test` | Node.js M2 状态测试 |
| `harness-m3-tests` | `unit-test` | Node.js M3 Dispatcher 测试 |
| `harness-structure` | `unit-test`、`build-publish` | PowerShell 结构校验 |
| `backend-tests` | `unit-test` | Maven tests |
| `backend-package` | `build-publish` | Maven package |
| `frontend-build` | `unit-test`、`build-publish` | npm build |
| `no-build-required` | `build-publish` | Git 确认 backend/frontend 无变化后的确定性成功证据 |

所有 adapter 使用代码内固定 executable、argv 和 cwd，通过 `execFile` 且 `shell: false` 执行。stdout 和 stderr 各使用 16 MiB 有界缓冲，可承载常规 Maven/npm 构建日志，同时避免无界内存增长。没有任意命令配置入口。

## 4. TDD 与审核

四类行为均先观察到 RED：

1. `{runId}` 未展开和 DAG 仍使用全局路径。
2. Dispatcher 模块缺失，无法 `prepare/status`。
3. `run-adapter/apply` 命令缺失。
4. M3 文件未登记到结构清单和 Smoke。

实现过程中审核发现并修复两个直接问题：

- task/checkpoint 的合法 JSON 未完整核对 workflow 输出集合和 dispatch 身份。
- phase 路径只做字符串前缀判断，`../` 归一化后可能逃逸到其他 run 位置。
- Windows 的 Maven/npm 入口是 `.cmd`，直接 `execFile("mvn"|"npm")` 不稳定；当前使用固定 `cmd.exe /d /s /c mvn.cmd|npm.cmd ...`，外层仍为 `shell: false` 且没有用户命令文本。
- build phase 曾可只运行结构校验或完全不运行 build adapter；当前必须存在 backend/frontend build 或显式 `no-build-required` 证据。
- code-review 曾只依赖全局 `review.status`；当前必须存在 `phase=code-review` 的 `review/passed` 记录且证据哈希仍匹配。
- `validate-state.ps1` 曾按 Windows 默认代码页读取活动 JSON；当前显式使用 UTF-8，并有中文需求摘要回归。
- 后续审核发现活动指针未被统一状态校验器识别；当前 `validate-state.ps1` 已校验 `active-run` 的身份、状态、revision 和目标状态路径，`select-tests.ps1` 推荐的全目录状态门禁可直接通过。
- 后续审核发现 Node.js `execFile` 默认 1 MiB 缓冲会误杀正常的大日志命令；当前所有 adapter 统一使用 16 MiB 有界缓冲，并以 2 MiB 真实子进程输出回归覆盖。
- 后续审核发现 Dispatch Schema 仅检查存在性；当前 `validate-structure.ps1` 会实际解析 task/result Schema JSON。
- 收尾验证发现 PowerShell 在 `param(...)` 默认值阶段不能稳定读取 `$PSScriptRoot`；当前 `run-state.ps1` 和 `run-story.ps1` 在脚本正文解析默认仓库根目录，省略 `-Root` 的标准命令可直接使用。
- 再次审核发现 `build-publish` 只读取 checkpoint 中的 adapter 字段，无法发现 evidence 缺失或被改写；当前 checkpoint 绑定 evidence SHA-256，`apply` 会重验普通文件、哈希、派发身份和成功退出状态。
- 最终审核发现 `no-build-required` 可无条件成功；当前固定检查 backend/frontend 的 staged、unstaged 和 untracked Git 差异，存在变化时保存失败 evidence 并拒绝推进。
- 最终审核发现 M2 已推进而 checkpoint 尚未落盘时无法幂等重试；当前使用 `runtime.previousPhase` 对账旧 task/result/checkpoint，补齐 checkpoint 后返回 `already-applied`。
- 最终审核发现活动状态可能进入交付边界；当前 `.gitignore` 排除活动指针、E2E 活动状态、备份、临时文件、锁和事件日志，同时保留模板与 run 证据。

T1、T2、T3 范围审核和最终总审均无剩余 `BLOCKER/WARNING`，证据位于 `.harness/runs/M3-001/reviews/` 和 code-review phase 目录。

## 5. 当前验证证据

- M3 测试覆盖结构化派发、任务复用、路径边界、固定 adapter、证据篡改拒绝、失败重跑、BLOCKER、blocked、部分应用恢复和九阶段纵向闭环。
- 九阶段 fixture 从 requirement 逐阶段重建状态读取，最终在测试批准证据存在时进入 `done`。
- 实际 `M3-001` 已完成 implementation、unit-test、code-review、build-publish 和 interface-verification，当前位于 `git-delivery`、状态为 `active`、revision 为 24。
- M2 状态运行时完整回归保持通过。
- 活动指针正反例、测试选择器推荐状态门禁、2 MiB adapter 输出和两个 PowerShell 默认根目录入口回归通过。
- Node.js 语法、Dispatch Schema JSON 结构校验和 19/117/13 Harness 结构校验通过。
- 当前 `backend/`、`frontend/` Git 范围为空，满足 `no-build-required`；未执行不必要的 backend/frontend 构建。

phase 4/5 产物保留当时阶段推进的历史证据。最终门禁修复后的全量命令、结果和核心文件 SHA-256 写入 `.harness/runs/M3-001/phases/08-git-delivery/final-verification-report.md`，最新审核使用 `.harness/reports/code-review-report.md`；两者在当前 `git-delivery` 阶段重新绑定状态 SHA-256。

## 6. 安全和阶段边界

- 未修改 `backend/src/**` 或 `frontend/src/**`。
- 未调用模型、API 密钥或外部服务。
- 未实现或执行真实 Agent 进程、Skill/Plugin Runtime、Worktree、Fork-Join、发布、部署、Git 写入或 PR。
- `git-delivery` 的状态完成仍需要 M2 中当前 phase 的显式用户批准证据；M3 不接受 approval result record。
- 当前运行没有用户 approval，未执行状态完成、暂存、提交、推送或 PR。
- 本机 `.harness/states/` 运行事实不属于 Git 交付内容；`.harness/runs/` 中的阶段报告和审核证据仍可按 owned 边界交付。
- 通用超时、取消、Agent 工具权限沙箱和模型选择留到 M4/M6。

## 7. 下一里程碑

M4 应在 M3 文件协议稳定后接入真实 Codex Skill/Agent Runtime：Worker 只接收声明的上下文和工具，返回符合 M3 result schema 的结果；Dispatcher 和 M2 继续拥有校验与状态推进权。Worktree 并行仍留到 M5。
