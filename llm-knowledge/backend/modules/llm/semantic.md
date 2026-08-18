---
generated_by: frontier-kb-generate
layer: L2-semantic
area: backend
module: llm
doc_type: semantic
git_hash: f12d893896617845242abb75e23d577fc730d579
source_fingerprint: sha256:5862707da6dc63e015b169d263bc4240c28c694d02c2070395d54422159c6615
generated_at: 2026-08-14T09:28:32.334Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/llm/DashScopeLlmProvider.java
  - backend/src/main/java/com/frontierscan/llm/LlmProperties.java
  - backend/src/main/java/com/frontierscan/llm/LlmProvider.java
  - backend/src/main/java/com/frontierscan/llm/SummaryMapReduceException.java
  - backend/src/main/java/com/frontierscan/llm/SummaryMapReduceService.java
  - backend/src/main/java/com/frontierscan/llm/SummaryQualityEvaluator.java
  - backend/src/main/java/com/frontierscan/llm/SummaryQualityResult.java
  - backend/src/main/java/com/frontierscan/llm/SummaryRequest.java
  - backend/src/main/java/com/frontierscan/llm/SummaryResult.java
  - backend/src/main/java/com/frontierscan/llm/package-info.java
  - backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMapping.java
  - backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMappingRepository.java
  - backend/src/main/java/com/frontierscan/llm/tag/DomainClassifier.java
  - backend/src/main/java/com/frontierscan/llm/tag/LlmTagScorer.java
  - backend/src/main/java/com/frontierscan/llm/tag/ScoredDomain.java
  - backend/src/main/java/com/frontierscan/llm/tag/ScoredTag.java
  - backend/src/main/java/com/frontierscan/llm/tag/TagController.java
  - backend/src/main/java/com/frontierscan/llm/tag/TagDomain.java
  - backend/src/main/java/com/frontierscan/llm/tag/TagDomainRepository.java
  - backend/src/main/java/com/frontierscan/llm/tag/TagEvaluationAgent.java
  - backend/src/main/java/com/frontierscan/llm/tag/TagInfo.java
  - backend/src/main/java/com/frontierscan/llm/tag/mapper/ArticleTagMappingMapper.java
  - backend/src/main/java/com/frontierscan/llm/tag/mapper/TagDomainMapper.java
  - backend/src/main/java/com/frontierscan/llm/tag/mp/ArticleTagMappingPo.java
  - backend/src/main/java/com/frontierscan/llm/tag/mp/TagDomainPo.java
  - backend/src/main/java/com/frontierscan/llm/tag/package-info.java
---

# llm 语义增强

semantic_status: pending
semantic_model: gpt-4.1-mini

## 当前状态

- 未配置 OPENAI_API_KEY，已降级为 L1 基线文档，L2 语义增强待补充。

## 待增强内容

- 模块职责和边界
- 核心业务流程
- 跨模块依赖和调用链
- 主要风险点和测试关注点
- 动态消费提示词和查询关键词
