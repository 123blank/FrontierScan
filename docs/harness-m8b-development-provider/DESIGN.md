# FrontierScan Harness M8-B 单任务开发 Agent Provider 设计

> 日期：2026-08-22
>
> 状态：方案 B 已获用户批准；独立只读审核通过，待用户批准实施
>
> 路线基线：`docs/harness-engineering-target-and-gap.md`
>
> 总体路线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：M8-A 已完成真实只读 `code-reviewer` Provider 验收
>
> 实施基线：`6c35532 docs(harness): finalize synchronized handoff`

## 1. 目标与防偏移说明

M8-B 对应长期目标中的“真实受限开发 Agent”和“单任务、单隔离 Worktree、串行执行”。本阶段在 M8-A 模型路由与真实 Codex CLI 调用、M5-A 单 Worktree、M5-B2 内容寻址集成和 M7 State v2 串行闭环之上，接入首个能够直接修改隔离 Worktree 的开发 Provider：

```text
State v2 implementation task
-> Runtime 冻结 DAG node、predictedFiles、知识、角色与模型配置
-> 用户批准并创建单任务 Worktree
-> Codex CLI Adapter 在 Worktree 中以 workspace-write 运行
-> Agent 直接修改 Worktree
-> Runtime 对账执行前后文件系统、Git 和结构化响应
-> Runtime 固化合法 candidate manifest
-> Runtime 在候选 Worktree 中运行固定测试 Adapter
-> Runtime 生成 notes/result 候选与开发 Provider receipt
-> 既有 M5-B2 内容寻址集成将候选写入主工作树
-> Story Runtime 显式 apply 推进 State
```

本阶段的核心不是让 Agent 获得主仓库写权限，而是证明：

> 真实开发 Agent 可以在一个受控、可审计、可丢弃的任务 Worktree 中直接编码；只有 Runtime 验证通过的候选才能进入主工作树。

M8-B 不实现：

- 多任务、多 Worktree、同 wave 并行或 Fork-Join。
- Agent 直接写主工作树、State、正式 phase result 或 Git 历史。
- 自动创建、删除、重建或回收 Worktree。
- 自动 `git add`、`git commit`、`git push`、PR、发布或部署。
- 删除、重命名、符号链接或子模块候选。
- `openai-compatible`、阿里百炼 HTTP Adapter 或其他外部 Provider Adapter。
- 自动执行完整 `Prepare -> Run -> Materialize -> Test -> Finalize -> Integrate -> Apply` 循环。
- 自动接受失败、越权、stale、测试缺口或集成冲突。

## 2. 已确认决策

1. 采用方案 B：Agent 直接修改任务专属 Worktree。
2. Agent 不能直接修改主工作树；主树只通过 Runtime 受控集成改变。
3. 首版只允许 `backend-developer` 和 `frontend-developer`。
4. 仅支持 State v2 `implementation` 阶段中的一个 pending DAG node。
5. 只允许一个已批准创建、Git 事实完整且初始干净的单任务 Worktree。
6. Codex 使用 `workspace-write`，工作目录固定为该 Worktree，不使用 `--add-dir`。
7. `predictedFiles` 和角色写策略是候选准入门禁，不声称是操作系统级逐文件 ACL。
8. Agent 最终结构化响应只声明摘要、开发方法和文件清单；候选事实以磁盘、Git 和 SHA-256 为准。
9. 越权或不可解释写入导致 attempt 失败关闭；Runtime 不自动 reset、删除或清理 Worktree。
10. 候选冻结后由 Runtime 运行固定测试 Adapter；Agent 自行运行的命令不构成正式测试证据。
11. 新建开发 Provider receipt，既有 M5-B2 Runtime 通过严格归一化消费，不把真实 Agent 伪装为 Mock Worker。
12. 模型路由继续使用 M8-A 的 `role -> profile -> adapter/model`；模型选择不能改变权限和固定 CLI 参数。

## 3. 现状与缺口

### 3.1 M8-A 只支持只读审核

M8-A 的 `provider-runtime.mjs`、`provider-context.mjs` 和 `codex-cli.mjs` 已证明：

- 真实 `codex exec` 可以由 Runtime 非交互启动。
- task、context、Profile、模型和权限可以冻结并绑定哈希。
- 超时、输出上限、非法响应、claim-first 和 result-last 可以确定性恢复。
- Agent 不直接写 State 或正式报告。

但 M8-A 固定：

```text
phase=code-review
role=code-reviewer
sandbox=read-only
```

不能直接扩展为开发角色。

