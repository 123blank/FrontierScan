# FrontierScan Harness M7-A2 统一阶段结果与 State 投影实施计划

> **供代理式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，逐任务先 RED、再最小 GREEN。未经用户逐次批准，不执行 Git 暂存、提交、推送、Worktree、Docker、发布或部署。
>
> 计划状态：设计已于 2026-08-12 获用户批准，设计与计划已通过独立只读评审；待实施批准。

**目标：** 为 State v2 九阶段建立独立 task/result v2、严格 payload、文件身份对账、纯 State 投影和可恢复的原子 apply。

**架构：** `dispatch-contract.mjs` 负责 task/result v2 结构，`phase-result-projector.mjs` 负责无 I/O 的阶段投影，`state-runtime.mjs` 负责锁、事件和 State/pointer 原子事务，`story-runtime.mjs` 负责准备、适配器、result 协调和 checkpoint 恢复。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Node 内置断言、临时 Git fixture、现有 FrontierScan Harness Runtime。

---

## 1. 实施边界与文件清单

### 1.1 新增

```text
.harness/schemas/dispatch-task-v2.schema.json
.harness/schemas/dispatch-result-v2.schema.json
.harness/scripts/lib/phase-result-projector.mjs
.harness/scripts/tests/phase-result-projector.test.mjs
docs/harness-m7a2-phase-result/REPORT.md
```

### 1.2 修改

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
docs/harness-engineering-target-and-gap.md
```

### 1.3 不修改

旧 task/result Schema、State v1 Schema/模板/工作流、历史 State/events 和 M5 协议资产。

## 2. Task 1：冻结旧协议兼容基线

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/tests/worker-runtime.test.mjs`

- [ ] 增加旧 `1.0/1.1/1.2` task/result 结构快照测试。
- [ ] 增加 State v1 显式 fixture 仍只读的回归断言。
- [ ] 运行 RED 前基线：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
```

预期：当前测试通过；记录测试计数，后续不得通过删除旧用例换取通过。

## 3. Task 2：建立 task v2 契约

**文件：**

- 新增：`.harness/schemas/dispatch-task-v2.schema.json`
- 修改：`.harness/scripts/lib/dispatch-contract.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：合法 task v2、缺失 runId、错误 preparedRevision、错误 attemptRoot/resultFile/checkpointFile、额外字段、State/task 身份漂移。
- [ ] 写 RED：合法 `active-attempt.json`、指针/task 身份漂移、preparedRevision 漂移和禁止目录扫描猜测。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：因 v2 task 未支持而失败。

- [ ] 实现 `validateDispatchTaskV20(task)`，字段严格使用 DESIGN 第 6 节。
- [ ] `validateDispatchTaskStructure` 按 `schemaVersion=2.0` 分发，旧分支不改。
- [ ] 修改 v2 `prepare` 生成 task v2；State v1/M5 路径继续生成旧版本。
- [ ] v2 task/result/checkpoint 使用 `phases/<phase>/attempts/<dispatchId>/`；canonical Markdown output 继续由 workflow 定义。
- [ ] prepare 原子写 task/checkpoint 后更新 phase 级 `active-attempt.json`；status/apply 只通过该指针定位当前 attempt。
- [ ] failed 且 revision 未变化时复用 task；blocked/resume 后创建新 dispatchId 和新 attempt。
- [ ] 重跑 story tests，预期新增 task v2 用例通过。

## 4. Task 3：建立 result v2 公共契约和状态分支

**文件：**

