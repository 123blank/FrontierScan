# FrontierScan Harness M8-B 单任务开发 Agent Provider 实施计划

> **供 Agent 式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，按本计划逐项执行。每完成一项立即将对应 `- [ ]` 更新为 `- [x]`，不得在末尾一次性批量勾选。
>
> 日期：2026-08-22
>
> 状态：独立只读审核通过，待用户批准实施
>
> 设计依据：`docs/harness-m8b-development-provider/DESIGN.md`
>
> 实施基线：`6c35532 docs(harness): finalize synchronized handoff`

**目标：** 接入单任务、单隔离 Worktree、串行的真实 backend/frontend developer Provider，使 Agent 能直接修改 Worktree，由 Runtime 校验、测试并通过既有 M5-B2 受控集成进入主工作树。

**架构：** 复用 M8-A 的 Provider 配置、模型路由、Codex CLI 进程控制与 claim-first 恢复，新增独立 Development Provider Runtime。Agent 以固定 `workspace-write` 在任务 Worktree 中执行；Runtime 从实际 Git/文件差异生成候选，固定测试通过后生成 notes/result 候选和开发 receipt，再交给 M5-B2 按 result-last 顺序内容寻址集成，最后由 Story Runtime apply。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Codex CLI、Git Worktree、现有 State/Story/E2E/M5 Integration Runtime。

---

## 1. 实施原则

- [x] 所有 Schema、Runtime、Adapter、恢复和集成行为按 RED-GREEN-REFACTOR 实施。
- [x] 每完成一个 checkbox 立即更新本文件。
- [x] M8-B 只允许 `implementation` 阶段的 `backend-developer` 和 `frontend-developer`。
- [x] 首版只处理一个 pending DAG node、一个 Worktree 和串行执行。
- [x] Agent 只直接写 Worktree，主树只由 M5-B2 Runtime 写入。
- [x] 不使用 `--add-dir`、`danger-full-access` 或任意调用方 CLI 参数。
- [x] 不自动创建、reset、clean、删除或回收 Worktree。
- [x] 不实现删除、重命名、symlink、submodule 或二进制候选。
- [x] 不实现 `openai-compatible`、并行、Fork-Join 或自动 Git。
- [x] 真实 `codex exec` 只在 fixture、回归和独立审核通过后执行。
- [x] Git 暂存、提交和推送继续分别获得用户批准。

## 2. Task 0：建立 M8-B State v2 实施 Story

**目标：** 使用现有 Harness 自身记录 M8-B 实施，不手工编辑 State。

**运行资产：**

```text
.harness/states/e2e-M8-B-001.json
.harness/runs/M8-B-001/
```

- [x] **0.1 核对 Git 与活动 State**

运行：

```powershell
git status --short --branch
.\.harness\scripts\run-state.ps1 -Command status -Json
```

预期：

- 当前分支与远端状态已现场确认。
- 工作区没有无法归属的修改。
- 不覆盖未完成 Story。

- [x] **0.2 初始化 M8-B-001**

摘要固定为：

```text
实现单任务隔离 Worktree 写入型开发 Agent Provider
```

- [x] **0.3 完成 requirement**

required criterion 至少包括：

```text
AC-M8B-REAL-DEVELOPER
AC-M8B-WORKTREE-ONLY
AC-M8B-PREDICTED-FILE-GATE
AC-M8B-CANDIDATE-TEST
AC-M8B-CONTROLLED-INTEGRATION
AC-M8B-RECOVERY
AC-M8B-MODEL-ROUTING
AC-M8B-REAL-STORY
```

- [x] **0.4 完成 technical-design**

将已批准 `DESIGN.md` 的决策、影响区域、知识快照和风险投影到 State。

- [x] **0.5 完成 task-dag**

DAG 必须：

- 将 Schema/contract、Codex Adapter、Runtime、integration、E2E/CLI、验收收口拆为串行节点。
- 每个节点包含稳定 criterion 引用和 `predictedFiles`。
- 不包含 backend/frontend 业务源码。
- 不声明并行 wave。