### 3.2 M4/M5 已有候选和集成协议

现有 `worker-runtime.mjs` 接受同进程 Mock Provider 返回的完整候选文件，校验角色策略和 `predictedFiles` 后写入 Worktree。M5-B1 回收候选，M5-B2 将其固化为内容寻址 bundle，并在批准后集成主树。

M8-B 采用的差异是：

```text
M4/M5 Mock Worker：Provider 返回完整文件，Runtime 写 Worktree
M8-B 真实 Provider：Agent 直接写 Worktree，Runtime 从实际差异收集候选
```

M5-B2 的内容寻址集成、主树前置条件、逐文件恢复和 result-last 原则继续复用。

### 3.3 `workspace-write` 不是 predictedFiles ACL

本机 `codex-cli 0.148.0` 支持：

```text
codex exec
--approve-for-me
--ephemeral
--ignore-user-config
--output-schema
--json
--cd <worktree>
```

在当前已验收的 Codex CLI `0.148.0` 中，`--approve-for-me` 会通过自动审批使用 `workspace-write` sandbox，且不能与显式 `--sandbox workspace-write` 同时传入。Runtime 因此只传 `--approve-for-me`，但 execution receipt 继续按实际权限语义记录 `sandbox=workspace-write`。

`workspace-write` 将可写边界限制到工作区级别，但不能证明 Agent 只能修改 `predictedFiles`。因此 M8-B 必须将：

```text
操作系统 Sandbox
+ Runtime 前后快照
+ Git 差异
+ 角色策略
+ predictedFiles
+ 候选哈希
```

组合为实际安全边界。

## 4. 方案比较

### 4.1 方案 A：Agent 返回完整候选文件

Agent 只读运行，返回 `{files, result}`，由 Runtime 写入 Worktree。

优点：

- 写入前即可拒绝越权路径。
- 最大程度复用 M4 Worker。

缺点：

- 大文件需要完整输出。
- 多轮编辑、格式化和复杂修改体验较差。
- 不能验证真实 Codex 写入型工作流。

本方案未采用。

### 4.2 方案 B：Agent 直接写隔离 Worktree

Agent 在单任务 Worktree 中以 `workspace-write` 运行，Runtime 在进程结束后收集实际差异。

优点：

- 接近真实编码体验。
- 支持搜索、增量编辑和本地诊断。
- 为 M9 真实并行 Provider 建立可复用执行边界。

缺点：

- 越权修改只能在写入后、集成前发现。
- 中断可能留下脏 Worktree。
- 必须增加完整快照、候选收集和失败恢复。

本方案已由用户批准采用。

### 4.3 方案 C：Agent 返回 Patch

Agent 只读返回 patch，Runtime 应用到 Worktree。

优点：

- 输出比完整文件紧凑。

缺点：

- 需要新增 patch 解析、hunk 漂移和应用语义。
- 与现有内容寻址 bundle 重复。
- 没有验证直接写 Worktree 的目标能力。

本方案不采用。

## 5. 总体架构

### 5.1 组件边界

| 组件 | 职责 |
| --- | --- |
| E2E Runtime | 根据 State 返回开发 Provider 的唯一下一动作，不自动执行完整链 |
| Development Provider Runtime | `Status/Prepare/Run/Materialize/Test/Finalize`、锁、恢复和候选收集 |
| Development Context Builder | 冻结 DAG node、知识、角色、Worktree 和显式上下文 |
| Codex CLI Adapter | 以固定 `workspace-write` 参数在 Worktree 中启动 Codex |
| Candidate Collector | 对账执行前后快照、Git 差异、角色策略和 `predictedFiles` |
| Test Adapter | 在冻结候选 Worktree 中运行固定测试命令并生成证据 |
| M5-B2 Integration Runtime | 消费开发 Provider receipt，固化 bundle 并受控集成主树 |
| Story Runtime | 最后应用正式 implementation result 并推进 State |

### 5.2 执行链

```text
run-e2e Step
-> development-worktree-required | development-provider-prepare-required

run-development-provider Prepare
-> 冻结 request/context/policy/profile/model/worktree baseline

run-development-provider Run
-> claim-first
-> codex exec --approve-for-me --cd <worktree>
-> 结构化 final response
-> execution receipt

run-development-provider Materialize
-> 重验 request/context/worktree/base
-> 收集 Git 与文件系统实际变化
-> 校验 predictedFiles/role policy
-> 生成 candidate manifest

run-development-provider Test
-> 固定 Adapter
-> 生成 test receipt

run-development-provider Finalize
-> 生成 implementation notes/result 候选
-> 生成 development Provider receipt

run-worktree-integration Plan/Status/Apply
-> 用户批准 Apply
-> 主树受控集成

run-e2e Apply
-> Story Runtime 投影 implementation result
```

