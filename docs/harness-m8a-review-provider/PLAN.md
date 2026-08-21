# FrontierScan Harness M8-A 只读审核 Agent Provider 实施计划

> **供 Agent 式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，按本计划逐项执行。每完成一项立即将对应 `- [ ]` 更新为 `- [x]`，不得在末尾一次性批量勾选。
>
> 日期：2026-08-19
>
> 状态：已完成
>
> 设计依据：`docs/harness-m8a-review-provider/DESIGN.md`
>
> 实施基线：`621cd3b docs(harness): complete M7-D closure acceptance`

**目标：** 在现有 State v2 和确定性串行驱动器上，实现基于本机 `codex exec` 的真实、只读 `code-reviewer` Provider，并建立按 Agent 角色选择 Provider Profile 和模型的配置契约。

**架构：** Provider Runtime 读取并冻结当前 code-review task、角色策略、知识和 task-owned diff，Provider Router 选择 `codex-cli` Profile，Adapter 在隔离目录中启动只读 Codex 子进程。Agent 只返回严格结构化 response，由父 Runtime 执行完整性核对、生成 evidence/report/result，并继续使用现有 Story Runtime apply。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Codex CLI、现有 FrontierScan State/Story/E2E Runtime。

---

## 1. 实施原则

- 所有 Runtime、Schema 和恢复行为按 TDD 执行：先增加可观察失败的 RED，再做最小 GREEN。
- 每完成一个 checkbox 立即更新本文件，保留真实实施进度。
- 不修改 State v2、dispatch result v2 和 Worker 权限的既有业务语义，除非本计划明确列出。
- 不重写现有 Mock Worker；M4/M5 历史协议必须保持兼容。
- M8-A 只允许 `code-reviewer`，其他角色即使配置了 Profile 也不得启动。
- `read-only` 只声明写入边界，不宣称实现了严格文件读取 ACL；execution receipt 使用 `readIsolation=same-os-user-readonly-sandbox`，不得写成操作系统用户隔离。
- 不实现 `openai-compatible`、百炼、开发 Agent、Worktree、并行或自动 Git。
- 不执行真实 Git 提交、推送、PR、发布或部署。
- 真实 `codex exec` 验收只在 fixture、全量回归和独立代码审核通过后进行。
- 计划中的 Git 提交点只表示建议的逻辑交付边界；实际 `git add`、`git commit`、`git push` 必须再次获得用户明确批准。
- 条件步骤不适用时，仍需将 checkbox 勾选为完成，并在实施记录中写明 `not-applicable`、原因和验证证据。

## 2. Task 0：初始化 M8-A 真实 State v2 Story

**目标：** 从实施开始就使用合法 State v2 记录 M8-A 自身开发，使真实 Provider 验收时已经存在可推进到 `code-review` 的 Story。

**运行资产：**

```text
.harness/states/e2e-M8-A-001.json
.harness/runs/M8-A-001/
```

- [x] **0.1 核对活动 State**

运行：

```powershell
Get-Content .\.harness\states\active-run.json -Encoding UTF8
powershell.exe -NoProfile -ExecutionPolicy Bypass `
  -File .\.harness\scripts\run-state.ps1 `
  -Command status `
  -Json
