import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_SEMANTIC_TIMEOUT_MS = 30_000;

const SEMANTIC_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    responsibility: { type: "string", minLength: 1 },
    business_flows: { type: "array", items: { type: "string", minLength: 1 } },
    cross_module_dependencies: { type: "array", items: { type: "string", minLength: 1 } },
    risks: { type: "array", items: { type: "string", minLength: 1 } },
    consumption_hints: { type: "array", items: { type: "string", minLength: 1 } },
  },
  required: [
    "responsibility",
    "business_flows",
    "cross_module_dependencies",
    "risks",
    "consumption_hints",
  ],
};

const BACKEND_DOC_TYPES = ["overview", "interfaces", "architecture", "dependencies", "storage", "config", "pitfalls"];
const FRONTEND_DOC_TYPES = ["overview", "routes", "components", "api-usage", "state", "pitfalls"];
const BACKEND_SOURCE_ROOT = "backend/src/main/java/com/frontierscan";
const BACKEND_RESOURCE_ROOT = "backend/src/main/resources";
const FRONTEND_SOURCE_ROOT = "frontend/src";

function normalizePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

function relativePath(root, fullPath) {
  return normalizePath(path.relative(root, fullPath));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

async function readText(filePath) {
  return readFile(filePath, "utf8");
}

function createReadFailure(root, filePath, stage, error) {
  const rawCode = typeof error?.code === "string" ? error.code : "UNKNOWN";
  const errorCode = /^[A-Za-z0-9_-]+$/.test(rawCode) ? rawCode : "UNKNOWN";
  return {
    file: relativePath(root, filePath),
    stage,
    error: `Read failed (${errorCode}).`,
  };
}

async function tryReadSource(root, filePath, stage, readTextImpl) {
  try {
    return { content: await readTextImpl(filePath), failure: null };
  } catch (error) {
    return { content: null, failure: createReadFailure(root, filePath, stage, error) };
  }
}

async function listFiles(root, extensions) {
  if (!existsSync(root)) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath, extensions));
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

async function listAllFiles(root) {
  return listFiles(root, [""]);
}

async function childProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, options, (error, stdout) => {
      resolve(error ? "" : stdout.trim());
    });
  });
}

async function getGitHash(root) {
  const hash = await childProcess("git", ["-C", root, "rev-parse", "HEAD"]);
  return hash || "unknown";
}

async function getChangedPaths(root) {
  const output = await childProcess("git", ["-C", root, "status", "--short", "--untracked-files=all"]);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\S{1,2}\s+/, "").replaceAll("\\", "/"))
    .sort();
}

function parseClassNames(content) {
  return [...content.matchAll(/\b(?:public\s+)?(class|interface|record|enum)\s+([A-Za-z0-9_]+)/g)]
    .map((match) => ({ kind: match[1], name: match[2] }));
}

function parseImports(content) {
  return unique([...content.matchAll(/^\s*import\s+([^;]+);/gm)].map((match) => match[1]));
}

function firstClassName(content, fallback) {
  return parseClassNames(content)[0]?.name ?? fallback;
}

function parseAnnotationValue(annotationText) {
  const quoted = annotationText.match(/"([^"]*)"/);
  return quoted ? quoted[1] : "";
}

function joinEndpoint(basePath, methodPath) {
  const base = basePath || "";
  const method = methodPath || "";
  const combined = `/${base}/${method}`.replaceAll(/\/+/g, "/");
  return combined.length > 1 ? combined.replace(/\/$/, "") : combined;
}

function skipWhitespace(content, start) {
  let cursor = start;
  while (/\s/.test(content[cursor] ?? "")) {
    cursor += 1;
  }
  return cursor;
}

function findBalancedEnd(content, start, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = "";
  for (let cursor = start; cursor < content.length; cursor += 1) {
    const character = content[cursor];
    if (quote) {
      if (character === "\\") {
        cursor += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }
    if (['"', "'"].includes(character)) {
      quote = character;
      continue;
    }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) depth -= 1;
    if (depth === 0) return cursor + 1;
  }
  return -1;
}

function readLeadingAnnotations(content, start) {
  const annotations = [];
  let cursor = skipWhitespace(content, start);
  while (content[cursor] === "@") {
    const nameMatch = content.slice(cursor + 1).match(/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/);
    if (!nameMatch) break;
    let end = cursor + 1 + nameMatch[0].length;
    end = skipWhitespace(content, end);
    if (content[end] === "(") {
      end = findBalancedEnd(content, end, "(", ")");
      if (end < 0) break;
    }
    annotations.push(content.slice(cursor, end).trim());
    cursor = skipWhitespace(content, end);
  }
  return { annotations, cursor };
}

function splitTopLevel(value) {
  const values = [];
  let start = 0;
  let angleDepth = 0;
  let parenthesisDepth = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let cursor = 0; cursor < value.length; cursor += 1) {
    const character = value[cursor];
    if (character === "<") angleDepth += 1;
    if (character === ">") angleDepth = Math.max(0, angleDepth - 1);
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === "{") braceDepth += 1;
    if (character === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (character === "," && angleDepth === 0 && parenthesisDepth === 0 && braceDepth === 0 && bracketDepth === 0) {
      values.push(value.slice(start, cursor));
      start = cursor + 1;
    }
  }
  values.push(value.slice(start));
  return values.map((item) => item.trim()).filter(Boolean);
}

function findBalancedStart(content, closeIndex, openCharacter, closeCharacter) {
  let depth = 0;
  for (let cursor = closeIndex; cursor >= 0; cursor -= 1) {
    if (content[cursor] === closeCharacter) depth += 1;
    if (content[cursor] === openCharacter) depth -= 1;
    if (depth === 0) return cursor;
  }
  return -1;
}

function enclosingFrontendParameters(content, callIndex) {
  let braceDepth = 0;
  let bodyStart = -1;
  for (let cursor = callIndex - 1; cursor >= 0; cursor -= 1) {
    if (content[cursor] === "}") braceDepth += 1;
    if (content[cursor] === "{") {
      if (braceDepth === 0) {
        bodyStart = cursor;
        break;
      }
      braceDepth -= 1;
    }
  }
  if (bodyStart < 0) return [];

  let closeParenthesis = bodyStart - 1;
  while (/\s/.test(content[closeParenthesis] ?? "")) closeParenthesis -= 1;
  if (content[closeParenthesis] !== ")") return [];
  const openParenthesis = findBalancedStart(content, closeParenthesis, "(", ")");
  if (openParenthesis < 0) return [];

  return splitTopLevel(content.slice(openParenthesis + 1, closeParenthesis)).map((parameter) => {
    const match = parameter.match(/^(?:\.\.\.)?([A-Za-z_$][\w$]*)\??\s*:\s*([\s\S]+)$/);
    return match ? { name: match[1], type: match[2].trim() } : null;
  }).filter(Boolean);
}

function parseJavaParameters(parametersText) {
  return splitTopLevel(parametersText).map((parameter) => {
    const annotations = [];
    let remaining = parameter.trim();
    while (remaining.startsWith("@")) {
      const parsed = readLeadingAnnotations(remaining, 0);
      if (!parsed.annotations.length) break;
      annotations.push(...parsed.annotations);
      remaining = remaining.slice(parsed.cursor).trim();
    }
    remaining = remaining.replace(/\bfinal\s+/g, "").trim();
    const name = remaining.match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? "";
    const type = name ? remaining.slice(0, remaining.lastIndexOf(name)).trim() : remaining;
    const binding = annotations
      .map((annotation) => annotation.match(/^@(?:[\w$]+\.)*([A-Za-z_$][\w$]*)/)?.[1] ?? "")
      .find((name) => ["PathVariable", "RequestParam", "RequestBody", "RequestHeader", "CookieValue", "ModelAttribute", "RequestPart"].includes(name))
      ?? "";
    return { name, type, binding, annotations };
  });
}

