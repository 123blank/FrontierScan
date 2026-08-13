import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  deriveDeliveryFacts,
  prepareOwnedManifest,
  recordDeliveryReceipt,
} from "../lib/delivery-runtime.mjs";
import {
  validateDeliveryFacts,
  validateDeliveryReceipt,
  validateOwnedManifest,
} from "../lib/delivery-contract.mjs";

const execFileAsync = promisify(execFile);
const NOW = "2026-08-13T00:00:00.000Z";
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

async function git(root, ...args) {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
}

async function write(root, relativePath, content) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-delivery-"));
  await git(root, "init", "-b", "dev");
  await git(root, "config", "user.email", "delivery@example.test");
  await git(root, "config", "user.name", "Delivery Test");
  await write(root, "backend/owned.txt", "baseline\n");
  await write(root, "docs/unrelated.md", "docs baseline\n");
  await git(root, "add", ".");
  await git(root, "commit", "-m", "baseline");
  const baselineHead = (await git(root, "rev-parse", "HEAD")).stdout.trim();
  const state = {
    schemaVersion: "2.0",
    storyId: "M7-A4-DELIVERY",
    phase: "delivery-preparation",
    runtime: { runId: "M7-A4-DELIVERY" },
    baseline: {
      head: baselineHead,
      branch: "dev",
      initialDirtyPaths: [],
      capturedAt: NOW,
    },
    implementation: {
      actualFiles: ["backend/owned.txt", "frontend/new.txt"],
    },
    dag: {
      nodes: [{
        taskId: "T1",
        predictedFiles: ["backend/**"],
      }],
    },
  };
  return { root, state };
}