```

预期：

- 现有活动 Story 已完成；不得覆盖未完成 State。
- M8-A DESIGN/PLAN 已通过单独批准完成 Git 交付，或已被安全隔离，不会成为 M8-A-001 的 initial dirty。
- 当前工作区中其他无关 dirty 如实保留，并将在 baseline 中作为 initial dirty，不得被 M8-A 认领。

若 M8-A DESIGN/PLAN 仍为 dirty，停止 Task 0，并请求用户单独批准规划文档的 Git 交付；不得自动提交。

- [x] **0.2 初始化 M8-A-001**

使用现有 State Runtime 创建摘要为“实现真实只读 code-reviewer Agent Provider”的 State v2 Story，冻结当前 HEAD、branch 和初始 dirty paths。

- [x] **0.3 完成 requirement phase**

验收标准至少覆盖：

- 真实 `codex exec` reviewer。
- role/Profile/model 配置。
- State 零污染。
- result-last 恢复。
- 人工与 Provider 审核对比。

通过现有 `run-e2e Prepare/Apply` 生成并应用合法 requirement result。

- [x] **0.4 完成 technical-design phase**

将已批准 `DESIGN.md` 的决策、影响区域、知识快照和风险投影到 State。

- [x] **0.5 完成 task-dag phase**

创建并验证 M8-A task DAG：

- 节点与本 PLAN 的实施任务对应。
- predicted files 覆盖配置、Schema、Runtime、测试和文档。
- 不包含业务源码。
- criterion 引用完整。

- [x] **0.6 推进到 implementation**

运行 State/DAG 校验，确认 State 当前 phase 为 `implementation`，再开始 Task 1 的代码实施。

## 3. 文件结构

### 3.1 新增配置与 Schema

```text
.harness/config/agent-providers.json
.harness/schemas/agent-provider-config.schema.json
.harness/schemas/agent-provider-request.schema.json
.harness/schemas/agent-provider-context.schema.json
.harness/schemas/agent-provider-response.schema.json
.harness/schemas/agent-provider-execution-receipt.schema.json
```

职责：

- `agent-providers.json`：可提交的项目默认 Profile 和角色绑定。
- `agent-provider-config.schema.json`：配置、Profile、Adapter 和模型字段。
- `agent-provider-request.schema.json`：冻结的 Provider 请求身份。
- `agent-provider-context.schema.json`：上下文条目、知识状态和 `reviewTargets`。
- `agent-provider-response.schema.json`：Agent 返回的严格审核数据。
- `agent-provider-execution-receipt.schema.json`：单次真实进程执行结果。

### 3.2 新增 Runtime

```text
.harness/scripts/lib/provider-config.mjs
.harness/scripts/lib/provider-contract.mjs
.harness/scripts/lib/provider-context.mjs
.harness/scripts/lib/provider-runtime.mjs
.harness/scripts/lib/provider-adapters/codex-cli.mjs
.harness/scripts/run-provider.ps1
```

职责：

- `provider-config.mjs`：读取、合并、验证和哈希配置。
- `provider-contract.mjs`：请求、上下文、response 和 receipt 的严格验证。
- `provider-context.mjs`：从 State/task/DAG/知识/diff/测试证据生成冻结上下文。
- `provider-runtime.mjs`：Status、Prepare、Run、Materialize、锁和恢复。
- `codex-cli.mjs`：固定 argv 的真实子进程 Adapter。
- `run-provider.ps1`：PowerShell 薄入口。

### 3.3 新增测试

```text
.harness/scripts/tests/provider-config.test.mjs
.harness/scripts/tests/provider-contract.test.mjs
.harness/scripts/tests/provider-context.test.mjs
.harness/scripts/tests/codex-cli-provider.test.mjs
.harness/scripts/tests/provider-runtime.test.mjs
.harness/scripts/tests/provider-cli.test.ps1
```

### 3.4 修改文件

```text
.gitignore
.harness/structure-manifest.yaml
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/tests/e2e-runtime.test.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/README.md
.harness/README.md
docs/harness-m7-m12-roadmap/DESIGN.md
docs/harness-m7-m12-roadmap/PLAN.md
docs/harness-engineering-target-and-gap.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
```

除上述文件和实施中证明必要的直接依赖外，不修改业务源码。

## 4. Task 1：建立配置契约 RED

**目标：** 先证明当前仓库不能解析角色到 Profile/模型的配置。

**文件：**

- 新建：`.harness/scripts/tests/provider-config.test.mjs`

- [x] **1.1 编写内置默认配置 RED**

测试在不存在项目配置和本地配置时，要求返回：

```json
{
  "defaultProfile": "codex-default",
  "profiles": {
    "codex-default": {
      "adapter": "codex-cli",
      "model": null
    }
  },
  "roleBindings": {}
}
```

验证结果：因 `provider-config.mjs` 尚不存在而失败。

- [x] **1.2 编写项目配置与本地覆盖 RED**

覆盖：

- 项目 `defaultProfile` 覆盖内置值。
- 本地同名 Profile 完整替换项目 Profile。
- 本地角色绑定替换项目角色绑定。
- 单次 `profile` 覆盖优先于本地配置。
- 单次 `model` 只覆盖模型，不改变 Adapter。

验证结果：全部因缺少配置加载器而失败。

- [x] **1.3 编写严格失败 RED**

覆盖：

- 未知顶层字段。
- 未知 Profile 字段。
- 未知角色。
- 悬空 Profile。
- 未实现 Adapter。
- 空模型字符串。
- `executable`、`argv`、`prompt`、环境变量值和 secret 字段注入。
- 本地配置 JSON 损坏。

验证结果：测试必须明确失败，不能静默回退默认值。

- [x] **1.4 运行配置 RED**

运行：

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
```

预期：FAIL，原因是配置模块或预期行为尚未实现，而不是测试语法错误。

## 5. Task 2：实现最小 Provider 配置

**目标：** 只实现当前设计需要的 `codex-cli` Profile 和角色绑定。

**文件：**

- 新建：`.harness/config/agent-providers.json`
- 新建：`.harness/schemas/agent-provider-config.schema.json`
- 新建：`.harness/scripts/lib/provider-config.mjs`
- 修改：`.gitignore`
- 修改：`.harness/structure-manifest.yaml`

- [x] **2.1 新增项目默认配置**

固定内容：

```json
{
  "schemaVersion": "1.0",
  "defaultProfile": "codex-default",
  "profiles": {
    "codex-default": {
      "adapter": "codex-cli",
      "model": null
    }
  },
  "roleBindings": {
    "code-reviewer": "codex-default"
  }
}
```

不填写具体付费模型。

- [x] **2.2 新增严格配置 Schema**

要求：

- `additionalProperties=false`。
- Profile 只允许 `adapter` 和 `model`。
- M8-A Adapter 只允许 `codex-cli`。
- `model` 只允许 `null` 或非空字符串。
- Profile ID 和 role ID 使用稳定安全模式。
- `profiles` 至少包含一个 Profile。

- [x] **2.3 实现确定性配置合并**

实现：

```text
内置默认
-> 项目配置
-> 本地配置
-> 单次 profile/model 覆盖
```

同名 Profile 完整替换，不执行任意深合并。

- [x] **2.4 绑定 Agent 注册表**

读取 `.codex/agents/agents.yaml`：

- `roleBindings` 的角色必须真实存在。
- Profile 不能改变角色 category、capability 或路径策略。
- M8-A 执行许可仍单独固定为 `code-reviewer`。

- [x] **2.5 生成规范化配置哈希**

按稳定键排序生成规范 JSON 和 `sha256:<hex>`，相同有效配置必须得到相同哈希。

- [x] **2.6 忽略本地配置**

在 `.gitignore` 增加：

```text
.harness/config/agent-providers.local.json
```

- [x] **2.7 运行配置 GREEN**

