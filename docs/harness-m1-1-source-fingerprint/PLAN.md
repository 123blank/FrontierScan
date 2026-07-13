# FrontierScan M1.1 Source Fingerprint Freshness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Every production change follows red-green-refactor and is verified before the next capability begins.

**Goal:** Replace Git-HEAD-based knowledge freshness with deterministic area and module source fingerprints, so generation, query, commit, and module-scoped refresh produce correct freshness results.

**Architecture:** Add one shared Node.js SHA-256 fingerprint engine. The generator imports it directly; PowerShell query and freshness scripts call its JSON CLI, ensuring all consumers use identical source scopes and canonical hashing. `git_hash` remains audit metadata, while source fingerprints become the freshness authority.

**Tech Stack:** Node.js ESM and built-in `node:crypto`/`node:fs`, PowerShell 5.1+, Markdown/YAML/JSON knowledge artifacts, existing script-based test harness.

---

## 1. Scope

This plan delivers one capability only: M1.1 source-fingerprint freshness.

Included source scopes:

- `backend`: `backend/src/**`
- `frontend`: `frontend/src/**`
- `common`: `AGENTS.md`, `llm-knowledge/common/**`, `.harness/workflows/**`, `.codex/skills/**`

Explicit exclusions:

- Generated backend knowledge: `llm-knowledge/backend/**`
- Generated frontend knowledge: `llm-knowledge/frontend/**`
- Generated index: `llm-knowledge/index/**`
- Ordinary project documents: `docs/**`
- Environment files, credentials, Git internals, build output, and files outside the repository root

Non-goals:

- No backend or frontend business-source modification.
- No OpenAI API call or L2 live semantic acceptance in this batch.
- No Embedding implementation.
- No state-machine, Agent runtime, Worktree execution, commit, push, publish, or deployment automation.

## 2. Accepted Design

### 2.1 Canonical fingerprint

For each selected file:

1. Convert its repository-relative path to `/` separators.
2. Sort all files by normalized relative path using ordinal ordering.
3. Read raw bytes rather than decoded text.
4. Feed SHA-256 with this unambiguous sequence per file:

```text
relative-path UTF-8 bytes
NUL
decimal byte length UTF-8 bytes
NUL
raw file bytes
NUL
```

The external value uses `sha256:<64 lowercase hex characters>`.

Fingerprint results expose:

```json
{
  "area": "backend",
  "algorithm": "sha256",
  "fingerprint": "sha256:...",
  "file_count": 89,
  "status": "complete",
  "failed_files": []
}
```

Read failures are fail-closed. The engine records only normalized path, stage, and sanitized error code; consumers must never report `fresh` when `status` is not `complete`.

### 2.2 Two freshness levels

- Area fingerprint: authoritative for backend/frontend/common index freshness.
- Module fingerprint: authoritative for baseline and semantic documents of one backend/frontend module.

Backend module fingerprints include `facts.source_files` and the resource files associated with that module. Frontend module fingerprints include `facts.source_files`. This preserves the current resource-to-module behavior without broadening source discovery.

### 2.3 Metadata contract

Area `meta.yaml` adds:

```yaml
source_fingerprint: "sha256:..."
source_fingerprint_status: complete
```

Each module freshness block adds:

```yaml
baseline_source_fingerprint: "sha256:..."
semantic_source_fingerprint: "sha256:..."
```

Generated Markdown frontmatter and generated index chunks add:

```yaml
source_fingerprint: "sha256:..."
```

Index `manifest.json` adds:

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

`git_hash` remains unchanged for audit and traceability but is not used to mark knowledge stale.

### 2.4 Partial refresh behavior

- A full area baseline refresh may advance that area's manifest fingerprint to the current value.
- A module-scoped baseline refresh advances only that module's documents and chunks.
- The area's manifest fingerprint advances only when every module's baseline chunks match the current module fingerprints.
- A semantic-only refresh changes semantic fingerprints but preserves baseline fingerprints.
- Common chunks are refreshed during `-Area all`; a stale Common refresh task therefore recommends `-Area all -Mode baseline`.
- Legacy metadata without fingerprints is `stale` with an explicit `source fingerprint missing` reason and is repaired by one baseline generation.

## 3. Success Criteria

