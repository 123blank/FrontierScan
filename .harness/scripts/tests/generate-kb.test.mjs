import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runGenerateKnowledge } from "../lib/generate-kb.mjs";
import { computeFileSetFingerprint } from "../lib/source-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const generateScript = path.resolve(testDirectory, "../generate-kb.ps1");

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
      env: { OPENAI_API_KEY: "test-key" },
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

async function testEmbeddingsFlagIsExplicitlyDisabledWithoutRetriever() {
  const root = await createFixture();
  try {
    const result = await runGenerateKnowledge({
      root,
      area: "all",
      mode: "baseline",
      withEmbeddings: true,
      env: {},
    });
    assert.equal(result.embeddings.status, "disabled");
    assert.match(result.embeddings.message, /retrieval consumer/i);
    const manifest = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/manifest.json"), "utf8"));
    assert.equal(manifest.embeddings_status, "disabled");
    assert.equal(manifest.files.embeddings, null);
    assert.equal(existsSync(path.join(root, "llm-knowledge/index/embeddings.jsonl")), false);
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
await testSourceCoverageRecordsReadFailuresAndContinues();
await testSemanticWithoutKeyDegrades();
await testSemanticSuccessUsesStructuredOutput();
await testSemanticHttpFailureDegrades();
await testSemanticTimeoutAbortsAndDegrades();
await testSemanticMalformedJsonDegrades();
await testSemanticSchemaInvalidOutputDegrades();
await testSemanticAggregateStatusFailsWhenAnyModuleFails();
await testBaselineRefreshPreservesSemanticLayer();
await testEmbeddingsRequireExplicitFlag();
await testEmbeddingsFlagIsExplicitlyDisabledWithoutRetriever();
await testAreaScopedRefreshPreservesOtherAreaIndex();
await testModuleScopedRefreshPreservesUnrelatedArtifacts();
await testPowerShellEntryPointSupportsModuleRefresh();
console.log("generate-kb tests passed");
