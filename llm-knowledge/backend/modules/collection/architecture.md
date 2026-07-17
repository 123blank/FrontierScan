---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: architecture
git_hash: 2b15e640d9f0f6e5be179dee838b3cb70784470e
source_fingerprint: sha256:4e9f1793b07cc45e7a704d995e2e646a580692abd1703f60cae725f4320b482f
generated_at: 2026-07-16T15:13:11.540Z
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

## 定时与异步执行

- CollectionScheduler (backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java)
- CollectionOrchestrator -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java)

## 待增强说明

需要 AI 审核：请补充核心调用链、事务边界、异步补偿流程和跨模块协作方式。
