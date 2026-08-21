# FrontierScan Harness M7-M12 迭代开发总体设计

> 日期：2026-08-12
>
> 状态：路线已批准；M7 与 M8-A 已完成，下一阶段为待批准的 M8-B 专项设计
>
> 路线制定基线：`53c1f29 docs(harness): establish target and gap baseline`
>
> 目标基线：`docs/harness-engineering-target-and-gap.md`

## 1. 目标

本设计用于指导 FrontierScan Harness 从当前单业务闭环骨架逐步演进为状态完整、可恢复、可编排、可受控扩展和可评估的研发系统：

```text
结构化知识
-> State 驱动
-> 确定性串行编排
-> 真实受限 Agent
-> 条件式并行
-> 多 Story Fork-Join
-> 本地测试环境闭环
-> 可量化评估
```

总体目标不是一次性实现 M7-M12，而是建立有严格依赖和真实验收门禁的迭代路线。每个技术子里程碑必须先完成专项设计和用户批准，再实施、fixture 验证和审核；每个主里程碑完成前必须通过计划指定的真实 Story 验收。前一主里程碑未通过时，不启动下一主里程碑。

## 2. 当前事实与问题

### 2.1 已验证能力

- M2 已实现单 Story State 的初始化、推进、阻塞、恢复、完成、锁、原子写入和事件审计。
- M3 已实现文件式 `task.json/result.json/checkpoint.json` Dispatcher 和固定 Adapter。
- M4-B 已实现受约束 Mock Worker。
- M5 已实现单 Worktree、串行批次和同 wave 多 Worktree 的计划、执行、集成与回收 Runtime，真实 Git 副作用仅在临时 fixture 中验证。
- M6-A 已使用真实业务完成需求、实现、测试、审核、构建、验证和交付闭环。

### 2.2 M6-A 暴露的问题

- `done/completed` State 中验收标准、知识、DAG、验证和交付等结构化字段为空。
- 关键事实主要保存在 Markdown 和通用 records 中。
- `git-delivery -> done` 被无条件绑定到 Git 操作批准。
- `resume` 后历史阻塞仍保存在类似活动阻塞的字段中。
- required output 与手工 record 可产生重复证据。
- owned files 主要按固定路径前缀判断，不能可靠识别业务文件。
- 知识 stale 能被检测，但不能进入 Story State 和完成门禁。
- 工作流仍由当前 Codex 会话手工串联。

## 3. 已确认架构决策

### 3.1 完成与交付语义

- `done/completed` 表示业务开发与交付准备闭环完成。
- `done/completed` 不表示已经执行 `git add`、`git commit`、`git push`、PR、发布或部署。
- 未请求 Git 操作时，`delivery.gitStatus` 为 `not-requested`，不构成未完成。
- 完成后的 Git 事实写入独立、版本化的 `delivery-receipt.json`，不得修改已完成 State。
- 交付回执只记录和验证已经发生的 Git 事实，不执行 Git 命令。

### 3.2 缺口与 stale 接受

- `accepted-with-known-gaps` 和 `accepted-stale` 必须逐项获得用户明确批准。M7-A3 建立通用 approval 契约并启用 `verification-gap`；M7-C 复用该契约并启用 `knowledge-stale` 业务门禁。
- 批准必须绑定 subject ID、用户身份、理由、证据文件和 SHA-256。
- 未被接受的 gap 或当前任务相关 stale 继续阻塞阶段推进。
- M7-A3 首版只记录 approved receipt；reason 或 subject 变化时，在同一 Story、run、attempt 和 case 内生成新批准并替换当前 result 引用。跨 attempt 或跨 case 不允许复用；拒绝、撤销和通用决策覆盖语义不在 A3 首版范围。

### 3.3 任务事实源

- State v2 不保留顶层 `tasks`。
- `dag.nodes` 是 Story 运行期间的唯一任务事实源。
- 原始 `task-dag.json` 是不可变规划证据，通过路径和 SHA-256 与 State 绑定。
- `dag.nodes[].status` 由确定性 Runtime 更新。
- 未来 attempt、Worker 和 Worktree 细节进入独立 execution ledger，不重新复制完整任务定义。

