# FrontierScan Harness M7-A3 验收追踪与语义门禁设计

> 日期：2026-08-13
>
> 状态：设计完成，已于 2026-08-13 通过独立只读评审，无 BLOCKER/WARNING
>
> 路线基线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：M7-A1、M7-A2 已实施并通过独立只读审核
>
> 实施基线：`fe65b0b feat(harness): implement M7-A2 phase result projection`

## 1. 目标与防偏移说明

FrontierScan 当前 Harness 的总体目标是：

> 用户只描述一个业务任务，Codex 就能按照项目 Harness 完成单仓库、单 Story、当前会话串行的需求、设计、实现、测试、审核、构建、验证和交付准备闭环。

M7-A1 已建立 State v2 和 State v1 只读兼容；M7-A2 已建立统一阶段 `result.json`、九阶段结构化投影、正式 `phase-result` 索引、原子推进和过程状态恢复。

M7-A3 只解决以下尚未闭合的问题：

```text
需求验收项
-> 实现任务
-> 测试用例和结果
-> 验证用例和结果
-> 逐项批准的验证缺口
-> 最终验收结论
```

完成后，最终 State 必须能独立回答：

- Story 有哪些验收项，哪些是 required。
- 每个验收项由哪些 DAG 任务负责。
- 每个验收项由哪些测试用例覆盖，结果是什么。
- 每个验收项由哪些接口或界面验证用例覆盖。
- 最终结论是 `verified`、`accepted-with-known-gaps`、`failed`、`blocked` 还是仍为 `pending`。
- 哪些缺口由用户逐项批准，批准绑定的具体结果和证据是什么。
- Runtime 为什么允许或拒绝进入下一阶段和 `done`。

M7-A3 不建立通用规则引擎。AI 继续负责产生需求、DAG、测试和验证内容；确定性模块负责契约、引用、聚合、批准凭据和门禁判定。

## 2. 当前事实与缺口

M7-A2 已经具备：

- `requirement.acceptanceCriteria[].criterionId`。
- test case 和 verification case 的 `criterionIds`。
- verification result 的 `approvalId`。
- State 顶层空数组 `approvals`。
- 九阶段 completed result 到 State 的原子投影。
- apply 前的 output、record、hash、bytes 和 revision 校验。
- code-review、unit-test 和 build 的基础阶段门禁。

但当前仍允许：

- required criterion 没有 DAG 任务负责。
- DAG 使用自由文本 `acceptanceCriteria`，无法可靠引用 requirement criterion。
- test case 或 verification case 引用不存在的 criterion。
- 无关 passed test 被误认为满足 Story 验收。
- required case 没有结果、结果为 skipped/blocked，却仍缺少统一语义判定。
- `accepted-with-known-gaps` 只填写任意 `approvalId`，没有真实批准凭据。
- verification 结果变化后旧批准仍可能被引用。
- State 无法直接展示 criterion 的任务、测试、验证和最终结论汇总。

这些问题使 State 虽然结构化，但尚未形成可判定的验收事实链。

## 3. 范围

### 3.1 本阶段包含

- requirement criterion 的非空、唯一、问题关闭和稳定身份门禁。
- 独立 `task-dag 2.0` 契约及与 DAG 1.0 的版本共存。
- DAG、implementation、test 和 verification 的 criterion 引用完整性。
- required 与 optional criterion 的不同完成语义。
- implementation task 完整完成门禁。
- test case/result 覆盖和状态门禁。
- verification case/result 覆盖和 criterion 聚合。
- `verification-gap` 的逐 case 用户批准。
- attempt-scoped approval receipt。
- apply 时 approval 与 verification result 的原子 State 投影。
- State `acceptance.criteria` 确定性汇总。
- delivery-preparation 到 done 的最终重算门禁。
- requirement、DAG、测试、验证、State Runner、Task Planner 和 Interface Verifier 相关 Skill/模板更新。
- `derive-interface-cases.ps1` 与 `select-tests.ps1` 的 A3 必需适配。

### 3.2 本阶段不包含

