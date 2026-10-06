# FrontierScan Harness M7-A4 运行时一致性与交付语义实施计划

> **供代理式开发者使用：** 实施时必须使用 `superpowers:test-driven-development`，逐项先 RED、再最小 GREEN。未经用户逐次批准，不执行 Git 暂存、提交、推送、正式 Worktree、Docker、发布或部署。
>
> 计划状态：专项设计与实施计划已通过独立只读评审，无 BLOCKER/WARNING；进入 TDD 实施。

**目标：** 统一 v2 evidence 语义幂等，使用 baseline/DAG/result/Git 推导 delivery facts，并在 completed State 外生成只读 Git 交付回执。

**架构：** 新增纯 record/delivery 契约和只读 delivery Runtime；Story Runtime 在 delivery apply 的同一写锁内对账推导事实；State Runtime 仅对 v2 record 使用共享语义身份；PowerShell 保持薄入口。

**技术栈：** Node.js ESM、PowerShell 5.1、JSON Schema 2020-12、Git porcelain/plumbing 命令、临时 Git fixture。

---

## 1. 文件边界

### 新增

```text
.harness/schemas/delivery-receipt.schema.json
.harness/schemas/owned-manifest.schema.json
.harness/scripts/lib/record-contract.mjs
.harness/scripts/lib/delivery-contract.mjs
.harness/scripts/lib/delivery-runtime.mjs
.harness/scripts/run-delivery.ps1
.harness/scripts/tests/record-contract.test.mjs
.harness/scripts/tests/delivery-runtime.test.mjs
.harness/scripts/tests/delivery-cli.test.ps1
docs/harness-m7a4-runtime-delivery/REPORT.md
```

### 修改

```text
.harness/scripts/lib/state-runtime.mjs
.harness/scripts/lib/story-runtime.mjs
.harness/scripts/lib/phase-data-contract.mjs
.harness/scripts/lib/state-contract.mjs
.harness/schemas/e2e-state-v2.schema.json
.harness/schemas/dispatch-result-v2.schema.json
.harness/states/e2e-state-v2.template.json
.harness/scripts/summarize-delivery.ps1
.harness/scripts/tests/state-runtime.test.mjs
.harness/scripts/tests/story-runtime.test.mjs
.harness/scripts/smoke-harness-flow.ps1
.harness/scripts/README.md
.harness/scripts/validate-structure.ps1
.harness/structure-manifest.yaml
.codex/skills/frontier-common/references/harness-runtime.md
.codex/skills/frontier-state-runner/*
.codex/skills/frontier-git-delivery/*
docs/harness-engineering-target-and-gap.md
docs/harness-structure-checklist.md
docs/harness-m7-m12-roadmap/*
CODEX-CROSS-SESSION-HANDOFF.md
```

State v2 和 dispatch result 的 delivery 增加 `ownedManifestFile/ownedManifestSha256`，并收紧 `status=ready` 时 summary 与 manifest 都必须存在。

## 2. Task 1：record 语义身份

- [ ] 新建 `record-contract.test.mjs`，写 RED：
  - output 同 phase/path/hash、不同 actor/status/message 身份相同。
  - test/review 状态变化身份不同。
  - note message 变化身份不同。
  - phase-result 以 dispatch/status 身份。
- [ ] 新建 `record-contract.mjs`，实现 `recordSemanticIdentity(record)`。
- [ ] 运行：

```powershell
node .\.harness\scripts\tests\record-contract.test.mjs
```

预期：PASS。

## 3. Task 2：v2 手工 record 幂等

- [ ] 在 `state-runtime.test.mjs` 写 RED：
  - v2 相同 record 重复命令不增加 revision、logs、events 或 records。
  - 相同 path 内容变化后新增 record。
  - v1 重复 record 保持历史行为。
- [ ] 修改 `recordEvidence`：
  - v2 生成 record 后先计算语义身份。
  - 已存在相同身份时返回 `already-recorded`，不调用 `persistLocated`。
  - v1 不变。
- [ ] 运行 state Runtime 全量测试。

## 4. Task 3：Story result record 幂等

