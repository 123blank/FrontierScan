# Harness M5-D-D WaveRetire 生命周期回收设计

> Story：`M5-D-D-001`
>
> 日期：2026-08-07
>
> 状态：待用户审阅

## 1. 目标

M5-D-D 为已完成 M5-D-C2 闭环的单个完整 implementation wave 增加审批门控的多 Worktree 回收能力。
回收只移除 Git Worktree 注册和目录，保留任务分支，并通过完成态证据、显式 owner、稳定回执前缀和 Git 事实支持
中断恢复。

```text
WaveCreate ready
  -> parallel Worker
  -> integration manifest freeze
  -> stable integration
  -> finalize-wave
  -> M3 apply
  -> target Story done/completed
  -> WaveRetire preflight
  -> approval + ConfirmRetire
  -> stable Worktree removal
  -> task retirement receipts
  -> wave retirement receipt
```

## 2. 已确认边界

- 首版只删除 Worktree 注册和目录，所有任务分支保留。
- 只接受 `phase === "done"` 且 `runtime.status === "completed"` 的目标 Story。
- 只接受 `status === "finalized"` 的 Wave execution ledger。
- `checkpoint.waveFinalization`、M3 apply、正式 task/result/implementation-notes 和 wave receipt 必须完整。
- 扩展现有 `worktree-runtime.mjs` 与 `run-worktree.ps1`，不新增第二套 Runtime。
- 不重构现有 `Retire`、`BatchRetire` 为通用框架；只复用已有 Git、路径、JSON、锁和校验辅助函数。
- 不执行分支删除、`git worktree prune`、merge、reset、clean、提交、推送、发布或部署。
- 正式 FrontierScan 仓库不执行真实 WaveRetire；Git 删除只在临时 fixture 中运行。

## 3. 方案选择

### 3.1 采用方案

在现有 Worktree Runtime 中新增 `wave-retire` 分支。它从完成态 Wave 证据派生任务、分支、路径和基准，按稳定顺序
回收多个 Worktree。

### 3.2 不采用独立 Runtime

新增 `wave-retirement-runtime.mjs` 会复制根路径限制、Git argv、Worktree 解析、原子 JSON 和生命周期完整性校验，
增加两套安全边界。

### 3.3 不采用统一 Retirement Engine

单任务、串行批次和 Wave 的证据结构不同。当前重构为统一引擎不会减少本 Story 的核心复杂度，反而扩大旧路径回归面。

## 4. 接口

PowerShell 入口：

```powershell
.\.harness\scripts\run-worktree.ps1 `
  -Command WaveRetire `
  -StateFile <completed-state-file> `
  -TaskDagFile <task-dag-file> `
  -WaveIndex <1-based-index> `
  -ExpectedWaveLedgerSha256 <sha256> `
  -ExpectedWaveReceiptSha256 <sha256> `
  -ConfirmRetire `
  [-ExpectedRetirementLockSha256 <sha256>] `
  [-ExpectedRetirementRecoveryLockSha256 <sha256>] `
  [-ConfirmWaveRetireLockRecovery] `
  [-Json]
