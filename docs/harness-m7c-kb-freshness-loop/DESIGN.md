# M7-C 知识新鲜度闭环设计

> 状态：独立设计审核通过
> 日期：2026-08-14
> 所属路线：`M7-C`

## 1. 背景

M7-A1 至 M7-B 已建立 State v2、统一阶段结果、验收门禁、交付语义和最小确定性串行驱动器。当前知识能力能够：

- 生成 backend、frontend、common 和本地索引知识。
- 使用 source fingerprint 判断区域知识是否 stale。
- 输出刷新建议和 module/area 级命令。
- 在生成时保留 `llm-knowledge/**/custom/`。

但 freshness 仍停留在命令输出中，没有成为 Story State、阶段门禁和串行恢复事实。当前仓库的 backend、frontend、common 均为 `stale-or-incomplete`，因此 M7-C 需要关闭以下差距：

```text
检测 freshness
-> 识别当前 Story 相关区域
-> 生成最小刷新任务
-> 执行刷新并重验
-> 或逐区域批准 accepted-stale
-> 投影 State 并继续工作流
```

## 2. 目标与非目标

### 2.1 目标

1. 让 `technical-design` 的 relevant knowledge area 具有可验证 freshness 结论。
2. 让 freshness、刷新任务、刷新结果和 accepted-stale 批准进入结构化 State。
3. 只让当前 Story 的 relevant area 参与门禁。
4. 优先生成 module 级刷新任务，无法可靠缩小时退回 area 级。
5. 刷新后重新核验 source fingerprint、index manifest 和知识日志。
6. 刷新前后校验 `custom/` 内容哈希，任何漂移均失败关闭。
7. 复用 M7-A3 approval 契约，实现逐 area `knowledge-stale` 批准。
8. 让 `run-e2e` 返回确定性的刷新、批准或认知修正动作。

### 2.2 非目标

- 不新增独立 knowledge workflow phase。
- 不自动调用真实 Agent Provider。
- 不进行 Worktree、并行、Docker、发布或 Git 写操作。
- 不自动接受 stale。
- 不默认全量刷新所有知识。
- 不在 M7-C 完成 M7-D 真实业务验收。
- 不要求 L2 semantic 必须为 fresh；现有 `pending` 仍是允许状态。

## 3. 方案比较

### 3.1 方案 A：嵌入 technical-design attempt

`technical-design` result 继续声明 `affectedAreas` 和 `knowledgeSnapshot`。Runtime 在 apply 前核对 freshness 证据；发现 relevant stale/missing 时，当前 attempt 进入 refresh 或 approval 分支。

优点：

- 复用现有 result、checkpoint、approval 和原子 apply。
- stale 在设计阶段关闭，不污染后续 DAG 和实现判断。
- 不改变九阶段工作流。
- 中断后可从当前 attempt 恢复。

缺点：

- `technical-design` attempt 需要增加少量确定性知识操作。

### 3.2 方案 B：新增 knowledge-refresh 阶段

在 requirement 与 technical-design 之间新增正式阶段。

优点：

- 知识职责在流程图中最显式。

缺点：

- 改变已稳定的九阶段协议。
- relevant areas 尚未由技术设计确定，容易过度刷新。
- 增加所有 Story 的固定流程成本。

### 3.3 方案 C：只在 done 前检查

保持前序阶段不变，在 completion gate 检查知识状态。

优点：

- 修改最少。

缺点：

- 设计和实现可能已经依赖 stale 知识。
- 刷新发生过晚，无法证明前序决策使用了正确上下文。

### 3.4 结论

采用方案 A。它与已批准路线中“根据需求和设计确定 relevant areas”的顺序一致，也是对现有 Runtime 最小且完整的扩展。

## 4. 状态契约

### 4.1 knowledge area

扩展 State v2 `knowledge.areas[]`：