- [x] **0.6 推进到 implementation**

验证：

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-M8-B-001.json
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .\.harness\runs\M8-B-001\phases\02-task-dag\task-dag.json
```

## 3. Task 1：Development 配置与角色路由

**目标：** 在不扩大配置权限的情况下，让开发角色选择 Profile 和模型。

**文件：**

```text
Modify .harness/config/agent-providers.json
Modify .harness/schemas/agent-provider-config.schema.json
Modify .harness/scripts/lib/provider-config.mjs
Modify .harness/scripts/tests/provider-config.test.mjs
```

- [x] **1.1 编写开发角色绑定 RED**

覆盖：

- `backend-developer` 和 `frontend-developer` 能绑定已有 Profile。
- 未配置角色时使用 `defaultProfile`。
- 本地角色绑定覆盖项目绑定。
- 单次 Profile/Model 覆盖保持最高优先级。

- [x] **1.2 编写权限不可配置 RED**

拒绝 Profile 中出现：

```text
sandbox
workingDirectory
addDir
executable
argv
prompt
writePaths
environment
```

- [x] **1.3 运行 RED**

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
```

预期：新增开发角色用例失败，原因是角色执行许可仍固定为 reviewer。

- [x] **1.4 实现最小配置扩展**

只扩展允许执行的角色集合和默认 roleBindings，不增加新 Adapter 或 Profile 字段。

