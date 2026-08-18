# FrontierScan Harness M7-D 双重闭环验收实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 在当前会话串行实施。每项任务必须按复选框跟踪；生产行为必须先有失败测试。独立 Agent 只承担只读审核，不承担实现或 State 写入。

**Goal:** 通过异常 fixture 和一个 Dashboard 阅读状态筛选真实 Story，证明 State v2、知识闭环和确定性串行驱动能够完成单 Story 九阶段开发闭环。

**Architecture:** 在现有 State/Story/E2E/Knowledge/Delivery Runtime 之上增加只读最终 State 核验器和测试级 M7-D acceptance 套件，不新增生产编排协议。Harness 验收资产通过后，使用正式 State v2 初始化 `M7-D-001`，由当前 Codex 会话串行完成业务需求、设计、DAG、TDD 实现、测试、审核、构建、浏览器验证和交付准备。

**Tech Stack:** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Spring Boot 3.3.5、Java 17、Maven、Vue 3、TypeScript、Vite、现有 Harness Runtime、SHA-256、浏览器自动化。

---

## 执行状态

本计划已于 2026-08-18 完成。实际执行包含一次经用户批准的 late-stage rework/supersession、交付扫描性能修复和 closure verifier 构建产物边界修复；最终事实以 `REPORT.md`、`.harness/states/e2e-M7-D-001.json` 和绑定证据为准。下方复选框保留原始实施拆解，不用于覆盖实际报告中的偏差说明。

## 1. 实施边界

- 不新增或修改 State v2、phase result、approval 或 delivery receipt 协议。
- 不创建真实 Agent Provider、Worktree、并行 wave 或 Fork-Join。
- 不执行 Docker、发布、部署或外部服务写入。
- 不自动执行 `git add`、`git commit`、`git push` 或创建 PR。
- 当前会话串行实施；独立 Agent 只读审核设计、计划和最终差异。
- Harness 资产先完成并验证，再初始化真实 Story。
- 真实 Story 只实现 Dashboard “全部/未读/已读”筛选。
- Favorites、未读数量、批量标记、筛选持久化和数据库迁移不在范围内。
- completed State 不因后续 Git receipt 被修改。

## 2. 文件结构

### 2.1 新建

- `.harness/scripts/lib/story-closure-verifier.mjs`
  - 只读加载 completed State。
  - 复用现有 State contract 和 completion gate。
  - 安全读取 State 正式引用的证据并校验 SHA-256。
  - 输出稳定闭环摘要。
- `.harness/scripts/verify-story-closure.ps1`
  - 提供固定 PowerShell CLI。
  - 只允许 `StateFile`、`Root` 和 `Json`。
- `.harness/scripts/tests/story-closure-verifier.test.mjs`
  - 覆盖完整 State、核心事实缺失、证据漂移和路径逃逸。
- `.harness/scripts/tests/story-closure-verifier-cli.test.ps1`
  - 覆盖 JSON 输出、退出码和参数拒绝。
- `.harness/scripts/tests/m7d-closure-acceptance.test.mjs`
  - 通过公开 Runtime 接口执行 M7-D 七类异常场景。
- `docs/harness-m7d-closure-acceptance/REPORT.md`
  - 最终记录 fixture、真实 Story、测试、审核、验证和剩余风险。

真实 Story 预计新增：

- `.harness/states/e2e-M7-D-001.json`
- `.harness/states/e2e-M7-D-001.events.jsonl`
- `.harness/runs/M7-D-001/`

### 2.2 修改

Harness：

- `.harness/scripts/README.md`
- `.harness/structure-manifest.yaml`

真实业务：

- `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`
- `backend/src/test/java/com/frontierscan/article/ArticleFilterIntegrationTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`
- `frontend/src/api/articles.ts`
- `frontend/src/views/DashboardView.vue`

最终同步：

- `docs/harness-m7-m12-roadmap/PLAN.md`
- `docs/harness-engineering-target-and-gap.md`
- `docs/harness-architecture-adaptation.md`
- `docs/harness-structure-checklist.md`
- `CODEX-CROSS-SESSION-HANDOFF.md`
- `llm-knowledge/overview.md`
- 刷新实际涉及的 `llm-knowledge/backend/`、`frontend/`、`common/` 和 `index/`

## 3. Task 1：最终 State 核验器 RED

**目标：** 先冻结核验器的公共接口、成功摘要和失败边界。

**Files:**

- Create: `.harness/scripts/tests/story-closure-verifier.test.mjs`
- Read: `.harness/scripts/lib/state-contract.mjs`
- Read: `.harness/scripts/lib/acceptance-gate.mjs`
- Read: `.harness/scripts/lib/knowledge-runtime.mjs`
- Read: `.harness/schemas/e2e-state-v2.schema.json`

- [ ] **Step 1：建立完整 completed State fixture**

测试 helper 只在临时仓库中工作，并创建 State 正式引用的 Markdown、DAG、测试、构建、验证和交付文件。

期望调用形态：

```javascript
const result = await verifyStoryClosure({
  root,
  stateFile: ".harness/states/e2e-M7-D-FIXTURE.json",
});

assert.equal(result.status, "passed");
assert.equal(result.storyId, "M7-D-FIXTURE");
assert.equal(result.delivery.status, "ready");
assert.equal(result.delivery.gitStatus, "not-requested");
```

- [ ] **Step 2：增加核心事实失败用例**

逐项复制完整 State 后破坏一个事实：

```javascript
for (const mutate of [
  (state) => { state.runtime.status = "active"; },
  (state) => { state.requirement.acceptanceCriteria = []; },
  (state) => { state.dag.nodes = []; },
  (state) => { state.tests.results = []; },
  (state) => { state.review.status = "blocked"; },
  (state) => {
    state.review.status = "passed";
    state.review.findings = [{
      findingId: "REV-WARN-1",
      severity: "WARNING",
      status: "open",
      summary: "Open warning must block M7-D closure verification.",
      file: null,
      line: null,
      evidence: null,
    }];
  },
  (state) => { state.verification.results = []; },
  (state) => { state.delivery.status = "pending"; },
]) {
  await assert.rejects(
    verifyStoryClosure({ root, stateFile, stateMutator: mutate }),
  );
}
```

