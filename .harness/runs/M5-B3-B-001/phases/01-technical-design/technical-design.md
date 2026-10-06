# M5-B3-B-001 技术设计

正式设计见 [`docs/harness-m5b3-batch-runtime/DESIGN.md`](../../../../../docs/harness-m5b3-batch-runtime/DESIGN.md)。

## 已确认结论

- M5-B3-B 仅支持 `implementation` phase 中具有可集成 backend/frontend 候选的多节点 DAG；既有其他 phase 和 v1.0 单任务协议不修改语义。
- 每个任务在 phase 下拥有独立 `task.json`、`result.json` 与 `checkpoint.json`，且与 batchId/taskId 绑定。
- 一个 batch Worktree 串行承载全部任务；每次任务开始时记录继承文件快照，并以 receipt allowlist、DAG 预测路径和当前 SHA-256 拒绝未声明的累积改动。
- 每个任务固定生成 `task-report.md`，M5-B1/M5-B2 逐任务生成和验证回执；只有全量任务 `integrated` 后才生成 batch receipt、唯一 `implementation-notes.md` 和标准 M3 phase 结果。
- `finalize-batch` 不推进状态；既有 M3 `apply` 仍是唯一 phase 推进入口，且只执行一次。
- M5-C 仅在目标 Story `done/completed` 后根据 batch 证据回收 Worktree。

## 实施前置

设计尚待用户审阅。审阅确认前不生成实现计划、不扩展 Runtime、不创建正式 Worktree、不执行提交、推送、发布或部署。
