# FrontierScan Harness Skill Customization Plan

> Status: next-phase implementation plan
> Last verified: 2026-07-10
> Scope: Harness, knowledge, Skill, Agent, workflow, and verification infrastructure only

## 1. Objective

Refactor `D:\ProjectStudy\FrontierScan` toward the Harness Engineering style described in the Tencent article by first creating a project-specific custom Skill system.

This document started as the Skill creation plan. The repository now contains the Harness structure, all 13 planned project-local Skill folders, deterministic helper scripts, and the first layered knowledge generator. The next phase is no longer "create the Skills". It is to turn the existing guidance and templates into a deterministic, testable runtime while preserving explicit approval gates.

Current implementation status:

| Area | Status |
| --- | --- |
| Project-local Skills | 13 folders exist under `.codex/skills/`; they are guidance files and are not installed in the active Codex Skill runtime |
| Harness contracts | Workflows, state schemas, templates, and structural validators exist under `.harness/` |
| L1 knowledge baseline | Implemented for 7 backend and 7 frontend modules |
| L2 semantic knowledge | Implemented with graceful degradation, but current generated status is `pending` and the success path is not verified |
| L3 local index | Implemented with 105 keyword/metadata chunks; optional embeddings can be generated but are not consumed by query |
| Knowledge query | Implemented, but index routing is flat and can bypass relevant `common/` knowledge |
| Knowledge freshness | Git/hash and dirty-source reporting works; refresh task creation and automatic regeneration do not |
| State and DAG | Templates and validators exist; no active state, transition engine, or workflow resumption runtime exists |
| Agents | Role registry exists; no dispatcher, context isolation, model selection, or tool permission enforcement exists |
| Worktree, test, review, interface, build, delivery | Read-only planning or evidence helpers exist; execution and closed-loop orchestration do not |
| End-to-end outcome | Human/Codex-driven assisted workflow only; autonomous Harness delivery is not implemented |

Target architecture:

```text
Knowledge Engineering
  -> structured project knowledge
  -> progressive query
  -> freshness checks

E2E Development Engineering
  -> requirement breakdown
  -> state-file-driven workflow
  -> DAG task planning
  -> isolated worktree execution
  -> review/test/publish gates

Deterministic Runtime
  -> owns state transitions and gate decisions
  -> invokes AI only for cognitive steps
  -> invokes scripts/adapters for deterministic steps
  -> records evidence for resume, audit, and evaluation
```

Core principle:

```text
AI handles cognition. Scripts handle deterministic execution. State files preserve workflow truth.
```

The existing Skill inventory in Sections 3-5 remains the responsibility contract. The implementation sequence in the later sections supersedes the original Skill-creation order.

## 2. Proposed Skill Location

Recommended project-local location:

```text
D:\ProjectStudy\FrontierScan\.codex\skills\
```

Why project-local:

- Keeps FrontierScan-specific business, API, database, and workflow knowledge inside the project.
- Avoids polluting global Codex Skills with project-only conventions.
- Allows this architecture to evolve together with the repository.

Optional global location for reusable generic Skills:

```text
C:\Users\czd\.codex\skills\
```

Use global only for reusable Skills such as generic state-machine execution or git worktree orchestration.

## 3. Skill Creation Phases

### Phase 0: Foundation

Create shared conventions before creating workflow Skills.

Deliverables:

```text
.codex/skills/
  frontier-common/
    SKILL.md
    references/
      project-map.md
      coding-conventions.md
      b2b-admin-guidelines.md
      backend-conventions.md
      frontend-conventions.md
      state-schema.md
```

Purpose:

- Centralize project conventions.
- Define where backend, frontend, docs, tests, scripts, and generated knowledge live.
- Define how all other Skills should read and write state.

### Phase 1: Knowledge Engineering MVP

Create Skills that let AI understand FrontierScan before changing it.

Skills:

1. `frontier-kb-generate`
2. `frontier-kb-query`
3. `frontier-kb-refresh-check`

Goal:

```text
source code + existing docs -> structured knowledge -> progressive query by later Skills
```

### Phase 2: Requirement and Planning Workflow

Create Skills that turn a request into executable work.

Skills:

1. `frontier-requirement-breakdown`
2. `frontier-task-dag-planner`
3. `frontier-state-runner`

Goal:

```text
user request -> clarified requirement -> stories/tasks -> DAG -> e2e-state.json
```

### Phase 3: Development Isolation and Quality Gates

Create Skills that support safe implementation.

Skills:

1. `frontier-worktree-orchestrator`
2. `frontier-code-review-gate`
3. `frontier-test-gate`

Goal:

```text
DAG tasks -> isolated worktrees -> implementation -> review/test gates
```

