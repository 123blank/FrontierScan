# FrontierScan Harness M7-A4 运行时一致性与交付语义设计

> 日期：2026-08-13
>
> 状态：设计完成，已通过独立只读评审，无 BLOCKER/WARNING
>
> 路线基线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：M7-A1、M7-A2、M7-A3 已实施并通过独立只读审核
>
> 实施基线：`cea21a8 feat(harness): implement M7-A3 acceptance gates`

## 1. 目标与防偏移说明

M7-A4 对应长期目标中的“结构化 State 完整性”和“外部副作用边界”，只关闭以下问题：

```text
重复证据
-> 同一语义事实只保留一份正式索引

Git baseline + 当前 Git 事实
-> 推导 Story owned files
-> 区分预测外修改和无关 dirty

completed State
-> 独立 delivery receipt
-> 只记录已经发生的 commit/push
```

本阶段不实现：

- 自动 `git add`、`git commit`、`git push` 或 PR。
- 确定性串行驱动器，属于 M7-B。
- knowledge stale 闭环，属于 M7-C。
- 真实 Agent、正式 Worktree 并行、Docker 或发布。
- completed State 回写 Git 结果。

M7-A1 已经实现 v2 `activeBlock` 在 resume 后清空，历史保存在 logs/events；A4 只增加回归，不重复修改该语义。

## 2. 当前问题

### 2.1 证据身份不统一

State Runtime 手工 `record`、Story Runtime output/evidence 投影和历史兼容路径使用不同去重规则。相同文件、阶段和 SHA-256 可能因为 actor、message 或状态名称不同重复出现。

### 2.2 owned files 仍由调用方声明

`delivery-preparation` payload 当前可以直接声明：

```text
ownedFiles
outOfPredictionFiles
unrelatedDirtyFiles
```

Runtime 只校验数组结构，不与 baseline、Git、DAG 和 implementation 对账。`summarize-delivery.ps1` 仍主要依赖固定路径前缀，因此业务文件和根目录交接文档可能被误报。

### 2.3 completed State 之外没有正式 Git 事实

State v2 正确地允许 `delivery-preparation -> done` 且不要求 Git，但 Git 操作完成后缺少独立、版本化、可验证的交付回执。聊天记录或 Markdown 不能可靠回答：

- 哪个 completed State 被交付。
- commit 是否真实存在。
- commit 是否包含 State 中的 owned files。
- push 的 remote/ref 是否真的指向该 commit。
- commit 中每个文件的内容是否仍是 completed State 验收时冻结的内容。

## 3. 方案比较

### 3.1 owned files

**方案 A：实际修改优先，prediction 只做风险分类（采用）**

- 当前 Git 变化必须相对 baseline 推导。
- owned 只由 `implementation.actualFiles` 决定。
- `dag.nodes[].predictedFiles` 只判断 owned 是否超出预测。
- prediction 不能单独认领 dirty 文件。
- 初始化前 dirty 路径永远不自动归属。

优点：不会因为宽泛 `backend/src/**` 把其他人的修改误归为 Story；业务文件只要进入 `actualFiles` 就能正确归属。

代价：implementation 漏报 actual file 时，交付准备会失败或将文件列为 unrelated，需要修正阶段结果。

**方案 B：prediction 命中即 owned（不采用）**

实现简单，但宽泛目录预测会吸收无关修改，违背安全边界。

**方案 C：只按固定路径前缀（不采用）**

无法识别业务文件，正是 M6-A 暴露的问题。

### 3.2 交付回执

**方案 A：独立只读 Runtime（采用）**

新增 `run-delivery.ps1` 和 `delivery-runtime.mjs`。命令只读取 Git/State/证据并写 append-only 版本化 receipt，不执行 Git 写操作。

**方案 B：回写 completed State（不采用）**

破坏 completed State 不可变语义。

**方案 C：只生成 Markdown（不采用）**

无法机器验证 commit、push 和 State 绑定。

## 4. 模块边界

### 4.1 `record-contract.mjs`

纯函数，负责 v2 record 的语义身份。

不同 record type 使用不同身份：

