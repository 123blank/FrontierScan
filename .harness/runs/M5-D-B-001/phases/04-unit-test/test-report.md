# M5-D-B-001 测试报告

## 范围

修改涉及 Harness Worktree Runtime、PowerShell 入口、Schema、结构登记、测试和文档。测试选择覆盖：

- M5-D-B wave 专项行为。
- M5-A、M5-B1、M5-B2、M5-C 与 M5-B3-B 直接回归。
- M3 Story、M2 State、Harness 状态摘要和 Task DAG。
- 结构、Smoke、知识新鲜度和 diff 格式门禁。

未修改 backend/frontend，因此业务测试和前端构建不属于本次必需门禁。

## 命令

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs` | PASS | 34/34；含 Review 修订后的共享锁、恢复写前/写后竞态、双恢复并发、Git/状态/释放 fencing、陈旧查询和恢复中断 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | PASS | 28/28 |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | PASS | 54/54；首次执行仅因 240 秒工具时限中止，扩大时限后完整通过 |
| `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | PASS | 44/44 |
| `node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs` | PASS | 37/37 |
| `node .\.harness\scripts\tests\batch-runtime.test.mjs` | PASS | 32/32 |
| `node .\.harness\scripts\tests\serial-batch-runtime.test.mjs` | PASS | 1/1 |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | PASS | 当前工作区通过 |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | PASS | 当前工作区通过 |
| `node .\.harness\scripts\tests\harness-status.test.mjs` | PASS | 当前工作区通过 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\task-dag.test.ps1` | PASS | Task DAG validator tests passed |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1` | PASS | 29 个目录、188 个必需文件、13 个 Skill |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1` | PASS | 结构、状态模板、State Runtime、serial batch、DAG、知识查询/freshness 和只读规划闭环通过 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1` | PASS | backend/frontend/common baseline 与 index 均 fresh；semantic pending 符合预期 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\run-state.ps1 -Command validate -StateFile .\.harness\states\e2e-M5-D-B-001.json` | PASS | 当前活动状态合法 |
| `git diff --check` | PASS | 无空白错误；仅有 Windows 行尾转换提示 |

## 失败

- 无测试断言失败。
- `worktree-worker-runtime.test.mjs` 首次调用在完成第 30 个用例后达到 240 秒工具时限；输出未包含失败。将命令时限调整为 600 秒后完整执行并通过 54/54，未修改代码。

## 跳过测试

| 测试/门禁 | 原因 | 风险 |
| --- | --- | --- |
| backend `mvn test` | 未修改 backend 源码、配置或依赖 | 无新增后端行为风险 |
| frontend `npm run build` | 未修改 frontend 源码、配置或依赖 | 无新增前端构建风险 |
| API/UI 环境验证 | 本 Story 仅修改 Harness Runtime，不改变业务接口或界面 | 由临时 Git fixture 和 Runtime 回归覆盖 |