### 3.4 版本兼容

- 保留现有 State v1 Schema、模板、工作流和历史状态。
- v1 State 仅支持 `status`、`validate` 和审计读取。
- v1 State 的所有写命令失败关闭。
- 已完成 v1 State 不迁移、不补写、不原地升级。
- 新 Story 默认使用 State v2。
- v1 与 v2 使用独立 Schema 和模板；Runtime 根据 `schemaVersion` 分派验证逻辑。
- `active-run.json` 首版保持现有指针结构，通过读取目标 State 判断其版本。

### 3.5 阶段结果

- v2 每个阶段目录都使用统一、版本化的 `result.json`。
- Markdown 继续作为人类可读报告，并作为 result output 绑定。
- State Runtime 不解析自由格式 Markdown。
- result 公共身份字段固定，阶段差异通过带判别的 `payload` 表达。
- `apply` 先校验 result、outputs、引用和 State 投影，再以单次原子事务推进。

### 3.6 TDD 证据

- 业务开发默认记录 `method=tdd`。
- TDD 不适用时记录 `method=exception` 和非空理由。
- 测试与验证用例必须引用其覆盖的验收项。
- 首版不要求保存每一次 RED/GREEN 命令的完整时间序列。

### 3.7 后续范围决策

- M8 首个真实 Provider 是只读 `code-reviewer`。
- M9 仅在 DAG 中至少存在两个无依赖、文件不冲突且无共享全局变化的任务时建议并行。
- 正式 Worktree 操作继续逐次获得用户批准。
- M10 由 Harness 提出 Fork-Join 建议，用户确认后才创建产品级运行和集成分支。
- M11 只实现本地 Docker Compose 测试环境闭环，不接生产和外部业务平台。
- M12 首版使用至少 5 个真实 Story，优先评估可靠性和人工介入。

## 4. 总体架构

```text
AGENTS.md
  -> 任务分类与默认入口
  -> run-e2e.ps1 / e2e-runtime.mjs
      -> State v1/v2 reader
      -> Workflow v1/v2
      -> phase task/action package
      -> deterministic adapters
      -> current Codex or Provider
      -> phase result validator
      -> State projector and semantic gates
      -> immutable event log and receipts
```

职责边界：

| 组件 | 职责 |
| --- | --- |
| State | 当前 Story 的结构化业务和工作流事实 |
| Workflow | 阶段顺序、owner、必需产物和阶段类别 |
| Phase task/action | 当前阶段需要完成的认知或确定性工作 |
| Phase result | 阶段输出、结构化 payload 和证据引用 |
| Runtime | 验证、投影、门禁、状态推进、锁和恢复 |
| Provider | 在最小上下文和权限下完成认知任务 |
| Ledger/receipt | 记录并行、外部副作用和终态后的事实 |
| Markdown | 面向开发人员的解释、报告和决策记录 |

## 5. State v2 契约

### 5.1 顶层结构