运行：

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
```

预期：PASS。

## 6. Task 3：建立 Provider 数据契约 RED

**目标：** 固定 request、context、response 和单次 execution receipt 的严格边界。

**文件：**

- 新建：`.harness/scripts/tests/provider-contract.test.mjs`

- [x] **3.1 编写 request 严格结构 RED**

覆盖：

```text
providerRequestId
dispatchId
storyId
runId
phase
preparedRevision
role
profile
adapter
requestedModel
modelSource
configSha256
taskFile/taskSha256
policy
contextManifestFile/contextManifestSha256
outputSchemaFile/outputSchemaSha256
promptTemplateVersion/promptTemplateSha256
createdAt
```

错误身份、未知字段、错误 phase 和非 reviewer role 必须失败。`modelSource` 必须在 Prepare 时冻结，Run 和 execution receipt 只能核对并复用；即使显式覆盖模型与 Profile 模型值相同，也必须保留 `runtime-override`。

- [x] **3.2 编写 context manifest RED**

覆盖：

- entries 的路径、SHA-256、bytes、purpose 和 source。
- `reviewTargets` 的 path、SHA-256 和 changeKind。
- 文件路径唯一且大小合计一致。
- finding 可引用路径与普通上下文路径分离。

- [x] **3.3 编写 response RED**

覆盖：

- `severity=BLOCKER|WARNING|INFO`。
- finding 初始状态只允许 `open`。
- `file` 只能为 review target 或 `null`。
- `line` 为正整数或 `null`。
- 使用 `evidenceText` 和 `rationale`。
- 禁止 candidate files、patch、shell、Markdown 文件内容和 State 字段。

- [x] **3.4 编写 execution receipt RED**

execution receipt 绑定：

- request/context/config/prompt。
- Codex 进程、Adapter 和模型元数据。
- raw response。
- 完整性核对和有界 diagnostics。

它不绑定正式 result 哈希；正式 result 也不引用 execution receipt，禁止循环依赖。

- [x] **3.5 运行契约 RED**

运行：

```powershell
node .\.harness\scripts\tests\provider-contract.test.mjs
```

预期：FAIL，原因是 Schema 和契约实现尚不存在。

## 7. Task 4：实现 Provider 数据契约

**目标：** 为后续 Runtime 提供无文件副作用的纯验证层。

**文件：**

- 新建：`.harness/schemas/agent-provider-request.schema.json`
- 新建：`.harness/schemas/agent-provider-context.schema.json`
- 新建：`.harness/schemas/agent-provider-response.schema.json`
- 新建：`.harness/schemas/agent-provider-execution-receipt.schema.json`
- 新建：`.harness/scripts/lib/provider-contract.mjs`
- 修改：`.harness/structure-manifest.yaml`

- [x] **4.1 实现 JSON Schema**

所有 Schema：

- 使用 JSON Schema 2020-12。
- `additionalProperties=false`。
- 对 ID、SHA-256、时间、路径和枚举使用现有项目格式。
- 不复制或放宽 State v2 finding 契约。

- [x] **4.2 实现纯验证函数**

导出独立函数：

```text
validateProviderRequest
validateProviderContext
validateProviderResponse
validateProviderExecutionReceipt
```

验证函数不得读写文件或调用 Git。

- [x] **4.3 实现 response 到正式 finding 的纯映射**

规则：

- Runtime 生成正式稳定 finding ID。
- `evidence` 指向 `<attemptRoot>/evidence/provider-review-response.json`。
- `evidenceText` 和 `rationale` 不进入 State finding。
- INFO 不阻塞，BLOCKER/WARNING 阻塞。

- [x] **4.4 运行契约 GREEN**

运行：

```powershell
node .\.harness\scripts\tests\provider-contract.test.mjs
```

预期：PASS。

## 8. Task 5：建立冻结上下文 RED

**目标：** 证明 Provider 只消费 Runtime 明确装配的有界输入。

**文件：**

- 新建：`.harness/scripts/tests/provider-context.test.mjs`

- [x] **5.1 编写当前 attempt 身份 RED**

只接受：

- State v2。
- 当前 phase 为 `code-review`。
- 当前 task owner 为 `code-reviewer`。
- task dispatch、run、story 和 revision 与 State 一致。
- 正式 result 尚不存在。

- [x] **5.2 编写最小上下文 RED**

要求 manifest 包含：

- task。
- State 最小投影。
- DAG。
- `AGENTS.md`。
- reviewer policy。
- code-review Skill 直接规则。
- State 已绑定知识文件。
- task-owned diff。
- 当前有效测试证据摘要。

- [x] **5.3 编写知识门禁 RED**

覆盖：

- fresh 可加载。
- accepted-stale 可加载但必须标记。
- relevant stale/missing 阻止 Prepare。
- not-relevant 不加载。

- [x] **5.4 编写路径与大小 RED**

覆盖：

- 路径必须命中 reviewer read policy。
- 单文件超过 2 MiB 拒绝。
- 总上下文超过 8 MiB 拒绝。
- 非 UTF-8 拒绝。
- symlink、junction/reparse point、目录和路径逃逸拒绝。

- [x] **5.5 编写 reviewTargets RED**

`reviewTargets` 只来自 Runtime 验证后的 task-owned diff：

- 业务或 Harness 修改文件可以进入。
- State、报告、知识文档和测试证据不能自动成为 finding target。
- 初始无关 dirty 文件不能进入。

- [x] **5.6 运行上下文 RED**

运行：

```powershell
node .\.harness\scripts\tests\provider-context.test.mjs
```

预期：FAIL。

## 9. Task 6：实现冻结上下文

**目标：** 生成可审计 manifest 和可直接内联到 prompt 的固定内容。

**文件：**

- 新建：`.harness/scripts/lib/provider-context.mjs`
- 修改：`.harness/scripts/tests/provider-context.test.mjs`

- [x] **6.1 复用现有路径安全函数**

优先提取或复用 `worker-runtime.mjs` 已验证的：

- 仓库相对路径解析。
- 普通文件和链接检查。
- UTF-8 解码。
- 文件与总量限制。
- role read prefix 匹配。

不复制一套行为不一致的宽松实现。

- [x] **6.2 生成 State 最小投影**

只包含审核需要的：

```text
storyId/runId/phase/revision
acceptance criteria
design decisions
dag source and nodes
implementation actual files
tests cases/results
knowledge areas
```

不把完整 logs、历史 superseded result 或 delivery 数据默认放入上下文。

- [x] **6.3 生成 task-owned diff**

通过固定 Git argv 或现有差异收集能力：

- 绑定 baseline/current HEAD。
- 只包含本 Story actual files 和必要上下文。
- 输出有界文本。
- reviewTargets 与差异文件一一对账。

- [x] **6.4 生成规范 context manifest 候选**

返回待 Prepare 写入的规范对象，目标路径为：

```text
<attemptRoot>/provider/context-manifest.json
```

每项绑定 SHA-256 和 bytes。本任务只构造和验证候选，不写正式文件；正式 request/context 原子写入只由 Task 10 的 Prepare 负责。

- [x] **6.5 生成内联 prompt data**

Runtime 从 manifest 对应冻结内容生成单一有界数据块；Adapter 不自行读取仓库。

- [x] **6.6 运行上下文 GREEN**

运行：

```powershell
node .\.harness\scripts\tests\provider-context.test.mjs
```

预期：PASS。

## 10. Task 7：建立 Codex CLI Adapter RED

**目标：** 用假 `codex` fixture 先验证 argv、stdin、输出和终止边界。

**文件：**

- 新建：`.harness/scripts/tests/codex-cli-provider.test.mjs`

- [x] **7.1 编写 argv 白名单 RED**

必须包含：

```text
exec
--sandbox read-only
--ephemeral
--ignore-user-config
--output-schema <schema>
--json
--skip-git-repo-check
--cd <isolated-provider-root>
```

不得包含：

```text
--config
--profile
--add-dir
--enable
--dangerously-bypass-approvals-and-sandbox
workspace-write
danger-full-access
```

- [x] **7.2 编写模型参数 RED**

- `model=null` 时没有 `--model`。
- 显式模型时只有一个 `--model <id>`。
- 模型字符串不能被解释为额外 argv。

- [x] **7.3 编写 stdin 与隔离目录 RED**

- prompt 通过 stdin。
- `--cd` 不指向仓库根目录。
- 隔离目录位于系统临时区域。
- 不通过 shell 执行。
- output Schema 副本必须与 request 冻结的路径和 SHA-256 一致。

- [x] **7.4 编写 JSONL RED**

覆盖：

- 一个合法 final response。
- 无 final response。
- 多个 final response。
- 非法 JSON。
- 非法 UTF-8。
- stdout/stderr 超限。
- 非零退出码。

- [x] **7.5 编写超时和进程树 RED**

短超时后：

- Abort/终止被触发。
- 子进程树退出。
- 不返回成功 response。

- [x] **7.6 运行 Adapter RED**

运行：

```powershell
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
```

预期：FAIL。

## 11. Task 8：实现 Codex CLI Adapter

**目标：** 实现最小、固定、不可配置 argv 的真实进程边界。

**文件：**

- 新建：`.harness/scripts/lib/provider-adapters/codex-cli.mjs`
- 修改：`.harness/scripts/tests/codex-cli-provider.test.mjs`

- [x] **8.1 实现可执行文件发现**

顺序：

1. 测试注入的绝对 fixture 路径。
2. 当前 PATH 中解析的 `codex`。

不允许项目配置提供 executable，不扫描整个磁盘。

- [x] **8.2 实现固定 argv 构造**

使用 `spawn`/`execFile` argv 数组，不经过 PowerShell、cmd 或 shell 字符串。

- [x] **8.3 实现隔离工作目录**

- 在系统临时目录创建。
- 只放固定占位文件和必要 output Schema 副本。
- 不复制认证信息或仓库。
- 执行完成后按现有临时资源策略回收；异常时允许诊断路径受控保留。
- 调用前冻结隔离目录完整 tree manifest；调用后拒绝任意新增、修改或删除。

- [x] **8.4 实现有界 JSONL 解析**

- 独立限制 stdout/stderr。
- 只接受一个最终结构化 response。
- Adapter 不直接写正式 response、报告或 result。

- [x] **8.5 实现超时终止**

默认 180 秒：

- 先终止。
- 固定宽限期后结束进程树。
- 超时终态必须先于进程终止产生的 `close` 事件冻结，且 Adapter 等待终止完成后再返回。
- 返回可验证的 timeout diagnostics。

- [x] **8.6 记录 Adapter 元数据**

返回：

```text
adapter=codex-cli
adapterVersion
executablePath
requestedModel
reportedModel
startedAt/finishedAt
exitCode
bounded diagnostics
```

不得记录认证内容或完整环境变量。

- [x] **8.7 运行 Adapter GREEN**

运行：

```powershell
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
```

预期：PASS。

## 12. Task 9：建立 Provider Runtime 状态机 RED

**目标：** 固定 Prepare、Run、Materialize 和恢复的唯一派生状态。

**文件：**

- 新建：`.harness/scripts/tests/provider-runtime.test.mjs`

- [x] **9.1 编写状态派生 RED**

覆盖：

```text
无 request -> provider-not-prepared
合法 request、无 execution -> provider-ready
活跃 Run 锁和进程 -> provider-run-in-progress
失败 execution -> provider-failed
成功 execution、无 result -> provider-materialize-required
合法 result -> provider-materialized
request/context/receipt 漂移 -> provider-invalid
```

- [x] **9.2 编写 Prepare RED**

要求：

- 只允许当前 code-review/code-reviewer attempt。
- 写入 request/context 前再次核对 State revision。
- 重复 Prepare 返回 already-prepared。
- 配置或输入漂移不静默覆盖 request。
- Profile/Model 只在 Prepare 解析并冻结。
- output Schema 路径、SHA-256 和 prompt template 哈希写入 request。
- Run/Materialize 不能重新提供或覆盖 Profile/Model。

- [x] **9.3 编写并发锁 RED**

覆盖：

- 两个 Prepare 竞争。
- 两个 Run 竞争。
- Run 与 Materialize 竞争。
- 过期持有者因 lockId 不匹配不能提交。
- 合法 stale lock 恢复。
- parent 已退出但 childPid 对应 Codex 进程仍存活时不得回收锁。

- [x] **9.4 编写失败零污染 RED**

Provider 失败、超时或非法 response 后：

- State/pointer/events 不变。
- 正式 evidence/report/result 不存在。
- execution receipt 和有界诊断可存在。
- 隔离工作目录的新增、修改和删除都会触发完整性失败。

- [x] **9.5 编写执行成功中断 RED**

成功 raw response 和 execution receipt 已写、正式 result 未写时：

- Status 为 `provider-materialize-required`。
- 重试不再次调用模型。

- [x] **9.6 运行 Runtime RED**

运行：

```powershell
node .\.harness\scripts\tests\provider-runtime.test.mjs
```

预期：FAIL。

## 13. Task 10：实现 Prepare、Status 和互斥锁

**目标：** 先完成不调用真实模型的确定性控制面。

**文件：**

- 新建：`.harness/scripts/lib/provider-runtime.mjs`
- 修改：`.harness/scripts/tests/provider-runtime.test.mjs`

- [x] **10.1 实现 Provider Status**

只从 State、task、request、execution receipt、锁和 result 推导，不创建第二份 State。

- [x] **10.2 实现 attempt/request 级锁**

锁文件：

```text
<attemptRoot>/provider/provider.lock
```

包含：

```text
lockId
dispatchId
providerRequestId
command
parentPid
childPid
providerExecutionId
startedAt
timeoutMs
```

- [x] **10.3 实现锁内重新校验**

Prepare、Run、Materialize 在执行实际动作前都重新读取：

- State revision。
- task/request/context 哈希。
- result 是否存在。
- execution 是否已存在或活跃。

- [x] **10.4 实现 Prepare**

原子写入：

```text
provider/request.json
provider/context-manifest.json
```

request 和 context 一旦开始 Run，不允许替换。

同时冻结并绑定：

```text
profile
adapter
requested/resolved model
config SHA-256
output Schema path/SHA-256
prompt template version/SHA-256
```

- [x] **10.5 实现 stale lock 恢复**

分别核对 parentPid 和 childPid。任一仍存活时不回收；两者都不存在且超过最大 Provider 时间窗口才回收，记录恢复诊断并使用 lockId fencing。

- [x] **10.6 运行控制面测试**

运行：

```powershell
node .\.harness\scripts\tests\provider-runtime.test.mjs
```

预期：与 Run/Materialize 无关的 Status、Prepare 和锁测试 PASS，其余仍 RED。

## 14. Task 11：实现 Run 与无写入核对

**目标：** 调用 Adapter，但仍不直接写正式 phase result。

**文件：**

- 修改：`.harness/scripts/lib/provider-runtime.mjs`
- 修改：`.harness/scripts/tests/provider-runtime.test.mjs`

- [x] **11.1 实现调用前完整性快照**

冻结：

- State、pointer、events、task、checkpoint。
- Git HEAD。
- Git porcelain 状态。
- manifest entries。
- 所有当前 tracked/untracked dirty 文件的内容哈希或删除标记。

ignored 非绑定文件明确不在证明范围。

- [x] **11.2 调用 Adapter**

只传：

```text
冻结 prompt
response Schema
resolved model
隔离工作目录
timeout
```

不传任意 argv、仓库路径列表或写权限。

Run 只能消费 request 已冻结的 Profile、模型和 output Schema；CLI 或配置文件中的后续变化不得覆盖它们。

- [x] **11.3 实现调用后完整性核对**

重新核对调用前事实；任一变化生成 `integrity-violation` execution receipt，禁止正式 materialize。

隔离工作目录使用 tree manifest 核对新增、修改和删除；只有父 Runtime 在进程结束后执行的受控回收不属于违规。

- [x] **11.4 写入 execution 证据**

路径：

```text
provider/executions/<providerExecutionId>/
  raw-events.jsonl
  raw-response.json
  diagnostics.json
  execution-receipt.json