1. Editing an in-scope source file makes only its relevant area stale.
2. Running baseline generation on a dirty working tree makes refreshed knowledge fresh without requiring a commit.
3. Committing identical source content does not change freshness.
4. Editing `docs/**` or generated knowledge does not change backend/frontend/common fingerprints.
5. Editing `.codex/skills/**` changes Common only.
6. Refreshing one module does not make another changed module fresh.
7. Missing or incomplete fingerprints never report fresh.
8. Existing semantic isolation, source coverage, query ranking, and refresh-task tests remain green.
9. No files under `backend/src` or `frontend/src` are modified.

## 4. File Map

Create:

- `.harness/scripts/lib/source-fingerprint.mjs`: shared scopes, canonical hashing, sanitized failures, and JSON CLI.
- `.harness/scripts/tests/source-fingerprint.test.mjs`: deterministic hashing and scope-isolation tests.
- `docs/harness-m1-1-source-fingerprint/REPORT.md`: final implementation and verification evidence.

Modify:

- `.harness/scripts/lib/generate-kb.mjs`: write and aggregate area/module fingerprints.
- `.harness/scripts/tests/generate-kb.test.mjs`: generator migration, dirty regeneration, commit stability, and module isolation.
- `.harness/scripts/kb-query.ps1`: compare current source fingerprints with manifest fingerprints.
- `.harness/scripts/tests/kb-query.test.ps1`: stale-before-refresh and fresh-after-refresh behavior.
- `.harness/scripts/check-kb-freshness.ps1`: fingerprint-based backend/frontend/Common findings and refresh tasks.
- `.harness/scripts/tests/kb-freshness.test.ps1`: fingerprint freshness and task-mode behavior.
- `.harness/scripts/README.md`: public freshness semantics and diagnostic commands.
- `.codex/skills/frontier-kb-generate/SKILL.md`: generator fingerprint contract.
- `.codex/skills/frontier-kb-query/SKILL.md`: query fingerprint consumption.
- `.codex/skills/frontier-kb-refresh-check/references/freshness-policy.md`: freshness authority and legacy fallback.
- `.harness/structure-manifest.yaml`: require the shared engine, its test, and this business documentation directory/files.
- Generated `llm-knowledge/**`: regenerate only after code and tests pass.

## 5. TDD Implementation Tasks

### Task 1: Shared deterministic fingerprint engine

**Files:**

- Create: `.harness/scripts/tests/source-fingerprint.test.mjs`
- Create: `.harness/scripts/lib/source-fingerprint.mjs`

- [ ] **Step 1: Write the failing scope and determinism test**

The test creates a temporary repository fixture, computes all three areas, and asserts:

```js
assert.match(result.backend.fingerprint, /^sha256:[a-f0-9]{64}$/);
assert.equal(result.backend.status, "complete");
assert.equal(result.backend.fingerprint, repeated.backend.fingerprint);
assert.notEqual(afterBackendEdit.backend.fingerprint, result.backend.fingerprint);
assert.equal(afterBackendEdit.frontend.fingerprint, result.frontend.fingerprint);
assert.equal(afterDocsEdit.backend.fingerprint, afterBackendEdit.backend.fingerprint);
assert.notEqual(afterSkillEdit.common.fingerprint, result.common.fingerprint);
```

It also injects a read failure and asserts `status: incomplete`, a repository-relative path, and an error value that contains the error code but not the original exception message.

- [ ] **Step 2: Run the test and observe RED**

```powershell
node .\.harness\scripts\tests\source-fingerprint.test.mjs
```

Expected: failure because `source-fingerprint.mjs` does not exist.

- [ ] **Step 3: Implement the minimal shared engine**

Required exports:

```js
export async function computeAreaSourceFingerprint(root, area, options = {})
export async function computeSourceFingerprints(root, areas, options = {})
export async function computeFileSetFingerprint(root, relativeFiles, options = {})
```

Supported CLI:

```powershell
node .\.harness\scripts\lib\source-fingerprint.mjs --root <repo> --area backend --json
node .\.harness\scripts\lib\source-fingerprint.mjs --root <repo> --area all --json
```

The implementation uses only Node built-ins, rejects paths escaping the repository root, skips symlinks, sorts normalized paths, hashes raw bytes, and sanitizes failures to stable error codes.

- [ ] **Step 4: Run the test and observe GREEN**

```powershell
node .\.harness\scripts\tests\source-fingerprint.test.mjs
```

Expected: `source-fingerprint tests passed`.

