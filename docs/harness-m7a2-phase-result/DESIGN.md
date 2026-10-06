# FrontierScan Harness M7-A2 统一阶段结果与 State 投影设计

> 日期：2026-08-12
>
> 状态：已于 2026-08-12 获用户批准并通过独立只读评审；待实施批准
>
> 路线基线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：`M7-A1` 已实施、fixture 验证并通过独立审核
>
> 实施基线：`09e80f2 feat(harness): implement M7-A1 state v2 contract`

## 1. 目标与防偏移说明

M7-A2 对应目标基线中的“State 作为完整事实源”和“AI 负责认知、程序负责确定性执行”。本阶段解决：

```text
阶段结论主要存在于 Markdown
-> 每个阶段产出统一、严格、版本化的 result.json
-> Runtime 校验文件身份和结构化 payload
-> Runtime 原子投影 State v2 并推进阶段
```

完成后，State v2 能直接回答每个已完成阶段的核心事实，Markdown 只承担人类说明和证据载体，不再被 Runtime 解析为业务事实。

本阶段不启用验收覆盖门禁、accepted gap/stale、owned files 自动推导、交付回执、真实 Agent、并行、Docker 或 Git 自动化。这些分别属于 M7-A3、M7-A4、M7-C 和后续里程碑。

## 2. 已确认的架构决策

用户已确认：

1. State v2 同时使用独立的 `dispatch-task v2` 和 `dispatch-result v2`。
2. 旧 `1.0/1.1/1.2` task/result 协议保持不变。
3. 只有 `status=completed` 的 result 投影阶段核心业务字段。
4. `failed/blocked` 不投影阶段业务 payload。
5. 阶段拥有字段使用完整替换，不做隐式增量合并。
6. 审计集合由 Runtime 追加并按本阶段定义的语义身份去重。
7. State 保存正式结果索引，`checkpoint.json` 只保存过程进度。
8. 重复 apply 以 State 正式结果索引为权威进行幂等判断。

## 3. 当前问题

现有 `story-runtime.mjs` 使用 `dispatch-result 1.0`：

- result 不携带 `runId` 和 `preparedRevision`。
- output 只有路径，没有 SHA-256 和字节数。
- result 没有阶段判别 payload。
- `recordResultEvidence` 在推进前逐条调用 State `record`，产生多次 revision。
- unit-test adapter 会在 result apply 前直接写 State。
- required output 自动记录与 result records 可能重复。
- State 推进后主要依靠 checkpoint 判断 result 是否已经 apply。
- 核心字段仍为空，Markdown 是实际事实载体。

这些行为不能满足 State v2 的完整事实源和单次原子投影目标。

## 4. 范围

### 4.1 本阶段包含

- 新增 `dispatch-task v2` 和 `dispatch-result v2` Schema。
- 扩展 Node dispatch contract，对 v2 task/result 严格校验。
- 新增九阶段 payload 判别契约。
- 新增纯函数 State projector。
- task-dag 从已验证 DAG 文件投影，不在 result 重复完整 DAG。
- output 路径、SHA-256、bytes 对账。
- completed result 的 State 投影、证据索引和阶段推进单事务提交。
- result 正式索引、重复 apply、checkpoint 落后恢复和 result 漂移检测。
- failed/blocked 的明确处理。
- v2 adapter 不再提前修改 State。
- 更新阶段模板、相关 Skill、结构清单和测试。

### 4.2 本阶段不包含

- 不修改或迁移历史 State v1。
- 不升级 M5 batch、wave、worktree 的 `1.0/1.1/1.2` 协议。
- 不实现 criterion 引用完整性和覆盖门禁。
- 不判定 accepted-with-known-gaps 或 accepted-stale 是否有效。
- 不刷新知识或阻止 stale。
- 不从 Git 自动推导 implementation/delivery 文件。
- 不生成 delivery receipt。
- 不自动调用 Agent、Git、Worktree、Docker、发布或部署。

## 5. 文件边界

### 5.1 计划新增

```text
.harness/schemas/dispatch-task-v2.schema.json
.harness/schemas/dispatch-result-v2.schema.json
.harness/scripts/lib/phase-result-projector.mjs
.harness/scripts/tests/phase-result-projector.test.mjs
docs/harness-m7a2-phase-result/REPORT.md（实施后）
```

