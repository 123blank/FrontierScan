import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runGenerateKnowledge } from "../lib/generate-kb.mjs";

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, "utf8");
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-kb-test-"));
  await write(
    root,
    "backend/src/main/java/com/frontierscan/article/ArticleController.java",
    `package com.frontierscan.article;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/articles")
public class ArticleController {
  @GetMapping
  public String list() { return "ok"; }
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
    "frontend/src/router/index.ts",
    `import { createRouter } from 'vue-router';
const routes = [{ path: '/dashboard', name: 'dashboard', component: () => import('../views/DashboardView.vue') }];
export default createRouter({ history: {} as any, routes });
`
  );
  await write(
    root,
    "frontend/src/api/articles.ts",
    `import { apiClient } from './client';
export const articleApi = { list() { return apiClient.get('/articles'); } };
`
  );
  await write(
    root,
    "frontend/src/stores/auth.ts",
    `import { defineStore } from 'pinia';
export const useAuthStore = defineStore('auth', {});
`
  );
  await write(root, "frontend/src/views/DashboardView.vue", "<template><main>dashboard</main></template>");
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

    const articleFacts = JSON.parse(await readFile(path.join(root, "llm-knowledge/backend/modules/article/facts.json"), "utf8"));
    assert.equal(articleFacts.module, "article");
    assert.ok(articleFacts.controllers.some((controller) => controller.name === "ArticleController"));
    assert.ok(articleFacts.endpoints.some((endpoint) => endpoint.path === "/api/articles"));

    const chunks = JSON.parse(await readFile(path.join(root, "llm-knowledge/index/chunks.json"), "utf8"));
    assert.ok(chunks.some((chunk) => chunk.text.includes("ArticleController")));
    assert.ok(chunks.some((chunk) => chunk.area === "frontend" && chunk.module === "api"));
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
await testSemanticWithoutKeyDegrades();
await testEmbeddingsRequireExplicitFlag();
await testAreaScopedRefreshPreservesOtherAreaIndex();
console.log("generate-kb tests passed");
