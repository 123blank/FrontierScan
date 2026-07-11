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

const BACKEND_DOC_TYPES = ["overview", "interfaces", "architecture", "dependencies", "storage", "config", "pitfalls"];
const FRONTEND_DOC_TYPES = ["overview", "routes", "components", "api-usage", "state", "pitfalls"];
const BACKEND_SOURCE_ROOT = "backend/src/main/java/com/frontierscan";
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

function parseBackendFile(root, filePath, moduleName, content) {
  const file = relativePath(root, filePath);
  const className = firstClassName(content, path.basename(filePath, ".java"));
  const classes = parseClassNames(content).map((item) => ({ ...item, file }));
  const imports = parseImports(content);
  const isController = /@RestController|@Controller/.test(content) || /Controller\.java$/.test(filePath);
  const baseMapping = isController
    ? parseAnnotationValue(content.match(/@RequestMapping\s*(?:\([^)]*\))?/)?.[0] ?? "")
    : "";
  const mappingRegex = /@(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping)\s*(?:\([^)]*\))?/g;
  const endpoints = [];
  if (isController) {
    for (const match of content.matchAll(mappingRegex)) {
      const annotation = match[1];
      if (annotation === "RequestMapping" && match.index === content.indexOf("@RequestMapping")) {
        continue;
      }
      const method = annotation.replace("Mapping", "").toUpperCase();
      endpoints.push({
        controller: className,
        method: method === "REQUEST" ? "ANY" : method,
        path: joinEndpoint(baseMapping, parseAnnotationValue(match[0])),
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
  };
}

async function discoverBackendModules(root) {
  const backendRoot = path.join(root, BACKEND_SOURCE_ROOT);
  if (!existsSync(backendRoot)) {
    return [];
  }

  const entries = await readdir(backendRoot, { withFileTypes: true });
  const modules = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modulePath = path.join(backendRoot, entry.name);
    const files = await listFiles(modulePath, [".java"]);
    const facts = {
      area: "backend",
      module: entry.name,
      root_path: normalizePath(path.relative(root, modulePath)),
      source_files: files.map((file) => relativePath(root, file)),
      file_count: files.length,
      classes: [],
      controllers: [],
      endpoints: [],
      entities: [],
      repositories: [],
      config_properties: [],
      scheduled_jobs: [],
      async_methods: [],
      imports: [],
      resources: [],
    };

    for (const file of files) {
      const parsed = parseBackendFile(root, file, entry.name, await readText(file));
      facts.classes.push(...parsed.classes);
      facts.controllers.push(...parsed.controllers);
      facts.endpoints.push(...parsed.endpoints);
      facts.entities.push(...parsed.entities);
      facts.repositories.push(...parsed.repositories);
      facts.config_properties.push(...parsed.configProperties);
      facts.scheduled_jobs.push(...parsed.scheduled);
      facts.async_methods.push(...parsed.asyncMethods);
      facts.imports.push(...parsed.imports);
    }

    modules.push({
      area: "backend",
      name: entry.name,
      type: "spring-package",
      path: facts.root_path,
      facts: { ...facts, imports: unique(facts.imports).slice(0, 80) },
    });
  }
  return modules;
}

function parseFrontendFile(root, filePath, areaName, content) {
  const file = relativePath(root, filePath);
  const apiCalls = [...content.matchAll(/apiClient\.(get|post|put|delete|patch)\s*(?:<[^>]+>)?\s*\(\s*(?:`([^`]+)`|'([^']+)'|"([^"]+)")/g)]
    .map((match) => ({ method: match[1].toUpperCase(), path: match[2] ?? match[3] ?? match[4], file }));
  const routes = [...content.matchAll(/path:\s*['"]([^'"]+)['"][\s\S]*?name:\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ path: match[1], name: match[2], file }));
  const stores = [...content.matchAll(/defineStore\s*\(\s*['"]([^'"]+)['"]/g)]
    .map((match) => ({ name: match[1], file }));
  const exports = [...content.matchAll(/export\s+(?:const|function|class|interface|type)\s+([A-Za-z0-9_]+)/g)]
    .map((match) => ({ name: match[1], file }));
  return {
    file,
    kind: path.extname(filePath).replace(".", "") || "unknown",
    apiCalls,
    routes,
    stores,
    exports,
    component: file.endsWith(".vue") ? path.basename(filePath) : "",
  };
}

async function discoverFrontendModules(root) {
  const frontendRoot = path.join(root, FRONTEND_SOURCE_ROOT);
  if (!existsSync(frontendRoot)) {
    return [];
  }

  const entries = await readdir(frontendRoot, { withFileTypes: true });
  const modules = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const modulePath = path.join(frontendRoot, entry.name);
    const files = await listFiles(modulePath, [".ts", ".tsx", ".js", ".vue", ".css"]);
    const parsedFiles = [];
    const facts = {
      area: "frontend",
      module: entry.name,
      root_path: normalizePath(path.relative(root, modulePath)),
      source_files: files.map((file) => relativePath(root, file)),
      file_count: files.length,
      files: parsedFiles,
      api_calls: [],
      routes: [],
      stores: [],
      exports: [],
      components: [],
    };

    for (const file of files) {
      const parsed = parseFrontendFile(root, file, entry.name, await readText(file));
      parsedFiles.push({ file: parsed.file, kind: parsed.kind });
      facts.api_calls.push(...parsed.apiCalls);
      facts.routes.push(...parsed.routes);
      facts.stores.push(...parsed.stores);
      facts.exports.push(...parsed.exports);
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
  return modules;
}

function yamlList(items, indent = 2) {
  if (!items.length) {
    return `${" ".repeat(indent)}[]`;
  }
  return items.map((item) => `${" ".repeat(indent)}- ${item}`).join("\n");
}

function docHeader({ area, moduleName, docType, generatedAt, gitHash, sourceFiles, layer, semanticStatus }) {
  return `---\ngenerated_by: frontier-kb-generate\nlayer: ${layer}\narea: ${area}\nmodule: ${moduleName}\ndoc_type: ${docType}\ngit_hash: ${gitHash}\ngenerated_at: ${generatedAt}\nbaseline_status: fresh\nsemantic_status: ${semanticStatus}\nsource_files:\n${yamlList(sourceFiles.slice(0, 30), 2)}\n---\n\n`;
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
      return `${header}# ${module.name} 路由基线\n\n${bullet(facts.routes.map((item) => `${item.path} -> ${item.name} (${item.file})`))}\n\nNeeds AI Review: 路由守卫、权限跳转和布局关系需结合源码进一步确认。\n`;
    case "components":
      return `${header}# ${module.name} 组件基线\n\n${bullet(facts.components.map((item) => `${item.name} (${item.file})`))}\n\n## Exports\n\n${bullet(facts.exports.map((item) => `${item.name} (${item.file})`))}\n\nNeeds AI Review: 组件职责、复用边界、表格/弹窗/筛选交互需补充。\n`;
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

async function callOpenAIForSemantic(module, context, env) {
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
    "输出 Markdown，包含：模块职责、核心流程、跨模块依赖、风险点、动态消费提示、来源文件。",
    JSON.stringify({ area: module.area, module: module.name, facts: module.facts }, null, 2).slice(0, 24000),
  ].join("\n\n");

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: prompt }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI response status ${response.status}`);
    }
    const payload = await response.json();
    const text = payload.output_text
      ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n")
      ?? "";
    if (!text.trim()) {
      throw new Error("OpenAI response did not include text output.");
    }
    const header = docHeader({
      ...context,
      area: module.area,
      moduleName: module.name,
      docType: "semantic",
      sourceFiles: module.facts.source_files,
      layer: "L2-semantic",
      semanticStatus: "fresh",
    });
    return {
      status: "fresh",
      model,
      message: "OpenAI semantic enrichment completed.",
      content: `${header}# ${module.name} 语义增强\n\nsemantic_status: fresh\nsemantic_model: ${model}\ngenerated_by: openai\n\n${text.trim()}\n`,
    };
  } catch (error) {
    return {
      status: "failed",
      model,
      message: `OpenAI 语义增强失败：${error.message}`,
      content: buildPendingSemanticDoc(module, context, {
        status: "failed",
        model,
        message: `OpenAI 语义增强失败：${error.message}`,
      }),
    };
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

function buildAreaMeta({ area, modules, generatedAt, gitHash, changedPaths, semanticStatus, indexStatus, model, embeddingModel }) {
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
    `status: ${sourceChanged ? "partial" : "fresh"}`,
    "baseline_status: fresh",
    `semantic_status: ${semanticStatus}`,
    `index_status: ${indexStatus}`,
    `source_changed: ${sourceChanged}`,
    `semantic_model: "${model}"`,
    `embedding_model: "${embeddingModel}"`,
    "technology:",
    ...technology,
    "modules:",
  ];
  for (const module of modules) {
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
    lines.push(`      git_hash: "${gitHash}"`);
    lines.push(`      generated_at: "${generatedAt}"`);
    lines.push("      baseline_status: fresh");
    lines.push(`      semantic_status: ${semanticStatus}`);
    lines.push(`      index_status: ${indexStatus}`);
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

async function callOpenAIEmbeddings(chunks, env) {
  const apiKey = env.OPENAI_API_KEY;
  const model = env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL;
  if (!apiKey) {
    return { status: "pending", model, lines: [], message: "OPENAI_API_KEY is not configured." };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input: chunks.map((chunk) => chunk.text.slice(0, 8000)) }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI embeddings status ${response.status}`);
    }
    const payload = await response.json();
    const lines = payload.data.map((item, index) => JSON.stringify({
      chunk_id: chunks[index].id,
      model,
      embedding: item.embedding,
    }));
    return { status: "fresh", model, lines, message: "Embeddings generated." };
  } catch (error) {
    return { status: "failed", model, lines: [], message: error.message };
  }
}

async function discoverModules(root, area) {
  const modules = [];
  if (area === "backend" || area === "all") {
    modules.push(...await discoverBackendModules(root));
  }
  if (area === "frontend" || area === "all") {
    modules.push(...await discoverFrontendModules(root));
  }
  return modules;
}

export async function runGenerateKnowledge(options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const area = options.area ?? "all";
  const mode = options.mode ?? "all";
  const dryRun = Boolean(options.dryRun);
  const withEmbeddings = Boolean(options.withEmbeddings);
  const env = options.env ?? process.env;
  const generatedAt = new Date().toISOString();
  const gitHash = await getGitHash(root);
  const changedPaths = await getChangedPaths(root);
  const modules = await discoverModules(root, area);
  const result = {
    root,
    area,
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
  let semanticStatus = includeSemantic ? "pending" : "pending";

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
        : await callOpenAIForSemantic(module, context, env);
      semanticStatus = semantic.status === "fresh" ? "fresh" : semanticStatus;
      result.semantic = { status: semantic.status, model: semantic.model, message: semantic.message };
      semanticContent = semantic.content;
      context.semanticStatus = semantic.status;
    } else {
      semanticContent = buildPendingSemanticDoc(module, context, {
        status: "pending",
        model: env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL,
        message: "本次未运行 L2 语义增强。",
      });
    }

    await ensureCustomDirectory(root, module.area, module.name, result, dryRun);
    await writePlanned(result, moduleDocPath(root, module.area, module.name, "facts.json"), `${JSON.stringify(module.facts, null, 2)}\n`, dryRun);
    const moduleDocs = docsForModule(module, { ...context, semanticStatus: context.semanticStatus }, includeBaseline || mode === "semantic", semanticContent);
    for (const entry of moduleDocs) {
      docs.push({ ...entry, moduleObject: module });
      await writePlanned(result, moduleDocPath(root, entry.area, entry.module, `${entry.docType}.md`), entry.content, dryRun);
    }
    await appendModuleLog(root, module.area, module.name, generatedAt, mode, context.semanticStatus, result, dryRun);
  }

  for (const entry of docs) {
    chunks.push(createChunk(entry, entry.moduleObject, {
      root,
      gitHash,
      generatedAt,
      semanticStatus: entry.docType === "semantic" ? (entry.content.match(/semantic_status:\s*(\w+)/)?.[1] ?? "pending") : "pending",
    }));
  }

  const selectedAreas = unique(modules.map((module) => module.area));
  const indexRoot = path.join(root, "llm-knowledge", "index");
  const preservedChunks = area === "all"
    ? []
    : (await readExistingIndexChunks(indexRoot)).filter((chunk) => chunk.area && !selectedAreas.includes(chunk.area));
  const indexChunks = [...preservedChunks, ...chunks].sort((left, right) => (
    `${left.area}:${left.module}:${left.doc_type}`.localeCompare(`${right.area}:${right.module}:${right.doc_type}`)
  ));
  const indexAreas = unique(indexChunks.map((chunk) => chunk.area));

  let embeddingsStatus = "skipped";
  let embeddingLines = [];
  let embeddingModel = env.OPENAI_EMBEDDING_MODEL || DEFAULT_OPENAI_EMBEDDING_MODEL;
  if (withEmbeddings) {
    const embeddings = dryRun
      ? { status: "pending", model: embeddingModel, lines: [], message: "Dry run skips OpenAI embeddings." }
      : await callOpenAIEmbeddings(indexChunks, env);
    result.embeddings = { status: embeddings.status, model: embeddings.model, message: embeddings.message };
    embeddingsStatus = embeddings.status;
    embeddingModel = embeddings.model;
    embeddingLines = embeddings.lines;
  }

  const manifest = buildIndexManifest({ root, chunks: indexChunks, generatedAt, gitHash, areas: indexAreas, semanticStatus, embeddingsStatus, embeddingModel });
  await writePlanned(result, path.join(indexRoot, "chunks.json"), `${JSON.stringify(indexChunks, null, 2)}\n`, dryRun);
  await writePlanned(result, path.join(indexRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, dryRun);
  if (embeddingLines.length) {
    await writePlanned(result, path.join(indexRoot, "embeddings.jsonl"), `${embeddingLines.join("\n")}\n`, dryRun);
  }

  for (const selectedArea of selectedAreas) {
    const areaModules = modules.filter((module) => module.area === selectedArea);
    const meta = buildAreaMeta({
      area: selectedArea,
      modules: areaModules,
      generatedAt,
      gitHash,
      changedPaths,
      semanticStatus,
      indexStatus: "fresh",
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
