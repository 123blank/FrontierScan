# Harness M5-D-B 审批门控 WaveCreate 设计

> 拟议 Story：`M5-D-B-001`
>
> 日期：2026-08-04
>
> 状态：设计已由用户分段确认，尚未初始化实施型 Harness Story。
>
> 范围：只设计同一合法 wave 的审批门控 Worktree 创建、波次级锁、部分创建恢复和完成证据；不修改业务源码。

## 1. 背景与现状

M5-D-A 已在现有 Worktree Runtime 中实现只读 `WavePlan/WaveStatus`：

- 为同一合法 wave 固定统一 `baseCommit`。
- 按稳定 `taskId` 顺序派生每任务分支和 Worktree 路径。
- 从 Git 事实识别任务级 `absent/branch-only/created`。
- 聚合 wave 状态为 `absent/partial/ready`。
- 对 DAG、基准、任务集合、分支、路径、HEAD、junction、计划外 Worktree 和异地分支挂载漂移失败关闭。
- 不创建 Worktree，不启动 Worker，不合并或删除，不修改 M2/M3 状态。

现有单任务 `Create` 和串行批次 `BatchCreate` 已验证显式确认、固定 Git argv、主工作树检查、原子 JSON 写入和受限恢复，但它们的身份、锁和“同一 Story 只允许一个 Worktree”约束不能直接用于多 Worktree wave。

M5-D-B 在 M5-D-A 之上增加创建能力，不创建第二套 Runtime。

## 2. 目标

为已经存在且通过校验的 `WavePlan` 提供：

```text
approved immutable WavePlan
  -> WaveCreate
  -> 按稳定顺序创建或恢复每项 Worktree
  -> Git 事实收敛为 ready
  -> 写入完成回执
```

首版必须满足：

1. 一次调用只处理一个明确 wave。
2. 一次用户批准覆盖该 wave 的完整固定计划，不覆盖其他 wave。
3. 批准必须绑定用户实际看到的计划 SHA-256。
4. 部分失败后保留已创建项，后续只重试缺失项。
5. 遗留锁不按时间或 PID 自动失效，只能在用户明确批准后恢复。
6. 同一 Story 同一时间只允许一个 wave 拥有已创建 Worktree。
7. 不修改 Harness phase、revision 或 M2/M3 状态。

## 3. 已确认决策

### 3.1 审批粒度

每个明确 wave 一次批准。批准绑定：

- `storyId/runId/wave`
- `plan.json` SHA-256
- Task DAG SHA-256
- 完整任务列表和顺序
- 每任务分支与 Worktree 路径
- `baseCommit`

批准不跨 wave 复用；计划内容或哈希变化后必须重新批准。

### 3.2 部分失败

部分创建失败时：

- 保留已成功创建的 Worktree。
- 以 Git 事实记录 `partial`。
- 修复失败原因后，只重试 `branch-only` 或 `absent` 项。
- 不自动回滚、删除、reset、merge、retire 或清理分支。
- 任何回收操作继续使用独立审批边界。

### 3.3 遗留锁

- 不按时间、PID 或主观超时自动认定锁失效。
- 用户必须明确确认旧创建进程和其他恢复进程已经停止。
- Runtime 必须重新校验锁、计划和 Git 事实后才能接管。
- 锁损坏、身份不符或哈希不匹配时失败关闭，不自动清理。

该人工确认是首版可信操作前提。如果确认不真实，普通 JSON 文件锁无法提供操作系统级强制隔离；OS 级租约锁不在本 Story 范围内。

## 4. 技术方案

采用方案 A：在现有入口中原生扩展。

主要修改位置：

```text
.harness/scripts/lib/worktree-runtime.mjs
.harness/scripts/run-worktree.ps1
.harness/scripts/tests/worktree-wave-runtime.test.mjs
```

按需要增加严格 Schema、结构登记和 M5-D-B 文档，但不创建新的 Wave Runtime。

现有单任务 `assertNoOtherStoryWorktree` 语义保持不变。Wave 创建新增专用 allowlist 校验，避免削弱 M5-A/M5-B3-B 的既有约束。

## 5. 接口

PowerShell 入口：

