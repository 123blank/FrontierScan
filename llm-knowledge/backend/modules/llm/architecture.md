---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: llm
doc_type: architecture
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
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

# llm 架构基线

## 模块内部结构

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

## 定时/异步执行

- 暂无自动识别结果。

## 待增强说明

Needs AI Review: 请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
