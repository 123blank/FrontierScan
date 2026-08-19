# FrontierScan Harness M8-A 只读审核 Agent Provider 设计

> 日期：2026-08-19
>
> 状态：设计已获用户批准；计划评审补充约束已通过独立复审，无 BLOCKER/WARNING
>
> 路线基线：`docs/harness-engineering-target-and-gap.md`
>
> 总体路线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：M7 已完成 fixture 与真实 Story 双重闭环验收
>
> 实施基线：`621cd3b docs(harness): complete M7-D closure acceptance`

## 1. 目标与防偏移说明

M8-A 对应长期目标中的“真实受限 Agent Provider”和“程序在需要认知时调用 AI”。本阶段在现有 State v2、Story Runtime、E2E 串行驱动器和 Worker 权限策略之上，接入第一个真实、非交互、只读的 `code-reviewer` Provider：

```text
E2E Runtime 判定 code-review 需要认知执行
-> Runtime 冻结 task、context manifest、role policy 和 Provider 配置
-> Provider Router 选择 code-reviewer 绑定的 Profile
-> Codex CLI Adapter 启动只读 codex exec
-> Agent 返回严格结构化 review response
-> Runtime 校验身份、权限、内容、文件系统和 Git 不变性
-> Runtime 生成正式审核报告与 phase result
-> 现有 Story Runtime apply 并投影 State
```

本阶段同时建立“角色 -> Provider Profile -> Adapter -> 模型”的配置契约，使后续角色可以选择不同模型，而不把模型选择硬编码进 Agent 角色、State 或阶段协议。

M8-A 不实现：

- `backend-developer`、`frontend-developer` 或其他写入型 Agent。
- Agent 生成或修改 candidate business files。
- `openai-compatible`、阿里百炼或其他外部 HTTP Adapter 的真实调用。
- Worktree、并行、Fork-Join 或多 Agent 协商。
- 自动 Git、PR、发布、部署或外部系统写入。
- 自动修复审核 finding。
- 将聊天记录作为 Provider 输入或恢复事实。

跨供应商 Adapter 接口在本设计中固定，但首版只注册并执行 `codex-cli`。当需求分析或业务设计 Agent 真正进入实施里程碑时，再实现并单独验收 `openai-compatible` Adapter。

## 2. 当前问题

### 2.1 认知任务仍由当前会话手工完成

M7-B 已能根据 State 返回唯一下一动作，但在 `cognitive-action-required` 时仍由当前 Codex 会话读取上下文、执行审核并手工生成阶段产物。新会话可以恢复流程，却不能由 Runtime 可重复地启动真实 Agent。

### 2.2 Mock Worker 不是正式 Provider

`.harness/scripts/lib/worker-runtime.mjs` 已具备角色策略、上下文限制、超时、结果校验和 result-last 写入，但当前 `provider` 是同进程函数注入。它用于验证协议和恢复边界，不能证明真实 Codex 进程已经受限执行。

### 2.3 旧 Worker 响应允许 candidate files

现有 Worker Provider 返回：

```text
files
result
```

这适合未来受限开发 Agent，但不适合 M8-A 只读审核。即使 candidate 仅声明为 `phase-output`，Agent 仍能直接决定正式报告文件内容和路径。M8-A 必须让 Agent 只返回结构化审核结论，由 Runtime 生成并写入正式文件。

### 2.4 模型与 Provider 尚无配置契约

角色注册表只描述职责和权限，没有定义：

- 角色使用哪个 Provider。
- Provider 使用哪个 Adapter。
- Adapter 使用哪个模型。
- 项目默认配置与用户本地覆盖如何合并。
- 未指定模型时的准确语义。

如果直接在 `code-reviewer` 实现中硬编码模型，后续业务设计、开发和测试角色会重复修改 Runtime。

## 3. 方案比较

### 3.1 真实 Provider 入口

**方案 A：本机 `codex exec` 子进程（采用）**

- 复用本机 Codex 登录态。
- 使用固定 argv、只读 sandbox、临时会话和严格输出 Schema。
- 不引入 SDK、项目 API Key 或工具循环。
- 与现有 Node.js Runtime 容易组合。

**方案 B：直接调用 Responses API（不采用）**

- 结构化输出能力完整。
- 需要新增认证、网络、模型配置、请求重试和工具循环，超过 M8-A 最小范围。

**方案 C：依赖当前客户端原生 Subagent（不采用）**

- 适合当前交互式会话中的临时协作。
- 仓库 Runtime 无法稳定、可重复地调用会话专属工具，不能形成正式 Provider 协议。

### 3.2 模型路由

**方案 A：角色绑定 Provider Profile（采用）**

```text
roleBindings.code-reviewer
-> profile
-> adapter + model
```

权限继续来自 `worker-policies.json`，Provider Profile 只决定执行渠道和模型。

