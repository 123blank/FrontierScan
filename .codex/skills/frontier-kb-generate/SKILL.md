---
name: frontier-kb-generate
description: 当需要从源码、文档、API、存储、前端路由或本地索引生成、刷新、语义增强、索引或检查 FrontierScan 的 llm-knowledge 时使用。
---

# Frontier 知识生成

在规划、设计、审核或验证前，需要构建或刷新 `llm-knowledge/` 时使用本 Skill。

核心分层：

```text
L0 源事实 -> L1 确定性基线 -> L2 OpenAI 语义增强 -> L3 本地关键词与元数据索引 -> L4 动态消费
```

## 快速工作流

1. 读取 `references/kb-document-types.md`。
2. 读取 `references/manual-note-preservation.md`。
3. 读取 `references/module-detection.md`。
4. 生成或试运行分层知识产物：

```powershell
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all -DryRun
.\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline
.\.harness\scripts\generate-kb.ps1 -Area all -Mode all
.\.harness\scripts\generate-kb.ps1 -Area backend -Module article -Mode baseline
.\.harness\scripts\generate-kb.ps1 -Area all -Mode baseline -WithEmbeddings
```

5. L2 语义增强只使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL`，响应必须通过生成器的严格语义结构校验。
6. `-WithEmbeddings` 只使用 `EMBEDDING_API_KEY`，未配置时回退到 `DASHSCOPE_API_KEY`；通过 `EMBEDDING_BASE_URL` 和 `EMBEDDING_MODEL` 覆盖默认百炼端点与 `text-embedding-v4`。`OPENAI_EMBEDDING_MODEL` 仅作为旧配置兼容兜底。
7. 保留所有 `custom/` 人工记录，并将生成记录追加到 `log.md`。
8. 记录确定性的区域和模块 `source_fingerprint`；`git_hash` 仅用于审计，不作为新鲜度权威依据。
9. 运行新鲜度和查询检查：

```powershell
.\.harness\scripts\check-kb-freshness.ps1
.\.harness\scripts\kb-query.ps1 -Query "ArticleController" -Mode api-search -Area backend
```

## 输出产物

- `llm-knowledge/backend/meta.yaml`
- `llm-knowledge/frontend/meta.yaml`
- 模块级知识文档
- 模块级 `facts.json`
- 区域级 `source-coverage.json`
- `llm-knowledge/index/chunks.json`
- `llm-knowledge/index/manifest.json`
- 追加式 `log.md`
- 可选的 `.harness/reports/knowledge-input-scan.md`
- 显式启用且成功时生成的 `llm-knowledge/index/embeddings.jsonl`

## 分层规则

| 层级 | 来源 | 输出 | 失败行为 |
| --- | --- | --- | --- |
| L1 基线 | 源码、配置、迁移、路由 | Markdown + `facts.json` | 必须保持确定性 |
| L2 语义 | OpenAI Responses API 对有界事实执行严格 JSON Schema 生成 | `semantic.md` | 缺少密钥、HTTP 失败、超时、JSON 损坏或结构非法时标记 `semantic_status: pending/failed` |
| L3 索引 | 自动生成知识、公共知识、Harness、Skill 和人工 Custom 知识 | `chunks.json`、`manifest.json`、可选 `embeddings.jsonl` | 外部服务失败时关键词与元数据索引仍可用，Embedding 失败不得阻塞 L1/L2/L3 |

`-WithEmbeddings` 是显式启用项。默认通过阿里百炼 OpenAI 兼容端点调用 `text-embedding-v4`，每批最多发送 10 条有界分块文本；生成器校验响应索引和向量值后，写入包含模型、provider 和源指纹元数据的本地 JSONL。项目尚未提供余弦或向量检索消费者，因此查询仍以本地关键词和元数据索引为主。

## 安全规则

- 不覆盖 `custom/` 下的人工记录。
- 不复制、输出或持久化任何密钥。
- 不读取 `.env`、终端历史、私有本地配置或未跟踪的密钥文件。
- 发现源码、公共知识、Skill、工作流或 Custom 知识时不跟随符号链接。
- 当前任务只需要一个模块时，不进行无必要的全量知识重建。
- 源文件变化或 OpenAI 语义增强未完成时，将生成文档标记为 `stale`、`partial`、`pending` 或 `failed`。
- 只有所有模块基线分块都匹配当前源指纹时，模块刷新才能推进区域索引指纹。
- 未经用户明确批准，不发送真实 Embedding 数据；语义增强和向量生成都不得修改业务代码或执行交付操作。