- [ ] 在 `story-runtime.test.mjs` 写 RED：手工 output 与 completed result 自动 output 同 path/hash 时只保留一个。
- [ ] 修改 `appendUniqueRecords` 使用共享 `recordSemanticIdentity`。
- [ ] 保持 phase-result 单 dispatch 正式索引不受普通 evidence 规则影响。
- [ ] 运行 Story Runtime 全量测试。

## 5. Task 4：delivery facts 严格契约

- [ ] 新建 `delivery-runtime.test.mjs` 基础契约 RED。
- [ ] 新建 `delivery-contract.mjs`：
  - `validateDeliveryFacts`。
  - `validateOwnedManifest`。
  - `validateDeliveryReceipt`。
  - 严格字段、路径、SHA-256、commit、remote/ref 和时间校验。
- [ ] 新增 `owned-manifest.schema.json` 和 `delivery-receipt.schema.json`，与 Node 契约字段一致。
- [ ] 增加 Schema/Node 一致性测试。

## 6. Task 5：Git 路径与 baseline 对账

- [ ] 创建临时 Git fixture，覆盖：
  - committed since baseline。
  - staged、unstaged、untracked、deleted、rename。
  - copy。
  - branch drift。
  - baseline 不可达。
  - 已提交 modified + 工作树 deleted。
  - 已提交 deleted + 当前路径重建。
  - 已提交 rename + target 再修改。
  - 已提交 added + 工作树删除。
- [ ] 在 `delivery-runtime.mjs` 实现：
  - Git identity。
  - baseline ancestor。
  - `git diff --name-status -z --find-renames --find-copies baseline --`，直接得到 baseline tree 到当前工作树的 tracked 净变化。
  - porcelain v1 `-z` 只补充 untracked。
  - 规范路径并稳定排序。
- [ ] 异常 Git 输出失败关闭。

## 7. Task 6：owned files 推导

- [ ] 写 RED：
  - actual changed file -> owned。
  - Story state/events/run files -> control assets，不进入三个 delivery 数组。
  - prediction-only dirty -> unrelated。
  - actual 超出 prediction -> outOfPrediction。
  - initial dirty -> unrelated。
  - initial dirty 与 actual file 碰撞 -> reject。
  - staged/unstaged/committed rename 任一端 initial dirty -> reject。
  - actual 未发生变化 -> reject。
- [ ] 实现 `deriveDeliveryFacts({ root, state, executeGit })`。
- [ ] 复用 DAG 精确路径和 `/**` 匹配规则，不引入通用 glob。
- [ ] rename 保留 source/target；copy 保留 source 但只认领 target。
- [ ] owned 只来自 `implementation.actualFiles`；prediction-only 变化保持 unrelated。
- [ ] 排除 State、events、active-run 和 `.harness/runs/<runId>/**` 控制资产。
- [ ] actualFiles 声明控制资产时失败。
- [ ] baseline initial dirty 元素增加可选 `sourcePath`，rename/copy 同时冻结两端。
- [ ] 历史 baseline 的 rename/copy 缺少 `sourcePath` 时失败关闭。
- [ ] 固定关系展开数组：
  - rename owned/unrelated/prediction 均展开 source + target。
  - copy 只展开 target。
- [ ] tracked deleted + 同路径 untracked added：
  - 规范化 blob/mode 等于 baseline -> 无变化。
  - 否则 -> modified。
- [ ] 覆盖 index 删除后重建、提交删除后重建和数组精确值。

## 8. Task 7：owned manifest 冻结

- [ ] 写 RED：
  - added/modified/renamed/copied 记录工作树 SHA-256、Git 规范化 blob OID 和 mode。
  - deleted 的三个内容身份字段为 null。
  - manifest 路径、字段、排序和 SHA-256 稳定。
  - 当前文件内容与 manifest 漂移时 completion 拒绝。
  - manifest 自身不进入 entries。
  - manifest 创建前后 delivery facts 相同。
  - 重复准备幂等。
  - 原子写入中断后可重试。
