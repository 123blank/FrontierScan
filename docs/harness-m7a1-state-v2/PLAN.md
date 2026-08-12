# FrontierScan Harness M7-A1 State v2 契约与版本共存实施计划

> **供代理式开发者使用：** 必须使用 `superpowers:test-driven-development` 按任务顺序实施。每个任务先运行指定 RED，再完成最小 GREEN。未经用户逐次批准，不执行 Git 暂存、提交、推送、Worktree、发布或部署。
>
> 计划状态：已于 2026-08-12 通过独立只读评审，无剩余 BLOCKER/WARNING；待用户批准实施。

**目标：** 为新 Story 建立默认 State v2、版本化工作流、Git 初始化基线和 v1 只读兼容，同时保持现有锁、原子写入、恢复和历史 State 审计能力。

**架构：** 新增独立 v2 Schema、模板和工作流；提取无外部依赖的 `state-contract.mjs` 作为 Node Runtime 与 PowerShell validator 的唯一可执行契约；`state-runtime.mjs` 保留 I/O、锁和事务职责，并按 State 版本分发命令与阶段行为。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Git CLI、Node 内置测试断言与临时 Git fixture。

---

## 1. 实施边界

### 1.1 本计划实施

```text
State v1 只读兼容
State v2 Schema/模板/工作流
单一 Node State 契约
新 Story 默认 v2
Git baseline 快照
v2 基础命令
PowerShell 薄 validator
smoke 与兼容回归
Skill/文档同步
REPORT.md
```

### 1.2 本计划不实施

```text
phase result v2 投影
criterion 覆盖门禁
accepted gap/stale
知识刷新
owned files 推导
delivery receipt
真实 Agent
并行与 Fork-Join
自动 Git 或发布
```

### 1.3 兼容策略

- `.harness/scripts/lib/story-runtime.mjs` 的基础 prepare/status/apply 路径必须可读取 v2 State。
- M5 batch/worktree/wave 协议仍使用自己的 `schemaVersion: "1.0"` fixture，不在 A1 升级。
- M5 Runtime 若明确要求 v1 E2E State，只保留既有 fixture 覆盖；A1 不宣称这些 Runtime 已支持正式 v2 Story。
- M7-B 前，v2 仍由现有 State/Story 基础入口串行操作。

## 2. 文件清单

### 2.1 新增

```text
.harness/schemas/e2e-state-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/workflows/e2e-development-v2.yaml
.harness/scripts/lib/state-contract.mjs
docs/harness-m7a1-state-v2/REPORT.md
```

### 2.2 修改

```text
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/run-state.ps1
.harness/scripts/validate-state.ps1
.harness/scripts/tests/state-runtime.test.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/tests/worker-runtime.test.mjs
.harness/scripts/smoke-harness-flow.ps1
.harness/scripts/validate-structure.ps1
.harness/structure-manifest.yaml
.codex/skills/frontier-state-runner/SKILL.md
.codex/skills/frontier-state-runner/references/phase-model.md
.codex/skills/frontier-state-runner/references/state-update-rules.md
.codex/skills/frontier-common/references/harness-runtime.md
docs/harness-structure-checklist.md
docs/harness-m7a1-state-v2/DESIGN.md
```

### 2.3 只读回归证据

```text
.harness/states/e2e-M6-A-001.json
.harness/states/e2e-M6-A-001.events.jsonl
.harness/schemas/e2e-state.schema.json
.harness/states/e2e-state.template.json
.harness/workflows/e2e-development.yaml
```

## 3. Task 1：冻结 v1 历史兼容契约

**文件：**

- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 只读：`.harness/states/e2e-M6-A-001.json`

### 3.1 RED：新增真实 v1 State 只读测试

增加测试辅助函数：

```javascript
async function sha256File(filePath) {
  return `sha256:${createHash("sha256").update(await readFile(filePath)).digest("hex")}`;
}
```

新增：