```

输出有界、原子写入，失败 execution 不覆盖历史。

- [x] **11.5 禁止自动重试**

失败后返回 `provider-failed`。只有用户或当前会话再次执行 Run 才创建新 execution。

- [x] **11.6 运行 Run GREEN**

运行：

```powershell
node .\.harness\scripts\tests\provider-runtime.test.mjs
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
```

预期：Run、超时、非法输出、完整性和并发测试 PASS。

## 15. Task 12：实现 Materialize、blocked finding 投影与 result-last

**目标：** 将唯一成功 execution 转换为现有 Story Runtime 可 apply 的正式产物。

**文件：**

- 修改：`.harness/scripts/lib/provider-runtime.mjs`
- 修改：`.harness/scripts/tests/provider-runtime.test.mjs`
- 修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/story-runtime.test.mjs`

- [x] **12.1 编写完整 Materialize RED**

在任何 Materialize 实现前覆盖：

- passed 普通审核报告使用当前 `task.expectedOutputs[0]`。
- passed rework 审核报告使用版本化 `task.expectedOutputs[0]`。
- blocked attempt 只写 attempt-scoped response evidence 和 blocked result，不写固定正式报告。
- passed 重审在共享锁内原子替换固定正式报告，允许从历史 blocked 遗留报告恢复。
- 唯一成功 execution 选择，禁止“最新文件”猜测。
- finding 到 State v2 的字段映射。
- BLOCKER/WARNING 生成 blocked result，INFO/无 finding 生成 completed result。
- response evidence/report/result 的 bytes 和 SHA-256。
- evidence 后中断、report 后中断、result rename 前中断。
- 成功 execution 已存在但 result 缺失时为 `provider-materialize-required`。
- 重复 Materialize 幂等，不再次调用模型。
- code-review blocked payload 投影到 State。
- 非 code-review blocked 行为保持不变。

