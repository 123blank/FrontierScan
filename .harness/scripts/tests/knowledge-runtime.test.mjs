import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  checkKnowledgeArea,
  refreshKnowledgeArea,
  verifyKnowledgeAreaArtifacts,
} from "../lib/knowledge-runtime.mjs";
import { computeAreaSourceFingerprint } from "../lib/source-fingerprint.mjs";

const FIXED_NOW = "2026-08-14T00:00:00.000Z";
const DISPATCH_ID = "00000000-0000-4000-8000-000000000001";

async function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function fileSha256(root, relativePath) {
  return `sha256:${createHash("sha256").update(await readFile(path.join(root, relativePath))).digest("hex")}`;
}

function task(storyId = "M7-C-KB") {
  const attemptRoot = `.harness/runs/${storyId}/phases/01-technical-design/attempts/${DISPATCH_ID}`;
  return {
    schemaVersion: "2.0",
    dispatchId: DISPATCH_ID,
    storyId,
    runId: storyId,
    phase: "technical-design",
    preparedRevision: 2,
    preparedAt: FIXED_NOW,
    attemptRoot,
  };
}

function freshness(status, area = "backend") {
  const stale = status !== "fresh";
  return {
    current_git_hash: "a".repeat(40),
    findings: [{
      area,
      status: stale ? "stale-or-incomplete" : "fresh",
      reason: stale ? `source fingerprint mismatch for ${area}` : "Freshness metadata matches current repository state.",
      recorded_source_fingerprint: `sha256:${"1".repeat(64)}`,
      current_source_fingerprint: `sha256:${"2".repeat(64)}`,
      source_changed: stale,
      baseline_status: "fresh",
      semantic_status: "pending",
      index_status: "fresh",
    }],
    refresh_task: {
      changed_paths: ["backend/src/main/java/com/frontierscan/article/Article.java"],
      targets: stale ? [{
        area,
        module: area === "common" ? null : "article",
        modules: area === "common" ? [] : ["article"],
        mode: "baseline",
        reason: `source fingerprint mismatch for ${area}`,
        source_paths: area === "common"
          ? [".harness/scripts/lib/story-runtime.mjs"]
          : ["backend/src/main/java/com/frontierscan/article/Article.java"],
      }] : [],
    },
  };
}