| 类型 | 语义身份 |
| --- | --- |
| `output` | `type + phase + path + sha256` |
| `test` | `type + phase + status + path/message + sha256` |
| `review` | `type + phase + status + path/message + sha256` |
| `approval` | `type + phase + status + actor + path/message + sha256` |
| `note` | `type + phase + actor + message` |
| `phase-result` | `type + dispatchId + status` |

相同语义身份重复写入不新增 record。内容或结论变化产生新 record，历史保留。

State v1 保持原行为；新语义去重只用于 State v2。

### 4.2 `delivery-contract.mjs`

纯契约模块，负责：

- delivery facts 严格结构。
- owned manifest 严格结构。
- delivery receipt 严格结构。
- 规范 JSON 和 receipt 身份哈希。
- owned/out-of-prediction/unrelated 数组排序和唯一性。

### 4.3 `delivery-runtime.mjs`

负责只读 Git 与文件系统对账：

```text
summarize
prepare-manifest
record
```

`summarize` 不写文件、不修改 State。

`prepare-manifest` 只在 active State v2 的 `delivery-preparation` 阶段运行。它获取 Story 写锁，在锁内重读 State 和 Git 事实，原子写入 owned manifest，但不修改 State、pointer 或 events。

`record` 只写独立 receipt，不修改 State、pointer 或 events，也不执行 Git 写操作。

receipt 使用独立锁串行化；锁内重新读取 State、manifest、既有 receipt 和 Git 事实。

### 4.4 Story Runtime

`delivery-preparation` apply 时：

1. 在 Story 写锁内读取当前 Git。
2. 推导 delivery facts。
3. 校验 payload 声明与推导结果逐字段一致。
4. 校验 summary file 和 SHA-256。
5. 再执行 M7-A3 completion gate。

任一不一致时 State、pointer、events 保持字节不变。

### 4.5 `summarize-delivery.ps1`

保留现有无 State 参数的路径前缀兼容模式。

新增 `-StateFile`：

- 调用 `delivery-runtime summarize`。
- 输出 Runtime 推导的 owned、预测外和 unrelated。
- 不再以固定路径前缀作为事实来源。

## 5. Git 事实模型

### 5.1 身份约束

推导 delivery facts 时要求：

- 当前目录仍是 Git 仓库。
- 当前分支等于 `baseline.branch`。
- `baseline.head` 仍存在。
- `baseline.head` 是当前 HEAD 的祖先或等于当前 HEAD。

发生 rebase、切分支或 baseline 不可达时失败关闭，不猜测归属。

### 5.2 当前净变化集合

```text
trackedNet = git diff --name-status -z --find-renames --find-copies baseline.head --
untrackedNow = git status --porcelain=v1 -z --untracked-files=all 中的 ??
changedRelations = trackedNet + untrackedNow
```

`git diff baseline.head --` 直接比较 baseline tree 与当前工作树，天然折叠 baseline 后已提交、staged 和 unstaged 的组合：

- 已提交 modified 后工作树 deleted：最终为 deleted。
- 已提交 deleted 后当前路径重建：按 baseline 与当前内容得到 modified 或无变化。
- 已提交 rename 后修改 target：最终仍是 rename，target hash 使用当前内容。
- 已提交 added 后工作树删除：相对 baseline 无变化，不进入集合。

每个净变化关系保留：

```text
changeKind
path
sourcePath
```

`changeKind`：

```text
added
modified
deleted
renamed
copied
```

rename/copy 不丢弃 source。untracked 作为 added。路径按仓库相对路径、`/` 分隔和 ordinal 规则排序。

### 5.3 初始 dirty

`baseline.initialDirtyPaths[]` 属于 Story 开始前已有修改。A4 为元素增加可选 `sourcePath`；rename/copy 同时记录 source 和 target。

规则：

