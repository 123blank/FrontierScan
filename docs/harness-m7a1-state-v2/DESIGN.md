# FrontierScan Harness M7-A1 State v2 契约与版本共存设计

> 日期：2026-08-12
>
> 状态：已于 2026-08-12 获用户批准并完成实施；fixture 验证通过，独立审核结论见 `REPORT.md`
>
> 路线基线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 实施基线：`deb3329 docs(harness): add M7-M12 iteration roadmap`

## 1. 目标

M7-A1 建立可长期演进的 E2E State v2 契约，并保留 State v1 的历史审计能力。

完成后应满足：

- 新 Story 默认创建 State v2。
- 已完成的 v1 State 保持字节不变，可执行 `status`、`validate` 和审计读取。
- v1 的所有写命令明确拒绝。
- v1 与 v2 使用独立 Schema、模板和工作流。
- State、Runtime 和 PowerShell validator 对版本的判断一致。
- v2 初始化时冻结 Git 基线，能够区分 Story 开始前已有修改。
- v2 使用 `runtime.activeBlock` 表示当前阻塞，不把已恢复阻塞保留为活动状态。
- v2 不存在顶层 `tasks`，`dag.nodes` 是任务事实的唯一入口。
- v2 以 `delivery-preparation -> done` 完成业务开发闭环，不要求 Git 操作批准。

本设计只覆盖版本共存、初始结构、基础运行和校验。阶段结果投影、验收追踪、知识新鲜度闭环和交付回执分别由 M7-A2、M7-A3、M7-C 和 M7-A4 实现。

## 2. 当前事实

### 2.1 v1 资产

当前单 Story 状态使用：

```text
.harness/schemas/e2e-state.schema.json
.harness/states/e2e-state.template.json
.harness/workflows/e2e-development.yaml
```

`state-runtime.mjs` 将模板和工作流路径硬编码为 v1 文件，并以手写 JavaScript 规则校验运行时结构。

`validate-state.ps1` 维护第二套 PowerShell 手写校验规则。两套规则均未按 `schemaVersion` 分发。

### 2.2 v1 运行行为

当前命令为：

```text
init
status
validate
record
next
block
resume
complete
```

其中：

- `init` 固定创建 v1。
- `resume` 设置 `runtime.blocked.resumedAt`，但不清空该对象。
- `complete` 固定要求从 `git-delivery` 完成，并要求该阶段存在用户批准。
- completed State 已不可变。
- active pointer 不携带目标 State 版本，只通过 `stateFile` 指向状态文件。

### 2.3 历史证据

`.harness/states/e2e-M6-A-001.json` 是已完成 v1 State。该文件包含：

- 顶层 `tasks`。
- `runtime.blocked` 历史对象。
- 空的验收标准、知识、DAG、验证和 owned files。
- `git-delivery` 完成语义。

M7-A1 不修改、不迁移、不补写该文件及其他历史 v1 State。

### 2.4 知识状态

2026-08-12 在提交 `deb3329` 上执行知识新鲜度检查：

```text
common: stale-or-incomplete
backend: stale-or-incomplete
frontend: stale-or-incomplete
```

本设计已直接核验 Harness 源码。backend/frontend 不属于当前修改范围；common stale 在 M7-C 之前不会自动进入 State 门禁。

## 3. 已确认方案

采用单一 Node 契约校验器：

```text
State JSON
-> Node 版本识别
-> v1 或 v2 契约校验
-> Runtime 命令分发
```

PowerShell 只保留参数处理和 Node 进程调用：

```text
validate-state.ps1
-> node state-contract.mjs validate-file
```

不引入 Ajv 或新的包管理依赖。JSON Schema 继续作为结构声明和外部工具契约；Node 契约模块作为当前 Runtime 的唯一可执行校验实现。

## 4. 范围

### 4.1 本阶段包含

