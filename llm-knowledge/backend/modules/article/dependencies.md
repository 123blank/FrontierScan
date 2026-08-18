---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: article
doc_type: dependencies
git_hash: f12d893896617845242abb75e23d577fc730d579
source_fingerprint: sha256:1be9274e55442429c8a5da213e792fd54df8500799df185c03b9f2242fc6efe6
generated_at: 2026-08-18T08:26:55.918Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/article/Article.java
  - backend/src/main/java/com/frontierscan/article/ArticleController.java
  - backend/src/main/java/com/frontierscan/article/ArticleRepository.java
  - backend/src/main/java/com/frontierscan/article/ArticleService.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryProperties.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryRecoveryScheduler.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryService.java
  - backend/src/main/java/com/frontierscan/article/ArticleSummaryStatus.java
  - backend/src/main/java/com/frontierscan/article/Favorite.java
  - backend/src/main/java/com/frontierscan/article/FavoriteArticleView.java
  - backend/src/main/java/com/frontierscan/article/FavoriteRepository.java
  - backend/src/main/java/com/frontierscan/article/package-info.java
---

# article 依赖基线

## 识别到的导入项

- com.frontierscan.collection.CollectResult
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.error.ResourceNotFoundException
- com.frontierscan.common.security.JwtPrincipal
- com.frontierscan.llm.LlmProperties
- com.frontierscan.llm.SummaryMapReduceException
- com.frontierscan.llm.SummaryMapReduceService
- com.frontierscan.llm.SummaryQualityEvaluator
- com.frontierscan.llm.SummaryQualityResult
- com.frontierscan.llm.SummaryRequest
- com.frontierscan.llm.SummaryResult
- com.frontierscan.llm.tag.TagEvaluationAgent
- com.frontierscan.llm.tag.mapper.ArticleTagMappingMapper
- jakarta.persistence.Column
- jakarta.persistence.Entity
- jakarta.persistence.GeneratedValue
- jakarta.persistence.GenerationType
- jakarta.persistence.Id
- jakarta.persistence.Table
- jakarta.validation.constraints.Pattern
- java.time.LocalDate
- java.time.LocalTime
- java.time.OffsetDateTime
- java.time.ZoneId
- java.util.List
- java.util.Map
- lombok.AllArgsConstructor
- lombok.Data
- lombok.NoArgsConstructor
- lombok.extern.slf4j.Slf4j
- org.slf4j.Logger
- org.slf4j.LoggerFactory
- org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
- org.springframework.boot.context.properties.ConfigurationProperties
- org.springframework.data.domain.Page
- org.springframework.data.domain.PageRequest
- org.springframework.data.domain.Pageable
- org.springframework.data.jpa.repository.JpaRepository
- org.springframework.data.jpa.repository.Query
- org.springframework.data.repository.query.Param
- org.springframework.scheduling.annotation.Scheduled
- org.springframework.security.core.annotation.AuthenticationPrincipal
- org.springframework.stereotype.Component
- org.springframework.stereotype.Service
- org.springframework.transaction.annotation.Transactional
- org.springframework.validation.annotation.Validated
- org.springframework.web.bind.annotation.DeleteMapping
- org.springframework.web.bind.annotation.GetMapping
- org.springframework.web.bind.annotation.PathVariable
- org.springframework.web.bind.annotation.PostMapping

## 待增强说明

需要 AI 审核：请区分框架依赖、业务依赖、外部服务依赖和测试替身。