- [ ] `run-delivery PrepareManifest` 在 Story 写锁内重读 State/Git，生成 `.harness/runs/<runId>/delivery/owned-manifest.json`，不修改 State/pointer/events。
- [ ] 使用只读 `git hash-object --path=<path> <path>` 计算规范化 blob OID，不写 object database。
- [ ] 从 Git raw/index 元数据或 untracked executable bit 推导 mode，只允许普通文件 `100644/100755`。
- [ ] symlink、submodule、目录和其他特殊 mode actual file 失败关闭，并增加负例。
- [ ] manifest 必须作为 delivery result output 并投影 `ownedManifestFile/ownedManifestSha256`。
- [ ] 更新 State v2 template、State Node 契约、State v2 Schema、dispatch result v2 Schema、phase data 契约和 projector fixture。

## 9. Task 8：delivery-preparation 原子门禁

- [ ] 在完整 v2 Story fixture 中制造真实业务文件变化。
- [ ] 写 RED：payload owned/outOfPrediction/unrelated 任一漂移时 State/pointer/events 字节不变。
- [ ] 写 RED：`status=ready` 但 summary 为空时拒绝。
- [ ] 写 RED：`status=ready` 但 manifest 为空时，State Schema、result Schema 和 Node 契约均拒绝。
- [ ] Story Runtime 在 delivery apply 写锁内调用 `deriveDeliveryFacts`。
- [ ] 对 payload 三个数组做稳定逐字段比较。
- [ ] summary 普通文件和 SHA-256 在 completion 前重验。
- [ ] owned manifest 普通文件、SHA-256 和当前工作树内容在 completion 前重验。
- [ ] 保持 `gitStatus=not-requested` 可进入 done。

## 10. Task 9：`summarize-delivery.ps1`

- [ ] 新增 PowerShell 测试：
  - 无 `-StateFile` 保持旧路径前缀输出。
  - 有 `-StateFile` 使用 Runtime facts。
  - JSON 输出稳定。
- [ ] 增加 `-StateFile` 参数和 Node 薄调用。
- [ ] 不写 State 或报告。

## 11. Task 10：delivery receipt not-requested

- [ ] 写 RED：只有 completed State v2 可记录 receipt。
- [ ] 实现 State、events、summary 文件读取和 SHA-256 绑定。
- [ ] 无 `-Commit` 时生成 append-only `commit/push.status=not-requested` receipt。
- [ ] 证明 State/pointer/events 字节不变。

## 12. Task 11：commit 内容只读对账

- [ ] fixture 创建单提交与多提交 chain。
- [ ] 写 RED：
  - commit 不存在。
  - baseline 不是祖先。
  - baseline..commit 缺 owned manifest entry。
  - 同路径但 blob OID 或 mode 与 manifest 不同。
  - deleted 路径仍存在。
  - rename source 仍存在或 target 内容不匹配。
  - parent/files 声明漂移。
- [ ] Runtime 只接受 40-hex commit 输入。
- [ ] 使用 `cat-file`、`rev-list --parents -n 1`、`merge-base --is-ancestor` 和 `diff --name-status -z --find-renames --find-copies`。
- [ ] 使用 `git ls-tree` 对账 commit tree 的 blob OID 和 mode。
- [ ] commit diff 复用 tracked net 的关系解析与展开函数；`extraFiles` 按 rename source+target、copy target 计算。

## 13. Task 12：push 只读对账

- [ ] 使用本地 bare remote fixture。
- [ ] 写 RED：remote 不存在、ref 不存在、ref 指向其他 commit。
- [ ] `Remote/Ref` 只有同时提供 commit 时允许。
- [ ] 使用 `git ls-remote --refs <remote> <ref>`，不执行 push/fetch。
- [ ] 固定 `GIT_TERMINAL_PROMPT=0` 和 30 秒超时。
- [ ] 覆盖超时、认证不可用和网络失败，不生成 receipt。

## 14. Task 13：receipt 版本、锁、幂等与恢复

- [ ] 写 RED：
  - 相同事实重复 record 返回 `already-recorded`。
  - receipt 内容漂移失败。
  - not-requested 后记录 commit 生成不同 receiptId 并并存。
  - State/summary/manifest/Git 事实变化生成新 subject 或失败关闭。
  - 原子 rename 前中断后可重试。
  - 正式 receipt 写入后命令返回前中断可复用。
