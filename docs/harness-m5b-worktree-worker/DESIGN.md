# Harness M5-B1 Worktree 内 Worker 执行与结果回收设计

## 1. 背景与目标

M3 已提供 phase 级 `task.json/result.json` 和唯一 `apply` 入口，M4-B 已提供受约束的 `runWorkerTask`，M5-A 已提供单 Worktree 的 `plan/status/create`。当前缺口是：已有 Worktree 无法安全获得当前 Story 的运行态输入，也没有把 Worker 结果按是否包含业务代码变更进行分级回收的编排层。

M5-B1 创建单 Story `M5-B1-001`，补充以下纵向链路：

```text
M3 prepare（主工作树）
  -> M5-A status（已有 Worktree）
  -> 输入快照
  -> M4-B runWorkerTask（Worktree）
  -> 结果核验与执行凭据
  -> ready-for-apply | ready-for-integration
```

目标是保证主工作树中的 M2/M3 状态不会领先于实际代码。M5-B1 不创建、合并、删除 Worktree，不执行 M3 `apply`，不启动真实 Agent，也不提供 Mock CLI。

## 2. 现状约束

- M3 的 dispatch 是 phase 级协议，`expectedOutputs` 只包含当前 phase 的 Harness 产物。
- M4-B 允许部分角色额外写入 `backend/src/` 或 `frontend/src/`，这些业务文件不进入 `result.outputs`。
- M5-A Worktree 固定在计划时的 `baseCommit`，主工作树中新生成的 `.harness/runs/<runId>/` 产物通常不在 Worktree 中。
- Worktree 中的未提交业务代码不会自动出现在主工作树；此时直接回收正式 `result.json` 并执行 `apply` 会造成状态与代码不一致。
- workflow 的 phase owner 与 Task DAG 节点 owner 不是同一层协议。M5-B1 不扩展 M3 Schema，因此只支持二者一致的单任务 Story。

## 3. 范围

### 3.1 本次实现

- 新增内部 Node 编排接口，不新增 PowerShell 或生产 Mock CLI。
- 消费 M5-A 已存在的 `plan.json/status.json`，执行前重新从 Git 事实核验 `created`。
- 校验当前 DAG 只有一个任务，且 task ID、Story、pending 状态和 owner 与 M3 task 一致。
- 生成混合输入清单：当前 run 的 Harness 产物复制到 Worktree；已提交源码和文档直接使用 Worktree 的 base 版本。
- 在 Worktree 内调用现有 `runWorkerTask`，Provider 仅由测试注入。
- 核验 Worker 写入集合并生成哈希凭据。
- 仅有 phase output 时回收到 M3 正式路径并返回 `ready-for-apply`。
- 存在 backend/frontend 业务写入时只回收独立证据并返回 `ready-for-integration`。
- 支持 Worker 已写完、主工作树凭据未写完时的同 dispatch 恢复。

### 3.2 明确排除

- Worktree 创建、合并、删除、reset、自动清理和冲突解决。
- 多任务聚合、多 Worktree 波次、Fork-Join 和并发 Agent。
- 修改 M2 state Schema、M3 dispatch Schema 或自动调用 `apply`。
- 真实 Codex Agent、任意 Provider 动态加载、shell、网络、Git 写入、发布和部署。
- 把 Worktree 业务代码复制或合并到主工作树。

## 4. 方案比较

### 方案 A：独立最小编排层（采用）

新增 `worktree-worker-runtime.mjs`，组合 M5-A 与 M4-B 的公开接口，M3/M4-B/M5-A 的职责不变。优点是修改范围小、协议边界清晰、可通过临时 Git 仓库完整测试；缺点是 M5-B1 只能处理单任务 Story。

### 方案 B：让 M4-B Worker 直接感知 Worktree

把 plan/status、输入复制和回收逻辑放进 `worker-runtime.mjs`。文件更少，但会把 Worker 权限校验与 Git/Worktree 生命周期耦合，破坏 M4-B 的可复用边界，因此不采用。

### 方案 C：立即新增 task-level dispatch 与聚合协议

可以支持多任务和多角色，但需要扩展 M3 dispatch/apply 语义和聚合门禁，实际属于 M5-B2，超出最小范围，因此延期。

## 5. 内部接口

```js
runWorktreeWorker({
  root,
  stateFile,
  taskId,
  taskFile,
  provider,
  timeoutMs = 30_000,
  contextFiles = []
})
```

约束：

- `provider` 继续遵循 M4-B 契约，只通过依赖注入传入。
- `taskFile` 必须是当前 M3 已 prepare 的 task，并与 active state 的 Story、phase、revision 一致。
- `contextFiles` 是唯一可见上下文清单，不扫描目录。
- 编排器不接受 `taskDagFile`、Worktree 路径、分支、创建确认或 apply 开关；这些值必须来自 M5-A 计划和当前状态。
- 返回值只可能是 `ready-for-apply`、`ready-for-integration` 或幂等复用结果；失败时抛错且不推进状态。

## 6. 前置门禁

执行 Provider 前必须全部满足：

1. state 为 active，Story、runId、phase 和 prepared revision 与 M3 task 一致。
2. M5-A plan 属于当前 Story/run/task，绑定 DAG 的 SHA-256 未漂移。
3. 调用 M5-A `status` 重新核验 Worktree 为 `created`，branch、path、HEAD 和 `baseCommit` 一致。
4. DAG 恰好只有一个 pending task，且其 `taskId` 和 `ownerAgent` 分别与入参及 M3 task 一致。
5. 首次执行时 Worktree 除 Git 元数据外没有未识别修改；恢复时所有已有修改都必须能由已保存输入清单和 Worker 输出解释。
6. 未发现已有的不匹配 receipt、正式 M3 result 或执行锁。

