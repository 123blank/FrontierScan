# FrontierScan Harness M7-A3 验收追踪与语义门禁实施计划

> **供代理式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，逐任务先 RED、再最小 GREEN。未经用户逐次批准，不执行 Git 暂存、提交、推送、Worktree、Docker、发布或部署。
>
> 计划状态：专项设计与实施计划已于 2026-08-13 通过独立只读评审并获得用户实施批准；实现与 fixture 回归已完成，独立代码审核待收口。

**目标：** 建立从 requirement criterion 到 DAG、implementation、test、verification、逐项 gap approval 和最终 acceptance summary 的机器可判定事实链。

**架构：** 新增独立的 acceptance 与 approval 纯契约模块，在现有 Story Runtime 中编排文件 I/O、Story 写锁、approval receipt 和原子 State 投影；State v2 使用 task-dag 2.0，历史 State v1、DAG 1.0 和 M5 协议保持兼容。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Node 内置测试与断言、临时 Git fixture、现有 FrontierScan State/Story Runtime。

---

## 1. 文件边界

### 1.1 新增

```text
.harness/schemas/task-dag-v2.schema.json
.harness/schemas/approval-receipt.schema.json
.harness/scripts/lib/acceptance-contract.mjs
.harness/scripts/lib/acceptance-gate.mjs
.harness/scripts/lib/approval-contract.mjs
.harness/scripts/tests/acceptance-gate.test.mjs
.harness/scripts/tests/approval-contract.test.mjs
docs/harness-m7a3-acceptance-gates/REPORT.md
```

### 1.2 修改

```text
.harness/schemas/e2e-state-v2.schema.json
.harness/schemas/dispatch-result-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/scripts/lib/task-dag-contract.mjs
.harness/scripts/lib/phase-data-contract.mjs
.harness/scripts/lib/phase-result-projector.mjs
.harness/scripts/lib/state-contract.mjs
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/run-story.ps1
.harness/scripts/validate-structure.ps1
.harness/scripts/derive-interface-cases.ps1
.harness/scripts/select-tests.ps1
.harness/scripts/tests/state-runtime.test.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/tests/phase-result-projector.test.mjs
.harness/scripts/tests/worker-runtime.test.mjs
.harness/scripts/tests/task-dag.test.ps1
.harness/scripts/tests/select-tests.test.ps1
.harness/scripts/smoke-harness-flow.ps1
.harness/templates/task-dag.example.json
.harness/templates/requirement-breakdown.md
.harness/templates/test-report.md
.harness/templates/interface-verification-report.md
.harness/structure-manifest.yaml
.codex/skills/frontier-common/references/harness-runtime.md
.codex/skills/frontier-state-runner/*
.codex/skills/frontier-requirement-breakdown/*
.codex/skills/frontier-task-dag-planner/*
.codex/skills/frontier-test-gate/*
.codex/skills/frontier-interface-verifier/*
docs/harness-engineering-target-and-gap.md
docs/harness-structure-checklist.md
docs/harness-m7-m12-roadmap/DESIGN.md
docs/harness-m7-m12-roadmap/PLAN.md
```

### 1.3 明确不修改

- State v1 Schema、模板、工作流和历史 State/events。
- task-dag 1.0 Schema 的既有字段和历史 DAG 文件。
- M5 batch、wave、worker 和 worktree 正式协议版本。
- 后端、前端和产品业务代码。
- Git、Worktree、Docker、发布或部署 Runtime。

## 2. Task 1：冻结兼容基线

**文件：**

- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worker-runtime.test.mjs`
- 修改：`.harness/scripts/tests/task-dag.test.ps1`

- [ ] 记录 State v1、State v2 A2、DAG 1.0 和旧 Worker fixture 当前通过基线。
- [ ] 增加断言：DAG 1.0 继续使用 `acceptanceCriteria`，不得被 A3 强制迁移。
- [ ] 增加断言：State v1 仍只读，历史 completed State 不写入 `acceptance`。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
```

预期：现有测试全部通过。后续不得通过删除或放宽旧用例换取 GREEN。

## 3. Task 2：建立 acceptance 结构契约

**文件：**

