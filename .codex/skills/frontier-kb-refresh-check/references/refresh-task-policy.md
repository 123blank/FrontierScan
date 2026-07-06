# Refresh Task Policy

Create refresh tasks that are narrow enough to review.

## Task Shape

Each refresh task should include:

- Area: backend, frontend, common, or all.
- Source paths that triggered the refresh.
- Knowledge files to update.
- Whether source verification is required.
- Whether manual notes must be preserved.

## Priority

1. Missing or stale knowledge needed for the current user request.
2. Knowledge for files changed in the current worktree.
3. Frequently reused overview/interface/API docs.
4. Broader module split or cleanup work.

## Output

Use `.harness/reports/` for freshness reports when writing artifacts is allowed. If the user requests no file changes, summarize findings in the response instead.
