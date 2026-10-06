# M4-A 测试报告

## 范围

本阶段覆盖 M4-A 的 CLI 兼容性证据、Harness 文档/结构变更和中文 UTF-8 Task DAG 修复。没有 backend/frontend 变化，因此不运行 Maven/npm 构建。

## 结果

| 门禁 | 结果 | 证据 |
| --- | --- | --- |
| M2 状态运行时回归 | PASS | `evidence/harness-state-tests.json`，`state-runtime tests passed` |
| M3 Dispatcher 回归 | PASS | `evidence/harness-m3-tests.json`，`story-runtime tests passed` |
| Harness 结构 | PASS | `evidence/harness-structure.json`，20/121/13 |
| 中文 UTF-8 DAG 回归 | PASS | `evidence/m4a-direct-gates.json` |
| M4-A 状态与 DAG | PASS | 状态有效；4 个任务、3 条边、4 个串行波次 |
| Harness Smoke | PASS | 结构、状态、知识、Dry Run、计划辅助脚本均通过 |
| 知识新鲜度 | PASS | backend、frontend、common 均为 fresh |
| Harness 状态契约 | PASS | `harness status tests passed` |
| no-build | PASS | backend/frontend Git 范围为空 |

## 修复过程

- 中文 DAG 回归测试先在校验器失败；修复后依次暴露 Worktree 计划和接口用例派生的同类默认编码问题，三个消费者均增加 `-Encoding UTF8` 后 GREEN。
- 首次 `harness-status` 因架构文档中文化和结构数量更新而失败；测试契约更新为中英文等价表达并登记 M4-A 文件后，最新运行 PASS。

## 跳过项

- backend tests：SKIPPED，没有 backend 变化。
- frontend build：SKIPPED，没有 frontend 变化。
- 真实模型调用：SKIPPED，M4-A 明确使用 `debug prompt-input`，不依赖模型或网络。

## 结论

所有与当前差异相关的必需门禁均通过，可以进入只读代码审核。

