# M5-D-C1-001 代码审核报告

## 范围

审核 `M5-D-C1-001` 任务拥有的 Harness Runtime、Schema、测试和文档差异，重点检查：

- implementation owner 是否可被 ordinary、serial-batch 或 legacy 路径绕过。
- dispatch v1.2 是否保持 Runtime 派生身份与 v1.0/v1.1 兼容。
- attempt claim、锁、result、receipt、failure、ledger 和锁释放是否受 owner fencing。
- 并行、partial、retry 和 recover 是否保持主工作树与 Harness 状态不变。
- 中断窗口是否能通过不可变证据和显式恢复收敛。

无关未跟踪文件 `CODEX-CROSS-SESSION-HANDOFF.md` 未纳入审核或交付范围。

## 审核发现

无未解决 `BLOCKER` 或 `WARNING`。

最终审核中发现并已修复：

| 严重级别 | 文件 | 问题 | 处理 |
| --- | --- | --- | --- |
| WARNING | `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | mutation lock 打开后、元数据写入前的空文件窗口会误伤同进程并发 | 增加有界不可解析窗口等待和确定性回归 |
| WARNING | `.harness/scripts/lib/worktree-worker-runtime.mjs` | failure 已写但 ledger 未 blocked 时无法恢复 | 复用已验证 failure 并补记 blocked |
| WARNING | `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | ready ledger 写入后遗留原锁时不在恢复白名单 | 验证 result/receipt/ledger 后受控释放锁 |
| WARNING | `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | abandoned failure 已写但 pending 未提交时二次恢复会改写不可变证据 | 复用既有 abandoned evidence |

对应修复均已通过 RED/GREEN 和完整回归，以上 finding 状态均为 resolved。

## 测试缺口

- 未在正式仓库执行 `WaveCreate`、Worker、Worktree 创建/回收或主工作树集成；真实 Git 行为仅在临时 fixture 验证。
- 未接入真实 Codex Agent Provider；C1 按设计仅验证现有 Mock Provider。
- 未验证 integration manifest、主工作树串行集成、`finalize-wave` 或 M3 `apply`；这些属于 M5-D-C2。

## 残余说明

- `ledger-mutation.lock` 是进程协作型 JSON 文件锁，不是 OS 租约或断电级事务；损坏、其他 PID 或超时仍失败关闭，并要求显式检查与恢复。
- C1 只负责把任务推进到 `ready-for-integration`，不构成集成、回收、Git 交付、发布或部署批准。

## 结论

审核通过。当前无未解决 `BLOCKER` 或 `WARNING`，可以进入 `build-publish` 的 `no-build-required` 判定和 Harness-only 接口验证。
