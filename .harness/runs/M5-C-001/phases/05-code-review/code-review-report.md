# M5-C 代码审核报告

## 范围

仅审核 `M5-C-001` 归属的 Harness Runtime、PowerShell 入口、Schema、测试、状态产物和文档；不审核无关工作区内容。

## 审核结论

未发现影响稳定性、基本可用性或近期扩展的 `BLOCKER` 或 `WARNING`。

复审发现的问题均已修复：生命周期锁单向重检无法阻止重检后才加锁的 Create/Worker/Apply、可变 M5-A status 历史哈希会拒绝真实 M5-B2 链路、上游凭据由测试手工伪造而缺少纵向覆盖、集成回执漏项可能丢失候选、ignored 文件可能被强制删除、非 JSON Retire 成功后误报失败，以及结构清单统计未随 M5-C 资产更新。行为问题均由针对性测试覆盖。

## 已核对项

- Retire 必须同时经过外部用户逐次批准和 `-ConfirmRetire`，且目标 Story 必须为 `done/completed`。
- Git 删除前验证 M5-A/M5-B1/M5-B2 身份、哈希、候选/结果文件、分支、HEAD、主树与 Worktree 变更集。
- M5-A `status.json` 作为当前事实重新校验，不与 M5-B1 receipt 中的历史观测哈希强制相等；不可变关联改由 M5-B2 plan 的 `executionReceiptFile/executionReceiptSha256` 证明。
- 生命周期锁形成双向互斥：Retire 获取 `retire.lock` 后重检 `create/execute/integrate` 锁；Create、Worker 和 Apply 获取自身锁后也检查 `retire.lock`，覆盖任意加锁先后顺序。
- Git 使用固定 argv、无 shell、30 秒超时和有限输出缓冲；不删除分支，不执行 `prune`，不改 M2/M3 状态。
- M5-B2 `appliedFiles` 必须与 M5-B1 候选按路径、类型、SHA-256 和字节数完整对应；未知 ignored 文件同样阻止强制回收。
- PowerShell `Retire` 的 JSON 与普通文本输出均返回成功状态并携带 taskId。
- receipt 使用严格 Schema、原子写入与受约束恢复；临时 Git fixture 覆盖重复调用和 Git 移除后的中断窗口。
- 真实纵向 fixture 调用 M5-A、M5-B1、M5-B2、M3、M2 和 M5-C 公开 Runtime，验证回收前后目标 state、候选与正式 result 字节不变。

## 测试缺口与延期边界

未在正式 FrontierScan 仓库执行回收，原因是该操作需要逐次用户批准。多 Worktree、多任务、分支删除、自动 `prune`、跨平台和断电级持久化仍按设计延期，不作为当前范围内的阻塞项。
