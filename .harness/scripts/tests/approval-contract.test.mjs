import assert from "node:assert/strict";
import {
  approvalSemanticKey,
  canonicalJson,
  deterministicApprovalId,
  knowledgeStaleSubject,
  knowledgeStaleSubjectSha256,
  validateApprovalReceipt,
  validateFormalApproval,
  verificationGapSubject,
  verificationGapSubjectSha256,
} from "../lib/approval-contract.mjs";

const NOW = "2026-08-13T00:00:00.000Z";
const task = {
  storyId: "M7-A3-APPROVAL",
  runId: "M7-A3-APPROVAL",
  phase: "interface-verification",
  dispatchId: "00000000-0000-4000-8000-000000000001",
  preparedRevision: 8,
  preparedAt: "2026-08-12T23:00:00.000Z",
};
const caseValue = {
  caseId: "VC-001",
  type: "ui-flow",
  required: true,
  criterionIds: ["AC-001"],
  action: "Open the page",
  expected: "The state is visible",
};
const resultValue = {
  caseId: "VC-001",
  status: "accepted-with-known-gaps",
  actual: "UI environment unavailable",
  evidencePath: ".harness/runs/M7-A3-APPROVAL/evidence/ui.md",
  evidenceSha256: `sha256:${"a".repeat(64)}`,
  approvalId: null,
  executedAt: "2026-08-12T23:30:00.000Z",
};

const knowledgeTask = {
  storyId: "M7-C-APPROVAL",
  runId: "M7-C-APPROVAL",
  phase: "technical-design",
  dispatchId: "00000000-0000-4000-8000-000000000002",
  preparedRevision: 2,
  preparedAt: "2026-08-13T23:00:00.000Z",
};
const knowledgeArea = {
  area: "backend",
  relevant: true,
  observedStatus: "stale",
  status: "stale",
  sourceFingerprint: `sha256:${"d".repeat(64)}`,
  loadedFiles: ["llm-knowledge/backend/meta.yaml"],
  missing: [],
  checkedAt: "2026-08-13T23:30:00.000Z",
  freshnessEvidencePath: ".harness/runs/M7-C-APPROVAL/knowledge/checks/CHK-001.json",
  freshnessEvidenceSha256: `sha256:${"e".repeat(64)}`,
  refreshTaskPath: ".harness/runs/M7-C-APPROVAL/knowledge/tasks/KRT-001.json",
  refreshTaskSha256: `sha256:${"f".repeat(64)}`,
  refreshReceiptPath: null,
  refreshReceiptSha256: null,
  approvalId: null,
};

