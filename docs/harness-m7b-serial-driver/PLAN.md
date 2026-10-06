# FrontierScan Harness M7-B 最小确定性串行驱动器实施计划

> **供代理式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，逐项先 RED、再最小 GREEN。当前会话串行实施；未经用户明确批准，不执行 Git 暂存、提交、推送、正式 Worktree、Docker、发布或部署。
>
> 计划状态：实施完成，最终独立只读代码审核无 BLOCKER/WARNING。

**目标：** 建立一个只根据 State、workflow 和当前 attempt 返回唯一下一动作的串行驱动入口，并复用现有 Story Runtime 完成准备和应用。

**架构：** Story Runtime 增加最小只读 `inspect` 接口，完整校验当前或恢复 attempt；`e2e-runtime.mjs` 只把 inspection 映射为动作。`Status` 纯读取，`Step` 最多执行一个确定性动作，`Apply` 委托现有 `runStoryCommand apply`。

**技术栈：** Node.js ESM、PowerShell 5.1、现有 State v2/dispatch v2 契约、临时 Git fixture。

---

## 1. 文件边界

### 新增

```text
.harness/scripts/lib/e2e-runtime.mjs
.harness/scripts/run-e2e.ps1
.harness/scripts/tests/e2e-runtime.test.mjs
.harness/scripts/tests/e2e-cli.test.ps1
docs/harness-m7b-serial-driver/DESIGN.md
docs/harness-m7b-serial-driver/PLAN.md
docs/harness-m7b-serial-driver/REPORT.md
```

### 修改

```text
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/run-story.ps1
.harness/scripts/smoke-harness-flow.ps1
.harness/scripts/README.md
.harness/structure-manifest.yaml
.codex/skills/frontier-common/references/harness-runtime.md
.codex/skills/frontier-state-runner/SKILL.md
docs/harness-engineering-target-and-gap.md
docs/harness-m7-m12-roadmap/PLAN.md
docs/harness-structure-checklist.md
CODEX-CROSS-SESSION-HANDOFF.md
```

不修改 State v2、dispatch v2、workflow 和 phase projector 契约。Story Runtime 只增加公开只读 inspection，不改变既有命令语义。

## 2. Task 1：Story inspection RED

- [ ] 新建 `e2e-runtime.test.mjs` 和最小 v2 临时 Git fixture。
- [ ] 在 `story-runtime.test.mjs` 写失败测试：
  - 未准备阶段返回 `prepare`。
  - prepared 且门禁不要求 Adapter 返回 `awaiting-result`。
  - unit-test/build-publish 缺合格 Adapter 返回 `adapter-required`。
  - Adapter 已通过后返回 `awaiting-result`，不重复要求 Adapter。
  - completed/blocked result 经完整校验后返回 `result-ready`。
  - failed result 返回 `failed-result`。
  - 任意 accepted gap 缺正式 approval 返回 `approval-required`。
  - approval receipt 或 evidence 漂移失败关闭。
  - State 已推进但旧 checkpoint 未收尾时返回 `recovery-required`。
  - blocked State 返回 `blocked`。
  - completed State 返回 `completed`。
  - v1 State 失败关闭。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：因 `inspect` 命令不存在而失败。

## 3. Task 2：Story inspection 最小 GREEN

- [ ] 在 `story-runtime.mjs` 增加只读 `inspectDispatch`。
- [ ] 复用 `validateTask`、`validateCheckpoint`、`validateResult`、Adapter evidence 和 formal approval 校验。
- [ ] 抽取现有跨阶段 reconcile 的只读验证部分，供 `inspect` 与 `apply` 共用；inspection 不写 checkpoint 或 active pointer。
- [ ] `run-story.ps1` 注册 `inspect`。
- [ ] 不解析 Markdown，不写文件。
- [ ] 运行 Story Runtime 测试，预期 Task 1 全部通过。

## 4. Task 3：E2E Status 动作映射 RED/GREEN

- [ ] 写 `e2e-runtime.test.mjs` RED，覆盖每个 inspection status 到唯一 action 的映射。
- [ ] 新建 `e2e-runtime.mjs`，只调用 `runStoryCommand inspect`。
- [ ] 不直接读取 task/result/checkpoint 或 approval receipt。
- [ ] 运行专项测试。

## 5. Task 4：Step prepare 幂等