## 6. Provider 配置与模型路由

继续使用：

```text
.harness/config/agent-providers.json
.harness/config/agent-providers.local.json
.harness/schemas/agent-provider-config.schema.json
```

项目默认配置扩展角色绑定：

```json
{
  "roleBindings": {
    "code-reviewer": "codex-default",
    "backend-developer": "codex-default",
    "frontend-developer": "codex-default"
  }
}
```

用户仍可在本地配置中将不同角色绑定到不同 Profile 和模型：

```text
backend-developer -> codex-backend
frontend-developer -> codex-frontend
code-reviewer -> codex-review
```

M8-B 不增加可配置的 sandbox、可执行文件、argv、prompt、工作目录、环境变量值或权限字段。以下值由 Runtime 根据角色固定：

```text
adapter=codex-cli
sandbox=workspace-write
workingRoot=task Worktree
phase=implementation
allowedRoles=backend-developer|frontend-developer
```

未指定模型时继续不传 `--model`，不声称继承父 Codex UI 会话的临时模型。

## 7. Worktree 前置条件

M8-B 不创建 Worktree。`Prepare` 前必须已有用户批准创建的 M5-A 单任务 Worktree，并满足：

1. 当前 State v2 phase 为 `implementation`。
2. DAG 只有一个 pending node。
3. node owner 为 `backend-developer` 或 `frontend-developer`。
4. `predictedFiles` 非空。
5. Worktree plan、status、branch、path、HEAD 和 `baseCommit` 一致。
6. Worktree Git 状态干净。
7. Worktree 中不存在计划外 junction、symlink、submodule 或嵌套 Git 仓库。
8. 主工作树 HEAD 和初始 dirty 状态符合既有 Story baseline。
9. 不存在未完成的旧 development Provider attempt、集成锁或退休锁。

Worktree 缺失时，E2E Runtime 只返回 `development-worktree-required`，不得自动创建。

## 8. 冻结输入

### 8.1 Development request

新增：

```text
.harness/schemas/agent-development-request.schema.json
```

字段至少包括：

```text
schemaVersion
providerRequestId
dispatchId
storyId
runId
phase
role
taskId
preparedRevision
taskFile/taskSha256
dagFile/dagSha256
worktreePlanFile/worktreePlanSha256
worktreeStatusFile/worktreeStatusSha256
contextManifestFile/contextManifestSha256
policy
profileId
adapter
requestedModel
modelSource
configSha256
baseCommit
worktreePath
```

`worktreePath` 由 Runtime 推导，不能由调用者或配置提供。

### 8.2 Development context

新增：

```text
.harness/schemas/agent-development-context.schema.json
```

上下文使用显式清单，不扫描聊天历史。至少包含：

- 当前 implementation task。
- 对应 DAG node 和 required criterion。
- `predictedFiles`。
- technical-design 和 requirement 输出。
- 相关知识查询结果与 freshness。
- 角色策略。
- `AGENTS.md`。
- 目标模块必要源码和测试文件。
- 当前 Worktree baseline 摘要。

上下文条目继续受单文件 2 MiB、总量 8 MiB 限制。M8-B 不声称严格读取 ACL；Agent 位于完整 Worktree 中，Runtime 只能冻结正式上下文并在 prompt 中要求优先使用，不能证明 Agent 未读取其他仓库文件。

### 8.3 执行前快照

`Prepare` 记录：

- Worktree HEAD、branch 和 Git status。
- `git rev-parse --git-dir` 与 `git rev-parse --git-common-dir` 的规范化路径。
- Worktree index、共享 Git config、`packed-refs` 和当前 branch ref 的可观察身份与哈希；不存在的文件记录为不存在，不创建文件。
- 规范化 `git for-each-ref --format=<固定格式>` 全量输出的 SHA-256，覆盖新增、删除或改写任意 ref。
- 全部 tracked 文件状态。
- 非忽略普通文件清单。
- ignored 路径的类型、大小和时间元数据，不读取潜在密钥内容。
- `.git` 文件内容哈希。
- 目标 `predictedFiles` 的 base 哈希或不存在标记。
- Worktree 顶层目录和受支持文件类型。

固定测试 Adapter 可能生成以下构建目录：

