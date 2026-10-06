# FrontierScan Harness M7-B 最小确定性串行驱动器设计

> 日期：2026-08-13
>
> 状态：设计完成，已通过独立只读评审，无 BLOCKER/WARNING
>
> 路线基线：`docs/harness-m7-m12-roadmap/DESIGN.md`
>
> 前置里程碑：M7-A1、M7-A2、M7-A3、M7-A4 已实施并通过独立只读审核
>
> 实施基线：`fe210dc feat(harness): implement M7-A4 delivery semantics`

## 1. 目标与防偏移说明

M7-B 对应长期目标中的“外部程序串联流程，程序在需要认知时暂停并交给 AI”。本阶段只增加一个位于现有 State Runtime 和 Story Runtime 之上的薄编排层：

```text
读取并验证 State
-> 判定唯一下一动作
-> 准备或复用当前阶段 task
-> 可选执行 task 明确允许的固定 Adapter
-> 认知任务返回给当前 Codex 会话
-> result 就绪后委托现有 apply
```

本阶段不实现：

- 真实 Agent Provider 或 Agent 自动派发。
- 自动生成认知阶段的 Markdown、`result.json` 或业务代码。
- 任意 shell、模型生成命令或调用方自定义命令。
- Worktree、并行、Fork-Join、Docker、发布或 Git 写操作。
- knowledge stale 刷新和 `accepted-stale`，属于 M7-C。
- 修改 State 投影、质量门禁、approval receipt 或 delivery receipt 语义。

知识新鲜度在实施开始时为 `stale-or-incomplete`。M7-B 只依赖当前源码、State 和版本化 workflow，不把知识状态误报为 fresh，也不提前实现 M7-C。

## 2. 当前问题

现有 `run-state.ps1` 和 `run-story.ps1` 已具备严格状态与阶段协议，但调用者仍需手工判断：

- 当前是否需要 `prepare`。
- task 已准备后应等待认知结果、运行哪个 Adapter，还是执行 `apply`。
- result 缺失、失败、阻塞或已经应用时应该如何恢复。
- State 已阻塞、已完成或需要用户批准时是否必须停止。

这些判断如果只存在于聊天上下文，新会话仍可能选择不同命令或遗漏安全边界。M7-B 的作用是把判断固化为确定性程序，而不是重新实现已有 Runtime。

## 3. 采用方案

### 3.1 薄编排层

新增：

```text
.harness/scripts/run-e2e.ps1
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/tests/e2e-runtime.test.mjs
```

`e2e-runtime.mjs` 只调用公开的 `runStoryCommand inspect/prepare/apply`。State 的读取、task/result/checkpoint 校验、approval receipt 校验、跨阶段恢复识别、写锁、投影、门禁和推进继续由现有 Runtime 负责。

`story-runtime.mjs` 增加最小只读 `inspect` 接口，因为只有 Story Runtime 拥有完整阶段协议。该接口返回经过完整校验的 dispatch 语义，不决定 E2E 用户动作。E2E 驱动器只把 inspection 映射为动作，从而避免复制或绕过私有契约。

不采用外部 YAML 动作 DSL。M7-B 只有九阶段线性 v2 workflow，新增 DSL 会复制 workflow 和 Runtime 事实。

### 3.2 三个命令

#### `Status`

纯读取。返回：

```text
schemaVersion
command
storyId
runId
stateFile
phase
stateStatus
revision
action
reason
taskFile
resultFile
allowedAdapters
approval
```

`action` 只允许：

```text
completed
blocked
prepare
cognitive-action-required
adapter-selection-required
apply-result
approval-required
failed-result
```

`Status` 不直接读取 task/result/checkpoint，不创建 task，不写 checkpoint，不执行 Adapter，不修改 State。它只消费 `runStoryCommand({command: "inspect"})` 的已验证结果。

#### `Step`

执行一个且仅一个确定性动作：

- `prepare`：调用 `runStoryCommand({command: "prepare"})`，随后返回 `cognitive-action-required` 或 `adapter-selection-required`。
- `apply-result`：调用现有 `apply`，随后重新判定下一动作。
- 其他动作：不执行副作用，原样返回。

首版不自动选择 Adapter。Story inspection 根据现有阶段门禁和 `checkpoint.adapterRuns` 返回：

- `adapter-required`：当前阶段尚缺至少一个合格的 Adapter 结果。
- `awaiting-result`：Adapter 门禁已满足或当前阶段不要求 Adapter，仍需认知产物。
- `result-ready`：result 及相关 evidence 已完整校验，可 apply。

E2E 驱动器将 `adapter-required` 映射为 `adapter-selection-required`，并返回仍可选择的固定白名单。Adapter 已通过后不会再次返回该动作。允许列表仍不表示应自动选择哪一个 Adapter。

