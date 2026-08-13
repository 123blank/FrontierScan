# Task DAG Schema Guidance

State v2 uses `.harness/schemas/task-dag-v2.schema.json` as the authoritative schema. Historical State v1 fixtures continue to use `.harness/schemas/task-dag.schema.json`.

## Task Node Fields

| Field | Required | Notes |
| --- | --- | --- |
| `taskId` | yes | Use `T1`, `T2`, etc. |
| `title` | yes | Short implementation-oriented title. |
| `type` | yes | One of `backend`, `frontend`, `database`, `docs`, `test`, `integration`, `unknown`. |
| `status` | yes | Must be `pending` in the applied planning document. |
| `predictedFiles` | yes | Files or directories likely to be touched. |
| `criterionIds` | yes | Stable requirement criterion IDs this task contributes to. |
| `ownerAgent` | yes | Registered owner role. |

DAG 2.0 nodes reject undeclared fields. Do not include the v1 `acceptanceCriteria`, `knowledgeUsed`, `notes`, or `risk` fields.

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