### Task 2: Generator metadata and partial-refresh correctness

**Files:**

- Modify: `.harness/scripts/tests/generate-kb.test.mjs`
- Modify: `.harness/scripts/lib/generate-kb.mjs`

- [ ] **Step 1: Write the failing generator contract test**

Add assertions that a full baseline run writes area, module, document, chunk, and manifest fingerprints. Add a scenario that:

1. Generates baseline.
2. Modifies article and auth.
3. Refreshes article only.
4. Verifies article uses its current module fingerprint.
5. Verifies auth retains its previous fingerprint and remains stale.
6. Verifies backend index remains partial/stale.

Add a second scenario that regenerates the full dirty backend, then creates an empty Git commit and verifies freshness inputs remain unchanged.

- [ ] **Step 2: Run and observe RED**

```powershell
node .\.harness\scripts\tests\generate-kb.test.mjs
```

Expected: missing `source_fingerprint` metadata assertions fail.

- [ ] **Step 3: Implement minimal generator integration**

Import the shared engine. Compute fingerprints once per generation scan, attach module fingerprints to module objects, include them in frontmatter/chunks, parse them from existing documents, and replace `normalizedDocumentStatus` hash comparison with fingerprint comparison.

Generation rules:

```js
const isCurrent = documentFingerprint
  && currentFingerprint.status === "complete"
  && documentFingerprint === currentFingerprint.fingerprint;
```

Do not remove existing `git_hash` fields. Preserve semantic chunks during baseline mode and baseline chunks during semantic mode.

- [ ] **Step 4: Run and observe GREEN**

```powershell
node .\.harness\scripts\tests\generate-kb.test.mjs
```

Expected: `generate-kb tests passed`.

### Task 3: Query consumes manifest fingerprints

**Files:**

- Modify: `.harness/scripts/tests/kb-query.test.ps1`
- Modify: `.harness/scripts/kb-query.ps1`

- [ ] **Step 1: Write the failing query lifecycle test**

The fixture must assert this sequence:

```text
matching manifest fingerprint -> fresh
backend source edit -> stale with source fingerprint mismatch
manifest updated to current fingerprint -> fresh while working tree remains dirty
empty Git commit -> still fresh
docs edit -> backend still fresh
```

Add a Common assertion showing a Skill edit changes Common but not backend.

- [ ] **Step 2: Run and observe RED**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
```

Expected: current working-tree/HEAD checks keep regenerated dirty knowledge stale or make an empty commit stale.

- [ ] **Step 3: Implement fingerprint comparison**

Replace `manifest.git_hash` and generic dirty-path freshness decisions with one invocation of the shared JSON CLI. Compare only selected-area fingerprints; for `all`, compare backend, frontend, and common. Preserve chunk-count validation and semantic/embedding status output.

Required reasons:

```text
source fingerprint missing
source fingerprint mismatch
source fingerprint incomplete
```

- [ ] **Step 4: Run and observe GREEN**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
```

Expected: `kb-query tests passed`.

### Task 4: Freshness checker and refresh-task repair

**Files:**

- Modify: `.harness/scripts/tests/kb-freshness.test.ps1`
- Modify: `.harness/scripts/check-kb-freshness.ps1`

- [ ] **Step 1: Write the failing freshness lifecycle test**

Assert backend/frontend against their area meta fingerprints and Common against manifest Common fingerprint. Test:

- Source mismatch produces baseline refresh.
- Full dirty regeneration produces no refresh requirement.
- Empty commit does not change freshness.
- Semantic-only failure still produces `-Mode semantic`.
- Common mismatch produces `-Area all -Mode baseline` without automatic execution.
- Missing legacy fingerprint produces baseline migration task.

- [ ] **Step 2: Run and observe RED**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
```

Expected: HEAD and dirty-path reasons incorrectly classify at least the dirty-regenerated or empty-commit scenario.

- [ ] **Step 3: Implement minimal checker integration**

Invoke the fingerprint CLI once with `--area all --json`. Remove Git-hash equality from freshness decisions but retain current/recorded Git hashes in JSON output. Use fingerprint mismatch/incomplete flags in `Get-RefreshMode`; retain the existing semantic/baseline/all mode precedence.

- [ ] **Step 4: Run and observe GREEN**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
```

Expected: `kb-freshness tests passed`.

### Task 5: Contracts, structure, and documentation

**Files:**

