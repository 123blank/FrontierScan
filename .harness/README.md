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

`validate-task-dag.ps1` expects a concrete DAG output file. It checks task shape, edge references,
wave references, duplicate task IDs, and cycles.

`kb-query.ps1` is a read-only keyword search over `llm-knowledge/`. Treat empty results as missing
knowledge and verify source files directly before implementation.
