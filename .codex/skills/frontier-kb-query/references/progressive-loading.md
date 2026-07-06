# Progressive Loading Rules

Use progressive loading to keep context focused.

## Order

1. Load `llm-knowledge/overview.md`.
2. Select an area:
   - `backend`
   - `frontend`
   - `common`
   - `all`
3. Read the relevant `meta.yaml`.
4. Query for precise terms.
5. Load only matched files and their immediate custom notes.

## Area Guidance

Backend:

- Start with `llm-knowledge/backend/meta.yaml`.
- Prefer `interfaces.md` for endpoint questions.
- Prefer `storage.md` for database questions.
- Prefer `config.md` for environment/config questions.

Frontend:

- Start with `llm-knowledge/frontend/meta.yaml`.
- Prefer `routes.md` for navigation questions.
- Prefer `components.md` for UI implementation questions.
- Prefer `api-usage.md` for frontend/backend contract questions.

Common:

- Use `llm-knowledge/common/conventions/` for workflow and testing rules.
- Use `llm-knowledge/common/tech/` for stack-level facts.

## Staleness

If a relevant file says `scaffold`, `generated_at` is empty, or `git_hash` is empty, treat it as incomplete knowledge and verify against source code before implementation.
