# Acceptance Criteria Rules

Acceptance criteria must be concrete enough for later test, review, and verification phases.

## Good Criteria

- Names the user-visible or API-visible behavior.
- Includes input, action, and expected result.
- Can be verified by test, build, API call, UI check, or documented manual check.
- Mentions important negative cases.

## Avoid

- "Works correctly"
- "Optimize UI"
- "Improve backend"
- "Handle errors" without naming the error and expected behavior

## Suggested Categories

- Backend API behavior
- Frontend UI behavior
- Data persistence or migration behavior
- Auth/security behavior
- Empty/loading/error state behavior
- Performance or operational behavior

## Minimum Bar

Every State v2 story must have at least one required acceptance criterion. If behavior is unknown, create a discovery story with acceptance criteria for the discovery result.

Each criterion uses:

| Field | Rule |
| --- | --- |
| `criterionId` | Stable and unique within the Story, such as `AC-001`. |
| `description` | Observable behavior or result. |
| `source` | User request, approved design, or discovery evidence. |
| `required` | `true` blocks completion until accepted; `false` is tracked without blocking required completion. |

Later DAG nodes, test cases, and verification cases reference `criterionId`. Text similarity or an unrelated passing test does not satisfy coverage.
