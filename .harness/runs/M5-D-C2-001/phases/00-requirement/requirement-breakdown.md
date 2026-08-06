# M5-D-C2 Wave 集成与阶段收尾需求拆解

## 来源需求

在 M5-D-C1 已完成单个完整 implementation wave 的并行 Mock Worker 执行闭环后，继续实现同一 wave 的 integration manifest 冻结、主工作树受控集成、显式恢复、`finalize-wave` 与既有 M3 `apply` 闭环。

## 已确认决策

- 当前只实现单 Story、单个完整 implementation wave 的 C2 闭环。
- 采用既有方案 A：先原子冻结 integration manifest，再按 WavePlan 稳定任务顺序串行写入主工作树。
- integration manifest 一旦开始冻结，C1 的 claim、retry、recover、result 和 execution receipt 变更入口全部关闭。
- 集成失败时保留已集成确定性前缀，不自动回滚；恢复后只继续剩余任务。
- `integrate-wave` 完成全部任务后保留 integration owner，由 `finalize-wave` 生成正式 phase 产物、wave receipt、ledger finalization 和 checkpoint 绑定。
- 现有 M3 `apply` 仍是唯一 phase 推进入口，并必须支持中断后的幂等恢复。
- 当前会话串行实施，不使用 Subagent。

## 影响范围

- Wave Execution Ledger 状态、manifest 与 integration receipt 契约。
- Wave integration Runtime、锁、恢复和主工作树写入校验。
- Story Runtime 的 `finalize-wave`、checkpoint 绑定和 M3 `apply` 校验。
- PowerShell 入口、专项测试、结构登记、Harness 文档和知识概览。
- 不修改 backend、frontend、数据库或产品业务行为。

## 验收标准

- [ ] 只有所有任务 `ready-for-integration` 且执行证据、Worktree Git 事实一致时才能冻结 manifest。
- [ ] `manifest-preparation.lock`、`integration.lock` 和 `integration-recovery.lock` 均绑定当前身份与预期 SHA-256；旧 owner 失权后不能继续写入或释放新锁。
- [ ] manifest 内容确定性绑定 state、DAG、WavePlan、creation receipt、dispatch、checkpoint、attempt result、execution receipt、候选文件和主工作树业务快照。
- [ ] 主工作树首次写入前拒绝路径冲突、超出 `predictedFiles`、候选漂移、HEAD 漂移和范围外业务变化。
- [ ] 集成严格按稳定任务顺序执行；部分失败保留已集成前缀和回执，重试只处理剩余任务。
- [ ] `finalize-wave` 只在全部任务 `integrated` 且当前 integration owner 有效时生成正式 phase 产物、wave receipt、finalized ledger 和 `checkpoint.waveFinalization`。
- [ ] M3 `apply` 重验 wave finalization 绑定，只推进一次，并覆盖推进前、推进后中断恢复。
- [ ] C2 专项测试、C1/M3 直接回归、结构校验和 Harness Smoke 全部通过。

## 风险与边界

- 多文件集成不是文件系统级全局事务；通过逐文件原子替换、逐任务回执和确定性前缀恢复控制中断窗口。
- 外部修改主工作树业务文件时保留已集成前缀并失败关闭，不自动冲突解决或回滚。
- 所有真实 Git/Worktree 写入只在临时 fixture 中验证，正式仓库不执行 WaveCreate、Worker 或业务候选集成。
- 不实现 Worktree/分支回收、真实 Agent Provider、自动提交、推送、PR、发布或部署。
- 未经用户另行批准，不执行 `git add`、`git commit`、`git push`、PR、发布或部署。