- 新增：`.harness/scripts/lib/acceptance-contract.mjs`
- 修改：`.harness/schemas/e2e-state-v2.schema.json`
- 修改：`.harness/states/e2e-state-v2.template.json`
- 修改：`.harness/scripts/lib/state-contract.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [ ] 写 RED：State v2 缺少顶层 `acceptance`。
- [ ] 写 RED：criterion summary 缺字段、额外字段、重复 criterionId、错误状态、重复 ID 数组。
- [ ] 写 RED：summary criterionId/required 与 requirement 不一致。
- [ ] 在模板增加：

```json
{
  "acceptance": {
    "criteria": []
  }
}
```

- [ ] 实现严格 acceptance summary 元素校验：

```text
criterionId
required
taskIds
testCaseIds
verificationCaseIds
status
approvalIds
```

- [ ] 状态只允许：

```text
pending
verified
accepted-with-known-gaps
failed
blocked
```

- [ ] State v2 validator 调用 acceptance contract；State v1 分支不改。
- [ ] 运行 state tests，预期新增契约用例通过。

## 4. Task 3：实现 requirement 语义门禁

**文件：**

- 新增：`.harness/scripts/lib/acceptance-gate.mjs`
- 新增：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/lib/phase-data-contract.mjs`
- 修改：`.harness/scripts/lib/phase-result-projector.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/schemas/dispatch-result-v2.schema.json`
- 修改：`.harness/scripts/tests/phase-result-projector.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
无 required criterion
重复 criterionId
open question
resolved 但 resolution 为空
open 但 resolution 非 null
```

- [ ] 实现 `assertRequirementGate(state)`。
- [ ] 收紧 question 契约：

```text
open -> resolution=null
resolved -> resolution=非空
```

- [ ] 实现 requirement 后的初始 `buildAcceptanceSummary(state)`，所有 criterion 为 `pending`。
- [ ] 断言纯函数不修改输入，输出顺序与 requirement 一致。
- [ ] requirement completed apply 在同一 State 事务中写入初始 acceptance summary；投影或门禁失败时 State、pointer、events 和 revision 均不变。
- [ ] 增加 requirement result apply 集成测试，断言推进后只读取 State 即可获得初始 criterion 汇总。
- [ ] 运行 acceptance tests，预期 requirement 用例全部通过。

## 5. Task 4：建立 task-dag 2.0 契约

**文件：**

- 新增：`.harness/schemas/task-dag-v2.schema.json`
- 修改：`.harness/scripts/lib/task-dag-contract.mjs`
- 修改：`.harness/scripts/tests/task-dag.test.ps1`
- 修改：`.harness/templates/task-dag.example.json`

- [ ] 写 RED：合法 DAG 2.0。
- [ ] 写负例：

```text
node 使用 acceptanceCriteria
缺 criterionIds
顶层或 node 额外字段
重复 criterionId
非 pending 初始状态
错误 owner/type/path
图、wave 和路径冲突
```

- [ ] 将现有 `validateTaskDag` 拆为版本分发和共享图校验，不改变 DAG 1.0 行为。
- [ ] DAG 2.0 node 固定字段：

```text
taskId/title/type/status/ownerAgent/predictedFiles/criterionIds
```

- [ ] DAG 2.0 状态只允许 `pending/running/done/blocked`，apply 输入只允许 `pending`。
- [ ] 示例模板切换为 DAG 2.0；另保留测试内 DAG 1.0 fixture。
- [ ] 运行 PowerShell DAG 测试和 Node contract CLI，预期 1.0/2.0 均通过。

## 6. Task 5：实现 DAG criterion 引用门禁

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
State v2 使用 DAG 1.0
悬空 criterionId
required criterion 无 task
optional criterion 无 task
node criterionIds 为空
```

- [ ] 实现 `assertTaskDagGate(state)`：

```text
State v2 DAG 必须来自 2.0
所有引用存在
每个 required criterion 至少一个 task
optional criterion 可无 task
```

- [ ] task-dag apply 在 State intent 前调用 gate。
- [ ] task-dag projector 后完整重建 acceptance `taskIds`。
- [ ] 增加 State 字节零写入断言。

## 7. Task 6：实现 implementation 门禁

**文件：**

- 修改：`.harness/scripts/lib/phase-data-contract.mjs`
- 修改：`.harness/schemas/dispatch-result-v2.schema.json`
- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
taskUpdates 缺失、重复、未知 task
任一 task 非 done
tdd 携带 exceptionReason
exception 缺理由
actualFiles 为空且 notes 为空
```