- 新建 E2E State v2 Schema。
- 新建 E2E State v2 模板。
- 新建 E2E v2 工作流。
- 提取单一 Node State 契约模块。
- 按 `schemaVersion` 分发 v1/v2 校验。
- 将 `init` 默认切换为 v2。
- 冻结初始化 Git 基线。
- v1 写命令失败关闭。
- v2 基础 `status/validate/record/next/block/resume/complete`。
- 保持 active pointer 当前结构。
- 更新 State Runner Skill、结构清单和结构 manifest。
- 增加 v1 兼容和 v2 基础语义测试。

### 4.2 本阶段不包含

- 不迁移或修改历史 v1 State。
- 不新增手工迁移命令。
- 不实现统一 phase `result.json` 投影。
- 不实现 criterion、DAG、测试和验证之间的语义追踪。
- 不实现 accepted gap/stale 批准门禁。
- 不实现知识刷新。
- 不实现 delivery receipt。
- 不实现真实 Agent、并行或 Fork-Join。
- 不执行 Git 暂存、提交、推送或 Worktree 操作。

## 5. 文件边界

### 5.1 新增文件

```text
.harness/schemas/e2e-state-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/workflows/e2e-development-v2.yaml
.harness/scripts/lib/state-contract.mjs
docs/harness-m7a1-state-v2/PLAN.md
docs/harness-m7a1-state-v2/REPORT.md（实施后）
```

`state-contract.mjs` 只负责版本识别、结构校验和命令能力判断，不负责文件锁、原子写入、事件恢复或阶段推进。

### 5.2 修改文件

```text
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/run-state.ps1
.harness/scripts/validate-state.ps1
.harness/scripts/tests/state-runtime.test.mjs
.harness/scripts/smoke-harness-flow.ps1
.harness/structure-manifest.yaml
.codex/skills/frontier-state-runner/SKILL.md
.codex/skills/frontier-state-runner/references/phase-model.md
.codex/skills/frontier-state-runner/references/state-update-rules.md
docs/harness-structure-checklist.md
```

### 5.3 不修改文件

```text
.harness/schemas/e2e-state.schema.json
.harness/states/e2e-state.template.json
.harness/workflows/e2e-development.yaml
.harness/states/e2e-M6-A-001.json
.harness/states/e2e-M6-A-001.events.jsonl
```

以上文件继续作为 v1 历史契约和审计证据。

## 6. 版本识别与命令能力

### 6.1 支持的版本

E2E State 首版只接受：

```text
1.0
2.0
```

缺少版本、版本类型错误或未知版本均失败关闭，不尝试猜测。

### 6.2 命令矩阵

| 命令 | v1 | v2 |
| --- | --- | --- |
| `init` | 不创建 v1 | 默认创建 |
| `status` | 允许 | 允许 |
| `validate` | 允许 | 允许 |
| 审计读取 | 通过 `status -Json` | 通过 `status -Json` |
| `record` | 拒绝 | 允许 |
| `next` | 拒绝 | 允许 |
| `block` | 拒绝 | 允许 |
| `resume` | 拒绝 | 允许 |
| `complete` | 拒绝 | 允许 |

不增加独立 `audit` 命令。`status -Json` 已返回完整 State、records 和 logs，足以承担当前审计读取。

命令能力还受文档状态约束：

- `runtime.status=template` 只允许 `status` 和 `validate`。
- `runtime.status=completed` 只允许 `status` 和 `validate`。
- 只有 `active/blocked` v2 State 可以进入与其状态匹配的写命令。
- 命令能力判断必须同时考虑版本、runtime status 和命令，不能只使用单一 `write` 布尔值。

### 6.3 拒绝顺序

写命令执行顺序为：

```text
定位并恢复 State
-> 校验 State
-> 识别版本
-> 检查版本是否允许该命令
-> 获取写锁
-> 重新读取并校验
-> 执行写命令
```

v1 写命令在任何持久化、事件 intent 或 revision 变化前拒绝。

completed v2 的写命令继续使用现有不可变规则拒绝。

template v2 的写命令也必须在获取写锁和写入事件 intent 前拒绝，模板文件保持字节不变。

## 7. State v2 顶层契约

State v2 顶层字段固定为：

