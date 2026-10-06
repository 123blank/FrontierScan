# M5-B2-001 测试报告

## 结果

结论：PASS。M5-B2 针对性测试、M2-M5 回归、结构、状态、Task DAG、Smoke、知识新鲜度和差异门禁全部通过。

## 命令证据

| 命令 | 结果 |
| --- | --- |
| `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | PASS，24/24 |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | PASS，19/19 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | PASS，11/11 |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | PASS |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | PASS |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | PASS |
| `node .\.harness\scripts\tests\harness-status.test.mjs` | PASS |
| `.\.harness\scripts\tests\task-dag.test.ps1` | PASS |
| `validate-state.ps1 -StateFile .harness/states/e2e-M5-B2-001.json` | PASS |
| `validate-task-dag.ps1 -TaskDagFile .harness/runs/M5-B2-001/phases/02-task-dag/task-dag.json` | PASS，1 task/0 edge/1 wave |
| `validate-structure.ps1` | PASS，24 directories/154 files/13 Skills |
| `smoke-harness-flow.ps1` | PASS |
| `select-tests.ps1` | PASS，建议 Harness structure/state 门禁 |
| `check-kb-freshness.ps1` | PASS，backend/frontend/common 均 fresh |
| `git diff --check`、新文件行尾空白检查、Node `--check` | PASS |

M3 固定 Adapter `harness-state-tests`、`harness-m3-tests` 和 `harness-structure` 均通过，证据位于当前 phase 的 `evidence/`。

## 范围确认

- `git diff -- backend/src frontend/src` 为空，未运行无关 backend Maven 测试或 frontend build。
- `git worktree list --porcelain` 只有正式 `dev` 主工作树；临时测试 Worktree 已随 fixture 清理。
- `collect-diff-context.ps1` 未发现无关 dirty files。
- 未执行正式仓库 Apply、Git 写操作、merge/remove、发布或部署。

## 剩余边界

断电级 fsync、恶意同进程调用方、跨平台 Git 差异和未知临时文件自动清扫属于已记录的低概率延期边界，不影响当前 Windows 单任务主流程验收。

## Review 修复后复验

针对逐文件 preflight 竞态、receipt 前最终哈希复核、receipt 严格字段和 `taskId` identifier 新增 4 个测试后，重新运行了本报告全部 Node 与 PowerShell 门禁。交付前 Review 又增加 Windows `core.autocrlf=true` 重新检出回归，先复现 base 哈希误判，再以 Git 逻辑差异完成 GREEN；结果保持 PASS，M5-B2 用例数更新为 24/24。
