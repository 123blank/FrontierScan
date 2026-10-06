import assert from "node:assert/strict";
import { recordSemanticIdentity } from "../lib/record-contract.mjs";

function record(overrides = {}) {
  return {
    id: "R1",
    type: "output",
    phase: "requirement",
    status: "produced",
    path: ".harness/runs/S1/phases/00-requirement/report.md",
    sha256: `sha256:${"a".repeat(64)}`,
    message: "",
    actor: "story-runtime",
    createdAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function testOutputIdentityIgnoresPresentationFields() {
  const original = record();
  const duplicate = record({
    id: "R2",
    status: "present",
    message: "Human-readable note",
    actor: "codex",
    createdAt: "2026-08-13T00:01:00.000Z",
  });
  assert.equal(recordSemanticIdentity(original), recordSemanticIdentity(duplicate));
  assert.notEqual(
    recordSemanticIdentity(original),
    recordSemanticIdentity(record({ sha256: `sha256:${"b".repeat(64)}` })),
  );
}

function testTestAndReviewIdentityKeepsConclusion() {
  for (const type of ["test", "review"]) {
    const passed = record({ type, status: "passed" });
    const failed = record({ type, status: type === "test" ? "failed" : "BLOCKER" });
    assert.notEqual(recordSemanticIdentity(passed), recordSemanticIdentity(failed));
    assert.equal(
      recordSemanticIdentity(passed),
      recordSemanticIdentity({ ...passed, id: "R2", actor: "other", message: "same evidence" }),
    );
  }
}

function testApprovalAndNoteIdentityKeepsSemanticFields() {
  const approval = record({
    type: "approval",
    status: "approved",
    actor: "user",
    message: "Approve delivery",
  });
  assert.notEqual(
    recordSemanticIdentity(approval),
    recordSemanticIdentity({ ...approval, status: "denied" }),
  );
  assert.notEqual(
    recordSemanticIdentity(approval),
    recordSemanticIdentity({ ...approval, actor: "codex" }),
  );

  const note = record({ type: "note", status: "recorded", path: null, sha256: undefined, message: "First" });
  assert.notEqual(
    recordSemanticIdentity(note),
    recordSemanticIdentity({ ...note, message: "Second" }),
  );
}

function testPhaseResultIdentityUsesDispatchAndStatus() {
  const applied = record({
    type: "phase-result",
    status: "applied",
    dispatchId: "00000000-0000-4000-8000-000000000001",
  });
  assert.equal(
    recordSemanticIdentity(applied),
    recordSemanticIdentity({ ...applied, path: "changed.json", sha256: `sha256:${"b".repeat(64)}` }),
  );
  assert.notEqual(
    recordSemanticIdentity(applied),
    recordSemanticIdentity({ ...applied, status: "blocked" }),
  );
}

testOutputIdentityIgnoresPresentationFields();
testTestAndReviewIdentityKeepsConclusion();
testApprovalAndNoteIdentityKeepsSemanticFields();
testPhaseResultIdentityUsesDispatchAndStatus();
console.log("record contract tests passed");
