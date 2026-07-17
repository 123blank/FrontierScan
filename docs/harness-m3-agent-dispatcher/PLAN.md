# FrontierScan Harness M3 实施计划

> **执行约束：** 按 TDD 串行完成 T1-T4；每个任务必须经历 RED、最小实现、GREEN、范围审核。项目规则禁止在未获用户批准时执行 `git add/commit/push`，因此计划内不包含自动提交步骤。

**目标：** 在 M2 状态运行时之上完成基本可用、可恢复、可扩展的单 Story 文件式 Dispatcher，并保持所有外部写操作禁用。

**架构：** `run-story.ps1` 转发到 `story-runtime.mjs`；后者从 M2 状态和 workflow 生成 task，校验 result，通过固定 `execFile` adapter 运行本地门禁，并且只调用 `runStateCommand` 修改状态。每个 phase 的 task、result、checkpoint、output 和 evidence 都位于 `.harness/runs/<storyId>/phases/<order>-<phase>/`。

**技术栈：** Node.js ESM 标准库、PowerShell 入口、JSON/JSON Schema、现有 M2 `runStateCommand`。

---

## 任务 T1：run 专属必需产物路径

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/workflows/e2e-development.yaml`

- [x] 在 `state-runtime.test.mjs` 增加 `{runId}` 展开测试：fixture workflow 使用 `.harness/runs/{runId}/phases/00-requirement/output.md`，只创建旧全局文件时 `next` 必须失败，创建 run 文件后必须成功。
- [x] 运行 `node .\.harness\scripts\tests\state-runtime.test.mjs`，确认新增用例因路径未展开而 RED。
- [x] 在 `state-runtime.mjs` 增加 `expandWorkflowPath(template, state)`，只允许已知 `{runId}`；发现其他 `{...}` 立即失败，展开结果继续经过 `resolveInsideRoot`。
- [x] 让 `outputEvidence` 和 `runTaskDagValidator` 接收展开后的实际路径；DAG 门禁从当前 phase 的必需输出中取得 `task-dag.json`，不再硬编码全局路径。
- [x] 将 `e2e-development.yaml` 九个 phase 的 required output 更新为设计文档中的 run 专属路径。
- [x] 重跑 M2 状态测试并执行只读审核，确认旧 fixture、路径边界和 DAG 门禁无回归。

## 任务 T2：结构化 `prepare/status`

**文件：**

- 新增：`.harness/scripts/lib/story-runtime.mjs`
- 新增：`.harness/scripts/run-story.ps1`
- 新增：`.harness/scripts/tests/story-runtime.test.mjs`
- 新增：`.harness/schemas/dispatch-task.schema.json`
- 新增：`.harness/schemas/dispatch-result.schema.json`

- [x] 用临时仓库 fixture 写 `prepare` RED：断言 task 包含 `dispatchId/storyId/phase/ownerAgent/preparedRevision/preparedAt/expectedOutputs/allowedAdapters/next`，且输出都在当前 phase 目录。
- [x] 增加重复 `prepare`、只读 `status`、blocked/done 拒绝派发以及损坏 task 失败关闭用例并观察 RED。
- [x] 实现 `runStoryCommand({ command, root, stateFile, ... })`，通过 `runStateCommand(status)` 读取状态，解析 workflow 当前 phase，并创建或复用 task/checkpoint。
- [x] 使用 `randomUUID` 生成首次 dispatch ID，使用临时文件加 rename 写 JSON；不得直接编辑状态 JSON。
- [x] 实现 PowerShell 参数转发和 JSON/人类可读输出，保留 Node 非零退出码。
- [x] 运行 M3 测试、M2 状态测试和结构化 Schema 人工字段对照，完成只读差异审核。

## 任务 T3：固定 adapter 与 `apply`

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/run-story.ps1`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [x] 写 adapter RED：未知 ID、phase 不匹配和注入 shell 文本必须拒绝；合法 adapter 调用注入的 `execFile` 时 argv 必须为固定数组且 `shell` 不启用。
- [x] 写证据 RED：成功/失败均生成包含 adapter、phase、exitCode、startedAt、finishedAt、durationMs、stdout、stderr 的 JSON；unit-test 自动调用 M2 `record test`。
- [x] 写 result RED：身份不匹配、输出集合不完整、越出当前 phase 目录、符号链接和伪造 approval 必须在状态修改前失败。
- [x] 写状态语义 RED：`completed` 调用 `next/complete`，`failed` 保持 phase，`blocked` 调用 M2 `block`；unit-test failed 和 code-review BLOCKER 不得推进。
- [x] 写中断恢复 RED：在 record 完成、next 前注入失败，再次 `apply` 必须复用相同 result，跳过重复记录并完成推进。
- [x] 以代码内对象实现固定 adapter registry，命令通过 `execFile(executable, args, { cwd, shell: false })` 运行；不加载仓库内任意命令配置。
- [x] 实现 result 语义校验、普通文件与路径边界校验、record 去重、checkpoint 状态更新和 M2 推进调用。
- [x] 运行 M3/M2 测试并只读审核安全边界、幂等判断和门禁行为。

## 任务 T4：全阶段纵向闭环与集成

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`
- 修改：`.harness/structure-manifest.yaml`
- 修改：`.harness/scripts/README.md`
- 新增：`docs/harness-m3-agent-dispatcher/REPORT.md`
- 修改：`docs/AI-handover.md`

- [x] 建立全九 phase fixture：每个 phase `prepare`，写必需产物/result，`apply` 后启动新 runtime 实例读取下一 phase；delivery 阶段写入用户批准 fixture 后完成。
- [x] 断言每个 phase 的 task/result/checkpoint/output/evidence 均在 run 目录并含时间戳，已完成 phase 不会被重新派发。
- [x] 在 Smoke 中增加临时目录的 M3 `prepare/status` 最小流程，不在仓库遗留运行状态。
- [x] 将 M3 新文件和 `docs/harness-m3-agent-dispatcher` 登记到 structure manifest，并更新脚本入口说明。
- [x] 更新实施报告和交接文档：写明当前可依赖能力、验证证据以及 M4/M5/M6 边界，不声称真实 Agent 已自动派发。
- [x] 运行最终验证：M3、M2、既有 Harness/知识回归、结构、状态模板、活动状态、任务 DAG、Smoke、freshness 和 `git diff --check`。
- [x] 对全部 task-owned diff 做最终只读审核；有 BLOCKER/WARNING 时回到对应任务按 RED/GREEN 修复并重跑验证。

## 完成定义

- `M3-001` 的全部验收标准都有当前工作区中的直接测试或状态/文件证据。
- 最终代码审核不存在未解决 `BLOCKER` 或会影响基本流程的 `WARNING`。
- 未修改业务源码，未执行发布、部署、暂存、提交、推送、PR 或 Worktree 操作。

## 审核修复补充

- [x] 先增加 RED：`no-build-required` 收到 backend/frontend Git 差异时必须失败并保存失败 evidence。
- [x] 将 `no-build-required` 固定为只读 Git 状态检查，覆盖已暂存、未暂存和未跟踪文件；干净范围仍可作为显式无构建证据。
- [x] 先增加 RED：M2 已推进、checkpoint 尚未写入时，重试 `apply` 必须补齐旧阶段 checkpoint 并返回 `already-applied`。
- [x] 通过 `runtime.previousPhase`、workflow next、旧 task/result/checkpoint 身份共同确认已推进事务，不回退或重复修改 M2 状态。
- [x] 先增加 RED：本机活动状态、备份和事件日志必须被 Git 忽略，状态模板与 `.harness/runs/` 证据不得被忽略。
