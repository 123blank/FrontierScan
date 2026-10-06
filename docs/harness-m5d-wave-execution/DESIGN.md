# Harness M5-D-C 同 Wave Worker 执行与受控集成设计

> 拟议 Story：`M5-D-C1-001`、`M5-D-C2-001`
>
> 日期：2026-08-06
>
> 状态：设计已由用户分段确认，并完成两轮独立只读评审修订；尚未初始化实施型 Harness Story。
>
> 范围：只设计单 Story、单个完整 implementation wave 的多 Worktree 并行 Mock Worker、结果收敛、主工作树串行受控集成和 M3 最终推进。

## 1. 背景与现状

FrontierScan Harness 已具备：

- M2 单 Story 确定性状态运行时。
- M3 v1.0 单任务 Dispatcher 和 v1.1 task-scoped serial batch。
- M4-B 受约束 Mock Worker。
- M5-A 单 Worktree 计划、状态和创建。
- M5-B1 单 Worktree Worker。
- M5-B2 单 Worktree候选受控集成。
- M5-C 单 Worktree审批门控回收。
- M5-B3-B 单 Worktree严格串行多任务批次。
- M5-D-A 同 wave 多 Worktree `WavePlan/WaveStatus`。
- M5-D-B 审批门控 `WaveCreate`、Story 级共享创建锁、`lockId` fencing、部分创建恢复和完成回执。

M5-D-B 的直接后继是让已经创建并通过事实校验的同 wave 多 Worktree：

```text
WaveCreate ready
  -> 多任务 Worker 并行执行
  -> 全部结果收敛
  -> 主工作树串行受控集成
  -> 生成 phase 结果
  -> M3 apply 推进一次
```

现有接口不能直接循环：

- M5-B1 v1.0 明确要求 Task DAG 只有一个任务。
- M5-B3-B v1.1 绑定单 Worktree、串行 claim 和前序继承快照。
- M5-B2 单任务锁不能阻止两个协调器同时写主工作树。
- M3 `apply` 会推进整个 phase，不能在只完成部分 DAG wave 时调用。

因此，本阶段新增独立 wave 协调协议，同时保留 M2/M3 的唯一状态权。

## 2. 目标

### 2.1 M5-D-C1

实现同 wave 多 Worktree 并行执行：

1. 为 wave 每个任务生成独立 dispatch、checkpoint 和 attempt 证据。
2. 使用现有 M4-B Mock Provider 并行执行 Worker。
3. 对每个任务提供 claim、锁、attempt 和逐写点 fencing。
4. 部分失败保留成功任务证据，只显式重试失败或缺失任务。
5. 全部任务达到 `ready-for-integration` 前不写主工作树。
6. 中断后只通过磁盘事实、哈希和显式恢复命令收敛。

### 2.2 M5-D-C2

实现同 wave 结果受控集成：

1. 全员 ready 后原子冻结不可变 integration manifest。
2. 在首次主树写入前完成全局候选冲突与业务目录漂移检查。
3. 使用 wave 级 integration owner 按稳定顺序串行写主工作树。
4. 中途失败保留已集成确定性前缀，只重试剩余任务。
5. 生成 phase 级产物、wave receipt、finalized ledger 和 checkpoint 绑定。
6. 最后由现有 M3 `apply` 显式推进一次。

## 3. 非目标

本阶段不实现：

- 多 wave 顺序调度。
- 真实 Codex Agent Provider 或真实模型自动业务开发。
- 多个真实 Agent 并行运行。
- `git merge`、自动冲突解决或自动回滚。
- WaveRetire、多 Worktree 回收、分支删除或 `git worktree prune`。
- Worktree 复用或遗留资产自动清扫。
- Fork-Join 多 Story Runtime。
- 自动 `git add`、`commit`、`push` 或 PR。
- 发布、部署或外部环境变更。
- OS 级租约锁、断电级 fsync 或恶意同进程调用方隔离。

## 4. 已确认决策

### 4.1 Provider

采用现有 M4-B Mock Provider。真实 Codex Agent Provider 延期。

### 4.2 执行与集成

- Worker 在不同 Worktree 中并行执行。
- 主工作树只允许单一 wave integration owner 串行写入。
- 不通过 Git merge 汇总候选。

