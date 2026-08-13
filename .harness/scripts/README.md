# Harness 脚本

本目录用于存放确定性工作流脚本。

规划脚本：

```text
validate-state.ps1
run-state.ps1
run-story.ps1
run-delivery.ps1
run-worktree.ps1
run-worktree-integration.ps1
validate-task-dag.ps1
select-tests.ps1
collect-diff-context.ps1
scan-knowledge-inputs.ps1
check-kb-freshness.ps1
generate-kb.ps1
plan-worktrees.ps1
derive-interface-cases.ps1
plan-build.ps1
summarize-delivery.ps1
smoke-harness-flow.ps1
```

当前状态：

- `validate-state.ps1`、`validate-task-dag.ps1`、`validate-structure.ps1`、`kb-query.ps1`、`select-tests.ps1`、`collect-diff-context.ps1`、`scan-knowledge-inputs.ps1`、`check-kb-freshness.ps1`、`plan-worktrees.ps1`、`derive-interface-cases.ps1`、`plan-build.ps1`、`summarize-delivery.ps1` 和 `smoke-harness-flow.ps1` 已实现为只读辅助脚本；状态校验覆盖 E2E、Product 和 `active-run` 指针。
- `run-state.ps1` 是单 Story 确定性状态运行时入口，支持 `init/status/validate/record/next/block/resume/complete`。更新命令使用独占锁、原子 JSON 写入和 JSONL 事务事件；`status/validate` 保持只读。
- `run-delivery.ps1` 是 M7-A4 交付事实入口，支持 `PrepareManifest/Summarize/Record`。它只读取 Git 或写入 Harness 控制证据，不执行 `git add/commit/push`；`PrepareManifest` 在 Story 写锁内生成 owned manifest，`Record` 在 completed State 外追加版本化交付回执。
- `lib/delivery-runtime.mjs` 从 baseline、`implementation.actualFiles`、DAG prediction 和当前 Git 净变化推导 owned、预测外与 unrelated；State 模式不再按固定路径前缀认领业务文件。`summarize-delivery.ps1` 无 `StateFile` 时保留旧兼容模式，有 `StateFile` 时使用该 Runtime。
- `lib/record-contract.mjs` 为 State v2 手工 evidence 与 Story 自动 evidence 提供共享语义身份；相同事实重放不增加 revision、events 或 records。
- 状态运行时核心与回归测试分别位于 `lib/state-runtime.mjs` 和 `tests/state-runtime.test.mjs`。
- `run-story.ps1` 是 M3 单 Story文件式 Dispatcher 入口，支持 `prepare/status/run-adapter/apply`、M5-B3-B 的 `prepare-batch/finalize-batch`，以及 M5-D 的 `prepare-wave/finalize-wave`。`prepare-wave` 生成 v1.2 task/checkpoint、implementation owner 与 execution ledger；`finalize-wave` 在全部任务完成受控集成后生成正式 v1.0 phase 产物和 `checkpoint.waveFinalization`。`apply` 仍是唯一状态推进入口。
- Dispatcher 的 task、result、checkpoint、阶段产物和命令证据位于 `.harness/runs/<storyId>/phases/`；核心与回归测试分别位于 `lib/story-runtime.mjs` 和 `tests/story-runtime.test.mjs`。
- `lib/worker-runtime.mjs` 是 M4-B 受约束 Mock Worker 内部模块，不提供 CLI。它读取 M3 task、按 `.codex/agents/worker-policies.json` 限制显式 context 和候选写入，使用测试注入 provider，并在全量校验后最后写入 `result.json`；v1.2 使用调用方已验证的 attempt result 路径，并在每个候选与 result 原子替换前调用 owner guard。
- `lib/dispatch-contract.mjs` 是 M3 与 M4-B 共用的 task/result 结构和 record 状态校验：v1.0 保持 phase 级单任务严格字段集合；v1.1 绑定 `batchId/taskId/taskRoot`；v1.2 绑定 `runId/waveId/waveIndex/taskId/taskRoot`。M3 继续负责 workflow、证据及状态语义。
- M4-B 不启动真实 Agent，不接受任意 shell/网络/Git/发布/状态能力，也不执行发布、部署、PR 或 Worktree 操作。
- `run-worktree.ps1` 是 Worktree 生命周期受控入口，支持单任务 `Plan/Status/Create/Retire`、批次 `BatchPlan/BatchStatus/BatchCreate/BatchRetire`，以及波次 `WavePlan/WaveStatus/WaveCreate`。核心 `lib/worktree-runtime.mjs` 固化 `dev` SHA、校验绑定 DAG、从 Git 事实对账、使用原子 JSON 和独占锁。`WaveCreate` 只消费既有计划，要求 `-ConfirmWaveCreate` 与精确 `-ExpectedPlanSha256`，按稳定顺序创建或挂载缺失项；同一 run/Story 的 wave 共享创建/恢复锁，以 `lockId` fencing，遗留锁恢复还必须绑定全部现存锁哈希。恢复在实际替换前重新比较完整锁集合，替换后必须匹配本次生成的 owner；恢复异常保留锁，只有完成回执成功后才清理。部分失败保留已创建 Worktree，只有 Git 事实为 `ready` 时才写完成回执。动态锁快照仅在 `WaveStatus` 命令结果顶层返回，不污染稳定状态文件；复用 `WavePlan` 和普通 `WaveStatus` 只返回动态事实，不持久化状态。波次入口不启动 Worker，不合并、回收或删除 Worktree。批次命令只能从 serial batch ledger 派生身份、路径、分支和基准，不接受任意任务、路径或基准输入。`Create/BatchCreate` 需要用户批准与 `-ConfirmCreate`；`Retire/BatchRetire` 只接受已完成目标 Story，并在用户批准与 `-ConfirmRetire` 后验证相应证据、主树和 Worktree 变更集，再安全移除 Worktree。Retire 保留分支，不执行 `prune`、合并或状态推进。
- `lib/batch-runtime.mjs` 只管理 serial batch ledger、任务顺序、独占锁、继承快照和逐任务证据状态，不执行 Git，也不调用 M2/M3。`lib/batch-base-contract.mjs` 是唯一允许解析并验证批次 `dev` 基准的内部契约；`lib/batch-finalization-contract.mjs` 固定正式 implementation task/result/notes 的路径与 SHA-256，并由 batch receipt、ledger 和 checkpoint 形成可复核的证据链。`finalize-batch` 的 checkpoint binding 使用独占锁，重叠调用失败关闭，首个完成后可显式重试。
- `lib/worktree-worker-runtime.mjs` 是 M5-B1 内部编排模块，不提供 CLI。单任务和 v1.1 批次路径保持原有行为；v1.2 分支只执行当前 running attempt，在独立 Wave Worktree 中写候选，并把 result/receipt 收集到不可变 attempt 目录。所有写点重新验证 attempt owner，失败只更新 execution ledger，不调用 M3 `apply`。
- `lib/worktree-wave-execution-runtime.mjs` 是 M5-D-C1/C2 内部协调模块，不提供真实 Agent CLI。它管理 execution ledger、attempt、并行 Worker、manifest freeze、integration/recovery owner、主树串行集成、partial recovery 和 wave finalization。成功事实只来自 result/receipt/Git/ledger 磁盘证据。
- `run-worktree-integration.ps1` 是 M5-B2 业务候选受控集成入口，支持 `Plan/Status/Apply`。单任务路径保持兼容；批次路径必须传入 `BatchFile` 与 ledger 内 taskId，并以先前集成回执和当前主树哈希为基线。核心 `lib/worktree-integration-runtime.mjs` 以 SHA-256 bundle 固化候选，要求用户批准与 `-ConfirmApply` 后才按业务文件、phase output、正式 result、receipt 的顺序写入。Runtime 不调用 M3 `apply`，不执行 Git 写操作、merge/remove 或 Worktree 清理。
- `lib/task-dag-contract.mjs` 是 DAG 校验和 Worktree Runtime 共用契约，覆盖唯一 wave、依赖顺序、精确/`/**` 路径范围冲突和 `globalChanges` 串行。
- `generate-kb.ps1` 是可写的知识生成器。它只写入 `llm-knowledge/`，支持试运行，保留 `custom/` 说明，并在缺少 `OPENAI_API_KEY` 时降级 OpenAI 语义增强。
- `generate-kb.ps1 -Area backend -Module article -Mode baseline` 可以刷新单个模块，同时保留无关文档、元数据、日志和索引分块。
- `check-kb-freshness.ps1 -WriteRefreshTask` 会为过期区域或模块显式写入 `.harness/outputs/kb-refresh-task.json`，但不会执行该任务。
- 只有当区域内每个变更源文件都属于同一受支持模块时，才会生成模块级刷新任务；共享源文件或区域根目录文件发生变化时，会回退为区域级刷新。
- `.harness/scripts/lib/source-fingerprint.mjs` 是生成、查询和新鲜度检查共用的 SHA-256 新鲜度引擎。源指纹是权威依据，`git_hash` 仅用于审计。
- 生成器采用失败关闭策略处理摄取失败：读取源文件或共享资源失败时保留覆盖率诊断，并将受影响文档和索引指纹标记为 `partial`。
- 缺少旧版指纹时需要执行一次基线刷新。公共源文件变化通过 `generate-kb.ps1 -Area all -Mode baseline` 修复。
- `generate-kb.ps1 -WithEmbeddings` 为显式启用项，使用 `EMBEDDING_API_KEY`（未配置时回退到 `DASHSCOPE_API_KEY`），并支持通过 `EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL` 覆盖默认的阿里百炼端点与 `text-embedding-v4` 模型；`OPENAI_EMBEDDING_MODEL` 仅作为旧配置兼容项。缺少密钥或 API 调用失败时会报告 `pending` 或 `failed`，但不会阻塞基线文档和本地索引生成。
- 回归测试位于 `tests/source-fingerprint.test.mjs`、`tests/harness-status.test.mjs`、`tests/generate-kb.test.mjs`、`tests/kb-query.test.ps1`、`tests/kb-freshness.test.ps1`、`tests/task-dag.test.ps1`、`tests/worktree-runtime.test.mjs`、`tests/worktree-wave-runtime.test.mjs`、`tests/worktree-wave-execution-runtime.test.mjs`、`tests/worktree-worker-runtime.test.mjs`、`tests/worktree-integration-runtime.test.mjs`、`tests/worktree-lifecycle-runtime.test.mjs`、`tests/batch-runtime.test.mjs` 和 `tests/serial-batch-runtime.test.mjs`。DAG 测试覆盖 UTF-8、wave/依赖/冲突；Worktree 与批次测试仅在临时 Git 仓库覆盖计划、审批门禁、真实创建、逐任务 Worker/集成、单次状态推进、回收、幂等、锁 fencing 和中断恢复。M5-D-C1 用 barrier 验证多 Worker 真实并发，并覆盖 partial、retry、完整/blocked/孤儿恢复和五个写点 owner fencing；正式仓库未执行 Worker 或 Worktree 写操作。
- 禁止在此处放置业务逻辑。
- 脚本应从仓库读取数据，并且只有在文档明确说明时才能写入 `.harness/` 产物。

## WaveRetire

- PowerShell 入口：`run-worktree.ps1 -Command WaveRetire`。
- 必需参数：`StateFile`、`TaskDagFile`、`WaveIndex`、`ExpectedWaveLedgerSha256`、
  `ExpectedWaveReceiptSha256`、`ConfirmRetire`。
- recovery 参数：`ExpectedRetirementLockSha256`、`ExpectedRetirementRecoveryLockSha256`、
  `ConfirmWaveRetireLockRecovery`。
- 命令拒绝调用方提供 `TaskId`、`BaseRef`、`ConfirmCreate` 或其他外部任务身份；所有删除目标均由完成态
  Wave 证据派生。
- 删除前执行全局零删除预检；删除期间每个 Git、task receipt、final receipt 和锁释放写点前均重验 owner。
- 成功只移除 Worktree 注册与目录，保留任务分支；不执行 `prune`、分支删除、状态推进、提交、推送或发布。
- 正式仓库不执行真实 WaveRetire；真实 Git 副作用只在临时测试仓库覆盖。
