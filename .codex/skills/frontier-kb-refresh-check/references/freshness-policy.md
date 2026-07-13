# Freshness Policy

Knowledge is advisory unless freshness is checked.

## Fresh Signals

- `meta.yaml` has a complete, non-empty `source_fingerprint` matching current scoped source contents.
- `manifest.json` has a complete area fingerprint matching current scoped source contents.
- `generated_at`, baseline status, and index status are complete/fresh.
- `git_hash` is retained for audit only and does not determine freshness.

## Stale Or Incomplete Signals

- A source fingerprint is missing, incomplete, or differs from current scoped source contents.
- `generated_at` is empty.
- Baseline or index status is `scaffold`, `stale`, `partial`, or otherwise incomplete.
- The required knowledge document is missing or scaffold-only.

## Required Behavior

- Report stale knowledge explicitly.
- Use source files directly when knowledge is stale.
- Create refresh tasks instead of silently trusting stale docs.
- Preserve manual `custom/` notes during refresh.
- Legacy metadata without fingerprints requires one baseline refresh.
- Common changes use `generate-kb.ps1 -Area all -Mode baseline` because Common is indexed during all-area generation.
