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
| L3 local index | `fresh` | 328 generated and curated keyword/metadata chunks in `index/chunks.json` |
| Optional embeddings | `on-demand` | `-WithEmbeddings` writes source-fingerprinted JSONL vectors after successful OpenAI API calls; keyword/metadata retrieval remains the active consumer |

Current limitations:

- Static extraction is intentionally bounded and reports unsupported root-level files in `source-coverage.json` instead of claiming full parser coverage.
- Semantic content remains `pending` until explicitly generated with an approved `OPENAI_API_KEY`.
- M2 deterministic phase advancement, evidence gates, block/resume, locks, and interrupted-write recovery are implemented for a single Story.
- M3 provides a file-based single-Story Dispatcher with structured task/result/checkpoint artifacts and fixed local command adapters. It does not launch real Agent workers or provide multi-Agent concurrency.
- M4-B provides a constrained Mock Worker that consumes M3 tasks, validates explicit context and role-scoped candidate files, and writes `result.json` last. It does not launch a real Agent or grant runtime tools.
- M5-A provides a single-Worktree `plan/status/create` Harness runtime with strict DAG wave/conflict validation, pinned `dev` commits, Git-fact reconciliation, explicit create confirmation, and temporary-repository recovery tests. It does not run Workers, merge, remove, or parallelize Worktrees.
- M5-B1 provides an internal single-task Worktree Worker orchestrator with explicit input snapshots, M3 checkpoint binding, Git-fact output reconciliation, and `ready-for-apply`/`ready-for-integration` collection. It does not integrate business code, call M3 `apply`, expose a mock CLI, or support multiple tasks or Worktrees.
- M5-B2 provides approval-gated `plan/status/apply` for one `ready-for-integration` result, using content-addressed bundles, base/candidate hash reconciliation, result-last writes, and per-file recovery. It does not call M3 `apply`, merge or remove Worktrees, execute Git writes, or support multiple tasks or Worktrees.

Trust rule:

- Always inspect `baseline_status`, `semantic_status`, `index_status`, `source_fingerprint`, and source references.
- Treat L1 as traceable static facts and L2 as optional interpretation; verify security and business semantics against cited source files.
