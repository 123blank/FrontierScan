# M7-A3 验收追踪与语义门禁实施报告

> 日期：2026-08-13
>
> 基线：`fe65b0b feat(harness): implement M7-A2 phase result projection`
>
> 状态：实现、fixture 回归与第二轮独立只读代码审核均已通过

## 1. 实施结果

- State v2 新增派生 `acceptance.criteria[]`，状态支持 `pending`、`verified`、`accepted-with-known-gaps`、`failed` 和 `blocked`。
- 新增 DAG 2.0，节点以 `criterionIds` 绑定需求验收项；历史 DAG 1.0 保持兼容。
- requirement、task-dag、implementation、unit-test、interface-verification 和 completion 使用确定性语义门禁。
- required criterion 必须被 DAG、required test 和 verification 覆盖；无关 passed case 或 optional case 不能替代 required coverage。
- 测试与验证证据在 apply 时重新校验普通文件身份和 SHA-256，漂移时 State、pointer 和 events 保持不变。
- `accepted-with-known-gaps` 使用 attempt-scoped approval receipt，绑定 Story、run、dispatch、case、result、evidence、用户理由和 subject SHA-256。
- `approve-gap` 与 `apply` 共用 Story 写锁；批准只更新 attempt 内 result 和 receipt，正式 approval、verification 和 acceptance 在同一 State 事务中投影。
- completion 重算 acceptance，只消费九阶段唯一的 applied `phase-result`；历史 blocked 记录不能替代 applied 结果。

## 2. TDD 证据

RED 覆盖：

- 只有 optional criterion 的 requirement 被错误接受。
- 悬空 criterion、无关 passed test、required test/verification 编失或失败仍可推进。
- 未批准 gap、伪造 approval、跨 attempt/case 复用和证据漂移未失败关闭。
- `approve-gap` 与 apply 并发写入缺少统一锁。
- DAG 2.0 接受额外字段或非 pending 初始状态。
- blocked/resume 后合法 revision 跳跃被 completion 错误拒绝。
- 运行态 DAG 路径未被 `select-tests.ps1` 识别。

GREEN 覆盖：

- `acceptance-gate.test.mjs`
- `approval-contract.test.mjs`
- `phase-result-projector.test.mjs`
- `state-runtime.test.mjs`
- `story-runtime.test.mjs`
- `task-dag.test.ps1`
- `select-tests.test.ps1`

## 3. 纵向 fixture

完整 State v2 fixture 包含：

- 两个 required criterion 和一个 optional criterion。
- 两个 DAG task 及 criterion 引用。
- 一个 required test case 同时覆盖两个 required criterion。
- 一个 verified verification case。
- 一个 `accepted-with-known-gaps` case 和正式 `approve-gap` receipt。
- 一个 optional-only blocked verification。
- `interface-verification` 的 blocked -> resume -> 新 attempt -> applied -> done 事件链。

最终 State 中 required criterion 分别为 `verified` 和 `accepted-with-known-gaps`，optional criterion 保留为 `blocked`，Story 合法进入 `done`。

## 4. 并发与恢复

- `withStateWriteLock` 在锁内重读 State 和 pointer，不创建独立 State intent/event。
- 并发 approval callback 按锁顺序串行。
- receipt 写入后、result 写入前中断可恢复。
- result 写入后、命令返回前中断可幂等恢复。
- 相同批准幂等；理由、result 或 evidence 变化会生成新的确定性 approval ID。
- blocked 历史保留，resume 清空当前 `activeBlock`，completion 只消费 applied 链并要求 revision 间隔可由 State logs 解释。
- Windows 锁竞争可能返回 `EPERM/EACCES`，且锁文件在 `open("wx")` 与 JSON 写入之间会短暂不可读；等待型共享锁现按截止时间重试，零等待命令仍立即失败关闭。

## 5. 辅助能力

- `derive-interface-cases.ps1` 对 DAG 2.0 输出结构化 pending draft，不伪造 actual、result 或 evidence。
- DAG 2.0 的 JSON 和 Markdown 输出均显示 `caseId`、`taskId`、`criterionIds` 和 `pending-draft`，不再因沿用 DAG 1.0 渲染字段产生空行。
- `select-tests.ps1` 识别 `.harness/runs/**/phases/02-task-dag/task-dag.json`。
- Harness smoke 增加 requirement/test acceptance、DAG 2.0 和 approval contract 检查。

## 6. 回归结果

- M7-A3 专项：`acceptance-gate`、`approval-contract`、`phase-result-projector`、`state-runtime`、`story-runtime`、`task-dag` 和 `select-tests` 全部通过。
- Worker 与批次：Worker 通过；Batch 32/32；串行批次 1/1。
- Worktree：基础 Runtime 28/28；集成 44/44；生命周期 39/39。
- Wave：计划与创建 35/35；执行 ledger 9/9；Worktree Worker、Wave 执行集成与回收 97/97。
- `smoke-harness-flow.ps1`：通过。
- `validate-structure.ps1`：通过，检查 35 个目录、245 个文件和 13 个 Skill。
- State v2 模板与 DAG 2.0 示例校验：通过。
- `git diff --check`：通过，仅有仓库既有 LF/CRLF 提示。
- 知识 freshness 仍为 `stale-or-incomplete`；本阶段按源码核验 common 相关事实，不将其错误描述为 fresh。

## 7. 独立审核

首轮独立只读代码审核发现 3 个 BLOCKER 和 1 个 WARNING：

1. completion 只重算 State 语义，没有重新读取历史 test/verification evidence、approval receipt 和 phase result 文件。
2. `required=true` case 若只引用 optional criterion，可以缺少最终结果。
3. 重新批准时，旧 receipt 的文件名、内部 approval ID、result 引用和 semantic key 未完整对账。
4. 缺少真实 `approve-gap` 与 `apply` 并发竞争测试。

上述问题均按 TDD 修复：

- delivery completion 在同一 Story 写锁和 State intent 前重验历史 test/verification evidence、正式 approval receipt 与全部 applied phase result 的普通文件身份、bytes、SHA-256、严格结构和 dispatch 身份。
- 所有 required test case 必须 `passed`，所有 required verification case 必须得到 `verified` 或正式批准的 `accepted-with-known-gaps`，不再依赖其 criterion 是否 required。
- 旧 receipt 必须满足文件路径、内部 approval ID、result 当前引用和自身 semantic key 四者一致，旧 subject 可以过期但不能被静默篡改。
- 新增两种公开 Runtime 并发 fixture：approve 先持锁时 apply 等待并消费稳定批准；apply 先完成时 approve 在锁内重读 completed State 后拒绝且 result 字节不变。

修复后重新运行 M7-A3 专项、State/Story/Worker、Batch、全部 Worktree/Wave 回归，结果均通过。第二轮独立只读复审结论为：

```text
无 BLOCKER/WARNING，建议 M7-A3 通过独立代码审核。
```

复审确认首轮四项均已关闭，approval 严格契约、锁等待边界、State v1、DAG 1.0、M5/Worktree 兼容和文档里程碑表述均保持正确。

## 8. 边界与后续

本阶段没有实现：

- knowledge stale 刷新与 `accepted-stale` 门禁，属于 M7-C。
- owned files、预测外修改、证据全面去重和 delivery receipt，属于 M7-A4。
- 确定性串行驱动器，属于 M7-B。
- 真实 Story 双重闭环验收，属于 M7-D。
- 自动 Git、Worktree、Docker、发布或部署。

M7-A3 完成后，下一子里程碑为 `M7-A4：运行时一致性与交付语义`，不得提前宣称 M7 整体完成。
