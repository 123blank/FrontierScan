# M5-D-D WaveRetire Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已完成且 finalized 的单个完整 Wave 增加审批门控、可恢复、保留分支的多 Worktree 回收闭环。

**Architecture:** 扩展现有 `worktree-runtime.mjs` 和薄 PowerShell 入口，不新增第二套 Runtime。WaveRetire 从完成态 State、WavePlan、creation receipt、finalized ledger、wave receipt 和 M3 checkpoint 派生全部身份，使用普通/recovery 双锁、精确回执前缀和逐任务 Git 后验检查完成稳定回收。

**Tech Stack:** Node.js ESM、PowerShell、JSON Schema、Node Test Runner、临时 Git fixture。

---

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `.harness/scripts/lib/worktree-runtime.mjs` | `wave-retire` 上下文、证据、锁、Git 删除、恢复和回执 |
| `.harness/scripts/run-worktree.ps1` | `WaveRetire` 参数门禁与 CLI 映射 |
| `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs` | WaveRetire 直接 RED/GREEN、临时 Git 纵向 fixture 和旧 Retire/BatchRetire 回归 |
| `.harness/scripts/tests/worktree-wave-runtime.test.mjs` | Wave PowerShell 参数兼容与旧 WavePlan/WaveCreate 回归 |
| `.harness/schemas/worktree-wave-retirement-*.schema.json` | 普通/recovery 锁、任务回执和最终回执契约 |
| `.harness/structure-manifest.yaml` | 新 Schema 和设计资产登记 |
| `.harness/README.md`、`.harness/scripts/README.md` | 运行时入口、审批和安全边界 |
| `docs/harness-architecture-adaptation.md`、`docs/harness-structure-checklist.md`、`docs/AI-handover.md` | 当前能力、下一阶段和检查清单 |
| `llm-knowledge/overview.md` | AI 可消费的最新 Harness 概览 |
| `docs/harness-m5d-wave-retire/REPORT.md` | 实施、测试、审核和延期边界 |

## Task 1：定义 WaveRetire 接口和严格 Schema

**Files:**

- Modify: `.harness/scripts/run-worktree.ps1`
- Modify: `.harness/scripts/lib/worktree-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`
- Modify: `.harness/scripts/tests/worktree-wave-runtime.test.mjs`
- Create: `.harness/schemas/worktree-wave-retirement-lock.schema.json`
- Create: `.harness/schemas/worktree-wave-retirement-recovery-lock.schema.json`
- Create: `.harness/schemas/worktree-wave-task-retirement-receipt.schema.json`
- Create: `.harness/schemas/worktree-wave-retirement-receipt.schema.json`

- [ ] **Step 1：写接口 RED**

  增加测试，断言：

  ```js
  await assert.rejects(
    runWorktreeCommand({ root, command: "wave-retire", stateFile }),
    /ConfirmRetire|TaskDagFile|WaveIndex|ExpectedWaveLedgerSha256|ExpectedWaveReceiptSha256/i,
  );
  ```

  PowerShell `WaveRetire` 必须拒绝 `TaskId/BaseRef/ConfirmCreate`，并要求完成态 Wave 参数。

- [ ] **Step 2：运行 RED**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
  ```

  预期：因 `wave-retire` 尚未支持而失败。

- [ ] **Step 3：写严格 Schema**

  普通锁固定字段：

  ```text
  schemaVersion, lockId, retirementId, mode, storyId, runId, waveId, waveIndex,
  wavePlanSha256, creationReceiptSha256, waveLedgerSha256, waveReceiptSha256,
  pid, createdAt
  ```

  recovery 锁额外绑定普通锁路径与 SHA-256。任务回执固定任务身份、branch/path/base、execution/integration
  receipt、applied files、`retiredAt/recovered`。最终回执固定完成态、M3、Wave 和有序任务回执证据。

- [ ] **Step 4：实现最小 CLI 路由**

  `run-worktree.ps1` 增加：

  ```text
  WaveRetire
  ExpectedWaveLedgerSha256
  ExpectedWaveReceiptSha256
  ExpectedRetirementLockSha256
  ExpectedRetirementRecoveryLockSha256
  ConfirmWaveRetireLockRecovery
  ```

  `runWorktreeCommand` 只增加命令分发和基础参数拒绝，不执行 Git 删除。

- [ ] **Step 5：运行 GREEN**

  目标接口测试通过，旧 `Retire/BatchRetire/WavePlan/WaveCreate` 路径无回归。

## Task 2：完成态证据和全局零删除预检

**Files:**

- Modify: `.harness/scripts/lib/worktree-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`

- [ ] **Step 1：写完成态与证据 RED**

  覆盖非 `done/completed`、非 `finalized`、ledger/wave receipt 预期哈希错误、DAG/WavePlan/creation receipt、
  manifest、checkpoint、正式 task/result/notes、execution/integration receipt 和 applied files 漂移。

- [ ] **Step 2：写全局预检 RED**

  构造两任务 fixture，使 T2 的 branch、HEAD、候选或 Worktree 输入漂移，断言：

  ```js
  assert.equal(await registeredWorktreeCount(root), 2);
  ```

  即任一任务失败时 T1 也不能被删除。

- [ ] **Step 3：运行 RED**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  ```