### Phase 4: E2E Verification and Delivery

Create Skills that close the loop from implementation to delivery.

Skills:

1. `frontier-interface-verifier`
2. `frontier-build-publish`
3. `frontier-git-delivery`

Goal:

```text
implemented changes -> API/UI verification -> build -> commit/PR workflow
```

## 4. Skill Inventory

### 4.1 `frontier-common`

Description draft:

```yaml
name: frontier-common
description: Shared FrontierScan project conventions, repository map, B2B admin UI rules, backend/frontend conventions, and Harness state schema. Use when Codex needs project-specific guidance before planning, implementing, reviewing, testing, or generating FrontierScan Harness workflow artifacts.
```

Responsibilities:

- Load project conventions.
- Route to backend/frontend/data/UI guidelines.
- Define state file locations and JSON schema.
- Define common output quality rules.

Resources:

```text
references/project-map.md
references/coding-conventions.md
references/b2b-admin-guidelines.md
references/backend-conventions.md
references/frontend-conventions.md
references/state-schema.md
```

No scripts required in MVP.

### 4.2 `frontier-kb-generate`

Description draft:

```yaml
name: frontier-kb-generate
description: Generate or update structured FrontierScan knowledge documents from backend, frontend, database, API, and existing docs. Use when Codex needs to build llm-knowledge style documentation such as overview, interfaces, architecture, dependencies, storage, config, pitfalls, and changelog files.
```

Responsibilities:

- Scan repository structure.
- Generate service/module knowledge files.
- Preserve manual notes.
- Append generation logs.
- Record git hash and generation metadata.

Recommended output structure:

```text
llm-knowledge/
  overview.md
  backend/
    meta.yaml
    modules/
      <module-name>/
        overview.md
        interfaces.md
        architecture.md
        dependencies.md
        storage.md
        config.md
        pitfalls.md
        log.md
        custom/
  frontend/
    meta.yaml
    modules/
      <module-name>/
        overview.md
        routes.md
        components.md
        api-usage.md
        state.md
        pitfalls.md
        log.md
        custom/
  common/
    conventions/
    tech/
```

Resources:

```text
references/kb-document-types.md
references/manual-note-preservation.md
references/frontier-module-detection.md
scripts/scan_project_structure.py
scripts/generate_kb_skeleton.py
```

Validation:

- Generated files exist.
- `meta.yaml` includes module path, type, git hash, and document freshness metadata.
- `log.md` is append-only.

### 4.3 `frontier-kb-query`

Description draft:

```yaml
name: frontier-kb-query
description: Query FrontierScan structured knowledge with progressive loading instead of broad context dumping. Use for product requirement analysis, technical design, API discovery, business rule lookup, database/storage lookup, frontend route/component lookup, and implementation planning.
```

Responsibilities:

- Load top-level overview first.
- Use `meta.yaml` to narrow to backend/frontend modules.
- Load only relevant document types.
- Prefer manual `custom/` notes when present.
- Report missing/stale knowledge.

Query modes:

```text
A. requirement-breakdown
B. technical-design
C. api-search
D. knowledge-qa
E. frontend-ui-search
F. data-flow-trace
```

Resources:

```text
references/query-modes.md
references/progressive-loading.md
scripts/kb_query.py
```

Validation:

- Query answer cites the loaded knowledge files.
- Query does not load unrelated modules.
- Stale or missing knowledge is surfaced explicitly.

### 4.4 `frontier-kb-refresh-check`

Description draft:

```yaml
name: frontier-kb-refresh-check
description: Check FrontierScan knowledge freshness by comparing recorded git hashes, source file changes, and generated document logs. Use before relying on llm-knowledge documents for planning, implementation, review, or verification.
```

Responsibilities:

- Compare `meta.yaml` git hash with current HEAD or file hash.
- Detect changed modules.
- Emit refresh tasks.
- Avoid silently trusting stale docs.

Resources:

```text
references/freshness-policy.md
scripts/check_kb_freshness.py
```

Validation:

- Changed modules are reported.
- Unchanged modules are not regenerated unnecessarily.

### 4.5 `frontier-requirement-breakdown`

Description draft:

```yaml
name: frontier-requirement-breakdown
description: Break FrontierScan product or engineering requests into clarified stories, affected modules, existing reusable APIs, new or changed backend/frontend work, open questions, and acceptance criteria. Use at the start of Harness-style development before implementation.
```

Responsibilities:

- Read user request.
- Call/consult `frontier-kb-query` conceptually.
- Identify affected backend, frontend, database, and UI areas.
- Ask only blocking clarification questions.
- Create a story breakdown document.
- Initialize `product-state.json` when request has multiple stories.

Resources:

```text
references/story-template.md
references/clarification-policy.md
references/acceptance-criteria.md
scripts/init_product_state.py
```

Outputs:

```text
.harness/states/product-state.json
.harness/outputs/requirement-breakdown-YYYYMMDD-HHMM.md
```

Validation:

- Every story has acceptance criteria.
- Every story has known affected modules or an explicit discovery task.

### 4.6 `frontier-task-dag-planner`

Description draft:

```yaml
name: frontier-task-dag-planner
description: Convert a FrontierScan story or technical design into implementation tasks, dependency edges, predicted touched files, parallel waves, global changes, and risk flags. Use before coding to produce a DAG and worktree execution plan.
```

Responsibilities:

- Split tasks by module/interface/component.
- Mark dependencies.
- Predict file touches.
- Detect shared files that must be serial.
- Detect DB/config/global changes.
- Detect UI guideline impact.

Resources:

```text
references/dag-task-schema.md
references/conflict-policy.md
references/global-change-policy.md
scripts/validate_task_dag.py
```

Outputs:

```text
.harness/outputs/task-dag-YYYYMMDD-HHMM.json
.harness/states/e2e-state.json
```

Validation:

- DAG is acyclic.
- Parallel tasks do not touch the same predicted files unless explicitly allowed.
- Global changes require explicit confirmation before implementation.

### 4.7 `frontier-state-runner`

Description draft:

```yaml
name: frontier-state-runner
description: Maintain and advance FrontierScan Harness workflow state files. Use when Codex needs to read, validate, resume, or update product-state.json or e2e-state.json across requirement, planning, development, review, test, verification, and delivery phases.
```

Responsibilities:

- Treat state files as source of truth.
- Validate current phase.
- Decide next phase.
- Record phase outputs.
- Support resume after interruption.

Resources:

```text
references/e2e-phase-model.md
references/product-phase-model.md
references/state-update-rules.md
scripts/state_runner.py
scripts/validate_state.py
```

State locations:

```text
.harness/states/product-state.json
.harness/states/e2e-state.json
.harness/outputs/
```

Validation:

- State JSON validates against schema.
- Phase transitions are legal.
- Required output artifacts exist before advancing.

### 4.8 `frontier-worktree-orchestrator`

Description draft:

```yaml
name: frontier-worktree-orchestrator
description: Plan and operate isolated git worktrees for FrontierScan Harness tasks, including creating task branches, assigning DAG waves, merging completed task work, detecting conflicts, and cleaning up. Use when executing parallel or isolated implementation tasks.
```

Responsibilities:

- Create task worktrees.
- Map DAG tasks to branches/worktrees.
- Merge completed task branches into integration branch.
- Detect conflicts.
- Never discard user changes.

Resources:

```text
references/worktree-policy.md
references/merge-conflict-policy.md
scripts/worktree_create.ps1
scripts/worktree_merge.ps1
scripts/worktree_status.ps1
```

Validation:

- Worktree paths are outside or under approved workspace location.
- Git status is checked before merge/cleanup.
- Dirty unrelated changes are reported, not overwritten.

### 4.9 `frontier-code-review-gate`

Description draft:

```yaml
name: frontier-code-review-gate
description: Review FrontierScan code changes for correctness, regressions, architecture drift, security risks, missing tests, and B2B admin UI guideline violations. Use after implementation and before merge, build, or delivery.
```

Responsibilities:

- Review diff, not whole repo unless needed.
- Prioritize bugs and regressions.
- Enforce backend/frontend conventions.
- Enforce `docs/B2B_ADMIN_UI_GUIDELINES.md` for UI changes.
- Produce BLOCKER/WARNING/NOTE findings.

Resources:

```text
references/review-checklist.md
references/backend-review-rules.md
references/frontend-review-rules.md
references/ui-review-rules.md
scripts/collect_diff_context.ps1
```

Validation:

- Findings include file/line references.
- UI work includes guideline checklist.
- Blocking findings prevent delivery phase.

### 4.10 `frontier-test-gate`

Description draft:

```yaml
name: frontier-test-gate
description: Select and run the appropriate FrontierScan backend, frontend, and data tests for a change. Use after implementation or fixes to verify behavior before publish, interface verification, or git delivery.
```

Responsibilities:

- Select narrow tests by touched files.
- Run backend tests for backend/data changes.
- Run frontend build for frontend changes.
- Record test commands and outcomes.

Resources:

```text
references/test-selection-policy.md
references/build-policy.md
scripts/select_tests.py
scripts/run_frontend_build.ps1
scripts/run_backend_tests.ps1
```

Validation:

- Test commands are recorded in state.
- Failures block next phase.
- Skipped tests require reason.

