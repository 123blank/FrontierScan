# M5-B1-001 实现记录

## 已实现

- 新增内部接口 `runWorktreeWorker`，组合 M5-A status 与 M4-B Worker，不提供 CLI。
- 绑定 active state、M3 prepared checkpoint、M5-A plan/status、单任务 DAG 和 owner identity。
- 当前 run Harness 输入完成全量预检后原子复制；已提交上下文直接读取固定 base Worktree。
- Provider 执行后使用 Git 事实校验完整写入集合，并复核输入哈希。
- `main-run` 和未声明候选的 base 上下文保持不可变；已声明且通过 M4-B 权限校验的 base 上下文可作为业务候选更新。
- 仅 phase output 返回 `ready-for-apply`；存在 backend/frontend 写入返回 `ready-for-integration`，不写 M3 正式 result。
- 新增 input manifest、execution receipt、独立 Worker result 证据和 task 级执行锁。
- 支持 receipt 幂等复用、Provider 失败后的输入快照复用，以及 phase-output Worker 完成后的回收恢复。
- 无 durable candidate list 的业务文件中断恢复失败关闭，等待人工检查或后续 M5-B2 能力。

## TDD 证据

- 依次观察了缺失入口、owner 不一致、多任务、Worktree absent、revision 漂移、输入快照、已有源码编辑、额外写入、两级回收、幂等、恢复、锁、显式 apply、输入原子性、checkpoint 绑定和 receipt 完整对账的 RED。
- 每条 RED 仅增加满足当前行为的最小 GREEN，并在后续步骤复用现有 M3/M4-B/M5-A 契约。
- 当前 `worktree-worker-runtime.test.mjs` 共 19 个测试，全部通过。

## 范围核对

未修改 `backend/src/**`、`frontend/src/**`，未创建正式仓库 Worktree，未实现 merge/remove、多任务聚合、真实 Agent、Git 自动交付、发布或部署，也未调用 M2/M3 状态推进命令。
