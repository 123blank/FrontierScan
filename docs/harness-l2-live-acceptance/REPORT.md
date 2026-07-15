# Harness L2 真实语义验收报告

> 日期：2026-07-15
> 分支：`feat/harness-l2-live-acceptance`
> 结果：通过

## 执行范围

- 对 `backend/article` 执行了一次受控的真实语义增强。
- 只发送自动生成的结构化事实，长度上限为 24,000 个字符；未发送源码正文。
- 使用 OpenAI 兼容服务 `https://coding.xiaofeilun.cn/v1` 和模型 `gpt-5.5`。
- 未请求向量嵌入。
- 未打印、持久化或检查 API 密钥值。
- 未修改 `backend/src/**` 或 `frontend/src/**`。

## 实现内容

真实验收过程中发现了三个可稳定复现的集成缺口，并通过针对性回归测试完成修复：

1. 生成器原先将官方 API 地址硬编码在代码中。现在语义增强支持读取 `OPENAI_BASE_URL`，自动移除末尾斜杠，默认使用 `https://api.openai.com/v1`，并强制要求 HTTPS。Embedding 使用独立的 `EMBEDDING_BASE_URL` 和端点构造逻辑。
2. 网络失败原先只记录 `fetch failed`。现在会附加经过清理的 `error.cause.code`，例如 `ECONNREFUSED`，但不会记录主机、地址或底层错误详情。
3. 自定义兼容端点原先仍被错误标记为 `generated_by: openai`。现在官方端点记录为 `openai`，自定义端点记录为 `openai-compatible`，并将不含密钥的服务主机写入 `semantic_provider` 和本地索引分块。

兼容服务返回的准确模型标识为 `gpt-5.5`。`/responses` 和 `/chat/completions` 均通过最小协议探测，生成器继续使用现有的 Responses API 实现。

## 真实验收结果

通过仅作用于当前进程的临时代理传输完成了真实单模块生成：

```text
语义状态：fresh
模型：gpt-5.5
结果：OpenAI 语义增强已完成
向量嵌入：skipped
```

生成产物检查结果：

- `backend/article/semantic.md` 包含 `generated_by: openai-compatible` 和 `layer: L2-semantic`。
- `semantic_status` 为 `fresh`，`semantic_model` 为 `gpt-5.5`，`semantic_provider` 为 `coding.xiaofeilun.cn`。
- 前置元数据中的 12 个来源文件与 `facts.json` 完全一致，并且全部出现在语义正文中。
- 本地索引包含 `backend/article/semantic` 分块，其 `semantic_status` 为 `fresh`。
- 语义分块包含 `semantic_provider: coding.xiaofeilun.cn`，动态查询能够识别真实兼容服务来源。
- 查询 `ArticleController` 时，包含模型 `gpt-5.5` 的语义分块位于前五条结果中。
- 全局清单仍保持 `semantic_status: pending`，正确反映其他模块尚未完成 L2 增强。
- 全局清单保持 `embeddings_status: skipped`。

## 中文文档规范补充

- 已将本计划和报告的说明文字统一改为中文。
- 已将项目根目录 `AGENTS.md` 中文化，并增加“新增或更新的项目文档默认使用中文”的长期规范。
- 命令、路径、环境变量、API 字段、模型标识、状态值和代码标识符继续保留原文，避免影响执行和检索。
- 自动知识生成模板中的 `Needs AI Review`、`Controllers`、`HTTP Endpoints`、`Exports` 等英文说明已替换为中文。
- 按 TDD 完成模板修复：新增回归测试后先观察到英文模板导致测试失败，再进行最小文案修改并确认测试通过。
- 已重新生成全部 L1 基线，使现有知识文档和索引应用中文模板并更新公共知识指纹。

## 阿里百炼 Embedding 配置

