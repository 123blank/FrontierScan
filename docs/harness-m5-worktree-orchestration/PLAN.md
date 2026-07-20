# FrontierScan Harness M5-A 实施计划

## T1：Task DAG 安全契约

- [x] RED：遗漏/重复 wave、逆序依赖、同波次冲突、非法路径和全局变更并行。
- [x] GREEN：共享 Node 契约，PowerShell 入口保持兼容。

## T2：确定性计划和状态

- [x] RED：未知/非 pending 任务、Story 不一致、非法根、无效 base ref 和不稳定生成。
- [x] GREEN：固化 SHA，原子写 plan/status JSON，以 Git 事实识别状态。

## T3：批准门禁和恢复

- [x] RED：无确认、脏仓库、漂移、占用、第二个活动 Worktree 和中断恢复。
- [x] GREEN：显式确认、固定 Git argv、独占锁、幂等复用和部分创建恢复。

## T4：临时仓库纵向闭环

- [x] 真实执行 validate -> plan -> absent -> create -> created。
- [x] 重复 create 返回 reused，Harness revision 和 phase 不变。

## T5：回归、文档与审核

- [x] 完成 Harness 测试、结构、Smoke、知识、no-build 和 diff 门禁。
- [x] 生成 REPORT 并循环审核至无未解决 BLOCKER/WARNING。
- [x] 未经批准不执行正式 Worktree 创建或 Git 交付。
