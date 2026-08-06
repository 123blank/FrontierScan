# Harness M5-D-C1 同 Wave 并行 Mock Worker 报告

> Story：`M5-D-C1-001`
>
> 日期：2026-08-06
>
> 范围：单个完整 implementation wave 的 v1.2 dispatch、统一 owner、不可变 attempt、并行 Mock Worker、partial、retry 和 recover。

## 需求覆盖

| 目标 | 实现 |
| --- | --- |
| implementation 唯一所有权 | `ordinary`、`serial-batch`、`worktree-wave` 互斥，owner 绑定 revision、Task DAG 路径与 SHA-256 |
| v1.2 派发 | `prepare-wave` 派生 `waveId/dispatchId/taskRoot`，每任务生成严格 task/checkpoint |
| Execution Ledger | 任务状态确定性派生 wave 状态，status 查询只读 |
| 不可变 attempt | 每次执行独立保存 claim、input snapshot、result、receipt 和 failure |
| 并行执行 | `Promise.allSettled` 调用不同 Worktree Worker，barrier 证明 Provider 同时进入 |
| 部分失败 | 成功 receipt 保留，失败任务为 blocked，普通 execute 不隐式重试 |
| 显式 retry | 重新批准并绑定旧 failure SHA-256，创建新 attempt，旧证据不覆盖 |
| 显式 recover | 覆盖 claim-only、lock-before-running、failure-before-ledger、完整 result/receipt、ready/blocked 锁释放、abandoned evidence 和孤儿候选 |
| owner fencing | candidate、result、receipt、ledger 和 lock release 前均重验 owner |

## TDD 记录

本轮实际观察的关键 RED：

1. v1.2 Worker task 被旧 phase 路径校验拒绝。
2. v1.2 Worktree Worker误入 M5-B1 v1.0 checkpoint 分支。
3. 两个 Worker 通过 barrier 并发后，短期 `ledger-mutation.lock` 竞争会把一个成功任务误记为 blocked。
4. `retry-task` 命令不存在。
5. 完整 result/receipt 中断后，`recover-attempt` 提示缺少 Worker-aware recovery。
6. blocked ledger 留锁中断不在可恢复状态白名单。
7. running attempt 留下孤儿 Worktree 候选时被错误恢复为 pending。
8. candidate/result 写点缺少可验证的锁替换注入点，旧 owner fencing 测试无法触发。
9. mutation lock 文件已创建但元数据尚未写完时，同进程竞争方会误判为空锁。
10. `failure.json` 已写但 ledger 仍为 running 时，恢复会尝试改写不可变 failure。
11. ledger 已 ready 但 `execute.lock` 尚未释放时，恢复状态白名单拒绝接管。
12. abandoned failure 已写但 pending ledger transition 尚未提交时，二次恢复会因不同 `recoveredAt` 触发 `EEXIST`。

每项 RED 均先确认失败原因，再做最小 GREEN。并行竞态通过 `failure.json.reason` 直接定位为同进程 ledger mutation
锁竞争。最终对当前 PID 的短期锁和“已创建但尚不可解析”的写入窗口做最多 5 秒有界等待；已确认的不同 PID、
结构损坏锁或超时继续失败关闭。恢复路径复用不可变 failure/receipt，不覆盖历史 attempt。

## 已实现边界

- C1 只把全部任务推进到 `ready-for-integration`。
- 不创建 integration manifest，不写主工作树业务候选，不生成正式 phase result。
- 不实现 `finalize-wave`，不调用 M3 `apply`。
- 不执行 Worktree 回收、merge、分支删除、`git worktree prune`。
- 不启动真实 Agent，不执行发布、部署、自动提交或推送。

## 正式仓库证据

- 正式仓库未执行 `WaveCreate`、Worker、Worktree 创建/回收或主树集成。
- 所有真实多 Worktree 和并行 Worker 行为只发生在测试临时 Git fixture。
- 未修改 `backend/src/**`、`frontend/src/**`。
- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- 无关未跟踪文件 `CODEX-CROSS-SESSION-HANDOFF.md` 未修改或纳入本 Story。

## 验证与 Review

最终验证结果：

- C1 专项 `8/8`。
- Worktree Worker `63/63`。
- batch `32/32`、serial batch `1/1`。
- Wave Runtime `34/34`、Worktree Runtime `28/28`。
- Integration `44/44`、Lifecycle `37/37`。
- 结构 `30/201/13`、状态、Task DAG、Smoke、知识新鲜度和 `git diff --check` 全部通过。
- Build Plan 为 `no-build-required`。
- 最终 Review 无未解决 `BLOCKER/WARNING`。

完整命令和审核结论记录在：

```text
.harness/runs/M5-D-C1-001/phases/04-unit-test/test-report.md
.harness/runs/M5-D-C1-001/phases/05-code-review/code-review-report.md
```

## 下一阶段

M5-D-C2 应独立实现 integration manifest freeze、主工作树串行受控集成、wave receipt、`finalize-wave` 和最终 M3
`apply`。C1 的 Worker 执行批准不构成集成、回收或 Git 交付批准。