- [x] **1.5 运行 GREEN**

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
```

预期：PASS。

## 4. Task 2：Development 契约与 Schema

**目标：** 建立 request/context/response/receipt/candidate/test 的严格契约。

**新增文件：**

```text
.harness/schemas/agent-development-request.schema.json
.harness/schemas/agent-development-context.schema.json
.harness/schemas/agent-development-response.schema.json
.harness/schemas/agent-development-execution-receipt.schema.json
.harness/schemas/agent-development-candidate-manifest.schema.json
.harness/schemas/agent-development-test-receipt.schema.json
.harness/schemas/agent-development-receipt.schema.json
.harness/scripts/lib/development-provider-contract.mjs
.harness/scripts/tests/development-provider-contract.test.mjs
```

- [x] **2.1 编写 request/context RED**

覆盖：

- phase 必须为 `implementation`。
- role 只能是 backend/frontend developer。
- taskId、preparedRevision、DAG、Worktree plan/status、baseCommit 和哈希必需。
- worktreePath 必须由 Runtime 固定。
- policy、Profile、requestedModel、modelSource 和 configSha256 必需。
- 额外字段失败。

- [x] **2.2 编写 response RED**

覆盖：

- `declaredFiles` 只允许 `create/update`。
- 路径唯一且仓库相对。
- `developmentMethod=tdd` 时 exception reason 必须为空。
- `developmentMethod=exception` 时 reason 必须非空。
- role、phase、request 和 dispatch 身份漂移失败。
- response 不允许文件内容、patch、shell 或任意工具命令字段。

- [x] **2.3 编写 receipt/manifest RED**

覆盖：

- execution receipt 绑定 request/execution/model/argv/sandbox/worktree。
- candidate manifest 绑定 baseline、after snapshot、Git status 和候选哈希。
- test receipt 绑定候选 manifest 和固定 Adapter。
- development receipt 绑定 request、execution、candidate、test 和 notes/result 候选。
- receipt 必须声明 `writeIsolation=task-worktree-workspace-write`。
- receipt 不得声称逐文件 ACL、严格读取隔离或 Agent 无法写 Git，只能声明 Runtime 未观察到受检查 Git 事实漂移。

- [x] **2.4 运行 RED**

```powershell
node .\.harness\scripts\tests\development-provider-contract.test.mjs
```

预期：因契约模块缺失失败。

- [x] **2.5 实现严格契约**

要求：

- JSON Schema `additionalProperties=false`。
- 共享路径、SHA-256、UTF-8、字节数和身份校验复用现有 helper。
- 不引入通用 Schema 框架。

- [x] **2.6 运行 GREEN**

```powershell
node .\.harness\scripts\tests\development-provider-contract.test.mjs
```

预期：PASS。

## 5. Task 3：冻结 Development Context

**目标：** 只从 State、DAG、知识、角色和 Worktree 事实生成可复核输入。

**新增文件：**

```text
.harness/scripts/lib/development-provider-context.mjs
.harness/scripts/tests/development-provider-context.test.mjs
```

- [x] **3.1 编写角色与任务 RED**

拒绝：

- 非 implementation phase。
- 多个 pending node。
- owner 不是 backend/frontend developer。
- 空 `predictedFiles`。
- criterion 引用不完整。

- [x] **3.2 编写 Worktree RED**

拒绝：

- plan/status 缺失或哈希漂移。
- Worktree 未创建、branch/HEAD/base 不匹配。
- Worktree 初始 dirty。
- `.git` 文件异常。
- junction、symlink、submodule 或嵌套 Git。
- 冲突的 create/integrate/retire/provider lock。

- [x] **3.3 编写上下文边界 RED**

覆盖：

- 加载 requirement、technical-design、task、DAG node、AGENTS、角色策略和 relevant knowledge。
- backend/frontend 只加载目标区域必要文件。
- 单文件 2 MiB、总量 8 MiB。
- stale relevant knowledge 阻止 Prepare。
- 不读取聊天、`.env`、本地 Provider 配置内容或凭据。

- [x] **3.4 编写 baseline RED**

baseline 必须记录：

- branch/HEAD/baseCommit。
- `git-dir`、`git-common-dir`、Worktree index、共享 Git config、`packed-refs` 和当前 branch ref 的可观察身份。
- 固定格式的完整 `git for-each-ref` 输出 SHA-256。
- Git status。
- tracked 和非忽略普通文件。
- ignored 路径类型、大小和时间元数据，不读取潜在密钥内容。
- `.git` 文件哈希。
- predicted target base 哈希。
- 固定测试构建输出目录。
- Provider Run 前后的 ignored 路径必须完全一致。
- 固定构建输出目录只允许在 Runtime Test 阶段产生。

- [x] **3.5 运行 RED**

```powershell
node .\.harness\scripts\tests\development-provider-context.test.mjs
```

- [x] **3.6 实现 Context Builder**

复用现有：

- Worktree Runtime 的计划与状态推导。
- role policy。
- source fingerprint 和知识状态。
- 路径规范化、普通文件和 symlink 检查。

- [x] **3.7 运行 GREEN**

```powershell
node .\.harness\scripts\tests\development-provider-context.test.mjs
```

## 6. Task 4：Codex CLI workspace-write Adapter

**目标：** 在不改变 M8-A read-only 行为的前提下，增加固定的 Worktree 写入执行。

**文件：**

```text
Modify .harness/scripts/lib/provider-adapters/codex-cli.mjs
Create .harness/scripts/tests/codex-cli-development-provider.test.mjs
```

- [x] **4.1 编写固定 argv RED**

精确断言：

```text
exec
--approve-for-me
--ephemeral
--ignore-user-config
--output-schema <schema>
--json
--cd <worktree>
```

当前验收的 Codex CLI `0.148.0` 中，`--approve-for-me` 隐式使用 `workspace-write` sandbox，不能与显式 `--sandbox workspace-write` 同时传入。测试仍需断言 execution receipt 记录 `sandbox=workspace-write`，并确认 M8-A 的显式 `--sandbox read-only` 未漂移。

断言不存在：

```text
--add-dir
danger-full-access
dangerously-bypass
调用方额外 argv
```

- [x] **4.2 编写 cwd 与路径 RED**

拒绝：

- 非绝对 Worktree path。
- Worktree path 与冻结 request 不一致。
- schema 不在冻结 prepared 目录。
- executable 不是已验证 Codex。

- [x] **4.3 编写进程控制 RED**

覆盖：

- spawn 失败。
- timeout。
- stdout/stderr 上限。
- 非零退出。
- JSONL 损坏。
- Structured response 非法。
- 子进程持续打开输出。
- `onSpawn` claim 失败。

- [x] **4.4 编写 M8-A 回归 RED/GREEN 基线**

先运行：

```powershell
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
```

记录当前通过结果，后续每次 Adapter 修改后重跑。

- [x] **4.5 实现 workspace 执行函数**

要求：

- 复用现有 executable discovery、环境白名单、脱敏、超时和进程树终止。
- 保持既有 `runCodexCli()` 和 `buildCodexCliArgs()` 只读语义不变。
- 新函数不创建额外可写目录。

- [x] **4.6 运行 GREEN**

```powershell
node .\.harness\scripts\tests\codex-cli-development-provider.test.mjs
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
```

预期：全部 PASS。

## 7. Task 5：Development Provider Runtime Prepare/Status

**目标：** 建立 attempt 路径、冻结输入、锁和唯一状态判定。

**新增文件：**

```text
.harness/scripts/lib/development-provider-runtime.mjs
.harness/scripts/tests/development-provider-runtime.test.mjs
```

- [x] **5.1 编写 Status RED**

状态至少覆盖：

```text
development-worktree-required
development-provider-not-prepared
development-provider-ready
development-provider-run-in-progress
development-provider-materialize-required
development-provider-test-required
adapter-selection-required
development-provider-finalize-required
development-provider-ready-for-integration
development-provider-failed
development-provider-indeterminate
development-provider-invalid
```

- [x] **5.2 编写 Prepare 原子性 RED**

覆盖：

- prepared 临时目录。
- request/context/schema/baseline 全部完成后原子提升。
- 任一写入失败不留下可消费 bundle。
- 重复 Prepare 相同事实复用。
- revision、DAG、Worktree、配置或模型来源漂移拒绝。

- [x] **5.3 编写锁 RED**

覆盖：

- provider lock 与随机 lockId。
- 同 task 并发 Prepare/Run/Materialize/Test/Finalize 串行化。
- 遗留锁只报告。
- 旧 owner 在锁替换后不能写 receipt 或释放新锁。

- [x] **5.4 运行 RED**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
```

