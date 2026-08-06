# M5-D-C2 Wave 集成与阶段收尾技术设计

## 权威设计

完整设计位于：

```text
docs/harness-m5d-wave-execution/DESIGN.md
```

当前确认内容 SHA-256：

```text
sha256:dc3db192262124889921bf09a9eb212a44842f5a608b1542e8d70f43ced9685d
```

## 实施计划

逐任务实施计划位于：

```text
docs/harness-m5d-wave-execution/PLAN-C2.md
```

当前计划 SHA-256：

```text
sha256:001ff9fe0d0caa8983ae89b7726685fef6b16e80b17d1a4282f07a2b9bf3be83
```

## 核心方案

- 扩展现有 Wave Execution Ledger，使 freeze、integration、partial recovery 和 finalization 均由磁盘证据确定性派生。
- `freeze-integration` 使用 `manifest-preparation.lock` 原子冻结 integration manifest；`recover-freeze` 只在显式确认与预期哈希绑定下恢复。
- manifest 绑定 state、DAG、WavePlan、creation receipt、dispatch、checkpoint、attempt result、execution receipt、候选文件和主工作树业务快照。
- `integrate-wave` 使用 wave 级 owner 和逐写点 fencing，按稳定任务顺序串行写入主工作树。
- 部分失败保留已集成确定性前缀；恢复只重验前缀并继续剩余任务，不自动回滚或解决冲突。
- `finalize-wave` 在有效 integration owner 下生成正式 phase v1.0 产物、wave receipt、finalized ledger 和 `checkpoint.waveFinalization`。
- 既有 M3 `apply` 是唯一 phase 推进入口，并重验 wave finalization 后只推进一次。

## 实施门禁

- 所有生产行为先观察直接 RED，再做最小 GREEN。
- 所有 Git/Worktree 写入只在临时 fixture 中执行。
- C1 执行、v1.0 ordinary 和 v1.1 serial batch 行为必须保持兼容。
- owner fencing、manifest 不可变性、主树前缀恢复或 M3 apply 绑定若无法失败关闭，停止实施并回到设计。
- 不执行 Worktree 回收、提交、推送、PR、发布或部署。
