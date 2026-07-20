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
    worktree-plan.schema.json
    worktree-status.schema.json
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

`run-worktree.ps1` 是 M5-A 单 Worktree 入口，支持 `Plan/Status/Create`。`Create` 必须有用户逐次批准并显式传入
`-ConfirmCreate`；它不启动 Worker，不合并或删除 Worktree，也不推进 M2/M3 状态。

`kb-query.ps1` is a read-only keyword search over `llm-knowledge/`. Treat empty results as missing
knowledge and verify source files directly before implementation.