- [x] **12.2 运行 Materialize RED**

运行：

```powershell
node .\.harness\scripts\tests\provider-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：新增 Materialize 和 blocked projection 用例 FAIL，原因是功能尚未实现。

- [x] **12.3 选择唯一成功 execution**

Materialize 必须显式绑定 execution ID，或由 Runtime 证明当前 request 只有一个未 materialize 的成功 execution。不得使用文件时间或“最新文件”猜测。

- [x] **12.4 写正式 response evidence**

固定路径：

```text
<attemptRoot>/evidence/provider-review-response.json
```

内容必须通过 response Schema，路径符合 Story Runtime evidence 边界。

- [x] **12.5 根据 task.expectedOutputs 渲染审核报告**

输出路径只来自当前 task：

```text
<task.expectedOutputs[0]>
```

passed 普通执行通常为 `code-review-report.md`；passed rework 必须使用 Story Runtime 冻结的 `code-review-report.rework-<reworkId>.md`。blocked 不写该固定正式报告。使用 Runtime 模板，不直接采用模型生成的 Markdown。

- [x] **12.6 映射 finding**

生成现有 State v2 finding：

```text
findingId
severity
status
summary
file
line
evidence
```

其中 `evidence` 指向正式 response evidence 文件。

结果状态映射：

- 存在 open BLOCKER 或 WARNING：生成 `status=blocked` 的 dispatch result，同时包含合法 review payload、diagnostics 和 blocker。
- 只有 INFO 或无 finding：生成 `status=completed`、`review.status=passed`。
- Provider execution 自身失败不进入此映射，不生成正式 result。

- [x] **12.7 实现严格 blocked review 投影**

仅当 `phase=code-review` 时，在 `applyBlockedV2()` 同一事务内验证并投影合法 payload，然后进入 blocked；不得放宽其他 phase。

- [x] **12.8 最后写入 result.json**

顺序：

```text
blocked: evidence -> result.json
passed: evidence -> 原子替换 report -> result.json
```

`result.json` 是唯一提交点。

- [x] **12.9 覆盖中断恢复**

复用 12.1 已建立的 RED，在 evidence 和 report 后分别注入中断：

- 不存在合法 result 时不能 apply。
- Status 为 `provider-materialize-required`。
- 再次 Materialize 幂等完成，不再次调用模型。
- execution receipt 继续保持不可变，不新增第二套 materialization receipt。

- [x] **12.10 运行 Materialize GREEN**

运行：

```powershell
node .\.harness\scripts\tests\provider-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：Provider Runtime 全部 PASS，现有 Story Runtime 能验证并 apply 生成的 result。

