# Freshness Policy

Knowledge is advisory unless freshness is checked.

## Fresh Signals

- `meta.yaml` has a non-empty `freshness.git_hash`.
- `meta.yaml` has a non-empty `freshness.generated_at`.
- `freshness.status` is `fresh`.
- The recorded hash matches current `git rev-parse HEAD`.
- The relevant source area has no working-tree changes.

## Stale Or Incomplete Signals

- `freshness.git_hash` is empty or differs from current HEAD.
- `freshness.generated_at` is empty.
- `freshness.status` is `scaffold`, `stale`, or anything other than `fresh`.
- Backend source changed and backend knowledge is being used.
- Frontend source changed and frontend knowledge is being used.
- The required knowledge document is missing or scaffold-only.

## Required Behavior

- Report stale knowledge explicitly.
- Use source files directly when knowledge is stale.
- Create refresh tasks instead of silently trusting stale docs.
- Preserve manual `custom/` notes during refresh.
