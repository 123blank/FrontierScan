# M5-D-C1 同 Wave 并行 Mock Worker 技术设计

## 权威设计

完整设计位于：

```text
docs/harness-m5d-wave-execution/DESIGN.md
```

当前确认内容 SHA-256：

```text
sha256:e1951c0f5fb6c7139d5d21ce6fd2164e68785b796ff80c0d7172e945cd90a1e0
```

## 实施计划

逐任务实施计划位于：

```text
docs/harness-m5d-wave-execution/PLAN-C1.md
```

当前计划 SHA-256：

```text
sha256:a34d4817143256205f13177814d1a063d68397008c0d3365ad221c1aae493c25
```

## 核心方案

- `story-runtime.mjs` 负责 `prepare-wave`、implementation owner 和正式 phase task/checkpoint。
- 新增 `worktree-wave-execution-runtime.mjs`，负责 Wave Execution Ledger、attempt claim、并行执行、status、retry 和 recover。
- Dispatch v1.2 的身份、路径和哈希全部由 Runtime 派生，不接受调用方注入。
- `ordinary`、`serial-batch`、`worktree-wave` 通过统一 implementation owner 契约互斥。
- 每任务 attempt 使用不可变目录；claim、执行锁和所有写点绑定当前 `attemptId/claimId/lockId`。
- `execute-wave` 使用 `Promise.allSettled` 并行调用现有 Mock Worker，再从磁盘证据确定性收敛状态。
- C1 仅将任务推进至 `ready-for-integration`；不创建 integration manifest，不写主工作树，不生成 phase result，不推进 M3。

## 实施门禁

- 所有生产行为先观察直接 RED，再做最小 GREEN。
- 每个任务完成后运行专项测试、直接回归和 owned diff 检查。
- 所有真实 Git/Worktree 并发只在临时 fixture 中执行。
- 若 owner fencing、不可变 attempt 或显式恢复无法关闭已识别竞态，停止实施并回到设计，不弱化安全边界。
