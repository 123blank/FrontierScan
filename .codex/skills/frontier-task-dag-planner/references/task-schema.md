# Task DAG Schema Guidance

Use `.harness/schemas/task-dag.schema.json` as the authoritative structural schema.

## Task Node Fields

| Field | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Use `T1`, `T2`, etc. |
| `title` | yes | Short implementation-oriented title. |
| `type` | yes | One of `backend`, `frontend`, `database`, `docs`, `test`, `integration`, `unknown`. |
| `status` | yes | Usually `pending` during planning. |
| `predictedFiles` | yes | Files or directories likely to be touched. |
| `acceptanceCriteria` | yes | Criteria this task contributes to satisfying. |

Optional but recommended:

- `ownerAgent`
- `knowledgeUsed`
- `notes`
- `risk`

## Edge Fields

Edges mean `from` must finish before `to`.

| Field | Required | Notes |
| --- | --- | --- |
| `from` | yes | Source task ID. |
| `to` | yes | Target task ID. |
| `reason` | yes | Why the dependency exists. |

## Waves

`waves` is an array of arrays. Tasks in the same wave may run in parallel if conflict policy allows it.

Example:

```json
"waves": [["T1"], ["T2", "T3"]]
```
