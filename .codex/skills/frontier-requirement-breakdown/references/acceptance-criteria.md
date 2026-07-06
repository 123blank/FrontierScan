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

Every story must have at least one acceptance criterion. If behavior is unknown, create a discovery story with acceptance criteria for the discovery result.