测试 helper 不应成为生产 API；实际做法是在调用前写入变体 State。

- [ ] **Step 3：增加正式证据漂移失败用例**

```javascript
await writeFile(path.join(root, reportPath), "drifted\n", "utf8");

await assert.rejects(
  verifyStoryClosure({ root, stateFile }),
  /hash|changed|drift/i,
);
```

- [ ] **Step 4：增加路径安全失败用例**

至少覆盖：

```text
绝对 stateFile
.harness/states/../../outside.json
State output 使用 ../
State output 使用绝对路径
.harness/states 下的 symlink/junction State
.harness/runs 下的 symlink/junction evidence
普通目录伪装为文件
realpath 指向仓库外
```

Windows 无法创建 symlink/junction 时，用例必须显式记录平台能力并跳过该单项，不得把路径字符串测试误报为真实 reparse point 测试。

- [ ] **Step 5：运行 RED**

```powershell
node .\.harness\scripts\tests\story-closure-verifier.test.mjs
```

预期：失败，原因是 `story-closure-verifier.mjs` 尚不存在，而不是 fixture JSON 或测试语法错误。

## 4. Task 2：最终 State 核验器 GREEN

**目标：** 用现有契约和门禁实现最小只读核验器。

**Files:**

- Create: `.harness/scripts/lib/story-closure-verifier.mjs`
- Test: `.harness/scripts/tests/story-closure-verifier.test.mjs`

- [ ] **Step 1：实现固定 State 路径解析**

接口：

```javascript
export async function verifyStoryClosure({
  root = process.cwd(),
  stateFile,
}) {}
```

路径解析至少满足：

```javascript
function resolveRepositoryFile(root, relativePath, allowedDirectory, label) {
  if (typeof relativePath !== "string"
      || !relativePath
      || path.isAbsolute(relativePath)) {
    throw new Error(`${label} must be a repository-relative path.`);
  }
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, relativePath);
  const allowedPath = path.resolve(rootPath, allowedDirectory);
  const withinRoot = path.relative(rootPath, fullPath);
  const withinAllowed = path.relative(allowedPath, fullPath);
  if (!withinRoot
      || withinRoot === ".."
      || withinRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(withinRoot)
      || !withinAllowed
      || withinAllowed === ".."
      || withinAllowed.startsWith(`..${path.sep}`)
      || path.isAbsolute(withinAllowed)) {
    throw new Error(`${label} must stay inside ${allowedDirectory}.`);
  }
  return { fullPath, relativePath: relativePath.replaceAll("\\", "/") };
}
```

`stateFile` 固定允许目录为 `.harness/states`。证据根据字段类型允许位于：

```text
.harness/runs
.harness/states
llm-knowledge
docs
```

不允许调用方传入额外 allowed directory。

- [ ] **Step 2：实现逐级 reparse point 和 realpath 校验**

复用 `knowledge-runtime.mjs` 的行为语义，不导出其私有函数，也不从其他 Runtime 深层导入私有实现。

```javascript
async function assertSafeRegularFile(root, fullPath) {
  const rootPath = path.resolve(root);
  const rootRealPath = await realpath(rootPath);
  const relative = path.relative(rootPath, fullPath);
  let current = rootPath;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Path contains a symbolic link or junction: ${current}`);
    }
    const currentRealPath = await realpath(current);
    const realRelative = path.relative(rootRealPath, currentRealPath);
    if (realRelative === ".."
        || realRelative.startsWith(`..${path.sep}`)
        || path.isAbsolute(realRelative)) {
      throw new Error(`Path resolves outside repository: ${current}`);
    }
  }
  const finalInfo = await lstat(fullPath);
  if (!finalInfo.isFile() || finalInfo.isSymbolicLink()) {
    throw new Error(`Expected a regular file: ${fullPath}`);
  }
}
```

- [ ] **Step 3：加载并验证 State**

```javascript
const source = await readFile(statePath.fullPath);
const state = JSON.parse(source.toString("utf8"));
validateStateDocument(state);

if (state.schemaVersion !== "2.0"
    || state.phase !== "done"
    || state.runtime.status !== "completed") {
  throw new Error("Story closure verification requires a completed State v2.");
}
```

workflow 和 Schema 路径不得从任意输入读取：

```text
schemaVersion=2.0
-> .harness/schemas/e2e-state-v2.schema.json
-> .harness/workflows/e2e-development-v2.yaml
```

- [ ] **Step 4：复用现有 completion gate**

```javascript
assertRequirementGate(state);
assertCompletionGate(state);