```powershell
.\.harness\scripts\run-worktree.ps1 `
  -Command WaveCreate `
  -StateFile <state-file> `
  -TaskDagFile <task-dag-file> `
  -WaveIndex <1-based> `
  -ExpectedPlanSha256 <sha256:...> `
  -ConfirmWaveCreate `
  [-ConfirmWaveLockRecovery] `
  [-ExpectedCreateLockSha256 <sha256:...>] `
  [-ExpectedRecoveryLockSha256 <sha256:...>] `
  [-Json]
```

内部入口：

```js
runWorktreeCommand({
  command: "wave-create",
  root,
  stateFile,
  taskDagFile,
  waveIndex,
  expectedPlanSha256,
  confirmWaveCreate: true,
  confirmWaveLockRecovery,
  expectedCreateLockSha256,
  expectedRecoveryLockSha256
})
```

约束：

- `WaveCreate` 不接受 `BaseRef`、`TaskId`、分支或路径参数。
- `baseRef/baseCommit` 只能来自已批准计划。
- `TaskDagFile` 只用于与 `plan.taskDagFile` 对账。
- `WaveCreate` 不隐式执行 `WavePlan`，也不覆盖现有计划。
- 恢复参数只能与 `ConfirmWaveLockRecovery` 一起使用。
- 普通创建发现任意创建锁或恢复锁时立即失败。

## 6. 固定产物

```text
.harness/runs/<runId>/waves/wave-<n>/plan.json
.harness/runs/<runId>/waves/wave-<n>/status.json
.harness/runs/<runId>/waves/create.lock
.harness/runs/<runId>/waves/create-recovery.lock
.harness/runs/<runId>/waves/wave-<n>/creation-receipt.json
```

所有路径由 `storyId/runId/wave` 确定性派生，不接受外部任意路径。
计划、状态和回执按 wave 隔离；创建锁与恢复锁由同一 run 的所有 wave 共享，使不同 wave 在任何 Worktree 出现前也只能有一个进入创建临界区。锁内的 `wave/planSha256` 继续固定实际所有者身份。

锁必须是预期目录中的普通非符号链接文件。锁结构至少包含：

```json
{
  "schemaVersion": "1.0",
  "lockId": "<random UUID>",
  "mode": "create",
  "storyId": "M5-D-B-001",
  "runId": "M5-D-B-001",
  "wave": 1,
  "planSha256": "sha256:...",
  "pid": 1234,
  "createdAt": "2026-08-04T00:00:00.000Z"
}
```

`mode` 只允许 `create` 或 `recovery`。锁文件哈希由 Runtime 读取文件字节后计算，不写入锁自身。

## 7. 批准绑定与 TOCTOU 防护

`ExpectedPlanSha256` 是必填批准证据，不是诊断参数。

Runtime 必须在以下位置重新读取磁盘文件并比较哈希：

1. 获取任何锁之前。
2. 成功持有锁并重新加载上下文之后。
3. 每次 `git worktree add` 之前。
4. 每次写 `status.json` 之前。
5. 写 `creation-receipt.json` 之前。

任一比较失败时：

- 停止后续 Git 写入。
- 不写完成回执。
- 只在锁所有权仍有效且 Git 事实可以被可信读取时更新真实状态。
- 本次用户批准失效。

锁恢复还必须绑定 `WaveStatus` 展示的全部现存锁 SHA-256。调用方不得省略存在锁对应的预期哈希，也不得为不存在的锁提供伪造哈希。

锁快照只出现在 `WaveStatus` 命令结果的顶层 `locks` 字段，不写入 `status.json`。`status.json` 只保存稳定 Git 事实，使完成回执绑定的 `statusSha256` 不会因活动锁获取或释放而失效。

状态持久化职责严格限定为：

- 首次 `WavePlan` 初始化计划对应的状态文件。
- 持有有效创建或恢复 owner 的 `WaveCreate` 更新后续稳定状态。

复用 `WavePlan` 和普通 `WaveStatus` 只计算并返回当前 Git 事实，不改写 `status.json`。这样陈旧查询即使在创建期间暂停，也不能在完成回执写入后覆盖其绑定状态。

