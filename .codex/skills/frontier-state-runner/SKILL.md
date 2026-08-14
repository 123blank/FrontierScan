---
name: frontier-state-runner
description: 管理、校验、恢复和推进 FrontierScan Harness 状态。单 Story 需要跨会话保存阶段、证据、测试、审核、阻塞或交付状态时使用。
---

# Frontier 状态运行器

当工作流进度需要跨会话保存时使用本 Skill。E2E 活动状态必须通过确定性运行时修改，不得手工改写阶段或 revision。

## 快速流程

1. 初始化单 Story 运行：

```powershell
.\.harness\scripts\run-state.ps1 -Command init -StoryId M2-001 -Summary "业务摘要"
```

2. 每次继续工作前读取并校验状态：

```powershell
.\.harness\scripts\run-state.ps1 -Command status -Json
.\.harness\scripts\run-state.ps1 -Command validate
```

3. State v2 阶段通过 `run-story.ps1 prepare` 获取 attempt-scoped task，并写入严格的 `result.json`。
4. 使用 `run-story.ps1 apply` 原子校验 result、投影 State 并推进；`record` 只保存手工审计证据，不回填阶段结构化字段。
5. `interface-verification` 中的 `accepted-with-known-gaps` 先使用 `run-story.ps1 approve-gap` 生成绑定当前 case、result 和 evidence 的批准回执。
6. 需要外部决策时使用 `block`，问题解决后使用 `resume`。
7. v2 由 `delivery-preparation` 的 completed result 经 completion gate 直接进入 `done`，不手工调用 `complete`。

M7-B 之后，普通单 Story 串行流程优先使用统一入口：

```powershell
.\.harness\scripts\run-e2e.ps1 -Command Status -Json
.\.harness\scripts\run-e2e.ps1 -Command Step -Json
.\.harness\scripts\run-e2e.ps1 -Command Apply -Json
```

`Step` 一次只执行一个确定性动作。返回 `cognitive-action-required` 时由当前 Codex 会话完成认知产物；返回 `adapter-selection-required` 时按测试或构建策略明确选择固定 Adapter；返回 `approval-required` 时停止并取得对应用户批准。

## 常用命令

```powershell
.\.harness\scripts\run-state.ps1 -Command record -RecordType test -Status passed -Path .harness/reports/test-report.md
.\.harness\scripts\run-state.ps1 -Command record -RecordType approval -Status approved -Actor user -Message "批准发布或 Git 交付" -Path .harness/reports/delivery-report.md
.\.harness\scripts\run-state.ps1 -Command next
.\.harness\scripts\run-state.ps1 -Command block -Reason "需要确认" -Owner user -SuggestedAction "确认范围"
.\.harness\scripts\run-state.ps1 -Command resume
.\.harness\scripts\run-story.ps1 -Command approve-gap -CaseId VC-001 -Reason "接受当前已知验证缺口"
```

通用参数：`-StateFile` 显式选择状态，`-Root` 指定仓库根目录，`-Json` 输出机器可读结果。

## 状态文件

- `.harness/states/active-run.json`：当前单 Story 活动指针。
- `.harness/states/e2e-<storyId>.json`：当前事实状态。
- `.harness/states/e2e-<storyId>.events.jsonl`：只追加审计事件。
- `.harness/states/e2e-state-v2.template.json`：新 Story 的默认初始化模板，不作为活动状态直接编辑。
- `.harness/states/e2e-state.template.json`：历史 v1 模板，仅用于兼容校验和审计读取。
- `.harness/states/product-state.template.json`：产品级拆分模板；M2 尚未实现产品级运行时。

## 参考资料

- 决定当前或下一阶段前读取 `references/phase-model.md`。
- 创建或修改状态记录前读取 `references/state-update-rules.md`。

## 规则