### 4.3 部分失败

- Worker 部分失败时保留成功 execution receipt。
- 所有 Worker ready 前禁止主树集成。
- 集成中途失败时保留已集成前缀和对应 receipt。
- 不自动 reset、删除候选或回滚已集成结果。

### 4.4 Story 拆分

严格按顺序实施：

```text
M5-D-C1 并行执行
  -> M5-D-C2 受控集成
```

C2 只能消费已经完成并通过审核的 C1 证据协议。

### 4.5 单 Wave 限制

首版只接受：

- Task DAG 恰好有一个 wave。
- 该 wave 覆盖当前 implementation phase 的全部 pending 任务。
- 任务类型为受支持的 `backend` 或 `frontend`。
- 不存在 `globalChanges`。
- 不存在相同、大小写等价或父子候选路径冲突。

不满足时，不能生成 wave phase result，也不能调用 M3 `apply`。

### 4.6 生命周期

完成 C2 后保留全部 Worktree 和任务分支。WaveRetire 后续独立设计。

### 4.7 审批

审批相互独立：

- Worker 执行批准不构成主树集成批准。
- 集成批准不构成恢复、回收、Git 交付或发布批准。
- 遗留 attempt、manifest preparation lock 和 integration lock 接管各自需要显式确认及当前证据哈希。

## 5. 总体架构

新增：

```text
.harness/scripts/lib/worktree-wave-execution-runtime.mjs
```

职责：

- 加载和校验 Wave Execution Ledger。
- claim 并并行运行 task attempt。
- 动态检查 attempt、锁、result、receipt 和 Git 事实。
- 冻结 integration manifest。
- 管理 wave integration owner。
- 串行调用受约束的共享集成原语。
- 不修改 M2 state、phase 或 revision。
- 不直接生成正式 phase checkpoint。

`story-runtime.mjs` 新增：

```text
prepare-wave
finalize-wave
```

职责：

- 获取 implementation phase 所有权。
- 生成 wave-scoped dispatch/checkpoint。
- 生成正式 phase 级 task/result/notes。
- 绑定 wave receipt、ledger 和 checkpoint。
- 保持 M3 `apply` 为唯一推进入口。

现有模块扩展：

```text
dispatch-contract.mjs
worker-runtime.mjs
worktree-worker-runtime.mjs
worktree-integration-runtime.mjs
```

只增加严格 v1.2 路由和共享无状态原语，不改变 v1.0/v1.1 行为。

## 6. Implementation Phase 唯一所有权

### 6.1 所有权模式

implementation phase 同一时间只能由一种模式拥有：

```text
ordinary
serial-batch
worktree-wave
```

新增持久化事实：

```text
.harness/runs/<runId>/phases/03-implementation/implementation-owner.json
```

精确字段：

```text
schemaVersion
storyId
runId
phase
mode
ownerId
preparedRevision
taskDagFile
taskDagSha256
acquiredAt
```

其中：

- `ordinary.ownerId` 为 phase dispatchId。
- `serial-batch.ownerId` 为 batchId。
- `worktree-wave.ownerId` 为 waveId。

### 6.2 获取规则

- 通过 exclusive-create 获取。
- 已存在时只能在所有字段与当前派生事实一致时复用。
- 不允许调用方注入 `ownerId` 或路径。
- 完成 phase 后保留为历史证据，不自动删除。

### 6.3 强制门禁

以下命令必须读取并重新验证 implementation owner：

```text
prepare
prepare-batch
prepare-wave
finalize-batch
finalize-wave
apply
reconcileAdvancedResult
```

当 owner 为 `worktree-wave` 时：

- 普通 `prepare` 失败。
- `prepare-batch` 失败。
- 普通未绑定 wave finalization 的 `apply` 失败。
- 只有 finalized ledger、wave receipt 和精确 `checkpoint.waveFinalization` 可进入 M3 `apply`。

旧 v1.0/v1.1 fixture 没有 owner 文件时，只按既有产物派生 legacy owner；不能因兼容逻辑绕过已存在的 wave ledger。

## 7. Dispatch v1.2

### 7.1 Task

v1.2 task 精确字段：

