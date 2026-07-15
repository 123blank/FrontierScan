# Harness L2 真实语义验收计划

> 日期：2026-07-15
> 分支：`feat/harness-l2-live-acceptance`
> 状态：已完成

## 目标

使用系统中已配置的 `OPENAI_API_KEY`，对后端 `article` 模块执行一次受控的真实 OpenAI 兼容语义增强，并验证 L2 协议在模拟测试以外的真实环境中可以正常工作。

## 范围

- 仅处理 `backend/article`。
- 仅运行语义增强模式，不重新生成完整基线。
- L2 真实验收不启用向量嵌入；后续仅使用模拟响应验证百炼 Embedding 配置，不上传真实知识分块。
- 验证生成的语义内容、来源可追溯性、模型元数据、索引集成和新鲜度状态。
- 如果真实运行暴露出可稳定复现的实现缺陷，先补充失败回归测试，再进行最小修复。

## 安全边界

- 不打印、持久化或检查 `OPENAI_API_KEY` 的值。
- 不读取 `.env`、终端历史记录、私钥或无关的本地配置。
- 不修改 `backend/src/**` 或 `frontend/src/**`。
- 不执行发布、部署、推送、发版或其他会改变外部交付状态的操作。
- 未经单独批准，本任务不向百炼发送真实向量嵌入请求。

## 执行步骤

1. 验证当前分支基于 `dev`，并确认工作区除本计划外没有无关修改。
2. 只验证 `OPENAI_API_KEY` 是否存在，不输出其值。
3. 记录运行前 `backend/article` 的语义文档和索引状态。
4. 运行：

   ```powershell
   .\.harness\scripts\generate-kb.ps1 -Area backend -Module article -Mode semantic
   ```

5. 验证 `semantic.md` 的前置元数据和正文：
   - 官方端点为 `generated_by: openai`，自定义兼容端点为 `generated_by: openai-compatible`
   - `semantic_provider` 记录实际服务主机
   - `layer: L2-semantic`
   - `semantic_status: fresh`
   - 语义模型元数据不为空
   - 来源文件存在，并且能够追溯到 L1 事实数据
6. 验证 `chunks.json` 中存在文章模块的语义分块，并确认全局清单没有将未增强模块错误标记为完成。
7. 运行生成器、查询、新鲜度、结构、冒烟和空白字符检查。
8. 确认业务源码路径没有发生变化。
9. 在 `REPORT.md` 中记录命令、结果、外部调用范围和剩余边界。

## 阿里百炼 Embedding 配置扩展

### 配置协议

- `EMBEDDING_API_KEY`：Embedding 专用密钥；未配置时读取现有 `DASHSCOPE_API_KEY`。
- `EMBEDDING_BASE_URL`：Embedding 专用服务地址；默认 `https://dashscope.aliyuncs.com/compatible-mode/v1`。
- `EMBEDDING_MODEL`：Embedding 专用模型；默认 `text-embedding-v4`。
- `OPENAI_EMBEDDING_MODEL`：仅作为旧配置兼容兜底，优先级低于 `EMBEDDING_MODEL`。
- L2 语义增强继续独立使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`。

### TDD 步骤

1. 增加阿里百炼默认端点、默认模型、专用密钥和 provider 元数据断言，并确认旧实现测试失败。
2. 增加 `OPENAI_API_KEY` 不能代替 Embedding 专用密钥的隔离断言。
3. 实现最小独立配置解析和 HTTPS 校验。
4. 将 `embedding_provider` 写入执行结果、JSONL 记录、区域元数据和索引清单。
5. 运行知识生成器、查询、新鲜度、结构和 Harness 冒烟回归测试。

### 验收标准

1. 默认 Embedding 请求发送到百炼兼容端点并使用 `text-embedding-v4`。
2. `EMBEDDING_*` 与 `OPENAI_*` 两套凭据和端点相互隔离。
3. `DASHSCOPE_API_KEY` 可以作为默认密钥来源，且密钥值不会写入任何产物。
4. JSONL、manifest、区域 meta 和命令结果均记录 `embedding_provider: dashscope.aliyuncs.com`。
5. 未配置 Embedding 密钥时保持 `pending`，不误用语义增强密钥。
6. 本轮不发起真实 Embedding 请求。

## 验收标准

1. 真实 OpenAI 兼容请求只处理一个模块并成功完成，且不暴露凭据。
2. `backend/article/semantic.md` 由 OpenAI 兼容模型生成，并通过本地语义协议检查。
3. 语义产物中的来源文件与确定性的 L1 事实来源列表一致。
4. 本地索引可以查询到文章模块的语义分块。
5. 未进行语义增强的模块仍保持真实状态。
6. 基线和索引保持新鲜。
7. 相关 Harness 回归测试和结构检查全部通过。
8. 后端和前端业务源码均未修改。

## 完成结果

- 兼容服务地址：`https://coding.xiaofeilun.cn/v1`
- 语义模型：`gpt-5.5`
- 处理范围：仅 `backend/article`
- 生成结果：`generated_by: openai-compatible`、`semantic_provider: coding.xiaofeilun.cn`、`semantic_status: fresh`
- 全局语义状态：`pending`，因为其他模块尚未增强
- 向量嵌入状态：`skipped`
- 向量嵌入模型：`text-embedding-v4`
- 向量嵌入服务：`dashscope.aliyuncs.com`
- Embedding 配置已与 L2 语义增强配置分离，本轮未发送真实向量请求
- 计划中的回归测试、新鲜度检查、结构检查、冒烟检查和源码审计全部通过

