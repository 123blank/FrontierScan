# FrontierScan Harness M2 确定性状态运行时实施计划

> **供代理式开发者使用：** 实施时必须使用 `superpowers:executing-plans` 或 `superpowers:subagent-driven-development`，并按复选框顺序执行。
>
> 状态：已完成审核跟进；TDD 证据和最终验收结果见同目录 `REPORT.md`。

**目标：** 实现可初始化、定位、校验、记录、推进、阻塞、恢复和完成的单 Story 确定性状态运行时。

**架构：** PowerShell 提供稳定入口，Node.js 核心读取工作流 YAML，以任务状态 JSON 为事实源，通过活动指针、独占锁、原子写入和 JSONL 事件日志支持跨进程恢复。

**技术栈：** PowerShell 5.1、Node.js ESM、JSON Schema、Harness YAML 严格子集、`node:fs/promises`、`node:test` 风格的自执行断言测试。

---

## 文件职责

- `.harness/scripts/lib/state-runtime.mjs`：工作流解析、路径安全、状态操作、门禁、锁、原子写入和恢复。
- `.harness/scripts/run-state.ps1`：PowerShell 参数转发和 Node.js 退出码传递。
- `.harness/scripts/tests/state-runtime.test.mjs`：临时 Fixture 中的运行时单元与集成测试。
- `.harness/schemas/active-run.schema.json`：活动指针结构契约。
- `.harness/schemas/e2e-state.schema.json`：补充 `runtime` 结构契约。
- `.harness/scripts/smoke-harness-flow.ps1`：加入无污染的状态运行时快速验证。
- `.codex/skills/frontier-state-runner/SKILL.md`：更新为真实可执行命令。

### 任务 1：初始化和活动运行定位

**文件：**
- 新增：`.harness/scripts/lib/state-runtime.mjs`
- 新增：`.harness/scripts/tests/state-runtime.test.mjs`

- [x] **步骤 1：先写初始化失败测试**

```javascript
const result = await runStateCommand({
  root,
  command: "init",
  storyId: "M2-001",
  summary: "验证状态运行时",
  now: () => "2026-07-16T00:00:00.000Z",
});
assert.equal(result.state.phase, "requirement");
assert.equal(result.state.runtime.revision, 1);
assert.equal(result.pointer.stateFile, ".harness/states/e2e-M2-001.json");
assert.equal(await readFile(templatePath, "utf8"), originalTemplate);
```

- [x] **步骤 2：运行 RED**

```powershell
node .harness/scripts/tests/state-runtime.test.mjs
```

预期：因 `state-runtime.mjs` 不存在或未实现 `init` 而失败。

- [x] **步骤 3：实现最小初始化和定位逻辑**

```javascript
export async function runStateCommand(options) {
  const root = path.resolve(options.root);
  if (options.command === "init") return initializeRun(root, options);
  const stateFile = await locateStateFile(root, options.stateFile);
  const state = await readRecoverableJson(stateFile);
  return executeExistingRun(root, stateFile, state, options);
}
```

实现要求：

- `storyId` 只允许 `[A-Za-z0-9][A-Za-z0-9._-]{0,63}`。
- 状态文件固定为 `.harness/states/e2e-<storyId>.json`。
- 已有 `active` 或 `blocked` 指针时拒绝重复初始化。
- 从模板深拷贝数据，不修改模板。

- [x] **步骤 4：运行 GREEN**

```powershell
node .harness/scripts/tests/state-runtime.test.mjs
```

预期：初始化、指针定位、重复初始化保护和模板不变断言通过。

### 任务 2：工作流解析和必需产物门禁

**文件：**
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [x] **步骤 1：先写工作流和阶段推进失败测试**

```javascript
await assert.rejects(
  runStateCommand({ root, command: "next" }),
  /required output.*requirement-breakdown\.md/i,
);
await write(root, ".harness/outputs/requirement-breakdown.md", "# Requirement\n");
const advanced = await runStateCommand({ root, command: "next" });
assert.equal(advanced.state.phase, "technical-design");
assert.equal(advanced.state.runtime.revision, 2);
```