- 状态文件是事实来源，对话历史不是。
- 只通过 `run-state.ps1` 更新 E2E 活动状态。
- 新 Story 默认创建 State v2；State v1 只允许 `status` 和 `validate`，所有写命令失败关闭。
- `-StateFile` 可独立读取或更新指定状态；只有目标与活动指针一致时才更新活动指针。
- 不得越过失败的质量门禁。
- 纯构建可以离开 `build-publish`；任何真实发布仍必须在执行前通过 `frontier-build-publish` 获取显式用户批准。
- v2 从 `delivery-preparation` 进入 `done` 不要求 Git 批准；`done/completed` 表示业务开发和交付准备闭环完成，不表示已提交或推送。
- v2 使用独立 `dispatch-task-v2` 和 `dispatch-result-v2`；只有 `completed` result 投影业务 payload。
- `failed` result 只更新 attempt 过程状态，不修改 State、活动指针或事件；同 revision 可复用 task。
- `blocked` result 不投影业务 payload，通过单次 State 事务写入阻塞状态、证据和 `phase-result` 正式索引。
- `runtime.records[type=phase-result]` 是 apply 幂等与恢复的权威事实；checkpoint 和 `active-attempt.json` 只是可重建过程状态。
- result 的 output、evidence、SHA-256、bytes、dispatchId 和 preparedRevision 必须在锁内重新对账。
- requirement 至少包含一个 required criterion，且没有未解决开放问题；DAG、测试和验证必须通过稳定 `criterionId` 建立完整引用。
- required criterion 只有在相关任务完成、required 测试通过，并由 verification 得到 `verified` 或正式批准的 `accepted-with-known-gaps` 后才能完成。
- completion 只消费九阶段唯一的 applied `phase-result`；blocked 历史可保留，但不能替代 applied 结果。
- `approve-gap` 生成 attempt-scoped `approval-receipt.json`，subject hash 覆盖 case、result 和证据事实并排除 `approvalId`；跨 attempt 或跨 case 复用失败关闭。
- Git 暂存、提交、推送、PR 或发布仍必须在执行前获得用户明确批准。
- 测试跳过、环境不可用和审核阻塞都必须记录。
- 未经用户明确批准且没有证据，不得将发布、提交、推送或合并标记为完成。
- 审批记录必须包含 `actor=user`、非空说明和仓库内证据文件；运行时保存证据文件 SHA-256，但调用方仍负责确认真实用户身份。
- 测试记录必须绑定仓库内证据文件；同一路径重跑时以最新结果判断门禁，历史记录继续保留。
- 测试证据文件变化后旧结果失效，必须对当前内容重新记录测试结果。
- 审批证据文件变化后旧批准失效，必须对当前内容重新记录批准。
- 同一证据路径以最新审批结果为准，`denied` 会撤销此前的 `approved`。
- 已完成运行不可再修改，已存在的 Story 状态不可通过重复 `init` 覆盖。
- 完成态写命令会先对账孤立事务事件，再拒绝状态修改。
- v2 使用 `runtime.activeBlock` 保存当前阻塞；`resume` 后清空该字段，阻塞历史保留在日志和事件中。
- v2 初始化要求当前目录是具有已提交 HEAD 的附着分支 Git 仓库，并冻结 HEAD、branch 和初始 dirty paths。
- 新 Story 初始化发现旧运行已完成时，会按 `active-run.lock -> completed Story lock` 的顺序重新读取并闭合旧事务；仍在执行的完成操作会使初始化明确失败，释放锁后可重试。
- 初始化会检查正式指针、`.tmp` 和 `.bak`；任一候选恢复出活动或阻塞运行时不得创建第二个活动运行。
- 更新按 `pointer stage -> state commit -> pointer promote` 提交；临时指针领先状态时回退正式指针，状态达到临时指针 revision 后才恢复它。
- 跨 Story 指针候选按当前原子写入身份恢复；正式指针 revision 领先状态时失败关闭，状态领先指针可以按写入顺序恢复。
- 默认指针和已有运行状态必须通过运行时契约校验；显式 `-StateFile` 仍可在无关活动指针损坏时独立使用。
- M7-A3 已实现验收追踪与 `verification-gap` 语义门禁，M7-A4 已实现 owned files、交付准备对账和独立交付回执，M7-B 已实现最小确定性串行驱动器。知识新鲜度闭环、Agent 自动派发、正式并行、真实发布或 Git 自动写入仍未实现。