- [x] **5.5 实现 Status/Prepare**

不启动 Agent、不创建 Worktree、不修改 State。

- [x] **5.6 运行 GREEN**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
```

## 8. Task 6：Run、claim-first 与执行恢复

**目标：** 安全启动真实或注入式 Codex Adapter，并按磁盘事实恢复。

- [x] **6.1 编写 claim-first RED**

覆盖：

- claim 在 spawn 前持久化。
- 一个 request 只允许一个 execution。
- claim-only 不重跑。
- response/receipt 身份必须与 request 一致。

- [x] **6.2 编写 execution receipt RED**

receipt 记录：

```text
providerRequestId/providerExecutionId
adapter/adapterVersion
requestedModel/reportedModel/modelSource
sandbox=workspace-write
workingRoot
startedAt/finishedAt/exitCode/status
stdout/stderr evidence
writeIsolation
```

- [x] **6.3 编写失败分类 RED**

分类：

```text
failed
timed-out
invalid-response
output-limit
integrity-violation
execution-indeterminate
```

- [x] **6.4 实现 Run**

只有完整 prepared bundle 和可用 owner lock 才启动 Adapter。

- [x] **6.5 运行专项测试**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
node .\.harness\scripts\tests\codex-cli-development-provider.test.mjs
```

## 9. Task 7：候选差异收集与 Materialize

**目标：** 从实际 Worktree 变化生成可信候选，不信任 Agent 文本。

- [x] **7.1 编写合法 update/create RED**

覆盖：

- 已有 backend/frontend 文件更新。
- predictedFiles 内新文件。
- Agent declaration 与实际差异一致。
- UTF-8、2 MiB 单文件和 8 MiB 总量。

- [x] **7.2 编写越权 RED**

拒绝：

- predictedFiles 外修改。
- backend/frontend 跨区修改。
- `.harness/states`、request、context 或 Schema 修改。
- `.git`、branch、HEAD、index、`git-dir`、`git-common-dir`、共享 Git config 或当前 branch ref 漂移。
- 未声明文件和虚假声明。