## 8. 普通创建流程

1. 校验 `ConfirmWaveCreate` 和 `ExpectedPlanSha256`。
2. 加载 active Story、现有 WavePlan 和 Task DAG。
3. 校验 Story 仍处于 `implementation`。
4. 校验计划 SHA-256、DAG SHA-256、任务集合、任务状态、分支、路径和 `baseCommit`。
5. 确认 `create-recovery.lock` 不存在。
6. 使用独占创建方式写入 run/Story 共享且带新 `lockId` 的 `create.lock`。
7. 再次确认 `create-recovery.lock` 不存在；若恢复锁在竞争窗口出现，立即停止且不删除 `create.lock`，由恢复所有者按已批准锁哈希统一对账和清理。
8. 持锁重新加载全部输入，不复用锁前对象。
9. 检查主工作树干净、`baseRef` 仍指向计划 `baseCommit`、父目录安全和 wave 专用 allowlist。
10. 读取当前 `WaveStatus`。
11. 按计划稳定顺序处理任务：
    - `created`：复核并跳过。
    - `branch-only`：挂载仍指向计划基准的现有分支。
    - `absent`：从固定 `baseCommit` 创建计划分支和 Worktree。
    - 其他不一致：失败关闭。
12. 每次 Git 写入前验证计划哈希和锁所有权。
13. 每次 Git 成功后重新检查整个 wave，并在验证锁所有权后原子更新状态。
14. 全部任务达到 `ready` 后完整对账，写完成回执。
15. 返回前再次验证锁所有权，只删除自身仍拥有且内容未变化的锁。

不使用每任务子锁，避免波次锁与任务锁交叉。

## 9. 波次专用 Worktree Allowlist

首版允许：

- 主工作树。
- 当前计划精确列出的 Worktree 路径。

必须拒绝：

- 当前 Story 其他 wave 的 Worktree。
- 当前 Story 根目录下计划外路径。
- 计划分支挂载在其他路径。
- 计划路径被其他分支或普通目录占用。
- 计划外 Worktree 位于当前 wave 目录。
- prunable、缺失、符号链接或 junction 形式的注册路径。

该检查是 WaveCreate 专用逻辑，不修改单 Worktree helper 的现有行为。

## 10. 锁所有权与 Fencing

每个创建或恢复操作生成不可复用 `lockId`。

以下动作前必须重新读取当前锁并执行 `assertLockOwned`：

- 分支探测完成后、每次实际 Git 写入前。
- 状态内容计算和测试钩子完成后、每次实际状态写入前。
- 完成回执写入。
- 正常释放锁。

所有权至少要求：

- 文件是普通非符号链接文件。
- `lockId/mode/storyId/runId/wave/planSha256` 全部匹配。
- 文件当前 SHA-256 与操作持有的最近可信哈希匹配。
- `create` 所有者还要求 `create-recovery.lock` 不存在；恢复锁一旦出现，旧创建所有者立即失去继续执行和释放锁的资格。

锁发生替换、损坏或内容变化后，旧所有者不得：

- 继续下一个任务。
- 写状态或完成回执。
- 删除当前锁。

受控异常只能按所有权释放锁，禁止无条件 `unlink`。普通创建的受控异常可以在未被恢复锁 fencing 时释放自身创建锁；恢复调用发生任何异常时保留旧创建证据与当前恢复锁，只有 `ready` 回执已成功验证后才执行恢复清理。

## 11. 遗留锁恢复

恢复调用必须同时满足：

- `ConfirmWaveCreate`
- `ConfirmWaveLockRecovery`
- `ExpectedPlanSha256`
- 为每个当前存在的 `create.lock/create-recovery.lock` 提供对应预期 SHA-256
- 用户确认旧创建进程和其他恢复进程已经停止

恢复流程：