- 初始 dirty 路径永远不自动进入 owned。
- 若该路径仍在 changed 集合中，进入 `unrelatedDirtyFiles`。
- rename/copy 的 source 或 target 任一端命中 initial dirty 时，整个关系视为污染。
- 若污染关系任一端出现在 `implementation.actualFiles`，delivery-preparation 失败，要求人工隔离或重新建立干净 baseline。
- 历史 v2 baseline 若状态表示 rename/copy 但缺少 `sourcePath`，推导失败关闭；不能按普通路径降级。

当前 baseline 没有初始 dirty 的内容快照，因此不实现字节级拆分。

### 5.4 Delivery 控制资产

以下路径是控制证据，不属于业务交付 owned/unrelated 分类：

```text
.harness/states/e2e-<storyId>.json
.harness/states/e2e-<storyId>.events.jsonl
.harness/states/active-run.json
.harness/runs/<runId>/**
```

其中包含 task/result/checkpoint、报告、owned manifest、receipt、lock 和临时文件。

规则：

- 控制资产不进入 owned、out-of-prediction 或 unrelated。
- `implementation.actualFiles` 不允许声明控制资产。
- State/events/summary/manifest 分别由 completed State 和 receipt 的独立 SHA-256 绑定。
- manifest 或 receipt 创建后重新推导 delivery facts，结果必须稳定。
- receipt 创建后不得改变 completed State 中冻结的 delivery facts。

### 5.5 业务与文档文件

`implementation.actualFiles` 必须是精确仓库路径，不允许 glob。

规则：

- owned 只来源于 `implementation.actualFiles`，不自动吸收控制资产或 prediction 命中的其他路径。
- 每个 actual file 必须出现在当前净变化集合。
- rename 要求 source 和 target 都进入 `actualFiles`；copy 只要求 target，source 只用于污染与内容来源校验。
- actual file 与 initial dirty 碰撞时失败。
- changed actual file 进入 owned。
- 不在 actualFiles 且不是控制资产的变化进入 unrelated。

### 5.6 prediction

prediction 只支持现有 DAG 规则：

- 精确路径。
- 以 `/**` 结尾的目录范围。

`outOfPredictionFiles` 是 owned 中的业务/文档文件里未被任一 prediction 覆盖的路径。Story 运行资产不参与 prediction 风险。

关系展开规则固定为：

| 关系 | `ownedFiles` | prediction 检查 | 未被认领时的 `unrelatedDirtyFiles` |
| --- | --- | --- | --- |
| added/modified/deleted | `path` | `path` | `path` |
| renamed | `sourcePath`、`path` | 两端分别检查 | 两端 |
| copied | `path` | 只检查 target `path` | 只包含 target |

因此 rename 的任一端预测外都会进入 `outOfPredictionFiles`；copy 的未变化 source 不进入 changed、owned、unrelated 或 extraFiles。

预测外修改如实记录，不自动变为 unrelated，也不自动阻止 `ready`；其风险由 delivery report 和 code review 判断。

## 6. delivery-preparation 契约

payload 新增 owned manifest 绑定：

```text
status
ownedFiles
outOfPredictionFiles
unrelatedDirtyFiles
remainingRisks
summaryFile
summarySha256
ownedManifestFile
ownedManifestSha256
gitStatus
```

新增语义：

- `status=ready` 时 `summaryFile/summarySha256` 必须存在。
- `status=ready` 时 `ownedManifestFile/ownedManifestSha256` 必须存在。
- `ownedFiles/outOfPredictionFiles/unrelatedDirtyFiles` 必须与 Runtime 推导完全一致。
- owned manifest 必须由 Runtime 根据当前 Git 事实生成或验证，不接受 Agent 自由构造。
- `gitStatus` 只表示 Story 完成前是否请求 Git，允许 `not-requested`。
- `unrelatedDirtyFiles` 非空不自动阻止完成，但必须准确披露。
- initial dirty 与 actual file 碰撞始终阻止完成。

owned manifest 路径固定为：

```text
.harness/runs/<runId>/delivery/owned-manifest.json
```

结构：

```text
schemaVersion
storyId
runId
baselineHead
entries[]
generatedAt
```

每个 entry：

```text
path
changeKind
sourcePath
contentSha256
blobOid
mode
```

