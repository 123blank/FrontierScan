# M5-D-C1-001 实施说明

## 实施范围

- 增加 implementation phase 统一 owner，阻止 ordinary、serial batch 与 worktree wave 重叠。
- 增加 dispatch/result v1.2 和 `prepare-wave`。
- 增加 Wave Execution Ledger、不可变 attempt、claim、execute.lock、failure 和显式恢复。
- 扩展 Worker 与 Worktree Worker，支持 attempt result、逐写点 fencing 和独立 Worktree 并行执行。
- 增加 `execute-wave`、`retry-task` 和 `recover-attempt` 内部命令。
- 更新 Schema、结构登记、测试和中文文档。

未修改 `backend/src/**`、`frontend/src/**`、数据库、产品 API 或界面。

## 实现结果

- 单个完整 implementation wave 可以生成 v1.2 task/checkpoint 和 execution ledger。
- 多个 Mock Worker 可在不同临时 Worktree 中真实并行运行。
- 成功任务保存不可变 execution receipt；失败任务稳定为 blocked。
- blocked 任务不会被普通 execute 自动重试，只能通过独立批准创建新 attempt。
- claim/lock 半完成、完整 result/receipt、blocked 释放中断和孤儿候选可按磁盘事实显式恢复。
- candidate、result、receipt、ledger 和 lock release 均执行 owner fencing。
- C1 不写主工作树业务文件，不生成正式 phase result，不调用 M3 `apply`。

## 最终审核修复

- mutation lock 文件已创建但元数据尚未写完时，同进程竞争方进行有界等待。
- Worker failure 已写但 ledger 尚未 blocked 时，`recover-attempt` 复用原 failure 并完成状态收敛。
- ledger 已 ready 但原执行锁尚未释放时，`recover-attempt` 验证完整证据后释放锁。
- abandoned failure 已写但 pending transition 尚未提交时，二次恢复复用不可变证据。
- status 对 ready/blocked 状态下的遗留执行锁报告 `recoveryRequired`。

## 安全边界

- 正式仓库未执行 WaveCreate、Worker、Worktree 创建/回收、集成或 Apply。
- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- C2 manifest、主树集成、`finalize-wave` 和 M3 apply 未提前实现。
