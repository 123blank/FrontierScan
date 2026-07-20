# M4-B 实施说明

## 已实现

- 新增 `dispatch-contract.mjs`，由 M3/M4-B 共用 task/result Schema `1.0` 结构和 record 状态校验。
- 新增 `worker-runtime.mjs`，实现显式 context、角色策略、provider timeout、2/8 MiB 限额、候选全量预检、result-last 原子写入、result 缺失时的同 dispatch 恢复，以及 result 已存在时的重复执行保护。
- 新增 12 角色 `worker-policies.json` 及公开 JSON Schema；角色名称和类别必须与 `agents.yaml` 一一对应。
- 新增 Worker 策略、context、权限、结果、原子恢复和 `prepare -> Worker -> apply` 纵向测试。
- Smoke 在临时仓库执行 M2 init、M3 prepare、M4-B Worker 和 M3 apply，不提供正式 mock CLI。

## TDD 与回归

每组行为均观察到明确 RED 后实现最小 GREEN。实施中发现并修复：Worker/M3 record 状态漂移、failed 结果引用 phase 外文件、M2 临时入口缺少共享模块、PowerShell 5.1 URI 构造、受控环境临时 Node 主模块限制，以及已有 result 的同一 task 重复执行覆盖产物。

当前针对性通过：

- `worker-runtime.test.mjs`
- `story-runtime.test.mjs`
- `state-runtime.test.mjs`
- `harness-status.test.mjs`
- Harness 结构 21/129/13
- 完整 Harness Smoke

## 边界

未修改 `backend/src/**`、`frontend/src/**`，未调用真实模型或外部服务，未启动真实 Agent，未执行 Worktree、发布、部署或任何 Git 写入。
