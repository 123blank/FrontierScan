# Harness Workflow Conventions

Use this workflow for non-trivial FrontierScan changes:

1. Understand the request and load only relevant knowledge.
2. Create or update a state file under `.harness/states/`.
3. Break work into tasks with dependencies and predicted file touches.
4. Implement only task-owned changes.
5. Run targeted tests and builds.
6. Review the diff for correctness, missing tests, and UI guideline alignment.
7. Verify APIs or UI flows when the environment is available.
8. Deliver only owned files.

Rules:

- State files are the source of truth, not conversation history.
- Do not silently trust stale knowledge.
- Do not overwrite unrelated dirty changes.
- Publish, push, and commit require explicit confirmation.

## M5-B3-B 串行批次约定

- 只有 active Story 的 `implementation` phase 中至少两个 `backend`/`frontend` 任务才能使用 v1.1 batch；单任务和其他 phase 继续使用 v1.0 Dispatcher。
- 批次必须由 `prepare-batch` 生成 task-scoped `task.json`、`result.json`、checkpoint 和 serial batch ledger。每次只允许 claim 一个确定性下一任务，不能因同 wave 而并行。
- `BatchPlan/BatchStatus/BatchCreate/BatchRetire` 从 ledger 派生身份、分支、路径和固定基准；Create、Apply、Retire 仍需要用户逐次批准和对应显式确认参数。
- 每项候选以其 `predictedFiles`、继承快照、执行回执和集成回执校验。全部任务 `integrated` 前不能生成正式 phase result；`finalize-batch` 不推进状态，既有 M3 `apply` 只推进一次。
- 临时 Git fixture 可以验证真实 Worktree 创建和回收；正式仓库 Worktree 操作、并行、多 Worktree、分支删除、`prune`、Fork-Join、真实 Agent 与 Git 交付继续不在此能力范围内。