```text
backend/target/
frontend/node_modules/
frontend/dist/
```

首版不允许调用方扩展该列表。Provider Run/Materialize 阶段不允许任何 ignored 路径发生变化，包括上述构建目录；这避免 Agent 预先生成的编译产物影响正式测试。只有 Runtime 进入 Test 后才允许固定测试 Adapter 在这些目录中生成输出。

执行后任何其他 ignored 路径变化均失败关闭。该规则用于发现 `.env`、本地配置或其他 Git ignored 文件写入，同时避免把潜在密钥内容复制进 evidence。

`workspace-write` 预期阻止 Agent 修改 linked Worktree 之外的共享 Git 元数据，但 Runtime 不把该预期描述为绝对隔离。Run、Materialize、Test 和 Finalize 都必须重验上述 Git 事实；正式回执只能声明“Runtime 未观察到受检查 Git 事实漂移”，不能声明“Agent 无法写 Git”。

## 9. Codex CLI 写入 Adapter

### 9.1 固定参数

在既有 `codex-cli.mjs` 中增加独立的 workspace 执行函数，复用可执行文件发现、环境白名单、输出限制、终止和诊断脱敏，不改变 M8-A `runCodexCli()` 的只读语义。

固定参数：

```text
codex exec
--approve-for-me
--ephemeral
--ignore-user-config
--output-schema <frozen schema>
--json
--cd <task worktree>
```

`--approve-for-me` 在当前验收版本中隐式使用 `workspace-write` sandbox。Development argv 不再同时传入显式 `--sandbox`，避免 CLI 参数冲突；M8-A `code-reviewer` 仍保持独立的显式 `--sandbox read-only`。

明确禁止：

```text
--add-dir
danger-full-access
--dangerously-bypass-approvals-and-sandbox
--dangerously-bypass-hook-trust
任意调用方 argv
任意调用方 cwd
```

模型 Provider 元数据继续通过 M8-A 已验证的白名单 TOML 参数注入。

### 9.2 环境

继续使用最小环境变量白名单。M8-B 不向 Agent 传递：

- API Key。
- Git credential。
- 发布凭据。
- `.env` 内容。
- 调用者任意环境变量。

Codex 登录态只通过现有 `CODEX_HOME` 使用。外部网络和外部写操作不属于本阶段能力。

### 9.3 最终响应

新增：

```text
.harness/schemas/agent-development-response.schema.json
```

Agent 最终响应包含：

```text
schemaVersion
providerRequestId
dispatchId
storyId
runId
phase=implementation
role
status=completed|failed
summary
developmentMethod=tdd|exception
tddExceptionReason
declaredFiles[]
diagnostics[]
usage
```

`declaredFiles` 只声明：

```text
path
changeType=create|update
purpose
```

不包含文件内容。Runtime 必须将声明与实际磁盘差异逐项对账；漏报、虚报或类型不一致均失败关闭。

## 10. 候选收集与准入

### 10.1 权威事实

候选事实优先级：

```text
Worktree 实际普通文件
-> Git 状态与 baseCommit
-> 执行前后快照
-> Agent declaredFiles
```

Agent 文本摘要不是候选事实。

### 10.2 允许变化

首版只接受：

- 已有普通 UTF-8 文件内容更新。
- 新建普通 UTF-8 文件。
- 当前 implementation phase 的固定报告文件。

业务路径必须同时满足：

```text
role.writePathPrefixes
AND DAG node.predictedFiles
AND capability prefix
```

`backend-developer` 只能产生 backend 候选；`frontend-developer` 只能产生 frontend 候选。

### 10.3 拒绝变化

发现以下任一变化时 attempt 失败关闭：

- predictedFiles 外修改。
- 跨角色区域修改。
- 文件删除或重命名。
- symlink、junction、reparse point、submodule 或嵌套 Git。
- `.git` 文件变化或 Git index/branch/HEAD 漂移。
- State、request、context、policy、Schema 或其他冻结输入变化。
- 不受支持的二进制文件。
- 单文件超过 2 MiB或候选总量超过 8 MiB。
- 未声明或虚假声明的业务文件。
- 进程结束后仍有活动子进程写入。
- 无法解释的非忽略文件。

越权文件不会被挑选后继续集成；整个 attempt 失败。

### 10.4 污染 Worktree

失败后：

- 保存执行前后快照、Git 状态、诊断和差异清单。
- 不生成成功 candidate receipt。
- 不自动 reset、checkout、clean 或删除文件。
- 不自动重新调用模型。
- E2E Runtime 返回 `development-provider-recovery-required`。

