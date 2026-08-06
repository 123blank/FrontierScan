# Harness Structure Checklist

This checklist tracks the project-structure adaptation toward the Harness Engineering architecture.

## Completed Structure

| Item | Evidence | Status |
| --- | --- | --- |
| Runtime state area | `.harness/states/` | Done |
| State schemas | `.harness/schemas/*.schema.json` | Done |
| Workflow definitions | `.harness/workflows/*.yaml` | Done |
| Output templates | `.harness/templates/*.md` | Done |
| Task DAG example template | `.harness/templates/task-dag.example.json` | Done |
| Report/output folders | `.harness/reports/`, `.harness/outputs/` | Done |
| Deterministic script area | `.harness/scripts/` | M2 状态、M3 Dispatcher、M4-B Mock Worker、M5-A 单 Worktree、M5-B1 Worker、M5-B2 受控集成、M5-C 生命周期回收、M5-B3-B 单 Worktree 串行批次、M5-D-A wave 规划和 M5-D-B 审批创建 Runtime 已实现 |
| Structure validation script | `.harness/scripts/validate-structure.ps1` | Done |
| State validation script | `.harness/scripts/validate-state.ps1` | E2E、Product 模板/状态与 `active-run` 指针只读校验已实现 |
| State runtime entry | `.harness/scripts/run-state.ps1` | M2 单 Story 状态推进、门禁、锁与恢复已实现 V1 |
| Story Dispatcher entry | `.harness/scripts/run-story.ps1` | M3 v1.0 单任务 `prepare/status/run-adapter/apply` 保持兼容；M5-B3-B 以 `prepare-batch/finalize-batch` 管理 v1.1 task-scoped dispatch，仍由既有 `apply` 唯一推进 phase |
| Mock Worker runtime | `.harness/scripts/lib/worker-runtime.mjs` | M4-B 显式 context、角色权限、2/8 MiB 限额、30 秒超时、result-last 和重试恢复已实现 |
| Worker policy registry | `.codex/agents/worker-policies.json` | 12 角色与 `agents.yaml` 名称、类别一一对应；无 shell、网络、状态、发布或 Git 能力 |
| Task DAG validation script | `.harness/scripts/validate-task-dag.ps1` | 共享 Node 契约覆盖 UTF-8、唯一 wave、依赖顺序、路径冲突和 globalChanges 串行 |
| KB query script | `.harness/scripts/kb-query.ps1` | Index-first query with Markdown fallback implemented V1 |
| KB generate script | `.harness/scripts/generate-kb.ps1` + `lib/generate-kb.mjs` + `lib/source-fingerprint.mjs` | Knowledge Reliability V2 plus M1.1 deterministic content fingerprints |
| KB regression tests | `.harness/scripts/tests/` | Source-fingerprint, generator, query, freshness, and status tests implemented |
| Diff context script | `.harness/scripts/collect-diff-context.ps1` | Basic read-only diff summary done |
| Test selection script | `.harness/scripts/select-tests.ps1` | Basic read-only path-based gate selection done |
| Knowledge input scan script | `.harness/scripts/scan-knowledge-inputs.ps1` | Basic read-only source structure scan done |
| Knowledge freshness script | `.harness/scripts/check-kb-freshness.ps1` | Backend/frontend/Common baseline, semantic, index, and content-fingerprint freshness check implemented |
| Worktree plan script | `.harness/scripts/plan-worktrees.ps1` | 旧版只读 DAG-to-worktree 计划保持兼容 |
| Worktree runtime | `.harness/scripts/run-worktree.ps1` + `lib/worktree-runtime.mjs` | 单任务 `Plan/Status/Create/Retire`、批次 `BatchPlan/BatchStatus/BatchCreate/BatchRetire` 与波次 `WavePlan/WaveStatus/WaveCreate` 已实现；WaveCreate 绑定计划哈希、波次锁、`lockId` fencing、部分恢复和完成回执，仍不执行 Worker、合并或回收 |
| Serial batch runtime | `.harness/scripts/lib/batch-runtime.mjs` + `lib/batch-base-contract.mjs` | M5-B3-B ledger、任务顺序、锁、继承快照、逐任务回执和受验证的 `dev` 基准契约已实现；不执行 Git 或状态推进 |
| Worktree Worker runtime | `.harness/scripts/lib/worktree-worker-runtime.mjs` | M5-B1 单任务路径保持兼容；M5-B3-B 仅在单个 batch Worktree 中逐项执行，验证前序集成快照、Git 对账、幂等和显式重试；无 CLI |
| Worktree integration runtime | `.harness/scripts/run-worktree-integration.ps1` + `lib/worktree-integration-runtime.mjs` | M5-B2 单任务 `Plan/Status/Apply` 保持兼容；M5-B3-B 批次路径按 taskId 与前序回执验证候选，仍受内容寻址、批准门禁、result-last 和逐文件恢复保护，不调用 M3 apply |
| Interface case derivation script | `.harness/scripts/derive-interface-cases.ps1` | Basic read-only acceptance-case draft done |
| Build plan script | `.harness/scripts/plan-build.ps1` | Basic read-only build/publish plan done |
| Delivery summary script | `.harness/scripts/summarize-delivery.ps1` | Basic read-only owned/unrelated change summary done |
| Harness smoke flow script | `.harness/scripts/smoke-harness-flow.ps1` | 非破坏性 M2 初始化、M3 prepare/apply、M4-B mock Worker 与 M5-B3-B public batch prepare/plan/status 协议临时闭环已实现；不是业务 E2E |
| Agent registry | `.codex/agents/agents.yaml` | 12 角色已映射受约束 Mock Worker 策略；真实 Agent 执行仍延期 |
| Project Skill area | `.codex/skills/` | Done |
| MVP Skill placeholders | `.codex/skills/frontier-*` | Replaced by basic guidance |
| State runner Skill | `.codex/skills/frontier-state-runner/` | M2 deterministic runtime guidance and executable entry implemented V1 |
| KB generate Skill | `.codex/skills/frontier-kb-generate/` | Implemented V1 workflow, generator, and M1.1 fingerprint contract |
| KB query Skill | `.codex/skills/frontier-kb-query/` | Implemented V1 index-first query with fingerprint freshness reporting |
| KB freshness Skill | `.codex/skills/frontier-kb-refresh-check/` | Implemented M1.1 content-fingerprint freshness workflow |
| Requirement breakdown Skill | `.codex/skills/frontier-requirement-breakdown/` | Basic breakdown guidance done |
| Task DAG planner Skill | `.codex/skills/frontier-task-dag-planner/` | Basic DAG planning guidance done |
| Code review gate Skill | `.codex/skills/frontier-code-review-gate/` | Basic review gate guidance done |
| Test gate Skill | `.codex/skills/frontier-test-gate/` | Basic test selection guidance done |
| Worktree orchestrator Skill | `.codex/skills/frontier-worktree-orchestrator/` | Basic isolation planning guidance done |
| Interface verifier Skill | `.codex/skills/frontier-interface-verifier/` | Basic verification guidance done |
| Build/publish Skill | `.codex/skills/frontier-build-publish/` | Basic approval-gated build guidance done |
| Git delivery Skill | `.codex/skills/frontier-git-delivery/` | Basic approval-gated delivery guidance done |
| Extended Skill placeholders | None | Done |
| Skill registry | `.codex/skills/skill-registry.yaml` | Done |
| Knowledge base root | `llm-knowledge/` | Done |
| Backend knowledge registry | `llm-knowledge/backend/meta.yaml` | 7 modules; baseline/index fresh, semantic pending; complete `source_fingerprint` and source coverage recorded |
| Frontend knowledge registry | `llm-knowledge/frontend/meta.yaml` | 7 modules; baseline/index fresh, semantic pending; complete `source_fingerprint` and source coverage recorded |
| Common knowledge registry | `llm-knowledge/common/` + `llm-knowledge/index/manifest.json` | Common knowledge is indexed and has complete `source_fingerprint`; baseline/index fresh, semantic pending |
| Local knowledge index | `llm-knowledge/index/` | Generated/curated chunks and fingerprint manifest available; current count is reported by the generator and overview |
| Quality gate knowledge | `llm-knowledge/common/conventions/quality-gates.md` | Basic guidance done |
| Execution/verification knowledge | `llm-knowledge/common/conventions/execution-verification.md` | Basic guidance done |
| Delivery knowledge | `llm-knowledge/common/conventions/delivery.md` | Basic guidance done |
| Human architecture doc | `docs/harness-architecture-adaptation.md` | Done |
| M0 + M1 business plan/report | `docs/harness-m0-m1/PLAN.md`, `docs/harness-m0-m1/REPORT.md` | Done |
| M1.1 business plan/report | `docs/harness-m1-1-source-fingerprint/PLAN.md`, `docs/harness-m1-1-source-fingerprint/REPORT.md` | Done |
| M2 state runtime plan/report | `docs/harness-m2-state-runtime/`, `.harness/scripts/run-state.ps1` | Implemented V1 |
| M3 Dispatcher plan/report | `docs/harness-m3-agent-dispatcher/`, `.harness/scripts/run-story.ps1` | Implemented V1 |
| M4-A runtime compatibility plan/report | `docs/harness-m4-runtime-compatibility/` | Windows `codex-cli 0.144.1` 连续三次发现 13 个项目 Skill，仓库外负向对照为 0 |
| M4-B constrained Worker plan/report | `docs/harness-m4-worker-runtime/` | Mock provider 的 task/result、权限、超时、原子写入与恢复闭环已实现 |
| M5-A single Worktree plan/report | `docs/harness-m5-worktree-orchestration/` | 单 Worktree 的 DAG 安全契约、计划、状态和批准创建已实现 |
| M5-B1 Worktree Worker plan/report | `docs/harness-m5b-worktree-worker/` | 已创建单 Worktree 的受约束 Worker 执行、输入快照和分级结果回收已实现 |
| M5-B2 Worktree integration plan/report | `docs/harness-m5b2-worktree-integration/` | 单 Worktree 业务候选的内容寻址计划、事实状态、批准集成和 M3 显式交接已实现 |
| M5-C Worktree lifecycle plan/report | `docs/harness-m5c-worktree-lifecycle/` | 已完成 M5-B2 Worktree 的证据校验、双重确认、强制移除、回执和中断恢复已实现 |
| M5-B3 multi-task protocol plan/report | `docs/harness-m5b3-multi-task-protocol/` | 已完成单 Worktree 串行多任务协议兼容性验证；Runtime 实现延期到 M5-B3-B |
| M5-B3-B serial batch runtime plan/report | `docs/harness-m5b3-batch-runtime/` | 已完成单 Worktree 串行多任务 Runtime：v1.1 task-scoped dispatch、batch ledger、逐项 Worker/集成、由 `finalizationArtifacts` 固定的正式阶段工件证据链、一次 M3 apply 与 batch Retire 仅在临时 Git fixture 验证；收尾绑定以独占锁失败关闭并支持受控重试 |
| M5-D-A multi-Worktree wave plan/report | `docs/harness-m5d-multi-worktree-wave/` | 已实现同 wave 多 Worktree 的确定性只读计划与 Git 事实状态；不提供创建、并行 Worker、合并或删除 |
| M5-D-B wave create plan/report | `docs/harness-m5d-wave-create/` | 已实现计划哈希审批门控、多 Worktree 顺序创建、波次锁恢复、`lockId` fencing、部分失败恢复和完成回执；正式仓库未执行创建 |

