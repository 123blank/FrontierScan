# Harness M5-D-A 同 Wave 多 Worktree 兼容性设计

> Story：`M5-D-A-001`
>
> 范围：只实现 `wave-plan` 与 `wave-status`，不创建正式仓库 Worktree，不启动 Worker，不合并或回收分支。

## 1. 现状

M5-A 已提供单任务 Worktree 的 `plan/status/create/retire`，M5-B3-B 已提供单 Worktree 严格串行多任务批次。Task DAG 共享契约已经校验 wave 唯一归属、依赖顺序、Windows 大小写不敏感的路径冲突和 `globalChanges` 串行约束，但当前没有把同一 wave 中多个任务映射为一组确定性的 Worktree 计划，也没有聚合 Git 事实判断该 wave 是否可进入后续编排。

## 2. 目标

为 active Story 的 `implementation` phase 增加只读兼容性入口：

```text
Task DAG wave
  -> wave-plan：固定 base commit，派生每任务分支和路径
  -> wave-status：从 Git 事实识别 absent / partial / ready
```

首版仅接受至少两个 `pending` 的 `backend`/`frontend` 任务。所有任务必须来自同一个已通过共享契约校验的 wave，且 `globalChanges` 为空。

## 3. 产物与接口

内部接口继续复用 `runWorktreeCommand`：

```js
runWorktreeCommand({
  command: "wave-plan" | "wave-status",
  root,
  stateFile,
  taskDagFile,
  waveIndex,
  baseRef: "dev"
})
```

PowerShell 薄入口：

```powershell
.\.harness\scripts\run-worktree.ps1 `
  -Command WavePlan|WaveStatus `
  -StateFile <state-file> `
  -TaskDagFile <task-dag-file> `
  -WaveIndex <1-based> `
  [-BaseRef dev] `
  [-Json]
```

结构化产物固定为：

```text
.harness/runs/<runId>/waves/wave-<n>/plan.json
.harness/runs/<runId>/waves/wave-<n>/status.json
```

分支与路径固定派生为：

```text
branch: harness/<story>/wave-<wave>-<task>-<slug>
path:   .harness/worktrees/<story>/wave-<wave>/<taskId>
```

## 4. 计划契约

`wave-plan` 必须：

- 要求 active Story 处于 `implementation`。
- 要求 `waveIndex` 为存在的 1-based 正整数。
- 要求目标 wave 至少包含两个任务，且任务均为 `pending`、类型仅为 `backend` 或 `frontend`。
- 复用 `task-dag-contract.mjs` 的冲突与依赖校验，不重复实现路径算法。
- 将 `baseRef` 解析为不可变 commit SHA，并为全部任务使用同一 SHA。
- 按 Windows 大小写不敏感的 `taskId` 稳定排序。
- 原子写入计划；相同输入重复调用复用现有计划，DAG、基准或身份漂移时失败关闭。

计划不执行 `git worktree add`，也不修改 Harness phase 或 revision。

## 5. 状态契约

每项任务状态：

- `absent`：目标路径和分支均不存在。
- `branch-only`：目标路径不存在，分支存在且仍指向计划基准，可供后续恢复。
- `created`：Git 已注册目标路径，分支和 HEAD 与计划完全一致。

聚合状态：

- `absent`：全部任务为 `absent`。
- `partial`：存在 `branch-only` 或只创建了部分计划 Worktree。
- `ready`：全部任务均为 `created`。

以下情况直接失败关闭，且不写入误导性状态：

- `baseRef` 已离开计划 SHA。
- 计划、Task DAG 或 state 身份漂移。
- 目标路径被非 Git 目录占用、父目录为符号链接或注册 Worktree 缺失。
- 分支或 Worktree HEAD 不匹配计划。
- 当前 Story wave 目录下存在计划之外的额外已注册 Worktree。

`wave-status` 只读取 Git 事实并原子写入状态，不创建、修复、删除或移动任何 Worktree。

## 6. 安全与恢复

- Git 调用沿用固定可执行文件、参数数组、无 shell、30 秒超时和有限输出缓冲。
- Runtime 不接收任意分支或 Worktree 路径。
- 计划写入中断依靠原子 rename；既有计划与当前输入不一致时不覆盖。
- 分支已创建但 Worktree 未挂载时记录 `branch-only`，为未来受审批创建提供恢复依据。
- 临时 Git fixture 可以真实创建两个 Worktree验证状态；正式 FrontierScan 仓库不执行创建或删除。

## 7. 排除范围

不实现 `wave-create`、并行 Worker、并发锁、结果聚合、自动 merge、冲突解决、Worktree 删除、分支删除、`git worktree prune`、Fork-Join、真实 Agent、发布、部署或 Git 自动交付。
