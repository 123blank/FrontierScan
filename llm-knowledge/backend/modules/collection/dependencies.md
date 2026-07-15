---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: dependencies
git_hash: 50253a205e583bc24faab6c8f50cdcf352ddae23
source_fingerprint: sha256:989e52a4506cb7a3a3f671a7d940614b1270a0f23460cd17c63d2f182d89b958
generated_at: 2026-07-15T03:45:44.398Z
baseline_status: fresh
semantic_status: pending
source_files:
  - backend/src/main/java/com/frontierscan/collection/ArticleParser.java
  - backend/src/main/java/com/frontierscan/collection/CollectResult.java
  - backend/src/main/java/com/frontierscan/collection/CollectionFailureClassifier.java
  - backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRun.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunController.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunRepository.java
  - backend/src/main/java/com/frontierscan/collection/CollectionRunService.java
  - backend/src/main/java/com/frontierscan/collection/CollectionScheduleProperties.java
  - backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java
  - backend/src/main/java/com/frontierscan/collection/Collector.java
  - backend/src/main/java/com/frontierscan/collection/CollectorException.java
  - backend/src/main/java/com/frontierscan/collection/ConnectionTimeoutException.java
  - backend/src/main/java/com/frontierscan/collection/EmptyResultException.java
  - backend/src/main/java/com/frontierscan/collection/HtmlCollector.java
  - backend/src/main/java/com/frontierscan/collection/ParseException.java
  - backend/src/main/java/com/frontierscan/collection/RssCollector.java
  - backend/src/main/java/com/frontierscan/collection/TagEvaluationAsyncService.java
  - backend/src/main/java/com/frontierscan/collection/package-info.java
---

# collection 依赖基线

## 识别到的 imports

- com.frontierscan.article.Article
- com.frontierscan.article.ArticleService
- com.frontierscan.article.ArticleSummaryService
- com.frontierscan.article.ArticleSummaryStatus
- com.frontierscan.common.api.ApiResponse
- com.frontierscan.common.security.JwtPrincipal
- com.frontierscan.site.Site
- com.frontierscan.site.SiteRepository
- com.frontierscan.site.SiteService
- com.rometools.rome.feed.synd.SyndEntry
- com.rometools.rome.feed.synd.SyndFeed
- com.rometools.rome.io.SyndFeedInput
- com.rometools.rome.io.XmlReader
- jakarta.persistence.Column
- jakarta.persistence.Entity
- jakarta.persistence.GeneratedValue
- jakarta.persistence.GenerationType
- jakarta.persistence.Id
- jakarta.persistence.Table
- java.net.URI
- java.net.URISyntaxException
- java.net.URL
- java.net.URLConnection
- java.net.URLDecoder
- java.net.URLEncoder
- java.nio.charset.StandardCharsets
- java.security.MessageDigest
- java.security.NoSuchAlgorithmException
- java.time.Duration
- java.time.Instant
- java.time.LocalDate
- java.time.LocalDateTime
- java.time.OffsetDateTime
- java.time.ZoneId
- java.time.ZonedDateTime
- java.time.format.DateTimeFormatter
- java.time.format.DateTimeParseException
- java.util.ArrayList
- java.util.Arrays
- java.util.Comparator
- java.util.Date
- java.util.HashSet
- java.util.HexFormat
- java.util.List
- java.util.Locale
- java.util.Map
- java.util.Objects
- java.util.Optional
- java.util.Set
- java.util.UUID

## 待增强说明

Needs AI Review: 请区分框架依赖、业务依赖、外部服务依赖和测试替身。
