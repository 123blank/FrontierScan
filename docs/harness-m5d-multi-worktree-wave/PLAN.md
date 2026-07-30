# Harness M5-D-A 同 Wave 多 Worktree 兼容性实施计划

> Story：`M5-D-A-001`
>
> 方法：严格 RED-GREEN-REFACTOR；每项任务通过针对性测试和 owned diff 检查后再进入下一项。

## 任务 1：确定性 Wave 计划

1. 先新增失败测试，覆盖非 `implementation`、非法 wave、单任务 wave、非 pending、非 backend/frontend、`globalChanges`、Story 不一致和无效 base ref。
2. 运行专项测试，确认因 `wave-plan` 尚不存在而 RED。
3. 在现有 `worktree-runtime.mjs` 中实现最小 wave 上下文、稳定排序、基准固化、确定性分支/路径和原子计划写入。
4. 新增 `worktree-wave-plan.schema.json`，严格限制字段。
5. 运行专项测试并审核本任务差异。

## 任务 2：Git 事实状态与恢复

1. 先新增失败测试，覆盖全 absent、部分 created、全部 created、branch-only 恢复和 Harness 状态不变。
2. 实现单次 `git worktree list --porcelain` 与逐分支 ref 探测，聚合 `absent/partial/ready`。
3. 新增 `worktree-wave-status.schema.json`，固定每任务和聚合状态。
4. 相同事实重复检查时复用已有状态，避免无意义改写时间戳。
5. 运行专项测试并审核本任务差异。

## 任务 3：漂移失败关闭与 PowerShell 入口

1. 先新增失败测试，覆盖基准、DAG、计划、分支、路径、HEAD、符号链接和额外 Worktree 漂移。
2. 确认任一漂移不会写入新的 `status.json`。
3. 扩展 `run-worktree.ps1` 与 CLI 参数解析，新增 `WavePlan/WaveStatus` 和 `-WaveIndex`，不增加创建确认参数。
4. 在临时 Git 仓库通过 PowerShell 跑通 `wave-plan -> wave-status(absent) -> 手工创建两个 fixture Worktree -> wave-status(ready)`。
5. 运行专项测试并审核本任务差异。

## 任务 4：回归、文档与 Review

1. 登记 Schema、测试和文档，更新 Harness README、脚本说明、结构清单、架构适配、AI 交接和知识概览。
2. 运行 M5-D-A 专项、M5-A、M5-B3-B、M4-B、M3、M2 回归，以及结构、Smoke、知识新鲜度和 `git diff --check`。
3. 生成 `REPORT.md`，记录 RED/GREEN、临时双 Worktree fixture、恢复、漂移拒绝、延期边界和最终命令。
4. 仅审核 M5-D-A owned diff；发现影响稳定性、基本可用性或近期扩展的 `BLOCKER/WARNING` 后修复并重跑受影响门禁。
5. 审核清零后推进至 `git-delivery`，不执行 `git add/commit/push`。

## 验收标准

- 同一合法 wave 的两个任务共享固定 base commit，并生成稳定且互不冲突的分支、路径和计划顺序。
- Git 事实正确聚合为 `absent/partial/ready`，分支预创建识别为可恢复的 `branch-only`。
- 任一基准、分支、路径、HEAD、DAG 或额外 Worktree 漂移均失败关闭。
- Runtime 不执行 Worktree 创建、Worker、合并、删除或 Harness 状态推进。
- 正式仓库无 Worktree 副作用，backend/frontend 无修改。