### 5.2 计划修改

```text
.harness/scripts/lib/dispatch-contract.mjs
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/lib/state-contract.mjs
.harness/schemas/e2e-state-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/tests/state-runtime.test.mjs
.harness/scripts/tests/worker-runtime.test.mjs
.harness/scripts/smoke-harness-flow.ps1
.harness/scripts/validate-structure.ps1
.harness/structure-manifest.yaml
.harness/templates/*
.codex/skills/frontier-state-runner/*
.codex/skills/frontier-common/references/harness-runtime.md
docs/harness-structure-checklist.md
docs/harness-engineering-target-and-gap.md（实施完成后更新进度）
```

### 5.3 明确不修改

```text
.harness/schemas/dispatch-task.schema.json
.harness/schemas/dispatch-task-v1.1.schema.json
.harness/schemas/dispatch-task-v1.2.schema.json
.harness/schemas/dispatch-result.schema.json
.harness/schemas/dispatch-result-v1.1.schema.json
.harness/schemas/dispatch-result-v1.2.schema.json
.harness/schemas/e2e-state.schema.json
.harness/states/e2e-state.template.json
.harness/workflows/e2e-development.yaml
历史 completed State 和 events
```

## 6. Dispatch task v2

普通 State v2 九阶段的 `task.json` 使用：

```json
{
  "schemaVersion": "2.0",
  "dispatchId": "00000000-0000-4000-8000-000000000000",
  "storyId": "M7-A2-001",
  "runId": "M7-A2-001",
  "phase": "requirement",
  "ownerAgent": "requirement-analyst",
  "purpose": "Clarify the story.",
  "preparedRevision": 1,
  "preparedAt": "2026-08-12T00:00:00.000Z",
  "resultSchemaVersion": "2.0",
  "attemptRoot": ".harness/runs/M7-A2-001/phases/00-requirement/attempts/00000000-0000-4000-8000-000000000000",
  "resultFile": ".harness/runs/M7-A2-001/phases/00-requirement/attempts/00000000-0000-4000-8000-000000000000/result.json",
  "checkpointFile": ".harness/runs/M7-A2-001/phases/00-requirement/attempts/00000000-0000-4000-8000-000000000000/checkpoint.json",
  "expectedOutputs": [
    ".harness/runs/M7-A2-001/phases/00-requirement/requirement-breakdown.md"
  ],
  "allowedAdapters": [],
  "next": "technical-design"
}
```

规则：

- `runId` 必须等于 `storyId` 和 State `runtime.runId`。
- `preparedRevision` 必须等于 prepare 时的 State revision。
- `resultSchemaVersion` 固定为 `2.0`。
- `attemptRoot` 必须是当前 phase 下的 `attempts/<dispatchId>`。
- task 固定写入 `<attemptRoot>/task.json`。
- `resultFile/checkpointFile` 必须分别是 `<attemptRoot>/result.json` 和 `<attemptRoot>/checkpoint.json`。
- phase 目录使用 `active-attempt.json` 定位当前 attempt，结构固定为
  `schemaVersion/dispatchId/attemptRoot/taskFile/resultFile/checkpointFile/preparedRevision/status/updatedAt`。
- `active-attempt.json` 是可恢复的过程指针，不是业务事实源；其身份必须与 task 一致。
- task 身份、workflow phase、输出集合和 adapter 集合必须一致。
- failed 后 State revision 未变化，重新 prepare 可复用同一 task。
- blocked/resume 后 State revision 已变化，旧 attempt 永久保留，重新 prepare 必须创建新 `dispatchId` 和新 attempt。
- 已存在 task 只有在 preparedRevision 仍等于当前 State revision 且上述字段完全匹配时才可复用。
- 不允许通过扫描 `attempts/` 或按修改时间猜测当前 attempt。
- State v1 或 M5 task-scoped/wave task 继续使用旧协议。

## 7. Dispatch result v2

### 7.1 公共结构

