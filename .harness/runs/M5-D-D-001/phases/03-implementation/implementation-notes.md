# M5-D-D-001 实施说明

- 在现有 Worktree Runtime 中新增 `wave-retire`，未创建第二套 Runtime。
- 新增完成态证据收集、全局零删除预检、普通/recovery owner、稳定 task receipt 前缀和最终回执。
- 删除目标全部由 Task DAG、WavePlan、creation receipt、finalized ledger 与 wave receipt 派生。
- 所有真实 Worktree 删除只在临时 Git fixture 中执行。
- `CODEX-CROSS-SESSION-HANDOFF.md` 为无关未跟踪文件，未修改。
