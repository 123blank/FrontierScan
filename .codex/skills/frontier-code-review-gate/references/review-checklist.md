# Review Checklist

Review changed files first, then read only the adjacent context needed to verify the risk.

## Scope

- Identify the task, story, or DAG node being reviewed.
- Separate task-owned changes from unrelated dirty files.
- Confirm implementation matches acceptance criteria and technical design.
- Check that generated Harness artifacts are consistent with schemas and templates.

## Backend

- API contract matches frontend usage and documented behavior.
- Controller, service, repository, DTO, and error-handling boundaries stay consistent.
- Data writes are intentional and reversible where appropriate.
- Date and time behavior is explicit when business dates are involved.
- Validation rejects invalid or ambiguous input.
- Exceptions return useful operational signals without leaking secrets.

## Frontend

- API calls, route usage, state updates, and error handling match backend contracts.
- Loading, empty, success, and failure states are handled.
- Tables, filters, dialogs, and actions follow existing local patterns.
- Text fits inside controls at likely desktop and mobile widths.

## Harness

- State files validate against their schema.
- Task DAGs are acyclic and do not parallelize shared-file edits.
- Reports use the matching template and include scope, evidence, and residual risk.
- Scripts are deterministic and do not publish, commit, push, or mutate business code unexpectedly.

## Tests

- Required test gates are present for every changed area.
- Skipped tests include reason and risk.
- New behavior has direct verification or an explicit test gap.
