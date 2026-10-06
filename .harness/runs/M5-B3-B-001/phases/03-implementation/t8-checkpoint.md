# M5-B3-B-001 T8 检查点

## 范围

T8 完成了单 Worktree 串行批次的两任务纵向 fixture、非破坏性 Smoke 协议覆盖和相关回归。所有真实 Git Worktree 创建与回收仅发生在系统临时目录中的测试仓库；本次没有在正式 FrontierScan 仓库创建、回收、合并或清理 Worktree，也没有修改 `backend/**`、`frontend/**`、执行 Git 交付或发布。

## 纵向闭环证据

新增 `serial-batch-runtime.test.mjs` 通过公开 Runtime 跑通：

```text
prepare-batch
-> batch-plan/status/create
-> T1 Worker + integration
-> T2 provider 异常 + 同 dispatch 显式重试 + integration
-> finalize-batch
-> M3 apply（只推进一次）
-> Story done/completed
-> batch-retire 中断恢复 + receipt 复用
```

断言覆盖 T1 集成不改变状态、T2 异常不生成结果或回执且 ledger 保持 `running`、重试后可集成、`finalize-batch` 不推进 revision、显式 M3 `apply` 只推进一次，以及 Git 已回收但回执未写入时的恢复与幂等复用。

## Smoke 和 TDD 证据

首次规格审核发现 Smoke 直接调用内部 `prepareSerialBatch`，没有覆盖公开 `prepare-batch` 入口。修复前新增断言失败；随后 Smoke 改为调用 `runStoryCommand({ command: 'prepare-batch', ... })`，并在临时仓库补齐 public Runtime 所需 workflow。

复审进一步发现 `batch-plan`、`batch-status` 共用 `executeGit` 及其 `git worktree add/remove` 拒绝边界没有被回归锁定。通过临时移除 `batch-status` 的 `executeGit` 参数验证新增断言会失败，再恢复实现；最终断言锁定三步调用均使用同一拒绝器。

## 新鲜验证

| 命令 | 结果 |
| --- | --- |
| `node --test-reporter=dot .\.harness\scripts\tests\serial-batch-runtime.test.mjs` | 1/1 通过，退出码 0 |
| `node --test-reporter=dot .\.harness\scripts\tests\batch-runtime.test.mjs` | 31/31 通过，退出码 0 |
| `node --test-reporter=dot .\.harness\scripts\tests\worktree-runtime.test.mjs` | 28/28 通过，退出码 0 |
| `node --test-reporter=dot .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | 47/47 通过，退出码 0 |
| `node --test-reporter=dot .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | 44/44 通过，退出码 0 |
| `node --test-reporter=dot .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs` | 29/29 通过，退出码 0 |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | 通过，退出码 0 |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | 通过，退出码 0 |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | 通过，退出码 0 |
| `task-dag.test.ps1` 和活动 DAG 校验 | 通过，退出码 0 |
| `smoke-harness-flow.ps1` | 通过，含 `Serial Batch Protocol`，退出码 0 |
| `run-state.ps1 -Command validate` | 通过 |
| `git diff --check` | 通过；仅有既有 LF/CRLF 工作树提示 |

## 审核结论

两轮规格审核分别发现公共入口绕过和 Smoke 拦截器回归缺口，均已通过最小修复、变异验证和受影响回归关闭。最终质量检查未发现影响稳定性、基本可用性或近期扩展的 `BLOCKER` 或 `WARNING`。

## 后续边界

T9 尚未开始，仍需完成文档、结构登记、完整门禁和最终审核。多 Worktree 并行、分支删除、自动 `prune`、正式仓库 Worktree 操作、真实 Agent、发布、部署和 Git 自动交付继续不在本 Story 范围内。