### 4.11 `frontier-interface-verifier`

Description draft:

```yaml
name: frontier-interface-verifier
description: Verify FrontierScan backend APIs and frontend-visible workflows by constructing requests from acceptance criteria, asserting responses, tracing failures, and writing verification results. Use after deployment or local startup for endpoint and workflow validation.
```

Responsibilities:

- Generate request cases from acceptance criteria.
- Execute API checks where environment is available.
- Diagnose failures without modifying code.
- Record verification output.

Resources:

```text
references/api-verification-schema.md
references/failure-diagnosis-policy.md
scripts/run_api_cases.py
```

Validation:

- Every acceptance criterion maps to at least one case or an explicit non-automated check.
- Failed assertions include request, response summary, and likely cause.

### 4.12 `frontier-build-publish`

Description draft:

```yaml
name: frontier-build-publish
description: Build, package, and optionally publish FrontierScan services or frontend artifacts in a controlled Harness workflow. Use when a change must be compiled, packaged, deployed to test, or prepared for release after review and tests pass.
```

Responsibilities:

- Build backend/frontend according to changed modules.
- Publish only after confirmation if environment-impacting.
- Record artifacts and versions.

Resources:

```text
references/publish-policy.md
scripts/build_backend.ps1
scripts/build_frontend.ps1
scripts/publish_stub.ps1
```

Validation:

- Build output is captured.
- Publish is never done without explicit approval.

### 4.13 `frontier-git-delivery`

Description draft:

```yaml
name: frontier-git-delivery
description: Prepare FrontierScan git delivery by summarizing owned changes, staging only task-owned files, creating commits, pushing branches, and preparing PR/MR descriptions after validation passes. Use at the end of a Harness workflow.
```

Responsibilities:

- Summarize changes.
- Stage only task-owned files.
- Avoid unrelated dirty files.
- Create commit/PR only after user confirmation.

Resources:

```text
references/git-delivery-policy.md
references/pr-template.md
scripts/list_owned_changes.ps1
```

Validation:

- Git status is shown before staging.
- Unrelated changes are called out.
- Commit message references story/task.

## 5. State Model Plan

### 5.1 `product-state.json`

Purpose:

Track product-level requests that split into multiple stories.

Draft schema:

```json
{
  "schemaVersion": "1.0",
  "requestId": "YYYYMMDD-HHMM-short-name",
  "phase": "breakdown|forking|joining|done|blocked",
  "sourceRequest": "string",
  "stories": [
    {
      "storyId": "S1",
      "title": "string",
      "status": "pending|running|reviewed|joined|blocked|done",
      "stateFile": ".harness/states/e2e-S1.json",
      "affectedModules": [],
      "acceptanceCriteria": []
    }
  ],
  "join": {
    "integrationBranch": "string",
    "mergeStatus": "pending|running|done|blocked",
    "verificationStatus": "pending|passed|failed|skipped"
  },
  "decisions": [],
  "logs": []
}
```

### 5.2 `e2e-state.json`

Purpose:

Track one story through the end-to-end workflow.

Draft phases:

```text
0 requirement
1 technical-design
2 task-dag
3 implementation
4 unit-test
5 code-review
6 build-publish
7 interface-verification
8 git-delivery
9 done
blocked
```

Draft schema:

```json
{
  "schemaVersion": "1.0",
  "storyId": "S1",
  "phase": "requirement",
  "requirement": {
    "summary": "string",
    "openQuestions": [],
    "acceptanceCriteria": []
  },
  "knowledge": {
    "loadedFiles": [],
    "staleFiles": [],
    "missingAreas": []
  },
  "tasks": [],
  "dag": {
    "nodes": [],
    "edges": [],
    "waves": []
  },
  "worktrees": [],
  "tests": {
    "commands": [],
    "results": []
  },
  "review": {
    "findings": [],
    "status": "pending"
  },
  "verification": {
    "cases": [],
    "results": []
  },
  "delivery": {
    "ownedFiles": [],
    "commit": null,
    "pr": null
  },
  "logs": []
}
```

## 6. Historical Initial Implementation Order

This section records the original creation order. All listed Skill folders now exist. It is retained for design history and is not the current execution roadmap; use Sections 12-18 instead.

Build in this order:

1. `frontier-common`
2. `frontier-kb-generate`
3. `frontier-kb-query`
4. `frontier-state-runner`
5. `frontier-requirement-breakdown`
6. `frontier-task-dag-planner`
7. `frontier-code-review-gate`
8. `frontier-test-gate`
9. `frontier-worktree-orchestrator`
10. `frontier-interface-verifier`
11. `frontier-build-publish`
12. `frontier-git-delivery`
13. `frontier-kb-refresh-check`

