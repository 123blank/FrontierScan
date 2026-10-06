# M7-C 知识新鲜度闭环实施计划

> **实施状态：已完成。** 最终实现、测试和审核事实见 `REPORT.md`；本计划保留 TDD 执行顺序和历史检查项。

> **For agentic workers:** REQUIRED SUB-SKILL: 使用 `superpowers:executing-plans` 在当前会话串行实施。每项任务必须按复选框跟踪，生产代码必须先有失败测试。

**Goal:** 将当前 Story 相关知识的新鲜度、最小刷新、重验和逐区域 `accepted-stale` 批准纳入 State v2 与确定性串行驱动。

**Architecture:** 保持九阶段工作流不变，把知识闭环嵌入 `technical-design` attempt。新增一个只负责知识检查、刷新和不可变回执的 Node 编排模块，复用现有 PowerShell freshness 与 generate-kb 能力；Story Runtime 负责 attempt 身份、result 更新、approval 和 State 原子投影。

**Tech Stack:** Node.js ESM、PowerShell、JSON Schema draft 2020-12、现有 State/Story/E2E Runtime、SHA-256、Node 内置测试断言。

---

## 1. 文件结构

### 新建

- `.harness/scripts/lib/knowledge-runtime.mjs`
  - 固定 argv 调用 freshness/generate-kb。
  - 生成不可变 check、refresh task 和 refresh receipt。
  - 校验 source fingerprint、index、log 和 `custom/` snapshot。
- `.harness/scripts/tests/knowledge-runtime.test.mjs`
  - 覆盖 relevant area、最小任务、不可变身份、刷新和中断恢复。
- `.harness/schemas/knowledge-freshness-evidence.schema.json`
- `.harness/schemas/knowledge-refresh-task.schema.json`
- `.harness/schemas/knowledge-refresh-receipt.schema.json`
- `docs/harness-m7c-kb-freshness-loop/REPORT.md`

### 修改

- `.harness/schemas/e2e-state-v2.schema.json`
- `.harness/schemas/dispatch-result-v2.schema.json`
- `.harness/schemas/approval-receipt.schema.json`
- `.harness/states/e2e-state-v2.template.json`
- `.harness/scripts/lib/approval-contract.mjs`
- `.harness/scripts/lib/acceptance-gate.mjs`
- `.harness/scripts/lib/phase-result-projector.mjs`
- `.harness/scripts/lib/story-runtime.mjs`
- `.harness/scripts/lib/e2e-runtime.mjs`
- `.harness/scripts/run-story.ps1`
- `.harness/scripts/README.md`
- `.harness/scripts/tests/approval-contract.test.mjs`
- `.harness/scripts/tests/state-runtime.test.mjs`
- `.harness/scripts/tests/story-runtime.test.mjs`
- `.harness/scripts/tests/e2e-runtime.test.mjs`
- `.harness/scripts/tests/kb-freshness.test.ps1`
- `.harness/structure-manifest.yaml`
- `.codex/skills/frontier-state-runner/SKILL.md`
- `.codex/skills/frontier-kb-refresh-check/SKILL.md`
- `docs/harness-m7-m12-roadmap/PLAN.md`
- `docs/harness-engineering-target-and-gap.md`
- `docs/harness-architecture-adaptation.md`
- `docs/harness-structure-checklist.md`
- `llm-knowledge/overview.md`
- `CODEX-CROSS-SESSION-HANDOFF.md`

## 2. Task 1：State 与知识产物 Schema

**目标：** 先冻结 knowledge area、freshness evidence、refresh task 和 refresh receipt 的严格契约。