```javascript
async function testCompletedV1StateIsReadOnlyAndByteStable() {
  const source = path.join(REPOSITORY_ROOT, ".harness/states/e2e-M6-A-001.json");
  const before = await sha256File(source);

  const status = await runStateCommand({
    root: REPOSITORY_ROOT,
    command: "status",
    stateFile: ".harness/states/e2e-M6-A-001.json",
  });
  assert.equal(status.state.schemaVersion, "1.0");

  const validated = await runStateCommand({
    root: REPOSITORY_ROOT,
    command: "validate",
    stateFile: ".harness/states/e2e-M6-A-001.json",
  });
  assert.equal(validated.valid, true);

  for (const command of ["record", "next", "block", "resume", "complete"]) {
    await assert.rejects(
      runStateCommand({
        root: REPOSITORY_ROOT,
        command,
        stateFile: ".harness/states/e2e-M6-A-001.json",
        recordType: "note",
        status: "recorded",
        message: "must fail",
        reason: "must fail",
        owner: "user",
        suggestedAction: "must fail",
      }),
      /State v1 is read-only/i,
    );
  }

  assert.equal(await sha256File(source), before);
}
```

同时增加临时 active v1 fixture 的写命令拒绝测试，证明拒绝原因优先于普通 phase/gate 错误。

### 3.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：新测试失败，因为当前 active v1 仍允许写命令，completed v1 返回旧的 immutable 错误。

### 3.3 GREEN 完成条件

Task 3 完成命令能力分发后，本任务测试通过。此任务暂不修改生产代码。

## 4. Task 2：建立单一 State 契约模块

**文件：**

- 新增：`.harness/scripts/lib/state-contract.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 4.1 RED：版本识别与结构错误测试

在测试文件中导入：

```javascript
import {
  assertStateCommandAllowed,
  detectE2EStateVersion,
  validateStateDocument,
} from "../lib/state-contract.mjs";
```

新增用例：

```text
detectE2EStateVersion 接受 1.0 和 2.0
缺少 schemaVersion 拒绝
数字 schemaVersion 拒绝
未知版本 3.0 拒绝
v2 顶层 tasks 拒绝
v2 runtime.blocked 拒绝
v1 status/validate 允许
v1 所有写命令拒绝
v2 template status/validate 允许
v2 template 所有写命令拒绝
v2 completed 所有写命令拒绝
Product State 和 active pointer 继续识别
```

### 4.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：模块不存在或导出不存在。

### 4.3 GREEN：实现最小契约模块

模块导出：

```javascript
export const E2E_STATE_V1 = "1.0";
export const E2E_STATE_V2 = "2.0";

export function detectStateKind(value) {}
export function detectE2EStateVersion(state) {}
export function validateE2EStateV1(state) {}
export function validateE2EStateV2(state) {}
export function validateProductState(state) {}
export function validateActivePointer(pointer) {}
export function validateStateDocument(value) {}
export function assertStateCommandAllowed(state, command) {}
```

实现原则：

- 使用普通对象、数组、字符串、整数和 enum 检查，不引入依赖。
- 每个 v2 对象维护明确允许字段集合，拒绝额外字段。
- v1 使用当前 Runtime/PowerShell 已接受的历史结构，不增加 v2 非空要求。
- `validateStateDocument` 返回：

```javascript
{
  kind: "e2e" | "product" | "active-run",
  schemaVersion: "1.0" | "2.0",
  capabilities: {
    allowedCommands: ["status", "validate"],
  },
}
```

- `assertStateCommandAllowed` 对 v1 写命令抛出稳定错误：

```text
State v1 is read-only; command '<command>' is not allowed.
```

- template v2 写命令抛出稳定错误：

```text
State template is read-only; command '<command>' is not allowed.
```

- `assertStateCommandAllowed` 必须同时根据版本、runtime status 和命令判断。

### 4.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：契约单元测试通过；涉及 Runtime 分发的 Task 1 测试仍可能失败。

## 5. Task 3：定义 v2 Schema 与模板

**文件：**

- 新增：`.harness/schemas/e2e-state-v2.schema.json`
- 新增：`.harness/states/e2e-state-v2.template.json`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/scripts/validate-structure.ps1`
- 修改：`.harness/structure-manifest.yaml`

### 5.1 RED：模板契约测试

新增：

```javascript
async function testV2TemplateMatchesStrictContract() {
  const template = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, ".harness/states/e2e-state-v2.template.json"),
    "utf8",
  ));
  const result = validateStateDocument(template);
  assert.equal(result.schemaVersion, "2.0");
  assert.equal(Object.hasOwn(template, "tasks"), false);
  assert.deepEqual(template.dag.nodes, []);
  assert.equal(template.runtime.activeBlock, null);
}
```

