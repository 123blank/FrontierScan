# Harness M5-B3-B 单 Worktree 串行多任务批次运行时报告

> Story：`M5-B3-B-001`
>
> 范围：Harness Runtime、Schema、测试、结构登记与中文文档；不修改业务源码。
>
> 交付状态：最终门禁和独立复审均已通过，`M5-B3-B-001` 已进入 `done/completed`、revision `24`；业务修改以提交 `e3d77a4479916fb529f3561b1527941d00eeed7f` 交付。截至 2026-07-30，本地 `dev` 与 `origin/dev` 一致；未执行正式仓库 Worktree、发布或部署。

## 需求覆盖

| 需求 | 实现与证据 |
| --- | --- |
| 保持 M2/M3 唯一状态推进权 | `finalize-batch` 只生成批次结果；两任务 fixture 断言只有显式 M3 `apply` 推进一次 revision。 |
| 保持 v1.0 兼容并引入任务级协议 | `dispatch-contract.mjs` 区分 v1.0/v1.1；v1.1 Schema 强制 `batchId`、`taskId`、`taskRoot`。 |
| 单 Worktree、严格串行 | `serial-batch-ledger` 只允许一个 running task，`BatchPlan/Status/Create` 从 ledger 派生唯一 Worktree。 |
| 前序候选安全继承 | 每项任务记录继承快照；Worker 与 integration 分别验证 `predictedFiles`、前序回执、当前哈希和未解释变更。 |
| 受控集成与一次推进 | 每项任务独立 M5-B1/M5-B2 回执；所有任务 integrated 后才允许收尾，再由既有 M3 `apply` 推进。 |
| 完成态回收与恢复 | `BatchRetire` 验证全量批次证据，保留分支，覆盖 Git 已移除但 receipt 未写入的受限恢复。 |

## TDD 记录

T1 至 T7 均按 RED、最小 GREEN、重构和任务级审核顺序完成。覆盖范围包括严格 Schema、ledger 状态机、基准解析、批次 Worktree 门禁、继承快照、逐项集成和 batch Retire。

T8 新增两任务真实 Git fixture，覆盖：

```text
prepare-batch
-> batch-plan/status/create
-> T1 Worker + integration
-> T2 provider 异常 + 同 dispatch 显式重试 + integration
-> finalize-batch
-> M3 apply（仅一次）
-> Story done/completed
-> batch-retire 中断恢复 + receipt 复用
```

T8 规格复审先后发现公共 `prepare-batch` 入口绕过和 Smoke 未锁定共用 Git 拒绝器；两项均以最小修复、变异 RED 和受影响回归关闭。

## 验证状态

结构登记已将 v1.1 Schema、批次 Runtime、专项测试和本报告纳入 `.harness/structure-manifest.yaml`。最终结构校验确认 27 个目录、177 个必需文件和 13 个 Skill 文件均有效。

本轮收尾修复后的直接回归结果：

| 命令 | 结果 |
| --- | --- |
| `node .\\.harness\\scripts\\tests\\worktree-worker-runtime.test.mjs` | 54/54 通过 |
| `node .\\.harness\\scripts\\tests\\worktree-lifecycle-runtime.test.mjs` | 37/37 通过 |
| `node .\\.harness\\scripts\\tests\\worktree-runtime.test.mjs` | 28/28 通过 |
| `node .\\.harness\\scripts\\tests\\serial-batch-runtime.test.mjs` | 1/1 通过 |

其余 M5-B2、M4-B、M3、M2 和 DAG 回归均已通过。报告更新后的最终新鲜门禁再次确认：

- `harness-status.test.mjs` 通过。
- `validate-structure.ps1` 通过，结果为 27 个目录、177 个必需文件、13 个 Skill 文件。
- `smoke-harness-flow.ps1` 通过。
- `check-kb-freshness.ps1` 确认 `backend`、`frontend`、`common` 均为 fresh。
- `run-state.ps1 -Command validate` 通过。
- `git diff --check` 退出码为 0，仅有 Windows 行尾转换提示，无空白错误。

