# Harness Runtime

## 目录

- `.harness/schemas/`：State、指针和 Task DAG 契约。
- `.harness/states/`：活动 State、模板和活动指针。
- `.harness/workflows/`：版本化阶段定义。
- `.harness/runs/`：按 Story 保存的阶段产物。
- `.harness/templates/`：报告和示例模板。
- `.harness/reports/`、`.harness/outputs/`：兼容性报告与输出区域。

## 当前状态规则

- 新单 Story 默认使用 `e2e-state-v2.template.json` 和 `e2e-development-v2.yaml`。
- State v1 保留只读兼容，只允许 `status`、`validate` 和审计读取。
- `active-run.json` 继续使用指针协议 `1.0`，通过 `stateFile` 指向 v1 或 v2 State。
- v2 初始化冻结 Git HEAD、branch 和初始 dirty paths。
- v2 当前阻塞使用 `runtime.activeBlock`；恢复后清空，历史保存在日志和事件中。
- v2 以 `delivery-preparation -> done` 结束；`done` 不表示 Git 已提交或推送。
- PowerShell `validate-state.ps1` 是 Node `state-contract.mjs` 的薄入口，不维护第二套规则。
- M5 batch/worktree 正式协议仍只支持其历史 v1 fixture，v2 支持延期到后续里程碑。
- 阶段结果投影、验收追踪、知识新鲜度门禁和交付回执尚未由 M7-A1 实现。
