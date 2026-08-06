# M5-D-C2 实施说明

## 已实现

- 扩展 Wave Execution Ledger 的 freeze、integration 和 finalized 状态真值表。
- 增加 integration manifest、preparation lock、integration/recovery lock、逐任务 integration receipt 和 wave receipt。
- 实现 `freeze-integration`、`recover-freeze`、`integrate-wave`、`recover-integration`。
- 主工作树只允许按稳定任务顺序形成“已集成前缀 + 当前任务”差异；部分失败保留前缀。
- 增加 `finalize-wave`，生成正式 v1.0 phase 产物与 `checkpoint.waveFinalization`。
- M3 `apply` 重验 Wave finalization，只推进一次，并支持推进前后中断恢复。
- 修复 recovery finalization 释放锁时可能误删 replacement integration lock 的竞态。
- 修复 Windows 并发 recovery writer 可能暴露原始 `EPERM/EACCES` 的兼容问题；确认竞争 owner 后统一返回既有 owner-fencing 错误，不改变锁协议。

## 边界

- 不实现自动冲突解决、主树回滚、Worktree/分支回收或真实 Agent Provider。
- 不执行自动提交、推送、PR、发布或部署。
- 正式仓库未执行 WaveCreate、Worker 或业务候选集成；真实 Git 写入只在临时 fixture 中发生。