```json
{
  "schemaVersion": "2.0",
  "dispatchId": "00000000-0000-4000-8000-000000000000",
  "storyId": "M7-A2-001",
  "runId": "M7-A2-001",
  "phase": "requirement",
  "preparedRevision": 1,
  "status": "completed",
  "summary": "需求已澄清。",
  "outputs": [
    {
      "path": ".harness/runs/M7-A2-001/phases/00-requirement/requirement-breakdown.md",
      "sha256": "sha256:<64 hex>",
      "bytes": 128
    }
  ],
  "records": [],
  "payload": {}
}
```

公共规则：

- 顶层和所有子对象禁止额外字段。
- 身份字段必须与 task 和锁内重读 State 一致。
- `preparedRevision` 必须与 task 及当前 State revision 一致。
- `outputs` 路径顺序和集合必须与 task `expectedOutputs` 一致。
- 每个 output 必须是当前 phase 目录内的普通文件，不允许符号链接。
- Runtime 重新计算 SHA-256 和 bytes，不能信任 result 声明。
- completed 的 `outputs` 必须与 task `expectedOutputs` 完全一致。
- failed/blocked 的 `outputs` 必须为空；其诊断证据放在 attempt 的 `evidence/` 中并通过 records 引用，避免覆盖 canonical Markdown output。
- `records` 只引用当前 attempt 的 `evidence/` 文件；带路径记录必须绑定当前哈希。

### 7.2 Result record

result record 固定为：

```json
{
  "type": "review",
  "status": "passed",
  "path": ".harness/runs/M7-A2-001/phases/05-code-review/attempts/<dispatchId>/evidence/review.json",
  "sha256": "sha256:<64 hex>",
  "bytes": 256,
  "message": "独立审核通过。",
  "actor": "code-reviewer"
}
```

字段规则：

- `type` 只允许 `test/review/note`；output 由 Runtime 根据 `outputs` 自动建立，不允许 result 重复声明。
- `test` status 只允许 `passed/failed/skipped/blocked`。
- `review` status 只允许 `passed/BLOCKER/WARNING/resolved`。
- `note` status 只允许 `recorded`。
- `message` 可为空字符串，`actor` 必须非空。
- `test/review` 必须有 path；`note` 可使用 `path=null`。
- path 非空时 `sha256/bytes` 必须存在并与普通文件一致。
- path 为 null 时 `sha256/bytes` 必须为 null。
- 所有对象禁止额外字段。

### 7.3 状态分支

`status` 允许：

```text
completed
failed
blocked
```

`completed`：

- 必须包含当前 phase 对应的严格 `payload`。
- 不允许 `diagnostics` 和 `blocker`。
- 校验成功后才允许投影和推进。

`failed`：

- 不允许 `payload` 和 `blocker`。
- 必须包含 `diagnostics`。
- State、pointer、events 和业务字段保持不变。
- checkpoint 可记录失败过程；固定 result 文件本身保留诊断。

`blocked`：

- 不允许 `payload`。
- 必须包含 `diagnostics` 和 `blocker`。
- 通过一次 State 事务进入 blocked，并写入阻塞结果索引。
- 不投影当前 phase 的业务字段。

诊断结构：

```json
{
  "code": "ENVIRONMENT_UNAVAILABLE",
  "message": "本地环境不可用。",
  "details": []
}
```

诊断只表达失败事实，不承担 A3/A4/C 的风险接受语义。

## 8. 九阶段 payload

### 8.0 公共元素类型

以下元素结构在九阶段 payload 和 State v2 中统一复用；所有对象禁止额外字段。

验收项：

```text
criterionId, description, source, required
```

开放问题：

```text
questionId, question, status(open|resolved), resolution(null|string)
```

知识区域复用 State v2 已有结构：

```text
area, relevant, status, sourceFingerprint, loadedFiles, missing, checkedAt
```

风险：

```text
riskId, description, severity(low|medium|high), mitigation
```

仓库文件引用均为非空仓库相对路径。ID 均匹配 Story ID 使用的安全字符集合。A2 校验结构、枚举和同一数组内 ID 唯一；跨阶段引用完整性由 A3 启用。

### 8.1 Requirement

```text
acceptanceCriteria
openQuestions
inScope
outOfScope
```

元素：

- `acceptanceCriteria` 使用公共验收项结构。
- `openQuestions` 使用公共开放问题结构。
- `inScope/outOfScope` 是唯一非空字符串数组。

