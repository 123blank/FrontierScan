# M5-D-B 审批门控 WaveCreate 技术设计

## 权威设计

完整设计位于：

```text
docs/harness-m5d-wave-create/DESIGN.md
```

当前确认内容 SHA-256：

```text
sha256:37b6e3ba3048caa3f0c27e67733d4acdbd7ad007ebc511ccea9c3537f1daaa2c
```

## 核心方案

- 在现有 `worktree-runtime.mjs` 与 `run-worktree.ps1` 中增加 `WaveCreate`。
- 强制 `ConfirmWaveCreate + ExpectedPlanSha256`。
- 恢复时额外要求 `ConfirmWaveLockRecovery` 和全部现存锁 SHA-256。
- `create.lock` 与 `create-recovery.lock` 使用不可复用 `lockId`。
- 每次 Git、状态、回执和释放动作前执行锁所有权 fencing。
- 恢复期间以 `create-recovery.lock` 为活动所有权，旧 `create.lock` 保留为接管证据。
- 使用 wave 专用 Worktree allowlist，不修改单任务 Worktree helper 语义。
- 只在完整 Git 事实为 `ready` 时写 `creation-receipt.json`。

## 实施门禁

实施计划位于：

```text
docs/harness-m5d-wave-create/PLAN.md
```

当前计划 SHA-256：

```text
sha256:4e382e04c031b0d21bab6f1d934927d69eb458faca00913b7e151f0ac6dfc5c7
```

所有生产代码必须先有按预期失败的 RED。若文件锁状态机无法关闭已识别竞态，停止实施并回到设计，不得弱化审批绑定或 fencing。
