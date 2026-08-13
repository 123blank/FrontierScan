# Verification Case Schema

Each verification case should be concrete before execution.

| Field | Meaning |
| --- | --- |
| `caseId` | Stable identifier, usually `VC-<n>` |
| `type` | `api`, `ui-flow`, or `manual` |
| `required` | Whether this case is required evidence. |
| `criterionIds` | One or more stable requirement criterion IDs. |
| `action` | URL/request body, command, or UI action sequence. |
| `expected` | Observable expected result |
| `actual` | Observed result after execution |
| `status` | `verified`, `accepted-with-known-gaps`, `failed`, or `blocked` |
| `evidencePath` / `evidenceSha256` | Current repository evidence identity. |
| `approvalId` | Required only for `accepted-with-known-gaps`. |
| `executedAt` | ISO-8601 execution time. |

Use `.harness/scripts/derive-interface-cases.ps1` to create DAG 2.0 drafts. Drafts intentionally omit fabricated actual results and evidence.