完整替换 `state.requirement` 中对应字段；`summary` 使用 result `summary`。

### 8.2 Technical design

```text
decisions
affectedAreas
knowledgeSnapshot
risks
```

元素：

- decision：`decisionId, summary, rationale`。
- affectedAreas：唯一非空字符串数组。
- knowledgeSnapshot：公共知识区域数组。
- risks：公共风险数组。

完整替换：

```text
state.design
state.knowledge.areas
```

A2 只保存快照，不判定 stale 是否阻塞。

### 8.3 Task DAG

```text
taskDagFile
taskDagSha256
```

Runtime 校验：

- 路径是当前 phase required output。
- result hash 与文件当前 hash 一致。
- DAG 通过现有结构校验。

projector 从该文件投影：

```text
sourceFile
sourceSha256
nodes
edges
waves
globalChanges
risks
```

不在 result 中复制完整 DAG。A2 保留当前 DAG item 结构，criterion ID 语义由 A3 收紧。

投影继续复用当前 `task-dag.schema.json`：

- node 字段至少为 `taskId/title/type/status/predictedFiles/acceptanceCriteria`，可选 `ownerAgent`。
- node status 保持当前 `pending/running/done/blocked`，A2 不在此处引入新的任务状态版本。
- edge 为 `from/to/reason`。
- wave 为唯一 taskId 数组。
- `globalChanges/risks` 为字符串数组。
- projector 深拷贝已验证字段，不保留 task-dag Schema 未声明的扩展字段。

### 8.4 Implementation

```text
taskUpdates
actualFiles
method
exceptionReason
notes
```

`taskUpdates` 每项只包含 `taskId/status`。只允许更新已存在 `dag.nodes` 的状态，不得增加、删除或修改任务身份、依赖、预测文件和验收信息。

元素：

- task update：`taskId, status(pending|running|done|blocked)`。
- actualFiles：唯一仓库相对路径数组。
- method：`tdd|exception`。
- exceptionReason：null 或非空字符串。
- notes：字符串数组。

投影：

- 完整替换 `state.implementation`。
- `completedTaskIds` 从 `taskUpdates.status=completed` 确定性派生。
- 对现有 `dag.nodes` 仅替换 status。

A2 校验结构和引用存在性，但 TDD 例外有效性与所有任务完成门禁由 A3 实现。

### 8.5 Unit test

```text
cases
commands
results
```

case：

```text
caseId, type(unit|integration|contract|ui), required, criterionIds, expected
```

command：

```text
commandId, command, status(passed|failed|skipped|blocked), exitCode(null|integer),
evidencePath, evidenceSha256, executedAt
```

result：

```text
caseId, status(passed|failed|skipped|blocked), actual,
evidencePath, evidenceSha256, executedAt
```

`criterionIds` 可为空，A3 才要求覆盖；evidence path/hash 必须同时为 null 或同时存在。

完整替换 `state.tests`。A2 不判定 criterion 覆盖完整性。

### 8.6 Code review

```text
findings
status
```

finding：

```text
findingId, severity(BLOCKER|WARNING|INFO), status(open|resolved),
summary, file, line, evidence
```

- file/evidence 可为 null 或仓库相对路径。
- line 可为 null 或正整数。
- review status 只允许 `pending/passed/blocked`。

完整替换 `state.review`。现有“未解决 BLOCKER 阻止推进”门禁继续保留。

### 8.7 Build and publish

```text
results
artifacts
externalActions
```

build result：

```text
buildId, type(backend|frontend|docker|no-build), status(passed|failed|skipped|blocked),
command, evidencePath, evidenceSha256, executedAt
```

artifact：

```text
artifactId, type, path, sha256, bytes
```

external action：

```text
actionId, type(publish|deploy|docker-build|docker-up|docker-down),
status(not-requested|approved|executed|blocked), approvalId, evidencePath, evidenceSha256
```

`approvalId` 和 evidence identity 可为 null。A2 只记录并校验结构，不判定批准有效性，也不执行 action。

完整替换 `state.build`。`externalActions` 只记录实际事实；result 不能宣称未获批准的发布已经执行。

### 8.8 Interface verification

```text
cases
results
environment
```

case：

```text
caseId, type(api|ui-flow|manual), required, criterionIds, action, expected
```