## Deferred Functional Work

- 在 CLI 升级或把 IDE/桌面端纳入目标时重新验证项目 Skill 加载路径；当前 CLI 保留 `.codex/skills`。
- 接入真实 Agent provider 前，使用 Codex custom agent 和 sandbox 复验操作系统级权限边界；当前同进程 mock provider 不是安全沙箱。
- M5-D-B 已实现审批门控创建；同 wave Worker 并行、跨 Worktree 结果汇总/集成和 Fork-Join 继续延期。
- 多 batch/多 Worktree 回收、分支删除、`git worktree prune`、自动清理和 Worktree 复用继续需要独立方案与明确批准。
- Implement real interface execution, publish, and git delivery behavior only after quality gates are stable and approved.

## Safety Notes

- Preserve unrelated working-tree files; do not delete or stage them as part of Harness work.
- `run-worktree.ps1 Create/BatchCreate` 只能在用户逐次批准并显式传入 `-ConfirmCreate` 后创建一个 Worktree；`WaveCreate` 必须逐 wave 批准并绑定 `-ExpectedPlanSha256`，遗留锁恢复还必须绑定全部现存锁哈希；`Retire/BatchRetire` 只能在已完成目标 Story、用户逐次批准并显式传入 `-ConfirmRetire` 后回收它。其他脚本不应隐式调用这些命令。
- Publish, commit, push, deployment, and destructive git scripts are not implemented.

## Structure Validation

Run:

```powershell
.\.harness\scripts\validate-structure.ps1
```

The script is read-only and checks required Harness files, JSON parseability, and Skill frontmatter.

Current verified structure: 29 directories, 188 required files, and 13 Skill files.

## Knowledge Query

Run:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "Spring Boot" -Mode knowledge-qa -Area backend
```

The script is read-only and searches `llm-knowledge/` for relevant knowledge snippets.