增加克隆变体：

```text
加入顶层 tasks -> 失败
加入 runtime.blocked -> 失败
删除 baseline -> 失败
加入未知 runtime 字段 -> 失败
status=active 且 activeBlock 非空 -> 失败
status=blocked 且 activeBlock 为空 -> 失败
status=completed 且 phase!=done -> 失败
status=template 时 baseline/time 为 null -> 通过
status=active/blocked/completed 时 baseline.head/branch/capturedAt 为 null -> 失败
status=active/blocked/completed 时 createdAt/updatedAt 为 null -> 失败
```

### 5.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：模板不存在。

### 5.3 GREEN：创建 Schema 和模板

模板使用设计文档第 7、8 节的完整结构：

```json
{
  "schemaVersion": "2.0",
  "storyId": "S1",
  "phase": "requirement",
  "runtime": {
    "runId": "S1",
    "workflow": ".harness/workflows/e2e-development-v2.yaml",
    "workflowVersion": "2.0",
    "status": "template",
    "revision": 0,
    "previousPhase": null,
    "activeBlock": null,
    "records": [],
    "createdAt": null,
    "updatedAt": null
  },
  "baseline": {
    "head": null,
    "branch": null,
    "initialDirtyPaths": [],
    "capturedAt": null
  },
  "requirement": {
    "summary": "",
    "openQuestions": [],
    "acceptanceCriteria": [],
    "inScope": [],
    "outOfScope": []
  },
  "knowledge": { "areas": [] },
  "design": { "decisions": [], "affectedAreas": [], "risks": [] },
  "dag": {
    "sourceFile": null,
    "sourceSha256": null,
    "nodes": [],
    "edges": [],
    "waves": [],
    "globalChanges": [],
    "risks": []
  },
  "implementation": {
    "method": null,
    "exceptionReason": null,
    "actualFiles": [],
    "completedTaskIds": [],
    "notes": []
  },
  "tests": { "cases": [], "commands": [], "results": [] },
  "review": { "findings": [], "status": "pending" },
  "build": { "results": [], "artifacts": [], "externalActions": [] },
  "verification": {
    "cases": [],
    "results": [],
    "environment": { "status": "not-checked", "summary": "" }
  },
  "delivery": {
    "status": "pending",
    "ownedFiles": [],
    "outOfPredictionFiles": [],
    "unrelatedDirtyFiles": [],
    "remainingRisks": [],
    "summaryFile": null,
    "summarySha256": null,
    "gitStatus": "not-requested"
  },
  "approvals": [],
  "worktrees": [],
  "logs": []
}
```

Schema 要求：

- `$id` 为 `e2e-state-v2.schema.json`。
- `schemaVersion` 使用 `const: "2.0"`。
- 顶层与 `runtime/baseline` 使用 `additionalProperties: false`。
- 其余已定义对象也列出允许字段并禁止额外字段。
- `runtime.status=template` 时，时间与 baseline 身份字段允许 `null`。
- `runtime.status=active/blocked/completed` 时，Node 契约必须要求非空 HEAD、branch、capturedAt、createdAt 和 updatedAt。
- Schema 表达通用字段类型，状态相关条件同时写入 Schema `if/then` 和 Node 契约测试，避免模板宽松度泄漏到运行态。

`validate-structure.ps1` 的 JSON 列表加入 v2 Schema 和模板。

### 5.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
```

预期：模板与变体测试通过，结构校验通过。

## 6. Task 4：定义 v2 工作流和版本绑定

**文件：**

- 新增：`.harness/workflows/e2e-development-v2.yaml`
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/structure-manifest.yaml`

### 6.1 RED：工作流版本测试

新增用例：

```text
v2 workflow 包含九阶段并以 delivery-preparation 收尾
v2 workflow 不包含 git-delivery
workflow schema_version 必须等于 runtime.workflowVersion
workflow state_file 必须指向 v2 模板
v2 delivery-preparation 必须唯一 next=done
v1 workflow 继续可读取历史 State
```

测试要求 `readWorkflowDefinition` 返回：

```javascript
{
  schemaVersion,
  stateFile,
  phases,
}
```

