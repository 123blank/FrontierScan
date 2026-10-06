# M5-C 测试报告

## 范围

验证 M5-C 单 Worktree 回收、M5-A/M5-B1/M5-B2 回归、M4-B/M3/M2 回归以及 Harness 结构与 Smoke 门禁。

## 命令结果

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node --test .\\.harness\\scripts\\tests\\worktree-lifecycle-runtime.test.mjs` | 通过 | 15/15，覆盖可变 status 兼容、真实 M5-A→M5-B1→M5-B2→M3→M2→M5-C 纵向链路、确认、完整候选对账、ignored 文件、非 JSON CLI、锁内重检、回收、分支保留与恢复。 |
| `node .\\.harness\\scripts\\tests\\worktree-runtime.test.mjs` | 通过 | 11/11，M5-A 创建与状态回归。 |
| `node .\\.harness\\scripts\\tests\\worktree-worker-runtime.test.mjs` | 通过 | 20/20，M5-B1 回归；覆盖持有执行锁后拒绝 `retire.lock`。 |
| `node .\\.harness\\scripts\\tests\\worktree-integration-runtime.test.mjs` | 通过 | 25/25，M5-B2 回归；覆盖持有集成锁后拒绝 `retire.lock`。 |
| `node .\\.harness\\scripts\\tests\\worker-runtime.test.mjs` | 通过 | M4-B 回归。 |
| `node .\\.harness\\scripts\\tests\\story-runtime.test.mjs` | 通过 | M3 回归。 |
| `node .\\.harness\\scripts\\tests\\state-runtime.test.mjs` | 通过 | M2 回归。 |
| `node --test .\\.harness\\scripts\\tests\\harness-status.test.mjs` | 通过 | 文档与结构 manifest 统计一致。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\tests\\task-dag.test.ps1` | 通过 | Task DAG 契约回归。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\validate-structure.ps1` | 通过 | 25 个目录、159 个文件、13 个 Skill。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\smoke-harness-flow.ps1` | 通过 | 非破坏性 Harness Smoke。 |
| `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\.harness\\scripts\\check-kb-freshness.ps1` | 通过 | backend/frontend/common 均为 `fresh`。 |
| `git diff --check` | 通过 | 无空白错误；仅有 Windows LF/CRLF 预警。 |

## 未执行项

| 测试/门禁 | 原因 | 风险 |
| --- | --- | --- |
| backend Maven 测试、frontend 构建 | 本 Story 未修改业务源码，测试选择器给出 `no-build-required`。 | 不覆盖业务构建，但本 Story 不触及业务构建输入。 |
| 正式仓库 Retire | 需要逐次用户批准；测试仅在临时 Git 仓库执行真实回收。 | 正式仓库路径、权限或 Git 环境仍需执行时再次确认。 |

## 环境说明

全部测试只在临时 Git 仓库执行 Worktree 创建、集成与回收；正式 FrontierScan 仓库未执行 Retire。知识新鲜度检查无读取错误，三个知识区域均报告 `fresh`。