## 16. Task 13：实现 CLI 与 E2E 动作映射

**目标：** 提供统一 PowerShell 入口，并让新会话得到唯一 Provider 下一动作。

**文件：**

- 新建：`.harness/scripts/run-provider.ps1`
- 新建：`.harness/scripts/tests/provider-cli.test.ps1`
- 修改：`.harness/scripts/lib/e2e-runtime.mjs`
- 修改：`.harness/scripts/tests/e2e-runtime.test.mjs`
- 修改：`.harness/structure-manifest.yaml`

- [x] **13.1 编写 CLI RED**

覆盖：

```text
Status
Prepare
Run
Materialize
```

允许参数：

```text
StateFile
Json
```

`Profile` 和 `Model` 只允许 `Prepare` 使用；`Run`、`Materialize` 和 `Status` 传入时必须拒绝。所有命令拒绝 Adapter、executable、argv、prompt、context path、timeout 扩大和输出路径覆盖。

- [x] **13.2 实现 PowerShell 薄入口**

PowerShell 只做：

- 参数白名单。
- Node 命令映射。
- JSON/文本输出。
- 退出码传播。

不复制 Provider 业务规则。

- [x] **13.3 编写 E2E 映射 RED**

当 Story inspection 为 code-review 的 `awaiting-result` 时：

```text
provider-not-prepared -> provider-prepare-required
provider-ready -> provider-run-required
provider-run-in-progress -> provider-run-in-progress
provider-failed -> provider-retry-decision
provider-materialize-required -> provider-materialize-required
provider-invalid -> provider-invalid
provider-materialized -> apply-result
```

其他 phase 继续返回 `cognitive-action-required`。

- [x] **13.4 实现 E2E 映射**

E2E Runtime 只调用 Provider Status，不复制 request、receipt 或锁验证。

- [x] **13.5 保持 Step 非自动执行**

`run-e2e Step` 对 Provider 动作只返回状态，不自动 Prepare、Run、Materialize 或重试。

- [x] **13.6 运行 CLI/E2E GREEN**

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\provider-cli.test.ps1
node .\.harness\scripts\tests\e2e-runtime.test.mjs
```

预期：PASS。

## 17. Task 14：专项回归和安全测试

**目标：** 证明 M8-A 没有破坏历史 Mock Worker、State 和串行闭环。

- [x] **14.1 运行 Provider 专项**

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
node .\.harness\scripts\tests\provider-contract.test.mjs
node .\.harness\scripts\tests\provider-context.test.mjs
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
node .\.harness\scripts\tests\provider-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\provider-cli.test.ps1
```

- [x] **14.2 运行 M4/M5 Worker 回归**

```powershell
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

- [x] **14.3 运行 M7 核心回归**

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
```

- [x] **14.4 运行结构和 smoke**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

- [x] **14.5 检查安全声明**

运行可复现的禁止范围审计：

```powershell
$providerSources = Get-ChildItem `
  .\.harness\scripts\lib\provider*.mjs, `
  .\.harness\scripts\lib\provider-adapters\*.mjs, `
  .\.harness\scripts\run-provider.ps1

$forbidden = $providerSources | Select-String `
  -Pattern 'openai-compatible|dashscope|apiKey|git\s+(add|commit|push)|workspace-write|danger-full-access'

if ($forbidden) {
  $forbidden
  throw 'Forbidden M8-A capability found.'
}

$processCalls = $providerSources | Select-String -Pattern 'spawn\(|execFile\('
$processCalls
```

第一组预期无命中。第二组命中只能位于固定 `codex-cli` Adapter，并由 argv 白名单测试覆盖。

再人工核对：

- 没有 `openai-compatible` 实现。
- 没有开发角色入口。
- 没有任意 executable/argv。
- 没有 API Key 配置。
- 没有自动重试。
- 没有 State 直接写入。
- 没有 Git、发布或 Worktree 副作用。
- 文档没有把 read-only 描述为严格读取 ACL。

## 18. Task 15：独立只读代码审核

**目标：** 在真实 Provider 调用前关闭 Runtime 和安全问题。

- [x] **15.1 创建充分上下文的独立审核 Agent**

上下文至少包括：