任一条件失败时 Provider 不得被调用。

## 7. 混合输入快照

输入分为两类：

- `main-run`：`task.json` 和显式指定的 `.harness/runs/<runId>/...` 文件。读取主工作树中的普通 UTF-8 文件，按相同仓库相对路径原子复制到 Worktree。
- `worktree-base`：其他显式上下文。要求文件存在于 `baseCommit`，直接读取 Worktree 当前文件，不从主工作树复制。

每项记录 `source`、`sourcePath`、`targetPath`、`sha256` 和 `bytes`。路径必须在仓库内且不得穿越符号链接。沿用 M4-B 的单文件 2 MiB、总上下文 8 MiB 限制。

该规则意味着未提交的 backend/frontend 业务源码不会被复制到 Worktree，也不会掩盖 base 漂移。

输入证据保存到：

```text
.harness/runs/<runId>/worktrees/<taskId>/input-manifest.json
```

## 8. 执行与写入核验

编排器在 Worktree 根目录调用现有 `runWorkerTask`。调用前后读取 Git 工作区事实，并将输入快照路径从候选输出中排除。新增或修改文件必须属于：

- 当前 M3 `expectedOutputs`；
- `backend/src/`；
- `frontend/src/`。

实际文件还必须符合 M4-B 对当前 owner 的策略。`main-run` 输入和未声明为候选输出的 base 上下文必须保持不变；已声明且通过 M4-B 权限校验的 base 上下文允许作为业务候选更新。发现其他输入变化、额外路径、删除或重命名时失败关闭。Provider 不获得主仓库绝对路径、Git、状态推进或外部副作用能力。

## 9. 分级回收

### 9.1 `ready-for-apply`

当 Worker 写入集合只有 `phase-output` 时：

1. 全量验证 Worktree 中的 phase outputs 和 result。
2. 将 phase outputs 原子复制到主工作树当前 phase 目录。
3. 最后写入 M3 正式 `result.json`。
4. 写入执行凭据并返回 `ready-for-apply`。

编排器不调用 M3 `apply`。调用方显式 apply 前，M2 revision 和 phase 保持不变。

### 9.2 `ready-for-integration`

只要存在 backend/frontend 业务写入：

1. 不复制任何业务文件到主工作树。
2. 不写 M3 正式 `result.json`，防止误 apply。
3. 将 Worker result 保存为独立证据 `worker-result.json`。
4. 记录全部变更路径、SHA-256、字节数和 base commit。
5. 写入执行凭据并返回 `ready-for-integration`。

后续必须由 M5-B2 或人工批准的集成流程处理业务代码；当前 phase 和 revision 不变。

## 10. 凭据与幂等恢复

凭据目录沿用 M5-A：

```text
.harness/runs/<runId>/worktrees/<taskId>/
  plan.json
  status.json
  input-manifest.json
  worker-result.json        # 仅 ready-for-integration
  execution-receipt.json
  execute.lock              # 执行期间
```

`execution-receipt.json` 至少记录 Story/run/task/dispatch/phase/owner、plan/status/input 哈希、base/head commit、结果级别、文件清单与哈希、Worker result 证据路径和完成时间。

- 已存在匹配 receipt 时，重新核验关键哈希后返回复用结果，不再次调用 Provider。
- Worker 已写完但 receipt 尚未写入时，只有 result 明确列出的 phase outputs 可根据匹配的 input manifest 和 Git 写入集合自动恢复；缺少 durable candidate list 的业务写入失败关闭并要求人工检查。
- receipt、输入、Git 事实或 dispatch 任一不一致时失败关闭。
- 使用 `execute.lock` 防止同一 task 并发执行；遗留锁不自动删除。
- 主工作树写入使用临时文件加 rename，`result.json` 最后写入。

## 11. 错误与稳定性

- 所有身份、路径、大小、策略和 Git 状态校验在主工作树回收前完成。
- Provider 超时、异常或非法输出由 M4-B 拒绝；M5-B1 不生成成功 receipt。
- Git 命令使用固定可执行文件和参数数组、30 秒超时及有限输出缓冲区，不使用 shell。
- 不自动重试 Provider；仅支持同 dispatch 的显式恢复，避免重复副作用。
- 不处理断电级 fsync、多文件全局事务和恶意同进程 Provider 的操作系统隔离，这些边界记录到最终报告。

## 12. 影响范围

预计新增：

- `.harness/scripts/lib/worktree-worker-runtime.mjs`
- `.harness/scripts/tests/worktree-worker-runtime.test.mjs`
- `.harness/schemas/worktree-worker-input-manifest.schema.json`
- `.harness/schemas/worktree-worker-receipt.schema.json`
- `docs/harness-m5b-worktree-worker/{DESIGN,PLAN,REPORT}.md`

预计更新：Harness README、结构校验清单、架构适配说明、`docs/AI-handover.md` 和知识概览。除非测试证明共享接口确有缺口，否则不修改 M3、M4-B、M5-A 核心实现。

`backend/src/**`、`frontend/src/**`、数据库、部署和外部服务不在修改范围。

## 13. 验收标准

- 已创建的单 Worktree 能消费当前 M3 task 和显式上下文并运行 mock Worker。
- owner 不一致、多 DAG task、非 pending task、base/status/input 漂移均在 Provider 调用前失败。
- phase-output-only 返回 `ready-for-apply`，但 revision 不变，显式 M3 apply 后才推进一次。
- 存在业务写入时返回 `ready-for-integration`，主工作树业务源码、正式 result、phase 和 revision 均不变。
- Worker 完成后中断可在相同 dispatch 下恢复，Provider 不重复执行。
- M2/M3/M4-B/M5-A 回归测试、Harness 结构、Smoke 和知识新鲜度门禁继续通过。