- [ ] 在 `state-runtime.test.mjs` 增加 RED：缺少 `observedStatus`、refresh receipt 字段或使用非法状态组合时，State v2 校验失败。
- [ ] 在 `story-runtime.test.mjs` 增加 RED：technical-design result 使用重复 area、悬空 evidence、`accepted-stale` 无 approval 或 refresh 后 fresh 无 receipt 时失败。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
```

预期：新增用例因 Schema 尚未支持而失败。

- [ ] 新建三个知识产物 Schema，要求 `additionalProperties=false`，路径和 SHA-256 严格绑定。
- [ ] 扩展 `knowledgeArea`：

```text
area
relevant
observedStatus
status
sourceFingerprint
loadedFiles
missing
checkedAt
freshnessEvidencePath/Sha256
refreshTaskPath/Sha256
refreshReceiptPath/Sha256
approvalId
```

- [ ] 为状态组合增加条件 Schema：
  - not-relevant 不得引用 evidence/task/receipt/approval。
  - 初次 fresh 不引用 task/receipt。
  - 刷新后的 fresh 引用 receipt。
  - stale/missing 引用 evidence 和 task。
  - accepted-stale 引用 evidence、task 和 approval。
- [ ] 更新 v2 template，保持 `knowledge.areas=[]`。
- [ ] 重跑两项测试，确认 GREEN。

## 3. Task 2：知识检查与最小刷新任务

**目标：** 通过稳定 Node API 复用现有 freshness 判断，生成 attempt-scoped 不可变检查产物。

- [ ] 新建 `knowledge-runtime.test.mjs` RED，定义期望 API：

```javascript
const result = await checkKnowledgeArea({
  root,
  task,
  area: "backend",
});

assert.equal(result.area.area, "backend");
assert.equal(result.area.observedStatus, "stale");
assert.match(result.area.freshnessEvidencePath, /knowledge\/checks\/CHK-/);
assert.match(result.area.refreshTaskPath, /knowledge\/tasks\/KRT-/);
```

- [ ] 覆盖：
  - fresh area 不生成 refresh task。
  - 单一有效 module 改动生成 module task。
  - rename、删除、共享源或多 module 退回 area task。
  - common 使用结构化 `area=common/module=null/mode=baseline`。
  - 同一 canonical 输入幂等复用；同 ID 不同内容失败关闭。
  - 非 backend/frontend/common 被拒绝。
- [ ] 运行 `node .\.harness\scripts\tests\knowledge-runtime.test.mjs`，确认 RED。
- [ ] 最小实现 `knowledge-runtime.mjs`：
  - `runFreshnessCheck`
  - `checkKnowledgeArea`
  - `validateFreshnessEvidence`
  - `validateRefreshTask`
  - `customSnapshotForArea`
- [ ] 使用 `execFile` 固定执行：

```text
powershell.exe -NoProfile -ExecutionPolicy Bypass -File check-kb-freshness.ps1 -Root <root> -Json
```

- [ ] refresh task 只保存 `area/module/mode`，不保存可执行 command。
- [ ] 更新 `kb-freshness.test.ps1`，确认现有 JSON 与 module/area 推导兼容。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
```

预期：GREEN。

## 4. Task 3：判别式 approval 契约

**目标：** 在不破坏 M7-A3 的前提下支持 `knowledge-stale`。

- [ ] 在 `approval-contract.test.mjs` 增加 RED：
  - verification-gap 旧行为继续合法。
  - knowledge-stale 只允许 technical-design。
  - subject canonical 排除 `status/approvalId`。
  - observedStatus、evidence 或 task 变化使批准失效。
  - 两类 subject 不可交叉验证。
- [ ] 运行 `node .\.harness\scripts\tests\approval-contract.test.mjs`，确认 RED。
- [ ] 将 `approval-contract.mjs` 拆成共享 receipt shape 与两类判别校验：

```javascript
verificationGapSubjectSha256(...)
knowledgeStaleSubjectSha256(...)
validateApprovalReceipt(receipt, context)
validateFormalApproval(value)
```

