const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const STATUSES = new Set([
  "pending",
  "verified",
  "accepted-with-known-gaps",
  "failed",
  "blocked",
]);
const CRITERION_FIELDS = [
  "criterionId",
  "required",
  "taskIds",
  "testCaseIds",
  "verificationCaseIds",
  "status",
  "approvalIds",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactFields(value, fields, label) {
  assertObject(value, label);
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
  }
  const extra = Object.keys(value).find((field) => !fields.includes(field));
  if (extra) throw new Error(`${label} contains unsupported field '${extra}'.`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertUniqueIds(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  value.forEach((item) => assertId(item, `${label} item`));
  if (new Set(value).size !== value.length) throw new Error(`${label} items must be unique.`);
}

export function validateAcceptance(value, requirement, label = "Acceptance") {
  assertExactFields(value, ["criteria"], label);
  if (!Array.isArray(value.criteria)) throw new Error(`${label}.criteria must be an array.`);
  const requirementCriteria = requirement?.acceptanceCriteria ?? [];
  if (value.criteria.length !== requirementCriteria.length) {
    throw new Error(`${label}.criteria must match requirement acceptance criteria.`);
  }
  const seen = new Set();
  value.criteria.forEach((criterion, index) => {
    const itemLabel = `${label}.criteria[${index}]`;
    assertExactFields(criterion, CRITERION_FIELDS, itemLabel);
    assertId(criterion.criterionId, `${itemLabel}.criterionId`);
    if (seen.has(criterion.criterionId)) throw new Error(`${label}.criteria criterionId values must be unique.`);
    seen.add(criterion.criterionId);
    if (typeof criterion.required !== "boolean") throw new Error(`${itemLabel}.required must be boolean.`);
    for (const field of ["taskIds", "testCaseIds", "verificationCaseIds", "approvalIds"]) {
      assertUniqueIds(criterion[field], `${itemLabel}.${field}`);
    }
    if (!STATUSES.has(criterion.status)) throw new Error(`${itemLabel}.status is invalid.`);
    const source = requirementCriteria[index];
    if (!source
        || source.criterionId !== criterion.criterionId
        || source.required !== criterion.required) {
      throw new Error(`${itemLabel} criterionId/required must match requirement.`);
    }
  });
  return value;
}