```json
{
  "area": "backend",
  "relevant": true,
  "observedStatus": "fresh",
  "status": "fresh",
  "sourceFingerprint": "sha256:...",
  "loadedFiles": ["llm-knowledge/backend/meta.yaml"],
  "missing": [],
  "checkedAt": "2026-08-14T00:00:00.000Z",
  "freshnessEvidencePath": ".harness/runs/.../knowledge/backend-freshness.json",
  "freshnessEvidenceSha256": "sha256:...",
  "refreshTaskPath": null,
  "refreshTaskSha256": null,
  "refreshReceiptPath": null,
  "refreshReceiptSha256": null,
  "approvalId": null
}
```

`observedStatus` 只表达 freshness 检查事实：

```text
fresh
stale
missing
not-relevant
```

`status` 表达 Story 对观测事实的处理结论：

```text
fresh
stale
missing
accepted-stale
not-relevant
```

约束：

- `relevant=false` 时 `observedStatus` 和 `status` 均为 `not-relevant`。
- `status=fresh` 时 `observedStatus=fresh`，并绑定当前 source fingerprint 和 freshness evidence。
- `status=stale|missing` 时 `observedStatus` 必须相同，并绑定 freshness evidence 和 refresh task。
- `status=accepted-stale` 时 `observedStatus` 必须为 `stale|missing`，并绑定 freshness evidence、refresh task 和正式 approval。
- 通过刷新进入 `fresh` 时必须同时绑定 refresh receipt；初次检查即 fresh 时 refresh task 和 refresh receipt 均为空。
- 每个 area 在 snapshot 中最多出现一次。
- `affectedAreas` 中属于知识区域的项必须在 snapshot 中标记为 relevant。

### 4.2 freshness evidence

每次检查使用 attempt-scoped 不可变 JSON 证据：

```text
.harness/runs/<runId>/phases/01-technical-design/attempts/<dispatchId>/knowledge/checks/<checkId>.json
```

证据至少包含：

```text
schemaVersion
storyId
runId
dispatchId
preparedRevision
area
status
recordedSourceFingerprint
currentSourceFingerprint
baselineStatus
semanticStatus
indexStatus
reason
checkedAt
```

`checkId` 根据 attempt 身份、area、检查输入和检查结果的 canonical hash 确定。已有同 ID 文件必须内容相同，否则失败关闭；新检查不得覆盖旧 evidence。

Runtime apply 时重新读取 result 当前引用的证据并核对哈希、attempt 身份和当前 source fingerprint。历史 evidence 漂移或源文件再次变化时，result 失效。

### 4.3 refresh task

相关 stale/missing area 使用 attempt-scoped refresh task：

```text
.harness/runs/<runId>/phases/01-technical-design/attempts/<dispatchId>/knowledge/tasks/<refreshTaskId>.json
```

任务至少包含：

```text
schemaVersion
storyId
runId
dispatchId
preparedRevision
area
parameters
protectedAreas
reason
sourcePaths
customSnapshots
createdAt
```

`parameters` 包含 `area/module/mode`。`module` 可为空；只有现有检测逻辑能够证明改动完全属于一个有效模块且不存在 rename 时才使用 module 级刷新，否则使用 area 级刷新。

`protectedAreas` 与生成器真实副作用一致：

```text
backend -> [backend]
frontend -> [frontend]
common -> [backend, frontend, common]
```

common 继续使用现有 all-area baseline 命令，因为 common 由全区域索引生成。`customSnapshots` 必须逐项覆盖全部 protected area。

任务不得保存或执行任意 shell 命令字符串。正式执行输入仅允许以下白名单字段：

```text
area: backend | frontend | common
module: 受 Runtime 校验的模块名 | null
mode: baseline | semantic | all
```

人类报告可以展示等价命令，但 Runtime 必须根据结构化字段构造固定 executable 和 argv。

### 4.4 refresh receipt

每次刷新成功后生成 attempt-scoped 不可变回执：