- [x] **7.3 编写不支持变化 RED**

拒绝：

- 删除。
- 重命名。
- symlink/junction/reparse point。
- submodule/嵌套 Git。
- 二进制或非法 UTF-8。
- 未知临时文件。
- Run 阶段任何 ignored 路径变化，包括 `node_modules/.bin`、依赖包、`target/` 和 `dist/`。
- `.env`、本地配置或其他 ignored 路径变化。

- [x] **7.4 编写污染恢复 RED**

断言：

- 不生成成功 candidate manifest/receipt。
- 不自动 reset/clean/delete。
- 保存 before/after/Git diagnostics。
- 返回 recovery-required。

- [x] **7.5 实现 Materialize**

生成：

```text
worktree-after.json
candidate-manifest.json
provider-diagnostics.json
```

- [x] **7.6 运行专项测试**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
```

## 10. Task 8：固定测试 Adapter 与 Test

**目标：** 候选冻结后运行机器选择的测试，模型不能提供任意 shell。

- [x] **8.1 编写测试选择 RED**

覆盖：

- backend/frontend 角色映射到现有允许的测试策略。
- 调用方不能传 command、shell 或 cwd。
- 无可靠 Adapter 时返回 adapter-selection-required，不自动猜测。

- [x] **8.2 编写候选完整性 RED**

测试前固定构建输出目录必须不存在或匹配冻结 baseline。测试前后候选哈希必须一致。测试修改源码、生成未知文件或改变 Git identity 时失败。

- [x] **8.3 编写可信工具链 RED**

覆盖：

- backend Maven/JDK/.m2 从 Worktree 外固定发现并绑定路径与版本身份。
- backend Test 前 `target/` 存在时失败。
- frontend `node_modules` 必须在 Prepare 完整内容寻址，Run/Materialize/Test 前重验。
- 修改 `node_modules/.bin`、依赖包、`target/` 或 `dist/` 失败。
- frontend 缺少可信依赖快照时返回 `adapter-selection-required`，不执行 `npm install`。

- [x] **8.4 编写测试结果 RED**

覆盖：

- passed。
- failed。
- timed-out。
- output-limit。
- interrupted。
- receipt 重放。

- [x] **8.5 实现 Test**

复用现有测试选择和固定 Adapter，不新增模型生成命令执行器。只有 Test 阶段允许固定构建输出目录变化。

- [x] **8.6 运行专项测试**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
```

## 11. Task 9：Finalize、Development receipt 与 result 候选

**目标：** 只在测试通过后生成 implementation notes/result 候选和可供集成消费的开发 receipt。

**文件：**

```text
Modify .harness/scripts/lib/development-provider-runtime.mjs
Modify .harness/scripts/tests/development-provider-runtime.test.mjs
```

- [x] **9.1 编写 Finalize 前置 RED**

拒绝：

```text
candidate manifest 缺失
test receipt 缺失或失败
candidate/test/request/execution 哈希漂移
已有不匹配 development receipt
```

- [x] **9.2 编写 notes/result 候选 RED**

Runtime 生成：

```text
implementation-notes.md candidate
result.json candidate
```

result payload 必须严格保持现有字段：

```text
taskUpdates
actualFiles
method
exceptionReason
notes
```

Provider Profile、requested/reported model、execution、candidate 和 test 事实必须通过 result 顶层 `records` 引用以下 Runtime 控制的正式投影，不进入 payload：

```text
<attemptRoot>/evidence/development-provider-result-evidence.json
```

该投影绑定 `development-provider/` 下原始 request、execution、candidate 和 passed test 的路径与 SHA-256。断言 records 直接引用 `development-provider/executions/**` 或 `development-provider/evidence/**` 时，Story Runtime 拒绝 Apply。Integration 事实由后续 M5-B2 plan/receipt 独立记录。State v2 与 `dispatch-result-v2` Schema 保持不变。

- [x] **9.3 编写 result 候选时序 RED**

断言：

- Run 后无 result 候选。
- Materialize 后无 result 候选。
- Test failed 后无 result 候选。
- Test passed 后只有 Finalize 可以生成。
- Agent 不直接写 notes/result。

