function value(record, field) {
  return record[field] ?? "";
}

export function recordSemanticIdentity(record) {
  if (record.type === "output") {
    return ["output", record.phase, value(record, "path"), value(record, "sha256")].join("\0");
  }
  if (record.type === "test" || record.type === "review") {
    return [
      record.type,
      record.phase,
      record.status,
      record.path ?? record.message,
      value(record, "sha256"),
    ].join("\0");
  }
  if (record.type === "approval") {
    return [
      "approval",
      record.phase,
      record.status,
      record.actor,
      record.path ?? record.message,
      value(record, "sha256"),
    ].join("\0");
  }
  if (record.type === "note") {
    return ["note", record.phase, record.actor, record.message].join("\0");
  }
  if (record.type === "phase-result") {
    return ["phase-result", record.dispatchId, record.status].join("\0");
  }
  throw new Error(`Unsupported record type '${record.type ?? ""}'.`);
}