**方案 B：在 Agent 注册表直接增加 model（不采用）**

把职责、权限和供应商配置耦合在一起，不利于本地覆盖和 Adapter 替换。

**方案 C：每次运行只传模型字符串（不采用）**

无法表达 Adapter、认证引用和项目默认值，也不能稳定审计配置来源。

### 3.3 只读响应

**方案 A：Agent 返回纯结构化 response，Runtime 生成正式产物（采用）**

Agent 不返回文件候选，不知道正式 result 的写入权限。Runtime 根据已验证 response 生成 Markdown、evidence 和 phase result。

**方案 B：复用旧 `files + result`（不采用）**

实现较少，但削弱“Agent 不直接写正式结果”的边界。

## 4. 总体架构

新增逻辑分为五个独立单元：

```text
Provider Config
-> 读取、合并并严格校验配置

Provider Router
-> 根据 role 和显式覆盖选择 Profile

Context Builder
-> 从 task、State、DAG、知识快照和 task-owned diff 生成冻结 manifest

Codex CLI Adapter
-> 使用固定 argv 启动只读 codex exec

Review Materializer
-> 校验 response 后生成正式 report、evidence 和 phase result
```

建议实施文件边界：

```text
.harness/config/agent-providers.json
.harness/schemas/agent-provider-config.schema.json
.harness/schemas/agent-provider-request.schema.json
.harness/schemas/agent-provider-response.schema.json
.harness/schemas/agent-provider-execution-receipt.schema.json
.harness/scripts/lib/provider-config.mjs
.harness/scripts/lib/provider-contract.mjs
.harness/scripts/lib/provider-runtime.mjs
.harness/scripts/lib/provider-adapters/codex-cli.mjs
.harness/scripts/run-provider.ps1
.harness/scripts/tests/provider-config.test.mjs
.harness/scripts/tests/provider-runtime.test.mjs
.harness/scripts/tests/provider-cli.test.ps1
```

不在 M8-A 中拆分或重写现有 `worker-runtime.mjs`。Provider Runtime 复用其路径、文件大小、角色策略和超时原则，但使用独立的只读响应契约。M8-B 再决定如何让真实开发 Provider 与旧 Worker candidate 协议汇合。

## 5. Provider 配置

### 5.1 文件

项目配置：

```text
.harness/config/agent-providers.json
```

用户本地覆盖：

```text
.harness/config/agent-providers.local.json
```

规则：

- 项目配置可提交。
- 本地配置加入 `.gitignore`，不得进入交付文件。
- 配置中不得保存 API Key、Token、Cookie 或认证文件内容。
- M8-A 配置不得提供 executable、任意 argv、prompt、环境变量值或 shell 片段。

### 5.2 结构

项目默认配置：

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

字段语义：

- `defaultProfile`：角色没有显式绑定时的 Profile。
- `profiles.*.adapter`：M8-A 只允许 `codex-cli`。
- `profiles.*.model`：`null` 或非空模型标识。
- `roleBindings`：键必须来自 `.codex/agents/agents.yaml`，值必须引用已定义 Profile。

正式配置不硬编码具体付费模型。用户需要固定模型时，在项目配置、本地配置或单次执行覆盖中明确填写。

### 5.3 合并与优先级

优先级：

```text
单次 Runtime 显式覆盖
-> agent-providers.local.json
-> agent-providers.json
-> 内置 codex-default
```

合并规则不是任意深合并：

- 顶层只允许 `schemaVersion`、`defaultProfile`、`profiles`、`roleBindings`。
- 本地 `profiles.<name>` 替换同名完整 Profile，不做字段级拼接。
- 本地 `roleBindings.<role>` 替换同名角色绑定。
- 显式覆盖只允许 `profile` 或 `model`，不能覆盖 Adapter、权限、路径、超时或 argv。
- 任一层出现未知字段、悬空 Profile、未知角色或不支持 Adapter，整体失败关闭。
- 合并结果规范化后计算 SHA-256，写入 Provider request 和 receipt。

### 5.4 未指定模型的准确语义

`model=null` 表示 Runtime 不向 `codex exec` 传递 `--model`。

由于 M8-A 使用 `--ignore-user-config`，该语义是：

> 使用本次隔离 `codex exec` 的有效默认模型，不保证等于父 Codex 客户端会话临时选择的模型。

仓库 Runtime 无法可靠读取父会话临时模型。需要严格固定或复现时，用户必须通过本地配置或单次执行覆盖显式指定模型。

执行元数据必须区分：

```text
requestedModel
resolvedModel
reportedModel
modelSource
```