- [x] **9.4 编写 Development receipt RED**

receipt 必须绑定：

- State/task/checkpoint。
- Worktree plan/status。
- request/execution。
- base/head。
- candidate manifest。
- test passed receipt。
- notes/result 候选。

- [x] **9.5 编写正式 evidence 投影 RED**

覆盖：

- Finalize 在 `<attemptRoot>/evidence/` 生成单一 `development-provider-result-evidence.json`。
- 投影只包含身份、原始 evidence 路径和 SHA-256，不复制日志、源码或凭据。
- result 的带路径 records 只引用该投影。
- 投影或其引用的 request/execution/candidate/test 漂移时拒绝复用。

- [x] **9.6 实现 Finalize**

生成受哈希绑定的 notes/result 候选和：

```text
development-provider-receipt.json
outcome=ready-for-integration
```

- [x] **9.7 运行 GREEN**

```powershell
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
```

## 12. Task 10：M5-B2 归一化与受控集成

**目标：** 让既有内容寻址集成消费真实开发 Provider 候选，并保持历史 Mock Worker 兼容。

**文件：**

```text
Modify .harness/schemas/worktree-integration-plan.schema.json
Modify .harness/scripts/lib/worktree-integration-runtime.mjs
Modify .harness/scripts/tests/worktree-integration-runtime.test.mjs
```

- [x] **10.1 编写双来源 RED**

M5-B2 接受：

```text
legacy Mock Worker receipt
development Provider receipt
```

两者归一化为同一内部 candidate source，不改写旧 receipt。

固定发现规则：

```text
legacy: input-manifest.json + execution-receipt.json
development: development-provider-receipt.json
```

两类 receipt 同时存在时失败关闭。

- [x] **10.2 编写 Development receipt 身份 RED**

拒绝：

- 未测试或测试失败。
- 候选、notes 或 result 漂移。
- Worktree path/HEAD/base 漂移。
- receipt 声称 ready 但文件缺失。
- executorKind 或 Schema 版本未知。

- [x] **10.3 编写 Integration plan v1.1 RED**

断言：

- v1.0 legacy plan 和 fixture 保持不变。
- development source 生成 v1.1 plan。
- v1.1 使用 `candidateSourceKind`、source receipt、candidate context 和 result evidence 的路径与 SHA-256。
- Plan/Status/Apply 重放重新验证原始 request、candidate、passed test、notes/result 和 development receipt 哈希。
- Integration receipt 继续使用 v1.0 并绑定 `planSha256`。

- [x] **10.4 编写主树 result-last RED**

断言集成顺序：

```text
业务文件
-> implementation notes
-> result.json
-> integration receipt
```

M5-B2 完成前主树不得出现正式 result。

- [x] **10.5 实现 normalizeCandidateSource 与 plan v1.1**

复用既有 bundle、status、Apply 和恢复逻辑。

- [x] **10.6 运行 Integration 与 Story 回归**

```powershell
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

## 13. Task 11：PowerShell CLI 与 E2E 动作

**新增文件：**

```text
.harness/scripts/run-development-provider.ps1
.harness/scripts/tests/development-provider-cli.test.ps1
```

**修改文件：**

```text
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/tests/e2e-runtime.test.mjs
```

- [x] **11.1 编写 CLI RED**

支持：

```text
Status
Prepare
Run
Materialize
Test
Finalize
```

拒绝任意 Worktree path、sandbox、argv、candidate 或 test command。

- [x] **11.2 编写 E2E 动作 RED**

implementation 单任务 developer 返回 Development Provider 动作；测试 Adapter 无法可信选择时返回 `adapter-selection-required`；其他认知 phase 和 code-review 继续原行为。

- [x] **11.3 编写幂等 RED**

`run-e2e Step` 一次只返回或执行一个确定性动作，不自动运行真实 Agent、创建 Worktree、集成或 apply。

- [x] **11.4 实现 CLI 与 E2E 映射**

- [x] **11.5 运行 GREEN**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\development-provider-cli.test.ps1
node .\.harness\scripts\tests\e2e-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\e2e-cli.test.ps1
```