function receiptFixture() {
  const subjectSha256 = verificationGapSubjectSha256(caseValue, resultValue, task);
  const reason = "接受当前已知验证缺口";
  const approvalId = deterministicApprovalId(approvalSemanticKey({
    storyId: task.storyId,
    dispatchId: task.dispatchId,
    caseId: caseValue.caseId,
    subjectSha256,
    actor: "user",
    reason,
  }));
  return {
    schemaVersion: "1.0",
    approvalId,
    storyId: task.storyId,
    runId: task.runId,
    phase: task.phase,
    dispatchId: task.dispatchId,
    preparedRevision: task.preparedRevision,
    subjectType: "verification-gap",
    subjectId: caseValue.caseId,
    subjectSha256,
    status: "approved",
    actor: "user",
    reason,
    evidencePath: resultValue.evidencePath,
    evidenceSha256: resultValue.evidenceSha256,
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}

function testCanonicalJsonAndSubject() {
  assert.equal(canonicalJson({ z: 1, a: [{ b: 2, a: 1 }] }), '{"a":[{"a":1,"b":2}],"z":1}');
  const subject = verificationGapSubject(caseValue, resultValue, task);
  assert.equal(Object.hasOwn(subject.result, "approvalId"), false);
  assert.deepEqual(subject.case, caseValue);
  assert.match(verificationGapSubjectSha256(caseValue, resultValue, task), /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(
    verificationGapSubjectSha256(caseValue, { ...resultValue, actual: "Changed" }, task),
    verificationGapSubjectSha256(caseValue, resultValue, task),
  );
}

function testReceiptAndFormalApprovalContracts() {
  const receipt = receiptFixture();
  assert.doesNotThrow(() => validateApprovalReceipt(receipt, {
    task,
    caseValue,
    resultValue,
    expectedSubjectSha256: receipt.subjectSha256,
  }));
  assert.equal(
    deterministicApprovalId(approvalSemanticKey({
      storyId: task.storyId,
      dispatchId: task.dispatchId,
      caseId: caseValue.caseId,
      subjectSha256: receipt.subjectSha256,
      actor: "user",
      reason: receipt.reason,
    })),
    receipt.approvalId,
  );

  for (const invalid of [
    { ...receipt, actor: "codex" },
    { ...receipt, status: "denied" },
    { ...receipt, subjectType: "knowledge-stale" },
    { ...receipt, subjectId: "VC-OTHER" },
    { ...receipt, reason: "" },
    { ...receipt, evidenceSha256: `sha256:${"b".repeat(64)}` },
    { ...receipt, createdAt: "invalid" },
    { ...receipt, unexpected: true },
  ]) {
    assert.throws(
      () => validateApprovalReceipt(invalid, {
        task,
        caseValue,
        resultValue,
        expectedSubjectSha256: receipt.subjectSha256,
      }),
      /invalid|match|unsupported|reason|actor|status|subject|evidence|timestamp/i,
    );
  }

  const formal = {
    ...receipt,
    receiptPath: `${task.storyId}/approvals/${receipt.approvalId}.json`,
    receiptSha256: `sha256:${"c".repeat(64)}`,
  };
  assert.doesNotThrow(() => validateFormalApproval(formal));
  assert.throws(() => validateFormalApproval({ ...formal, receiptSha256: "bad" }), /receiptSha256/i);
}

function testKnowledgeStaleApprovalContract() {
  const subject = knowledgeStaleSubject(knowledgeArea, knowledgeTask);
  assert.equal(Object.hasOwn(subject, "status"), false);
  assert.equal(Object.hasOwn(subject, "approvalId"), false);
  assert.equal(subject.observedStatus, "stale");
  const subjectSha256 = knowledgeStaleSubjectSha256(knowledgeArea, knowledgeTask);
  assert.equal(
    knowledgeStaleSubjectSha256({
      ...knowledgeArea,
      status: "accepted-stale",
      approvalId: "APR-after-approval",
    }, knowledgeTask),
    subjectSha256,
  );
  assert.notEqual(
    knowledgeStaleSubjectSha256({
      ...knowledgeArea,
      refreshTaskSha256: `sha256:${"0".repeat(64)}`,
    }, knowledgeTask),
    subjectSha256,
  );

  const reason = "已通过源码核验，接受当前 stale 知识";
  const approvalId = deterministicApprovalId(approvalSemanticKey({
    storyId: knowledgeTask.storyId,
    dispatchId: knowledgeTask.dispatchId,
    caseId: knowledgeArea.area,
    subjectSha256,
    actor: "user",
    reason,
  }));
  const receipt = {
    schemaVersion: "1.0",
    approvalId,
    storyId: knowledgeTask.storyId,
    runId: knowledgeTask.runId,
    phase: knowledgeTask.phase,
    dispatchId: knowledgeTask.dispatchId,
    preparedRevision: knowledgeTask.preparedRevision,
    subjectType: "knowledge-stale",
    subjectId: knowledgeArea.area,
    subjectSha256,
    status: "approved",
    actor: "user",
    reason,
    evidencePath: knowledgeArea.freshnessEvidencePath,
    evidenceSha256: knowledgeArea.freshnessEvidenceSha256,
    createdAt: "2026-08-14T00:00:00.000Z",
  };
  assert.doesNotThrow(() => validateApprovalReceipt(receipt, {
    task: knowledgeTask,
    knowledgeArea,
    expectedSubjectSha256: subjectSha256,
  }));
  assert.doesNotThrow(() => validateFormalApproval({
    ...receipt,
    receiptPath: `${knowledgeTask.storyId}/approvals/${approvalId}.json`,
    receiptSha256: `sha256:${"1".repeat(64)}`,
  }));
  assert.throws(
    () => validateApprovalReceipt({ ...receipt, phase: "interface-verification" }, {
      task: knowledgeTask,
      knowledgeArea,
      expectedSubjectSha256: subjectSha256,
    }),
    /phase/i,
  );
}

testCanonicalJsonAndSubject();
testReceiptAndFormalApprovalContracts();
testKnowledgeStaleApprovalContract();
console.log("approval contract tests passed");
