# M4-B 受约束 Mock Worker 需求拆解

## 来源需求

在 M2 唯一状态推进和 M3 文件式 Dispatcher 之上，实现只通过测试依赖注入使用的受约束 Mock Worker。Worker 消费 M3 `task.json`，按 12 角色策略限制上下文和候选写入，生成兼容 `dispatch-result.schema.json` 的 `result.json`，由调用方显式执行 M3 `apply`。

## 假设与边界

- `contextFiles` 是内部可选参数，默认空数组，不修改 M3 task Schema。
- Worker 策略采用 JSON Schema 公开契约和 Node.js 标准库运行时校验，不引入 Ajv 或根级包管理。
- mock provider 是同进程测试依赖，不是恶意代码安全沙箱。
- 不进入真实模型、Custom Agent 启动、Plugin、Worktree、多 Agent、发布、部署或 Git 自动化。
- 不修改实际 backend/frontend 业务源码；写权限只在临时测试仓库验证。

## 开放问题

无。两项未回复选择按已批准计划中的推荐默认执行。

## 影响范围

| 区域 | 影响 |
| --- | --- |
| `.harness/scripts/lib/` | 新增 Worker 和共享 Dispatch 契约运行时 |
| `.harness/scripts/tests/` | 新增严格 TDD 回归和纵向 fixture |
| `.harness/schemas/` | 新增 Worker 策略 Schema，M3 Schema 保持 `1.0` |
| `.codex/agents/` | 新增 12 角色 Worker 策略，不启动真实 Agent |
| `docs/`、Harness 文档 | 新增设计、计划、报告并同步交接说明 |
| backend/frontend | 实际源码无修改、无需业务构建 |

## Story

### M4-B-001 - 打通受约束 Mock Worker 纵向闭环

- 用户价值：在接入真实 Agent 前验证任务、权限、结果和恢复边界，防止非法 Worker 输出污染状态。
- 验收标准：
  - [ ] 12 个 Worker 策略与 Agent 注册表名称、类别一一对应。
  - [ ] planning、review、verification、publisher 和 git-committer 的越权候选在落盘前被拒绝。
  - [ ] provider 异常、超时、非法结构、身份不符、路径越界和大小超限不产生 `result.json`，状态 revision 不变。
  - [ ] 同一 dispatch 可从 provider 超时或产物写入后中断中显式重试恢复。
  - [ ] 临时单 Story 可完成 `prepare -> mock Worker -> apply` 且只推进一次。
  - [ ] M2/M3/Worker 测试、Harness 结构、Smoke 和知识门禁通过。
  - [ ] 最终审核无未解决 `BLOCKER/WARNING`。
- 风险：同进程 provider 不构成 OS 沙箱；多文件写入不是断电级事务，作为延期边界记录。
- 测试提示：策略负例、上下文和输出限额、symlink、timeout、全量预检、result-last、中断重试、M3 纵向闭环。