```text
schemaVersion
storyId
phase
runtime
baseline
requirement
knowledge
design
dag
implementation
tests
review
build
verification
delivery
approvals
worktrees
logs
```

Schema 使用 `additionalProperties: false`。顶层不包含 `tasks`；混入 v1 顶层字段或未知字段时校验失败。

本阶段模板中的业务结构允许为空，但结构必须存在。A2 和 A3 将逐步增加阶段投影和非空语义门禁。

## 8. State v2 字段设计

### 8.1 身份与阶段

```json
{
  "schemaVersion": "2.0",
  "storyId": "M7-A1-001",
  "phase": "requirement"
}
```

`storyId` 必须匹配：

```text
^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$
```

允许阶段：

```text
requirement
technical-design
task-dag
implementation
unit-test
code-review
build-publish
interface-verification
delivery-preparation
done
blocked
```

### 8.2 Runtime

```json
{
  "runId": "M7-A1-001",
  "workflow": ".harness/workflows/e2e-development-v2.yaml",
  "workflowVersion": "2.0",
  "status": "active",
  "revision": 1,
  "previousPhase": null,
  "activeBlock": null,
  "records": [],
  "createdAt": "2026-08-12T00:00:00.000Z",
  "updatedAt": "2026-08-12T00:00:00.000Z"
}
```

约束：

- `runId` 必须等于 `storyId`。
- `workflow` 必须是仓库内相对路径。
- `workflowVersion` 必须等于工作流文件的 `schema_version`。
- `status` 只允许 `template/active/blocked/completed`。
- 活动 State 的 revision 从 `1` 开始；模板为 `0`。
- 仅 `status=template` 时允许 `createdAt/updatedAt` 和 `baseline.head/branch/capturedAt` 为 `null`。
- `active/blocked/completed` State 的上述字段必须是非空合法值。
- `status=blocked` 时，`phase=blocked` 且 `activeBlock` 非空。
- 非 blocked 状态时 `activeBlock=null`。
- `status=completed` 时 `phase=done`。
- `previousPhase` 记录最近一次阶段来源，不承担阻塞历史。

### 8.3 Active block

```json
{
  "previousPhase": "technical-design",
  "reason": "需要用户确认",
  "owner": "user",
  "suggestedAction": "确认方案",
  "blockedAt": "2026-08-12T00:00:00.000Z"
}
```

`resume` 后：

- phase 恢复为 `activeBlock.previousPhase`。
- status 恢复为 `active`。
- previousPhase 设置为 `blocked`。
- activeBlock 设置为 `null`。
- blocked/resumed 历史只保留在事件日志和 `logs` 中。

### 8.4 Baseline

```json
{
  "head": "40 位小写 Git commit",
  "branch": "dev",
  "initialDirtyPaths": [
    {
      "path": "docs/example.md",
      "indexStatus": "M",
      "worktreeStatus": " ",
      "untracked": false
    }
  ],
  "capturedAt": "2026-08-12T00:00:00.000Z"
}
```

规则：

- `head` 来自 `git rev-parse --verify HEAD`。
- `branch` 来自 `git symbolic-ref --quiet --short HEAD`。
- detached HEAD 失败关闭。
- `initialDirtyPaths` 来自 `git status --porcelain=v1 -z --untracked-files=all`。
- 每个仓库相对路径只出现一次。
- rename/copy 记录目标路径；来源路径不作为当前 dirty path。
- 路径按 ordinal 升序排序，保证同一 Git 状态得到稳定 JSON。
- ignored 文件不进入基线。
- Git 命令失败、路径越界或无法解析的 porcelain 记录使初始化失败。
- 在 status 采集前后分别读取 HEAD 和 branch；前后任一值变化时初始化失败，避免把并发 checkout、commit 或 reset 组合成不存在的一致性快照。

首版保留 index/worktree 两列状态，不保存文件内容或哈希。owned files 推导由 M7-A4 实现。

### 8.5 Requirement

```json
{
  "summary": "",
  "openQuestions": [],
  "acceptanceCriteria": [],
  "inScope": [],
  "outOfScope": []
}
```

`acceptanceCriteria` 在 A1 中允许为空，但其 item 结构固定为：