const unresolvedReviewFinding = state.review.findings.find(
  (finding) => ["BLOCKER", "WARNING"].includes(finding.severity)
    && finding.status === "open",
);
if (unresolvedReviewFinding) {
  throw new Error(
    `Story closure has an unresolved ${unresolvedReviewFinding.severity} finding.`,
  );
}
```

核验器不得重新实现 criterion、knowledge、DAG、test、verification 和 acceptance 聚合规则。拒绝 open WARNING 是 M7-D 里程碑额外只读门禁，不修改 State v2 completion gate 协议。

- [ ] **Step 5：校验 State 正式引用**

只遍历明确字段，不递归扫描所有字符串。

具有现成 path/hash 配对的字段：

```text
dag.sourceFile/sourceSha256
knowledge.areas[].freshnessEvidencePath/freshnessEvidenceSha256
knowledge.areas[].refreshTaskPath/refreshTaskSha256
knowledge.areas[].refreshReceiptPath/refreshReceiptSha256
tests.commands[].evidencePath/evidenceSha256
tests.results[].evidencePath/evidenceSha256
build.results[].evidencePath/evidenceSha256
build.artifacts[].path/sha256
build.externalActions[].evidencePath/evidenceSha256
verification.environment.evidencePath/evidenceSha256
verification.results[].evidencePath/evidenceSha256
approvals[].evidencePath/evidenceSha256
approvals[].receiptPath/receiptSha256
delivery.summaryFile/summarySha256
delivery.ownedManifestFile/ownedManifestSha256
```

`runtime.records[]` 单独处理：

- `type=phase-result` 的正式 record 必须同时具有 `path` 和 `sha256`，并验证文件身份。
- 其他 record 只有在同时存在非空 `path` 和 `sha256` 时才验证文件身份。
- 只有 `path`、没有 `sha256` 的历史或辅助 record 只检查路径规范和仓库包含关系，不推断不存在的哈希。

没有独立 SHA-256 字段的路径：

```text
review.findings[].evidence
review.findings[].file
implementation.actualFiles[]
delivery.ownedFiles[]
delivery.outOfPredictionFiles[]
delivery.unrelatedDirtyFiles[]
```

`review.findings[].evidence` 只进行路径安全和普通文件检查；若它与某个正式 `runtime.records[]` 的 `path` 相同，则同时使用该 record 的 SHA-256 校验。审核报告本体必须由 code-review 阶段的正式 passed `phase-result` record 提供路径和哈希。`review.findings[].file`、`implementation.actualFiles[]` 和 delivery 文件分类只检查仓库相对路径、规范化和包含关系，不读取目标，也不要求目标当前存在，因为这些列表可以合法描述已删除文件。不得为此扩展 State Schema。

带 path/hash 配对的正式证据必须：

1. 是仓库相对路径。
2. 位于对应允许目录。
3. 不经过 reparse point。
4. 是普通文件。
5. 当前 SHA-256 等于 State 记录值。

无哈希业务或历史路径只执行前两项路径检查，不读取目标、不要求目标存在，也不执行 SHA-256 校验。

- [ ] **Step 6：返回稳定摘要**

```javascript
return {
  schemaVersion: "1.0",
  storyId: state.storyId,
  runId: state.runtime.runId,
  status: "passed",
  stateFile: stateLocation.relativePath,
  stateSha256: sha256(source),
  requirement: {
    summary: state.requirement.summary,
    acceptanceCriteria: state.requirement.acceptanceCriteria,
  },
  decisions: state.design.decisions,
  knowledge: state.knowledge,
  dag: state.dag,
  implementation: state.implementation,
  tests: state.tests,
  review: state.review,
  build: state.build,
  verification: state.verification,
  acceptedGaps: state.approvals.filter(
    (approval) => approval.subjectType === "verification-gap",
  ),
  delivery: state.delivery,
  diagnostics: [],
};
```

不返回聊天、Markdown 正文或 delivery receipt 内容。

- [ ] **Step 7：运行 GREEN**

```powershell
node .\.harness\scripts\tests\story-closure-verifier.test.mjs
```

预期：输出 `story closure verifier tests passed`。

## 5. Task 3：PowerShell 核验入口

**目标：** 提供稳定 CLI 和错误退出码。

**Files:**

- Create: `.harness/scripts/verify-story-closure.ps1`
- Create: `.harness/scripts/tests/story-closure-verifier-cli.test.ps1`
- Modify: `.harness/scripts/README.md`

- [ ] **Step 1：编写 CLI RED**

测试创建临时完整 State fixture，并验证：

```powershell
$json = & $runner -StateFile ".harness/states/e2e-M7-D-FIXTURE.json" -Root $temporaryRoot -Json |
  Out-String | ConvertFrom-Json
if ($json.status -ne "passed") { throw "Expected passed closure." }
```

负向用例：

```text
缺少 StateFile
未知参数
v1 State
active v2 State
路径逃逸
损坏 JSON
```

- [ ] **Step 2：运行 RED**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\story-closure-verifier-cli.test.ps1
```

预期：因入口脚本不存在而失败。

- [ ] **Step 3：实现最小 PowerShell 包装**

```powershell
param(
  [Parameter(Mandatory = $true)]
  [string]$StateFile,
  [string]$Root,
  [switch]$Json
)

$ErrorActionPreference = "Stop"
if ([string]::IsNullOrWhiteSpace($Root)) {
  $Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$arguments = @(
  (Join-Path $PSScriptRoot "lib\story-closure-verifier.mjs"),
  "--root", $Root,
  "--state-file", $StateFile
)
if ($Json) { $arguments += "--json" }

& node @arguments
exit $LASTEXITCODE
```

Node CLI 仅允许 `--root`、`--state-file` 和 `--json`，未知参数返回非零。

- [ ] **Step 4：更新脚本说明**

在 `.harness/scripts/README.md` 明确：

```text
verify-story-closure 是 completed State 的只读完整性核验器。
它不记录 Git receipt、不修改 State，也不代替测试和审核。
```

- [ ] **Step 5：运行 GREEN**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\story-closure-verifier-cli.test.ps1
```

预期：输出 `story closure verifier CLI tests passed`。

## 6. Task 4：M7-D 异常 Acceptance 套件

**目标：** 用一个里程碑入口证明七类异常和交付语义仍可工作。

**Files:**

- Create: `.harness/scripts/tests/m7d-closure-acceptance.test.mjs`
- Read: `.harness/scripts/lib/state-runtime.mjs`
- Read: `.harness/scripts/lib/story-runtime.mjs`
- Read: `.harness/scripts/lib/knowledge-runtime.mjs`
- Read: `.harness/scripts/lib/delivery-runtime.mjs`

- [ ] **Step 1：建立测试级 fixture helper**

helper 只创建临时 Git 仓库、复制正式模板/workflow/agent policy，并通过公开 Runtime 初始化 State。不得复制 State 投影、approval subject hash、completion gate 或 delivery 验证逻辑。

```javascript
async function createM7DFixture(storyId) {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-m7d-"));
  await git(root, "init", "-b", "dev");
  await copyHarnessRuntimeAssets(root);
  await runStateCommand({ root, command: "init", storyId, summary: "M7-D fixture" });
  return { root, storyId, stateFile: `.harness/states/e2e-${storyId}.json` };
}
```

- [ ] **Step 2：编写七类纵向场景**

每个场景使用独立 fixture：

```javascript
await testBlockResume();
await testAcceptedVerificationGap();
await testAcceptedStaleKnowledge();
await testResultDriftAndDuplicateApply();
await testInterruptedPhaseRecovery();
await testCompletionWithoutGit();
await testDeliveryReceiptAfterCompletion();
```

关键断言：

```text
block/resume
  activeBlock 清空，事件保留，新 attempt 身份变化

