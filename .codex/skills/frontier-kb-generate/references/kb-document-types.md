# KB Document Types

Use the existing `llm-knowledge/` layout and keep documents short enough for progressive loading.

## Backend Module Documents

| Document | Purpose |
| --- | --- |
| `overview.md` | Module purpose, major responsibilities, important packages/classes |
| `interfaces.md` | Controllers, endpoints, DTOs, API contracts, integration points |
| `architecture.md` | Internal service flow, dependencies between packages, async jobs |
| `dependencies.md` | Libraries, framework features, external services |
| `storage.md` | Entities, repositories, migrations, database/cache usage |
| `config.md` | Properties, environment variables, scheduling, security config |
| `pitfalls.md` | Known risks, edge cases, operational traps |
| `log.md` | Append-only generation and manual-update log |

## Frontend Module Documents

| Document | Purpose |
| --- | --- |
| `overview.md` | UI module purpose and main workflows |
| `routes.md` | Route map and page ownership |
| `components.md` | Reusable components and view-level composition |
| `api-usage.md` | Axios clients, backend contract usage, error handling |
| `state.md` | Pinia stores, auth/session state, cross-page state |
| `pitfalls.md` | UI guideline risks, empty/loading/error states, known quirks |
| `log.md` | Append-only generation and manual-update log |

## Common Documents

- `common/conventions/*.md`: workflow, testing, quality gates, project conventions.
- `common/tech/*.md`: technology stack and cross-cutting infrastructure.
