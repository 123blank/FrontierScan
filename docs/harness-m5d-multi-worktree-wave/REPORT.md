# Harness M5-D-A 同 Wave 多 Worktree 兼容性报告

> Story：`M5-D-A-001`
>
> 范围：Harness Runtime、Schema、测试、结构登记与中文文档；不修改业务源码。
>
> 当前状态：`git-delivery`；用户已批准本地提交，本报告随本次提交交付，未批准推送。

## 需求覆盖

| 目标 | 结果 |
| --- | --- |
| 同 wave 确定性计划 | 全部任务共享固定 `baseCommit`，按稳定 taskId 顺序派生唯一分支与路径 |
| Git 事实状态 | 任务级 `absent/branch-only/created`，聚合 `absent/partial/ready` |
| 冲突与漂移拒绝 | DAG、基准、任务集合、分支、路径、HEAD、junction、计划外 Worktree 和异地分支挂载均失败关闭 |
| 恢复兼容性 | 匹配分支未挂载时识别为 `branch-only`；相同事实复用状态证据 |
| 权限边界 | 无 `WaveCreate`，不启动 Worker，不 merge/remove，不调用 M2/M3 |

## TDD 与临时 Git Fixture

专项测试先后观察到预期 RED：命令缺失、计划外 Worktree 未拒绝、PowerShell 入口缺失、junction 漏检、重复任务计划漏检、不安全 taskId 路径逃逸，以及计划分支异地挂载被误报为可恢复。每项以最小实现转为 GREEN。

临时 Git fixture 验证：

```text
wave-plan
-> wave-status(absent)
-> 预建匹配分支(branch-only / partial)
-> 挂载第一个 Worktree(created + absent / partial)
-> 挂载第二个 Worktree(created + created / ready)
```

整个流程中 Harness state 字节不变。正式 FrontierScan 仓库未创建 Worktree。

## 最终验证

| 命令 | 结果 |
| --- | --- |
| `node .\.harness\scripts\tests\worktree-wave-runtime.test.mjs` | 11/11 通过 |
| `node .\.harness\scripts\tests\worktree-runtime.test.mjs` | 28/28 通过 |
| `node .\.harness\scripts\tests\worktree-worker-runtime.test.mjs` | 54/54 通过 |
| `node .\.harness\scripts\tests\worktree-integration-runtime.test.mjs` | 44/44 通过 |
| `node .\.harness\scripts\tests\worktree-lifecycle-runtime.test.mjs` | 37/37 通过 |
| `node .\.harness\scripts\tests\serial-batch-runtime.test.mjs` | 1/1 通过 |
| `node .\.harness\scripts\tests\batch-runtime.test.mjs` | 32/32 通过 |
| `node .\.harness\scripts\tests\worker-runtime.test.mjs` | 通过 |
| `node .\.harness\scripts\tests\story-runtime.test.mjs` | 通过 |
| `node .\.harness\scripts\tests\state-runtime.test.mjs` | 通过 |
| `node .\.harness\scripts\tests\harness-status.test.mjs` | 通过 |
| `powershell.exe ... task-dag.test.ps1` | 通过 |
| `powershell.exe ... validate-structure.ps1` | 28 目录、183 必需文件、13 Skill 通过 |
| `powershell.exe ... smoke-harness-flow.ps1` | 通过 |
| `powershell.exe ... check-kb-freshness.ps1` | backend/frontend/common 均 fresh |
| `git diff --check` | 通过，仅有 Windows 行尾转换提示 |

`select-tests.ps1` 判定没有 backend/frontend、Docker 或环境变更，因此业务构建不适用。

## Review 结论

Review 期间发现并修复以下问题：

- junction 父目录在目标路径缺失时被误判为 `absent`。
- 缺少状态缓存时，重复任务计划可绕过任务集合校验。
- 不安全 `taskId` 可逃出预期 wave 子目录。
- 计划分支挂载在其他 Worktree 路径时被误报为 `branch-only`。
- `localeCompare` 的区域设置排序不满足跨环境确定性。

每项均先新增可复现 RED，再以最小修复转 GREEN。最终 owned diff Review 未发现影响稳定性、基本可用性或近期扩展的未解决 `BLOCKER/WARNING`。

## 延期边界

- 审批门控 `WaveCreate`、波次锁、并行 Worker 与结果汇总。
- 自动 merge/remove、冲突解决、分支删除、`git worktree prune`、Fork-Join。
- 断电级持久化、遗留锁自动回收、Windows 以外平台差异。
- 真实 Agent、真实模型、发布、部署和 Git 自动交付。