accepted gap
  未批准失败，批准后完成，evidence 漂移后旧批准失效

accepted stale
  按 area 批准，observedStatus 保持 stale，subject 漂移失败

result drift/duplicate apply
  apply 前漂移零写入，重复 apply 幂等，record 不重复
  成功 apply 后正式 result 再次漂移必须失败关闭

interruption
  beforeAdvance 和 afterAdvance 两个窗口均可恢复

no Git
  delivery.status=ready + gitStatus=not-requested 可 completed

delivery receipt
  临时仓库真实 commit 可记录
  伪造 commit、错误 parent、缺失 owned file、remote/ref 不匹配失败
  State 字节不变
```

- [ ] **Step 3：运行 RED**

首次运行：

```powershell
node .\.harness\scripts\tests\m7d-closure-acceptance.test.mjs
```

如果某个场景因 Runtime 缺陷失败，必须先确认它是路线要求的真实缺陷，不得降低断言。

如果场景全部立即通过，这是合法的验收测试结果，因为 M7-D 主要复用已完成能力；在报告中记录“验收测试首次运行即 GREEN，未修改生产 Runtime”。不得为了制造 RED 修改正常 Runtime。

- [ ] **Step 4：只修复真实缺陷**

发现缺陷时遵循：

```text
新增最小复现测试
-> 确认 RED
-> 修改现有责任模块
-> 运行 GREEN
-> 运行相关回归
```

不允许通过 M7-D 新增第二套 Runtime。

- [ ] **Step 5：运行 acceptance GREEN**

```powershell
node .\.harness\scripts\tests\m7d-closure-acceptance.test.mjs
```

预期：输出 `M7-D closure acceptance fixtures passed`。

## 7. Task 5：Harness 验收资产回归与审核

**目标：** 在真实业务开始前证明新增验收层没有破坏既有协议。

- [ ] **Step 1：更新结构清单**

将新脚本和测试加入 `.harness/structure-manifest.yaml`，不预登记尚未创建的真实 Story 动态文件。

- [ ] **Step 2：运行定向回归**

```powershell
node .\.harness\scripts\tests\story-closure-verifier.test.mjs
node .\.harness\scripts\tests\m7d-closure-acceptance.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\delivery-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\story-closure-verifier-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\e2e-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\delivery-cli.test.ps1
```

- [ ] **Step 3：运行结构门禁**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

- [ ] **Step 4：独立只读审核**

审核范围仅为：

```text
story-closure-verifier
M7-D acceptance test
PowerShell CLI
结构清单和脚本说明
M7-D DESIGN/PLAN
```

审核重点：

- 路径逃逸和 reparse point。
- 错误信任 State 任意路径。
- 重复实现 completion gate。
- completed State 被修改。
- 测试只验证 mock 而未调用公开 Runtime。
- 验收场景遗漏。

修复全部 BLOCKER/WARNING 后复审。

- [ ] **Step 5：安全停点**

记录 Harness 验收资产状态。此处不执行 Git 操作；只有用户明确要求时才暂存或提交。

## 8. Task 6：初始化真实 Story 与 requirement

**目标：** 使用正式 State v2 创建 `M7-D-001`，不覆盖历史 M6-A。

**Files:**

- Create: `.harness/states/e2e-M7-D-001.json`
- Create: `.harness/states/e2e-M7-D-001.events.jsonl`
- Modify: `.harness/states/active-run.json`
- Create: `.harness/runs/M7-D-001/phases/00-requirement/...`

- [ ] **Step 1：确认工作区与初始 dirty**

```powershell
git status --short
git rev-parse HEAD
```

预期：只有 M7-D Harness 资产属于本里程碑工作区修改。State init 必须把这些路径记录为 initial dirty，避免真实 Story 错误拥有 Harness 资产。

- [ ] **Step 2：初始化 State**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-state.ps1 `
  -Command init `
  -StoryId M7-D-001 `
  -Summary "Dashboard 文章列表支持全部、未读和已读筛选" `
  -Json
```

- [ ] **Step 3：验证新 State**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-state.ps1 `
  -StateFile .harness/states/e2e-M7-D-001.json

powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-e2e.ps1 `
  -Command Status `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

预期：`action=prepare`、`phase=requirement`。

- [ ] **Step 4：准备 requirement attempt**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-e2e.ps1 `
  -Command Step `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

预期：`cognitive-action-required`。

- [ ] **Step 5：编写 requirement result**

验收项固定为设计中的：

```text
AC-READ-FILTER-1 未读筛选
AC-READ-FILTER-2 已读筛选
AC-READ-FILTER-3 全部和组合筛选兼容
AC-READ-FILTER-4 非法参数和用户隔离
AC-READ-FILTER-5 前端切换、请求和分页一致
```

开放问题为空，非目标明确列出 Favorites、批量操作、未读计数和迁移。

- [ ] **Step 6：Apply 并验证推进**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-e2e.ps1 `
  -Command Apply `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

预期：进入 `technical-design`。

## 9. Task 7：technical-design 与知识闭环

**目标：** 通过 M7-C 正式接口处理实际 relevant area。

- [ ] **Step 1：prepare technical-design**

```powershell
.\.harness\scripts\run-e2e.ps1 `
  -Command Step `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

- [ ] **Step 2：确定 affectedAreas**

预计：

