# FrontierScan Knowledge Overview

FrontierScan is a Spring Boot 3 + Vue 3 B2B admin system for collecting, organizing, and presenting technology and AI frontier website information.

Top-level areas:

| Area | Path | Notes |
| --- | --- | --- |
| Backend service | `backend/` | Spring Boot 3, Java 17, Maven, PostgreSQL, Redis, Flyway, Spring Security, JPA/MyBatis-Plus |
| Frontend admin | `frontend/` | Vue 3, TypeScript, Vite, Pinia, Vue Router, Axios |
| Operations docs | `docs/` | Architecture, local development, AI handover, Harness planning |
| Harness runtime | `.harness/` | State/DAG schemas, workflow contracts, templates, deterministic helpers, and tests |
| Project Skills | `.codex/skills/` | 13 project-local Skill definitions with mixed runtime readiness |

Progressive query entry points:

1. Backend work: start with `backend/meta.yaml`, then load the relevant backend module docs.
2. Frontend work: start with `frontend/meta.yaml`, then load route, component, API usage, and UI convention docs.
3. Cross-cutting work: start with `common/conventions/` and `common/tech/`.
4. Quality gate work: load `common/conventions/quality-gates.md`, then the relevant Skill references.
5. Execution and verification work: load `common/conventions/execution-verification.md`, then the relevant Skill references.
6. Build/publish/git delivery work: load `common/conventions/delivery.md`, then the relevant Skill references.

Current knowledge status:

| Layer | Status | Evidence |
| --- | --- | --- |
| L1 deterministic baseline | `fresh` | 7 backend modules, 7 frontend modules, and Common knowledge with Markdown + `facts.json` |
| L2 OpenAI semantic enrichment | `pending` | Mock success/failure/timeout/malformed/schema-invalid paths pass; no live API call has completed controlled acceptance |
| L3 local index | `fresh` | 324 generated and curated keyword/metadata chunks in `index/chunks.json` |
| Optional embeddings | `disabled` | Write-only vectors are blocked until a tested retrieval consumer exists |

Current limitations:

- Static extraction is intentionally bounded and reports unsupported root-level files in `source-coverage.json` instead of claiming full parser coverage.
- Semantic content remains `pending` until explicitly generated with an approved `OPENAI_API_KEY`.
- Project-local Skills and Agent roles are not an automatically dispatched runtime.
- State schemas and workflow contracts exist, but deterministic phase advancement and resume are not implemented.

Trust rule:

- Always inspect `baseline_status`, `semantic_status`, `index_status`, `source_fingerprint`, and source references.
- Treat L1 as traceable static facts and L2 as optional interpretation; verify security and business semantics against cited source files.
