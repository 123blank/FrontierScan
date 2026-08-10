# M5-D-D-001 WaveRetire 生命周期回收需求拆解

## 来源需求

在 M5-D-C2 已完成单个完整 implementation wave 的并行执行、受控集成、阶段收尾和 M3 apply 闭环后，为已完成
Story 增加审批门控、可恢复且保留任务分支的多 Worktree 回收能力。

## 已确认决策

- 首版只移除 Git Worktree 注册和目录，保留所有任务分支。
- 仅允许目标 Story 已达到 `done/completed`，Wave execution ledger 为 `finalized`，且 M3 apply 与正式产物证据完整时回收。
- 扩展现有 `worktree-runtime.mjs` 和 `run-worktree.ps1`，不新增第二套 Runtime，也不重构统一 Retirement Engine。
- 路径、分支、base commit 和任务集合全部从已冻结 Wave 证据派生，不接受调用方自定义。
- 正式 FrontierScan 仓库不执行真实 Worktree 删除；真实 Git 副作用只在临时 fixture 中验证。

## 独立评审结论

独立只读 Agent 发现并经源码核验确认：

- BLOCKER：普通 retirement lock 缺少进程退出后的显式接管协议。
- BLOCKER：逐任务回执会与后续任务删除前的主树完整性重验冲突。
- WARNING：冲突锁集合、最终完成态绑定和 Git 删除后验检查不完整。

本 Story 必须吸收上述问题后才能进入实现。

## 影响范围

- `.harness/scripts/lib/worktree-runtime.mjs`：`wave-retire`、证据重验、锁、恢复和 Git 删除编排。
- `.harness/scripts/run-worktree.ps1`：`WaveRetire` 参数和拒绝规则。
- `.harness/schemas/`：Wave retirement lock、任务回执和最终回执 Schema。
- `.harness/scripts/tests/`：WaveRetire 临时 Git fixture、并发、partial recovery 和兼容回归。
- Harness 结构登记、脚本文档、架构文档、交接文档和知识概览。
- 不修改 backend、frontend、数据库或产品业务行为。

## 用户价值

完成态 Wave 的多个 Worktree 可以在保留审计分支的前提下被确定性回收，避免长期占用磁盘和 Git Worktree 注册，
同时保证任何证据漂移、并发 owner 变化或中断都不会造成不可解释删除。

## 验收标准

- [ ] `WaveRetire` 只接受 `done/completed` Story、`finalized` ledger 和完整 `checkpoint.waveFinalization`/M3 apply 证据。
- [ ] 外部用户批准、`ConfirmRetire`、预期 ledger SHA-256 和预期 wave receipt SHA-256 缺一不可。
- [ ] 遗留 retirement lock 只能在显式 recovery 确认及全部现存锁哈希绑定下接管。
- [ ] 普通/recovery owner 在每次 Git 删除、任务回执写入、最终回执写入和锁释放前重新验证；旧 owner 不能继续写入或删除 replacement lock。
- [ ] 首次删除前对全部任务完成全局预检；任一任务失败时不得删除任何 Worktree。
- [ ] partial retirement 后，主树允许集只增加当前 owner 锁和稳定任务前缀中已验证的回执，不允许目录级通配放行。
- [ ] Worktree 按 WavePlan 稳定任务顺序删除；每项删除后确认 Git 注册消失、目录不存在、保留分支仍指向 `baseCommit`，再写任务回执。
- [ ] 中断恢复只根据预期锁哈希、任务回执、Git Worktree 事实和保留分支完成；无法证明时失败关闭。
- [ ] 最终回执绑定完成态 state/events/backup、DAG、WavePlan、creation receipt、manifest、finalized ledger、wave receipt、M3 checkpoint、正式产物和有序任务回执。
- [ ] 重复调用仅在完整证据重新验证通过后复用最终回执。
- [ ] 回收不修改完成态 Story 的 phase、revision、checkpoint、业务文件或正式产物。
- [ ] 所有任务分支保留；不执行 branch delete、`prune`、merge、reset、clean、提交、推送、发布或部署。
- [ ] WaveRetire 专项测试、既有 Retire/BatchRetire、Wave、Worker、Story Runtime、结构和 Smoke 回归全部通过。

## 风险与边界

- 多 Worktree 删除不是 Git 级全局事务；通过全局预检、稳定前缀回执和显式恢复控制 partial retirement。
- `git worktree remove --force` 具有破坏性，因此生产入口必须保持外部批准与显式确认双重门禁。
- 不自动处理损坏、手工迁移或无法证明身份的 Worktree；这些情况失败关闭并要求人工调查。
- 不实现分支删除、自动 `prune`、真实 Agent、Fork-Join、自动 Git 交付、发布或部署。
- 无关未跟踪文件 `CODEX-CROSS-SESSION-HANDOFF.md` 不属于本 Story，不修改、不暂存。

## 知识与源码依据

- `docs/harness-m5d-wave-execution/DESIGN.md`
- `docs/harness-m5d-wave-execution/REPORT-C2.md`
- `docs/harness-m5c-worktree-lifecycle/DESIGN.md`
- `docs/harness-m5b3-batch-runtime/DESIGN.md`
- `.harness/scripts/lib/worktree-runtime.mjs`
- `.harness/scripts/lib/worktree-wave-execution-runtime.mjs`
- `.harness/scripts/lib/story-runtime.mjs`
- `.harness/scripts/tests/worktree-lifecycle-runtime.test.mjs`
- `.harness/scripts/tests/worktree-worker-runtime.test.mjs`