调用者确认保留、人工修复或批准 Worktree 退休/重建后，才能创建新 attempt。

## 11. 持久化产物

固定目录：

```text
.harness/runs/<runId>/phases/03-implementation/attempts/<dispatchId>/
  evidence/
    development-provider-result-evidence.json
  development-provider/
    prepared/
      request.json
      context-manifest.json
      response.schema.json
      binding.json
      worktree-baseline.json
    executions/<providerExecutionId>/
      execution-claim.json
      response.json
      execution-receipt.json
      stdout.jsonl
      stderr.txt
    evidence/
      worktree-after.json
      candidate-manifest.json
      provider-diagnostics.json
      test-receipt.json
    provider.lock
```

原始 Provider 运行产物保存在 `development-provider/` 子目录。Finalize 额外在 Story Runtime 已允许的 `<attemptRoot>/evidence/` 中生成一个 Runtime 控制的正式证据投影：

```text
development-provider-result-evidence.json
```

该投影只保存 Provider execution、Profile/model、Worktree、candidate 和 passed test 的身份、原始路径与 SHA-256，不复制 stdout、stderr、源码或潜在凭据。正式 result 的带路径 `records` 只引用该标准 evidence 文件；不得直接引用 `development-provider/executions/**` 或 `development-provider/evidence/**`。

原始目录布局为：

```text
.harness/runs/<runId>/phases/03-implementation/attempts/<dispatchId>/development-provider/
  prepared/
    request.json
    context-manifest.json
    response.schema.json
    binding.json
    worktree-baseline.json
  executions/<providerExecutionId>/
    execution-claim.json
    response.json
    execution-receipt.json
    stdout.jsonl
    stderr.txt
  evidence/
    worktree-after.json
    candidate-manifest.json
    provider-diagnostics.json
    test-receipt.json
  provider.lock
```

新增 Schema：

```text
agent-development-request.schema.json
agent-development-context.schema.json
agent-development-response.schema.json
agent-development-execution-receipt.schema.json
agent-development-candidate-manifest.schema.json
agent-development-test-receipt.schema.json
agent-development-receipt.schema.json
```

正式候选回执：

```text
.harness/runs/<runId>/worktrees/<taskId>/development-provider-receipt.json
```

该 receipt 明确记录：

```text
executorKind=development-provider
providerRequestId
providerExecutionId
role/profile/model
baseCommit/headCommit
candidate files
implementation notes/result candidates
worktree baseline/after hashes
test receipt
outcome=ready-for-integration
```

## 12. 与 M5-B2 集成

M5-B2 当前只接受 M5-B1 `ready-for-integration` receipt。M8-B 扩展为：

```text
Mock Worker receipt v1
OR Development Provider receipt v1
-> normalizeCandidateSource()
-> 统一 identity、base、result 和 files
-> 既有 bundle/plan/status/apply
```

归一化后仍执行既有门禁：

- State/task/checkpoint 身份。
- Worktree plan/status。
- baseCommit。
- 候选哈希。
- 测试通过回执。
- Runtime 生成的 implementation notes/result 候选。
- 主树目标为 base 或候选。
- 用户批准和 `ConfirmApply`。
- result-last。

M8-B 不把开发 Provider receipt 写成 Worker receipt，也不修改历史 M5 fixture。

### 12.1 候选来源发现与归一化

单任务 M5-B2 使用固定路径发现候选来源：

```text
legacy:
.harness/runs/<runId>/worktrees/<taskId>/execution-receipt.json
.harness/runs/<runId>/worktrees/<taskId>/input-manifest.json

development:
.harness/runs/<runId>/worktrees/<taskId>/development-provider-receipt.json
```

仅存在 legacy 文件时按原 v1.0 路径执行；仅存在 development receipt 时按 M8-B 路径执行；两类 receipt 同时存在时失败关闭，不按时间或文件顺序猜测来源。

两类来源只在 Runtime 内归一化为：

```text
storyId
runId
taskId
dispatchId
phase
ownerAgent
baseCommit
headCommit
outcome
resultEvidenceFile
resultSha256
files[]
sourceReceiptFile
sourceReceiptSha256
contextEvidenceFile
contextEvidenceSha256
```

其中 legacy 的 `contextEvidenceFile/Sha256` 映射到 `input-manifest.json`，development 的对应字段映射到 candidate manifest；development receipt 还必须额外深检 passed test receipt，但不把该字段伪装进 legacy receipt。

### 12.2 Integration plan 版本