- 新增：`.harness/schemas/dispatch-result-v2.schema.json`
- 修改：`.harness/scripts/lib/dispatch-contract.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：公共身份、outputs `path/sha256/bytes`、records、completed/failed/blocked 分支。
- [ ] 覆盖：

```text
completed 缺 payload
completed 带 diagnostics/blocker
failed 带 payload
blocked 缺 diagnostics/blocker
未知 phase
未知字段
错误 hash/bytes 类型
failed/blocked outputs 非空
record path 不在 attempt evidence 目录
record path/hash/bytes null 组合错误
```

- [ ] 运行 story tests，预期 v2 result 未支持。
- [ ] 实现公共校验和状态分支，不实现具体 phase payload。
- [ ] 重跑，预期公共契约用例通过，payload 用例继续 RED。

## 5. Task 4：定义九阶段 payload 契约

**文件：**

- 修改：`.harness/schemas/dispatch-result-v2.schema.json`
- 修改：`.harness/scripts/lib/dispatch-contract.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 为九阶段各增加合法 payload fixture。
- [ ] 为九阶段各增加缺失字段、错误字段类型和额外字段负例。
- [ ] 增加 phase/payload 交叉使用拒绝测试。
- [ ] 按 DESIGN 8.0-8.9 为每种数组元素定义完整字段、枚举、null 组合、唯一 ID 和额外字段负例。
- [ ] 实现显式校验函数：

```text
validateRequirementPayload
validateTechnicalDesignPayload
validateTaskDagPayload
validateImplementationPayload
validateUnitTestPayload
validateCodeReviewPayload
validateBuildPayload
validateInterfaceVerificationPayload
validateDeliveryPreparationPayload
```

- [ ] 不使用通用自由对象或深合并。
- [ ] 运行 story tests，预期九阶段契约全部通过。

## 6. Task 5：扩展 State v2 正式结果索引契约

**文件：**

- 修改：`.harness/scripts/lib/state-contract.mjs`
- 修改：`.harness/schemas/e2e-state-v2.schema.json`
- 修改：`.harness/states/e2e-state-v2.template.json`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [ ] 写 RED：`phase-result` applied/blocked 合法结构。
- [ ] 写负例：缺 dispatchId、错误 result hash、bytes、preparedRevision、appliedRevision、额外字段。
- [ ] 保证 v1 record 和现有 v2 普通 record 继续通过。
- [ ] 将 record 校验改为按 `type` 判别：

```text
phase-result -> 严格正式索引字段
其他类型 -> 现有严格普通证据字段
```

- [ ] 模板 records 继续为空，不预建假记录。
- [ ] 运行 state tests 和结构校验。
- [ ] 将 DESIGN 第 8 节所有 payload 元素结构同步到 State v2 Node/JSON Schema，禁止任意数组元素进入正式 State。

## 7. Task 6：实现纯 phase projector

**文件：**

- 新增：`.harness/scripts/lib/phase-result-projector.mjs`
- 新增：`.harness/scripts/tests/phase-result-projector.test.mjs`

- [ ] 为 requirement 写 RED：完整替换并保留非拥有字段。
- [ ] 实现最小 requirement projector。
- [ ] 依次为其余八阶段执行 RED/GREEN。
- [ ] task-dag 测试传入已解析并验证的 DAG 文档，断言 source identity 与 arrays 精确投影。
- [ ] implementation 测试覆盖：

```text
只更新已存在 taskId
只允许修改 status
未知 taskId 拒绝
completedTaskIds 确定性派生
静态 DAG 字段保持不变
```

- [ ] 每阶段加入输入不变性测试：

```javascript
assert.deepEqual(originalState, beforeState);
assert.deepEqual(result, beforeResult);
```

- [ ] 运行：

```powershell
node .\.harness\scripts\tests\phase-result-projector.test.mjs
```

预期：九阶段全部通过。

## 8. Task 7：实现 output、result 和 evidence 身份对账

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：

```text
output path/hash/bytes 匹配
缺失文件
目录
符号链接
路径越界
hash 漂移
bytes 漂移
输出顺序或集合变化
record evidence 漂移
result.json 自身 hash/bytes 计算
```

- [ ] 实现只读校验函数，返回规范化且冻结的 result identity。
- [ ] 不修改传入 result 对象。
- [ ] task-dag 额外调用现有 DAG validator，并读取已验证文档供 projector 使用。
- [ ] 所有错误在 State intent 前出现。

## 9. Task 8：移除 v2 adapter 的提前 State 写入

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：v2 unit-test adapter 执行后 State revision 和 records 不变。
- [ ] 断言 evidence 与 checkpoint adapterRuns 已写入。
- [ ] 修改 `runAdapter`：

```text
State v2 -> 只写 evidence/checkpoint
历史兼容路径 -> 保持既有行为
```