- `requestedModel`：配置或单次覆盖中的值，可为 `null`。
- `resolvedModel`：Runtime 传给 Adapter 的值，可为 `null`。
- `reportedModel`：Adapter 能从真实执行事件确认时记录，否则为 `null`。
- `modelSource`：`runtime-override`、`local-config`、`project-config` 或 `builtin-default`。

不得在无法确认时伪造 `reportedModel`。

## 6. Provider Request 与冻结上下文

### 6.1 Request

Runtime 在调用 Adapter 前生成不可变 request：

```text
schemaVersion
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
configSha256
taskFile
taskSha256
policy
contextManifest
outputContract
outputSchemaFile
outputSchemaSha256
createdAt
```

约束：

- `phase` 必须为 `code-review`。
- `role` 必须为 `code-reviewer`。
- task 必须是 State v2 当前有效 attempt。
- `preparedRevision` 必须等于当前 State revision。
- response output Schema 的路径和 SHA-256 必须在 Prepare 时冻结；Run 只使用 request 已绑定的 Schema。
- request 写入 attempt 的 Provider 子目录，使用原子写入。
- 相同 dispatch 和配置重复准备时返回同一身份；输入变化生成新 request，不覆盖旧执行证据。

建议路径：

```text
.harness/runs/<runId>/phases/05-code-review/attempts/<dispatchId>/provider/request.json
```

### 6.2 Context Manifest

上下文由 Runtime 构造。manifest 是可审计的输入契约和 prompt 内容来源，不是操作系统级文件读取 ACL。`codex exec --sandbox read-only` 能约束写入，但不能证明子进程无法读取当前用户有权访问的其他文件。

M8-A 采用以下最小化措施：

- Adapter 不以仓库根目录作为工作目录，而是在系统临时目录创建只包含固定说明和无敏感数据占位文件的隔离工作目录。
- 使用 `--skip-git-repo-check`，Provider 不依赖自行打开 Git 仓库。
- manifest 中冻结的文本内容由 Runtime 按总量限制直接装配进 stdin prompt。
- prompt 明确禁止搜索、打开或引用 manifest 之外的路径。
- 正式 receipt 如实声明 `readIsolation=os-user-boundary`，不得描述为严格 manifest ACL。

这能减少意外读取和上下文漂移，但不是强对抗读取隔离。若未来要求严格证明 Agent 只能读取白名单文件，必须单独引入不同操作系统身份、容器或等价的进程级文件系统沙箱，不在 M8-A 中虚构该能力。

manifest 至少包含：

```text
schemaVersion
storyId
runId
dispatchId
role
entries[]
totalBytes
createdAt
```

每个 entry：

```text
path
sha256
bytes
purpose
source
```

允许的 `source`：

```text
task
state
dag
knowledge
policy
diff
test-evidence
project-rule
```

manifest 另有独立 `reviewTargets[]`，只列出允许作为 finding `file` 的业务或 Harness 源文件：

```text
path
sha256
changeKind
```

`reviewTargets` 不能从报告、State、DAG 或知识文档路径自动推导，必须来自 Runtime 验证后的 task-owned diff。Provider finding 的 `file` 只能为 `reviewTargets[].path` 或 `null`。

首版上下文只包含当前审核所需最小集合：

1. 当前 `task.json`。
2. 当前 State 的只读冻结副本或最小投影。
3. 当前 DAG 文件。
4. `AGENTS.md`。
5. `code-reviewer` 角色策略。
6. `frontier-code-review-gate` 的直接规则文件。
7. State 中 `knowledge.loadedFiles` 对应、且通过当前 freshness 结论的相关知识。
8. task-owned diff 或 Runtime 生成的 bounded diff context。
9. 当前有效测试结果和必要证据摘要。

不默认加载：

- 全仓库源码。
- 无关历史 Story。
- 聊天记录。
- API Key、`.env`、认证配置或用户级 Codex 配置。
- `node_modules`、构建产物和大型日志。

继续沿用：

- 单文件最大 2 MiB。
- 总上下文最大 8 MiB。
- UTF-8 普通文件。
- 禁止 symlink、junction/reparse point 和仓库路径逃逸。
- 路径必须命中 `code-reviewer.readPathPrefixes`。

### 6.3 知识新鲜度

Provider 不自行判断知识是否 fresh。Context Builder 只接受 State 已记录的知识结论：

- `fresh`：可加载 State 绑定的知识文件。
- `accepted-stale`：可加载，但 request 和 prompt 必须明确标记为已接受过期，不得描述为 fresh。
- `stale` 或 `missing`：若仍是当前相关区域，Provider 调用失败关闭并交回现有知识门禁。
- `not-relevant`：不加载。

Provider receipt 记录知识区域状态和已加载文件哈希，不能只记录文件名。

## 7. Code Reviewer Response

### 7.1 Agent 只返回数据

Provider response 不包含文件：

