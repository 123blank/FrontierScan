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

M5-D-A 在同一 Runtime 中增加只读 `WavePlan/WaveStatus`。它只接受 active Story 的 `implementation` phase 中至少两个
pending 的 backend/frontend 任务，复用共享 Task DAG 冲突校验，把 `dev` 固化为同一 `baseCommit`，并为每项任务派生
稳定分支和 `.harness/worktrees/<story>/wave-<n>/<taskId>` 路径。状态仅从 Git 事实聚合为 `absent/partial/ready`，
任务级状态为 `absent/branch-only/created`；DAG、基准、分支、路径、HEAD、junction 或计划外 Worktree 漂移均失败关闭。
该入口不提供 `WaveCreate`，不启动 Worker，不合并或删除 Worktree，也不修改 M2/M3 状态。

`kb-query.ps1` is a read-only keyword search over `llm-knowledge/`. Treat empty results as missing
knowledge and verify source files directly before implementation.
