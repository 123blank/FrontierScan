import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  claimWaveTask,
  createWaveExecutionLedger,
  deriveWaveExecutionStatus,
  inspectWaveExecution,
  recoverAttempt,
  validateWaveExecutionLedger,
} from "../lib/worktree-wave-execution-runtime.mjs";

const FIXED_NOW = "2026-08-06T00:00:00.000Z";
const SHA = `sha256:${"a".repeat(64)}`;

async function write(root, relativePath, value) {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256(root, relativePath) {
  return `sha256:${createHash("sha256").update(
    await readFile(path.join(root, relativePath)),
  ).digest("hex")}`;
}

async function createPreparedFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-wave-execution-"));
  const state = {
    schemaVersion: "1.0",
    storyId: "M5-D-C1-FIXTURE",
    phase: "implementation",
    runtime: {
      runId: "M5-D-C1-FIXTURE",
      status: "active",
      revision: 7,
    },
  };
  const waveId = "wave-0123456789abcdef";
  const taskRoot = (taskId) => `.harness/runs/${state.runtime.runId}/waves/${waveId}/tasks/${taskId}`;
  const tasks = ["T1", "T2"].map((taskId, index) => ({
    reused: false,
    taskFile: `${taskRoot(taskId)}/task.json`,
    checkpointFile: `${taskRoot(taskId)}/checkpoint.json`,
    task: {
      schemaVersion: "1.2",
      dispatchId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      storyId: state.storyId,
      runId: state.runtime.runId,
      phase: "implementation",
      waveId,
      waveIndex: 1,
      taskId,
      taskRoot: taskRoot(taskId),
      ownerAgent: "backend-developer",
      purpose: `Implement ${taskId}`,
      preparedRevision: 7,
      preparedAt: FIXED_NOW,
      expectedOutputs: [`${taskRoot(taskId)}/report.md`],
      allowedAdapters: [],
      next: "unit-test",
    },
  }));
  for (const item of tasks) {
    item.checkpoint = {
      schemaVersion: "1.2",
      dispatchId: item.task.dispatchId,
      storyId: item.task.storyId,
      runId: item.task.runId,
      phase: item.task.phase,
      waveId,
      waveIndex: 1,
      taskId: item.task.taskId,
      taskRoot: item.task.taskRoot,
      status: "prepared",
      preparedAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    await write(root, item.taskFile, item.task);
    await write(root, item.checkpointFile, item.checkpoint);
  }
  return {
    root,
    state,
    waveId,
    tasks,
    wave: {
      waveIndex: 1,
      taskDagFile: `.harness/runs/${state.runtime.runId}/phases/02-task-dag/task-dag.json`,
      taskDagSha256: SHA,
      planFile: `.harness/runs/${state.runtime.runId}/waves/wave-1/plan.json`,
      planSha256: SHA,
      creationReceiptFile: `.harness/runs/${state.runtime.runId}/waves/wave-1/creation-receipt.json`,
      creationReceiptSha256: SHA,
      plan: { baseCommit: "a".repeat(40) },
    },
  };
}

test("creates a deterministic initial execution ledger and status is read-only", async () => {
  const fixture = await createPreparedFixture();
  try {
    const created = await createWaveExecutionLedger({
      root: fixture.root,
      state: fixture.state,
      wave: fixture.wave,
      waveId: fixture.waveId,
      tasks: fixture.tasks,
      now: () => FIXED_NOW,
    });
    assert.equal(created.ledger.status, "prepared");
    assert.deepEqual(created.ledger.tasks.map((task) => task.status), ["pending", "pending"]);
    const before = await readFile(path.join(fixture.root, created.ledgerFile), "utf8");
    const inspected = await inspectWaveExecution({
      root: fixture.root,
      ledgerFile: created.ledgerFile,
    });
    assert.equal(inspected.ledger.status, "prepared");
    assert.equal(await readFile(path.join(fixture.root, created.ledgerFile), "utf8"), before);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("derives wave status from task states", () => {
  assert.equal(deriveWaveExecutionStatus(["pending", "pending"]), "prepared");
  assert.equal(deriveWaveExecutionStatus(["running", "ready-for-integration"]), "executing");
  assert.equal(deriveWaveExecutionStatus(["blocked", "ready-for-integration"]), "partial");
  assert.equal(
    deriveWaveExecutionStatus(["ready-for-integration", "ready-for-integration"]),
    "ready-for-integration",
  );
});

test("derives C2 freeze, integration, and finalization states from bound evidence", () => {
  const ready = ["ready-for-integration", "ready-for-integration"];
  const integrated = ["integrated", "integrated"];
  const manifestFile = ".harness/runs/M5-D-C2-FIXTURE/waves/wave-1/integration-manifest.json";
  const waveReceiptFile = ".harness/runs/M5-D-C2-FIXTURE/waves/wave-1/wave-receipt.json";

  assert.equal(deriveWaveExecutionStatus(ready, {
    status: "freezing",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: null,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "freezing");
  assert.equal(deriveWaveExecutionStatus(ready, {
    status: "integration-frozen",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "integration-frozen");
  assert.equal(deriveWaveExecutionStatus(ready, {
    status: "integrating",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "integrating");
  assert.equal(deriveWaveExecutionStatus(["integrated", "ready-for-integration"], {
    status: "partial-integration",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "partial-integration");
  assert.equal(deriveWaveExecutionStatus(integrated, {
    status: "integrated",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "integrated");
  assert.equal(deriveWaveExecutionStatus(integrated, {
    status: "finalized",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile,
    waveReceiptSha256: SHA,
    finalizedAt: FIXED_NOW,
  }), "finalized");

  assert.equal(deriveWaveExecutionStatus(ready, {
    status: "freezing",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile: null,
    waveReceiptSha256: null,
    finalizedAt: null,
  }), "integration-frozen");
  assert.throws(() => deriveWaveExecutionStatus(integrated, {
    status: "finalized",
    integrationManifestFile: manifestFile,
    integrationManifestSha256: SHA,
    waveReceiptFile,
    waveReceiptSha256: null,
    finalizedAt: FIXED_NOW,
  }), /receipt|finalized/i);
});

test("rejects task evidence that contradicts task or top-level status", async () => {
  const fixture = await createPreparedFixture();
  try {
    const { ledger } = await createWaveExecutionLedger({
      root: fixture.root,
      state: fixture.state,
      wave: fixture.wave,
      waveId: fixture.waveId,
      tasks: fixture.tasks,
      now: () => FIXED_NOW,
    });

    const pendingWithAttempt = structuredClone(ledger);
    pendingWithAttempt.tasks[0].currentAttemptId = "attempt-0123456789abcdef";
    assert.throws(() => validateWaveExecutionLedger(pendingWithAttempt), /pending.*attempt/i);

    const runningWithoutAttempt = structuredClone(ledger);
    runningWithoutAttempt.status = "executing";
    runningWithoutAttempt.tasks[0].status = "running";
    assert.throws(() => validateWaveExecutionLedger(runningWithoutAttempt), /running.*attempt|lock/i);

    const readyWithoutReceipt = structuredClone(ledger);
    readyWithoutReceipt.status = "partial";
    readyWithoutReceipt.tasks[0].status = "ready-for-integration";
    readyWithoutReceipt.tasks[0].currentAttemptId = "attempt-0123456789abcdef";
    readyWithoutReceipt.tasks[0].startedAt = FIXED_NOW;
    assert.throws(() => validateWaveExecutionLedger(readyWithoutReceipt), /ready.*receipt/i);

    const wrongTopLevel = structuredClone(ledger);
    wrongTopLevel.status = "partial";
    assert.throws(() => validateWaveExecutionLedger(wrongTopLevel), /derived|top-level|status/i);

    const halfBoundManifest = structuredClone(ledger);
    halfBoundManifest.status = "freezing";
    halfBoundManifest.integrationManifestFile = null;
    halfBoundManifest.integrationManifestSha256 = SHA;
    assert.throws(() => validateWaveExecutionLedger(halfBoundManifest), /manifest/i);

    const finalizedWithoutReceipt = structuredClone(ledger);
    finalizedWithoutReceipt.tasks = finalizedWithoutReceipt.tasks.map((task) => ({
      ...task,
      status: "integrated",
      currentAttemptId: "attempt-0123456789abcdef",
      executionReceiptFile: "execution-receipt.json",
      executionReceiptSha256: SHA,
      integrationReceiptFile: "integration-receipt.json",
      integrationReceiptSha256: SHA,
      startedAt: FIXED_NOW,
      workerReadyAt: FIXED_NOW,
      integratedAt: FIXED_NOW,
    }));
    finalizedWithoutReceipt.status = "finalized";
    finalizedWithoutReceipt.integrationManifestFile = "integration-manifest.json";
    finalizedWithoutReceipt.integrationManifestSha256 = SHA;
    finalizedWithoutReceipt.finalizedAt = FIXED_NOW;
    assert.throws(() => validateWaveExecutionLedger(finalizedWithoutReceipt), /receipt|finalized/i);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("claim evidence written before ledger commit cannot strand a claiming task", async () => {
  const fixture = await createPreparedFixture();
  try {
    const created = await createWaveExecutionLedger({
      root: fixture.root,
      state: fixture.state,
      wave: fixture.wave,
      waveId: fixture.waveId,
      tasks: fixture.tasks,
      now: () => FIXED_NOW,
    });
    const interruptedAttemptId = "attempt-1000000000004000";
    await assert.rejects(
      claimWaveTask({
        root: fixture.root,
        ledgerFile: created.ledgerFile,
        taskId: "T1",
        expectedWaveLedgerSha256: await sha256(fixture.root, created.ledgerFile),
        expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
        now: () => FIXED_NOW,
        randomUUID: (() => {
          const values = [
            "10000000-0000-4000-8000-000000000011",
            "20000000-0000-4000-8000-000000000012",
            "30000000-0000-4000-8000-000000000013",
          ];
          return () => values.shift();
        })(),
        afterClaimEvidenceWriteBeforeLedgerCommit: () => {
          throw new Error("injected before claim ledger commit");
        },
      }),
      /injected before claim ledger commit/,
    );
    const afterInterruption = await inspectWaveExecution({
      root: fixture.root,
      ledgerFile: created.ledgerFile,
    });
    assert.equal(afterInterruption.ledger.tasks[0].status, "pending");
    assert.equal(afterInterruption.ledger.tasks[0].currentAttemptId, null);
    const orphanClaim = `.harness/runs/${fixture.state.runtime.runId}/waves/${fixture.waveId}/tasks/T1/attempts/${interruptedAttemptId}/claim.json`;
    assert.equal((await JSON.parse(await readFile(path.join(fixture.root, orphanClaim), "utf8"))).attemptId, interruptedAttemptId);

    const retried = await claimWaveTask({
      root: fixture.root,
      ledgerFile: created.ledgerFile,
      taskId: "T1",
      expectedWaveLedgerSha256: await sha256(fixture.root, created.ledgerFile),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      now: () => FIXED_NOW,
      randomUUID: (() => {
        const values = [
          "40000000-0000-4000-8000-000000000014",
          "50000000-0000-4000-8000-000000000015",
          "60000000-0000-4000-8000-000000000016",
        ];
        return () => values.shift();
      })(),
    });
    assert.notEqual(retried.claim.attemptId, interruptedAttemptId);
    assert.equal(retried.task.status, "running");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("same-process recovery waits while the mutation lock owner is still writing lock evidence", async () => {
  const fixture = await createPreparedFixture();
  try {
    const created = await createWaveExecutionLedger({
      root: fixture.root,
      state: fixture.state,
      wave: fixture.wave,
      waveId: fixture.waveId,
      tasks: fixture.tasks,
      now: () => FIXED_NOW,
    });
    async function createClaimingAttempt(taskId, values) {
      await assert.rejects(
        claimWaveTask({
          root: fixture.root,
          ledgerFile: created.ledgerFile,
          taskId,
          expectedWaveLedgerSha256: await sha256(fixture.root, created.ledgerFile),
          expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
          now: () => FIXED_NOW,
          randomUUID: (() => () => values.shift())(),
          afterClaimWrite: () => {
            throw new Error(`injected ${taskId} claiming interruption`);
          },
        }),
        new RegExp(`injected ${taskId} claiming interruption`),
      );
      const ledger = (await inspectWaveExecution({
        root: fixture.root,
        ledgerFile: created.ledgerFile,
      })).ledger;
      const task = ledger.tasks.find((item) => item.taskId === taskId);
      const claimFile = `.harness/runs/${fixture.state.runtime.runId}/waves/${fixture.waveId}/tasks/${taskId}/attempts/${task.currentAttemptId}/claim.json`;
      return {
        root: fixture.root,
        ledgerFile: created.ledgerFile,
        taskId,
        expectedAttemptId: task.currentAttemptId,
        expectedClaimSha256: await sha256(fixture.root, claimFile),
        expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
        confirmAttemptRecovery: true,
        now: () => FIXED_NOW,
      };
    }
    const firstAttempt = await createClaimingAttempt("T1", [
      "10000000-0000-4000-8000-000000000021",
      "20000000-0000-4000-8000-000000000022",
      "30000000-0000-4000-8000-000000000023",
    ]);
    const secondAttempt = await createClaimingAttempt("T2", [
      "40000000-0000-4000-8000-000000000024",
      "50000000-0000-4000-8000-000000000025",
      "60000000-0000-4000-8000-000000000026",
    ]);
    let markLockOpened;
    let releaseLockWrite;
    const lockOpened = new Promise((resolve) => { markLockOpened = resolve; });
    const lockWriteReleased = new Promise((resolve) => { releaseLockWrite = resolve; });
    const first = recoverAttempt({
      ...firstAttempt,
      afterMutationLockOpenBeforeWrite: async () => {
        markLockOpened();
        await lockWriteReleased;
      },
    });
    await Promise.race([
      lockOpened,
      new Promise((_, reject) => setTimeout(
        () => reject(new Error("mutation lock write hook was not reached")),
        100,
      )),
    ]);
    const second = recoverAttempt(secondAttempt);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseLockWrite();
    const recovered = await Promise.all([first, second]);
    assert.deepEqual(recovered.map((item) => item.task.status), ["pending", "pending"]);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createInterruptedAttempt(interruptAt) {
  const fixture = await createPreparedFixture();
  const created = await createWaveExecutionLedger({
    root: fixture.root,
    state: fixture.state,
    wave: fixture.wave,
    waveId: fixture.waveId,
    tasks: fixture.tasks,
    now: () => FIXED_NOW,
  });
  const hooks = interruptAt === "after-claim"
    ? { afterClaimWrite: () => { throw new Error("injected after-claim interruption"); } }
    : { afterExecutionLockWrite: () => { throw new Error("injected after-lock interruption"); } };
  await assert.rejects(
    claimWaveTask({
      root: fixture.root,
      ledgerFile: created.ledgerFile,
      taskId: "T1",
      expectedWaveLedgerSha256: await sha256(fixture.root, created.ledgerFile),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      now: () => FIXED_NOW,
      randomUUID: (() => {
        const values = [
          "00000000-0000-4000-8000-000000000011",
          "00000000-0000-4000-8000-000000000012",
          "00000000-0000-4000-8000-000000000013",
        ];
        return () => values.shift();
      })(),
      ...hooks,
    }),
    /injected/i,
  );
  const interrupted = await inspectWaveExecution({
    root: fixture.root,
    ledgerFile: created.ledgerFile,
  });
  const task = interrupted.ledger.tasks.find((item) => item.taskId === "T1");
  const attemptRoot = `.harness/runs/${fixture.state.runtime.runId}/waves/${fixture.waveId}/tasks/T1/attempts/${task.currentAttemptId}`;
  const claimFile = `${attemptRoot}/claim.json`;
  const lockFile = `.harness/runs/${fixture.state.runtime.runId}/waves/${fixture.waveId}/tasks/T1/execute.lock`;
  return {
    fixture,
    created,
    task,
    claimFile,
    lockFile,
    options: {
      root: fixture.root,
      ledgerFile: created.ledgerFile,
      taskId: "T1",
      expectedAttemptId: task.currentAttemptId,
      expectedClaimSha256: await sha256(fixture.root, claimFile),
      expectedCreationReceiptSha256: fixture.wave.creationReceiptSha256,
      now: () => FIXED_NOW,
    },
  };
}

test("recover-attempt closes a claim written before the task lock exists", async () => {
  const interrupted = await createInterruptedAttempt("after-claim");
  try {
    await assert.rejects(
      recoverAttempt({ ...interrupted.options, confirmAttemptRecovery: false }),
      /ConfirmAttemptRecovery/i,
    );
    const recovered = await recoverAttempt({
      ...interrupted.options,
      confirmAttemptRecovery: true,
    });
    assert.equal(recovered.task.status, "pending");
    assert.equal(recovered.task.currentAttemptId, null);
    const failureFile = path.posix.join(
      path.posix.dirname(interrupted.claimFile),
      "failure.json",
    );
    assert.equal((await JSON.parse(await readFile(
      path.join(interrupted.fixture.root, failureFile),
      "utf8",
    ))).status, "abandoned");
  } finally {
    await rm(interrupted.fixture.root, { recursive: true, force: true });
  }
});

test("recover-attempt reuses abandoned evidence written before the pending ledger transition", async () => {
  const interrupted = await createInterruptedAttempt("after-claim");
  try {
    await assert.rejects(
      recoverAttempt({
        ...interrupted.options,
        confirmAttemptRecovery: true,
        afterMutationLockOpenBeforeWrite: () => {
          throw new Error("injected before abandoned ledger commit");
        },
      }),
      /injected before abandoned ledger commit/,
    );
    assert.equal((await inspectWaveExecution({
      root: interrupted.fixture.root,
      ledgerFile: interrupted.created.ledgerFile,
    })).ledger.tasks[0].status, "claiming");

    const recovered = await recoverAttempt({
      ...interrupted.options,
      confirmAttemptRecovery: true,
      now: () => "2026-08-06T00:01:00.000Z",
    });
    assert.equal(recovered.task.status, "pending");
    assert.equal(recovered.task.currentAttemptId, null);
  } finally {
    await rm(interrupted.fixture.root, { recursive: true, force: true });
  }
});

test("recover-attempt binds a task lock written before running is recorded", async () => {
  const interrupted = await createInterruptedAttempt("after-lock");
  try {
    await assert.rejects(
      recoverAttempt({
        ...interrupted.options,
        expectedExecutionLockSha256: `sha256:${"0".repeat(64)}`,
        confirmAttemptRecovery: true,
      }),
      /lock hash/i,
    );
    assert.equal((await inspectWaveExecution({
      root: interrupted.fixture.root,
      ledgerFile: interrupted.created.ledgerFile,
    })).ledger.tasks[0].status, "claiming");
  } finally {
    await rm(interrupted.fixture.root, { recursive: true, force: true });
  }
});