- [ ] 收紧 implementation payload 的 method/exceptionReason/notes 组合。
- [ ] 实现 `assertImplementationGate(state)`。
- [ ] 保留 `completedTaskIds` 的 Runtime 确定性派生。
- [ ] 不实现 Git 或 predictedFiles 对账。
- [ ] 运行 acceptance 和 story tests。

## 8. Task 7：实现 test 引用与结果门禁

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
case 引用未知 criterion
required criterion 只有 optional case
required criterion 无 case
required case 缺 result
重复 result
result 引用未知 case
required result skipped/blocked/failed
optional failed
无关 passed case
```

- [ ] 实现 `assertUnitTestGate(state)`：

```text
每个 required criterion 至少一个 required case
required case 恰一个 passed result
optional case 可无结果或 skipped/blocked
任何 failed result 阻止推进
```

- [ ] required passed result 必须校验普通 evidence 文件、非符号链接、路径和 SHA-256。
- [ ] 继续要求至少一个 passed command 或有效 adapter evidence。
- [ ] unit-test apply 重建 acceptance `testCaseIds`。
- [ ] 增加“无关 passed test 不能满足 criterion”的完整 Story fixture。

## 9. Task 8：建立 approval receipt 契约

**文件：**

- 新增：`.harness/schemas/approval-receipt.schema.json`
- 新增：`.harness/scripts/lib/approval-contract.mjs`
- 新增：`.harness/scripts/tests/approval-contract.test.mjs`

- [ ] 写 RED：合法 verification-gap receipt。
- [ ] 写负例：

```text
错误 Story/run/phase/dispatch/revision
错误 subjectType/status/actor
空 reason
错误 case
错误 evidence hash
额外字段
非法时间
```

- [ ] 实现规范 JSON 序列化，键按 Unicode code point 排序，数组保持原顺序。
- [ ] 实现：

```javascript
verificationGapSubject(caseValue, resultValue, task)
verificationGapSubjectSha256(...)
approvalSemanticKey(...)
deterministicApprovalId(...)
validateApprovalReceipt(...)
validateFormalApproval(...)
```

- [ ] subject 排除 `approvalId`，包含完整 case、完整 result 其余字段和 attempt 身份。
- [ ] 相同语义键生成相同 approvalId。
- [ ] 运行 approval contract tests。

## 10. Task 9：收紧 verification result 契约

**文件：**

- 修改：`.harness/scripts/lib/phase-data-contract.mjs`
- 修改：`.harness/schemas/dispatch-result-v2.schema.json`
- 修改：`.harness/schemas/e2e-state-v2.schema.json`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [ ] 写 RED：

```text
accepted gap 无 evidence
verified/failed/blocked 携带 approvalId
重复 case result
```

- [ ] 收紧：

```text
accepted-with-known-gaps -> evidence 非空；结构契约允许 approvalId=null 的待批准候选
其他状态 -> approvalId=null
```

- [ ] 增加专用 approval-candidate 校验：当前 attempt 中的目标 case 必须为 `accepted-with-known-gaps + evidence`，且 `approvalId` 为 null，或指向同一 Story/run/attempt/case 的有效旧 receipt。
- [ ] 旧 receipt 可以具有不同的 subjectSha256 或 reason，以支持 reason、result 或 evidence 变化后的直接重新批准；跨 attempt、跨 case、receipt 缺失或身份不匹配必须拒绝。
- [ ] apply 语义门禁仍要求每个 accepted gap 的 `approvalId` 非空且 receipt、subject、attempt、case 和 evidence 全部有效。
- [ ] 增加集成测试：未批准 accepted gap 直接 apply 失败，执行 approve-gap 后同一 result apply 成功。
- [ ] State `approvals` 改为严格元素数组，不再接受任意对象。
- [ ] A3 正式 approval 只允许 `subjectType=verification-gap`。
- [ ] M7-C 的 `knowledge-stale` 只保留扩展接口，不在本任务启用。

## 11. Task 10：实现 `approve-gap` 命令

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/run-story.ps1`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] PowerShell 增加：

