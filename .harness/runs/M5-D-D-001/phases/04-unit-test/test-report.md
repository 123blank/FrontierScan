# M5-D-D-001 测试报告

首轮验证日期：2026-08-07
复审修复验证日期：2026-08-10

## 范围

- WaveRetire 参数和 Schema。
- 完成态与 M3/Wave 证据。
- 全局零删除预检。
- 双锁 recovery、owner fencing 和冲突锁。
- 有序删除、Git 后验、partial recovery、最终回执和幂等复用。
- M3 finalization binding、State record 哈希、已有回执 Schema 和实际写点 fencing 修复。
- 旧 Retire、BatchRetire、WavePlan、WaveCreate、Wave execution、Worker 和 Story Runtime 回归。

## Runtime 回归

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern "wave-retire" .harness/scripts/tests/worktree-worker-runtime.test.mjs` | PASS，22/22 |
| State revision 与 lock RFC 3339 定向测试 | PASS，2/2 |
| `node --test .harness/scripts/tests/worktree-worker-runtime.test.mjs` | PASS，97/97 |
| `node --test .harness/scripts/tests/worktree-lifecycle-runtime.test.mjs` | PASS，39/39 |
| `node --test .harness/scripts/tests/worktree-wave-runtime.test.mjs` | PASS，35/35 |
| `node --test .harness/scripts/tests/worktree-wave-execution-runtime.test.mjs` | PASS，9/9 |
| `node --test .harness/scripts/tests/story-runtime.test.mjs` | PASS，1/1 |

## Harness 门禁

| 命令 | 结果 |
| --- | --- |
| `validate-structure.ps1` | PASS，31 个目录、216 个必需文件、13 个 Skill 文件 |
| `validate-state.ps1 -StateFile .harness/states/e2e-M5-D-D-001.json` | PASS |
| `validate-task-dag.ps1 -TaskDagFile .harness/runs/M5-D-D-001/phases/02-task-dag/task-dag.json` | PASS，6 个任务、5 条边、6 个 Wave |
| `smoke-harness-flow.ps1` | PASS |
| `check-kb-freshness.ps1` | PASS，backend/frontend/common 均 fresh |
| `git diff --check` | PASS；仅有 CRLF 转换提示，无空白错误 |

## 结论

- 本次修改仅涉及 Harness Runtime、测试、Schema 和文档，不需要 backend/frontend 构建。
- 2026-08-10 完成独立复审新增 BLOCKER/WARNING 的 TDD 修复与完整 Worker 回归。
- 正式仓库未执行真实 Worktree 删除；所有 Git 删除均在临时 fixture 中完成。
- 未执行 `git add`、`git commit`、`git push`、PR、发布或部署。