```json
{
  "criterionId": "AC-001",
  "description": "可验证结果",
  "source": "user",
  "required": true
}
```

唯一 ID 和非空门禁由 M7-A3 启用。

### 8.6 Knowledge

```json
{
  "areas": []
}
```

area item 预留已确认结构：

```text
area
relevant
status
sourceFingerprint
loadedFiles
missing
checkedAt
```

A1 只校验结构；任务相关 freshness 判断和 accepted-stale 由 M7-C 实现。

### 8.7 Design

```json
{
  "decisions": [],
  "affectedAreas": [],
  "risks": []
}
```

### 8.8 DAG

```json
{
  "sourceFile": null,
  "sourceSha256": null,
  "nodes": [],
  "edges": [],
  "waves": [],
  "globalChanges": [],
  "risks": []
}
```

不保留顶层 `tasks`。A1 只建立任务唯一事实入口；DAG 文件投影和 criterion 引用由 A2/A3 实现。

### 8.9 Implementation

```json
{
  "method": null,
  "exceptionReason": null,
  "actualFiles": [],
  "completedTaskIds": [],
  "notes": []
}
```

TDD 例外和任务完成门禁由 M7-A3 实现。

### 8.10 Tests、review、build 与 verification

```json
{
  "tests": {
    "cases": [],
    "commands": [],
    "results": []
  },
  "review": {
    "findings": [],
    "status": "pending"
  },
  "build": {
    "results": [],
    "artifacts": [],
    "externalActions": []
  },
  "verification": {
    "cases": [],
    "results": [],
    "environment": {
      "status": "not-checked",
      "summary": ""
    }
  }
}
```

A1 保留现有 test/review record 写入兼容所需的数组。结构化 case/result 投影由 A2 实现，验收覆盖门禁由 A3 实现。

### 8.11 Delivery

```json
{
  "status": "pending",
  "ownedFiles": [],
  "outOfPredictionFiles": [],
  "unrelatedDirtyFiles": [],
  "remainingRisks": [],
  "summaryFile": null,
  "summarySha256": null,
  "gitStatus": "not-requested"
}
```

`gitStatus` 在 A1 只允许：

```text
not-requested
requested
```

实际 Git 结果不进入 completed State。文件归属和 delivery receipt 由 M7-A4 实现。

### 8.12 Approvals、worktrees 与 logs

```json
{
  "approvals": [],
  "worktrees": [],
  "logs": []
}
```

A1 不启用 gap/stale 或 Worktree 批准语义，只保留后续结构入口。

## 9. State v2 工作流

新增：

```text
.harness/workflows/e2e-development-v2.yaml
```

阶段顺序：

```text
requirement
-> technical-design
-> task-dag
-> implementation
-> unit-test
-> code-review
-> build-publish
-> interface-verification
-> delivery-preparation
-> done
```

阶段 required outputs 首版继续使用现有 Markdown/JSON 路径，最后阶段改为：

```text
.harness/runs/{runId}/phases/08-delivery-preparation/delivery-report.md
```

工作流顶层必须声明：

```yaml
schema_version: "2.0"
state_file: .harness/states/e2e-state-v2.template.json
```

Runtime 读取工作流时校验：

- `state.runtime.workflowVersion` 等于 `schema_version`。
- `state_file` 与当前 State 版本注册的模板一致。
- v2 工作流不得包含 `git-delivery`。
- `delivery-preparation` 必须唯一转移到 `done`。

## 10. 基础命令行为

### 10.1 Init

```text
校验 storyId/summary
-> 检查 active pointer
-> 进入初始化锁
-> 重新检查 active pointer 和目标文件
-> 读取并校验 v2 模板
-> 读取 Git HEAD、branch、dirty paths
-> 构造 v2 State 与 v1 格式 pointer
-> 按既有原子事务顺序持久化
```

Git 基线必须在初始化锁内采集，避免检查 active run 后、写 State 前发生并发初始化。

State 文件名继续使用：

```text
.harness/states/e2e-<storyId>.json
```

