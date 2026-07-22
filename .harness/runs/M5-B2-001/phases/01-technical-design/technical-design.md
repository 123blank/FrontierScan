# M5-B2-001 技术设计

权威设计为 `docs/harness-m5b2-worktree-integration/DESIGN.md`，权威执行计划为同目录 `PLAN.md`。两份文档已经用户确认。

## 核心结构

```text
M5-B1 ready-for-integration
  -> M5-B2 plan 固化内容寻址 bundle
  -> M5-B2 status 核验 base/candidate 哈希事实
  -> 用户批准 + ConfirmApply
  -> M5-B2 apply 逐文件原子写入
  -> 业务文件 -> phase output -> result.json -> integration receipt
  -> 调用方显式 M3 apply
```

新增独立 `worktree-integration-runtime.mjs` 和 PowerShell 薄入口，保持 M2/M3/M4-B/M5-A/M5-B1 公开职责不变。Runtime 只消费已存在的 state、DAG、M3 task/checkpoint、M5-A plan/status 和 M5-B1 receipt/manifest/result 证据。

## 稳定性设计

- 所有身份、Schema、路径、大小、哈希、Git 事实和批准条件在目标写入前验证。
- 候选内容按 SHA-256 固化，单文件 2 MiB、总量 8 MiB。
- 主工作树 HEAD 必须等于固定 `baseCommit`；业务差异必须完全由 plan 解释。
- 每个目标只接受 base、candidate 或不存在三种受控状态，未知内容进入 `inconsistent`。
- 使用任务级独占锁和同目录临时文件加 rename；正式 result 与成功 receipt 最后写入。
- 不提供全局回滚。部分完成后通过候选哈希恢复，避免覆盖未知修改。

## 边界

Runtime 不执行 M3 apply、Git 写操作、merge/remove、发布、部署、真实 Agent、多任务或多 Worktree。正式项目业务源码不在开发测试中写入；真实 Apply 仅在临时 Git fixture 发生。
