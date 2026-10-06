# M5-D-C2 Wave 集成与阶段收尾实施计划

> **执行要求：** 当前会话串行实施。每项生产行为必须先增加直接失败的测试，再做最小实现并运行直接回归。

**目标：** 为单个完整 implementation wave 增加 manifest 原子冻结、主工作树确定性串行集成、显式恢复、`finalize-wave` 和 M3 `apply` 闭环。

**架构：** 扩展现有 `worktree-wave-execution-runtime.mjs`，由同一 Wave Execution Ledger 保存 freeze、integration 和 finalization 事实；复用现有路径、Git、候选和原子写入能力，不复制 Worker。`story-runtime.mjs` 只负责正式 phase 产物、checkpoint 绑定和 M3 apply 门禁。

**技术栈：** Node.js ESM、PowerShell、JSON Schema、Node Test Runner、临时 Git fixture。

---

## 文件职责

| 文件 | 职责 |
| --- | --- |
| `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | manifest freeze、integration owner、主树串行集成、恢复和 wave receipt |
| `.harness/scripts/lib/story-runtime.mjs` | `finalize-wave`、正式 phase 产物、checkpoint 绑定和 M3 apply 校验 |
| `.harness/scripts/run-story.ps1` | 增加 `finalize-wave` 命令参数门禁 |
| `.harness/scripts/tests/worktree-wave-execution-runtime.test.mjs` | freeze、集成、partial recovery 和 owner fencing 的临时 Git fixture |
| `.harness/scripts/tests/story-runtime.test.mjs` | finalize、apply、历史 revision 恢复和 legacy 路由回归 |
| `.harness/schemas/worktree-wave-*.schema.json` | manifest、锁、integration receipt、wave receipt 与 finalized ledger 契约 |
| `.harness/structure-manifest.yaml` 及说明文档 | 登记 C2 资产、边界与验证证据 |

## T1：扩展 Ledger 状态和证据契约

- [ ] 在 `worktree-wave-execution-runtime.test.mjs` 增加 RED：`freezing`、`integration-frozen`、`integrating`、`partial-integration`、`integrated`、`finalized` 必须由任务与绑定证据确定性派生。
- [ ] 运行 `node .\.harness\scripts\tests\worktree-wave-execution-runtime.test.mjs`，确认因 C2 状态尚未实现而失败。
- [ ] 最小扩展 ledger 校验、状态派生和 Schema；不改变 C1 `prepared/executing/partial/ready-for-integration` 行为。
- [ ] 重跑专项测试与 `node .\.harness\scripts\tests\story-runtime.test.mjs`，确认 GREEN。

## T2：实现 manifest 原子冻结与显式恢复

- [ ] 增加 RED：未全 ready、execution receipt/候选/Worktree 漂移、并发 freeze、遗留 preparation lock 和 manifest 已存在但字段漂移均失败关闭。
- [ ] 增加 RED：合法 freeze 生成确定性 manifest，绑定全部任务与候选证据；`recover-freeze` 只在显式确认及当前 lock/ledger SHA-256 下完成或恢复。
- [ ] 最小实现 `freeze-integration`、`recover-freeze`、`manifest-preparation.lock` 和 manifest Schema。
- [ ] 验证 manifest 出现后 C1 claim、retry、recover 与 Worker 写入 guard 全部关闭。

## T3：实现 integration owner 与主树串行集成

- [ ] 增加 RED：普通 owner、recovery owner、锁替换窗口和每个写点的 fencing。
- [ ] 增加 RED：路径大小写冲突、父子冲突、超出 `predictedFiles`、HEAD 漂移、范围外业务变化和后续任务候选提前出现均拒绝。
- [ ] 最小实现 `integrate-wave` 与 `recover-integration`，按 WavePlan 稳定顺序逐任务原子写入候选、写 integration receipt、更新 ledger。
- [ ] 验证完整成功后所有任务为 `integrated`，integration owner 保留给 finalize。

## T4：实现 partial integration 恢复

- [ ] 增加 RED：T1 已成功、T2 写入前或写入后中断时，不得回滚或覆盖 T1。
- [ ] 增加 RED：重试必须重验已集成前缀，前缀漂移或外部业务修改时保留现状并拒绝继续。
- [ ] 最小实现从首个未集成任务继续，匹配已有 integration receipt 时幂等复用。
- [ ] 重跑专项测试，确认不存在自动冲突解决、reset、clean 或主树回滚。

## T5：实现 `finalize-wave` 与 M3 apply

- [ ] 在 `story-runtime.test.mjs` 增加 RED：未全部 integrated、owner/manifest 漂移、预存 phase artifact 和并发 finalize 均失败关闭。
- [ ] 增加 RED：合法 finalize 生成 v1.0 `task.json/result.json`、`implementation-notes.md`、wave receipt、finalized ledger 和 `checkpoint.waveFinalization`，但 state 保持 implementation。
- [ ] 最小实现 `finalize-wave` 与 PowerShell 参数门禁；写入顺序固定并可幂等复用。
- [ ] 增加 RED/GREEN：M3 apply 重验全部绑定，覆盖推进前中断、推进后中断、历史 revision 恢复和重复 apply。

## T6：结构登记、文档和最终回归

- [ ] 更新 `.harness/structure-manifest.yaml`、Harness README、脚本说明、架构适配、检查清单、AI 交接和知识概览。
- [ ] 运行 C2 专项、C1/M3/Worker/Worktree 直接回归。
- [ ] 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1`。
- [ ] 运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1`。
- [ ] 记录测试、审核、构建规划和接口验证证据；不执行提交、推送、PR、发布或部署。

## 自检

- 设计覆盖：第 14-22 节均有对应任务。
- 占位符检查：无 `TBD`、`TODO` 或未定义实现步骤。
- 类型一致性：统一使用 `integrationManifest*`、`integrationReceipt*`、`waveReceipt*` 和 `checkpoint.waveFinalization`。
- 简化边界：只扩展现有 wave runtime 与 story runtime，不新增通用框架或第三套 Worker。
