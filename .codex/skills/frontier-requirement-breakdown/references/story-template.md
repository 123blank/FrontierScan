# Story Template

Use this shape for every story produced by `frontier-requirement-breakdown`.

## Fields

| Field | Required | Notes |
| --- | --- | --- |
| `storyId` | yes | Use `S1`, `S2`, etc. |
| `title` | yes | Short action-oriented title. |
| `userValue` | yes | What user or operator value this story creates. |
| `affectedModules` | yes | Backend/frontend/data/docs modules or `discovery-needed`. |
| `knowledgeUsed` | yes | Knowledge files or query outputs used. |
| `newOrChangedBehavior` | yes | Observable behavior change. |
| `acceptanceCriteria` | yes | Concrete checks. |
| `risks` | yes | Unknowns, stale knowledge, migration/config concerns. |
| `testHints` | yes | Suggested backend/frontend/API checks. |

## Markdown Shape

```markdown
### S1 - <title>

- User value:
- Affected modules:
- Knowledge used:
- New or changed behavior:
- Acceptance criteria:
  - [ ] ...
- Risks:
- Test hints:
```

Prefer small stories that can move independently through task DAG planning.