async function testStaleAreaCreatesImmutableEvidenceAndTask() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-runtime-"));
  try {
    await write(root, "llm-knowledge/backend/modules/article/custom/business-rules.md", "# Manual\n");
    const result = await checkKnowledgeArea({
      root,
      task: task(),
      area: "backend",
      loadedFiles: ["llm-knowledge/backend/meta.yaml"],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });

    assert.equal(result.area.area, "backend");
    assert.equal(result.area.relevant, true);
    assert.equal(result.area.observedStatus, "stale");
    assert.equal(result.area.status, "stale");
    assert.equal(result.area.sourceFingerprint, `sha256:${"2".repeat(64)}`);
    assert.match(result.area.freshnessEvidencePath, /knowledge\/checks\/CHK-[a-f0-9]{32}\.json$/);
    assert.match(result.area.refreshTaskPath, /knowledge\/tasks\/KRT-[a-f0-9]{32}\.json$/);
    assert.equal(result.area.refreshReceiptPath, null);
    assert.equal(result.area.approvalId, null);

    const refreshTask = JSON.parse(await readFile(path.join(root, result.area.refreshTaskPath), "utf8"));
    assert.deepEqual(refreshTask.parameters, {
      area: "backend",
      module: "article",
      mode: "baseline",
    });
    assert.equal(Object.hasOwn(refreshTask, "command"), false);
    assert.deepEqual(refreshTask.protectedAreas, ["backend"]);
    assert.equal(refreshTask.customSnapshots.length, 1);
    assert.equal(refreshTask.customSnapshots[0].area, "backend");
    assert.equal(refreshTask.customSnapshots[0].files.length, 1);

    const repeated = await checkKnowledgeArea({
      root,
      task: task(),
      area: "backend",
      loadedFiles: ["llm-knowledge/backend/meta.yaml"],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });
    assert.equal(repeated.area.freshnessEvidencePath, result.area.freshnessEvidencePath);
    assert.equal(repeated.area.refreshTaskPath, result.area.refreshTaskPath);

    await assert.doesNotReject(verifyKnowledgeAreaArtifacts({
      root,
      task: task(),
      area: result.area,
    }));
    await writeFile(path.join(root, result.area.freshnessEvidencePath), "{}\n", "utf8");
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({ root, task: task(), area: result.area }),
      /freshness evidence.*changed|hash/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testFreshAreaDoesNotCreateRefreshTask() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-runtime-"));
  try {
    const result = await checkKnowledgeArea({
      root,
      task: task("M7-C-FRESH"),
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("fresh"),
    });
    assert.equal(result.area.observedStatus, "fresh");
    assert.equal(result.area.status, "fresh");
    assert.equal(result.area.refreshTaskPath, null);
    assert.equal(result.area.refreshTaskSha256, null);
    assert.equal(result.area.refreshReceiptPath, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRefreshWritesReceiptAndRecoversAfterReceiptInterruption() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-refresh-"));
  try {
    await write(root, "llm-knowledge/backend/modules/article/custom/business-rules.md", "# Manual\n");
    await write(root, "llm-knowledge/backend/modules/article/log.md", "old\n");
    await write(root, "llm-knowledge/index/manifest.json", "{}\n");
    const preparedTask = task("M7-C-REFRESH");
    const stale = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: ["llm-knowledge/backend/meta.yaml"],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });
    let generateCalls = 0;
    const runGenerate = async (parameters) => {
      generateCalls += 1;
      assert.deepEqual(parameters, { area: "backend", module: "article", mode: "baseline" });
      await write(root, "llm-knowledge/backend/meta.yaml", "status: fresh\n");
      await write(root, "llm-knowledge/backend/modules/article/log.md", "new\n");
      await write(root, "llm-knowledge/index/manifest.json", '{"status":"fresh"}\n');
    };

    await assert.rejects(
      refreshKnowledgeArea({
        root,
        task: preparedTask,
        area: stale.area,
        now: () => FIXED_NOW,
        runGenerate,
        runFreshness: async () => freshness("fresh"),
        verifyCurrentFingerprint: false,
        afterReceiptWrite: async () => { throw new Error("simulated post-receipt interruption"); },
      }),
      /post-receipt interruption/i,
    );
    assert.equal(generateCalls, 1);

    const recovered = await refreshKnowledgeArea({
      root,
      task: preparedTask,
      area: stale.area,
      now: () => FIXED_NOW,
      runGenerate,
      runFreshness: async () => freshness("fresh"),
      verifyCurrentFingerprint: false,
    });
    assert.equal(generateCalls, 1);
    assert.equal(recovered.area.observedStatus, "fresh");
    assert.equal(recovered.area.status, "fresh");
    assert.equal(recovered.area.refreshTaskPath, stale.area.refreshTaskPath);
    assert.match(recovered.area.refreshReceiptPath, /knowledge\/refreshes\/KRR-[a-f0-9]{32}\.json$/);
    assert.match(recovered.area.refreshReceiptSha256, /^sha256:[a-f0-9]{64}$/);
    await assert.doesNotReject(verifyKnowledgeAreaArtifacts({
      root,
      task: preparedTask,
      area: recovered.area,
    }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testKnowledgeArtifactsRejectParentJunctionEscape() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-junction-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-outside-"));
  try {
    const preparedTask = task("M7-C-JUNCTION");
    const checks = path.join(root, preparedTask.attemptRoot, "knowledge", "checks");
    await mkdir(path.dirname(checks), { recursive: true });
    await symlink(outside, checks, "junction");
    await assert.rejects(
      checkKnowledgeArea({
        root,
        task: preparedTask,
        area: "backend",
        loadedFiles: [],
        now: () => FIXED_NOW,
        runFreshness: async () => freshness("fresh"),
      }),
      /symbolic link|junction|outside repository/i,
    );
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

async function testRefreshRejectsWritableKnowledgeJunctionBeforeGeneratorRuns() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-refresh-junction-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-refresh-outside-"));
  try {
    await write(root, "llm-knowledge/backend/log.md", "old\n");
    await mkdir(path.join(root, "llm-knowledge"), { recursive: true });
    await symlink(outside, path.join(root, "llm-knowledge/index"), "junction");
    const preparedTask = task("M7-C-REFRESH-JUNCTION");
    const stale = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });
    let generateCalls = 0;
    await assert.rejects(
      refreshKnowledgeArea({
        root,
        task: preparedTask,
        area: stale.area,
        now: () => FIXED_NOW,
        verifyCurrentFingerprint: false,
        runGenerate: async () => {
          generateCalls += 1;
          await write(root, "llm-knowledge/index/manifest.json", '{"escaped":true}\n');
        },
        runFreshness: async () => freshness("fresh"),
      }),
      /symbolic link|junction|outside repository/i,
    );
    assert.equal(generateCalls, 0);
    assert.deepEqual(await readdir(outside), []);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}

async function testKnowledgeArtifactCategoryCannotUseDotDotPrefixBypass() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-prefix-bypass-"));
  try {
    const preparedTask = task("M7-C-PREFIX-BYPASS");
    const checked = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("fresh"),
    });
    const source = await readFile(path.join(root, checked.area.freshnessEvidencePath));
    const fileName = path.basename(checked.area.freshnessEvidencePath);
    const bypassPath = `${preparedTask.attemptRoot}/knowledge/checks/../tasks/${fileName}`;
    await write(root, bypassPath, source);
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({
        root,
        task: preparedTask,
        area: {
          ...checked.area,
          freshnessEvidencePath: bypassPath,
          freshnessEvidenceSha256: await fileSha256(root, bypassPath),
        },
      }),
      /attempt|checks|scoped|directory/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCurrentSourceFingerprintDriftIsRejected() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-source-drift-"));
  try {
    await write(root, "backend/src/main/java/com/frontierscan/article/Article.java", "class Article {}\n");
    const current = await computeAreaSourceFingerprint(root, "backend");
    const raw = freshness("stale");
    raw.findings[0].current_source_fingerprint = current.fingerprint;
    const preparedTask = task("M7-C-SOURCE-DRIFT");
    const checked = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => raw,
    });
    await assert.doesNotReject(verifyKnowledgeAreaArtifacts({
      root,
      task: preparedTask,
      area: checked.area,
      verifyCurrentFingerprint: true,
    }));
    await write(root, "backend/src/main/java/com/frontierscan/article/Article.java", "class Article { int changed; }\n");
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({
        root,
        task: preparedTask,
        area: checked.area,
        verifyCurrentFingerprint: true,
      }),
      /source fingerprint.*changed|fingerprint.*current/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testKnowledgeArtifactContentIdentityIsStrictlyVerified() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-identity-"));
  try {
    const preparedTask = task("M7-C-IDENTITY");
    const checked = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });

    const forgedEvidence = JSON.parse(await readFile(path.join(root, checked.area.freshnessEvidencePath), "utf8"));
    forgedEvidence.checkId = `CHK-${"f".repeat(32)}`;
    await write(root, checked.area.freshnessEvidencePath, `${JSON.stringify(forgedEvidence, null, 2)}\n`);
    const forgedEvidenceArea = {
      ...checked.area,
      freshnessEvidenceSha256: await fileSha256(root, checked.area.freshnessEvidencePath),
    };
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({ root, task: preparedTask, area: forgedEvidenceArea }),
      /content identity|checkId|file name/i,
    );

    const valid = await checkKnowledgeArea({
      root,
      task: task("M7-C-FILENAME"),
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });
    const mismatchedPath = valid.area.freshnessEvidencePath.replace(/CHK-[a-f0-9]{32}\.json$/, `CHK-${"e".repeat(32)}.json`);
    await write(root, mismatchedPath, await readFile(path.join(root, valid.area.freshnessEvidencePath), "utf8"));
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({
        root,
        task: task("M7-C-FILENAME"),
        area: {
          ...valid.area,
          freshnessEvidencePath: mismatchedPath,
          freshnessEvidenceSha256: await fileSha256(root, mismatchedPath),
        },
      }),
      /content identity|checkId|file name/i,
    );

    const invalidTask = JSON.parse(await readFile(path.join(root, valid.area.refreshTaskPath), "utf8"));
    invalidTask.parameters.mode = "dangerous";
    invalidTask.parameters.module = "../outside";
    await write(root, valid.area.refreshTaskPath, `${JSON.stringify(invalidTask, null, 2)}\n`);
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({
        root,
        task: task("M7-C-FILENAME"),
        area: {
          ...valid.area,
          refreshTaskSha256: await fileSha256(root, valid.area.refreshTaskPath),
        },
      }),
      /refresh task|mode|module|content identity/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testReceiptRequiresCompleteContentAddressedContract() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-receipt-identity-"));
  try {
    await write(root, "llm-knowledge/backend/modules/article/log.md", "old\n");
    await write(root, "llm-knowledge/index/manifest.json", "{}\n");
    const preparedTask = task("M7-C-RECEIPT-IDENTITY");
    const stale = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale"),
    });
    const refreshed = await refreshKnowledgeArea({
      root,
      task: preparedTask,
      area: stale.area,
      now: () => FIXED_NOW,
      verifyCurrentFingerprint: false,
      runGenerate: async () => {
        await write(root, "llm-knowledge/backend/meta.yaml", "status: fresh\n");
        await write(root, "llm-knowledge/backend/modules/article/log.md", "new\n");
        await write(root, "llm-knowledge/index/manifest.json", '{"status":"fresh"}\n');
      },
      runFreshness: async () => freshness("fresh"),
    });
    const receipt = JSON.parse(await readFile(path.join(root, refreshed.area.refreshReceiptPath), "utf8"));
    delete receipt.parameters;
    delete receipt.beforeFreshnessEvidencePath;
    delete receipt.beforeFreshnessEvidenceSha256;
    await write(root, refreshed.area.refreshReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    await assert.rejects(
      verifyKnowledgeAreaArtifacts({
        root,
        task: preparedTask,
        area: {
          ...refreshed.area,
          refreshReceiptSha256: await fileSha256(root, refreshed.area.refreshReceiptPath),
        },
      }),
      /refresh receipt|content identity|required/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testImmutableArtifactRejectsCanonicalOnlyReuse() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-byte-identity-"));
  try {
    const preparedTask = task("M7-C-BYTE-IDENTITY");
    const first = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "backend",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("fresh"),
    });
    const evidence = JSON.parse(await readFile(path.join(root, first.area.freshnessEvidencePath), "utf8"));
    await write(root, first.area.freshnessEvidencePath, JSON.stringify(evidence));
    await assert.rejects(
      checkKnowledgeArea({
        root,
        task: preparedTask,
        area: "backend",
        loadedFiles: [],
        now: () => FIXED_NOW,
        runFreshness: async () => freshness("fresh"),
      }),
      /immutable|identity collision|byte/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testCommonRefreshProtectsAllWrittenKnowledgeAreas() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-common-protection-"));
  try {
    await write(root, "llm-knowledge/backend/modules/article/custom/business-rules.md", "# Manual\n");
    await write(root, "llm-knowledge/common/log.md", "old\n");
    await write(root, "llm-knowledge/index/manifest.json", "{}\n");
    const preparedTask = task("M7-C-COMMON-PROTECTION");
    const stale = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "common",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale", "common"),
    });
    await assert.rejects(
      refreshKnowledgeArea({
        root,
        task: preparedTask,
        area: stale.area,
        now: () => FIXED_NOW,
        verifyCurrentFingerprint: false,
        runGenerate: async () => {
          await write(root, "llm-knowledge/backend/modules/article/custom/business-rules.md", "# Changed\n");
          await write(root, "llm-knowledge/common/overview.md", "# Common\n");
          await write(root, "llm-knowledge/common/log.md", "new\n");
          await write(root, "llm-knowledge/index/manifest.json", '{"status":"fresh"}\n');
        },
        runFreshness: async () => freshness("fresh", "common"),
      }),
      /custom snapshot changed/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testSequentialAreaRefreshReceiptsRemainComposable() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-knowledge-composable-refresh-"));
  try {
    for (const area of ["backend", "frontend", "common"]) {
      await write(root, `llm-knowledge/${area}/log.md`, "old\n");
    }
    await write(root, "llm-knowledge/index/manifest.json", "{}\n");
    const preparedTask = task("M7-C-COMPOSABLE");
    const refreshedAreas = [];
    for (const area of ["backend", "frontend"]) {
      const stale = await checkKnowledgeArea({
        root,
        task: preparedTask,
        area,
        loadedFiles: [],
        now: () => FIXED_NOW,
        runFreshness: async () => freshness("stale", area),
      });
      refreshedAreas.push((await refreshKnowledgeArea({
        root,
        task: preparedTask,
        area: stale.area,
        now: () => FIXED_NOW,
        verifyCurrentFingerprint: false,
        runGenerate: async () => {
          await write(root, `llm-knowledge/${area}/meta.yaml`, "status: fresh\n");
          await write(root, `llm-knowledge/${area}/log.md`, `${area} refreshed\n`);
          await write(root, "llm-knowledge/index/manifest.json", `{"last":"${area}"}\n`);
        },
        runFreshness: async () => freshness("fresh", area),
      })).area);
    }
    await assert.doesNotReject(verifyKnowledgeAreaArtifacts({
      root,
      task: preparedTask,
      area: refreshedAreas[0],
    }));

    const commonStale = await checkKnowledgeArea({
      root,
      task: preparedTask,
      area: "common",
      loadedFiles: [],
      now: () => FIXED_NOW,
      runFreshness: async () => freshness("stale", "common"),
    });
    const commonRefreshed = await refreshKnowledgeArea({
      root,
      task: preparedTask,
      area: commonStale.area,
      now: () => FIXED_NOW,
      verifyCurrentFingerprint: false,
      runGenerate: async () => {
        for (const area of ["backend", "frontend", "common"]) {
          await write(root, `llm-knowledge/${area}/meta.yaml`, "status: fresh\n");
          await write(root, `llm-knowledge/${area}/log.md`, `${area} refreshed by common\n`);
        }
        await write(root, "llm-knowledge/common/overview.md", "# Common\n");
        await write(root, "llm-knowledge/index/manifest.json", '{"last":"common"}\n');
      },
      runFreshness: async () => freshness("fresh", "common"),
    });
    for (const area of [...refreshedAreas, commonRefreshed.area]) {
      await assert.doesNotReject(verifyKnowledgeAreaArtifacts({
        root,
        task: preparedTask,
        area,
      }));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

await testStaleAreaCreatesImmutableEvidenceAndTask();
await testFreshAreaDoesNotCreateRefreshTask();
await testRefreshWritesReceiptAndRecoversAfterReceiptInterruption();
await testKnowledgeArtifactsRejectParentJunctionEscape();
await testRefreshRejectsWritableKnowledgeJunctionBeforeGeneratorRuns();
await testKnowledgeArtifactCategoryCannotUseDotDotPrefixBypass();
await testCurrentSourceFingerprintDriftIsRejected();
await testKnowledgeArtifactContentIdentityIsStrictlyVerified();
await testReceiptRequiresCompleteContentAddressedContract();
await testImmutableArtifactRejectsCanonicalOnlyReuse();
await testCommonRefreshProtectsAllWrittenKnowledgeAreas();
await testSequentialAreaRefreshReceiptsRemainComposable();
console.log("knowledge-runtime tests passed");
