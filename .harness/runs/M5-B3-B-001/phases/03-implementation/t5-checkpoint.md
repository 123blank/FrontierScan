# M5-B3-B-001 T5 检查点

## 暂停范围

本检查点仅确认 `T5`“累计 Worktree 的逐任务 Worker 执行”已完成实现、定向测试和双重审核。当前 Story 仍停留在 `implementation`，不推进 phase，不启动 `T6` 至 `T9`，不执行正式 FrontierScan 仓库的 Worktree 创建、回收、提交、推送、发布或部署。

本次实现仍只影响 Harness Runtime、Schema、测试和已有 Story 运行资产；`backend/src/**` 与 `frontend/src/**` 未修改。

## T5 覆盖与 RED/GREEN 记录

- 对已验证前序任务的继承候选建立不可变快照；后续任务只能读取并按自身 `predictedFiles` 改写允许的业务候选。
- 在生成执行回执前拒绝继承文件的越权改写、重命名和删除，且不推进 ledger。
- Provider 超时或异常后保持任务可显式重试，不留下可用结果、回执或锁。
- 结果已写但回执未写、回执已写但 ledger 未更新时，可在事实和哈希一致时恢复，不重复调用 Provider。
- 对已登记 Worktree 的缺失、末级 junction 与父级 junction 均失败关闭；创建前的第二次 Git 引用探测会拒绝分支漂移。
- 上述边界先以失败断言覆盖，再完成最小实现并通过回归；本轮以完整定向测试再次确认 GREEN 结果。

## 新鲜验证证据

执行日期：`2026-07-27`。所有命令在 `D:\ProjectStudy\FrontierScan` 执行。

| 门禁 | 结果 |
| --- | --- |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | `47/47` 通过 |
| `node .\.harness\scripts\tests\batch-runtime.test.mjs` | `31/31` 通过 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | `28/28` 通过 |
| `node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs` | `16/16` 通过 |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | 通过 |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | 通过 |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | 通过 |
| `task-dag.test.ps1` | 通过 |
| `validate-structure.ps1 -Root D:\ProjectStudy\FrontierScan` | 通过，检查 26 个目录、162 个文件和 13 个 Skill 文件 |
| `smoke-harness-flow.ps1 -Root D:\ProjectStudy\FrontierScan` | 通过 |
| `check-kb-freshness.ps1 -Root D:\ProjectStudy\FrontierScan` | backend、frontend、common 均为 `fresh` |
| `git diff --check` | 通过；仅有 Git 的 LF/CRLF 工作区提示，无空白错误 |

`smoke-harness-flow.ps1` 和知识新鲜度脚本均显式传入 `-Root D:\ProjectStudy\FrontierScan`，以避免当前会话目录或 PowerShell 解析差异影响结果归属。

## 审核结论

- 规格审核：未发现 `BLOCKER` 或 `WARNING`。
- 最终质量审核：未发现 `BLOCKER` 或 `WARNING`。
- 本轮独立复跑覆盖了审核关注的状态证据稳定性、继承文件越权、junction 安全边界和创建前分支漂移。
- 续审确认：忽略文件不能绕过 Worktree 白名单，Provider 返回后的 Git 事实会在 readiness 转换锁内重新核验，跨角色继承文件仅在符合读取策略时进入 Provider 上下文；公开入口拒绝传入内部锁豁免参数。

## 延期边界

- `T6` 逐任务集成与批次证据聚合、`T7` 批次回收校验、`T8` 两任务纵向 fixture、`T9` 文档收尾和最终审核均未开始。
- 多 Worktree 并行、自动清理、分支删除、断电级持久化、跨平台行为差异和真实 Agent 仍不在本检查点范围内。
- 正式仓库的 Worktree 创建、回收和所有 Git 交付仍须取得单独的用户批准。

## 后续恢复条件

恢复时先读取本检查点和活动状态，重新检查工作区差异、相关测试与知识新鲜度；确认范围后从 `T6` 开始，不应重新执行或改写已经完成的 `T5` 证据。