- [ ] **Step 4：实现证据收集**

  新增 Wave retirement context/evidence 函数，复用现有路径限制、Git 解析和 SHA-256 读取。完成态证据至少包含：

  ```text
  state/events/backup
  task DAG
  WavePlan + creation receipt
  integration manifest
  finalized ledger + wave receipt
  implementation task/result/checkpoint/notes
  ordered task execution/integration evidence
  applied files
  ```

- [ ] **Step 5：实现无写入全局预检**

  首次 Git 删除前验证全部任务和全部冲突锁。此步骤不得创建 retirement lock、receipt 或修改稳定状态。

- [ ] **Step 6：运行 GREEN**

  所有完成态、漂移和零删除断言通过。

## Task 3：实现普通/recovery 双锁与 owner fencing

**Files:**

- Modify: `.harness/scripts/lib/worktree-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`

- [ ] **Step 1：写并发与遗留锁 RED**

  覆盖：

  - 两个普通回收并发只能一个 owner。
  - 子进程在普通锁写入后终止，下一次无 recovery 确认时拒绝。
  - recovery 缺少任一现存锁哈希时拒绝。
  - replacement recovery lock 出现后旧 owner 不能继续。

- [ ] **Step 2：写完整冲突锁 RED**

  分别放置 create/recovery、`ledger-mutation.lock`、task `execute.lock`、`manifest-preparation.lock`、
  integration/recovery、implementation preparation/finalization lock，断言 Git remove 未调用。

- [ ] **Step 3：运行 RED**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  ```

- [ ] **Step 4：实现 owner**

  普通 owner 使用独占锁；recovery owner 复用 WaveCreate 的预期锁哈希和 replacement fencing 模式。
  提供统一 guard：

  ```js
  await assertWaveRetirementOwner(root, context, owner, evidence);
  ```

  在每个 Git、任务回执、最终回执和锁释放写点调用。

- [ ] **Step 5：实现安全释放**

  `finally` 只删除本次 owner 持有且当前 SHA-256/`lockId` 匹配的锁。失权或恢复失败时保留证据。

- [ ] **Step 6：运行 GREEN**

  并发、进程终止、锁替换和全部冲突锁测试通过。

## Task 4：实现稳定任务回收、精确前缀与 partial recovery

**Files:**

- Modify: `.harness/scripts/lib/worktree-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`

- [ ] **Step 1：写精确允许集 RED**

  T1 回执写入后，T2 删除前主树检查必须接受 T1 的精确 path/SHA-256/bytes；篡改 T1 回执、增加越序 T2
  回执或遗留 `.tmp-*` 时拒绝。

- [ ] **Step 2：写 Git 后验 RED**

  注入 Git 返回成功但 Worktree 仍注册、目录重新出现或保留分支漂移，断言当前任务回执不存在。

- [ ] **Step 3：写 partial recovery RED**

  在 T1 Git 删除后、任务回执前中断。重试必须补写 `recovered: true`，再处理 T2；无法证明 T1 身份时停止。

- [ ] **Step 4：运行 RED**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  ```

- [ ] **Step 5：实现稳定顺序删除**

  按 WavePlan 顺序对每项执行：

  ```text
  owner guard
  -> conflict locks
  -> exact main allowlist
  -> current Worktree verification
  -> git worktree remove --force <derived path>
  -> owner guard
  -> Git registration/directory/branch postcondition
  -> atomic task receipt
  ```

- [ ] **Step 6：实现稳定前缀恢复**

  只允许有序、完整验证的任务回执前缀。已删除但无回执的当前首项可受约束恢复；后续越序事实拒绝。