- knowledge freshness 判断、刷新任务和 `accepted-stale` 业务门禁；归 M7-C。
- Git 差异、`actualFiles/predictedFiles` 对账、owned files 和交付回执；归 M7-A4。
- remaining risk 的批准有效性；归 M7-A4。
- 自动串行调度；归 M7-B。
- 真实 Agent Provider、并行、Fork-Join、Docker 或发布。
- finding 与 criterion 的逐项绑定。
- build result 与 criterion 的逐项绑定。
- 自动根据业务模块推导精确测试命令。
- 完整 RED/GREEN 时间线保存。

## 4. 已确认的架构决策

1. required criterion 必须完整覆盖；optional criterion 可无覆盖且不阻止 `done`。
2. optional criterion 一旦被引用，引用和结果仍必须合法，最终 State 必须如实保存。
3. verification gap 按 verification `caseId` 逐项批准，一个批准不能覆盖多个 case。
4. 结果、case 或 evidence 变化后，旧批准立即失效。
5. 批准入口为 `run-story approve-gap`，只处理当前冻结的 interface-verification attempt。
6. approve-gap 不修改 State，不增加 revision。
7. approve-gap 先写不可变 approval receipt，再原子更新当前 `result.json` 的 `approvalId`。
8. apply 验证 receipt 后，将 approval 和 verification payload 在同一 State 事务中写入。
9. 新增 task-dag 2.0；task-dag 1.0、State v1 和 M5 协议不迁移。
10. required criterion 必须分别被 DAG、required test case 和 required verification case 覆盖。
11. implementation 的 `taskUpdates` 必须完整覆盖 DAG nodes，离开阶段时所有任务均为 `done`。
12. test 中任何 `failed` 都是全局质量失败并阻止推进。
13. optional-only verification failure 如实保留，但不阻止 `done`。
14. State 新增独立 `acceptance.criteria` 汇总，原始 requirement criterion 不承载执行状态。
15. 采用独立 `acceptance-contract.mjs`、`acceptance-gate.mjs` 和 `approval-contract.mjs`。

## 5. Requirement 契约与门禁

### 5.1 Criterion

沿用现有结构：

```json
{
  "criterionId": "AC-001",
  "description": "用户可以看到文章的已读状态",
  "source": "user",
  "required": true
}
```

规则：

- 至少存在一个 `required=true` criterion。
- `criterionId` 在 Story 内唯一。
- `criterionId` 使用现有安全 ID 字符集。
- `description` 和 `source` 必须非空。
- requirement apply 后，后续阶段只能引用，不能更名、删除或改写 criterion。
- optional criterion 保留在最终 State，不得因为未覆盖而静默删除。

### 5.2 Open question

沿用：

```text
questionId
question
status(open|resolved)
resolution
```

一致性规则：

- 离开 requirement 前所有问题必须为 `resolved`。
- `status=resolved` 时 `resolution` 必须为非空字符串。
- `status=open` 时 `resolution` 必须为 `null`。
- 不新增 blocking/non-blocking 分类。
- 不影响当前 Story 的问题应移入非目标、风险或后续任务，不能以 open question 形式留在已完成 requirement 中。

### 5.3 Requirement apply 门禁

Runtime 在候选 State 上执行：

```text
criterion 非空和唯一
-> 至少一个 required criterion
-> question 状态和 resolution 一致
-> 无 open question
-> 生成初始 acceptance 汇总
-> 通过才允许投影和推进
```

任一失败必须发生在 State intent 之前。

## 6. Task DAG 2.0

### 6.1 版本共存

新增：

```text
.harness/schemas/task-dag-v2.schema.json
```

现有 `.harness/scripts/lib/task-dag-contract.mjs` 按 `schemaVersion` 分发：

```text
1.0 -> 现有历史契约
2.0 -> M7-A3 严格 criterion 引用契约
```

不新增第二套通用 DAG Runtime。

### 6.2 顶层结构