不把版本写入文件名，版本由 State 内容判定。

### 10.2 Status 与 validate

- `status` 先恢复可恢复 JSON，再执行版本契约校验。
- `validate` 在结构校验后继续校验工作流版本和当前 phase。
- v1 校验保持历史宽松度，不用 v2 规则反向否定历史 State。
- v2 混入顶层 `tasks`、`runtime.blocked` 或未知字段时失败。
- 显式读取模板允许 `status/validate`，但模板的所有写命令必须零写入拒绝。

### 10.3 Record 与 next

A1 继续支持现有 record 类型和基础质量门禁，以保证 v2 可运行：

```text
output
test
review
approval
note
```

不在本阶段实现 result 投影或 criterion 覆盖。

`next` 根据 State 指向的版本化工作流推进，并继续验证 required outputs。

### 10.4 Block 与 resume

v2 使用 `activeBlock`。v1 写命令已拒绝，因此不再运行旧 `runtime.blocked` 写逻辑。

### 10.5 Complete

v2 只允许从：

```text
phase=delivery-preparation
runtime.status=active
```

进入：

```text
phase=done
runtime.status=completed
```

完成前仍要求该阶段 required output 存在并绑定 evidence，但不要求 Git approval。

这只建立“交付准备完成”的基本语义。owned files 完整性和剩余风险门禁由 M7-A4 实现。

## 11. Active pointer 兼容

`.harness/states/active-run.json` 首版保持现有结构：

```text
schemaVersion
runId
stateFile
status
revision
updatedAt
```

pointer 的 `schemaVersion` 继续表示 pointer 契约版本 `1.0`，不表示目标 State 版本。

Runtime 必须先读取 pointer 指向的 State，再从 State 的 `schemaVersion` 分发契约。pointer 不增加 `stateSchemaVersion`，避免为可推导数据建立第二事实源。

## 12. 单一 Node 契约模块

建议接口：

```javascript
detectStateKind(value)
detectE2EStateVersion(state)
validateStateDocument(value)
validateE2EStateV1(state)
validateE2EStateV2(state)
validateActivePointer(pointer)
assertCommandAllowed(state, command)
```

返回值至少包含：

```text
kind
schemaVersion
capabilities
```

`state-runtime.mjs` 和 validator CLI 复用相同导出。PowerShell 不再复制 E2E 字段、阶段和 enum 规则。

Product State 和 active pointer 也迁入该模块，以真正消除 `validate-state.ps1` 与 Node 的双份校验；本阶段不升级它们的版本。

## 13. 错误处理

以下情况必须零写入并给出稳定错误类别：

- 未知 `schemaVersion`。
- v1/v2 字段混用。
- v1 写命令。
- 非 Git 仓库。
- unborn HEAD。
- detached HEAD。
- 无法解析 Git status。
- workflow 版本与 State 不一致。
- pointer 与 State 身份、revision 或 status 不一致。
- v2 非 blocked 状态存在 activeBlock。
- v2 blocked 状态缺少 activeBlock。
- v2 completed 状态不在 done。
- 非 template v2 的 baseline 或运行时间字段为空。

错误信息应包含失败对象和原因，不包含文件内容、环境变量或敏感配置。

## 14. TDD 与测试设计

### 14.1 v1 兼容

- 已完成 M6-A State 的 SHA-256 在测试前后不变。
- v1 `status` 成功。
- v1 `validate` 成功。
- v1 `record/next/block/resume/complete` 分别失败。
- v1 错误字段仍按 v1 契约报告，不套用 v2 错误。

### 14.2 v2 Schema

- 合法模板通过。
- 顶层 `tasks` 被拒绝。
- `runtime.blocked` 被拒绝。
- 缺少 baseline 被拒绝。
- 未知顶层或 runtime 字段被拒绝。
- 错误版本和混合字段被拒绝。
- activeBlock 与 status/phase 不一致被拒绝。

### 14.3 初始化基线

临时 Git fixture 覆盖：