```text
Command=approve-gap
CaseId
Reason
```

- [ ] 拒绝 approve-gap 携带 Adapter、ResultFile、TaskDagFile、BatchFile 或 Wave 参数。
- [ ] 写 RED：

```text
非 State v2
非 interface-verification
未 prepare
revision/attempt/task/result 漂移
case 不存在
case 不是 accepted gap
evidence 缺失/漂移/符号链接
```

- [ ] 在 `state-runtime.mjs` 导出 `withStateWriteLock(options, callback)`：定位 State、获取现有 run lock、锁内重读并验证 State/pointer、调用 callback、释放锁，不执行 `persistLocated`。
- [ ] 让 `runStateTransaction` 基于 `withStateWriteLock` 实现，并继续独占事件生成和 State/pointer 持久化职责。
- [ ] approve-gap 使用 `withStateWriteLock`，与 apply 复用同一 Story 写锁但不提交 State。
- [ ] 增加 state runtime 测试，证明只持锁 callback 不产生 State、pointer、event 或 revision 写入，且 transaction 既有行为不变。
- [ ] 在锁内重读并校验 State、active-attempt、task、checkpoint、result。
- [ ] 写 receipt 临时文件并原子 rename。
- [ ] 原子修改当前唯一 result.json 的目标 `approvalId`。
- [ ] actor 固定为 `user`。
- [ ] 返回 approvalId、receiptFile、resultFile 和 reused。

## 12. Task 11：实现 approve-gap 幂等、替换与恢复

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
相同输入重复 approve
receipt 已写、result 未更新
result 已更新、返回前中断
reason 变化
result/evidence 变化后直接重新批准
旧 receipt 跨 attempt
旧 receipt 跨 case
receipt 漂移
```

- [ ] 同一 Story/run/attempt/case 的旧 approvalId 可被新 subject 或新 reason 直接替换。
- [ ] 跨 attempt/case 必须拒绝。
- [ ] 已存在同 approvalId receipt 必须逐字段和 SHA-256 一致。
- [ ] 为 receipt 写入和 result 写回增加中断 hook，验证重试恢复。
- [ ] approve-gap 不修改 State、pointer、events、revision 和 checkpoint status。

## 13. Task 12：验证 approve-gap 与 apply 串行化

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 使用 deferred hook 构造 approve-gap 持有 Story 写锁。
- [ ] 同时启动 apply，断言 apply 在锁外等待。
- [ ] 释放 approve-gap 后，apply 只读取已稳定写回 approvalId 的 result。
- [ ] 构造 apply 先持锁，approve-gap 后进入，断言 completed State 后不能再修改 result。
- [ ] 断言无正式 State hash 漂移。

## 14. Task 13：实现 verification 聚合门禁

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
required criterion 无 required case
required case 缺 result
required failed/blocked
environment unavailable 自动通过
optional-only failed/blocked
optional case 引用 required criterion 后 failed/blocked
```

- [ ] 实现 `assertVerificationGate(state)`。
- [ ] required criterion 聚合优先级：

```text
failed
blocked
required result missing -> pending
accepted-with-known-gaps
verified
```

- [ ] optional case 不能满足 required 覆盖。
- [ ] optional case 引用 required criterion 时，其 failed/blocked 参与该 criterion 聚合。
- [ ] optional-only failure 不阻止完成。

## 15. Task 14：原子投影 verification、approval 与 acceptance

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/lib/phase-result-projector.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/tests/phase-result-projector.test.mjs`

- [ ] 写 RED：accepted gap apply 无 receipt、错误 receipt、错误 subject hash、错误 receipt path/hash。
- [ ] apply 锁内为每个 accepted gap 加载当前 attempt receipt。
- [ ] 重新计算 case/result subject hash和 evidence SHA-256。
- [ ] 构造正式 approval，增加 `receiptPath/receiptSha256`。
- [ ] 在同一候选 State 中写入：

```text
verification
approvals
acceptance
phase-result
phase/revision
```

- [ ] 任一校验失败时 State、pointer、events、revision 字节不变。
- [ ] 重复 apply 继续以正式 phase-result 索引幂等。

## 16. Task 15：实现 acceptance 确定性重建

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`