```json
{
  "schemaVersion": "1.0",
  "providerRequestId": "<uuid>",
  "dispatchId": "<uuid>",
  "storyId": "<storyId>",
  "runId": "<runId>",
  "phase": "code-review",
  "role": "code-reviewer",
  "status": "completed",
  "summary": "审核结论",
  "findings": [],
  "diagnostics": [],
  "usage": {
    "reportedModel": null,
    "inputTokens": null,
    "outputTokens": null
  }
}
```

每个 finding：

```text
findingId
severity
status
summary
file
line
evidenceText
rationale
```

约束：

- `severity` 只允许 `BLOCKER`、`WARNING`、`INFO`，与现有 State v2 finding 契约一致。
- 新 Provider finding 的初始 `status` 只允许 `open`。
- `file` 必须是 `contextManifest.reviewTargets[].path` 或 `null`。
- `line` 为正整数或 `null`。
- `evidenceText` 必须描述可复核的当前代码事实。
- `rationale` 解释为什么该事实影响当前正确性、安全性、回归风险或必要测试。
- `status=completed` 时必须提供 `summary` 和 `findings`。
- `status=failed` 时 findings 必须为空并提供 diagnostics。
- response 禁止 Markdown 文件内容、candidate files、shell、补丁或 State 字段。
- Schema 使用 `additionalProperties=false`。

### 7.2 Finding ID

`findingId` 不由模型自由生成正式身份。Agent response 中使用顺序稳定的临时 ID：

```text
F-001
F-002
```

Runtime 根据以下规范化字段生成正式语义身份：

```text
severity + file + line + normalized summary + evidenceText
```

这避免重试时模型生成不同 UUID 导致重复 finding。Runtime 保留 Agent 临时 ID 作为诊断信息，不进入 State 的正式 finding ID。

## 8. Codex CLI Adapter

### 8.1 固定执行方式

M8-A 只允许 Runtime 解析出的固定 `codex` 可执行文件，不允许配置覆盖 executable。

固定参数：

```text
codex exec
--sandbox read-only
--ephemeral
--ignore-user-config
--output-schema <response-schema>
--json
--skip-git-repo-check
--cd <isolated-provider-root>
```

仅当 `resolvedModel` 非 `null` 时追加：

```text
--model <resolvedModel>
```

禁止追加：

- `--dangerously-bypass-approvals-and-sandbox`
- `--sandbox workspace-write`
- `--sandbox danger-full-access`
- `--add-dir`
- `--enable`
- `--config`
- `--profile`
- `--oss`
- `--local-provider`
- 任意调用方提供参数

prompt 通过 stdin 传入，不拼接进 shell 命令。Node 使用 `spawn` 或 `execFile` 的 argv 数组，不经过 shell。

### 8.2 Prompt 边界

Runtime 生成固定系统化任务说明，包含：

- 角色为只读 `code-reviewer`。
- 只能依据 manifest 中的上下文。
- 目标是报告当前修改中的可复现正确性、安全性、回归和缺失测试问题。
- 不报告纯风格偏好、低概率猜测或与当前阶段无关的未来加固。
- 不修改文件，不运行 Git 写命令，不建议绕过门禁。
- 最终响应必须匹配 Schema。

用户文本、源码、diff、文档和知识内容均作为有边界的数据块，不得被解释为 Runtime 指令。prompt 模板自身版本和 SHA-256 写入 request。

### 8.3 进程边界

- 默认超时 30 秒，配置不允许扩大；测试可注入更短超时。
- 超时后先发送终止信号，等待固定宽限期，再强制结束进程树。
- stdout、stderr 各自设置上限，超限立即终止。
- JSONL 事件只用于诊断和提取最终响应，不直接成为正式 State。
- 进程退出码非零、缺失最终响应、多个最终响应、非法 UTF-8 或非法 JSON 均失败关闭。
- Adapter 不使用 `--output-last-message`，避免 Codex CLI 直接写正式响应文件。
- `--ephemeral` 用于避免持久化 Agent 会话。

### 8.4 可执行文件发现

发现顺序固定：

1. 测试显式注入的绝对路径。
2. `Get-Command codex`/当前进程 PATH 解析结果。
3. 已验证的应用安装候选只作为诊断建议，不自动扫描整个磁盘。

最终路径必须是普通可执行文件，不得是 symlink、脚本字符串或配置提供的路径。receipt 记录规范路径和 `codex --version` 输出，不记录认证信息。

## 9. 无写入证明

只读 sandbox 是第一层边界，但 M8-A 还要由 Runtime 验证调用前后事实未变化。

Profile、Adapter 和模型只在 Prepare 时解析并写入 request。Run、重试和 Materialize 不接受新的 Profile/Model 覆盖；配置文件后续变化不改变已经冻结的 request。

父 Runtime 在启动 Agent 前完成以下顺序：