```text
.harness/runs/<runId>/phases/01-technical-design/attempts/<dispatchId>/knowledge/refreshes/<refreshId>.json
```

回执至少绑定：

```text
schemaVersion
storyId
runId
dispatchId
preparedRevision
area
refreshTaskPath
refreshTaskSha256
parameters
protectedAreas
beforeFreshnessEvidencePath
beforeFreshnessEvidenceSha256
afterFreshnessEvidencePath
afterFreshnessEvidenceSha256
beforeCustomSnapshots
afterCustomSnapshots
generatedFiles
indexManifest
logFiles
status
completedAt
```

`refreshId` 根据 attempt 身份、refresh task、before/after evidence、custom snapshot 和产物哈希的 canonical hash 确定。已有同 ID 文件必须内容相同，否则失败关闭；重试生成新的 `refreshId`，不得覆盖旧 receipt。

before/after freshness 均引用 `checks/<checkId>.json` 中的不可变 evidence。`generatedFiles`、`indexManifest` 和 `logFiles` 的每一项同时保存原始路径/哈希与 attempt 内 content-addressed evidence 副本路径/哈希，因此后续合法刷新不会使历史 receipt 失效。`refresh-receipt.json` 是刷新操作的单一提交事实。result 和最终 State 的 knowledge area 同时保存 `refreshReceiptPath` 与 `refreshReceiptSha256`。

所有 evidence、task、receipt 和 artifact evidence 都必须通过规范路径包含关系验证，不能依靠原始字符串前缀判断。读写路径逐级拒绝 symlink、junction、reparse point 和仓库外 realpath。

## 5. Runtime 行为

### 5.1 检查

新增 Node 知识编排模块，复用现有 freshness 与 generate-kb 能力，封装以下确定性能力：

- 以固定 executable 和 argv 调用现有 freshness 检查，并归一化为稳定 camelCase 结构。
- 按指定 relevant areas 生成 freshness evidence。
- 使用现有规则生成最小 refresh task。
- 计算并核对 `custom/` 文件集合与 SHA-256。

PowerShell `check-kb-freshness.ps1` 继续保留默认表格输出和现有 `-Json` 兼容行为。M7-C 不复制其中的 freshness 判定和 module/area 缩小规则。

初次检查使用显式确定性命令：

```powershell
.\.harness\scripts\run-story.ps1 `
  -Command check-knowledge `
  -Area backend
```

该命令要求当前 phase 为已 prepare 的 `technical-design`，在 Story 写锁内为指定 area 生成不可变 freshness evidence 和必要的 refresh task，并返回可直接写入 `knowledgeSnapshot` 的 area 结构。

- result 尚不存在时，命令不写 result，由认知任务组装完整 technical-design result。
- 已存在 completed result 时，命令校验 result 身份后只原子替换指定 area，保留 `loadedFiles` 和其他设计内容，用于 source fingerprint 漂移后的正式恢复。
- 两种模式均不修改 State、pointer 或 events。

多个 relevant area 逐项调用；纯 Harness 或纯文档 Story 可以不调用。

### 5.2 technical-design result

认知任务仍负责确定 `affectedAreas`、`loadedFiles` 和业务风险。freshness 状态、fingerprint、证据哈希、refresh task 和 approval 引用必须来自 Runtime 产物，不允许由认知结果自由声明。

普通顺序：

```text
prepare technical-design
-> Codex 确定 relevant areas
-> Codex 对每个 relevant area 调用 check-knowledge
-> Codex 写设计报告和 result
-> Runtime inspect 复核 freshness
-> fresh: apply
-> stale/missing: knowledge-refresh-required
-> 刷新成功并重写当前 snapshot: apply
-> 或 approve-stale 后: apply
```

### 5.3 刷新

新增 `run-story refresh-knowledge --area <area>`：