```text
schemaVersion
dispatchId
storyId
runId
phase
waveId
waveIndex
taskId
taskRoot
ownerAgent
purpose
preparedRevision
preparedAt
expectedOutputs
allowedAdapters
next
```

规则：

- `schemaVersion = "1.2"`。
- `runId` 必须等于当前 state runtime runId。
- `waveId` 由 Story、revision、DAG、wave index 和计划哈希确定性派生。
- `dispatchId` 由 Runtime 生成。
- `taskRoot` 由 Runtime 派生并保持在当前 run/wave/task 目录内。
- v1.2 Worker 的 result 与 execution receipt 必须写入当前 attempt 子目录，不能使用或覆盖 v1.0/v1.1 的固定 result 路径。
- result 必须镜像 `storyId/runId/phase/waveId/waveIndex/taskId/taskRoot/dispatchId`。
- v1.2 不包含 `batchId`，不能进入 serial batch 分支。

### 7.2 路由

```text
v1.0 -> 现有单任务路径
v1.1 -> 现有 serial batch 路径
v1.2 -> 新 wave-task 路径
```

未知版本或字段失败关闭。

## 8. 运行目录与产物

```text
.harness/runs/<runId>/waves/<waveId>/
  execution-ledger.json
  ledger-mutation.lock
  integration-manifest.json
  manifest-preparation.lock
  integration.lock
  integration-recovery.lock
  wave-receipt.json
  tasks/
    <taskId>/
      task.json
      checkpoint.json
      input-manifest.json
      integration-receipt.json
      attempts/
        <attemptId>/
          claim.json
          input-snapshot.json
          result.json
          execution-receipt.json
          failure.json
```

正式 phase 产物继续位于：

```text
.harness/runs/<runId>/task.json
.harness/runs/<runId>/result.json
.harness/runs/<runId>/checkpoint.json
.harness/runs/<runId>/phases/03-implementation/implementation-notes.md
```

attempt 历史证据不可覆盖或删除。

## 9. `prepare-wave`

`story-runtime prepare-wave` 必须验证：

1. state 为 `implementation/active`。
2. revision 与调用读取一致。
3. implementation owner 不存在或精确复用当前 wave owner。
4. DAG 恰好一个 wave并覆盖全部 pending implementation 任务。
5. DAG 无 `globalChanges`、无依赖或文件冲突。
6. WavePlan、WaveStatus 和 creation receipt 均为当前事实。
7. 全部 Worktree 当前为 `created`，HEAD 等于统一 `baseCommit`。
8. 主工作树未出现不允许的业务变化。

随后按固定顺序：

```text
获取 implementation owner
-> 生成 v1.2 task/checkpoint
-> 生成 execution ledger
-> 绑定所有文件 SHA-256
-> 返回 prepared
```

不推进 state。

## 10. M5-D-C1 Ledger 状态

### 10.1 任务状态

```text
pending
claiming
running
blocked
ready-for-integration
integrated
```

`integrated` 只由 C2 使用。

### 10.2 Wave 状态真值表

| Wave 状态 | 确定性条件 |
| --- | --- |
| `prepared` | 所有任务均为 `pending` |
| `executing` | 至少一个任务为 `claiming` 或 `running` |
| `partial` | 无 active task，且至少一个任务为 `blocked`，或任务集合为 ready/pending 的非初始混合 |
| `ready-for-integration` | 所有任务均为 `ready-for-integration` |
| `freezing` | manifest freeze owner 已记录，尚未绑定 manifest |
| `integration-frozen` | manifest SHA-256 已绑定，所有任务仍为 ready |
| `integrating` | integration owner 有效，至少一个任务正在集成 |
| `partial-integration` | 无当前写入，已集成前缀非空但未覆盖全部任务，或当前集成失败 |
| `integrated` | 所有任务均为 `integrated` |
| `finalized` | phase 产物、wave receipt、ledger 和 checkpoint 全部完成绑定 |

顶层状态不接受调用方赋值，必须从任务状态、owner 和最终证据确定性派生。

每次 ledger mutation 后立即运行完整结构与真值表校验。

## 11. 不可变 Attempt

### 11.1 身份

每次 attempt 固定：