```json
["backend", "frontend", "common"]
```

其中：

- backend：Controller、Service、Repository 和测试。
- frontend：API 参数和 Dashboard 控件。
- common：Harness 入口、项目约束和跨层契约。

最终以技术设计 result 为准，不把预期值硬编码进 Runtime。

- [ ] **Step 3：逐 area 检查知识**

```powershell
foreach ($area in @("backend", "frontend", "common")) {
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    .\.harness\scripts\run-story.ps1 `
    -Command check-knowledge `
    -StateFile .harness/states/e2e-M7-D-001.json `
    -Area $area `
    -Json
}
```

- [ ] **Step 4：默认执行刷新**

对 inspection 返回的 stale/missing relevant area，逐项执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-story.ps1 `
  -Command refresh-knowledge `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Area <area> `
  -Json
```

不直接运行未绑定 attempt 的裸 `generate-kb.ps1` 代替正式刷新。

刷新失败时先诊断；只有无法修复时才向用户申请该具体 area 的 `accepted-stale`。

- [ ] **Step 5：编写 technical-design result**

关键决策：

```text
Controller 使用 @Validated + @Pattern 约束 all|read|unread
Service 将 null/blank 归一化为 all，并只在 readStatus=all 且无其他搜索条件时使用派生查询
Repository 原生查询增加 read_at 条件
Dashboard 使用独立 segmented control，不改变 Favorites
切换状态时 currentPage=0 并复用 reloadArticlePage
前端无组件测试框架，记录 TDD 例外；使用 build + 浏览器验证
```

- [ ] **Step 6：Apply technical-design**

确认 inspection 为 `result-ready`，再执行 `run-e2e Apply`。

## 10. Task 8：Task DAG

**目标：** 建立可追踪的串行任务与验收覆盖。

建议节点：

```text
T1 后端阅读状态筛选契约和测试
T2 后端最小实现
T3 Dashboard 前端筛选控件
T4 测试、审核、构建和浏览器验证证据
```

依赖：

```text
T1 -> T2
T2 -> T3
T2 -> T4
T3 -> T4
```

预测文件必须精确列出，不包含 Favorites、迁移和无关文档。

- [ ] **Step 1：prepare task-dag**
- [ ] **Step 2：生成 DAG 2.0**
- [ ] **Step 3：运行验证**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-task-dag.ps1 `
  -TaskDagFile <generated-task-dag.json>
```

- [ ] **Step 4：Apply task-dag**

预期：进入 `implementation`。

## 11. Task 9：后端阅读状态筛选 RED

**目标：** 在修改生产代码前证明新行为缺失。

**Files:**

- Modify: `backend/src/test/java/com/frontierscan/article/ArticleServiceFilterTest.java`
- Modify: `backend/src/test/java/com/frontierscan/article/ArticleFilterIntegrationTest.java`
- Modify: `backend/src/test/java/com/frontierscan/article/ArticleReadStatusApiIntegrationTest.java`

- [ ] **Step 1：更新 Service 单元测试调用签名**

现有文章测试中对 `ArticleService.listByUser` 的直接调用全部增加筛选参数 `"all"`，保证旧场景明确使用兼容语义。随后新增：

```java
@Test
@DisplayName("阅读状态筛选委托原生查询")
void shouldDelegateToNativeQueryWhenReadStatusPresent() {
    when(articleRepository.findWithFilters(
            anyLong(), any(), any(), any(), any(), any(), any(), eq("unread"), any()))
            .thenReturn(Page.empty());

    articleService.listByUser(
            USER_ID, null, null, null, null, null, null, "unread",
            PageRequest.of(0, 10));

    verify(articleRepository).findWithFilters(
            anyLong(), any(), any(), any(), any(), any(), any(), eq("unread"), any());
}
```

再增加 `"all"` 保持派生查询的用例。

增加 Service 非法值 RED：

```java
@Test
@DisplayName("非法阅读状态在查询前被拒绝")
void shouldRejectInvalidReadStatusBeforeRepositoryCall() {
    assertThatThrownBy(() -> articleService.listByUser(
            USER_ID, null, null, null, null, null, null, "invalid",
            PageRequest.of(0, 10)))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessageContaining("readStatus");

    verifyNoInteractions(articleRepository);
}
```

- [ ] **Step 2：增加集成筛选数据**

在 fixture 中把两篇文章设为已读：

```java
articleTitle.setReadAt(OffsetDateTime.now().minusHours(2));
articleRecent.setReadAt(OffsetDateTime.now().minusHours(1));
articleRepository.saveAll(List.of(articleTitle, articleRecent));
```

新增：

```java
@Test
void shouldFilterUnreadArticles() {
    Page<Article> result = articleService.listByUser(
            userId, null, null, null, null, null, null, "unread",
            PageRequest.of(0, 10));
    assertThat(result.getContent()).allMatch(article -> article.getReadAt() == null);
    assertThat(result.getTotalElements()).isEqualTo(2);
}

@Test
void shouldFilterReadArticlesWithExistingConditions() {
    Page<Article> result = articleService.listByUser(
            userId, null, null, "AI", null, null, null, "read",
            PageRequest.of(0, 10));
    assertThat(result.getContent()).hasSize(1);
    assertThat(result.getContent().get(0).getReadAt()).isNotNull();
}
```

- [ ] **Step 3：增加 API 参数测试**

在 `ArticleReadStatusApiIntegrationTest` 增加：

```java
mockMvc.perform(get("/api/articles")
        .param("readStatus", "unread")
        .header("Authorization", "Bearer " + ownerToken))
    .andExpect(status().isOk())
    .andExpect(jsonPath("$.data.content[0].readAt").doesNotExist());

mockMvc.perform(get("/api/articles")
        .param("readStatus", "invalid")
        .header("Authorization", "Bearer " + ownerToken))
    .andExpect(status().isBadRequest())
    .andExpect(jsonPath("$.success").value(false));
```