result：

```text
caseId, status(verified|failed|blocked|accepted-with-known-gaps),
actual, evidencePath, evidenceSha256, approvalId, executedAt
```

environment：

```text
status(not-checked|available|unavailable), summary, evidencePath, evidenceSha256
```

`approvalId` 可为 null；A3 才校验 accepted gap 的批准绑定。

完整替换 `state.verification`。A2 保存 `verified/blocked/failed` 等结构化结论，但 accepted gap 的批准有效性由 A3 实现。

### 8.9 Delivery preparation

```text
status
ownedFiles
outOfPredictionFiles
unrelatedDirtyFiles
remainingRisks
summaryFile
summarySha256
gitStatus
```

元素：

- status：`pending|ready|blocked`。
- 三类文件集合均为唯一仓库相对路径数组。
- remaining risk：公共风险加 `status(open|accepted|resolved)` 和 `approvalId(null|string)`。
- summaryFile/summarySha256 必须同时为 null 或同时存在，并与 completed output 身份一致。
- gitStatus：`not-requested|requested`。

完整替换 `state.delivery`。A2 信任经过严格结构和文件身份校验的 payload，不在本阶段实现 Git 基线差异推导；该推导由 A4 实现。

### 8.10 State v2 元素契约同步

`.harness/schemas/e2e-state-v2.schema.json` 与 `state-contract.mjs` 必须使用本节相同的元素结构、枚举、null 组合和额外字段规则。不能只严格校验 result，再把 payload 投影到仍接受任意数组元素的 State。

本阶段允许空数组；A3 再启用验收项非空、覆盖完整和批准有效性门禁。

## 9. State projector

新增：

```javascript
projectCompletedPhaseResult({
  state,
  result,
  taskDag,
  appliedAt,
})
```

返回全新的候选 State，不执行文件 I/O。

约束：

- 输入 State 不可修改。
- 只接受 State v2、活动状态和 `completed` result。
- 每个 phase 使用显式 projector，不使用动态路径或通用深合并。
- 数组完整替换并保持 result 顺序。
- 输入对象深克隆，后续修改 result 不得改变候选 State。
- 投影后调用 `validateStateDocument(candidate)`。
- projector 不推进 phase、不增加 revision、不写 records；这些由 State Runtime 事务层负责。

阶段所有权例外只有：

- technical-design 可替换 `knowledge.areas` 快照。
- implementation 可更新现有 `dag.nodes.status`。

## 10. 正式结果索引与证据

State v2 `runtime.records` 增加 `type=phase-result` 判别结构：

```json
{
  "id": "result:<dispatchId>",
  "type": "phase-result",
  "phase": "requirement",
  "status": "applied",
  "path": ".harness/runs/M7-A2-001/phases/00-requirement/attempts/<dispatchId>/result.json",
  "sha256": "sha256:<64 hex>",
  "bytes": 1024,
  "message": "需求已澄清。",
  "actor": "story-runtime",
  "dispatchId": "00000000-0000-4000-8000-000000000000",
  "preparedRevision": 1,
  "appliedRevision": 2,
  "createdAt": "2026-08-12T00:00:00.000Z"
}
```

blocked 使用 `status=blocked`，`appliedRevision` 是进入 blocked 后的 revision。

普通 `output/test/review/approval/note` 历史结构继续兼容。A2 不跨 record type 合并事实：同一文件可以同时存在 output 和 review/test 记录，因为它们表达不同语义。只对完全相同语义身份去重：

```text
type + phase + status + path + sha256 + actor
```

required output 自动记录固定为 `type=output/status=produced/actor=story-runtime`。result 不允许声明 output record，因此不会与自动 output record重复。跨消息等价、旧记录归并等更广泛清理仍属于 A4。

## 11. 原子 apply

为 State Runtime 增加仅供 Story Runtime 调用的内部结构化命令。它不接受任意候选 State，只接受已读取的 task/result 身份，并在锁内重新完成验证和投影。

事务顺序：

