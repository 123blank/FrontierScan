# M5-D-D WaveRetire 实施报告

## 1. 结果

`M5-D-D-001` 在现有 `worktree-runtime.mjs` 与 `run-worktree.ps1` 中实现 `WaveRetire/wave-retire`，
完成单个完整 implementation wave 的审批门控、可恢复、保留分支的多 Worktree 回收闭环。

## 2. 已实现能力

- 严格 CLI 参数门禁和四个 JSON Schema。
- `done/completed`、finalized ledger、wave receipt、M3 apply checkpoint 和正式产物完整性校验。
- M3 finalization 的 `preparedRevision`、`finalizedAt`、正式产物路径、Wave receipt 身份和任务映射重验。
- 完成态 State 当前有效 record 的路径与 SHA-256 绑定。
- 首次 Git 删除前的全局零删除预检。
- 普通/recovery 双锁、预期锁哈希接管和 replacement fencing。
- 全部 Wave/implementation writer lock 冲突检查。
- 按 WavePlan 稳定顺序删除 Worktree。
- Git 注册消失、目录不存在、保留分支仍指向 `baseCommit` 的删除后验。
- task retirement receipt 稳定前缀、partial recovery 和最终 wave retirement receipt。
- task/final receipt 的 UUID、RFC 3339 时间和严格字段校验。
- task/final receipt 实际写点 owner 重验，以及锁释放前的 replacement 比较和失败关闭。
- 最终回执写入前后中断恢复与完整重验后的幂等复用。

## 3. 安全边界

- 只删除 Git Worktree 注册和目录，保留任务分支。
- 不执行 `git worktree prune`、分支删除、合并、reset、clean。
- 不修改完成态 State，不推进 M2/M3。
- 不执行自动提交、推送、PR、发布或部署。
- 正式 FrontierScan 仓库未执行真实 WaveRetire；Git 删除仅在临时 fixture 中验证。

## 4. 验证

直接 Runtime 回归、Harness 结构/状态/DAG/Smoke、知识新鲜度和差异检查结果记录在
`.harness/runs/M5-D-D-001/phases/04-unit-test/test-report.md`。

完整 Worker Runtime 为 97/97；lifecycle 为 39/39；wave 为 35/35；
wave-execution 为 9/9；Story Runtime 通过。结构校验结果为 31 个目录、
216 个必需文件和 13 个 Skill 文件。

## 5. 延期项

- 任务分支删除及其审批协议。
- `git worktree prune`。
- 外部创建、迁移或损坏 Worktree 的自动修复。
- 基于时间或 PID 的遗留锁自动判定。
- 真实 Agent、Fork-Join、自动 Git 交付、发布和部署。