- [x] **步骤 2：运行 RED，确认缺少解析和推进逻辑**

- [x] **步骤 3：实现严格 YAML 子集解析器**

```javascript
function parseWorkflow(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const phases = parsePhaseList(lines);
  const qualityGates = parseQualityGateList(lines);
  validateWorkflowShape(phases, qualityGates);
  return { phases, qualityGates };
}
```

解析器必须拒绝重复阶段、未知 `next`、非唯一阶段序号、不支持的缩进和越界产物路径。

- [x] **步骤 4：实现 `next` 和证据哈希**

```javascript
const evidence = {
  type: "output",
  phase: state.phase,
  status: "present",
  path: relativeOutput,
  sha256: await hashFile(outputPath),
};
```

- [x] **步骤 5：运行 GREEN，确认非法转换和缺少产物不改变 revision**

### 任务 3：证据记录、质量门禁、阻塞和完成

**文件：**
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [x] **步骤 1：先写 `record/block/resume/complete` 失败测试**

```javascript
await runStateCommand({ root, command: "record", recordType: "test", status: "failed", message: "unit test failed" });
await assert.rejects(runStateCommand({ root, command: "next" }), /failed required tests/i);
const blocked = await runStateCommand({ root, command: "block", reason: "need decision", owner: "user", suggestedAction: "approve" });
assert.equal(blocked.state.phase, "blocked");
const resumed = await runStateCommand({ root, command: "resume" });
assert.equal(resumed.state.phase, blocked.state.runtime.blocked.previousPhase);
```

- [x] **步骤 2：运行 RED**

- [x] **步骤 3：实现统一记录模型**

```javascript
function createRecord(state, options, now) {
  return {
    id: `${state.runtime.runId}-${state.runtime.revision + 1}-${state.runtime.records.length + 1}`,
    type: options.recordType,
    phase: state.phase,
    status: options.status,
    path: options.path || null,
    message: options.message || "",
    actor: options.actor || "codex",
    createdAt: now,
  };
}
```

- [x] **步骤 4：实现门禁**

- `task-dag` 调用现有 `validate-task-dag.ps1`。
- `unit-test` 要求存在必需测试记录且无 `failed`。
- `code-review` 要求无未解决 `BLOCKER`。
- 发布或 Git 写入相关记录要求同阶段 `approval=approved`。
- `complete` 仅允许从 `git-delivery` 执行。

- [x] **步骤 5：运行 GREEN，确认所有门禁拒绝时状态不变**

### 任务 4：独占锁、事件日志和中断恢复

**文件：**
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [x] **步骤 1：先写锁竞争和损坏恢复失败测试**

```javascript
await write(root, ".harness/states/e2e-M2-001.lock", JSON.stringify({ pid: process.pid, createdAt: now }));
await assert.rejects(runStateCommand({ root, command: "record", recordType: "note", status: "recorded" }), /locked/i);

await writeFile(`${stateFile}.tmp`, JSON.stringify({ ...state, runtime: { ...state.runtime, revision: 4 } }));
await writeFile(stateFile, "{broken");
const recovered = await runStateCommand({ root, command: "status" });
assert.equal(recovered.state.runtime.revision, 4);
```

- [x] **步骤 2：运行 RED**

- [x] **步骤 3：实现锁和原子写入**

```javascript
async function withRunLock(lockPath, action) {
  const handle = await acquireExclusiveLock(lockPath);
  try {
    return await action();
  } finally {
    await handle.close();
    await unlink(lockPath).catch(() => {});
  }
}
```

- [x] **步骤 4：实现 `intent/committed/aborted` 事件协议和高 revision 恢复**

- [x] **步骤 5：运行 GREEN，确认并发写入只有一个成功且事件顺序可重放**

### 任务 5：PowerShell 入口和 Schema