function parseMethodAfterAnnotation(content, annotationEnd) {
  const leading = readLeadingAnnotations(content, annotationEnd);
  const signatureStart = skipWhitespace(content, leading.cursor);
  const openParenthesis = content.indexOf("(", signatureStart);
  const bodyStart = content.indexOf("{", signatureStart);
  const declarationEnd = content.indexOf(";", signatureStart);
  const nearestEnd = [bodyStart, declarationEnd].filter((index) => index >= 0).sort((a, b) => a - b)[0] ?? -1;
  if (openParenthesis < 0 || (nearestEnd >= 0 && openParenthesis > nearestEnd)) {
    return null;
  }
  const closeParenthesis = findBalancedEnd(content, openParenthesis, "(", ")");
  if (closeParenthesis < 0) return null;

  const prefix = content.slice(signatureStart, openParenthesis).trim();
  const handler = prefix.match(/([A-Za-z_$][\w$]*)\s*$/)?.[1] ?? "";
  const beforeHandler = handler ? prefix.slice(0, prefix.lastIndexOf(handler)).trim() : "";
  const returnType = beforeHandler
    .replace(/^(?:(?:public|protected|private|static|final|synchronized|abstract|default|native|strictfp)\s+)+/, "")
    .replace(/^<[^>]+>\s*/, "")
    .trim();
  if (!handler || !returnType) return null;

  return {
    handler,
    return_type: returnType,
    parameters: parseJavaParameters(content.slice(openParenthesis + 1, closeParenthesis - 1)),
    annotations: leading.annotations,
  };
}

function parseConstructorDependencies(content, className, file) {
  if (!/@(?:Service|Component)\b/.test(content)) return [];
  const dependencies = [];
  const constructorRegex = new RegExp(`\\b${className}\\s*\\(`, "g");
  for (const match of content.matchAll(constructorRegex)) {
    const lineStart = content.lastIndexOf("\n", match.index) + 1;
    const prefix = content.slice(lineStart, match.index).trim();
    if (!/^(?:public|protected|private)?$/.test(prefix)) continue;
    const openParenthesis = content.indexOf("(", match.index);
    const closeParenthesis = findBalancedEnd(content, openParenthesis, "(", ")");
    if (closeParenthesis < 0) continue;
    for (const parameter of parseJavaParameters(content.slice(openParenthesis + 1, closeParenthesis - 1))) {
      dependencies.push({
        class: className,
        dependency: parameter.type,
        parameter: parameter.name,
        injection: "constructor",
        file,
      });
    }
  }
  return dependencies;
}

function extractFrontendApiCalls(content, file) {
  const calls = [];
  const callRegex = /apiClient\.(get|post|put|delete|patch)\b/g;
  for (const match of content.matchAll(callRegex)) {
    let cursor = match.index + match[0].length;
    let responseType = "";
    while (/\s/.test(content[cursor] ?? "")) {
      cursor += 1;
    }

    if (content[cursor] === "<") {
      const genericStart = cursor;
      let depth = 0;
      do {
        if (content[cursor] === "<") depth += 1;
        if (content[cursor] === ">") depth -= 1;
        cursor += 1;
      } while (cursor < content.length && depth > 0);
      if (depth !== 0) {
        continue;
      }
      responseType = content.slice(genericStart + 1, cursor - 1).trim();
      while (/\s/.test(content[cursor] ?? "")) {
        cursor += 1;
      }
    }

    if (content[cursor] !== "(") {
      continue;
    }
    const callOpenParenthesis = cursor;
    cursor += 1;
    while (/\s/.test(content[cursor] ?? "")) {
      cursor += 1;
    }

    const quote = content[cursor];
    if (!['"', "'", "`"].includes(quote)) {
      continue;
    }
    cursor += 1;
    let value = "";
    while (cursor < content.length) {
      const character = content[cursor];
      if (character === "\\" && cursor + 1 < content.length) {
        value += character + content[cursor + 1];
        cursor += 2;
        continue;
      }
      if (character === quote) {
        const method = match[1].toUpperCase();
        const callEnd = findBalancedEnd(content, callOpenParenthesis, "(", ")");
        const argumentsList = callEnd > 0
          ? splitTopLevel(content.slice(callOpenParenthesis + 1, callEnd - 1))
          : [];
        const parameters = enclosingFrontendParameters(content, match.index);
        const bodyArguments = ["POST", "PUT", "PATCH"].includes(method) ? argumentsList.slice(1) : [];
        const requestTypes = unique(parameters
          .filter((parameter) => bodyArguments.some((argument) => new RegExp(`\\b${parameter.name}\\b`).test(argument)))
          .map((parameter) => parameter.type));
        calls.push({
          method,
          path: value,
          response_type: responseType,
          request_types: requestTypes,
          file,
        });
        break;
      }
      value += character;
      cursor += 1;
    }
  }
  return calls;
}

