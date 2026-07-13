import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "../../..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

const overview = await read("llm-knowledge/overview.md");
assert.doesNotMatch(overview, /only scaffolded|not implemented yet/i);
assert.match(overview, /L1.*fresh/i);
assert.match(overview, /L2.*pending/i);
assert.match(overview, /324/);

const adaptation = await read("docs/harness-architecture-adaptation.md");
assert.doesNotMatch(adaptation, /current step creates structure only/i);
assert.match(adaptation, /knowledge generator.*implemented/i);
assert.match(adaptation, /agent runtime.*not implemented/i);

const checklist = await read("docs/harness-structure-checklist.md");
assert.doesNotMatch(checklist, /freshness still scaffold/i);
assert.match(checklist, /16.*102.*13/);

const registry = await read(".codex/skills/skill-registry.yaml");
assert.match(registry, /status: mixed-runtime-readiness/);
assert.match(registry, /name: frontier-kb-generate[\s\S]*?status: implemented-v1/);
assert.match(registry, /name: frontier-kb-query[\s\S]*?status: implemented-v1/);
assert.match(registry, /name: frontier-state-runner[\s\S]*?status: guidance-only/);

const manifest = await read(".harness/structure-manifest.yaml");
assert.match(manifest, /structure: implemented/);
assert.match(manifest, /knowledge_generation: implemented-v1/);
assert.match(manifest, /knowledge_semantic: mock-verified-current-pending/);
assert.match(manifest, /agent_runtime: deferred/);
assert.match(manifest, /harness-status\.test\.mjs/);
assert.match(manifest, /kb-freshness\.test\.ps1/);
assert.match(manifest, /docs\/harness-m0-m1\/PLAN\.md/);
assert.match(manifest, /docs\/harness-m0-m1\/REPORT\.md/);

const businessPlan = await read("docs/harness-m0-m1/PLAN.md");
assert.match(businessPlan, /M0: Baseline Consolidation/);
const businessReport = await read("docs/harness-m0-m1/REPORT.md");
assert.match(businessReport, /M0 \+ M1 Implementation Report/);
assert.equal(existsSync(path.join(root, "docs/harness-skill-customization-plan.md")), false);
assert.equal(existsSync(path.join(root, "docs/harness-m0-m1-implementation-report.md")), false);

const deliverySummary = await read(".harness/scripts/summarize-delivery.ps1");
assert.match(deliverySummary, /docs\/AI-handover\.md/);

assert.equal(
  existsSync(path.join(root, "llm-knowledge/backend/modules/application")),
  false,
  "obsolete backend application scaffold must be removed"
);
assert.equal(
  existsSync(path.join(root, "llm-knowledge/frontend/modules/web-admin")),
  false,
  "obsolete frontend web-admin scaffold must be removed"
);

console.log("harness status tests passed");
