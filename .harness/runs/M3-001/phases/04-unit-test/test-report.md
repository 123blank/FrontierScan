# Harness M3 测试报告

## 范围

Harness M3 文件式 Dispatcher、M2 run 专属产物扩展、固定命令 adapter、结构化结果应用、恢复门禁、结构/状态/DAG 契约、知识回归和完整 Smoke。

## 命令与结果

| 命令 | 结果 | 证据或说明 |
| --- | --- | --- |
| `run-story.ps1 -Command run-adapter -Adapter harness-m3-tests` | 通过 | `evidence/harness-m3-tests.json`，九阶段纵向闭环、缺失产物、失败 adapter、BLOCKER、blocked 和中断恢复通过 |
| `run-story.ps1 -Command run-adapter -Adapter harness-state-tests` | 通过 | `evidence/harness-state-tests.json`，M2 状态回归和中文 UTF-8 状态校验回归通过 |
| `run-story.ps1 -Command run-adapter -Adapter harness-structure` | 通过 | `evidence/harness-structure.json`，19 个目录、117 个文件、13 个 Skill |
| `node .\.harness\scripts\tests\source-fingerprint.test.mjs` | 通过 | 源指纹回归通过 |
| `node .\.harness\scripts\tests\harness-status.test.mjs` | 通过 | M2/M3 状态文档契约通过 |
| `node .\.harness\scripts\tests\generate-kb.test.mjs` | 通过 | 知识生成回归通过 |
| `kb-query.test.ps1` | 通过 | 查询回归通过 |
| `kb-freshness.test.ps1` | 通过 | 新鲜度回归通过 |
| `validate-state.ps1` 校验 E2E/Product 模板和 `e2e-M3-001.json` | 通过 | 含中文摘要的活动状态可按 UTF-8 解析 |
| `validate-task-dag.ps1 -TaskDagFile .harness/outputs/task-dag.json` | 通过 | 4 个任务、3 条边、4 个波次 |
| `generate-kb.ps1 -Area all -Mode baseline` | 通过 | 14 个模块、125 个写入文件、0 删除、328 个 Chunk |
| `check-kb-freshness.ps1` | 通过 | backend/frontend/common 均为 baseline/index `fresh`；Semantic `pending`，Embedding `skipped` |
| `smoke-harness-flow.ps1` | 通过 | 临时目录执行 M2 init/validate 与 M3 prepare/status，无仓库状态污染 |
| `git diff --check` | 通过 | 无空白错误，仅 Windows 行尾提示 |
| `git status --short -- backend/src frontend/src` | 通过 | 业务源码差异为空 |

## RED/GREEN 证据

- `{runId}` 未展开时，run 专属输出测试失败；实现路径展开后通过。
- `story-runtime.mjs`、`run-adapter` 和 `apply` 不存在时，对应行为测试失败；最小实现后通过。
- task/checkpoint 合法 JSON 但契约不一致时原实现错误复用；增加完整契约校验后通过。
- `phase/../../` 原实现通过字符串前缀校验；路径归一化后正确拒绝。
- 结构清单仍标记 `agent_runtime: deferred` 时状态回归失败；登记 M3 后通过。
- 含中文摘要的活动状态被 PowerShell 默认代码页破坏；`Get-Content -Encoding UTF8` 后通过。

## 跳过项

| 测试或门禁 | 原因 | 风险 |
| --- | --- | --- |
| Backend tests/package | 未修改 backend 业务源码；adapter 契约通过注入 argv 测试覆盖 | 不影响本次 Harness 主流程 |
| Frontend build | 未修改 frontend 业务源码；adapter 契约通过固定 argv 测试覆盖 | 不影响本次 Harness 主流程 |
| 真实 Agent/模型 | 属于 M4，M3 明确使用当前 Codex/人工文件结果 | 当前不具备自动 Worker 执行能力 |
| 真实发布、部署、Git、PR、Worktree | 不在 M3 范围且需要用户批准 | 没有外部状态变更 |

## 结论

当前 M3 实现的必需测试和 Harness 回归全部通过，可以进入 code-review。没有失败或无理由跳过的必需门禁。