- [ ] **Step 7：运行 GREEN**

  正常删除、精确前缀、partial recovery、未知修改和 Git 后验测试通过。

## Task 5：实现最终回执、幂等复用和纵向闭环

**Files:**

- Modify: `.harness/scripts/lib/worktree-runtime.mjs`
- Modify: `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`
- Modify: `.harness/scripts/tests/worktree-worker-runtime.test.mjs`

- [ ] **Step 1：写最终回执 RED**

  全部任务回执存在时，最终回执必须绑定完成态、M3、Wave 和 ordered task receipts。已有最终回执但 state、
  checkpoint、ledger、wave receipt 或任务回执漂移时拒绝复用。

- [ ] **Step 2：写最终中断 RED**

  全部任务已回收但最终回执写入前中断；重试补写 `recovered: true`。最终回执存在且证据完整时幂等复用。

- [ ] **Step 3：写真实纵向 fixture**

  在临时 Git 仓库通过公开 Runtime 跑通：

  ```text
  WaveCreate -> parallel Worker -> integrate -> finalize-wave
  -> M3 apply -> Story done -> WaveRetire
  ```

  断言全部 Worktree 消失、分支保留、主树业务文件/正式产物/完成态 State 字节不变。

- [ ] **Step 4：运行 RED**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
  ```

- [ ] **Step 5：实现最终回执**

  最终回执仅在所有任务回执及 Git 事实重验通过后原子写入。已有最终回执时仍重跑完整验证。

- [ ] **Step 6：运行 GREEN 与直接回归**

  ```powershell
  node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
  node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
  node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
  node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
  node .\.harness\scripts\tests\story-runtime.test.mjs
  ```

## Task 6：结构、文档、审核和最终门禁

**Files:**

- Modify: `.harness/structure-manifest.yaml`
- Modify: `.harness/README.md`
- Modify: `.harness/scripts/README.md`
- Modify: `docs/harness-architecture-adaptation.md`
- Modify: `docs/harness-structure-checklist.md`
- Modify: `docs/AI-handover.md`
- Modify: `llm-knowledge/overview.md`
- Create: `docs/harness-m5d-wave-retire/REPORT.md`
- Create: `.harness/runs/M5-D-D-001/phases/03-implementation/implementation-notes.md`
- Create: `.harness/runs/M5-D-D-001/phases/04-unit-test/test-report.md`
- Create: `.harness/runs/M5-D-D-001/phases/05-code-review/code-review-report.md`
- Create: `.harness/runs/M5-D-D-001/phases/06-build-publish/build-report.md`
- Create: `.harness/runs/M5-D-D-001/phases/07-interface-verification/interface-verification-report.md`
- Create: `.harness/runs/M5-D-D-001/phases/08-git-delivery/delivery-report.md`

- [ ] **Step 1：更新结构与文档**

  准确说明 WaveRetire 的完成态门禁、双锁恢复、稳定回执前缀、分支保留和延期边界。

- [ ] **Step 2：运行确定性门禁**

  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .\.harness\runs\M5-D-D-001\phases\02-task-dag\task-dag.json
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1
  git diff --check
  ```

- [ ] **Step 3：代码审核**

  只审核 M5-D-D owned diff。BLOCKER/WARNING 未关闭时不得进入交付。

- [ ] **Step 4：记录 build/interface 边界**

  本 Story 为 Harness-only，无 backend/frontend 构建和业务 API/UI 验证；记录不适用原因。正式仓库未执行
  Worktree 删除、发布或部署。

- [ ] **Step 5：准备交付摘要**

  区分 M5-D-D owned changes 与无关 `CODEX-CROSS-SESSION-HANDOFF.md`。未经用户明确批准不执行
  `git add`、`git commit`、`git push` 或 PR。

## 计划自检

- 设计覆盖：普通/recovery owner、全局预检、精确前缀、partial recovery、最终回执和 Git 后验均有对应任务。
- 占位符检查：无 `TBD`、`TODO` 或未定义实施步骤。
- 类型一致性：统一使用 `wave-retire`、`worktree-retire.lock`、`worktree-retire-recovery.lock`、
  task retirement receipt 和 wave retirement receipt。
- 简化边界：不新增通用 Retirement Engine，不删除分支，不修改完成态 State。
- 执行方式：沿用用户已确认的当前会话串行实施；Git 交付另行审批。