1. 原子写入 request 和 context manifest。
2. 创建仓库外的隔离 Provider 工作目录。
3. 冻结调用前完整性快照。
4. 启动 Agent 子进程。

调用前快照包含：

```text
State 文件 SHA-256
pointer 文件 SHA-256
events 文件 SHA-256
task/checkpoint SHA-256
Git HEAD
Git status porcelain -z
context manifest 中所有文件 SHA-256
所有初始 tracked/untracked dirty 文件的内容 SHA-256 或删除标记
```

调用后重新核对：

- State、pointer、events、task 和 checkpoint 字节不变。
- Git HEAD 不变。
- Git status 的路径、状态和关系不变。
- 所有 manifest entry 当前 SHA-256 不变。
- 所有调用前 tracked/untracked dirty 文件的内容哈希或删除状态不变。
- 隔离 Provider 工作目录的 tree manifest 完全一致，不允许新增、修改或删除。
- response Schema 副本与 request 绑定的 `outputSchemaSha256` 一致。

request 和 context manifest 只由父 Runtime 在调用前写入。raw response、execution receipt、正式 evidence、报告和 result 只由父 Runtime 在进程退出并完成无写入核对后写入。Agent 子进程不获得这些正式路径的写权限。

若调用前工作区已有 dirty 文件，允许审核，但必须完整冻结其状态和内容哈希。调用后任何漂移都使本次 Provider 执行失败，不生成正式报告或 phase result。

Git ignored 文件不属于 M8-A 的仓库完整性证明范围，除非它们本身是 request/context/task/State 等本次明确绑定资产。receipt 必须明确记录该限制，不得声称验证了当前用户可访问文件系统的全部字节。

## 10. Runtime 正式产物

Provider 执行成功并完成所有校验后，Runtime 根据当前 task 的实际 `expectedOutputs` 生成：

```text
<task.expectedOutputs[0]>
evidence/provider-review-response.json
result.json
```

职责：

- `evidence/provider-review-response.json`：保存通过 Schema 校验的结构化结论，位于现有 Story Runtime 允许的 `<attemptRoot>/evidence/` 边界内。
- `<task.expectedOutputs[0]>`：Runtime 使用固定模板渲染的人类报告；普通执行通常为 `code-review-report.md`，rework 时使用 Story Runtime 冻结的 `code-review-report.rework-<reworkId>.md`。
- `result.json`：Runtime 转换为现有 dispatch result v2 的 `code-review` payload。

转换规则：

- 存在 open `BLOCKER`：`review.status=blocked`。
- 无 `BLOCKER`，存在 open `WARNING`：按当前审核规则仍为 `blocked`，等待修复或后续只读复审关闭。
- 只有 `INFO` 或无 finding：`review.status=passed`。
- Provider 失败不生成 `result.json`，State 保持原 revision。
- Provider response 不能自行声明 finding 已解决。
- Runtime 将完整结构化 response 保存为正式 evidence 文件。
- State finding 的 `evidence` 指向该 evidence 文件，不保存描述性文本。
- `evidenceText` 和 `rationale` 进入原始 response 与 Markdown 报告，不增加到 State finding 的严格字段中。
- 正式 `review` record 的 path、bytes 和 SHA-256 指向 `<attemptRoot>/evidence/provider-review-response.json`。
- 正式 result 的 outputs、records、bytes 和 SHA-256 全部由 Runtime 根据实际写入文件计算。

现有 Story Runtime 继续作为 apply 和 State 投影的唯一入口。Provider Runtime 不直接修改 State、pointer 或 events。

现有 `applyBlockedV2()` 不会投影 phase payload。M8-A 必须增加一个严格限定于 `phase=code-review` 的 blocked review 投影：

- blocked result 必须包含合法 `code-review` payload。
- 在同一个 State 事务内先将 `payload.findings/status` 投影到 `state.review`，再进入 blocked State。
- 其他 phase 的 blocked result 行为保持不变。
- 恢复和 rework 后历史 finding 继续通过 State、result 和 supersession 证据保留，不能只存在于 Markdown。

materialize 采用逐文件临时写入和 rename，提交点固定为 `result.json` 最后写入。若在 result 前中断，已有 provider evidence 或报告可以作为恢复诊断保留，但 Story Runtime 仍视为 result 缺失，不会 apply 半成品。本阶段不声称多个文件构成单次文件系统原子事务。

## 11. Provider Execution Receipt

每次真实 Codex 进程执行只生成一份 execution receipt：

```text
<attemptRoot>/provider/executions/<providerExecutionId>/execution-receipt.json
```

execution receipt 至少包含：

