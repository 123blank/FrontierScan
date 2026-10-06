import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  mapProviderResponseToReview,
  validateProviderContext,
  validateProviderExecutionReceipt,
  validateProviderRequest,
  validateProviderResponse,
} from "../lib/provider-contract.mjs";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const DISPATCH_ID = "20000000-0000-4000-8000-000000000002";
const EXECUTION_ID = "30000000-0000-4000-8000-000000000003";
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const NOW = "2026-08-19T04:00:00.000Z";

function validPolicy() {
  return {
    name: "code-reviewer",
    category: "review",
    readPathPrefixes: [
      ".harness/",
      ".codex/",
      "docs/",
    ],
    writePathPrefixes: [],
    capabilities: [
      "phase-output",
    ],
  };
}

function validRequest() {
  return {
    schemaVersion: "1.0",
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-A-001",
    runId: "M8-A-001",
    phase: "code-review",
    preparedRevision: 6,
    role: "code-reviewer",
    profile: "codex-default",
    adapter: "codex-cli",
    requestedModel: null,
    modelSource: "project-config",
    modelProvider: null,
    configSha256: SHA_A,
    taskFile: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/task.json`,
    taskSha256: SHA_B,
    policy: validPolicy(),
    contextManifestFile: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/provider/context-manifest.json`,
    contextManifestSha256: SHA_C,
    outputSchemaFile: ".harness/schemas/agent-provider-response.schema.json",
    outputSchemaSha256: SHA_A,
    promptTemplateVersion: "1.0",
    promptTemplateSha256: SHA_B,
    createdAt: NOW,
  };
}