1. 读取并校验当前锁集合，不按时间或 PID 推断。
2. 比较所有预期锁哈希，任一缺失、额外或变化都失败。
3. 校验锁身份、计划身份和安全父目录。
4. 通过原子 JSON 替换写入带新 `lockId` 的 `create-recovery.lock`；替换前校验全部批准锁哈希，替换后必须确认磁盘锁的 `lockId` 正是本次生成值。
5. `create-recovery.lock` 是恢复调用的活动所有权；已有 `create.lock` 保留为被接管证据，不转换为新创建锁。
6. 普通创建所有者发现恢复锁后立即失去 fencing，不得继续 Git、写证据或删除原创建锁。
7. 在恢复所有权下重新校验 DAG、计划、基准、主工作树和全部 Git 事实。
8. 以当前 `created/branch-only/absent` 状态继续，不盲目重放。
9. 每个副作用继续受计划哈希和恢复锁所有权 fencing。
10. 正常结束时，先按批准哈希删除仍未变化的旧 `create.lock`，再按自身所有权删除 `create-recovery.lock`。
11. 恢复自身中断时保留恢复锁；下一次恢复必须绑定当前全部锁哈希，并原子替换恢复锁取得新的 `lockId`。两个恢复调用即使同时基于同一旧快照开始，也只有最终磁盘 `lockId` 的所有者可以继续，其他调用在任何 Git 或证据副作用前失败。

恢复接管不执行删除 Worktree、删除分支、reset、clean、prune、merge 或回滚。

实现计划必须把普通创建、首次恢复和恢复再次中断的锁转换步骤细化为可测试的确定性状态机；如果无法在现有文件锁与原子文件操作下关闭竞争窗口，应停止实施并回到技术设计，而不是弱化 fencing。

## 12. 状态与部分失败恢复

Git 事实是创建进度的权威来源。

- Git 成功但状态尚未写入：重试识别为 `created`。
- 前几个任务成功、后续任务失败：重新对账后写入真实 `partial`。
- Git 失败后无法可信读取事实：保留最后可信 `status.json`，不写推测状态。
- `ready` 已形成但回执未写入：重试重新核验后补写回执。
- 回执存在但当前 Git 事实漂移：拒绝复用回执。

状态更新不得修改 Harness state 文件。

## 13. 完成回执

`creation-receipt.json` 仅是完成与审计证据，不是 Git 事实替代品。

至少包含：

```text
schemaVersion
storyId
runId
wave
planSha256
taskDagSha256
statusSha256
baseCommit
tasks[].taskId
tasks[].branch
tasks[].worktreePath
tasks[].headCommit
lockRecovered
completedAt
```

写入条件：

1. 当前完整 Git 事实为 `ready`。
2. 当前状态文件通过结构校验且哈希已计算。
3. 当前计划哈希仍等于批准哈希。
4. 当前操作仍拥有锁。

幂等复用前必须重新验证计划、状态和 Git 事实，不能只读取回执。

## 14. 错误处理

- 所有 Git 命令继续使用固定可执行文件、参数数组、无 shell、超时和有限输出。
- 错误必须指出失败任务、失败动作和最后可信 wave 状态。
- 计划、DAG、锁、路径、分支、HEAD、基准或 allowlist 漂移一律失败关闭。
- 锁格式损坏或身份不匹配只报告诊断，不自动删除或替换。
- 无关未跟踪文件必须阻止正式创建，不为 `CODEX-CROSS-SESSION-HANDOFF.md` 设置特殊豁免。
- 正式 FrontierScan 仓库的 Worktree 创建仍需执行时单独批准；设计确认不构成创建授权。

## 15. TDD 与验收标准

### 15.1 批准与计划绑定

- [ ] 无 `ConfirmWaveCreate` 时不得获取锁或调用 Git。
- [ ] 缺少或错误 `ExpectedPlanSha256` 时不得获取锁或调用 Git。
- [ ] 计划在锁前后、任务之间或回执前漂移时停止。
- [ ] `WaveCreate` 拒绝 `BaseRef/TaskId` 等计划外身份输入。

### 15.2 正常创建与恢复

- [ ] 合法双任务 wave 按稳定顺序从 `absent` 收敛为 `ready`。
- [ ] `branch-only` 只挂载匹配分支。
- [ ] 第二项 Git 失败时第一项保留，状态为 `partial`。
- [ ] 重试只处理缺失项，不重复创建已完成项。
- [ ] Git 成功但状态未写时可从事实恢复。
- [ ] `ready` 已形成但回执未写时可补写回执。