```text
schemaVersion
providerExecutionId
providerRequestId
dispatchId
storyId
runId
phase
role
profile
adapter
configSha256
requestFile
requestSha256
contextManifestFile
contextManifestSha256
promptTemplateVersion
promptTemplateSha256
requestedModel
resolvedModel
reportedModel
modelSource
adapterVersion
startedAt
finishedAt
exitCode
status
responseFile
responseSha256
integrityChecks
diagnostics
```

`status`：

```text
completed
failed
timed-out
invalid-response
integrity-violation
```

失败 receipt 可以作为 attempt 内诊断证据保存，但不能伪装为正式 code-review result。receipt 中不得包含：

- API Key 或认证头。
- Codex 登录态内容。
- 完整用户级配置。
- 未经清理的环境变量。
- 超出上限的 stdout/stderr。

M8-A 不增加第二套 materialization receipt：

- execution receipt 绑定 request、context、模型、Adapter、raw response 和完整性核对。
- 正式 `result.json` 绑定 response evidence 和审核报告。
- `result.json` 不引用 execution receipt，execution receipt 也不绑定 result 哈希，避免循环依赖。
- Materialize 每次都从成功 execution、冻结 request 和磁盘正式产物重新计算候选 result。
- `result.json` 写入前中断时，Status 根据“成功 execution + result 缺失”返回 `provider-materialize-required`；重复 Materialize 重新核验并幂等提交。

## 12. 重试与中断恢复

### 12.1 执行身份

每次真实进程启动生成新的 `providerExecutionId`，但继续绑定同一个 `providerRequestId` 和 dispatch：

```text
provider/
  request.json
  context-manifest.json
  executions/<providerExecutionId>/
    raw-events.jsonl
    diagnostics.json
    execution-receipt.json
```

规则：

- request 和 context 不变时允许重试。
- request 在首次 Provider 执行开始后不可替换。
- task、State revision、配置、manifest 或 prompt 漂移时当前 request 失效并失败关闭，不允许在同一执行中静默重建。
- 已存在合法正式 `result.json` 时禁止再次启动 Provider。
- 已存在成功 execution receipt 和合法 raw response、但尚无 `result.json` 时，不重复调用模型，进入幂等 materialize。
- 已成功 materialize 且尚未 apply 时，E2E Runtime 返回 `apply-result`，不重复审核。
- 失败执行保留有界诊断，不污染正式 response/report/result。

### 12.2 并发与锁

`Prepare`、`Run` 和 `Materialize` 使用同一个 attempt/request 级互斥锁：

```text
<attemptRoot>/provider/provider.lock
```

规则：

- 原子创建锁，锁内容包含 `lockId`、dispatch、request、命令、父进程 PID、子进程 PID、Provider execution ID、开始时间和超时上限。
- `Run` 在整个 Codex 子进程生命周期内持锁。
- Adapter 创建 Codex 子进程后，通过 lockId fencing 将 child PID 和 Provider execution ID 写回锁。
- 每个命令在锁内重新读取 State revision、task、request、context、execution receipts 和 `result.json`。
- 同一 request 不能并发启动两个 Agent 进程。
- `Materialize` 必须绑定一个唯一的成功 execution，不能使用“最新文件”猜测。
- 写入 execution receipt、正式 evidence、报告和 result 前再次核对 `lockId`，防止过期持有者提交。
- 进程异常退出遗留锁时，必须分别核对父进程和子进程；任一记录进程仍存活时不得回收。两个进程都不存在且超过“Provider 超时 + 固定宽限期”后才允许确定性回收，回收事实写入诊断。
- 锁文件是控制资产，不进入 State、Git owned files 或 Provider 上下文。

### 12.3 重试策略

M8-A 不自动重试模型调用。超时、进程失败或非法响应后返回明确失败状态，由当前会话或未来调度器决定是否在同一冻结 request 上重试。

理由：

- 自动重试会增加不可见模型成本。
- 非法输出可能来自不兼容模型或配置错误，重复调用没有确定收益。
- 人工可在不修改 State 的情况下检查诊断并决定重试。

## 13. 与 E2E Runtime 的集成

### 13.1 派生状态

Provider Runtime 不新增第二份可变工作流 State。它只从当前 State、task、不可变 request、execution receipt 和正式 result 推导：

```text
provider-not-prepared
provider-ready
provider-run-in-progress
provider-failed
provider-materialize-required
provider-materialized
provider-invalid
```

推导优先级：

1. 正式 `result.json` 存在并通过 Story Runtime 校验：`provider-materialized`。
2. request、context 或执行证据漂移：`provider-invalid`。
3. 存在唯一成功 execution receipt 和合法 raw response，但正式 result 缺失：`provider-materialize-required`。
4. 最新已完成 execution receipt 为失败、超时、非法响应或完整性违规：`provider-failed`。
5. 存在合法 request/context 且无已完成或活跃 execution：`provider-ready`。
6. 不存在 request：`provider-not-prepared`。