API fixture 增加当前用户已读/未读文章及其他用户文章，新增带 `readStatus` 的列表隔离用例，断言响应不包含其他用户 ID。现有 `UserDataIsolationIntegrationTest` 继续作为全量回归执行，但本 Story 不需要修改该文件。

- [ ] **Step 4：运行 RED**

```powershell
Set-Location backend
mvn -q -Dtest=ArticleServiceFilterTest,ArticleFilterIntegrationTest,ArticleReadStatusApiIntegrationTest test
```

预期：编译或断言失败，原因是生产签名和查询尚未支持 `readStatus`。

## 12. Task 10：后端阅读状态筛选 GREEN

**目标：** 用最少生产修改通过后端测试。

**Files:**

- Modify: `backend/src/main/java/com/frontierscan/article/ArticleController.java`
- Modify: `backend/src/main/java/com/frontierscan/article/ArticleService.java`
- Modify: `backend/src/main/java/com/frontierscan/article/ArticleRepository.java`

- [ ] **Step 1：Controller 增加受限参数**

```java
@Validated
@RestController
@RequestMapping("/api/articles")
public class ArticleController {
```

列表参数：

```java
@RequestParam(defaultValue = "all")
@Pattern(regexp = "all|read|unread",
        message = "readStatus must be one of all, read, unread")
String readStatus,
```

调用：

```java
articleService.listByUser(
        principal.userId(), categoryId, siteId, keyword, tagId,
        startDate, endDate, readStatus, PageRequest.of(page, size));
```

复用现有 `ConstraintViolationException` 400 handler，不新增异常类型。

- [ ] **Step 2：Service 归一化并选择查询**

签名：

```java
public Page<Article> listByUser(
        Long userId,
        Long categoryId,
        Long siteId,
        String keyword,
        Long tagId,
        String startDateStr,
        String endDateStr,
        String readStatus,
        Pageable pageable)
```

最小逻辑：

```java
String normalizedReadStatus =
        readStatus == null || readStatus.isBlank() ? "all" : readStatus;

if (!List.of("all", "read", "unread").contains(normalizedReadStatus)) {
    throw new IllegalArgumentException("Unsupported readStatus: " + normalizedReadStatus);
}

boolean hasSearchFilters =
        keyword != null || tagId != null || startDateStr != null || endDateStr != null;
boolean hasReadFilter = !"all".equals(normalizedReadStatus);

if (!hasSearchFilters && !hasReadFilter) {
    // 保留现有 category/site/全部派生查询
}

String keywordPattern = keyword != null ? "%" + keyword.toLowerCase() + "%" : null;
return articleRepository.findWithFilters(
        userId, categoryId, siteId, keywordPattern, tagId,
        startDateStr, endDateStr, normalizedReadStatus, pageable);
```

Controller 已负责 HTTP 400；该检查保护直接 Service 调用和未来调用方。

- [ ] **Step 3：Repository 增加 SQL 条件**

方法参数增加：

```java
@Param("readStatus") String readStatus
```

主查询与 countQuery 同时加入：

```sql
and (
  :readStatus = 'all'
  or (:readStatus = 'unread' and a.read_at is null)
  or (:readStatus = 'read' and a.read_at is not null)
)
```

不得只修改主查询而遗漏 countQuery。

- [ ] **Step 4：运行 GREEN**

```powershell
Set-Location backend
mvn -q -Dtest=ArticleServiceFilterTest,ArticleFilterIntegrationTest,ArticleReadStatusApiIntegrationTest test
```

预期：PASS。

- [ ] **Step 5：运行文章模块回归**

```powershell
mvn -q -Dtest=ArticleFilterIntegrationTest,ArticleServiceFilterTest,ArticleReadStatusTest,ArticleReadStatusApiIntegrationTest,UserDataIsolationIntegrationTest test
```

预期：PASS，无新增 warning。

## 13. Task 11：Dashboard 前端筛选

**目标：** 增加紧凑、独立、不会影响 Favorites 的阅读状态控件。

**TDD 说明：** 当前 frontend 没有组件测试框架或测试命令。为本 Story 引入 Vitest/Vue Test Utils 会扩大 M7-D 范围，因此前端任务记录 `implementation.method=exception` 的局部例外理由：使用 TypeScript build 和真实浏览器请求/界面验证替代自动组件测试。后端业务和 API 契约仍严格 TDD。

**Files:**

- Modify: `frontend/src/api/articles.ts`
- Modify: `frontend/src/views/DashboardView.vue`

- [ ] **Step 1：扩展 API 类型**

```typescript
list(params: {
  categoryId?: number;
  siteId?: number;
  keyword?: string;
  tagId?: number;
  startDate?: string;
  endDate?: string;
  readStatus?: 'all' | 'read' | 'unread';
  page?: number;
  size?: number;
})
```

- [ ] **Step 2：增加 Dashboard 状态**

```typescript
type ReadStatusFilter = 'all' | 'unread' | 'read';
const selectedReadStatus = ref<ReadStatusFilter>('all');
```

- [ ] **Step 3：增加独立 segmented control**

放在 Dashboard `ArticleFilterBar` 附近，不修改 Favorites：

```vue
<div class="read-filter" aria-label="阅读状态筛选">
  <button
    v-for="option in readStatusOptions"
    :key="option.value"
    type="button"
    :class="{ active: selectedReadStatus === option.value }"
    :aria-pressed="selectedReadStatus === option.value"
    :disabled="loading"
    @click="selectReadStatus(option.value)"
  >
    {{ option.label }}
  </button>
</div>
```

```typescript
const readStatusOptions: Array<{ value: ReadStatusFilter; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'unread', label: '未读' },
  { value: 'read', label: '已读' },
];

function selectReadStatus(value: ReadStatusFilter) {
  if (selectedReadStatus.value === value) {
    return;
  }
  selectedReadStatus.value = value;
  currentPage.value = 0;
  reloadArticlePage();
}
```

- [ ] **Step 4：发送参数**