Reasoning:

- Knowledge and state must exist before workflow automation.
- Planning should exist before worktree parallelism.
- Review/test gates should exist before delivery automation.
- Publish and git delivery should be last because they affect external state.

## 7. Historical Minimum Viable Harness Skill Set

The folder-level MVP is complete as guidance. Runtime behavior described below is still not implemented.

If time is limited, create only these first:

```text
frontier-common
frontier-kb-generate
frontier-kb-query
frontier-state-runner
frontier-requirement-breakdown
frontier-task-dag-planner
frontier-code-review-gate
frontier-test-gate
```

This MVP supports:

```text
understand project -> split requirement -> plan tasks -> track state -> review/test changes
```

It does not yet support:

```text
parallel worktree execution
API verification
publishing
commit/PR automation
```

## 8. Validation Strategy

Each Skill must pass three validation levels.

### Level 1: Skill folder validation

Run Codex skill validation after creation:

```text
quick_validate.py <skill-folder>
```

Check:

- Valid `SKILL.md` frontmatter.
- Lowercase hyphenated skill name.
- Required description exists.
- No unrelated README/INSTALL docs.

### Level 2: Artifact validation

Check each Skill's outputs.

Examples:

- `frontier-kb-generate`: generated docs and `meta.yaml` are present.
- `frontier-task-dag-planner`: DAG is acyclic.
- `frontier-state-runner`: state transitions are legal.
- `frontier-code-review-gate`: findings have severity and file references.

### Level 3: Workflow validation

Run a simulated non-destructive workflow:

```text
sample request -> requirement breakdown -> task DAG -> state update -> review/test plan
```

Do not publish, push, or modify production data during validation.

## 9. Risk Controls

- Do not let review or verification Skills modify code.
- Do not let planning Skills publish or commit.
- Do not let delivery Skills stage unrelated files.
- Do not trust stale knowledge silently.
- Do not use global Memory for deterministic workflows.
- Do not rely on dialogue history as the source of truth.
- Do not perform destructive git operations automatically.
- Require explicit user approval for publish, push, and commit.

## 10. Historical Open Decisions Before Creating Skills

The location, storage, and first implementation-language decisions below have been resolved. Remaining runtime decisions are tracked in Section 17.

Before implementation, decide:

1. Should Skills be project-local under `D:\ProjectStudy\FrontierScan\.codex\skills` or global under `C:\Users\czd\.codex\skills`?
2. Should deterministic scripts be written in PowerShell, Python, Node, or a mix?
3. Should generated knowledge live in `llm-knowledge/` or `docs/llm-knowledge/`?
4. Should Harness runtime state live in `.harness/` or `tmp/harness/`?
5. Which backend/frontend test commands are canonical for FrontierScan?
6. Which environment, if any, is safe for API verification?
7. Should build/publish/git-delivery Skills be created only after MVP proves stable?

Recommended defaults:

```text
Skills: .codex/skills/
Knowledge: llm-knowledge/
State: .harness/states/
Outputs: .harness/outputs/
Scripts: bundled under each Skill's scripts/ first, promoted later if shared
Publish/git automation: defer until review/test workflow is stable
```

## 11. Superseded Initial Next Step

The following Skill-creation step has already been completed at the folder and guidance level. It is retained only as project history.

After this plan is approved, create the MVP Skills in this order:

```text
frontier-common
frontier-kb-generate
frontier-kb-query
frontier-state-runner
frontier-requirement-breakdown
frontier-task-dag-planner
frontier-code-review-gate
frontier-test-gate
```

Use `skill-creator` initialization workflow for each Skill, then customize `SKILL.md`, references, and scripts. Validate each Skill before moving to the next one.

## 12. Verified Baseline (2026-07-10)

The next-phase plan is based on repository inspection and executable checks, not folder existence alone.

Verified checks:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\generate-kb.ps1 -Root "D:\ProjectStudy\FrontierScan" -Area all -Mode all -DryRun -Json
```

Verified results:

- Structure validation passes for 14 directories, 91 required files, and 13 Skill files.
- Knowledge generator tests pass.
- Knowledge query tests pass.
- The smoke flow passes.
- Dry run detects 14 source modules and plans 137 knowledge writes without writing files.
- Backend and frontend L1 baseline status is `fresh`.
- Local index status is `fresh` with 105 chunks.
- L2 semantic status is `pending`.
- Embeddings status is `skipped`.

Important interpretation:

- Passing smoke proves that schemas, templates, validators, dry-run generation, and planning helpers can execute.
- It does not prove that a real requirement can advance through the workflow.
- It does not dispatch Agents, create worktrees, execute builds, deploy an environment, call an API, run a UI workflow, or prepare an approved commit.
- The current usable outcome is a human/Codex-driven, knowledge-first development workflow with deterministic assistance.

## 13. Target Runtime Architecture

The target architecture should follow the article's later engineering conclusion: the external program owns orchestration, AI owns cognitive work, and deterministic adapters own execution.

```text
AGENTS.md / user request
          |
          v