```json
{
  "schemaVersion": "2.0",
  "storyId": "S1",
  "nodes": [],
  "edges": [],
  "waves": [],
  "globalChanges": [],
  "risks": []
}
```

顶层禁止额外字段。

### 6.3 Node

```json
{
  "taskId": "T1",
  "title": "实现文章已读状态",
  "type": "backend",
  "status": "pending",
  "ownerAgent": "backend-developer",
  "predictedFiles": [
    "backend/src/main/**"
  ],
  "criterionIds": [
    "AC-001"
  ]
}
```

规则：

- 必需字段为 `taskId/title/type/status/ownerAgent/predictedFiles/criterionIds`。
- 禁止 `acceptanceCriteria`。
- node 禁止额外字段。
- `criterionIds` 可为空，以支持纯基础设施或全局辅助任务。
- 非空引用必须存在于当前 State requirement。
- 同一 node 内 criterion ID 唯一。
- 所有 node 在 task-dag apply 时必须为 `pending`。
- 状态继续使用 `pending/running/done/blocked`。
- 每个 required criterion 至少被一个 node 引用。
- optional criterion 可以没有 node。

### 6.4 DAG apply

task-dag result 继续只携带 DAG 文件路径和 SHA-256。Runtime：

```text
读取 DAG
-> 按版本校验
-> State v2 只接受 DAG 2.0
-> 校验 storyId、hash、图、波次和引用
-> 校验 required criterion 覆盖
-> 投影 State dag
-> 重建 acceptance 汇总
```

悬空引用、required criterion 未覆盖、非 pending 初始状态或 DAG 漂移均零写入。

## 7. Acceptance 汇总

### 7.1 State 结构

State v2 新增必需顶层对象：

```json
{
  "acceptance": {
    "criteria": [
      {
        "criterionId": "AC-001",
        "required": true,
        "taskIds": ["T1"],
        "testCaseIds": ["TC-001"],
        "verificationCaseIds": ["VC-001"],
        "status": "verified",
        "approvalIds": []
      }
    ]
  }
}
```

每项只允许：

```text
criterionId
required
taskIds
testCaseIds
verificationCaseIds
status
approvalIds
```

状态：

```text
pending
verified
accepted-with-known-gaps
failed
blocked
```

### 7.2 事实来源

汇总不接受 result 自行声明。Runtime 只从以下正式候选 State 字段派生：

- `requirement.acceptanceCriteria`
- `dag.nodes`
- `tests.cases/results`
- `verification.cases/results`
- `approvals`

顺序保持 requirement criterion 顺序；各 ID 数组保持源对象顺序并去重。

### 7.3 重建时机

以下 completed phase apply 时完整重建：

```text
requirement
task-dag
implementation
unit-test
interface-verification
delivery-preparation
```

technical-design、code-review 和 build-publish 不改变追踪关系，但候选 State 仍必须通过 acceptance 结构校验。

进入 done 前必须从候选 State 再次完整计算，并与待提交 `acceptance.criteria` 逐字段比较；不一致则失败关闭。

### 7.4 状态聚合

在 interface-verification 之前，criterion 默认为 `pending`。

验证阶段后：

对 required criterion，参与聚合的集合包括：

- 所有用于满足 required 覆盖的 required verification case。
- 所有引用该 required criterion 的 optional verification case。

按以下优先级聚合：

1. 任一参与 case 为 `failed`：`failed`。
2. 否则任一参与 case 为 `blocked`：`blocked`。
3. 否则任一 required case 缺少结果：`pending`。
4. 否则至少一个参与 case 为合法 `accepted-with-known-gaps`，其余均为 `verified` 或合法 accepted gap：`accepted-with-known-gaps`。
5. 否则全部 required case 为 `verified`：`verified`。

optional case 不能单独满足 required criterion 的覆盖要求，但其失败或阻塞不能与 required criterion 的汇总结论矛盾。

optional criterion：

- 可以无 task、test 或 verification 覆盖，并保持 `pending`。
- optional-only verification result 可以形成 `verified/accepted-with-known-gaps/failed/blocked`。
- optional criterion 的非通过状态不阻止 `done`。

