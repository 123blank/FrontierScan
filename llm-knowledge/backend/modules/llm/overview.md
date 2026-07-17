---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: llm
doc_type: overview
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:5862707da6dc63e015b169d263bc4240c28c694d02c2070395d54422159c6615
generated_at: 2026-07-16T15:13:11.540Z
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

# llm 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/llm`
- Java 文件数：26
- 类/接口/记录/枚举数量：27
- 控制器数量：1
- 实体数量：4
- 数据仓库数量：4

## 主要类

- class DashScopeLlmProvider (backend/src/main/java/com/frontierscan/llm/DashScopeLlmProvider.java)
- record LlmProperties (backend/src/main/java/com/frontierscan/llm/LlmProperties.java)
- record SummaryMapReduceProperties (backend/src/main/java/com/frontierscan/llm/LlmProperties.java)
- record TagProperties (backend/src/main/java/com/frontierscan/llm/LlmProperties.java)
- interface LlmProvider (backend/src/main/java/com/frontierscan/llm/LlmProvider.java)
- class SummaryMapReduceException (backend/src/main/java/com/frontierscan/llm/SummaryMapReduceException.java)
- class SummaryMapReduceService (backend/src/main/java/com/frontierscan/llm/SummaryMapReduceService.java)
- class SummaryQualityEvaluator (backend/src/main/java/com/frontierscan/llm/SummaryQualityEvaluator.java)
- record SummaryQualityResult (backend/src/main/java/com/frontierscan/llm/SummaryQualityResult.java)
- record SummaryRequest (backend/src/main/java/com/frontierscan/llm/SummaryRequest.java)
- record SummaryResult (backend/src/main/java/com/frontierscan/llm/SummaryResult.java)
- class ArticleTagMapping (backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMapping.java)
- interface ArticleTagMappingRepository (backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMappingRepository.java)
- class DomainClassifier (backend/src/main/java/com/frontierscan/llm/tag/DomainClassifier.java)
- class LlmTagScorer (backend/src/main/java/com/frontierscan/llm/tag/LlmTagScorer.java)
- record ScoredDomain (backend/src/main/java/com/frontierscan/llm/tag/ScoredDomain.java)
- record ScoredTag (backend/src/main/java/com/frontierscan/llm/tag/ScoredTag.java)
- class TagController (backend/src/main/java/com/frontierscan/llm/tag/TagController.java)
- class TagDomain (backend/src/main/java/com/frontierscan/llm/tag/TagDomain.java)
- interface TagDomainRepository (backend/src/main/java/com/frontierscan/llm/tag/TagDomainRepository.java)
- class TagEvaluationAgent (backend/src/main/java/com/frontierscan/llm/tag/TagEvaluationAgent.java)
- record CandidateTag (backend/src/main/java/com/frontierscan/llm/tag/TagEvaluationAgent.java)
- record TagInfo (backend/src/main/java/com/frontierscan/llm/tag/TagInfo.java)
- interface ArticleTagMappingMapper (backend/src/main/java/com/frontierscan/llm/tag/mapper/ArticleTagMappingMapper.java)
- interface TagDomainMapper (backend/src/main/java/com/frontierscan/llm/tag/mapper/TagDomainMapper.java)
- class ArticleTagMappingPo (backend/src/main/java/com/frontierscan/llm/tag/mp/ArticleTagMappingPo.java)
- class TagDomainPo (backend/src/main/java/com/frontierscan/llm/tag/mp/TagDomainPo.java)

## 语义说明

需要 AI 审核：请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