- added/modified/renamed/copied 的 `contentSha256` 是 delivery-preparation 时工作树目标文件原始字节的 SHA-256，用于 apply 前漂移检测。
- added/modified/renamed/copied 的 `blobOid` 使用只读 `git hash-object --path=<path> <path>` 计算，包含 `.gitattributes`、clean filter 和行尾规范化语义。
- `mode` 是目标 Git tree mode：仅允许普通文件 `100644` 或 `100755`。tracked 路径从 Git raw diff/index 元数据推导；untracked 路径根据 executable bit 推导。
- A4 不接受 symlink、submodule、目录或其他特殊 mode 作为 actual file；遇到 mode `120000`、`160000` 或非普通文件时失败关闭，避免平台相关链接语义扩张。
- deleted 的 `contentSha256/blobOid/mode` 均为 `null`。
- renamed/copied 保留 `sourcePath`；其他类型为 `null`。
- manifest 作为 delivery-preparation result output 绑定，并由 completed State 的 `ownedManifestFile/ownedManifestSha256` 冻结。
- Runtime 在 completion 前重新校验 manifest 内容、State 字段和当前工作树内容。
- manifest 本身是控制资产，不得成为 manifest entry。
- 相同 State/Git 事实重复 `prepare-manifest` 返回 `already-prepared`。
- Git 事实变化后，在 result apply 前可重新生成 candidate manifest；一旦 result 引用该 hash，apply 只接受完全匹配的当前事实。
- manifest 写入中断不留下正式半文件，重试可恢复。

## 7. Delivery Receipt

回执目录固定为：

```text
.harness/runs/<runId>/delivery/receipts/<receiptId>.json
```

回执是 append-only 版本化事实。`receiptId` 由 completed State hash、owned manifest hash、commit facts 和 push facts 的规范 JSON 确定性生成。

Schema 版本 `1.0`，字段：

```text
schemaVersion
receiptId
storyId
runId
stateFile
stateSha256
eventsFile
eventsSha256
baselineHead
deliverySummaryFile
deliverySummarySha256
ownedManifestFile
ownedManifestSha256
commit
push
recordedAt
```

### 7.1 commit

```text
status: not-requested | recorded
sha
parents
filesSinceBaseline
extraFiles
```

`not-requested` 时其他字段为 `null` 或空数组。

`recorded` 时 Runtime 验证：

- commit 是真实 commit object。
- receipt 中 SHA 由 Runtime 获取，不接受缩写。
- baseline 是 commit 的祖先或等于 commit。
- 对 owned manifest 每项验证 commit tree：
  - added/modified/copied：目标 tree entry 的 blob OID 和 mode 等于 manifest 的 `blobOid/mode`。
  - deleted：目标路径在 commit tree 中不存在。
  - renamed：source 在 commit tree 中不存在，target tree entry 的 blob OID 和 mode 等于 manifest。
- commit chain 使用 `git diff --name-status -z --find-renames --find-copies baseline..commit`，复用 delivery tracked net 的关系解析与展开函数。
- `extraFiles` 使用与 delivery facts 相同的关系展开规则；rename 展开 source/target，copy 只展开 target，再减去 `ownedFiles`。
- `parents` 与 Git 实际 parent 列表完全一致。

允许 baseline 到 commit 之间存在多个提交，不强制最终 commit 的直接 parent 等于 baseline。

### 7.2 push

```text
status: not-requested | recorded
remote
ref
commit
```

`recorded` 时显式传入 remote 和完整 ref，Runtime 使用只读 `git ls-remote --refs` 验证该 ref 当前指向 commit。

push 检查可能访问远程；只有用户明确请求记录 push 事实时执行。

远程命令固定：

- `GIT_TERMINAL_PROMPT=0`。
- 默认 30 秒超时，可由测试注入更短值。
- 超时、认证不可用或网络失败如实失败，不生成 receipt。

### 7.3 幂等与恢复