## 8. Implementation 门禁

implementation payload 保持：

```text
taskUpdates
actualFiles
method
exceptionReason
notes
```

规则：

- `taskUpdates` 必须覆盖所有 DAG nodes。
- 每个 DAG task 恰好出现一次。
- 不允许未知、重复或缺失 task。
- 离开 implementation 时所有 task status 必须为 `done`。
- `completedTaskIds` 继续由 Runtime 根据 `taskUpdates.status=done` 派生。
- `method=tdd` 时 `exceptionReason=null`。
- `method=exception` 时 `exceptionReason` 必须非空。
- `method=exception` 不豁免 test 覆盖。
- `actualFiles` 可以为空，但 `notes` 必须至少包含一条明确理由。
- A3 不校验 actual files 与 Git 或 predicted files；该对账归 M7-A4。

## 9. Unit-test 门禁

### 9.1 Case

沿用现有字段：

```text
caseId
type
required
criterionIds
expected
```

规则：

- caseId 唯一。
- criterionIds 内部唯一且全部存在。
- 每个 required criterion 至少被一个 `required=true` test case 引用。
- 一个 case 可覆盖多个 criterion。
- 一个 criterion 可由多个 case 覆盖。

### 9.2 Result

每个 required test case：

- 必须有且只有一个同 `caseId` result。
- result 必须为 `passed`。
- `failed/skipped/blocked` 均阻止推进。

optional test case：

- 可以没有 result。
- 可以为 `passed/skipped/blocked`。
- 任意 test result 为 `failed` 都是全局测试失败并阻止推进。

其他规则：

- result 不得引用不存在的 case。
- 同一 case 不得有重复 result。
- required result 必须有 evidence path/hash，且 Runtime 对账普通文件、非符号链接、路径边界和 SHA-256。
- test command 是执行证据，不承担 criterion 映射。
- 至少存在一个已通过且证据有效的命令或现有 adapter 结果。
- `implementation.method=tdd` 不能代替 test case/result。

## 10. Interface verification 门禁

### 10.1 Case

沿用：

```text
caseId
type
required
criterionIds
action
expected
```

规则：

- caseId 唯一。
- criterionIds 全部存在。
- 每个 required criterion 至少被一个 required verification case 引用。
- required case 必须至少引用一个 criterion。

### 10.2 Result

required case：

- 必须有且只有一个结果。
- 只允许 `verified` 或带有效逐 case批准的 `accepted-with-known-gaps`。
- `failed/blocked/缺失` 均阻止推进。

optional case：

- 可以没有结果。
- `blocked` 或 optional-only `failed` 如实保留，不阻止 `done`。
- 如果 optional case 同时覆盖 required criterion，则按 required criterion 的门禁处理。

所有 result：

- 必须引用已存在 case。
- evidence path/hash 必须同时存在或同时为 null。
- `verified` 的 required result 必须有真实 evidence。
- `accepted-with-known-gaps` 必须有真实 evidence；作为 `approve-gap` 输入的待批准候选允许 `approvalId=null`，但进入 apply 语义门禁时必须引用当前 attempt 下的有效 approval。
- 其他状态必须 `approvalId=null`。

### 10.3 Environment

- `environment.status=unavailable` 不能自动满足 criterion。
- 相关 required case 必须保持 blocked，或转换为带逐项批准的 accepted gap。
- environment evidence 继续按现有契约校验。

## 11. Verification-gap approval

### 11.1 Approval receipt

路径：

```text
<attemptRoot>/approvals/<approvalId>.json
```

结构：

```json
{
  "schemaVersion": "1.0",
  "approvalId": "APR-<deterministic-id>",
  "storyId": "S1",
  "runId": "S1",
  "phase": "interface-verification",
  "dispatchId": "<uuid>",
  "preparedRevision": 8,
  "subjectType": "verification-gap",
  "subjectId": "VC-001",
  "subjectSha256": "sha256:<64-hex>",
  "status": "approved",
  "actor": "user",
  "reason": "本地 UI 环境不可用，接受本次已知验证缺口。",
  "evidencePath": "<verification-evidence>",
  "evidenceSha256": "sha256:<64-hex>",
  "createdAt": "2026-08-13T00:00:00.000Z"
}
```

