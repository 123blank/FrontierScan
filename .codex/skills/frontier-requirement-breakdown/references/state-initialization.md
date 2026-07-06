# State Initialization Mapping

Use this reference after requirement breakdown to prepare state initialization values.

Do not edit `.harness/states/*.template.json` directly.

## Single Story

When the request produces one story, initialize an E2E state file from:

```text
.harness/states/e2e-state.template.json
```

Recommended active file:

```text
.harness/states/e2e-S1.json
```

Field mapping:

| Breakdown Field | E2E State Field |
| --- | --- |
| `storyId` | `storyId` |
| source request summary | `requirement.summary` |
| blocking questions | `requirement.openQuestions` |
| acceptance criteria | `requirement.acceptanceCriteria` |
| knowledge files loaded | `knowledge.loadedFiles` |
| stale/missing knowledge | `knowledge.staleFiles`, `knowledge.missingAreas` |
| initial risks/notes | `logs` |

## Multiple Stories

When the request produces multiple stories, initialize product state from:

```text
.harness/states/product-state.template.json
```

Recommended active file:

```text
.harness/states/product-YYYYMMDD-HHMM-short-name.json
```

Field mapping:

| Breakdown Field | Product State Field |
| --- | --- |
| request identifier | `requestId` |
| source request | `sourceRequest` |
| stories | `stories[]` |
| story ID | `stories[].storyId` |
| story title | `stories[].title` |
| affected modules | `stories[].affectedModules` |
| acceptance criteria | `stories[].acceptanceCriteria` |
| target E2E state file | `stories[].stateFile` |

After creating an active state file, run:

```powershell
.\.harness\scripts\validate-state.ps1 -StateFile <state-file>
```
