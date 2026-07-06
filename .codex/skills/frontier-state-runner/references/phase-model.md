# Frontier Harness Phase Model

Use this reference to decide where a workflow is and what must exist before it advances.

## Product State Phases

| Phase | Owner | Purpose | Required Evidence Before Next Phase |
| --- | --- | --- | --- |
| `breakdown` | `product-analyst` | Split a product request into stories. | Stories with IDs, titles, affected modules, and acceptance criteria. |
| `forking` | `task-planner` | Run story workflows independently through review. | Each story has an active E2E state file and status evidence. |
| `joining` | `backend-developer` | Merge reviewed work and run integration gates. | Merge/build/verification evidence or a blocking report. |
| `done` | `git-committer` | Final delivery is prepared after approval. | Delivery report and user-approved git actions, if any. |
| `blocked` | any | Workflow cannot continue. | Blocking reason, owner, and next required decision. |

## E2E State Phases

| Phase | Owner | Purpose | Required Evidence Before Next Phase |
| --- | --- | --- | --- |
| `requirement` | `requirement-analyst` | Clarify request and acceptance criteria. | Requirement summary, open questions, acceptance criteria. |
| `technical-design` | `requirement-analyst` | Produce implementation approach. | Technical design output and affected modules. |
| `task-dag` | `task-planner` | Create task graph and wave plan. | Valid task DAG and surfaced global changes. |
| `implementation` | `backend-developer` | Implement task-owned changes. | Implementation notes and owned file list. |
| `unit-test` | `unit-tester` | Run selected tests/builds. | Test report with pass/fail/skipped reasons. |
| `code-review` | `code-reviewer` | Review diff without modifying code. | Review report; no unresolved BLOCKER findings. |
| `build-publish` | `publisher` | Build and optionally publish. | Build report; publish approval if publish occurred. |
| `interface-verification` | `interface-verifier` | Verify behavior against acceptance criteria. | Verification report or explicit environment-unavailable note. |
| `git-delivery` | `git-committer` | Prepare commit/PR after approval. | Delivery report and user-approved git actions, if any. |
| `done` | any | Story workflow is complete. | All required gates have evidence. |
| `blocked` | any | Story cannot continue. | Blocking reason, owner, and next required decision. |

## Quality Gate Rules

- `task-dag` cannot advance if DAG validation fails.
- `unit-test` cannot advance if required tests fail.
- `code-review` cannot advance with unresolved BLOCKER findings.
- `build-publish` cannot publish without explicit user approval.
- `git-delivery` cannot stage, commit, push, or open PRs without explicit user approval.