```text
attemptId
claimId
lockId
dispatchId
storyId
runId
waveId
taskId
planSha256
creationReceiptSha256
inputSnapshotSha256
claimedAt
```

### 11.2 Claim 顺序

```text
短期获取 ledger mutation lock
-> task: pending -> claiming
-> 写不可变 claim.json
-> owner-checked 释放 ledger lock
-> exclusive-create task execute.lock
-> 验证 lockId/attemptId/claimId
-> 再次获取 ledger mutation lock
-> 验证 claim 与 task lock
-> task: claiming -> running
-> 启动 Worker
```

固定顺序避免“锁先于 claim”的正常路径，但必须恢复：

- claim 已写、task lock 未建立。
- task lock 已建立、ledger 尚未进入 running。

### 11.3 逐写点 Fencing

v1.2 Worker 在以下动作前调用 owner guard：

- 每个候选文件原子替换。
- attempt result 写入。
- execution receipt 写入。
- ledger 状态更新。
- execute.lock 释放。

guard 必须同时验证：

- 当前磁盘 lock SHA-256 与 `lockId`。
- ledger current attempt 等于 `attemptId/claimId`。
- dispatch、计划和 creation receipt 未漂移。
- manifest 尚未开始冻结。

旧 Worker 失去 owner 后不能继续写入或删除新锁。

## 12. Attempt 失败与恢复

### 12.1 正常失败

Provider 或校验失败后：

- 写 attempt `failure.json`。
- owner-checked 将任务标记为 `blocked`。
- 保留 result、快照、失败和锁历史哈希。
- owner-checked 释放当前锁。

### 12.2 `recover-attempt`

必须提供：

```text
ConfirmAttemptRecovery
ExpectedClaimSha256
ExpectedExecutionLockSha256（存在时）
ExpectedAttemptId
```

不按 PID、时间或主观超时自动恢复。

恢复前重新读取 claim、锁、ledger、attempt 文件和 Worktree Git 事实。

结果：

1. Worktree 与输入快照一致且没有 result
   将 attempt 记录为 `abandoned`，任务回到 `pending`。

2. result 与 execution receipt 完整且候选事实一致
   恢复为 `ready-for-integration`。

3. blocked result 完整且无无法解释变化
   保持 `blocked`，允许后续 `retry-task` 创建新 attempt。

4. 存在候选变化但没有完整结果证据
   保持 `blocked`，失败关闭，不自动 reset、删除或覆盖。

动态 `status` 可报告 `recovery-required` 诊断，但不新增稳定 ledger 状态。

### 12.3 `retry-task`

- 只接受稳定 `blocked` 任务。
- 必须绑定上一个 attempt 的结束证据。
- 必须提供 `ConfirmWaveTaskRetry`、当前 ledger SHA-256 和上一个 attempt failure/receipt SHA-256。
- 创建新的 `attemptId/claimId/lockId`。
- 不复用或覆盖旧 attempt 路径。
- manifest 进入 `freezing` 后禁止 retry。

## 13. 并行执行

`execute-wave` 需要：

```text
ConfirmWaveExecute
ExpectedWaveLedgerSha256
ExpectedCreationReceiptSha256
```

流程：

1. 在短期 ledger mutation lock 下按稳定任务顺序 claim 所有 `pending` 项。
2. 每个任务取得独立 execute.lock。
3. 使用 `Promise.allSettled` 并行运行。
4. 不信任 Promise 返回值作为成功事实。
5. 所有调用结束后重新读取 attempt result、receipt、ledger 和 Git 事实。
6. 根据真值表计算 wave 状态。

重复协调器不能再次 claim `claiming/running` 项。

一次执行批准不自动覆盖 `retry-task` 或 `recover-attempt`。

## 14. Integration Manifest 原子冻结

### 14.1 准入

只有：

- 所有任务均为 `ready-for-integration`。
- 无 execute.lock、claiming/running/blocked 任务。
- 全部 execution receipt 与候选 Git 事实一致。

才允许冻结。

### 14.2 Freeze 顺序

