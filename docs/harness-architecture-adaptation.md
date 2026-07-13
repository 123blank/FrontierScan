# FrontierScan Harness Architecture Adaptation

This document records the current FrontierScan adaptation toward a Harness Engineering workflow.

The repository now contains implemented structural contracts, deterministic helpers, 13 project-local Skill definitions, a 12-role Agent registry, and a layered knowledge generator. The knowledge generator and query helpers are implemented at V1 with M1.1 content-fingerprint freshness. The Agent runtime, deterministic phase runner, lifecycle hooks, Worktree execution, and DevOps loop are not implemented.

## Added Structure

```text
.harness/
  schemas/
  states/
  outputs/
  workflows/
  templates/
  reports/
  scripts/
.codex/
  agents/
  skills/
llm-knowledge/
  backend/
  frontend/
  common/
docs/
  harness-m0-m1/
    PLAN.md
    REPORT.md
  harness-architecture-adaptation.md
```

## Responsibility Split

| Area | Purpose |
| --- | --- |
| `.harness/` | Runtime state, schemas, and generated workflow outputs |
| `.harness/workflows/` | Phase definitions for single-story E2E and product-level Fork-Join workflows |
| `.harness/templates/` | Standard output templates for requirements, design, review, testing, verification, and delivery |
| `.harness/scripts/` | Deterministic validators, planners, knowledge generator/query, freshness checks, smoke flow, and tests |
| `.codex/agents/` | Expert Agent role and responsibility registry; not an active runtime |
| `.codex/skills/` | 13 project-local Skill definitions with mixed implementation readiness |
| `llm-knowledge/` | Generated and curated structured knowledge consumed by current Codex work and future runtime workers |
| `docs/` | Human-facing architecture and planning docs |

## Current FrontierScan Adaptation

The Tencent article describes a Go/tRPC/internal-platform environment. FrontierScan is adapted as:

| Article concept | FrontierScan equivalent |
| --- | --- |
| Service knowledge documents | `llm-knowledge/backend/modules/<module>/*.md` for 7 backend modules |
| Frontend/admin knowledge | `llm-knowledge/frontend/modules/<module>/*.md` for 7 frontend modules |
| `meta.yaml` registry | `llm-knowledge/backend/meta.yaml`, `llm-knowledge/frontend/meta.yaml` |
| E2E state file | `.harness/states/e2e-state.template.json` |
| Product state file | `.harness/states/product-state.template.json` |
| DAG task planning | `.harness/schemas/task-dag.schema.json` |
| Workflow phase config | `.harness/workflows/e2e-development.yaml`, `.harness/workflows/product-fork-join.yaml` |
| Expert Agent registry | `.codex/agents/agents.yaml` |
| Project Skills | `.codex/skills/`, starting with `.codex/skills/frontier-common/` |

## Current Workflow Contracts

The single-story E2E workflow is defined in `.harness/workflows/e2e-development.yaml`:

```text
requirement
  -> technical-design
  -> task-dag
  -> implementation
  -> unit-test
  -> code-review
  -> build-publish
  -> interface-verification
  -> git-delivery
  -> done
```

The product-level workflow is defined in `.harness/workflows/product-fork-join.yaml`:

```text
breakdown -> forking -> joining -> done
```

These workflow files are structural contracts only. They do not execute automation yet.

## Current Agent Registry

`.codex/agents/agents.yaml` defines planned expert roles:

```text
product-analyst
requirement-analyst
task-planner
backend-developer
frontend-developer
code-fixer
unit-tester
test-case-designer
interface-verifier
code-reviewer
publisher
git-committer
```

The registry records responsibilities and file-modification boundaries. It is not an active Agent runtime yet.

## Current Skill System

`.codex/skills/frontier-common/` is the shared project-local Skill definition. It centralizes:

- repository map
- Harness runtime conventions
- backend conventions
- frontend conventions
- review and test gates

The project-local Skill registry covers the planned MVP and extended workflow Skills:

```text
frontier-common
frontier-kb-generate
frontier-kb-query
frontier-kb-refresh-check
frontier-state-runner
frontier-requirement-breakdown
frontier-task-dag-planner
frontier-worktree-orchestrator
frontier-code-review-gate
frontier-test-gate
frontier-interface-verifier
frontier-build-publish
frontier-git-delivery
```

Knowledge generation, query, freshness, structural validation, and planning helpers have executable V1 implementations. Requirement, state, DAG, review, test, verification, build, and delivery Skills primarily remain guidance contracts around read-only helpers. Automatic Skill discovery and Agent dispatch are not implemented.

`frontier-state-runner` now includes basic workflow guidance and references for:

- phase model
- state update discipline
- state validation usage
- blocked-state rules

