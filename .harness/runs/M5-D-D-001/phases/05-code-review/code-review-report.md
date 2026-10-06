# M5-D-D-001 代码审核报告

审核日期：2026-08-07

## 首轮独立审核

首轮只读 Reviewer 报告了 4 个 BLOCKER：

1. task/final receipt 写入点和锁释放存在 owner replacement 竞态。
2. M3 Wave finalization 未完整绑定 `preparedRevision`、`finalizedAt`、正式产物路径和 Wave receipt 身份。
3. 完成态 State record 路径被读取，但未校验当前有效记录的 `sha256`。
4. 已有 task/final retirement receipt 的 `retirementId` 和 `retiredAt` 校验弱于 Schema。

## 修复处置

- 在 task receipt、final receipt 实际写入前重新校验 owner。
- 锁释放在每个删除点前重新读取并比较目标锁，replacement 出现时保留现场并失败关闭。
- 对齐 M3 finalization 契约，完整校验 revision、finalized time、正式产物路径、Wave receipt 身份和任务映射。
- 按 State Runtime 的同路径最新记录语义校验当前有效 record 的 SHA-256。
- 统一校验 retirement receipt 的 UUID 与 RFC 3339 date-time。
- 新增 8 个负向/竞态测试；完整 Worker Runtime 从 87 个用例增加到 95 个用例。

## 当前状态

- 4 个首轮 BLOCKER 均已完成 TDD 修复。
- 第二个独立只读 Reviewer 于 2026-08-07 报告 1 个 BLOCKER 和 1 个 WARNING：
  - 完成态 State revision 未约束为不小于 Wave `preparedRevision`。
  - retirement normal/recovery lock 的 `createdAt` 仍弱于 Schema `date-time`。
- 2026-08-10 已完成两项 TDD 修复：
  - State revision 回退会在首次删除前失败，两个 Worktree 保持存在。
  - normal/recovery lock 统一使用 RFC 3339 date-time 校验。
- 对应定向测试 2/2，完整 Worker Runtime 97/97。

## 最终独立复审

2026-08-10，原独立 Reviewer 对上述 BLOCKER/WARNING 做闭环复核：

- 无 BLOCKER。
- 无 WARNING。
- 独立重跑两个新增定向测试，2/2 PASS。
- 确认 State revision 校验发生在 owner 获取、preflight hook 和任何 Worktree 删除之前。
- 确认 normal/recovery lock 的 `createdAt` 均使用 RFC 3339 校验。
- 确认 `CODEX-CROSS-SESSION-HANDOFF.md` 是无关 dirty file，未修改、未纳入 Story。

## 结论

代码审核通过，可以从 `implementation` 推进并通过 `unit-test`、`code-review` 阶段。

剩余边界：

- 独立 Reviewer 未重复运行完整 97 用例；主会话当前工作树已实际完成 97/97。
- 正式仓库未执行真实 WaveRetire，删除验证仍限定在临时 Git fixture。