1. 获取 Story 写锁并重新读取当前 State、task、result 和 refresh task。
2. 验证 area 为当前 relevant stale/missing area。
3. 根据 protected areas 记录刷新前逐区域 `custom/` snapshot。
4. 在执行生成器前验证 `llm-knowledge`、`index` 和所有 protected area 的真实目录链，再根据 refresh task 的白名单结构化字段构造固定 `generate-kb.ps1` argv；不执行任意 shell 字符串。
5. 重新运行 freshness。
6. 核对 source fingerprint、index manifest、全部 protected area 日志和 `custom/` snapshot。
7. 把生成文件、index 和日志复制为 attempt 内不可变 evidence；仅在全部通过后写入 content-addressed `refresh-receipt.json`。
8. 最后一个提交点仅原子更新 result，使 area 的 `observedStatus/status` 变为 `fresh`，并引用 refresh receipt。
9. 任一步失败时 State 不变；没有有效 refresh receipt 时 result 不得声明 fresh。

知识生成会直接修改 `llm-knowledge/`，因此无法与 result 组成一个跨文件系统事务。中断恢复以磁盘事实为准：

- result 已引用有效 receipt：刷新已提交，可继续 apply，并在 technical-design 投影时把 receipt 引用写入 State。
- receipt 已存在但 result 未引用：重新验证 receipt 绑定的全部事实后，幂等补写 result。
- 知识已改变但 receipt 不存在：重新运行 freshness；满足目标时生成 receipt，否则再次执行刷新。
- 任一不可变 evidence 或 receipt 哈希漂移：旧 receipt 失效，必须重新刷新或重新生成正式回执。
- 后续合法区域刷新只修改 `llm-knowledge/` 工作副本，不会使历史 receipt 的不可变 evidence 失效。

### 5.4 accepted-stale

新增：

```powershell
.\.harness\scripts\run-story.ps1 `
  -Command approve-stale `
  -Area backend `
  -Reason "已通过源码核验，接受本 Story 使用当前 stale 知识"
```

M7-C 先把现有 approval 契约泛化为按 `subjectType` 判别的通用结构，再复用 approval ID、subject hash、receipt 和 Story 写锁规则：

- `subjectType=knowledge-stale`
- `subjectId=<area>`
- phase 必须为 `technical-design`
- subject hash 绑定 task、area snapshot、freshness evidence 和 refresh task
- actor 固定为 `user`
- receipt 写入当前 attempt 的 `approvals/`
- 成功后只更新当前 result 中该 area 的 `approvalId` 和状态
- 不直接修改 State；正式 approval 在 result apply 时投影

证据、reason、result 或 attempt 变化后，不得复用旧批准。

通用 approval 契约必须保留两条互斥分支：

```text
verification-gap
  phase=interface-verification
  subjectId=caseId
  evidence=result evidence

knowledge-stale
  phase=technical-design
  subjectId=area
  evidence=freshness evidence
  subject hash 同时绑定 refresh task
