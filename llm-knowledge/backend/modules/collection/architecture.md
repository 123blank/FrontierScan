---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: architecture
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

# collection 架构基线

## 模块内部结构

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

## 定时/异步执行

- CollectionScheduler (backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java)
- CollectionOrchestrator -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java)

## 待增强说明

Needs AI Review: 请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
