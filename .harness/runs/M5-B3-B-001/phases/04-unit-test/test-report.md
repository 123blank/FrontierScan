# M5-B3-B-001 测试报告

## 范围

本 Story 仅修改 Harness Runtime、Schema、测试、文档和知识产物，未修改 `backend/**` 或 `frontend/**`。测试覆盖 v1.1 task-scoped dispatch、严格串行批次账本、单 Worktree Worker/集成/回收、M3 显式 apply 边界以及 M2 状态回归。

## RED-GREEN 证据

- `worktree-batch-receipt.schema.json` 缺失时，新增的 `serial batch receipt schema preserves finalized task evidence` 测试以 `ENOENT` 失败。
- 补齐 Schema、结构清单、JSON 解析门禁和结构计数后，同一测试及 `harness-status.test.mjs` 均通过。
- 原子写入失败时 UUID 临时文件未清理、Worker 执行锁初始化失败时遗留 `execute.lock`、批次回收锁初始化失败时遗留锁，均先由针对性测试复现，再通过 `close + unlink` 的最小清理逻辑转为 GREEN。
- `batchRetire` 锁后重载上下文可能释放错误锁路径的问题，先由源级回归守卫锁定失败条件，再通过冻结实际取得的 `retirementLockPath` 修复；最终生命周期回归 `37/37` 通过。

## 命令

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\batch-runtime.test.mjs` | 通过 | 账本、回执、Schema 与收尾回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\serial-batch-runtime.test.mjs` | 通过（1/1） | 两任务临时 Git 串行闭环；锁路径修复后重新验证。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\worktree-runtime.test.mjs` | 通过（28/28） | M5-A 单 Worktree 兼容回归；锁路径修复后重新验证。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\worktree-worker-runtime.test.mjs` | 通过（54/54） | M5-B1 单任务和批次 Worker、原子写入与锁初始化清理回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\worktree-integration-runtime.test.mjs` | 通过 | M5-B2 单任务和批次集成回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\worktree-lifecycle-runtime.test.mjs` | 通过（37/37） | M5-C、batch Retire 回收恢复、锁初始化清理与实际锁路径释放回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\worker-runtime.test.mjs` | 通过 | M4-B 权限、结果和恢复回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\story-runtime.test.mjs` | 通过 | M3 Dispatcher、`prepare-batch/finalize-batch` 与 apply 边界。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\state-runtime.test.mjs` | 通过 | M2 状态推进、锁和恢复回归。 |
| `node --test-reporter=dot .\\.harness\\scripts\\tests\\harness-status.test.mjs` | 通过 | 结构清单、文档计数和运行状态摘要回归。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\tests\\task-dag.test.ps1` | 通过 | DAG 安全契约回归。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\validate-task-dag.ps1 -TaskDagFile .\\.harness\\runs\\M5-B3-B-001\\phases\\02-task-dag\\task-dag.json` | 通过 | 9 个任务、8 条依赖、9 个 wave 均有效。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\validate-structure.ps1` | 通过 | 27 个目录、177 个受保护文件、13 个 Skill 文件。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\smoke-harness-flow.ps1` | 通过 | 非破坏性 M2/M3/M4-B/M5-B3-B 协议 Smoke。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\check-kb-freshness.ps1` | 通过 | `backend`、`frontend`、`common` 均为 fresh。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\run-state.ps1 -Command validate -StateFile .\\.harness\\states\\e2e-M5-B3-B-001.json` | 通过 | 当前 Story 状态有效。 |
| `git diff --check` | 通过 | 未发现空白错误；仅输出 Windows 工作区行尾转换提示。 |

## 未执行的业务构建

| 测试/构建 | 原因 | 风险 |
| --- | --- | --- |
| `backend` Maven 测试 | 无 `backend/**` 改动，测试选择器未要求。 | 本 Story 未重新验证业务服务；Harness 运行时测试不替代后端业务回归。 |
| `frontend` 构建 | 无 `frontend/**` 改动，测试选择器未要求。 | 本 Story 未重新验证前端打包；Harness 运行时测试不替代前端业务回归。 |

## 失败

- 无未关闭失败。
