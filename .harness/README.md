# FrontierScan Harness Runtime

This directory stores runtime state and generated outputs for the FrontierScan Harness workflow.

The workflow follows three rules:

1. State files are the source of truth for long-running work.
2. AI performs planning, reasoning, review, and diagnosis.
3. Scripts and deterministic commands perform repeatable execution.

Directory layout:

```text
.harness/
  README.md
  schemas/
    product-state.schema.json
    e2e-state.schema.json
    task-dag.schema.json
    dispatch-task-v1.1.schema.json
    dispatch-result-v1.1.schema.json
    dispatch-task-v1.2.schema.json
    dispatch-result-v1.2.schema.json
    implementation-owner.schema.json
    serial-batch-ledger.schema.json
    worktree-plan.schema.json
    worktree-status.schema.json
    worktree-batch-plan.schema.json
    worktree-batch-status.schema.json
    worktree-batch-receipt.schema.json
    worktree-batch-retirement-receipt.schema.json
    worktree-worker-input-manifest.schema.json
    worktree-worker-receipt.schema.json
    worktree-retirement-receipt.schema.json
    worktree-wave-execution-ledger.schema.json
    worktree-wave-attempt-claim.schema.json
    worktree-wave-attempt-lock.schema.json
    worktree-wave-attempt-failure.schema.json
  states/
    product-state.template.json
    e2e-state.template.json
  workflows/
    e2e-development.yaml
    product-fork-join.yaml
  templates/
  reports/
  outputs/
    .gitkeep
  scripts/
    validate-structure.ps1
    validate-state.ps1
    validate-task-dag.ps1
    run-worktree.ps1
    kb-query.ps1
```

Use `states/` for active workflow files and `outputs/` for generated plans, review reports,
verification reports, and other phase artifacts.

## Structure Validation

Run the read-only structure check from the repository root:

```powershell
.\.harness\scripts\validate-structure.ps1
```

The validation checks:

- required directories and files from `.harness/structure-manifest.yaml`
- JSON schema/template parseability
- `SKILL.md` frontmatter presence for project-local Skills

