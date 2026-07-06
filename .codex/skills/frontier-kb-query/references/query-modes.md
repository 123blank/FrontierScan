# Frontier KB Query Modes

Choose the narrowest mode that satisfies the task.

| Mode | Use For | Preferred Area | Typical Files |
| --- | --- | --- | --- |
| `requirement-breakdown` | Turning product requests into stories and affected modules. | `all` | `overview.md`, `meta.yaml`, module overviews, custom notes |
| `technical-design` | Designing backend/frontend/data changes. | `all` | architecture, dependencies, storage, routes, components |
| `api-search` | Finding backend endpoints or frontend API clients. | `backend` or `frontend` | interfaces, api-usage |
| `knowledge-qa` | Answering project questions. | `all` | any matched knowledge file |
| `frontend-ui-search` | UI routes, components, stores, and B2B admin patterns. | `frontend` | routes, components, state, pitfalls |
| `data-flow-trace` | Understanding data movement across API, persistence, and UI. | `all` | interfaces, storage, api-usage, architecture |

Default to `knowledge-qa` only when the request does not fit a more specific mode.

If results are broad or noisy, rerun with a narrower `Area` or more specific query terms.