- M8-A DESIGN/PLAN。
- target-and-gap 基线。
- Provider 配置和 Schema。
- Provider Runtime/Adapter/Context。
- State/Story/E2E Runtime。
- Worker policy。
- 专项测试和回归结果。

- [x] **15.2 审核 task-owned diff**

重点：

- 子进程写入边界。
- argv 注入。
- prompt/context 漂移。
- secret 泄漏。
- State/正式结果污染。
- result-last 恢复。
- 并发 Run。
- finding 到 State 契约映射。
- 模型配置不扩大权限。

- [x] **15.3 修复 BLOCKER/WARNING**

每项修复：

1. 增加复现 RED。
2. 实现最小 GREEN。
3. 运行受影响测试。
4. 重新只读复审。

- [x] **15.4 达到审核门禁**

最终独立复审必须：

```text
BLOCKER = 0
WARNING = 0
```

## 19. Task 16：真实 `codex exec` Provider 验收

**目标：** 证明不是 Mock Provider，而是真实 Codex Agent 完成只读审核。

- [x] **16.1 确认真实调用前置条件**

确认：

- 本机 `codex --version` 可执行。
- 当前凭据可用。
- 当前工作区修改范围已冻结。
- Provider 专项、回归和独立代码审核全部通过。
- 用户已批准执行本次真实本机 Agent 调用。

- [x] **16.2 将 M8-A-001 推进到 code-review**

复用 Task 0 初始化的 `M8-A-001`：

1. 根据最终 task-owned diff 生成 implementation result。
2. 将所有 DAG 节点更新为真实最终状态。
3. 记录实际文件、TDD 方法和必要例外。
4. 应用 implementation result。
5. 根据 Task 14 的真实测试证据生成并应用 unit-test result。
6. 确认 State phase 为 `code-review`，当前 task owner 为 `code-reviewer`。

不得使用手工伪造的孤立 task 绕过前置阶段，也不得为了验收故意植入缺陷。

- [x] **16.3 完成人工只读审核**

当前 Codex 会话按 `frontier-code-review-gate` 记录：

- findings。
- 证据。
- 通过或阻塞结论。

- [x] **16.4 Prepare 真实 request**

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Prepare `
  -StateFile <state> `
  -Json
```

核对 request、context、Profile、模型语义和哈希。

- [x] **16.5 Run 真实 Provider**

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Run `
  -StateFile <state> `
  -Json
```

核对真实 `codex exec` execution receipt。

- [x] **16.6 Materialize 并 apply**

如 Status 为 `provider-materialize-required`：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Materialize `
  -StateFile <state> `
  -Json
```

result 就绪后：

```powershell
.\.harness\scripts\run-e2e.ps1 `
  -Command Apply `
  -StateFile <state> `
  -Json
```

- [x] **16.7 对比人工与 Provider 审核**

比较：

- 有效 finding。
- 误报。
- 漏报。
- 文件和行号准确性。
- 证据可复核性。
- 是否符合当前阶段审核范围。

- [x] **16.8 关闭真实 finding**

若 finding 成立：

- 按现有返工规则处理。
- 重新测试。
- 再次人工和 Provider 审核。
- 不允许直接将 Provider finding 标为 resolved。

- [x] **16.9 达到真实验收门禁**

必须证明：

- 真实 Codex 进程确实执行。
- Agent 未修改业务代码、State 或 Git。
- 正式 result 由 Runtime 生成并被 Story Runtime apply。
- 最终无未解决 BLOCKER/WARNING。
- 人工与 Provider 对比报告可审计。

- [x] **16.10 将 M8-A-001 完整收口到 done**

code-review 通过后继续使用现有九阶段工作流：

1. `build-publish`：使用 `no-build-required` 或真实适用的 Harness 构建证据，不执行发布。
2. `interface-verification`：用 Provider CLI fixture、真实 `codex exec` 执行和恢复证据覆盖全部 required criterion；无浏览器业务界面时按 `not-applicable` 规则记录理由，不能伪造 UI 验证。
3. `delivery-preparation`：推导 owned files、预测外修改和无关 dirty，生成合法 manifest/report。
4. `complete`：在未请求 Git 的情况下进入 `done/completed`。
5. 运行 `verify-story-closure.ps1`，确认只读取最终 State 和绑定证据即可回答 M8-A 闭环事实。

M8-A-001 不允许停留在 code-review 后被描述为里程碑完成。

### 16R：自定义 Codex 模型 Provider 阻塞修复

第二次真实执行已经证明超时和完整性修复有效，但固定 `--ignore-user-config` 会隔离用户级 `model_provider`，导致自定义 Provider 凭据被错误用于 OpenAI 官方端点。保留安全隔离边界，并通过受限 Profile 元数据重建必要配置。

- [x] **16R.1 将 401 失败 attempt 正式投影为 blocked**
- [x] **16R.2 为 Provider 元数据、冻结 request、配置漂移和固定 CLI 参数编写 RED**
- [x] **16R.3 实现严格 Schema、确定性配置哈希和 request/receipt 契约**
- [x] **16R.4 实现固定白名单 `-c` 参数和安全 TOML 字符串编码**
- [x] **16R.5 创建不含密钥的本地 Profile 覆盖并完成专项与全量回归**
- [x] **16R.6 完成独立只读复审并关闭本次 BLOCKER**
- [x] **16R.7 恢复 Story，创建新 attempt 并重新执行真实 Provider**
- [x] **16R.8 修复 claim-only 不可判定执行的恢复闭环**

真实 Provider 复审发现：`execution-claim.json` 已提交但 receipt 尚未提交时，父进程崩溃会使
active attempt 永久进入 `provider-invalid`。按 TDD 完成：

- 新增 `provider-execution-indeterminate` 派生状态和 E2E 显式 materialization 动作。
- 禁止对同一冻结 request 自动或手工 `Run`。
- 复用 `Materialize` 生成 Runtime evidence 和 code-review blocked result。
- 不生成 Provider response、execution receipt 或通过报告。
- 覆盖 result-last 中断恢复、幂等、claim 漂移和零 Adapter 调用测试。
- 专项、E2E/Story、结构、State 和差异检查通过，待新真实 Provider attempt 复审。