## 评审问题修复计划

### 问题范围

1. 阿里百炼官方文档规定 `text-embedding-v4` 同步接口单次最多接收 10 行输入，生成器原批量大小为 64，真实全量请求会失败。
2. `.harness/scripts/README.md` 仍描述旧的 OpenAI Embedding 环境变量，与当前独立百炼配置不一致。

### TDD 步骤

1. 使用全区域知识分块新增多批次回归测试，断言单批不超过 10 条、请求数大于 1 且最终向量总数完整。
2. 保持原实现运行测试，确认测试因只发送一个超过上限的批次而失败。
3. 将默认 Embedding 批量大小最小调整为 10，并确认新增测试及原有生成器测试通过。
4. 更新公开脚本文档，准确说明 `EMBEDDING_API_KEY`、`DASHSCOPE_API_KEY`、`EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL`。
5. 运行知识生成、查询、新鲜度、结构、冒烟和业务源码审计回归。

### 验收标准

1. 每次 `text-embedding-v4` 请求最多包含 10 条输入。
2. 多批请求生成的向量数量与索引分块数量一致。
3. README 不再引导用户使用 `OPENAI_API_KEY` 作为 Embedding 密钥。
4. 不发起真实 Embedding 请求，不修改后端或前端业务源码。

## 配置契约一致性防回归计划

### 问题范围

Embedding 配置已经从 OpenAI 配置中独立，但当前操作文档没有共享可执行的一致性门禁，导致 README 修复后，Skill、交接文档和动态索引仍可能保留旧协议。

### 实现方案

1. 将 `.harness/scripts/README.md`、`.codex/skills/frontier-kb-generate/SKILL.md`、`docs/AI-handover.md` 和 `llm-knowledge/index/chunks.json` 定义为当前生效的 Embedding 操作契约载体。
2. 在现有生成器回归测试中增加文档契约检查，要求上述载体同时包含 `EMBEDDING_API_KEY`、`DASHSCOPE_API_KEY`、`EMBEDDING_BASE_URL`、`EMBEDDING_MODEL` 和默认模型 `text-embedding-v4`。
3. 禁止当前操作载体继续出现“使用 `OPENAI_API_KEY` 执行 Embedding”“OpenAI Embeddings API”或“`-WithEmbeddings` disabled”等已废弃说明。
4. 将项目本地 `frontier-kb-generate` Skill 全文更新为中文，并同步当前百炼配置、批量限制和失败降级行为。
5. 更新交接文档的顶部现状和知识工程现状，明确 L2 单模块真实验收结果及百炼 Embedding 的独立配置。
6. 重新生成 L1/索引，使动态消费内容与源 Skill 一致，再运行完整回归。

### 验收标准

1. 契约测试在旧 Skill、旧交接说明和旧索引存在时失败，修复后通过。
2. 所有当前操作入口对 Embedding 凭据、端点和模型的说明一致。
3. 历史报告保留历史事实，但显式标明已被当前协议取代，不作为现行配置指南。
4. `chunks.json` 不再向 AI 返回旧 Embedding 配置。
5. 知识新鲜度、结构校验和 Harness 冒烟流程保持通过。

### 语义模型元数据保持

1. 先使用非默认 `OPENAI_MODEL` 生成真实结构等价的 L2 语义文档和区域 meta。
2. 在不提供 `OPENAI_MODEL` 的情况下执行 baseline 局部刷新。
3. 要求 baseline 保留已有区域 `semantic_model`，不得回落到脚本默认模型。
4. 只有显式执行 semantic 模式时，才使用当前 `OPENAI_MODEL` 更新区域语义模型元数据。
