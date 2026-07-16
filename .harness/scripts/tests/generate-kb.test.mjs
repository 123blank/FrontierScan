import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runGenerateKnowledge } from "../lib/generate-kb.mjs";
import { computeFileSetFingerprint, computeSourceFingerprints } from "../lib/source-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(testDirectory, "../../..");
const generateScript = path.resolve(testDirectory, "../generate-kb.ps1");
const queryScript = path.resolve(testDirectory, "../kb-query.ps1");

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

async function git(root, ...args) {
  return execFileAsync("git", ["-C", root, ...args], { encoding: "utf8" });
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-kb-test-"));
  await write(
    root,
    "backend/src/main/java/com/frontierscan/article/ArticleController.java",
    `package com.frontierscan.article;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.access.prepost.PreAuthorize;
@RestController
@RequestMapping("/api/articles")
public class ArticleController {
  @GetMapping
  public String list() { return "ok"; }
  @GetMapping("/{id}")
  @PreAuthorize("isAuthenticated()")
  public ApiResponse<Article> get(@PathVariable Long id, @RequestParam(required = false) String keyword) { return null; }
  @PostMapping("/{id}/favorite")
  public String favorite(@PathVariable Long id) { return "ok"; }
}
`
  );
  await write(
    root,
    "backend/src/main/java/com/frontierscan/article/Article.java",
    `package com.frontierscan.article;
import jakarta.persistence.*;
@Entity @Table(name = "articles")
public class Article {}
`
  );
  await write(
    root,
    "backend/src/main/java/com/frontierscan/article/ArticleRepository.java",
    `package com.frontierscan.article;
import org.springframework.data.jpa.repository.JpaRepository;
public interface ArticleRepository extends JpaRepository<Article, Long> {}
`
  );
  await write(
    root,
    "backend/src/main/java/com/frontierscan/article/ArticleService.java",
    `package com.frontierscan.article;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.stereotype.Service;
@Service
public class ArticleService {
  private static final String PROMPT_TEMPLATE_PATH = "prompt_template/article-summary.stg";
  private final ArticleRepository articleRepository;
  public ArticleService(ArticleRepository articleRepository) { this.articleRepository = articleRepository; }
  @Transactional
  public Article save(Article article) { return article; }
}
`
  );
  await write(
    root,
    "backend/src/main/java/com/frontierscan/auth/AuthController.java",
    `package com.frontierscan.auth;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/auth")
public class AuthController {
  @PostMapping("/login")
  public String login() { return "ok"; }
}
`
  );
  await write(
    root,
    "backend/src/main/resources/application.yml",
    `app:
  llm:
    model: \${OPENAI_MODEL:gpt-4.1-mini}
`
  );
  await write(
    root,
    "backend/src/main/resources/db/migration/V1__initial_schema.sql",
    "create table articles(id bigint primary key);"
  );
  await write(
    root,
    "backend/src/main/resources/prompt_template/article-summary.stg",
    "Summarize: <content>"
  );
  await write(root, "backend/src/main/resources/ignored.bin", "fixture");
  await write(
    root,
    "frontend/src/router/index.ts",
    `import { createRouter } from 'vue-router';
const routes = [{ path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') }];
const router = createRouter({ history: {} as any, routes: [{ ...routes[0], meta: { requiresAuth: true } }] });
router.beforeEach((to) => to.meta.requiresAuth ? '/login' : true);
export default router;
`
  );
  await write(
    root,
    "frontend/src/api/articles.ts",
    `import { apiClient } from './client';
export const articleApi = {
  list() { return apiClient.get<ApiResponse<Page<Article>>>('/articles'); },
  create(data: CreateArticleRequest) { return apiClient.post<ApiResponse<Article>>('/articles', data); },
  retrySummary(id: number) { return apiClient.post<ApiResponse<Article>>(\`/articles/\${id}/summary/retry\`); }
};
`
  );
  await write(
    root,
    "frontend/src/stores/auth.ts",
    `import { defineStore } from 'pinia';
export const useAuthStore = defineStore('auth', {});
`
  );
  await write(
    root,
    "frontend/src/views/DashboardView.vue",
    `<script setup lang="ts">
import { articleApi } from '../api/articles';
articleApi.list();
</script>
<template><main>dashboard</main></template>`
  );
  return root;
}