### 6.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：当前 parser 丢弃顶层元数据或 v2 文件不存在。

### 6.3 GREEN：扩展 workflow parser

`parseWorkflow` 保存并验证顶层：

```text
schema_version
name
description
state_file
```

`readWorkflow` 根据 State 版本校验：

```javascript
const expected = {
  "1.0": {
    workflow: ".harness/workflows/e2e-development.yaml",
    template: ".harness/states/e2e-state.template.json",
  },
  "2.0": {
    workflow: ".harness/workflows/e2e-development-v2.yaml",
    template: ".harness/states/e2e-state-v2.template.json",
  },
};
```

v1 历史 State 没有 `workflowVersion` 时，以 `schemaVersion` 推导 `1.0`；v2 必须显式提供。

### 6.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：版本绑定测试通过。

## 7. Task 5：实现 Git baseline 采集器

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 7.1 RED：临时 Git fixture

新增辅助函数：

```javascript
const execFileAsync = promisify(execFile);

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function createGitFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-state-v2-git-"));
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "state-v2@example.test");
  await git(root, "config", "user.name", "State V2 Test");
  await write(root, "seed.txt", "seed");
  await git(root, "add", "seed.txt");
  await git(root, "commit", "-m", "seed");
  return root;
}
```

覆盖：

```text
clean
staged
unstaged
untracked
同路径 staged+unstaged
rename：source.txt -> target.txt，只保留 target.txt
copy 的原始 NUL parser fixture，只保留目标路径
稳定排序
detached HEAD
非 Git
unborn branch
executeGit 注入失败
status 采集前后 HEAD 变化
status 采集前后 branch 变化
```

每个成功用例断言：

```text
40 位小写 head
branch=dev
initialDirtyPaths 唯一路径
indexStatus/worktreeStatus/untracked 正确
capturedAt 使用注入时钟
```

### 7.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：init 尚不读取 Git 或仍使用 v1 模板。

### 7.3 GREEN：实现 Git 调用与 porcelain 解析

新增内部函数：

```javascript
async function runGit(root, args, options) {}
async function captureGitBaseline(root, timestamp, options) {}
function parsePorcelainV1Z(source) {}
```

命令：

```text
git rev-parse --verify HEAD
git symbolic-ref --quiet --short HEAD
git status --porcelain=v1 -z --untracked-files=all
git rev-parse --verify HEAD
git symbolic-ref --quiet --short HEAD
```

实现细节：

- `options.executeGit` 可注入测试替身。
- `-z` 下 rename/copy 记录按 `<XY> <target>\0<source>\0` 消费两个 path，只记录目标路径。
- parser 单元测试直接输入名称明显不同的 source/target 原始 NUL 数据。
- `R` 或 `C` 出现在 X/Y 任一列时按双路径记录解析。
- `??` 设置 `untracked=true`、两个 status 均为 `?`。
- 普通记录保留 XY 两列。
- Map 按 path 合并后 ordinal 排序。
- 路径必须为非空仓库相对路径，禁止 `../` 和绝对路径。

### 7.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：baseline fixture 全部通过。

## 8. Task 6：将 init 默认切换到 v2

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`

### 8.1 RED：v2 初始化与零写入

修改 fixture，使默认包含 v2 模板和工作流，并初始化 Git。

新增断言：

```text
state.schemaVersion=2.0
runtime.workflow 指向 v2
runtime.workflowVersion=2.0
baseline 已冻结
不存在顶层 tasks
pointer.schemaVersion=1.0
模板字节不变
Git baseline 失败时不存在 state/pointer/event committed
```

### 8.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：当前 init 生成 v1。

### 8.3 GREEN：修改 initializeRun

常量改为：

```javascript
const E2E_V2_TEMPLATE = ".harness/states/e2e-state-v2.template.json";
const E2E_V2_WORKFLOW = ".harness/workflows/e2e-development-v2.yaml";
```

初始化锁内顺序：

```text
二次 active pointer 检查
-> 目标 State 候选检查
-> 读取并 validate v2 模板
-> captureGitBaseline
-> 对账采集前后的 HEAD 与 branch
-> 构造 active v2 State
-> validate active v2 State
-> 写 intent
-> 原子 State/pointer 事务
```

在写 intent 前完成 Git baseline，确保失败时没有事务残留。

`captureGitBaseline` 前后 HEAD/branch 不一致时抛错；测试断言 State、pointer 和 committed event 均不存在。

`smoke-harness-flow.ps1` 的临时 State Runtime fixture：

- 初始化临时 Git 仓库和 seed commit。
- 复制 v2 模板及工作流。
- 继续保留 v1 模板和工作流，供历史/协议 fixture 使用。

### 8.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
```