PowerShell entry points
          |
          v
Typed Node runtime
  |-- run and state engine
  |-- transition and quality-gate engine
  |-- knowledge router
  |-- cognitive task adapter
  |-- deterministic execution adapters
  |-- evidence, trace, and evaluation writer
          |
          +--> Skills / model calls for cognition
          +--> git / test / build / HTTP / browser adapters for execution
```

Runtime ownership rules:

1. The runtime is the only component allowed to advance workflow phase.
2. Cognitive workers return schema-validated results; they do not directly decide the next phase.
3. State updates use atomic writes and append-only events so interruption cannot corrupt the run.
4. Every gate records command, exit code, evidence path, result, timestamp, and skip reason.
5. External side effects remain behind explicit approval gates.
6. PowerShell remains the Windows-facing entry layer; complex orchestration moves to a typed Node/TypeScript core.
7. The workflow must remain resumable without depending on Codex hooks. Hooks may enforce or resume the workflow, but they cannot be its only execution path.

Proposed runtime layout:

```text
.harness/
  runtime/
    cli/
    state/
    workflow/
    adapters/
      cognition/
      git/
      test/
      build/
      verification/
    evidence/
    evals/
  scripts/
    harness.ps1
```

The existing `.harness/scripts/lib/generate-kb.mjs` can remain in place while the state runtime is introduced. Converting it to TypeScript is not required for the first runtime milestone.

## 14. Next Implementation Milestones

### M0: Baseline Consolidation

Goal: establish one truthful description of the current architecture before adding runtime behavior.

Deliverables:

- Reconcile `docs/AI-handover.md`, `docs/harness-architecture-adaptation.md`, `llm-knowledge/overview.md`, `.codex/skills/skill-registry.yaml`, and `.harness/structure-manifest.yaml`.
- Replace obsolete statements such as "knowledge generation is not implemented" with layer-specific status.
- Inventory the obsolete `application` and `web-admin` scaffold modules and mark or remove them only after confirming that no manual notes exist.
- Record the current uncommitted Harness-owned file set and prepare a reviewable commit boundary; committing still requires explicit approval.

Acceptance criteria:

- All status documents agree on L1, L2, L3, Skill, Agent, and runtime status.
- No registered knowledge path points to a missing or obsolete module.
- `validate-structure.ps1` and `smoke-harness-flow.ps1` pass.
- No backend or frontend business source file changes are introduced.

### M1: Knowledge Reliability V2

Goal: make knowledge accurate enough to drive planning instead of only listing source structure.

Deliverables:

- Add module-scoped generation, for example `-Area backend -Module article`, while retaining area-wide batch generation.
- Replace fragile extraction paths with parser-backed extraction where false negatives are material.
- Parse backend controller parameters, response types, security annotations, service dependencies, transactions, resources, `application.yml`, Flyway migrations, and prompt templates.
- Parse frontend API clients with nested TypeScript generics, template URLs, request/response types, route guards, stores, and page-to-API relationships.
- Produce a source-coverage report showing parsed, skipped, and failed files.
- Index registered `common/`, Harness, and manual `custom/` knowledge in addition to generated backend/frontend documents.
- Make query mode and area part of index ranking and filtering.
- Require freshness status to be surfaced before query results are trusted.
- Either implement embedding retrieval and tests or keep embedding generation disabled. Do not maintain write-only embeddings.
- Add a schema for semantic output and mocked OpenAI success, failure, timeout, and malformed-response tests.
- Add refresh-task JSON generation for stale modules; automatic execution remains an explicit command, not an implicit source edit.

Acceptance criteria:

- Actual frontend API files produce non-empty, correct `api-usage.md` output.
- Backend knowledge references real configuration and migration files.
- `quality gate` in `Area all` returns the common quality-gate document ahead of unrelated LLM classes.
- Module-scoped refresh does not rewrite unrelated modules.
- Unregistered or obsolete generated documents are detected.
- Semantic success is verified with a mock; a real API call is optional and requires a configured key.
- Generator and query regression suites cover the real FrontierScan source patterns that previously failed.

### M2: Deterministic State Runtime

Goal: turn state templates into an executable, resumable workflow source of truth.

Deliverables:

- Add commands for `init`, `status`, `validate`, `record`, `next`, `block`, `resume`, and `complete`.
- Create task-specific active state files without editing templates.
- Add an active-run locator or equivalent deterministic discovery rule.
- Implement legal transition guards from workflow YAML.
- Enforce required outputs and quality gates before phase advancement.
- Use atomic state writes, append-only events, run locks, and recovery from interrupted writes.
- Record approvals and evidence references in state instead of relying on conversation history.
- Provide optional lifecycle-hook integration only after the CLI resume path works independently.

Acceptance criteria:

- A run can stop after any phase and resume in a new process from the same state.
- Invalid transitions and missing required outputs are rejected.
- A failed test or BLOCKER review cannot advance to build or delivery.
- Concurrent attempts to update the same run cannot corrupt state.
- State runtime tests do not call a model or external service.

### M3: Single-Story Vertical Slice

Goal: prove one real, non-parallel workflow from requirement to delivery summary before adding multi-Agent concurrency.

Deliverables:

- Connect requirement breakdown, technical design, task DAG, implementation handoff, test gate, review gate, verification plan, and delivery summary to the state runtime.
- Let the current Codex session perform cognitive steps manually through structured input/output files.
- Execute deterministic validation and selected local test/build commands through adapters.
- Store all phase artifacts under a run-specific output/evidence directory.
- Keep publish, commit, push, and PR actions disabled.

Acceptance criteria:

- A representative FrontierScan change completes the workflow through delivery summary.
- Restarting the runtime mid-flow resumes without redoing completed phases.
- Every phase has inputs, outputs, evidence, status, and timestamps.
- The vertical-slice test detects a missing artifact, failed command, and BLOCKER review.

### M4: Codex Skill and Agent Runtime Integration

Goal: replace manual Skill reading and role simulation with a verified runtime integration.

Deliverables:

- Run a dedicated compatibility spike to select the supported project-scoped Codex plugin or Skill installation mechanism.
- Package or install the `frontier-*` Skills so a fresh Codex session exposes them in its available Skill list.
- Map project Agent roles to runtime workers with explicit input/output schemas.
- Configure per-role model selection, context boundaries, allowed tools, and writable paths.
- Make the orchestrator validate worker output and write state; workers must not advance phases themselves.
- Add a mock cognitive provider so orchestration tests do not depend on live model calls.

Acceptance criteria:

- A fresh session visibly discovers the required project Skills.
- Each role receives only its declared context and tools.
- Review and verification roles cannot modify business code.
- Planning roles cannot publish or run delivery actions.
- Invalid worker output is rejected without corrupting workflow state.

### M5: DAG, Worktree, and Fork-Join Execution

Goal: add safe parallelism only after the single-story runtime is stable.

Deliverables:

- Strengthen DAG validation for wave topology, duplicate/missing tasks, predicted-file overlap, shared files, and global changes.
- Add approval-gated worktree create, inspect, merge, and cleanup adapters.
- Dispatch independent tasks by DAG wave and join only after all required tasks pass their gates.
- Force shared files, migrations, security configuration, and global configuration into serialized integration tasks.
- Implement product-level Fork-Join over multiple story states.
- Stop and diagnose merge conflicts; never discard changes or bypass checks.

Acceptance criteria:

- Independent fixture tasks run in separate worktrees and merge successfully.
- Predicted same-file tasks cannot enter the same parallel wave.
- A merge conflict blocks the workflow and preserves all worktrees and evidence.
- A failed child story prevents product-level Join completion.
- Cleanup cannot run without explicit approval and a verified path boundary.

### M6: Verification, Build, and Delivery Adapters

Goal: close the local/test-environment loop while keeping external writes approval-gated.

Deliverables:

- Execute selected backend tests and frontend builds, capturing structured results.
- Add review and fixer loops with maximum-attempt and escalation policies.
- Turn acceptance criteria into concrete API and UI verification cases.
- Add authenticated HTTP and browser verification only for an explicitly approved environment.
- Add build artifacts and optional deployment adapters for the chosen test environment.
- Add approval-gated commit, push, and PR preparation with owned-file enforcement.

Acceptance criteria:

- Test/build commands record exit code, duration, logs, and artifact paths.
- API/UI failures produce diagnostic evidence and do not silently trigger code changes.
- Delivery cannot include unrelated dirty files.
- Publish, commit, push, and PR operations cannot execute without recorded approval.
- Secrets are referenced through environment/configuration and never copied into state or reports.

### M7: Evaluation and Hardening

Goal: measure whether the Harness improves delivery instead of only increasing automation.

Deliverables:

- Add fixture requirements and expected artifacts for regression testing.
- Measure workflow completion rate, resume success, gate failure detection, knowledge precision, model calls, token/cost usage, and elapsed time.
- Add deterministic replay for state transitions and mocked cognitive outputs.
- Add trace IDs across state, evidence, logs, and external adapters.
- Add a post-run retrospective artifact and a controlled proposal path for improving Skills or rules.

Acceptance criteria:

- The same fixture produces equivalent state transitions across repeated runs.
- Evaluation failures identify the phase and evidence that caused regression.
- Workflow changes require passing the fixture suite before release.
- Self-improvement proposals never modify production rules automatically.

## 15. Validation Matrix

| Layer | Required validation |
| --- | --- |
| Knowledge extraction | Parser fixtures plus assertions against real FrontierScan source patterns |
| Semantic generation | Mock success/failure/timeout/malformed output plus optional live smoke |
| Query | Mode, area, freshness, common/manual knowledge, ranking, and no-match behavior |
| State engine | Legal/illegal transitions, atomic writes, lock contention, block/resume, evidence gates |
| Agent adapter | Schema validation, context isolation, tool permissions, timeout, retry, cancellation |
| DAG/worktree | Topology, collision detection, create/merge/conflict/cleanup safety |
| Test/build | Exit code, timeout, log capture, skipped/unavailable environment behavior |
| Verification | Concrete request/action, expected result, auth context, evidence, diagnosis-only policy |
| Delivery | Owned-file filter, approval record, unrelated dirty files, no destructive git behavior |
| End-to-end | Single-story restart/resume first; product Fork-Join only after the vertical slice passes |

## 16. Dependency and Release Gates

Required sequence:

```text
M0 baseline consolidation
  -> M1 knowledge reliability
  -> M2 deterministic state runtime
  -> M3 single-story vertical slice
  -> M4 Skill/Agent runtime integration
  -> M5 DAG/Worktree/Fork-Join
  -> M6 verification and delivery adapters
  -> M7 evaluation and hardening