```

Schema、`approval-contract.mjs`、正式 approval State 定义、投影和 completion 校验必须使用相同判别规则。既有 verification-gap receipt 和 M7-A3 测试必须保持通过，不迁移或重写历史 receipt。

`knowledge-stale` subject 使用专用 canonical 结构：

```text
storyId
runId
phase
dispatchId
preparedRevision
area
observedStatus
sourceFingerprint
missing
freshnessEvidencePath
freshnessEvidenceSha256
refreshTaskPath
refreshTaskSha256
```

subject 明确排除会在批准后变化的 `status` 和 `approvalId`。批准前要求 `status` 与 `observedStatus` 均为 `stale|missing`；批准写回 result 后只把 `status` 改为 `accepted-stale` 并设置 `approvalId`，`observedStatus` 及其余 subject 事实保持不变。

## 6. 串行驱动动作

扩展 inspection 和 `run-e2e` 动作：

```text
knowledge-refresh-required
approval-required
cognitive-action-required
apply-result
```

优先级：

1. failed/blocked result。
2. result 结构或身份错误。
3. relevant stale/missing 且没有有效 refresh task：确定性产物修正。
4. relevant stale/missing：`knowledge-refresh-required`。
5. accepted-stale 候选缺批准：`approval-required`。
6. 所有知识门禁通过：`apply-result`。

`Step` 不自动选择“刷新”还是“接受 stale”。刷新通过显式 `refresh-knowledge` 执行；accepted-stale 必须由用户批准命令产生。串行驱动不得自行生成用户批准。

## 7. 门禁

technical-design apply 前必须满足：

- relevant areas 允许为空，但不得重复。
- 只有 `affectedAreas` 映射到 backend、frontend 或 common 时，才要求对应 knowledge area 标记为 relevant。
- 每个 relevant area 状态为 `fresh` 或 `accepted-stale`。
- fresh evidence 与当前 source fingerprint、index 和日志一致。
- 通过刷新得到 fresh 时，refresh receipt 路径和哈希必须投影到 State。
- accepted-stale 具有当前 attempt 的正式 approval。
- stale/missing 不能直接推进。
- not-relevant area 不参与阻塞。
- evidence、refresh task、approval 或 custom snapshot 漂移时失败关闭。

completion gate 再次检查 State 中所有 relevant area 仍为 `fresh` 或 `accepted-stale`，并重新核对 technical-design 保存的 freshness evidence、refresh task、refresh receipt 和 approval receipt 路径与 SHA-256。它不重新计算当前源码 freshness，也不重新定义技术设计阶段的 source fingerprint 时点；后续业务实现产生的源码变化不会把已通过的设计知识自动判为 stale，这些修改将在 Story 完成后的知识刷新或后续 Story 中处理。

## 8. 错误与恢复

- freshness 检测失败：保持当前 attempt，返回 `result-invalid` 或明确知识错误。
- generate-kb 失败：State 不变，result 仍为 stale/missing。
- refresh 后仍 stale：不更新为 fresh，允许修复后重试或请求 accepted-stale。
- `custom/` 漂移：失败关闭，不自动还原文件。
- 中断发生在知识文件生成后、receipt 写入前：重新检查磁盘事实，满足目标后生成 receipt，否则重试刷新。
- 中断发生在 receipt 写入后、result 更新前：验证 receipt 后幂等补写 result 引用。
- 中断发生在 approval receipt 写入后、result 更新前：复用现有幂等恢复规则。
- completed State 不允许 refresh 或 approve-stale 写入。

## 9. 测试策略

按 TDD 实施：

1. freshness Node Runtime 的状态归一化、relevant area 过滤和最小任务推导 RED。
2. State/dispatch/approval Schema RED。
3. technical-design inspect/apply 门禁 RED。
4. refresh 成功、失败、重验失败、custom 漂移和中断恢复 RED。
5. approve-stale 幂等、证据漂移、跨 attempt 和并发 RED。
6. verification-gap 与 knowledge-stale 的判别式 approval 契约兼容 RED。
7. completion 历史知识 evidence/receipt 漂移 RED。
8. `run-e2e` 动作映射 RED。
9. v1 只读兼容和九阶段 v2 回归。

## 10. 验收标准

- freshness findings 能以稳定 JSON 获取并进入 State。
- 非 relevant area stale 不阻塞 technical-design。
- relevant stale/missing 不能在无刷新或批准时推进。
- Runtime 生成的刷新任务为可证明的最小 module/area 范围。
- refresh 后必须通过 fingerprint、index、log 和 custom 完整性重验。
- refresh receipt 成为唯一提交事实，中断可按磁盘证据幂等恢复。
- accepted-stale 按 area 生成用户 approval receipt，并在 State 中可审计。
- 既有 verification-gap approval 行为和历史 receipt 保持兼容。
- 重复操作幂等，证据漂移失败关闭。
- v1 State 内容不变且继续只读兼容。
- 不执行 Git、Worktree、Docker、发布或真实 Agent 调度。
