# FrontierScan M1.1 Source Fingerprint Freshness Report

> Date: 2026-07-12
> Scope: Deterministic source fingerprints for knowledge generation, query, freshness checks, and refresh tasks
> Result: Completed

## 1. Delivered Capability

M1.1 replaces Git-HEAD-based knowledge freshness with content-based SHA-256 source fingerprints.

- Backend scope: `backend/src/**`
- Frontend scope: `frontend/src/**`
- Common scope: `AGENTS.md`, `llm-knowledge/common/**`, `.harness/workflows/**`, `.codex/skills/**`
- Excluded: generated backend/frontend/index knowledge, `docs/**`, credentials, environment files, Git internals, and build output

`git_hash` remains available for traceability but no longer decides whether knowledge is fresh.

## 2. Main Changes

- Added `.harness/scripts/lib/source-fingerprint.mjs` as the only fingerprint implementation used by Node and PowerShell workflows.
- Added deterministic ordinal path sorting, raw-byte hashing, path traversal rejection, symlink exclusion, and sanitized read failures.
- Added area fingerprints for backend, frontend, and Common.
- Added module fingerprints for baseline/semantic document isolation and module-scoped refresh.
- Added fingerprints to generated Markdown frontmatter, index chunks, area metadata, and the index manifest.
- Changed `kb-query.ps1` to compare current area contents with manifest fingerprints.
- Changed `check-kb-freshness.ps1` to compare meta/index fingerprints while retaining Git status only for module-target suggestions.
- Added Common freshness findings and repair command `generate-kb.ps1 -Area all -Mode baseline`.
- Expanded Common Skill ingestion to include Skill references, README files, and the YAML registry; directory-only `.gitkeep` files are excluded from fingerprints.
- Legacy artifacts without fingerprints now fail closed and request one baseline migration.

No backend or frontend business source was modified.

## 3. TDD Evidence

| Task | Observed RED | GREEN result |
| --- | --- | --- |
| Shared engine | `ERR_MODULE_NOT_FOUND` for `source-fingerprint.mjs` | Determinism, area isolation, exclusions, CLI, path safety, and failure sanitization pass |
| Generator integration | `meta.yaml` lacked `source_fingerprint` | Area/module/document/chunk/manifest fingerprints pass all Generator regressions |
| Query lifecycle | Dirty source reason remained `working-tree source changes` | Source mismatch, dirty regeneration, commit stability, docs exclusion, and Skill isolation pass |
| Freshness lifecycle | Refresh task still used working-tree changes as authority | Backend/frontend/Common fingerprint findings and repairable refresh commands pass |
| PowerShell hardening | Single module array degraded to character `a` | Explicit array handling restores `-Module article` and all tests pass |

Each production change was made only after its corresponding test failed for the expected missing behavior.

## 4. Metadata Contract

Area metadata records:

```yaml
source_fingerprint: "sha256:<64 lowercase hex>"
source_fingerprint_status: complete
```

Module freshness records baseline and semantic fingerprints independently. The index manifest records:

```json
{
  "source_fingerprints": {
    "backend": "sha256:...",
    "frontend": "sha256:...",
    "common": "sha256:..."
  },
  "source_fingerprint_status": {
    "backend": "complete",
    "frontend": "complete",
    "common": "complete"
  }
}
```

A module-scoped refresh sets the area index fingerprint only when every module baseline chunk matches current module contents. Otherwise the area remains `partial` and its manifest fingerprint is `null`.

## 5. Real Project Evidence

Real baseline regeneration processed 14 modules and wrote 125 knowledge artifacts.

| Area | Fingerprint | Status | Freshness |
| --- | --- | --- | --- |
| Backend | `sha256:1ba1602ffd15d0695752a7d2febb48232404028c0009888b70d1c20d46c1b387` | complete | Baseline fresh, Index fresh, Semantic pending |
| Frontend | `sha256:5a7a72c184158233e4d4fd9a7abfb4a81e6e035c6dfc28ce4b90460bb017db5e` | complete | Baseline fresh, Index fresh, Semantic pending |
| Common | `sha256:317062e2c3d95b9900e4b4bd5467ddbe17f1a17a76243fdc9f93b985888ed3f1` | complete | Baseline fresh, Index fresh, Semantic pending |

Backend and frontend source coverage both report zero failed files. The final manifest contains 324 chunks across backend, Common, and frontend; Skill reference and registry chunks are present. Real `ArticleController`, `dashboard`, and `quality gate` queries use the local index and report `Index freshness: fresh`.

## 6. Verification Commands

```powershell
node .\.harness\scripts\tests\source-fingerprint.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
git diff --check
git status --short -- backend/src frontend/src
```

## 7. Safety and Remaining Work

Final verification results:

| Gate | Result |
| --- | --- |
| Source fingerprint regression | Pass |
| Harness status regression | Pass |
| Generator regression | Pass |
| Query regression | Pass |
| Freshness/refresh-task regression | Pass |
| Node syntax checks | Pass |
| Structure validation | Pass: 16 directories, 102 required files, 13 Skills |
| Full Harness smoke | Pass |
| `git diff --check` | Pass; line-ending notices only |
| Business source audit | Empty for `backend/src` and `frontend/src` |

- The existing `OPENAI_API_KEY` was not read, printed, or sent to any service in this batch.
- No OpenAI API call was made.
- No staging, commit, push, publish, deployment, branch deletion, or Worktree operation was performed.
- The next independent business capability is live L2 semantic enrichment acceptance using the configured environment key.