```

Do not skip these gates:

- Do not use knowledge as a planning authority until M1 acceptance passes.
- Do not dispatch Agents until the M2 state engine owns transitions.
- Do not add parallel worktrees until the M3 single-story slice is stable.
- Do not enable deployment or git writes until local verification and owned-file gates pass.
- Do not claim article-level Harness behavior until a real request completes and resumes through the full approved workflow.

Definition of the target ideal effect:

```text
request
-> structured clarification and acceptance criteria
-> trustworthy knowledge loading
-> persisted state and task DAG
-> isolated implementation
-> test and review gates
-> approved build/deploy
-> concrete API/UI verification
-> approved delivery
-> complete evidence and replayable trace
```

## 17. Decisions

Resolved decisions:

| Topic | Decision |
| --- | --- |
| Project Skill location | `.codex/skills/` remains the project source of Skill definitions |
| Knowledge location | `llm-knowledge/` |
| Runtime state | `.harness/states/` with run-specific files; templates remain immutable |
| Artifact location | `.harness/outputs/` and `.harness/reports/`, evolving to run-specific evidence directories |
| Knowledge format | Markdown + YAML + JSON |
| Knowledge architecture | Deterministic L1 + optional OpenAI L2 + local L3 index |
| Entry/core split | PowerShell entry points plus Node core |
| Failure behavior | External semantic/embedding failure must not block deterministic baseline generation |
| External writes | Publish, deploy, commit, push, PR, branch deletion, and worktree cleanup require approval |

Decisions required before the relevant milestone starts:

1. Select and verify the supported Codex project Skill/plugin installation mechanism for M4.
2. Select the active-run discovery convention and any Codex lifecycle hooks for M2.
3. Identify the safe API/UI verification environment, authentication method, and allowed test data for M6.
4. Define which git operations may be automated after approval: worktree create, branch create, merge, commit, push, and PR creation.
5. Decide whether embeddings will be consumed by a tested retriever or remain disabled.
6. Provide and approve OpenAI credentials/model configuration only when a live semantic test is desired.

## 18. Immediate Next Implementation Batch

The next code change should implement M0 and the highest-risk part of M1. It should not start Agent dispatch, Worktree execution, deployment, or git automation.

Scope:

1. Reconcile stale status documents and registries.
2. Detect and resolve obsolete knowledge scaffold modules without deleting manual content.
3. Fix mode-aware/common-aware knowledge retrieval.
4. Add parser coverage for the actual frontend API generic patterns and backend resources/migrations.
5. Add module-scoped refresh.
6. Add semantic mocked-success and malformed-output tests.
7. Decide and document whether embeddings are implemented end-to-end or disabled.

Expected files are limited to Harness, project Skill, knowledge, and documentation areas. Backend/frontend business behavior must remain unchanged.

Exit criteria:

```powershell
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
```

After this batch passes, M2 deterministic state runtime becomes the next implementation target.