活跃锁对应的 Agent 子进程仍存在时，Status 返回 `provider-run-in-progress`，不允许第二次 Run。

只有以下条件全部满足时，E2E Runtime 才进行 Provider 状态映射：

- 当前 phase 为 `code-review`。
- 当前 task 已 prepare。
- result 尚不存在。
- ownerAgent 为 `code-reviewer`。
- Provider 配置有效。
- 当前知识和上下文门禁满足。

### 13.2 E2E 动作

当 Story Runtime 原始 inspection 为 `awaiting-result` 且满足上述 Provider 条件时，E2E Runtime 再读取 Provider 派生状态：

```text
provider-not-prepared -> provider-prepare-required
provider-ready        -> provider-run-required
provider-run-in-progress -> provider-run-in-progress
provider-failed       -> provider-retry-decision
provider-materialize-required -> provider-materialize-required
provider-invalid      -> provider-invalid
provider-materialized -> apply-result
```

其他 phase 或角色继续保持现有 `cognitive-action-required`，不被 M8-A 改写。

`run-e2e Step` 首版不会自动执行 `provider-prepare-required`、`provider-run-required`、`provider-materialize-required` 或 `provider-retry-decision`，避免改变 M7-B“一次只做明确确定性动作”的语义。用户或当前 Codex 会话通过专用入口执行：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Run `
  -StateFile <state> `
  -Json
```

Provider 成功后：

```powershell
.\.harness\scripts\run-e2e.ps1 -Command Apply -StateFile <state> -Json
```

中断恢复：

- `provider-prepare-required`：执行 `run-provider Prepare`。
- `provider-run-required`：执行 `run-provider Run`。
- `provider-materialize-required`：执行 `run-provider Materialize`，不再次调用模型。
- `provider-retry-decision`：读取最新失败 receipt；由用户或当前会话决定是否对同一 request 再次 `Run`。
- `provider-invalid`：停止并报告漂移，不自动删除或覆盖证据。
- `apply-result`：使用现有 `run-e2e Apply`。

M8-A 真实 Story 验收通过后，再决定是否让后续串行调度器自动执行 Provider 动作。本阶段不增加无人值守循环。

## 14. CLI

只读状态：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Status `
  -StateFile <state> `
  -Json
```

准备冻结 request：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Prepare `
  -StateFile <state> `
  -Json
```

执行真实 Provider：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Run `
  -StateFile <state> `
  -Json
```

完成或恢复正式产物生成：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Materialize `
  -StateFile <state> `
  -Json
```

单次选择 Profile：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Prepare `
  -StateFile <state> `
  -Profile codex-default `
  -Json
```

单次覆盖模型：

```powershell
.\.harness\scripts\run-provider.ps1 `
  -Command Prepare `
  -StateFile <state> `
  -Model <model-id> `
  -Json