- [ ] `buildAcceptanceSummary(state)` 按 requirement 顺序生成。
- [ ] 在以下 completed apply 后完整替换：

```text
requirement
task-dag
implementation
unit-test
interface-verification
delivery-preparation
```

- [ ] taskIds/testCaseIds/verificationCaseIds/approvalIds 顺序稳定且去重。
- [ ] technical-design、code-review、build-publish 不改变追踪关系，但必须保持 summary 合法。
- [ ] 人工篡改 acceptance 后，下一相关 apply 或 completion gate 失败关闭。

## 17. Task 16：保留 code-review 与 build 全局门禁

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] code-review 不增加 criterionIds。
- [ ] 保留：

```text
review.status=passed
无未解决 BLOCKER
passed review evidence hash 有效
```

- [ ] open WARNING 如实保留但不作为 A3 阻塞项。
- [ ] build 不增加 criterionIds。
- [ ] 保留 build/no-build adapter 和结构化 failed 门禁。
- [ ] 增加回归断言，证明 A3 未改变外部操作批准边界。

## 18. Task 17：实现 delivery-preparation 与 done 最终门禁

**文件：**

- 修改：`.harness/scripts/lib/acceptance-gate.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/acceptance-gate.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 实现 `assertCompletionGate(state)`。
- [ ] 写 RED：

```text
delivery.status 非 ready
required criterion pending/failed/blocked
acceptance summary 漂移
DAG 引用漂移
task 非 done
required test/verification 失效
approval receipt/result/evidence 漂移
缺任一 applied phase-result
```

- [ ] completion 前重新构建 summary 并逐字段比较。
- [ ] 每个 workflow phase 恰好存在一个 `status=applied` 正式索引；允许任意数量历史 `status=blocked` 索引。
- [ ] applied 索引按 workflow phase 顺序校验 dispatch 身份和 revision 链；blocked 历史不能替代 applied 索引。
- [ ] 增加 blocked -> resume -> applied -> done fixture，证明历史 blocked 索引保留且 completion 只消费 applied 链。
- [ ] A3 不校验 owned files、remaining risk approval 或 Git 事实。

## 19. Task 18：适配接口用例派生

**文件：**

- 修改：`.harness/scripts/derive-interface-cases.ps1`
- 修改：`.harness/scripts/tests/task-dag.test.ps1`

- [ ] DAG 1.0 保持当前人类草稿兼容输出。
- [ ] DAG 2.0 JSON 输出：

```text
caseId
taskId
type
required
criterionIds
status=pending-draft
action=null
expected=null
```

- [ ] v2 不输出 `TBD` actual/result/evidence。
- [ ] 不把 draft 冒充正式 verification payload。
- [ ] 增加 backend/frontend/integration/docs 类型映射测试。

## 20. Task 19：适配测试选择

**文件：**

- 修改：`.harness/scripts/select-tests.ps1`
- 新增：`.harness/scripts/tests/select-tests.test.ps1`

- [ ] 写 RED：仅修改 `.harness/runs/<run>/phases/02-task-dag/task-dag.json` 时未推荐 DAG 校验。
- [ ] 识别：

```text
.harness/templates/task-dag*
.harness/schemas/task-dag*
.harness/runs/**/task-dag.json
```

- [ ] DAG 2.0 继续只推荐确定性 DAG/Harness 测试。
- [ ] 不在 A3 自动推导后端测试类、前端 spec 或业务命令。

## 21. Task 20：完整 v2 Story fixture

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`

- [ ] 构造 requirement -> delivery-preparation 九阶段 fixture。
- [ ] 至少包含：

```text
两个 required criterion
一个 optional criterion
多个 DAG tasks
一个 test case 覆盖多个 criterion
一个 verified verification case
一个 accepted gap + approve-gap receipt
一个 optional-only blocked/failed verification
```

- [ ] 每阶段只读取 State 断言 acceptance 汇总。
- [ ] 最终进入 done/completed。
- [ ] smoke 保持轻量，只覆盖 requirement、DAG 2.0、test 和 approval 的最小链路。

## 22. Task 21：兼容回归

- [ ] 运行：

```powershell
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\phase-result-projector.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\select-tests.test.ps1
```