```text
获取 Story 写锁
-> 重读并校验 State
-> 读取并校验 active-attempt 指针
-> 重读 task/result/checkpoint
-> 校验 task/result/State 身份与 preparedRevision
-> 计算 result 文件 SHA-256 和 bytes
-> 校验 outputs、records 和 task-dag 引用
-> 计算候选投影 State
-> 向候选 State 添加规范化 output/test/review/note evidence
-> 在包含待提交 evidence 的候选 State 上执行当前阶段门禁
-> 添加 phase-result 正式索引
-> 推进 phase/status/revision
-> 校验完整候选 State 和 pointer
-> 写 intent
-> 使用既有 State/pointer 原子事务提交
-> 写 committed event
```

checkpoint 在 State 事务成功后更新为 completed。checkpoint 更新失败不回滚已提交 State；后续 apply 从 State 正式结果索引恢复 checkpoint。

`active-attempt.json` 在 checkpoint 之后更新为 completed/blocked/failed。State 已提交但两个过程文件更新失败时，后续 status/apply 必须先查询 State 正式索引，再修复过程文件；不得再次投影。

以下失败必须发生在 intent 之前：

- task/result/State 身份不一致。
- preparedRevision 不一致。
- output 缺失、符号链接、路径越界、hash 或 bytes 漂移。
- record evidence 漂移。
- payload 缺失、错误 phase 或额外字段。
- task-dag 路径、hash 或结构错误。
- projector 生成非法 State。
- 当前阶段门禁失败。

## 12. 幂等与恢复

### 12.1 重复 apply

若 State 已包含同一：

```text
dispatchId
preparedRevision
result path
result SHA-256
result bytes
```

则返回：

```text
status=already-applied
```

不修改 State、pointer、events、records 或 revision；如 checkpoint 落后则只恢复 checkpoint。

### 12.2 Result 漂移

同一 `dispatchId` 已存在正式索引，但当前 result hash 或 bytes 不同：

```text
result-drift
```

失败关闭，不覆盖正式索引，不推进 State。

### 12.3 Checkpoint 不一致

- State 有正式索引、checkpoint 缺失或落后：以 State 为准恢复 checkpoint。
- State 有正式索引、active-attempt 缺失或落后：根据索引中的 result path 和 attempt task 恢复过程指针。
- checkpoint 标记 completed、State 无正式索引：报告不一致，不信任 checkpoint。
- active-attempt 指向的 task 身份与 State 当前 revision 不匹配时不得复用；blocked/resume 后由新 prepare 原子替换为新 attempt。
- State 已推进但 previous phase result 索引匹配：返回 already-applied。
- State phase 与 task prepared phase 无合法前后关系：失败关闭。

## 13. Failed 与 blocked

### 13.1 Failed

failed result：

- 完整校验公共身份、diagnostics 和已声明证据。
- checkpoint 写为 failed。
- active-attempt 写为 failed。
- 不修改 State、pointer、events 或业务字段。
- 重试可在同一 preparedRevision 覆盖 result.json，但新的 completed/blocked result 必须仍匹配原 task。

failed checkpoint 不是业务完成事实，只是过程状态。

### 13.2 Blocked

blocked result：

- 完整校验身份、diagnostics、blocker 和证据。
- 在一个 State 事务中进入 `phase=blocked/status=blocked`。
- `activeBlock.previousPhase` 为 result phase。
- 添加 blocked phase-result 索引和规范化证据。
- 不投影 phase payload。
- checkpoint 在 State 提交后标记 blocked。
- active-attempt 在 checkpoint 后标记 blocked。

blocked attempt 的 task/result/checkpoint 和 evidence 永久保留。resume 增加 revision 并恢复原 phase；下一次 prepare 必须创建新 `dispatchId`、新 attemptRoot 和绑定 resume 后 revision 的 task。旧 blocked result 不得覆盖，也不得被新 attempt 当作 completed。

## 14. Adapter 与现有门禁

State v2 的 `run-adapter`：

- 继续写 phase evidence 和 checkpoint adapterRuns。
- 不再直接调用 State `record`。
- completed result 的 payload/records 引用 adapter evidence。
- apply 在候选投影 State 上执行 unit-test、code-review 和 build 的现有门禁。

State v1/M5 历史路径保持原行为，不因 A2 改写协议。

这避免：

```text
prepare revision=N
-> adapter 提前 record，State revision=N+1
-> result preparedRevision=N 无法原子 apply
```

## 15. 模板与人类报告

