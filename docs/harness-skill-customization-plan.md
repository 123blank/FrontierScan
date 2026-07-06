# FrontierScan Harness Skill Customization Plan

## 1. Objective

Refactor `D:\ProjectStudy\FrontierScan` toward the Harness Engineering style described in the Tencent article by first creating a project-specific custom Skill system.

This document started as the Skill creation plan. The repository now contains the first Harness structure and several basic Skill implementations, while application business code remains unchanged.

Current implementation status:

| Area | Status |
| --- | --- |
| Project-local Skill root | Created under `.codex/skills/` |
| Harness runtime root | Created under `.harness/` |
| LLM knowledge root | Created under `llm-knowledge/` |
| KB generate, KB query, KB freshness check, state runner, requirement breakdown, task DAG planner | Basic guidance implemented |
| Code review gate and test gate | Basic guidance and read-only helper scripts implemented |
| Worktree, interface verifier, build/publish, git delivery | Basic guidance implemented |

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
```

Core principle:

```text
AI handles cognition. Scripts handle deterministic execution. State files preserve workflow truth.
```

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

## 6. Recommended Initial Implementation Order

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

## 7. Minimum Viable Harness Skill Set

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

## 10. Open Decisions Before Creating Skills

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

## 11. Next Step

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