- [ ] 增加 completed result 引用 adapter evidence 后一次投影的测试。

## 10. Task 9：实现 State Runtime 原子 phase apply

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：投影、records、phase、revision 和 pointer 必须一次提交。
- [ ] 增加内部命令 `apply-result`，不加入公开 PowerShell CLI 命令集合。
- [ ] 锁内重读 task/result/checkpoint，不接受调用方传入任意候选 State。
- [ ] 锁内先重读并校验 `active-attempt.json`，不得扫描 attempt 目录。
- [ ] 调用 projector 生成候选业务字段。
- [ ] 先向候选 State 添加规范化 result records 和自动 output records。
- [ ] 在包含待提交 evidence 的候选 State 上执行阶段门禁，增加首次 code-review passed result 可推进的回归。
- [ ] 门禁通过后添加唯一 `phase-result` 正式索引。
- [ ] 使用既有 `persistLocated` 原子提交一次 revision。
- [ ] 终态阶段在同一事务中进入 `done/completed`。
- [ ] 删除 v2 apply 中逐条 `recordResultEvidence` 和后续 `next/complete` 的多事务路径。
- [ ] 旧协议路径保持原实现。

## 11. Task 10：实现本阶段证据去重

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [ ] 写 RED：相同类型且完整语义身份相同的 evidence 只写一条。
- [ ] 写 RED：同一文件的 output 与 test/review record 必须分别保留，不得跨类型合并。
- [ ] 语义身份固定为：

```text
type + phase + status + path + sha256 + actor
```

- [ ] 相同身份复用，任一身份字段不同则保留独立事实。
- [ ] result Schema 禁止 `type=output`；required output 只由 Runtime 自动记录。
- [ ] 不在 A2 清理历史重复 records。

## 12. Task 11：实现重复 apply 与 result 漂移

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：State 已推进且正式索引完全匹配时返回 `already-applied`。
- [ ] 断言 State、pointer、events、records、revision 字节不变。
- [ ] 写 RED：同 dispatchId 但 result hash/bytes 改变时 `result-drift`。
- [ ] 实现先查 State 正式索引，再判断当前 phase/checkpoint。
- [ ] 不再以 checkpoint completed 作为已 apply 的充分条件。

## 13. Task 12：实现 checkpoint 落后恢复

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 覆盖 State 已提交、checkpoint 仍为 result-received。
- [ ] 覆盖 checkpoint 文件缺失。
- [ ] 覆盖 active-attempt 文件缺失或落后。
- [ ] 匹配正式索引时重建/更新 completed checkpoint。
- [ ] 匹配正式索引时重建/更新 active-attempt。
- [ ] checkpoint completed 但 State 无索引时失败关闭。
- [ ] checkpoint 与正式索引 dispatch/hash 不一致时失败关闭。

## 14. Task 13：实现 failed result

**文件：**

- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：failed result 只更新 checkpoint 与 active-attempt，不修改 State、pointer 和 events。
- [ ] 断言 active-attempt 同步标记 failed。
- [ ] 对比 State、pointer 和 events 字节不变。
- [ ] 断言 diagnostics 和 result 文件可读取。
- [ ] 允许在同一 task/preparedRevision 下用新的 completed result 重试。
- [ ] 不写 `phase-result` 正式索引。

## 15. Task 14：实现 blocked result

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [ ] 写 RED：blocked 一次 revision 进入 blocked。
- [ ] 断言：

```text
activeBlock.previousPhase=result.phase
业务 payload 未投影
blocked phase-result 索引存在
records 无重复
checkpoint 在 State 提交后变为 blocked
active-attempt 在 checkpoint 后变为 blocked
```

- [ ] 覆盖 checkpoint 更新失败后的恢复。
- [ ] 覆盖 active-attempt 更新失败后的恢复。
- [ ] 覆盖 resume 后旧 attempt 不变，并创建绑定新 revision 的新 task/dispatchId/attempt。
- [ ] 新 attempt 的 completed result 正常推进，旧 blocked 正式索引继续可审计。