```typescript
const params: Record<string, any> = {
  page: currentPage.value,
  size: pageSize.value,
  readStatus: selectedReadStatus.value,
};
```

明确发送 `all`，便于浏览器验证当前状态与请求一致；后端同时支持未传参数保持兼容。

- [ ] **Step 5：增加最小样式**

```css
.read-filter {
  display: inline-flex;
  gap: 4px;
}

.read-filter button {
  background: #f4f7f6;
  color: #53605c;
  min-height: 34px;
  padding: 7px 12px;
}

.read-filter button.active {
  background: #136f63;
  color: #fff;
}
```

不使用卡片、渐变或装饰背景。移动端允许换行，按钮文字不得溢出。

- [ ] **Step 6：运行前端构建**

```powershell
Set-Location frontend
npm run build
```

预期：`vue-tsc --noEmit` 和 Vite build 均成功。

## 14. Task 12：implementation 与 unit-test 阶段

**目标：** 把真实修改和测试覆盖投影到 State。

- [ ] **Step 1：完成 implementation result**

`actualFiles` 只列真实业务文件，不包含 Story 初始化前的 Harness dirty files。

`completedTaskIds` 覆盖 DAG 全部节点。

开发方法记录：

```text
后端：tdd
前端：exception
例外理由：仓库无组件测试框架；本次不引入依赖，使用类型构建和真实浏览器验证
```

如果现有 State 只支持一个全局 `method`，使用 `exception` 并在 notes 中明确后端实际遵循 TDD，避免把前端例外伪装为全量 TDD。

- [ ] **Step 2：Apply implementation**

- [ ] **Step 3：运行测试选择器**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\select-tests.ps1
```

记录建议，但定向命令以本计划实际测试为准。

- [ ] **Step 4：运行 unit-test 命令**

```powershell
Set-Location backend
mvn -q -Dtest=ArticleFilterIntegrationTest,ArticleServiceFilterTest,ArticleReadStatusTest,ArticleReadStatusApiIntegrationTest,UserDataIsolationIntegrationTest test

Set-Location ..\frontend
npm run build
```

- [ ] **Step 5：建立 criterion 覆盖**

```text
AC-READ-FILTER-1 -> unread service/integration/API tests
AC-READ-FILTER-2 -> read service/integration/API tests
AC-READ-FILTER-3 -> all + combined + pagination tests
AC-READ-FILTER-4 -> invalid parameter + user isolation tests
AC-READ-FILTER-5 -> frontend build + interface browser cases
```

- [ ] **Step 6：Apply unit-test**

required tests 必须为 passed；构建不能代替 AC-READ-FILTER-5 的界面验证。

## 15. Task 13：独立代码审核

**目标：** 审核真实 Story owned diff，不修改文件。

审核 Agent 获取：

```text
业务目标和五个 criterion
DESIGN/PLAN
State 和 DAG 路径
baseline HEAD 与 initial dirty
业务 owned diff
测试结果
明确非目标
```

重点：

- native query 主查询与 countQuery 是否一致。
- `all/read/unread` 参数和非法值语义。
- 用户隔离是否仍只依赖当前 principal。
- Dashboard 是否错误影响 Favorites。
- 切换筛选是否回第一页。
- 异步请求竞态、失败反馈和 loading 状态。
- 前端控件可访问性和移动端布局。
- 是否存在无关重构。

发现问题时：

```text
写失败测试
-> 最小修复
-> 重跑定向测试和 build
-> 第二轮只读审核
```

无未解决 BLOCKER/WARNING 后才能 Apply code-review。

## 16. Task 14：build-publish

**目标：** 完成本地构建，不发布。

- [ ] **Step 1：运行构建规划**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\plan-build.ps1
```

- [ ] **Step 2：运行后端构建**

```powershell
Set-Location backend
mvn -q test
```

- [ ] **Step 3：运行前端构建**

```powershell
Set-Location frontend
npm run build
```

- [ ] **Step 4：记录外部动作**

```text
publish/deploy/docker-build/docker-up/docker-down = not-requested
```

- [ ] **Step 5：Apply build-publish**

不得把本地 build 描述为发布。

## 17. Task 15：真实浏览器 Interface Verification

**目标：** 验证 UI 状态、请求参数、列表结果和分页行为。

优先使用本地 Vite 加浏览器请求拦截，不要求 Docker：

```text
启动 frontend dev server
-> 浏览器写入测试 token
-> 对 /api/categories、/api/sites、/api/articles/count、/api/articles/favorites 提供固定响应
-> 对 /api/articles 根据 readStatus 返回不同 fixture
-> 打开 /dashboard
-> 操作三个筛选按钮
-> 记录请求和 DOM 结果
```

- [ ] **Step 1：启动 Vite**

```powershell
Set-Location frontend
npm run dev -- --host 127.0.0.1
```

使用空闲端口；该进程在验证完成后关闭。

- [ ] **Step 2：准备浏览器 mock**

浏览器自动化只拦截本地 `/api/**` 请求，不修改仓库文件。固定文章：

```text
unread: 文章 A、文章 B，readAt=null
read: 文章 C，readAt=固定时间
all: A、B、C
```

每次请求记录：

```text
URL
readStatus
page
size
返回文章 IDs
```

- [ ] **Step 3：验证三个状态**

用例：

```text
IV-READ-ALL
  初始“全部”被选中
  请求 readStatus=all
  显示 A/B/C

IV-READ-UNREAD
  点击“未读”
  aria-pressed=true
  请求 readStatus=unread&page=0
  只显示 A/B

IV-READ-READ
  先切换到非首页 fixture，再点击“已读”
  请求 readStatus=read&page=0
  只显示 C

IV-READ-FAVORITES-SCOPE
  Favorites 页面不存在阅读状态筛选控件
  favorites 请求不包含 readStatus
```

- [ ] **Step 4：保存证据**

保存：

```text
浏览器截图
请求记录 JSON
DOM 断言摘要
前端 URL 和验证时间
```

证据进入当前 interface-verification attempt，并绑定 SHA-256。