- Embedding 已与 L2 语义增强使用不同的密钥、端点和模型配置，不再复用 `OPENAI_API_KEY` 或 `OPENAI_BASE_URL`。
- 默认密钥读取 `EMBEDDING_API_KEY`，未配置时读取系统中的 `DASHSCOPE_API_KEY`。
- 默认端点为 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- 默认模型为 `text-embedding-v4`；`OPENAI_EMBEDDING_MODEL` 仅保留为旧配置兼容兜底。
- `EMBEDDING_MODEL` 的优先级高于旧配置，`EMBEDDING_BASE_URL` 可覆盖默认端点。
- JSONL 记录、执行结果、区域 meta 和索引 manifest 均记录 `embedding_provider`。
- 仅配置语义增强使用的 `OPENAI_API_KEY` 时，Embedding 保持 `pending`，不会误用语义密钥。
- 本轮使用注入的模拟响应完成 TDD 验证，没有向阿里百炼发送真实知识分块。
- 当前 manifest 记录 `embedding_model: text-embedding-v4`、`embedding_provider: dashscope.aliyuncs.com` 和 `embeddings_status: skipped`。

## 验证记录

以下检查全部通过：

```text
node .harness/scripts/tests/source-fingerprint.test.mjs
node .harness/scripts/tests/harness-status.test.mjs
node .harness/scripts/tests/generate-kb.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/tests/kb-query.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/tests/kb-freshness.test.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/kb-query.ps1 -Query ArticleController -Mode knowledge-qa -Area backend -MaxMatches 5
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/check-kb-freshness.ps1 -Json
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/validate-structure.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ./.harness/scripts/smoke-harness-flow.ps1
git diff --check
git status --short -- backend/src frontend/src
```

新鲜度检查确认 `backend`、`frontend` 和 `common` 均为 `fresh`。结构检查覆盖 16 个目录、102 个文件和 13 个 Skill 文件。Harness 冒烟流程正常完成，业务源码审计没有发现修改。

## 排查记录

- 最初直接访问官方 API 时出现 `ECONNREFUSED` 或连接超时，因为 Node 没有自动使用本地规则模式代理。
- 通过显式代理可以访问官方端点，但当前凭据未被官方端点接受。
- 用户随后提供了实际使用的兼容服务地址，通过认证的 `GET /models` 返回 HTTP 200。
- 原默认模型 `gpt-4.1-mini` 在该服务中不可用，请求返回 HTTP 404。
- 使用可用模型完成最小请求，确认两种 API 协议均受支持，然后执行最终的 `gpt-5.5` 真实生成。

## 剩余边界

- 当前只有 `backend/article` 完成了真实 L2 增强，其他后端和前端模块按设计保持 `pending`。
- 代理传输只注入本次验收进程，没有写入仓库配置。在 Node 无法直接访问目标服务的环境中，仍需使用 TUN 路由或显式可信代理传输。
- 第三方兼容服务会接收语义增强所需的结构化模块事实，其可用性和数据处理策略属于外部依赖。
- 本任务没有执行真实向量生成；阿里百炼接口连通性、实际向量维度和全量调用成本仍需在获得单独数据外发批准后验收。

## 评审问题修复

### 根因

- 阿里百炼官方同步接口文档规定 `text-embedding-v4` 单次最大输入行数为 10。
- 生成器原先使用固定批量大小 64；当前本地索引包含数百个分块，真实执行时首批请求会超过服务限制并使整次 Embedding 生成进入 `failed`。
- 原测试只覆盖单模块的少量分块，没有触发多批次边界。

### TDD 过程

1. 新增全区域多批次测试，要求请求数大于 1、每批最多 10 条，并校验所有批次的输入总数与最终向量记录数一致。
2. 保持原实现运行测试，测试在 `batchSizes.length > 1` 断言处失败，确认旧实现仍发送一个大批次。
3. 将 `DEFAULT_EMBEDDING_BATCH_SIZE` 从 64 最小调整为 10。
4. 再次运行生成器测试，新增测试和原有回归测试全部通过。

### 文档修复

- `.harness/scripts/README.md` 已改为中文，并更新为当前实际配置协议。
- README 现在说明 Embedding 使用 `EMBEDDING_API_KEY`，缺失时回退到 `DASHSCOPE_API_KEY`，并支持 `EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL`。
- `OPENAI_EMBEDDING_MODEL` 仅作为旧配置兼容项，不再引导用户使用 `OPENAI_API_KEY` 作为 Embedding 密钥。

### 回归结果