## 14. Task 12：纵向 fixture

**目标：** 在临时 Git 仓库证明完整单任务链。

- [x] **12.1 建立 backend fixture**

执行：

```text
State v2 implementation
-> Worktree Plan/Create
-> Development Prepare/Run/Materialize/Test/Finalize
-> Integration Plan/Status/Apply
-> Story Apply
```

断言主树只在 Integration Apply 时改变。

- [x] **12.2 建立 frontend fixture**

验证 frontend role/predictedFiles 和固定测试 Adapter。

- [x] **12.3 建立越权 fixture**

Agent 同时修改合法文件和计划外文件，断言整个 attempt 失败且主树不变。

- [x] **12.4 建立中断 fixture**

覆盖：

- claim-only。
- response 后 receipt 前。
- Materialize 前。
- candidate 后 Test 前。
- Test 后 Finalize 前。
- Finalize 写 notes 后 result 前。
- result 后 development receipt 前。
- development receipt 后 Integration 前。
- Integration 部分应用。

- [x] **12.5 建立模型路由 fixture**

验证 backend/frontend 可使用不同 Profile，但 sandbox、cwd 和角色权限不变。

## 15. Task 13：全量回归

- [x] **13.1 Provider 回归**

```powershell
node .\.harness\scripts\tests\provider-config.test.mjs
node .\.harness\scripts\tests\provider-contract.test.mjs
node .\.harness\scripts\tests\provider-context.test.mjs
node .\.harness\scripts\tests\codex-cli-provider.test.mjs
node .\.harness\scripts\tests\provider-runtime.test.mjs
```

- [x] **13.2 Development Provider 专项**

```powershell
node .\.harness\scripts\tests\development-provider-contract.test.mjs
node .\.harness\scripts\tests\development-provider-context.test.mjs
node .\.harness\scripts\tests\codex-cli-development-provider.test.mjs
node .\.harness\scripts\tests\development-provider-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\development-provider-cli.test.ps1
```

- [x] **13.3 State/Story/E2E 回归**

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
```

- [x] **13.4 Worktree/Integration 回归**

```powershell
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
```

- [x] **13.5 结构与差异门禁**

```powershell
.\.harness\scripts\validate-structure.ps1
.\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

## 16. Task 14：独立只读代码审核

- [x] **14.1 准备 owned diff**

只包含 M8-B 配置、Schema、Runtime、测试和文档。

- [x] **14.2 启动 M8-A code-reviewer Provider**

使用真实只读 Provider 审核 M8-B task-owned diff。

- [x] **14.3 独立人工/Agent 复核**

重点检查：

- workspace-write 目录边界。
- predictedFiles 越权。
- `.git`、HEAD、完整 refs 集合和共享 Git 元数据漂移。
- claim-first。
- 污染 Worktree 恢复。
- test-before-integration。
- development receipt 归一化。
- M8-A 回归。

- [x] **14.4 关闭 findings**

所有 BLOCKER/WARNING 必须修复或按当前审核规则明确关闭，并重跑受影响测试。

## 17. Task 15：真实 Codex CLI fixture

- [x] **15.1 确认真实调用前置**

- 本机 Codex CLI 可用。
- fixture Worktree 已获批准创建。
- 不包含业务凭据。
- 模型/Profile 来源明确。

- [x] **15.2 执行真实开发 Provider**

在临时或专用验收 Worktree 中完成一个小型 create/update 任务。

- [x] **15.3 验证实际写入**

证明：

- Agent 直接修改了 Worktree。
- 主树在集成前不变。
- response 与实际差异一致。
- candidate/test receipt 完整。

- [x] **15.4 验证失败边界**

使用测试 Adapter 或受控 fixture 验证越权写入不会进入主树，不要求真实模型故意越权。另在临时 linked Worktree 验证 Agent 尝试 `git branch m8b-probe`、`git config --local m8b.probe true`、`git add --all` 和 `git commit --allow-empty -m m8b-probe` 时，要么被 sandbox 拒绝，要么被 Runtime 的 `git-dir`/`git-common-dir`/ref/index 对账发现；报告不得夸大为绝对 Git 隔离。