`backend/**`、`frontend/**` 无差异，因此业务构建和真实 API/UI 验证不适用；对应阶段只记录范围说明，不伪造业务验证结果。

## 最终审核结论

- 规格复审未发现可复现的 `BLOCKER/WARNING`，确认 `batchRetire` 冻结并释放同一 `retirementLockPath`，且锁后证据重算、二次预检与回执恢复流程保持完整。
- 质量复审未发现影响稳定性、可用性或近期扩展的 `BLOCKER/WARNING`，确认原子写入与锁初始化清理保持可重试语义，M2/M3 状态推进权限未扩大。
- 审核期间发现的原子写临时文件、Worker 执行锁、通用回收锁和锁路径重载问题均已通过最小修复及针对性回归关闭。

## Git 交付收尾（2026-07-30）

- 用户批准本地提交后，任务归属修改以 `feat(harness): add serial multi-task batch runtime` 提交，完整 SHA 为 `e3d77a4479916fb529f3561b1527941d00eeed7f`。
- Harness 状态已通过确定性运行时完成为 `done/completed`，最终 revision 为 `24`。
- 截至 2026-07-30，本地 `dev` 与 `origin/dev` 无 ahead/behind 差异。
- 已完成运行的 `.harness/runs/M5-B3-B-001/**` 证据保持不变；本次文档纠偏不修改状态机已绑定的证据文件。
- 未执行正式 FrontierScan Worktree Create/Apply/Retire、发布或部署。

## 代码审核收尾修复（2026-07-29）

- 正式 implementation `task.json`、`result.json`、`implementation-notes.md` 现由 `batch-receipt.json.finalizationArtifacts` 固定路径和 SHA-256；ledger 固定 receipt 哈希，checkpoint 仅引用已固定的 receipt 证据。`apply` 与 `batch-retire` 均重新读取该链并在漂移时失败关闭。
- `finalize-batch` 使用 `batch-finalization.lock` 串行化 ledger 收尾与 checkpoint 绑定；并发调用在写入前明确拒绝，首个调用完成后可以安全重试。阶段原子写入使用带进程号和 UUID 的临时文件，并在异常时清理。
- 已覆盖两个中断恢复窗口：batch receipt 已写但 ledger 尚未 finalized 时重试复用同一 receipt；ledger 已 finalized 但 checkpoint 尚未绑定时重试仅补写 binding，不改写 receipt、ledger 或正式阶段工件。
- `batch-retire` 在执行 `git worktree remove --force` 前重新校验 Worktree 中所有 `main-run` 输入的存在性、普通文件属性、长度和 SHA-256。删除未跟踪输入、协调篡改 result/checkpoint、残留 `batch-finalization.lock` 均会在移除前失败关闭，且不会写 retirement receipt 或改动已有关键证据。
- Worker 与 Worktree Runtime 的原子写入在写入或 rename 失败时清理 UUID 临时文件；执行锁和回收锁在元数据构造、写入或关闭失败时执行 `close + unlink`，避免一次初始化异常永久阻塞显式重试。
- `batchRetire` 在取得回收锁前冻结实际 `retirementLockPath`，后续即使重新加载上下文，`finally` 也只释放本次调用取得的锁，不会遗留旧锁或误删其他操作的锁。
- TDD 证据：链接阶段目录拒绝、并发收尾锁、receipt-to-ledger 中断恢复、ledger-to-checkpoint 中断恢复、原子写临时文件清理、锁初始化清理以及锁路径释放不变性均先出现预期 RED，再以最小实现转为 GREEN。

## 延期边界

- 不实现同 wave 并行、多 Worktree、跨 batch 协调、Fork-Join、自动 merge、分支删除、`git worktree prune`、自动清理或 Worktree 复用。
- 不启动真实 Agent，不提供真实模型、shell、网络、Git、发布或部署能力。
- 真实 FrontierScan 仓库的 Worktree Create/Apply/Retire 仍要求每次用户批准；本 Story 的真实 Git 副作用只发生在系统临时目录 fixture。
- 断电级持久化、进程崩溃遗留锁自动回收和跨平台差异属于低概率延期项，不作为本 Story 的交付阻塞条件。
