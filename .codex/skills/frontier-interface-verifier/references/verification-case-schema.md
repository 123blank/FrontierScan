# Verification Case Schema

Each verification case should be concrete before execution.

| Field | Meaning |
| --- | --- |
| `case_id` | Stable identifier, usually `<task>-C<n>` |
| `task_id` | Source task from the DAG |
| `type` | `api`, `ui-flow`, `api-or-ui-flow`, or `manual-check` |
| `request_or_action` | URL/request body, command, or UI action sequence |
| `expected` | Observable expected result |
| `actual` | Observed result after execution |
| `result` | `pending`, `pass`, `fail`, `blocked`, or `skipped` |
| `evidence` | Response summary, screenshot path, logs, or terminal output |

Use `.harness/scripts/derive-interface-cases.ps1` to create drafts from task acceptance criteria.
