# Harness 结构清单

本清单跟踪项目向 Harness Engineering 架构演进时的结构资产、实现状态和延期事项。

## 已完成结构

| 项目 | 证据 | 状态 |
| --- | --- | --- |
| Runtime 状态目录 | `.harness/states/` | 已完成 |
| State Schema | `.harness/schemas/*.schema.json` | 已完成 |
| 工作流定义 | `.harness/workflows/*.yaml` | 已完成 |
| 输出模板 | `.harness/templates/*.md` | 已完成 |
| Task DAG 示例模板 | `.harness/templates/task-dag.example.json` | 已完成 |
| 报告与输出目录 | `.harness/reports/`、`.harness/outputs/` | 已完成 |
| Deterministic script area | `.harness/scripts/` | M2 状态、M3 Dispatcher、M4-B Mock Worker、M5-A 单 Worktree、M5-B1 Worker、M5-B2 受控集成、M5-C 生命周期回收、M5-B3-B 串行批次、M5-D-A/B wave 规划创建和 M5-D-C1/C2 执行集成 Runtime 已实现 |
| 结构校验脚本 | `.harness/scripts/validate-structure.ps1` | 已完成 |
| State validation script | `.harness/scripts/validate-state.ps1` + `lib/state-contract.mjs` | PowerShell 薄入口与单一 Node 契约已支持 E2E v1/v2、Product State 和 `active-run` 指针 |
| State runtime entry | `.harness/scripts/run-state.ps1` | M7-A1 已实现新 Story 默认 v2、v1 拒写、Git baseline、版本化 workflow、`activeBlock` 和 `delivery-preparation -> done` |
| Story Dispatcher entry | `.harness/scripts/run-story.ps1` | v1.0 单任务与 v1.1 serial batch 保持兼容；M5-D `prepare-wave/finalize-wave` 完成 v1.2 Wave 准备、正式 phase 产物和 M3 apply 绑定 |
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
| Worktree runtime | `.harness/scripts/run-worktree.ps1` + `lib/worktree-runtime.mjs` | 单任务 `Plan/Status/Create/Retire`、批次 `BatchPlan/BatchStatus/BatchCreate/BatchRetire` 与波次 `WavePlan/WaveStatus/WaveCreate/WaveRetire` 已实现；WaveRetire 仅回收完成态 finalized Wave 的 Worktree 注册和目录，保留分支并支持审批门控、双锁恢复、回执前缀和 owner fencing |
| Serial batch runtime | `.harness/scripts/lib/batch-runtime.mjs` + `lib/batch-base-contract.mjs` | M5-B3-B ledger、任务顺序、锁、继承快照、逐任务回执和受验证的 `dev` 基准契约已实现；不执行 Git 或状态推进 |
| Worktree Worker runtime | `.harness/scripts/lib/worktree-worker-runtime.mjs` | v1.0/v1.1 路径保持兼容；v1.2 在每任务独立 Worktree 中运行当前 attempt，收集不可变 result/receipt，并在五类副作用前执行 owner fencing；无 CLI |
| Wave execution runtime | `.harness/scripts/lib/worktree-wave-execution-runtime.mjs` | M5-D-C1/C2 execution ledger、并行 Worker、manifest freeze、串行集成、partial recovery、wave receipt 和 finalization 已实现 |
| Worktree integration runtime | `.harness/scripts/run-worktree-integration.ps1` + `lib/worktree-integration-runtime.mjs` | M5-B2 单任务 `Plan/Status/Apply` 保持兼容；M5-B3-B 批次路径按 taskId 与前序回执验证候选，仍受内容寻址、批准门禁、result-last 和逐文件恢复保护，不调用 M3 apply |
| Interface case derivation script | `.harness/scripts/derive-interface-cases.ps1` | Basic read-only acceptance-case draft done |
| Build plan script | `.harness/scripts/plan-build.ps1` | Basic read-only build/publish plan done |
| Delivery summary script | `.harness/scripts/summarize-delivery.ps1` | Basic read-only owned/unrelated change summary done |
| Harness smoke flow script | `.harness/scripts/smoke-harness-flow.ps1` | 非破坏性 M2 初始化、M3 prepare/apply、M4-B mock Worker 与 M5-B3-B public batch prepare/plan/status 协议临时闭环已实现；不是业务 E2E |
| Agent registry | `.codex/agents/agents.yaml` | 12 角色已映射受约束 Mock Worker 策略；真实 Agent 执行仍延期 |
| 项目 Skill 目录 | `.codex/skills/` | 已完成 |
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
| 扩展 Skill 占位 | 无 | 已完成 |
| Skill 注册表 | `.codex/skills/skill-registry.yaml` | 已完成 |
| 知识库根目录 | `llm-knowledge/` | 已完成 |
| Backend knowledge registry | `llm-knowledge/backend/meta.yaml` | 7 modules; baseline/index fresh, semantic pending; complete `source_fingerprint` and source coverage recorded |
| Frontend knowledge registry | `llm-knowledge/frontend/meta.yaml` | 7 modules; baseline/index fresh, semantic pending; complete `source_fingerprint` and source coverage recorded |
| Common knowledge registry | `llm-knowledge/common/` + `llm-knowledge/index/manifest.json` | Common knowledge is indexed and has complete `source_fingerprint`; baseline/index fresh, semantic pending |
| Local knowledge index | `llm-knowledge/index/` | Generated/curated chunks and fingerprint manifest available; current count is reported by the generator and overview |
| Quality gate knowledge | `llm-knowledge/common/conventions/quality-gates.md` | Basic guidance done |
| Execution/verification knowledge | `llm-knowledge/common/conventions/execution-verification.md` | Basic guidance done |
| Delivery knowledge | `llm-knowledge/common/conventions/delivery.md` | Basic guidance done |
| 人类可读架构文档 | `docs/harness-architecture-adaptation.md` | 已完成 |
| M0 + M1 计划与报告 | `docs/harness-m0-m1/PLAN.md`、`docs/harness-m0-m1/REPORT.md` | 已完成 |
| M1.1 计划与报告 | `docs/harness-m1-1-source-fingerprint/PLAN.md`、`docs/harness-m1-1-source-fingerprint/REPORT.md` | 已完成 |
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
| M5-D-C1/C2 wave execution design/plan/report | `docs/harness-m5d-wave-execution/` | 已实现单个完整 implementation wave 的并行执行、manifest freeze、主树串行集成、partial recovery、finalize-wave 和 M3 apply |
| M5-D-D wave retirement design/plan/report | `docs/harness-m5d-wave-retire/` | 已实现完整 M3/Wave 证据绑定、完成态记录哈希、双锁恢复、有序 task receipt 前缀、写点 fencing、Git 后验、分支保留和最终回执 |
| M7-M12 总体路线设计与计划 | `docs/harness-m7-m12-roadmap/DESIGN.md`、`docs/harness-m7-m12-roadmap/PLAN.md` | 路线文档已完成；未实现任何 M7-M12 Runtime、Schema、Provider、Worktree、Docker 或 Git 自动化能力 |
| M7-A1 State v2 专项设计、计划与报告 | `docs/harness-m7a1-state-v2/` | 已实施并通过 fixture 验证；真实 Story 验收统一延期到 M7-D |