#### `Apply`

显式消费当前 attempt 的正式 `result.json`，委托 `runStoryCommand({command: "apply"})`，再返回推进后的唯一下一动作。

`Apply` 是便捷入口，不增加新的投影或写事务。`Step` 在动作已经是 `apply-result` 时与 `Apply` 语义相同。

## 4. 动作判定

判定顺序固定：

1. State 或 workflow 校验失败：命令失败，零写入。
2. `runtime.status=completed` 或 `phase=done`：`completed`。
3. `runtime.status=blocked` 或 `phase=blocked`：`blocked`，返回 `activeBlock` 摘要。
4. 非 State v2：失败关闭；M7-B 不驱动历史 v1。
5. Story inspection 返回 `not-prepared`：`prepare`。
6. inspection 返回 `adapter-required`：`adapter-selection-required`。
7. inspection 返回 `awaiting-result`：`cognitive-action-required`。
8. inspection 返回 `approval-required`：`approval-required`。
9. inspection 返回 `result-ready` 或 `recovery-required`：`apply-result`。
10. inspection 返回 `failed-result`：`failed-result`。

task、checkpoint、result、revision、dispatch、output/evidence、Adapter evidence、approval receipt 和跨阶段恢复候选均由 Story Runtime inspection 完整验证。损坏或漂移直接失败关闭，不返回可执行动作。

### 4.1 approval 判定

M7-B 首版只识别已经结构化存在的批准需求：

- `interface-verification` result 中任意 case 为 `accepted-with-known-gaps` 且缺少有效正式 approval 时，inspection 返回 `approval-required`。
- 返回 case ID 列表、批准类型 `verification-gap` 和现有 `approve-gap` 命令提示。
- 已引用 approval 时，inspection 必须复用正式 approval 校验，核对 receipt、subject、evidence、dispatch、revision 和哈希；缺失或漂移不得被视为可 apply。
- 驱动器不生成批准、不把普通认知问题推断为批准点、不读取 Markdown 猜测风险。

`build-publish` 的真实发布不由驱动器执行；认知结果必须将外部操作如实记录。由于 M7-B 没有发布 Adapter，因此不会自动越过发布批准。

## 5. 一致性与安全

- 每次命令都重新读取并验证 State，不缓存聊天上下文。
- `Status` 只读；测试比较 State、指针、事件和 attempt 文件均不变化。
- `Step` 最多调用一次现有写命令，不循环推进多个阶段。
- `Apply` 不接受调用方提供 dispatch ID、phase、owner、shell 或任意结果路径。
- result 路径只能来自 inspection 返回的当前或恢复 attempt；所有身份、revision、哈希、输出和 approval 校验复用 Story Runtime。
- 重复 `Step`：
  - 同 revision 的 prepare 复用同一 attempt。
  - 已应用 result 由 Story Runtime 返回 `already-applied` 或基于新阶段返回下一动作。
  - 不重复增加 State records。
- 驱动器输出是即时决策结果，不作为新的事实来源持久化。

## 6. 公共接口

PowerShell：

```powershell
.\.harness\scripts\run-e2e.ps1 -Command Status -StateFile <state> -Json
.\.harness\scripts\run-e2e.ps1 -Command Step -StateFile <state> -Json
.\.harness\scripts\run-e2e.ps1 -Command Apply -StateFile <state> -Json
```

Node：

```js
runE2ECommand({
  root,
  command: "status" | "step" | "apply",
  stateFile,
});
```

PowerShell 只做参数白名单、命令名映射和退出码传播。

## 7. 测试策略

按 TDD 分批覆盖：

1. Story `inspect` 对未准备、认知、Adapter、result、approval、恢复、blocked、done 的只读判定。
2. `Step` 只准备一次，并复用同 revision attempt。
3. `Apply` 委托现有 Runtime，推进一个阶段，不循环推进。
4. failed result、缺失 result、revision 漂移和损坏 attempt 零 State 写入。
5. verification gap 缺批准时返回 `approval-required`。
6. PowerShell 参数拒绝和 JSON 输出。
7. smoke 使用最小合法 payload 和固定 Adapter fixture 驱动全部九阶段到 `done`，并逐阶段断言 `prepare -> cognitive/adapter -> apply`。

回归至少覆盖：

```powershell
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

## 8. 验收标准

- 新会话只读取 State，即可得到唯一下一动作。
- 九阶段使用同一入口，不在驱动器中复制九套业务投影。
- 认知任务明确暂停，不被脚本伪造成完成。
- approval 缺失时明确停止。
- 重复执行不重复推进、不重复记录、不创建新 attempt。
- 脚本失败、result 缺失或身份漂移时 State 不变。
- 首版不启动 Agent、不自动 Git、不并行、不发布。