function parseBackendFile(root, filePath, moduleName, content) {
  const file = relativePath(root, filePath);
  const className = firstClassName(content, path.basename(filePath, ".java"));
  const classes = parseClassNames(content).map((item) => ({ ...item, file }));
  const imports = parseImports(content);
  const isController = /@RestController|@Controller/.test(content) || /Controller\.java$/.test(filePath);
  const classDeclarationIndex = content.search(/\b(?:class|interface|record)\s+[A-Za-z_$][\w$]*/);
  const classMapping = [...content.matchAll(/@RequestMapping\s*(?:\([^)]*\))?/g)]
    .find((match) => classDeclarationIndex >= 0 && match.index < classDeclarationIndex);
  const baseMapping = isController ? parseAnnotationValue(classMapping?.[0] ?? "") : "";
  const mappingRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\([^)]*\))?/g;
  const endpoints = [];
  if (isController) {
    for (const match of content.matchAll(mappingRegex)) {
      const annotation = match[1];
      if (classMapping && match.index === classMapping.index) {
        continue;
      }
      const parsedMethod = parseMethodAfterAnnotation(content, match.index + match[0].length);
      if (!parsedMethod) continue;
      const method = annotation.replace("Mapping", "").toUpperCase();
      endpoints.push({
        controller: className,
        method: method === "REQUEST" ? "ANY" : method,
        path: joinEndpoint(baseMapping, parseAnnotationValue(match[0])),
        handler: parsedMethod.handler,
        return_type: parsedMethod.return_type,
        parameters: parsedMethod.parameters,
        security: parsedMethod.annotations.filter((item) => /@(PreAuthorize|PostAuthorize|Secured|RolesAllowed)\b/.test(item)),
        file,
      });
    }
  }

  const entities = /@Entity\b|@TableName\s*\(/.test(content)
    ? [{
        name: className,
        table: content.match(/@Table\s*\([^)]*name\s*=\s*"([^"]+)"/)?.[1]
          ?? content.match(/@TableName\s*\(\s*"([^"]+)"/)?.[1]
          ?? "",
        file,
      }]
    : [];

  const repositories = /extends\s+JpaRepository|extends\s+BaseMapper/.test(content)
    ? [{ name: className, file }]
    : [];

  const configProperties = [...content.matchAll(/@ConfigurationProperties\s*\([^)]*prefix\s*=\s*"([^"]+)"/g)]
    .map((match) => ({ class: className, prefix: match[1], file }));
  const scheduled = /@Scheduled\s*\(/.test(content) ? [{ class: className, file }] : [];
  const asyncMethods = [...content.matchAll(/@Async\s*(?:\(\s*"([^"]+)"\s*\))?/g)]
    .map((match) => ({ class: className, executor: match[1] ?? "", file }));
  const transactionalMethods = [...content.matchAll(/@Transactional\b(?:\s*\([^)]*\))?/g)]
    .map((match) => parseMethodAfterAnnotation(content, match.index + match[0].length))
    .filter(Boolean)
    .map((method) => ({
      class: className,
      name: method.handler,
      return_type: method.return_type,
      parameters: method.parameters,
      file,
    }));
  const serviceDependencies = parseConstructorDependencies(content, className, file);

  return {
    classes,
    imports,
    controllers: isController ? [{ name: className, base_path: baseMapping, file }] : [],
    endpoints,
    entities,
    repositories,
    configProperties,
    scheduled,
    asyncMethods,
    transactionalMethods,
    serviceDependencies,
  };
}

async function discoverBackendResources(root, readTextImpl = readText) {
  const resourcesRoot = path.join(root, BACKEND_RESOURCE_ROOT);
  const files = await listFiles(resourcesRoot, [".yml", ".yaml", ".properties", ".sql", ".md", ".txt", ".json", ".mustache", ".hbs", ".stg"]);
  const resources = [];
  const failedFiles = [];
  for (const filePath of files) {
    const file = relativePath(root, filePath);
    const normalized = file.toLowerCase();
    const baseName = path.basename(filePath).toLowerCase();
    let kind = "";
    if (/^application(?:-[^.]+)?\.(?:ya?ml|properties)$/.test(baseName)) {
      kind = "configuration";
    } else if (normalized.includes("/db/migration/") && baseName.endsWith(".sql")) {
      kind = "migration";
    } else if (/\/(?:prompts?|prompt[_-]?templates?|templates?)\//.test(normalized) || baseName.includes("prompt")) {
      kind = "prompt-template";
    }
    if (kind) {
      const readResult = await tryReadSource(root, filePath, "backend-resource-read", readTextImpl);
      if (readResult.failure) {
        failedFiles.push(readResult.failure);
        continue;
      }
      resources.push({ kind, file, content: readResult.content });
    }
  }
  return { resources, failedFiles };
}

function resourcesForBackendModule(moduleName, facts, sourceText, resources) {
  const tableNames = facts.entities.map((entity) => entity.table).filter(Boolean);
  const searchTerms = unique([moduleName, `${moduleName}s`, ...tableNames]).map((term) => term.toLowerCase());
  return resources
    .filter((resource) => {
      if (resource.kind === "configuration") return true;
      if (resource.kind === "migration") {
        const searchable = `${resource.file}\n${resource.content}`.toLowerCase();
        return searchTerms.some((term) => searchable.includes(term));
      }
      if (resource.kind === "prompt-template") {
        const resourcePath = resource.file.replace(/^backend\/src\/main\/resources\//, "");
        return [resourcePath, path.basename(resourcePath)]
          .some((reference) => sourceText.includes(reference));
      }
      return false;
    })
    .map(({ kind, file }) => ({ kind, file }));
}

async function discoverBackendModules(root, readTextImpl = readText) {
  const backendRoot = path.join(root, BACKEND_SOURCE_ROOT);
  if (!existsSync(backendRoot)) {
    return { modules: [], resourceFiles: [], failedFiles: [] };
  }

  const entries = await readdir(backendRoot, { withFileTypes: true });
  const resourceDiscovery = await discoverBackendResources(root, readTextImpl);
  const resources = resourceDiscovery.resources;
  const failedFiles = [...resourceDiscovery.failedFiles];
  const modules = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modulePath = path.join(backendRoot, entry.name);
    const files = await listFiles(modulePath, [".java"]);
    const facts = {
      area: "backend",
      module: entry.name,
      root_path: normalizePath(path.relative(root, modulePath)),
      source_files: [],
      file_count: 0,
      classes: [],
      controllers: [],
      endpoints: [],
      entities: [],
      repositories: [],
      config_properties: [],
      scheduled_jobs: [],
      async_methods: [],
      transactional_methods: [],
      service_dependencies: [],
      imports: [],
      resources: [],
    };

    const sourceContents = [];
    for (const file of files) {
      const readResult = await tryReadSource(root, file, "backend-source-read", readTextImpl);
      if (readResult.failure) {
        failedFiles.push(readResult.failure);
        continue;
      }
      const content = readResult.content;
      facts.source_files.push(relativePath(root, file));
      facts.file_count += 1;
      sourceContents.push(content);
      const parsed = parseBackendFile(root, file, entry.name, content);
      facts.classes.push(...parsed.classes);
      facts.controllers.push(...parsed.controllers);
      facts.endpoints.push(...parsed.endpoints);
      facts.entities.push(...parsed.entities);
      facts.repositories.push(...parsed.repositories);
      facts.config_properties.push(...parsed.configProperties);
      facts.scheduled_jobs.push(...parsed.scheduled);
      facts.async_methods.push(...parsed.asyncMethods);
      facts.transactional_methods.push(...parsed.transactionalMethods);
      facts.service_dependencies.push(...parsed.serviceDependencies);
      facts.imports.push(...parsed.imports);
    }
    facts.resources = resourcesForBackendModule(entry.name, facts, sourceContents.join("\n"), resources);

    modules.push({
      area: "backend",
      name: entry.name,
      type: "spring-package",
      path: facts.root_path,
      facts: { ...facts, imports: unique(facts.imports).slice(0, 80) },
    });
  }
  return {
    modules,
    resourceFiles: resources.map((resource) => resource.file),
    failedFiles,
  };
}

function parseFrontendFile(root, filePath, areaName, content) {
  const file = relativePath(root, filePath);
  const apiCalls = extractFrontendApiCalls(content, file);
  const routes = [...content.matchAll(/path:\s*['"]([^'"]+)['"][\s\S]*?name:\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ path: match[1], name: match[2], file }));
  const routeGuards = [...content.matchAll(/\b(?:router\.)?beforeEach\s*\(/g)]
    .map(() => ({ kind: "beforeEach", file }));
  for (const metaMatch of content.matchAll(/\bmeta\s*:\s*\{([^}]*)\}/g)) {
    for (const property of metaMatch[1].matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(true|false|['"][^'"]*['"]|\d+)/g)) {
      routeGuards.push({
        kind: "route-meta",
        key: property[1],
        value: property[2].replace(/^['"]|['"]$/g, ""),
        file,
      });
    }
  }
  const stores = [...content.matchAll(/defineStore\s*\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ name: match[1], file }));
  const exports = [...content.matchAll(/export\s+(?:const|function|class|interface|type)\s+([A-Za-z0-9_]+)/g)]
    .map((match) => ({ name: match[1], file }));
  const apiDependencies = [];
  for (const match of content.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]*\/api\/([^'"/]+))['"]/g)) {
    const importedSymbols = match[1].split(",")
      .map((item) => item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[1] ?? item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0])
      .filter(Boolean);
    const contentAfterImport = content.slice(match.index + match[0].length);
    for (const symbol of importedSymbols) {
      if (new RegExp(`\\b${symbol}\\b`).test(contentAfterImport)) {
        apiDependencies.push({ api_module: match[3], symbol, file });
      }
    }
  }
  return {
    file,
    kind: path.extname(filePath).replace(".", "") || "unknown",
    apiCalls,
    routes,
    routeGuards,
    stores,
    exports,
    apiDependencies,
    component: file.endsWith(".vue") ? path.basename(filePath) : "",
  };
}