```

内部调用：

```js
runWorktreeCommand({
  root,
  command: "wave-retire",
  stateFile,
  taskDagFile,
  waveIndex,
  expectedWaveLedgerSha256,
  expectedWaveReceiptSha256,
  confirmRetire,
  expectedRetirementLockSha256,
  expectedRetirementRecoveryLockSha256,
  confirmWaveRetireLockRecovery,
})
```

调用方不能提供 `taskId`、branch、Worktree path、base ref 或 base commit。所有身份从 Task DAG、WavePlan、creation
receipt 和 finalized ledger 派生。

## 5. 产物与路径

Wave 根目录：

```text
.harness/runs/<runId>/waves/<waveId>/
```

新增产物：

```text
worktree-retire.lock
worktree-retire-recovery.lock
tasks/<taskId>/retirement-receipt.json
wave-retirement-receipt.json
```

新增 Schema：

```text
.harness/schemas/worktree-wave-retirement-lock.schema.json
.harness/schemas/worktree-wave-retirement-recovery-lock.schema.json
.harness/schemas/worktree-wave-task-retirement-receipt.schema.json
.harness/schemas/worktree-wave-retirement-receipt.schema.json
```

不修改 finalized execution ledger，也不新增可变 retirement ledger。

## 6. 证据模型

### 6.1 完成态证据

回收必须重新读取并绑定：

- state file、event log 和 backup 的路径、SHA-256 与字节数。
- `phase === "done"`、`runtime.status === "completed"` 和目标 `runId`。
- Task DAG、WavePlan 和 creation receipt。
- integration manifest、finalized execution ledger 和 wave receipt。
- implementation task、result、checkpoint 和 implementation-notes。
- `checkpoint.waveFinalization` 中的 ledger、manifest、wave receipt 与正式产物绑定。
- M3 apply 已完成且状态没有领先或落后于正式代码事实。

### 6.2 任务证据

每个任务绑定：

- `taskId`、WavePlan 顺序、branch、Worktree path 和 base commit。
- selected attempt、result、execution receipt 和 task-start manifest。
- integration receipt、候选文件和最终 applied files。
- Worktree 当前 Git 注册、branch、HEAD 和可解释变更。

### 6.3 最终回执

`wave-retirement-receipt.json` 必须绑定：

- 完成态 state/events/backup。
- Task DAG、WavePlan、creation receipt。
- integration manifest、finalized ledger、wave receipt。
- implementation task/result/checkpoint/notes。
- 按稳定顺序排列的任务回执路径和 SHA-256。
- 最终 applied files 摘要。
- `retiredAt` 和 `recovered`。

复用最终回执时仍重跑完整证据验证，不能只信任回执本身。

## 7. 普通 owner 与显式恢复 owner

### 7.1 普通回收

不存在 retirement/recovery lock 时，以独占创建方式写入 `worktree-retire.lock`。锁至少绑定：

- `lockId`
- `retirementId`
- Story/run/wave 身份
- WavePlan、creation receipt、ledger 和 wave receipt SHA-256
- `pid`
- `createdAt`

每次 Git 删除、任务回执写入、最终回执写入和锁释放前，都重新读取锁并验证 `lockId` 与当前 SHA-256。

### 7.2 遗留锁接管

发现普通锁或 recovery lock 时，默认失败关闭。只有调用方同时提供：

- `ConfirmWaveRetireLockRecovery`
- 所有现存 retirement/recovery lock 的预期 SHA-256
- 当前 finalized ledger 和 wave receipt 的预期 SHA-256

才允许创建 replacement recovery owner。

接管流程复用 WaveCreate 的双锁模式：

1. 读取并验证全部现存锁。
2. 写 recovery lock 前再次验证锁快照。
3. 原子写入新的 recovery lock。
4. 每个后续写点验证普通锁和 recovery lock 身份。
5. 接管失败或中断时保留证据，不按时间或 PID 自动删除。
6. 只删除本次 owner 持有且哈希一致的锁，不能删除 replacement lock。

## 8. 冲突锁集合

首次预检、取得 retirement owner 后和每项删除前，都从固定运行目录派生并检查：

- WaveCreate 普通锁与 recovery lock。
- `ledger-mutation.lock`。
- 每任务 `execute.lock`。
- `manifest-preparation.lock`。
- `integration.lock` 与 `integration-recovery.lock`。
- implementation preparation/finalization lock。
- retirement 普通锁与 recovery lock；当前 owner 自身锁除外。

完成态本身不能替代锁检查。任何遗留 writer 锁均阻止删除。

## 9. 全局预检

首次 Git 删除前必须一次性验证全部任务：

1. 完成态、DAG、WavePlan、creation receipt、ledger 和 wave receipt 一致。
2. M3 checkpoint 与正式产物一致。
3. 所有任务 execution/integration 证据完整。
4. 主工作树 applied files 与最终哈希一致。
5. 全部任务分支仍存在且指向各自 `baseCommit`。
6. 全部 Worktree 注册、目录、branch、HEAD 和允许变更一致。
7. 所有冲突锁不存在。

任一任务失败时，不删除任何 Worktree。

取得 retirement owner 后必须重新执行全局预检，关闭预检与首个 Git 删除之间的竞争窗口。

## 10. 主树精确允许集

不能忽略整个 `.harness/runs/**`。每次主树检查只允许：

- 已绑定完成态、DAG、Wave、M3 和正式产物证据。
- 当前普通/recovery retirement owner 的锁文件。
- 稳定任务前缀中已完整验证的 task retirement receipt，按路径、SHA-256 和字节数精确绑定。
- 最终 wave retirement receipt 仅在幂等复用路径中允许。

任何其他新文件、内容漂移、删除、重命名或遗留 `.tmp-*` 均失败关闭。

第一个任务回执写入后，必须将它作为已验证前缀加入允许集，再执行第二个任务删除前的主树重验。

## 11. 稳定回收流程

任务严格按 WavePlan 顺序处理：

1. 验证 retirement owner 和全部冲突锁。
2. 重新计算主树精确允许集并验证。
3. 重新验证当前任务 Worktree、branch、HEAD 和变更集合。
4. 若已有匹配任务回执，要求 Worktree 注册和目录均已不存在，然后复用。
5. 若 Worktree 存在，执行固定 argv：

   ```text
   git worktree remove --force <derived-absolute-path>
   ```

6. Git 返回成功后再次验证 owner。
7. 后验确认：
   - `git worktree list --porcelain` 不再包含目标路径。
   - 目标目录不存在。
   - 保留分支存在且仍指向 `baseCommit`。
8. 原子写入任务 retirement receipt。
9. 再次验证 owner 后进入下一任务。

## 12. Partial Retirement 与恢复

已完成任务形成稳定 retirement 前缀，不回滚。

### 12.1 有任务回执

任务回执必须与当前全部上游证据一致，且 Worktree 注册和目录均不存在。满足时复用回执。

### 12.2 Git 已删除但回执未写

只有以下事实同时成立时补写 `recovered: true`：

- 当前 owner 有效。
- Worktree 注册和目录均不存在。
- 保留分支仍存在并指向 `baseCommit`。
- 完成态、ledger、wave receipt、任务 execution/integration 与 applied files 证据全部匹配。
- 该任务之前的稳定回执前缀完整，后续任务尚未产生越序回执。

无法证明时失败关闭，不创建回执，也不继续后续任务。

### 12.3 最终回执恢复

全部任务回执存在且验证通过，但最终回执缺失时，可原子补写 `recovered: true`。

已有最终回执时，必须重验全部完成态和任务证据，并确认所有 Worktree 缺失、所有分支保留后才幂等复用。

## 13. 失败语义

- 任一首次全局预检失败：零 Worktree 删除。
- partial retirement 后失败：保留已删除前缀和任务回执，不恢复目录，不删除后续 Worktree。
- Git 删除失败：不写当前任务回执。
- Git 返回成功但后验事实不满足：不写回执，后续通过受约束恢复调查。
- owner 失权：旧调用不能继续删除、写回执或释放锁。
- 任一不确定状态：失败关闭并保留全部证据。

## 14. TDD 计划

每项生产逻辑先观察直接 RED，再做最小 GREEN。

### 14.1 门禁

- 缺少外部批准、`ConfirmRetire` 或预期 ledger/wave receipt 哈希。
- 目标非 `done/completed`。
- ledger 非 `finalized`。
- M3 checkpoint、正式产物、manifest、receipt 或 applied files 漂移。

### 14.2 全局预检

- 任一任务 branch/HEAD、Worktree、候选或输入漂移时，所有 Worktree 均保持存在。
- 未知主树文件、Worktree 文件、删除、重命名、忽略文件和链接父目录均拒绝。

### 14.3 锁与并发

- 覆盖全部 Wave 和 implementation 冲突锁。
- 并发普通回收只能一个 owner。
- 真实子进程终止后遗留普通锁，缺少恢复确认时拒绝。
- 正确预期哈希与恢复确认可接管。
- replacement lock 出现后旧 owner 不能删除 Worktree、写回执或释放新锁。

### 14.4 Partial Retirement

- T1 回执写入后，T2 删除前的主树重验接受精确前缀。
- 篡改 T1 回执、增加越序 T2 回执或遗留 `.tmp-*` 时拒绝。
- T1 删除后中断可恢复，T2 仍存在且不会被越序处理。

### 14.5 Git 后验

- Git 返回成功但注册仍存在、目录重新出现或分支漂移时不写任务回执。
- 正常删除后注册和目录消失、分支保留。

### 14.6 纵向闭环

临时 Git fixture 完整运行：

```text
WaveCreate
  -> parallel Worker
  -> integrate
  -> finalize-wave
  -> M3 apply
  -> Story done
  -> WaveRetire
```

断言：

- 全部 Worktree 注册和目录消失。
- 所有任务分支保留并指向原 `baseCommit`。
- 主树业务文件、正式产物和完成态 State 字节不变。
- 任务回执和最终回执可恢复、可幂等复用。

### 14.7 回归

- 单任务 `Retire`。
- 串行 `BatchRetire`。
- WavePlan/WaveCreate、Wave Execution、Worker 和 Story Runtime。
- Harness 结构、状态、Task DAG、Smoke、知识新鲜度和差异检查。

## 15. 延期项

- 任务分支删除及其审批协议。
- `git worktree prune`。
- 手工迁移、损坏或外部创建的 Worktree 修复。
- 遗留锁按时间/PID 自动判定。
- 真实 Agent、Fork-Join、自动 Git 交付、发布和部署。

## 16. 独立评审吸收结果

独立只读 Agent 提出的两项 BLOCKER 已闭合：

- 增加普通/recovery 双锁与显式哈希接管协议。
- 增加 stable task receipt prefix 的精确主树允许集。

三项 WARNING 已进入正式契约和测试矩阵：

- 补全所有 Wave/implementation 冲突锁。
- 最终回执绑定完成态、M3 与正式产物证据。
- 每项 Git 删除后执行注册、目录和保留分支后验检查。

## 17. 设计自审

- 占位符检查：无 `TBD`、`TODO` 或未定义的生产行为。
- 一致性检查：接口、证据、锁、恢复、回执和测试使用相同身份与路径模型。
- 范围检查：仅实现 Wave Worktree 回收并保留分支，不扩展分支删除或通用框架。
- 歧义检查：首次失败零删除，partial failure 保留稳定前缀，所有未知状态失败关闭。
