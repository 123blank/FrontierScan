---
generated_by: frontier-kb-generate
layer: L1-baseline
area: backend
module: collection
doc_type: config
git_hash: 8f741538f612f9293972aaff3a81e8c3812b8236
source_fingerprint: sha256:4e9f1793b07cc45e7a704d995e2e646a580692abd1703f60cae725f4320b482f
generated_at: 2026-07-15T15:48:15.724Z
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

# collection 配置基线

## 配置属性

- app.collection -> CollectionScheduleProperties (backend/src/main/java/com/frontierscan/collection/CollectionScheduleProperties.java)

## 异步与调度配置线索

- CollectionScheduler (backend/src/main/java/com/frontierscan/collection/CollectionScheduler.java)
- CollectionOrchestrator -> frontierScanCollectionExecutor (backend/src/main/java/com/frontierscan/collection/CollectionOrchestrator.java)

## 待增强说明

需要 AI 审核：请补充环境变量、默认值、生产风险和降级行为。
