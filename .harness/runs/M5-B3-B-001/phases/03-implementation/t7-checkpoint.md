# M5-B3-B-001 T7 检查点

## 范围

T7 已完成单 Worktree 串行批次的 `batch-retire` 回收校验。回收仅接受已完成的目标 Story 和已 finalized 的完整 batch；它从 ledger 与 batch plan 派生路径、分支和基准，校验每个 execution/integration receipt、最终业务文件、主树与 Worktree 改动、生命周期锁和保留分支后，才在临时 Git fixture 中执行 `git worktree remove --force`。

本检查点不推进 M3 phase 或 revision，不修改 `backend/src/**`、`frontend/src/**`，不在正式 FrontierScan 仓库创建或删除 Worktree，不执行 `git add`、提交、推送、合并、发布或部署。

## TDD 与修复

规格审查发现：Git 已成功删除 Worktree 后，若 retirement receipt 的原子写入失败并遗留 `.tmp-*`，重试会将该临时文件视为未知主树改动，无法进入受约束恢复。

- RED：新增“receipt 临时文件写入失败后重试”用例；旧实现稳定失败，错误为 `Main repository contains an unexplained batch change: ...worktree-retirement-receipt.json.tmp-*`。
- GREEN：`writeAtomicJson` 仅在自身 `writeFile` 或 `rename` 失败时删除其随机派生的临时文件；成功写入路径保持不变，清理失败继续失败关闭。
- 回归：用例通过后确认删除成功、receipt 失败后可重试写入恢复回执，且不会清理任何非本次写入生成的文件。

## 新鲜验证

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern "batch-retire clears a failed retirement receipt temporary file before retrying" .\\.harness\\scripts\\tests\\worktree-lifecycle-runtime.test.mjs` | `1/1` 通过 |
| `node .\\.harness\\scripts\\tests\\worktree-lifecycle-runtime.test.mjs` | `29/29` 通过，退出码 `0` |
| `node .\\.harness\\scripts\\tests\\worktree-runtime.test.mjs` | `28/28` 通过，退出码 `0` |
| `node .\\.harness\\scripts\\tests\\worktree-integration-runtime.test.mjs` | `44/44` 通过，退出码 `0` |
| `node --check .\\.harness\\scripts\\lib\\worktree-runtime.mjs` | 通过 |
| `validate-task-dag.ps1 -TaskDagFile .\\.harness\\runs\\M5-B3-B-001\\phases\\02-task-dag\\task-dag.json` | 通过，9 个任务、8 条边、9 个波次 |
| `run-state.ps1 -Command validate` | 通过 |
| `validate-structure.ps1` | 通过，26 个目录、162 个文件、13 个 Skill |
| `git diff --check` | 通过；仅有既有 LF/CRLF 工作区提示，无空白错误 |

## 审核结论

第一轮规格审核发现的 receipt 临时文件恢复问题已通过上述 RED/GREEN 修复并重新验证。修复后重新检查确认门禁、派生范围、完整证据绑定、主树和 Worktree 改动拒绝、锁、保留分支、重复回收及 Git 成功后的 receipt 恢复路径；未发现影响稳定性、基本可用性或近期扩展的 `BLOCKER` 或 `WARNING`。

## 延期边界

T8 的两任务纵向 fixture 和全量 Harness 回归、T9 的文档收尾与最终审核尚未开始。多 Worktree 并行、分支删除、自动 `prune`、正式仓库回收、断电级持久化和跨平台差异仍不在当前任务范围内。