预期：init 与 smoke 的 State Runtime 段通过。

## 9. Task 7：Runtime 版本分发与 v1 拒写

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 9.1 RED：命令分发与恢复顺序

确保 Task 1 的测试覆盖：

```text
v1 write 在锁和 intent 前拒绝
v2 template write 在锁和 intent 前拒绝
v1 status/validate 继续恢复 .tmp/.bak
v2 completed 仍不可变
未知版本在 status 阶段失败
pointer 指向混合字段 v2 时失败
```

注入 `beforeCommit` 计数器，断言 v1 写命令从未进入持久化回调。

对 v2 模板记录执行前后 SHA-256，逐一调用 `record/next/block/resume/complete`，断言均以 template read-only 错误拒绝且哈希不变。

### 9.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

### 9.3 GREEN：复用 State contract

替换本地：

```text
validateActivePointer
validateRuntimeState
```

由 `state-contract.mjs` 提供。

`runStateCommand`：

```javascript
const metadata = validateStateDocument(located.state);
if (["status", "validate"].includes(options.command)) { ... }
assertStateCommandAllowed(located.state, options.command);
```

锁内重读后再次：

```javascript
validateStateDocument(fresh.state);
assertStateCommandAllowed(fresh.state, options.command);
```

### 9.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：v1 只读和恢复测试通过。

## 10. Task 8：实现 v2 block/resume

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 10.1 RED

新增：

```javascript
async function testV2ResumeClearsActiveBlockAndKeepsHistory() {}
```

断言：

```text
block 后 phase=blocked
status=blocked
activeBlock.previousPhase 正确
logs 最后一项 type=blocked
resume 后 activeBlock=null
phase 恢复
previousPhase=blocked
logs 包含 blocked/resumed
events 包含两次 committed
```

### 10.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：Runtime 仍访问 `runtime.blocked`。

### 10.3 GREEN

`blockRun` 和 `resumeRun` 按版本调用 v2 实现。因为 v1 已拒写，不保留新的 v1 写分支。

### 10.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

## 11. Task 9：实现 v2 delivery-preparation 完成

**文件：**

- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 11.1 RED

构造 v2 State 位于 `delivery-preparation`，写入 required delivery report。

测试：

```text
没有 approval record 也能 complete
缺少 delivery report 失败且 revision 不变
workflow next 不是 done 时失败
完成后 previousPhase=delivery-preparation
完成后 status=completed/phase=done
完成后 record/next/block/resume/complete 全部 immutable
v1 git-delivery complete 仍因 v1 read-only 拒绝
```

### 11.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：当前 complete 固定要求 `git-delivery`。

### 11.3 GREEN

`completeRun` 从当前 workflow 找到：

```javascript
const current = workflow.phases.find((phase) => phase.id === state.phase);
```

仅 v2 允许 `delivery-preparation -> done`。不调用 git-delivery approval gate。

`assertQualityGate` 中旧 `git-delivery` 分支保留为未使用的 v1 历史逻辑或删除；推荐删除不可达分支，v1 已整体拒写。

### 11.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

## 12. Task 10：将 PowerShell validator 改为薄入口

**文件：**

- 修改：`.harness/scripts/validate-state.ps1`
- 修改：`.harness/scripts/lib/state-contract.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

### 12.1 RED：CLI 一致性

新增 Node contract CLI：

```text
node state-contract.mjs validate-file --state-file <absolute-path>
```

测试 PowerShell：

```text
v1 E2E 通过
v2 template 通过
v2 active State 通过
Product State 通过
active pointer 通过
未知版本失败
混合字段失败
中文摘要通过
路径不存在失败
```

并断言同一非法文档：

```text
validateStateDocument 抛错
validate-state.ps1 非零退出
错误原因包含相同关键类别
```

### 12.2 运行 RED

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
```