```

Profile 和 Model 只允许在 `Prepare` 时提供；`Run`、`Materialize` 和 `Status` 必须拒绝新的 Profile/Model。CLI 不接受 Adapter、executable、argv、prompt、权限、上下文路径或输出路径覆盖。

## 15. 测试策略

### 15.1 配置

- 无配置时生成内置 `codex-default`。
- 项目配置覆盖内置默认值。
- 本地 Profile 和 role binding 按完整项覆盖项目配置。
- Prepare 阶段的单次 Profile 和 model 覆盖优先级正确，Run/Materialize 不允许重新覆盖。
- 未知字段、角色、Profile、Adapter 和悬空引用失败。
- 配置不能注入 executable、argv、prompt 或 secret。
- 本地配置被 `.gitignore` 忽略。
- 规范化配置哈希稳定。

### 15.2 Request 与 context

- 只允许当前 State v2 的 code-review attempt。
- 非 `code-reviewer`、错误 phase、revision drift 和已存在 result 拒绝。
- context 只加载显式 manifest。
- prompt 内联 manifest 冻结内容，Adapter 工作目录不指向仓库。
- 角色读路径、单文件 2 MiB、总量 8 MiB、UTF-8 和链接逃逸测试。
- relevant stale/missing 阻止调用。
- `accepted-stale` 在 request 中如实标记。
- task、State、DAG、知识、diff 和测试证据哈希漂移拒绝。

### 15.3 Codex CLI Adapter

使用本地假 `codex` 可执行 fixture 验证：

- argv 只包含白名单。
- prompt 通过 stdin。
- 固定包含 `--skip-git-repo-check` 和隔离工作目录，不使用仓库根目录作为 `--cd`。
- `model=null` 不传 `--model`。
- 显式模型只产生一个 `--model` 参数。
- 禁止 shell、额外 argv 和路径注入。
- 成功 JSONL、非零退出、无 final response、多个 final response。
- 非法 UTF-8、非法 JSON、额外字段和输出超限。
- 超时后进程树终止。
- stdout/stderr 有界。

### 15.4 Response 与 materialize

- Provider response 不允许 candidate files。
- finding 路径必须属于审核上下文。
- finding 使用 `BLOCKER/WARNING/INFO`，行号和字段严格校验。
- finding `file` 只能引用 `reviewTargets`，State `evidence` 指向 Runtime 写入的 evidence 文件。
- Runtime 生成稳定正式 finding ID。
- BLOCKER/WARNING/INFO 映射为正确 review status。
- report、evidence、receipt 和 result 的 bytes/SHA-256 正确。
- materialize 中断不产生合法 `result.json`；残留 evidence、receipt 或报告不能被识别为可 apply 的正式结果。
- Provider Prepare、Run 和 Materialize 并发时由同一 attempt/request 锁串行。
- 成功 execution 后、result 前中断时进入 `provider-materialize-required`，恢复不重复调用模型。
- 成功后由现有 Story Runtime apply，Provider Runtime 不直接改 State。

### 15.5 无写入证明

- Provider 修改 tracked、untracked、State、events、task 或 context 文件时失败。
- Provider 新增仓库文件时失败。
- Provider 修改后恢复 Git status 但内容哈希变化时仍失败。
- 初始 untracked 文件内容变化时失败。
- ignored 非绑定文件不在证明范围内，并在 receipt 中明确披露。
- 失败时正式 report/result 不存在，State、pointer 和 events 字节不变。
- 调用前已有 dirty 文件在调用后保持完全一致时允许审核。

### 15.6 回归与真实验收

至少运行：

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
node .\.harness\scripts\tests\provider-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\provider-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

真实验收选择一个包含可审核修改的小 Story：

1. 当前 Codex 会话先进行一次人工只读审核。
2. 使用默认 `codex-cli` Profile 执行真实 Provider 审核。
3. 比较两者发现、误报、漏报和证据质量。
4. Provider finding 若成立，按现有 late-stage rework 规则修复并重新审核。
5. 最终正式 code-review phase 通过现有 State 投影和完成门禁。
6. 继续完成 build-publish、interface-verification 和 delivery-preparation，在不执行 Git 的情况下进入 `done/completed`。

真实验收不要求 Provider 必须发现问题；若修改确实无问题，能够提供有证据的通过结论同样有效。不得为了验收故意保留缺陷。

## 16. 验收标准

- Runtime 能通过本机 `codex exec` 启动真实、非交互 `code-reviewer`。
- 真实 Agent 运行在 `read-only` sandbox，使用临时会话和固定 argv。
- Agent 不能返回 candidate files，也不能直接写正式报告、result 或 State。
- Provider 失败、超时、非法输出或完整性违规时 State 和正式结果零污染。
- `read-only` 只作为写入边界；M8-A 不声称已实现严格文件读取 ACL。
- 只有当前 State v2 的 `code-review`/`code-reviewer` 可以启动。
- 配置支持角色绑定 Profile 和显式模型，不把模型硬编码进角色。
- 未指定模型时的隔离 CLI 默认语义被准确记录，不虚构父会话模型继承。
- 模型或 Profile 切换不能扩大角色权限、上下文范围或 CLI 参数。
- Runtime 生成的正式 result 可由 Story Runtime apply；M8-A 只增加严格限定的 code-review blocked payload 投影，不改变 State v2 或 dispatch result v2 协议。
- Provider Prepare、Run、Retry decision 和 Apply 能由磁盘事实确定性恢复。
- 替换未来 Adapter 不需要修改 State v2 或 dispatch result v2 契约。
- M4/M5 Mock Worker、M7 State/Story/E2E Runtime 全量回归通过。
- 至少一个真实 Story 完成人工审核与 Provider 审核对比。

## 17. 后续扩展边界

### 17.1 `openai-compatible` Adapter

后续在业务设计或需求分析 Agent 正式接入前单独设计：

- `baseUrl`、模型和 `apiKeyEnv`。
- HTTPS、主机允许列表和内网地址限制。
- 外部网络调用批准。
- 超时、限流、重试和供应商错误归一化。
- Structured Outputs 支持差异。
- API Key 脱敏和日志边界。
- 本地模拟 HTTP fixture 与真实供应商验收。

该 Adapter 必须输出与 M8-A 相同的 Provider response，不得改变权限、State 或 phase result 协议。

### 17.2 M8-B 开发 Provider

M8-B 才开放：

- `backend-developer` 和 `frontend-developer`。
- 单任务、单隔离 Worktree、串行执行。
- predicted files 和 role capability 双重写入约束。
- candidate files、受控集成和开发测试。

M8-A 的只读 Review Materializer 不直接扩展为写入型 materializer，避免审核与开发权限混用。