- [ ] 写 RED：
  - `Step` 在 `prepare` 动作时创建 task/checkpoint。
  - State revision、事件和 records 不变化。
  - 重复 `Step` 复用同一 dispatch。
  - prepare 失败时不产生半成品 active attempt。
- [ ] 最小实现 `Step`：只在动作是 `prepare` 时调用现有 `runStoryCommand prepare`，随后重新 `Status`。
- [ ] 运行专项测试。

## 6. Task 5：Apply 单步推进与恢复

- [ ] 写 RED：
  - completed result 经 `Apply` 推进恰好一个阶段。
  - 重复 `Apply` 不重复 records。
  - result 缺失时 State 原字节不变。
  - result revision、dispatch、output 或 evidence 漂移时 State 原字节不变。
  - checkpoint 已完成但 State 已推进时返回恢复后的下一动作。
- [ ] 最小实现 `Apply`：只调用 `runStoryCommand apply`，随后重新判定。
- [ ] `Step` 在 `apply-result` 时复用同一实现。
- [ ] 运行专项测试与 Story Runtime 回归。

## 7. Task 6：approval-required

- [ ] 写 RED：构造 `interface-verification` 当前 attempt，其中 required 或 optional case 为 `accepted-with-known-gaps` 且无有效 formal approval。
- [ ] `Status` 必须返回：

```text
action=approval-required
approval.type=verification-gap
approval.subjectIds=[caseId...]
```

- [ ] 已存在且完整验证的正式 approval 时返回 `apply-result`。
- [ ] receipt、subject 或 evidence 漂移时命令失败，State 不变。
- [ ] 不生成 receipt、不修改 result 或 State。
- [ ] 运行专项、approval contract 和 acceptance gate 测试。

## 8. Task 7：PowerShell CLI

- [ ] 写 `run-e2e` CLI RED：
  - `Status/Step/Apply` 命令映射。
  - `-Json` 返回机器可读单对象。
  - 拒绝未知命令和不支持参数。
  - Node 非零退出码向上传播。
- [ ] 新建 `run-e2e.ps1` 薄入口。
- [ ] 为 `e2e-runtime.mjs` 增加 CLI 参数解析，仅接受 `--root`、`--state-file`、`--json`。
- [ ] 运行 PowerShell CLI 测试。

## 9. Task 8：九阶段串行 fixture smoke

- [ ] 在 `smoke-harness-flow.ps1` 增加独立 M7-B 步骤。
- [ ] 临时仓库逐阶段执行：

```text
init
-> 对九阶段重复 Status/Step
-> 按阶段写入最小合法 output/result
-> unit-test/build-publish 注入固定成功 Adapter
-> interface-verification 使用 verified 结果
-> Apply
-> done
```

- [ ] 每阶段断言 State 只推进一次、结构化投影存在、下一动作唯一。
- [ ] 不运行真实 Agent、不执行正式仓库 Git 写操作。

## 10. Task 9：文档与结构同步

- [ ] 更新 `.harness/scripts/README.md` 和项目 Skill，说明统一入口及边界。
- [ ] 将新增文件加入 `.harness/structure-manifest.yaml`。
- [ ] 新建中文 `REPORT.md`，记录 RED/GREEN、测试证据、审核结论和剩余边界。
- [ ] 更新长期目标、路线计划、结构清单和交接文档。
- [ ] 不把 M7-C、M7-D 或真实 Agent 描述为已完成。

## 11. Task 10：验证与独立审核

- [ ] 运行专项：

```powershell
node .\.harness\scripts\tests\e2e-runtime.test.mjs
```

- [ ] 运行直接回归：

```powershell
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\acceptance-gate.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
```

- [ ] 运行结构与 smoke：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

- [ ] 使用独立只读 Agent 审核 task-owned diff。
- [ ] 修复所有 BLOCKER/WARNING 后重跑受影响门禁并复审。
- [ ] 不执行 `git add`、`git commit` 或 `git push`。

## 11. 完成标准

- `Status` 对同一磁盘事实总是返回同一动作。
- `Step` 一次最多执行一个确定性动作。
- `Apply` 完全复用现有 result 校验和原子投影。
- 缺失或非法认知结果不会改变 State。
- 缺批准时返回明确机器状态。
- 九阶段无需调用者手工选择 `prepare` 或 `apply`。
- 所有直接测试、结构校验、smoke 与独立审核通过。