async function discoverFrontendModules(root, readTextImpl = readText) {
  const frontendRoot = path.join(root, FRONTEND_SOURCE_ROOT);
  if (!existsSync(frontendRoot)) {
    return { modules: [], resourceFiles: [], failedFiles: [] };
  }

  const entries = await readdir(frontendRoot, { withFileTypes: true });
  const modules = [];
  const failedFiles = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modulePath = path.join(frontendRoot, entry.name);
    const files = await listFiles(modulePath, [".ts", ".tsx", ".js", ".vue", ".css"]);
    const parsedFiles = [];
    const facts = {
      area: "frontend",
      module: entry.name,
      root_path: normalizePath(path.relative(root, modulePath)),
      source_files: [],
      file_count: 0,
      files: parsedFiles,
      api_calls: [],
      routes: [],
      route_guards: [],
      stores: [],
      exports: [],
      api_dependencies: [],
      components: [],
    };

    for (const file of files) {
      const readResult = await tryReadSource(root, file, "frontend-source-read", readTextImpl);
      if (readResult.failure) {
        failedFiles.push(readResult.failure);
        continue;
      }
      const parsed = parseFrontendFile(root, file, entry.name, readResult.content);
      facts.source_files.push(parsed.file);
      facts.file_count += 1;
      parsedFiles.push({ file: parsed.file, kind: parsed.kind });
      facts.api_calls.push(...parsed.apiCalls);
      facts.routes.push(...parsed.routes);
      facts.route_guards.push(...parsed.routeGuards);
      facts.stores.push(...parsed.stores);
      facts.exports.push(...parsed.exports);
      facts.api_dependencies.push(...parsed.apiDependencies);
      if (parsed.component) {
        facts.components.push({ name: parsed.component, file: parsed.file });
      }
    }

    modules.push({
      area: "frontend",
      name: entry.name,
      type: "vue-source-area",
      path: facts.root_path,
      facts,
    });
  }
  return { modules, resourceFiles: [], failedFiles };
}

function yamlList(items, indent = 2) {
  if (!items.length) {
    return `${" ".repeat(indent)}[]`;
  }
  return items.map((item) => `${" ".repeat(indent)}- ${item}`).join("\n");
}

function docHeader({ area, moduleName, docType, generatedAt, gitHash, sourceFiles, layer, semanticStatus, generatedBy = "frontier-kb-generate" }) {
  return `---\ngenerated_by: ${generatedBy}\nlayer: ${layer}\narea: ${area}\nmodule: ${moduleName}\ndoc_type: ${docType}\ngit_hash: ${gitHash}\ngenerated_at: ${generatedAt}\nbaseline_status: fresh\nsemantic_status: ${semanticStatus}\nsource_files:\n${yamlList(sourceFiles.slice(0, 30), 2)}\n---\n\n`;
}

function bullet(items, emptyText = "暂无自动识别结果。") {
  if (!items.length) {
    return `- ${emptyText}`;
  }
  return items.map((item) => `- ${item}`).join("\n");
}

function backendDoc(module, docType, context) {
  const facts = module.facts;
  const header = docHeader({ ...context, area: "backend", moduleName: module.name, docType, sourceFiles: facts.source_files, layer: "L1-baseline" });
  const controllerLines = facts.controllers.map((item) => `${item.name}：${item.base_path || "(root)"} (${item.file})`);
  const endpointLines = facts.endpoints.map((item) => `${item.method} ${item.path} -> ${item.controller} (${item.file})`);
  const entityLines = facts.entities.map((item) => `${item.name}${item.table ? ` -> ${item.table}` : ""} (${item.file})`);
  const repositoryLines = facts.repositories.map((item) => `${item.name} (${item.file})`);
  const configLines = facts.config_properties.map((item) => `${item.prefix} -> ${item.class} (${item.file})`);
  const jobLines = facts.scheduled_jobs.map((item) => `${item.class} (${item.file})`);
  const asyncLines = facts.async_methods.map((item) => `${item.class}${item.executor ? ` -> ${item.executor}` : ""} (${item.file})`);

  switch (docType) {
    case "overview":
      return `${header}# ${module.name} 后端模块概览\n\n## 自动识别职责\n\n- 模块路径：\`${module.path}\`\n- Java 文件数：${facts.file_count}\n- 类/接口/记录/枚举数量：${facts.classes.length}\n- Controller 数量：${facts.controllers.length}\n- Entity 数量：${facts.entities.length}\n- Repository 数量：${facts.repositories.length}\n\n## 主要类\n\n${bullet(facts.classes.map((item) => `${item.kind} ${item.name} (${item.file})`))}\n\n## 语义说明\n\nNeeds AI Review: 请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。\n`;
    case "interfaces":
      return `${header}# ${module.name} 接口与集成点\n\n## Controllers\n\n${bullet(controllerLines)}\n\n## HTTP Endpoints\n\n${bullet(endpointLines)}\n\n## 外部调用/集成提示\n\nNeeds AI Review: 自动基线只识别 Spring MVC 注解，复杂参数、权限、响应体和异常语义需由 L2 或人工补充。\n`;
    case "architecture":
      return `${header}# ${module.name} 架构基线\n\n## 模块内部结构\n\n${bullet(facts.source_files)}\n\n## 定时/异步执行\n\n${bullet([...jobLines, ...asyncLines])}\n\n## 待增强说明\n\nNeeds AI Review: 请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。\n`;
    case "dependencies":
      return `${header}# ${module.name} 依赖基线\n\n## 识别到的 imports\n\n${bullet(facts.imports.slice(0, 50))}\n\n## 待增强说明\n\nNeeds AI Review: 请区分框架依赖、业务依赖、外部服务依赖和测试替身。\n`;
    case "storage":
      return `${header}# ${module.name} 存储基线\n\n## Entities / Tables\n\n${bullet(entityLines)}\n\n## Repositories / Mappers\n\n${bullet(repositoryLines)}\n\n## 待增强说明\n\nNeeds AI Review: 请结合 Flyway migration、索引、约束和查询模式补充数据语义。\n`;
    case "config":
      return `${header}# ${module.name} 配置基线\n\n## Configuration Properties\n\n${bullet(configLines)}\n\n## 异步/调度配置线索\n\n${bullet([...jobLines, ...asyncLines])}\n\n## 待增强说明\n\nNeeds AI Review: 请补充环境变量、默认值、生产风险和降级行为。\n`;
    case "pitfalls":
      return `${header}# ${module.name} 风险与注意事项\n\n## 自动识别风险线索\n\n${bullet([
        facts.controllers.length ? "存在对外 HTTP API，需关注鉴权、参数校验和响应兼容性。" : "",
        facts.scheduled_jobs.length ? "存在定时任务，需关注重复执行、锁、幂等和失败恢复。" : "",
        facts.async_methods.length ? "存在异步执行，需关注线程池、事务上下文和异常传播。" : "",
        facts.entities.length ? "存在持久化实体，需关注 migration、索引和数据兼容。" : "",
      ].filter(Boolean))}\n\n## 待增强说明\n\nNeeds AI Review: 请结合线上故障、测试缺口和业务规则补充真实风险。\n`;
    default:
      return `${header}# ${module.name} ${docType}\n\nNeeds AI Review\n`;
  }
}

