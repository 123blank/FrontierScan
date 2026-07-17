# Harness M3 实现记录

## 已完成业务

### T1：run 专属工作流产物

- M2 workflow required output 支持安全展开 `{runId}`。
- task DAG 门禁改为校验当前 phase 展开后的 DAG 路径。
- 九个 E2E phase 的新产物路径统一到 `.harness/runs/<storyId>/phases/`。
- M2 既有固定路径 workflow fixture 保持兼容。

### T2：结构化任务准备与查询

- 新增 `story-runtime.mjs` 和 `run-story.ps1`。
- `prepare` 生成/复用 task 与 checkpoint；`status` 保持只读。
- task/checkpoint 会核对 Story、phase、workflow、输出集合和 dispatch 身份。
- 路径归一化后强制位于当前 run/phase 目录。
- 新增 dispatch task/result JSON Schema。

### T3：固定 adapter 与结果应用

- adapter 使用代码内固定 registry、`execFile` 参数数组和 `shell: false`。
- 命令证据记录 exit code、耗时、stdout、stderr 和时间戳。
- unit-test adapter 自动绑定 M2 测试记录，同路径重跑可恢复失败门禁。
- `apply` 支持 completed/failed/blocked，且只通过 M2 `record/next/block/complete` 修改状态。
- 输出缺失、身份不匹配、目录越界、失败 adapter 和未解决 `BLOCKER` 均不能推进。
- record 后中断可按证据 SHA-256 去重并继续推进。

## 已完成验证

- M3 测试：通过。
- M2 状态运行时回归：通过。
- Node.js 语法检查：通过。
- PowerShell `status/prepare` 实际入口：通过。
- 三轮任务范围审核：无未解决 `BLOCKER/WARNING`。

## 变更边界

- 未修改 `backend/src/**`、`frontend/src/**`。
- 未加入真实 Agent、模型调用、多 Story、Worktree、发布、部署或 Git 写操作。
- T4 继续完成全阶段纵向测试、结构登记、Smoke 和最终文档。
