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
| Deterministic script area | `.harness/scripts/` | M2 状态、M3 Dispatcher、M4-B Mock Worker、M5-A 单 Worktree、M5-B1 Worker 回收、M5-B2 受控集成和 M5-C 生命周期回收 Runtime 已实现 V1 |
| Structure validation script | `.harness/scripts/validate-structure.ps1` | Done |
| State validation script | `.harness/scripts/validate-state.ps1` | E2E、Product 模板/状态与 `active-run` 指针只读校验已实现 |
| State runtime entry | `.harness/scripts/run-state.ps1` | M2 单 Story 状态推进、门禁、锁与恢复已实现 V1 |
| Story Dispatcher entry | `.harness/scripts/run-story.ps1` | M3 `prepare/status/run-adapter/apply` 文件式派发闭环已实现 V1 |
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
| Worktree runtime | `.harness/scripts/run-worktree.ps1` + `lib/worktree-runtime.mjs` | M5-A `Plan/Status/Create` 与 M5-C `Retire`、SHA 绑定、事实对账、批准门禁、幂等和恢复已实现；Retire 只回收已完成 M5-B2 Worktree 并保留分支 |
| Worktree Worker runtime | `.harness/scripts/lib/worktree-worker-runtime.mjs` | M5-B1 单任务执行、输入快照、Git 对账、分级回收、幂等和显式重试已实现；无 CLI |
| Worktree integration runtime | `.harness/scripts/run-worktree-integration.ps1` + `lib/worktree-integration-runtime.mjs` | M5-B2 单任务 `Plan/Status/Apply`、内容寻址 bundle、批准门禁、result-last 和逐文件恢复已实现；不调用 M3 apply |
| Interface case derivation script | `.harness/scripts/derive-interface-cases.ps1` | Basic read-only acceptance-case draft done |
| Build plan script | `.harness/scripts/plan-build.ps1` | Basic read-only build/publish plan done |
| Delivery summary script | `.harness/scripts/summarize-delivery.ps1` | Basic read-only owned/unrelated change summary done |
| Harness smoke flow script | `.harness/scripts/smoke-harness-flow.ps1` | 非破坏性 M2 初始化、M3 prepare/apply 和 M4-B mock Worker 临时闭环已实现；不是业务 E2E |
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

## Deferred Functional Work

- 在 CLI 升级或把 IDE/桌面端纳入目标时重新验证项目 Skill 加载路径；当前 CLI 保留 `.codex/skills`。
- 接入真实 Agent provider 前，使用 Codex custom agent 和 sandbox 复验操作系统级权限边界；当前同进程 mock provider 不是安全沙箱。
- M5-B2 已实现单任务业务代码集成；多任务聚合、多 Worktree 波次和跨任务冲突停止继续延期。
- 多任务/多 Worktree 回收、分支删除、`git worktree prune`、Fork-Join 和自动清理继续需要独立方案与明确批准。
- Implement real interface execution, publish, and git delivery behavior only after quality gates are stable and approved.

## Safety Notes

- Preserve unrelated working-tree files; do not delete or stage them as part of Harness work.
- `run-worktree.ps1 Create` 只能在用户逐次批准并显式传入 `-ConfirmCreate` 后创建一个 Worktree；`Retire` 只能在已完成目标 Story、用户逐次批准并显式传入 `-ConfirmRetire` 后回收它。其他脚本不应隐式调用这些命令。
- Publish, commit, push, deployment, and destructive git scripts are not implemented.

## Structure Validation

Run:

```powershell
.\.harness\scripts\validate-structure.ps1
```

The script is read-only and checks required Harness files, JSON parseability, and Skill frontmatter.

Current verified structure: 25 directories, 159 required files, and 13 Skill files.

## Knowledge Query

Run:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "Spring Boot" -Mode knowledge-qa -Area backend
```

The script is read-only and searches `llm-knowledge/` for relevant knowledge snippets.
