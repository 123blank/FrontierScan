# M5-D-C1-001 测试报告

## 范围

修改只涉及 Harness Runtime、Schema、测试、状态证据和文档。测试覆盖：

- implementation owner 与 `prepare-wave`。
- dispatch/result v1.2 与 Worker attempt result/guard。
- Wave Execution Ledger、claim、并行、partial、retry 和 recover。
- mutation lock 创建窗口、failure/ledger 中断、ready/lock 中断和 abandoned evidence 二次恢复。
- v1.0/v1.1 Story、Worker、serial batch、Worktree、集成和生命周期直接回归。
- 结构、状态、Task DAG、Smoke、知识新鲜度、构建计划和 diff 门禁。

未修改 backend/frontend，因此不要求 Maven 测试或前端构建。

## 命令

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | PASS | implementation owner、v1.2 与 `prepare-wave` |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | PASS | v1.0/v1.1 与 v1.2 Worker |
| `node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs` | PASS | 8/8 |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | PASS | 63/63 |
| `node .\.harness\scripts\tests\batch-runtime.test.mjs` | PASS | 32/32 |
| `node .\.harness\scripts\tests\serial-batch-runtime.test.mjs` | PASS | 1/1 |
| `node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs` | PASS | 34/34 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | PASS | 28/28 |
| `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | PASS | 44/44 |
| `node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs` | PASS | 37/37 |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | PASS | 状态运行时回归 |
| `node .\.harness\scripts\tests\harness-status.test.mjs` | PASS | Harness 状态查询回归 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1` | PASS | Task DAG 校验器测试 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-task-dag.ps1 -TaskDagFile .harness\runs\M5-D-C1-001\phases\02-task-dag\task-dag.json` | PASS | 6 个任务、5 条边、6 个 wave |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-state.ps1 -StateFile .harness\states\e2e-M5-D-C1-001.json` | PASS | 活动 E2E 状态有效 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root D:\ProjectStudy\FrontierScan` | PASS | 30 个目录、201 个文件、13 个 Skill |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1` | PASS | 结构、状态、DAG、知识、构建和交付摘要冒烟 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1` | PASS | backend/frontend/common 均 fresh，semantic pending |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\kb-query.ps1 -Query "M5-D-C1 wave execution recover attempt owner dispatch v1.2" -Mode technical-design -Area common` | PASS | 知识索引可查询 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\plan-build.ps1` | PASS | `no-build-required` |
| `git diff --check` | PASS | 无空白错误 |
| `git worktree list --porcelain` | PASS | 正式仓库只有主工作树 |

## 已解决失败

1. v1.2 Worker 曾被旧 phase 路径与 checkpoint 分支拒绝。
2. 同进程短期 mutation lock 竞争曾导致并行任务错误 blocked。
3. mutation lock 已创建但 JSON 尚未写完时，竞争方曾把空文件误判为外部锁。
4. claim、execution lock、result/receipt、blocked 和孤儿候选的中断恢复曾存在缺口。
5. `failure.json` 已写但 ledger 尚未 blocked 时，恢复曾无法收敛。
6. ledger 已 ready 但执行锁尚未释放时，恢复曾拒绝 ready 状态。
7. abandoned failure 已写但 ledger 尚未 pending 时，二次恢复曾因不可变文件 `EEXIST` 失败。

以上问题均先观察 RED，再完成最小 GREEN，并由专项及完整回归覆盖。

## 跳过测试

| 测试/门禁 | 原因 | 风险 |
| --- | --- | --- |
| backend `mvn test` | 未修改 backend 源码、配置或依赖 | 无新增后端行为风险 |
| frontend `npm run build` | 未修改 frontend 源码、配置或依赖 | 无新增前端构建风险 |
| API/UI 环境验证 | 本 Story 仅修改 Harness Runtime | 由临时 Git fixture 和 Runtime 回归覆盖 |
| 真实 Agent Provider | C1 明确使用现有 Mock Provider | 真实 Agent 接入属于后续独立范围 |

## 结论

全部必需测试和确定性门禁通过，无未解决失败。
