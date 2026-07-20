import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
assert.match(overview, /M2 deterministic phase advancement/i);
assert.match(overview, /M3 provides a file-based single-Story Dispatcher/i);
assert.match(overview, /M4-B.*constrained Mock Worker/i);

const adaptation = await read("docs/harness-architecture-adaptation.md");
assert.doesNotMatch(adaptation, /current step creates structure only/i);
assert.match(adaptation, /(?:knowledge generator.*implemented|知识生成.*V1)/i);
assert.match(adaptation, /(?:M2 deterministic state runtime.*implemented|M2 确定性状态运行时.*已实现)/i);
assert.match(adaptation, /(?:real Agent worker runtime.*not implemented|真实 Agent Worker.*仍未实现)/i);
assert.match(adaptation, /M4-B.*受约束 Mock Worker.*已实现/i);

const checklist = await read("docs/harness-structure-checklist.md");
assert.doesNotMatch(checklist, /freshness still scaffold/i);
assert.match(checklist, /21.*129.*13/);

const registry = await read(".codex/skills/skill-registry.yaml");
assert.match(registry, /status: mixed-runtime-readiness/);
assert.match(registry, /name: frontier-kb-generate[\s\S]*?status: implemented-v1/);
assert.match(registry, /name: frontier-kb-query[\s\S]*?status: implemented-v1/);
assert.match(registry, /name: frontier-state-runner[\s\S]*?status: implemented-v1/);

const manifest = await read(".harness/structure-manifest.yaml");
assert.match(manifest, /structure: implemented/);
assert.match(manifest, /knowledge_generation: implemented-v1/);
assert.match(manifest, /knowledge_semantic: mock-verified-current-pending/);
assert.match(manifest, /agent_runtime: single-story-dispatcher-v1-constrained-mock-worker-v1/);
assert.match(manifest, /harness-status\.test\.mjs/);
assert.match(manifest, /kb-freshness\.test\.ps1/);
assert.match(manifest, /task-dag\.test\.ps1/);
assert.match(manifest, /worker-runtime\.mjs/);
assert.match(manifest, /worker-runtime\.test\.mjs/);
assert.match(manifest, /worker-policies\.schema\.json/);
assert.match(manifest, /worker-policies\.json/);
assert.match(manifest, /docs\/harness-m0-m1\/PLAN\.md/);
assert.match(manifest, /docs\/harness-m0-m1\/REPORT\.md/);
assert.match(manifest, /docs\/harness-m3-agent-dispatcher\/REPORT\.md/);
assert.match(manifest, /docs\/harness-m4-runtime-compatibility\/REPORT\.md/);
assert.match(manifest, /docs\/harness-m4-worker-runtime\/REPORT\.md/);

const businessPlan = await read("docs/harness-m0-m1/PLAN.md");
assert.match(businessPlan, /M0: Baseline Consolidation/);
const businessReport = await read("docs/harness-m0-m1/REPORT.md");
assert.match(businessReport, /M0 \+ M1 Implementation Report/);
assert.equal(existsSync(path.join(root, "docs/harness-skill-customization-plan.md")), false);
assert.equal(existsSync(path.join(root, "docs/harness-m0-m1-implementation-report.md")), false);

const deliverySummary = await read(".harness/scripts/summarize-delivery.ps1");
assert.match(deliverySummary, /docs\/AI-handover\.md/);
assert.match(deliverySummary, /"\.gitignore"/);

for (const runtimePath of [
  ".harness/states/active-run.json",
  ".harness/states/active-run.json.bak",
  ".harness/states/e2e-M3-001.json",
  ".harness/states/e2e-M3-001.events.jsonl",
]) {
  const ignored = spawnSync("git", ["check-ignore", "--no-index", "--quiet", runtimePath], { cwd: root });
  assert.equal(ignored.status, 0, `${runtimePath} must be ignored as local runtime state`);
}
const templateIgnored = spawnSync(
  "git",
  ["check-ignore", "--no-index", "--quiet", ".harness/states/e2e-state.template.json"],
  { cwd: root },
);
assert.equal(templateIgnored.status, 1, "the tracked E2E state template must remain deliverable");

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