验收结果：真实 `codex-custom/gpt-5.6-sol` fixture 在 `workspace-write` 任务 Worktree 中只修改 `backend/src/main/java/example/Service.java`，完成固定 Maven 测试、候选冻结、开发回执、M5-B2 受控集成和 Story Apply，最终进入 `unit-test`。独立 Git 探针证明上述四类 Git 操作均被 sandbox 拒绝或被 Runtime 基线对账识别。

## 18. Task 16：真实业务 Story 验收

**目标：** 证明 M8-B 能参与真实业务开发闭环。

- [x] **16.1 选择真实 Story**

要求：

- 首个验收选择单 backend task；frontend 先通过 fixture，具备可信 dependency snapshot 后再选择真实 frontend Story。
- predictedFiles 明确。
- 不涉及迁移、共享配置、删除或重命名。
- 有可运行的现有测试。

- [x] **16.2 使用 State v2 初始化 Story**

按正常九阶段流程执行，不手工编辑 State。

- [x] **16.3 implementation 使用 Development Provider**

执行：

```text
Prepare -> Run -> Materialize -> Test -> Finalize
-> Integration Plan/Status/Apply
-> Story Apply
```

- [x] **16.4 完成后续质量阶段**

完成 unit-test、M8-A code-review、build、interface verification 和 delivery preparation。

- [x] **16.5 闭包核验**

```powershell
.\.harness\scripts\verify-story-closure.ps1 -StateFile <state-file>
```

最终 State 必须 `done/completed`，Git 可保持 `not-requested`。

## 19. Task 17：文档与知识收口

- [x] **17.1 新建 REPORT.md**

记录：

- 实现范围。
- 真实 Provider execution。
- fixture 和真实 Story。
- findings 与修复。
- 测试与验收。
- 安全边界和剩余限制。

- [x] **17.2 更新 Runtime 文档**

```text
.harness/README.md
.harness/scripts/README.md
```

- [x] **17.3 更新路线与交接**

```text
docs/harness-engineering-target-and-gap.md
docs/harness-m7-m12-roadmap/DESIGN.md
docs/harness-m7-m12-roadmap/PLAN.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
```

- [x] **17.4 刷新知识**

按实际 common/Harness 变更执行正式知识刷新，保留 `custom/`。

- [x] **17.5 最终结构校验**

```powershell
.\.harness\scripts\validate-structure.ps1
.\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

## 20. Task 18：M8-B 完成门禁

- [x] 真实 backend/frontend developer Provider 已接入。
- [x] Agent 只直接写任务 Worktree。
- [x] 主树只通过 M5-B2 受控集成改变。
- [x] predictedFiles 和 role policy 对全部候选生效。
- [x] 删除、重命名、symlink 和越权修改失败关闭。
- [x] claim-only 不重跑原 request。
- [x] 测试失败不集成。
- [x] Development receipt 与 M5-B2 集成可审计恢复。
- [x] result 候选只在测试通过后生成，由 integration 最后写入主树并只 apply 一次。
- [x] 模型路由不能扩大权限。
- [x] M8-A 和 M4/M5/M7 回归通过。
- [x] 真实 Codex fixture 通过。
- [x] 至少一个真实业务 Story 闭环通过。
- [x] 最终独立审核无 BLOCKER/WARNING。
- [x] 文档、结构清单和知识均已同步。
- [x] 未执行自动 Git、并行、Fork-Join、发布或部署。
- [x] 用户批准后才允许进入 M9 设计。

## 21. 建议提交边界

以下只是建议的逻辑提交，不构成 Git 授权：

```text
test(harness): define M8-B development provider contracts
feat(harness): add workspace-write development provider runtime
feat(harness): integrate development provider candidates
test(harness): verify M8-B real provider workflow
docs(harness): complete M8-B development provider
```

每次实际 `git add`、`git commit` 和 `git push` 都必须重新获得用户明确批准。