Additional read-only checks:

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\e2e-state.template.json
.\.harness\scripts\validate-state.ps1 -StateFile .\.harness\states\product-state.template.json
.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .\.harness\outputs\task-dag.json
.\.harness\scripts\kb-query.ps1 -Query "Spring Boot" -Mode knowledge-qa -Area backend
```

`validate-task-dag.ps1` 需要具体 DAG 文件，并通过共享 Node 契约校验任务结构、唯一 wave
归属、依赖顺序、Windows 路径冲突、全局变更串行和无环性。

`run-worktree.ps1` 是单 Worktree 生命周期入口，支持 `Plan/Status/Create/Retire`。`Create` 必须有用户逐次批准并显式传入
`-ConfirmCreate`。`Retire` 只接受已完成且已完成 M5-B2 集成的目标 Story，必须有用户逐次批准并显式传入
`-ConfirmRetire`；它验证 M5-A/M5-B1/M5-B2 证据、主工作树和 Worktree Git 事实后才执行 `git worktree remove --force`。
Retire 保留任务分支，不执行 `prune`、合并或状态推进。

`scripts/lib/worktree-worker-runtime.mjs` 是 M5-B1 内部编排接口，不提供 CLI。它只消费 M5-A 已创建的单 Worktree，
在 Worktree 内运行测试注入的 M4-B Provider，并把结果分为 `ready-for-apply` 与 `ready-for-integration`；它不创建、
合并或删除 Worktree，也不调用 M3 `apply`。

M5-B3-B 在保持上述单任务入口兼容的前提下，为同一 Story 的 `implementation` phase 增加严格串行批次协议。多节点
`backend`/`frontend` DAG 必须先通过 `run-story.ps1 -Command prepare-batch` 创建 task-scoped v1.1 dispatch 与
serial batch ledger；随后仅使用 `run-worktree.ps1` 的 `BatchPlan/BatchStatus/BatchCreate/BatchRetire`。每项任务仍经
M5-B1 Worker 和 M5-B2 集成独立验收，全部任务已集成后才可用 `finalize-batch` 生成 M3 可应用的 phase result，既有
`apply` 仍是唯一状态推进入口。正式 implementation 工件通过 batch receipt 的 `finalizationArtifacts`、ledger receipt 哈希和 checkpoint binding 形成固定证据链；收尾 binding 使用独占锁，重叠调用失败关闭并可在首个完成后重试。批次不并行、不创建多个 Worktree，也不绕过用户对 Create、Apply 或 Retire 的逐次批准。

M5-D-A 在同一 Runtime 中增加 `WavePlan/WaveStatus`。它只接受 active Story 的 `implementation` phase 中至少两个
pending 的 backend/frontend 任务，复用共享 Task DAG 冲突校验，把 `dev` 固化为同一 `baseCommit`，并为每项任务派生
稳定分支和 `.harness/worktrees/<story>/wave-<n>/<taskId>` 路径。状态仅从 Git 事实聚合为 `absent/partial/ready`，
任务级状态为 `absent/branch-only/created`；DAG、基准、分支、路径、HEAD、junction 或计划外 Worktree 漂移均失败关闭。

M5-D-B 在上述只读计划之上增加审批门控的 `WaveCreate`。每次调用只处理一个明确 wave，必须同时提供
`-ConfirmWaveCreate` 与计划文件的 `-ExpectedPlanSha256`；计划漂移、主工作树不干净、同 Story 其他 wave 已有
Worktree 或计划外挂载都会在继续写入前失败关闭。创建按计划稳定顺序处理 `branch-only/absent` 项，部分失败保留已创建项，
重试只补齐缺失项。

同一 run/Story 的所有 wave 共享带随机 `lockId` 的 `waves/create.lock`；遗留锁恢复必须由用户确认旧进程已停止，并绑定
`WaveStatus` 返回的全部现存锁 SHA-256。恢复期间共享 `waves/create-recovery.lock` 是活动所有权，旧创建所有者一旦
观察到恢复锁便失去 Git、状态、回执和删锁资格。恢复异常保留两把锁，只有完成回执成功后才清理。
只有当前 Git 事实完整收敛为 `ready` 时才写入绑定计划、DAG、稳定状态哈希和任务 HEAD 的
`creation-receipt.json`。动态锁快照只出现在命令结果顶层 `locks`，不写入稳定 `status.json`。该入口不启动 Worker，
复用 `WavePlan` 和普通 `WaveStatus` 也只返回动态 Git 事实，不改写稳定状态；后续状态持久化只由持锁 `WaveCreate` 执行。
该入口不合并、回收或删除 Worktree/分支，也不修改 M2/M3 状态；正式仓库执行仍需要针对具体计划的独立批准。

M5-D-C1 在 WaveCreate 完成证据之上增加单个完整 implementation wave 的并行 Mock Worker 执行闭环。`prepare-wave`
生成 v1.2 task/checkpoint 和统一 `implementation-owner.json`；`worktree-wave-execution-runtime.mjs` 管理
execution ledger、不可变 attempt、claim、execute.lock、`execute-wave`、`retry-task` 和 `recover-attempt`。
Worker 在独立临时 Worktree 中并行运行，候选、result、execution receipt、ledger ready/blocked 与锁释放前均重新验证
当前 attempt owner。部分失败保留成功 receipt，blocked 任务只能经独立批准创建新 attempt；完整 result/receipt、
blocked 释放中断、claim/lock 半完成和孤儿候选均按磁盘事实显式恢复。该能力不写主工作树业务文件，不生成正式 phase
result，不调用 M3 `apply`，也不实现 integration manifest、跨 Worktree 集成、回收、提交或推送。

M5-D-C2 在 C1 ready 证据之上增加 integration manifest 原子冻结、wave 级 integration/recovery owner、按稳定任务
顺序写入主工作树、partial integration 前缀恢复、`finalize-wave`、wave receipt 与 M3 `apply` 单次推进。所有真实
Git/Worktree 写入仍只在临时 fixture 中验证；不实现自动冲突解决、主树回滚、Worktree 回收、提交、推送或发布。

`kb-query.ps1` is a read-only keyword search over `llm-knowledge/`. Treat empty results as missing
knowledge and verify source files directly before implementation.