- clean repository。
- staged 修改。
- unstaged 修改。
- untracked 文件。
- 同一路径同时 staged 和 unstaged。
- rename：只记录目标路径，来源路径不进入 dirty paths。
- copy 的原始 porcelain parser fixture：只记录目标路径；不依赖 Git copy 检测启发式稳定触发。
- dirty paths 稳定排序。
- detached HEAD。
- 非 Git 目录。
- unborn branch。
- Git 命令失败。
- status 采集前后 HEAD 变化。
- status 采集前后 branch 变化。

不在正式仓库制造 dirty fixture。

### 14.4 v2 基础运行

- init 默认生成 v2。
- pointer 仍为 `schemaVersion=1.0`。
- status/validate 成功。
- required output 缺失时 next 零写入。
- block 设置 activeBlock。
- resume 清空 activeBlock 并保留日志。
- delivery-preparation 无 Git approval 可 complete。
- completed v2 不可修改。
- v2 模板 `status/validate` 可读，所有写命令零写入且模板 SHA-256 不变。
- 初始化、pointer promotion 和事件恢复回归通过。

### 14.5 PowerShell 入口

- `validate-state.ps1` 对 v1、v2、Product State 和 active pointer 使用 Node 契约。
- CLI 成功和失败 exit code 保持可脚本消费。
- 中文摘要和路径保持 UTF-8。

## 15. 兼容与回归

### 15.1 必须保持

- active pointer 恢复顺序。
- State `.tmp/.bak` 恢复。
- 事件 intent/committed/aborted 对账。
- State 锁和初始化锁。
- 显式 `-StateFile` 在无关 pointer 损坏时可读。
- Story ID 和仓库路径安全校验。
- completed State 不可变。

### 15.2 允许改变

- `init` 从 v1 改为 v2。
- v1 写命令从可运行改为明确拒绝。
- PowerShell validator 的错误文本可以调整，但错误类别和非零退出语义必须稳定。
- smoke 新建的 Story 变为 v2。

### 15.3 下游 Runtime

M3/M4/M5 测试中若通过 `init` 创建状态，将得到 v2。A1 只调整它们依赖的基础字段和命令兼容，不升级 dispatch/result 协议。

测试 fixture 如果明确验证 v1 历史协议，应直接写入 v1 fixture 并只执行读取命令，不再通过 `init` 创建 v1。

## 16. 验收标准

### AC-A1-01 新 Story 默认 v2

执行 `init` 后：

- State 为 `schemaVersion=2.0`。
- workflow 为 v2。
- pointer 继续使用 pointer Schema 1.0。

### AC-A1-02 v1 只读兼容

M6-A State 可读取和校验，所有写命令拒绝，文件 SHA-256 不变。

### AC-A1-03 版本失败关闭

未知版本、缺失版本、混合字段和错误 workflow 绑定全部失败，State 与 pointer 不变。

### AC-A1-04 任务唯一事实入口

v2 不存在顶层 `tasks`，DAG 节点只存在于 `dag.nodes`。

### AC-A1-05 阻塞语义

v2 block 后 activeBlock 非空；resume 后 activeBlock 为 null，历史可从 logs/events 查询。

### AC-A1-06 Git 基线

初始化 State 准确记录 HEAD、branch 和开始前 dirty paths；非 Git、unborn 或 detached 状态失败关闭。

### AC-A1-07 完成语义

v2 从 delivery-preparation 完成时不要求 Git approval，完成 State 保持不可变。

### AC-A1-08 单一契约

Node Runtime 与 PowerShell validator 对同一 State 给出一致的版本、合法性和错误结论。

## 17. 验证命令

实施完成后至少运行：

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-M6-A-001.json
git diff --check
```

根据回归影响补充：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

## 18. 实施顺序

```text
v1 只读兼容 RED
-> v2 契约 RED
-> 单一 Node 契约模块
-> v2 Schema/模板/工作流
-> init Git baseline
-> Runtime 版本分发
-> v2 block/resume/complete
-> PowerShell 薄 validator
-> smoke 与下游回归
-> 独立只读审核
-> fixture 验收
```

本设计获得用户批准后，才编写详细 `PLAN.md` 并进入代码实施。