function validContext() {
  return {
    schemaVersion: "1.0",
    storyId: "M8-A-001",
    runId: "M8-A-001",
    dispatchId: DISPATCH_ID,
    role: "code-reviewer",
    entries: [
      {
        path: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/task.json`,
        sha256: SHA_A,
        bytes: 100,
        purpose: "当前 code-review dispatch task",
        source: "task",
      },
      {
        path: ".harness/scripts/lib/provider-config.mjs",
        sha256: SHA_B,
        bytes: 200,
        purpose: "待审核实现文件",
        source: "diff",
      },
    ],
    reviewTargets: [
      {
        path: ".harness/scripts/lib/provider-config.mjs",
        sha256: SHA_B,
        changeKind: "added",
      },
    ],
    knowledgeAreas: [
      {
        area: "common",
        status: "fresh",
        loadedFiles: [
          "llm-knowledge/common/meta.yaml",
        ],
      },
    ],
    totalBytes: 300,
    createdAt: NOW,
  };
}

function validResponse() {
  return {
    schemaVersion: "1.0",
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-A-001",
    runId: "M8-A-001",
    phase: "code-review",
    role: "code-reviewer",
    status: "completed",
    summary: "发现一项需要修复的问题。",
    findings: [
      {
        findingId: "F-001",
        severity: "WARNING",
        status: "open",
        summary: "配置错误可能被静默回退。",
        file: ".harness/scripts/lib/provider-config.mjs",
        line: 88,
        evidenceText: "本地 JSON 解析失败后继续使用默认配置。",
        rationale: "这会使用户指定的审核模型未生效且缺少明确失败。",
      },
    ],
    diagnostics: [],
    usage: {
      reportedModel: null,
      inputTokens: null,
      outputTokens: null,
    },
  };
}

function validReceipt() {
  return {
    schemaVersion: "1.0",
    providerExecutionId: EXECUTION_ID,
    providerRequestId: REQUEST_ID,
    dispatchId: DISPATCH_ID,
    storyId: "M8-A-001",
    runId: "M8-A-001",
    phase: "code-review",
    role: "code-reviewer",
    profile: "codex-default",
    adapter: "codex-cli",
    modelProvider: null,
    configSha256: SHA_A,
    requestFile: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/provider/request.json`,
    requestSha256: SHA_B,
    contextManifestFile: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/provider/context-manifest.json`,
    contextManifestSha256: SHA_C,
    promptTemplateVersion: "1.0",
    promptTemplateSha256: SHA_A,
    requestedModel: null,
    resolvedModel: null,
    reportedModel: null,
    modelSource: "project-config",
    adapterVersion: "codex-cli/0.148.0-alpha.15",
    readIsolation: "same-os-user-readonly-sandbox",
    startedAt: NOW,
    finishedAt: "2026-08-19T04:00:05.000Z",
    exitCode: 0,
    status: "completed",
    responseFile: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/provider/executions/${EXECUTION_ID}/provider-response.json`,
    responseSha256: SHA_C,
    integrityChecks: [
      {
        checkId: "git-status",
        status: "passed",
        beforeSha256: SHA_A,
        afterSha256: SHA_A,
        details: "Git status remained unchanged.",
      },
    ],
    diagnostics: [],
  };
}

function clone(value) {
  return structuredClone(value);
}

function testRequestContract() {
  assert.equal(validateProviderRequest(validRequest()).role, "code-reviewer");

  for (const [field, value, pattern] of [
    ["providerRequestId", "not-a-uuid", /providerRequestId.*UUID/i],
    ["storyId", "wrong story", /storyId.*invalid/i],
    ["runId", "OTHER", /runId.*storyId/i],
    ["phase", "implementation", /phase.*code-review/i],
    ["role", "backend-developer", /role.*code-reviewer/i],
    ["adapter", "openai-compatible", /adapter.*codex-cli/i],
  ]) {
    const candidate = validRequest();
    candidate[field] = value;
    assert.throws(() => validateProviderRequest(candidate), pattern);
  }

  const extra = validRequest();
  extra.argv = ["--dangerously-bypass-approvals-and-sandbox"];
  assert.throws(() => validateProviderRequest(extra), /unsupported field.*argv/i);

  const customProvider = validRequest();
  customProvider.modelProvider = {
    id: "custom",
    baseUrl: "https://coding.example.test",
    wireApi: "responses",
    requiresOpenAiAuth: true,
  };
  assert.equal(validateProviderRequest(customProvider).modelProvider.id, "custom");
}

async function testModelProviderUrlSchemaParity() {
  const schemas = await Promise.all([
    ".harness/schemas/agent-provider-config.schema.json",
    ".harness/schemas/agent-provider-request.schema.json",
    ".harness/schemas/agent-provider-execution-receipt.schema.json",
  ].map(async (file) => JSON.parse(await readFile(file, "utf8"))));
  const patterns = schemas.map((schema) => new RegExp(schema.$defs.modelProvider.properties.baseUrl.pattern));
  const samples = [
    ["https://coding.example.test", true],
    ["https://coding.example.test/compatible-mode/v1", true],
    ["http://coding.example.test", false],
    ["https://user:password@coding.example.test", false],
    ["https://coding.example.test?unsafe=true", false],
    ["https://coding.example.test#fragment", false],
  ];
  for (const [baseUrl, expected] of samples) {
    for (const pattern of patterns) assert.equal(pattern.test(baseUrl), expected, baseUrl);
    const request = validRequest();
    request.modelProvider = {
      id: "custom",
      baseUrl,
      wireApi: "responses",
      requiresOpenAiAuth: true,
    };
    if (expected) assert.equal(validateProviderRequest(request).modelProvider.baseUrl, baseUrl);
    else assert.throws(() => validateProviderRequest(request), /modelProvider.*baseUrl/i);
  }
}

async function testResponseSchemaUsesProviderCompatibleSubset() {
  const schema = JSON.parse(
    await readFile(".harness/schemas/agent-provider-response.schema.json", "utf8"),
  );
  for (const keyword of ["allOf", "if", "then", "else"]) {
    assert.equal(
      JSON.stringify(schema).includes(`"${keyword}"`),
      false,
      `Provider response Schema must not use unsupported keyword '${keyword}'.`,
    );
  }
  const visit = (value, location = "$") => {
    if (!value || typeof value !== "object") return;
    if ((Object.hasOwn(value, "const") || Object.hasOwn(value, "enum"))
        && !Object.hasOwn(value, "type")) {
      assert.fail(`Provider response Schema ${location} must declare type with const/enum.`);
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${location}.${key}`);
  };
  visit(schema);
}

function testContextContract() {
  assert.equal(validateProviderContext(validContext()).totalBytes, 300);

  const wrongTotal = validContext();
  wrongTotal.totalBytes = 299;
  assert.throws(() => validateProviderContext(wrongTotal), /totalBytes.*sum/i);

  const duplicateEntry = validContext();
  duplicateEntry.entries.push(clone(duplicateEntry.entries[0]));
  duplicateEntry.totalBytes += duplicateEntry.entries[0].bytes;
  assert.throws(() => validateProviderContext(duplicateEntry), /duplicate.*path/i);

  const duplicateTarget = validContext();
  duplicateTarget.reviewTargets.push(clone(duplicateTarget.reviewTargets[0]));
  assert.throws(() => validateProviderContext(duplicateTarget), /duplicate.*review target/i);

  const unsafePath = validContext();
  unsafePath.entries[0].path = "../secret.env";
  assert.throws(() => validateProviderContext(unsafePath), /repository-relative path/i);
}

function testResponseContract() {
  const context = validContext();
  assert.equal(validateProviderResponse(validResponse(), { context }).findings.length, 1);

  for (const [mutate, pattern] of [
    [(response) => { response.findings[0].severity = "ERROR"; }, /severity/i],
    [(response) => { response.findings[0].status = "resolved"; }, /status.*open/i],
    [(response) => { response.findings[0].file = ".env"; }, /reviewTargets/i],
    [(response) => { response.findings[0].line = 0; }, /line.*positive/i],
    [(response) => { response.findings[0].evidenceText = ""; }, /evidenceText.*non-empty/i],
    [(response) => { response.findings[0].rationale = ""; }, /rationale.*non-empty/i],
    [(response) => { response.files = []; }, /unsupported field.*files/i],
    [(response) => { response.patch = "*** Begin Patch"; }, /unsupported field.*patch/i],
    [(response) => { response.shell = "git status"; }, /unsupported field.*shell/i],
    [(response) => { response.markdown = "# Review"; }, /unsupported field.*markdown/i],
    [(response) => { response.state = {}; }, /unsupported field.*state/i],
  ]) {
    const response = validResponse();
    mutate(response);
    assert.throws(() => validateProviderResponse(response, { context }), pattern);
  }

  const failed = validResponse();
  failed.status = "failed";
  failed.summary = "Provider could not complete the review.";
  failed.findings = [];
  failed.diagnostics = ["model returned no final response"];
  assert.equal(validateProviderResponse(failed, { context }).status, "failed");

  const failedWithFinding = clone(failed);
  failedWithFinding.findings = validResponse().findings;
  assert.throws(
    () => validateProviderResponse(failedWithFinding, { context }),
    /failed response.*findings.*empty/i,
  );
}

function testExecutionReceiptContract() {
  assert.equal(validateProviderExecutionReceipt(validReceipt()).status, "completed");

  const resultHash = validReceipt();
  resultHash.resultSha256 = SHA_A;
  assert.throws(
    () => validateProviderExecutionReceipt(resultHash),
    /unsupported field.*resultSha256/i,
  );

  const failed = validReceipt();
  failed.status = "timed-out";
  failed.exitCode = null;
  failed.responseFile = null;
  failed.responseSha256 = null;
  failed.diagnostics = ["Codex process exceeded timeout."];
  assert.equal(validateProviderExecutionReceipt(failed).status, "timed-out");

  const completedWithoutResponse = validReceipt();
  completedWithoutResponse.responseFile = null;
  completedWithoutResponse.responseSha256 = null;
  assert.throws(
    () => validateProviderExecutionReceipt(completedWithoutResponse),
    /completed receipt.*response/i,
  );
}

function testFormalFindingMapping() {
  const mapped = mapProviderResponseToReview(validResponse(), {
    evidencePath: `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/evidence/provider-review-response.json`,
  });
  assert.equal(mapped.status, "blocked");
  assert.equal(mapped.findings.length, 1);
  assert.match(mapped.findings[0].findingId, /^PF-[A-F0-9]{16}$/);
  assert.equal(mapped.findings[0].severity, "WARNING");
  assert.equal(mapped.findings[0].status, "open");
  assert.equal(
    mapped.findings[0].evidence,
    `.harness/runs/M8-A-001/phases/05-code-review/attempts/${DISPATCH_ID}/evidence/provider-review-response.json`,
  );
  assert.equal(Object.hasOwn(mapped.findings[0], "evidenceText"), false);
  assert.equal(Object.hasOwn(mapped.findings[0], "rationale"), false);

  const passed = validResponse();
  passed.findings = [{
    ...passed.findings[0],
    severity: "INFO",
  }];
  assert.equal(mapProviderResponseToReview(passed, {
    evidencePath: "evidence/provider-review-response.json",
  }).status, "passed");

  const failed = validResponse();
  failed.status = "failed";
  failed.findings = [];
  failed.diagnostics = ["model returned no final review"];
  assert.throws(
    () => mapProviderResponseToReview(failed, {
      evidencePath: "evidence/provider-review-response.json",
    }),
    /completed.*response/i,
  );
}

testRequestContract();
await testModelProviderUrlSchemaParity();
await testResponseSchemaUsesProviderCompatibleSubset();
testContextContract();
testResponseContract();
testExecutionReceiptContract();
testFormalFindingMapping();
console.log("provider-contract tests passed");