- [ ] 更新 approval Schema 和 State formal approval Schema，使用 `oneOf` 或 `if/then` 绑定 phase 与 subjectType。
- [ ] 保留 receipt schemaVersion `1.0`，不修改历史 verification-gap receipt 字段。
- [ ] 重跑 approval、state 和 story runtime 测试，确认 GREEN。

## 5. Task 4：Story Runtime 初次检查命令

**目标：** 在 technical-design result 写入前，显式生成可引用 knowledge snapshot。

- [ ] 在 `story-runtime.test.mjs` 增加 `check-knowledge` RED：
  - 仅允许 active State v2 technical-design 且已 prepare。
  - 逐 area 返回完整 snapshot。
  - 不修改 State、pointer、events、result。
  - completed、blocked、v1、错误 phase 和未 prepare 均拒绝。
  - check 与 apply/approve 共享 Story 写锁。
- [ ] 增加 PowerShell CLI RED，确认 `-Command check-knowledge -Area backend -Json` 参数可用。
- [ ] 最小实现：
  - `runStoryCommand({command:"check-knowledge"})`
  - CLI `--area`
  - `run-story.ps1` 的 `Area` 参数透传
- [ ] 只让命令写 attempt 的 `knowledge/checks/` 与 `knowledge/tasks/`。
- [ ] 重跑 `story-runtime.test.mjs` 和真实 PowerShell CLI 测试，确认 GREEN。

## 6. Task 5：technical-design inspect 与 apply 门禁

**目标：** stale/missing 不再被普通 preflight 吞成通用错误，而是返回可执行下一动作。

- [ ] 在 `story-runtime.test.mjs` 增加 RED：
  - relevant stale/missing 返回 `knowledge-refresh-required` 和 area 列表。
  - not-relevant stale 不参与门禁。
  - relevant area 缺 task/evidence 返回 `result-invalid`。
  - accepted-stale 缺 approval 返回 `approval-required`，type 为 `knowledge-stale`。
  - fresh 或合法 accepted-stale 返回 `result-ready`。
  - apply 时 evidence/source fingerprint 漂移，State 不变。
- [ ] 在 `acceptance-gate.mjs` 新增 `assertKnowledgeGate(state)`，并在 technical-design 与 completion 使用。
- [ ] `phase-result-projector.mjs` 继续只从 completed technical-design result 投影 knowledge 和 formal approvals。
- [ ] `story-runtime.mjs` 在 technical-design inspection 中按以下顺序处理：

```text
结构/身份校验
-> knowledge 产物校验
-> refresh-required
-> approval-required
-> completed preflight
```

- [ ] 重跑 story runtime 测试，确认 GREEN。

## 7. Task 6：refresh-knowledge 与不可变回执

**目标：** 受控执行现有生成器，刷新后以不可变 receipt 作为唯一提交事实。

- [ ] 在 `knowledge-runtime.test.mjs` 增加 RED：
  - 固定 argv 执行 backend module、backend area 和 common 刷新。
  - generate-kb 失败不生成 receipt、不更新 result。
  - after freshness 仍 stale 时失败。
  - index manifest 或 log 未更新时失败。
  - `custom/` 集合或内容漂移时失败。
  - receipt 已写但 result 未更新时可幂等恢复。
  - 知识已 fresh 但无 receipt 时可从磁盘事实收口。
  - receipt 或绑定产物漂移时拒绝。
- [ ] 在 `story-runtime.test.mjs` 增加 `refresh-knowledge` 的锁、phase、attempt 和 result 绑定 RED。
- [ ] 实现 `refreshKnowledgeArea`：
  - 读取结构化 task。
  - 固定构造 `generate-kb.ps1` argv。
  - 计算 before/after check 与 custom snapshot。
  - 校验 index 和 log。
  - 写 `knowledge/refreshes/<refreshId>.json`。
  - 最后原子更新 result 的 area。
- [ ] CLI 新增 `refresh-knowledge --area` 与 PowerShell 透传。
- [ ] 运行 knowledge、story、generate-kb 和 kb-freshness 测试，确认 GREEN。