async function testDerivesOwnedPredictionRiskAndUnrelated() {
  const { root, state } = await fixture();
  try {
    await write(root, "backend/owned.txt", "changed\n");
    await write(root, "frontend/new.txt", "new\n");
    await write(root, "docs/unrelated.md", "unrelated\n");
    await write(root, `.harness/runs/${state.runtime.runId}/phases/report.md`, "control\n");

    const facts = await deriveDeliveryFacts({ root, state });
    validateDeliveryFacts(facts);
    assert.deepEqual(facts.ownedFiles, ["backend/owned.txt", "frontend/new.txt"]);
    assert.deepEqual(facts.outOfPredictionFiles, ["frontend/new.txt"]);
    assert.deepEqual(facts.unrelatedDirtyFiles, ["docs/unrelated.md"]);
    assert.equal(facts.relations.find((item) => item.path === "backend/owned.txt").changeKind, "modified");
    assert.equal(facts.relations.find((item) => item.path === "frontend/new.txt").changeKind, "added");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testPredictionCannotClaimDirtyFile() {
  const { root, state } = await fixture();
  try {
    state.implementation.actualFiles = [];
    state.dag.nodes[0].predictedFiles.push("docs/unrelated.md");
    await write(root, "docs/unrelated.md", "changed\n");
    const facts = await deriveDeliveryFacts({ root, state });
    assert.deepEqual(facts.ownedFiles, []);
    assert.deepEqual(facts.unrelatedDirtyFiles, ["docs/unrelated.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testInitialDirtyCollisionFailsClosed() {
  const { root, state } = await fixture();
  try {
    state.baseline.initialDirtyPaths = [{
      path: "backend/owned.txt",
      sourcePath: null,
      indexStatus: " ",
      worktreeStatus: "M",
      untracked: false,
    }];
    await write(root, "backend/owned.txt", "changed\n");
    await assert.rejects(
      deriveDeliveryFacts({ root, state }),
      /initial dirty.*actual|actual.*initial dirty/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testManifestIsStableAndExcludesItself() {
  const { root, state } = await fixture();
  try {
    await write(root, "backend/owned.txt", "changed\n");
    state.implementation.actualFiles = ["backend/owned.txt"];
    const first = await prepareOwnedManifest({ root, state, now: () => NOW });
    validateOwnedManifest(first.manifest);
    assert.equal(first.status, "prepared");
    assert.equal(first.manifest.entries.length, 1);
    assert.equal(first.manifest.entries[0].path, "backend/owned.txt");
    assert.match(first.manifest.entries[0].contentSha256, /^sha256:[a-f0-9]{64}$/);
    assert.match(first.manifest.entries[0].blobOid, /^[a-f0-9]{40}$/);
    assert.equal(first.manifest.entries[0].mode, "100644");

    const second = await prepareOwnedManifest({ root, state, now: () => NOW });
    assert.equal(second.status, "already-prepared");
    assert.equal(second.manifestSha256, first.manifestSha256);
    const facts = await deriveDeliveryFacts({ root, state });
    assert.deepEqual(facts.ownedFiles, ["backend/owned.txt"]);
    assert.deepEqual(facts.unrelatedDirtyFiles, []);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, first.manifestFile), "utf8")),
      first.manifest,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testRenameExpandsFactsButUsesOneManifestRelation() {
  const { root, state } = await fixture();
  try {
    await git(root, "mv", "backend/owned.txt", "backend/renamed.txt");
    state.implementation.actualFiles = ["backend/owned.txt", "backend/renamed.txt"];
    state.dag.nodes[0].predictedFiles = ["backend/owned.txt", "backend/renamed.txt"];

    const facts = await deriveDeliveryFacts({ root, state });
    assert.deepEqual(facts.ownedFiles, ["backend/owned.txt", "backend/renamed.txt"]);
    assert.deepEqual(facts.relations, [{
      path: "backend/renamed.txt",
      changeKind: "renamed",
      sourcePath: "backend/owned.txt",
    }]);

    const prepared = await prepareOwnedManifest({ root, state, now: () => NOW });
    assert.deepEqual(prepared.manifest.entries.map((item) => ({
      path: item.path,
      changeKind: item.changeKind,
      sourcePath: item.sourcePath,
    })), [{
      path: "backend/renamed.txt",
      changeKind: "renamed",
      sourcePath: "backend/owned.txt",
    }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testDeletedPathRecreatedIsFoldedToNetChange() {
  for (const commitDeletion of [false, true]) {
    const { root, state } = await fixture();
    try {
      state.implementation.actualFiles = ["backend/owned.txt"];
      await git(root, "rm", "backend/owned.txt");
      if (commitDeletion) await git(root, "commit", "-m", "delete owned");
      await write(root, "backend/owned.txt", commitDeletion ? "rebuilt\n" : "baseline\n");

      if (commitDeletion) {
        const facts = await deriveDeliveryFacts({ root, state });
        assert.deepEqual(facts.relations, [{
          path: "backend/owned.txt",
          changeKind: "modified",
          sourcePath: null,
        }]);
      } else {
        await assert.rejects(
          deriveDeliveryFacts({ root, state }),
          /actual file is not changed/i,
        );
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testUnstagedFilesystemRenameAndCopyAreDetected() {
  const renamed = await fixture();
  try {
    await git(renamed.root, "mv", "backend/owned.txt", "backend/renamed.txt");
    await git(renamed.root, "reset");
    renamed.state.implementation.actualFiles = ["backend/owned.txt", "backend/renamed.txt"];
    const facts = await deriveDeliveryFacts({ root: renamed.root, state: renamed.state });
    assert.deepEqual(facts.relations, [{
      path: "backend/renamed.txt",
      changeKind: "renamed",
      sourcePath: "backend/owned.txt",
    }]);
  } finally {
    await rm(renamed.root, { recursive: true, force: true });
  }

  const copied = await fixture();
  try {
    await write(copied.root, "backend/copied.txt", "baseline\n");
    copied.state.implementation.actualFiles = ["backend/copied.txt"];
    const facts = await deriveDeliveryFacts({ root: copied.root, state: copied.state });
    assert.deepEqual(facts.relations, [{
      path: "backend/copied.txt",
      changeKind: "copied",
      sourcePath: "backend/owned.txt",
    }]);
  } finally {
    await rm(copied.root, { recursive: true, force: true });
  }
}

async function testCrossControlAssetRenameFailsClosed() {
  for (const [source, target] of [
    ["backend/owned.txt", ".harness/runs/M7-A4-DELIVERY/phases/owned.txt"],
    [".harness/runs/M7-A4-DELIVERY/phases/control.txt", "backend/from-control.txt"],
  ]) {
    const { root, state } = await fixture();
    try {
      if (source.startsWith(".harness/")) {
        await write(root, source, "control\n");
        await git(root, "add", source);
        await git(root, "commit", "-m", "add control source");
        state.baseline.head = (await git(root, "rev-parse", "HEAD")).stdout.trim();
      }
      await mkdir(path.dirname(path.join(root, target)), { recursive: true });
      await git(root, "mv", source, target);
      await assert.rejects(
        deriveDeliveryFacts({ root, state }),
        /control asset.*rename|rename.*control asset/i,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

async function testCopySourceParticipatesInSafetyChecks() {
  const control = await fixture();
  try {
    const controlSource = `.harness/runs/${control.state.runtime.runId}/source.txt`;
    await write(control.root, controlSource, "copied content\n");
    await git(control.root, "add", controlSource);
    await git(control.root, "commit", "-m", "add control source");
    control.state.baseline.head = (await git(control.root, "rev-parse", "HEAD")).stdout.trim();
    await write(control.root, "backend/from-control.txt", "copied content\n");
    control.state.implementation.actualFiles = ["backend/from-control.txt"];
    await assert.rejects(
      deriveDeliveryFacts({ root: control.root, state: control.state }),
      /copy.*control asset|control asset.*copy/i,
    );
  } finally {
    await rm(control.root, { recursive: true, force: true });
  }

  const dirty = await fixture();
  try {
    dirty.state.baseline.initialDirtyPaths = [{
      path: "backend/owned.txt",
      indexStatus: " ",
      worktreeStatus: "M",
      untracked: false,
    }];
    await write(dirty.root, "backend/copied.txt", "baseline\n");
    dirty.state.implementation.actualFiles = ["backend/copied.txt"];
    await assert.rejects(
      deriveDeliveryFacts({ root: dirty.root, state: dirty.state }),
      /initial dirty.*copy|copy.*initial dirty/i,
    );
  } finally {
    await rm(dirty.root, { recursive: true, force: true });
  }
}

async function completedDeliveryFixture() {
  const value = await fixture();
  await write(value.root, "backend/owned.txt", "changed\n");
  value.state.implementation.actualFiles = ["backend/owned.txt"];
  const prepared = await prepareOwnedManifest({ root: value.root, state: value.state, now: () => NOW });
  const summaryFile = `.harness/runs/${value.state.runtime.runId}/phases/08-delivery-preparation/delivery-report.md`;
  await write(value.root, summaryFile, "# Delivery ready\n");
  const summaryContent = await readFile(path.join(value.root, summaryFile));
  const completedState = JSON.parse(await readFile(
    path.join(REPOSITORY_ROOT, ".harness/states/e2e-state-v2.template.json"),
    "utf8",
  ));
  completedState.storyId = value.state.storyId;
  completedState.phase = "done";
  completedState.runtime = {
    ...completedState.runtime,
    runId: value.state.runtime.runId,
    status: "completed",
    revision: 9,
    createdAt: NOW,
    updatedAt: NOW,
  };
  completedState.baseline = value.state.baseline;
  completedState.implementation.actualFiles = [...value.state.implementation.actualFiles];
  completedState.delivery = {
    status: "ready",
    ownedFiles: prepared.facts.ownedFiles,
    outOfPredictionFiles: prepared.facts.outOfPredictionFiles,
    unrelatedDirtyFiles: prepared.facts.unrelatedDirtyFiles,
    remainingRisks: [],
    summaryFile,
    summarySha256: `sha256:${createHash("sha256").update(summaryContent).digest("hex")}`,
    ownedManifestFile: prepared.manifestFile,
    ownedManifestSha256: prepared.manifestSha256,
    gitStatus: "not-requested",
  };
  value.state = completedState;
  const stateFile = `.harness/states/e2e-${value.state.storyId}.json`;
  const eventsFile = `.harness/states/e2e-${value.state.storyId}.events.jsonl`;
  await write(value.root, stateFile, `${JSON.stringify(value.state, null, 2)}\n`);
  await write(value.root, eventsFile, `${JSON.stringify({ event: "completed" })}\n`);
  await write(value.root, ".harness/states/active-run.json", `${JSON.stringify({
    schemaVersion: "1.0",
    runId: value.state.runtime.runId,
    stateFile,
    status: "completed",
    revision: 9,
    updatedAt: NOW,
  }, null, 2)}\n`);
  return { ...value, prepared, stateFile, eventsFile };
}

async function testNotRequestedReceiptIsAppendOnlyAndIdempotent() {
  const fixtureValue = await completedDeliveryFixture();
  try {
    const before = await Promise.all([
      readFile(path.join(fixtureValue.root, fixtureValue.stateFile), "utf8"),
      readFile(path.join(fixtureValue.root, fixtureValue.eventsFile), "utf8"),
      readFile(path.join(fixtureValue.root, ".harness/states/active-run.json"), "utf8"),
    ]);
    const first = await recordDeliveryReceipt({
      root: fixtureValue.root,
      stateFile: fixtureValue.stateFile,
      now: () => NOW,
    });
    validateDeliveryReceipt(first.receipt);
    assert.equal(first.status, "recorded");
    assert.equal(first.receipt.commit.status, "not-requested");
    assert.equal(first.receipt.push.status, "not-requested");

    const second = await recordDeliveryReceipt({
      root: fixtureValue.root,
      stateFile: fixtureValue.stateFile,
      now: () => "2026-08-13T00:01:00.000Z",
    });
    assert.equal(second.status, "already-recorded");
    assert.equal(second.receiptId, first.receiptId);
    assert.deepEqual(await Promise.all([
      readFile(path.join(fixtureValue.root, fixtureValue.stateFile), "utf8"),
      readFile(path.join(fixtureValue.root, fixtureValue.eventsFile), "utf8"),
      readFile(path.join(fixtureValue.root, ".harness/states/active-run.json"), "utf8"),
    ]), before);
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
}

async function testReceiptRejectsIdentityAndTimestampDrift() {
  for (const mutate of [
    (receipt) => { receipt.receiptId = `DR-${"f".repeat(32)}`; },
    (receipt) => { receipt.recordedAt = "2026-08-13T01:00:00.000Z"; },
  ]) {
    const fixtureValue = await completedDeliveryFixture();
    try {
      const first = await recordDeliveryReceipt({
        root: fixtureValue.root,
        stateFile: fixtureValue.stateFile,
        now: () => NOW,
      });
      const receipt = JSON.parse(await readFile(path.join(fixtureValue.root, first.receiptFile), "utf8"));
      mutate(receipt);
      await write(fixtureValue.root, first.receiptFile, `${JSON.stringify(receipt, null, 2)}\n`);
      await assert.rejects(
        recordDeliveryReceipt({
          root: fixtureValue.root,
          stateFile: fixtureValue.stateFile,
          now: () => NOW,
        }),
        /receipt.*drift|receipt.*identity|receipt.*timestamp/i,
      );
    } finally {
      await rm(fixtureValue.root, { recursive: true, force: true });
    }
  }
}

async function testReceiptRecoversDeadOwnerLockButNotLiveOwner() {
  const fixtureValue = await completedDeliveryFixture();
  try {
    const lockFile = `${fixtureValue.stateFile}.delivery-receipt.lock`;
    await write(fixtureValue.root, lockFile, `${JSON.stringify({
      lockId: "dead-owner",
      pid: 2147483647,
      hostname: os.hostname(),
      createdAt: "2020-01-01T00:00:00.000Z",
    })}\n`);
    const recovered = await recordDeliveryReceipt({
      root: fixtureValue.root,
      stateFile: fixtureValue.stateFile,
      lockStaleMs: 1,
      lockWaitMs: 100,
      now: () => NOW,
    });
    assert.equal(recovered.status, "recorded");

    await write(fixtureValue.root, lockFile, `${JSON.stringify({
      lockId: "live-owner",
      pid: process.pid,
      hostname: os.hostname(),
      createdAt: NOW,
    })}\n`);
    await assert.rejects(
      recordDeliveryReceipt({
        root: fixtureValue.root,
        stateFile: fixtureValue.stateFile,
        lockStaleMs: 1,
        lockWaitMs: 50,
        now: () => NOW,
      }),
      /locked by process/i,
    );
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
}

async function testReceiptRejectsMalformedCompletedState() {
  const fixtureValue = await completedDeliveryFixture();
  try {
    const malformed = JSON.parse(await readFile(path.join(fixtureValue.root, fixtureValue.stateFile), "utf8"));
    delete malformed.requirement;
    await write(fixtureValue.root, fixtureValue.stateFile, `${JSON.stringify(malformed, null, 2)}\n`);
    await assert.rejects(
      recordDeliveryReceipt({
        root: fixtureValue.root,
        stateFile: fixtureValue.stateFile,
        now: () => NOW,
      }),
      /missing required field 'requirement'|requires.*requirement/i,
    );
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
}

async function testCommitReceiptVerifiesManifestTree() {
  const fixtureValue = await completedDeliveryFixture();
  try {
    await git(fixtureValue.root, "add", "backend/owned.txt");
    await git(fixtureValue.root, "commit", "-m", "deliver owned");
    const commit = (await git(fixtureValue.root, "rev-parse", "HEAD")).stdout.trim();
    const recorded = await recordDeliveryReceipt({
      root: fixtureValue.root,
      stateFile: fixtureValue.stateFile,
      commit,
      now: () => NOW,
    });
    assert.equal(recorded.receipt.commit.status, "recorded");
    assert.equal(recorded.receipt.commit.sha, commit);
    assert.deepEqual(recorded.receipt.commit.extraFiles, []);

    await write(fixtureValue.root, "backend/owned.txt", "different\n");
    await git(fixtureValue.root, "add", "backend/owned.txt");
    await git(fixtureValue.root, "commit", "-m", "different content");
    const different = (await git(fixtureValue.root, "rev-parse", "HEAD")).stdout.trim();
    await assert.rejects(
      recordDeliveryReceipt({
        root: fixtureValue.root,
        stateFile: fixtureValue.stateFile,
        commit: different,
        now: () => NOW,
      }),
      /manifest.*blob|blob.*manifest|tree.*manifest/i,
    );
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
}

async function testPushReceiptUsesReadOnlyRemoteFacts() {
  const fixtureValue = await completedDeliveryFixture();
  try {
    await git(fixtureValue.root, "add", "backend/owned.txt");
    await git(fixtureValue.root, "commit", "-m", "deliver owned");
    const commit = (await git(fixtureValue.root, "rev-parse", "HEAD")).stdout.trim();
    let remoteArgs = null;
    const recorded = await recordDeliveryReceipt({
      root: fixtureValue.root,
      stateFile: fixtureValue.stateFile,
      commit,
      remote: "origin",
      ref: "refs/heads/dev",
      executeRemoteGit: async (args) => {
        remoteArgs = args;
        return { stdout: `${commit}\trefs/heads/dev\n`, stderr: "" };
      },
      now: () => NOW,
    });
    assert.deepEqual(remoteArgs, ["ls-remote", "--refs", "origin", "refs/heads/dev"]);
    assert.deepEqual(recorded.receipt.push, {
      status: "recorded",
      remote: "origin",
      ref: "refs/heads/dev",
      commit,
    });

    await assert.rejects(
      recordDeliveryReceipt({
        root: fixtureValue.root,
        stateFile: fixtureValue.stateFile,
        commit,
        remote: "origin",
        ref: "refs/heads/dev",
        executeRemoteGit: async () => ({ stdout: `${"f".repeat(40)}\trefs/heads/dev\n`, stderr: "" }),
        now: () => NOW,
      }),
      /does not point to commit/i,
    );
  } finally {
    await rm(fixtureValue.root, { recursive: true, force: true });
  }
}

await testDerivesOwnedPredictionRiskAndUnrelated();
await testPredictionCannotClaimDirtyFile();
await testInitialDirtyCollisionFailsClosed();
await testManifestIsStableAndExcludesItself();
await testRenameExpandsFactsButUsesOneManifestRelation();
await testDeletedPathRecreatedIsFoldedToNetChange();
await testUnstagedFilesystemRenameAndCopyAreDetected();
await testCrossControlAssetRenameFailsClosed();
await testCopySourceParticipatesInSafetyChecks();
await testNotRequestedReceiptIsAppendOnlyAndIdempotent();
await testReceiptRejectsIdentityAndTimestampDrift();
await testReceiptRecoversDeadOwnerLockButNotLiveOwner();
await testReceiptRejectsMalformedCompletedState();
await testCommitReceiptVerifiesManifestTree();
await testPushReceiptUsesReadOnlyRemoteFacts();
console.log("delivery-runtime tests passed");
