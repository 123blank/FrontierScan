# Harness 脚本

本目录用于存放确定性工作流脚本。

规划脚本：

```text
validate-state.ps1
run-state.ps1
run-story.ps1
run-worktree.ps1
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
- 状态运行时核心与回归测试分别位于 `lib/state-runtime.mjs` 和 `tests/state-runtime.test.mjs`。
- `run-story.ps1` 是 M3 单 Story 文件式 Dispatcher 入口，支持 `prepare/status/run-adapter/apply`。`prepare` 按 M2 当前 phase 生成结构化任务；`run-adapter` 只运行代码内固定本地命令，stdout 和 stderr 各使用 16 MiB 有界缓冲，并将证据 SHA-256 写入 checkpoint；`no-build-required` 会确认 backend/frontend 不存在 Git 差异；`apply` 复核证据文件、哈希和派发身份后，只通过 M2 推进、阻塞或完成状态，并可对账推进后尚未写完的 checkpoint。
- Dispatcher 的 task、result、checkpoint、阶段产物和命令证据位于 `.harness/runs/<storyId>/phases/`；核心与回归测试分别位于 `lib/story-runtime.mjs` 和 `tests/story-runtime.test.mjs`。
- `lib/worker-runtime.mjs` 是 M4-B 受约束 Mock Worker 内部模块，不提供 CLI。它读取 M3 task、按 `.codex/agents/worker-policies.json` 限制显式 context 和候选写入，使用测试注入 provider，并在全量校验后最后写入 `result.json`；测试位于 `tests/worker-runtime.test.mjs`。
- `lib/dispatch-contract.mjs` 是 M3 与 M4-B 共用的 task/result Schema `1.0` 结构和 record 状态校验，M3 继续负责 workflow、证据及状态语义。
- M4-B 不启动真实 Agent，不接受任意 shell/网络/Git/发布/状态能力，也不执行发布、部署、PR 或 Worktree 操作。
- `run-worktree.ps1` 是 M5-A 单 Worktree 受控入口，支持 `Plan/Status/Create`。核心 `lib/worktree-runtime.mjs` 固化 `dev` SHA、校验绑定 DAG、从 Git 事实对账、使用原子 JSON 和独占锁，并要求用户批准与 `-ConfirmCreate`；不提供 merge/remove、Worker 启动或状态推进。
- `lib/worktree-worker-runtime.mjs` 是 M5-B1 内部编排模块，不提供 CLI。它重新核验 M5-A 已创建 Worktree，复制当前 run Harness 输入、复用 base 上下文并调用 M4-B Worker；仅 phase output 时返回 `ready-for-apply`，存在业务写入时只生成独立证据并返回 `ready-for-integration`，两者都不调用 M3 `apply`。
- `lib/task-dag-contract.mjs` 是 DAG 校验和 Worktree Runtime 共用契约，覆盖唯一 wave、依赖顺序、精确/`/**` 路径范围冲突和 `globalChanges` 串行。
- `generate-kb.ps1` 是可写的知识生成器。它只写入 `llm-knowledge/`，支持试运行，保留 `custom/` 说明，并在缺少 `OPENAI_API_KEY` 时降级 OpenAI 语义增强。
- `generate-kb.ps1 -Area backend -Module article -Mode baseline` 可以刷新单个模块，同时保留无关文档、元数据、日志和索引分块。
- `check-kb-freshness.ps1 -WriteRefreshTask` 会为过期区域或模块显式写入 `.harness/outputs/kb-refresh-task.json`，但不会执行该任务。
- 只有当区域内每个变更源文件都属于同一受支持模块时，才会生成模块级刷新任务；共享源文件或区域根目录文件发生变化时，会回退为区域级刷新。
- `.harness/scripts/lib/source-fingerprint.mjs` 是生成、查询和新鲜度检查共用的 SHA-256 新鲜度引擎。源指纹是权威依据，`git_hash` 仅用于审计。
- 生成器采用失败关闭策略处理摄取失败：读取源文件或共享资源失败时保留覆盖率诊断，并将受影响文档和索引指纹标记为 `partial`。
- 缺少旧版指纹时需要执行一次基线刷新。公共源文件变化通过 `generate-kb.ps1 -Area all -Mode baseline` 修复。
- `generate-kb.ps1 -WithEmbeddings` 为显式启用项，使用 `EMBEDDING_API_KEY`（未配置时回退到 `DASHSCOPE_API_KEY`），并支持通过 `EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL` 覆盖默认的阿里百炼端点与 `text-embedding-v4` 模型；`OPENAI_EMBEDDING_MODEL` 仅作为旧配置兼容项。缺少密钥或 API 调用失败时会报告 `pending` 或 `failed`，但不会阻塞基线文档和本地索引生成。
- 回归测试位于 `tests/source-fingerprint.test.mjs`、`tests/harness-status.test.mjs`、`tests/generate-kb.test.mjs`、`tests/kb-query.test.ps1`、`tests/kb-freshness.test.ps1`、`tests/task-dag.test.ps1`、`tests/worktree-runtime.test.mjs` 和 `tests/worktree-worker-runtime.test.mjs`。DAG 测试覆盖 UTF-8、wave/依赖/冲突；Worktree 测试在临时 Git 仓库覆盖计划、门禁、真实创建、Worker 执行、分级回收、幂等和恢复。
- 禁止在此处放置业务逻辑。
- 脚本应从仓库读取数据，并且只有在文档明确说明时才能写入 `.harness/` 产物。
