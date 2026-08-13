import assert from "node:assert/strict";
import {
  approvalSemanticKey,
  canonicalJson,
  deterministicApprovalId,
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
    createdAt: NOW,
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

testCanonicalJsonAndSubject();
testReceiptAndFormalApprovalContracts();
console.log("approval contract tests passed");