```text
获取 ledger mutation lock
-> 生成 freezeId
-> ledger: ready-for-integration -> freezing
-> exclusive-create manifest-preparation.lock
-> 释放 ledger mutation lock
-> 重读全部执行证据和 Git 事实
-> 生成确定性 manifest
-> owner guard
-> exclusive-create integration-manifest.json
-> 获取 ledger mutation lock
-> 绑定 manifest SHA-256
-> ledger: freezing -> integration-frozen
-> owner-checked 释放 preparation lock
```

两个协调器只能有一个 freeze owner。

已存在 manifest 只能逐字段验证后复用，绝不覆盖。

`manifest-preparation.lock` 必须绑定 `lockId/freezeId/storyId/runId/waveId/ledgerSha256/creationReceiptSha256/pid/createdAt`，其替换、释放和恢复均按当前 owner 校验。

manifest 写入后，C1 的 claim、retry、recover、result 和 execution receipt 变更入口全部关闭。

### 14.3 Freeze 恢复

中断恢复使用显式 `recover-freeze`，绑定：

```text
freezeId
ExpectedPreparationLockSha256
ExpectedLedgerSha256
ConfirmManifestFreezeRecovery
```

不自动清理遗留 preparation lock。

## 15. Manifest 内容

Manifest 绑定：

```text
storyId/runId/phase
waveId/waveIndex
preparedRevision
taskDagFile/taskDagSha256
wavePlanFile/wavePlanSha256
creationReceiptFile/creationReceiptSha256
baseCommit
mainHeadCommit
businessStatusSnapshot
tasks
candidateFiles
createdAt
```

每个任务绑定 dispatch、checkpoint、attempt result、execution receipt 及 SHA-256。

每个候选绑定：

```text
taskId
path
type
sha256
bytes
```

业务状态快照至少覆盖：

- `backend/src/**`
- `frontend/src/**`
- 全部候选路径。
- 正式 phase artifact 路径。

首次主树写入前拒绝：

- 相同路径冲突。
- Windows 大小写等价冲突。
- 文件与父子路径冲突。
- 超出 `predictedFiles`。
- 任务、计划、Worktree HEAD 或 receipt 漂移。
- 候选范围外业务文件变化。

首版任务互不冲突，因此不实现继承快照或同路径 replacement。

## 16. Integration Owner 与恢复

### 16.1 普通获取

`integrate-wave` 需要：

```text
ConfirmWaveIntegrate
ExpectedIntegrationManifestSha256
```

使用：

```text
integration.lock
integration-recovery.lock
```

普通 owner 绑定：

```text
lockId
freezeId
manifestSha256
storyId
runId
waveId
pid
createdAt
```

### 16.2 遗留锁接管

必须提供：

```text
ConfirmWaveIntegrationRecovery
ExpectedIntegrationLockSha256
ExpectedIntegrationRecoveryLockSha256（存在时）
```

恢复顺序沿用 M5-D-B：

1. 读取全部现存 integration 锁快照。
2. 要求每个现存锁都有对应预期 SHA-256。
3. 实际替换前重新读取完整锁集合。
4. 原子写入带新随机 `lockId` 的 recovery lock。
5. 写后确认磁盘 `lockId` 属于本次调用。
6. 再次确认原 integration lock 未变化。

旧 owner 看到 recovery lock 后立即失权。

恢复失败时保留锁；只在最终回执成功后清理恢复锁。

### 16.3 逐写点 Fencing

以下动作前重验 manifest 与 owner：

- 每个主树候选原子替换。
- 每任务 integration receipt 写入。
- ledger 更新。
- phase task/result/notes 写入。
- wave receipt 写入。
- checkpoint 更新。
- 锁释放。

## 17. 确定性串行集成

任务顺序来自 WavePlan 的稳定任务排序。

主工作树允许的业务差异必须严格等于：

```text
已集成确定性前缀
+ 当前正在集成的任务
```

每项写入前重新验证：

- HEAD 未变化。
- 完整业务状态快照无额外漂移。
- 已集成前缀文件与 receipt 一致。
- 当前候选与 manifest 一致。
- 后续任务候选尚未写入主树。
- 当前 owner 仍有效。

任务完成顺序：

```text
原子写入当前任务候选
-> 重新读取主树文件
-> 写 integration receipt
-> ledger task: ready-for-integration -> integrated
```

## 18. 集成失败与恢复

Wave 状态：

