# Conflict Policy

Use this policy while building task DAGs.

## File Touch Prediction

Every task must list predicted files or directories. Use directory-level entries when exact files are unknown.

Examples:

- `backend/src/main/java/com/frontierscan/**`
- `frontend/src/views/SitesView.vue`
- `frontend/src/api/sites.ts`
- `backend/src/main/resources/db/migration/**`

## Global Changes

Surface these in `globalChanges` before implementation:

- Database migrations
- Environment/config changes
- Authentication or authorization behavior
- Shared API client changes
- Shared layout, router, store, or global CSS changes
- Build/deploy configuration changes

## Conflict Handling

- Same predicted file in two tasks: do not place them in the same wave.
- Shared entry file: prefer one integration task.
- Unknown impacted files: add a discovery/planning task.
- Merge conflict: stop and diagnose; never discard user changes.
