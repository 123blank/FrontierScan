# M5-B3-B-001 T6 检查点

## 范围

T6 完成单 Worktree 串行批次的逐任务集成与批次证据聚合。本检查点只覆盖批次 `plan/status/apply` 的集成前校验、任务专属 integration receipt 和账本登记；不调用 M3 `apply`，不修改 Harness phase、revision、业务源码、正式 Worktree 或 Git 交付状态。

## TDD 证据

1. 三任务串行回归先失败：`T1`、`T2` 合法连续覆盖 `SharedService.java` 后，`T3` 修改独立文件会因旧版逐个前序哈希校验报 `Predecessor integrated target hash drifted`。修复后，前序业务文件按规范化路径汇总为最后一次已集成回执，`T3` 可以完成集成。
2. 计划省略 Worker 候选的回归先失败：篡改计划以遗漏多候选中的一个文件时，旧版仍会执行部分写入。修复后，计划必须与 Worker receipt 的所有非 `result` 产物双向一致，写入前拒绝。
3. 伪造初始基线的回归先失败：篡改 `baseSha256` 以匹配未提交业务内容时，旧版会覆盖该内容。修复后，无前序回执的基线必须对应固定 `baseCommit` 的 Git clean 内容；同时保留与当前候选完全一致的受控恢复分支。

## 验证

| 命令 | 结果 |
| --- | --- |
| `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | `42/42` 通过，退出码 `0` |
| `node .\.harness\scripts\tests\batch-runtime.test.mjs` | `31/31` 通过，退出码 `0` |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | `47/47` 通过，退出码 `0` |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | `28/28` 通过，退出码 `0` |
| `node --check .\.harness\scripts\lib\worktree-integration-runtime.mjs` | 通过 |
| `node --check .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | 通过 |
| `git diff --check` | 通过；仅出现既有 LF/CRLF 工作树提示 |

## 审核结论

本任务进行了规格和质量复审。复审发现的前序回执覆盖、候选集合遗漏和初始基线篡改问题均已通过新增回归修复并重跑受影响门禁。最后一轮检查未发现影响稳定性、基本可用性或近期扩展的 `BLOCKER` 或 `WARNING`。

## 当前边界

- M5-B2 单任务入口和无 `batchFile` 的 v1.0 分支保持不变。
- 批次集成只写任务专属 report、result、bundle、integration receipt 和账本；正式 phase `result.json` 仍由后续显式 M3 `apply` 处理。
- T7-T9 尚未开始；结构清单、完整文档收尾和生命周期回收留在对应任务处理。