```text
integration-frozen
-> integrating
-> partial-integration
-> integrated
```

若 T1 成功、T2 失败：

- 保留 T1 文件和 integration receipt。
- 不回滚 T1。
- 重试时先验证 T1 仍等于已集成前缀。
- 从 T2 继续。
- 外部业务文件修改时保留前缀并拒绝后续写入。

不提供自动冲突解决或主树回滚。

## 19. `finalize-wave`

只有所有任务均为 `integrated` 时允许执行。

`integrate-wave` 在全部任务 integrated 后保留当前 integration lock，不提前释放。`finalize-wave` 必须接收并核对 `ExpectedIntegrationManifestSha256` 与 `ExpectedIntegrationLockSha256`，但不需要新增外部操作批准。

由 `story-runtime` 在有效 integration owner 下按固定顺序：

```text
1. 生成 phase v1.0 task.json/result.json/notes
2. 生成 wave receipt，绑定 phase 产物及全部 execution/integration 证据
3. ledger 标记 finalized 并绑定 wave receipt SHA-256
4. checkpoint 写入精确 waveFinalization
5. owner-checked 释放 integration/recovery lock
6. 返回 ready-for-apply
```

`checkpoint.waveFinalization` 至少绑定：

```text
waveId
waveLedgerFile/waveLedgerSha256
waveReceiptFile/waveReceiptSha256
taskFile/taskSha256
resultFile/resultSha256
notesFile/notesSha256
preparedRevision
finalizedAt
```

M3 `apply` 必须重新验证：

- implementation owner 为当前 `worktree-wave`。
- ledger 为 finalized。
- wave receipt、phase 产物和 checkpoint 哈希一致。
- 当前 revision 等于 prepared revision，或满足既有历史 revision 恢复规则。

M3 只推进一次；重复 apply 幂等。

## 20. 共享代码边界

不复制第三套完整 Worker/Integration。

允许抽取的纯底层能力：

- task-scoped dispatch/result 精确校验。
- 路径、候选和 Git 事实校验。
- manifest/receipt 哈希读取与验证。
- bundle 构建。
- 原子文件替换循环。
- 可注入的 owner guard。

保持独立：

- v1.0 单任务上下文和状态。
- v1.1 serial batch ledger、继承和 claim。
- v1.2 wave ledger、并行 attempt 和共同 base。
- wave 主树集成前缀策略。

## 21. 接口边界

### 21.1 M3 PowerShell 入口

`run-story.ps1` 增加：

```text
prepare-wave
finalize-wave
```

只接受派生身份所需的 state、DAG 和 wave index；不接受调用方自定义 waveId、dispatchId、taskRoot 或产物路径。

### 21.2 Wave 协调 Runtime

首版提供内部 Node API：

```text
status
execute-wave
retry-task
recover-attempt
freeze-integration
recover-freeze
integrate-wave
recover-integration
```

由于本阶段仍使用注入式 Mock Provider，不提供声称可启动真实 Agent 的 CLI。

## 22. TDD 验收矩阵

### 22.1 Phase 所有权

- wave owner 存在时普通 `prepare` 拒绝。
- wave owner 存在时 `prepare-batch` 拒绝。
- ordinary/batch owner 存在时 `prepare-wave` 拒绝。
- 未 finalized wave 的普通 `apply` 拒绝。
- `reconcileAdvancedResult` 按历史 revision 重验 `waveFinalization`。

### 22.2 Dispatch v1.2

- 精确字段与 Schema。
- Runtime 派生身份不可注入。
- v1.0/v1.1 路由保持不变。
- 未知版本和跨 taskRoot 路径拒绝。

### 22.3 Attempt 与并行

- 测试 barrier 证明多个 Worker 同时进入执行区间。
- 双协调器对每任务只产生一个有效 attempt。
- claim 落盘后、task lock 建立前中断。
- task lock 建立后、ledger running 前中断。
- 候选、result、receipt、ledger 和 release 点替换锁，旧 owner 失权。
- blocked result 存在后显式 retry。
- 旧 Provider 在新 attempt 建立后返回时不能写入。
- 孤儿候选无完整证据时失败关闭。
- status 查询不持久化动态观察。

### 22.4 Manifest Freeze

