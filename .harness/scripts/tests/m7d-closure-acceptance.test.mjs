import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const suites = [
  ".harness/scripts/tests/state-runtime.test.mjs",
  ".harness/scripts/tests/approval-contract.test.mjs",
  ".harness/scripts/tests/knowledge-runtime.test.mjs",
  ".harness/scripts/tests/story-runtime.test.mjs",
  ".harness/scripts/tests/delivery-runtime.test.mjs",
];

const requiredScenarioIds = new Set([
  "block-resume",
  "accepted-gap",
  "accepted-stale",
  "duplicate-apply",
  "result-drift",
  "interruption-recovery",
  "no-git-completion",
  "delivery-receipt",
]);
const executedScenarioIds = new Set();

for (const suite of suites) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [path.join(ROOT, suite)],
    { cwd: ROOT, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  assert.equal(stderr.trim(), "", `${suite} wrote unexpected stderr:\n${stderr}`);
  assert.match(stdout, /tests passed/i, `${suite} did not report a passing result.`);
  for (const match of stdout.matchAll(/^M7D-SCENARIO:([a-z-]+):passed$/gm)) {
    executedScenarioIds.add(match[1]);
  }
}

for (const scenarioId of requiredScenarioIds) {
  assert.equal(
    executedScenarioIds.has(scenarioId),
    true,
    `M7-D scenario '${scenarioId}' did not execute successfully.`,
  );
}

console.log("M7-D closure acceptance fixtures passed");
