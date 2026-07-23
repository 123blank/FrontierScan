# Harness M5-C 单 Worktree 生命周期收尾设计

## 1. 目标

M5-C 为已完成 M5-B2 集成的单 Worktree 增加受控回收能力：在用户明确批准和 `ConfirmRetire` 双重门禁后，验证 Worktree 中所有未提交内容均可由 M5-B1/M5-B2 凭据解释，再移除 Git Worktree 注册和目录。

```text
M5-B1 ready-for-integration
  -> M5-B2 integration receipt
  -> M3 显式 apply
  -> target Story done/completed
  -> Retire preflight
  -> approval + ConfirmRetire
  -> git worktree remove --force
  -> retirement receipt
```

## 2. 范围与边界

- 只接受 `phase === "done"` 且 `runtime.status === "completed"` 的目标 M5-B2 Story。
- 只接受 M5-B1 `ready-for-integration` execution receipt 与 M5-B2 integration receipt 都完整且匹配的单任务 Worktree。
- 保留 `harness/<story>/<task>-<slug>` 分支，不执行分支删除、`git worktree prune`、merge、reset、clean、提交、推送、发布或部署。
- 不支持 M5-B1 `ready-for-apply`、多任务、多 Worktree、Worktree 复用、Fork-Join、真实 Agent 或跨平台兼容性扩展。
- 不修改 M2/M3 的 phase、revision、checkpoint 或 Schema；M5-C 的 `stateFile` 指向待回收的完成 Story，而不是 M5-C 自身状态。

## 3. 接口与持久化

扩展现有 M5-A Runtime，不新增第二套 Worktree Runtime：

```js
runWorktreeCommand({
  root,
  command: "retire",
  stateFile,
  taskId,
  confirmRetire: false,
})
```

PowerShell 入口扩展为：

```powershell
.\.harness\scripts\run-worktree.ps1 `
  -Command Retire `
  -StateFile <完成的 M5-B2 state-file> `
  -TaskId <task-id> `
  -ConfirmRetire `
  [-Json]
```

新增 `worktree-retirement-receipt.schema.json`，固定产物：

```text
.harness/runs/<runId>/worktrees/<taskId>/retirement-receipt.json
```

receipt 记录 Story/run/task、派生 branch/path、base commit、M5-A plan 与历史 status 哈希、M5-B1 execution receipt、M5-B2 integration receipt、正式 result 和已集成文件摘要、移除时间及 `recovered` 标识。M5-A `status.json` 保持历史证据，不被回收操作覆盖。

## 4. Retire 门禁与恢复

Retire 先校验仓库根目录、目标终态、Task DAG 绑定、派生分支和 Worktree 路径。随后校验：

1. M5-A 历史 status 为 `created`，当前 Worktree 注册、分支和 HEAD 仍与 plan 的 `baseCommit` 匹配。
2. M5-B1 manifest、worker result 与 execution receipt 哈希匹配，且 outcome 为 `ready-for-integration`。
3. M5-B2 integration receipt、正式 `result.json` 和每个已集成候选文件仍匹配各自 SHA-256。
4. Worktree Git 变更集合仅包含 M5-B1 主运行输入、execution receipt 已声明候选和同阶段 `result.json`；主运行输入保持 manifest 哈希，候选和 result 保持 receipt 哈希，未知改动、删除、重命名或漂移失败关闭。
5. Retire 获取 `retire.lock` 后重新确认 `create.lock`、`execute.lock` 与 `integrate.lock` 均不存在；Create、Worker 和 Apply 获取自身锁后也必须确认 `retire.lock` 不存在。主工作树不得存在未解释改动。

全部通过后才以固定 Git argv 执行 `git worktree remove --force <derived-path>`。成功后原子写入 retirement receipt。若 Git 已移除但 receipt 尚未写入，重试仅在 Worktree 缺失、分支仍在 base、历史 status 为 created 且全部证据仍一致时补写 `recovered: true`；其他状态均拒绝。

## 5. TDD 与验证

每项生产逻辑先在临时 Git fixture 中写 RED 并确认失败，再实现最小 GREEN：

- 无确认、目标未完成、receipt 缺失或篡改、主树候选漂移、未知 Worktree 改动、锁和分支/HEAD 漂移不得执行 Git 移除。
- 完整 fixture 跑通 M5-A 创建、M5-B1 回收、M5-B2 集成、M3 显式 apply、目标终态和 Retire。
- 断言 Worktree 注册及目录消失、分支保留且指向 base、主树文件和目标状态不变。
- 覆盖重复 Retire 复用 receipt，以及 Git 成功后 receipt 写入中断恢复。

最终运行 M5-C 针对性测试及 M5-A/M5-B1/M5-B2、M4-B/M3/M2、结构、状态、DAG、Smoke、知识新鲜度和差异门禁。正式仓库不执行实际 Retire。
