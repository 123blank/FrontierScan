Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
- Adopt TDD as the primary approach for business development; use alternative suitable development methods only when you determine TDD is unnecessary.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

## 5. Harness Structure Guidelines

FrontierScan is being adapted toward a Harness Engineering workflow inspired by the Tencent article.

Current structural areas:

- `.harness/`: workflow state, schemas, workflow definitions, reports, templates, and deterministic scripts.
- `.codex/agents/`: planned expert Agent registry.
- `.codex/skills/`: project-local Skill scaffolds.
- `llm-knowledge/`: AI-consumable structured project knowledge.
- `docs/harness-*.md`: human-facing Harness plans and checklists.

When working on Harness structure:

- Treat `.harness/states/` as workflow state, not source code.
- Treat `llm-knowledge/` as generated or manually curated AI knowledge.
- Keep Skill and Agent scaffolds separate from runtime state.
- Do not implement publish, push, commit, or destructive git automation without explicit user approval.
- Do not touch unrelated dirty business files.
- Run `.\.harness\scripts\validate-structure.ps1` after changing Harness structure.

## 6. FrontierScan Harness Default Entry Rules

When Codex is working inside `D:\ProjectStudy\FrontierScan`, treat this file as the default operating entry point for Harness-style AI coding.

At the start of each task, classify the request before acting:

- `question`: answer from local docs, `.harness/`, `.codex/skills/`, `llm-knowledge/`, and source files as needed. Do not modify files.
- `harness-structure`: update Harness, Skill, Agent, state, workflow, template, docs, or knowledge scaffolding only.
- `business-implementation`: modify backend/frontend/product code only after checking relevant knowledge and current workflow state.
- `review`: inspect diffs and report findings first; do not modify files unless explicitly asked to fix.
- `test-or-verification`: select and run the narrowest useful tests or verification commands, then report evidence.
- `delivery`: summarize owned changes and ask for explicit approval before staging, committing, pushing, publishing, or opening PRs.

For non-trivial implementation work, state the assumed workflow phase and success criteria before editing files.

## 7. Knowledge-First Development

Use `llm-knowledge/` as the first project knowledge source before broad source-code exploration.

Before requirement analysis, design, implementation, review, or verification:

- Check knowledge freshness with `.harness\scripts\check-kb-freshness.ps1` when the task depends on existing project knowledge.
- Query relevant knowledge with `.harness\scripts\kb-query.ps1`.
- If knowledge is missing or stale, say so explicitly and verify against source files before making decisions.
- Prefer targeted source reads after knowledge lookup instead of loading unrelated modules.
- Preserve manual notes under `llm-knowledge/**/custom/` when updating generated knowledge.

Recommended query modes:

- Requirement breakdown: `-Mode requirement-breakdown`
- Technical design: `-Mode technical-design`
- API discovery: `-Mode api-search`
- Frontend UI/component lookup: `-Mode frontend-ui-search`
- Data flow tracing: `-Mode data-flow-trace`
- General project questions: `-Mode knowledge-qa`

## 8. Project Skill Routing

Project-local Skills live under `.codex/skills/`.

If a matching `frontier-*` Skill is available in the active Codex runtime, invoke it normally. If it is not available in the active runtime, manually read the matching project-local `SKILL.md` and only the directly relevant references before acting.

Use this routing map:

- General project conventions: `frontier-common`
- Generate or refresh structured knowledge: `frontier-kb-generate`
- Query structured knowledge: `frontier-kb-query`
- Check stale knowledge: `frontier-kb-refresh-check`
- Break down product or engineering requests: `frontier-requirement-breakdown`
- Plan tasks, dependencies, and parallel waves: `frontier-task-dag-planner`
- Read, validate, resume, or update workflow state: `frontier-state-runner`
- Plan isolated worktrees: `frontier-worktree-orchestrator`
- Select or run tests: `frontier-test-gate`
- Review code changes: `frontier-code-review-gate`
- Derive or run API/UI verification cases: `frontier-interface-verifier`
- Plan builds or publish steps: `frontier-build-publish`
- Prepare delivery, commits, or PR summaries: `frontier-git-delivery`

Current project-local Skills are guidance scaffolds unless the active Codex runtime exposes them as installed Skills. Do not claim they are automatically triggered by runtime unless they appear in the current available Skill list.

## 9. Agent Registry Usage

`.codex/agents/agents.yaml` is a role and responsibility registry, not an active Agent runtime.

Use it to decide which responsibility lens applies to the task:

- `product-analyst` and `requirement-analyst` for request breakdown and acceptance criteria.
- `task-planner` for DAG and dependency planning.
- `backend-developer` and `frontend-developer` for implementation.
- `unit-tester`, `test-case-designer`, and `interface-verifier` for verification.
- `code-reviewer` for review-only work.
- `publisher` and `git-committer` for approval-gated delivery.

Do not pretend that Agents have been automatically dispatched unless an actual runtime dispatch mechanism is present.

## 10. Harness Workflow Triggers

Use the single-story workflow in `.harness/workflows/e2e-development.yaml` for ordinary feature or bugfix work:

```text
requirement -> technical-design -> task-dag -> implementation -> unit-test -> code-review -> build-publish -> interface-verification -> git-delivery -> done
```

Use `.harness/workflows/product-fork-join.yaml` when one user request naturally splits into multiple independent stories:

```text
breakdown -> forking -> joining -> done
```

Trigger expectations:

- New ambiguous product request: create or update requirement breakdown before implementation.
- Multi-module change: create or update a task DAG before implementation.
- Existing active state file: read and respect it before continuing work.
- Frontend UI change: follow existing frontend patterns and any B2B admin UI guideline document present in the repo.
- Backend/data change: use narrow backend tests where possible before broader builds.
- Review/test/build/delivery phase: write evidence into `.harness/reports/` or summarize it clearly to the user when not writing files.

## 11. Required Harness Checks

Run the relevant deterministic checks after changing Harness assets:

- Structure, Skill, Agent, docs, or knowledge scaffolding changed:
  `.\.harness\scripts\validate-structure.ps1`
- State files changed:
  `.\.harness\scripts\validate-state.ps1 -StateFile <state-file>`
- Task DAG changed:
  `.\.harness\scripts\validate-task-dag.ps1 -TaskDagFile <dag-file>`
- Need knowledge lookup:
  `.\.harness\scripts\kb-query.ps1 -Query "<keywords>" -Mode <mode> -Area <area>`
- Need stale knowledge detection:
  `.\.harness\scripts\check-kb-freshness.ps1`
- Need test recommendation:
  `.\.harness\scripts\select-tests.ps1`
- Need build recommendation:
  `.\.harness\scripts\plan-build.ps1`
- Need delivery summary:
  `.\.harness\scripts\summarize-delivery.ps1`
- Need non-destructive smoke validation:
  `.\.harness\scripts\smoke-harness-flow.ps1`

These scripts are helpers. They do not replace source review, real tests, or user approval for external-state-changing actions.

## 12. Approval and Safety Boundaries

Never perform these actions without explicit user approval:

- `git add`, `git commit`, `git push`, PR creation, tagging, release, publish, or deploy.
- Destructive git or filesystem cleanup.
- Worktree deletion or branch deletion.
- Any command that modifies external services, production data, or deployment environments.

Before delivery, always separate owned task changes from unrelated dirty files. Do not revert or overwrite unrelated changes.
