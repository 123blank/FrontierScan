---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: llm
doc_type: storage
git_hash: 4ab9c49f8ef459e1ab90bd143c1799fef2a46aa1
source_fingerprint: sha256:109e1ad7eb8d9914a617ea97266b44398468c426bf665808e0e74d2313e753dc
generated_at: 2026-07-11T17:38:46.678Z
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

# llm 存储基线

## Entities / Tables

- ArticleTagMapping -> article_tags (backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMapping.java)
- TagDomain -> tag_domains (backend/src/main/java/com/frontierscan/llm/tag/TagDomain.java)
- ArticleTagMappingPo -> article_tags (backend/src/main/java/com/frontierscan/llm/tag/mp/ArticleTagMappingPo.java)
- TagDomainPo -> tag_domains (backend/src/main/java/com/frontierscan/llm/tag/mp/TagDomainPo.java)

## Repositories / Mappers

- ArticleTagMappingRepository (backend/src/main/java/com/frontierscan/llm/tag/ArticleTagMappingRepository.java)
- TagDomainRepository (backend/src/main/java/com/frontierscan/llm/tag/TagDomainRepository.java)
- ArticleTagMappingMapper (backend/src/main/java/com/frontierscan/llm/tag/mapper/ArticleTagMappingMapper.java)
- TagDomainMapper (backend/src/main/java/com/frontierscan/llm/tag/mapper/TagDomainMapper.java)

## 待增强说明

Needs AI Review: 请结合 Flyway migration、索引、约束和查询模式补充数据语义。