预期：PowerShell 仍使用本地手写规则。

### 12.3 GREEN

`validate-state.ps1` 缩减为：

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile
)

$ErrorActionPreference = "Stop"
$nodeScript = Join-Path $PSScriptRoot "lib\state-contract.mjs"
& node $nodeScript validate-file --state-file (Resolve-Path -LiteralPath $StateFile).Path
exit $LASTEXITCODE
```

Node CLI 输出保持：

```text
Harness state validation passed.
State type: <kind>
State version: <version>
State file: <path>
```

### 12.4 运行 GREEN

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-M6-A-001.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
```

## 13. Task 11：修复基础 Story Runtime v2 兼容

**文件：**

- 修改：`.harness/scripts/tests/story-runtime.test.mjs`
- 按测试结果最小修改：`.harness/scripts/lib/story-runtime.mjs`
- 修改：`.harness/scripts/tests/worker-runtime.test.mjs`

### 13.1 RED/回归定位

先运行：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

若现有测试因 `init` 默认 v2 或 workflow metadata 变化失败，增加明确用例：

```text
v2 requirement phase prepare 生成现有 v1 dispatch task
v2 status 不修改 State
v2 apply 仍只通过 runStateCommand 推进
v2 delivery-preparation apply 调用 complete 而不是 next
完整 v2 九阶段 prepare -> mock result -> apply 最终进入 done
v1 git-delivery 历史 fixture 不再执行 apply，只保留读取验证
dispatch/result 协议保持 1.0
```

完整九阶段用例为每个 phase 生成现有 v1 dispatch/result 与 required output，逐阶段 apply；最后断言 `delivery-preparation` 使用 complete、无 approval 也进入 `done/completed`。

### 13.2 最小 GREEN

只调整对 E2E State `schemaVersion=1.0` 和终态阶段名的基础假设：

```javascript
const command = phase.next.includes("done") ? "complete" : "next";
```

不得继续以 `phase.id === "git-delivery"` 判断完成，也不得把任意无 `done` 转移的阶段误判为 complete。

不得：

- 升级 dispatch task/result。
- 实现 v2 phase result。
- 修改 M5 batch/wave 协议。

`worker-runtime.test.mjs` 的 vertical fixture 当前通过 `init` 创建 State，必须初始化临时 Git 仓库并复制 v2 模板/工作流，不能把该确定性回归归类为 M5 延期。

### 13.3 验证

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
```

## 14. Task 12：更新 smoke 和结构检查

**文件：**

- 修改：`.harness/scripts/smoke-harness-flow.ps1`
- 修改：`.harness/scripts/validate-structure.ps1`
- 修改：`.harness/structure-manifest.yaml`

### 14.1 RED

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
```

预期：在 Task 6 前因临时目录非 Git 或缺少 v2 资产失败；Task 6 后应接近通过。

### 14.2 GREEN

smoke 的 State Runtime fixture：

```text
git init -b dev
配置 fixture user
写 seed 并 commit
复制 v1/v2 模板
复制 v1/v2 工作流
init/status/validate
M3 prepare/mock worker/apply
```

结构校验加入：

```text
e2e-state-v2.schema.json
e2e-state-v2.template.json
e2e-development-v2.yaml
state-contract.mjs
```

### 14.3 验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
```

## 15. Task 13：更新 Skill 与项目文档

**文件：**

- 修改：`.codex/skills/frontier-state-runner/SKILL.md`
- 修改：`.codex/skills/frontier-state-runner/references/phase-model.md`
- 修改：`.codex/skills/frontier-state-runner/references/state-update-rules.md`
- 修改：`.codex/skills/frontier-common/references/harness-runtime.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`docs/harness-m7a1-state-v2/DESIGN.md`

### 15.1 文档更新内容

- 新 Story 默认 v2。
- v1 只允许 `status/validate`。
- v2 使用 `delivery-preparation`。
- `complete` 不代表 Git 已执行。
- baseline 初始化条件。
- `activeBlock` 的当前阻塞语义。
- M7-A2/A3/A4/C 仍未实现。
- common knowledge 当前 stale，源码是本阶段事实来源。

### 15.2 验证

