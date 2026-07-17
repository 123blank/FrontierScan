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
| Deterministic script area | `.harness/scripts/` | M2 state runtime and M3 single-Story Dispatcher implemented V1 |
| Structure validation script | `.harness/scripts/validate-structure.ps1` | Done |
| State validation script | `.harness/scripts/validate-state.ps1` | E2E、Product 模板/状态与 `active-run` 指针只读校验已实现 |
| State runtime entry | `.harness/scripts/run-state.ps1` | M2 单 Story 状态推进、门禁、锁与恢复已实现 V1 |
| Story Dispatcher entry | `.harness/scripts/run-story.ps1` | M3 `prepare/status/run-adapter/apply` 文件式派发闭环已实现 V1 |
| Task DAG validation script | `.harness/scripts/validate-task-dag.ps1` | Basic read-only validation done |
| KB query script | `.harness/scripts/kb-query.ps1` | Index-first query with Markdown fallback implemented V1 |
| KB generate script | `.harness/scripts/generate-kb.ps1` + `lib/generate-kb.mjs` + `lib/source-fingerprint.mjs` | Knowledge Reliability V2 plus M1.1 deterministic content fingerprints |
| KB regression tests | `.harness/scripts/tests/` | Source-fingerprint, generator, query, freshness, and status tests implemented |
| Diff context script | `.harness/scripts/collect-diff-context.ps1` | Basic read-only diff summary done |
| Test selection script | `.harness/scripts/select-tests.ps1` | Basic read-only path-based gate selection done |
| Knowledge input scan script | `.harness/scripts/scan-knowledge-inputs.ps1` | Basic read-only source structure scan done |
| Knowledge freshness script | `.harness/scripts/check-kb-freshness.ps1` | Backend/frontend/Common baseline, semantic, index, and content-fingerprint freshness check implemented |
| Worktree plan script | `.harness/scripts/plan-worktrees.ps1` | Basic read-only DAG-to-worktree plan done |
| Interface case derivation script | `.harness/scripts/derive-interface-cases.ps1` | Basic read-only acceptance-case draft done |
| Build plan script | `.harness/scripts/plan-build.ps1` | Basic read-only build/publish plan done |
| Delivery summary script | `.harness/scripts/summarize-delivery.ps1` | Basic read-only owned/unrelated change summary done |
| Harness smoke flow script | `.harness/scripts/smoke-harness-flow.ps1` | Non-destructive M2 init/validate and M3 prepare/status smoke implemented; not business E2E |
| Agent registry | `.codex/agents/agents.yaml` | 12 roles feed M3 task owners; real Agent worker execution deferred |
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

## Deferred Functional Work

- Verify and package project Skills through a supported Codex runtime integration mechanism for M4.
- Implement constrained Agent workers that consume M3 task/result schemas without owning state transitions.
- Strengthen DAG validation for wave topology, file collisions, shared files, and global changes.
- Implement write-capable worktree orchestration only after explicit approval.
- Implement real interface execution, publish, and git delivery behavior only after quality gates are stable and approved.

## Safety Notes

- Preserve unrelated working-tree files; do not delete or stage them as part of Harness work.
- Current helpers do not execute publish, push, commit, deployment, or Worktree creation.
- Publish, commit, push, deployment, and destructive git scripts are not implemented.

## Structure Validation

Run:

```powershell
.\.harness\scripts\validate-structure.ps1
```

The script is read-only and checks required Harness files, JSON parseability, and Skill frontmatter.

Current verified structure: 19 directories, 117 required files, and 13 Skill files.

## Knowledge Query

Run:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "Spring Boot" -Mode knowledge-qa -Area backend
```

The script is read-only and searches `llm-knowledge/` for relevant knowledge snippets.