## 8. Task 7：approve-stale 与 State 投影

**目标：** 逐区域批准 stale，并把 formal approval 与 knowledge area 一起原子投影。

- [ ] 在 `story-runtime.test.mjs` 增加 RED：
  - `approve-stale` 仅接受 current technical-design stale/missing area。
  - receipt actor 固定 user，subjectType 固定 knowledge-stale。
  - 重复同理由幂等。
  - reason、evidence、task 或 attempt 变化生成新 approval 或拒绝旧引用。
  - receipt 写入中断和 result 写入中断可恢复。
  - approve/apply 并发由 Story 写锁串行化。
- [ ] 实现 `approveStale` 与 `formalApprovalsForKnowledge`。
- [ ] technical-design preflight 把 knowledge formal approvals 合并进 `candidate.approvals`，不得覆盖已有 verification approvals。
- [ ] knowledge area 投影为 `status=accepted-stale`，保留 `observedStatus`。
- [ ] completion gate 校验两类 formal approval 和 knowledge artifact 哈希。
- [ ] 重跑 approval、story、state runtime 测试，确认 GREEN。

## 9. Task 8：E2E 串行驱动

**目标：** 让统一入口给出唯一知识下一动作。

- [ ] 在 `e2e-runtime.test.mjs` 增加 RED：

```text
inspection knowledge-refresh-required -> action knowledge-refresh-required
inspection approval-required/knowledge-stale -> action approval-required
Step 不自动刷新、不自动批准
```

- [ ] 扩展 `e2e-runtime.mjs` 动作映射，不增加自动外部写行为。
- [ ] 扩展纵向 Story fixture：
  - technical-design relevant stale。
  - 显式 refresh 后继续。
  - 另一个 fixture 使用 accepted-stale approval。
  - 完成 State 可回答 knowledge 事实。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\e2e-cli.test.ps1
```

预期：GREEN。

## 10. Task 9：回归、独立审核与文档收尾

**目标：** 证明 M7-C 没有破坏 v1、M7-A3 approval、M7-B 串行恢复和知识生成。

- [x] 运行针对性回归：

```powershell
node .\.harness\scripts\tests\knowledge-runtime.test.mjs
node .\.harness\scripts\tests\approval-contract.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\e2e-runtime.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\e2e-cli.test.ps1
```

- [x] 运行结构与冒烟门禁：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
git diff --check
```

- [x] 使用 fixture 完成两条闭环：
  - stale -> refresh -> fresh -> technical-design apply。
  - stale -> 用户 approval receipt -> accepted-stale -> technical-design apply。
- [x] 创建独立只读审核 Agent，审核 task-owned diff；修复全部 BLOCKER/WARNING 后复审。
- [x] 编写中文 `REPORT.md`，记录 RED/GREEN、测试、审核、限制和剩余风险。
- [x] 更新路线、目标基线、架构说明、结构清单、Skill、知识概览和跨会话交接。
- [x] 更新 `structure-manifest.yaml` 后再次运行结构校验。
- [x] 不执行 `git add`、`git commit` 或 `git push`；交付操作等待用户明确批准。

## 11. 完成标准

- 所有 relevant knowledge area 均可从最终 State 判断为 fresh 或正式 accepted-stale。
- 初次检查、刷新任务、refresh receipt 和 approval receipt 均具有 attempt 身份和 SHA-256。
- module/area 缩小规则来自现有 freshness 事实，不执行 result 中的命令字符串。
- refresh 中断可恢复，重复执行幂等，证据漂移失败关闭。
- verification-gap 与 knowledge-stale approval 均通过判别式契约。
- completion 复核历史知识证据身份，但不因 Story 后续源码修改重新计算设计时 freshness。
- v1 State 保持只读兼容。
- 独立审核无剩余 BLOCKER/WARNING。
- 未执行 Git、Worktree、Docker、发布、部署或真实 Agent 调度。