async function testDryRunDoesNotWrite() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({ root, area: "all", mode: "all", dryRun: true });
    assert.equal(result.dryRun, true);
    assert.equal(existsSync(path.join(root, "llm-knowledge")), false);
    assert.ok(result.plannedWrites.length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBaselineGeneratesModulesAndIndex() {
  const root = await createFixture();
  try {
    await write(
      root,
      "llm-knowledge/common/conventions/quality-gates.md",
      "# Quality Gate Conventions\n\nTests and BLOCKER review findings gate delivery.\n"
    );
    await write(
      root,
      "llm-knowledge/backend/modules/article/custom/business-rules.md",
      "# Article Business Rules\n\nFavorites are isolated by user.\n"
    );
    await write(
      root,
      ".harness/workflows/e2e-development.yaml",
      "name: fixture-e2e\nphases:\n  - id: requirement\n"
    );
    await write(
      root,
      ".codex/skills/frontier-test-gate/SKILL.md",
      "---\nname: frontier-test-gate\ndescription: Fixture test gate.\n---\n\n# Test Gate\n"
    );
    await write(
      root,
      ".codex/skills/frontier-test-gate/references/policy.md",
      "# Fixture Policy\n\nRun focused tests before delivery.\n"
    );
    await write(
      root,
      ".codex/skills/skill-registry.yaml",
      "skills:\n  - frontier-test-gate\n"
    );

    const result = await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    assert.equal(result.area, "all");
    assert.equal(result.mode, "baseline");
    assert.ok(existsSync(path.join(root, "llm-knowledge/backend/modules/article/facts.json")));
    assert.ok(existsSync(path.join(root, "llm-knowledge/frontend/modules/api/facts.json")));
    assert.ok(existsSync(path.join(root, "llm-knowledge/index/chunks.json")));
    assert.ok(existsSync(path.join(root, "llm-knowledge/index/manifest.json")));

    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /baseline_status: fresh/);
    assert.match(backendMeta, /semantic_status: pending/);
    assert.match(backendMeta, /^source_fingerprint: "sha256:[a-f0-9]{64}"$/m);
    assert.match(backendMeta, /^source_fingerprint_status: complete$/m);

    const articleFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/modules/article/facts.json"), "utf8"));
    assert.equal(articleFacts.module, "article");
    assert.ok(articleFacts.controllers.some((controller) => controller.name === "ArticleController"));
    assert.ok(articleFacts.endpoints.some((endpoint) => endpoint.path === "/api/articles"));
    const detailEndpoint = articleFacts.endpoints.find((endpoint) => endpoint.path === "/api/articles/{id}");
    assert.equal(detailEndpoint.handler, "get");
    assert.equal(detailEndpoint.return_type, "ApiResponse<Article>");
    assert.ok(detailEndpoint.parameters.some((parameter) => parameter.name === "id" && parameter.binding === "PathVariable"));
    assert.ok(detailEndpoint.parameters.some((parameter) => parameter.name === "keyword" && parameter.binding === "RequestParam"));
    assert.ok(detailEndpoint.security.some((annotation) => annotation.includes("PreAuthorize")));
    assert.ok(articleFacts.transactional_methods.some((method) => method.name === "save"));
    assert.ok(articleFacts.service_dependencies.some((dependency) => dependency.class === "ArticleService" && dependency.dependency === "ArticleRepository"));
    assert.ok(articleFacts.resources.some((resource) => resource.kind === "configuration" && resource.file.endsWith("application.yml")));
    assert.ok(articleFacts.resources.some((resource) => resource.kind === "migration" && resource.file.includes("V1__initial_schema.sql")));
    assert.ok(articleFacts.resources.some((resource) => resource.kind === "prompt-template" && resource.file.endsWith("article-summary.stg")));

    const apiFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/frontend/modules/api/facts.json"), "utf8"));
    assert.ok(apiFacts.api_calls.some((call) => call.path === "/articles" && call.method === "GET" && call.response_type === "ApiResponse<Page<Article>>"));
    assert.ok(apiFacts.api_calls.some((call) => call.path === "/articles" && call.method === "POST" && call.request_types.includes("CreateArticleRequest")));
    assert.ok(apiFacts.api_calls.some((call) => call.path === "/articles/${id}/summary/retry" && call.method === "POST"));

    const routerFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/frontend/modules/router/facts.json"), "utf8"));
    assert.ok(routerFacts.route_guards.some((guard) => guard.kind === "beforeEach"));
    assert.ok(routerFacts.route_guards.some((guard) => guard.kind === "route-meta" && guard.key === "requiresAuth"));

    const viewFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/frontend/modules/views/facts.json"), "utf8"));
    assert.ok(viewFacts.api_dependencies.some((dependency) => dependency.api_module === "articles" && dependency.symbol === "articleApi"));

    const backendCoverage = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/source-coverage.json"), "utf8"));
    assert.ok(backendCoverage.parsed_files.some((file) => file.endsWith("ArticleController.java")));
    assert.ok(backendCoverage.resource_files.some((file) => file.endsWith("application.yml")));
    assert.ok(backendCoverage.resource_files.some((file) => file.endsWith("article-summary.stg")));
    assert.ok(backendCoverage.skipped_files.some((file) => file.endsWith("ignored.bin")));
    assert.equal(backendCoverage.failed_files.length, 0);

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.ok(chunks.some((chunk) => chunk.text.includes("ArticleController")));
    assert.ok(chunks.some((chunk) => chunk.area === "frontend" && chunk.module === "api"));
    assert.ok(chunks.some((chunk) => chunk.area === "common" && chunk.path.endsWith("quality-gates.md")));
    assert.ok(chunks.some((chunk) => chunk.area === "backend" && chunk.module === "article" && chunk.doc_type === "custom"));
    assert.ok(chunks.some((chunk) => chunk.area === "common" && chunk.module === "harness-workflows"));
    assert.ok(chunks.some((chunk) => chunk.area === "common" && chunk.module === "project-skills"));
    assert.ok(chunks.some((chunk) => chunk.path.endsWith("frontier-test-gate/references/policy.md")));
    assert.ok(chunks.some((chunk) => chunk.path.endsWith(".codex/skills/skill-registry.yaml")));
    assert.ok(chunks.every((chunk) => /^sha256:[a-f0-9]{64}$/.test(chunk.source_fingerprint)));

    const articleOverview = await readFile(path.join(root, "llm-knowledge/backend/modules/article/overview.md"), "utf8");
    assert.match(articleOverview, /^source_fingerprint: sha256:[a-f0-9]{64}$/m);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.match(manifest.source_fingerprints.backend, /^sha256:[a-f0-9]{64}$/);
    assert.match(manifest.source_fingerprints.frontend, /^sha256:[a-f0-9]{64}$/);
    assert.match(manifest.source_fingerprints.common, /^sha256:[a-f0-9]{64}$/);
    assert.equal(manifest.source_fingerprint_status.backend, "complete");

    const manualNote = await readFile(
      path.join(root, "llm-knowledge/backend/modules/article/custom/business-rules.md"),
      "utf8"
    );
    assert.match(manualNote, /Favorites are isolated by user/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSymlinkedKnowledgeFilesAreSkipped() {
  const root = await createFixture();
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "frontier-kb-external-"));
  try {
    const externalFile = path.join(externalRoot, "private-note.md");
    await writeFile(externalFile, "PRIVATE CONTENT OUTSIDE THE REPOSITORY", "utf8");
    const linkedFile = path.join(root, "llm-knowledge/common/conventions/external-link.md");
    await mkdir(path.dirname(linkedFile), { recursive: true });
    await symlink(externalFile, linkedFile, "file");

    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.equal(chunks.some((chunk) => chunk.text.includes("PRIVATE CONTENT OUTSIDE THE REPOSITORY")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
}

async function testSymlinkedRootAgentsFileIsSkipped() {
  const root = await createFixture();
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), "frontier-kb-external-"));
  try {
    const externalFile = path.join(externalRoot, "private-agents.md");
    await writeFile(externalFile, "PRIVATE AGENTS CONTENT OUTSIDE THE REPOSITORY", "utf8");
    const agentsFile = path.join(root, "AGENTS.md");
    await symlink(externalFile, agentsFile, "file");

    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.equal(chunks.some((chunk) => chunk.text.includes("PRIVATE AGENTS CONTENT OUTSIDE THE REPOSITORY")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(externalRoot, { recursive: true, force: true });
  }
}

async function testAreaRefreshRemovesChunksWhenLastModuleIsDeleted() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    await rm(path.join(root, "backend", "src"), { recursive: true, force: true });

    await runGenerateKnowledge({ root, area: "backend", mode: "baseline" });

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    const currentFingerprints = await computeSourceFingerprints(root, ["backend"]);
    assert.equal(chunks.some((chunk) => chunk.area === "backend"), false);
    assert.equal(manifest.source_fingerprint_status.backend, "complete");
    assert.equal(manifest.source_fingerprints.backend, currentFingerprints.backend.fingerprint);
    assert.match(backendMeta, /^baseline_status: fresh$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmptySourceDirectoriesAreNotDiscoveredAsModules() {
  const root = await createFixture();
  try {
    await mkdir(path.join(root, "backend/src/main/java/com/frontierscan/empty"), { recursive: true });
    await mkdir(path.join(root, "frontend/src/empty"), { recursive: true });

    const result = await runGenerateKnowledge({ root, area: "all", mode: "baseline" });

    assert.equal(result.modules.some((module) => module.name === "empty"), false);
    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.equal(chunks.some((chunk) => chunk.module === "empty"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testAreaRefreshRemovesDeletedModuleArtifactsAndPreservesManualFiles() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    const moduleDocsRoot = path.join(root, "llm-knowledge/backend/modules/article");
    const customFile = path.join(moduleDocsRoot, "custom/business-rules.md");
    await writeFile(customFile, "# Preserved manual note\n", "utf8");
    await rm(path.join(root, "backend/src/main/java/com/frontierscan/article"), { recursive: true, force: true });

    const dryRun = await runGenerateKnowledge({ root, area: "backend", mode: "baseline", dryRun: true });
    const overviewPath = path.join(moduleDocsRoot, "overview.md");
    assert.equal(existsSync(overviewPath), true);
    assert.ok((dryRun.plannedDeletes ?? []).includes(overviewPath.replaceAll("\\", "/")));

    const { stdout: dryRunStdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", generateScript,
      "-Root", root,
      "-Area", "backend",
      "-Mode", "baseline",
      "-DryRun",
    ], { encoding: "utf8" });
    assert.match(dryRunStdout, /Planned deletes: [1-9]/);
    assert.match(dryRunStdout, /Deleted files: 0/);

    await runGenerateKnowledge({ root, area: "backend", mode: "baseline" });

    assert.equal(existsSync(overviewPath), false);
    assert.equal(existsSync(path.join(moduleDocsRoot, "facts.json")), false);
    assert.equal(existsSync(path.join(moduleDocsRoot, "semantic.md")), false);
    assert.equal(existsSync(customFile), true);
    assert.equal(existsSync(path.join(moduleDocsRoot, "log.md")), true);

    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy", "Bypass",
      "-File", queryScript,
      "-Root", root,
      "-Query", "ArticleController",
      "-Area", "backend",
    ], { encoding: "utf8" });
    assert.match(stdout, /Source: markdown-fallback/);
    assert.match(stdout, /Matches: 0/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPartialRefreshMarksUnselectedAreaPartialWhenIndexIsInvalid() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    await writeFile(path.join(root, "llm-knowledge/index/chunks.json"), "{invalid json", "utf8");

    await runGenerateKnowledge({ root, area: "backend", mode: "baseline" });

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(chunks.some((chunk) => chunk.area === "frontend"), false);
    assert.equal(manifest.source_fingerprint_status.backend, "complete");
    assert.equal(manifest.source_fingerprint_status.frontend, "partial");
    assert.equal(manifest.source_fingerprints.frontend, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPartialRefreshMarksAreaPartialWhenModuleDocTypesAreMissing() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    const chunksPath = path.join(root, "llm-knowledge/index/chunks.json");
    const chunks = JSON.parse(await readFile(chunksPath, "utf8"));
    const partialChunks = chunks.filter((chunk) => !(
      chunk.area === "frontend"
      && chunk.module === "views"
      && !["overview", "semantic"].includes(chunk.doc_type)
    ));
    await writeFile(chunksPath, `${JSON.stringify(partialChunks, null, 2)}\n`, "utf8");

    await runGenerateKnowledge({ root, area: "backend", mode: "baseline" });

    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.source_fingerprint_status.frontend, "partial");
    assert.equal(manifest.source_fingerprints.frontend, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSourceCoverageRecordsReadFailuresAndContinues() {
  const root = await createFixture();
  const failedRelativePath = "backend/src/main/java/com/frontierscan/article/ArticleRepository.java";
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      mode: "baseline",
      readTextImpl: async (filePath) => {
        if (filePath.replaceAll("\\", "/").endsWith(failedRelativePath)) {
          const error = new Error("sensitive fixture detail must not be persisted");
          error.code = "EACCES";
          throw error;
        }
        return readFile(filePath, "utf8");
      },
    });

    assert.ok(result.modules.some((module) => module.name === "article"));
    const facts = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/modules/article/facts.json"), "utf8"));
    assert.ok(facts.controllers.some((controller) => controller.name === "ArticleController"));
    assert.equal(facts.repositories.some((repository) => repository.name === "ArticleRepository"), false);

    const coverage = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/source-coverage.json"), "utf8"));
    assert.equal(coverage.failed_files.length, 1);
    assert.equal(coverage.failed_files[0].file, failedRelativePath);
    assert.equal(coverage.failed_files[0].stage, "backend-source-read");
    assert.match(coverage.failed_files[0].error, /EACCES/);
    assert.doesNotMatch(coverage.failed_files[0].error, /sensitive fixture detail/);
    assert.equal(coverage.parsed_files.includes(failedRelativePath), false);
    assert.equal(coverage.skipped_files.includes(failedRelativePath), false);

    const overview = await readFile(path.join(root, "llm-knowledge/backend/modules/article/overview.md"), "utf8");
    assert.match(overview, /^baseline_status: partial$/m);
    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /^status: partial$/m);
    assert.match(backendMeta, /^baseline_status: partial$/m);
    assert.match(backendMeta, /^index_status: partial$/m);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.source_fingerprint_status.backend, "partial");
    assert.equal(manifest.source_fingerprints.backend, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSharedResourceReadFailureMarksBackendPartial() {
  const root = await createFixture();
  const failedResource = "backend/src/main/resources/application.yml";
  try {
    await runGenerateKnowledge({
      root,
      area: "backend",
      mode: "baseline",
      readTextImpl: async (filePath) => {
        if (filePath.replaceAll("\\", "/").endsWith(failedResource)) {
          const error = new Error("sensitive resource detail must not be persisted");
          error.code = "EACCES";
          throw error;
        }
        return readFile(filePath, "utf8");
      },
    });

    const coverage = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/source-coverage.json"), "utf8"));
    assert.ok(coverage.failed_files.some((failure) => (
      failure.file === failedResource && failure.stage === "backend-resource-read"
    )));
    const articleOverview = await readFile(path.join(root, "llm-knowledge/backend/modules/article/overview.md"), "utf8");
    const authOverview = await readFile(path.join(root, "llm-knowledge/backend/modules/auth/overview.md"), "utf8");
    assert.match(articleOverview, /^baseline_status: partial$/m);
    assert.match(authOverview, /^baseline_status: partial$/m);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.source_fingerprint_status.backend, "partial");
    assert.equal(manifest.source_fingerprints.backend, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testModuleScopedRefreshPreservesUnrelatedArtifacts() {
  const root = await createFixture();
  try {
    await git(root, "init", "--quiet");
    await git(root, "config", "user.email", "fixture@example.com");
    await git(root, "config", "user.name", "Fixture");
    await git(root, "add", "backend", "frontend");
    await git(root, "commit", "--quiet", "-m", "fixture baseline");
    const oldHash = (await git(root, "rev-parse", "HEAD")).stdout.trim();
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    const authOverviewPath = path.join(root, "llm-knowledge/backend/modules/auth/overview.md");
    const routerOverviewPath = path.join(root, "llm-knowledge/frontend/modules/router/overview.md");
    const authBefore = await readFile(authOverviewPath, "utf8");
    const routerBefore = await readFile(routerOverviewPath, "utf8");

    await write(
      root,
      "backend/src/main/java/com/frontierscan/article/NewArticleEndpoint.java",
      `package com.frontierscan.article; public class NewArticleEndpoint {}`
    );
    await write(
      root,
      "backend/src/main/java/com/frontierscan/auth/NewAuthPolicy.java",
      `package com.frontierscan.auth; public class NewAuthPolicy {}`
    );
    await git(root, "add", "backend");
    await git(root, "commit", "--quiet", "-m", "change article and auth");
    const currentHash = (await git(root, "rev-parse", "HEAD")).stdout.trim();
    const result = await runGenerateKnowledge({ root, area: "backend", module: "article", mode: "baseline" });

    assert.deepEqual(result.modules.map((module) => module.name), ["article"]);
    assert.equal(await readFile(authOverviewPath, "utf8"), authBefore);
    assert.equal(await readFile(routerOverviewPath, "utf8"), routerBefore);

    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /name: article/);
    assert.match(backendMeta, /name: auth/);
    const articleMeta = backendMeta.match(/  - name: article[\s\S]*?(?=\n  - name:|$)/)?.[0] ?? "";
    const authMeta = backendMeta.match(/  - name: auth[\s\S]*?(?=\n  - name:|$)/)?.[0] ?? "";
    assert.match(articleMeta, new RegExp(`git_hash: "${currentHash}"`));
    assert.match(articleMeta, /baseline_status: fresh/);
    assert.match(authMeta, new RegExp(`git_hash: "${oldHash}"`));
    assert.match(authMeta, /baseline_status: stale/);
    assert.match(backendMeta, /^baseline_status: partial$/m);
    const articleFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/modules/article/facts.json"), "utf8"));
    const currentArticleFingerprint = await computeFileSetFingerprint(root, [
      ...articleFacts.source_files,
      ...articleFacts.resources.map((resource) => resource.file),
    ]);
    const articleFingerprint = articleMeta.match(/baseline_source_fingerprint: "([^"]+)"/)?.[1];
    const authFingerprint = authMeta.match(/baseline_source_fingerprint: "([^"]+)"/)?.[1];
    const authDocumentFingerprint = authBefore.match(/^source_fingerprint:\s*([^\s]+)$/m)?.[1];
    assert.equal(articleFingerprint, currentArticleFingerprint.fingerprint);
    assert.equal(authFingerprint, authDocumentFingerprint);
    assert.notEqual(articleFingerprint, authFingerprint);

    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.source_fingerprints.backend, null);
    assert.equal(manifest.source_fingerprint_status.backend, "partial");

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.ok(chunks.some((chunk) => chunk.area === "backend" && chunk.module === "auth"));
    assert.ok(chunks.some((chunk) => chunk.area === "frontend" && chunk.module === "router"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPowerShellEntryPointSupportsModuleRefresh() {
  const root = await createFixture();
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", generateScript,
        "-Root", root,
        "-Area", "backend",
        "-Mode", "baseline",
        "-Module", "article",
        "-Json",
      ],
      { encoding: "utf8" }
    );
    const result = JSON.parse(stdout);
    assert.deepEqual(result.modules.map((module) => module.name), ["article"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPowerShellEntryPointPreservesNodeFailureExitCode() {
  const root = await createFixture();
  try {
    await writeFile(path.join(root, "llm-knowledge"), "not-a-directory", "utf8");
    await assert.rejects(
      execFileAsync(
        "powershell.exe",
        [
          "-NoProfile",
          "-ExecutionPolicy", "Bypass",
          "-File", generateScript,
          "-Root", root,
          "-Area", "backend",
          "-Mode", "baseline",
          "-Json",
        ],
        { encoding: "utf8" }
      ),
      (error) => {
        assert.notEqual(error.code, 0);
        assert.match(error.stderr, /ENOTDIR|EEXIST/);
        return true;
      }
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticWithoutKeyDegrades() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({ root, area: "backend", mode: "semantic", env: {} });
    assert.equal(result.semantic.status, "pending");
    const semanticDoc = await readFile(path.join(root, "llm-knowledge/backend/modules/article/semantic.md"), "utf8");
    assert.match(semanticDoc, /semantic_status: pending/);
    assert.match(semanticDoc, /OPENAI_API_KEY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticSuccessUsesStructuredOutput() {
  const root = await createFixture();
  const requests = [];
  const semanticOutput = {
    responsibility: "提供文章查询、收藏与摘要重试能力。",
    business_flows: ["控制器接收文章请求并调用文章领域服务。"],
    cross_module_dependencies: ["认证模块提供当前用户身份。"],
    risks: ["收藏接口必须保持用户级数据隔离。"],
    consumption_hints: ["修改文章接口前先查询 interfaces 与 storage 文档。"],
  };
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { output_text: JSON.stringify(semanticOutput) };
      },
    };
  };

  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "test-model" },
      fetchImpl,
      semanticTimeoutMs: 100,
    });

    assert.equal(result.semantic.status, "fresh");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
    const requestBody = JSON.parse(requests[0].options.body);
    assert.equal(requestBody.model, "test-model");
    assert.equal(requestBody.text.format.type, "json_schema");
    assert.equal(requestBody.text.format.strict, true);
    assert.ok(requests[0].options.signal instanceof AbortSignal);

    const semanticDoc = await readFile(path.join(root, "llm-knowledge/backend/modules/article/semantic.md"), "utf8");
    assert.match(semanticDoc, /^---\ngenerated_by: openai/m);
    assert.match(semanticDoc, /^semantic_provider: api\.openai\.com$/m);
    assert.match(semanticDoc, /## 模块职责/);
    assert.match(semanticDoc, /## 核心业务流程/);
    assert.match(semanticDoc, /## 来源文件/);
    assert.match(semanticDoc, /ArticleController\.java/);
    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /^baseline_status: missing$/m);
    assert.match(backendMeta, /^status: partial$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPartialSemanticKeepsGlobalIndexPending() {
  const root = await createFixture();
  const semanticOutput = {
    responsibility: "Article module responsibilities.",
    business_flows: [],
    cross_module_dependencies: [],
    risks: [],
    consumption_hints: [],
  };
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { output_text: JSON.stringify(semanticOutput) };
        },
      }),
    });

    assert.equal(result.semantic.status, "fresh");
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.semantic_status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBackendSemanticKeepsGlobalIndexPendingWhenFrontendIsPending() {
  const root = await createFixture();
  const semanticOutput = {
    responsibility: "Backend module responsibilities.",
    business_flows: [],
    cross_module_dependencies: [],
    risks: [],
    consumption_hints: [],
  };
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { output_text: JSON.stringify(semanticOutput) };
        },
      }),
    });

    assert.equal(result.semantic.status, "fresh");
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.semantic_status, "pending");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticHttpFailureDegrades() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    assert.equal(result.semantic.status, "failed");
    assert.match(result.semantic.message, /status 429/);
    const semanticDoc = await readFile(path.join(root, "llm-knowledge/backend/modules/article/semantic.md"), "utf8");
    assert.match(semanticDoc, /semantic_status: failed/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testGeneratedMarkdownUsesChineseExplanatoryText() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });

    const documentPaths = [
      "llm-knowledge/backend/modules/article/overview.md",
      "llm-knowledge/backend/modules/article/interfaces.md",
      "llm-knowledge/backend/modules/article/dependencies.md",
      "llm-knowledge/backend/modules/article/storage.md",
      "llm-knowledge/backend/modules/article/config.md",
      "llm-knowledge/frontend/modules/api/components.md",
    ];
    const generatedMarkdown = (await Promise.all(
      documentPaths.map((relativePath) => readFile(path.join(root, relativePath), "utf8"))
    )).join("\n");

    assert.doesNotMatch(
      generatedMarkdown,
      /Needs AI Review|## Controllers|## HTTP Endpoints|## Exports|## Entities \/ Tables|## Repositories \/ Mappers|## Configuration Properties|## 识别到的 imports/
    );
    assert.match(generatedMarkdown, /## 控制器/);
    assert.match(generatedMarkdown, /## HTTP 接口/);
    assert.match(generatedMarkdown, /需要 AI 审核：/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testOperationalEmbeddingDocsUseDedicatedConfiguration() {
  const operationalDocs = [
    ".harness/scripts/README.md",
    ".codex/skills/frontier-kb-generate/SKILL.md",
    "docs/AI-handover.md",
    "llm-knowledge/index/chunks.json",
  ];
  for (const relativePath of operationalDocs) {
    const content = await readFile(path.join(repositoryRoot, relativePath), "utf8");
    for (const environmentVariable of [
      "EMBEDDING_API_KEY",
      "DASHSCOPE_API_KEY",
      "EMBEDDING_BASE_URL",
      "EMBEDDING_MODEL",
    ]) {
      assert.match(content, new RegExp(environmentVariable), `${relativePath} must document ${environmentVariable}`);
    }
    assert.match(content, /text-embedding-v4/, `${relativePath} must document the default embedding model`);
    assert.doesNotMatch(
      content,
      /Use `OPENAI_API_KEY` and optional `OPENAI_EMBEDDING_MODEL`|OpenAI Embeddings API|`-WithEmbeddings` 当前明确返回 `disabled`|Embedding 明确 `disabled`|Maximum batch size: 64/,
      `${relativePath} contains a superseded embedding contract`
    );
  }

  const skill = await readFile(
    path.join(repositoryRoot, ".codex/skills/frontier-kb-generate/SKILL.md"),
    "utf8"
  );
  assert.match(skill, /## 快速工作流/);
  assert.match(skill, /## 分层规则/);
  assert.match(skill, /## 安全规则/);
}

async function testSemanticUsesConfiguredBaseUrl() {
  const root = await createFixture();
  let requestUrl = "";
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: {
        OPENAI_API_KEY: "test-key",
        OPENAI_BASE_URL: "https://coding.xiaofeilun.cn/v1/",
      },
      fetchImpl: async (url) => {
        requestUrl = url;
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              output_text: JSON.stringify({
                responsibility: "Article module responsibilities.",
                business_flows: [],
                cross_module_dependencies: [],
                risks: [],
                consumption_hints: [],
              }),
            };
          },
        };
      },
    });

    assert.equal(result.semantic.status, "fresh");
    assert.equal(requestUrl, "https://coding.xiaofeilun.cn/v1/responses");
    const semanticDoc = await readFile(path.join(root, "llm-knowledge/backend/modules/article/semantic.md"), "utf8");
    assert.match(semanticDoc, /^generated_by: openai-compatible$/m);
    assert.match(semanticDoc, /^semantic_provider: coding\.xiaofeilun\.cn$/m);
    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    const semanticChunk = chunks.find((chunk) => (
      chunk.area === "backend" && chunk.module === "article" && chunk.doc_type === "semantic"
    ));
    assert.equal(semanticChunk.semantic_provider, "coding.xiaofeilun.cn");
    assert.match(semanticChunk.text, /^semantic_provider: coding\.xiaofeilun\.cn$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticNetworkFailureIncludesSanitizedCauseCode() {
  const root = await createFixture();
  try {
    const networkError = new TypeError("fetch failed");
    networkError.cause = Object.assign(new Error("connect ECONNREFUSED private-host:443"), {
      code: "ECONNREFUSED",
    });
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => { throw networkError; },
    });

    assert.equal(result.semantic.status, "failed");
    assert.match(result.semantic.message, /fetch failed \(ECONNREFUSED\)/);
    assert.doesNotMatch(result.semantic.message, /private-host/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticTimeoutAbortsAndDegrades() {
  const root = await createFixture();
  const fetchImpl = async (url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl,
      semanticTimeoutMs: 10,
    });
    assert.equal(result.semantic.status, "failed");
    assert.match(result.semantic.message, /timed out after 10ms/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticMalformedJsonDegrades() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { output_text: "not-json" };
        },
      }),
    });
    assert.equal(result.semantic.status, "failed");
    assert.match(result.semantic.message, /JSON/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticSchemaInvalidOutputDegrades() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            output_text: JSON.stringify({
              responsibility: "文章管理。",
              business_flows: [],
              cross_module_dependencies: [],
              consumption_hints: [],
            }),
          };
        },
      }),
    });
    assert.equal(result.semantic.status, "failed");
    assert.match(result.semantic.message, /'risks'/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSemanticAggregateStatusFailsWhenAnyModuleFails() {
  const root = await createFixture();
  let callCount = 0;
  const validOutput = {
    responsibility: "认证模块。",
    business_flows: [],
    cross_module_dependencies: [],
    risks: [],
    consumption_hints: [],
  };
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key" },
      fetchImpl: async () => {
        callCount += 1;
        if (callCount === 1) return { ok: false, status: 500 };
        return {
          ok: true,
          status: 200,
          async json() {
            return { output_text: JSON.stringify(validOutput) };
          },
        };
      },
    });
    assert.equal(result.semantic.status, "failed");
    assert.equal(result.semantic.modules.length, 2);
    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /^semantic_status: failed$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBaselineRefreshPreservesSemanticLayer() {
  const root = await createFixture();
  const validOutput = {
    responsibility: "模块职责。",
    business_flows: [],
    cross_module_dependencies: [],
    risks: [],
    consumption_hints: [],
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { output_text: JSON.stringify(validOutput) };
    },
  });
  try {
    await runGenerateKnowledge({
      root,
      area: "backend",
      mode: "semantic",
      env: { OPENAI_API_KEY: "test-key", OPENAI_MODEL: "semantic-model-v1" },
      fetchImpl,
    });
    const semanticPath = path.join(root, "llm-knowledge/backend/modules/article/semantic.md");
    const semanticBefore = await readFile(semanticPath, "utf8");
    const chunksBefore = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    const semanticChunkBefore = chunksBefore.find((chunk) => chunk.id === "backend:article:semantic");

    await runGenerateKnowledge({ root, area: "backend", module: "article", mode: "baseline" });

    assert.equal(await readFile(semanticPath, "utf8"), semanticBefore);
    const chunksAfter = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.deepEqual(chunksAfter.find((chunk) => chunk.id === "backend:article:semantic"), semanticChunkBefore);
    const backendMeta = await readFile(path.join(root, "llm-knowledge/backend/meta.yaml"), "utf8");
    assert.match(backendMeta, /^semantic_status: fresh$/m);
    assert.match(backendMeta, /^semantic_model: "semantic-model-v1"$/m);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmbeddingsRequireExplicitFlag() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    await stat(path.join(root, "llm-knowledge/index/manifest.json"));
    assert.equal(existsSync(path.join(root, "llm-knowledge/index/embeddings.jsonl")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmbeddingsGenerateJsonlWhenRequested() {
  const root = await createFixture();
  const requests = [];
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "baseline",
      withEmbeddings: true,
      env: { DASHSCOPE_API_KEY: "dashscope-test-key" },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        const body = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: body.input.map((input, index) => ({ index, embedding: [index, input.length] })),
            };
          },
        };
      },
    });
    assert.equal(result.embeddings.status, "fresh");
    assert.equal(result.embeddings.provider, "dashscope.aliyuncs.com");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings");
    assert.equal(requests[0].options.headers.Authorization, "Bearer dashscope-test-key");
    const requestBody = JSON.parse(requests[0].options.body);
    assert.equal(requestBody.model, "text-embedding-v4");
    assert.ok(Array.isArray(requestBody.input));

    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.embeddings_status, "fresh");
    assert.equal(manifest.embedding_provider, "dashscope.aliyuncs.com");
    assert.equal(manifest.files.embeddings, "llm-knowledge/index/embeddings.jsonl");
    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    const embeddingLines = (await readFile(path.join(root, "llm-knowledge/index/embeddings.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(embeddingLines.length, chunks.length);
    assert.ok(embeddingLines.every((record) => record.embedding_provider === "dashscope.aliyuncs.com"));
    assert.deepEqual(embeddingLines[0].embedding, [0, requestBody.input[0].length]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmbeddingsUseDedicatedConfiguration() {
  const root = await createFixture();
  let request = null;
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "baseline",
      withEmbeddings: true,
      env: {
        OPENAI_API_KEY: "semantic-key-must-not-be-used",
        EMBEDDING_API_KEY: "embedding-key",
        EMBEDDING_BASE_URL: "https://embedding.example.com/v1/",
        EMBEDDING_MODEL: "custom-embedding-model",
        OPENAI_EMBEDDING_MODEL: "legacy-model-must-not-win",
      },
      fetchImpl: async (url, options) => {
        request = { url, options };
        const body = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: body.input.map((input, index) => ({ index, embedding: [index, input.length] })),
            };
          },
        };
      },
    });

    assert.equal(result.embeddings.status, "fresh");
    assert.equal(result.embeddings.model, "custom-embedding-model");
    assert.equal(result.embeddings.provider, "embedding.example.com");
    assert.equal(request.url, "https://embedding.example.com/v1/embeddings");
    assert.equal(request.options.headers.Authorization, "Bearer embedding-key");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testDashScopeEmbeddingBatchesRespectMaximumRows() {
  const root = await createFixture();
  const batchSizes = [];
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "all",
      mode: "baseline",
      withEmbeddings: true,
      env: { DASHSCOPE_API_KEY: "dashscope-test-key" },
      fetchImpl: async (_url, options) => {
        const body = JSON.parse(options.body);
        batchSizes.push(body.input.length);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: body.input.map((input, index) => ({ index, embedding: [index, input.length] })),
            };
          },
        };
      },
    });

    assert.equal(result.embeddings.status, "fresh");
    assert.ok(batchSizes.length > 1);
    assert.ok(batchSizes.every((size) => size <= 10));
    assert.equal(batchSizes.reduce((total, size) => total + size, 0), result.embeddings.chunks);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmbeddingsWithoutKeyDegrade() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "baseline",
      withEmbeddings: true,
      env: { OPENAI_API_KEY: "semantic-key-must-not-be-used" },
      fetchImpl: async () => {
        throw new Error("Embedding request must not use OPENAI_API_KEY.");
      },
    });
    assert.equal(result.embeddings.status, "pending");
    assert.equal(existsSync(path.join(root, "llm-knowledge/index/embeddings.jsonl")), false);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.embeddings_status, "pending");
    assert.equal(manifest.files.embeddings, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testEmbeddingHttpFailureDegrades() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "backend",
      module: "article",
      mode: "baseline",
      withEmbeddings: true,
      env: { DASHSCOPE_API_KEY: "test-key" },
      fetchImpl: async () => ({ ok: false, status: 429 }),
    });
    assert.equal(result.embeddings.status, "failed");
    assert.match(result.embeddings.message, /status 429/);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.embeddings_status, "failed");
    assert.equal(manifest.files.embeddings, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testAreaScopedRefreshPreservesOtherAreaIndex() {
  const root = await createFixture();
  try {
    await runGenerateKnowledge({ root, area: "all", mode: "baseline" });
    await runGenerateKnowledge({ root, area: "backend", mode: "semantic", env: {} });

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.ok(chunks.some((chunk) => chunk.area === "backend" && chunk.module === "article"));
    assert.ok(chunks.some((chunk) => chunk.area === "frontend" && chunk.module === "router" && chunk.text.includes("dashboard")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testDryRunDoesNotWrite();
await testBaselineGeneratesModulesAndIndex();
await testGeneratedMarkdownUsesChineseExplanatoryText();
await testOperationalEmbeddingDocsUseDedicatedConfiguration();
await testSymlinkedKnowledgeFilesAreSkipped();
await testSymlinkedRootAgentsFileIsSkipped();
await testAreaRefreshRemovesChunksWhenLastModuleIsDeleted();
await testEmptySourceDirectoriesAreNotDiscoveredAsModules();
await testAreaRefreshRemovesDeletedModuleArtifactsAndPreservesManualFiles();
await testPartialRefreshMarksUnselectedAreaPartialWhenIndexIsInvalid();
await testPartialRefreshMarksAreaPartialWhenModuleDocTypesAreMissing();
await testSourceCoverageRecordsReadFailuresAndContinues();
await testSharedResourceReadFailureMarksBackendPartial();
await testSemanticWithoutKeyDegrades();
await testSemanticSuccessUsesStructuredOutput();
await testSemanticUsesConfiguredBaseUrl();
await testPartialSemanticKeepsGlobalIndexPending();
await testBackendSemanticKeepsGlobalIndexPendingWhenFrontendIsPending();
await testSemanticHttpFailureDegrades();
await testSemanticNetworkFailureIncludesSanitizedCauseCode();
await testSemanticTimeoutAbortsAndDegrades();
await testSemanticMalformedJsonDegrades();
await testSemanticSchemaInvalidOutputDegrades();
await testSemanticAggregateStatusFailsWhenAnyModuleFails();
await testBaselineRefreshPreservesSemanticLayer();
await testEmbeddingsRequireExplicitFlag();
await testEmbeddingsGenerateJsonlWhenRequested();
await testEmbeddingsUseDedicatedConfiguration();
await testDashScopeEmbeddingBatchesRespectMaximumRows();
await testEmbeddingsWithoutKeyDegrade();
await testEmbeddingHttpFailureDegrades();
await testAreaScopedRefreshPreservesOtherAreaIndex();
await testModuleScopedRefreshPreservesUnrelatedArtifacts();
await testPowerShellEntryPointSupportsModuleRefresh();
await testPowerShellEntryPointPreservesNodeFailureExitCode();
console.log("generate-kb tests passed");
