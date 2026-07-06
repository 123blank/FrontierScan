# Manual Note Preservation

Knowledge generation must preserve human notes and historical context.

## Rules

- Do not overwrite files under any `custom/` directory.
- Do not delete existing `log.md`; append a dated entry when generation happens.
- Do not copy secrets from `.env`, shell history, local config, or untracked private files.
- Prefer summaries and source references over large copied code blocks.
- When uncertain, mark a section as `Needs source verification` instead of inventing facts.

## Regeneration Strategy

1. Scan source structure.
2. Identify documents that are missing or scaffold-only.
3. Update only the requested or clearly stale documents.
4. Preserve manual notes and append log entries.
5. Run knowledge freshness check after generation.