## 延期功能工作

- 在 CLI 升级或把 IDE/桌面端纳入目标时重新验证项目 Skill 加载路径；当前 CLI 保留 `.codex/skills`。
- 接入真实 Agent provider 前，使用 Codex custom agent 和 sandbox 复验操作系统级权限边界；当前同进程 mock provider 不是安全沙箱。
- M5-D-D 已实现并交付单个完整 wave 的审批门控 Worktree 回收闭环；`M5-D-D-001` 为 `done/completed` revision `18`，提交 `2b7269d` 已推送到 `origin/dev`。
- M6-A 已完成真实单业务闭环验收，并暴露结构化 State、验收追踪、知识新鲜度、交付归属和串行编排差距。
- 下一步是 `M7-A2：统一阶段结果与 State 投影`；启动前仍需独立设计、计划、审核和用户批准。
- M7 按 A1、A2、A3、A4、B、C、D 顺序推进；M7-D 真实 Story 验收通过后才允许启动 M8。
- 真实 Agent、正式并行、Fork-Join 和本地 Docker Compose 闭环分别延期到 M8、M9、M10 和 M11。
- 多 wave 批量回收、分支删除、`git worktree prune`、自动清理和 Worktree 复用继续需要独立方案与明确批准。
- 自动 Git 暂存、提交、推送、PR、生产发布和部署不在 M7-M12 当前批准范围内；完成后的 Git 事实仅由只读交付回执记录。

## 安全说明

- 保留无关工作区文件，不得因 Harness 任务删除、覆盖或暂存它们。
- `run-worktree.ps1 Create/BatchCreate` 只能在用户逐次批准并显式传入 `-ConfirmCreate` 后创建一个 Worktree；`WaveCreate` 必须逐 wave 批准并绑定 `-ExpectedPlanSha256`，遗留锁恢复还必须绑定全部现存锁哈希；`Retire/BatchRetire` 只能在已完成目标 Story、用户逐次批准并显式传入 `-ConfirmRetire` 后回收它。其他脚本不应隐式调用这些命令。
- 发布、提交、推送、部署和破坏性 Git 自动化未实现。

## 结构校验

运行：

```powershell
.\.harness\scripts\validate-structure.ps1
```

该脚本只读检查必需 Harness 文件、JSON 可解析性和 Skill frontmatter。

当前已验证结构：32 个目录、219 个必需文件和 13 个 Skill 文件。

## 知识查询

运行：

```powershell
.\.harness\scripts\kb-query.ps1 -Query "Spring Boot" -Mode knowledge-qa -Area backend
```

该脚本只读搜索 `llm-knowledge/` 中的相关知识片段。