- 任一任务未 ready 时拒绝冻结。
- 双协调器并发首次冻结只能产生一个 manifest。
- manifest 写入后、integration lock 建立前中断。
- 已存在 manifest 只可精确复用，不能覆盖。
- freeze 后 claim/retry/recover 全部拒绝。
- preparation lock 恢复必须绑定锁和 ledger 哈希。

### 22.5 主树集成

- 同路径、大小写等价和父子路径冲突在首次写入前拒绝。
- 候选超出 predictedFiles 拒绝。
- 业务目录出现额外修改时拒绝。
- 双协调器只有一个 integration owner。
- integration lock 在 manifest、候选、receipt、ledger、phase 产物、wave receipt、checkpoint 和 release 点替换时旧 owner 失权。
- 稳定任务顺序和已集成前缀验证。
- T1 成功、T2 失败后只重试 T2。
- 两任务之间出现 unrelated business change 时保留前缀并拒绝后续写入。

### 22.6 Finalize 与 M3

- 多 wave DAG 不能生成 phase result。
- 未全部 integrated 时 finalize 拒绝。
- 固定顺序为 phase artifacts、wave receipt、ledger、checkpoint。
- phase 产物或 receipt 漂移时 M3 apply 拒绝。
- M3 apply 只推进一次且重复调用幂等。
- M3 已推进但 checkpoint 提交中断时，可按历史 revision 恢复。

### 22.7 回归

至少覆盖：

```text
M3 v1.0
M5-B3-B v1.1
M4-B Worker
M5-A
M5-B1
M5-B2
M5-C
M5-D-A
M5-D-B
Harness structure/state/smoke
```

## 23. 正式仓库安全边界

开发和验收期间，真实：

- 多 Worktree 创建。
- 并行 Worker。
- 主工作树候选集成。
- 锁替换和中断恢复。

只允许发生在临时 Git fixture。

正式 `D:\ProjectStudy\FrontierScan` 仓库不执行：

- `WaveCreate`。
- `execute-wave`。
- `integrate-wave`。
- M5-B2 Apply。
- Worktree 创建或回收。
- merge、reset、clean、branch delete 或 prune。
- 自动 Git 交付、发布或部署。

## 24. 完成定义

### 24.1 M5-D-C1

- v1.2、implementation owner、prepare-wave、ledger、attempt fencing、并行 Worker、partial/retry/recover 全部通过 TDD。
- C1 不写主工作树，不生成 phase result，不推进状态。
- C1 Review 无未解决 `BLOCKER/WARNING`。

### 24.2 M5-D-C2

- manifest 原子冻结、候选全局预检、integration owner、前缀集成、恢复、finalize-wave 和 M3 apply 纵向 fixture 通过。
- 主工作树只有一个可验证写入者。
- M3/M2 状态不领先于代码事实。
- C2 Review 无未解决 `BLOCKER/WARNING`。

### 24.3 总体

- 单 Story、单个完整 implementation wave 从 WaveCreate ready 收敛到 M3 apply 成功。
- v1.0/v1.1 和 M5-A 至 M5-D-B 无行为回归。
- 正式仓库没有未经批准的 Worktree、Apply、Git、发布或部署副作用。

## 25. 独立评审处理结果

第一轮评审提出：

- phase 提前推进。
- Worker 旧 owner 写回。
- 主树多写者与前缀缺失。
- 最终产物顺序错误。
- v1.1 语义误用和重复实现风险。

第二轮评审继续提出：

- implementation phase 普通/batch/wave 所有权未统一。
- claim/task lock 半完成状态和 attempt 历史恢复未闭合。
- integration manifest 首次冻结缺少并发原子性。
- 顶层状态缺少确定性真值表。
- 并发和历史 revision 测试矩阵不足。

本设计已经分别通过：

- implementation owner 契约。
- dispatch v1.2。
- 不可变 attempt、逐写点 fencing 和显式 `recover-attempt`。
- manifest preparation 临界区和显式 `recover-freeze`。
- integration/recovery 双锁与 M5-D-B 式接管。
- 状态真值表。
- 修订后的 TDD 矩阵。

吸收上述发现。尚未开始实现，后续仍需把本设计转换为逐任务实施计划并再次审核。