- [ ] **Step 5：环境失败处理**

如果浏览器、Vite 或请求拦截无法使用：

- result 记录 `blocked`。
- 不用 frontend build 替代 verified。
- 只有用户对具体 case 批准后才能 `accepted-with-known-gaps`。

- [ ] **Step 6：Apply interface-verification**

优先目标是所有 required case 为 `verified`。

## 18. Task 16：delivery-preparation 与最终 State 核验

**目标：** 无 Git 操作完成真实 Story。

- [ ] **Step 1：生成 owned manifest**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-delivery.ps1 `
  -Command PrepareManifest `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

- [ ] **Step 2：生成交付摘要**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\run-delivery.ps1 `
  -Command Summarize `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

检查：

```text
Harness initial dirty 不进入业务 owned files
业务后端/前端文件进入 owned files
不存在未解释 out-of-prediction files
gitStatus=not-requested
delivery.status=ready
```

- [ ] **Step 3：Apply delivery-preparation**

预期：State 进入 `done/completed`。

- [ ] **Step 4：运行最终核验器**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\verify-story-closure.ps1 `
  -StateFile .harness/states/e2e-M7-D-001.json `
  -Json
```

预期：`status=passed`。

- [ ] **Step 5：证明 completed State 不可变**

```powershell
$before = Get-FileHash .\.harness\states\e2e-M7-D-001.json -Algorithm SHA256
# 只执行 status/verify 等只读命令
$after = Get-FileHash .\.harness\states\e2e-M7-D-001.json -Algorithm SHA256
if ($before.Hash -ne $after.Hash) { throw "Completed State changed." }
```

此时不记录当前仓库 delivery receipt，因为尚未执行用户批准的真实 commit。

## 19. Task 17：M7-D 报告和项目同步

**目标：** 更新防偏移基线并记录真实证据。

- [ ] **Step 1：编写 `REPORT.md`**

包括：

```text
设计和审核结论
fixture 七类场景结果
final-State verifier 安全测试
真实 Story requirement/design/DAG 摘要
知识 freshness 处理
RED/GREEN 证据
后端测试和前端 build
代码审核
浏览器验证
delivery preparation
最终 State verifier 输出
未执行 Git 的事实
剩余风险
```

- [ ] **Step 2：更新路线**

`docs/harness-m7-m12-roadmap/PLAN.md`：

- M7-D fixture 勾选完成。
- 真实 Story 勾选完成。
- M7 完成门禁标记真实结果。
- M8 仍需用户批准才启动。

- [ ] **Step 3：更新目标基线**

`docs/harness-engineering-target-and-gap.md`：

- 更新日期和实施基线。
- 将 State v2、串行驱动和知识闭环从 fixture 提升为真实 Story 已验收。
- 关闭“M7-D 尚未完成”的差距。
- 下一优先级变为 M8-A 设计，不直接声明已启动。

- [ ] **Step 4：更新结构与交接**

同步：

```text
docs/harness-architecture-adaptation.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
llm-knowledge/overview.md
```

- [ ] **Step 5：刷新实现后知识**

业务源码变化后重新检查并刷新相关区域。该刷新用于下一 Story 和项目知识基线，不改写 completed State 中技术设计时点的 freshness 证据。

## 20. Task 18：最终回归和独立审核

- [ ] **Step 1：Harness 全量相关测试**

```powershell
node .\.harness\scripts\tests\story-closure-verifier.test.mjs
node .\.harness\scripts\tests\m7d-closure-acceptance.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\delivery-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\tests\story-closure-verifier-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\smoke-harness-flow.ps1
```

- [ ] **Step 2：业务回归**

```powershell
Set-Location backend
mvn -q test

Set-Location ..\frontend
npm run build
```

- [ ] **Step 3：State/DAG 验证**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-state.ps1 `
  -StateFile .harness/states/e2e-M7-D-001.json

powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
  .\.harness\scripts\validate-task-dag.ps1 `
  -TaskDagFile <M7-D-001-task-dag.json>
```

- [ ] **Step 4：差异检查**

```powershell
git diff --check
git status --short
```

- [ ] **Step 5：最终独立只读审核**

Agent 审核全部 M7-D task-owned diff、最终 State、REPORT 和测试证据。必须无未解决 BLOCKER/WARNING。

- [ ] **Step 6：交付停点**

向用户汇报：

```text
M7-D 是否通过
真实 Story 效果
测试和审核证据
工作区修改范围
是否存在已知缺口
未执行 git add/commit/push
下一步为用户批准后提交，或批准进入 M8-A 设计
```

## 21. 建议提交点

以下仅是逻辑提交分组，不代表自动授权：

```text
1. feat(harness): add M7-D closure verification
2. feat(article): add read status filtering
3. docs(harness): complete M7-D closure acceptance
```

执行任意 `git add` 或 `git commit` 前必须再次获得用户明确批准。若用户要求一次提交，可在最终验证后合并为一个提交，不影响 Harness State 语义。

## 22. 完成标准

- M7-D acceptance suite 覆盖全部规定异常。
- final-State verifier 通过完整 State，并拒绝缺失事实、哈希漂移和路径逃逸。
- `M7-D-001` 使用 State v2 和统一串行入口完成九阶段。
- Dashboard 支持全部、未读和已读筛选，Favorites 不受影响。
- 后端筛选、组合条件、分页、非法参数和用户隔离测试通过。
- frontend build 通过，真实浏览器验证请求参数、DOM 结果和页码重置。
- relevant knowledge 在技术设计阶段 fresh 或逐项 accepted-stale。
- 独立代码审核无未解决 BLOCKER/WARNING。
- delivery preparation 正确，未请求 Git 也能进入 completed。
- 最终核验器只读取正式 State 和绑定证据即可回答完整闭环事实。
- M7-D 报告、路线、目标基线、结构清单、知识和交接同步。
- 全程未自动执行 Git、Docker、发布、部署、Worktree 或 Agent Provider。
