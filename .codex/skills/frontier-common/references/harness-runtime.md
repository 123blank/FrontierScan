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
- M7-A2 已实现 attempt-scoped task/result v2、九阶段严格 payload、completed-only State 投影、原子 apply、正式 `phase-result` 索引、幂等与过程状态恢复。
- M7-A3 已实现稳定 `criterionId`、DAG 2.0 `criterionIds`、测试与验证覆盖门禁、验收汇总重算，以及 `verification-gap` 的逐项用户批准回执。
- `accepted-with-known-gaps` 只能引用当前 attempt、当前 case 和当前证据对应的正式 approval；optional-only 的失败或阻塞如实保留但不阻止完成。
- `approve-gap` 与 `apply` 使用同一 Story 写锁；批准命令只更新 attempt 内 result 和 receipt，不单独推进 State。
- M7-A4 已实现 State v2 record 语义幂等、baseline 到工作树净变化、actual-only owned 推导、受控 owned manifest、delivery apply 对账和 completed State 外的版本化 delivery receipt。
- M7-B 已实现 `run-e2e.ps1 Status/Step/Apply` 和 Story Runtime 只读 `inspect`。驱动器只返回唯一下一动作或执行一次 prepare/apply，不自动生成认知结果、不自动选择 Adapter、不启动 Agent。
- `run-delivery.ps1` 不执行 Git 写操作。`PrepareManifest` 只在 active `delivery-preparation` 阶段运行；`Record` 只接受 completed State v2，并可只读核对 commit tree 和 remote ref。
- 知识新鲜度门禁仍属于 M7-C。
