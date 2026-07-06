---
name: frontier-kb-generate
description: Use when generating or updating FrontierScan structured llm-knowledge documents from backend, frontend, database, API, and existing docs, including overview, interfaces, architecture, dependencies, storage, config, pitfalls, and logs.
---

# Frontier KB Generate

Use this Skill when building or refreshing `llm-knowledge/` before planning, design, review, or verification.

## Quick Workflow

1. Read `references/kb-document-types.md`.
2. Read `references/manual-note-preservation.md`.
3. Read `references/module-detection.md`.
4. Scan source structure:

```powershell
.\.harness\scripts\scan-knowledge-inputs.ps1
```

5. Update only the requested or clearly stale knowledge files.
6. Preserve all `custom/` notes and append generation notes to `log.md`.
7. Run freshness check:

```powershell
.\.harness\scripts\check-kb-freshness.ps1
```

## Outputs

- `llm-knowledge/backend/meta.yaml`
- `llm-knowledge/frontend/meta.yaml`
- Module-level knowledge documents
- Append-only `log.md`
- Optional `.harness/reports/knowledge-input-scan.md`

## Safety Rules

- Do not overwrite manual `custom/` notes.
- Do not copy secrets.
- Do not regenerate broad knowledge when the current task needs only one module.
- Mark generated docs as stale or incomplete when source files changed and regeneration is incomplete.
