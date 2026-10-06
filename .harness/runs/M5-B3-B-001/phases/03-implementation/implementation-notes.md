# M5-B3-B-001 实施说明

## 实施范围

本 Story 在既有 M2、M3、M4-B、M5-A、M5-B1、M5-B2 与 M5-C 的边界内，实现同一 Story `implementation` phase 的单 Worktree 严格串行多任务批次能力。

核心变更包括：

- v1.1 task-scoped dispatch/result Schema 与严格版本区分；v1.0 单任务协议保持不变。
- serial batch ledger、不可变 `dev` 基准契约、任务级锁、继承快照、逐任务执行/集成回执和批次收尾。
- `run-story.ps1` 的 `prepare-batch/finalize-batch`，以及 `run-worktree.ps1` 的 `BatchPlan/BatchStatus/BatchCreate/BatchRetire`。
- M5-B1/M5-B2/M5-C 在 batch 路径中的逐任务校验、内容寻址集成、状态延迟物化和完成态回收。
- 临时 Git fixture 与非破坏性 Smoke；正式仓库没有创建或回收 Worktree。

## 不变量

- M2/M3 仍独占 Story revision 与 phase 推进；`finalize-batch` 不改变状态，只有既有 M3 `apply` 可推进一次。
- 同一 batch 只允许一个 Worktree 和一个 running task；同 wave 不构成并行授权。
- Worker 不获得 shell、网络、Git、发布或状态能力；所有业务候选必须经过任务 `predictedFiles`、哈希、回执和锁校验。
- Create、Apply、Retire 均继续要求外部用户逐次批准和显式确认参数。

## 范围控制

未修改 `backend/src/**`、`frontend/src/**`、数据库、外部服务、部署配置或业务构建脚本。未执行正式 Worktree 操作、`git add`、`git commit`、`git push`、发布或部署。