function frontendDoc(module, docType, context) {
  const facts = module.facts;
  const header = docHeader({ ...context, area: "frontend", moduleName: module.name, docType, sourceFiles: facts.source_files, layer: "L1-baseline" });
  switch (docType) {
    case "overview":
      return `${header}# ${module.name} 前端区域概览\n\n## 自动识别职责\n\n- 区域路径：\`${module.path}\`\n- 文件数：${facts.file_count}\n- Vue 组件数：${facts.components.length}\n- API 调用数：${facts.api_calls.length}\n- 路由数：${facts.routes.length}\n- Store 数：${facts.stores.length}\n\n## 文件清单\n\n${bullet(facts.files.map((item) => `${item.file} (${item.kind})`))}\n\n## 语义说明\n\nNeeds AI Review: 请结合页面流程、B2B 后台交互规范和用户任务补充语义。\n`;
    case "routes":
      return `${header}# ${module.name} 路由基线\n\n${bullet(facts.routes.map((item) => `${item.path} -> ${item.name} (${item.file})`))}\n\n## 路由守卫\n\n${bullet(facts.route_guards.map((item) => item.kind === "route-meta" ? `${item.key}=${item.value} (${item.file})` : `${item.kind} (${item.file})`))}\n\nNeeds AI Review: 权限跳转和布局关系需结合源码进一步确认。\n`;
    case "components":
      return `${header}# ${module.name} 组件基线\n\n${bullet(facts.components.map((item) => `${item.name} (${item.file})`))}\n\n## Exports\n\n${bullet(facts.exports.map((item) => `${item.name} (${item.file})`))}\n\n## 页面到 API 依赖\n\n${bullet(facts.api_dependencies.map((item) => `${item.symbol} -> api/${item.api_module} (${item.file})`))}\n\nNeeds AI Review: 组件职责、复用边界、表格/弹窗/筛选交互需补充。\n`;
    case "api-usage":
      return `${header}# ${module.name} API 使用基线\n\n${bullet(facts.api_calls.map((item) => `${item.method} ${item.path} (${item.file})`))}\n\nNeeds AI Review: 请求参数、错误处理、加载状态和后端契约兼容性需补充。\n`;
    case "state":
      return `${header}# ${module.name} 状态基线\n\n${bullet(facts.stores.map((item) => `${item.name} (${item.file})`))}\n\nNeeds AI Review: 跨页面状态、localStorage、鉴权状态和缓存刷新策略需补充。\n`;
    case "pitfalls":
      return `${header}# ${module.name} 风险与注意事项\n\n${bullet([
        facts.api_calls.length ? "存在后端 API 依赖，需关注空态、错误态、鉴权过期和契约变化。" : "",
        facts.routes.length ? "存在路由配置，需关注登录态和默认跳转。" : "",
        facts.components.length ? "存在 Vue 组件，需关注 B2B 后台一致性和响应式布局。" : "",
      ].filter(Boolean))}\n\nNeeds AI Review: 请补充页面级业务风险、测试缺口和已知 UI 陷阱。\n`;
    default:
      return `${header}# ${module.name} ${docType}\n\nNeeds AI Review\n`;
  }
}

function buildPendingSemanticDoc(module, context, reason) {
  const facts = module.facts;
  const header = docHeader({
    ...context,
    area: module.area,
    moduleName: module.name,
    docType: "semantic",
    sourceFiles: facts.source_files,
    layer: "L2-semantic",
    semanticStatus: reason.status,
  });
  return `${header}# ${module.name} 语义增强\n\nsemantic_status: ${reason.status}\nsemantic_model: ${reason.model}\n\n## 当前状态\n\n- ${reason.message}\n\n## 待增强内容\n\n- 模块职责和边界\n- 核心业务流程\n- 跨模块依赖和调用链\n- 主要风险点和测试关注点\n- 动态消费提示词和查询关键词\n`;
}

function validateSemanticOutput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Semantic output must be a JSON object.");
  }
  if (typeof value.responsibility !== "string" || !value.responsibility.trim()) {
    throw new Error("Semantic output field 'responsibility' must be a non-empty string.");
  }
  for (const field of ["business_flows", "cross_module_dependencies", "risks", "consumption_hints"]) {
    if (!Array.isArray(value[field]) || value[field].some((item) => typeof item !== "string" || !item.trim())) {
      throw new Error(`Semantic output field '${field}' must be an array of non-empty strings.`);
    }
  }
  return value;
}

function responseOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  return (payload?.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((item) => item.text ?? "")
    .join("\n");
}

function renderSemanticDoc(module, context, model, semantic) {
  const header = docHeader({
    ...context,
    area: module.area,
    moduleName: module.name,
    docType: "semantic",
    sourceFiles: module.facts.source_files,
    layer: "L2-semantic",
    semanticStatus: "fresh",
    generatedBy: "openai",
  });
  return `${header}# ${module.name} 语义增强\n\nsemantic_status: fresh\nsemantic_model: ${model}\n\n## 模块职责\n\n${semantic.responsibility.trim()}\n\n## 核心业务流程\n\n${bullet(semantic.business_flows)}\n\n## 跨模块依赖\n\n${bullet(semantic.cross_module_dependencies)}\n\n## 风险点\n\n${bullet(semantic.risks)}\n\n## 动态消费提示\n\n${bullet(semantic.consumption_hints)}\n\n## 来源文件\n\n${bullet(module.facts.source_files)}\n`;
}