- Modify: `.harness/scripts/README.md`
- Modify: `.codex/skills/frontier-kb-generate/SKILL.md`
- Modify: `.codex/skills/frontier-kb-query/SKILL.md`
- Modify: `.codex/skills/frontier-kb-refresh-check/references/freshness-policy.md`
- Modify: `.harness/structure-manifest.yaml`

- [ ] **Step 1: Add the new required files and directory to the structure manifest**

Require:

```yaml
- docs/harness-m1-1-source-fingerprint
- .harness/scripts/lib/source-fingerprint.mjs
- .harness/scripts/tests/source-fingerprint.test.mjs
- docs/harness-m1-1-source-fingerprint/PLAN.md
- docs/harness-m1-1-source-fingerprint/REPORT.md
```

- [ ] **Step 2: Document the public behavior**

Document that source fingerprints are authoritative, `git_hash` is audit-only, legacy artifacts require one baseline migration, and Common refresh uses `-Area all -Mode baseline`.

- [ ] **Step 3: Run structure validation**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
```

Expected: pass with the incremented directory and required-file counts.

### Task 6: Real-project regeneration and final verification

**Files:**

- Regenerate: `llm-knowledge/backend/**`
- Regenerate: `llm-knowledge/frontend/**`
- Regenerate: `llm-knowledge/index/**`
- Create: `docs/harness-m1-1-source-fingerprint/REPORT.md`

- [ ] **Step 1: Run all focused regressions**

```powershell
node .\.harness\scripts\tests\source-fingerprint.test.mjs
node .\.harness\scripts\tests\harness-status.test.mjs
node .\.harness\scripts\tests\generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\tests\kb-freshness.test.ps1
```

- [ ] **Step 2: Regenerate real baseline knowledge**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline
```

Expected: 14 backend/frontend modules generated; Semantic remains preserved/pending unless already fresh.

- [ ] **Step 3: Verify real freshness and query behavior**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\check-kb-freshness.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\kb-query.ps1 -Query "ArticleController" -Mode api-search -Area backend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\kb-query.ps1 -Query "dashboard" -Mode frontend-ui-search -Area frontend
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\kb-query.ps1 -Query "quality gate" -Mode knowledge-qa -Area common
```

Expected: all selected areas report fresh immediately after regeneration, including a dirty Harness/Skill working tree when the index contains those exact source contents.

- [ ] **Step 4: Run full non-destructive gates**

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\validate-structure.ps1 -Root "D:\ProjectStudy\FrontierScan"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\.harness\scripts\smoke-harness-flow.ps1 -Root "D:\ProjectStudy\FrontierScan" -TaskDagFile "D:\ProjectStudy\FrontierScan\.harness\templates\task-dag.example.json"
git diff --check
git status --short -- backend/src frontend/src
```

Expected: all commands exit zero; business-source audit is empty; line-ending notices are acceptable only when `git diff --check` exits zero.

- [ ] **Step 5: Write the completion report**

`REPORT.md` must include:

- Scope and non-goals.
- Every observed RED failure and corresponding GREEN result.
- Final metadata schema and migration behavior.
- Real backend/frontend/Common fingerprints without exposing file contents or secrets.
- Test, structure, smoke, whitespace, and business-source audit evidence.
- Explicit statement that OpenAI was not called in this batch.
- Remaining next step: separate live L2 semantic acceptance using the existing environment key.

## 6. Safety and Delivery Rules

- Do not read or print `OPENAI_API_KEY`.
- Do not read `.env`, credentials, shell history, or files outside the approved source scopes.
- Do not modify `backend/src`, `frontend/src`, or unrelated dirty files.
- Do not stage, commit, push, publish, deploy, delete branches, or delete Worktrees.
- Use `apply_patch` for manual edits.
- Complete and verify each TDD task before beginning the next task.
- If a test exposes an architectural contradiction, stop and discuss it before broadening scope.

## 7. Plan Self-Review

- Scope coverage: area/module generation, query, freshness, Common, migration, and partial refresh are covered.
- Placeholder scan: no unfinished markers or deferred implementation steps remain.
- Type consistency: all metadata uses `source_fingerprint` for document/module values and `source_fingerprints` for manifest area mapping.
- Safety check: no business source, OpenAI call, Git delivery, or external service mutation is included.
- Execution order: each capability has an isolated RED, minimal GREEN, and regression gate before the next capability.
