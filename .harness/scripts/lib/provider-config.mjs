import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const CONFIG_FIELDS = ["schemaVersion", "defaultProfile", "profiles", "roleBindings"];
const PROFILE_FIELDS = ["adapter", "model", "modelProvider"];
const MODEL_PROVIDER_FIELDS = ["id", "baseUrl", "wireApi", "requiresOpenAiAuth"];
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MODEL_PROVIDER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MODEL_PATTERN = /^[^\s\u0000-\u001f\u007f]{1,128}$/;
const SUPPORTED_ADAPTERS = new Set(["codex-cli"]);
const BUILTIN_CONFIG = {
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
};

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactFields(value, allowed, label) {
  const unexpected = Object.keys(value).find((field) => !allowed.includes(field));
  if (unexpected) throw new Error(`${label} contains unsupported field '${unexpected}'.`);
}

function assertId(value, label) {
  if (typeof value !== "string" || !ID_PATTERN.test(value)) {
    throw new Error(`${label} must use a safe provider identifier.`);
  }
}

function assertModel(value, label) {
  if (value !== null && (typeof value !== "string" || !MODEL_PATTERN.test(value))) {
    throw new Error(`${label} must be null or a non-empty model string.`);
  }
}

function assertModelProvider(value, label) {
  if (value === null || value === undefined) return;
  assertObject(value, label);
  assertExactFields(value, MODEL_PROVIDER_FIELDS, label);
  for (const field of MODEL_PROVIDER_FIELDS) {
    if (!Object.hasOwn(value, field)) throw new Error(`${label} requires '${field}'.`);
  }
  if (typeof value.id !== "string" || !MODEL_PROVIDER_ID_PATTERN.test(value.id)) {
    throw new Error(`${label} id must use a safe provider identifier without dots.`);
  }
  if (typeof value.baseUrl !== "string"
      || !value.baseUrl
      || value.baseUrl.length > 2048
      || /[\u0000-\u001f\u007f]/.test(value.baseUrl)) {
    throw new Error(`${label} baseUrl must be a safe HTTPS URL.`);
  }
  let parsed;
  try {
    parsed = new URL(value.baseUrl);
  } catch {
    throw new Error(`${label} baseUrl must be a safe HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${label} baseUrl must use HTTPS.`);
  if (parsed.username || parsed.password) throw new Error(`${label} baseUrl must not contain userinfo credentials.`);
  if (parsed.hash) throw new Error(`${label} baseUrl must not contain a fragment.`);
  if (parsed.search) throw new Error(`${label} baseUrl must not contain a query.`);
  if (value.wireApi !== "responses") throw new Error(`${label} wireApi must be 'responses'.`);
  if (typeof value.requiresOpenAiAuth !== "boolean") {
    throw new Error(`${label} requiresOpenAiAuth must be a boolean.`);
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonical(value));
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function yamlScalar(raw) {
  const value = raw.trim();
  if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function parseAgentRoles(source) {
  const roles = new Set();
  for (const line of source.replaceAll("\r\n", "\n").split("\n")) {
    const match = line.match(/^  - name:\s*(.+)$/);
    if (!match) continue;
    const role = yamlScalar(match[1]);
    assertId(role, "Agent role");
    if (roles.has(role)) throw new Error(`Agent registry contains duplicate role '${role}'.`);
    roles.add(role);
  }
  if (!roles.size) throw new Error("Agent registry does not define any roles.");
  return roles;
}

function resolveInsideRoot(root, relativePath, label) {
  const rootPath = path.resolve(root);
  const fullPath = path.resolve(rootPath, relativePath);
  const relative = path.relative(rootPath, fullPath).replaceAll("\\", "/");
  if (!relative || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new Error(`${label} must stay inside the repository root.`);
  }
  return fullPath;
}

async function readTextFile(filePath, label, optional = false) {
  const info = await lstat(filePath).catch((error) => {
    if (error?.code === "ENOENT" && optional) return null;
    if (error?.code === "ENOENT") throw new Error(`${label} is missing.`);
    throw error;
  });
  if (!info) return null;
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file.`);
  }
  return readFile(filePath, "utf8");
}

async function readJsonLayer(root, relativePath, label) {
  const source = await readTextFile(
    resolveInsideRoot(root, relativePath, label),
    label,
    true,
  );
  if (source === null) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${label} contains invalid JSON.`);
    throw error;
  }
}

function validateProfile(profile, label) {
  assertObject(profile, label);
  assertExactFields(profile, PROFILE_FIELDS, label);
  for (const field of ["adapter", "model"]) {
    if (!Object.hasOwn(profile, field)) throw new Error(`${label} requires '${field}'.`);
  }
  if (!SUPPORTED_ADAPTERS.has(profile.adapter)) {
    throw new Error(`${label} uses unsupported adapter '${profile.adapter}'.`);
  }
  assertModel(profile.model, `${label} model`);
  assertModelProvider(profile.modelProvider, `${label} modelProvider`);
}

function validateLayer(layer, label, knownRoles) {
  assertObject(layer, label);
  assertExactFields(layer, CONFIG_FIELDS, label);
  if (layer.schemaVersion !== "1.0") throw new Error(`${label} schemaVersion must be '1.0'.`);
  if (Object.hasOwn(layer, "defaultProfile")) {
    assertId(layer.defaultProfile, `${label} defaultProfile`);
  }
  if (Object.hasOwn(layer, "profiles")) {
    assertObject(layer.profiles, `${label} profiles`);
    if (!Object.keys(layer.profiles).length) throw new Error(`${label} profiles must not be empty.`);
    for (const [profileId, profile] of Object.entries(layer.profiles)) {
      assertId(profileId, `${label} profile ID`);
      validateProfile(profile, `${label} profile '${profileId}'`);
    }
  }
  if (Object.hasOwn(layer, "roleBindings")) {
    assertObject(layer.roleBindings, `${label} roleBindings`);
    for (const [role, profileId] of Object.entries(layer.roleBindings)) {
      assertId(role, `${label} role`);
      if (!knownRoles.has(role)) throw new Error(`${label} references unknown role '${role}'.`);
      assertId(profileId, `${label} role binding`);
    }
  }
}

function mergeLayer(current, sources, layer, sourceName) {
  if (Object.hasOwn(layer, "defaultProfile")) {
    current.defaultProfile = layer.defaultProfile;
    sources.defaultProfile = sourceName;
  }
  for (const [profileId, profile] of Object.entries(layer.profiles ?? {})) {
    current.profiles[profileId] = {
      adapter: profile.adapter,
      model: profile.model,
      modelProvider: structuredClone(profile.modelProvider ?? null),
    };
    sources.profiles[profileId] = sourceName;
  }
  for (const [role, profileId] of Object.entries(layer.roleBindings ?? {})) {
    current.roleBindings[role] = profileId;
    sources.roleBindings[role] = sourceName;
  }
}

function validateMergedConfig(config) {
  if (!config.profiles[config.defaultProfile]) {
    throw new Error(`Default profile '${config.defaultProfile}' is not defined.`);
  }
  for (const [role, profileId] of Object.entries(config.roleBindings)) {
    if (!config.profiles[profileId]) {
      throw new Error(`Role '${role}' references profile '${profileId}' that is not defined.`);
    }
  }
}

export async function loadProviderConfig({ root }) {
  if (typeof root !== "string" || !root) throw new Error("Repository root is required.");
  const registrySource = await readTextFile(
    resolveInsideRoot(root, ".codex/agents/agents.yaml", "Agent registry"),
    "Agent registry",
  );
  const knownRoles = parseAgentRoles(registrySource);
  const project = await readJsonLayer(
    root,
    ".harness/config/agent-providers.json",
    "Project provider config",
  );
  const local = await readJsonLayer(
    root,
    ".harness/config/agent-providers.local.json",
    "Local provider config",
  );
  if (project) validateLayer(project, "Project provider config", knownRoles);
  if (local) validateLayer(local, "Local provider config", knownRoles);

  const config = structuredClone(BUILTIN_CONFIG);
  const sources = {
    defaultProfile: "builtin-default",
    profiles: {
      "codex-default": "builtin-default",
    },
    roleBindings: {},
  };
  if (project) mergeLayer(config, sources, project, "project-config");
  if (local) mergeLayer(config, sources, local, "local-config");
  validateMergedConfig(config);

  return {
    config,
    configSha256: sha256(canonicalJson(config)),
    knownRoles,
    sources,
  };
}

export function resolveProviderProfile({
  loaded,
  role,
  profile,
  model,
}) {
  if (!loaded || typeof loaded !== "object") throw new Error("Loaded provider config is required.");
  if (!loaded.knownRoles?.has(role)) throw new Error(`Unknown role '${role}'.`);
  if (profile !== undefined) assertId(profile, "Runtime profile");
  if (model !== undefined) assertModel(model, "Runtime model");

  const selectedProfile = profile
    ?? loaded.config.roleBindings[role]
    ?? loaded.config.defaultProfile;
  const selected = loaded.config.profiles[selectedProfile];
  if (!selected) throw new Error(`Unknown profile '${selectedProfile}'.`);
  const profileSource = profile !== undefined
    ? "runtime-override"
    : loaded.sources.roleBindings[role] ?? loaded.sources.defaultProfile;
  const requestedModel = model !== undefined ? model : selected.model;
  const modelSource = model !== undefined
    ? "runtime-override"
    : loaded.sources.profiles[selectedProfile];

  return {
    role,
    profile: selectedProfile,
    adapter: selected.adapter,
    requestedModel,
    modelProvider: structuredClone(selected.modelProvider ?? null),
    profileSource,
    modelSource,
    configSha256: loaded.configSha256,
  };
}