- [ ] receipt 写入 `.harness/runs/<runId>/delivery/receipts/<receiptId>.json`。
- [ ] 增加 receipt 专用锁，锁内重读全部事实。
- [ ] 两个不同 commit 并发 record 不得覆盖或混用 receipt。
- [ ] 不清理或改写 completed State。

## 15. Task 14：PowerShell CLI

- [ ] 新增 `run-delivery.ps1`：

```text
Summarize
PrepareManifest
Record
```

- [ ] 参数：`StateFile`、`Commit`、`Remote`、`Ref`、`Root`、`Json`。
- [ ] 严格拒绝无关参数组合。
- [ ] 新建 `delivery-cli.test.ps1`，覆盖参数组合、旧 summarize 兼容模式和 Node exit code。
- [ ] CLI 测试扫描 Runtime Git argv，证明不存在 add/commit/push/fetch/merge/reset。

## 16. Task 15：v1 与 M5 兼容

- [ ] v1 `status/validate` 不变。
- [ ] v1 receipt `Record` 明确拒绝。
- [ ] DAG 1.0、M5 batch/worktree fixture 全量回归。
- [ ] 不修改 v1 State、历史 events 或 M6-A 文件。

## 17. Task 16：Smoke 与结构登记

- [ ] smoke 增加 delivery facts 与 not-requested receipt 临时 fixture。
- [ ] smoke 验证 manifest 与 receipt 控制资产不会反向改变 delivery facts。
- [ ] manifest/validator 登记新 Schema、Runtime、CLI、测试和文档目录。
- [ ] 更新脚本 README。

## 18. Task 17：Skill 与文档

- [ ] 更新 `frontier-common`、`frontier-state-runner` 和 `frontier-git-delivery`。
- [ ] 新增中文 `REPORT.md`，记录 RED/GREEN、Git fixture、receipt 和回归。
- [ ] 更新目标基线、总路线、结构清单和交接。
- [ ] 如实保留：

```text
knowledge stale -> M7-C
serial driver -> M7-B
real Story -> M7-D
automatic Git -> not implemented
```

## 19. Task 18：专项与全量验证

运行：

```powershell
node .\.harness\scripts\tests\record-contract.test.mjs
node .\.harness\scripts\tests\delivery-runtime.test.mjs
node .\.harness\scripts\tests\phase-result-projector.test.mjs
node .\.harness\scripts\tests\state-runtime.test.mjs
node .\.harness\scripts\tests\story-runtime.test.mjs
node .\.harness\scripts\tests\worker-runtime.test.mjs
node .\.harness\scripts\tests\batch-runtime.test.mjs
node .\.harness\scripts\tests\serial-batch-runtime.test.mjs
node .\.harness\scripts\tests\worktree-runtime.test.mjs
node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs
node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs
node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs
node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\select-tests.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\delivery-cli.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state-v2.template.json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
git diff --check
```

## 20. Task 19：独立只读代码审核

审核重点：

```text
prediction 是否能错误认领 unrelated dirty
initial dirty 是否可能进入 owned
actual files 是否能伪造未修改路径
rename/delete/untracked 是否完整
delivery apply 是否在锁内对账且失败零写入
completed State 是否保持不可变
receipt 是否可能伪造 commit、parent、files、remote/ref
commit 同路径不同内容是否会被拒绝
rename source/target 是否完整传播 initial dirty
receipt 重试是否信任漂移文件
不同 receipt 事实并发是否覆盖
CLI 是否存在隐式 Git 写操作
v1/M5 是否回归
```

所有 BLOCKER/WARNING 按 TDD 修复后复审。

## 21. 完成标准

- 设计和计划通过独立只读评审。
- record、owned derivation、delivery gate 和 receipt 专项测试通过。
- 全量兼容回归通过。
- 独立代码审核无未解决 BLOCKER/WARNING。
- REPORT、Skill、manifest、目标基线、结构清单和交接同步。
- 未执行未经批准的 Git、Worktree、Docker、发布或部署操作。