- [x] **16R.9 修复恢复 response 与冻结 request 的身份绑定**

真实 Provider 复审发现：恢复路径只验证 response Schema 与 receipt 中的 response 哈希，协调修改
`raw-response.json` 身份和 `receipt.responseSha256` 可绕过冻结 request。按 TDD 增加协同篡改
fixture，并在每次磁盘恢复读取时重新对账：

```text
providerRequestId
dispatchId
storyId
runId
phase
role
```

任一漂移返回 `provider-invalid`，不得进入 Materialize。

- [x] **16R.10 修复输出超限终止与分类**

真实 Provider 复审发现：stdout/stderr 超限只触发进程树终止，但没有独立 settle 等待中的 outcome；
若 tracked child 不产生 `close`，会等满 180 秒并误分类为 `timed-out`。按 TDD 完成：

- output-limit 独立完成 outcome，不依赖 `close`。
- 等待 `killProcessTree` 完成后再返回。
- 保持 `invalid-response` 分类和有界诊断。
- 覆盖子进程持续打开、终止函数返回但不发出 `close` 的 fixture。

边界：

- 继续固定 `--ignore-user-config`、`--sandbox read-only`、`--ephemeral`、`--json`、`shell=false`。
- 仅允许 `id`、HTTPS `baseUrl`、`wireApi=responses` 和 boolean `requiresOpenAiAuth`。
- API Key 只来自现有 Codex 登录状态或环境，不进入项目配置、State、日志或回执。
- 不允许任意 `-c` 键、argv、环境变量、可执行文件或 prompt。

## 20. Task 17：文档、知识和里程碑收口

**目标：** 将实现事实同步到长期基线，避免新会话沿用旧状态。

**文件：**

- 新建：`docs/harness-m8a-review-provider/REPORT.md`
- 修改：`docs/harness-engineering-target-and-gap.md`
- 修改：`docs/harness-m7-m12-roadmap/DESIGN.md`
- 修改：`docs/harness-m7-m12-roadmap/PLAN.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`CODEX-CROSS-SESSION-HANDOFF.md`
- 修改：`.harness/README.md`
- 修改：`.harness/scripts/README.md`
- 修改：必要的 `llm-knowledge/common/`
- 修改：`.harness/structure-manifest.yaml`

- [x] **17.1 编写中文 REPORT**

报告必须区分：

- 设计完成。
- fixture 验证。
- 真实 `codex exec` 验收。
- 人工/Provider 审核对比。
- 已关闭问题。
- 剩余边界。

- [x] **17.2 更新长期目标基线**

将“真实 Agent Provider 未接入”更新为 M8-A 当前真实状态，但不得声称：

- 开发 Agent 已接入。
- 跨供应商 Adapter 已实现。
- 严格读取 ACL 已实现。
- M8-B/M9 已启动。

- [x] **17.3 更新路线和结构清单**

同步 M8-A 完成证据和下一步 M8-B 启动门禁。

- [x] **17.4 更新交接文档**

包含：

- Git/State 真实快照。
- Provider 入口。
- 配置文件。
- 模型默认语义。
- 已实现安全边界。
- 明确未实现能力。

- [x] **17.5 检查知识新鲜度**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
```

只刷新 M8-A 实际影响的 common/Harness 知识，保留 `custom/`。

- [x] **17.6 最终全量校验**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

- [x] **17.7 最终独立只读复审**

审核实现、测试、真实验收、REPORT、目标基线和交接的一致性。要求无 BLOCKER/WARNING。

## 21. Task 18：交付准备

**目标：** 明确本次 owned changes 和验证证据，不自动执行 Git。

- [x] **18.1 生成修改清单**

区分：

- M8-A 配置、Schema、Runtime、测试和 CLI。
- 文档和知识同步。
- 本任务开始前已有无关修改。
- 本任务运行生成但不应提交的本地资产。

- [x] **18.2 运行交付摘要**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\summarize-delivery.ps1
```

- [x] **18.3 核对 Git 安全边界**

确认没有：

- `git add .`
- 自动 commit/push。
- 本地 Provider 配置。
- 认证信息。
- 临时执行目录。
- 无关业务文件。

完成态外勘误 `docs/harness-m8a-review-provider/ERRATA.md` 不属于冻结的 37 个 owned
文件；后续 Git 交付时必须将其作为独立更正文件披露。

### 18.4 外部交付批准门禁

只有用户明确要求后，才能分别执行：

```text
git add
git commit
git push
```

该门禁不作为实施者可自行完成的 checkbox，也不阻止 `done/completed`；它只控制完成后的 Git 外部副作用。

## 22. M8-A 完成标准

只有以下项目全部勾选后，才能把 M8-A 标记为完成：

- [x] Provider 配置支持 role -> profile -> adapter/model。
- [x] 未指定模型的隔离 CLI 默认语义准确记录。
- [x] 真实 `codex exec` 只读 reviewer 可执行。
- [x] Agent 不返回 candidate files。
- [x] Runtime 生成 evidence、report、execution receipt 和 result。
- [x] code-review blocked findings 能在同一 State 事务中投影并进入 blocked。
- [x] State/Story Runtime 契约未被 Provider 绕过。
- [x] Prepare/Run/Materialize/Apply 可从磁盘事实恢复。
- [x] 并发 Run 被 attempt/request 锁阻止。
- [x] 失败、超时、非法输出和完整性违规不污染正式结果。
- [x] read-only 没有被错误声明为严格读取 ACL。
- [x] M4/M5/M7 回归通过。
- [x] 独立代码审核无 BLOCKER/WARNING。
- [x] 至少一次真实 Story 或真实 task-owned diff 完成人工/Provider 审核对比。
- [x] M8-A-001 最终进入 done/completed，并通过 closure verifier。
- [x] 目标基线、路线、结构清单、交接和知识状态已同步。
- [x] 用户批准进入 M8-B 之前，不启动开发 Provider 实施。
