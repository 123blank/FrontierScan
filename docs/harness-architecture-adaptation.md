# FrontierScan Harness Architecture Adaptation

This document records the first structural adaptation of FrontierScan toward a Harness Engineering workflow.

The current step creates structure only. It does not implement custom Skills, Agents, runtime hooks, or business-code changes.

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
  harness-skill-customization-plan.md
  harness-architecture-adaptation.md
```

## Responsibility Split

| Area | Purpose |
| --- | --- |
| `.harness/` | Runtime state, schemas, and generated workflow outputs |
| `.harness/workflows/` | Phase definitions for single-story E2E and product-level Fork-Join workflows |
| `.harness/templates/` | Standard output templates for requirements, design, review, testing, verification, and delivery |
| `.harness/scripts/` | Placeholder location for deterministic workflow scripts |
| `.codex/agents/` | Planned expert Agent role registry |
| `.codex/skills/` | Project-local custom Skills |
| `llm-knowledge/` | Structured knowledge base consumed by future Skills/Agents |
| `docs/` | Human-facing architecture and planning docs |

## Current FrontierScan Adaptation

The Tencent article describes a Go/tRPC/internal-platform environment. FrontierScan is adapted as:

| Article concept | FrontierScan equivalent |
| --- | --- |
| Service knowledge documents | `llm-knowledge/backend/modules/application/*.md` |
| Frontend/admin knowledge | `llm-knowledge/frontend/modules/web-admin/*.md` |
| `meta.yaml` registry | `llm-knowledge/backend/meta.yaml`, `llm-knowledge/frontend/meta.yaml` |
| E2E state file | `.harness/states/e2e-state.template.json` |
| Product state file | `.harness/states/product-state.template.json` |
| DAG task planning | `.harness/schemas/task-dag.schema.json` |
| Workflow phase config | `.harness/workflows/e2e-development.yaml`, `.harness/workflows/product-fork-join.yaml` |
| Expert Agent registry | `.codex/agents/agents.yaml` |
| Project Skills | `.codex/skills/`, starting with `.codex/skills/frontier-common/` |

## Current Workflow Skeleton

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

## Current Agent Skeleton

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

## Current Skill Skeleton

`.codex/skills/frontier-common/` is the first project-local Skill scaffold. It centralizes:

- repository map
- Harness runtime conventions
- backend conventions
- frontend conventions
- review and test gates

The full project-local Skill scaffold now covers the planned MVP and extended workflow Skills:

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

These Skills are structural scaffolds. Most implementation logic is still deferred.

`frontier-state-runner` now includes basic workflow guidance and references for:

- phase model
- state update discipline
- state validation usage
- blocked-state rules

`frontier-kb-query` now includes basic progressive query guidance and a read-only keyword query script:

```powershell
.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode knowledge-qa -Area all
```

The current query capability is intentionally simple. It finds relevant knowledge files and line snippets, while future work can add richer module-aware retrieval.

`frontier-kb-generate` now includes basic knowledge generation guidance and a read-only source structure scan:

```powershell
.\.harness\scripts\scan-knowledge-inputs.ps1
```

The scan reports backend package candidates, frontend area candidates, and suggested knowledge tasks without overwriting existing knowledge files.

`frontier-kb-refresh-check` now includes basic freshness guidance and a read-only metadata/source check:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
```

The check reports missing metadata, scaffold freshness status, hash mismatches, and source working-tree changes so stale knowledge is not trusted silently.

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

The scaffold also includes a read-only smoke flow that exercises the core Harness helpers in sequence:

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

1. Expand `frontier-common` with validated `agents/openai.yaml` metadata.
2. Create the remaining MVP project-local Skills listed in `docs/harness-skill-customization-plan.md`.
3. Implement deterministic scripts for knowledge generation and richer workflow artifact generation.
4. Generate real code-derived knowledge into `llm-knowledge/`.
5. Introduce active state files only when a concrete request starts.
6. Add workflow validation gates before enabling publish or git delivery automation.

## Safety Boundaries

- Do not let planning or review steps modify business code.
- Do not trust stale generated knowledge silently.
- Do not commit, push, or publish without explicit user confirmation.
- Do not overwrite unrelated dirty files.
- Keep B2B admin UI changes aligned with project UI guidelines.
