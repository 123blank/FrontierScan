# FrontierScan Knowledge Overview

FrontierScan is a Spring Boot 3 + Vue 3 B2B admin system for collecting, organizing, and presenting technology and AI frontier website information.

Top-level areas:

| Area | Path | Notes |
| --- | --- | --- |
| Backend service | `backend/` | Spring Boot 3, Java 17, Maven, PostgreSQL, Redis, Flyway, Spring Security, JPA/MyBatis-Plus |
| Frontend admin | `frontend/` | Vue 3, TypeScript, Vite, Pinia, Vue Router, Axios |
| Operations docs | `docs/` | Architecture, local development, AI handover, Harness planning |
| Harness runtime | `.harness/` | State schemas, state templates, workflow outputs |
| Project Skills | `.codex/skills/` | Planned project-local Skills |

Progressive query entry points:

1. Backend work: start with `backend/meta.yaml`, then load the relevant backend module docs.
2. Frontend work: start with `frontend/meta.yaml`, then load route, component, API usage, and UI convention docs.
3. Cross-cutting work: start with `common/conventions/` and `common/tech/`.
4. Quality gate work: load `common/conventions/quality-gates.md`, then the relevant Skill references.
5. Execution and verification work: load `common/conventions/execution-verification.md`, then the relevant Skill references.
6. Build/publish/git delivery work: load `common/conventions/delivery.md`, then the relevant Skill references.

Known gaps:

- Detailed backend module docs are only scaffolded.
- Detailed frontend module docs are only scaffolded.
- Automated freshness checks are not implemented yet.