约束：

- subjectType 首版只允许 `verification-gap`。
- subjectId 必须为当前 result 中 `accepted-with-known-gaps` caseId。
- status 固定 `approved`。
- actor 固定 `user`。
- reason 非空。
- evidencePath/evidenceSha256 必须与当前 verification result 一致。
- accepted gap 必须有真实 verification evidence，不允许 null evidence。
- receipt 必须是当前 attempt approvals 目录中的普通文件，不允许符号链接。
- `createdAt >= task.preparedAt`。
- `createdAt >= verification result.executedAt`。

### 11.2 Subject hash

不使用易歧义的字符串拼接。对以下对象执行规范 JSON 序列化并计算 SHA-256：

```json
{
  "storyId": "...",
  "runId": "...",
  "phase": "interface-verification",
  "dispatchId": "...",
  "preparedRevision": 8,
  "case": {
    "...": "完整 verification case"
  },
  "result": {
    "...": "移除 approvalId 后的完整 verification result"
  }
}
```

规范化规则：

- 对象键按 Unicode code point 升序。
- 数组保持业务顺序。
- 不包含空白。
- 使用 UTF-8 bytes。
- 不包含 approvalId，避免循环依赖。

case、status、actual、evidence、executedAt 或 criterionIds 任一变化都会改变 subject hash。

### 11.3 Approval ID 与幂等

幂等语义键：

```text
storyId
dispatchId
caseId
subjectSha256
actor
reason
```

对规范化语义键计算 SHA-256，并转换为满足 ID 契约的确定性 approvalId。

- 相同输入重复 approve，复用同一 receipt。
- reason、result 或 evidence 变化，生成新 approvalId。
- 已存在同 approvalId receipt 必须逐字段和文件 hash 一致，否则失败关闭。

### 11.4 正式 State approval

apply 时写入：

```text
approval receipt 全部业务字段
receiptPath
receiptSha256
```

State `approvals` 使用严格元素契约和 approvalId 唯一性。A3 只允许 `verification-gap` 正式 approval；M7-C 后续复用契约并扩展 `knowledge-stale`。

## 12. `run-story approve-gap`

### 12.1 输入

```powershell
.\.harness\scripts\run-story.ps1 `
  -Command approve-gap `
  -CaseId VC-001 `
  -Reason "接受当前已知验证缺口"
