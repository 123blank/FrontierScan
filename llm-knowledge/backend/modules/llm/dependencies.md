---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: llm
doc_type: dependencies
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

# llm 依赖基线

## 识别到的导入项

- com.baomidou.mybatisplus.annotation.IdType
- com.baomidou.mybatisplus.annotation.TableId
- com.baomidou.mybatisplus.annotation.TableName
- com.baomidou.mybatisplus.core.conditions.query.QueryWrapper
- com.baomidou.mybatisplus.core.mapper.BaseMapper
- com.fasterxml.jackson.core.JsonProcessingException
- com.fasterxml.jackson.databind.JsonNode
- com.fasterxml.jackson.databind.ObjectMapper
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.llm.LlmProperties
- com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper
- com.frontierscan.llm.tag.mapper.TagDomainMapper
- com.frontierscan.llm.tag.mp.ArticleTagMappingPo
- com.frontierscan.llm.tag.mp.TagDomainPo
- jakarta.persistence.Column
- jakarta.persistence.Entity
- jakarta.persistence.GeneratedValue
- jakarta.persistence.GenerationType
- jakarta.persistence.Id
- jakarta.persistence.Table
- jakarta.persistence.UniqueConstraint
- java.io.IOException
- java.nio.charset.StandardCharsets
- java.time.Duration
- java.time.OffsetDateTime
- java.util.ArrayList
- java.util.Comparator
- java.util.HashMap
- java.util.HashSet
- java.util.LinkedHashMap
- java.util.List
- java.util.Locale
- java.util.Map
- java.util.Set
- java.util.concurrent.CompletableFuture
- java.util.concurrent.CompletionException
- java.util.concurrent.Executor
- java.util.regex.Pattern
- java.util.stream.Collectors
- lombok.AllArgsConstructor
- lombok.Data
- lombok.NoArgsConstructor
- lombok.extern.slf4j.Slf4j
- org.apache.ibatis.annotations.Mapper
- org.apache.ibatis.annotations.Param
- org.apache.ibatis.annotations.Select
- org.springframework.beans.factory.annotation.Qualifier
- org.springframework.boot.context.properties.ConfigurationProperties
- org.springframework.boot.web.client.RestTemplateBuilder
- org.springframework.core.io.ClassPathResource

## 待增强说明

需要 AI 审核：请区分框架依赖、业务依赖、外部服务依赖和测试替身。