**文件：**
- 新增：`.harness/scripts/run-state.ps1`
- 新增：`.harness/schemas/active-run.schema.json`
- 修改：`.harness/schemas/e2e-state.schema.json`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`

- [x] **步骤 1：先写 PowerShell 入口成功与失败退出码测试**

```javascript
const success = await execPowerShell(["-Command", "status", "-Root", root, "-Json"]);
assert.equal(success.exitCode, 0);
const failure = await execPowerShell(["-Command", "next", "-Root", root, "-Json"]);
assert.notEqual(failure.exitCode, 0);
```

- [x] **步骤 2：运行 RED**

- [x] **步骤 3：实现 PowerShell 参数转发并显式传递 `$LASTEXITCODE`**

```powershell
& node @arguments
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}
```

- [x] **步骤 4：在 Schema 中定义指针、runtime、record 和 blocked 结构**

- [x] **步骤 5：运行 GREEN 和现有 `validate-state.ps1` 回归**

### 任务 6：结构、Skill 和冒烟集成

**文件：**
- 修改：`.harness/structure-manifest.yaml`
- 修改：`.harness/scripts/smoke-harness-flow.ps1`
- 修改：`.codex/skills/frontier-state-runner/SKILL.md`
- 修改：`.codex/skills/skill-registry.yaml`
- 修改：`.harness/scripts/README.md`

- [x] **步骤 1：先让结构和冒烟测试要求新运行时文件**

- [x] **步骤 2：运行 RED，确认缺少清单登记和冒烟步骤**

- [x] **步骤 3：登记新文件，将 `frontier-state-runner` 状态更新为 `implemented-v1`**

- [x] **步骤 4：冒烟流程在临时根目录执行 `init/status`，不在仓库留下活动状态**

- [x] **步骤 5：运行 GREEN**

```powershell
.\.harness\scripts\validate-structure.ps1
.\.harness\scripts\smoke-harness-flow.ps1
```

### 任务 7：交接、知识刷新和最终验收

**文件：**
- 新增：`docs/harness-m2-state-runtime/REPORT.md`
- 修改：`docs/AI-handover.md`
- 更新：`llm-knowledge/**`

- [x] **步骤 1：用中文记录实现边界、TDD 证据、验证命令和剩余风险**

- [x] **步骤 2：更新交接文档，明确 M2 已完成但 Agent 自动派发仍未实现**

- [x] **步骤 3：重建 L1 和本地索引**

```powershell
.\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline
```

- [x] **步骤 4：执行完整回归**

```powershell
node .harness/scripts/tests/state-runtime.test.mjs
node .harness/scripts/tests/source-fingerprint.test.mjs
node .harness/scripts/tests/harness-status.test.mjs
node .harness/scripts/tests/generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/tests/kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/tests/kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/check-kb-freshness.ps1 -Json
git diff --check
git status --short -- backend/src frontend/src
```

预期：所有测试退出 0；backend、frontend、common 均为 `fresh`；业务源码无差异。

- [x] **步骤 5：不自动提交**

待用户明确批准后，才按任务拥有文件暂存并使用以下中文提交信息：

```text
feat(harness): 实现 M2 确定性状态运行时
```

### 任务 8：二次审核缺陷修复

**文件：**
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.harness/schemas/e2e-state.schema.json`
- 修改：`.codex/skills/frontier-state-runner/SKILL.md`
- 修改：`docs/harness-m2-state-runtime/DESIGN.md`
- 修改：`docs/harness-m2-state-runtime/REPORT.md`

- [x] **步骤 1：先写失败测试，覆盖测试重跑、完成态写入、重复 Story 初始化和无证据审批**
- [x] **步骤 2：逐个运行 RED，确认失败原因分别命中四个审核问题**
- [x] **步骤 3：按证据路径读取最新测试结果，同时保留完整历史记录**
- [x] **步骤 4：在统一写入口拒绝完成态，在初始化锁内拒绝覆盖已有状态或恢复副本**
- [x] **步骤 5：审批强制绑定说明、证据路径和 SHA-256，并要求 `actor=user`**
- [x] **步骤 6：运行状态测试、结构校验、状态校验、Harness 冒烟和差异检查**

### 任务 9：三次审核门禁与审计修复

**文件：**
- 修改：`.harness/scripts/lib/state-runtime.mjs`
- 修改：`.harness/scripts/tests/state-runtime.test.mjs`
- 修改：`.codex/skills/frontier-state-runner/SKILL.md`
- 修改：`docs/harness-m2-state-runtime/DESIGN.md`
- 修改：`docs/harness-m2-state-runtime/REPORT.md`

- [x] **步骤 1：测试报告内容变化后门禁必须失败**

```javascript
await write(root, ".harness/reports/test-report.md", "# changed after pass\n");
await assert.rejects(runStateCommand({ root, command: "next" }), /test evidence.*changed/i);
```

- [x] **步骤 2：纯构建在没有发布动作时允许推进**

```javascript
const advanced = await runStateCommand({ root, command: "next" });
assert.equal(advanced.state.phase, "interface-verification");
```

- [x] **步骤 3：完成态写命令先对账孤立事务，再拒绝状态修改**

```javascript
await assert.rejects(runStateCommand({ root, command: "record", recordType: "note", status: "recorded" }), /completed/i);
assert.ok(events.some((event) => event.transactionId === orphanId && event.event === "committed"));
```

- [x] **步骤 4：实现最小修复**

```javascript
await assertRecordEvidenceCurrent(root, latestTestRecord, "Test evidence");
if (phaseId === "git-delivery") await assertApprovalGate(root, state, phaseId);
await reconcileEventLog(root, fresh.state);
if (fresh.state.runtime.status === "completed") throw new Error("A completed run is immutable.");
```

`quality_gates` 保留为严格解析和校验的描述性元数据，M2 的可执行门禁由确定性代码实现；真实发布仍由 `frontier-build-publish` 在执行前获取用户批准。

- [x] **步骤 5：运行完整验证**

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state.template.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
git diff --check
```

结果：状态运行时及既有 Harness/知识回归、结构与状态校验、完整冒烟、知识新鲜度和差异检查均退出 0；`backend/src/**`、`frontend/src/**` 差异为空。

本任务不执行暂存、提交、推送、发布或部署。

### 任务 10：四次审核恢复一致性修复

- [x] **步骤 1：初始化必须识别正式文件、`.tmp` 和 `.bak` 中可恢复的活动指针**
- [x] **步骤 2：跨 Story 替换指针时按 `.tmp` 当前事务身份或正式指针身份选择候选，旧高 revision 备份不得遮蔽新运行**
- [x] **步骤 3：指针 revision 领先可恢复状态时失败关闭，状态领先指针仍允许恢复**
- [x] **步骤 4：所有已有运行命令校验 runtime，初始化和默认定位校验活动指针契约**
- [x] **步骤 5：同 revision 初始化重试时，后续提交取代的早期孤立 intent 记录为 `aborted`；无 committed 尾事件时仅最后一个孤立 intent 可提交**
- [x] **步骤 6：每个业务分别完成 RED、GREEN、Harness 验证和只读代码审核**

### 任务 11：五次审核跨文件提交与并发闭环

- [x] **步骤 1：跨文件提交按 `pointer stage -> state commit -> pointer promote` 执行，并增加两个中断窗口的故障注入测试**
- [x] **步骤 2：指针候选结合目标状态选择，未提交的 `pointer.tmp` 不得遮蔽正式指针，已提交状态必须能恢复临时指针**
- [x] **步骤 3：新 Story 初始化前对账 completed 旧运行，闭合 `complete` 状态已提交但尾事件缺失的事务**
- [x] **步骤 4：初始化按 `active-run.lock -> completed Story lock` 固定锁序重新读取并对账，拒绝与仍在执行的 `complete` 并发替换指针**
- [x] **步骤 5：上述问题分别观察到 RED，完成最小实现、针对性 GREEN 和独立只读复审；复审无 `BLOCKER/WARNING`**
