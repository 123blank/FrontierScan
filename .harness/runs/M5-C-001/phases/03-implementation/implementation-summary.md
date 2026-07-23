# M5-C 实现说明

## 实现范围

- 扩展 `.harness/scripts/lib/worktree-runtime.mjs` 的 `retire` 命令。
- 扩展 M5-A/M5-B1/M5-B2 共享 Runtime，在持有自身锁后拒绝并发的 `retire.lock`，与 Retire 的锁内复检形成双向互斥。
- 扩展 `.harness/scripts/run-worktree.ps1`，公开 `Retire` 和 `-ConfirmRetire`。
- 新增 `worktree-retirement-receipt.schema.json` 与临时 Git fixture 生命周期测试。

## 核心行为

只有已完成的 M5-B2 目标 Story 可请求回收。Runtime 在任何 Git 删除前验证 M5-A/M5-B1/M5-B2 身份和哈希证据、目标分支与 HEAD、主工作树与 Worktree 变更集、所有生命周期锁以及显式确认。

回收使用固定参数数组调用 `git worktree remove --force`，保留任务分支，最后原子写入 retirement receipt。M2/M3 phase、revision 和 Adapter 均不受该 Runtime 修改。

## 受影响文件

- `.harness/scripts/lib/worktree-runtime.mjs`
- `.harness/scripts/lib/worktree-worker-runtime.mjs`
- `.harness/scripts/lib/worktree-integration-runtime.mjs`
- `.harness/scripts/run-worktree.ps1`
- `.harness/schemas/worktree-retirement-receipt.schema.json`
- `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`
- `.harness/scripts/tests/worktree-runtime.test.mjs`
- `.harness/scripts/tests/worktree-worker-runtime.test.mjs`
- `.harness/scripts/tests/worktree-integration-runtime.test.mjs`
- `.harness/README.md`
- 本 Story 的 Harness 文档与结构登记

未修改 `backend/src/**`、`frontend/src/**`、数据库、部署或外部服务。