九阶段模板继续生成 Markdown，但需要同步说明对应 v2 payload 字段。模板不得要求 Runtime 从标题、表格或自由文本解析核心事实。

result.json 是机器接口，Markdown 是人类接口。二者通过 output 的：

```text
path
sha256
bytes
```

绑定。

## 16. 安全与兼容

- 所有路径继续经过仓库根目录约束和符号链接检查。
- result 不能提交 shell 命令给 Runtime 执行。
- externalActions 只记录事实，不能触发发布或外部写操作。
- v1 completed State 保持字节不变。
- 旧 task/result Schema 文件保持不变。
- M5 batch/wave/worktree Runtime 继续使用旧协议。
- 不执行正式 Git、Worktree、Docker、发布或部署。

## 17. TDD 测试矩阵

### 17.1 协议

- 合法 task v2/result v2。
- 缺失 `runId/preparedRevision/payload`。
- phase 与 payload 不一致。
- completed 携带 diagnostics/blocker。
- failed/blocked 携带 payload。
- 未知字段和错误 enum。
- 旧协议继续通过。

### 17.2 Outputs 与 records

- path/hash/bytes 全匹配。
- 缺失文件、目录、符号链接、越界路径。
- hash 漂移、bytes 漂移和输出顺序变化。
- record evidence 漂移。
- 同 result 重复证据不重复写入。

### 17.3 九阶段投影

- 每个阶段合法 payload 得到精确候选 State。
- 每个阶段不修改非拥有字段。
- 数组完整替换，旧条目不会残留。
- implementation 只能更新既有 task status。
- task-dag 从验证文件投影。
- 输入 State/result 不被修改。

### 17.4 原子性与恢复

- revision 漂移零写入。
- projector/gate 失败零写入。
- beforeCommit/afterPointerStage 等中断恢复。
- State 提交后 checkpoint 更新失败。
- 相同 result already-applied。
- 同 dispatch result 漂移。
- checkpoint completed 但 State 无索引。

### 17.5 Failed/blocked

- failed 只修改 checkpoint 与 active-attempt，不修改 State、pointer 和 events。
- blocked 单事务写 State，不投影 payload。
- failed 可复用同 task；blocked/resume 后必须创建新 dispatchId 和新 attempt。
- blocked result 漂移不覆盖正式索引。

## 18. 验收标准

### AC-A2-01 独立 v2 协议

State v2 普通阶段生成 task/result v2；旧协议资产和测试不变。

### AC-A2-02 严格身份与文件对账

task、result、State、output 和 evidence 的身份、revision、hash、bytes 任一不一致均零写入。

### AC-A2-03 九阶段完整投影

九阶段 completed result 均能把核心事实完整投影到 State，可直接查询。

### AC-A2-04 原子推进

投影、证据索引、phase/status/revision 和 pointer 在一次 State 事务中提交，不存在部分业务投影。

### AC-A2-05 幂等与恢复

相同 result 重试不增加 revision 或 records；State 能在 checkpoint 丢失或落后时证明并恢复已 apply 结果。

### AC-A2-06 失败语义

failed 不修改 State；blocked 只写阻塞事实和正式索引，不投影业务 payload。

### AC-A2-07 Markdown 非事实源

Runtime 不读取 Markdown 正文获取验收项、设计、测试、审核、验证或交付事实。

### AC-A2-08 兼容边界

State v1 与 M5 `1.0/1.1/1.2` Dispatcher、Worker、batch、wave 和 worktree 回归无 A2 引入的失败。

## 19. 完成门禁

M7-A2 实施完成必须同时满足：

- 本设计通过独立只读评审且无待定决策。
- 按 TDD 完成协议、投影、原子性、幂等和恢复 fixture。
- 九阶段都有至少一组 completed 投影测试。
- failed/blocked 均有零污染测试。
- State、Story、Worker 和相关 M5 回归通过。
- smoke、结构校验和 `git diff --check` 通过。
- REPORT、结构清单、目标基线、Skill 和 manifest 同步。
- 独立代码审核无未解决 BLOCKER/WARNING。
- 未执行 Git、Worktree、Docker、发布或部署。

M7-A2 通过后进入 M7-A3 专项设计，不提前宣称 M7 已完成。