- `source-fingerprint`、`harness-status`、`generate-kb`、`kb-query` 和 `kb-freshness` 测试全部通过。
- 结构检查覆盖 16 个目录、102 个文件和 13 个 Skill 文件，结果通过。
- Harness 冒烟流程通过；知识生成 DryRun 实际写入文件数为 0。
- `backend`、`frontend` 和 `common` 新鲜度均为 `fresh`。
- 未向阿里百炼发送真实知识分块，未修改 `backend/src/**` 或 `frontend/src/**`。

## 配置契约一致性防回归

### 修复范围

- `.harness/scripts/README.md`：现行脚本入口说明。
- `.codex/skills/frontier-kb-generate/SKILL.md`：Codex 动态工作流说明。
- `docs/AI-handover.md`：项目交接现状与里程碑边界。
- `llm-knowledge/index/chunks.json`：AI 动态消费索引。
- `docs/harness-kb-integrity-fixes/REPORT.md`：历史实现报告的已废弃配置提示。

### 防回归机制

生成器回归测试新增了操作文档契约检查。四个当前生效的入口必须同时包含：

```text
EMBEDDING_API_KEY
DASHSCOPE_API_KEY
EMBEDDING_BASE_URL
EMBEDDING_MODEL
text-embedding-v4
```

测试同时禁止现行入口再次出现以下已废弃说明：

- 使用 `OPENAI_API_KEY` 和可选 `OPENAI_EMBEDDING_MODEL` 执行 Embedding。
- 将向量服务描述为 OpenAI Embeddings API。
- 将 `-WithEmbeddings` 描述为不可用。
- 将默认最大批量恢复为 64。

### TDD 证据

1. 首次 RED：契约测试在 `.codex/skills/frontier-kb-generate/SKILL.md` 缺少 `EMBEDDING_API_KEY` 时失败。
2. 修复 Skill 和交接文档后再次运行，第二次 RED 移动到 `llm-knowledge/index/chunks.json`，证明动态索引仍携带旧 Skill 快照。
3. 执行 `-Area all -Mode baseline` 后重建本地索引，没有调用语义或 Embedding 外部服务。
4. GREEN：生成器测试通过；索引中的旧 Skill 分块数量为 0，包含独立百炼配置的 Skill 分块数量为 1。

### 文档治理结果

- `frontier-kb-generate` Skill 已全文中文化，并记录百炼端点、默认模型、每批 10 条和失败降级行为。
- `AI-handover.md` 顶部状态更新到 2026-07-15，旧里程碑统一标记为历史记录，并新增 16.14 当前状态节。
- 历史完整性报告保留历史事实，但明确声明不再作为现行配置指南。
- 当前索引包含 327 个 Chunk，`semantic_status: pending`、`embeddings_status: skipped`、`embedding_provider: dashscope.aliyuncs.com`。

### 语义模型元数据修复

- 进一步核对发现，非 semantic 的 baseline 刷新会使用当前进程默认模型覆盖已有区域 `semantic_model`，导致文章语义文档为 `gpt-5.5` 而区域 meta 回落为 `gpt-4.1-mini`。
- 第三次 RED 使用 `semantic-model-v1` 完成 L2 模拟生成，再执行不带模型变量的 baseline 刷新；测试稳定复现元数据被覆盖。
- 生成器现已在非 semantic 模式下读取并保留已有区域 `semantic_model`；首次生成或显式 semantic 模式仍使用当前 `OPENAI_MODEL` 或脚本默认值。
- 使用仅作用于刷新进程的 `OPENAI_MODEL=gpt-5.5` 重建基线后，后端和前端区域 meta 均记录 `semantic_model: "gpt-5.5"`，且没有调用任何外部模型服务。

## 合并后跨平台指纹修复

- 在功能分支快进合并到本地 `dev` 后，验证发现 Windows 检出将部分公共知识源从 LF 转为 CRLF，导致原始字节指纹误报过期。
- 回归测试先稳定复现 LF 和 CRLF 生成不同指纹，修复后两者生成相同指纹。
- 指纹计算现仅对有效 UTF-8 文本规范化 CRLF，无法无损解码的二进制内容仍按原始字节处理。
- 已重建全量 L1 基线和本地索引，并将已有 `backend/article` 真实 L2 文档迁移到新指纹，未重复调用外部模型。
- 迁移后 `backend`、`frontend` 和 `common` 均为 `fresh`，语义总状态保持 `pending`，准确反映仍有其他模块未执行 L2 增强。