State v2 采用以下逻辑结构：

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
acceptance
delivery
approvals
worktrees
logs
```

不包含顶层 `tasks`。

### 5.2 Runtime

`runtime` 至少包含：

```text
runId
workflow
workflowVersion
status
revision
previousPhase
activeBlock
records
createdAt
updatedAt
```

- `activeBlock` 只表示当前阻塞；非阻塞状态必须为 `null`。
- 阻塞历史只保存在 logs 和事件日志中，避免第二份可变历史。
- `records` 是去重后的证据索引，不再承担所有业务语义。

### 5.3 Baseline

初始化时冻结：

```text
head
branch
initialDirtyPaths
capturedAt
```

用途：

- 区分 Story 前已有修改和 Story 产生的修改。
- 计算已提交和未提交的 Story 差异。
- 支持 owned files 推导和交付回执验证。

如果当前目录不是 Git 仓库、HEAD 无法解析或分支状态异常，初始化失败关闭。

### 5.4 Requirement

验收项结构：

```json
{
  "criterionId": "AC-001",
  "description": "可验证的业务结果",
  "source": "user",
  "required": true
}
```

规则：

- `criterionId` 在 Story 内唯一且初始化后不可更名。
- description 非空且必须是可验证结果。
- open questions 未关闭时不能离开 requirement。

### 5.5 Knowledge

`knowledge.areas` 每项包含：

```text
area
relevant
status
sourceFingerprint
loadedFiles
missing
checkedAt
```

状态至少包括：

```text
fresh
stale
missing
accepted-stale
not-relevant
```

仅 `relevant=true` 的 stale/missing 参与门禁。

### 5.6 DAG

`dag` 至少包含：

```text
sourceFile
sourceSha256
nodes
edges
waves
globalChanges
risks
```

节点至少包含：

```text
taskId
title
type
status
ownerAgent
predictedFiles
criterionIds
```

节点状态首版使用：

```text
pending
running
done
blocked
```

### 5.7 Implementation 与 TDD

`implementation` 至少包含：

```text
method
exceptionReason
actualFiles
completedTaskIds
notes
```

- `method` 只允许 `tdd` 或 `exception`。
- `exception` 必须提供理由。
- actual files 必须是仓库相对路径，并与 Git 事实对账。

### 5.8 Tests 与 verification

测试 case 至少包含：

```text
caseId
criterionIds
type
required
command
expected
```

测试 result 至少包含：

```text
caseId
status
actual
evidencePath
evidenceSha256
executedAt
```

验证结果状态：

```text
verified
accepted-with-known-gaps
blocked
failed
```

`accepted-with-known-gaps` 必须引用一个有效的逐项批准记录。

### 5.9 Approvals

批准记录至少包含：

```text
approvalId
subjectType
subjectId
status
actor
reason
evidencePath
evidenceSha256
createdAt
```

`subjectType` 按里程碑启用：

```text
M7-A3: verification-gap
M7-C: knowledge-stale
```

Worktree、Docker、Git、发布和部署继续使用各自既有批准边界，是否进入通用 approval 契约由对应里程碑专项设计决定。State 内只保存完成前需要的业务和风险接受；完成后的 Git 事实进入独立 delivery receipt。

### 5.10 Delivery

交付准备结构至少包含：

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

状态：

```text
pending
ready
blocked
```

`gitStatus` 首版允许：

```text
not-requested
requested
```

实际 Git 结果不写回 completed State。

## 6. State v2 工作流

新工作流：

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

与 v1 的主要差异：

- `git-delivery` 改为 `delivery-preparation`。
- complete 不要求 Git 批准。
- 所有阶段都要求 v2 result 和结构化投影。
- 阶段门禁按验收引用和业务语义执行。

## 7. Phase result v2 契约

### 7.1 公共字段

```json
{
  "schemaVersion": "2.0",
  "dispatchId": "<uuid>",
  "storyId": "<storyId>",
  "runId": "<runId>",
  "phase": "<phase>",
  "preparedRevision": 1,
  "status": "completed",
  "summary": "阶段结论",
  "outputs": [
    {
      "path": ".harness/runs/<runId>/phases/.../report.md",
      "sha256": "sha256:<64 hex>",
      "bytes": 1
    }
  ],
  "records": [],
  "payload": {}
}
```

`status` 允许 `completed`、`failed`、`blocked`。批准需求由 Runtime 根据 payload 和 State 推导，不由 Agent 自行宣称批准已获得。

### 7.2 阶段 payload

| 阶段 | payload 必需内容 |
| --- | --- |
| requirement | acceptanceCriteria、openQuestions、inScope、outOfScope |
| technical-design | decisions、affectedAreas、knowledgeSnapshot、risks |
| task-dag | taskDagFile、taskDagSha256 |
| implementation | taskUpdates、actualFiles、method、exceptionReason |
| unit-test | cases、results、commands |
| code-review | findings、status |
| build-publish | builds、artifacts、externalActions |
| interface-verification | cases、results、environment |
| delivery-preparation | ownedFiles、outOfPredictionFiles、unrelatedDirtyFiles、remainingRisks |

task-dag 的完整节点从已验证的 DAG 文件投影，不在 result 中重复一份完整 DAG。

## 8. 阶段语义门禁

### 8.1 Requirement

- 至少一个 required acceptance criterion。
- criterion ID 唯一。
- open questions 为空。

### 8.2 Technical design

- 每个 relevant knowledge area 有 freshness 结论。
- stale/missing 已刷新或存在逐项批准。
- 风险和全局变化候选已显式记录。

### 8.3 Task DAG

- DAG 通过结构、无环、依赖、wave、路径冲突和 globalChanges 校验。
- 每个 required criterion 至少被一个 DAG node 引用。
- 不允许未知 criterion ID。

### 8.4 Implementation

- 所有 DAG task 进入 done。
- actual files 与 Git 事实一致性由 M7-A4 收口。
- 存在 TDD method 或有效例外理由。

### 8.5 Unit test

- 每个 required criterion 至少由一个 required test case 覆盖。
- 当前最终测试结果不存在 failed。
- evidence 当前哈希与记录一致。

### 8.6 Code review

- 无未解决 BLOCKER。
- WARNING 必须关闭或明确记录为不阻塞且符合当前审核规则。

### 8.7 Build

- 必需构建完成。
- 真实发布没有批准时不得执行，但纯构建可正常推进。

### 8.8 Interface verification

- 每个 required criterion 有最终验证结论。
- blocked 不能伪装为 verified。
- accepted gap 必须逐项引用批准。

### 8.9 Delivery preparation

- owned files、无关 dirty files 和预测外修改均已明确。
- remaining risks 已记录。
- delivery status 为 ready。
- 不要求 commit 或 push。

## 9. 证据、阻塞与恢复

### 9.1 证据幂等

record key 由以下内容构成：

```text
type + phase + semanticSubject + path + sha256
```

相同 key 重复写入不新增记录。相同 path 内容变化时生成新记录，历史保留。

### 9.2 阻塞

- `block` 设置 `activeBlock`。
- `resume` 将 `activeBlock` 清空。
- blocked/resumed 事实进入事件日志和 State logs。
- 历史阻塞不再保存在当前活动字段中。

### 9.3 完成态

- completed State 不可修改。
- 完成态后的外部事实写入独立 receipt。
- receipt 必须绑定 completed State 文件、事件日志摘要、baseline、delivery summary 和 Git 事实。

## 10. 交付回执

建议运行路径：

```text
.harness/runs/<runId>/delivery/delivery-receipt.json
```

回执是本地运行资产，不要求进入产生该 commit 的同一次提交。

回执至少包含：

```text
schemaVersion
storyId
runId
stateFile
stateSha256
deliverySummaryFile
deliverySummarySha256
commit
push
recordedAt
```

- `commit.status` 为 `not-requested` 或 `recorded`。
- `recorded` 时验证 commit 存在、包含预期 owned files，并可选验证 parent/baseline。
- push 仅记录已发生的 remote/ref/commit 对账。
- 回执命令不得执行 Git 写操作。

## 11. M7-B 确定性驱动器

首版入口建议：

```powershell
.\.harness\scripts\run-e2e.ps1 -Command Status
.\.harness\scripts\run-e2e.ps1 -Command Step
.\.harness\scripts\run-e2e.ps1 -Command Apply -ResultFile <result.json>
```

返回动作类别：

```text
deterministic-action
cognitive-action-required
approval-required
blocked
completed
```

M7-B 不调用真实 Agent。认知任务由当前 Codex 会话消费 action package，并生成 v2 result。

## 12. M7-C 知识闭环

流程：

```text
根据需求和设计确定 relevant areas
-> 运行 freshness
-> 投影 State
-> fresh 继续
-> stale/missing 生成最小刷新任务
-> 刷新和重验
-> 或逐项请求 accepted-stale
```

最小刷新单位优先为 module，其次为 area。不得因为一个模块 stale 默认刷新整个仓库。

## 13. M8 Provider

### 13.1 Provider 契约

Provider 输入：

```text
task/action package
context manifest
role policy
timeout
output contract
```

Provider 输出：

```text
candidate files
phase result
diagnostics
usage metadata（可选）
```

Runtime 负责：

- 输入冻结和哈希。
- 上下文和文件限额。
- 路径与 capability 校验。
- result-last。
- 正式 State 和报告写入。

### 13.2 M8-A

首个真实角色为只读 `code-reviewer`：

- 不允许业务文件候选。
- 只允许结构化审核 result 和报告。
- 不提供 Git、发布、网络写入或 State 写能力。
- 通过 `role -> profile -> adapter/model` 配置路由选择执行模型。
- 项目默认配置可提交，本地覆盖被忽略，密钥不得进入配置、State、日志或回执。
- 首版只实现 `codex-cli` Adapter；跨供应商 HTTP Adapter 延后到对应角色确有需求时单独设计。
- `read-only` 只约束写入，不声称同一操作系统用户下存在严格读取 ACL。

### 13.3 M8-B

开发 Provider 只允许：

- 单任务。
- 单个隔离 Worktree。
- 串行执行。
- 修改 predicted files 和角色允许路径。
- 由 Runtime 收集和受控集成。

## 14. M9 条件式并行

并行建议条件必须全部满足：

1. 同一 wave 至少两个 pending 实现任务。
2. 任务之间无依赖边。
3. predicted files 不冲突。
4. 不包含共享入口、数据库、协议或配置全局变化。
5. 每个任务存在可用的真实 Provider。
6. 用户批准本次正式 Worktree 创建。

否则保持串行，不视为降级失败。

## 15. M10 Fork-Join

触发条件：

- 一个请求可以拆成至少两个独立验收 Story。
- Story 之间的共享文件和全局变化已识别。
- Harness 提交拆分建议。
- 用户确认后创建 Product State 和集成分支。

Fork 段每个 Story 独立运行至 code review。Join 段串行完成集成、构建、环境验证和交付准备。

## 16. M11 本地 DevOps

范围仅为仓库现有 Docker Compose：

```text
postgres
redis
backend
frontend
```

`docker compose build`、`up`、`down` 分别在执行时请求批准。Runtime 负责健康等待、迁移结果、API/UI 用例、日志证据和可恢复诊断，不连接生产环境。

## 17. M12 评估

从 M7 开始采集，累计至少 5 个真实 Story 后形成首版报告。

首版指标：

- Story 闭环成功率。
- 阶段失败、重试和恢复次数。
- 不手工编辑 State 的恢复成功率。
- 测试、审核和验证门禁发现的问题数。
- 用户业务决策、风险批准和外部操作批准次数。
- accepted gap/stale 数量和类别。
- 越权操作、伪造验证和无关文件污染次数，目标为零。

首版不强制 Token、费用和耗时统计。自进化在 M12 后单独设计，不能自动修改项目规则。

## 18. 里程碑启动门禁

每个技术子里程碑必须依次满足：

1. 专项 `DESIGN.md` 获得用户批准。
2. `PLAN.md` 完整且无待定决策。
3. 按 TDD 完成 fixture 测试。
4. 相关全量 Harness 回归通过。
5. 独立只读审核无未解决 BLOCKER/WARNING。
6. 目标基线、结构清单、交接文档和知识状态按影响范围同步。

每个对外宣称完成的主里程碑还必须至少通过一次真实 Story 验收。M7 由 M7-D 承担该验收；M8-M11 在各自计划指定的真实任务中验收；M12 使用累计至少 5 个真实 Story 的数据验收。主里程碑未通过真实 Story 验收时，不启动下一主里程碑的实现。

## 19. 明确延期

- 自动 Git 暂存、提交、推送和 PR。
- 无人值守发布与生产部署。
- 云端控制面、多租户和弹性沙箱。
- M12 之前的自动自进化。
- 没有真实数据来源时的 Token/费用统计。
- 没有真实外部平台时的需求、配置和监控平台写入。