### 15.3 并发与 Fencing

- [ ] 两个普通 `WaveCreate` 只有一个获得有效所有权。
- [ ] 恢复锁在普通获取前、获取中和获取后出现时，普通调用均安全退出。
- [ ] 旧所有者失去 `lockId` 后不能继续 Git、写状态/回执或删除新锁。
- [ ] 恢复在接管前、接管后或状态写入前中断，新的明确批准可以继续。
- [ ] 锁哈希不匹配时恢复不得修改任何锁或 Git 事实。

### 15.4 Git 与路径安全

- [ ] 拒绝 base、DAG、任务集合、分支、HEAD 和计划漂移。
- [ ] 拒绝异地挂载、路径占用、junction/symlink 和计划外 Worktree。
- [ ] 拒绝同一 Story 其他 wave 的已创建 Worktree。
- [ ] 无关未跟踪文件阻止创建，并在错误中列出阻断路径。

### 15.5 状态、回执与权限

- [ ] `ready` 前不产生完成回执。
- [ ] 回执、状态或 Git 任一漂移时拒绝幂等复用。
- [ ] Harness state 文件字节保持不变。
- [ ] 不调用 M2/M3，不启动 Worker，不 merge/remove。

### 15.6 入口与回归

- [ ] PowerShell 正确转发两个确认和预期哈希参数。
- [ ] 临时 Git fixture 真实创建多个 Worktree。
- [ ] 正式 FrontierScan 仓库不执行 Worktree 创建。
- [ ] M5-D-B 专项、M5-D-A、M5-A、M5-B3-B 和相关 M3/M2 回归通过。
- [ ] `validate-structure.ps1`、Smoke、知识新鲜度和 `git diff --check` 通过。

## 16. 排除范围

本 Story 不实现：

- 多 Worktree 并行 Worker。
- 结果汇总或自动 merge。
- 自动冲突解决。
- Worktree 回收、分支删除或 `git worktree prune`。
- 多 wave 同时创建。
- Fork-Join 运行时。
- OS 级租约锁或错误人工确认下的强制隔离。
- 真实 Agent、真实模型业务开发闭环。
- 发布、部署、Git add/commit/push/PR 自动化。

## 17. 独立评审结论

独立只读评审 Agent 对初稿给出 `reject`，主要原因是：

1. 布尔确认未绑定不可变计划。
2. 双锁协议缺少 `lockId` fencing 和按所有权释放。
3. 单 Worktree allowlist 不能直接复用。
4. `BaseRef` 调用参数与“只消费计划”冲突。

本设计已纳入上述修改：

- 强制 `ExpectedPlanSha256` 和恢复锁哈希绑定。
- 取消 `WaveCreate` 的 `BaseRef/TaskId` 输入。
- 所有副作用和释放前验证锁所有权。
- 增加 wave 专用 allowlist。
- 明确完成回执字段、事实优先级和恢复边界。

实施期独立 Review 又发现并修复了四类可复现问题：

1. 恢复异常曾无条件清理接管锁，现改为仅在 `ready` 回执成功后清理。
2. 恢复锁替换曾可能采用他人 `lockId`，现强制验证本次生成值，并覆盖双恢复并发。
3. 每-wave 独立锁不能阻止不同 wave 同时起步，现改为同一 run/Story 共享创建锁。
4. Git 分支探测后与状态写入点缺少最后 fencing，现把计划和 owner guard 下沉到实际副作用前。
5. 恢复写入前曾未重新比较全部批准锁快照，现于测试钩子后、实际替换前再次校验 create/recovery 集合。
6. 普通 `WaveStatus/WavePlan` 曾可与创建并发覆盖稳定状态，现改为动态只读，状态持久化仅由初次规划和持锁创建负责。

普通 JSON 文件锁仍不是 OS 级租约或内核强制隔离。当前协议的可信前提仍是恢复批准中的“旧创建/恢复进程已经停止”真实成立；Runtime 负责关闭已识别、可测试的并发窗口，并在锁或计划变化时失败关闭，不声称抵御错误人工确认后的恶意纳秒级替换。