`worktree-integration-plan` v1.0 与历史 legacy fixture 保持不变。M8-B 只为 development source 增加 v1.1，使用以下通用来源字段替代 v1.0 的 Worker 专用字段：

```text
candidateSourceKind=development-provider
candidateSourceReceiptFile
candidateSourceReceiptSha256
candidateContextFile
candidateContextSha256
resultEvidenceFile
resultEvidenceSha256
```

Integration receipt 继续使用 v1.0，因为它已经绑定 `planSha256`。Plan、Status、Apply 或恢复重放时，Runtime 必须重新读取并校验原始 development request、candidate manifest、passed test receipt、notes/result 候选及 source receipt 的当前哈希；只信任 plan 内复制字段不构成通过。

## 13. 正式 implementation result

Agent 不直接生成正式 `result.json`。测试通过后，Development Provider Runtime 根据：

- 冻结 task。
- Agent response。
- candidate manifest。
- 测试 receipt。

生成受哈希绑定的 implementation notes 和严格 phase result 候选，并将其写入 Development Provider receipt。M5-B2 将业务候选、implementation notes 和 result 候选一起固化为内容寻址 bundle，按以下稳定顺序集成：

```text
业务候选
-> implementation notes
-> 正式 result.json
-> integration receipt
```

implementation payload 保持现有 `dispatch-result-v2` 严格契约，不增加字段：

```text
taskUpdates
actualFiles
method
exceptionReason
notes
```

其中 `taskUpdates`、`actualFiles`、`method` 和 `exceptionReason` 保存既有实现事实；`notes` 只写简短的人类可读结论。Provider Profile、requested/reported model、Worktree、candidate 和 test 身份不进入 payload，而是由 result 顶层 `records` 引用 `<attemptRoot>/evidence/development-provider-result-evidence.json`。Integration 在 result 候选之后发生，其事实继续由 M5-B2 integration plan/receipt 独立记录，不能反向写入已冻结 result。M8-B 不升级 State v2 或 `dispatch-result-v2` Schema。

测试通过前不得生成 result 候选；M5-B2 完成前主工作树不得出现正式 result。Story Runtime `apply` 仍是唯一 State 推进入口。

## 14. 测试策略

### 14.1 测试选择

Agent 可以执行不会改变 Worktree 的只读搜索和诊断命令，但不得运行会生成 ignored 构建产物的构建或测试命令；发现此类产物时本次 attempt 失败。正式测试只由 Runtime 使用固定 Adapter：

- backend task：优先定向 Maven 测试；没有可靠定向命令时使用批准的 backend 默认命令。
- frontend task：`npx vue-tsc --noEmit` 或 `npm run build`，由现有测试选择策略确定。
- Harness task：仅用于 fixture，不作为真实 backend/frontend developer 角色验收任务。

M8-B 不允许模型生成 shell 命令后由 Runtime直接执行。

### 14.2 执行位置

测试在候选冻结后的同一 Worktree 中运行。测试前确认固定构建输出目录不存在或与冻结 baseline 一致；测试后再次核对候选文件哈希。固定 Adapter 生成的允许构建产物不进入候选，其他 ignored 或普通文件变化均失败关闭。若测试修改候选源码或产生未知文件，结果失败关闭。

### 14.3 可信工具链

正式测试不能使用 Agent 在 Run 阶段生成或修改的工具、依赖或增量产物：

- backend：Maven、JDK 和本机 Maven repository 位于 Worktree 外，由 Runtime 固定发现并记录可执行文件、版本和路径身份；Test 前 `backend/target/` 必须不存在。
- frontend：Runtime 只有在 Prepare 时已对 Worktree 内 `frontend/node_modules/` 建立完整内容寻址快照，并在 Run、Materialize 和 Test 前重验一致时，才允许使用其中依赖；仅比较目录时间或大小不足以通过。
- frontend 缺少可信 `node_modules` 快照或固定依赖来源时返回 `adapter-selection-required`，不临时执行 `npm install`，也不复用 Agent 生成的依赖。
- M8-B 首个真实业务验收优先选择 backend task；frontend 必须先通过 fixture，待可信依赖快照门禁可用后再进行真实 Story 验收。

Run 阶段发现 `node_modules/.bin`、任意依赖包、`backend/target/` 或 `frontend/dist/` 变化时，attempt 失败关闭。Test receipt 必须绑定实际 Maven/JDK 或 frontend dependency snapshot 身份。

### 14.4 结果

测试 receipt 记录：