`frontier-kb-query` includes progressive query guidance and an index-first, Markdown-fallback query script:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode knowledge-qa -Area all
```

The query is index-first with Markdown fallback, mode/area-aware ranking, Common/Harness/Skill knowledge ingestion, and source/freshness metadata.

`frontier-kb-generate` now implements layered generation:

```powershell
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all -DryRun -Json
```

The generator produces L1 Markdown/facts, L2 OpenAI semantic documents with graceful degradation, and an L3 local index. Current output covers 7 backend and 7 frontend modules plus Common knowledge, with 324 chunks. M1.1 records SHA-256 content fingerprints for area, module, document, chunk, metadata, and manifest isolation.

`frontier-kb-refresh-check` includes freshness guidance and a read-only metadata/source/index check:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
```

The check reports backend, frontend, and Common baseline/semantic/index status, missing manifests, and source-fingerprint mismatches so stale knowledge is not trusted silently. `git_hash` remains audit metadata; Git or working-tree state is not the freshness authority.

`frontier-requirement-breakdown` now includes basic decomposition guidance and references for:

- story shape
- clarification policy
- acceptance criteria quality
- mapping breakdown output into product/e2e state initialization fields

`frontier-task-dag-planner` now includes basic DAG planning guidance and references for:

- task node schema
- dependency edges
- parallel wave policy
- conflict/global-change policy
- a valid `.harness/templates/task-dag.example.json`

`frontier-worktree-orchestrator` now includes basic isolation planning guidance and a read-only DAG-to-worktree plan:

```powershell
.\.harness\scripts\plan-worktrees.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
```

The helper emits suggested branches, worktree paths, waves, and create commands, but does not create or modify worktrees.

`frontier-code-review-gate` now includes basic review guidance and references for:

- changed-file review scope
- backend/frontend/Harness review checklist
- BLOCKER/WARNING/NOTE severity policy
- conditional frontend UI review rules
- read-only diff context collection through `.harness/scripts/collect-diff-context.ps1`

`frontier-test-gate` now includes basic test selection guidance and references for:

- path-based test gate selection
- command execution rules
- test report result labels
- read-only gate recommendation through `.harness/scripts/select-tests.ps1`

`frontier-interface-verifier` now includes basic verification guidance and a read-only case derivation helper:

```powershell
.\.harness\scripts\derive-interface-cases.ps1 -TaskDagFile .\.harness\templates\task-dag.example.json
```

The helper turns task acceptance criteria into verification case drafts; concrete requests/actions still need environment-specific completion before execution.

`frontier-build-publish` now includes basic approval-gated build guidance and a read-only build plan:

```powershell
.\.harness\scripts\plan-build.ps1
```

The helper recommends backend/frontend/Docker build commands from changed paths, but does not publish or deploy.

`frontier-git-delivery` now includes basic approval-gated git delivery guidance and a read-only delivery summary:

```powershell
.\.harness\scripts\summarize-delivery.ps1
```

The helper separates default Harness-owned changes from unrelated dirty files, but does not stage, commit, push, or create PRs.

The Harness includes a non-destructive smoke flow that exercises the core helpers in sequence:

```powershell
.\.harness\scripts\smoke-harness-flow.ps1
```

The shared knowledge base now includes `llm-knowledge/common/conventions/quality-gates.md` so review/test gate questions can be found through progressive knowledge queries.

The shared knowledge base also includes `llm-knowledge/common/conventions/execution-verification.md` so worktree and interface verification questions can be found through progressive knowledge queries.

The shared knowledge base also includes `llm-knowledge/common/conventions/delivery.md` so build, publish, and git delivery questions can be found through progressive knowledge queries.

## Current Output Templates

`.harness/templates/` contains standard templates for:

- requirement breakdown
- technical design
- code review report
- test report
- interface verification report
- delivery report

These templates make future Skill and Agent outputs stable and parseable.

## Next Implementation Steps

M0, M1, and M1.1 are complete. The authoritative records are `docs/harness-m0-m1/REPORT.md` and `docs/harness-m1-1-source-fingerprint/REPORT.md`.

The next independent capability is a controlled live L2 semantic-enrichment acceptance using the configured OpenAI environment key. It must verify source-file traceability, model metadata, success output, and graceful degradation without reading or printing credentials or changing business code.

After that acceptance, implement M2 deterministic state runtime: active-run initialization, atomic transitions, evidence gates, locking, blocking/resume, and a single-story recovery test. Do not implement automatic Agent dispatch or parallel Worktree execution before M2 and the single-story vertical slice are stable.

## Safety Boundaries

- Do not let planning or review steps modify business code.
- Do not trust stale generated knowledge silently.
- Do not commit, push, or publish without explicit user confirmation.
- Do not overwrite unrelated dirty files.
- Keep B2B admin UI changes aligned with project UI guidelines.
