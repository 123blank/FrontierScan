# M5-C 实施记录

已实现审批门控的单 Worktree `Retire`：只接受已完成且已有 M5-B2 集成证据的目标 Story，并在固定 Git 参数执行 `git worktree remove --force` 前重新验证上游证据、主工作树、Worktree、分支、HEAD、变更集和生命周期锁。

回收后保留任务分支，原子写入 retirement receipt；Git 已移除但 receipt 未写入时，仅在全部证据仍匹配时恢复补写。该实现不推进 M2/M3 状态，不执行合并、分支删除或 `git worktree prune`，且未修改业务源码。

评审修复后，Runtime 还要求 M5-B2 `appliedFiles` 与 M5-B1 完整候选集合一致，显式拒绝未知 ignored 文件，并保证非 JSON `Retire` 成功路径返回正确退出码。

生命周期锁采用双向互斥：Retire 持有 `retire.lock` 后重检 `create/execute/integrate` 锁；Create、Worker 和 Apply 持有自身锁后也会在副作用前检查 `retire.lock`。后加锁的一方失败关闭，避免 Retire 重检后才启动的操作与强制移除重叠。