- [ ] 对超长测试记录完整自然结束或分段证据，不用部分结果宣称全量通过。
- [ ] 只修复 A3 引入的真实兼容问题，不升级 M5 协议。

## 23. Task 22：更新模板、Skill 与结构登记

**文件：**

- 修改：第 1.2 节列出的模板、Skill、manifest 和结构校验资产

- [ ] 模板使用稳定 criterion IDs 和 DAG 2.0。
- [ ] State Runner 说明 approve-gap receipt 与正式 approval 区别。
- [ ] Requirement Skill 说明 required criterion 和 question 关闭。
- [ ] Task Planner Skill 使用 criterionIds。
- [ ] Test/Interface Skill 明确 required coverage 和 accepted gap。
- [ ] `validate-structure.ps1` 登记新增 Schema、模块和测试。
- [ ] manifest 增加 `m7a3_acceptance_gates` 状态。

## 24. Task 23：最终确定性验证

- [ ] 必跑：

```powershell
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\phase-result-projector.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\select-tests.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
git diff --check
```

- [ ] 按 Task 21 完成 M5/Worktree 回归。
- [ ] 记录测试计数、耗时限制和残余风险。

## 25. Task 24：独立只读代码审核

审核重点：

```text
criterion 是否能被悬空或重复引用
optional criterion/case 是否错误阻塞或错误放行
无关 passed test 是否能满足 required criterion
approval receipt 是否可伪造、跨 attempt 或跨 case 复用
subject hash 是否排除 approvalId 且覆盖全部 gap 事实
approve-gap 与 apply 是否使用同一 Story 写锁
批准替换和中断恢复是否可靠
verification、approval、acceptance 是否同事务提交
completion 是否重新计算而非信任 State 汇总
State v1、DAG 1.0 和 M5 是否回归
A4/B/C 是否被提前实现
```

所有 BLOCKER/WARNING 必须按 TDD 修复并复审。

## 26. Task 25：报告与目标基线同步

**文件：**

- 新增：`docs/harness-m7a3-acceptance-gates/REPORT.md`
- 修改：`docs/harness-engineering-target-and-gap.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`.harness/structure-manifest.yaml`

- [ ] REPORT 记录 RED/GREEN、DAG 2.0、acceptance 聚合、批准 receipt、并发和恢复证据。
- [ ] 目标基线把“验收追踪未形成门禁”更新为有 fixture 证据的已实现能力。
- [ ] 如实保留 knowledge stale、owned files、串行编排等剩余差距。
- [ ] 下一子里程碑更新为 M7-A4。
- [ ] 不把 M7-A3 描述为 M7 完成或真实 Story 验收。

## 27. 验收映射

| 验收项 | 必需实现与证据 |
| --- | --- |
| AC-A3-01 | requirement gate、question 组合负例、State 零写入 |
| AC-A3-02 | DAG 2.0 Schema、1.0 回归、criterion 引用门禁 |
| AC-A3-03 | implementation task 完整覆盖和 method 组合测试 |
| AC-A3-04 | required test 覆盖、无关 passed case、结果状态门禁 |
| AC-A3-05 | required verification 覆盖、optional case 聚合、environment unavailable |
| AC-A3-06 | approval receipt、subject hash、跨 attempt/case 拒绝、漂移测试 |
| AC-A3-07 | verification/approval/acceptance 单事务测试 |
| AC-A3-08 | 各阶段 acceptance 重建和篡改检测 |
| AC-A3-09 | delivery/done 最终重算和九阶段索引完整性 |
| AC-A3-10 | State v1、DAG 1.0、Worker 和 M5/Worktree 回归 |

## 28. 实施完成条件

只有同时满足以下条件，才可将 M7-A3 标记为完成：

- 本计划通过独立只读评审并获得用户实施批准。
- 所有 Task 按 TDD 完成。
- A3 专项测试和相关全量回归通过。
- Harness smoke、结构校验、State/DAG 校验和 `git diff --check` 通过。
- 独立代码审核无未解决 BLOCKER/WARNING。
- REPORT、目标基线、结构清单、Skill 和 manifest 同步。
- 未执行未经批准的 Git、Worktree、Docker、发布或部署操作。

完成后进入 M7-A4 专项设计，不提前宣称 M7 已完成。
