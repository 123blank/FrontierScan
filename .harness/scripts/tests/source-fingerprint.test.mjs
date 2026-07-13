import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  computeAreaSourceFingerprint,
  computeFileSetFingerprint,
  computeSourceFingerprints,
} from "../lib/source-fingerprint.mjs";

const execFileAsync = promisify(execFile);
const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const fingerprintScript = path.resolve(testDirectory, "../lib/source-fingerprint.mjs");

async function write(root, relativePath, content) {
  const fullPath = path.join(root, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-source-fingerprint-"));
  await write(root, "backend/src/main/java/Article.java", "class Article {}\n");
  await write(root, "backend/src/main/resources/application.yml", "app: fixture\n");
  await write(root, "frontend/src/main.ts", "export const app = true;\n");
  await write(root, "AGENTS.md", "# Project rules\n");
  await write(root, "llm-knowledge/common/conventions/quality.md", "# Quality\n");
  await write(root, ".harness/workflows/e2e.yaml", "name: e2e\n");
  await write(root, ".codex/skills/frontier-test/SKILL.md", "# Skill\n");
  await write(root, "docs/ignored.md", "ignored\n");
  await write(root, "llm-knowledge/backend/meta.yaml", "generated\n");
  await write(root, "llm-knowledge/index/manifest.json", "{}\n");
  return root;
}

async function testDeterminismAndAreaIsolation() {
  const root = await createFixture();
  try {
    const initial = await computeSourceFingerprints(root, ["backend", "frontend", "common"]);
    const repeated = await computeSourceFingerprints(root, ["common", "frontend", "backend"]);

    for (const area of ["backend", "frontend", "common"]) {
      assert.equal(initial[area].status, "complete");
      assert.match(initial[area].fingerprint, /^sha256:[a-f0-9]{64}$/);
      assert.equal(repeated[area].fingerprint, initial[area].fingerprint);
    }

    await write(root, "backend/src/main/java/Article.java", "class Article { long id; }\n");
    const afterBackendEdit = await computeSourceFingerprints(root, ["backend", "frontend", "common"]);
    assert.notEqual(afterBackendEdit.backend.fingerprint, initial.backend.fingerprint);
    assert.equal(afterBackendEdit.frontend.fingerprint, initial.frontend.fingerprint);
    assert.equal(afterBackendEdit.common.fingerprint, initial.common.fingerprint);

    await write(root, "docs/ignored.md", "changed docs\n");
    await write(root, "llm-knowledge/backend/meta.yaml", "changed generated knowledge\n");
    await write(root, "llm-knowledge/index/manifest.json", "{\"changed\":true}\n");
    const afterExcludedEdits = await computeSourceFingerprints(root, ["backend", "frontend", "common"]);
    assert.equal(afterExcludedEdits.backend.fingerprint, afterBackendEdit.backend.fingerprint);
    assert.equal(afterExcludedEdits.frontend.fingerprint, afterBackendEdit.frontend.fingerprint);
    assert.equal(afterExcludedEdits.common.fingerprint, afterBackendEdit.common.fingerprint);

    await write(root, ".codex/skills/frontier-test/SKILL.md", "# Changed Skill\n");
    const afterSkillEdit = await computeSourceFingerprints(root, ["backend", "frontend", "common"]);
    assert.notEqual(afterSkillEdit.common.fingerprint, afterExcludedEdits.common.fingerprint);
    assert.equal(afterSkillEdit.backend.fingerprint, afterExcludedEdits.backend.fingerprint);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testFileSetAndReadFailureSafety() {
  const root = await createFixture();
  try {
    const ordered = await computeFileSetFingerprint(root, [
      "backend/src/main/resources/application.yml",
      "backend/src/main/java/Article.java",
    ]);
    const reversed = await computeFileSetFingerprint(root, [
      "backend/src/main/java/Article.java",
      "backend/src/main/resources/application.yml",
    ]);
    assert.equal(ordered.fingerprint, reversed.fingerprint);
    assert.equal(ordered.file_count, 2);

    const failed = await computeAreaSourceFingerprint(root, "backend", {
      readFileImpl: async (filePath) => {
        if (filePath.endsWith("Article.java")) {
          const error = new Error("sensitive exception detail");
          error.code = "EACCES";
          throw error;
        }
        return readFile(filePath);
      },
    });
    assert.equal(failed.status, "incomplete");
    assert.equal(failed.failed_files.length, 1);
    assert.equal(failed.failed_files[0].file, "backend/src/main/java/Article.java");
    assert.equal(failed.failed_files[0].stage, "source-fingerprint-read");
    assert.match(failed.failed_files[0].error, /EACCES/);
    assert.doesNotMatch(failed.failed_files[0].error, /sensitive exception detail/);

    const escaped = await computeFileSetFingerprint(root, ["../outside.txt"]);
    assert.equal(escaped.status, "incomplete");
    assert.equal(escaped.failed_files[0].stage, "source-fingerprint-path-validation");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testJsonCli() {
  const root = await createFixture();
  try {
    const { stdout } = await execFileAsync("node", [
      fingerprintScript,
      "--root", root,
      "--area", "all",
      "--json",
    ], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.deepEqual(Object.keys(result), ["backend", "frontend", "common"]);
    assert.equal(result.common.status, "complete");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testDeterminismAndAreaIsolation();
await testFileSetAndReadFailureSafety();
await testJsonCli();
console.log("source-fingerprint tests passed");
