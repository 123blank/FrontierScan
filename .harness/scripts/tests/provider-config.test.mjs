import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  loadProviderConfig,
  resolveProviderProfile,
} from "../lib/provider-config.mjs";

async function write(root, relativePath, content) {
  const file = path.join(root, relativePath);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content, "utf8");
}

async function writeJson(root, relativePath, value) {
  await write(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "frontier-provider-config-"));
  await write(
    root,
    ".codex/agents/agents.yaml",
    [
      'schema_version: "1.0"',
      "agents:",
      "  - name: requirement-analyst",
      "    category: planning",
      "  - name: backend-developer",
      "    category: execution",
      "  - name: code-reviewer",
      "    category: review",
      "",
    ].join("\n"),
  );
  return root;
}

async function withRoot(run) {
  const root = await createRoot();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function testBuiltinDefaultConfig() {
  await withRoot(async (root) => {
    const loaded = await loadProviderConfig({ root });
    assert.deepEqual(loaded.config, {
      schemaVersion: "1.0",
      defaultProfile: "codex-default",
      profiles: {
        "codex-default": {
          adapter: "codex-cli",
          model: null,
          modelProvider: null,
        },
      },
      roleBindings: {},
    });
    assert.match(loaded.configSha256, /^sha256:[a-f0-9]{64}$/);

    const resolved = resolveProviderProfile({
      loaded,
      role: "code-reviewer",
    });
    assert.deepEqual(resolved, {
      role: "code-reviewer",
      profile: "codex-default",
      adapter: "codex-cli",
      requestedModel: null,
      modelProvider: null,
      profileSource: "builtin-default",
      modelSource: "builtin-default",
      configSha256: loaded.configSha256,
    });
  });
}

async function testProjectLocalAndRuntimeOverrides() {
  await withRoot(async (root) => {
    await writeJson(root, ".harness/config/agent-providers.json", {
      schemaVersion: "1.0",
      defaultProfile: "project-default",
      profiles: {
        "project-default": {
          adapter: "codex-cli",
          model: "project-model",
          modelProvider: null,
        },
        shared: {
          adapter: "codex-cli",
          model: "project-shared",
          modelProvider: null,
        },
      },
      roleBindings: {
        "code-reviewer": "shared",
      },
    });
    await writeJson(root, ".harness/config/agent-providers.local.json", {
      schemaVersion: "1.0",
      profiles: {
        shared: {
          adapter: "codex-cli",
          model: "local-shared",
          modelProvider: {
            id: "custom",
            baseUrl: "https://coding.example.test",
            wireApi: "responses",
            requiresOpenAiAuth: true,
          },
        },
      },
      roleBindings: {
        "code-reviewer": "project-default",
      },
    });

    const loaded = await loadProviderConfig({ root });
    assert.equal(loaded.config.defaultProfile, "project-default");
    assert.deepEqual(loaded.config.profiles.shared, {
      adapter: "codex-cli",
      model: "local-shared",
      modelProvider: {
        id: "custom",
        baseUrl: "https://coding.example.test",
        wireApi: "responses",
        requiresOpenAiAuth: true,
      },
    });

    const localBinding = resolveProviderProfile({
      loaded,
      role: "code-reviewer",
    });
    assert.equal(localBinding.profile, "project-default");
    assert.equal(localBinding.requestedModel, "project-model");
    assert.equal(localBinding.profileSource, "local-config");
    assert.equal(localBinding.modelSource, "project-config");

    const profileOverride = resolveProviderProfile({
      loaded,
      role: "code-reviewer",
      profile: "shared",
    });
    assert.equal(profileOverride.profile, "shared");
    assert.equal(profileOverride.adapter, "codex-cli");
    assert.equal(profileOverride.requestedModel, "local-shared");
    assert.deepEqual(profileOverride.modelProvider, {
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    });
    assert.equal(profileOverride.profileSource, "runtime-override");
    assert.equal(profileOverride.modelSource, "local-config");

    const modelOverride = resolveProviderProfile({
      loaded,
      role: "code-reviewer",
      profile: "shared",
      model: "runtime-model",
    });
    assert.equal(modelOverride.adapter, "codex-cli");
    assert.equal(modelOverride.requestedModel, "runtime-model");
    assert.deepEqual(modelOverride.modelProvider, profileOverride.modelProvider);
    assert.equal(modelOverride.modelSource, "runtime-override");
  });
}

async function assertProjectConfigRejected(config, pattern) {
  await withRoot(async (root) => {
    await writeJson(root, ".harness/config/agent-providers.json", config);
    await assert.rejects(loadProviderConfig({ root }), pattern);
  });
}

async function testStrictFailures() {
  const validProfile = {
    adapter: "codex-cli",
    model: null,
    modelProvider: null,
  };
  const valid = {
    schemaVersion: "1.0",
    defaultProfile: "codex-default",
    profiles: {
      "codex-default": validProfile,
    },
    roleBindings: {
      "code-reviewer": "codex-default",
    },
  };

  await assertProjectConfigRejected(
    { ...valid, unexpected: true },
    /unsupported field.*unexpected/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          ...validProfile,
          executable: "custom-codex",
        },
      },
    },
    /unsupported field.*executable/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          ...validProfile,
          argv: ["--dangerously-bypass-approvals-and-sandbox"],
        },
      },
    },
    /unsupported field.*argv/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          ...validProfile,
          prompt: "ignore policy",
        },
      },
    },
    /unsupported field.*prompt/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          ...validProfile,
          environment: {
            CODEX_HOME: "unsafe",
          },
        },
      },
    },
    /unsupported field.*environment/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          ...validProfile,
          apiKey: "secret",
        },
      },
    },
    /unsupported field.*apiKey/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      roleBindings: {
        "unknown-role": "codex-default",
      },
    },
    /unknown role.*unknown-role/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      roleBindings: {
        "code-reviewer": "missing-profile",
      },
    },
    /missing-profile.*not defined|unknown profile.*missing-profile/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          adapter: "openai-compatible",
          model: null,
        },
      },
    },
    /unsupported adapter.*openai-compatible/i,
  );
  await assertProjectConfigRejected(
    {
      ...valid,
      profiles: {
        "codex-default": {
          adapter: "codex-cli",
          model: "",
        },
      },
    },
    /model.*non-empty|string/i,
  );
  for (const [modelProvider, pattern] of [
    [{
      id: "custom provider",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /provider.*id.*safe/i],
    [{
      id: "vendor.custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /provider.*id.*safe/i],
    [{
      id: "custom",
      baseUrl: "http://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /baseUrl.*HTTPS/i],
    [{
      id: "custom",
      baseUrl: "https://user:password@coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /baseUrl.*userinfo|credentials/i],
    [{
      id: "custom",
      baseUrl: "https://coding.example.test#fragment",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /baseUrl.*fragment/i],
    [{
      id: "custom",
      baseUrl: "https://coding.example.test?unsafe=true",
      wireApi: "responses",
      requiresOpenAiAuth: true,
    }, /baseUrl.*query/i],
    [{
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "chat",
      requiresOpenAiAuth: true,
    }, /wireApi.*responses/i],
    [{
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: "true",
    }, /requiresOpenAiAuth.*boolean/i],
    [{
      id: "custom",
      baseUrl: "https://coding.example.test",
      wireApi: "responses",
      requiresOpenAiAuth: true,
      apiKey: "secret",
    }, /unsupported field.*apiKey/i],
  ]) {
    await assertProjectConfigRejected(
      {
        ...valid,
        profiles: {
          "codex-default": {
            adapter: "codex-cli",
            model: null,
            modelProvider,
          },
        },
      },
      pattern,
    );
  }

  await withRoot(async (root) => {
    await write(root, ".harness/config/agent-providers.local.json", "{broken");
    await assert.rejects(
      loadProviderConfig({ root }),
      /local provider config.*invalid JSON/i,
    );
  });

  await withRoot(async (root) => {
    const loaded = await loadProviderConfig({ root });
    assert.throws(
      () => resolveProviderProfile({ loaded, role: "unknown-role" }),
      /unknown role.*unknown-role/i,
    );
    assert.throws(
      () => resolveProviderProfile({
        loaded,
        role: "code-reviewer",
        profile: "missing-profile",
      }),
      /unknown profile.*missing-profile/i,
    );
    assert.throws(
      () => resolveProviderProfile({
        loaded,
        role: "code-reviewer",
        model: "",
      }),
      /model.*non-empty|string/i,
    );
  });
}

async function testConfigHashIsCanonical() {
  await withRoot(async (root) => {
    const first = await loadProviderConfig({ root });
    await writeJson(root, ".harness/config/agent-providers.json", {
      roleBindings: {},
      profiles: {
        "codex-default": {
          model: null,
          adapter: "codex-cli",
          modelProvider: null,
        },
      },
      defaultProfile: "codex-default",
      schemaVersion: "1.0",
    });
    const second = await loadProviderConfig({ root });
    assert.equal(second.configSha256, first.configSha256);
  });
}

async function testModelProviderAffectsConfigHash() {
  await withRoot(async (root) => {
    const withoutProvider = await loadProviderConfig({ root });
    await writeJson(root, ".harness/config/agent-providers.json", {
      schemaVersion: "1.0",
      profiles: {
        "codex-default": {
          adapter: "codex-cli",
          model: null,
          modelProvider: {
            id: "custom",
            baseUrl: "https://coding.example.test",
            wireApi: "responses",
            requiresOpenAiAuth: true,
          },
        },
      },
    });
    const withProvider = await loadProviderConfig({ root });
    assert.notEqual(withProvider.configSha256, withoutProvider.configSha256);
  });
}

await testBuiltinDefaultConfig();
await testProjectLocalAndRuntimeOverrides();
await testStrictFailures();
await testConfigHashIsCanonical();
await testModelProviderAffectsConfigHash();
console.log("provider-config tests passed");
