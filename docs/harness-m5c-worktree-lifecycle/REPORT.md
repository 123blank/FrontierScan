# Harness M5-C 单 Worktree 生命周期回收报告

## 1. 目标与范围

`M5-C-001` 为已完成 M5-B2 集成的单 Worktree 增加审批门控的安全回收。它只扩展 Harness Runtime、Schema、测试和文档，不修改 `backend/src/**`、`frontend/src/**`，不删除分支、不执行 `git worktree prune`、不合并、不启动真实 Agent，也不执行提交、推送、发布或部署。

## 2. 已实现能力

- `run-worktree.ps1 Retire` 同时要求外部用户逐次批准和 `-ConfirmRetire`。
- 目标 Story 必须为 `phase === "done"` 且 `runtime.status === "completed"`，并绑定 M5-A、M5-B1 与 M5-B2 证据。
- 删除前重新对账主工作树、Worktree、分支、HEAD、证据哈希、可解释变更集合与生命周期锁；任何不一致均在 Git 移除前失败关闭。
- M5-B2 `appliedFiles` 必须完整覆盖 M5-B1 候选；ignored 文件也纳入未知内容门禁，不能被 `--force` 静默删除。
- 仅使用固定参数数组执行 `git worktree remove --force <派生路径>`，并保留任务分支。
- `retirement-receipt.json` 绑定回收身份、全部上游证据、正式结果和恢复状态；Git 移除后 receipt 写入中断支持受证据约束的补写恢复。

## 3. TDD 证据

- RED：M5-B2 计划调用 M5-A `status` 后，`status.json` 的 `observedAt` 改变，旧实现因继续比较 M5-B1 receipt 中的历史 `statusSha256` 而拒绝合法回收。
- GREEN：Retire 改为校验当前 M5-A status 的身份、状态和 `planSha256`，并校验 M5-B2 integration plan 对 M5-B1 execution receipt 的路径与 SHA-256 绑定，不再把可变观测文件当作不可变历史证据。
- RED：在取得 `retire.lock` 后写入 M5-B2 `integrate.lock` 的测试失败，证明旧实现存在锁检查窗口。
- GREEN：Runtime 在持有 `retire.lock` 后重新检查 `create/execute/integrate` 锁；同一测试通过，且 Git 移除前拒绝执行。
- RED：分别在 M5-A Create、M5-B1 Worker 和 M5-B2 Apply 前放置 `retire.lock`；旧实现仍创建 Worktree、调用 Provider 或写入集成候选，证明单向重检无法阻止重检后才加锁的操作。
- GREEN：Create、Worker 和 Apply 均在持有自身锁后、任何副作用前检查同任务 `retire.lock`。结合 Retire 持锁后的反向重检，无论哪一方先加锁，后加锁的一方都会失败关闭并清理自身锁。
- 真实纵向 fixture 通过公开 Runtime 完成 `M5-A plan/create -> M5-B1 Worker -> M5-B2 plan/apply -> M3 apply -> M2 done -> M5-C retire`，未手工伪造上游 receipt 或终态；它证明 M5-B2 刷新 status 后仍可回收，且回收不改变完成态 state、已集成候选或正式 `result.json`。

## 4. 最终验证与审核

本轮已完成并通过以下门禁：M5-C 15/15、M5-A 11/11、M5-B1 20/20、M5-B2 25/25、M4-B Worker、M3 Story、M2 State、Harness status、Task DAG、全部 Harness 状态、Harness 结构、Smoke、知识新鲜度和 `git diff --check`。结构校验结果为 25 个目录、159 个文件、13 个 Skill。

M5-C owned diff 最终审核未发现 `BLOCKER` 或 `WARNING`。审核累计修复了可变 status 历史哈希误判、生命周期锁单向竞争窗口、集成回执候选漏项、ignored 文件静默删除、非 JSON CLI 成功后误报失败和结构统计漂移，并补齐真实上游 Runtime 纵向验收。

本 Story 已推进到 `git-delivery`；未获得 Git 交付批准，因此未执行暂存、提交、推送或 PR，也不会标记为 `done`。

## 5. 延期边界

- 不处理 M5-B1 `ready-for-apply` 路径、多任务/多 Worktree 波次、Worktree 复用、分支删除、自动 `prune`、冲突处理或自动清理。
- 不实现断电级 `fsync`、跨文件全局事务、并发回收协调、遗留锁自动回收、手工迁移 Worktree 或非 Windows 行为差异。
- 真实 Agent provider、真实模型、发布、部署和 Git 自动交付继续不在本 Story 范围内。