```

首版 actor 固定为 `user`，不接受任意 actor 输入。

### 12.2 前置条件

- State v2 处于 active `interface-verification`。
- 当前 active-attempt、task、checkpoint 和 result 身份一致。
- task preparedRevision 等于当前 State revision。
- result status 为 completed。
- case 存在且 result status 为 `accepted-with-known-gaps`。
- result 当前 approvalId 可以为 null、等于本命令确定性生成的 approvalId，或引用同一 Story、run、attempt 和 case 的有效旧 receipt。旧 receipt 的 subjectSha256 可以与当前 subject 不同，以支持 result 或 evidence 变化后的直接重新批准；跨 attempt 或跨 case 的旧 receipt 必须拒绝。
- verification evidence 存在且路径和 SHA-256 有效。

### 12.3 原子顺序

```text
获取与 apply 相同的 Story 写锁
-> 重读 State、active-attempt、task、checkpoint、result
-> 校验 case/result/evidence
-> 计算 subjectSha256 和 approvalId
-> 写 approval receipt 临时文件并原子 rename
-> 只修改目标 result.approvalId，可替换同一 subject 的旧 approvalId
-> 原子写回当前 result.json
-> 返回 approvalId、receiptFile、resultFile
```

不修改：

- State
- active pointer
- events
- revision
- checkpoint phase status

### 12.4 中断恢复

- receipt 已写、result 未更新：重试时验证 receipt 并补写 approvalId。
- result 已更新、命令返回前中断：重试时返回 reused。
- reason 变化时生成新 approvalId，并在 Story 写锁内替换同一 subject 的旧 approvalId。
- result 或 evidence 变化时，在 Story 写锁内基于新 subject 生成新 approvalId，并直接替换同一 Story、run、attempt 和 case 的旧 approvalId。
- approve-gap 与 apply 不能并发持有 Story 写锁；apply 只会消费锁内重读到的稳定 result。
- result 在批准后改变：apply 时 subject hash 不匹配，失败关闭。
- receipt 漂移、丢失或变为符号链接：apply 失败，不写 State。
- approval receipt 存在但 apply 未发生：它只是 attempt 凭据，不是正式 State approval。

## 13. Apply 与原子投影

interface-verification completed apply 在现有 Story 锁内：

```text
重读并验证 State/task/result/checkpoint
-> 校验 case/result 引用
-> 对每个 accepted gap 加载 approval receipt
-> 重算 subject hash
-> 校验 receipt 身份、actor、reason、evidence 和 hash
-> 构造候选 verification
-> 构造正式 approvals
-> 重建 acceptance 汇总
-> 执行 verification gate
-> 在同一候选 State 中写 verification、approvals、acceptance 和 phase-result
-> 原子推进
```

不得出现：

- approval 已进入 State，但 verification 未进入。
- verification 已进入 State，但 approval 缺失。
- approval 引用旧 result。
- result 引用其他 attempt receipt。

## 14. Code review 与 build

### 14.1 Code review

不要求 finding 绑定 criterion。继续作为全局质量门禁：

- `review.status=passed`。
- 无未解决 BLOCKER。
- 存在 hash 有效的 passed review evidence。
- open WARNING 如实保留，但不因非必要改进阻止 Story。

### 14.2 Build-publish

不增加 criterionIds。继续作为全局工程门禁：

- 必需 build/no-build adapter 存在并通过。
- 结构化 build result 无 failed。
- A3 不扩展 publish、deploy 或 Docker approval。

## 15. Delivery-preparation 与 done

delivery-preparation completed apply 的候选 State必须：

1. `delivery.status=ready`。
2. required criterion 均为 `verified` 或合法 `accepted-with-known-gaps`。
3. acceptance 汇总与重新计算结果逐字段一致。
4. DAG criterion 引用仍完整。
5. 所有 DAG task 均为 done。
6. required test 和 verification 覆盖仍成立。
7. 所有 required test result 仍 passed。
8. required verification result 仍有效。
9. approval receipt、receipt hash、subject hash 和 evidence 未漂移。
10. code-review 和 build 全局门禁仍成立。
11. 九个工作流阶段各存在一个合法 applied `phase-result` 正式索引；当前 delivery-preparation result 在候选 State 中计入。

每个 workflow phase 必须恰好存在一个 `status=applied` 的正式索引；同一阶段可以保留任意数量的历史 `status=blocked` 索引。applied 索引必须按 workflow 顺序校验 dispatch 身份和 revision 链，blocked 历史不得替代 applied 索引。

A3 不判定：

- owned files 是否与 Git 一致。
- `remainingRisks` 的 accepted 状态是否合法。
- 是否执行 Git 提交或推送。

## 16. 模块边界

### 16.1 `acceptance-contract.mjs`

负责：

- criterion 和 acceptance summary 元素契约。
- criterion/case/task ID 集合和引用完整性。
- State acceptance 结构严格校验。
- DAG 2.0 criterion 元素公共校验。

不负责文件 I/O 或 State 推进。

### 16.2 `acceptance-gate.mjs`

纯函数接口建议：

```javascript
buildAcceptanceSummary(state)
assertRequirementGate(state)
assertTaskDagGate(state)
assertImplementationGate(state)
assertUnitTestGate(state)
assertVerificationGate(state)
assertCompletionGate(state)
```

返回新对象或抛出确定性错误，不修改输入。

### 16.3 `approval-contract.mjs`

负责：

- verification gap subject 规范化和 hash。
- approval receipt/正式 approval 结构校验。
- 确定性 approval ID。
- receipt 与 case/result/attempt 的身份匹配。

文件安全和原子写入由 Story Runtime 负责。

### 16.4 现有模块

- `task-dag-contract.mjs`：DAG 1.0/2.0 版本分发和图结构。
- `phase-data-contract.mjs`：收紧 question、implementation、test 和 verification 元素。
- `phase-result-projector.mjs`：继续投影阶段拥有字段；acceptance 由 gate 模块重建。
- `state-contract.mjs`：调用 acceptance/approval contract 验证 State。
- `state-runtime.mjs`：导出 `withStateWriteLock(options, callback)`，在现有 run lock 内重读并验证 State/pointer，但不调用 `persistLocated`；`runStateTransaction` 基于该接口继续负责事件和 State 持久化。
- `story-runtime.mjs`：I/O、锁、attempt、receipt、事务和 gate 编排。

## 17. Dispatch result v2 调整

不升级顶层 `dispatch-result v2` 版本，不增加新的顶层字段。

只收紧现有 payload 元素：

- open question 与 resolution 一致。
- implementation method 与 exceptionReason 一致。
- actualFiles 为空时 notes 非空。
- accepted-with-known-gaps 必须有 evidence；结构契约允许待批准候选的 `approvalId=null`。
- 非 accepted gap verification result 必须 `approvalId=null`。
- required test/verification result 的 evidence 要求由 gate 判定。

`approve-gap` 使用专用 approval-candidate 校验消费以下 result：

- 首次批准时 `approvalId=null`。
- 重新批准时，`approvalId` 指向同一 Story、run、attempt 和 case 的有效旧 receipt；旧 receipt 可以具有不同的 `subjectSha256` 或 reason。

跨 attempt、跨 case、receipt 缺失或身份不匹配必须拒绝。apply 语义门禁仍要求 accepted gap 引用与当前 subject 完全匹配的有效 `approvalId`。批准不由 result 创建；result 只引用 `approvalId`。

## 18. 兼容策略

- State v1 保持只读，字节内容不迁移。
- task-dag 1.0 Schema 和 validator 行为保持兼容。
- M5 batch、wave、worktree fixture 继续使用 DAG 1.0。
- State v2 新 Story 的 task-dag 阶段只接受 DAG 2.0。
- 已完成历史 State 不修改。
- M7-A1/A2 fixture 按新的 State v2 acceptance 必需字段升级。
- 不使用 A3 行为解释或重写旧 Markdown 产物。

## 19. 辅助脚本与 Skill

### 19.1 `derive-interface-cases.ps1`

- 支持 DAG 1.0 和 2.0。
- DAG 2.0 输出包含 criterionIds 的结构化 draft。
- 不再为 v2 输出看似正式结果的 `TBD` 请求和结论。
- 缺少上游信息时输出 `pending-draft`，要求后续认知阶段填写 action/expected。

### 19.2 `select-tests.ps1`

- 识别 `.harness/runs/**/task-dag.json`。
- 识别 task-dag 2.0。
- 继续只提供确定性测试范围建议。
- 不在 A3 自动推导模块级业务测试类或命令。

### 19.3 Skill 和模板

更新：

- requirement：稳定 criterion ID、required 和问题关闭规则。
- task planner：DAG 2.0 criterionIds。
- state runner：approval receipt、正式 approval 和 acceptance summary。
- test gate：criterion coverage 和 required result。
- interface verifier：case/result/approval 语义。
- common：M7-A3 模块和边界。

## 20. 错误处理与安全

- 所有语义失败必须发生在 State intent 前。
- gate 失败时 State、pointer、events、revision 和正式 records 字节不变。
- approve-gap 只允许修改当前 attempt 的 result approvalId。
- receipt、result、evidence、DAG 和 State 路径必须在仓库根目录内。
- 所有正式证据文件必须是普通文件，不允许符号链接。
- Runtime 重新计算 hash，不信任声明值。
- result 或 evidence 漂移后旧批准不能继续使用。
- approval receipt 不能触发 Git、发布、Docker 或外部写操作。
- actor 首版固定为 user，但不宣称具备密码学身份认证；其真实性仍依赖当前用户批准边界和审计记录。

## 21. TDD 测试矩阵

| 区域 | RED/GREEN 场景 |
| --- | --- |
| Requirement | 无 required criterion、重复 ID、open question、resolved 无 resolution、open 携带 resolution |
| DAG 2.0 | 版本分发、额外字段、自由文本 acceptanceCriteria、悬空/重复 criterion、required criterion 未覆盖、非 pending 初始状态 |
| Implementation | taskUpdates 缺失、重复、未知 task、非 done、method/exceptionReason 组合、actualFiles 空且无 notes |
| Test | 无关 passed case、悬空 criterion、required criterion 未覆盖、缺失/重复 result、required skipped/blocked/failed、optional failed |
| Verification | required criterion 未覆盖、缺失/重复 result、blocked、failed、environment unavailable、optional-only failure |
| Approval | 无 receipt、错误 actor、空理由、错误 case、错误 attempt、错误 subject hash、null evidence、符号链接 |
| Approve recovery | 重复 approve、receipt 后中断、result 后中断、reason 变化替换、result/evidence 变化后直接重新批准、approve 与 apply 并发串行化、receipt 漂移 |
| Acceptance | 各阶段重建、顺序稳定、optional criterion、聚合优先级、人工篡改检测 |
| Completion | 汇总不一致、缺 phase-result、approval 漂移、required criterion 未通过、delivery 非 ready |
| Compatibility | State v1、DAG 1.0、A2 九阶段、Worker、batch、wave、worktree、smoke |

## 22. 验收标准

### AC-A3-01 Requirement 可判定

required criterion 非空且唯一，开放问题全部关闭，非法 requirement 零写入。

### AC-A3-02 DAG criterion 引用

State v2 只接受 DAG 2.0；所有引用存在，每个 required criterion 至少有一个任务负责。

### AC-A3-03 Implementation 闭环

所有 DAG node 均有唯一 task update 并进入 done；开发方法和例外理由结构一致。

### AC-A3-04 Test 覆盖

每个 required criterion 有 required test case 和 passed result；无关 passed test 不能满足门禁。

### AC-A3-05 Verification 覆盖

每个 required criterion 有 required verification case，且结果为 verified 或合法 accepted gap。

### AC-A3-06 逐项缺口批准

每个 accepted gap 绑定当前 attempt、case、result 和 evidence 的用户 approval receipt；漂移后旧批准失效。

### AC-A3-07 原子 approval 投影

verification、正式 approval、acceptance 汇总和阶段推进在同一 State 事务中提交。

### AC-A3-08 Acceptance 汇总

State 可直接查询每个 criterion 的 task、test、verification、approval 和最终状态；Runtime 能确定性重建。

### AC-A3-09 Completion 门禁

required criterion 未通过、汇总漂移、approval 漂移或阶段正式索引不完整时不能进入 done。

### AC-A3-10 兼容边界

State v1、DAG 1.0 和 M5 Runtime 不因 A3 回归；不提前实现 A4、B、C 或后续里程碑能力。

## 23. 完成门禁

M7-A3 实施完成必须同时满足：

- 本设计通过独立只读评审。
- `PLAN.md` 无待定决策并获得实施批准。
- acceptance、approval 和 DAG 2.0 采用 TDD 实施。
- 所有 A3 fixture 通过。
- State、Story、Worker、DAG 1.0 和 M5 相关回归通过。
- Harness smoke、结构校验和 `git diff --check` 通过。
- 独立代码审核无未解决 BLOCKER/WARNING。
- 更新目标基线、结构清单、Skill 和实施报告。
- 未执行未经批准的 Git、Worktree、Docker、发布或部署操作。

M7-A3 通过后进入 M7-A4 专项设计，不提前宣称 M7 已完成。