## 16. Task 15：九阶段端到端 fixture

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`

- [ ] 创建完整 v2 Story fixture。
- [ ] 每阶段 prepare v2 task、写 Markdown、计算 output identity、写严格 result v2、apply。
- [ ] 每阶段 apply 后只从 State 断言投影事实。
- [ ] delivery-preparation 最终进入 done/completed。
- [ ] 不读取 Markdown 正文断言核心事实。
- [ ] smoke 加入最小 requirement -> technical-design v2 投影链路，避免 smoke 过重。

## 17. Task 16：Worker 与 M5 兼容回归

**文件：**

- 按失败最小修改：`.harness/scripts/tests/worker-runtime.test.mjs`
- 按失败最小修改：相关 Runtime 测试 fixture

- [ ] 运行：

```powershell
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

- [ ] 只修复基础 State v2 接入造成的真实兼容问题。
- [ ] 不把 M5 task/result 升级为 v2。
- [ ] 不删除或放宽安全测试。

## 18. Task 17：更新模板、Skill 和结构登记

**文件：**

- 修改：`.harness/templates/*`
- 修改：`.codex/skills/frontier-state-runner/*`
- 修改：`.codex/skills/frontier-common/references/harness-runtime.md`
- 修改：`.harness/scripts/validate-structure.ps1`
- 修改：`.harness/structure-manifest.yaml`
- 修改：`docs/harness-structure-checklist.md`

- [ ] 模板列出对应 payload 字段和 Markdown output。
- [ ] Skill 明确 State v2 result 规则、completed-only 投影和 failed/blocked 语义。
- [ ] 结构校验登记两个 Schema、projector 和测试。
- [ ] manifest 标记 `m7a2_phase_result` 的实际状态。

## 19. Task 18：全量验证

- [ ] 必跑：

```powershell
node .\.harness\scripts\tests\phase-result-projector.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
git diff --check
```

- [ ] 按 Task 17 运行全部 M5 回归。
- [ ] 记录每组测试计数和任何环境限制。

## 20. Task 19：独立只读审核

使用独立 `code-reviewer` Agent，只读审核：

```text
旧协议是否被意外改变
task/result/State 身份是否严格绑定
output/hash/bytes 是否在锁内重验
projector 是否修改非拥有字段
implementation 是否破坏 DAG 静态事实
adapter 是否仍提前写 State
apply 是否真正单 State 事务
State 索引是否权威
重复 apply 和 checkpoint 恢复是否可靠
failed/blocked 是否污染业务字段
blocked/resume 是否创建新 attempt
code-review 门禁是否读取待提交 evidence
是否错误跨类型去重
A2 payload 元素结构是否完整一致
A3/A4/C 是否被提前实现
```

BLOCKER/WARNING 必须按 TDD 修复并复审。

## 21. Task 20：报告与目标基线同步

**文件：**

- 新增：`docs/harness-m7a2-phase-result/REPORT.md`
- 修改：`docs/harness-engineering-target-and-gap.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`.harness/structure-manifest.yaml`

- [ ] REPORT 记录 RED/GREEN、九阶段投影、原子中断、幂等恢复、兼容回归和独立审核。
- [ ] 目标基线将 A2 从差距改为有 fixture 证据的实现状态。
- [ ] 不把 A2 描述为 M7 完成或真实 Story 验收。
- [ ] 标记下一子里程碑为 M7-A3。

## 22. 最终验收映射

| 验收项 | 必需证据 |
| --- | --- |
| AC-A2-01 | task/result v2 Schema 和旧协议回归 |
| AC-A2-02 | revision、path、hash、bytes 零写入负例 |
| AC-A2-03 | 九阶段 projector 与完整 Story fixture |
| AC-A2-04 | 单 revision、事件中断和 pointer 恢复测试 |
| AC-A2-05 | already-applied、result-drift、checkpoint 恢复 |
| AC-A2-06 | failed State 字节不变、blocked 无 payload 投影 |
| AC-A2-07 | Runtime 无 Markdown 正文解析测试 |
| AC-A2-08 | State/Story/Worker/M5 全量兼容回归 |

所有验收项通过、独立审核无 BLOCKER/WARNING、文档同步后，才向用户请求是否进入 M7-A3 设计。