```text
adapterId
commandId
workingDirectory
exitCode
status
stdout/stderr evidence
candidateBefore/After hashes
```

测试失败时：

- 不集成主树。
- 保留候选和测试证据。
- 不自动调用 Agent 修复。
- 下一 attempt 必须显式创建。

## 15. Runtime 命令与 E2E 动作

新增入口：

```powershell
.\.harness\scripts\run-development-provider.ps1 `
  -Command Status|Prepare|Run|Materialize|Test|Finalize `
  -StateFile <state-file> `
  [-Profile <profile>] `
  [-Model <model>] `
  [-Json]
```

调用方不能传入：

- Worktree 路径。
- sandbox。
- executable。
- argv。
- candidate path。
- test shell。
- integration target。

E2E Runtime 新增动作：

```text
development-worktree-required
development-provider-prepare-required
development-provider-run-required
development-provider-run-in-progress
development-provider-materialize-required
development-provider-test-required
adapter-selection-required
development-provider-finalize-required
development-provider-ready-for-integration
development-provider-retry-decision
development-provider-recovery-required
development-provider-invalid
```

`run-e2e Step` 一次仍只执行一个确定性动作，不自动创建 Worktree、运行真实 Agent、集成或 apply。

## 16. 并发、锁与恢复

### 16.1 claim-first

在启动 Codex 前原子写：

```text
execution-claim.json
```

同一 request 只允许一个执行 claim。父进程在 claim 后崩溃且没有可信 receipt 时，原 request 标记为 indeterminate，不自动重跑。

### 16.2 Worktree 写入所有权

执行期间持有：

```text
development-provider.lock
```

锁绑定 Story、run、task、dispatch、request、execution、Worktree path 和随机 `lockId`。每个正式写点和锁释放前重新验证 owner。

### 16.3 恢复

- 完整 response、receipt 和 after snapshot：重验后进入 Materialize。
- claim-only：生成不可判定证据，不重跑原 request。
- Agent 已写文件但无完整 receipt：只记录污染和诊断，不推断成功。
- candidate manifest 已完成但 test 未运行：可继续 Test。
- test receipt 已完成但开发 receipt 未生成：重验候选哈希后继续 Finalize。
- development receipt 已完成：重验 notes/result/candidate/test 哈希后复用。
- integration 中断：继续由既有 M5-B2 恢复。

遗留锁不自动删除；恢复需要调用者确认旧进程已停止并绑定当前锁哈希。

## 17. 安全边界

### 17.1 能保证

- Agent 主工作目录固定为任务 Worktree。
- 不增加其他可写目录。
- 主树只通过 M5-B2 Runtime 写入。
- 候选必须通过角色和 predictedFiles 双重校验。
- 不执行自动 Git、发布或外部写操作。
- Provider 失败不会推进 State。

### 17.2 不能保证

- `workspace-write` 不是逐文件写 ACL。
- 同一操作系统用户下不构成严格读取隔离。
- 无法证明 Agent 没有读取 Worktree 中其他文件。
- 不提供恶意本地进程级强隔离。
- 不处理断电级 fsync、多文件全局回滚或未知平台差异。

这些边界必须写入 receipt 和最终报告，不得描述为“Agent 只能访问 predictedFiles”。

## 18. TDD 与验证矩阵

| 风险 | 必需测试 |
| --- | --- |
| 错误角色或多任务 | Provider 启动前拒绝 |
| Worktree 缺失或脏 | Prepare 失败且无 request |
| 固定 CLI 参数漂移 | argv 精确断言 |
| Agent 越权文件 | 整个 attempt 失败，无 candidate receipt |
| 删除/重命名/symlink | 失败关闭 |
| `.git`、HEAD 或共享 Git 元数据漂移 | 失败关闭 |
| response 漏报/虚报 | Materialize 失败 |
| timeout/output limit | 终止进程树并记录失败 |
| claim-only | 不重跑原 request |
| backend 工具链污染 | Worktree `target/` 存在或 Maven/JDK 身份漂移时拒绝 Test |
| frontend 依赖污染 | `node_modules` 快照漂移或缺失时拒绝 Test |
| 测试失败 | 不生成 result 候选，不进入 integration |
| 测试修改候选 | 失败关闭 |
| candidate 漂移 | M5-B2 Plan 前拒绝 |
| 双候选来源 | legacy 与 development receipt 同时存在时失败关闭 |
| plan 重放 | 重验原始 request/candidate/test/result/receipt 哈希 |
| 主树目标冲突 | M5-B2 Apply 前拒绝 |
| 模型切换 | 不改变 role/sandbox/path |
| M8-A 回归 | 只读 reviewer 行为不变 |
| M4/M5 回归 | Mock Worker 和既有 receipt 继续通过 |

## 19. 真实验收

M8-B 实施本身由当前 Codex 会话按 TDD 完成。实现、fixture、独立审核通过后，选择一个范围较小的真实业务 Story 进行验收：

- 首个验收选择一个 backend 单任务；frontend 先完成可信依赖快照 fixture。
- predictedFiles 明确且数量有限。
- 不涉及数据库迁移、共享配置、删除或重命名。
- 能使用现有测试命令验证。

真实验收必须证明：

1. Agent 在隔离 Worktree 中直接修改代码。
2. Runtime 收集的候选与 Agent 声明、Git 差异一致。
3. 正式测试通过后才生成 notes/result 候选。
4. 主树只通过受控集成改变，正式 result 最后写入。
5. State 只通过已集成的正式 result apply 推进。
6. 没有越权 Git、发布或外部写操作。

真实业务验收通过前，不把 M8-B 标记为完成，也不启动 M9。

## 20. 预计文件范围

预计新增：

```text
.harness/schemas/agent-development-request.schema.json
.harness/schemas/agent-development-context.schema.json
.harness/schemas/agent-development-response.schema.json
.harness/schemas/agent-development-execution-receipt.schema.json
.harness/schemas/agent-development-candidate-manifest.schema.json
.harness/schemas/agent-development-test-receipt.schema.json
.harness/schemas/agent-development-receipt.schema.json
.harness/scripts/lib/development-provider-context.mjs
.harness/scripts/lib/development-provider-contract.mjs
.harness/scripts/lib/development-provider-runtime.mjs
.harness/scripts/run-development-provider.ps1
.harness/scripts/tests/codex-cli-development-provider.test.mjs
.harness/scripts/tests/development-provider-context.test.mjs
.harness/scripts/tests/development-provider-contract.test.mjs
.harness/scripts/tests/development-provider-runtime.test.mjs
.harness/scripts/tests/development-provider-cli.test.ps1
docs/harness-m8b-development-provider/REPORT.md
```

预计修改：

```text
.harness/config/agent-providers.json
.harness/schemas/agent-provider-config.schema.json
.harness/schemas/worktree-integration-plan.schema.json
.harness/scripts/lib/provider-adapters/codex-cli.mjs
.harness/scripts/lib/provider-config.mjs
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/lib/worktree-integration-runtime.mjs
.harness/scripts/tests/provider-config.test.mjs
.harness/scripts/tests/e2e-runtime.test.mjs
.harness/scripts/tests/worktree-integration-runtime.test.mjs
.harness/scripts/README.md
.harness/README.md
.harness/structure-manifest.yaml
docs/harness-engineering-target-and-gap.md
docs/harness-m7-m12-roadmap/DESIGN.md
docs/harness-m7-m12-roadmap/PLAN.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
llm-knowledge/overview.md
```

实现时只有测试证明必要才能扩大范围。

## 21. 验收标准

M8-B 只有同时满足以下条件才完成：

- 真实 `backend-developer` 或 `frontend-developer` 能在单任务 Worktree 中直接修改代码。
- Agent 不能直接修改主工作树、State 或 Git 历史。
- `workspace-write` 固定且不能被配置扩大。
- 角色策略和 `predictedFiles` 对所有候选生效。
- 越权、删除、重命名、symlink、HEAD 漂移和冻结输入漂移均失败关闭。
- Agent response 与实际差异严格一致。
- 测试失败或候选漂移时不集成。
- Development Provider receipt 能被 M5-B2 严格归一化并受控集成。
- 正式 implementation result 候选只在测试通过后生成，由 M5-B2 最后写入主树，Story Runtime apply 只推进一次。
- M8-A、M4/M5、M7 回归继续通过。
- fixture 和至少一个真实小业务 Story 验收通过。
- 独立只读审核无未解决 BLOCKER/WARNING。
- 文档、结构清单、目标基线和知识同步完成。
- 未执行自动 Git、并行、Fork-Join、发布或部署。

## 22. 下一阶段边界

M8-B 通过后，M9 才可以设计条件式单 Story 并行。M9 应复用已验收的真实开发 Provider 和 M5-D Wave Runtime，但不能因为 M8-B 成功而自动开放：

- 多 Agent 并行。
- 多 Worktree 自动创建。
- 自动冲突解决。
- Worktree 自动回收。
- 自动 Git 或发布。
