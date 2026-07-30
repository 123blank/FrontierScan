# M5-D-A-001 实现说明

## 已实现

- 在既有 `worktree-runtime.mjs` 中增加 `wave-plan` 与 `wave-status`，未创建第二套 Runtime。
- 新增 `WavePlan/WaveStatus` PowerShell 入口与 `-WaveIndex`。
- 新增严格的 wave plan/status Schema。
- 对合法同 wave 任务固定统一 base commit，稳定派生分支、路径和任务顺序。
- 从 Git 事实识别任务级 `absent/branch-only/created` 与聚合 `absent/partial/ready`。
- 拒绝非法 phase/wave/task/base、DAG 漂移、重复计划任务、路径逃逸、junction、路径占用、分支/HEAD 漂移、计划外 Worktree 和分支异地挂载。
- 相同 Git 事实复用已有状态文件，Runtime 不修改 Harness phase 或 revision。

## TDD 证据

专项测试逐项经历 RED 到 GREEN：

1. `wave-plan` 命令不存在。
2. `wave-status` 命令不存在。
3. 计划外 Worktree 未被拒绝。
4. PowerShell 不识别 `WavePlan`。
5. 缺失任务路径时 junction 未被拒绝。
6. 缺少 status 缓存时重复计划任务未被拒绝。
7. 不安全 `taskId` 可逃出派生 wave 目录。
8. 计划分支挂载在其他 Worktree 路径时被误报为 `branch-only`。
9. `localeCompare` 使安全 ASCII `taskId` 的标点顺序依赖运行时区域设置。

每项均以最小修改修复，并在下一项前重跑专项测试。

## 范围

未修改 `backend/src/**`、`frontend/src/**`。未在正式 FrontierScan 仓库创建、合并、回收或删除 Worktree；真实双 Worktree 只在系统临时 Git fixture 中使用。未实现 Worker、Fork-Join、发布、部署或 Git 自动交付。
