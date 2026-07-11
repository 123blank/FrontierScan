---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: overview
git_hash: dfbb39a87e15c337796a7f2fb38cf48430fe769e
generated_at: 2026-07-06T09:39:30.103Z
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

# collection 后端模块概览

## 自动识别职责

- 模块路径：`backend/src/main/java/com/frontierscan/collection`
- Java 文件数：19
- 类/接口/记录/枚举数量：20
- Controller 数量：1
- Entity 数量：1
- Repository 数量：1

## 主要类

- class ArticleParser (backend/src/main/java/com/frontierscan/collection/ArticleParser.java)
- record QueryParam (backend/src/main/java/com/frontierscan/collection/ArticleParser.java)
- record CollectResult (backend/src/main/java/com/frontierscan/collection/CollectResult.java)
- record RawArticle (backend/src/main/java/com/frontierscan/collection/CollectResult.java)
- class CollectionFailureClassifier (backend/src/main/java/com/frontierscan/collection/CollectionFailureClassifier.java)
- class CollectionOrchestrator (backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java)
- class CollectionRun (backend/src/main/java/com/frontierscan/collection/CollectionRun.java)
- class CollectionRunController (backend/src/main/java/com/frontierscan/collection/CollectionRunController.java)
- interface CollectionRunRepository (backend/src/main/java/com/frontierscan/collection/CollectionRunRepository.java)
- class CollectionRunService (backend/src/main/java/com/frontierscan/collection/CollectionRunService.java)
- record CollectionScheduleProperties (backend/src/main/java/com/frontierscan/collection/CollectionScheduleProperties.java)
- class CollectionScheduler (backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java)
- interface Collector (backend/src/main/java/com/frontierscan/collection/Collector.java)
- class CollectorException (backend/src/main/java/com/frontierscan/collection/CollectorException.java)
- class ConnectionTimeoutException (backend/src/main/java/com/frontierscan/collection/ConnectionTimeoutException.java)
- class EmptyResultException (backend/src/main/java/com/frontierscan/collection/EmptyResultException.java)
- class HtmlCollector (backend/src/main/java/com/frontierscan/collection/HtmlCollector.java)
- class ParseException (backend/src/main/java/com/frontierscan/collection/ParseException.java)
- class RssCollector (backend/src/main/java/com/frontierscan/collection/RssCollector.java)
- class TagEvaluationAsyncService (backend/src/main/java/com/frontierscan/collection/TagEvaluationAsyncService.java)

## 语义说明

Needs AI Review: 请结合 L2 语义增强确认该模块的业务边界、核心流程和跨模块依赖。
