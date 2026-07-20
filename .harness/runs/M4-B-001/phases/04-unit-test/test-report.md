# M4-B 单元与集成测试报告

## 结论

M4-B Worker、M3、M2、Harness 状态和结构门禁通过。测试全部在当前工作区执行；未修改 backend/frontend，因此按测试选择器和构建计划不运行无关业务构建。

## 结果

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| Worker | `node .\.harness\scripts\tests\worker-runtime.test.mjs` | 通过 |
| M3 | `node .\.harness\scripts\tests\story-runtime.test.mjs` | 通过 |
| M2 | `node .\.harness\scripts\tests\state-runtime.test.mjs` | 通过 |
| Harness 状态文档 | `node .\.harness\scripts\tests\harness-status.test.mjs` | 通过 |
| UTF-8 DAG | `task-dag.test.ps1` | 通过 |
| 结构 | `validate-structure.ps1` | 21 个目录、129 个文件、13 个 Skill，通过 |
| 全部状态 | 遍历 `.harness/states/*.json` 调用 `validate-state.ps1` | active pointer、3 个 Story、2 个模板均通过 |
| M4-B DAG | `validate-task-dag.ps1` | 5 个任务、4 条边、5 个串行波次，通过 |
| Smoke | `smoke-harness-flow.ps1` | M2 init、M3 prepare、M4-B Worker、M3 apply 及既有辅助流程通过 |
| 知识 | `check-kb-freshness.ps1 -Json` | backend/frontend/common 均 fresh，无刷新任务 |
| 知识查询 | `kb-query.ps1` | Common 索引 fresh，查询通过 |
| no-build | `git status --porcelain -- backend frontend` | 无差异，无需构建 |
| diff | `git diff --check` | 无空白错误；仅 Windows LF/CRLF 提示 |

## 覆盖重点

- 12 角色策略的一致性和 fail-closed 负例。
- context UTF-8、symlink、权限和 2/8 MiB 限额。
- provider 异常、超时和 AbortSignal。
- 候选身份、Schema、record、capability、路径、输出集合与大小。
- 全量预检、result-last、写后中断和相同 dispatch 重试。
- result 已存在时，apply 前后重复执行均在 provider 前拒绝且不修改阶段产物。
- Worker 不修改 revision，显式 M3 apply 只推进一次。
- Review 修复后的 Windows 大小写/父子候选路径冲突、test record 证据路径、固定角色 capability 集合和重复 dispatch 保护已重新运行全部门禁。

最后一轮新鲜验证在所有 Review 修复完成后执行，表中命令均为退出码 0。

## 跳过项

- backend tests、frontend build：无业务源码、依赖、配置或构建文件变化。
- 真实 Agent/API：明确不在 M4-B mock provider 范围。