- receipt 使用专用锁和原子 JSON 写入。
- 相同 State/Git 事实得到相同 `receiptId`，重复 `record` 返回 `already-recorded`。
- `not-requested`、commit recorded、push recorded 是不同事实，生成不同 receipt，可按时间顺序并存。
- 同一 receiptId 文件漂移、额外字段或内容不匹配时失败关闭。
- receipt 写入中断不得留下正式半文件；临时文件可在重试时清理。
- 两个不同事实并发 record 时由 receipt 锁串行，不能互相覆盖。

## 8. CLI

准备 manifest：

```powershell
.\.harness\scripts\run-delivery.ps1 `
  -Command PrepareManifest `
  -StateFile .harness/states/e2e-<storyId>.json `
  -Json
```

```powershell
.\.harness\scripts\run-delivery.ps1 `
  -Command Summarize `
  -StateFile .harness/states/e2e-<storyId>.json `
  -Json
```

```powershell
.\.harness\scripts\run-delivery.ps1 `
  -Command Record `
  -StateFile .harness/states/e2e-<storyId>.json
```

记录 commit：

```powershell
.\.harness\scripts\run-delivery.ps1 `
  -Command Record `
  -StateFile .harness/states/e2e-<storyId>.json `
  -Commit <40-hex>
```

记录 push：

```powershell
.\.harness\scripts\run-delivery.ps1 `
  -Command Record `
  -StateFile .harness/states/e2e-<storyId>.json `
  -Commit <40-hex> `
  -Remote origin `
  -Ref refs/heads/dev
```

CLI 不提供执行 Git 写操作的参数。

## 9. 测试策略

### 9.1 record

- 相同 output 的手工/自动记录只保留一个。
- 相同 test/review 状态和证据重复不增加 revision。
- 状态或 SHA-256 变化保留新事实。
- State v1 行为不变。

### 9.2 owned files

- 干净 baseline 后业务 actual file 正确 owned。
- prediction 范围命中。
- 预测外 actual file 进入 out-of-prediction。
- predicted-only dirty 仍 unrelated。
- initial dirty 不进入 owned。
- initial dirty 与 actual 碰撞失败。
- committed、unstaged、staged、untracked、deleted、copy 和 rename fixture。
- staged、unstaged、committed rename 均保留 source/target，任一端 initial dirty 时失败。
- committed+dirty 的四种组合按 baseline 到当前工作树净事实折叠。
- tracked deleted 与同路径 untracked added 按以下规则归并：
  - 当前规范化 `blobOid/mode` 等于 baseline tree entry：无变化。
  - 否则折叠为 modified。
- 覆盖 index 删除后重建和提交删除后重建。
- control asset、manifest 和 receipt 不进入 delivery facts。
- manifest 创建后重新推导 facts 保持不变。
- branch/baseline drift 失败。
- payload 与推导结果不一致时 State 零写入。

### 9.3 receipt

- completed v2 + not-requested receipt。
- not-requested 后再记录 commit 生成第二个版本化 receipt。
- 单提交和多提交 commit chain。
- commit 不存在、baseline 不可达、缺 owned file。
- commit 目标 blob OID 或 mode 与 manifest 不一致。
- deleted/renamed tree 事实不一致。
- push remote/ref/commit 匹配与不匹配。
- push 非交互、超时和认证不可用。
- receipt 重试、中断恢复、内容漂移和严格字段。
- 两个不同 commit receipt 并发竞争。
- receipt 创建后重新推导 completed delivery facts 保持不变。
- completed State、pointer 和 events 字节不变。
- v1 State 拒绝 record receipt，但仍可只读历史状态。

## 10. 验收标准

- 相同语义 evidence 不产生重复 State record。
- Story 前已有 dirty 路径不进入 owned。
- 业务 actual files 能正确进入 owned。
- prediction 不会单独认领无关 dirty。
- delivery-preparation payload 不能伪造 owned/unrelated。
- 无 Git 请求的 Story 可合法进入 done。
- completed State 保持不可变。
- receipt 只能记录真实 commit/push，不能执行 Git。
- receipt 能证明 commit tree 内容与 completed State 冻结的 owned manifest 一致，而不只是路径相同。
- State v1、DAG 1.0 和 M5/Worktree 全量兼容。