```powershell
$files = @(
  ".codex\skills\frontier-state-runner\SKILL.md",
  ".codex\skills\frontier-state-runner\references\phase-model.md",
  ".codex\skills\frontier-state-runner\references\state-update-rules.md",
  ".codex\skills\frontier-common\references\harness-runtime.md",
  "docs\harness-structure-checklist.md",
  "docs\harness-m7a1-state-v2\DESIGN.md"
)
Select-String -LiteralPath $files -Pattern "只有 `git-delivery`","新 Story 初始化.*v1" -Encoding utf8
```

预期：无过期当前规则；历史说明明确标记为 v1。

## 16. Task 14：全量回归与兼容分类

### 16.1 必跑

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-M6-A-001.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
git diff --check
```

### 16.2 按影响运行

```powershell
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
```

分类规则：

- 因明确 v1 M5 fixture 继续通过：记录为兼容。
- 因正式 v2 State 被 M5 拒绝：记录为 M8/M9 前的已知延期，不在 A1 扩大范围。
- `worktree-runtime.mjs` 等 M5 资产中固定的 `08-git-delivery` 路径属于 v1 M5 协议，不在 A1 改名。
- 因基础 Story/State 路径错误假设 v1：必须在 A1 修复。
- 不得通过删除测试或放宽安全校验换取通过。

## 17. Task 15：独立只读审核

使用独立 `code-reviewer` Agent，只读审核本任务 diff。

审核重点：

```text
v1 历史字节是否保持不变
v1 写命令是否在任何写入前拒绝
v2 是否存在双重任务事实源
Node/PowerShell 是否真正复用同一契约
Git status -z 解析是否正确
baseline 是否在初始化锁内冻结
activeBlock 是否在 resume 后清空
complete 是否错误执行或要求 Git
workflow/version/template 是否可漂移
恢复和 pointer 契约是否回归
A2/A3/A4/C 是否被提前实现
```

审核输出：

```text
docs/harness-m7a1-state-v2/REPORT.md
```

BLOCKER/WARNING 必须修复并重新运行受影响测试后才进入验收。

## 18. Task 16：fixture 验收与报告

**文件：**

- 新增：`docs/harness-m7a1-state-v2/REPORT.md`
- 修改：`docs/harness-structure-checklist.md`
- 修改：`.harness/structure-manifest.yaml`

### 18.1 fixture 验收矩阵

| 验收项 | 证据 |
| --- | --- |
| AC-A1-01 新 Story 默认 v2 | init 测试与生成 State |
| AC-A1-02 v1 只读兼容 | M6-A SHA-256 前后对账与拒写测试 |
| AC-A1-03 版本失败关闭 | 未知/混合/workflow 漂移测试 |
| AC-A1-04 DAG 唯一任务入口 | v2 模板/Schema 严格测试 |
| AC-A1-05 activeBlock | block/resume logs/events 测试 |
| AC-A1-06 Git baseline | 临时 Git fixture 矩阵 |
| AC-A1-07 完成语义 | 无 approval 的 delivery-preparation complete |
| AC-A1-08 单一契约 | Node 与 PowerShell 一致性测试 |

### 18.2 REPORT 内容

```text
实施摘要
设计偏离及批准
RED/GREEN 证据
v1 字节稳定证据
Git fixture 结果
全量回归结果
独立审核结论
已知延期
未执行的 Git/Worktree/Docker/发布操作
```

### 18.3 状态同步

结构清单将 M7-A1 标记为：

```text
implemented
fixture-verified
real-story-acceptance-pending-at-M7-D
```

不把 M7-A1 单独描述为完成整个 M7。

## 19. 最终完成门禁

M7-A1 实施完成必须同时满足：

- 设计中的 8 个验收项均有 fixture 证据。
- v1 M6-A State 与 events 文件字节不变。
- 所有 v1 写命令失败关闭。
- 新 Story 默认生成 v2。
- Node 与 PowerShell 校验结论一致。
- 必跑回归全部通过。
- 按影响运行的 M5 回归已分类且无 A1 引入的未解决回归。
- 独立审核无 BLOCKER/WARNING。
- `REPORT.md`、结构清单和 manifest 同步。
- 未执行 Git 暂存、提交、推送、Worktree、Docker、发布或部署。

完成以上门禁后，向用户汇报并请求是否进入 M7-A2 设计；不自动启动下一子里程碑。