async function callOpenAIForSemantic(module, context, env, requestOptions = {}) {
  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  if (!apiKey) {
    return {
      status: "pending",
      model,
      message: "未配置 OPENAI_API_KEY，已降级为 L1 基线文档，L2 语义增强待补充。",
      content: buildPendingSemanticDoc(module, context, {
        status: "pending",
        model,
        message: "未配置 OPENAI_API_KEY，已降级为 L1 基线文档，L2 语义增强待补充。",
      }),
    };
  }

  const prompt = [
    "你是 FrontierScan 项目的知识工程助手。",
    "请基于给定 facts 生成中文语义增强文档，必须保持可追溯，不要编造源码中没有的信息。",
    "只输出符合给定 JSON Schema 的数据。来源文件由生成器从 facts 注入，不要自行生成来源。",
    JSON.stringify({ area: module.area, module: module.name, facts: module.facts }, null, 2).slice(0, 24000),
  ].join("\n\n");

  const fetchImpl = requestOptions.fetchImpl ?? globalThis.fetch;
  const timeoutMs = requestOptions.timeoutMs ?? DEFAULT_SEMANTIC_TIMEOUT_MS;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);
  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "frontier_kb_semantic",
            strict: true,
            schema: SEMANTIC_OUTPUT_SCHEMA,
          },
        },
      }),
      signal: abortController.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenAI response status ${response.status}`);
    }
    const payload = await response.json();
    const text = responseOutputText(payload);
    if (!text.trim()) {
      throw new Error("OpenAI response did not include text output.");
    }
    const semantic = validateSemanticOutput(JSON.parse(text));
    return {
      status: "fresh",
      model,
      message: "OpenAI semantic enrichment completed.",
      content: renderSemanticDoc(module, context, model, semantic),
    };
  } catch (error) {
    const message = abortController.signal.aborted
      ? `OpenAI semantic request timed out after ${timeoutMs}ms.`
      : error.message;
    return {
      status: "failed",
      model,
      message: `OpenAI 语义增强失败：${message}`,
      content: buildPendingSemanticDoc(module, context, {
        status: "failed",
        model,
        message: `OpenAI 语义增强失败：${message}`,
      }),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function docsForModule(module, context, includeBaseline, semanticContent) {
  const docs = [];
  const docTypes = module.area === "backend" ? BACKEND_DOC_TYPES : FRONTEND_DOC_TYPES;
  if (includeBaseline) {
    for (const docType of docTypes) {
      const content = module.area === "backend"
        ? backendDoc(module, docType, context)
        : frontendDoc(module, docType, context);
      docs.push({ area: module.area, module: module.name, docType, content });
    }
  }
  if (semanticContent) {
    docs.push({ area: module.area, module: module.name, docType: "semantic", content: semanticContent });
  }
  return docs;
}

function moduleDocPath(root, area, moduleName, fileName) {
  return path.join(root, "llm-knowledge", area, "modules", moduleName, fileName);
}

function createChunk(entry, module, context) {
  const compact = entry.content
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/\r/g, "")
    .trim()
    .slice(0, 4000);
  return {
    id: `${entry.area}:${entry.module}:${entry.docType}`,
    area: entry.area,
    module: entry.module,
    doc_type: entry.docType,
    path: normalizePath(path.relative(context.root, moduleDocPath(context.root, entry.area, entry.module, `${entry.docType}.md`))),
    text: compact,
    source_files: module.facts.source_files,
    git_hash: context.gitHash,
    generated_at: context.generatedAt,
    baseline_status: "fresh",
    semantic_status: context.semanticStatus,
    keywords: unique([
      entry.area,
      entry.module,
      entry.docType,
      ...module.facts.source_files.map((file) => path.basename(file, path.extname(file))),
    ]).slice(0, 40),
  };
}

function splitTextIntoChunks(content, maxLength = 3500) {
  const lines = content.replace(/\r/g, "").split("\n");
  const chunks = [];
  let current = [];
  let currentLength = 0;

  const flush = () => {
    const text = current.join("\n").trim();
    if (text) {
      chunks.push(text);
    }
    current = [];
    currentLength = 0;
  };

  for (const line of lines) {
    const startsSection = /^#{1,4}\s+/.test(line);
    if (startsSection && currentLength > 0) {
      flush();
    }
    if (currentLength > 0 && currentLength + line.length + 1 > maxLength) {
      flush();
    }
    current.push(line);
    currentLength += line.length + 1;
  }
  flush();
  return chunks;
}

function curatedKeywords(relativeFile, text, extraKeywords = []) {
  const headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map((match) => match[1]);
  return unique([
    ...normalizePath(relativeFile).split("/"),
    path.basename(relativeFile, path.extname(relativeFile)),
    ...headings,
    ...extraKeywords,
  ]).slice(0, 40);
}

async function createCuratedFileChunks(root, filePath, metadata, context) {
  const relativeFile = relativePath(root, filePath);
  const content = await readText(filePath);
  const sections = splitTextIntoChunks(content.replace(/^---[\s\S]*?---\s*/m, ""));
  return sections.map((text, index) => ({
    id: `${metadata.area}:${metadata.module}:${metadata.docType}:${relativeFile}:${index + 1}`,
    area: metadata.area,
    module: metadata.module,
    doc_type: metadata.docType,
    path: relativeFile,
    text,
    source_files: [relativeFile],
    git_hash: context.gitHash,
    generated_at: context.generatedAt,
    baseline_status: "curated",
    semantic_status: "not-applicable",
    keywords: curatedKeywords(relativeFile, text, metadata.keywords),
  }));
}

async function discoverCuratedChunks(root, area, context) {
  const chunks = [];
  const addFiles = async (files, metadataFactory) => {
    for (const file of files) {
      chunks.push(...await createCuratedFileChunks(root, file, metadataFactory(file), context));
    }
  };

  const commonRoot = path.join(root, "llm-knowledge", "common");
  const commonFiles = await listFiles(commonRoot, [".md", ".yaml", ".yml"]);
  await addFiles(commonFiles, (file) => ({
    area: "common",
    module: normalizePath(path.relative(commonRoot, path.dirname(file))).split("/")[0] || "common",
    docType: "conventions",
    keywords: ["common", "project knowledge"],
  }));

  for (const selectedArea of area === "all" ? ["backend", "frontend"] : [area]) {
    if (!['backend', 'frontend'].includes(selectedArea)) {
      continue;
    }
    const modulesRoot = path.join(root, "llm-knowledge", selectedArea, "modules");
    const customFiles = (await listFiles(modulesRoot, [".md", ".yaml", ".yml", ".json"]))
      .filter((file) => normalizePath(file).includes("/custom/"));
    await addFiles(customFiles, (file) => {
      const relative = normalizePath(path.relative(modulesRoot, file));
      return {
        area: selectedArea,
        module: relative.split("/")[0],
        docType: "custom",
        keywords: ["manual", "custom"],
      };
    });
  }

  const workflowRoot = path.join(root, ".harness", "workflows");
  await addFiles(await listFiles(workflowRoot, [".yaml", ".yml", ".md"]), () => ({
    area: "common",
    module: "harness-workflows",
    docType: "workflow",
    keywords: ["harness", "workflow", "state"],
  }));

  const skillRoot = path.join(root, ".codex", "skills");
  const skillFiles = (await listFiles(skillRoot, [".md"]))
    .filter((file) => path.basename(file).toLowerCase() === "skill.md");
  await addFiles(skillFiles, () => ({
    area: "common",
    module: "project-skills",
    docType: "skill",
    keywords: ["skill", "codex"],
  }));

  const agentsFile = path.join(root, "AGENTS.md");
  if (existsSync(agentsFile)) {
    await addFiles([agentsFile], () => ({
      area: "common",
      module: "project-rules",
      docType: "conventions",
      keywords: ["agents", "rules", "quality gate"],
    }));
  }

  return chunks;
}

async function writePlanned(result, filePath, content, dryRun) {
  const normalized = normalizePath(filePath);
  result.plannedWrites.push(normalized);
  if (dryRun) {
    return;
  }
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
  result.writtenFiles.push(normalized);
}

async function ensureCustomDirectory(root, area, moduleName, result, dryRun) {
  const keepPath = moduleDocPath(root, area, moduleName, "custom/.gitkeep");
  if (existsSync(keepPath)) {
    return;
  }
  await writePlanned(result, keepPath, "", dryRun);
}

async function appendModuleLog(root, area, moduleName, generatedAt, mode, semanticStatus, result, dryRun) {
  const logPath = moduleDocPath(root, area, moduleName, "log.md");
  const entry = `\n- ${generatedAt}: generate-kb mode=${mode}, semantic_status=${semanticStatus}\n`;
  result.plannedWrites.push(normalizePath(logPath));
  if (dryRun) {
    return;
  }
  await mkdir(path.dirname(logPath), { recursive: true });
  await appendFile(logPath, entry, "utf8");
  result.writtenFiles.push(normalizePath(logPath));
}

function parseGeneratedDocumentMeta(content) {
  const frontmatter = content.match(/^---\s*\n([\s\S]*?)\n---/)?.[1] ?? "";
  const value = (name) => frontmatter.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  return {
    gitHash: value("git_hash"),
    generatedAt: value("generated_at"),
    baselineStatus: value("baseline_status"),
    semanticStatus: value("semantic_status"),
  };
}

async function readGeneratedDocumentMeta(filePath) {
  if (!existsSync(filePath)) return null;
  return parseGeneratedDocumentMeta(await readText(filePath));
}

function normalizedDocumentStatus(status, documentHash, currentHash, sourceChanged, missingStatus) {
  if (!status) return missingStatus;
  if (sourceChanged) return "stale";
  if (status === "fresh" && documentHash && currentHash !== "unknown" && documentHash !== currentHash) return "stale";
  return status;
}

async function collectModuleFreshness(root, module, currentHash, changedPaths) {
  const baseline = await readGeneratedDocumentMeta(moduleDocPath(root, module.area, module.name, "overview.md"));
  const semantic = await readGeneratedDocumentMeta(moduleDocPath(root, module.area, module.name, "semantic.md"));
  const trackedSources = [
    ...module.facts.source_files,
    ...(module.facts.resources ?? []).map((resource) => resource.file),
  ];
  const sourceChanged = trackedSources.some((sourceFile) => changedPaths.includes(sourceFile));
  const baselineStatus = normalizedDocumentStatus(
    baseline?.baselineStatus,
    baseline?.gitHash,
    currentHash,
    sourceChanged,
    "missing"
  );
  const semanticStatus = normalizedDocumentStatus(
    semantic?.semanticStatus,
    semantic?.gitHash,
    currentHash,
    sourceChanged,
    "pending"
  );
  return {
    baselineGitHash: baseline?.gitHash ?? "",
    baselineGeneratedAt: baseline?.generatedAt ?? "",
    baselineStatus,
    semanticGitHash: semantic?.gitHash ?? "",
    semanticGeneratedAt: semantic?.generatedAt ?? "",
    semanticStatus,
    indexStatus: baselineStatus === "fresh" ? "fresh" : "partial",
  };
}

function aggregateBaselineStatus(moduleFreshness) {
  const statuses = moduleFreshness.map((item) => item.baselineStatus);
  if (statuses.length && statuses.every((status) => status === "fresh")) return "fresh";
  if (statuses.length && statuses.every((status) => status === "missing")) return "missing";
  return "partial";
}

function aggregateDocumentSemanticStatus(moduleFreshness) {
  const statuses = moduleFreshness.map((item) => item.semanticStatus);
  if (statuses.some((status) => status === "failed")) return "failed";
  if (statuses.some((status) => status === "stale")) return "stale";
  if (statuses.length && statuses.every((status) => status === "fresh")) return "fresh";
  return "pending";
}

function buildAreaMeta({ area, modules, moduleFreshness, generatedAt, gitHash, changedPaths, baselineStatus, semanticStatus, indexStatus, model, embeddingModel }) {
  const sourcePrefix = area === "backend" ? "backend/" : "frontend/";
  const sourceChanged = changedPaths.some((item) => item.startsWith(sourcePrefix));
  const technology = area === "backend"
    ? [
        "  language: Java 17",
        "  framework: Spring Boot 3.3.5",
        "  build: Maven",
        "  database: PostgreSQL",
        "  cache: Redis",
        "  migrations: Flyway",
      ]
    : [
        "  language: TypeScript",
        "  framework: Vue 3",
        "  build: Vite",
        "  state: Pinia",
        "  router: Vue Router",
        "  http: Axios",
      ];
  const lines = [
    'schema_version: "2.0"',
    `area: ${area}`,
    `root_path: ${area}`,
    `generated_at: "${generatedAt}"`,
    `git_hash: "${gitHash}"`,
    `status: ${sourceChanged || baselineStatus !== "fresh" || indexStatus !== "fresh" ? "partial" : "fresh"}`,
    `baseline_status: ${baselineStatus}`,
    `semantic_status: ${semanticStatus}`,
    `index_status: ${indexStatus}`,
    `source_changed: ${sourceChanged}`,
    `semantic_model: "${model}"`,
    `embedding_model: "${embeddingModel}"`,
    "technology:",
    ...technology,
    "modules:",
  ];
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index];
    const freshness = moduleFreshness[index];
    const docTypes = module.area === "backend" ? BACKEND_DOC_TYPES : FRONTEND_DOC_TYPES;
    lines.push(`  - name: ${module.name}`);
    lines.push(`    path: ${module.path}`);
    lines.push(`    type: ${module.type}`);
    lines.push("    docs:");
    for (const docType of [...docTypes, "semantic"]) {
      lines.push(`      ${docType.replace("-", "_")}: llm-knowledge/${area}/modules/${module.name}/${docType}.md`);
    }
    lines.push(`      facts: llm-knowledge/${area}/modules/${module.name}/facts.json`);
    lines.push("    freshness:");
    lines.push(`      git_hash: "${freshness.baselineGitHash}"`);
    lines.push(`      generated_at: "${freshness.baselineGeneratedAt}"`);
    lines.push(`      baseline_status: ${freshness.baselineStatus}`);
    lines.push(`      semantic_git_hash: "${freshness.semanticGitHash}"`);
    lines.push(`      semantic_generated_at: "${freshness.semanticGeneratedAt}"`);
    lines.push(`      semantic_status: ${freshness.semanticStatus}`);
    lines.push(`      index_status: ${freshness.indexStatus}`);
  }
  return `${lines.join("\n")}\n`;
}

function buildIndexManifest({ root, chunks, generatedAt, gitHash, areas, semanticStatus, embeddingsStatus, embeddingModel }) {
  return {
    schema_version: "1.0",
    generated_by: "frontier-kb-generate",
    generated_at: generatedAt,
    git_hash: gitHash,
    areas,
    chunk_count: chunks.length,
    semantic_status: semanticStatus,
    embeddings_status: embeddingsStatus,
    embedding_model: embeddingModel,
    files: {
      chunks: "llm-knowledge/index/chunks.json",
      embeddings: embeddingsStatus === "fresh" ? "llm-knowledge/index/embeddings.jsonl" : null,
    },
  };
}

async function buildSourceCoverage(root, area, modules, generatedAt, gitHash, scanResult = {}) {
  const parsedFiles = unique(modules.flatMap((module) => module.facts.source_files));
  const resourceFiles = unique(scanResult.resourceFiles ?? []);
  const failedFiles = scanResult.failedFiles ?? [];
  const candidateRoots = area === "backend"
    ? [path.join(root, BACKEND_SOURCE_ROOT), path.join(root, BACKEND_RESOURCE_ROOT)]
    : [path.join(root, FRONTEND_SOURCE_ROOT)];
  const candidateFiles = unique((await Promise.all(candidateRoots.map((candidateRoot) => listAllFiles(candidateRoot))))
    .flat()
    .map((file) => relativePath(root, file)));
  const handledFiles = new Set([...parsedFiles, ...resourceFiles, ...failedFiles.map((failure) => failure.file)]);
  return {
    schema_version: "1.0",
    generated_by: "frontier-kb-generate",
    generated_at: generatedAt,
    git_hash: gitHash,
    area,
    parsed_files: parsedFiles,
    resource_files: resourceFiles,
    skipped_files: candidateFiles.filter((file) => !handledFiles.has(file)),
    failed_files: failedFiles,
  };
}

async function readExistingIndexChunks(indexRoot) {
  const chunksPath = path.join(indexRoot, "chunks.json");
  if (!existsSync(chunksPath)) {
    return [];
  }

  try {
    const parsed = JSON.parse(await readFile(chunksPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function discoverModules(root, area, readTextImpl = readText) {
  const modules = [];
  const scanResults = {};
  if (area === "backend" || area === "all") {
    const backend = await discoverBackendModules(root, readTextImpl);
    modules.push(...backend.modules);
    scanResults.backend = backend;
  }
  if (area === "frontend" || area === "all") {
    const frontend = await discoverFrontendModules(root, readTextImpl);
    modules.push(...frontend.modules);
    scanResults.frontend = frontend;
  }
  return { modules, scanResults };
}

function aggregateSemanticStatus(moduleResults, includeSemantic) {
  if (!includeSemantic || !moduleResults.length) return "pending";
  if (moduleResults.some((item) => item.status === "failed")) return "failed";
  if (moduleResults.some((item) => item.status !== "fresh")) return "pending";
  return "fresh";
}

async function readAreaSemanticStatus(root, area) {
  const metaPath = path.join(root, "llm-knowledge", area, "meta.yaml");
  if (!existsSync(metaPath)) return "pending";
  const content = await readText(metaPath);
  return content.match(/^semantic_status:\s*([^\s]+)\s*$/m)?.[1] ?? "pending";
}

export async function runGenerateKnowledge(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const area = options.area ?? "all";
  const moduleName = options.module ?? "";
  const mode = options.mode ?? "all";
  const dryRun = Boolean(options.dryRun);
  const withEmbeddings = Boolean(options.withEmbeddings);
  const env = options.env ?? process.env;
  const generatedAt = new Date().toISOString();
  const gitHash = await getGitHash(root);
  const changedPaths = await getChangedPaths(root);
  const discovery = await discoverModules(root, area, options.readTextImpl ?? readText);
  const discoveredModules = discovery.modules;
  const modules = moduleName
    ? discoveredModules.filter((module) => module.name === moduleName)
    : discoveredModules;
  if (moduleName && !modules.length) {
    throw new Error(`Module '${moduleName}' was not found in area '${area}'.`);
  }
  const result = {
    root,
    area,
    module: moduleName || null,
    mode,
    dryRun,
    withEmbeddings,
    modules: modules.map((module) => ({ area: module.area, name: module.name, path: module.path })),
    plannedWrites: [],
    writtenFiles: [],
    semantic: { status: "pending", model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL },
    embeddings: { status: "skipped", model: env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL },
  };

  const includeBaseline = mode === "baseline" || mode === "all";
  const includeSemantic = mode === "semantic" || mode === "all";
  const docs = [];
  const chunks = [];
  const semanticModules = [];

  for (const module of modules) {
    const context = {
      root,
      generatedAt,
      gitHash,
      semanticStatus: "pending",
    };
    let semanticContent = null;
    if (includeSemantic) {
      const semantic = dryRun
        ? {
            status: "pending",
            model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
            message: "Dry run skips OpenAI semantic enrichment.",
            content: buildPendingSemanticDoc(module, context, {
              status: "pending",
              model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
              message: "Dry run skips OpenAI semantic enrichment.",
            }),
          }
        : await callOpenAIForSemantic(module, context, env, {
            fetchImpl: options.fetchImpl,
            timeoutMs: options.semanticTimeoutMs,
          });
      semanticModules.push({
        area: module.area,
        module: module.name,
        status: semantic.status,
        message: semantic.message,
      });
      semanticContent = semantic.content;
      context.semanticStatus = semantic.status;
    } else {
      const semanticPath = moduleDocPath(root, module.area, module.name, "semantic.md");
      if (existsSync(semanticPath)) {
        context.semanticStatus = (await readText(semanticPath)).match(/semantic_status:\s*(\w+)/)?.[1] ?? "pending";
      } else {
        semanticContent = buildPendingSemanticDoc(module, context, {
          status: "pending",
          model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
          message: "本次未运行 L2 语义增强。",
        });
      }
    }

    await ensureCustomDirectory(root, module.area, module.name, result, dryRun);
    await writePlanned(result, moduleDocPath(root, module.area, module.name, "facts.json"), `${JSON.stringify(module.facts, null, 2)}\n`, dryRun);
    const moduleDocs = docsForModule(module, { ...context, semanticStatus: context.semanticStatus }, includeBaseline, semanticContent);
    for (const entry of moduleDocs) {
      docs.push({ ...entry, moduleObject: module });
      await writePlanned(result, moduleDocPath(root, entry.area, entry.module, `${entry.docType}.md`), entry.content, dryRun);
    }
    await appendModuleLog(root, module.area, module.name, generatedAt, mode, context.semanticStatus, result, dryRun);
  }

  const selectedAreas = unique(modules.map((module) => module.area));
  const semanticStatus = includeSemantic
    ? aggregateSemanticStatus(semanticModules, true)
    : aggregateSemanticStatus(
        await Promise.all(selectedAreas.map(async (selectedArea) => ({ status: await readAreaSemanticStatus(root, selectedArea) }))),
        true
      );
  result.semantic = {
    status: semanticStatus,
    model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
    message: includeSemantic
      ? semanticModules.length === 1
        ? semanticModules[0].message
        : `${semanticModules.filter((item) => item.status === "fresh").length}/${semanticModules.length} modules enriched successfully.`
      : "Semantic enrichment was not requested.",
    modules: semanticModules,
  };

  for (const entry of docs) {
    chunks.push(createChunk(entry, entry.moduleObject, {
      root,
      gitHash,
      generatedAt,
      semanticStatus: entry.docType === "semantic" ? (entry.content.match(/semantic_status:\s*(\w+)/)?.[1] ?? "pending") : "pending",
    }));
  }

  const curatedChunks = await discoverCuratedChunks(root, area, { gitHash, generatedAt });

  const indexRoot = path.join(root, "llm-knowledge", "index");
  const existingChunks = await readExistingIndexChunks(indexRoot);
  const preservedChunks = existingChunks.filter((chunk) => {
    if (!selectedAreas.includes(chunk.area)) return true;
    if (moduleName && chunk.module !== moduleName) return true;
    if (chunk.doc_type === "semantic") return !includeSemantic;
    return !includeBaseline;
  });
  const chunkById = new Map();
  for (const chunk of [...preservedChunks, ...chunks, ...curatedChunks]) {
    chunkById.set(chunk.id, chunk);
  }
  const indexChunks = [...chunkById.values()].sort((left, right) => (
    `${left.area}:${left.module}:${left.doc_type}`.localeCompare(`${right.area}:${right.module}:${right.doc_type}`)
  ));
  const indexAreas = unique(indexChunks.map((chunk) => chunk.area));

  const embeddingModel = env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL;
  let embeddingsStatus = "skipped";
  if (withEmbeddings) {
    embeddingsStatus = "disabled";
    result.embeddings = {
      status: "disabled",
      model: embeddingModel,
      message: "Embedding generation is disabled until a tested retrieval consumer is implemented.",
    };
  }

  const manifest = buildIndexManifest({ root, chunks: indexChunks, generatedAt, gitHash, areas: indexAreas, semanticStatus, embeddingsStatus, embeddingModel });
  await writePlanned(result, path.join(indexRoot, "chunks.json"), `${JSON.stringify(indexChunks, null, 2)}\n`, dryRun);
  await writePlanned(result, path.join(indexRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, dryRun);

  for (const selectedArea of selectedAreas) {
    const areaModules = (moduleName ? discoveredModules : modules)
      .filter((module) => module.area === selectedArea);
    const moduleFreshness = await Promise.all(
      areaModules.map((module) => collectModuleFreshness(root, module, gitHash, changedPaths))
    );
    const areaBaselineStatus = aggregateBaselineStatus(moduleFreshness);
    const areaSemanticStatus = aggregateDocumentSemanticStatus(moduleFreshness);
    const areaIndexStatus = moduleFreshness.every((freshness) => freshness.indexStatus === "fresh")
      ? "fresh"
      : "partial";
    const sourceCoverage = await buildSourceCoverage(
      root,
      selectedArea,
      areaModules,
      generatedAt,
      gitHash,
      discovery.scanResults[selectedArea]
    );
    await writePlanned(
      result,
      path.join(root, "llm-knowledge", selectedArea, "source-coverage.json"),
      `${JSON.stringify(sourceCoverage, null, 2)}\n`,
      dryRun
    );
    const meta = buildAreaMeta({
      area: selectedArea,
      modules: areaModules,
      moduleFreshness,
      generatedAt,
      gitHash,
      changedPaths,
      baselineStatus: areaBaselineStatus,
      semanticStatus: areaSemanticStatus,
      indexStatus: areaIndexStatus,
      model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
      embeddingModel,
    });
    await writePlanned(result, path.join(root, "llm-knowledge", selectedArea, "meta.yaml"), meta, dryRun);
  }

  return result;
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--root":
        options.root = argv[++index];
        break;
      case "--area":
        options.area = argv[++index];
        break;
      case "--mode":
        options.mode = argv[++index];
        break;
      case "--module":
        options.module = argv[++index];
        break;
      case "--with-embeddings":
        options.withEmbeddings = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const result = await runGenerateKnowledge(options);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log("# FrontierScan Knowledge Generation");
  console.log(`Root: ${result.root}`);
  console.log(`Area: ${result.area}`);
  console.log(`Mode: ${result.mode}`);
  console.log(`Module: ${result.module ?? "all"}`);
  console.log(`Dry run: ${result.dryRun}`);
  console.log(`Modules: ${result.modules.length}`);
  console.log(`Semantic: ${result.semantic.status}`);
  console.log(`Embeddings: ${result.embeddings.status}`);
  console.log(`Planned writes: ${result.plannedWrites.length}`);
  console.log(`Written files: ${result.writtenFiles.length}`);
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isCli) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
