# M5-D-B 审批门控 WaveCreate 需求拆解

## 来源需求

在 M5-D-A 已有只读 `WavePlan/WaveStatus` 的基础上，为同一合法 wave 增加审批门控的多 Worktree 创建、波次锁、部分失败恢复和完成证据。

## 已确认决策

- 每个明确 wave 一次批准，批准绑定完整计划和 SHA-256。
- 部分创建失败时保留已创建 Worktree，只重试缺失项。
- 遗留锁不按时间或 PID 自动失效，必须由用户明确批准恢复。
- 同一 Story 同一时间只允许一个 wave 拥有已创建 Worktree。
- 采用现有 `worktree-runtime.mjs` 原生扩展，不创建第二套 Runtime。

## 影响范围

- Harness Worktree Runtime 与 PowerShell 入口。
- Wave 状态、锁和完成回执 Schema。
- 临时 Git fixture 与 Harness 回归测试。
- Harness 结构登记、架构、交接和里程碑文档。
- 不修改 backend、frontend、数据库或产品业务行为。

## 验收标准

- [ ] `WaveCreate` 只消费现有 `WavePlan`，并强制绑定 `ExpectedPlanSha256`。
- [ ] 一次批准只覆盖一个明确 wave，计划漂移后批准失效。
- [ ] 合法 wave 按稳定任务顺序创建或恢复多个 Worktree。
- [ ] 部分失败保留已创建 Worktree，只重试缺失项。
- [ ] 遗留锁只在用户确认旧进程停止并绑定全部现存锁哈希后恢复。
- [ ] 旧锁所有者失去 `lockId` 后不能继续 Git、写状态/回执或删除新锁。
- [ ] 同一 Story 其他 wave、计划外 Worktree、异地挂载和路径漂移均失败关闭。
- [ ] `ready` 和完成回执只能从当前 Git 事实产生。
- [ ] Harness state 文件不由 Worktree Runtime 修改，不调用 M2/M3。
- [ ] 不启动 Worker，不 merge/remove，不执行提交、推送、发布或部署。

## 风险与边界

- Windows 文件替换和受控中断恢复必须通过真实临时 Git fixture 验证。
- 锁恢复依赖用户确认旧创建进程和其他恢复进程均已停止。
- OS 级租约锁、错误人工确认下的强制隔离、并行 Worker 和自动 merge 不属于本 Story。
