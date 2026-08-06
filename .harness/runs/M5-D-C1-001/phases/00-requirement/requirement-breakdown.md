# M5-D-C1 同 Wave 并行 Mock Worker 需求拆解

## 来源需求

在 M5-D-B 已完成同 wave 多 Worktree 审批门控创建的基础上，为单个 Story、单个完整 implementation wave 增加并行 Mock Worker、执行结果收敛、不可变 attempt 和显式恢复能力。

## 已确认决策

- 当前只实现 `M5-D-C1-001`，不实现 C2 的 manifest、主工作树集成、`finalize-wave` 或 M3 `apply`。
- Task DAG 必须恰好包含一个 wave，且该 wave 覆盖全部 implementation 任务。
- 使用现有 M4-B Mock Provider，不接入真实 Codex Agent。
- Worker 可以并行执行，但全部任务 ready 前不得写主工作树。
- implementation phase 使用 `ordinary`、`serial-batch`、`worktree-wave` 三种互斥 owner 模式。
- 每次执行使用不可变 attempt 目录，并绑定 `attemptId`、`claimId` 和 `lockId`。
- 候选、result、receipt、ledger 和锁释放前均执行 owner fencing。
- 只通过显式 `recover-attempt` 和 `retry-task` 收敛异常，不按 PID 或时间自动恢复。

## 影响范围

- Harness Story Runtime 与 PowerShell 入口。
- Dispatch v1.2 task/result 契约。
- Wave Execution Ledger、attempt claim、执行锁和失败证据。
- M4-B Mock Worker 的 v1.2 受约束执行路径。
- 临时 Git fixture、Harness 回归测试、结构登记和项目文档。
- 不修改 backend、frontend、数据库或产品业务行为。

## 验收标准

- [ ] DAG 恰好一个 wave 且覆盖全部 implementation 任务。
- [ ] `ordinary`、`serial-batch`、`worktree-wave` phase owner 互斥。
- [ ] v1.2 task/result 身份全部由 Runtime 派生。
- [ ] 每任务 attempt 历史不可覆盖，所有写点受 `lockId` fencing。
- [ ] 多 Worker 真实并行，部分失败保留成功证据。
- [ ] `retry-task` 和 `recover-attempt` 只在显式确认和当前哈希绑定下执行。
- [ ] 全部任务 ready 前不写主工作树、不生成 phase result、不推进 M3。

## 风险与边界

- Windows 文件原子替换、并发 claim 和受控中断恢复必须通过真实临时 Git fixture 验证。
- C1 的稳定状态不增加 `recovery-required`；只读 status 可以报告需要恢复的动态诊断。
- 不在正式仓库执行 `WaveCreate`、Worker、Apply、Retire、Worktree 创建或回收。
- 未经用户另行批准，不执行 `git add`、`git commit`、`git push`、PR、发布或部署。
